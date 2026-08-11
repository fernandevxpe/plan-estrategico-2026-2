import { randomUUID } from "node:crypto";

import { FinanceUnavailableError, query } from "@/lib/financeiro/db";
import { gravarValorManual } from "@/lib/financeiro/modelo";

/**
 * PATCH /api/financeiro/modelo — o dono corrige uma célula do modelo.
 *
 * O QUE ESTA ROTA NÃO FAZ, e é o ponto: ela não altera lançamento nenhum. O
 * ledger continua sendo o que o extrato diz. O que ela grava é uma CAMADA por
 * cima — `fin_model_value` com `procedencia='manual'` — que a tela exibe no
 * lugar do realizado daquela célula.
 *
 * A distinção não é sutil. Se editar "Materiais de Obras de março" reclassificasse
 * lançamentos, uma correção de apresentação viraria uma reescrita do histórico
 * bancário, e a próxima importação a desfaria sem avisar. Separando as camadas,
 * o dono pode dizer "sei que faltou R$ 12 mil aqui, a nota ainda não caiu" sem
 * que ninguém precise fingir que o dinheiro saiu da conta.
 *
 * COMO SE DESFAZ. Enviar `valorCents: null` apaga a linha manual e devolve a
 * célula ao ledger. É por isso que apagar não grava zero: zero é uma afirmação
 * ("não houve movimento"), ausência é a devolução do controle.
 *
 * TRILHA. Toda gravação deixa `fin_audit_log` com o valor anterior, como as
 * demais escritas do módulo. Um número que o dono digitou e depois não reconhece
 * é exatamente o caso em que a pergunta "quem mudou isso e quando" precisa ter
 * resposta.
 */

const ENTITY = "xpe";

type Corpo = {
  ano?: unknown;
  mes?: unknown;
  linha?: unknown;
  valorCents?: unknown;
  motivo?: unknown;
};

function erro(mensagem: string, status = 400) {
  return Response.json({ erro: mensagem }, { status });
}

export async function PATCH(request: Request) {
  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("corpo não é JSON válido");
  }

  const ano = Number(corpo.ano);
  const mes = Number(corpo.mes);
  const linha = typeof corpo.linha === "string" ? corpo.linha.trim() : "";

  if (!linha) return erro("informe `linha` (slug da linha do modelo)");
  if (!Number.isInteger(ano) || !Number.isInteger(mes)) return erro("`ano` e `mes` precisam ser inteiros");

  // `null` é apagar; qualquer outra coisa precisa ser inteiro de centavos.
  // Aceitar decimal aqui deixaria R$ 12,34 virar 12.34 centavos numa linha e
  // 1234 em outra, dependendo de quem chamou.
  let valorCents: number | null = null;
  if (corpo.valorCents !== null && corpo.valorCents !== undefined) {
    const v = Number(corpo.valorCents);
    if (!Number.isSafeInteger(v)) return erro("`valorCents` precisa ser inteiro em centavos, ou null para apagar");
    valorCents = v;
  }

  const motivo = typeof corpo.motivo === "string" && corpo.motivo.trim() ? corpo.motivo.trim().slice(0, 500) : null;

  // Quem está logado, para carimbar a trilha. O middleware já autenticou; aqui
  // só se lê o nome. A senha nunca é lida nem registrada.
  const autor = autorDaRequisicao(request);

  try {
    const antes = await query<{ id: number; valor_cents: number }>(
      `SELECT v.id, v.valor_cents FROM fin_model_value v
         JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
        WHERE v.line_slug = $2 AND v.ano = $3 AND v.mes = $4 AND v.procedencia = 'manual'`,
      [ENTITY, linha, ano, mes]
    );

    const r = await gravarValorManual({ ano, mes, lineSlug: linha, valorCents, motivo: motivo ?? undefined, autor });
    if (!r.ok) return erro(r.erro, r.erro.includes("não existe") ? 404 : 400);

    // Apagar devolve o id da linha removida; gravar, o da linha gravada. Um dos
    // dois sempre existe quando a operação teve efeito.
    const alvo = r.id ?? antes[0]?.id ?? null;

    // `fin_audit_log.action` tem lista fechada desde a 0004 — insert, update,
    // delete, bulk_update, import, rollback. Um verbo próprio ("modelo.editar")
    // seria mais expressivo e o banco o recusa, com razão: relatório de
    // auditoria que precisa conhecer cada verbo novo deixa de ser relatório de
    // auditoria. O QUE mudou já está em `target_table` e no `after`.
    const acao = valorCents === null ? "delete" : antes.length ? "update" : "insert";

    await query(
      `INSERT INTO fin_audit_log (entity_id, batch_id, actor, action, target_table, target_id, before, after)
       SELECT e.id, $1, $2, $3, 'fin_model_value', $11::bigint,
              jsonb_build_object('valor_cents', $4::bigint),
              jsonb_build_object('valor_cents', $5::bigint, 'linha', $6::text, 'ano', $7::int, 'mes', $8::int, 'motivo', $9::text)
         FROM fin_entity e WHERE e.slug = $10`,
      [
        randomUUID(),
        autor,
        acao,
        antes[0]?.valor_cents ?? null,
        valorCents,
        linha,
        ano,
        mes,
        motivo,
        ENTITY,
        alvo
      ]
    );

    return Response.json({ ok: true, linha, ano, mes, valorCents });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) {
      return erro("banco do financeiro indisponível", 503);
    }
    return erro(e instanceof Error ? e.message : "falha ao gravar", 500);
  }
}

/** Usuário do basic auth que o middleware já validou, ou 'tela' quando ausente. */
function autorDaRequisicao(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("basic ")) return "tela";
  try {
    const decodificado = Buffer.from(header.slice(6), "base64").toString("utf8");
    const usuario = decodificado.split(":")[0]?.trim();
    return usuario || "tela";
  } catch {
    return "tela";
  }
}
