import { NextResponse } from "next/server";

import { query, transaction } from "@/lib/financeiro/db";
import { SQL_DOCS_PARA_REGRA, sujeitoDeDocumento, type DocParaRegra } from "@/lib/financeiro/regras";
import { evaluateConditions } from "@/scripts/lib/fin-rules.mjs";

/**
 * Aplica UMA regra às cobranças ainda sem categoria.
 *
 * Só toca em documento sem classificação, nunca sobrescreve decisão existente —
 * e jamais uma trava humana. Uma regra nova é uma hipótese; ela ganha o que
 * ninguém reivindicou, não o que já foi decidido.
 */
export async function POST(request: Request) {
  let body: { ruleId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const ruleId = Number(body.ruleId);
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return NextResponse.json({ error: "ruleId inválido" }, { status: 400 });
  }

  const [regra] = await query<{
    id: number;
    name: string;
    conditions: unknown;
    actions: { category_code?: string; nucleo?: string };
    confidence: number;
  }>(`SELECT id, name, conditions, actions, confidence FROM fin_rule WHERE id = $1 AND status = 'ativa'`, [ruleId]);
  if (!regra) return NextResponse.json({ error: "regra não encontrada ou inativa" }, { status: 404 });

  const codigo = regra.actions?.category_code;
  if (!codigo) return NextResponse.json({ error: "a regra não define category_code" }, { status: 422 });

  const [categoria] = await query<{ id: number }>(
    `SELECT c.id FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id WHERE e.slug = 'xpe' AND c.code = $1`,
    [codigo]
  );
  if (!categoria) return NextResponse.json({ error: `categoria ${codigo} não existe` }, { status: 422 });

  const docs = await query<DocParaRegra>(`${SQL_DOCS_PARA_REGRA} AND d.category_id IS NULL`, ["xpe"]);

  const alvos: { id: number; trecho: string | null }[] = [];
  for (const doc of docs) {
    const resultado = evaluateConditions(regra.conditions as never, sujeitoDeDocumento(doc));
    if (resultado.ok) alvos.push({ id: doc.id, trecho: resultado.snippet ?? null });
  }
  if (!alvos.length) return NextResponse.json({ aplicados: 0, mensagem: "nenhuma cobrança sem categoria casou" });

  const resultado = await transaction(async (client) => {
    let aplicados = 0;
    for (const alvo of alvos) {
      const { rowCount } = await client.query(
        `UPDATE fin_document
            SET category_id = $2,
                nucleo = COALESCE(nucleo, $3),
                classified_by = 'regra',
                classified_rule_id = $4,
                classified_at = now(),
                classified_reason = jsonb_build_object('regra', $5::text, 'trecho', $6::text, 'origem', 'aplicada pela tela'),
                review_status = CASE WHEN $7::int >= 80 THEN 'ok' ELSE 'pendente' END,
                updated_at = now()
          WHERE id = $1 AND category_id IS NULL
            AND NOT ('category_id' = ANY (human_locked_fields))`,
        [alvo.id, categoria.id, regra.actions?.nucleo ?? null, regra.id, regra.name, alvo.trecho, regra.confidence]
      );
      if (rowCount) aplicados += 1;
    }

    // Item de fila cuja causa sumiu sai da fila — mas SÓ os documentos que ESTA
    // regra tocou. Sem amarrar aos ids, qualquer item pendente cujo documento
    // já estivesse 'ok' por outro motivo sumia junto, e a fila encolhia por
    // razão errada.
    await client.query(
      `UPDATE fin_review_item ri SET status = 'resolvido', resolved_at = now(), resolved_by = 'regra'
        WHERE ri.target_table = 'fin_document' AND ri.status = 'pendente'
          AND ri.target_id = ANY($1)
          AND EXISTS (SELECT 1 FROM fin_document d WHERE d.id = ri.target_id AND d.review_status = 'ok')`,
      [alvos.map((alvo) => alvo.id)]
    );

    await client.query(
      `UPDATE fin_rule SET hits_count = hits_count + $2, last_hit_at = now() WHERE id = $1`,
      [regra.id, aplicados]
    );

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, actor)
       SELECT e.id, 'fin_rule', $1, 'bulk_update', $2::jsonb, 'ui' FROM fin_entity e WHERE e.slug = 'xpe'`,
      [regra.id, JSON.stringify({ regra: regra.name, categoria: codigo, aplicados })]
    );

    return aplicados;
  });

  return NextResponse.json({ aplicados: resultado, regra: regra.name, categoria: codigo });
}
