import { query, transaction } from "@/lib/financeiro/db";

/**
 * GET/POST /api/financeiro/pessoas/[id]/prolabore-esperado — quanto esperar
 * de pró-labore no mês seguinte (0166).
 *
 * NÃO É O PRÓ-LABORE REAL. O pró-labore de um mês FECHADO continua sendo o
 * resto por construção (0164/0165) — sobra depois de reembolso, salário-base
 * e comissão, provada igual ao que caiu na conta. Isto aqui não entra nessa
 * fórmula; é só o insumo da PREVISÃO, para o mês que ainda não tem transação
 * nenhuma. Mesma vigência de fin_pessoa_salario_base — muda raro, vale até a
 * próxima linha.
 */

const ENTITY = "xpe";

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

function dataValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  const historico = await query<{
    id: number;
    valor_cents: string;
    vigente_desde: string;
    nota: string | null;
    criado_em: string;
  }>(
    `SELECT id, valor_cents, to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, nota,
            to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS criado_em
       FROM fin_pessoa_prolabore_esperado
      WHERE person_id = $1
      ORDER BY vigente_desde DESC`,
    [idNum]
  );

  return Response.json({
    historico: historico.map((h) => ({
      id: h.id,
      valorCents: Number(h.valor_cents),
      vigenteDesde: h.vigente_desde,
      nota: h.nota,
      criadoEm: h.criado_em
    })),
    atual: historico[0] ? { valorCents: Number(historico[0].valor_cents), vigenteDesde: historico[0].vigente_desde } : null
  });
}

type Corpo = { valorCents?: unknown; vigenteDesde?: unknown; nota?: unknown };

export async function POST(request: Request, { params }: RouteParams) {
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

  const valorCents = Number(body.valorCents);
  if (!Number.isInteger(valorCents) || valorCents <= 0) {
    return Response.json({ error: "valorCents precisa ser um inteiro positivo, em centavos" }, { status: 422 });
  }
  const vigenteDesde = typeof body.vigenteDesde === "string" ? body.vigenteDesde : "";
  if (!dataValida(vigenteDesde)) {
    return Response.json({ error: "vigenteDesde precisa ser uma data válida, formato AAAA-MM-DD" }, { status: 422 });
  }
  const nota = typeof body.nota === "string" && body.nota.trim() ? body.nota.trim() : null;
  if (!nota) {
    return Response.json({ error: "nota é obrigatória — diga a origem do número (quem afirmou, e quando)" }, { status: 422 });
  }

  const pessoa = await query<{ entity_id: number }>(
    `SELECT p.entity_id FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1 WHERE p.id = $2`,
    [ENTITY, idNum]
  ).then((r) => r[0] ?? null);
  if (!pessoa) return Response.json({ error: `pessoa ${idNum} não encontrada` }, { status: 404 });

  const ator = atorDaRequisicao(request);
  const batchId = crypto.randomUUID();

  const linha = await transaction(async (client) => {
    const { rows: anteriorRows } = await client.query(
      `SELECT id, valor_cents, nota FROM fin_pessoa_prolabore_esperado WHERE person_id = $1 AND vigente_desde = $2`,
      [idNum, vigenteDesde]
    );
    const anterior = anteriorRows[0] ?? null;

    const { rows } = await client.query<{
      id: number;
      valor_cents: string;
      vigente_desde: string;
      nota: string | null;
    }>(
      `INSERT INTO fin_pessoa_prolabore_esperado (entity_id, person_id, vigente_desde, valor_cents, nota)
       VALUES ($1, $2, $3::date, $4, $5)
       ON CONFLICT (person_id, vigente_desde) DO UPDATE
         SET valor_cents = EXCLUDED.valor_cents, nota = EXCLUDED.nota, atualizado_em = now()
       RETURNING id, valor_cents, to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, nota`,
      [pessoa.entity_id, idNum, vigenteDesde, valorCents, nota]
    );
    const gravado = rows[0];

    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_prolabore_esperado', $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8)`,
      [
        pessoa.entity_id,
        gravado.id,
        anterior ? "update" : "insert",
        anterior ? JSON.stringify({ valorCents: Number(anterior.valor_cents), nota: anterior.nota }) : null,
        JSON.stringify({ valorCents: Number(gravado.valor_cents), vigenteDesde: gravado.vigente_desde, nota: gravado.nota }),
        ["valor_cents", "nota"],
        batchId,
        ator
      ]
    );

    return gravado;
  });

  return Response.json({
    prolaboreEsperado: { id: linha.id, valorCents: Number(linha.valor_cents), vigenteDesde: linha.vigente_desde, nota: linha.nota }
  });
}
