// Parsers de tipo do driver `pg`, compartilhados entre os scripts e a aplicação.
//
// POR QUE ISTO É UM ARQUIVO SEPARADO: lib/financeiro/db.ts registra estes mesmos
// parsers para o processo do Next. Se os scripts `.mjs` não registrarem também,
// a MESMA consulta devolve 1184000 num lado e "1184000" no outro — e os scripts
// de teste, que afirmam números em vez de mocar, comparariam número com string e
// falhariam de um jeito que parece erro de cálculo.
//
// Registrar em dois lugares com listas diferentes é a mesma classe de problema
// que a normalização duplicada: converge no começo e diverge sem avisar.

import pg from 'pg';

const { types } = pg;

let registered = false;

/**
 * Idempotente — pode ser chamado por vários módulos no mesmo processo.
 */
export function registerFinanceTypeParsers() {
  if (registered) return;
  registered = true;

  // bigint (OID 20). Dinheiro vive em centavos inteiros; o driver devolve string
  // para não perder precisão, e "12345" + "678" numa soma vira "12345678" sem
  // erro nenhum. Number é exato até 2^53 centavos ≈ R$ 90 trilhões.
  types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

  // numeric (OID 1700). Menos óbvio e mais importante do que parece:
  // SUM(bigint) devolve NUMERIC, não bigint. Sem este parser, toda soma de
  // dinheiro volta como string.
  types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

  // date (OID 1082) → string 'YYYY-MM-DD', não Date.
  //
  // Sem isto o driver constrói um Date à meia-noite UTC e, lido em BRT, uma
  // competência de '2026-08-01' vira 31/07 às 21h — o lançamento migra de mês
  // sozinho. Data pura não tem fuso; tratar como texto é o que preserva isso.
  types.setTypeParser(1082, (value) => value);
}
