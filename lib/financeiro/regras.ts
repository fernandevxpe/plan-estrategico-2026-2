import "server-only";

import { evaluateConditions, type RuleConditions, type RuleSubject } from "@/scripts/lib/fin-rules.mjs";

/**
 * Apoio às rotas de regra (/api/financeiro/regras{,/preview,/aplicar}).
 *
 * Vive fora das rotas por dois motivos: um route.ts do Next só pode exportar
 * handlers HTTP, e o sujeito-de-documento tem de ser construído IGUAL no
 * preview e no aplicar — montado em dois lugares, um dia o preview diria
 * "casaria 187" e o lote aplicaria 184, que é exatamente a deriva que faz a
 * pessoa voltar para a planilha.
 */

/**
 * Sujeito sintético que exercita TODAS as validações do avaliador (agulha
 * vazia, campo desconhecido, regex inválida) sem tocar o banco. Os erros do
 * avaliador dependem só da FORMA das condições, nunca do valor do sujeito —
 * então uma avaliação de mentira é um validador de verdade.
 */
const SUJEITO_DE_PROVA: RuleSubject = {
  scope: "document",
  description_norm: "",
  counterparty_name_norm: "",
  counterparty_document: "",
  account_slug: "",
  amount_cents: 0,
  amount_abs: 0,
  source_kind: "",
  billing_type: "",
  direction: "receber",
  day_of_month: 1
};

/** Devolve a mensagem do problema, ou null quando as condições são válidas. */
export function validarCondicoes(conditions: unknown): string | null {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
    return "conditions deve ser um objeto {all,any,none}";
  }
  const cond = conditions as RuleConditions;
  if (!cond.all?.length && !cond.any?.length) {
    // O avaliador trata bloco vazio como "não casa nada" de propósito; uma
    // regra assim salva seria lixo silencioso na tabela.
    return "conditions precisa de ao menos uma condição em all ou any";
  }
  try {
    evaluateConditions(cond, SUJEITO_DE_PROVA);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A mesma receita de slug da migração 0009: minúscula, sem acento, traços. */
export function slugDoNome(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A linha de fin_document como o preview e o aplicar a leem. */
export type DocParaRegra = {
  id: number;
  description_norm: string;
  direction: string;
  billing_type: string | null;
  amount_cents: number;
  day_of_month: number | null;
  category_id: number | null;
};

/** SELECT compartilhado — o preview varre TODOS; o aplicar filtra depois. */
export const SQL_DOCS_PARA_REGRA = `
  SELECT d.id, d.description_norm, d.direction, d.billing_type, d.amount_cents,
         EXTRACT(DAY FROM d.due_date)::int AS day_of_month, d.category_id
    FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
   WHERE e.slug = $1`;

/** Um documento → sujeito do avaliador. Único lugar que faz essa tradução. */
export function sujeitoDeDocumento(doc: DocParaRegra): RuleSubject {
  return {
    scope: "document",
    description_norm: doc.description_norm,
    direction: doc.direction,
    billing_type: doc.billing_type,
    amount_cents: doc.amount_cents,
    amount_abs: Math.abs(doc.amount_cents),
    day_of_month: doc.day_of_month
  };
}
