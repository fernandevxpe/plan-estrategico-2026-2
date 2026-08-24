import "server-only";

import jsQR from "jsqr";
import sharp from "sharp";

/**
 * Decodifica o QR code de uma nota fiscal — de verdade, sem chutar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NÃO ENTRA NO PROMPT DO HAIKU
 * ---------------------------------------------------------------------------
 * `lib/financeiro/ler-comprovante.ts` já lê a chave de 44 dígitos do TEXTO
 * impresso — é OCR, e OCR erra um dígito de vez em quando numa fonte pequena
 * de impressora térmica. Pedir para o mesmo modelo de visão "ler" o QR seria
 * o mesmo tipo de leitura, sujeita ao mesmo erro, só que sobre um alvo pior:
 * um QR é um padrão binário, não texto — não tem por que um modelo de
 * linguagem acertar o bit a mais que separa uma chave válida de uma inválida.
 *
 * Decodificação de QR é determinística: existe algoritmo exato para isso
 * (localizar os três quadrados de âncora, ler os módulos, corrigir erro por
 * Reed-Solomon). `jsqr` faz isso — zero chute, funciona ou não funciona.
 * Por isso a chave que sai daqui, quando sai, é tratada como mais confiável
 * que a lida por OCR: substitui, não só confirma.
 *
 * ---------------------------------------------------------------------------
 * O QUE O QR DE UMA NFC-e REALMENTE CONTÉM
 * ---------------------------------------------------------------------------
 * Uma URL de consulta ao portal da Sefaz do estado, algo como
 * `https://nfce.sefaz.pe.gov.br/nfce/consulta?p=<44 dígitos>|2|1|1|<hash>`.
 * Cada estado usa host e parâmetro diferentes — não existe um formato único
 * nacional. Em vez de mapear 27 formatos, o parser pega os primeiros 44
 * dígitos CONSECUTIVOS que aparecerem em qualquer lugar da URL: é onde a
 * chave mora em todo estado que já foi conferido, e não quebra se um estado
 * novo usar outro nome de parâmetro.
 *
 * O QR NÃO contém os itens nem o valor discriminado — só a chave e o link de
 * consulta. Por isso esta função só devolve `chaveNfe` e a `url`; valor, data,
 * itens etc. continuam vindo exclusivamente da leitura da foto.
 */

export type QrDeNota = {
  /** 44 dígitos, ou null se o QR não decodificou ou não continha uma chave. */
  chaveNfe: string | null;
  /** A URL crua decodificada, para a tela oferecer "conferir na Sefaz". */
  url: string | null;
};

const SEM_QR: QrDeNota = { chaveNfe: null, url: null };

/** Os primeiros 44 dígitos consecutivos da string — onde a chave mora em toda URL de NFC-e já vista. */
function extrairChave(texto: string): string | null {
  const m = texto.match(/\d{44}/);
  return m ? m[0] : null;
}

export async function lerQrCode(bytes: Buffer): Promise<QrDeNota> {
  let pixels: { data: Buffer; info: { width: number; height: number } };
  try {
    // ensureAlpha força 4 canais (RGBA) — o formato que jsqr espera. Sem
    // isto, uma foto sem transparência sairia em 3 canais (RGB) e o decode
    // leria os pixels errados, deslocados, e falharia silenciosamente.
    pixels = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    // Arquivo que o sharp não decodifica como imagem (ex.: PDF, ou bytes
    // corrompidos). Sem QR — a leitura por foto segue sozinha.
    return SEM_QR;
  }

  const { data, info } = pixels;
  let resultado: ReturnType<typeof jsQR>;
  try {
    resultado = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, {
      inversionAttempts: "attemptBoth"
    });
  } catch {
    return SEM_QR;
  }

  if (!resultado?.data) return SEM_QR;

  return {
    chaveNfe: extrairChave(resultado.data),
    url: resultado.data
  };
}
