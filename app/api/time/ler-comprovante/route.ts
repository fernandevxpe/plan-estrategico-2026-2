import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { ComprovanteIndisponivel, lerComprovante, leituraDeComprovanteDisponivel } from "@/lib/financeiro/ler-comprovante";
import { TimeError } from "@/lib/financeiro/time";

/**
 * POST /api/time/ler-comprovante — a foto vira campos preenchidos.
 *
 * Exige sessão, como todo o prefixo: sem isso seria um endpoint anônimo que
 * gasta dinheiro de API por requisição, e um laço de `curl` viraria fatura.
 *
 * Não grava nada. A resposta só volta para a tela preencher o formulário; quem
 * grava é o envio, depois que a pessoa conferiu. É a diferença entre a IA
 * digitar por você e a IA decidir por você.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // A tela pergunta antes de mostrar o botão: sem chave configurada, o botão
  // não aparece, em vez de aparecer e falhar no toque.
  return Response.json({ disponivel: leituraDeComprovanteDisponivel() });
}

export async function POST(request: Request) {
  try {
    await exigirContexto();
    const { arquivo } = await lerCorpo(request);
    if (!arquivo) throw new TimeError("mande o arquivo do comprovante", 400);

    // Mesmo teto do anexo. Uma foto de 10 MB também custaria 10 MB de tokens.
    if (arquivo.bytes.length > 10 * 1024 * 1024) {
      throw new TimeError("comprovante acima de 10 MB", 413);
    }

    return Response.json({ lido: await lerComprovante(arquivo.bytes, arquivo.mime) });
  } catch (erro) {
    if (erro instanceof ComprovanteIndisponivel) {
      return Response.json({ error: erro.message }, { status: 503 });
    }
    return respostaDeErro(erro);
  }
}
