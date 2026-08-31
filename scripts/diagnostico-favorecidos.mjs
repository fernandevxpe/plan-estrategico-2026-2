// Quantos favorecidos têm coordenada PIX cadastrada, e quanto do mês depende
// disso. Só leitura — nenhuma escrita, nenhuma chave impressa.
//
//   node scripts/diagnostico-favorecidos.mjs [YYYY-MM]
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const mes = process.argv[2] ?? new Date().toISOString().slice(0, 7);
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });

const linha = (r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  ');

const contas = await pool.query(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE is_active)::int AS ativas,
          count(*) FILTER (WHERE is_default AND is_active)::int AS padrao,
          count(*) FILTER (WHERE operation_type = 'PIX' AND nullif(btrim(coalesce(pix_address_key,'')),'') IS NOT NULL)::int AS com_chave_pix
     FROM fin_payee_account`
);
console.log('\nfin_payee_account (coordenada bancária do favorecido)');
console.log('  ' + linha(contas.rows[0]));

const pessoas = await pool.query(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE metodo = 'pix')::int AS por_pix,
          count(*) FILTER (WHERE conferido_em IS NOT NULL)::int AS conferidas
     FROM fin_person_pagamento`
).catch(() => ({ rows: [{ erro: 'tabela ausente' }] }));
console.log('\nfin_person_pagamento (chave PIX de quem é do time)');
console.log('  ' + linha(pessoas.rows[0]));

const doMes = await pool.query(
  `SELECT v.camada,
          count(*)::int AS linhas,
          count(*) FILTER (WHERE v.entra_no_total)::int AS somam,
          count(*) FILTER (WHERE v.entra_no_total AND pa.id IS NOT NULL)::int AS com_chave,
          to_char(SUM(v.valor_cents) FILTER (WHERE v.entra_no_total) / 100.0, 'FM999G999G990D00') AS total
     FROM fin_agenda_dia_v v
     JOIN fin_entity e ON e.id = v.entity_id AND e.slug = 'xpe'
     LEFT JOIN fin_payee_account pa
            ON pa.counterparty_id = v.counterparty_id AND pa.is_default AND pa.is_active
    WHERE v.direcao = 'pagar'
      AND v.dia >= to_date($1,'YYYY-MM') AND v.dia < (to_date($1,'YYYY-MM') + interval '1 month')
    GROUP BY 1 ORDER BY 3 DESC`,
  [mes]
);
console.log(`\nO que sai em ${mes}, por camada`);
for (const r of doMes.rows) console.log('  ' + linha(r));

const semChave = await pool.query(
  `SELECT cp.name AS favorecido,
          count(*)::int AS linhas,
          to_char(SUM(v.valor_cents) / 100.0, 'FM999G999G990D00') AS total
     FROM fin_agenda_dia_v v
     JOIN fin_entity e ON e.id = v.entity_id AND e.slug = 'xpe'
     JOIN fin_counterparty cp ON cp.id = v.counterparty_id
     LEFT JOIN fin_payee_account pa
            ON pa.counterparty_id = v.counterparty_id AND pa.is_default AND pa.is_active
    WHERE v.direcao = 'pagar' AND v.entra_no_total AND pa.id IS NULL
      AND v.dia >= to_date($1,'YYYY-MM') AND v.dia < (to_date($1,'YYYY-MM') + interval '1 month')
    GROUP BY 1 ORDER BY SUM(v.valor_cents) DESC LIMIT 15`,
  [mes]
);
console.log(`\nFavorecidos de ${mes} que somam e NÃO têm chave PIX cadastrada`);
for (const r of semChave.rows) console.log('  ' + linha(r));

await pool.end();
