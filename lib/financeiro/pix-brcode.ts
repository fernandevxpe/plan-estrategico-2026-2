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
export function gerarPixBrcode(dados: PixEstatico): string {
  const chave = dados.chave.replace(/\D/g, "").length >= 11 ? dados.chave.replace(/\D/g, "") : dados.chave.trim();
  const nome = dados.nomeRecebedor.slice(0, 25).toUpperCase();
  const cidade = dados.cidade.slice(0, 15).toUpperCase();
  const txid = (dados.txid ?? "***").slice(0, 25);

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
