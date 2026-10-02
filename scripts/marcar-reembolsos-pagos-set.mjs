// Marca como PAGOS os itens de reembolso que saíram do banco em 01–02/09/2026.
//
//   node scripts/marcar-reembolsos-pagos-set.mjs            mostra o que faria
//   node scripts/marcar-reembolsos-pagos-set.mjs --aplicar  grava
//
// ---------------------------------------------------------------------------
// O DEFEITO
// ---------------------------------------------------------------------------
// As dez ordens `2026-09|fin_person:N:reembolso` foram pagas (o extrato tem os
// dez PIX), mas a ordem nasce da folha — `reimbursement_id` nulo — e nada
// devolve o "pago" ao pedido. Os 16 itens do app cobertos por elas seguiram
// `aprovado`, e `fin_reembolso_saldo_unificado_v` os oferecia de novo em
// outubro: R$ 2.957,09 que a casa pagaria pela segunda vez.
//
// O dono confirmou em 02/10/2026: "todos reembolsos do mês passado foram pagos".
//
// ---------------------------------------------------------------------------
// POR QUE POR ITEM, E NÃO `mudarStatusReembolso(id, 'pago')`
// ---------------------------------------------------------------------------
// Três pedidos (Diogo, Gabriel, Jonildo) misturam o que foi pago em setembro
// com o que a pessoa lançou depois, no mesmo cabeçalho de competência 2026-09.
// Pagar o cabeçalho marcaria como pago o que ainda se deve. A view filtra pelo
// status do ITEM, então o item basta; o cabeçalho só vira `pago` onde TODOS os
// itens foram pagos.
//
// Os dois itens cancelados do Cleber (901, 902 — R$ 508,00, pagos em 02/09 e
// cancelados por ele em 30/09) ficam FORA: se ele devolve ou abate é decisão do
// dono, e `cancelado` → `pago` apagaria o rastro do cancelamento.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ATOR = 'script:marcar-reembolsos-pagos-set';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

/*
 * [pessoa, ordem paga, itens, soma esperada em centavos, cabeçalho inteiro pago?]
 * A soma é conferida contra o banco antes de gravar: se alguém editou um valor
 * desde a medição, o script para em vez de carimbar "pago" num número novo.
 */
const CARGA = [
  ['Igor',     'PG-2026-0050', [896, 897, 898, 899, 900], 134951, 387],
  ['Fernando', 'PG-2026-0044', [894, 895],                16400,  386],
  ['Belo',     'PG-2026-0032', [905, 906],                8292,   390],
  ['Audrey',   'PG-2026-0029', [903, 904],                24017,  389],
  ['Diogo',    'PG-2026-0040', [907, 908],                46882,  null],
  ['Gabriel',  'PG-2026-0048', [910, 911],                31151,  null],
  ['Jonildo',  'PG-2026-0056', [909],                     34016,  null]
];

const pool = financePool();
const client = await pool.connect();
console.log(`\nReembolsos pagos em 01–02/09/2026 — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

try {
  await client.query('BEGIN');
  let total = 0;
  let itens = 0;

  for (const [nome, ordem, ids, esperado, cabecalho] of CARGA) {
    const { rows } = await client.query(
      `SELECT i.id, i.status, i.amount_cents, r.id AS rid, r.entity_id, p.name
         FROM fin_reimbursement_item i
         JOIN fin_reimbursement r ON r.id = i.reimbursement_id
         JOIN fin_person p ON p.id = r.person_id
        WHERE i.id = ANY($1::bigint[]) FOR UPDATE OF i`,
      [ids]
    );
    const soma = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
    if (rows.length !== ids.length) throw new Error(`${nome}: esperava ${ids.length} itens, achei ${rows.length}`);
    if (rows.some((r) => r.name !== nome)) throw new Error(`${nome}: item de outra pessoa na lista`);
    if (rows.some((r) => r.status !== 'aprovado')) throw new Error(`${nome}: item fora de 'aprovado' — já mexeram`);
    if (soma !== esperado) throw new Error(`${nome}: soma ${brl(soma)} ≠ ${brl(esperado)} medido`);

    await client.query(`UPDATE fin_reimbursement_item SET status = 'pago' WHERE id = ANY($1::bigint[])`, [ids]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         VALUES ($1, 'fin_reimbursement_item', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['status'], $5)`,
        [r.entity_id, r.id, JSON.stringify({ status: 'aprovado' }), JSON.stringify({ status: 'pago', ordem }), ATOR]
      );
    }

    if (cabecalho) {
      const { rows: abertos } = await client.query(
        `SELECT count(*)::int AS n FROM fin_reimbursement_item
          WHERE reimbursement_id = $1 AND status NOT IN ('pago', 'rejeitado', 'cancelado')`,
        [cabecalho]
      );
      if (abertos[0].n > 0) throw new Error(`${nome}: pedido ${cabecalho} ainda tem ${abertos[0].n} item(ns) em aberto`);
      await client.query(
        `UPDATE fin_reimbursement
            SET status = 'pago', notes = concat_ws(' · ', notes, $2::text)
          WHERE id = $1 AND status = 'aprovado'`,
        [cabecalho, `pago em 01–02/09/2026 pela ordem ${ordem}`]
      );
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         VALUES ($1, 'fin_reimbursement', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['status'], $5)`,
        [rows[0].entity_id, cabecalho, JSON.stringify({ status: 'aprovado' }), JSON.stringify({ status: 'pago', ordem }), ATOR]
      );
    }

    total += soma;
    itens += ids.length;
    console.log(
      `  ${nome.padEnd(9)} ${ordem}  ${String(ids.length).padStart(2)} item(ns)  R$ ${brl(soma).padStart(9)}` +
        (cabecalho ? `  · pedido ${cabecalho} → pago` : '  · pedido segue aberto (tem item novo)')
    );
  }

  // Pós-condição: nenhum dos itens pode continuar na fila do a-receber.
  const todos = CARGA.flatMap((c) => c[2]);
  const { rows: sobra } = await client.query(
    `SELECT count(*)::int AS n FROM fin_reembolso_saldo_unificado_v
      WHERE origem = 'app' AND slug = ANY($1::text[])`,
    [todos.map((id) => `app-${id}`)]
  );
  if (sobra[0].n > 0) throw new Error(`${sobra[0].n} item(ns) ainda aparecem como a receber`);

  console.log(`\n  ${itens} itens · R$ ${brl(total)}`);
  if (APLICAR) {
    await client.query('COMMIT');
    console.log('  gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('  nada gravado — rode com --aplicar.\n');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ABORTADO, nada gravado: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
