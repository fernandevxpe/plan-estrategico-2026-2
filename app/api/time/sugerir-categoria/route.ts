import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { sugerirCategoria } from "@/lib/financeiro/time";

/**
 * GET /api/time/sugerir-categoria?documento=CNPJ
 *
 * O CNPJ vem da foto do comprovante — a extração já o lia e o descartava. Com
 * ele, a categoria sai do histórico daquela contraparte em vez de sair de um
 * select com trinta opções.
 *
 * Devolve `null` quando não há histórico suficiente. Silêncio é a resposta
 * certa: uma sugestão fraca ocupa o mesmo espaço de uma boa e ensina a pessoa a
 * ignorar as duas.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await exigirContexto();
    const doc = new URL(request.url).searchParams.get("documento") ?? "";
    return Response.json({ sugestao: await sugerirCategoria(doc) });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
