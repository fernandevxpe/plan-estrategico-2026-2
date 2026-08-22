import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { cadastrarCartao, opcoesDoTime } from "@/lib/financeiro/time";

/**
 * POST /api/time/cartao — cadastra um plástico pelo celular.
 *
 * Era o único jeito de o Inter (zero plásticos) e os nove Nubank sem apelido
 * saírem do estado em que estão: não havia caminho de escrita para cartão em
 * lugar nenhum da aplicação.
 *
 * Devolve as opções atualizadas junto, para o formulário que chamou não precisar
 * de uma segunda viagem só para ver o cartão que acabou de criar.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cartao = await cadastrarCartao(sessao, corpo);
    return Response.json({ ok: true, cartao, opcoes: await opcoesDoTime() }, { status: 201 });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
