import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_SESSAO, abrirSessao } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

/**
 * Atalho de desenvolvimento para autenticar direto como Fernando no app do time.
 * Abre a sessão, grava o cookie e redireciona direto para /time.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent");
  const destino = url.searchParams.get("destino") || "/time";

  const resultado = await abrirSessao(4, null, userAgent);
  const cookieJar = await cookies();
  cookieJar.set(COOKIE_SESSAO, resultado.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return NextResponse.redirect(new URL(destino, request.url));
}
