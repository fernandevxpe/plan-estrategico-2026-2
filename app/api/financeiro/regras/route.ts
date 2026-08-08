import { FinanceUnavailableError, query, transaction } from "@/lib/financeiro/db";
import { slugDoNome, validarCondicoes } from "@/lib/financeiro/regras";
import { resolverCategoria, resolverNucleo, ValidacaoError } from "@/lib/financeiro/revisao";

const ENTITY = "xpe";

/**
 * GET/POST /api/financeiro/regras — listar regras ativas e criar regra nova.
 *
 * Regra criada pela tela nasce source='humano' e status='ativa': é a promessa
 * central do módulo — cada decisão recorrente vira regra permanente sem
 * deploy. O slug é a chave natural (migração 0009): colidir com uma regra
 * existente é 409, nunca uma segunda linha com o mesmo nome.
 */
export async function GET() {
  try {
    const regras = await query(
      `SELECT r.id, r.slug, r.name, r.priority, r.match_scope, r.conditions, r.actions,
              r.confidence, r.source, r.hits_count, r.last_hit_at, r.created_at
         FROM fin_rule r
         LEFT JOIN fin_entity e ON e.id = r.entity_id
        WHERE r.status = 'ativa' AND (r.entity_id IS NULL OR e.slug = $1)
        ORDER BY r.priority, r.id`,
      [ENTITY]
    );
    return Response.json({ regras });
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  let body: {
    name?: unknown;
    priority?: unknown;
    conditions?: unknown;
    actions?: { category_code?: unknown; nucleo?: unknown };
    confidence?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name é obrigatório" }, { status: 400 });

  const priority = Number(body.priority ?? 50);
  if (!Number.isInteger(priority)) return Response.json({ error: "priority deve ser inteiro" }, { status: 422 });

  const confidence = Number(body.confidence ?? 90);
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    return Response.json({ error: "confidence deve ser inteiro entre 0 e 100" }, { status: 422 });
  }

  const categoryCode =
    typeof body.actions?.category_code === "string" ? body.actions.category_code.trim() : "";
  if (!categoryCode) return Response.json({ error: "actions.category_code é obrigatório" }, { status: 422 });
  const nucleoPedido =
    typeof body.actions?.nucleo === "string" && body.actions.nucleo.trim() ? body.actions.nucleo.trim() : null;

  const problema = validarCondicoes(body.conditions);
  if (problema) return Response.json({ error: problema }, { status: 422 });

  const slug = slugDoNome(name);
  if (!slug) return Response.json({ error: "name não gera slug válido" }, { status: 422 });

  try {
    const criada = await transaction(async (client) => {
      // A categoria valida ANTES do INSERT: uma regra apontando para código
      // inexistente classificaria nada para sempre, em silêncio.
      const categoria = await resolverCategoria(client, categoryCode);
      const nucleo = nucleoPedido ? await resolverNucleo(client, nucleoPedido) : null;
      const actions: Record<string, string> = { category_code: categoria.code };
      if (nucleo) actions.nucleo = nucleo;

      // match_scope 'document' fixo: regra de texto NÃO roda contra o extrato
      // (migração 0009) — a descrição de lançamento do Asaas só contém o nome
      // do cliente, e regra de palavra-chave casaria com o nome de alguém.
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO fin_rule
            (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, created_by)
         SELECT e.id, $2, $3, $4, 'document', $5::jsonb, $6::jsonb, $7, 'humano', 'ativa', 'ui'
           FROM fin_entity e WHERE e.slug = $1
         ON CONFLICT (entity_id, slug) DO NOTHING
         RETURNING id`,
        [ENTITY, slug, name, priority, JSON.stringify(body.conditions), JSON.stringify(actions), confidence]
      );
      return rows[0] ?? null;
    });

    if (!criada) {
      return Response.json({ error: `já existe regra com o slug "${slug}"` }, { status: 409 });
    }
    return Response.json({ ok: true, id: criada.id, slug }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidacaoError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
