import { query, transaction } from "@/lib/financeiro/db";

/**
 * GET/POST /api/financeiro/pessoas/[id]/mes-ajuste — confirmar à mão o
 * salário e o pró-labore de UM mês (0171).
 *
 * A REGRA QUE NÃO PODE FURAR: salário + pró-labore propostos, mais o que já
 * está certo no mês (comissão, reembolso, estágio, encargo, extra — essas
 * naturezas não mudam aqui, vêm de onde sempre vieram), tem de somar
 * EXATAMENTE o total real que caiu na conta naquele mês. `fin_pessoa_mes_ajuste`
 * não tem como checar isso sozinha — não sabe as outras naturezas. Esta rota é
 * quem sabe, e é aqui que "mostrar que tem erro" acontece: antes de gravar,
 * não depois.
 *
 * O total real vem de `fin_pessoa_remuneracao_v` (extrato linha a linha,
 * ground truth) — nunca da view de bandas, que já pode ter outro ajuste
 * influenciando o que ela mostra para salário/pró-labore.
 */

const ENTITY = "xpe";

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
function mesValido(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(valor);
  if (!m) return null;
  const [, ano, mes] = m;
  const n = Number(mes);
  if (n < 1 || n > 12) return null;
  return `${ano}-${mes}-01`;
}

type RouteParams = { params: Promise<{ id: string }> };

/** As naturezas que este ajuste NÃO toca — vêm sempre da fórmula/tabela própria. */
const OUTRAS_NATUREZAS = ["comissao", "reembolso", "estagio", "encargo_beneficio", "extra"];

async function resumoDoMes(personId: number, mes: string) {
  const [totalRow, bandas, ajusteRow] = await Promise.all([
    query<{ total: string }>(
      `SELECT coalesce(sum(valor_cents), 0)::text AS total
         FROM fin_pessoa_remuneracao_v
        WHERE person_id = $1 AND mes = $2::date`,
      [personId, mes]
    ),
    query<{ natureza: string; valor_cents: string }>(
      `SELECT natureza, valor_cents FROM fin_time_remuneracao_mes_v WHERE person_id = $1 AND mes = $2::date`,
      [personId, mes]
    ),
    query<{ salario_cents: string; prolabore_cents: string; nota: string; confirmado_por: string; atualizado_em: string }>(
      `SELECT salario_cents, prolabore_cents, nota, confirmado_por,
              to_char(atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS atualizado_em
         FROM fin_pessoa_mes_ajuste WHERE person_id = $1 AND mes = $2::date`,
      [personId, mes]
    )
  ]);

  const totalCents = Number(totalRow[0]?.total ?? 0);
  const porNatureza: Record<string, number> = {};
  for (const b of bandas) porNatureza[b.natureza] = Number(b.valor_cents);

  const outrasCents = OUTRAS_NATUREZAS.reduce((s, nat) => s + (porNatureza[nat] ?? 0), 0);
  const ajuste = ajusteRow[0]
    ? {
        salarioCents: Number(ajusteRow[0].salario_cents),
        prolaboreCents: Number(ajusteRow[0].prolabore_cents),
        nota: ajusteRow[0].nota,
        confirmadoPor: ajusteRow[0].confirmado_por,
        atualizadoEm: ajusteRow[0].atualizado_em
      }
    : null;

  return {
    mes: mes.slice(0, 7),
    totalCents,
    outrasNaturezas: OUTRAS_NATUREZAS.filter((n) => (porNatureza[n] ?? 0) > 0).map((n) => ({
      natureza: n,
      valorCents: porNatureza[n]
    })),
    outrasCents,
    // O que a tela pré-preenche: o ajuste salvo, ou o palpite atual da fórmula.
    salarioSugeridoCents: ajuste?.salarioCents ?? porNatureza.salario ?? 0,
    prolaboreSugeridoCents: ajuste?.prolaboreCents ?? porNatureza.prolabore ?? 0,
    // Quanto falta distribuir em salário+pró-labore para fechar o total real.
    disponivelParaSalarioProlaboreCents: totalCents - outrasCents,
    ajuste
  };
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }
  const url = new URL(request.url);
  const mesParam = url.searchParams.get("mes") ?? "";
  const mes = mesValido(mesParam);
  if (!mes) return Response.json({ error: "parâmetro mes precisa ser 'AAAA-MM'" }, { status: 422 });

  const resumo = await resumoDoMes(idNum, mes);
  return Response.json(resumo);
}

type Corpo = { mes?: unknown; salarioCents?: unknown; prolaboreCents?: unknown; nota?: unknown };

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

  const mes = typeof body.mes === "string" ? mesValido(body.mes) : null;
  if (!mes) return Response.json({ error: "mes precisa ser 'AAAA-MM'" }, { status: 422 });

  const salarioCents = Number(body.salarioCents);
  const prolaboreCents = Number(body.prolaboreCents);
  if (!Number.isInteger(salarioCents) || salarioCents < 0) {
    return Response.json({ error: "salarioCents precisa ser um inteiro ≥ 0, em centavos" }, { status: 422 });
  }
  if (!Number.isInteger(prolaboreCents) || prolaboreCents < 0) {
    return Response.json({ error: "prolaboreCents precisa ser um inteiro ≥ 0, em centavos" }, { status: 422 });
  }
  const nota = typeof body.nota === "string" && body.nota.trim() ? body.nota.trim() : null;
  if (!nota) {
    return Response.json({ error: "nota é obrigatória — o que foi conferido para chegar nesse número" }, { status: 422 });
  }

  const pessoa = await query<{ entity_id: number }>(
    `SELECT p.entity_id FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1 WHERE p.id = $2`,
    [ENTITY, idNum]
  ).then((r) => r[0] ?? null);
  if (!pessoa) return Response.json({ error: `pessoa ${idNum} não encontrada` }, { status: 404 });

  // A CONFERÊNCIA — antes de gravar, não depois.
  const resumo = await resumoDoMes(idNum, mes);
  const somaProposta = salarioCents + prolaboreCents + resumo.outrasCents;
  if (somaProposta !== resumo.totalCents) {
    const diffCents = resumo.totalCents - somaProposta;
    return Response.json(
      {
        error:
          diffCents > 0
            ? `faltam ${brl(diffCents)} — a soma (salário + pró-labore + comissão + reembolso + outros) ficou menor que o total real do mês`
            : `sobram ${brl(-diffCents)} — a soma ficou maior que o total real do mês`,
        totalRealCents: resumo.totalCents,
        outrasCents: resumo.outrasCents,
        somaPropostaCents: somaProposta,
        diffCents
      },
      { status: 422 }
    );
  }

  const ator = atorDaRequisicao(request);
  const batchId = crypto.randomUUID();

  const salvo = await transaction(async (client) => {
    const { rows: anteriorRows } = await client.query(
      `SELECT id, salario_cents, prolabore_cents, nota FROM fin_pessoa_mes_ajuste WHERE person_id = $1 AND mes = $2::date`,
      [idNum, mes]
    );
    const anterior = anteriorRows[0] ?? null;

    const { rows } = await client.query<{
      id: number;
      salario_cents: string;
      prolabore_cents: string;
      nota: string;
    }>(
      `INSERT INTO fin_pessoa_mes_ajuste
         (entity_id, person_id, mes, salario_cents, prolabore_cents, nota, confirmado_por)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (person_id, mes) DO UPDATE
         SET salario_cents = EXCLUDED.salario_cents,
             prolabore_cents = EXCLUDED.prolabore_cents,
             nota = EXCLUDED.nota,
             confirmado_por = EXCLUDED.confirmado_por,
             atualizado_em = now()
       RETURNING id, salario_cents, prolabore_cents, nota`,
      [pessoa.entity_id, idNum, mes, salarioCents, prolaboreCents, nota, ator]
    );
    const gravado = rows[0];

    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_pessoa_mes_ajuste', $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8)`,
      [
        pessoa.entity_id,
        gravado.id,
        anterior ? "update" : "insert",
        anterior
          ? JSON.stringify({
              salarioCents: Number(anterior.salario_cents),
              prolaboreCents: Number(anterior.prolabore_cents),
              nota: anterior.nota
            })
          : null,
        JSON.stringify({
          mes: mes.slice(0, 7),
          salarioCents: Number(gravado.salario_cents),
          prolaboreCents: Number(gravado.prolabore_cents),
          nota: gravado.nota
        }),
        ["salario_cents", "prolabore_cents", "nota"],
        batchId,
        ator
      ]
    );

    return gravado;
  });

  return Response.json({
    ajuste: {
      mes: mes.slice(0, 7),
      salarioCents: Number(salvo.salario_cents),
      prolaboreCents: Number(salvo.prolabore_cents),
      nota: salvo.nota
    }
  });
}
