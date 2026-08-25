import { FinanceUnavailableError, transaction } from "@/lib/financeiro/db";

import { autor, erro, foiRecusa, recusar } from "../_comum";

/**
 * POST /api/financeiro/cartao/reatribuir — a compra estava no plástico errado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA EXISTIR
 * ---------------------------------------------------------------------------
 * "Compras que dizem ser feitas em um cartão e não aparecem, e aparecem em
 * outros — podem ser erros." Acontece de verdade: um plástico reemitido troca
 * de final e a fonte reaponta os lançamentos antigos para o novo; um adicional
 * é lançado no titular; o `card_last4` vem vazio e o sync casa pelo primeiro
 * candidato.
 *
 * ---------------------------------------------------------------------------
 * ELA MOVE O PONTEIRO, NUNCA O VALOR
 * ---------------------------------------------------------------------------
 * O que muda é `card_id` — de qual plástico aquela compra é. `amount_cents`,
 * `posted_on`, `competence_month` e `bill_id` ficam intactos, e é isso que
 * garante que a fatura continue somando o mesmo: mover uma compra entre dois
 * plásticos da MESMA linha de crédito não muda um centavo do que o emissor
 * cobrou.
 *
 * Mover para outra LINHA seria diferente — mudaria de qual fatura aquele item
 * faz parte, e a fatura é fato da fonte, não opinião. Por isso a rota recusa:
 * o destino precisa pertencer à mesma `card_account_id` da origem. Um erro de
 * plástico se corrige aqui; um erro de emissor é problema do sync.
 */

type Corpo = {
  ids?: unknown;
  paraCardId?: unknown;
  motivo?: unknown;
};

export async function POST(request: Request) {
  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("corpo não é JSON válido");
  }

  const ids = Array.isArray(corpo.ids) ? corpo.ids.map(Number).filter(Number.isSafeInteger) : [];
  const paraCardId = Number(corpo.paraCardId);
  const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() : "";

  if (!ids.length) return erro("informe ao menos um lançamento");
  if (ids.length > 200) return erro("lote acima de 200 lançamentos — divida");
  if (!Number.isSafeInteger(paraCardId) || paraCardId <= 0) return erro("cartão de destino inválido");
  // Motivo obrigatório: reatribuir é dizer que a fonte errou, e daqui a seis
  // meses "por que esta compra está neste final?" precisa ter resposta escrita
  // por quem mudou — a trilha guarda o antes e o depois, não o porquê.
  if (motivo.length < 5) return erro("diga por que está movendo (mínimo 5 caracteres)");

  const quem = autor(request);

  try {
    const resultado = await transaction(async (client) => {
      const destino = await client.query<{ id: number; last4: string; card_account_id: number | null }>(
        `SELECT id, last4, card_account_id FROM fin_card WHERE id = $1`,
        [paraCardId]
      );
      if (!destino.rows[0]) return recusar("cartão de destino não encontrado", 404);

      const antes = await client.query<{
        id: number; card_id: number | null; card_account_id: number | null;
        last4: string | null; description: string; amount_cents: string;
      }>(
        `SELECT t.id, t.card_id, t.card_account_id, c.last4, t.description, t.amount_cents
           FROM fin_card_transaction t
           LEFT JOIN fin_card c ON c.id = t.card_id
          WHERE t.id = ANY($1::bigint[])`,
        [ids]
      );
      if (!antes.rows.length) return recusar("nenhum lançamento encontrado", 404);

      // A trava que protege a fatura: mesma linha de crédito, sempre.
      const foraDaLinha = antes.rows.filter(
        (r) => Number(r.card_account_id) !== Number(destino.rows[0].card_account_id)
      );
      if (foraDaLinha.length) {
        return recusar(
          `${foraDaLinha.length} lançamento(s) são de outra linha de crédito. ` +
            `Mover entre emissores mudaria de qual fatura o item faz parte, e a fatura é fato da fonte — ` +
            `isso é caso para corrigir no sync, não aqui.`,
          422
        );
      }

      const depois = await client.query(
        `UPDATE fin_card_transaction t
            SET card_id = $1,
                card_last4 = (SELECT last4 FROM fin_card WHERE id = $1),
                notes = trim(both E'\n' from coalesce(t.notes, '') || E'\n' || $2),
                updated_at = now()
          WHERE t.id = ANY($3::bigint[])
          RETURNING t.id, t.card_id`,
        [paraCardId, `[${new Date().toISOString().slice(0, 10)}] movido por ${quem}: ${motivo}`, ids]
      );

      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         SELECT (SELECT id FROM fin_entity WHERE slug = 'xpe'), 'fin_card_transaction', x.id,
                'bulk_update', to_jsonb(x), $2::jsonb, ARRAY['card_id','card_last4']::text[], $3
           FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, card_id bigint, last4 text)`,
        [
          JSON.stringify(antes.rows.map((r) => ({
            id: Number(r.id), card_id: r.card_id === null ? null : Number(r.card_id), last4: r.last4
          }))),
          JSON.stringify({ card_id: paraCardId, last4: destino.rows[0].last4, motivo }),
          quem
        ]
      );

      return {
        movidos: depois.rowCount ?? 0,
        paraLast4: destino.rows[0].last4
      };
    });

    if (foiRecusa(resultado)) return erro(resultado.mensagem, resultado.status);
    return Response.json({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) return erro(e.message, 503);
    return erro(e instanceof Error ? e.message : "falha ao reatribuir", 500);
  }
}
