import { headers } from "next/headers";

import { respostaDeErro } from "@/app/api/time/_sessao";
import { pedirRecuperacaoDeSenha } from "@/lib/financeiro/time-senha";

/**
 * POST /api/time/senha/esqueci — { email }
 *
 * Sem sessão por definição: quem chega aqui não consegue entrar. A resposta é
 * a mesma exista o e-mail ou não; ver `pedirRecuperacaoDeSenha`.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const corpo = (await request.json().catch(() => ({}))) as { email?: unknown };
    const ua = (await headers()).get("user-agent");
    await pedirRecuperacaoDeSenha(typeof corpo.email === "string" ? corpo.email : "", ua);
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
