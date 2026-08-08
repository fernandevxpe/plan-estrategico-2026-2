// Avaliador do DSL de regras de classificação.
//
// Vocabulário FECHADO: um conjunto fixo de campos e operadores, avaliado por
// este arquivo. Nunca `eval`, nunca SQL montado, nunca expressão livre. Três
// consequências que justificam a restrição:
//
//   · é auditável — dá para dizer exatamente por que uma linha caiu onde caiu;
//   · é editável pela tela sem deploy, que é a condição para a planilha não
//     voltar;
//   · o MESMO avaliador roda no dry-run ("esta regra classificaria mais 187
//     cobranças, R$ 94.300"), então o preview não pode divergir do lote.
//
// O retorno carrega o trecho que casou e o deslocamento, porque é isso que
// permite à tela destacar a palavra dentro da descrição original no popover
// "por quê?". É essa interação que faz alguém confiar no número.

/** Campos que uma condição pode inspecionar. */
const FIELDS = new Set([
  'description_norm',
  'counterparty_name_norm',
  'counterparty_document',
  'account_slug',
  'amount_cents',
  'amount_abs',
  'source_kind',
  'billing_type',
  'direction',
  'day_of_month'
]);

const OPS = {
  contains_any: (value, expected) => {
    const text = String(value ?? '');
    for (const needle of expected) {
      const offset = text.indexOf(needle);
      if (offset !== -1) return { ok: true, snippet: needle, offset };
    }
    return { ok: false };
  },
  contains_all: (value, expected) => {
    const text = String(value ?? '');
    const missing = expected.find((needle) => !text.includes(needle));
    if (missing) return { ok: false };
    return { ok: true, snippet: expected.join(' + '), offset: text.indexOf(expected[0]) };
  },
  starts_with: (value, expected) => {
    const text = String(value ?? '');
    const hit = (Array.isArray(expected) ? expected : [expected]).find((p) => text.startsWith(p));
    return hit ? { ok: true, snippet: hit, offset: 0 } : { ok: false };
  },
  equals: (value, expected) => ({ ok: String(value ?? '') === String(expected), snippet: String(expected) }),
  in: (value, expected) => {
    const list = (Array.isArray(expected) ? expected : [expected]).map(String);
    const hit = list.includes(String(value ?? ''));
    return hit ? { ok: true, snippet: String(value) } : { ok: false };
  },
  gte: (value, expected) => ({ ok: Number(value) >= Number(expected) }),
  lte: (value, expected) => ({ ok: Number(value) <= Number(expected) }),
  between: (value, expected) => ({ ok: Number(value) >= Number(expected[0]) && Number(value) <= Number(expected[1]) }),
  // Regex é o escape hatch. Fica limitado a `i` para não permitir flags que
  // mudem a semântica, e o autor assume o risco de catastrophic backtracking.
  regex: (value, expected) => {
    const match = new RegExp(expected, 'i').exec(String(value ?? ''));
    return match ? { ok: true, snippet: match[0], offset: match.index } : { ok: false };
  }
};

function evaluateCondition(condition, subject) {
  if (!FIELDS.has(condition.field)) {
    throw new Error(`campo desconhecido na regra: ${condition.field}`);
  }
  const op = OPS[condition.op];
  if (!op) throw new Error(`operador desconhecido na regra: ${condition.op}`);
  return op(subject[condition.field], condition.value);
}

/**
 * Avalia um bloco `{all,any,none}` contra um sujeito já normalizado.
 *
 * @returns {{ ok: boolean, field?: string, snippet?: string, offset?: number }}
 */
export function evaluateConditions(conditions, subject) {
  let evidence = null;

  for (const condition of conditions.all ?? []) {
    const result = evaluateCondition(condition, subject);
    if (!result.ok) return { ok: false };
    if (!evidence && result.snippet) evidence = { field: condition.field, snippet: result.snippet, offset: result.offset };
  }

  if (conditions.any?.length) {
    let anyOk = false;
    for (const condition of conditions.any) {
      const result = evaluateCondition(condition, subject);
      if (result.ok) {
        anyOk = true;
        if (!evidence && result.snippet) evidence = { field: condition.field, snippet: result.snippet, offset: result.offset };
        break;
      }
    }
    if (!anyOk) return { ok: false };
  }

  for (const condition of conditions.none ?? []) {
    if (evaluateCondition(condition, subject).ok) return { ok: false };
  }

  // Um bloco vazio não casa com tudo — casaria com o mundo inteiro na
  // prioridade em que estivesse.
  if (!conditions.all?.length && !conditions.any?.length) return { ok: false };

  return { ok: true, ...(evidence ?? {}) };
}

/**
 * Roda as regras em ordem de prioridade e devolve a primeira que casa, junto com
 * as que também casaram e perderam.
 *
 * As perdedoras não são curiosidade: são o que a tela mostra em "outras regras
 * que também casaram", e é assim que se descobre que duas regras disputam o
 * mesmo texto antes de o número sair errado num relatório.
 *
 * @param {Array} rules ordenadas por priority ASC, id ASC
 * @param {object} subject
 * @param {{ collectCompetitors?: boolean }} [options]
 */
export function classify(rules, subject, { collectCompetitors = true } = {}) {
  let winner = null;
  const competitors = [];

  for (const rule of rules) {
    if (rule.match_scope && rule.match_scope !== 'both' && rule.match_scope !== subject.scope) continue;

    let result;
    try {
      result = evaluateConditions(rule.conditions, subject);
    } catch (error) {
      // Regra malformada não pode derrubar a classificação das outras 3 mil
      // linhas. Ela some do lote e o erro aparece no relatório.
      competitors.push({ rule_id: rule.id, priority: rule.priority, erro: error.message });
      continue;
    }
    if (!result.ok) continue;

    if (!winner) {
      winner = { rule, evidence: result };
      if (!collectCompetitors) break;
    } else {
      competitors.push({ rule_id: rule.id, priority: rule.priority, name: rule.name });
    }
  }

  if (!winner) return null;

  return {
    rule: winner.rule,
    actions: winner.rule.actions,
    confidence: winner.rule.confidence,
    rationale: {
      regra: winner.rule.name,
      prioridade: winner.rule.priority,
      campo: winner.evidence.field ?? null,
      trecho: winner.evidence.snippet ?? null,
      offset: winner.evidence.offset ?? null,
      tambem_casaram: competitors.slice(0, 5)
    }
  };
}
