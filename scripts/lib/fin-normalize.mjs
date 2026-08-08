// Normalização de texto financeiro.
//
// Escrito UMA vez e importado tanto pelos scripts `.mjs` (classificação em lote)
// quanto pela UI em TypeScript (preview de regra ao vivo), através do
// fin-normalize.d.mts ao lado.
//
// Duplicar isso garantiria deriva, e deriva aqui tem consequência concreta: uma
// regra que no preview diz "classificaria 187 cobranças" e no lote classifica
// 184. A pessoa perde a confiança na ferramenta e volta para a planilha.

import { createHash } from 'node:crypto';

/**
 * Prefixos que o Asaas gera sozinho e que não carregam nenhum sinal sobre o que
 * foi vendido.
 *
 * São 1.015 cobranças (R$ 531 mil, 14% da receita) presas nisso. Detectá-las
 * explicitamente permite mandá-las para uma estratégia diferente — histórico da
 * contraparte e agrupamento por valor — em vez de deixá-las falhar contra regras
 * de palavra-chave que nunca vão casar.
 */
const GENERIC_PREFIXES = [
  'cobranca gerada automaticamente a partir de pix recebido',
  'cobranca gerada automaticamente',
  'nota fiscal da fatura'
];

/**
 * O sufixo "Mensagem: ..." de um PIX é digitado por uma pessoa e frequentemente
 * é a única informação útil da descrição inteira ("entrada", "ultima parcela",
 * "referente ao laudo"). Vale a pena separá-lo do ruído em vez de descartar a
 * descrição toda.
 */
const MESSAGE_MARKER = 'mensagem';

/** Remove acentos sem depender de locale. ̀-ͯ é o bloco de diacríticos combinantes. */
function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Forma canônica de uma descrição, para casar regra e detectar duplicata.
 *
 * Minúscula · sem acento · sem pontuação (dígitos preservados, porque
 * "Parcela 3 de 12" precisa deles) · espaços colapsados.
 */
export function normalizeDescription(text) {
  if (!text) return '';
  return stripAccents(String(text))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nome de contraparte em forma canônica, para casar "CONDOMÍNIO DO EDIFÍCIO X"
 * do extrato com "Condominio Edificio X" do cadastro.
 *
 * Remove apenas formas societárias (LTDA, ME, EIRELI, SPE, S/A...), que aparecem
 * inconsistentemente entre as fontes, e conectores sem valor discriminante.
 *
 * Deliberadamente NÃO remove palavras como "serviços" ou "comércio": elas fazem
 * parte do nome e às vezes são o que distingue duas empresas parecidas. Cortar
 * demais aqui gera falso positivo na conciliação, que custa mais caro do que um
 * falso negativo — este vira item na fila, aquele vira dinheiro no lugar errado.
 */
const LEGAL_FORMS = /\b(ltda|me|epp|eireli|sa|s a|mei|spe|cia|ss|slu)\b/g;
const CONNECTORS = /\b(de|da|do|das|dos|e)\b/g;

export function normalizeName(text) {
  if (!text) return '';
  return normalizeDescription(text).replace(LEGAL_FORMS, ' ').replace(CONNECTORS, ' ').replace(/\s+/g, ' ').trim();
}

/** A descrição é texto automático do Asaas, sem sinal sobre o serviço? */
export function isGenericDescription(text) {
  const norm = normalizeDescription(text);
  if (!norm) return true;
  const withoutMessage = norm.split(MESSAGE_MARKER)[0].trim();
  return GENERIC_PREFIXES.some((prefix) => withoutMessage.startsWith(prefix));
}

/**
 * Extrai a parte digitada por uma pessoa de uma descrição gerada pelo Asaas.
 * Devolve string vazia quando não há mensagem.
 */
export function extractHumanMessage(text) {
  if (!text) return '';
  const match = String(text).match(/mensagem:\s*(.+)$/is);
  return match ? match[1].trim() : '';
}

/**
 * Texto que a classificação deve olhar: a mensagem humana quando existe, a
 * descrição inteira caso contrário.
 *
 * É a diferença entre ver "cobranca gerada automaticamente a partir de pix
 * recebido mensagem ultima parcela" e ver "ultima parcela".
 */
export function classifiableText(text) {
  const human = extractHumanMessage(text);
  if (human) return normalizeDescription(human);
  return isGenericDescription(text) ? '' : normalizeDescription(text);
}

/**
 * Chave de idempotência de um lançamento.
 *
 * Quando a fonte dá id estável (id do Asaas, `Identificador` do Nubank, `FITID`
 * do OFX), usa-se ele e acabou — zero heurística. Sem id estável (CSV do Inter),
 * o hash é composto pelos campos que identificam a linha, mais um ordinal.
 *
 * O ordinal existe porque duas linhas idênticas no mesmo dia (dois PIX de R$ 50
 * para o mesmo lugar) são transações diferentes e ambas têm de entrar. Ele é a
 * posição da ocorrência DENTRO do arquivo — o que também é a fraqueza conhecida
 * desta abordagem, tratada com o botão "importar mesmo assim" na tela de
 * conferência.
 *
 * @param {object} input
 * @param {string} input.accountSlug
 * @param {string} [input.sourceId] id estável da fonte, quando houver
 * @param {string} [input.date] 'YYYY-MM-DD'
 * @param {number} [input.amountCents]
 * @param {string} [input.description]
 * @param {number} [input.occurrenceIndex]
 */
export function dedupeHash({ accountSlug, sourceId, date, amountCents, description, occurrenceIndex = 0 }) {
  const basis = sourceId
    ? `${accountSlug}|id:${sourceId}`
    : [accountSlug, date ?? '', String(amountCents ?? ''), normalizeDescription(description), String(occurrenceIndex)].join('|');
  return createHash('sha256').update(basis, 'utf8').digest('hex');
}

/** Converte "1.234,56", "R$ 1.234,56", 1234.56 ou "-1234.56" em centavos inteiros. */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100);

  let text = String(value).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  const negative = text.startsWith('-') || /\(.*\)/.test(text);
  text = text.replace(/[()-]/g, '');

  // Formato brasileiro ("1.234,56") vs internacional ("1,234.56"): decide pelo
  // separador que aparece por último.
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 0;
  const cents = Math.round(parsed * 100);
  return negative ? -cents : cents;
}
