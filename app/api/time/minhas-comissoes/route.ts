import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { minhasComissoes } from "@/lib/financeiro/time";

/**
 * GET /api/time/minhas-comissoes — a comissão declarada de quem está logado.
 *
 * Sempre a própria pessoa: `minhasComissoes` recebe a `Sessao` e nada mais,
 * como todo o prefixo. Não existe parâmetro de pessoa aqui, e é por isso que
 * não existe forma de pedir a comissão do colega.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    return Response.json(
      { comissoes: await minhasComissoes(sessao) },
      // Comissão de uma pessoa não fica em cache de intermediário.
      { headers: { "cache-control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
