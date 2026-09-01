// O cadastro por pessoa — o que a casa DECLAROU que paga a cada um.
// SÓ LEITURA.
//
// O dono disse: "os valores a serem pagos por pessoa são justamente os
// previstos que temos no app pessoal e no cadastro pessoal de cada um, que
// considera os itens cadastrados por pessoa." Este script responde se esse
// cadastro está preenchido o bastante para virar a folha da tela de pagamento.
//
//   node scripts/diagnostico-cadastro-pessoa.mjs
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const ativas = (await pool.query(`SELECT count(*)::int AS n FROM fin_person WHERE status='ativo'`)).rows[0].n;
console.log(`\n${ativas} pessoas ativas no roster.\n`);

const TABELAS = [
  ['fin_pessoa_salario_base', 'salário base declarado (0164)'],
  ['fin_pessoa_mes_ajuste', 'ajuste por mês (0171)'],
  ['fin_pessoa_comissao_declarada', 'comissão declarada (0165)'],
  ['fin_person_compensation', 'remuneração contratada (0026)'],
  ['fin_person_pagamento', 'chave PIX / coordenada (0159)']
];

console.log('Preenchimento de cada cadastro');
for (const [tabela, rotulo] of TABELAS) {
  const r = await pool
    .query(`SELECT count(*)::int AS linhas, count(DISTINCT person_id)::int AS pessoas FROM ${tabela}`)
    .catch((e) => ({ rows: [{ linhas: null, pessoas: null, erro: e.message.slice(0, 60) }] }));
  const { linhas, pessoas, erro } = r.rows[0];
  console.log(
    erro
      ? `  ${tabela.padEnd(32)} ${erro}`
      : `  ${tabela.padEnd(32)} ${String(linhas).padStart(4)} linha(s) · ${String(pessoas).padStart(3)}/${ativas} pessoas — ${rotulo}`
  );
}

console.log('\nColunas de fin_pessoa_salario_base');
const cols = await pool
  .query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='fin_pessoa_salario_base' ORDER BY ordinal_position`
  )
  .catch(() => ({ rows: [] }));
console.log('  ' + cols.rows.map((c) => c.column_name).join(', '));

console.log('\nO que está declarado, pessoa a pessoa');
const decl = await pool
  .query(
    `SELECT p.name AS pessoa, b.*
       FROM fin_pessoa_salario_base b JOIN fin_person p ON p.id = b.person_id
      ORDER BY p.name LIMIT 30`
  )
  .catch((e) => ({ rows: [], erro: e.message }));
if (decl.erro) console.log('  ', decl.erro.slice(0, 80));
for (const r of decl.rows) {
  const valor = r.salario_base_cents ?? r.valor_cents ?? r.cents;
  console.log(`  ${String(r.pessoa).slice(0, 30).padEnd(30)} R$ ${brl(valor).padStart(11)}  vigencia=${r.vigencia_inicio ?? r.inicio ?? '—'}`);
}

console.log('\nfin_time_remuneracao_mes_v — o último mês fechado, por pessoa e natureza');
const ultimo = await pool.query(
  `WITH m AS (SELECT max(mes) AS mes FROM fin_time_remuneracao_mes_v)
   SELECT p.name AS pessoa, v.natureza, v.valor_cents
     FROM fin_time_remuneracao_mes_v v
     JOIN fin_person p ON p.id = v.person_id
     CROSS JOIN m
    WHERE v.mes = m.mes
    ORDER BY p.name, v.natureza`
).catch((e) => ({ rows: [], erro: e.message }));
if (ultimo.erro) console.log('  ', ultimo.erro.slice(0, 80));
let atual = null;
for (const r of ultimo.rows) {
  if (r.pessoa !== atual) {
    console.log(`  ${r.pessoa}`);
    atual = r.pessoa;
  }
  console.log(`      ${String(r.natureza).padEnd(12)} R$ ${brl(r.valor_cents)}`);
}

await pool.end();
