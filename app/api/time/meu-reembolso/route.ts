import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { meuReembolso } from "@/lib/financeiro/time";

/**
 * GET /api/time/meu-reembolso — o dinheiro que a empresa deve a ESTA pessoa.
 *
 * Não existe parâmetro de pessoa, pela mesma disciplina de `/api/time/envios`:
 * o escopo é a sessão e é a única fonte. O admin vê o de todo mundo por
 * `/financeiro/reembolsos`, que mora sob o prefixo protegido.
 *
 * É a primeira rota do app que mostra DINHEIRO da pessoa, e por isso ela só
 * existe depois do login por senha — enquanto a identidade era declarada
 * (clicar no próprio nome numa lista), qualquer um veria o saldo de qualquer um.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    return Response.json({ reembolso: await meuReembolso(sessao) });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
