// A ordem de reembolso foi paga → os itens do app que ela pagou viram `pago`.
//
//   node scripts/baixar-reembolso-pago.mjs            mostra o que faria
//   node scripts/baixar-reembolso-pago.mjs --aplicar  grava
//
// ---------------------------------------------------------------------------
// O DEFEITO, DUAS VEZES
// ---------------------------------------------------------------------------
// A ordem de reembolso nasce da folha (`…|fin_person:N:reembolso`) e não aponta
// para item nenhum. Quando o banco a paga, nada devolve o "pago" aos itens:
// eles seguem `aprovado` e `fin_reembolso_saldo_unificado_v` os oferece de novo
// no mês seguinte. Em 02/10/2026 isso já tinha acontecido com setembro — 16
// itens, R$ 2.957,09 prestes a sair pela segunda vez, corrigidos à mão por
// `marcar-reembolsos-pagos-set.mjs` — e ia acontecer de novo com outubro.
//
// ---------------------------------------------------------------------------
// QUAIS ITENS — e por que só com a conta fechando no centavo
// ---------------------------------------------------------------------------
// Uma ordem paga, por pessoa e mês de caixa, cobre:
//   · os itens do app ainda `aprovado`, criados ANTES da ordem, com competência
//     até o mês da ordem (parcela de novembro não foi paga em outubro); e
//   · uma parcela de cada série da planilha ainda aberta.
// Se essa soma for EXATAMENTE o valor pago, os itens viram `pago`. Se não for,
// nada é tocado e a linha sai no relatório: diferença de centavo é sinal de
// que alguém pagou outra coisa, e baixa por aproximação esconderia isso.
//
// As séries da planilha não são baixadas aqui — o contador delas é outro
// problema, documentado em 0195.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ATOR = 'script:baixar-reembolso-pago';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const { rows: ordens } = await client.query(
    `SELECT pr.id, pr.code, pr.entity_id, pr.paid_cents, pr.created_at,
            split_part(pr.source_id, '|', 1) AS caixa,
            substring(pr.source_id from 'fin_person:([0-9]+):reembolso$')::bigint AS person_id,
            p.name
       FROM fin_payment_request pr
       JOIN fin_person p ON p.id = substring(pr.source_id from 'fin_person:([0-9]+):reembolso$')::bigint
      WHERE pr.source_id ~ '^[0-9]{4}-[0-9]{2}\\|fin_person:[0-9]+:reembolso$'
        AND pr.status = 'pago'
      ORDER BY pr.id`
  );

  let baixados = 0;
  console.log(`\nOrdens de reembolso pagas — ${ordens.length} · ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);
  for (const o of ordens) {
    const { rows: itens } = await client.query(
      `SELECT i.id, i.amount_cents, i.reimbursement_id
         FROM fin_reimbursement_item i
         JOIN fin_reimbursement r ON r.id = i.reimbursement_id
        WHERE r.person_id = $1
          AND i.status = 'aprovado'
          AND COALESCE(r.status, 'aprovado') NOT IN ('pago', 'rejeitado')
          AND i.created_at < $2
          AND r.reference_month <= to_date($3, 'YYYY-MM')
          AND NOT EXISTS (
            SELECT 1 FROM fin_reembolso_item a
             WHERE a.person_id = r.person_id
               AND a.competencia = date_trunc('month', r.reference_month)::date
               AND (a.valor_parcela_cents = i.amount_cents OR lower(btrim(a.descricao)) = lower(btrim(i.description))))
        FOR UPDATE OF i`,
      [o.person_id, o.created_at, o.caixa]
    );
    if (itens.length === 0) continue;

    const { rows: planilha } = await client.query(
      `SELECT coalesce(sum(valor_parcela_cents), 0)::bigint AS c
         FROM fin_reembolso_saldo_v WHERE person_id = $1 AND NOT quitado AND parcelas_restantes >= 1`,
      [o.person_id]
    );
    const somaItens = itens.reduce((s, i) => s + Number(i.amount_cents), 0);
    const esperado = somaItens + Number(planilha[0].c);
    const rotulo = `${o.code} ${o.name.slice(0, 22).padEnd(22)} pago R$ ${brl(o.paid_cents).padStart(9)}`;

    if (esperado !== Number(o.paid_cents)) {
      console.log(
        `  ≠  ${rotulo}  itens R$ ${brl(somaItens)} + planilha R$ ${brl(planilha[0].c)} = R$ ${brl(esperado)} — não baixei`
      );
      continue;
    }

    const ids = itens.map((i) => i.id);
    await client.query(`UPDATE fin_reimbursement_item SET status = 'pago' WHERE id = ANY($1::bigint[])`, [ids]);
    for (const i of itens) {
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         VALUES ($1, 'fin_reimbursement_item', $2, 'update', '{"status":"aprovado"}'::jsonb, $3::jsonb, ARRAY['status'], $4)`,
        [o.entity_id, i.id, JSON.stringify({ status: 'pago', ordem: o.code }), ATOR]
      );
    }
    // O cabeçalho vira `pago` quando não sobra item vivo nele.
    await client.query(
      `UPDATE fin_reimbursement r SET status = 'pago'
        WHERE r.id = ANY($1::bigint[]) AND r.status <> 'pago'
          AND NOT EXISTS (SELECT 1 FROM fin_reimbursement_item i
                           WHERE i.reimbursement_id = r.id AND i.status NOT IN ('pago', 'rejeitado', 'cancelado'))`,
      [[...new Set(itens.map((i) => i.reimbursement_id))]]
    );
    baixados += ids.length;
    console.log(`  +  ${rotulo}  ${ids.length} item(ns) do app baixado(s)`);
  }

  console.log(`\n  ${baixados} item(ns) baixado(s)`);
  if (APLICAR) await client.query('COMMIT');
  else await client.query('ROLLBACK');
  console.log(APLICAR ? '  gravado.\n' : '  nada gravado — rode com --aplicar.\n');
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ABORTADO, nada gravado: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
