import { cookies } from "next/headers";

import { respostaDeErro, sessaoAtual } from "@/app/api/time/_sessao";
import {
  COOKIE_SESSAO,
  TimeError,
  abrirSessao,
  encerrarSessao,
  listarPessoas,
  schemaTimeDisponivel
} from "@/lib/financeiro/time";

/**
 * Quem está usando o app do time.
 *
 * GET    — a sessão atual (ou null) e a lista de quem se pode dizer que é.
 * POST   — abre a sessão declarando a identidade (e o PIN, se houver).
 * DELETE — encerra.
 *
 * A honestidade que esta rota carrega: a resposta do GET traz `prova`, e é
 * 'declarada' enquanto ninguém cadastrar PIN. A tela mostra isso. Um produto
 * que chamasse essa escolha de "login" estaria mentindo sobre a força da
 * evidência — e esta base não faz isso com dinheiro, não vai fazer com gente.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await schemaTimeDisponivel())) {
      return Response.json({
        disponivel: false,
        motivo: "migration 0105 não aplicada neste ambiente",
        sessao: null,
        pessoas: []
      });
    }
    const [sessao, pessoas] = await Promise.all([sessaoAtual(), listarPessoas()]);
    return Response.json({ disponivel: true, motivo: null, sessao, pessoas });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function POST(request: Request) {
  try {
    if (!(await schemaTimeDisponivel())) {
      throw new TimeError("o app do time ainda não foi liberado neste ambiente (migration 0105 não aplicada)", 503);
    }
    const corpo = (await request.json().catch(() => ({}))) as { personId?: unknown; pin?: unknown };
    const personId = Number(corpo.personId);
    const pin = typeof corpo.pin === "string" && corpo.pin.trim() ? corpo.pin.trim() : null;

    const { token, sessao } = await abrirSessao(personId, pin, request.headers.get("user-agent"));

    // httpOnly: o token não precisa ser lido por JavaScript nenhum, e não sendo
    // legível ele não vaza por XSS. sameSite=lax: o app é navegado, não
    // embutido em terceiro.
    (await cookies()).set(COOKIE_SESSAO, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    return Response.json({ ok: true, sessao });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function DELETE() {
  try {
    const jar = await cookies();
    await encerrarSessao(jar.get(COOKIE_SESSAO)?.value ?? null);
    jar.delete(COOKIE_SESSAO);
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
