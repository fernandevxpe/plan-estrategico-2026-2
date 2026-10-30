import { editarComissaoSerie, excluirComissaoSerie, getPainelComissoes } from "@/lib/financeiro/comissoes";

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

/**
 * PATCH /api/financeiro/comissoes/serie/[id] — { descricao?, tipoSlug?, cliente?, nota? }
 * propaga para todas as parcelas. Total e nº de parcelas não mudam aqui (ver
 * `editarComissaoSerie`).
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }
  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const edicao: { descricao?: string; tipoSlug?: string | null; cliente?: string | null; nota?: string | null } = {};
  if (typeof corpo.descricao === "string") edicao.descricao = corpo.descricao;
  for (const campo of ["cliente", "tipoSlug", "nota"] as const) {
    if (campo in corpo) edicao[campo] = typeof corpo[campo] === "string" ? (corpo[campo] as string) : null;
  }
  const r = await editarComissaoSerie(idNum, edicao, atorDaRequisicao(request));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true, mudou: r.mudou });
}

/** DELETE /api/financeiro/comissoes/serie/[id] — apaga série e todas as parcelas. */
export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }
  const r = await excluirComissaoSerie(idNum, atorDaRequisicao(request));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true, painel: await getPainelComissoes() });
}
