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
    .array(
      z.object({
        descricao: z.string().describe("O nome do produto como está escrito, sem abreviar."),
        quantidade: z.number().nullable().describe("Quantas unidades. null se não estiver escrito."),
        valorUnitario: z.number().nullable().describe("Preço de UMA unidade, em reais. null se só houver o total.")
      })
    )
    .describe(
      "Cada produto discriminado, com quantidade e preço unitário quando aparecerem. " +
        'Tela de e-commerce escreve "3 un." ou "Qtd: 3" ao lado do nome. Lista vazia se não houver discriminação.'
    ),
  numeroPedido: z
    .string()
    .nullable()
    .describe(
      'Número do pedido ou da compra, quando a tela mostrar. Ex.: "Compra #2000014503310099" ' +
        "vira 2000014503310099. É o que permite achar esta compra de novo na loja. null se não houver."
    ),
  categoriaCode: z
    .string()
    .nullable()
    .describe(
      "O CÓDIGO da linha da DRE que melhor descreve esta compra, escolhido da lista do catálogo " +
        'que vem no prompt (ex.: "5.07"). Use exatamente um código do catálogo, nunca invente. ' +
        "null quando nenhuma linha servir claramente — e null é a resposta certa mais vezes do que parece."
    ),
  areaNome: z
    .string()
    .nullable()
    .describe(
      "O NOME da área que consumiu a compra, escolhido da lista de áreas do prompt " +
        '(ex.: "Comercial"). Use o nome exato da lista. null quando o comprovante não der ' +
        "elemento nenhum para decidir — a área é sobre para quem foi, e o cupom raramente diz."
    ),
  porQue: z
    .string()
    .describe(
      "Uma frase curta dizendo em que você se baseou para sugerir a categoria e a área. " +
        'Ex.: "banner e impressão em gráfica, típico de material de apresentação". ' +
        'Se não sugeriu nenhuma das duas, explique o que faltou. Máximo 120 caracteres.'
    ),
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

/** O catálogo que aterra o palpite: sem ele o modelo inventa nomes de rubrica. */
export type CatalogoDeClassificacao = {
  categorias: { code: string; nome: string }[];
  areas: string[];
};

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
  Quando o ano NÃO aparecer ("12 de agosto"), use a data de hoje, informada abaixo, para
  decidir: normalmente é o ano corrente, e só é o anterior se o mês já passou de hoje —
  ninguém anexa comprovante de uma compra que ainda não aconteceu.
- Cartão: "Mastercard **** 5585" dá bandeira mastercard e final 5585. O logotipo da bandeira
  também conta, mesmo sem o nome escrito.
- "1x R$ 193,83" é uma parcela só — devolva 1, não null. Parcela e total são coisas diferentes:
  em "12x de R$ 16,15" o TOTAL é 12 × 16,15, e é o total que vai em valorTotal.
- Se a imagem estiver borrada ou escura a ponto de você não ter certeza dos números,
  marque legibilidade como "ruim" e volte null nos campos que dependem de leitura precisa.

ITENS: discrimine tudo que a tela listar. "Cabo Hdmi 4k 2 Metros — 3 un." é um item com
quantidade 3. Quando só houver o total e a quantidade, deixe valorUnitario null em vez de
dividir: a divisão erra quando há frete ou desconto embutido.

CLASSIFICAÇÃO (categoriaCode e areaNome)
Estes dois campos são PALPITE, e a tela mostra eles como palpite, ao lado da sua frase de
justificativa. Isso muda o que se espera de você: não é para acertar sempre, é para não
afirmar o que não dá para sustentar.

- Escolha SEMPRE de dentro das listas que vêm abaixo. Um código fora do catálogo é
  descartado pelo servidor, então inventar não ajuda ninguém — só some.
- A categoria sai do QUE FOI COMPRADO. Um almoço com cliente é representação; uma anuidade
  de conselho é taxa.
- MATERIAL, EQUIPAMENTOS E INSUMOS tem QUATRO contas, uma por destino, e escolher entre elas
  é escolher para que serviu — não o que é o objeto:
    Obras        material que entra numa obra ou adequação física.
    Consultoria  material para rodar laudo e inspeção: EPI, instrumento, consumível de campo.
    Comercial    material para VENDER: banner de estande, brinde, cabo comprado para uma
                 apresentação, amostra levada ao cliente.
    Marketing    material para ser encontrado e lembrado: impresso, papelaria, produção
                 gráfica, brinde de campanha.
  Comercial e Marketing se confundem: a régua é quem consome. Se foi para uma reunião ou
  visita a cliente específico, é Comercial; se foi para campanha e público em geral, é
  Marketing. Sem elemento para separar, devolva null e deixe a pessoa escolher.
- Equipamento DURÁVEL — notebook, veículo, bancada, o que serve por anos — é 8.01, não a
  família de material. A família é o que se consome ou se gasta no uso.
- A área sai de PARA QUEM FOI, e quase nunca está escrita no comprovante. Sugira só quando
  o próprio produto denunciar: banner de estande e brinde denunciam Comercial; toner e café
  denunciam Administrativo; cabo de campo e EPI denunciam Operações. Na dúvida, null.
- Nunca deduza área a partir de quem comprou nem do endereço de entrega.
- Em porQue, diga o que na imagem te levou ali. Se você não sugeriu, diga o que faltava.

Preencher errado é pior que não preencher: o campo vazio a pessoa nota e digita; o campo
errado ela aceita sem olhar.`;

/**
 * O catálogo entra no prompt em vez de no schema.
 *
 * Um enum com os 24 códigos travaria a resposta a um valor válido, o que parece
 * melhor — mas as categorias são criadas por quem usa o app, e um enum
 * compilado ficaria velho no dia em que alguém criasse a vigésima quinta.
 * Texto no prompt acompanha o banco, e a validação depois joga fora o que não
 * existir: um código inventado vira null, não vira categoria errada.
 */
/**
 * A DATA DE HOJE PRECISA IR NO PROMPT.
 *
 * Medido no print do Mercado Livre: a tela escreve "12 de agosto" sem ano, e o
 * modelo devolveu 2024-08-12 — a compra é de 2026. Um custo de agosto/2026
 * entraria dois anos atrás, num mês já fechado, e ninguém veria: a data está
 * preenchida e é plausível.
 *
 * O modelo não tem relógio. Sem esta linha ele usa o ano em que foi treinado, o
 * que é o tipo de erro que nunca aparece em teste — porque em teste o ano
 * costuma bater.
 */
function hojeEmTexto(): string {
  const hoje = new Date().toISOString().slice(0, 10);
  return `\n\nHOJE É ${hoje}. Use isto para resolver datas sem ano e para nunca devolver data futura.`;
}

function catalogoEmTexto(catalogo: CatalogoDeClassificacao): string {
  const linhas = catalogo.categorias.map((c) => `  ${c.code}  ${c.nome}`).join("\n");
  return `\n\nCATÁLOGO DE CATEGORIAS (use o código exato):\n${linhas}\n\nÁREAS (use o nome exato):\n  ${catalogo.areas.join("\n  ")}`;
}

/**
 * Uma data que pode mesmo ser deste comprovante.
 *
 * Dezoito meses para trás cobre nota antiga que alguém achou na gaveta; um dia
 * para frente cobre fuso horário. Fora disso é leitura errada, não comprovante
 * velho — e o caso concreto que motivou a trava foi o modelo devolver o ano em
 * que foi treinado quando o print não trazia ano nenhum.
 */
function dataPlausivel(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  const agora = Date.now();
  const DIA = 86_400_000;
  if (t > agora + DIA) return null;
  if (t < agora - 550 * DIA) return null;
  return v;
}

export class ComprovanteIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ComprovanteIndisponivel";
  }
}

export function leituraDeComprovanteDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function lerComprovante(
  bytes: Buffer,
  mime: string,
  catalogo: CatalogoDeClassificacao = { categorias: [], areas: [] }
): Promise<ComprovanteLido> {
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
      // Subiu de 1500 com os itens discriminados: uma nota de supermercado com
      // trinta linhas estourava o teto e voltava JSON cortado, que o parse
      // recusa inteiro — a pessoa perdia a leitura por causa do último item.
      max_tokens: 4000,
      system:
        INSTRUCAO + hojeEmTexto() + (catalogo.categorias.length ? catalogoEmTexto(catalogo) : ""),
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

  // A CLASSIFICAÇÃO SÓ VALE SE EXISTIR NO BANCO.
  //
  // O modelo escolhe de uma lista escrita no prompt, e ainda assim pode
  // devolver "5.14" — um código plausível que não existe. Conferir contra o
  // catálogo aqui é o que separa "sugestão" de "texto que parece uma
  // sugestão": o que não bate vira null e a pessoa escolhe, em vez de a tela
  // exibir uma rubrica inventada com cara de resposta do sistema.
  const codigos = new Set(catalogo.categorias.map((c) => c.code));
  const categoriaCode = lido.categoriaCode && codigos.has(lido.categoriaCode.trim())
    ? lido.categoriaCode.trim()
    : null;

  // Área compara sem acento e sem caixa: "operacoes" e "Operações" são a mesma
  // área, e recusar por causa do acento perderia um palpite certo.
  const chaveArea = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const porArea = new Map(catalogo.areas.map((a) => [chaveArea(a), a]));
  const areaNome = lido.areaNome ? (porArea.get(chaveArea(lido.areaNome)) ?? null) : null;

  return {
    ...lido,
    categoriaCode,
    areaNome,
    // A justificativa é o que torna o palpite conferível. Cortada no tamanho
    // que cabe numa linha do celular — a frase que rola não é lida.
    porQue: (lido.porQue ?? "").trim().slice(0, 120),
    // Item sem nome não é item. Quantidade zero ou negativa é leitura torta, e
    // vale mais deixar a pessoa digitar do que gravar "-1 unidade".
    itens: (lido.itens ?? [])
      .filter((i) => i.descricao?.trim())
      .slice(0, 40)
      .map((i) => ({
        descricao: i.descricao.trim().slice(0, 200),
        quantidade: typeof i.quantidade === "number" && i.quantidade > 0 ? i.quantidade : null,
        valorUnitario: typeof i.valorUnitario === "number" && i.valorUnitario > 0 ? i.valorUnitario : null
      })),
    numeroPedido: (lido.numeroPedido ?? "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 40) || null,
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
    // Data só passa se for uma data de verdade E PLAUSÍVEL.
    //
    // O formato sozinho não bastava: "2024-08-12" é uma data perfeita e estava
    // errada por dois anos. A janela recusa o que não pode ser um comprovante
    // que alguém tem na mão agora — mais de 18 meses atrás, ou no futuro.
    // Fora dela o campo fica vazio e a pessoa digita, que é melhor que um ano
    // errado preenchido com cara de leitura.
    data: dataPlausivel(lido.data)
  };
}
