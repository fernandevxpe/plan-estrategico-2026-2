import { randomUUID } from "node:crypto";

import { FinanceUnavailableError, query, transaction } from "@/lib/financeiro/db";

/**
 * POST /api/financeiro/qualificar — o dono decide um grupo inteiro.
 *
 * TRÊS INVARIANTES QUE ESTA ROTA SUSTENTA
 *
 * 1. `classified_by = 'humano'` — a decisão sai da fila para sempre e fica
 *    protegida do próximo `reclassificar.mjs`. Decisão tomada não volta a ser
 *    pergunta; se voltasse, o dono deixaria de responder.
 *
 * 2. Trilha antes de mexer, com a evidência que sustentava a sugestão. Meses
 *    depois, "por que isto é 3.05?" tem resposta: casou com a cobrança de
 *    fulano, mesma quantia, um dia de diferença.
 *
 * 3. O item de fila correspondente é resolvido no MESMO commit. Classificar e
 *    deixar o item aberto é o ruído que empurra trabalho real para fora da
 *    tela — o invariante H1 mede exatamente isso.
 *
 * SOBRE CRIAR REGRA: só quando o pedido vem com `criarRegra`, e só quando o
 * padrão é específico. Um padrão curto vira uma regra que engole meio extrato
 * — é o que a regra `pix-pessoa-fisica` faz, com precisão medida de 15,2%. A
 * rota recusa em vez de criar uma regra ruim, e diz por quê.
 */

const ENTITY = "xpe";

type Corpo = {
  ids?: unknown;
  code?: unknown;
  criarRegra?: unknown;
  rotulo?: unknown;
  padrao?: unknown;
  porContraparte?: unknown;
  evidencia?: unknown;
};

function erro(mensagem: string, status = 400) {
  return Response.json({ erro: mensagem }, { status });
}

function autor(request: Request): string {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("basic ")) return "tela";
  try {
    return Buffer.from(h.slice(6), "base64").toString("utf8").split(":")[0]?.trim() || "tela";
  } catch {
    return "tela";
  }
}

export async function POST(request: Request) {
  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("corpo não é JSON válido");
  }

  const ids = Array.isArray(corpo.ids) ? corpo.ids.map(Number).filter(Number.isSafeInteger) : [];
  const code = typeof corpo.code === "string" ? corpo.code.trim() : "";
  if (!ids.length) return erro("informe ao menos um lançamento");
  if (!code) return erro("informe a categoria");
  // Teto por requisição: um lote maior que isto é quase sempre um clique errado
  // num "selecionar tudo", e desfazer 5.000 linhas é bem mais caro que refazer
  // duas chamadas.
  if (ids.length > 1000) return erro("lote acima de 1.000 lançamentos — divida");

  const quem = autor(request);
  const rotulo = typeof corpo.rotulo === "string" ? corpo.rotulo.slice(0, 120) : "";
  const evidencia = typeof corpo.evidencia === "string" ? corpo.evidencia.slice(0, 400) : null;
  const padrao = typeof corpo.padrao === "string" ? corpo.padrao : "";
  const porContraparte = Boolean(corpo.porContraparte);

  try {
    const resultado = await transaction(async (cliente) => {
      const { rows: cat } = await cliente.query(
        `SELECT c.id, c.code, c.name FROM fin_category c
           JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1 WHERE c.code = $2`,
        [ENTITY, code]
      );
      if (!cat.length) throw new Error(`categoria ${code} não existe`);

      const lote = randomUUID();

      await cliente.query(
        `INSERT INTO fin_classification_event
           (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
         SELECT 'fin_transaction', t.id, 'humano', $2, true,
                jsonb_build_object('category_id', t.category_id),
                jsonb_build_object('motivo','qualificação em grupo','grupo',$3::text,
                                   'evidencia',$4::text,'lote',$5::text),
                $6
           FROM fin_transaction t WHERE t.id = ANY($1::bigint[])`,
        [ids, cat[0].id, rotulo, evidencia, lote, quem]
      );

      const { rowCount } = await cliente.query(
        `UPDATE fin_transaction
            SET category_id = $2, classified_by = 'humano', classified_at = now(),
                review_status = 'ok', updated_at = now(),
                classified_reason = jsonb_build_object('motivo','qualificação em grupo','grupo',$3::text)
          WHERE id = ANY($1::bigint[])
            AND NOT ('category_id' = ANY (human_locked_fields))`,
        [ids, cat[0].id, rotulo]
      );

      await cliente.query(
        `UPDATE fin_review_item SET status='resolvido', resolved_at=now()
          WHERE target_table='fin_transaction' AND target_id = ANY($1::bigint[]) AND status='pendente'`,
        [ids]
      );

      let regra: string | null = null;
      let regraRecusada: string | null = null;

      if (corpo.criarRegra) {
        const alvo = porContraparte ? rotulo : padrao.replace(/#/g, " ").replace(/\s+/g, " ").trim();
        if (!alvo || alvo.length < 18) {
          regraRecusada = `o padrão "${alvo}" tem menos de 18 caracteres e pegaria lançamento alheio`;
        } else {
          const slug = `qualificacao-${alvo
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 46)}`;
          const cond = porContraparte
            ? { all: [{ op: "equals", field: "counterparty_name_norm", value: alvo.toLowerCase() }] }
            : { all: [{ op: "contains_any", field: "description_norm", value: [alvo.slice(0, 60)] }] };
          const { rows: r } = await cliente.query(
            `INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions,
                                   confidence, source, status, created_by, notes)
             SELECT e.id, $1, $2, 120, 'transaction', $3::jsonb,
                    jsonb_build_object('category_code', $4::text), 75, 'humano', 'ativa', $5, $6
               FROM fin_entity e WHERE e.slug = $7
             ON CONFLICT (entity_id, slug) DO UPDATE
                SET actions = EXCLUDED.actions, conditions = EXCLUDED.conditions, updated_at = now()
             RETURNING slug`,
            [slug, `Qualificação: ${rotulo.slice(0, 50)}`, JSON.stringify(cond), code, quem,
             `Criada ao qualificar ${ids.length} lançamentos na tela.`, ENTITY]
          );
          regra = r[0]?.slug ?? null;
        }
      }

      await cliente.query(
        `INSERT INTO fin_audit_log (entity_id, batch_id, actor, action, target_table, target_id, before, after)
         SELECT e.id, $1, $2, 'bulk_update', 'fin_transaction', $3::bigint, NULL,
                jsonb_build_object('categoria',$4::text,'lancamentos',$5::int,'grupo',$6::text,'regra',$7::text)
           FROM fin_entity e WHERE e.slug = $8`,
        [lote, quem, ids[0], code, ids.length, rotulo, regra, ENTITY]
      );

      return { aplicados: rowCount, categoria: `${cat[0].code} ${cat[0].name}`, regra, regraRecusada };
    });

    return Response.json({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) return erro("banco do financeiro indisponível", 503);
    return erro(e instanceof Error ? e.message : "falha ao qualificar", 500);
  }
}
