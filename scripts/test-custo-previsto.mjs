// A prova de que confirmar um custo previsto NAO infla o mes.
//
// Este script aplica a migration 0100 dentro de uma transacao, exerce a tabela
// e as views, e SEMPRE termina em ROLLBACK. Ele nao grava nada — nem quando a
// 0100 ja estiver aplicada, caso em que ele pula o CREATE e testa o que esta no
// banco.
//
// O QUE ELE PROVA, NESTA ORDEM
//
//   1. Com a tabela vazia, o consolidado e igual a projecao somavel.
//   2. Materializar TODOS os derivados de um mes pelo valor de face deixa o
//      total do mes IDENTICO AO CENTAVO. O que entrou na coluna do item saiu da
//      coluna da projecao, linha a linha.
//   3. Confirmar um item por um valor diferente move o total exatamente pela
//      diferenca — nem mais, nem menos.
//   4. Um item manual soma por cima, porque nao duplica projecao nenhuma.
//   5. Ignorar um derivado tira o valor do total sem ressuscitar a projecao.
//   6. As guardas recusam o que tem de recusar: realizado sem lancamento,
//      realizado sobre credito, apagar derivado, apagar realizado, dois itens
//      para a mesma projecao, valor ausente sem motivo.
//
// uso: node scripts/test-custo-previsto.mjs [--mes=2026-09]
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = resolve(raiz, 'db/migrations/0100_fin_custo_previsto.sql');

const argMes = process.argv.find((a) => a.startsWith('--mes='));
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let ok = 0;
let falhas = 0;
function checar(nome, condicao, detalhe = '') {
  if (condicao) {
    ok += 1;
    console.log(`  ✓ ${nome}${detalhe ? `   ${detalhe}` : ''}`);
  } else {
    falhas += 1;
    console.log(`  ✗ ${nome}${detalhe ? `   ${detalhe}` : ''}`);
  }
}

/** Espera que a instrucao seja RECUSADA pelo banco. Recusa e o comportamento. */
async function recusa(c, nome, sql, params = []) {
  await c.query('SAVEPOINT sp_recusa');
  try {
    await c.query(sql, params);
    await c.query('ROLLBACK TO SAVEPOINT sp_recusa');
    checar(nome, false, 'o banco ACEITOU o que deveria recusar');
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT sp_recusa');
    checar(nome, true, `recusado: ${e.message.split('\n')[0].slice(0, 90)}`);
  }
}

const pool = financePool();
const c = await pool.connect();

try {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout = '10s'");

  const { rows: existe } = await c.query("SELECT to_regclass('fin_custo_previsto') AS t");
  if (existe[0].t) {
    console.log('0100 ja aplicada — testando o que esta no banco.\n');
  } else {
    console.log('0100 nao aplicada — executando o arquivo dentro da transacao.\n');
    await c.query(readFileSync(MIGRATION, 'utf8'));
  }

  const { rows: ent } = await c.query("SELECT id FROM fin_entity WHERE slug='xpe'");
  const entityId = ent[0].id;

  // O mes de trabalho: o primeiro mes inteiramente a frente do horizonte, para
  // que o teste nao dependa de quanto de agosto ja passou.
  const mes =
    argMes?.slice(6) ??
    (
      await c.query(
        `SELECT to_char(min(competencia),'YYYY-MM-DD') m FROM fin_custo_previsto_derivado_v
          WHERE competencia > date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)`
      )
    ).rows[0].m;

  const totalDoMes = async () => {
    const { rows } = await c.query(
      `SELECT
         COALESCE(sum(valor_cents) FILTER (WHERE entra_no_total), 0)::bigint            AS total,
         COALESCE(sum(valor_cents) FILTER (WHERE entra_no_total AND procedencia='item'), 0)::bigint      AS de_item,
         COALESCE(sum(valor_cents) FILTER (WHERE entra_no_total AND procedencia='projetado'), 0)::bigint AS de_projecao,
         COALESCE(sum(valor_cents) FILTER (WHERE suprimido_por_item), 0)::bigint         AS projecao_calada,
         count(*) FILTER (WHERE entra_no_total)                                          AS linhas
       FROM fin_custo_previsto_consolidado_v
      WHERE entity_id=$1 AND competencia=$2::date`,
      [entityId, mes]
    );
    return rows[0];
  };

  console.log(`══ competencia de trabalho: ${mes} ══\n`);

  // ── 1. ponto zero ────────────────────────────────────────────────────────
  const antes = await totalDoMes();
  const { rows: proj } = await c.query(
    `SELECT count(*) n, COALESCE(sum(valor_projetado_cents),0)::bigint cents
       FROM fin_custo_previsto_derivado_v
      WHERE entity_id=$1 AND competencia=$2::date AND entra_no_saldo`,
    [entityId, mes]
  );

  console.log('1. ponto zero — tabela vazia');
  checar(
    'o consolidado e exatamente a projecao somavel',
    BigInt(antes.total) === BigInt(proj[0].cents),
    `${brl(antes.total)} em ${antes.linhas} linha(s)`
  );
  checar('nada vem de item ainda', BigInt(antes.de_item) === 0n);

  // ── 2. materializar TODOS os derivados pelo valor de face ────────────────
  // TODOS, inclusive os que a camada de origem mantem fora do saldo: e o unico
  // jeito de provar que materializar e neutro mesmo quando o item nasce de uma
  // recorrente proposta.
  console.log('\n2. materializar todos os derivados do mes, pelo valor de face');
  const { rowCount: criados } = await c.query(
    `INSERT INTO fin_custo_previsto
       (entity_id, origem, origem_ref, origem_camada, recurring_id, document_id, person_id,
        competencia, descricao, category_id, nucleo, cost_center_id, counterparty_id,
        dia_esperado, dia_regra, valor_previsto_cents, created_by)
     SELECT d.entity_id, 'derivado', d.origem_ref, d.origem_camada,
            d.recurring_id, d.document_id, d.person_id,
            d.competencia, d.descricao, d.category_id, d.nucleo, d.cost_center_id,
            d.counterparty_id, d.dia_esperado, d.dia_regra,
            d.valor_projetado_cents, 'test-custo-previsto'
       FROM fin_custo_previsto_derivado_v d
      WHERE d.entity_id=$1 AND d.competencia=$2::date`,
    [entityId, mes]
  );

  const depois = await totalDoMes();
  checar(
    'o total do mes nao mudou um centavo',
    BigInt(antes.total) === BigInt(depois.total),
    `antes ${brl(antes.total)} · depois ${brl(depois.total)} · ${criados} item(ns) criado(s)`
  );
  checar(
    'tudo passou a vir de item; a projecao correspondente calou',
    BigInt(depois.de_item) === BigInt(antes.total) && BigInt(depois.de_projecao) === 0n,
    `item ${brl(depois.de_item)} · projecao ${brl(depois.de_projecao)}`
  );
  const { rows: face } = await c.query(
    `SELECT COALESCE(sum(valor_projetado_cents),0)::bigint cents FROM fin_custo_previsto_derivado_v
      WHERE entity_id=$1 AND competencia=$2::date`,
    [entityId, mes]
  );
  checar(
    'o que calou e exatamente o que foi materializado',
    BigInt(depois.projecao_calada) === BigInt(face[0].cents),
    `${brl(depois.projecao_calada)} de ${criados} projecao(oes)`
  );

  const { rows: semMotivo } = await c.query(
    `SELECT count(*) n FROM fin_custo_previsto_consolidado_v
      WHERE entity_id=$1 AND competencia=$2::date AND NOT entra_no_total AND motivo_nao_soma IS NULL`,
    [entityId, mes]
  );
  checar('nenhuma linha calada ficou sem motivo', Number(semMotivo[0].n) === 0);

  // A recorrente proposta: materializada e ainda fora do saldo; confirmada, entra.
  const { rows: prop } = await c.query(
    `SELECT i.id, i.valor_previsto_cents FROM fin_custo_previsto i
      WHERE i.entity_id=$1 AND i.competencia=$2::date AND i.origem_camada='pagar_recorrente'
      ORDER BY i.valor_previsto_cents DESC LIMIT 1`,
    [entityId, mes]
  );
  if (prop.length) {
    const { rows: linhaProp } = await c.query(
      `SELECT entra_no_total, motivo_nao_soma FROM fin_custo_previsto_consolidado_v
        WHERE procedencia='item' AND item_id=$1`,
      [prop[0].id]
    );
    checar(
      'item derivado de recorrente proposta NAO soma so por existir',
      linhaProp[0].entra_no_total === false,
      linhaProp[0].motivo_nao_soma?.slice(0, 80)
    );
    await c.query(
      `UPDATE fin_custo_previsto SET estado='confirmado', valor_confirmado_cents=valor_previsto_cents,
              confirmado_por='teste', confirmado_em=now() WHERE id=$1`,
      [prop[0].id]
    );
    const comProposta = await totalDoMes();
    checar(
      'confirmar a recorrente proposta soma exatamente o valor dela',
      BigInt(comProposta.total) - BigInt(depois.total) === BigInt(prop[0].valor_previsto_cents),
      `+${brl(prop[0].valor_previsto_cents)} — e o caminho da duvida 33, mes a mes`
    );
    // Volta ao estado anterior para nao contaminar as contas seguintes.
    await c.query(
      `UPDATE fin_custo_previsto SET estado='previsto', valor_confirmado_cents=NULL,
              confirmado_por=NULL, confirmado_em=NULL WHERE id=$1`,
      [prop[0].id]
    );
  }

  // ── 3. confirmar por valor diferente move so a diferenca ─────────────────
  console.log('\n3. confirmar ajustando o valor');
  const { rows: alvo } = await c.query(
    `SELECT id, valor_previsto_cents FROM fin_custo_previsto
      WHERE entity_id=$1 AND competencia=$2::date AND origem='derivado'
      ORDER BY valor_previsto_cents DESC LIMIT 1`,
    [entityId, mes]
  );
  const delta = 12345n;
  await c.query(
    `UPDATE fin_custo_previsto
        SET estado='confirmado', valor_confirmado_cents = valor_previsto_cents + $2,
            confirmado_por='teste', confirmado_em=now()
      WHERE id=$1`,
    [alvo[0].id, Number(delta)]
  );
  const confirmado = await totalDoMes();
  checar(
    'o total subiu exatamente pelo ajuste, e nada alem',
    BigInt(confirmado.total) - BigInt(depois.total) === delta,
    `+${brl(Number(delta))}`
  );

  const { rows: conf } = await c.query(
    `SELECT COALESCE(sum(ajuste_da_confirmacao_cents),0)::bigint ajuste
       FROM fin_custo_previsto_confronto_v WHERE entity_id=$1 AND competencia=$2::date`,
    [entityId, mes]
  );
  checar(
    'o confronto mede o ajuste da confirmacao',
    BigInt(conf[0].ajuste) === delta,
    `ajuste_da_confirmacao_cents = ${brl(conf[0].ajuste)}`
  );

  const { rows: prec } = await c.query(
    `SELECT precedencia, procedencia, entra_no_total, motivo_nao_soma
       FROM fin_custo_previsto_consolidado_v
      WHERE entity_id=$1 AND competencia=$2::date AND origem_ref=(SELECT origem_ref FROM fin_custo_previsto WHERE id=$3)
      ORDER BY precedencia_nivel`,
    [entityId, mes, alvo[0].id]
  );
  checar(
    'confirmado vence derivado vence projetado',
    prec.length === 2 && prec[0].precedencia === 'confirmado' && prec[0].entra_no_total === true &&
      prec[1].precedencia === 'projetado' && prec[1].entra_no_total === false,
    prec.map((p) => `${p.precedencia}:${p.entra_no_total ? 'soma' : 'cala'}`).join(' · ')
  );

  // ── 4. item manual soma por cima ─────────────────────────────────────────
  console.log('\n4. item manual — a lacuna do gasto nao recorrente');
  await c.query(
    `INSERT INTO fin_custo_previsto
       (entity_id, origem, competencia, descricao, valor_previsto_cents, created_by)
     VALUES ($1,'manual',$2::date,'gasto nao recorrente do teste', 800000, 'test-custo-previsto')`,
    [entityId, mes]
  );
  const comManual = await totalDoMes();
  checar(
    'manual soma por cima, porque nao duplica projecao nenhuma',
    BigInt(comManual.total) - BigInt(confirmado.total) === 800000n,
    `+${brl(800000)}`
  );

  // ── 5. ignorar tira do total sem ressuscitar a projecao ──────────────────
  console.log('\n5. ignorar um derivado');
  await c.query(
    `UPDATE fin_custo_previsto SET estado='ignorado', ignorado_motivo='teste: contrato encerrado' WHERE id=$1`,
    [alvo[0].id]
  );
  const ignorado = await totalDoMes();
  checar(
    'o valor ignorado sai do total',
    BigInt(ignorado.total) === BigInt(comManual.total) - (BigInt(alvo[0].valor_previsto_cents) + delta),
    brl(BigInt(comManual.total) - BigInt(ignorado.total))
  );
  const { rows: ress } = await c.query(
    `SELECT count(*) n FROM fin_custo_previsto_consolidado_v
      WHERE entity_id=$1 AND competencia=$2::date AND procedencia='projetado'
        AND origem_ref=(SELECT origem_ref FROM fin_custo_previsto WHERE id=$3) AND entra_no_total`,
    [entityId, mes, alvo[0].id]
  );
  checar(
    'a projecao NAO ressuscita quando o item e ignorado',
    Number(ress[0].n) === 0,
    'ignorar e uma decisao sobre o dinheiro, nao um desfazer'
  );

  // ── 6. as guardas ────────────────────────────────────────────────────────
  console.log('\n6. o que o banco tem de recusar');
  const { rows: credito } = await c.query(
    `SELECT id FROM fin_transaction WHERE amount_cents > 0 ORDER BY id LIMIT 1`
  );
  const { rows: debito } = await c.query(
    `SELECT id FROM fin_transaction WHERE amount_cents < 0 ORDER BY id DESC LIMIT 1`
  );

  await recusa(
    c,
    'previsto nao vira realizado sem lancamento',
    `UPDATE fin_custo_previsto SET estado='realizado', realizado_em=now(),
        valor_confirmado_cents=valor_previsto_cents, confirmado_por='x', confirmado_em=now()
      WHERE entity_id=$1 AND competencia=$2::date AND origem='manual'`,
    [entityId, mes]
  );
  await recusa(
    c,
    'um credito nao realiza um custo',
    `UPDATE fin_custo_previsto SET estado='realizado', realizado_transaction_id=$3, realizado_em=now(),
        valor_confirmado_cents=valor_previsto_cents, confirmado_por='x', confirmado_em=now()
      WHERE entity_id=$1 AND competencia=$2::date AND origem='manual'`,
    [entityId, mes, credito[0].id]
  );
  await recusa(
    c,
    'dois itens nao reivindicam a mesma projecao',
    `INSERT INTO fin_custo_previsto (entity_id, origem, origem_ref, competencia, descricao, valor_previsto_cents)
     SELECT entity_id, 'derivado', origem_ref, competencia, 'duplicata', 1 FROM fin_custo_previsto WHERE id=$1`,
    [alvo[0].id]
  );
  await recusa(
    c,
    'valor ausente exige motivo declarado',
    `INSERT INTO fin_custo_previsto (entity_id, origem, competencia, descricao)
     VALUES ($1,'manual',$2::date,'sem valor e sem motivo')`,
    [entityId, mes]
  );
  await recusa(
    c,
    'confirmar exige autor e hora',
    `INSERT INTO fin_custo_previsto (entity_id, origem, competencia, descricao, valor_previsto_cents, estado, valor_confirmado_cents)
     VALUES ($1,'manual',$2::date,'confirmado sem autor', 100, 'confirmado', 100)`,
    [entityId, mes]
  );
  await recusa(
    c,
    'ignorar exige motivo',
    `INSERT INTO fin_custo_previsto (entity_id, origem, competencia, descricao, valor_previsto_cents, estado)
     VALUES ($1,'manual',$2::date,'ignorado sem motivo', 100, 'ignorado')`,
    [entityId, mes]
  );
  await recusa(
    c,
    'derivado nao se apaga',
    `DELETE FROM fin_custo_previsto WHERE id=$1`,
    [alvo[0].id]
  );
  await recusa(
    c,
    'competencia tem de ser o primeiro dia do mes',
    `INSERT INTO fin_custo_previsto (entity_id, origem, competencia, descricao, valor_previsto_cents)
     VALUES ($1,'manual',$2::date,'dia 16', 100)`,
    [entityId, `${mes.slice(0, 8)}16`]
  );

  // Realizado de verdade, e depois a recusa de apagar.
  await c.query(
    `UPDATE fin_custo_previsto
        SET estado='realizado', realizado_transaction_id=$3, realizado_em=now(),
            valor_confirmado_cents=valor_previsto_cents, confirmado_por='teste', confirmado_em=now()
      WHERE entity_id=$1 AND competencia=$2::date AND origem='manual'`,
    [entityId, mes, debito[0].id]
  );
  checar('realizado com lancamento de saida e aceito', true, `lancamento ${debito[0].id}`);
  await recusa(c, 'realizado nao se apaga', `DELETE FROM fin_custo_previsto WHERE realizado_transaction_id=$1`, [
    debito[0].id
  ]);

  // ── 7. o item manual apagavel ────────────────────────────────────────────
  console.log('\n7. o unico apagamento permitido');
  await c.query(
    `INSERT INTO fin_custo_previsto (entity_id, origem, competencia, descricao, valor_previsto_cents)
     VALUES ($1,'manual',$2::date,'manual descartavel', 500)`,
    [entityId, mes]
  );
  const { rowCount: apagados } = await c.query(
    `DELETE FROM fin_custo_previsto WHERE entity_id=$1 AND descricao='manual descartavel'`,
    [entityId]
  );
  checar('item manual nao realizado se apaga', apagados === 1);

  // ── 8. as views de apoio respondem ───────────────────────────────────────
  console.log('\n8. as views de apoio');
  const { rows: cat } = await c.query(
    `SELECT count(*) n, COALESCE(sum(participacao_pct),0) soma
       FROM fin_custo_previsto_categoria_v WHERE entity_id=$1 AND competencia=$2::date`,
    [entityId, mes]
  );
  checar(
    'participacao por categoria fecha em 100%',
    Math.abs(Number(cat[0].soma) - 100) < 0.5,
    `${cat[0].n} categoria(s), soma ${Number(cat[0].soma).toFixed(2)}%`
  );

  const { rows: pend } = await c.query(
    `SELECT count(*) n, COALESCE(sum(valor_cents),0)::bigint cents
       FROM fin_custo_previsto_pendente_v WHERE entity_id=$1 AND competencia=$2::date`,
    [entityId, mes]
  );
  checar('a fila de "falta confirmar" responde', Number(pend[0].n) >= 0, `${pend[0].n} item(ns), ${brl(pend[0].cents)}`);

  // ── 9. a fronteira com quem consome (agenda diaria, 0104) ────────────────
  console.log('\n9. o contrato com quem consome esta previsao');
  const { rows: chave } = await c.query(
    `SELECT count(*) colisoes FROM (
       SELECT chave_dedupe FROM fin_custo_previsto_consolidado_v
        WHERE entra_no_total GROUP BY entity_id, chave_dedupe HAVING count(*)>1) x`
  );
  checar(
    'chave_dedupe e unica entre as linhas que somam',
    Number(chave[0].colisoes) === 0,
    'agrupar por ela nunca perde nem duplica dinheiro'
  );
  const { rows: semRegra } = await c.query(
    `SELECT count(*) n FROM fin_custo_previsto_consolidado_v
      WHERE dia_esperado IS NOT NULL AND dia_regra IS NULL`
  );
  checar('todo dia esperado tem regra escrita', Number(semRegra[0].n) === 0);
  const { rows: regras } = await c.query(
    `SELECT DISTINCT left(dia_regra, 58) r FROM fin_custo_previsto_consolidado_v
      WHERE dia_regra IS NOT NULL ORDER BY 1`
  );
  for (const r of regras) console.log(`     · ${r.r}`);

  const { rows: lacuna } = await c.query(
    `SELECT count(*) n, COALESCE(sum(realizado_cents),0)::bigint cents
       FROM fin_custo_previsto_confronto_v
      WHERE entity_id=$1 AND leitura LIKE 'realizado sem previsao%' AND competencia >= '2026-01-01'`,
    [entityId]
  );
  console.log(
    `     categorias com gasto realizado e nenhuma previsao em 2026: ${lacuna[0].n} · ${brl(lacuna[0].cents)}`
  );

  // ── panorama ─────────────────────────────────────────────────────────────
  const { rows: panorama } = await c.query(
    `SELECT to_char(competencia,'YYYY-MM') mes,
            sum(subtotal_cents)::bigint total,
            count(*) categorias
       FROM fin_custo_previsto_categoria_v WHERE entity_id=$1
      GROUP BY 1 ORDER BY 1 LIMIT 8`,
    [entityId]
  );
  console.log('\n══ custo previsto por competencia (dentro da transacao de teste) ══');
  for (const p of panorama) {
    console.log(`  ${p.mes}   ${brl(p.total).padStart(16)}   ${p.categorias} categoria(s)`);
  }
} catch (erro) {
  falhas += 1;
  console.error('\nERRO:', erro.message);
  if (erro.detail) console.error('detalhe:', erro.detail);
  if (erro.hint) console.error('dica:', erro.hint);
} finally {
  // SEMPRE. Este script nao grava.
  await c.query('ROLLBACK').catch(() => {});
  c.release();
  await pool.end();
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok} verificacao(oes) ok · ${falhas} falha(s) — ROLLBACK executado`);
process.exit(falhas === 0 ? 0 : 1);
