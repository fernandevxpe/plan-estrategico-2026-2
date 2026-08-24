import { query, transaction } from "@/lib/financeiro/db";

/**
 * GET/POST /api/financeiro/pessoas/[id]/comissao — a comissão do mês,
 * afirmada por quem paga (0165).
 *
 * DIFERENTE DO SALÁRIO-BASE: aqui não é vigência aberta, é COMPETÊNCIA — um
 * valor por mês, não "vale a partir de". Cada mês se declara (ou corrige) por
 * si, porque comissão varia mês a mês; salário-base muda raro e vale até a
 * próxima mudança.
 *
 * Só produz efeito visível em `fin_time_remuneracao_mes_v` para quem TEM
 * salário-base registrado (0165) — sem base, o 6.01 do ledger já consome a
 * sobra inteira antes da comissão declarada ter de onde ser puxada. A rota
 * aceita o valor de qualquer forma (o dado fica correto e disponível assim
 * que a base existir), mas a UI deveria avisar quando faltar a base.
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

/** Aceita 'YYYY-MM' ou 'YYYY-MM-DD' e devolve sempre o primeiro dia do mês. */
function competenciaValida(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(valor);
  if (!m) return null;
  const [, ano, mes] = m;
  const n = Number(mes);
  if (n < 1 || n > 12) return null;
  return `${ano}-${mes}-01`;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  const [historico, temBase] = await Promise.all([
    query<{ id: number; valor_cents: string; competencia: string; nota: string | null; criado_em: string }>(
      `SELECT id, valor_cents, to_char(competencia, 'YYYY-MM') AS competencia, nota,
              to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS criado_em
         FROM fin_pessoa_comissao_declarada
        WHERE person_id = $1
        ORDER BY competencia DESC`,
      [idNum]
    ),
    query<{ existe: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM fin_pessoa_salario_base WHERE person_id = $1) AS existe`,
      [idNum]
    ).then((r) => r[0]?.existe ?? false)
  ]);

  return Response.json({
    historico: historico.map((h) => ({
      id: h.id,
      valorCents: Number(h.valor_cents),
      competencia: h.competencia,
      nota: h.nota,
      criadoEm: h.criado_em
    })),
    temSalarioBase: temBase
  });
}

type Corpo = { valorCents?: unknown; competencia?: unknown; nota?: unknown };

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
  const competencia = typeof body.competencia === "string" ? competenciaValida(body.competencia) : null;
  if (!competencia) {
    return Response.json({ error: "competencia precisa ser 'AAAA-MM'" }, { status: 422 });
  }
  const nota = typeof body.nota === "string" && body.nota.trim() ? body.nota.trim() : null;
  if (!nota) {
    return Response.json({ error: "nota é obrigatória — diga de onde veio o número" }, { status: 422 });
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
      `SELECT id, valor_cents, nota FROM fin_pessoa_comissao_declarada WHERE person_id = $1 AND competencia = $2::date`,
      [idNum, competencia]
    );
    const anterior = anteriorRows[0] ?? null;

    const { rows } = await client.query<{ id: number; valor_cents: string; competencia: string; nota: string | null }>(
      `INSERT INTO fin_pessoa_comissao_declarada (entity_id, person_id, competencia, valor_cents, nota)
       VALUES ($1, $2, $3::date, $4, $5)
       ON CONFLICT (person_id, competencia) DO UPDATE
         SET valor_cents = EXCLUDED.valor_cents, nota = EXCLUDED.nota, atualizado_em = now()
       RETURNING id, valor_cents, to_char(competencia, 'YYYY-MM') AS competencia, nota`,
      [pessoa.entity_id, idNum, competencia, valorCents, nota]
    );
    const gravado = rows[0];

    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_comissao_declarada', $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8)`,
      [
        pessoa.entity_id,
        gravado.id,
        anterior ? "update" : "insert",
        anterior ? JSON.stringify({ valorCents: Number(anterior.valor_cents), nota: anterior.nota }) : null,
        JSON.stringify({ valorCents: Number(gravado.valor_cents), competencia: gravado.competencia, nota: gravado.nota }),
        ["valor_cents", "nota"],
        batchId,
        ator
      ]
    );

    return gravado;
  });

  return Response.json({
    comissao: { id: linha.id, valorCents: Number(linha.valor_cents), competencia: linha.competencia, nota: linha.nota }
  });
}
