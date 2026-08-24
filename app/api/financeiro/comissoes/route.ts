import {
  criarComissaoAvulsa,
  criarComissaoParcelada,
  getPainelComissoes
} from "@/lib/financeiro/comissoes";

/**
 * GET/POST /api/financeiro/comissoes — painel e lançamento de comissão
 * declarada (0165/0167). À vista ou parcelada; várias por pessoa×mês.
 */

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

export async function GET() {
  return Response.json(await getPainelComissoes());
}

type Corpo = {
  modo?: unknown;
  personId?: unknown;
  competencia?: unknown;
  primeiraCompetencia?: unknown;
  valorCents?: unknown;
  totalCents?: unknown;
  parcelas?: unknown;
  descricao?: unknown;
  nota?: unknown;
};

export async function POST(request: Request) {
  let body: Corpo;
  try {
    body = (await request.json()) as Corpo;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  const personId = Number(body.personId);
  if (!Number.isInteger(personId) || personId <= 0) {
    return Response.json({ error: "personId inválido" }, { status: 422 });
  }
  const descricao = typeof body.descricao === "string" ? body.descricao : "";
  const nota = typeof body.nota === "string" ? body.nota : null;
  const ator = atorDaRequisicao(request);
  const modo = body.modo === "parcelada" ? "parcelada" : "avulsa";

  if (modo === "parcelada") {
    const r = await criarComissaoParcelada(
      {
        personId,
        primeiraCompetencia: typeof body.primeiraCompetencia === "string" ? body.primeiraCompetencia : "",
        totalCents: Number(body.totalCents),
        parcelas: Number(body.parcelas),
        descricao,
        nota
      },
      ator
    );
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ serieId: r.serieId, itens: r.itens, painel: await getPainelComissoes() });
  }

  const r = await criarComissaoAvulsa(
    {
      personId,
      competencia: typeof body.competencia === "string" ? body.competencia : "",
      valorCents: Number(body.valorCents),
      descricao,
      nota
    },
    ator
  );
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ item: r.item, painel: await getPainelComissoes() });
}
