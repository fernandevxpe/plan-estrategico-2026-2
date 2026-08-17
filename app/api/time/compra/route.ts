import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { criarCompraDoTime } from "@/lib/financeiro/time";

/**
 * POST /api/time/compra — o pedido de compra, com o link do que comprar.
 *
 * `fin_purchase_request` existe desde a 0075, já com `source='app_time'` no
 * CHECK, e tinha **0 linhas** — a tabela esperava esta rota. O que faltava nela
 * era o link, que o dono pediu com essas palavras: *"enviar por exemplo link de
 * coisas pra comprar"*.
 *
 * O que este endpoint NÃO faz: não aprova, não reserva orçamento e não cria
 * solicitação de pagamento. Um pedido aprovado só vira saída de caixa quando um
 * `fin_payment_request` nascer dele — e esse caminho depende da alçada, que
 * está vazia por desenho (dúvida 27). Somar as duas camadas contaria o mesmo
 * dinheiro duas vezes, e é o que o comentário da própria 0075 avisa.
 */
export async function POST(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const { dados } = await lerCorpo(request);
    const resultado = await criarCompraDoTime(sessao, dados);
    return Response.json({ ok: true, ...resultado }, { status: 201 });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
