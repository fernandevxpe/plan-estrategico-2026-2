/**
 * PIX copia-e-cola estático (BR Code / EMV). CNPJ da empresa no Inter — sem
 * dependência externa; o QR é o mesmo payload renderizado graficamente.
 */

function tlv(id: string, valor: string): string {
  const v = valor.trim();
  return `${id}${String(v.length).padStart(2, "0")}${v}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export type PixEstatico = {
  chave: string;
  tipoChave: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";
  nomeRecebedor: string;
  cidade: string;
  valorReais?: number;
  txid?: string;
};

/** Gera payload PIX copia-e-cola com valor fixo (quando informado). */
/**
 * ASCII sem acento, como o EMV exige — e por um motivo que não é estético.
 *
 * O TLV declara o comprimento em `String(v.length)`, que conta CARACTERES.
 * O payload trafega em UTF-8, onde "Ç" ocupa dois bytes. "XPE CONSULTORIA E
 * SERVIÇO" tem 25 caracteres e 26 bytes: o campo diz 25, um leitor que conta
 * bytes para no meio da última letra, e TODOS os campos seguintes desalinham —
 * inclusive o CRC. O QR simplesmente não lê.
 *
 * Hoje a razão social da casa é ASCII pura, então nada quebrou. Bastava alguém
 * escrever "MEDIÇÃO" no cadastro para o PIX parar de funcionar sem nenhum erro
 * no caminho.
 */
function somenteAscii(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A chave, normalizada PELO TIPO que o chamador informou.
 *
 * Antes decidia contando dígitos: se houvesse 11 ou mais, tirava tudo que não
 * fosse número. Duas das cinco formas de chave morriam nisso —
 * `123e4567-e89b-12d3-a456-426614174000` (aleatória) virava
 * `123456789123456426614174000`, e `+5581999998888` perdia o `+`, sem o qual
 * a chave de telefone não existe. Como só CNPJ era usado, nunca apareceu.
 *
 * `tipoChave` estava no tipo e não era lido em lugar nenhum — o campo
 * anunciava uma intenção que o código ignorava.
 */
function normalizarChave(chave: string, tipo: PixEstatico["tipoChave"]): string {
  const bruta = chave.trim();
  switch (tipo) {
    case "CPF":
    case "CNPJ":
      return bruta.replace(/\D/g, "");
    case "PHONE": {
      const d = bruta.replace(/\D/g, "");
      // O padrão do BCB é E.164 com o "+": +5581999998888.
      return d.startsWith("55") ? `+${d}` : `+55${d}`;
    }
    case "EMAIL":
    case "EVP":
    default:
      // Chave aleatória e e-mail vão como estão. Mexer nelas é destruí-las.
      return bruta;
  }
}

export function gerarPixBrcode(dados: PixEstatico): string {
  const chave = normalizarChave(dados.chave, dados.tipoChave);
  const nome = somenteAscii(dados.nomeRecebedor).slice(0, 25).toUpperCase();
  const cidade = somenteAscii(dados.cidade).slice(0, 15).toUpperCase();
  // TXID é [A-Za-z0-9] no layout; "***" é o coringa para "sem identificador".
  // Hífen ou acento aqui faz PSP recusar a leitura.
  const txidLimpo = (dados.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  const txid = txidLimpo || "***";

  const merchantAccount = tlv("00", "br.gov.bcb.pix") + tlv("01", chave);
  const additional = tlv("05", txid);

  let payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (dados.valorReais !== undefined && dados.valorReais > 0
      ? tlv("54", dados.valorReais.toFixed(2))
      : "") +
    tlv("58", "BR") +
    tlv("59", nome) +
    tlv("60", cidade) +
    tlv("62", additional);

  payload += "6304";
  return payload + crc16(payload);
}

export function formatarCnpjPix(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
