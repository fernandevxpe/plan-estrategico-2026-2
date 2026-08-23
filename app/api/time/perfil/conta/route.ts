import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { lerContaPagamento, salvarContaPagamento } from "@/lib/financeiro/time";

/**
 * A conta bancária de quem está logado — sempre a própria, nunca a de outro.
 *
 * O escopo vem da `Sessao`, como em todo o prefixo `/api/time`: nenhuma das
 * duas funções aceita pessoa como parâmetro. Quem precisa ver a conta do time
 * inteiro é o financeiro, e essa tela vive sob `/financeiro`, atrás de Basic
 * Auth — a chave PIX de uma pessoa não é assunto do colega.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    return Response.json(
      { conta: await lerContaPagamento(sessao) },
      // Chave PIX e documento de titular não têm por que ficar em cache de
      // intermediário nenhum.
      { headers: { "cache-control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function PUT(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const conta = await salvarContaPagamento(sessao, corpo);
    return Response.json({ conta }, { headers: { "cache-control": "no-store" } });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
