/**
 * Contrato dos parsers de extrato bancário.
 *
 * Cada banco exporta num formato diferente (CSV com vírgula, CSV com ponto e
 * vírgula em windows-1252, OFX SGML dos anos 90) — mas o resto do módulo só
 * conhece ESTA forma. Adicionar um banco novo é escrever um parser e registrá-lo
 * em detect.ts; nenhuma rota ou tela muda.
 */

export type ParsedRow = {
  /** Posição no arquivo (1-based), para mensagens de erro apontarem a linha. */
  rowNumber: number;
  /** Dia-calendário do movimento, 'YYYY-MM-DD'. Nunca timestamp: extrato não tem fuso. */
  postedOn: string;
  /** Assinado: positivo entra, negativo sai. */
  amountCents: number;
  descriptionRaw: string;
  /**
   * Id estável da fonte quando o banco dá um (Identificador do Nubank, FITID do
   * OFX). É a chave de idempotência CORRETA; o hash por chave natural é só o
   * fallback para CSV sem id.
   */
  sourceId?: string;
  /** Saldo após o lançamento, quando o extrato traz a coluna. */
  balanceAfterCents?: number;
  /** Tipo cru da fonte (TRNTYPE do OFX). Nunca interpretado aqui. */
  sourceKind?: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** Linhas puladas ou estranhezas — vão para a tela de conferência, não para um log. */
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
  /**
   * Saldo final DECLARADO pelo banco (LEDGERBAL do OFX, coluna Saldo do Inter).
   * É a conferência que pega linha faltando antes de o dado envenenar o ledger.
   */
  declaredBalanceCents?: number | null;
};

export type BankParser = {
  /** Vira fin_import_batch.adapter — 'nubank_csv' | 'inter_csv' | 'ofx'. */
  id: string;
  /** Conta padrão (slug em fin_account); a tela de conferência deixa trocar. */
  accountSlug: string;
  /** Nome exibido: "Nubank (CSV)". */
  label: string;
  /** 0..1 — quão certo o parser está de que o arquivo é dele. */
  detect(sample: string): number;
  /** Lança em arquivo malformado; linha individual ruim vira warning. */
  parse(text: string): ParseResult;
};

/** 'DD/MM/YYYY' → 'YYYY-MM-DD'. Devolve null quando o texto não é data. */
export function brDateToIso(text: string): string | null {
  const match = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/** Menor e maior data de um conjunto de linhas — o período real do extrato. */
export function periodOf(rows: ParsedRow[]): { periodStart: string | null; periodEnd: string | null } {
  if (!rows.length) return { periodStart: null, periodEnd: null };
  let min = rows[0].postedOn;
  let max = rows[0].postedOn;
  for (const row of rows) {
    if (row.postedOn < min) min = row.postedOn;
    if (row.postedOn > max) max = row.postedOn;
  }
  return { periodStart: min, periodEnd: max };
}
