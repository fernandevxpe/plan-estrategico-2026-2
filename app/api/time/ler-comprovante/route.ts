import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { ComprovanteIndisponivel, lerComprovante, leituraDeComprovanteDisponivel } from "@/lib/financeiro/ler-comprovante";
import { XmlNaoEhNota, lerNotaXml, pareceXml } from "@/lib/financeiro/ler-nfe-xml";
import { TimeError, catalogoDeClassificacao } from "@/lib/financeiro/time";

/**
 * POST /api/time/ler-comprovante — a foto vira campos preenchidos.
 *
 * Exige sessão, como todo o prefixo: sem isso seria um endpoint anônimo que
 * gasta dinheiro de API por requisição, e um laço de `curl` viraria fatura.
 *
 * Não grava nada. A resposta só volta para a tela preencher o formulário; quem
 * grava é o envio, depois que a pessoa conferiu. É a diferença entre a IA
 * digitar por você e a IA decidir por você.
 *
 * ---------------------------------------------------------------------------
 * DOIS CAMINHOS, E O ARQUIVO ESCOLHE QUAL
 * ---------------------------------------------------------------------------
 * XML de NF-e vai para `ler-nfe-xml`: os campos têm nome, o valor é exato, e
 * não custa nada. Foto, print e PDF vão para o Haiku, que lê o que está na
 * imagem e ainda arrisca a categoria e a área.
 *
 * Os dois se completam em vez de competirem. O XML é a verdade sobre o número;
 * o print é rico no que o XML não tem — o parcelamento como a loja mostrou, os
 * quatro dígitos do cartão, o contexto que permite adivinhar para que área foi.
 * Quem anexa os dois fica com o melhor dos dois, e a tela diz de onde veio cada
 * campo.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // A tela pergunta antes de mostrar o botão: sem chave configurada, o botão
  // não aparece, em vez de aparecer e falhar no toque.
  return Response.json({ disponivel: leituraDeComprovanteDisponivel() });
}

/** Formatos que o modelo aceita como imagem. HEIC do iPhone não está aqui. */
const IMAGENS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  try {
    await exigirContexto();
    const { arquivo } = await lerCorpo(request);
    if (!arquivo) throw new TimeError("mande o arquivo do comprovante", 400);

    // Mesmo teto do anexo. Uma foto de 10 MB também custaria 10 MB de tokens.
    if (arquivo.bytes.length > 10 * 1024 * 1024) {
      throw new TimeError("comprovante acima de 10 MB", 413);
    }

    // ---------------------------------------------------------------------
    // XML: leitura exata, sem modelo e sem custo.
    // ---------------------------------------------------------------------
    // Decidido pelo CONTEÚDO, não pela extensão: o Android manda .xml como
    // `application/octet-stream` com frequência, e confiar no mime mandava a
    // nota para a IA — que lia o XML como se fosse texto de imagem e devolvia
    // 400. Era esse o "não consegui ler" que aparecia com nota boa na mão.
    if (pareceXml(arquivo.bytes)) {
      try {
        const nota = lerNotaXml(arquivo.bytes.toString("utf8"));
        return Response.json({ lido: { ...nota, legibilidade: "boa" as const }, fonte: "xml" });
      } catch (erro) {
        if (erro instanceof XmlNaoEhNota) throw new TimeError(erro.message, 400);
        throw erro;
      }
    }

    // ---------------------------------------------------------------------
    // HEIC: recusa explicada, em vez de 400 do provedor.
    // ---------------------------------------------------------------------
    // O iPhone grava em HEIC e o modelo não aceita o formato. A tela já
    // converte para JPEG antes de mandar — mas só quando o canvas consegue
    // decodificar, o que não acontece em todo navegador. Quando escapa, a
    // pessoa precisa saber que o problema é o formato do arquivo e não a foto,
    // senão ela tira a mesma foto de novo e falha de novo.
    if (!IMAGENS.has(arquivo.mime) && arquivo.mime !== "application/pdf") {
      throw new TimeError(
        `não sei ler arquivo do tipo ${arquivo.mime || "desconhecido"} — mande foto (JPG ou PNG), PDF ou o XML da nota`,
        415
      );
    }

    // O catálogo aterra o palpite de categoria e área nos valores que existem
    // no banco de verdade. Sem ele a leitura ainda funciona; só não classifica.
    const catalogo = await catalogoDeClassificacao();

    return Response.json({
      lido: await lerComprovante(arquivo.bytes, arquivo.mime, catalogo),
      fonte: "ia"
    });
  } catch (erro) {
    if (erro instanceof ComprovanteIndisponivel) {
      return Response.json({ error: erro.message }, { status: 503 });
    }
    return respostaDeErro(erro);
  }
}
