import { NextResponse } from "next/server";

import { confirmarLote, ImportError } from "@/lib/financeiro/importacao";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const aceitarDivergencia = body?.aceitarDivergencia === true;

  try {
    return NextResponse.json(await confirmarLote(Number(id), aceitarDivergencia));
  } catch (erro) {
    if (erro instanceof ImportError) {
      return NextResponse.json({ error: erro.message, ...erro.detalhe }, { status: erro.status });
    }
    console.error("[financeiro] confirmação de lote falhou:", erro);
    return NextResponse.json({ error: "não consegui confirmar o lote" }, { status: 500 });
  }
}
