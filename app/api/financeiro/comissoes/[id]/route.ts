import { editarCompetenciaComissao, excluirComissaoItem, getPainelComissoes } from "@/lib/financeiro/comissoes";

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

/** PATCH /api/financeiro/comissoes/[id] — { competencia: "AAAA-MM" } muda o mês da linha. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }
  const corpo = (await request.json().catch(() => ({}))) as { competencia?: unknown };
  const r = await editarCompetenciaComissao(
    idNum,
    typeof corpo.competencia === "string" ? corpo.competencia.trim() : "",
    atorDaRequisicao(request)
  );
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true });
}

/** DELETE /api/financeiro/comissoes/[id] — apaga lançamento à vista. */
export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }
  const r = await excluirComissaoItem(idNum, atorDaRequisicao(request));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true, painel: await getPainelComissoes() });
}
