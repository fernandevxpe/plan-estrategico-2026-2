// Que naturezas de pagamento a base sabe separar por pessoa? SÓ LEITURA.
//
// Existe para responder uma pergunta de produto: dá para quebrar o pagamento
// de uma pessoa em N PIX (salário, pró-labore, comissão, reembolso) com o dado
// que EXISTE, ou a quebra seria inventada?
//
//   node scripts/diagnostico-composicao-folha.mjs
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

console.log('\n1. fin_folha_previsao_v — as três parcelas que ela já separa');
const prev = await pool.query(
  `SELECT pessoa, vinculo, fixo_cents, variavel_cents, reembolso_cents, total_cents
     FROM fin_folha_previsao_v ORDER BY total_cents DESC LIMIT 10`
);
console.log('   pessoa                     vínculo      fixo          variável     reembolso');
for (const p of prev.rows) {
  console.log(
    `   ${String(p.pessoa).slice(0, 24).padEnd(24)} ${String(p.vinculo ?? '—').slice(0, 10).padEnd(11)} ` +
      `R$ ${brl(p.fixo_cents).padStart(11)}  R$ ${brl(p.variavel_cents).padStart(8)}  R$ ${brl(p.reembolso_cents).padStart(9)}`
  );
}

console.log('\n2. As categorias 6.x realmente usadas no ledger (a composição de verdade)');
const cats = await pool.query(
  `SELECT c.code, c.name, count(*)::int AS lanc,
          count(DISTINCT t.counterparty_id)::int AS pessoas,
          SUM(-t.amount_cents)::bigint AS cents
     FROM fin_transaction t
     JOIN fin_category c ON c.id = t.category_id
     JOIN fin_entity e ON e.id = t.entity_id AND e.slug='xpe'
    WHERE t.amount_cents < 0 AND c.code LIKE '6.%'
      AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY 1,2 ORDER BY 5 DESC`
);
for (const r of cats.rows) {
  console.log(
    `   ${r.code.padEnd(6)} ${String(r.name).slice(0, 30).padEnd(30)} ${String(r.lanc).padStart(4)} lanç.  ` +
      `${String(r.pessoas).padStart(3)} pessoas  R$ ${brl(r.cents)}`
  );
}

console.log('\n3. Composição por pessoa no ledger, 2026 (quantas naturezas cada uma tem)');
const comp = await pool.query(
  `SELECT cp.name AS pessoa,
          count(DISTINCT c.code)::int AS naturezas,
          string_agg(DISTINCT c.code, ' ' ORDER BY c.code) AS codigos,
          SUM(-t.amount_cents)::bigint AS cents
     FROM fin_transaction t
     JOIN fin_category c ON c.id = t.category_id
     JOIN fin_counterparty cp ON cp.id = t.counterparty_id
     JOIN fin_entity e ON e.id = t.entity_id AND e.slug='xpe'
    WHERE t.amount_cents < 0 AND c.code LIKE '6.%'
      AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY 1 ORDER BY 4 DESC LIMIT 14`
);
for (const r of comp.rows) {
  console.log(
    `   ${String(r.pessoa).slice(0, 34).padEnd(34)} ${r.naturezas} natureza(s): ${String(r.codigos).padEnd(20)} R$ ${brl(r.cents)}`
  );
}

console.log('\n4. fin_time_remuneracao_mes_v (0163) — a view que já desenha N naturezas');
const rem = await pool.query(`SELECT * FROM fin_time_remuneracao_mes_v LIMIT 1`).catch((e) => ({ rows: [], erro: e.message }));
if (rem.erro) console.log('   indisponível:', rem.erro);
else console.log('   colunas:', Object.keys(rem.rows[0] ?? {}).join(', '));

console.log('\n5. Comissão prevista (fin_comissao_prevista) — a natureza que a folha NÃO separa');
const com = await pool.query(
  `SELECT count(*)::int AS n, count(DISTINCT person_id)::int AS pessoas, SUM(valor_cents)::bigint AS cents
     FROM fin_comissao_prevista`
).catch((e) => ({ rows: [{ n: 'erro: ' + e.message.slice(0, 50) }] }));
console.log('   ', JSON.stringify(com.rows[0]));

console.log('\n6. Chaves PIX de pessoa (fin_person_pagamento) — quantas dá para pagar');
const pix = await pool.query(
  `SELECT p.nome, pp.metodo, pp.pix_tipo, (pp.conferido_em IS NOT NULL) AS conferida,
          pp.recebe_salario, pp.recebe_reembolso
     FROM fin_person_pagamento pp JOIN fin_person p ON p.id = pp.person_id
    ORDER BY p.nome`
).catch((e) => ({ rows: [], erro: e.message }));
if (pix.erro) console.log('   ', pix.erro);
for (const r of pix.rows) {
  console.log(
    `   ${String(r.nome).slice(0, 30).padEnd(30)} ${r.metodo}/${r.pix_tipo}  conferida=${r.conferida}  ` +
      `salário=${r.recebe_salario} reembolso=${r.recebe_reembolso}`
  );
}
const totalPessoas = await pool.query(`SELECT count(*)::int AS n FROM fin_person WHERE status = 'ativo'`);
console.log(`   → ${pix.rows?.length ?? 0} chave(s) para ${totalPessoas.rows[0].n} pessoa(s) ativa(s)`);

console.log('\n7. fin_folha_previsao_v tem dimensão de MÊS?');
const dim = await pool.query(
  `SELECT count(*)::int AS linhas, count(DISTINCT person_id)::int AS pessoas,
          count(DISTINCT mes_previsto)::int AS meses,
          min(mes_previsto)::text AS de, max(mes_previsto)::text AS ate
     FROM fin_folha_previsao_v`
);
console.log('   ', JSON.stringify(dim.rows[0]));

console.log('\n8. fin_time_remuneracao_mes_v — naturezas que ela emite de fato');
const nat = await pool.query(
  `SELECT natureza, count(*)::int AS n, count(DISTINCT person_id)::int AS pessoas,
          SUM(valor_cents)::bigint AS cents
     FROM fin_time_remuneracao_mes_v GROUP BY 1 ORDER BY 4 DESC`
).catch((e) => ({ rows: [{ erro: e.message.slice(0,70) }] }));
for (const r of nat.rows) console.log('   ', JSON.stringify(r));

await pool.end();
