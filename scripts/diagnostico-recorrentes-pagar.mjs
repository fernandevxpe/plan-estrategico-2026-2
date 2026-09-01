// O que a empresa paga todo mês, e por que não aparece como conta a pagar.
// SÓ LEITURA.
//
//   node scripts/diagnostico-recorrentes-pagar.mjs
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

console.log('\n1. fin_recurring direction=pagar, por status');
const porStatus = await pool.query(
  `SELECT r.status, r.cadence, count(*)::int AS n, SUM(r.amount_cents)::bigint AS cents
     FROM fin_recurring r JOIN fin_entity e ON e.id = r.entity_id AND e.slug='xpe'
    WHERE r.direction='pagar' GROUP BY 1,2 ORDER BY 3 DESC`
);
for (const r of porStatus.rows) {
  console.log(`   ${String(r.status).padEnd(12)} ${String(r.cadence).padEnd(10)} ${String(r.n).padStart(3)}  R$ ${brl(r.cents)}`);
}

console.log('\n2. As recorrentes uma a uma (as que a tela mostraria se fossem ativas)');
const lista = await pool.query(
  `SELECT r.id, r.status, r.day_of_month, r.amount_cents,
          COALESCE(cp.name, '—') AS favorecido,
          COALESCE(c.code, '—') AS cat,
          COALESCE(pa.id::text, 'NÃO') AS tem_chave_pix
     FROM fin_recurring r
     JOIN fin_entity e ON e.id = r.entity_id AND e.slug='xpe'
     LEFT JOIN fin_counterparty cp ON cp.id = r.counterparty_id
     LEFT JOIN fin_category c ON c.id = r.category_id
     LEFT JOIN fin_payee_account pa ON pa.counterparty_id = r.counterparty_id AND pa.is_default AND pa.is_active
    WHERE r.direction='pagar'
    ORDER BY r.amount_cents DESC`
);
console.log('   id   status      dia  valor          favorecido                        cat   chave PIX');
for (const r of lista.rows) {
  console.log(
    `   ${String(r.id).padStart(4)} ${String(r.status).padEnd(11)} ${String(r.day_of_month ?? '—').padStart(3)}  ` +
      `R$ ${brl(r.amount_cents).padStart(11)}  ${String(r.favorecido).slice(0, 32).padEnd(32)} ${String(r.cat).padEnd(5)} ${r.tem_chave_pix}`
  );
}

console.log('\n3. Os 48 itens de teste em fin_custo_previsto (candidatos a remoção)');
const teste = await pool.query(
  `SELECT i.origem, i.origem_ref, i.estado, count(*)::int AS n,
          SUM(i.valor_previsto_cents)::bigint AS cents,
          min(i.competencia)::text AS de, max(i.competencia)::text AS ate,
          min(i.criado_em)::text AS criado_em, max(i.criado_por) AS por
     FROM fin_custo_previsto i JOIN fin_entity e ON e.id = i.entity_id AND e.slug='xpe'
    WHERE i.descricao ILIKE '%teste automatizado%'
    GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 10`
).catch((e) => ({ rows: [], erro: e.message }));
if (teste.erro) console.log('   ', teste.erro);
for (const r of teste.rows) {
  console.log(
    `   origem=${r.origem} ref=${r.origem_ref} estado=${r.estado} n=${r.n} R$ ${brl(r.cents)} ${r.de}..${r.ate} criado=${r.criado_em} por=${r.por}`
  );
}

await pool.end();
