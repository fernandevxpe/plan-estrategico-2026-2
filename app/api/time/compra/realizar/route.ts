import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { minhasComprasAprovadas, realizarCompra } from "@/lib/financeiro/time";
import { TimeError } from "@/lib/financeiro/time";

/**
 * GET  — as compras aprovadas que esta pessoa ainda não fez.
 * POST — fecha uma delas com o que foi realmente gasto.
 *
 * O ciclo completo: pediu → aprovaram → comprou → registrou aqui. O custo que
 * nasce é um custo normal, com obra, cartão e comprovante; o que muda é que ele
 * aponta de volta para a solicitação, e ela passa a `atendida`.
 *
 * Sem parâmetro de pessoa, como todo o prefixo: a lista é de quem pediu, e quem
 * pediu vem da sessão.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    return Response.json({ compras: await minhasComprasAprovadas(sessao) });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function POST(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const { dados, arquivo } = await lerCorpo(request);
    const compraId = Number(dados.compraId);
    if (!Number.isInteger(compraId) || compraId <= 0) throw new TimeError("qual compra?", 400);

    const envio = await realizarCompra(sessao, compraId, { ...dados, kind: "custo", anexo: arquivo });
    return Response.json({ ok: true, envio }, { status: 201 });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
