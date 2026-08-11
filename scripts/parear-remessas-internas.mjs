// Fecha as remessas internas que a qualificação identificou.
//
// O QUE ACONTECEU ANTES DESTE ARQUIVO
//
// A qualificação descobriu 54 entradas que eram remessa da própria empresa
// (Asaas → Nubank/Inter), não receita de cliente, e as marcou com a categoria
// 9.01. Marcar a CATEGORIA não bastou: `transfer_status` continuou 'nao', e as
// telas que somam por status — não por categoria — seguiam contando
// R$ 352.401,82 como entrada. Meia correção é pior que nenhuma, porque parece
// resolvida.
//
// POR QUE PAREAR EM VEZ DE SÓ MARCAR 'em_transito'
//
// 'em_transito' diz "isto é perna de transferência e não sei qual é a outra".
// Aqui eu SEI: 52 das 54 têm espelho de valor exato e sinal oposto em outra
// conta, único, dentro de três dias. Deixá-las em trânsito jogaria fora essa
// prova e manteria o dinheiro na convenção `<> 'pareado'`, que é a que a tela
// de fluxo usa.
//
// Parear também resolve um problema mais antigo: 51 desses espelhos são pernas
// órfãs em 'em_transito' — parte dos 322 que vinham sendo reportados como
// incerteza aberta do resultado.
//
// A REGRA DE SEGURANÇA: só pareia espelho ÚNICO. Dois candidatos do mesmo
// valor significam que escolher um é chute, e um par errado tira o dinheiro
// certo do lugar errado. Esses ficam como estão, visíveis.
//
// Uso:
//   node scripts/parear-remessas-internas.mjs            dry-run
//   node scripts/parear-remessas-internas.mjs --aplicar
import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const { rows: antes } = await client.query(
    `SELECT a.slug, sum(t.amount_cents) v FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id GROUP BY 1 ORDER BY 1`
  );

  // Só entradas 9.01 ainda soltas, com espelho único.
  const { rows: alvo } = await client.query(`
    SELECT t.id, t.posted_on, t.amount_cents, a.slug AS conta,
           o.id AS espelho_id, ao.slug AS espelho_conta, o.posted_on AS espelho_data,
           o.transfer_status AS espelho_status
      FROM fin_transaction t
      JOIN fin_category c ON c.id = t.category_id AND c.code = '9.01'
      JOIN fin_account a ON a.id = t.account_id
      JOIN LATERAL (
        SELECT o.* FROM fin_transaction o
         WHERE o.amount_cents = -t.amount_cents
           AND o.account_id <> t.account_id
           AND abs(o.posted_on - t.posted_on) <= 3
           AND o.transfer_status <> 'pareado'
         ORDER BY abs(o.posted_on - t.posted_on)
      ) o ON true
      JOIN fin_account ao ON ao.id = o.account_id
     WHERE t.transfer_status = 'nao'
       AND (SELECT count(*) FROM fin_transaction x
             WHERE x.amount_cents = -t.amount_cents AND x.account_id <> t.account_id
               AND abs(x.posted_on - t.posted_on) <= 3 AND x.transfer_status <> 'pareado') = 1
     ORDER BY t.posted_on DESC`);

  // Um espelho não pode servir a duas entradas. Sem esta trava, duas entradas
  // do mesmo valor no mesmo dia parearia ambas com a MESMA saída, e uma delas
  // sumiria do caixa sem contrapartida.
  const usados = new Set();
  const pares = [];
  for (const t of alvo) {
    if (usados.has(t.espelho_id)) continue;
    usados.add(t.espelho_id);
    pares.push(t);
  }

  for (const p of pares) {
    const grupo = randomUUID();
    await client.query(
      `UPDATE fin_transaction
          SET transfer_status = 'pareado', transfer_group_id = $2, updated_at = now()
        WHERE id = ANY($1::bigint[])`,
      [[p.id, p.espelho_id], grupo]
    );
    await client.query(
      `INSERT INTO fin_classification_event
         (target_table, target_id, stage, category_id, accepted, rationale, actor)
       SELECT 'fin_transaction', x, 'humano', NULL, true,
              jsonb_build_object('motivo','remessa interna pareada por espelho único',
                                 'grupo', $2::text, 'contas', $3::text),
              'parear-remessas-internas'
         FROM unnest($1::bigint[]) x`,
      [[p.id, p.espelho_id], grupo, `${p.espelho_conta} → ${p.conta}`]
    );
  }

  console.log(`\nRemessas internas pareadas — ${pares.length} pares\n`);
  console.log('  data         valor              de → para');
  pares.slice(0, 12).forEach((p) =>
    console.log(`  ${String(p.posted_on).slice(4, 15)}  ${brl(Math.abs(Number(p.amount_cents))).padStart(15)}  ${p.espelho_conta} → ${p.conta}`)
  );
  if (pares.length > 12) console.log(`  … e mais ${pares.length - 12}`);

  const naoPareados = alvo.length - pares.length;
  const { rows: [soltas] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(abs(t.amount_cents)),0) v FROM fin_transaction t
       JOIN fin_category c ON c.id = t.category_id AND c.code='9.01'
      WHERE t.transfer_status = 'nao'`
  );
  console.log(`\n  valor neutralizado: ${brl(pares.reduce((s, p) => s + Math.abs(Number(p.amount_cents)), 0))}`);
  if (naoPareados) console.log(`  espelho já tomado por outra entrada: ${naoPareados} (ficam visíveis)`);
  console.log(`  ainda 9.01 e soltas: ${soltas.n} · ${brl(soltas.v)}`);

  const { rows: depois } = await client.query(
    `SELECT a.slug, sum(t.amount_cents) v FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id GROUP BY 1 ORDER BY 1`
  );
  console.log('\n  ÂNCORA — parear não move dinheiro:');
  let ok = true;
  for (const a of antes) {
    const d = depois.find((x) => x.slug === a.slug);
    const delta = Number(d?.v ?? 0) - Number(a.v);
    if (delta !== 0) ok = false;
    console.log(`    ${a.slug.padEnd(18)}${brl(a.v).padStart(15)} → ${brl(d?.v).padStart(15)}  ${delta === 0 ? 'OK' : 'DELTA ' + brl(delta)}`);
  }
  if (!ok) throw new Error('o saldo de alguma conta mudou — abortado');

  // Nenhuma perna pareada pode ficar sem grupo: o CHECK da 0002 exige, e é ele
  // que impede um "pareado" órfão de sumir das duas convenções ao mesmo tempo.
  const { rows: [furo] } = await client.query(
    `SELECT count(*) n FROM fin_transaction WHERE transfer_status='pareado' AND transfer_group_id IS NULL`
  );
  if (Number(furo.n) > 0) throw new Error(`${furo.n} perna(s) pareada(s) sem grupo`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
