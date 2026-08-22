import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { ComprovanteIndisponivel } from "@/lib/financeiro/ler-comprovante";
import { lerCartao } from "@/lib/financeiro/ler-cartao";
import { TimeError } from "@/lib/financeiro/time";

/**
 * POST /api/time/cartao/ler — a foto do cartão vira banco, bandeira, cor e final.
 *
 * ---------------------------------------------------------------------------
 * ESTA ROTA NÃO GRAVA NADA. É O PONTO PRINCIPAL DELA.
 * ---------------------------------------------------------------------------
 * A foto de um cartão contém o número completo, o nome impresso e a validade.
 * Ela entra, é lida em memória e some quando a resposta é enviada — não passa
 * por `guardarAnexo`, não toca `fin_anexo_blob`, não vira anexo de nada.
 *
 * A diferença para `/api/time/ler-comprovante` é essa: lá o arquivo é a PROVA
 * do gasto e precisa ficar guardado; aqui ele é só a fonte de quatro campos, e
 * guardá-lo seria hospedar número de cartão em troca de conveniência.
 *
 * O que sai daqui — banco, bandeira, cor, quatro últimos — é exatamente o que a
 * casa já podia guardar antes de existir foto.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await exigirContexto();
    const { arquivo } = await lerCorpo(request);
    if (!arquivo) throw new TimeError("mande a foto do cartão", 400);

    // Teto menor que o do comprovante: cartão é um retângulo pequeno e a tela
    // já reduz antes de mandar. Um arquivo de 8 MB aqui é foto errada.
    if (arquivo.bytes.length > 6 * 1024 * 1024) {
      throw new TimeError("foto acima de 6 MB — tire mais de perto, só o cartão", 413);
    }

    const lido = await lerCartao(arquivo.bytes, arquivo.mime);

    // `no-store` explícito: a resposta traz os quatro últimos e o nome
    // impresso, e nenhum intermediário tem motivo para reter isso.
    return Response.json({ lido }, { headers: { "cache-control": "no-store" } });
  } catch (erro) {
    if (erro instanceof ComprovanteIndisponivel) {
      return Response.json({ error: erro.message }, { status: 503 });
    }
    return respostaDeErro(erro);
  }
}
