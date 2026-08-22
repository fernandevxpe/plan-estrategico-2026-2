import { cookies } from "next/headers";

import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { COOKIE_SESSAO, TimeError, trocarSenha } from "@/lib/financeiro/time";

/**
 * Trocar a própria senha.
 *
 * A senha que o admin define é de ENTREGA, não de uso: quem a definiu conhece
 * o valor. Por isso `senha_trocar` nasce `true` e a tela cobra a troca na
 * primeira sessão.
 *
 * A senha atual é exigida mesmo havendo sessão válida. A sessão dura 30 dias
 * de propósito (o app é usado com a mão suja, no meio da rua), e um celular
 * esquecido na mesa não pode virar troca de senha.
 *
 * De quem é a senha vem da sessão, nunca do corpo — a mesma disciplina que
 * `scripts/test-perfil-guard.mjs` verifica em todo o prefixo `/api/time`.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // A única rota que aceita sessão com senha de entrega pendente: é a saída.
    const { sessao } = await exigirContexto({ senhaPendenteOk: true });
    const token = (await cookies()).get(COOKIE_SESSAO)?.value;
    if (!token) throw new TimeError("identifique-se para continuar", 401);

    const corpo = (await request.json().catch(() => ({}))) as { atual?: unknown; nova?: unknown };
    const atual = typeof corpo.atual === "string" ? corpo.atual : "";
    const nova = typeof corpo.nova === "string" ? corpo.nova : "";

    await trocarSenha(sessao, token, atual, nova);
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
