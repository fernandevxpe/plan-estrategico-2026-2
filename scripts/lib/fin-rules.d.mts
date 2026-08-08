// Tipos para scripts/lib/fin-rules.mjs.
//
// Mesmo arranjo do fin-normalize.d.mts ao lado: o avaliador é JavaScript porque
// o pipeline é .mjs, mas o dry-run de regra da UI roda EXATAMENTE o mesmo
// código — é a garantia de que "casaria 187 cobranças" no preview e o lote
// aplicado nunca divergem. Este arquivo só dá nome aos tipos; a semântica mora
// no .mjs.

/** Uma condição do DSL: campo de vocabulário fechado, operador fixo, valor. */
export type RuleCondition = {
  field:
    | "description_norm"
    | "counterparty_name_norm"
    | "counterparty_document"
    | "account_slug"
    | "amount_cents"
    | "amount_abs"
    | "source_kind"
    | "billing_type"
    | "direction"
    | "day_of_month";
  op:
    | "contains_any"
    | "contains_all"
    | "starts_with"
    | "equals"
    | "in"
    | "gte"
    | "lte"
    | "between"
    | "regex";
  value: unknown;
};

export type RuleConditions = {
  all?: RuleCondition[];
  any?: RuleCondition[];
  none?: RuleCondition[];
};

/**
 * O sujeito avaliado: uma linha já normalizada. `scope` decide se regras com
 * match_scope 'transaction'/'document' se aplicam.
 */
export type RuleSubject = {
  scope?: "transaction" | "document";
  description_norm?: string | null;
  counterparty_name_norm?: string | null;
  counterparty_document?: string | null;
  account_slug?: string | null;
  amount_cents?: number | null;
  amount_abs?: number | null;
  source_kind?: string | null;
  billing_type?: string | null;
  direction?: string | null;
  day_of_month?: number | null;
};

/** Evidência de um casamento: qual campo, que trecho, em que posição. */
export type RuleEvidence = {
  ok: boolean;
  field?: string;
  snippet?: string;
  offset?: number;
};

export type RuleLike = {
  id?: number;
  name?: string;
  priority?: number;
  match_scope?: "transaction" | "document" | "both" | string;
  conditions: RuleConditions;
  actions?: Record<string, unknown>;
  confidence?: number;
};

export type ClassifyRationale = {
  regra: string | undefined;
  prioridade: number | undefined;
  campo: string | null;
  trecho: string | null;
  offset: number | null;
  tambem_casaram: { rule_id?: number; priority?: number; name?: string; erro?: string }[];
};

export type ClassifyResult = {
  rule: RuleLike;
  actions: Record<string, unknown> | undefined;
  confidence: number | undefined;
  rationale: ClassifyRationale;
};

/**
 * Avalia um bloco {all,any,none}. LANÇA erro em condição malformada (campo ou
 * operador desconhecido, agulha de texto vazia) — o chamador da UI deve
 * capturar e devolver 422, nunca engolir.
 */
export function evaluateConditions(conditions: RuleConditions, subject: RuleSubject): RuleEvidence;

/**
 * Roda `rules` (já ordenadas por priority ASC, id ASC) e devolve a primeira que
 * casa, com a lista das que também casaram e perderam. `null` quando nada casa.
 */
export function classify(
  rules: RuleLike[],
  subject: RuleSubject,
  options?: {
    collectCompetitors?: boolean;
    onRuleError?: (info: { rule_id?: number; name?: string; erro: string }) => void;
  }
): ClassifyResult | null;
