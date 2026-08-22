import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { ComprovanteIndisponivel, leituraDeComprovanteDisponivel } from "@/lib/financeiro/ler-comprovante";

/**
 * Lê a FOTO DO CARTÃO e devolve banco, bandeira, cor e os quatro últimos.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE — E POR QUE NÃO DÁ PARA DEDUZIR DOS 4 DÍGITOS
 * ---------------------------------------------------------------------------
 * O Fernando perguntou se dá para saber banco, cor e bandeira "pelos dados do
 * cartão". Do que a casa guarda, não dá, e vale entender por quê: o que
 * identifica emissor, bandeira e tier é o BIN — os seis a oito dígitos
 * INICIAIS. Os quatro últimos são efetivamente aleatórios; o último nem é
 * dígito de dado, é verificador de Luhn.
 *
 * E os iniciais não são guardados de propósito. Número completo em banco é PAN,
 * com tudo que isso implica de PCI-DSS, e a casa não quer essa
 * responsabilidade por um campo de conveniência.
 *
 * Sobra o caminho honesto: olhar o cartão. A pessoa o tem na mão no momento em
 * que cadastra, e a foto responde as três perguntas de uma vez.
 *
 * ---------------------------------------------------------------------------
 * A IMAGEM É DESCARTADA. ISTO NÃO É DETALHE.
 * ---------------------------------------------------------------------------
 * A foto de um cartão contém o número completo, o nome impresso e a validade.
 * Ela é lida em memória e some quando a requisição termina: não passa por
 * `guardarAnexo`, não entra em `fin_anexo_blob`, não vira `fin_payment_attachment`.
 *
 * O que atravessa são quatro campos que a casa já podia guardar antes de
 * existir foto. Se um dia alguém quiser "guardar a foto para conferir depois",
 * este comentário é a resposta: o que se ganharia em conferência não paga
 * hospedar número de cartão.
 *
 * Por isso o modelo é instruído a NUNCA devolver o número completo. Não é a
 * única defesa — o schema não tem campo para ele —, mas duas travas na mesma
 * porta é o certo quando o custo de errar é esse.
 */

const Cartao = z.object({
  banco: z
    .string()
    .nullable()
    .describe(
      "O emissor impresso no cartão: Nubank, Inter, Itaú, Bradesco, Caixa, Santander, BB, C6, " +
        "Will, PagBank… Como está escrito. null se não der para ler."
    ),
  bandeira: z
    .enum(["visa", "mastercard", "elo", "amex", "hipercard", "outra", "indeterminado"])
    .describe("Pelo logotipo, que costuma estar no canto inferior direito."),
  cor: z
    .enum([
      "preto",
      "branco",
      "cinza",
      "prata",
      "dourado",
      "roxo",
      "azul",
      "verde",
      "vermelho",
      "laranja",
      "rosa",
      "transparente",
      "indeterminado"
    ])
    .describe(
      "A cor DOMINANTE do plástico, como a pessoa descreveria ('o preto', 'o dourado'). " +
        "Ignore o brilho da luz e a sombra da foto. 'indeterminado' quando a foto está " +
        "escura ou recortada demais para ter certeza."
    ),
  final: z
    .string()
    .nullable()
    .describe(
      "APENAS os quatro últimos dígitos do número. Nunca o número inteiro, nunca mais de " +
        "quatro dígitos. null se o número não estiver legível."
    ),
  tipo: z
    .enum(["fisico", "virtual", "indeterminado"])
    .describe(
      "'virtual' quando for print de cartão virtual do app do banco; 'fisico' quando for " +
        "foto de um plástico de verdade."
    ),
  titular: z
    .string()
    .nullable()
    .describe("O nome impresso no cartão, se estiver legível. Ajuda a saber de quem é o plástico."),
  legibilidade: z
    .enum(["boa", "parcial", "ruim"])
    .describe("'ruim' quando a foto está borrada, escura ou muito inclinada.")
});

export type CartaoLido = z.infer<typeof Cartao>;

const INSTRUCAO = `Você olha a foto de um cartão de crédito ou débito brasileiro, ou o print de um
cartão virtual no app do banco, e descreve o PLÁSTICO.

REGRA ACIMA DE TODAS: nunca devolva o número completo do cartão, nem o CVV, nem a validade.
Do número, só os QUATRO ÚLTIMOS dígitos. Se você se pegar transcrevendo mais de quatro
dígitos seguidos, pare — esse dado não é para sair daqui.

- O banco é o nome ou o logotipo impresso. Nubank é roxo com o nome minúsculo; Inter é
  laranja; C6 é preto ou carbono. Se não estiver escrito e o logotipo não for reconhecível,
  volte null em vez de deduzir pela cor: cartão preto existe em todo banco.
- A bandeira é o logotipo, quase sempre no canto inferior direito. Dois círculos
  entrelaçados vermelho e laranja é Mastercard; o pássaro estilizado é Visa; Elo tem o nome
  escrito.
- A cor é a do plástico, não a do fundo da foto nem a da mesa.
- Cartão virtual aparece como um retângulo desenhado dentro da tela do app, com botões em
  volta. Cartão físico tem relevo, brilho e borda real.
- Campo que você não consegue ler volta null ou 'indeterminado'. Preencher errado é pior que
  não preencher: o campo vazio a pessoa nota e digita; o preenchido ela aceita sem olhar — e
  um cartão cadastrado no banco errado nunca casa com a fatura, que é a única coisa que ele
  existe para fazer.`;

const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function lerCartao(bytes: Buffer, mime: string): Promise<CartaoLido> {
  if (!leituraDeComprovanteDisponivel()) {
    throw new ComprovanteIndisponivel("a leitura automática não está configurada neste ambiente");
  }
  if (!MIMES.has(mime)) {
    throw new ComprovanteIndisponivel(`não sei ler ${mime || "este formato"} — mande uma foto JPG ou PNG`);
  }

  const cliente = new Anthropic();
  let resposta;
  try {
    resposta = await cliente.messages.parse({
      model: "claude-haiku-4-5",
      // Sete campos curtos. O teto baixo é economia real e, aqui, também um
      // limite útil: não há resposta longa que faça sentido nesta tarefa.
      max_tokens: 800,
      system: INSTRUCAO,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: bytes.toString("base64")
              }
            },
            { type: "text", text: "Descreva este cartão." }
          ]
        }
      ],
      output_config: { format: zodOutputFormat(Cartao) }
    });
  } catch (erro) {
    if (erro instanceof Anthropic.APIError) {
      if (/credit balance/i.test(String(erro.message ?? ""))) {
        throw new ComprovanteIndisponivel("a leitura automática está sem crédito — avise o admin");
      }
      if (erro instanceof Anthropic.RateLimitError) {
        throw new ComprovanteIndisponivel("muita gente lendo ao mesmo tempo — tente em um minuto");
      }
      throw new ComprovanteIndisponivel(`a leitura do cartão falhou (${erro.status})`);
    }
    throw erro;
  }

  const lido = resposta.parsed_output;
  if (!lido) throw new ComprovanteIndisponivel("não consegui interpretar esta foto");

  // A SEGUNDA TRAVA DO NÚMERO.
  // A instrução pede quatro dígitos; o corte garante. Se vier o número inteiro
  // apesar de tudo, ficam os quatro últimos — que é justamente o que se queria.
  const final = (lido.final ?? "").replace(/\D/g, "");

  return {
    ...lido,
    final: final.length >= 4 ? final.slice(-4) : null,
    // O nome impresso é útil e sensível: serve para saber de quem é o plástico,
    // e não precisa de sobrenome inteiro guardado. Corta no que cabe na tela.
    titular: lido.titular?.trim().slice(0, 60) || null,
    banco: lido.banco?.trim().slice(0, 40) || null
  };
}
