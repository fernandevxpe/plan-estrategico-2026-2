import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Lê um comprovante (foto, print ou PDF) e devolve o que dá para preencher.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAIKU, E QUANTO CUSTA
 * ---------------------------------------------------------------------------
 * O Fernando pediu "a API mais barata possível que atenda". Entre os modelos
 * com visão, Haiku 4.5 é o mais barato: US$ 1,00 por milhão de tokens de
 * entrada e US$ 5,00 de saída.
 *
 * Uma foto de nota já reduzida a 1600px (o app encolhe antes de enviar) custa
 * ~2.500 tokens de entrada; a resposta em JSON, ~200 de saída. Dá cerca de
 * **US$ 0,004 por comprovante** — uns 2 centavos de real. Quinhentas notas por
 * mês ficam abaixo de R$ 12.
 *
 * A tarefa é extração de campo, não raciocínio: um modelo maior leria a mesma
 * nota e cobraria cinco vezes mais pela mesma resposta.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE VALE MAIS QUE A EXTRAÇÃO
 * ---------------------------------------------------------------------------
 * Campo que o modelo não conseguiu ler volta `null`, nunca chutado. Esta base
 * inteira é construída sobre isso — "diante de duas leituras possíveis, não
 * escolha" — e num comprovante o chute é pior que em qualquer outro lugar: um
 * valor errado preenchido automaticamente é um valor que ninguém confere,
 * porque já veio preenchido.
 *
 * O resultado NUNCA é gravado direto. Ele preenche o formulário, a pessoa olha,
 * corrige e envia. A IA aqui digita mais rápido; ela não decide nada.
 */

const Extracao = z.object({
  valorTotal: z
    .number()
    .nullable()
    .describe("Valor total pago, em reais, com centavos. null se não estiver legível."),
  data: z
    .string()
    .nullable()
    .describe("Data da compra ou do pagamento, no formato AAAA-MM-DD. null se não houver."),
  estabelecimento: z
    .string()
    .nullable()
    .describe(
      "A LOJA ou prestador que recebeu o dinheiro, como está escrito. Nunca o endereço de " +
        "entrega nem quem assinou o recebimento. null se não estiver escrito."
    ),
  documento: z
    .string()
    .nullable()
    .describe("CNPJ ou CPF de quem recebeu, só os dígitos. null se não houver."),
  chaveNfe: z
    .string()
    .nullable()
    .describe("Chave de acesso da NF-e: exatamente 44 dígitos. null se não houver."),
  formaPagamento: z
    .enum(["pix", "cartao_credito", "cartao_debito", "boleto", "dinheiro", "indeterminado"])
    .describe("Como foi pago. 'indeterminado' quando o comprovante não diz."),
  cartaoFinal: z
    .string()
    .nullable()
    .describe(
      "Os 4 últimos dígitos do cartão, quando aparecerem. Comprovantes escrevem " +
        '"**** 5585", "final 5585" ou "•••• 5585". Só os dígitos. null se não houver.'
    ),
  cartaoBandeira: z
    .enum(["visa", "mastercard", "elo", "amex", "hipercard", "outra", "indeterminado"])
    .describe("Bandeira do cartão, quando aparecer escrita ou pelo logotipo. 'indeterminado' se não der."),
  parcelas: z
    .number()
    .int()
    .nullable()
    .describe(
      'Em quantas vezes. Comprovantes escrevem "1x R$ 193,83" ou "12x de R$ 16,15". ' +
        "Devolva 1 quando estiver escrito 1x, e null quando não houver parcelamento indicado."
    ),
  itens: z
    .array(z.string())
    .describe("Itens comprados, se estiverem discriminados. Lista vazia quando não estiverem."),
  resumo: z
    .string()
    .describe(
      "Título curto do lançamento: no máximo 8 palavras, sem valor e sem data. " +
        'Ex.: "Cabo flexível 10mm — Dimensional". Não é uma frase explicativa.'
    ),
  legibilidade: z
    .enum(["boa", "parcial", "ruim"])
    .describe("'ruim' quando a imagem está borrada, cortada ou escura demais para confiar.")
});

export type ComprovanteLido = z.infer<typeof Extracao>;

const MIMES_DE_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const INSTRUCAO = `Você lê comprovantes brasileiros: nota fiscal, cupom, print de PIX, fatura de cartão, recibo.

Extraia só o que estiver VISÍVEL. A regra mais importante:

- Campo ilegível, cortado ou ausente volta null. NUNCA infira, complete ou arredonde.
- Valor total é o que foi efetivamente pago. Se houver subtotal, desconto e total, use o TOTAL.
- O estabelecimento é QUEM RECEBEU O DINHEIRO: a loja, o prestador, o posto. NUNCA é o
  endereço de entrega, nem quem assinou o recebimento do pacote, nem quem pagou.
  Em print de PIX, é quem recebeu — não quem enviou.
  Em tela de e-commerce (Mercado Livre, Amazon, Shopee), o estabelecimento é a PLATAFORMA
  ou o vendedor. Se nenhum dos dois estiver escrito, volte null — endereço não é loja.
- Chave de NF-e tem exatamente 44 dígitos. Se contar diferente disso, volte null.
- Data no formato AAAA-MM-DD. Comprovante brasileiro escreve DD/MM/AAAA: converta.
  Quando o ano não aparecer ("12 de agosto"), use o ano corrente.
- Cartão: "Mastercard **** 5585" dá bandeira mastercard e final 5585. O logotipo da bandeira
  também conta, mesmo sem o nome escrito.
- "1x R$ 193,83" é uma parcela só — devolva 1, não null. Parcela e total são coisas diferentes:
  em "12x de R$ 16,15" o TOTAL é 12 × 16,15, e é o total que vai em valorTotal.
- Se a imagem estiver borrada ou escura a ponto de você não ter certeza dos números,
  marque legibilidade como "ruim" e volte null nos campos que dependem de leitura precisa.

Preencher errado é pior que não preencher: o campo vazio a pessoa nota e digita; o campo
errado ela aceita sem olhar.`;

export class ComprovanteIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ComprovanteIndisponivel";
  }
}

export function leituraDeComprovanteDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function lerComprovante(bytes: Buffer, mime: string): Promise<ComprovanteLido> {
  if (!leituraDeComprovanteDisponivel()) {
    throw new ComprovanteIndisponivel("a leitura automática não está configurada neste ambiente");
  }

  const cliente = new Anthropic();
  const base64 = bytes.toString("base64");

  // PDF e imagem entram por blocos diferentes, e mandar um como o outro é 400.
  const anexo: Anthropic.ContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: (MIMES_DE_IMAGEM.has(mime) ? mime : "image/jpeg") as
              | "image/jpeg"
              | "image/png"
              | "image/webp"
              | "image/gif",
            data: base64
          }
        };

  let resposta;
  try {
    resposta = await cliente.messages.parse({
      model: "claude-haiku-4-5",
      // Extração de campo: a resposta são poucas centenas de tokens. Teto baixo
      // aqui é economia real, não mesquinharia — é o parâmetro que multiplica.
      max_tokens: 1500,
      system: INSTRUCAO,
      messages: [{ role: "user", content: [anexo, { type: "text", text: "Extraia os campos deste comprovante." }] }],
      output_config: { format: zodOutputFormat(Extracao) }
    });
  } catch (erro) {
    // A CAUSA PRECISA CHEGAR NA TELA CERTA.
    // "não consegui ler" e "a conta está sem crédito" mandam a pessoa fazer
    // coisas opostas: a primeira, tirar outra foto; a segunda, avisar o admin.
    // Foi o mesmo erro que a tela cometia dizendo "migration não aplicada"
    // quando o banco só tinha piscado.
    if (erro instanceof Anthropic.APIError) {
      const texto = String(erro.message ?? "");
      if (/credit balance/i.test(texto)) {
        throw new ComprovanteIndisponivel(
          "a leitura automática está sem crédito na conta da API — avise o admin. Preencha à mão por enquanto."
        );
      }
      if (erro instanceof Anthropic.AuthenticationError) {
        throw new ComprovanteIndisponivel("a chave da leitura automática não está válida — avise o admin");
      }
      if (erro instanceof Anthropic.RateLimitError) {
        throw new ComprovanteIndisponivel("muita gente lendo comprovante ao mesmo tempo — tente em um minuto");
      }
      throw new ComprovanteIndisponivel(`a leitura automática falhou (${erro.status})`);
    }
    throw erro;
  }

  const lido = resposta.parsed_output;
  if (!lido) {
    throw new ComprovanteIndisponivel("não consegui interpretar este arquivo");
  }

  // NORMALIZA NO SERVIDOR, em vez de confiar na instrução.
  // Medido: mesmo pedindo "só os dígitos", o modelo devolve o CNPJ formatado
  // ("11.222.333/0001-44"). Regra de formato é coisa de código — pedir ao
  // modelo e torcer é o tipo de acordo que falha silenciosamente na centésima
  // nota, quando ninguém está mais olhando.
  const digitos = (v: string | null) => {
    const d = (v ?? "").replace(/\D/g, "");
    return d.length === 11 || d.length === 14 ? d : null;
  };
  const chave = (lido.chaveNfe ?? "").replace(/\D/g, "");

  const finalCartao = (lido.cartaoFinal ?? "").replace(/\D/g, "").slice(-4);

  return {
    ...lido,
    // Quatro dígitos ou nada. Três é leitura parcial, e um final errado é pior
    // que nenhum: ele casaria com o cartão de outra pessoa.
    cartaoFinal: finalCartao.length === 4 ? finalCartao : null,
    // Parcela 1 é à vista, e a base guarda isso como NULL — a conversão mora
    // aqui para a tela não precisar conhecer a regra do banco.
    parcelas: lido.parcelas && lido.parcelas >= 2 && lido.parcelas <= 48 ? lido.parcelas : null,
    documento: digitos(lido.documento),
    // 44 dígitos ou nada: chave truncada é pior que chave ausente, porque
    // parece preenchida.
    chaveNfe: chave.length === 44 ? chave : null,
    // O título do envio tem teto de 200; e um título longo demais some no
    // celular. Corta aqui em vez de deixar a tela cortar no meio da palavra.
    resumo: lido.resumo.trim().slice(0, 90),
    // Data só passa se for uma data de verdade — o modelo pode devolver
    // "2026-13-45" e o formulário aceitaria como texto.
    data: /^\d{4}-\d{2}-\d{2}$/.test(lido.data ?? "") && !Number.isNaN(Date.parse(lido.data!))
      ? lido.data
      : null
  };
}
