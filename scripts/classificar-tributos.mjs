// Classifica os tributos federais que ficaram sem categoria.
//
// POR QUE UM SCRIPT PRÓPRIO EM VEZ DE `reclassificar.mjs`
//
// A reclassificação geral aplica TODAS as regras ativas. Rodada hoje sobre 2026
// ela gravaria 1.121 linhas, e entre elas:
//
//   5.99 Despesa a classificar → 6.01 Salários   (desfaz `desinflar-folha.mjs`)
//   6.02 Pró-labore            → 6.01 Salários   (237 linhas)
//   (sem regra)                → pix-pessoa-fisica (421 linhas)
//
// A regra `pix-pessoa-fisica` tem precisão medida de 15,2% contra gabarito
// humano: ela manda para Salários tudo que começa com "Pix enviado", sem olhar
// documento nem cadastro. Rodar o motor inteiro para corrigir R$ 125 mil de
// tributo custaria re-inflar a folha em centenas de linhas — trocar um erro
// conhecido e cercado por outro maior e solto.
//
// Este arquivo faz UMA coisa: pega o que está sem categoria nenhuma, confirma
// que é tributo federal, e separa DAS de INSS pela faixa de valor que a 0035
// documenta. Não toca em linha que já tem categoria, não toca em decisão
// humana, e deixa trilha em `fin_classification_event`.
//
// Uso:
//   node scripts/classificar-tributos.mjs            dry-run (padrão)
//   node scripts/classificar-tributos.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Faixa do INSS de pró-labore, em centavos. Ver o cabeçalho da 0035. */
const INSS_MIN = 60000;
const INSS_MAX = 100000;

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const { rows: [antes] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(amount_cents),0) v FROM fin_transaction
      WHERE category_id IS NULL AND amount_cents < 0 AND transfer_status = 'nao'`
  );

  // Só o que NÃO tem categoria. Um tributo já classificado — certo ou errado —
  // é decisão de outra rodada, e sobrescrevê-lo aqui esconderia o histórico.
  const { rows: alvo } = await client.query(
    `SELECT t.id, t.entity_id, t.amount_cents,
            to_char(t.posted_on, 'YYYY-MM') AS mes,
            COALESCE(cp.name, t.counterparty_raw, '—') AS quem
       FROM fin_transaction t
       LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
      WHERE (t.category_id IS NULL OR t.classified_reason->>'motivo' = 'tributo federal')
        AND t.amount_cents < 0
        AND t.transfer_status = 'nao'
        AND t.classified_by IS DISTINCT FROM 'humano'
        AND NOT ('category_id' = ANY (t.human_locked_fields))
        AND (t.description_norm ~ '(receita federal|ministerio da fazenda|min da fazenda|darf|das simples|simples nacional|previdencia social)'
             OR cp.normalized_name ~ '(receita federal|ministerio da fazenda)')
      ORDER BY t.posted_on`
  );

  const { rows: cats } = await client.query(
    `SELECT code, id FROM fin_category WHERE code IN ('7.01','6.03')`
  );

  // A regra que JUSTIFICA cada decisão. Sem ela, `classified_by='regra'` fica
  // sem `classified_rule_id`, e o invariante D6 acusa — com razão: o badge
  // "por quê?" da tela mostraria "por regra" sem conseguir dizer qual. Este
  // script aplica as duas regras da 0035 num recorte estreito; a proveniência
  // é delas, não do arquivo.
  const { rows: regras } = await client.query(
    `SELECT slug, id FROM fin_rule WHERE slug IN ('tributos-receita-federal','inss-pro-labore')`
  );
  const regraDe = Object.fromEntries(regras.map((r) => [r.slug, r.id]));
  if (!regraDe['tributos-receita-federal'] || !regraDe['inss-pro-labore']) {
    throw new Error('regras da migração 0035 ausentes: rode `npm run db:migrate` antes');
  }
  const idDe = Object.fromEntries(cats.map((c) => [c.code, c.id]));
  if (!idDe['7.01'] || !idDe['6.03']) throw new Error('categorias 7.01/6.03 ausentes do plano de contas');

  const porMes = new Map();
  let nDas = 0;
  let nInss = 0;

  for (const t of alvo) {
    const abs = Math.abs(Number(t.amount_cents));
    const ehInss = abs >= INSS_MIN && abs <= INSS_MAX;
    const code = ehInss ? '6.03' : '7.01';
    if (ehInss) nInss += 1; else nDas += 1;

    const mes = t.mes;
    const acc = porMes.get(mes) ?? { das: 0, inss: 0 };
    acc[ehInss ? 'inss' : 'das'] += abs;
    porMes.set(mes, acc);

    await client.query(
      `INSERT INTO fin_classification_event
         (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
       VALUES ('fin_transaction', $1, 'regra', $2, true, NULL,
               jsonb_build_object('motivo', $3::text, 'valor_cents', $4::bigint,
                                  'criterio','tributo federal sem categoria; DAS e INSS separados por faixa de valor (migração 0035)'),
               'classificar-tributos')`,
      [t.id, idDe[code], ehInss ? 'INSS de pró-labore (valor fixo mensal)' : 'DAS do Simples Nacional (varia com o faturamento)', t.amount_cents]
    );

    await client.query(
      `UPDATE fin_transaction
          SET category_id = $2, nucleo = COALESCE(nucleo, 'corporativo'),
              classified_by = 'regra', classified_rule_id = $4, review_status = 'ok',
              classified_at = now(), updated_at = now(),
              classified_reason = jsonb_build_object('motivo','tributo federal', 'faixa', $3::text)
        WHERE id = $1`,
      [t.id, idDe[code], ehInss ? 'inss' : 'das', regraDe[ehInss ? 'inss-pro-labore' : 'tributos-receita-federal']]
    );

    // O lançamento ganhou categoria: o item de fila que pedia justamente isso
    // deixa de ter motivo. Deixá-lo aberto é o ruído que o invariante H1 mede —
    // trabalho já feito empurrando trabalho real para fora da tela.
    await client.query(
      `UPDATE fin_review_item
          SET status = 'resolvido', resolved_at = now()
        WHERE target_table = 'fin_transaction' AND target_id = $1 AND status = 'pendente'`,
      [t.id]
    );
  }

  console.log(`\nTributos federais — ${alvo.length} lançamentos\n`);
  console.log('  mês        DAS (Simples)         INSS          soma');
  const meses = [...porMes.keys()].sort();
  let tDas = 0;
  let tInss = 0;
  for (const m of meses) {
    const x = porMes.get(m);
    tDas += x.das;
    tInss += x.inss;
    console.log(`  ${m}  ${brl(x.das).padStart(15)}${brl(x.inss).padStart(13)}${brl(x.das + x.inss).padStart(14)}`);
  }
  console.log(`  TOTAL    ${brl(tDas).padStart(15)}${brl(tInss).padStart(13)}${brl(tDas + tInss).padStart(14)}`);
  console.log(`\n  para 7.01 Simples Nacional: ${nDas}`);
  console.log(`  para 6.03 Encargos (INSS):  ${nInss}`);

  // Confronto com a planilha do dono: é o teste que vale. Se a soma mensal não
  // bater com a linha "Impostos" dela, a separação por faixa está errada.
  const { rows: conf } = await client.query(
    `SELECT v.mes, sum(v.valor_cents) ref
       FROM fin_model_value v
      WHERE v.ano = 2026 AND v.procedencia = 'referencia'
        AND v.line_slug IN ('simples-nacional','inss')
      GROUP BY 1 ORDER BY 1`
  );
  if (conf.length) {
    console.log('\n  CONFRONTO COM A PLANILHA (linha "Impostos"):');
    console.log('  mês        ledger      planilha     diferença');
    for (const c of conf) {
      const m = `2026-${String(c.mes).padStart(2, '0')}`;
      const x = porMes.get(m) ?? { das: 0, inss: 0 };
      const nosso = x.das + x.inss;
      const dela = Math.abs(Number(c.ref));
      const d = nosso - dela;
      console.log(`  ${m}${brl(nosso).padStart(14)}${brl(dela).padStart(14)}${brl(d).padStart(14)}${d === 0 ? '  ✓' : ''}`);
    }
  }

  const { rows: [depois] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(amount_cents),0) v FROM fin_transaction
      WHERE category_id IS NULL AND amount_cents < 0 AND transfer_status = 'nao'`
  );
  console.log(`\n  saídas sem categoria antes:  ${String(antes.n).padStart(4)}  ${brl(antes.v)}`);
  console.log(`  saídas sem categoria depois: ${String(depois.n).padStart(4)}  ${brl(depois.v)}`);

  const { rows: [total] } = await client.query(`SELECT sum(amount_cents) v FROM fin_transaction`);
  console.log(`\n  âncora — soma do ledger: ${brl(total.v)} (não pode mudar)`);

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
