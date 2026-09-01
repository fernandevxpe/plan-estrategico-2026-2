// A folha projetada bate com a folha paga? Só leitura.
//
//   node scripts/diagnostico-folha-previsao.mjs
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

console.log('\n1. fin_agenda_dia_v · camada pagar_folha, mês a mês');
const agenda = await pool.query(
  `SELECT to_char(v.competencia,'YYYY-MM') AS mes, count(*)::int AS pessoas, SUM(v.valor_cents)::bigint AS cents
     FROM fin_agenda_dia_v v JOIN fin_entity e ON e.id = v.entity_id AND e.slug='xpe'
    WHERE v.direcao='pagar' AND v.camada='pagar_folha' AND v.entra_no_total
    GROUP BY 1 ORDER BY 1 LIMIT 8`
);
for (const r of agenda.rows) console.log(`   ${r.mes}  ${String(r.pessoas).padStart(3)} pessoas  R$ ${brl(r.cents)}`);

console.log('\n2. fin_folha_previsao_v · a fonte da camada');
const fonte = await pool.query(
  `SELECT * FROM fin_folha_previsao_v LIMIT 1`
).catch((e) => ({ rows: [], erro: e.message }));
if (fonte.rows.length) console.log('   colunas:', Object.keys(fonte.rows[0]).join(', '));
else console.log('   indisponível:', fonte.erro);

const somaFonte = await pool.query(
  `SELECT count(*)::int AS pessoas,
          SUM(fixo_cents)::bigint AS fixo,
          SUM(variavel_cents)::bigint AS variavel,
          SUM(reembolso_cents)::bigint AS reembolso,
          SUM(total_cents)::bigint AS total
     FROM fin_folha_previsao_v`
).catch((e) => ({ rows: [{ erro: e.message }] }));
const f = somaFonte.rows[0];
if (f?.erro) console.log('   ', f.erro);
else
  console.log(
    `   ${f.pessoas} pessoas · fixo R$ ${brl(f.fixo)} · variável R$ ${brl(f.variavel)} · reembolso R$ ${brl(f.reembolso)} · TOTAL R$ ${brl(f.total)}`
  );

console.log('\n3. O que REALMENTE saiu de folha (6.x no ledger), mês a mês');
const real = await pool.query(
  `SELECT to_char(t.posted_on,'YYYY-MM') AS mes, count(*)::int AS lanc, SUM(-t.amount_cents)::bigint AS cents
     FROM fin_transaction t
     JOIN fin_category c ON c.id = t.category_id
     JOIN fin_entity e ON e.id = t.entity_id AND e.slug='xpe'
    WHERE t.amount_cents < 0 AND c.code LIKE '6.%'
      AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY 1 ORDER BY 1`
);
for (const r of real.rows) console.log(`   ${r.mes}  ${String(r.lanc).padStart(4)} lanç.  R$ ${brl(r.cents)}`);

console.log('\n4. De onde vem o fixo_cents de cada pessoa (as 8 maiores)');
const porPessoa = await pool.query(
  `SELECT pessoa, meses_pagos, fixo_base, fixo_confianca, fixo_cents
     FROM fin_folha_previsao_v ORDER BY fixo_cents DESC LIMIT 8`
);
for (const p of porPessoa.rows) {
  console.log(
    `   ${String(p.pessoa).slice(0, 22).padEnd(22)} fixo R$ ${brl(p.fixo_cents).padStart(11)}  ` +
      `meses_pagos=${p.meses_pagos}  conf=${p.fixo_confianca}  base=${String(p.fixo_base).slice(0, 46)}`
  );
}

console.log('\n5. O que essas pessoas realmente receberam por MÊS (6.x)');
const mediaPessoa = await pool.query(
  `SELECT cp.name AS pessoa,
          count(DISTINCT to_char(t.posted_on,'YYYY-MM'))::int AS meses,
          (SUM(-t.amount_cents) / GREATEST(count(DISTINCT to_char(t.posted_on,'YYYY-MM')),1))::bigint AS media_mes
     FROM fin_transaction t
     JOIN fin_category c ON c.id = t.category_id
     JOIN fin_counterparty cp ON cp.id = t.counterparty_id
     JOIN fin_entity e ON e.id = t.entity_id AND e.slug='xpe'
    WHERE t.amount_cents < 0 AND c.code LIKE '6.%'
      AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY 1 ORDER BY SUM(-t.amount_cents) DESC LIMIT 8`
);
for (const p of mediaPessoa.rows) {
  console.log(`   ${String(p.pessoa).slice(0, 34).padEnd(34)} R$ ${brl(p.media_mes).padStart(11)}/mês  (${p.meses} meses)`);
}

await pool.end();
