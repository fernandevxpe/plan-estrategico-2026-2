import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { meusRecebiveis } from "@/lib/financeiro/time";

/**
 * GET /api/time/recebiveis — o que a casa pagou para quem está logado.
 *
 * Sempre a própria pessoa: `meusRecebiveis` recebe a `Sessao` e nada mais,
 * como todo o prefixo. Não existe parâmetro de pessoa aqui, e é por isso que
 * não existe forma de pedir o salário do colega.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    return Response.json(
      { recebiveis: await meusRecebiveis(sessao) },
      // Salário e reembolso de uma pessoa não ficam em cache de intermediário.
      { headers: { "cache-control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
