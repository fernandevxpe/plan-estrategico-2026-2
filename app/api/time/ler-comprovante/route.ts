import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { ComprovanteIndisponivel, lerComprovante, leituraDeComprovanteDisponivel } from "@/lib/financeiro/ler-comprovante";
import { XmlNaoEhNota, lerNotaXml, pareceXml } from "@/lib/financeiro/ler-nfe-xml";
import { lerQrCode } from "@/lib/financeiro/ler-qrcode";
import { TimeError, buscarPadraoCategoriaFornecedor, catalogoDeClassificacao } from "@/lib/financeiro/time";

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

    // ---------------------------------------------------------------------
    // QR CODE: decodificado de verdade, em paralelo com o Haiku.
    // ---------------------------------------------------------------------
    // Só imagem tem QR — PDF de nota não traz o código impresso como pixel
    // fotografável, e `lerQrCode` devolve vazio sozinho se o sharp não
    // conseguir decodificar (sem lançar, sem atrasar o resto). A chave que
    // sai daqui é DECODIFICADA, não lida: substitui a do OCR quando existe,
    // porque é a fonte mais confiável das duas — ver o comentário em
    // `ler-qrcode.ts`.
    const [lido, qr] = await Promise.all([
      lerComprovante(arquivo.bytes, arquivo.mime, catalogo),
      IMAGENS.has(arquivo.mime) ? lerQrCode(arquivo.bytes) : Promise.resolve(null)
    ]);

    const chaveDoQr = qr?.chaveNfe ?? null;

    // -----------------------------------------------------------------------
    // APRENDIZADO: o que a equipe já escolheu para fornecedor parecido.
    // -----------------------------------------------------------------------
    // Busca por PROXIMIDADE (pg_trgm), não igualdade — "Auto Posto Petrobras"
    // e "AUTOPOSTO PETROBRAS FILIAL 2" são o mesmo fornecedor. `similaridade
    // > 0.35` é o corte de confiança: nome pouco parecido é coincidência de
    // letras comuns, não o mesmo estabelecimento. Uma única confirmação
    // passada NÃO fica de fora — é um fato contado (a pessoa escolheu isto
    // uma vez), só que fraco; quem decide se é fraco demais é a TELA, com o
    // mesmo "mas nem sempre" que já usa para o histórico por CNPJ, não este
    // endpoint escondendo o dado.
    //
    // Isto vai na resposta como `aprendizado`, NUNCA dentro de `lido` — antes
    // ia para `lido.categoriaCode`/`lido.porQue`, os mesmos campos do palpite
    // da FOTO, e a tela que exibe esses campos sempre escreve "Li da imagem…
    // Confira, é chute, não histórico". Um fato virava chute na tela por
    // compartilhar o campo errado — o card certo já existe (o que mostra
    // "você já classificou X assim N vezes" para o CNPJ) e é para lá que isto
    // deve ir, não para o palpite.
    let padrao: Awaited<ReturnType<typeof buscarPadraoCategoriaFornecedor>>[number] | null = null;
    if (lido.estabelecimento) {
      const achados = await buscarPadraoCategoriaFornecedor(lido.estabelecimento).catch(() => []);
      const melhor = achados[0];
      if (melhor && melhor.similaridade > 0.35) padrao = melhor;
    }

    return Response.json({
      lido: chaveDoQr ? { ...lido, chaveNfe: chaveDoQr } : lido,
      fonte: "ia",
      // A tela usa isto para mostrar "chave conferida pelo QR" em vez de só
      // "lida" — a diferença de confiança entre as duas fontes é real e a
      // pessoa que vai conferir o reembolso merece saber qual foi usada.
      qr: chaveDoQr ? { chaveConferida: true, url: qr!.url } : null,
      aprendizado: padrao
        ? {
            vezes: padrao.vezes,
            fornecedorParecido: padrao.fornecedorParecido,
            categoriaCode: padrao.categoriaCode,
            categoriaNome: padrao.categoriaNome
          }
        : null
    });
  } catch (erro) {
    if (erro instanceof ComprovanteIndisponivel) {
      return Response.json({ error: erro.message }, { status: 503 });
    }
    return respostaDeErro(erro);
  }
}
