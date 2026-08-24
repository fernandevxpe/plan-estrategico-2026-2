import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { sugerirCategoriaPorTexto } from "@/lib/financeiro/time";

/**
 * GET /api/time/sugerir-categoria-por-texto?texto=...
 *
 * Igual em espírito a `/sugerir-categoria` (o do CNPJ): busca no que já foi
 * confirmado antes, nunca chuta. A diferença é a chave — aqui é o título ou a
 * descrição que a pessoa está digitando, não algo que a foto revelou. Existe
 * para o lançamento mais manual, sem foto nenhuma, também ganhar sugestão.
 *
 * Devolve `null` sem histórico parecido o bastante — ver `sugerirCategoriaPorTexto`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await exigirContexto();
    const texto = new URL(request.url).searchParams.get("texto") ?? "";
    return Response.json({ sugestao: await sugerirCategoriaPorTexto(texto) });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
