import { randomUUID } from "node:crypto";

import type pg from "pg";

import { FinanceUnavailableError, query, transaction } from "@/lib/financeiro/db";
import {
  GUARDAS_SAIDA,
  pareceInstituicaoFinanceira,
  slugArea,
  vinculoValido
} from "@/lib/financeiro/pessoas";
import { resolverNucleo, ValidacaoError } from "@/lib/financeiro/revisao";

/**
 * GET/PATCH /api/financeiro/pessoas/[id] — o cadastro de uma pessoa e as
 * decisões que hoje só existem por script.
 *
 * A rota irmã (`/api/financeiro/pessoas`) é declaradamente somente-leitura, e o
 * comentário dela diz por quê: corrigir um vínculo ou uma ligação muda a soma de
 * TODOS os meses passados de uma vez, então a escrita não pertence a um botão
 * dentro de um relatório. Esta rota é o outro lado dessa frase — o lugar onde a
 * mudança acontece com trilha, validação e um número dizendo quanto dinheiro ela
 * moveu.
 *
 * ONDE MORA A LÓGICA. O padrão da casa põe a mecânica em `lib/` e deixa a rota
 * traduzindo HTTP (é o que `/lancamentos/[id]` faz com `processarPatchClassificacao`).
 * Ali a extração era obrigatória porque DUAS rotas aplicam a mesma operação a
 * tabelas diferentes. Aqui há um escritor só, e o que `lib/financeiro/pessoas.ts`
 * exporta é o que a TELA também precisa — domínio de vínculo, normalização de
 * área, a regra de "isto é um banco, não uma pessoa", as guardas do ledger.
 * Duplicar qualquer uma dessas seria a divergência que o módulo inteiro evita;
 * mover a orquestração para lá só criaria uma função com um chamador.
 *
 * OS QUATRO INVARIANTES QUE ESTA ROTA SUSTENTA:
 *
 *   1. Toda alteração deixa linha em `fin_audit_log` com `before` — é o que
 *      torna o desfazer possível (0004) e o que separa "o dono decidiu" de "o
 *      número mudou sozinho".
 *   2. Decisão humana anterior nunca é apagada em silêncio: o `before` carrega
 *      quem decidiu e quando, e a própria linha da ligação guarda a decisão
 *      anterior em `evidence.decisao_humana.anterior`.
 *   3. Nada entra pela metade: cadastro e ligações no MESMO batch_id, na mesma
 *      transação. Confirmar uma ligação e falhar ao gravar a área deixaria a
 *      folha movida e o cadastro velho.
 *   4. Confirmar ligação de BANCO exige consentimento explícito. Não é
 *      paranoia: a migração 0027 desfez exatamente isso, 57 pessoas colapsadas
 *      em 19 instituições, "o erro mais destrutivo possível" para uma plataforma
 *      que existe para saber quanto custa cada pessoa.
 *
 * AUTENTICAÇÃO. Nenhuma inventada aqui: o middleware já cobre `/:path*` com
 * basic auth (e libera em desenvolvimento). Esta rota só LÊ o usuário que ele já
 * autenticou, para carimbar `actor` e `confirmed_by` com um nome em vez de
 * 'desconhecido'. A senha nunca é lida, comparada nem registrada.
 */

const ENTITY = "xpe";

type RouteParams = { params: Promise<{ id: string }> };

/** Colunas editáveis, com o nome do campo no corpo → coluna. Lista fechada. */
const COLUNA: Record<string, string> = {
  area: "area",
  employmentType: "employment_type",
  role: "role",
  status: "status",
  startDate: "start_date",
  endDate: "end_date",
  defaultNucleo: "default_nucleo",
  defaultCategoryCode: "default_category_id"
};

const STATUS_VALIDOS = new Set(["ativo", "inativo"]);
const DECISOES_VALIDAS = new Set(["confirmado", "rejeitado"]);

/**
 * A migration que falta, sinalizada como tal.
 *
 * Vira 501 e não 422: o pedido está correto, o schema é que ainda não chegou. Um
 * 422 diria ao usuário que ele errou o corpo, e ele tentaria outros valores para
 * sempre.
 */
class ColunaAusenteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColunaAusenteError";
  }
}

/**
 * Quem está mexendo, segundo o basic auth do middleware.
 *
 * Enquanto a senha for compartilhada isto devolve sempre o mesmo nome, e o
 * comentário de `fin_audit_log` já admite que nesse cenário a trilha é
 * decorativa. Ler o usuário mesmo assim é o que faz a trilha virar real no dia
 * em que o middleware ganhar o segundo par usuário:senha — sem reescrever nada
 * do que foi gravado até lá.
 */
function atorDaRequisicao(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return "ui";
  try {
    const decodificado = atob(header.slice("Basic ".length));
    const separador = decodificado.indexOf(":");
    const usuario = separador === -1 ? decodificado : decodificado.slice(0, separador);
    return usuario.trim() ? `ui:${usuario.trim()}` : "ui";
  } catch {
    return "ui";
  }
}

/** 'YYYY-MM-DD' que existe no calendário, ou null. Não aceita 2026-02-31. */
function dataValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

/**
 * O domínio de `employment_type` lido do CHECK DE VERDADE, não de uma cópia.
 *
 * `vinculoValido()` existe para dar a mensagem boa ("vínculo desconhecido: xyz")
 * sem ir ao banco. Mas uma lista em TypeScript que espelha um CHECK em SQL é
 * duas verdades esperando divergir — na próxima migration que acrescentar um
 * vínculo, a tela recusaria o valor que o banco aceita. Por isso a palavra final
 * é do `pg_get_constraintdef`: o código dá o texto, o banco dá o domínio.
 */
async function vinculoNoCheck(client: pg.PoolClient, valor: string): Promise<boolean> {
  const { rows } = await client.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = 'fin_person'::regclass AND conname = 'fin_person_employment_type_check'`
  );
  // Sem a constraint (banco novo, migration futura), o espelho em código decide.
  if (!rows[0]) return vinculoValido(valor);
  return rows[0].def.includes(`'${valor}'`);
}

/**
 * Categoria que pode ser padrão de uma PESSOA.
 *
 * Repete o filtro da consulta que alimenta o combo porque o combo é sugestão e
 * isto é garantia: um cliente que mande `defaultCategoryCode: "3.01"` direto na
 * API cadastraria receita como custo de gente, e a coluna
 * `default_category_id` — como a de `fin_counterparty` — não tem dimensão de
 * direção que impeça isso depois.
 */
async function resolverCategoriaDeCusto(
  client: pg.PoolClient,
  code: string
): Promise<{ id: number; code: string; name: string }> {
  const { rows } = await client.query<{ id: number; code: string; name: string; kind: string }>(
    `SELECT c.id, c.code, c.name, c.kind
       FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id
      WHERE e.slug = $1 AND c.code = $2 AND c.is_active`,
    [ENTITY, code]
  );
  const categoria = rows[0];
  if (!categoria) throw new ValidacaoError(`categoria desconhecida: ${code}`);
  if (!["pessoal", "custo_variavel_direto", "despesa_operacional"].includes(categoria.kind)) {
    throw new ValidacaoError(
      `${categoria.code} é do grupo "${categoria.kind}" e não pode ser custo padrão de uma pessoa: pagamento a pessoa é sempre saída`
    );
  }
  if (categoria.code === "5.99") {
    throw new ValidacaoError(
      "5.99 é o balde de despesa a classificar; cadastrá-lo como padrão registra a dívida de classificação em vez de pagá-la"
    );
  }
  return { id: categoria.id, code: categoria.code, name: categoria.name };
}

/** A coluna nova de 0029 já existe neste banco? */
async function temColunaCategoriaPadrao(client: pg.PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ tem: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'fin_person' AND column_name = 'default_category_id') AS tem`
  );
  return rows[0]?.tem ?? false;
}

// ---------------------------------------------------------------------------
// GET — o cadastro, as ligações (inclusive as propostas) e a trilha
// ---------------------------------------------------------------------------
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const temCategoria = (
      await query<{ tem: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'fin_person' AND column_name = 'default_category_id') AS tem`
      )
    )[0].tem;

    const pessoas = await query<Record<string, unknown>>(
      `SELECT p.id, p.name AS nome, p.legal_name AS nome_legal, p.area, p.role AS papel,
              p.employment_type AS vinculo, p.status, p.default_nucleo,
              to_char(p.start_date, 'YYYY-MM-DD') AS inicio,
              to_char(p.end_date, 'YYYY-MM-DD') AS fim,
              ${temCategoria ? "cp.code AS categoria_padrao" : "NULL::text AS categoria_padrao"}
         FROM fin_person p
         JOIN fin_entity e ON e.id = p.entity_id
         ${temCategoria ? "LEFT JOIN fin_category cp ON cp.id = p.default_category_id" : ""}
        WHERE p.id = $1 AND e.slug = $2`,
      [idNum, ENTITY]
    );
    if (!pessoas[0]) return Response.json({ error: `pessoa ${idNum} não encontrada` }, { status: 404 });

    const [ligacoes, historico] = await Promise.all([
      query(
        `SELECT l.id AS link_id, c.id AS counterparty_id, c.name AS contraparte,
                c.document_number AS documento, l.status, l.method AS metodo,
                l.confidence::text AS confianca, l.is_primary AS primaria, l.evidence,
                l.confirmed_by AS decidido_por,
                to_char(l.confirmed_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS decidido_em,
                COALESCE(SUM(-t.amount_cents), 0) AS saida_cents,
                count(t.id)::int AS n
           FROM fin_person_counterparty l
           JOIN fin_counterparty c ON c.id = l.counterparty_id
           LEFT JOIN fin_transaction t ON t.counterparty_id = c.id AND ${GUARDAS_SAIDA}
          WHERE l.person_id = $1
          GROUP BY l.id, c.id, c.name, c.document_number, l.status, l.method, l.confidence,
                   l.is_primary, l.evidence, l.confirmed_by, l.confirmed_at
          ORDER BY saida_cents DESC`,
        [idNum]
      ),
      // A trilha inclui as ligações da pessoa, não só a linha dela: confirmar um
      // link é a mudança que move dinheiro, e ela não apareceria num histórico
      // filtrado só por target_table='fin_person'.
      query(
        `SELECT a.id, a.target_table, a.target_id, a.action, a.before, a.after, a.fields, a.actor,
                to_char(a.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS quando
           FROM fin_audit_log a
          WHERE (a.target_table = 'fin_person' AND a.target_id = $1)
             OR (a.target_table = 'fin_person_counterparty'
                 AND a.target_id IN (SELECT id FROM fin_person_counterparty WHERE person_id = $1))
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 50`,
        [idNum]
      )
    ]);

    return Response.json({
      pessoa: pessoas[0],
      ligacoes,
      historico,
      categoriaPadraoDisponivel: temCategoria
    });
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PATCH — cadastro e decisão sobre ligações, numa transação só
// ---------------------------------------------------------------------------

type CorpoLigacao = { id?: unknown; status?: unknown; aceitarRiscoBanco?: unknown };

type Corpo = {
  area?: unknown;
  employmentType?: unknown;
  role?: unknown;
  status?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  defaultNucleo?: unknown;
  defaultCategoryCode?: unknown;
  ligacoes?: unknown;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  let body: Corpo;
  try {
    body = (await request.json()) as Corpo;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "corpo deve ser um objeto" }, { status: 400 });
  }

  const camposPedidos = Object.keys(COLUNA).filter((campo) => campo in body);
  const ligacoesPedidas = Array.isArray(body.ligacoes) ? (body.ligacoes as CorpoLigacao[]) : [];
  if (!camposPedidos.length && !ligacoesPedidas.length) {
    return Response.json(
      { error: `nada a alterar: informe ao menos um de ${Object.keys(COLUNA).join(", ")} ou ligacoes[]` },
      { status: 400 }
    );
  }

  // ── Validação do que não depende do banco ───────────────────────────────
  const valores: Record<string, string | null> = {};

  if ("area" in body) {
    // O invariante é "area não vazia": limpar a área de alguém pela API
    // devolveria a pessoa para "Sem time" sem que ninguém tivesse decidido isso.
    // Quem realmente quiser desfazer tem `status`, que é uma decisão declarada.
    if (typeof body.area !== "string" || !body.area.trim()) {
      return Response.json({ error: "area não pode ficar vazia" }, { status: 422 });
    }
    const slug = slugArea(body.area);
    if (!slug) {
      return Response.json(
        { error: `area "${body.area}" não gera um nome utilizável (só pontuação?)` },
        { status: 422 }
      );
    }
    valores.area = slug;
  }

  if ("employmentType" in body) {
    if (typeof body.employmentType !== "string" || !vinculoValido(body.employmentType)) {
      return Response.json(
        { error: `vínculo desconhecido: ${String(body.employmentType)}` },
        { status: 422 }
      );
    }
    valores.employment_type = body.employmentType;
  }

  if ("status" in body) {
    if (typeof body.status !== "string" || !STATUS_VALIDOS.has(body.status)) {
      return Response.json({ error: "status deve ser 'ativo' ou 'inativo'" }, { status: 422 });
    }
    valores.status = body.status;
  }

  if ("role" in body) {
    if (body.role !== null && typeof body.role !== "string") {
      return Response.json({ error: "role deve ser texto ou null" }, { status: 422 });
    }
    const papel = typeof body.role === "string" ? body.role.trim() : "";
    valores.role = papel || null;
  }

  for (const campo of ["startDate", "endDate"] as const) {
    if (!(campo in body)) continue;
    const valor = body[campo];
    if (valor === null || valor === "") {
      valores[COLUNA[campo]] = null;
      continue;
    }
    if (typeof valor !== "string" || !dataValida(valor)) {
      return Response.json({ error: `${campo} deve ser 'YYYY-MM-DD' ou null` }, { status: 422 });
    }
    valores[COLUNA[campo]] = valor;
  }

  if ("defaultNucleo" in body) {
    if (body.defaultNucleo !== null && typeof body.defaultNucleo !== "string") {
      return Response.json({ error: "defaultNucleo deve ser texto ou null" }, { status: 422 });
    }
    const nucleo = typeof body.defaultNucleo === "string" ? body.defaultNucleo.trim() : "";
    valores.default_nucleo = nucleo || null;
  }

  const ligacoes: { id: number; status: string; aceitarRiscoBanco: boolean }[] = [];
  for (const pedido of ligacoesPedidas) {
    const linkId = Number(pedido?.id);
    if (!Number.isInteger(linkId) || linkId <= 0) {
      return Response.json({ error: "ligacoes[].id inválido" }, { status: 400 });
    }
    if (typeof pedido?.status !== "string" || !DECISOES_VALIDAS.has(pedido.status)) {
      return Response.json(
        { error: "ligacoes[].status deve ser 'confirmado' ou 'rejeitado'" },
        { status: 422 }
      );
    }
    ligacoes.push({
      id: linkId,
      status: pedido.status,
      aceitarRiscoBanco: pedido.aceitarRiscoBanco === true
    });
  }

  const ator = atorDaRequisicao(request);
  const batchId = randomUUID();

  try {
    const resultado = await transaction(async (client) => {
      // ── A pessoa, travada até o COMMIT ──────────────────────────────────
      const { rows: pessoaRows } = await client.query<{
        id: number;
        entity_id: number;
        nome: string;
        area: string | null;
        role: string | null;
        employment_type: string;
        status: string;
        start_date: string | null;
        end_date: string | null;
        default_nucleo: string | null;
      }>(
        `SELECT p.id, p.entity_id, p.name AS nome, p.area, p.role, p.employment_type, p.status,
                to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
                to_char(p.end_date, 'YYYY-MM-DD') AS end_date,
                p.default_nucleo
           FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id
          WHERE p.id = $1 AND e.slug = $2
          FOR UPDATE OF p`,
        [idNum, ENTITY]
      );
      const pessoa = pessoaRows[0];
      if (!pessoa) return { naoEncontrada: true as const };

      // ── Validações que precisam do estado atual ─────────────────────────
      if (valores.employment_type && !(await vinculoNoCheck(client, valores.employment_type))) {
        throw new ValidacaoError(
          `vínculo "${valores.employment_type}" não é aceito pelo CHECK de fin_person.employment_type`
        );
      }

      // Saída antes da entrada é uma linha que nenhum relatório consegue ler: o
      // custo do período fica preso a um intervalo negativo. A comparação usa o
      // valor EFETIVO — o novo quando veio no corpo, o gravado quando não veio —
      // porque validar só contra o corpo deixaria passar "mudar a entrada para
      // depois da saída já existente".
      const inicioEfetivo = "start_date" in valores ? valores.start_date : pessoa.start_date;
      const fimEfetivo = "end_date" in valores ? valores.end_date : pessoa.end_date;
      if (inicioEfetivo && fimEfetivo && fimEfetivo < inicioEfetivo) {
        throw new ValidacaoError(
          `data de saída (${fimEfetivo}) é anterior à de entrada (${inicioEfetivo})`
        );
      }

      // A FK de `default_nucleo` já barraria um núcleo inexistente, mas com a
      // mensagem crua do Postgres ("violates foreign key constraint
      // fin_person_default_nucleo_fkey"), que não diz a quem lê qual valor
      // usar. `resolverNucleo` é a mesma checagem que as rotas de classificação
      // usam, e devolve o nome do problema.
      if (valores.default_nucleo) await resolverNucleo(client, valores.default_nucleo);

      let categoriaPadrao: { id: number; code: string; name: string } | null = null;
      let limparCategoria = false;
      if ("defaultCategoryCode" in body) {
        if (!(await temColunaCategoriaPadrao(client))) {
          throw new ColunaAusenteError(
            "fin_person.default_category_id ainda não existe neste banco: a migration que a cria está no relatório de entrega e precisa ser aplicada por quem administra o schema"
          );
        }
        if (body.defaultCategoryCode === null || body.defaultCategoryCode === "") {
          limparCategoria = true;
        } else if (typeof body.defaultCategoryCode !== "string") {
          throw new ValidacaoError("defaultCategoryCode deve ser texto ou null");
        } else {
          categoriaPadrao = await resolverCategoriaDeCusto(client, body.defaultCategoryCode.trim());
        }
      }

      // ── O diff: só o que MUDA de fato vira UPDATE e vira trilha ─────────
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const alterados: string[] = [];
      const atual: Record<string, unknown> = {
        area: pessoa.area,
        employment_type: pessoa.employment_type,
        role: pessoa.role,
        status: pessoa.status,
        start_date: pessoa.start_date,
        end_date: pessoa.end_date,
        default_nucleo: pessoa.default_nucleo
      };

      for (const [coluna, valor] of Object.entries(valores)) {
        if (atual[coluna] === valor) continue;
        before[coluna] = atual[coluna] ?? null;
        after[coluna] = valor;
        alterados.push(coluna);
      }

      if (categoriaPadrao || limparCategoria) {
        const { rows: atualCategoria } = await client.query<{ code: string | null }>(
          `SELECT c.code FROM fin_person p LEFT JOIN fin_category c ON c.id = p.default_category_id
            WHERE p.id = $1`,
          [idNum]
        );
        const codeAtual = atualCategoria[0]?.code ?? null;
        const codeNovo = categoriaPadrao?.code ?? null;
        if (codeAtual !== codeNovo) {
          before.default_category_id = codeAtual;
          after.default_category_id = codeNovo;
          alterados.push("default_category_id");
        }
      }

      if (alterados.length) {
        // Os nomes de coluna vêm da lista fechada `COLUNA` e de `default_category_id`,
        // nunca do corpo da requisição; os VALORES vão sempre por parâmetro.
        const sets: string[] = [];
        const parametros: unknown[] = [];
        for (const coluna of alterados) {
          if (coluna === "default_category_id") {
            parametros.push(categoriaPadrao?.id ?? null);
            sets.push(`default_category_id = $${parametros.length}`);
            continue;
          }
          parametros.push(valores[coluna]);
          sets.push(`${coluna} = $${parametros.length}`);
        }
        parametros.push(idNum);
        await client.query(
          `UPDATE fin_person SET ${sets.join(", ")} WHERE id = $${parametros.length}`,
          parametros
        );

        await client.query(
          `INSERT INTO fin_audit_log
              (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
           VALUES ($1, 'fin_person', $2, 'update', $3::jsonb, $4::jsonb, $5::text[], $6, $7)`,
          [pessoa.entity_id, idNum, JSON.stringify(before), JSON.stringify(after), alterados, batchId, ator]
        );
      }

      // ── As ligações ─────────────────────────────────────────────────────
      const decididas: {
        linkId: number;
        contraparte: string;
        status: string;
        statusAnterior: string;
        valorCents: number;
        n: number;
        mudou: boolean;
      }[] = [];

      for (const pedido of ligacoes) {
        const { rows: linkRows } = await client.query<{
          id: number;
          entity_id: number;
          person_id: number;
          counterparty_id: number;
          status: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          contraparte: string;
        }>(
          `SELECT l.id, l.entity_id, l.person_id, l.counterparty_id, l.status,
                  l.confirmed_by, l.confirmed_at::text, c.name AS contraparte
             FROM fin_person_counterparty l
             JOIN fin_counterparty c ON c.id = l.counterparty_id
            WHERE l.id = $1
            FOR UPDATE OF l`,
          [pedido.id]
        );
        const link = linkRows[0];
        if (!link) throw new ValidacaoError(`ligação ${pedido.id} não existe`);
        if (link.person_id !== idNum) {
          // Confirmar a ligação de OUTRA pessoa por engano move o custo dela para
          // esta. O id da URL é a autorização; o id do corpo, sozinho, não é.
          throw new ValidacaoError(
            `ligação ${pedido.id} pertence à pessoa ${link.person_id}, não à ${idNum}`
          );
        }

        if (pedido.status === "confirmado" && pareceInstituicaoFinanceira(link.contraparte) && !pedido.aceitarRiscoBanco) {
          throw new ValidacaoError(
            `"${link.contraparte}" tem nome de instituição financeira, não de pessoa. O importador do Inter guardou o banco de destino no lugar do favorecido (migração 0027) e essa contraparte costuma carregar lançamentos de várias pessoas misturadas — confirmar penduraria o custo de meio time em ${pessoa.nome}. Se souber que é mesmo ela, reenvie com aceitarRiscoBanco: true.`
          );
        }

        // Quanto dinheiro esta decisão move, medido com as MESMAS guardas da
        // tela: é o número que transforma "confirmei um link" em "movi
        // R$ 20.710,35 de time".
        const { rows: dinheiroRows } = await client.query<{ cents: number; n: number }>(
          `SELECT COALESCE(SUM(-t.amount_cents), 0) AS cents, count(*)::int AS n
             FROM fin_transaction t
            WHERE t.counterparty_id = $1 AND ${GUARDAS_SAIDA}`,
          [link.counterparty_id]
        );
        const dinheiro = dinheiroRows[0] ?? { cents: 0, n: 0 };

        if (link.status === pedido.status) {
          decididas.push({
            linkId: link.id,
            contraparte: link.contraparte,
            status: link.status,
            statusAnterior: link.status,
            valorCents: dinheiro.cents,
            n: dinheiro.n,
            mudou: false
          });
          continue;
        }

        const anterior = {
          status: link.status,
          confirmed_by: link.confirmed_by,
          confirmed_at: link.confirmed_at
        };

        // `confirmed_by`/`confirmed_at` só são carimbados na confirmação — é o
        // que o nome das colunas promete. A rejeição também é decisão humana e
        // também precisa de dono, e o lugar dela é `evidence.decisao_humana`,
        // ao lado da evidência de máquina que a produziu. Em ambos os casos a
        // decisão ANTERIOR viaja junto, na própria linha: o audit log é a
        // história completa, e este campo é o que impede uma segunda passada do
        // importador de tratar uma reversão humana como se fosse a primeira
        // opinião sobre o assunto.
        await client.query(
          `UPDATE fin_person_counterparty
              SET status = $1,
                  confirmed_by = CASE WHEN $1 = 'confirmado' THEN $2 ELSE confirmed_by END,
                  confirmed_at = CASE WHEN $1 = 'confirmado' THEN now() ELSE confirmed_at END,
                  evidence = evidence || jsonb_build_object(
                    'decisao_humana',
                    jsonb_build_object('status', $1::text, 'por', $2::text, 'em', now(),
                                       'anterior', $3::jsonb)
                  )
            WHERE id = $4`,
          [pedido.status, ator, JSON.stringify(anterior), link.id]
        );

        await client.query(
          `INSERT INTO fin_audit_log
              (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
           VALUES ($1, 'fin_person_counterparty', $2, 'update', $3::jsonb, $4::jsonb,
                   ARRAY['status', 'confirmed_by', 'confirmed_at'], $5, $6)`,
          [
            link.entity_id,
            link.id,
            JSON.stringify(anterior),
            JSON.stringify({
              status: pedido.status,
              confirmed_by: pedido.status === "confirmado" ? ator : link.confirmed_by,
              person_id: idNum,
              counterparty_id: link.counterparty_id,
              contraparte: link.contraparte,
              // O valor movido entra na trilha porque é a única forma de, meses
              // depois, entender por que a folha de um time mudou num dia sem
              // importação nenhuma.
              valor_cents: pedido.status === "confirmado" ? dinheiro.cents : -dinheiro.cents,
              lancamentos: dinheiro.n
            }),
            batchId,
            ator
          ]
        );

        decididas.push({
          linkId: link.id,
          contraparte: link.contraparte,
          status: pedido.status,
          statusAnterior: link.status,
          valorCents: dinheiro.cents,
          n: dinheiro.n,
          mudou: true
        });
      }

      return { naoEncontrada: false as const, alterados, before, after, decididas };
    });

    if (resultado.naoEncontrada) {
      return Response.json({ error: `pessoa ${idNum} não encontrada` }, { status: 404 });
    }

    const moveuCents = resultado.decididas
      .filter((d) => d.mudou)
      .reduce((soma, d) => soma + (d.status === "confirmado" ? d.valorCents : -d.valorCents), 0);

    return Response.json({
      ok: true,
      id: idNum,
      batchId,
      alterados: resultado.alterados,
      before: resultado.before,
      after: resultado.after,
      ligacoes: resultado.decididas,
      /** Quanto de custo realizado entrou (+) ou saiu (−) do total desta pessoa. */
      moveuCents
    });
  } catch (error) {
    if (error instanceof ColunaAusenteError) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof ValidacaoError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    // O CHECK do banco é o dono do domínio; se ele recusar apesar das validações
    // acima, o cliente merece 422 e a mensagem do Postgres — não um 500 mudo.
    const codigo = (error as { code?: string })?.code;
    if (codigo === "23514" || codigo === "23503") {
      return Response.json({ error: (error as Error).message }, { status: 422 });
    }
    if (codigo === "23505") {
      return Response.json({ error: (error as Error).message }, { status: 409 });
    }
    throw error;
  }
}
