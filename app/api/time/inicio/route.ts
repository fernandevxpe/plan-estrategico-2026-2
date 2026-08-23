import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { resumoInicio } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    return Response.json({ resumo: await resumoInicio(sessao) });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
