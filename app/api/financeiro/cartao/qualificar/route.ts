import { FinanceUnavailableError, transaction } from "@/lib/financeiro/db";

import { autor, erro, foiRecusa, normalizarTexto, recusar } from "../_comum";

/**
 * POST /api/financeiro/cartao/qualificar — dizer o que é um gasto, e ensinar.
 *
 * ---------------------------------------------------------------------------
 * O BURACO QUE ELA FECHA
 * ---------------------------------------------------------------------------
 * Medido em 24/08/2026: dos 774 itens de compra do cartão, 234 estão sem
 * categoria (R$ 13.478,68) e 461 sem núcleo (R$ 49.703,98). Quase metade do
 * valor do cartão não sabe de que área é — e não havia tela para responder
 * isso item a item.
 *
 * ---------------------------------------------------------------------------
 * QUALIFICAR É DOIS ATOS, E O SEGUNDO É O QUE FAZ VALER A PENA
 * ---------------------------------------------------------------------------
 * O primeiro ato é gravar a decisão nos itens escolhidos. O segundo é GUARDAR
 * O PADRÃO: "quem descreve assim vai para lá". Sem o segundo, a mesma pessoa
 * classifica "Facebk *Va4u4frll2" hoje e "Facebk* 9he9jf9ll2" na semana que
 * vem sem que a segunda vez fique mais fácil — e são treze lançamentos do
 * Facebook só em 2026, cada um com sufixo aleatório.
 *
 * O padrão é gravado a partir da descrição de CADA item qualificado, não de um
 * texto que a pessoa digita: o que precisa casar da próxima vez é o que o banco
 * manda, não como a pessoa chamaria aquilo.
 *
 * ---------------------------------------------------------------------------
 * `classified_by = 'humano'` É UM CADEADO
 * ---------------------------------------------------------------------------
 * Mesma disciplina de `/api/financeiro/qualificar`: decisão de gente sai da
 * fila para sempre e o reclassificador automático não a desfaz. Se desfizesse,
 * ninguém responderia a segunda pergunta.
 */

type Corpo = {
  ids?: unknown;
  categoriaId?: unknown;
  nucleo?: unknown;
  centroId?: unknown;
  /** Guardar o padrão para as próximas buscas. Padrão: sim. */
  aprender?: unknown;
};

export async function POST(request: Request) {
  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("corpo não é JSON válido");
  }

  const ids = Array.isArray(corpo.ids) ? corpo.ids.map(Number).filter(Number.isSafeInteger) : [];
  if (!ids.length) return erro("informe ao menos um lançamento");
  if (ids.length > 500) return erro("lote acima de 500 lançamentos — divida");

  const temCategoria = "categoriaId" in corpo && corpo.categoriaId !== null;
  const temNucleo = "nucleo" in corpo && corpo.nucleo !== null;
  const temCentro = "centroId" in corpo && corpo.centroId !== null;
  if (!temCategoria && !temNucleo && !temCentro) {
    return erro("informe categoria, núcleo ou centro de custo");
  }

  const categoriaId = temCategoria ? Number(corpo.categoriaId) : null;
  if (temCategoria && (!Number.isSafeInteger(categoriaId) || categoriaId! <= 0)) {
    return erro("categoria inválida");
  }
  const nucleo = temNucleo ? String(corpo.nucleo).trim() : null;
  const centroId = temCentro ? Number(corpo.centroId) : null;
  if (temCentro && (!Number.isSafeInteger(centroId) || centroId! <= 0)) {
    return erro("centro de custo inválido");
  }

  const aprender = corpo.aprender !== false;
  const quem = autor(request);

  try {
    const resultado = await transaction(async (client) => {
      // Os alvos existem? Perguntar antes evita um erro de FK cru chegando na
      // tela como "violates foreign key constraint".
      if (categoriaId !== null) {
        const c = await client.query(`SELECT id FROM fin_category WHERE id = $1 AND is_active`, [categoriaId]);
        if (!c.rows[0]) return recusar("categoria não encontrada", 404);
      }
      if (nucleo !== null) {
        const nu = await client.query(`SELECT slug FROM fin_nucleo WHERE slug = $1`, [nucleo]);
        if (!nu.rows[0]) return recusar(`núcleo desconhecido: ${nucleo}`, 404);
      }
      if (centroId !== null) {
        const cc = await client.query(`SELECT id FROM fin_cost_center WHERE id = $1 AND is_active`, [centroId]);
        if (!cc.rows[0]) return recusar("centro de custo não encontrado", 404);
      }

      const antes = await client.query<{
        id: number; description: string; description_norm: string | null;
        category_id: number | null; nucleo: string | null; cost_center_id: number | null;
      }>(
        `SELECT id, description, description_norm, category_id, nucleo, cost_center_id
           FROM fin_card_transaction WHERE id = ANY($1::bigint[])`,
        [ids]
      );
      if (!antes.rows.length) return recusar("nenhum lançamento encontrado", 404);

      const sets: string[] = [];
      const valores: unknown[] = [];
      const campos: string[] = [];
      if (categoriaId !== null) {
        valores.push(categoriaId);
        sets.push(`category_id = $${valores.length}`);
        campos.push("category_id");
      }
      if (nucleo !== null) {
        valores.push(nucleo);
        sets.push(`nucleo = $${valores.length}`);
        campos.push("nucleo");
      }
      if (centroId !== null) {
        valores.push(centroId);
        sets.push(`cost_center_id = $${valores.length}`);
        campos.push("cost_center_id");
      }

      // Os campos que a pessoa acabou de decidir entram em
      // `human_locked_fields` somados aos que já estavam lá, sem repetir — é
      // esse array que o reclassificador automático consulta antes de mexer
      // em qualquer coisa.
      valores.push(campos);
      const idxCampos = valores.length;
      valores.push(ids);
      const idxIds = valores.length;

      const depois = await client.query(
        `UPDATE fin_card_transaction
            SET ${sets.join(", ")},
                classified_by = 'humano',
                classified_at = now(),
                human_locked_fields = (
                  SELECT array_agg(DISTINCT c)
                    FROM unnest(coalesce(human_locked_fields, ARRAY[]::text[]) || $${idxCampos}::text[]) AS c
                )
          WHERE id = ANY($${idxIds}::bigint[])
          RETURNING id, category_id, nucleo, cost_center_id`,
        valores
      );

      // ---------------------------------------------------------------------
      // O aprendizado: uma linha por (descrição do item, alvo).
      // ---------------------------------------------------------------------
      let padroes = 0;
      if (aprender) {
        for (const linha of antes.rows) {
          const texto = normalizarTexto(linha.description_norm ?? linha.description ?? "");
          if (texto.length < 4) continue;
          const alvos: { tipo: string; cat: number | null; nuc: string | null; cc: number | null }[] = [];
          if (categoriaId !== null) alvos.push({ tipo: "categoria", cat: categoriaId, nuc: null, cc: null });
          if (nucleo !== null) alvos.push({ tipo: "nucleo", cat: null, nuc: nucleo, cc: null });
          if (centroId !== null) alvos.push({ tipo: "centro", cat: null, nuc: null, cc: centroId });
          for (const a of alvos) {
            await client.query(
              `INSERT INTO fin_padrao_qualificacao
                 (entity_id, texto_norm, alvo_tipo, category_id, nucleo, cost_center_id, vezes, criado_por, ultima_vez_em)
               VALUES ((SELECT id FROM fin_entity WHERE slug = 'xpe'), $1, $2, $3, $4, $5, 1, $6, now())
               ON CONFLICT (entity_id, texto_norm, alvo_tipo,
                            coalesce(category_id, 0), coalesce(nucleo, ''), coalesce(cost_center_id, 0))
               DO UPDATE SET vezes = fin_padrao_qualificacao.vezes + 1, ultima_vez_em = now()`,
              [texto, a.tipo, a.cat, a.nuc, a.cc, quem]
            );
            padroes += 1;
          }
        }
      }

      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         SELECT (SELECT id FROM fin_entity WHERE slug = 'xpe'), 'fin_card_transaction', x.id,
                'bulk_update', to_jsonb(x), $2::jsonb, $3::text[], $4
           FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, category_id bigint, nucleo text, cost_center_id bigint)`,
        [
          JSON.stringify(antes.rows.map((r) => ({
            id: Number(r.id), category_id: r.category_id, nucleo: r.nucleo, cost_center_id: r.cost_center_id
          }))),
          JSON.stringify({ category_id: categoriaId, nucleo, cost_center_id: centroId }),
          campos,
          quem
        ]
      );

      return { atualizados: depois.rowCount ?? 0, padroes };
    });

    if (foiRecusa(resultado)) return erro(resultado.mensagem, resultado.status);
    return Response.json({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) return erro(e.message, 503);
    return erro(e instanceof Error ? e.message : "falha ao qualificar", 500);
  }
}
