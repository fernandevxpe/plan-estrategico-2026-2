// Tipos para scripts/lib/fin-normalize.mjs.
//
// O módulo é JavaScript porque os scripts do pipeline são .mjs, mas a UI precisa
// exatamente da mesma normalização para o preview de regra bater com o lote.
// Este arquivo é o que permite importá-lo do lado TypeScript sem duplicar código.

export function normalizeDescription(text: string | null | undefined): string;
export function normalizeName(text: string | null | undefined): string;
export function isGenericDescription(text: string | null | undefined): boolean;
export function extractHumanMessage(text: string | null | undefined): string;
export function classifiableText(text: string | null | undefined): string;

export function dedupeHash(input: {
  accountSlug: string;
  sourceId?: string | null;
  date?: string | null;
  amountCents?: number | null;
  description?: string | null;
  occurrenceIndex?: number;
}): string;

/**
 * Converte texto/número monetário em centavos inteiros. Vazio/null → 0.
 * LANÇA em entrada irreconhecível — quem importa extrato deve tratar o erro
 * por linha em vez de deixar um 0 silencioso entrar no ledger.
 */
export function toCents(value: string | number | null | undefined): number;
