import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { TimeError, criarEnvioDoTime } from "@/lib/financeiro/time";

/**
 * POST /api/time/envio — um custo da empresa, ou uma nota de entrada.
 *
 * Os dois no mesmo endpoint porque percorrem o mesmo caminho (pessoa envia →
 * admin decide → pessoa vê a resposta) e diferem só nos campos de identificação
 * do documento. Dois endpoints dobrariam o número de lugares onde a regra de
 * escopo precisa estar certa.
 *
 * Sobre a nota de entrada: hoje `fin_document` é 100% "a receber" e a nota de
 * entrada não tem por onde chegar (dúvidas 28 e 45). Este é o primeiro caminho.
 * Ele NÃO cria documento — cria um envio aguardando decisão. A empresa passa a
 * ter para onde mandar a nota antes de ter resolvido o que fazer com ela, que é
 * a ordem certa: sem lugar para pousar, a nota fica no WhatsApp.
 */
export async function POST(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const { dados, arquivo, arquivos } = await lerCorpo(request);

    const kind = dados.kind === "nota_entrada" ? "nota_entrada" : dados.kind === "custo" ? "custo" : null;
    if (!kind) throw new TimeError("informe se é 'custo' ou 'nota_entrada'");

    const resultado = await criarEnvioDoTime(sessao, {
      ...dados,
      kind,
      anexo: arquivos.arquivo ?? arquivo,
      anexoNota: arquivos.arquivoNota ?? null
    });
    return Response.json({ ok: true, ...resultado }, { status: 201 });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
