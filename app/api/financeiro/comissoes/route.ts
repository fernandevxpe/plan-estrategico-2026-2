import { criarComissao, getPainelComissoes } from "@/lib/financeiro/comissoes";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/financeiro/comissao-cronograma";

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
  forma?: unknown;
  entradaCents?: unknown;
  tipoSlug?: unknown;
  cliente?: unknown;
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

  // `forma` é o vocabulário novo (0178). `modo` continua aceito porque a tela
  // antiga mandava "avulsa"/"parcelada" — trocar os dois no mesmo deploy
  // deixaria requisição em voo sem resposta.
  const forma: FormaPagamento = FORMAS_PAGAMENTO.includes(body.forma as FormaPagamento)
    ? (body.forma as FormaPagamento)
    : body.modo === "parcelada"
      ? "parcelada"
      : "avista";

  // O valor cheio pode chegar como `totalCents` (parcelado) ou `valorCents`
  // (à vista): os dois nomes existiam antes e significam a mesma coisa aqui.
  const totalCents = Number(body.totalCents ?? body.valorCents);
  const primeiraCompetencia =
    typeof body.primeiraCompetencia === "string"
      ? body.primeiraCompetencia
      : typeof body.competencia === "string"
        ? body.competencia
        : "";

  const r = await criarComissao(
    {
      personId,
      forma,
      totalCents,
      parcelas: Number(body.parcelas ?? 1),
      entradaCents: Number(body.entradaCents ?? 0),
      primeiraCompetencia,
      descricao,
      nota,
      tipoSlug: typeof body.tipoSlug === "string" ? body.tipoSlug : null,
      cliente: typeof body.cliente === "string" ? body.cliente : null
    },
    ator
  );
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({
    serieId: r.resultado.serieId,
    cronograma: r.resultado.cronograma,
    painel: await getPainelComissoes()
  });
}
