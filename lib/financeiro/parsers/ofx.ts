import { toCents } from "../../../scripts/lib/fin-normalize.mjs";

import { periodOf, type BankParser, type ParsedRow, type ParseResult } from "./types";

/**
 * OFX 1.x — o formato que Inter e Caixa exportam.
 *
 * É SGML de 1997, não XML: as tags de valor NÃO fecham (`<TRNAMT>-51.50` e
 * ponto), então nenhum parser XML o lê. Um parser de verdade seria uma
 * dependência; um tokenizador tolerante são ~80 linhas: varre `<TAG>valor`,
 * agrupa os blocos <STMTTRN>...</STMTTRN> e ignora o resto da árvore.
 *
 * O que este formato dá de melhor: FITID, a chave de idempotência do PRÓPRIO
 * banco. Com ela, reimportar períodos sobrepostos é seguro por definição.
 * E LEDGERBAL/BALAMT, o saldo declarado que confere a completude do lote.
 */
function ofxDate(value: string): string | null {
  // YYYYMMDD com hora e fuso opcionais: "20240705120000[-03:EST]".
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

export const ofxParser: BankParser = {
  id: "ofx",
  // Padrão Inter (o exportador de OFX mais usado aqui); a tela deixa trocar
  // para caixa-aplicacao / caixa.
  accountSlug: "inter",
  label: "OFX (Inter/Caixa)",

  detect(sample: string): number {
    if (/OFXHEADER/i.test(sample)) return 1;
    if (/<OFX>/i.test(sample) && /<STMTTRN>/i.test(sample)) return 0.9;
    return 0;
  },

  parse(text: string): ParseResult {
    const rows: ParsedRow[] = [];
    const warnings: string[] = [];

    let inTransaction = false;
    let current: Record<string, string> = {};
    // BALAMT aparece em LEDGERBAL (saldo contábil) E em AVAILBAL (disponível);
    // sem rastrear a seção, o parser pegaria o que viesse por último.
    let section = "";
    let declaredBalanceCents: number | null = null;
    let dtStart: string | null = null;
    let dtEnd: string | null = null;
    let rowNumber = 0;

    const flush = () => {
      inTransaction = false;
      rowNumber += 1;
      const record = current;
      current = {};

      const postedOn = record.DTPOSTED ? ofxDate(record.DTPOSTED) : null;
      if (!postedOn) {
        warnings.push(`lançamento ${rowNumber}: DTPOSTED irreconhecível ("${record.DTPOSTED ?? ""}") — pulado`);
        return;
      }
      let amountCents: number;
      try {
        amountCents = toCents(record.TRNAMT);
      } catch {
        warnings.push(`lançamento ${rowNumber}: TRNAMT irreconhecível ("${record.TRNAMT ?? ""}") — pulado`);
        return;
      }
      if (amountCents === 0) {
        warnings.push(`lançamento ${rowNumber}: valor zero — pulado (zero não é lançamento)`);
        return;
      }

      // NAME é o favorecido, MEMO o detalhe; bancos preenchem um, outro ou os
      // dois com o mesmo texto. Junta sem repetir.
      const name = (record.NAME ?? "").trim();
      const memo = (record.MEMO ?? "").trim();
      const descriptionRaw = memo && name && memo !== name ? `${name} — ${memo}` : memo || name || "(sem descrição)";

      rows.push({
        rowNumber,
        postedOn,
        amountCents,
        descriptionRaw,
        sourceId: (record.FITID ?? "").trim() || undefined,
        sourceKind: (record.TRNTYPE ?? "").trim() || undefined
      });
    };

    // O tokenizador: cada `<TAG>` ou `</TAG>` seguido do texto até o próximo `<`.
    for (const match of text.matchAll(/<(\/?)([A-Za-z0-9._]+)>([^<]*)/g)) {
      const closing = match[1] === "/";
      const tag = match[2].toUpperCase();
      const value = match[3].trim();

      if (tag === "STMTTRN") {
        // Um <STMTTRN> abrindo sobre outro aberto = banco que não fecha a tag
        // (tolerado: o bloco anterior é finalizado como está).
        if (inTransaction) flush();
        if (!closing) {
          inTransaction = true;
          current = {};
        }
        continue;
      }

      if (inTransaction) {
        if (!closing && value && current[tag] === undefined) current[tag] = value;
        continue;
      }

      if (closing) {
        if (tag === section) section = "";
        continue;
      }
      if (tag === "LEDGERBAL" || tag === "AVAILBAL") section = tag;
      else if (tag === "BALAMT" && section === "LEDGERBAL") {
        try {
          declaredBalanceCents = toCents(value);
        } catch {
          warnings.push(`LEDGERBAL/BALAMT irreconhecível ("${value}") — sem conferência de saldo`);
        }
      } else if (tag === "DTSTART") dtStart = ofxDate(value);
      else if (tag === "DTEND") dtEnd = ofxDate(value);
    }
    if (inTransaction) flush();

    if (!rows.length && !text.includes("STMTTRN")) {
      throw new Error("arquivo OFX sem bloco de lançamentos (STMTTRN)");
    }

    const fromRows = periodOf(rows);
    return {
      rows,
      warnings,
      periodStart: dtStart ?? fromRows.periodStart,
      periodEnd: dtEnd ?? fromRows.periodEnd,
      declaredBalanceCents
    };
  }
};
