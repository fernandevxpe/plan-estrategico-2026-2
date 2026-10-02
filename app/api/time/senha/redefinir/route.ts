import { respostaDeErro } from "@/app/api/time/_sessao";
import { redefinirSenhaComToken } from "@/lib/financeiro/time-senha";

/**
 * POST /api/time/senha/redefinir — { token, nova }
 *
 * Quem prova a identidade é o token que chegou no e-mail da pessoa. Não abre
 * sessão: depois de trocar, ela entra pelo login com a senha nova.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const corpo = (await request.json().catch(() => ({}))) as { token?: unknown; nova?: unknown };
    await redefinirSenhaComToken(
      typeof corpo.token === "string" ? corpo.token : "",
      typeof corpo.nova === "string" ? corpo.nova : ""
    );
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
