// Por que cada linha a pagar do mês não entra no total. SÓ LEITURA.
//
//   node scripts/diagnostico-motivo-nao-soma.mjs [YYYY-MM]
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const mes = process.argv[2] ?? '2026-09';
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

console.log(`\nMotivos de não somar em ${mes}, agrupados`);
const grupos = await pool.query(
  `SELECT v.camada, v.procedencia, v.entra_no_total,
          left(coalesce(v.motivo_nao_soma,'(soma)'), 78) AS motivo,
          count(*)::int AS n, SUM(v.valor_cents)::bigint AS cents
     FROM fin_agenda_dia_v v JOIN fin_entity e ON e.id = v.entity_id AND e.slug='xpe'
    WHERE v.direcao='pagar'
      AND v.dia >= to_date($1,'YYYY-MM') AND v.dia < (to_date($1,'YYYY-MM') + interval '1 month')
    GROUP BY 1,2,3,4 ORDER BY 6 DESC NULLS LAST`,
  [mes]
);
for (const r of grupos.rows) {
  console.log(
    `  ${String(r.camada).padEnd(22)} ${String(r.procedencia).padEnd(10)} soma=${r.entra_no_total ? 'S' : 'n'} ` +
      `${String(r.n).padStart(3)}×  R$ ${brl(r.cents).padStart(12)}\n      ${r.motivo}`
  );
}

console.log(`\nQuem GANHA a chave das recorrentes que perderam (amostra)`);
const disputa = await pool.query(
  `WITH doMes AS (
     SELECT * FROM fin_agenda_dia_v v
      JOIN fin_entity e ON e.id = v.entity_id AND e.slug='xpe'
     WHERE v.direcao='pagar'
       AND v.dia >= to_date($1,'YYYY-MM') AND v.dia < (to_date($1,'YYYY-MM') + interval '1 month')
   )
   SELECT p.chave_dedupe,
          p.descricao AS perdedora, p.procedencia AS proc_perdedora, p.valor_cents AS cents_perdedora,
          g.descricao AS vencedora, g.procedencia AS proc_vencedora, g.entra_no_total AS vencedora_soma
     FROM doMes p
     LEFT JOIN doMes g ON g.chave_dedupe = p.chave_dedupe AND g.entra_no_total
    WHERE NOT p.entra_no_total AND p.camada = 'pagar_recorrente'
    ORDER BY p.valor_cents DESC LIMIT 12`,
  [mes]
);
for (const r of disputa.rows) {
  console.log(
    `  R$ ${brl(r.cents_perdedora).padStart(11)}  ${String(r.perdedora).slice(0, 34).padEnd(34)} (${r.proc_perdedora})\n` +
      `      → vencedora: ${r.vencedora ? `${String(r.vencedora).slice(0, 40)} (${r.proc_vencedora}, soma=${r.vencedora_soma})` : 'NENHUMA — o dinheiro não é contado por ninguém'}`
  );
}

await pool.end();
