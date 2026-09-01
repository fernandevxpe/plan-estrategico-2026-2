// A previsão pelo CADASTRO contra o molde do último mês fechado. SÓ LEITURA.
//
// Existe porque a aba de Contas a pagar estava usando a composição REALIZADA do
// último mês como projeção — o que projeta para frente o que não se repete
// (uma comissão avulsa, um reembolso que acabou) e ignora o que foi cadastrado.
// `lib/financeiro/pessoas.ts` já fazia certo; esta prova mostra o tamanho da
// diferença, pessoa a pessoa.
//
//   node scripts/diagnostico-previsao-vs-molde.mjs [YYYY-MM]
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const mes = process.argv[2] ?? '2026-09';
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// A previsão pelo cadastro, com a vigência resolvida PARA O MÊS PEDIDO — que é
// a regra do app (`vigenteEm` em lib/financeiro/time.ts:2116), e não a do
// `DISTINCT ON` sem filtro de data que pessoas.ts usa hoje.
const previsao = await pool.query(
  `WITH alvo AS (SELECT to_date($1,'YYYY-MM') AS mes),
   sal AS (
     SELECT DISTINCT ON (person_id) person_id, valor_cents
       FROM fin_pessoa_salario_base, alvo
      WHERE vigente_desde <= alvo.mes
      ORDER BY person_id, vigente_desde DESC
   ),
   pro AS (
     SELECT DISTINCT ON (person_id) person_id, valor_cents
       FROM fin_pessoa_prolabore_esperado, alvo
      WHERE vigente_desde <= alvo.mes
      ORDER BY person_id, vigente_desde DESC
   ),
   com AS (
     SELECT cd.person_id, SUM(cd.valor_cents)::bigint AS valor_cents
       FROM fin_pessoa_comissao_declarada cd CROSS JOIN alvo
      WHERE cd.competencia = alvo.mes GROUP BY 1
   ),
   ree AS (
     SELECT person_id, SUM(valor_parcela_cents)::bigint AS valor_cents
       FROM fin_reembolso_saldo_unificado_v
      WHERE NOT quitado AND parcelas_restantes >= 1 GROUP BY 1
   )
   SELECT p.id, p.name AS pessoa,
          COALESCE(sal.valor_cents,0)::bigint AS salario,
          COALESCE(pro.valor_cents,0)::bigint AS prolabore,
          COALESCE(com.valor_cents,0)::bigint AS comissao,
          COALESCE(ree.valor_cents,0)::bigint AS reembolso
     FROM fin_person p
     JOIN fin_entity e ON e.id = p.entity_id AND e.slug='xpe'
     LEFT JOIN sal ON sal.person_id = p.id
     LEFT JOIN pro ON pro.person_id = p.id
     LEFT JOIN com ON com.person_id = p.id
     LEFT JOIN ree ON ree.person_id = p.id
    WHERE (COALESCE(sal.valor_cents,0)+COALESCE(pro.valor_cents,0)
         + COALESCE(com.valor_cents,0)+COALESCE(ree.valor_cents,0)) > 0
    ORDER BY p.name`,
  [mes]
);

// O molde: a composição realizada do último mês fechado (o que eu usei, errado).
const molde = await pool.query(
  `WITH m AS (SELECT max(mes) AS mes FROM fin_time_remuneracao_mes_v WHERE mes <= to_date($1,'YYYY-MM'))
   SELECT p.id, SUM(v.valor_cents)::bigint AS total,
          to_char(max(m.mes),'YYYY-MM') AS mes_molde
     FROM fin_time_remuneracao_mes_v v
     JOIN m ON v.mes = m.mes
     JOIN fin_person p ON p.id = v.person_id
    GROUP BY 1`,
  [mes]
);
const porId = new Map(molde.rows.map((r) => [Number(r.id), Number(r.total)]));
const mesMolde = molde.rows[0]?.mes_molde ?? '—';

console.log(`\nPrevisão por CADASTRO para ${mes}  ×  molde realizado de ${mesMolde}\n`);
console.log('  pessoa                    salário    pró-lab.   comissão   reemb.     PREVISTO      molde      dif');
let tp = 0, tm = 0;
for (const r of previsao.rows) {
  const prev = Number(r.salario) + Number(r.prolabore) + Number(r.comissao) + Number(r.reembolso);
  const mol = porId.get(Number(r.id)) ?? 0;
  tp += prev; tm += mol;
  const dif = prev - mol;
  const marca = Math.abs(dif) > 50_00 ? ' ←' : '';
  console.log(
    `  ${String(r.pessoa).slice(0, 24).padEnd(24)} ${brl(r.salario).padStart(9)} ${brl(r.prolabore).padStart(10)} ` +
      `${brl(r.comissao).padStart(10)} ${brl(r.reembolso).padStart(9)} ${brl(prev).padStart(12)} ${brl(mol).padStart(11)} ${brl(dif).padStart(11)}${marca}`
  );
}
console.log(`\n  ${'TOTAL'.padEnd(24)} ${''.padStart(41)} ${brl(tp).padStart(12)} ${brl(tm).padStart(11)} ${brl(tp - tm).padStart(11)}`);

console.log('\nVigências futuras cadastradas (o que o DISTINCT ON sem filtro de data erraria)');
for (const [t, rot] of [['fin_pessoa_salario_base', 'salário base'], ['fin_pessoa_prolabore_esperado', 'pró-labore']]) {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM ${t} WHERE vigente_desde > to_date($1,'YYYY-MM')`, [mes]
  ).catch(() => ({ rows: [{ n: 'erro' }] }));
  console.log(`  ${rot.padEnd(14)} ${r.rows[0].n} linha(s) com vigência depois de ${mes}`);
}

await pool.end();
