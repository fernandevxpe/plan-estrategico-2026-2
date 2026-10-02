// Divide em 3 parcelas o reembolso "Materiais Fe síndico" do Igor.
//
//   node scripts/parcelar-reembolso-igor.mjs            mostra o que faria
//   node scripts/parcelar-reembolso-igor.mjs --aplicar  grava
//
// ---------------------------------------------------------------------------
// O DEFEITO
// ---------------------------------------------------------------------------
// O app do time grava a compra parcelada num item só, pelo valor cheio: o item
// 924 tem R$ 1.400,34 com parcela 1 de 3 e nenhum plano. A plataforma pagaria
// tudo em outubro. O dono, em 02/10/2026: "deveria ser dividido em 3 parcelas e
// não 3x" — R$ 466,78 por mês (466,78 × 3 = 1.400,34, sem resto).
//
// ---------------------------------------------------------------------------
// O QUE GRAVA, E POR QUE AS PARCELAS FICAM EM NOVEMBRO E DEZEMBRO
// ---------------------------------------------------------------------------
// O mesmo desenho de `criarItemReembolso` (lib/financeiro/reembolsos.ts): um
// `fin_installment_plan` e um item por parcela, cada um no reembolso do seu mês.
//
//   1/3  item 924, competência 09/2026 — pago em outubro, com o resto de setembro
//   2/3  item novo, competência 11/2026
//   3/3  item novo, competência 12/2026
//
// A 2ª não vai em 10/2026 porque a 0195 libera o item quando a competência
// CHEGA: uma parcela em outubro entraria no pagamento de outubro junto com a
// 1ª. Aqui a competência da parcela futura é o mês em que ela é paga.
//
// Depende da migration 0195 — sem ela as três parcelas seriam oferecidas de uma
// vez, e o script confere isso antes de gravar.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ATOR = 'script:parcelar-reembolso-igor';
const ITEM = 924;
const TOTAL_CENTS = 140034;
const PARCELAS = 3;
const PARCELA_CENTS = TOTAL_CENTS / PARCELAS;
const FUTURAS = [
  [2, '2026-11-01'],
  [3, '2026-12-01']
];
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

if (!Number.isInteger(PARCELA_CENTS)) throw new Error('a divisão deixaria resto de centavo');

const pool = financePool();
const client = await pool.connect();
console.log(`\nIgor — "Materiais Fe síndico" em ${PARCELAS}× — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

const aPagar = async () =>
  Number(
    (
      await client.query(
        `SELECT coalesce(sum(valor_parcela_cents), 0)::bigint AS c
           FROM fin_reembolso_saldo_unificado_v
          WHERE person_id = $1 AND NOT quitado AND parcelas_restantes >= 1`,
        [pessoaId]
      )
    ).rows[0].c
  );

let pessoaId = 0;
try {
  await client.query('BEGIN');

  const { rows } = await client.query(
    `SELECT i.id, i.amount_cents, i.status, i.description, i.expense_date::text, i.category_id,
            i.reimbursement_type, i.installment_number, i.installment_total, i.installment_plan_id,
            r.person_id, r.entity_id, r.reference_month::text, p.name
       FROM fin_reimbursement_item i
       JOIN fin_reimbursement r ON r.id = i.reimbursement_id
       JOIN fin_person p ON p.id = r.person_id
      WHERE i.id = $1 FOR UPDATE OF i`,
    [ITEM]
  );
  const item = rows[0];
  if (!item) throw new Error(`item ${ITEM} não existe`);
  if (item.name !== 'Igor') throw new Error(`item ${ITEM} é de ${item.name}, não do Igor`);
  if (Number(item.amount_cents) !== TOTAL_CENTS) throw new Error(`valor mudou: R$ ${brl(item.amount_cents)}`);
  if (item.status !== 'aprovado') throw new Error(`item está '${item.status}' — já mexeram`);
  if (item.installment_plan_id) throw new Error('item já tem plano');
  pessoaId = Number(item.person_id);

  const antes = await aPagar();

  const plano = await client.query(
    `INSERT INTO fin_installment_plan
       (entity_id, person_id, title, kind, total_amount_cents, installments_total,
        monthly_amount_cents, first_due_date, category_id, status, notes)
     VALUES ($1, $2, 'Materiais Fe síndico', 'reembolso', $3, $4, $5, $6::date, $7, 'ativo', $8)
     RETURNING id`,
    [
      item.entity_id,
      pessoaId,
      TOTAL_CENTS,
      PARCELAS,
      PARCELA_CENTS,
      item.reference_month,
      item.category_id,
      `Lançado no app como item único de R$ ${brl(TOTAL_CENTS)} (item ${ITEM}); dividido pelo dono em 02/10/2026.`
    ]
  );
  const planoId = plano.rows[0].id;

  await client.query(
    `UPDATE fin_reimbursement_item SET amount_cents = $2, installment_plan_id = $3 WHERE id = $1`,
    [ITEM, PARCELA_CENTS, planoId]
  );
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
     VALUES ($1, 'fin_reimbursement_item', $2, 'update', $3::jsonb, $4::jsonb,
             ARRAY['amount_cents','installment_plan_id'], $5)`,
    [
      item.entity_id,
      ITEM,
      JSON.stringify({ amount_cents: TOTAL_CENTS, installment_plan_id: null }),
      JSON.stringify({ amount_cents: PARCELA_CENTS, installment_plan_id: planoId }),
      ATOR
    ]
  );
  console.log(`  1/${PARCELAS}  item ${ITEM}  competência ${item.reference_month.slice(0, 7)}  R$ ${brl(TOTAL_CENTS)} → R$ ${brl(PARCELA_CENTS)}`);

  const base = item.description.replace(/\s*\(pago:.*$/, '');
  for (const [n, mes] of FUTURAS) {
    let { rows: cab } = await client.query(
      `SELECT id, status FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
      [pessoaId, mes]
    );
    if (cab[0]?.status === 'pago') throw new Error(`o reembolso de ${mes.slice(0, 7)} já está pago`);
    if (!cab[0]) {
      ({ rows: cab } = await client.query(
        `INSERT INTO fin_reimbursement (entity_id, person_id, reference_month, status, approved_at, approved_by, notes)
         VALUES ($1, $2, $3::date, 'aprovado', now(), 'lançado pelo financeiro', $4) RETURNING id, status`,
        [item.entity_id, pessoaId, mes, `parcela ${n}/${PARCELAS} de compra de ${item.expense_date}`]
      ));
    }
    const novo = await client.query(
      `INSERT INTO fin_reimbursement_item
         (reimbursement_id, category_id, reimbursement_type, description, expense_date, amount_cents,
          installment_plan_id, installment_number, installment_total, status)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, 'aprovado') RETURNING id`,
      [
        cab[0].id,
        item.category_id,
        item.reimbursement_type,
        `${base} ${n}/${PARCELAS}`,
        // A data é a da COMPRA, igual nas três: é ela que amarra a parcela ao gasto.
        item.expense_date,
        PARCELA_CENTS,
        planoId,
        n,
        PARCELAS
      ]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_reimbursement_item', $2, 'insert', $3::jsonb,
               ARRAY['description','amount_cents','installment_plan_id'], $4)`,
      [
        item.entity_id,
        novo.rows[0].id,
        JSON.stringify({ reference_month: mes, amount_cents: PARCELA_CENTS, installment_plan_id: planoId, origem_item: ITEM }),
        ATOR
      ]
    );
    console.log(`  ${n}/${PARCELAS}  item ${novo.rows[0].id}  competência ${mes.slice(0, 7)}  R$ ${brl(PARCELA_CENTS)}`);
  }

  // Pós-condições: o plano fecha no total, e o a-pagar de agora cai exatamente
  // o que foi empurrado para frente — nem as parcelas futuras entraram.
  const { rows: soma } = await client.query(
    `SELECT sum(amount_cents)::bigint AS c, count(*)::int AS n FROM fin_reimbursement_item WHERE installment_plan_id = $1`,
    [planoId]
  );
  if (Number(soma[0].c) !== TOTAL_CENTS || soma[0].n !== PARCELAS) {
    throw new Error(`plano não fecha: ${soma[0].n} itens somando R$ ${brl(soma[0].c)}`);
  }
  const depois = await aPagar();
  if (antes - depois !== TOTAL_CENTS - PARCELA_CENTS) {
    throw new Error(
      `a-pagar foi de R$ ${brl(antes)} para R$ ${brl(depois)}; esperava cair R$ ${brl(TOTAL_CENTS - PARCELA_CENTS)} — a 0195 está aplicada?`
    );
  }

  console.log(`\n  a pagar ao Igor agora: R$ ${brl(antes)} → R$ ${brl(depois)}`);
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
