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
// ---------------------------------------------------------------------------
// AS SÉRIES DA PLANILHA ANDAM AQUI (desde 30/10/2026, junto com a 0198)
// ---------------------------------------------------------------------------
// A linha de competência M de uma série é paga no 1º dia útil de M+1, dentro
// da ordem `M+1|fin_person:N:reembolso`. Antes, nada gravava essa linha: as 12
// séries pararam em 2026-07 e a tela mostrava "Curso LGR 03/10" com a 5/10
// já paga — R$ 4.419,00 de saldo que não existia (0198 conserta o passado).
//
// Agora, para cada ordem paga do mês de caixa C, a conta é:
//   itens do app ainda abertos + itens do app que ESTA ordem já baixou
//   (audit `ordem`) + uma parcela de cada série aberta em C−1
//   (+ a parcela de série cancelada DEPOIS da ordem: a TV do Fernando estava
//   no PIX de 02/09, R$ 108,29, e só foi cancelada em 02/10).
// Fechando no centavo, além de baixar os itens, grava a linha C−1 de cada
// série com parcela+1 (ON CONFLICT DO NOTHING). Série já gravada em C−1 entra
// na soma e não é regravada — é isso que torna o script idempotente com a
// 0198. Série cancelada não ganha linha: a 0194 a tirou do saldo.
// Ordem sem item do app também é processada: o Adryan só tinha a série.
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
      ORDER BY split_part(pr.source_id, '|', 1), pr.id`
  );

  let baixados = 0;
  let gravadas = 0;
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

    // Itens do app que esta mesma ordem já baixou numa rodada anterior (ou à mão,
    // em `marcar-reembolsos-pagos-set.mjs`): continuam fazendo parte da soma.
    const { rows: jaBaixados } = await client.query(
      `SELECT coalesce(sum(i.amount_cents), 0)::bigint AS c
         FROM fin_reimbursement_item i
        WHERE i.id IN (SELECT l.target_id FROM fin_audit_log l
                        WHERE l.target_table = 'fin_reimbursement_item' AND l.after->>'ordem' = $1)`,
      [o.code]
    );

    // Séries da pessoa em C−1: `gravada` = já tem a linha; senão, aberta se a
    // última linha é de C−2 e ainda não chegou ao total.
    const { rows: series } = await client.query(
      `WITH alvo AS (SELECT (to_date($2, 'YYYY-MM') - interval '1 month')::date AS m),
            u AS (SELECT DISTINCT ON (slug) *
                    FROM fin_reembolso_item, alvo
                   WHERE person_id = $1 AND competencia <= alvo.m
                   ORDER BY slug, competencia DESC, parcela DESC)
       SELECT u.entity_id, u.slug, u.descricao, u.parcela, u.parcelas_total, u.valor_parcela_cents,
              u.categoria_livre, alvo.m::text AS alvo,
              (u.competencia = alvo.m) AS gravada,
              c.cancelado_em
         FROM u CROSS JOIN alvo
         LEFT JOIN fin_reembolso_slug_cancelado c ON c.person_id = $1 AND c.slug = u.slug
        WHERE u.parcelas_total > 1
          AND ( u.competencia = alvo.m
             OR (u.competencia = (alvo.m - interval '1 month')::date AND u.parcela < u.parcelas_total) )
          AND (c.id IS NULL OR c.cancelado_em > $3)`,
      [o.person_id, o.caixa, o.created_at]
    );
    const aGravar = series.filter((x) => !x.gravada && !x.cancelado_em);
    if (itens.length === 0 && aGravar.length === 0) continue; // nada a fazer: em dia

    const somaItens = itens.reduce((s, i) => s + Number(i.amount_cents), 0);
    const somaSeries = series.reduce((s, x) => s + Number(x.valor_parcela_cents), 0);
    const esperado = somaItens + Number(jaBaixados[0].c) + somaSeries;
    const rotulo = `${o.code} ${o.name.slice(0, 22).padEnd(22)} pago R$ ${brl(o.paid_cents).padStart(9)}`;

    if (esperado !== Number(o.paid_cents)) {
      console.log(
        `  ≠  ${rotulo}  itens R$ ${brl(somaItens)} + já baixados R$ ${brl(jaBaixados[0].c)} + séries R$ ${brl(somaSeries)} = R$ ${brl(esperado)} — não baixei`
      );
      continue;
    }

    for (const x of aGravar) {
      const n = x.parcela + 1;
      const m = x.descricao.match(/([0-9]+)(\s*\/\s*[0-9]+)\s*$/);
      const descricao = m
        ? x.descricao.slice(0, m.index) + String(n).padStart(m[1].length, '0') + m[2]
        : `${x.descricao} ${n}/${x.parcelas_total}`;
      const r = await client.query(
        `INSERT INTO fin_reembolso_item
                (entity_id, person_id, slug, descricao, competencia, valor_parcela_cents,
                 parcela, parcelas_total, categoria_livre, fonte, nota, criado_por)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (person_id, slug, competencia) DO NOTHING`,
        [x.entity_id, o.person_id, x.slug, descricao, x.alvo, x.valor_parcela_cents, n, x.parcelas_total,
         x.categoria_livre, `ordem ${o.code} paga`, `parcela paga pela ordem ${o.code} (${o.caixa})`, ATOR]
      );
      console.log(`     série ${x.slug.padEnd(24)} ${x.alvo.slice(0, 7)}  ${descricao.padEnd(32)} R$ ${brl(x.valor_parcela_cents)}${r.rowCount ? '' : '  (já existia)'}`);
      gravadas += r.rowCount;
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
    console.log(`  +  ${rotulo}  ${ids.length} item(ns) do app baixado(s), ${aGravar.length} parcela(s) de série`);
  }

  console.log(`\n  ${baixados} item(ns) baixado(s) · ${gravadas} parcela(s) de série gravada(s)`);
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
