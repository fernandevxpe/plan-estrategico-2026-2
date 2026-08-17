import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { criarReembolsoDoTime } from "@/lib/financeiro/time";

/**
 * POST /api/time/reembolso — a pessoa lança uma despesa que pagou do bolso.
 *
 * O comprovante é o ponto. A base tem 81 pedidos e 193 itens, e **zero** deles
 * têm anexo: a coluna `receipt_artifact_key` existe desde a 0012 esperando um
 * caminho de upload que nunca foi construído. Sem ela, "aprovar reembolso" é
 * acreditar num número digitado.
 *
 * O anexo é opcional no schema de propósito — bloquear o lançamento por falta
 * de foto faria a pessoa desistir e voltar para a planilha, e aí o item não
 * existiria nem sem comprovante. A tela pede, a fila mostra quem não tem, e a
 * decisão de exigir é do admin.
 */
export async function POST(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const { dados, arquivo } = await lerCorpo(request);
    const resultado = await criarReembolsoDoTime(sessao, { ...dados, comprovante: arquivo });
    return Response.json({ ok: true, ...resultado }, { status: 201 });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
