// Muda a data de pagamento de ordens que ainda NÃO saíram para o banco.
//
//   node scripts/reprogramar-data-pagamento.mjs --data=2026-09-02
//   node scripts/reprogramar-data-pagamento.mjs --data=2026-09-02 --aplicar
//   node scripts/reprogramar-data-pagamento.mjs --data=2026-09-02 --codes=PG-2026-0029 --aplicar
//
// ---------------------------------------------------------------------------
// POR QUE SÓ RASCUNHO
// ---------------------------------------------------------------------------
// `enviarOrdemAoInter` manda `dataPagamento: scheduled_for ?? due_date`. Depois
// que a ordem sai, o banco tem uma data e este banco tem outra — e reescrever
// aqui a data de uma ordem já entregue faria a tela mentir sobre o que o Inter
// segura. Ordem em `aguardando_autorizacao` se reprograma pelo caminho que já
// existe: devolver para a fila (com motivo, que registra a tentativa nova) e
// enviar de novo.
//
// A data também não pode ser passado: o Inter recusa, e `fin_payment_execution`
// já proíbe `paid_on` futuro pelo motivo espelhado.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const DATA = process.argv.find((a) => a.startsWith('--data='))?.slice('--data='.length);
const CODES = process.argv.find((a) => a.startsWith('--codes='))?.slice('--codes='.length)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const ATOR = 'reprogramar-data-pagamento.mjs';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

if (!DATA || !/^\d{4}-\d{2}-\d{2}$/.test(DATA)) {
  console.error('\n  --data=AAAA-MM-DD é obrigatório\n');
  process.exit(1);
}

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const hoje = (await client.query(`SELECT current_date AS d`)).rows[0].d;
  if (new Date(DATA) < new Date(String(hoje).slice(0, 10))) {
    throw new Error(`${DATA} já passou (hoje é ${String(hoje).slice(0, 10)}) — o Inter recusa data no passado`);
  }

  const { rows } = await client.query(
    `SELECT r.id, r.code, r.status, r.scheduled_for, r.amount_cents,
            COALESCE(c.name, r.payee_snapshot->>'owner_name') AS favorecido, r.description
       FROM fin_payment_request r
       LEFT JOIN fin_counterparty c ON c.id = r.counterparty_id
      WHERE r.status = 'rascunho' AND r.paid_cents = 0
        AND ($1::text[] IS NULL OR r.code = ANY($1))
      ORDER BY r.id`,
    [CODES]
  );

  console.log(`\nData de pagamento → ${DATA} — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);
  if (rows.length === 0) {
    console.log('  Nenhuma ordem em rascunho corresponde.\n');
    await client.query('ROLLBACK');
    process.exit(0);
  }

  for (const r of rows) {
    const de = String(r.scheduled_for ?? '(sem data)').slice(0, 10);
    console.log(
      `  ${r.code}  R$ ${brl(r.amount_cents).padStart(9)}  ${String(r.favorecido ?? '?').slice(0, 26).padEnd(26)} ${de} → ${DATA}  ${String(r.description ?? '').slice(0, 30)}`
    );
  }
  console.log(`\n  ${rows.length} ordem(ns), R$ ${brl(rows.reduce((s, r) => s + Number(r.amount_cents), 0))}\n`);

  // O que fica de fora, dito em voz alta — é a parte que surpreende.
  const { rows: fora } = await client.query(
    `SELECT count(*)::int AS n, COALESCE(SUM(amount_cents),0)::bigint AS cents
       FROM fin_payment_request
      WHERE status = 'aguardando_autorizacao' AND paid_cents = 0`
  );
  if (fora[0].n > 0) {
    console.log(
      `  NÃO tocadas: ${fora[0].n} ordem(ns) em aguardando_autorizacao (R$ ${brl(fora[0].cents)}) —\n` +
        `  já estão no banco com a data antiga. Para mudá-las, devolva para a fila primeiro.\n`
    );
  }

  if (!APLICAR) {
    await client.query('ROLLBACK');
    console.log('  Para aplicar: acrescente --aplicar\n');
    process.exit(0);
  }

  const ids = rows.map((r) => r.id);
  const upd = await client.query(
    `UPDATE fin_payment_request
        SET scheduled_for = $1::date, updated_at = now()
      WHERE id = ANY($2::int[]) AND status = 'rascunho' AND paid_cents = 0`,
    [DATA, ids]
  );

  for (const r of rows) {
    await client.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, actor)
       SELECT entity_id, 'fin_payment_request', id, 'update',
              jsonb_build_object('scheduled_for', $2::text),
              jsonb_build_object('scheduled_for', $3::text),
              ARRAY['scheduled_for'], $4
         FROM fin_payment_request WHERE id = $1`,
      [r.id, String(r.scheduled_for ?? '').slice(0, 10), DATA, ATOR]
    );
  }

  // Pós-condição: nenhuma das alvo pode ter ficado com data diferente.
  const { rows: prova } = await client.query(
    `SELECT count(*)::int AS erradas FROM fin_payment_request
      WHERE id = ANY($1::int[]) AND scheduled_for IS DISTINCT FROM $2::date`,
    [ids, DATA]
  );
  if (prova[0].erradas > 0) throw new Error(`${prova[0].erradas} ordem(ns) não ficaram em ${DATA}`);

  await client.query('COMMIT');
  console.log(`  ✓ ${upd.rowCount} ordem(ns) reprogramada(s) para ${DATA}.\n`);
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ✗ nada mudou: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
