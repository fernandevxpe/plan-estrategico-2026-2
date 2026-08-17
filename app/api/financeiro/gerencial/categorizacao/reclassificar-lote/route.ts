import {
  LOTE_MAXIMO,
  RecusaCategorizacao,
  reclassificarLote,
  type AlvoLote
} from "@/lib/financeiro/categorizacao";
import { UNIVERSOS, type Universo } from "@/lib/financeiro/contratos/categorizacao";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { autorDe, erro, idsDe, lerCorpo } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/categorizacao/reclassificar-lote
 *
 * ```json
 * {
 *   "alvos": [{ "universo": "documento", "ids": [1, 2, 3] }],
 *   "code": "3.03",
 *   "motivo": "NF 190 e 192 casam as parcelas 1/6 e 2/6 do contrato",
 *   "evidencia": "paid_on das duas parcelas = 12/03; únicos créditos de R$ 17.000 no mês",
 *   "aplicar": false
 * }
 * ```
 *
 * ==========================================================================
 * `aplicar` É FALSO POR PADRÃO. NÃO É PARANOIA — É O PADRÃO DA CASA
 * ==========================================================================
 *
 * Todo script de escrita deste repositório tem `--aplicar`, e o default é não
 * gravar. O dry-run devolve, por universo: quantos itens foram encontrados,
 * quais ids não existem, quantos já estão na categoria de destino, quantos
 * estão travados, o valor total antes e a distribuição de categorias atuais.
 * É a "contagem e valor antes/depois" que a §10 do CONTINUACAO.md exige.
 *
 * ==========================================================================
 * O LOTE EXIGE `ids`. NUNCA UM FILTRO QUE O SERVIDOR EXPANDA
 * ==========================================================================
 *
 * Esta é a diferença entre esta rota e `scripts/reclassificar.mjs --conta=inter`.
 * Aquele comando aplicaria 450 mudanças de uma vez, das quais **205 movem
 * lançamentos de `6.02 Pró-labore` para `6.01 Salários`** por conta de uma
 * regra genérica (`pix-pessoa-fisica`, precisão medida de 15,2%). Pró-labore e
 * salário têm encargo e IR diferentes: é a **dúvida 0**, e está aberta.
 *
 * Uma rota que aceitasse `{"filtro": {...}}` seria o mesmo comando com outra
 * roupa — bastaria alguém filtrar "conta=inter, categoria=6.02". Com `ids`
 * explícitos e teto de LOTE_MAXIMO, o lote continua sendo uma pessoa decidindo
 * sobre itens que ela viu.
 *
 * ==========================================================================
 * A ORDEM DAS ESCRITAS, QUE É ONDE ISTO COSTUMA DAR ERRADO
 * ==========================================================================
 *
 *   1. `fin_classification_event` com o valor ANTERIOR   ← torna o desfazer possível
 *   2. `fin_review_item` → resolvido                     ← ANTES da linha, sempre
 *   3. a linha: categoria, `classified_by='humano'`,
 *      `classified_rule_id=NULL`, `human_locked_fields += category_id`
 *   4. releitura do banco provando que a trava ficou escrita
 *   5. `fin_audit_log` com before/after
 *
 * O passo 2 vem antes do 3 porque o gatilho
 * `fin_transaction_revisao_sincroniza` (0094) lê `fin_review_item` PENDENTE de
 * motivo `baixa_confianca` no BEFORE do UPDATE. Resolver depois — mesmo no
 * statement seguinte da mesma transação — faz o `review_status='ok'` voltar
 * para `'pendente'` sozinho. Medido nesta frente:
 *
 *   ordem errada (linha antes da fila) → review_status = pendente
 *   ordem certa  (fila antes da linha) → review_status = ok
 *
 * Exceção declarada: quando o destino é 3.99 ou 5.99, o item de fila NÃO é
 * resolvido. Marcar "a classificar" é declarar indecisão, não resolvê-la, e o
 * H3 exige item pendente para todo indeciso.
 *
 * ==========================================================================
 * A TRAVA HUMANA NÃO É OPCIONAL
 * ==========================================================================
 *
 * Em 11/08/2026 uma pessoa classificou 52 lançamentos na tela; em 16/08 o
 * importador do Asaas herdou "o NADA" de um documento sem categoria e gravou
 * `category_id = NULL` por cima, carimbando `'contrato'` sobre o `'humano'`.
 * As 52 viraram a dúvida 40. `human_locked_fields` é o que impede a repetição:
 * `fin_preserve_human_locks` devolve o valor antigo a qualquer escrita feita em
 * `fin.sync_mode='on'`, que é como os sincronizadores rodam.
 *
 * Por isso a rota **relê o banco depois do UPDATE** e devolve `travasEscritas`.
 * Afirmar que travou sem conferir é como as 54 classificações foram perdidas.
 */
export async function POST(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  if (corpo.filtro !== undefined) {
    return erro(
      "esta rota não aceita filtro: o lote é sempre uma lista de `ids` que alguém viu. " +
        "Um lote por filtro é reclassificar.mjs com outra roupa, e a dúvida 0 (205 linhas de " +
        "Pró-labore → Salários, com consequência tributária) está aberta.",
      422
    );
  }

  const alvos: AlvoLote[] = [];
  const bruto = Array.isArray(corpo.alvos) ? corpo.alvos : [];
  for (const item of bruto) {
    const a = item as Record<string, unknown>;
    const universo = String(a?.universo ?? "");
    if (!UNIVERSOS.includes(universo as Universo)) {
      return erro(`universo inválido: "${universo}". Use um de ${UNIVERSOS.join(", ")}`);
    }
    const ids = idsDe(a?.ids);
    if (!ids.length) return erro(`o universo ${universo} veio sem ids válidos`);
    alvos.push({ universo: universo as Universo, ids });
  }
  if (!alvos.length) return erro("informe `alvos`: [{ universo, ids }]");

  const total = alvos.reduce((s, a) => s + a.ids.length, 0);
  if (total > LOTE_MAXIMO) {
    return erro(`lote de ${total} itens acima do teto de ${LOTE_MAXIMO} — divida`, 422, {
      total,
      teto: LOTE_MAXIMO
    });
  }

  const code = String(corpo.code ?? "").trim();
  if (!code) return erro("informe a categoria de destino em `code`");

  const motivo = String(corpo.motivo ?? "").trim();
  if (!motivo) {
    return erro(
      "informe o `motivo`: a trilha sem motivo diz 'alguém mudou isso' e o desfazer perde o porquê",
      422
    );
  }

  try {
    const resultado = await reclassificarLote({
      alvos,
      code,
      motivo: motivo.slice(0, 400),
      evidencia: corpo.evidencia === undefined ? null : String(corpo.evidencia).slice(0, 1000),
      ator: autorDe(request),
      aplicar: corpo.aplicar === true
    });

    return Response.json(
      {
        ok: true,
        dryRun: !resultado.aplicado,
        ...resultado,
        ressalvas: resultado.aplicado
          ? [
              `${resultado.travasEscritas.reduce((s, t) => s + t.n, 0)} item(ns) ficaram com ` +
                `'category_id' em human_locked_fields — conferido relendo o banco, não afirmado.`,
              "A fila foi resolvida ANTES do UPDATE: o gatilho da 0094 derruba o review_status='ok' " +
                "quando a ordem se inverte."
            ]
          : [
              "DRY-RUN: nada foi escrito. Envie `\"aplicar\": true` para gravar.",
              "Os itens travados listados só mudam porque esta rota é ato humano explícito — " +
                "a automação não os tocaria."
            ]
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof RecusaCategorizacao) {
      return Response.json(
        { erro: e.message, ...e.detalhe },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (e instanceof FinanceUnavailableError) return erro("banco do financeiro indisponível", 503);
    const pg = e as { code?: string; message?: string };
    if (pg?.code === "23514" || pg?.code === "23503") {
      return Response.json(
        { erro: pg.message ?? "o banco recusou a operação" },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    console.error("[categorizacao:lote]", pg?.message ?? e);
    return erro(pg?.message ?? "falha ao reclassificar", 500);
  }
}
