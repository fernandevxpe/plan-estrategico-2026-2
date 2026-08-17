// A prova de que a agenda diária não conta o mesmo dinheiro duas vezes.
//
// ---------------------------------------------------------------------------
// POR QUE ESTE TESTE EXISTE
// ---------------------------------------------------------------------------
// Esta base já somou R$ 1,27 milhão falso por empilhar camadas de previsão sem
// trava (migration 0060). A 0061 resolveu com "cobrança emitida vence
// projeção"; a 0104 estendeu a mesma disciplina ao DIA. A diferença entre uma
// trava que funciona e uma que parece funcionar é este arquivo.
//
// O defeito que ele procura é silencioso na direção pior: um total inflado não
// parece errado, parece bom. Ninguém abre um chamado porque a receita prevista
// subiu.
//
// ---------------------------------------------------------------------------
// COMO ELE PROVA
// ---------------------------------------------------------------------------
// Não por inspeção de código, e não confiando na assertiva da própria
// migration. Ele CONFRONTA a agenda com uma fonte independente já validada
// (`fin_previsao_evento_v`, a previsão mensal), e depois ESCREVE de verdade —
// materializa, confirma, ajusta, ignora — dentro de uma transação, para provar
// que a trava continua de pé depois de a decisão humana entrar. No fim,
// ROLLBACK: o teste não deixa uma linha para trás.
//
// Uso:
//   node scripts/test-agenda-dia.mjs
//   node scripts/test-agenda-dia.mjs --verbose
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const VERBOSE = process.argv.includes('--verbose');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let ok = 0;
let falhas = 0;
const detalhes = [];

function afirma(titulo, condicao, evidencia) {
  if (condicao) {
    ok += 1;
    if (VERBOSE) console.log(`  ✓ ${titulo}${evidencia ? ` — ${evidencia}` : ''}`);
  } else {
    falhas += 1;
    detalhes.push(`${titulo}${evidencia ? `\n      ${evidencia}` : ''}`);
    console.log(`  ✗ ${titulo}${evidencia ? ` — ${evidencia}` : ''}`);
  }
}

const pool = financePool();
const c = await pool.connect();

try {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout = '20s'");

  // A 0104 pode ainda não estar aplicada: quem aplica migration nesta base é o
  // principal, não a frente que a escreve. Quando ela falta, o teste a aplica
  // DENTRO da própria transação e desfaz junto com o resto — assim ele vale
  // como validação antes de aplicar e como regressão depois, sem duas versões
  // do mesmo arquivo divergindo.
  const existe = await c.query(`SELECT to_regclass('public.fin_agenda_dia_v') AS v`);
  if (!existe.rows[0].v) {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    console.log('\n(0104 ainda não aplicada — aplicando nesta transação, que termina em ROLLBACK)');
    await c.query(readFileSync(resolve(raiz, 'db/migrations/0104_fin_agenda_dia.sql'), 'utf8'));
  }

  const { rows: [ent] } = await c.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
  const entityId = Number(ent.id);

  // A âncora de dinheiro, antes de tudo.
  const ancoraSQL = `SELECT a.slug, COALESCE(SUM(t.amount_cents), 0) AS calc
                       FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
                      GROUP BY 1 ORDER BY 1`;
  const ancoraAntes = (await c.query(ancoraSQL)).rows;

  // =======================================================================
  console.log('\n[1] A trava: uma chave, um somador');
  // =======================================================================
  const dup = await c.query(`
    SELECT chave_dedupe, count(*) n, sum(valor_cents) v
      FROM fin_agenda_dia_v WHERE entra_no_total
     GROUP BY 1 HAVING count(*) > 1 ORDER BY 3 DESC NULLS LAST LIMIT 5`);
  afirma(
    'nenhuma chave_dedupe se repete entre linhas que somam',
    dup.rowCount === 0,
    dup.rowCount ? `${dup.rowCount} repetida(s), ex.: ${dup.rows[0].chave_dedupe}` : 'zero repetidas'
  );

  const dupOrigem = await c.query(`
    SELECT count(*)::int n FROM (
      SELECT dia, origem_tabela, origem_id, direcao FROM fin_agenda_dia_v
       WHERE entra_no_total AND origem_id IS NOT NULL
       GROUP BY 1,2,3,4 HAVING count(*) > 1) x`);
  afirma(
    'nenhuma origem soma duas vezes no mesmo dia',
    dupOrigem.rows[0].n === 0,
    `${dupOrigem.rows[0].n} colisão(ões)`
  );

  const semChave = await c.query(`
    SELECT count(*)::int n FROM fin_agenda_dia_v
     WHERE dia IS NULL OR chave_dedupe IS NULL OR origem_tabela IS NULL`);
  afirma(
    'toda linha tem dia, chave de deduplicação e origem',
    semChave.rows[0].n === 0,
    `${semChave.rows[0].n} linha(s) fora do alcance de qualquer trava`
  );

  // =======================================================================
  console.log('\n[2] A soma do mês bate com a previsão mensal já validada');
  // =======================================================================
  const prova = await c.query(`SELECT * FROM fin_agenda_prova_v ORDER BY competencia, direcao`);
  const ruins = prova.rows.filter((r) => !r.delta_explicado);
  afirma(
    `a soma da agenda bate com fin_previsao_evento_v em todos os ${prova.rowCount} confrontos mês×direção`,
    ruins.length === 0,
    ruins.length
      ? ruins.map((r) => `${String(r.competencia).slice(0, 7)}/${r.direcao} delta ${brl(r.delta_cents)}`).join(' · ')
      : 'delta zero ou explicado em todos'
  );

  // Sem nenhum item na base, o delta tem de ser exatamente zero — não só
  // "explicado". A distinção importa: `delta_explicado` aceita decisão humana,
  // e antes de existir decisão nenhuma o único valor aceitável é 0.
  const itensExistentes = await c.query(
    `SELECT (SELECT count(*) FROM fin_custo_previsto) +
            (SELECT count(*) FROM fin_receita_prevista) AS n`
  );
  if (Number(itensExistentes.rows[0].n) === 0) {
    const naoZero = prova.rows.filter((r) => Number(r.delta_cents) !== 0);
    afirma(
      'com a base sem itens, o delta é exatamente zero (não apenas explicado)',
      naoZero.length === 0,
      naoZero.length ? `${naoZero.length} mês(es) com delta` : 'zero em todos'
    );
  }

  // =======================================================================
  console.log('\n[3] O passado é história, o futuro é previsão');
  // =======================================================================
  const tempo = await c.query(`
    SELECT tempo, count(*)::int n,
           count(*) FILTER (WHERE procedencia = 'projetado')::int projetadas,
           min(dia) d0, max(dia) d1
      FROM fin_agenda_dia_v GROUP BY 1`);
  const passado = tempo.rows.find((r) => r.tempo === 'passado');
  afirma(
    'o passado não é projetado: nenhuma linha de projeção antes de hoje',
    !passado || passado.projetadas === 0,
    passado ? `${passado.n} linha(s) no passado, ${passado.projetadas} projetada(s)` : 'sem passado'
  );

  const vencidoDuplo = await c.query(`
    SELECT count(*)::int n FROM fin_agenda_dia_v WHERE camada = 'receber_vencido'`);
  afirma(
    'a camada receber_vencido (ancorada em hoje) não entra na agenda — o vencido aparece no dia real',
    vencidoDuplo.rows[0].n === 0,
    `${vencidoDuplo.rows[0].n} linha(s) ancorada(s) em hoje`
  );

  const saldoPassado = await c.query(`
    SELECT count(*)::int n FROM fin_agenda_resumo_dia_v
     WHERE tempo = 'passado' AND saldo_previsto_cents IS NOT NULL`);
  afirma(
    'saldo projetado é NULL no passado (o saldo de ontem é o extrato de ontem)',
    saldoPassado.rows[0].n === 0,
    `${saldoPassado.rows[0].n} dia(s) passado(s) com saldo inventado`
  );

  // =======================================================================
  console.log('\n[4] Recorrente e parcelado continuam sendo coisas diferentes');
  // =======================================================================
  const series = await c.query(`
    SELECT tipo, fim_declarado, count(*)::int n,
           count(*) FILTER (WHERE end_month IS NOT NULL)::int com_fim
      FROM fin_agenda_serie_v GROUP BY 1,2 ORDER BY 1`);
  const assinatura = series.rows.find((r) => r.tipo === 'assinatura');
  const parcelamento = series.rows.find((r) => r.tipo === 'parcelamento');
  const observado = series.rows.find((r) => r.tipo === 'padrao_observado');

  afirma(
    'assinatura NÃO tem fim declarado e parcelamento TEM',
    (!assinatura || assinatura.com_fim === 0) && (!parcelamento || parcelamento.com_fim === parcelamento.n),
    `assinatura ${assinatura?.n ?? 0} (${assinatura?.com_fim ?? 0} com fim) · ` +
      `parcelamento ${parcelamento?.n ?? 0} (${parcelamento?.com_fim ?? 0} com fim)`
  );
  afirma(
    'padrão observado declara que o fim dele é IGNORÂNCIA, não natureza (fim_declarado = false)',
    !observado || observado.fim_declarado === false,
    `${observado?.n ?? 0} série(s) detectada(s) no histórico`
  );

  // =======================================================================
  console.log('\n[5] A escrita não fura a trava — materializar, confirmar, ajustar, ignorar');
  // =======================================================================
  const alvo = await c.query(`
    SELECT competencia, origem_ref, valor_projetado_cents, dia_esperado
      FROM fin_custo_previsto_derivado_v
     WHERE entra_no_saldo AND valor_projetado_cents > 0
     ORDER BY valor_projetado_cents DESC LIMIT 1`);

  if (!alvo.rowCount) {
    afirma('há projeção de saída para exercitar a escrita', false, 'nenhuma projeção somável no horizonte');
  } else {
    const a = alvo.rows[0];
    const mes = String(a.competencia).slice(0, 10);
    const totalAntes = await c.query(
      `SELECT sum(valor_cents) v FROM fin_agenda_dia_v
        WHERE entra_no_total AND direcao = 'pagar' AND competencia = $1::date`,
      [mes]
    );

    // 5a. Materializar não muda o total do mês.
    await c.query(
      `INSERT INTO fin_custo_previsto
         (entity_id, origem, origem_ref, origem_camada, competencia, descricao,
          category_id, nucleo, cost_center_id, counterparty_id, dia_esperado, dia_regra,
          valor_previsto_cents, created_by)
       SELECT d.entity_id, 'derivado', d.origem_ref, d.origem_camada, d.competencia, d.descricao,
              d.category_id, d.nucleo, d.cost_center_id, d.counterparty_id, d.dia_esperado, d.dia_regra,
              d.valor_projetado_cents, 'test-agenda'
         FROM fin_custo_previsto_derivado_v d
        WHERE d.entity_id = $1 AND d.competencia = $2::date AND d.origem_ref = $3`,
      [entityId, mes, a.origem_ref]
    );
    const totalMat = await c.query(
      `SELECT sum(valor_cents) v FROM fin_agenda_dia_v
        WHERE entra_no_total AND direcao = 'pagar' AND competencia = $1::date`,
      [mes]
    );
    afirma(
      'materializar uma projeção NÃO muda o total do mês (a projeção cala e o item herda)',
      String(totalAntes.rows[0].v) === String(totalMat.rows[0].v),
      `${brl(totalAntes.rows[0].v)} → ${brl(totalMat.rows[0].v)}`
    );

    const dupDepois = await c.query(`
      SELECT count(*)::int n FROM (
        SELECT chave_dedupe FROM fin_agenda_dia_v WHERE entra_no_total
         GROUP BY 1 HAVING count(*) > 1) x`);
    afirma(
      'depois de materializar, nenhuma chave soma duas vezes',
      dupDepois.rows[0].n === 0,
      `${dupDepois.rows[0].n} repetida(s)`
    );

    const { rows: [item] } = await c.query(
      `SELECT id FROM fin_custo_previsto WHERE entity_id = $1 AND competencia = $2::date AND origem_ref = $3`,
      [entityId, mes, a.origem_ref]
    );

    // 5b. Confirmar com ajuste move o total pelo ajuste, e a prova continua explicando.
    const ajuste = 12345;
    const novoValor = Number(a.valor_projetado_cents) + ajuste;
    await c.query(
      `UPDATE fin_custo_previsto
          SET estado = 'confirmado', valor_confirmado_cents = $2,
              confirmado_por = 'test-agenda', confirmado_em = now()
        WHERE id = $1`,
      [item.id, novoValor]
    );
    const totalConf = await c.query(
      `SELECT sum(valor_cents) v FROM fin_agenda_dia_v
        WHERE entra_no_total AND direcao = 'pagar' AND competencia = $1::date`,
      [mes]
    );
    afirma(
      'confirmar com ajuste move o total EXATAMENTE pelo ajuste',
      Number(totalConf.rows[0].v) - Number(totalAntes.rows[0].v) === ajuste,
      `delta ${brl(Number(totalConf.rows[0].v) - Number(totalAntes.rows[0].v))}, ajuste ${brl(ajuste)}`
    );

    const provaConf = await c.query(
      `SELECT * FROM fin_agenda_prova_v WHERE competencia = $1::date AND direcao = 'pagar'`,
      [mes]
    );
    afirma(
      'a prova continua explicando o delta depois da confirmação',
      provaConf.rows.every((r) => r.delta_explicado),
      provaConf.rows.map((r) => `delta ${brl(r.delta_cents)} = manual ${brl(r.manual_cents)} + ajuste ${brl(r.ajuste_humano_cents)}`).join(' · ')
    );

    // 5c. Ajustar o dia move a linha no calendário sem mexer no total do mês.
    const diaNovo = await c.query(
      `UPDATE fin_custo_previsto SET dia_esperado = dia_esperado + 3, dia_regra = 'ajustado à mão por test-agenda'
        WHERE id = $1 RETURNING dia_esperado`,
      [item.id]
    );
    const totalDia = await c.query(
      `SELECT sum(valor_cents) v FROM fin_agenda_dia_v
        WHERE entra_no_total AND direcao = 'pagar' AND competencia = $1::date`,
      [mes]
    );
    afirma(
      'mudar o dia esperado NÃO muda o total do mês',
      String(totalConf.rows[0].v) === String(totalDia.rows[0].v),
      `movido para ${String(diaNovo.rows[0].dia_esperado).slice(0, 10)}, total ${brl(totalDia.rows[0].v)}`
    );

    // 5d. "Não vai acontecer" tira do total e mantém visível.
    await c.query(
      `UPDATE fin_custo_previsto
          SET estado = 'ignorado', ignorado_motivo = 'teste: fornecedor cancelou'
        WHERE id = $1`,
      [item.id]
    );
    const linhaIgnorada = await c.query(
      `SELECT entra_no_total, motivo_nao_soma FROM fin_agenda_dia_v WHERE item_id = $1`,
      [item.id]
    );
    afirma(
      '"não vai acontecer" tira do total E mantém a linha visível com o motivo',
      linhaIgnorada.rowCount > 0 &&
        linhaIgnorada.rows.every((r) => r.entra_no_total === false && r.motivo_nao_soma),
      linhaIgnorada.rows[0]?.motivo_nao_soma ?? 'linha sumiu da agenda'
    );

    // E a projeção NÃO ressuscita: ignorar é decisão sobre o dinheiro.
    const projRessuscitada = await c.query(
      `SELECT count(*)::int n FROM fin_agenda_dia_v
        WHERE entra_no_total AND competencia = $1::date AND origem_ref = $2`,
      [mes, a.origem_ref]
    );
    afirma(
      'ignorar o item NÃO ressuscita a projeção que o originou',
      projRessuscitada.rows[0].n === 0,
      `${projRessuscitada.rows[0].n} linha(s) somando para a chave ignorada`
    );
  }

  // =======================================================================
  console.log('\n[6] Previsto nunca vira realizado, e o sinal é conferido');
  // =======================================================================
  const { rows: [credito] } = await c.query(
    `SELECT id FROM fin_transaction WHERE amount_cents > 0 AND entity_id = $1 LIMIT 1`,
    [entityId]
  );
  await c.query('SAVEPOINT s_sinal');
  let recusou = false;
  try {
    await c.query(
      `INSERT INTO fin_receita_prevista
         (entity_id, origem, competencia, descricao, valor_previsto_cents, estado,
          valor_confirmado_cents, confirmado_por, confirmado_em, realizado_transaction_id, realizado_em)
       VALUES ($1, 'manual', date_trunc('month', now())::date, 'teste de sinal', 1000, 'realizado',
               1000, 'test-agenda', now(), $2, now())`,
      [entityId, credito.id]
    );
  } catch {
    recusou = true;
  }
  await c.query('ROLLBACK TO SAVEPOINT s_sinal');
  afirma(
    'receita realizada por um CRÉDITO é aceita (o sinal certo passa)',
    !recusou,
    recusou ? 'o gatilho recusou um crédito' : `lançamento ${credito.id}`
  );

  const { rows: [debito] } = await c.query(
    `SELECT id FROM fin_transaction WHERE amount_cents < 0 AND entity_id = $1 LIMIT 1`,
    [entityId]
  );
  await c.query('SAVEPOINT s_sinal2');
  let recusouDebito = false;
  try {
    await c.query(
      `INSERT INTO fin_receita_prevista
         (entity_id, origem, competencia, descricao, valor_previsto_cents, estado,
          valor_confirmado_cents, confirmado_por, confirmado_em, realizado_transaction_id, realizado_em)
       VALUES ($1, 'manual', date_trunc('month', now())::date, 'teste de sinal', 1000, 'realizado',
               1000, 'test-agenda', now(), $2, now())`,
      [entityId, debito.id]
    );
  } catch {
    recusouDebito = true;
  }
  await c.query('ROLLBACK TO SAVEPOINT s_sinal2');
  afirma(
    'receita realizada por um DÉBITO é recusada pelo gatilho (um débito não realiza receita)',
    recusouDebito,
    recusouDebito ? 'recusado' : 'PASSOU — o confronto compararia sinais opostos'
  );

  await c.query('SAVEPOINT s_realizado');
  let recusouSemLancamento = false;
  try {
    await c.query(
      `INSERT INTO fin_receita_prevista
         (entity_id, origem, competencia, descricao, valor_previsto_cents, estado,
          valor_confirmado_cents, confirmado_por, confirmado_em)
       VALUES ($1, 'manual', date_trunc('month', now())::date, 'sem lançamento', 1000, 'realizado',
               1000, 'test-agenda', now())`,
      [entityId]
    );
  } catch {
    recusouSemLancamento = true;
  }
  await c.query('ROLLBACK TO SAVEPOINT s_realizado');
  afirma(
    'não se chega a "realizado" sem lançamento — previsto não vira realizado sozinho',
    recusouSemLancamento,
    recusouSemLancamento ? 'recusado pelo CHECK' : 'PASSOU — a regra de ouro foi furada'
  );

  await c.query('SAVEPOINT s_motivo');
  let recusouSemMotivo = false;
  try {
    await c.query(
      `INSERT INTO fin_receita_prevista (entity_id, origem, competencia, descricao)
       VALUES ($1, 'manual', date_trunc('month', now())::date, 'sem valor e sem motivo')`,
      [entityId]
    );
  } catch {
    recusouSemMotivo = true;
  }
  await c.query('ROLLBACK TO SAVEPOINT s_motivo');
  afirma(
    'item sem valor E sem motivo é recusado (restrição nº 5: indeterminado COM motivo)',
    recusouSemMotivo,
    recusouSemMotivo ? 'recusado pelo CHECK' : 'PASSOU — nasceria um vazio sem explicação'
  );

  // =======================================================================
  console.log('\n[7] Item manual entra na agenda, some no total, e não é caixa');
  // =======================================================================
  const mesFuturo = await c.query(
    `SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date + 40)::date AS m,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 40) AS d`
  );
  const mes = String(mesFuturo.rows[0].m).slice(0, 10);
  const dia = String(mesFuturo.rows[0].d).slice(0, 10);
  const antesManual = await c.query(
    `SELECT COALESCE(sum(valor_cents), 0) v FROM fin_agenda_dia_v
      WHERE entra_no_total AND direcao = 'receber' AND competencia = $1::date`,
    [mes]
  );
  const { rows: [manual] } = await c.query(
    `INSERT INTO fin_receita_prevista
       (entity_id, origem, competencia, descricao, dia_esperado, dia_regra, valor_previsto_cents, created_by)
     VALUES ($1, 'manual', $2::date, 'teste: contrato fechado fora do Asaas', $3::date,
             'informado por quem criou o item', 5000000, 'test-agenda')
     RETURNING id`,
    [entityId, mes, dia]
  );
  const depoisManual = await c.query(
    `SELECT COALESCE(sum(valor_cents), 0) v FROM fin_agenda_dia_v
      WHERE entra_no_total AND direcao = 'receber' AND competencia = $1::date`,
    [mes]
  );
  afirma(
    'item manual soma por cima da projeção (é a lacuna se fechando)',
    Number(depoisManual.rows[0].v) - Number(antesManual.rows[0].v) === 5000000,
    `+${brl(Number(depoisManual.rows[0].v) - Number(antesManual.rows[0].v))}`
  );

  const provaManual = await c.query(
    `SELECT * FROM fin_agenda_prova_v WHERE competencia = $1::date AND direcao = 'receber'`,
    [mes]
  );
  afirma(
    'a prova explica o delta do item manual em vez de acusar dupla contagem',
    provaManual.rows.every((r) => r.delta_explicado && Number(r.manual_cents) === 5000000),
    provaManual.rows.map((r) => `delta ${brl(r.delta_cents)} = manual ${brl(r.manual_cents)}`).join(' · ')
  );

  const trilha = await c.query(
    `SELECT count(*)::int n FROM fin_audit_log
      WHERE target_table = 'fin_receita_prevista' AND target_id = $1`,
    [manual.id]
  );
  afirma(
    'a criação deixou trilha em fin_audit_log',
    trilha.rows[0].n > 0,
    `${trilha.rows[0].n} registro(s)`
  );

  const linhaManual = await c.query(
    `SELECT procedencia, precedencia, certeza, origem_tabela, chave_dedupe
       FROM fin_agenda_dia_v WHERE item_id = $1 AND direcao = 'receber'`,
    [manual.id]
  );
  afirma(
    'o item manual é distinguível na agenda (procedencia=item, precedencia=manual)',
    linhaManual.rows.every((r) => r.procedencia === 'item' && r.precedencia === 'manual' && r.origem_tabela),
    linhaManual.rows[0]
      ? `${linhaManual.rows[0].procedencia}/${linhaManual.rows[0].precedencia}, chave ${linhaManual.rows[0].chave_dedupe}`
      : 'não apareceu na agenda'
  );

  // =======================================================================
  console.log('\n[8] A âncora de dinheiro — nada disto tocou o caixa');
  // =======================================================================
  const ancoraDepois = (await c.query(ancoraSQL)).rows;
  const mudaram = ancoraAntes.filter((a, i) => String(a.calc) !== String(ancoraDepois[i]?.calc));
  afirma(
    'a soma por conta é idêntica depois de materializar, confirmar, ajustar, ignorar e criar manual',
    mudaram.length === 0,
    mudaram.length ? mudaram.map((m) => m.slug).join(', ') : `${ancoraAntes.length} contas conferidas`
  );

  const tocouLedger = await c.query(
    `SELECT count(*)::int n FROM fin_transaction WHERE created_by = 'test-agenda'`
  );
  afirma(
    'nenhum lançamento foi criado em fin_transaction',
    tocouLedger.rows[0].n === 0,
    `${tocouLedger.rows[0].n} lançamento(s)`
  );

  const tocouDoc = await c.query(
    `SELECT count(*)::int n FROM fin_document WHERE created_by = 'test-agenda'`
  );
  afirma(
    'nenhum documento foi criado — receita prevista não é cobrança emitida',
    tocouDoc.rows[0].n === 0,
    `${tocouDoc.rows[0].n} documento(s)`
  );

  await c.query('ROLLBACK');

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${ok} verificação(ões) ok · ${falhas} falha(s)`);
  if (falhas) {
    console.log('\nO que falhou:');
    detalhes.forEach((d) => console.log(`  · ${d}`));
  } else {
    console.log('A agenda diária não conta o mesmo dinheiro duas vezes, e nada disto foi gravado.');
  }
  console.log('');
  process.exitCode = falhas ? 1 : 0;
} catch (erro) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('\n✗ o teste abortou:', erro.message);
  if (erro.detail) console.error('  detalhe:', erro.detail);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
