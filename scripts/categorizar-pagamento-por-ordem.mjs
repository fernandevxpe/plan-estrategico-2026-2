// O PIX que pagou uma ORDEM herda a natureza dela: reembolso → 6.05, comissão → 4.01.
//
//   node scripts/categorizar-pagamento-por-ordem.mjs            mostra o que faria
//   node scripts/categorizar-pagamento-por-ordem.mjs --aplicar  grava
//
// ---------------------------------------------------------------------------
// O DEFEITO, MEDIDO EM 02/10/2026
// ---------------------------------------------------------------------------
// O app do Fernando acusava "faltou receber" em agosto: o reembolso de
// R$ 1.440,76 (PG-2026-0044, pago em 01/09) estava no extrato como 6.02
// pró-labore, porque a categoria de PIX a pessoa do time vem do VÍNCULO
// (sócio → 6.02, MEI → 6.01 — `classificar-custo-pessoas.mjs` e o gatilho
// `fin_transaction_categoria_pessoa`). A conferência do mês casou o PIX com a
// comissão (R$ 10,00 prevista), mostrou R$ 1.430,76 "a mais" e o reembolso
// inteiro "faltando". O dinheiro chegou; o rótulo é que mentia.
//
// A regra do vínculo não tem como saber o que um PIX é. A ORDEM sabe: o
// `source_id` dela termina em `:reembolso`, `:salario`, `:comissao…`. E a
// conciliação já liga ordem e PIX em `fin_payment_execution`, por código de
// solicitação do banco — prova, não palpite.
//
// ---------------------------------------------------------------------------
// SÓ REEMBOLSO E COMISSÃO — salário e pró-labore ficam com o vínculo
// ---------------------------------------------------------------------------
// `fin_time_remuneracao_mes_v` (0171) separa o salário do sócio SUBTRAINDO o
// salário base do total em 6.02. Mover o salário de um sócio para 6.01 faria
// a view tirar a base duas vezes. Reembolso e comissão não têm essa conta:
// 6.05 e 4.01 são lidos direto.
//
// A categoria sai TRAVADA (`category_id` em `human_locked_fields`). Sem a trava,
// a importação seguinte desfazia tudo: em 02/10/2026, 22h46, o pipeline de
// produção reimportou a janela de 45 dias do Inter e devolveu os 30 PIX para
// 6.01/6.02 pela regra do favorecido. A trava é a mesma que a importação já
// respeita para decisão humana — e aqui a decisão tem prova: a ordem paga.
//
// Respeita `human_locked_fields` (decisão humana vence) e não mexe em quem já
// está na categoria certa. Rodar duas vezes não muda nada na segunda — por
// isso pode entrar no agendador, logo depois da conciliação.
import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ATOR = 'script:categorizar-pagamento-por-ordem';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const pool = financePool();
const client = await pool.connect();
const lote = randomUUID();

try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT t.id AS tx_id, t.entity_id, -t.amount_cents AS cents, t.posted_on::text AS dia,
            t.category_id, cat.code AS de, t.classified_by, t.classified_rule_id, t.human_locked_fields,
            pr.code AS ordem, alvo.id AS para_id, alvo.code AS para
       FROM fin_payment_execution ex
       JOIN fin_payment_request pr ON pr.id = ex.payment_request_id
       JOIN fin_transaction t ON t.id = ex.transaction_id
       LEFT JOIN fin_category cat ON cat.id = t.category_id
       JOIN fin_category alvo
         ON alvo.entity_id = t.entity_id
        AND alvo.code = CASE WHEN pr.source_id ~ ':reembolso$' THEN '6.05'
                             WHEN pr.source_id ~ ':comissao(:|$)' THEN '4.01' END
      WHERE pr.source_id ~ '\\|fin_person:[0-9]+:(reembolso$|comissao)'
        AND t.category_id IS DISTINCT FROM alvo.id
        AND NOT ('category_id' = ANY (COALESCE(t.human_locked_fields, '{}')))
      ORDER BY t.posted_on, pr.code
      FOR UPDATE OF t`
  );

  console.log(`\nPIX de ordem com a natureza errada — ${rows.length} · ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);
  for (const r of rows) {
    console.log(`  ${r.dia}  ${r.ordem}  R$ ${brl(r.cents).padStart(10)}  ${r.de ?? '(sem)'} → ${r.para}`);
    await client.query(
      `INSERT INTO fin_classification_event
         (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
       VALUES ('fin_transaction', $1, 'fato_estrutural', $2, true, $3::jsonb, $4::jsonb, $5)`,
      [
        r.tx_id,
        r.para_id,
        JSON.stringify({ category_id: r.category_id, classified_by: r.classified_by, classified_rule_id: r.classified_rule_id }),
        JSON.stringify({ motivo: 'natureza da ordem de pagamento', ordem: r.ordem, lote }),
        ATOR
      ]
    );
    // `classified_rule_id = NULL` no mesmo SET: sem ele estoura a paridade de
    // versão de regra (ver lib/financeiro/categorizacao.ts).
    await client.query(
      `UPDATE fin_transaction
          SET category_id = $2, classified_by = 'fato_estrutural', classified_rule_id = NULL, classified_at = now(),
              human_locked_fields = (SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                                       FROM unnest(COALESCE(human_locked_fields, '{}') || ARRAY['category_id']) AS f),
              classified_reason = jsonb_build_object('motivo', 'natureza da ordem de pagamento', 'ordem', $3::text, 'lote', $4::text),
              updated_at = now()
        WHERE id = $1`,
      [r.tx_id, r.para_id, r.ordem, lote]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       VALUES ($1, 'fin_transaction', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['category_id'], $5)`,
      [r.entity_id, r.tx_id, JSON.stringify({ category: r.de }), JSON.stringify({ category: r.para, ordem: r.ordem, lote }), ATOR]
    );
  }

  if (APLICAR) {
    await client.query('COMMIT');
    console.log(rows.length ? `\n  gravado · lote ${lote}\n` : '');
  } else {
    await client.query('ROLLBACK');
    console.log(rows.length ? '\n  nada gravado — rode com --aplicar.\n' : '');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ABORTADO, nada gravado: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
