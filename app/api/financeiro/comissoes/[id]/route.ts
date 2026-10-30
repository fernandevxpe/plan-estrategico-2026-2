import { type EdicaoComissao, editarComissao, excluirComissaoItem, getPainelComissoes } from "@/lib/financeiro/comissoes";

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
 * PATCH /api/financeiro/comissoes/[id] — edita uma linha (à vista ou parcela).
 * Aceita qualquer subconjunto de { valorCents, competencia: "AAAA-MM",
 * descricao, cliente, tipoSlug, nota }. Campo ausente não muda; `null` em
 * cliente/tipo/nota limpa. O corpo antigo `{ competencia }` continua valendo.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }
  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const edicao: EdicaoComissao = {};
  if ("valorCents" in corpo) edicao.valorCents = Number(corpo.valorCents);
  if (typeof corpo.competencia === "string") edicao.competencia = corpo.competencia.trim().slice(0, 7);
  if (typeof corpo.descricao === "string") edicao.descricao = corpo.descricao;
  for (const campo of ["cliente", "tipoSlug", "nota"] as const) {
    if (campo in corpo) edicao[campo] = typeof corpo[campo] === "string" ? (corpo[campo] as string) : null;
  }
  const r = await editarComissao(idNum, edicao, atorDaRequisicao(request));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true, mudou: r.mudou });
}

/** DELETE /api/financeiro/comissoes/[id] — apaga uma linha (à vista ou uma parcela). */
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
