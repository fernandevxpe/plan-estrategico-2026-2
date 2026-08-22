import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { cadastrarCartao, opcoesDoTime, procurarCartaoPeloFinal } from "@/lib/financeiro/time";

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

/**
 * GET /api/time/cartao?final=5585 — este final já é conhecido?
 *
 * Existe porque a resposta muda o fluxo inteiro, e a tela precisa dela ANTES
 * de perguntar qualquer outra coisa: cartão da empresa é compra da empresa,
 * cartão pessoal é reembolso. Sem isto o final lido da foto ficava num estado
 * que só aparecia depois de escolher o banco — e a foto não diz o banco.
 */
export async function GET(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const final = new URL(request.url).searchParams.get("final");
    return Response.json(await procurarCartaoPeloFinal(sessao, final));
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

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
