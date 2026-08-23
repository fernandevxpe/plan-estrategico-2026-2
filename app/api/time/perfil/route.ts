import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { atualizarPerfil, lerPerfil } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    const perfil = await lerPerfil(sessao);
    return Response.json({ perfil, sessao: { nome: perfil.nome } });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function PATCH(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const corpo = (await request.json().catch(() => ({}))) as { nome?: unknown; email?: unknown };
    const perfil = await atualizarPerfil(sessao, {
      nome: typeof corpo.nome === "string" ? corpo.nome : undefined,
      email: corpo.email === null || typeof corpo.email === "string" ? (corpo.email as string | null) : undefined
    });
    return Response.json({ perfil, sessao: { ...sessao, nome: perfil.nome } });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
