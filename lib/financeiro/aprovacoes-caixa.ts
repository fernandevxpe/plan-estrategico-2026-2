/**
 * Conta do caixa de HOJE contra o saldo do Inter — só aritmética.
 *
 * Mora fora de `aprovacoes.ts` de propósito: aquele arquivo é `server-only`, e
 * a tela precisa desta conta no clique, sem ir ao servidor. Nada aqui lê banco
 * nem chama o Inter; o número que entra é o que a tela já tem.
 */

export type SaldoInter = {
  disponivelCents: number | null;
  bloqueadoCents: number;
  em: string | null;
  fonte: "inter" | "ledger" | null;
  lastroAte: string | null;
  ressalva: string | null;
};

export type SaldoConta = {
  disponivelCents: number | null;
  lastroAte: string | null;
  fonte: "asaas" | "ledger" | null;
  ressalva: string | null;
};

export type TipoOrdem =
  | "reembolso"
  | "recorrente"
  | "documento"
  | "fatura"
  | "compra"
  | "time"
  | "importacao"
  | "manual";

export const ROTULO_TIPO: Record<TipoOrdem, string> = {
  reembolso: "Reembolso",
  recorrente: "Recorrente",
  documento: "Documento",
  fatura: "Fatura",
  compra: "Compra",
  time: "App do time",
  importacao: "Importação",
  manual: "Manual"
};

export type CoberturaDoDia = {
  /** O que o Inter diz que tem (ou o ledger, se o ao vivo falhou). */
  saldoCents: number;
  /** Soma das ordens com data de hoje — as que podem sair nesta aprovação. */
  hojeCents: number;
  faltaCents: number;
  sobraCents: number;
  cabe: boolean;
};

/**
 * Data que decide "sai hoje": a programada, e só ela.
 *
 * `due_date` é o vencimento da obrigação, não o dia em que o Inter debita.
 * Colapsar as duas faria uma ordem marcada para amanhã parecer de hoje — e o
 * aviso de caixa dispararia cedo demais. Sem data programada, a ordem ainda
 * não tem dia: não entra na conta de hoje.
 */
export function ordemEhHoje(scheduledFor: string | null, hoje: string): boolean {
  return Boolean(hoje) && scheduledFor === hoje;
}

/**
 * Quanto falta no Inter para cobrir o que vence hoje.
 *
 * `saldoCents === null` devolve null: sem número do banco, qualquer "falta
 * R$ X" seria chute. A tela some o aviso, não inventa o buraco.
 */
export function coberturaDoDia(
  saldoCents: number | null,
  hojeCents: number
): CoberturaDoDia | null {
  if (saldoCents === null || !Number.isFinite(saldoCents)) return null;
  const falta = Math.max(0, hojeCents - saldoCents);
  return {
    saldoCents,
    hojeCents,
    faltaCents: falta,
    sobraCents: Math.max(0, saldoCents - hojeCents),
    cabe: falta === 0
  };
}
