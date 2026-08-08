import { NextResponse } from "next/server";

import { ImportError, reverterLote } from "@/lib/financeiro/importacao";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Desfazer é o que torna seguro confirmar rápido. Sem isto, ninguém aceita um
 * lote sem conferir linha a linha — e a importação diária volta a custar mais
 * que colar na planilha.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    return NextResponse.json(await reverterLote(Number(id)));
  } catch (erro) {
    if (erro instanceof ImportError) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("[financeiro] reversão de lote falhou:", erro);
    return NextResponse.json({ error: "não consegui reverter o lote" }, { status: 500 });
  }
}
