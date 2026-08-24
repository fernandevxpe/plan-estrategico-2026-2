/**
 * GET/POST /api/financeiro/pessoas/[id]/comissao — atalho do perfil.
 *
 * A tela canônica é `/financeiro/comissoes` (0167): várias por mês, descrição,
 * parcelamento. Este endpoint continua para o chip do perfil e agora SEMPRE
 * INSERE (não sobrescreve o mês) — duas comissões no mesmo mês somam.
 */

import { query } from "@/lib/financeiro/db";
import { criarComissaoAvulsa } from "@/lib/financeiro/comissoes";

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

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  const [historico, temBase] = await Promise.all([
    query<{
      id: number;
      valor_cents: string;
      competencia: string;
      descricao: string;
      nota: string | null;
      criado_em: string;
    }>(
      `SELECT id, valor_cents, to_char(competencia, 'YYYY-MM') AS competencia,
              descricao, nota,
              to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS criado_em
         FROM fin_pessoa_comissao_declarada
        WHERE person_id = $1
        ORDER BY competencia DESC, id DESC`,
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
      descricao: h.descricao,
      nota: h.nota,
      criadoEm: h.criado_em
    })),
    temSalarioBase: temBase
  });
}

type Corpo = { valorCents?: unknown; competencia?: unknown; nota?: unknown; descricao?: unknown };

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

  const descricao =
    typeof body.descricao === "string" && body.descricao.trim()
      ? body.descricao.trim()
      : typeof body.nota === "string" && body.nota.trim()
        ? body.nota.trim()
        : "";

  const r = await criarComissaoAvulsa(
    {
      personId: idNum,
      competencia: typeof body.competencia === "string" ? body.competencia : "",
      valorCents: Number(body.valorCents),
      descricao,
      nota: typeof body.nota === "string" ? body.nota : null
    },
    atorDaRequisicao(request)
  );
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({
    comissao: {
      id: r.item.id,
      valorCents: r.item.valorCents,
      competencia: r.item.competencia.slice(0, 7),
      descricao: r.item.descricao,
      nota: r.item.nota
    }
  });
}
