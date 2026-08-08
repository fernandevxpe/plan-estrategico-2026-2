import { NextResponse } from "next/server";

import { decidirLinha, descartarLote, getLote, ImportError } from "@/lib/financeiro/importacao";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const lote = await getLote(Number(id));
  if (!lote) return NextResponse.json({ error: "lote não encontrado" }, { status: 404 });
  return NextResponse.json(lote);
}

/** "Importar mesmo assim" e "tirar do lote", gravados antes do commit. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  let body: { rowId?: unknown; acao?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const rowId = Number(body.rowId);
  const acao = body.acao;
  if (!Number.isInteger(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "rowId inválido" }, { status: 400 });
  }
  if (acao !== "forcar" && acao !== "ignorar" && acao !== "restaurar") {
    return NextResponse.json({ error: "acao deve ser forcar, ignorar ou restaurar" }, { status: 400 });
  }

  try {
    return NextResponse.json(await decidirLinha(Number(id), rowId, acao));
  } catch (erro) {
    if (erro instanceof ImportError) return NextResponse.json({ error: erro.message }, { status: erro.status });
    throw erro;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    await descartarLote(Number(id));
    return NextResponse.json({ ok: true });
  } catch (erro) {
    if (erro instanceof ImportError) return NextResponse.json({ error: erro.message }, { status: erro.status });
    throw erro;
  }
}
