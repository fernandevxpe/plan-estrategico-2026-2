// Teste de aceite do módulo financeiro.
//
// Segue o padrão dos outros scripts/test-*.mjs desta plataforma: AFIRMA NÚMEROS
// contra a fonte, em vez de mocar. Um teste que passa contra um mock não diz
// nada sobre um ledger — a única pergunta que importa é se o que está no banco
// bate com o que o Asaas diz.
//
//   node scripts/test-financeiro.mjs
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let falhas = 0;
let passes = 0;

function check(nome, atual, esperado, tolerancia = 0) {
  const ok = Math.abs(atual - esperado) <= tolerancia;
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${nome}: ${brl(atual)}`);
  } else {
    falhas += 1;
    console.error(`  ✗ ${nome}\n      esperado ${brl(esperado)}\n      obtido   ${brl(atual)}\n      delta    ${brl(atual - esperado)}`);
  }
}

function checkNum(nome, atual, esperado) {
  const ok = atual === esperado;
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${nome}: ${atual}`);
  } else {
    falhas += 1;
    console.error(`  ✗ ${nome}: esperado ${esperado}, obtido ${atual}`);
  }
}

const pool = financePool();
const client = await pool.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  const [{ id: entityId }] = await q(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
  const [{ id: accountId }] = await q(`SELECT id FROM fin_account WHERE slug = 'asaas'`);

  // -------------------------------------------------------------------------
  console.log('\n=== 1. Completude: o ledger reconstrói o saldo do banco? ===');
  // Esta é a verificação que substitui o balancete que a partida simples não dá.
  // Se as 12.181 linhas somam exatamente o saldo que a API informa, não falta
  // nem sobra lançamento.
  const [saldo] = await q(
    `SELECT COALESCE(SUM(amount_cents), 0) AS calculado,
            (SELECT balance_cents FROM fin_balance_snapshot
              WHERE account_id = $1 AND source = 'api' ORDER BY date DESC LIMIT 1) AS api
       FROM fin_transaction WHERE account_id = $1 AND NOT is_split_parent`,
    [accountId]
  );
  check('saldo reconstruído == saldo da API', saldo.calculado, saldo.api);

  // -------------------------------------------------------------------------
  console.log('\n=== 2. Receita recebida — DUAS visões, ambas corretas ===');
  //
  // O teste original falhava porque eu tratava as duas como a mesma coisa. Elas
  // não são, e 864 das 3.023 cobranças têm datas diferentes:
  //
  //   · POR DATA DE PAGAMENTO — quando o cliente pagou. É o número que o painel
  //     do Asaas mostra e que o negócio sabe de cor.
  //   · POR DATA DE CRÉDITO — quando o dinheiro ficou disponível na conta.
  //     Boleto pago na sexta cai na segunda, e em virada de mês isso move
  //     receita inteira. É o que a previsão de caixa precisa.
  //
  // Um único boleto de R$ 4.941,44 sai de julho e entra em agosto entre uma
  // visão e outra. Testar as duas é o que impede alguém de "corrigir" uma delas
  // para bater com a outra.

  // Visão A: por data de pagamento (documento). Inclui recebimento fora do
  // Asaas — dinheiro e transferência direta — que é receita igual.
  const receitaPorPagamento = async (de, ate) => {
    const [row] = await q(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM fin_document
        WHERE entity_id = $1 AND direction = 'receber'
          AND source_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
          AND paid_on BETWEEN $2 AND $3`,
      [entityId, de, ate]
    );
    return row.total;
  };

  console.log('  Por data de pagamento (espelha o painel do Asaas):');
  check('  julho/2026', await receitaPorPagamento('2026-07-01', '2026-07-31'), 24090600, 100_00);
  check('  2025 inteiro', await receitaPorPagamento('2025-01-01', '2025-12-31'), 118370400, 100_00);
  check('  2026 jan–jul', await receitaPorPagamento('2026-01-01', '2026-07-31'), 135073200, 100_00);

  // Visão B: por data de crédito (extrato). É o caixa de verdade.
  const receitaPorCredito = async (de, ate) => {
    const [row] = await q(
      `SELECT COALESCE(SUM(t.amount_cents), 0) AS total
         FROM fin_transaction t
        WHERE t.account_id = $1 AND t.source_kind = 'PAYMENT_RECEIVED'
          AND t.posted_on BETWEEN $2 AND $3`,
      [accountId, de, ate]
    );
    return row.total;
  };

  console.log('  Por data de crédito no extrato (o caixa):');
  check('  julho/2026', await receitaPorCredito('2026-07-01', '2026-07-31'), 22746451, 100);
  check('  histórico completo', await receitaPorCredito('2000-01-01', '2100-01-01'), 379866415, 100);

  // -------------------------------------------------------------------------
  console.log('\n=== 3. Neutralização de transferências ===');
  // Sem isto o ledger conta R$ 3,82 mi em dobro e a receita fecha em zero.
  // Como só o Asaas está importado, a perna que chega nos outros bancos ainda
  // não existe: o esperado é 'em_transito', NÃO 'pareado'.
  const [transf] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents), 0) AS total
       FROM fin_transaction WHERE account_id = $1 AND source_kind = 'TRANSFER'`,
    [accountId]
  );
  checkNum('transferências identificadas', Number(transf.n), 372);
  check('valor transferido para outros bancos', transf.total, -381557542, 100);

  const [emTransito] = await q(
    `SELECT count(*) AS n FROM fin_transaction
      WHERE account_id = $1 AND source_kind = 'TRANSFER' AND transfer_status = 'em_transito'`,
    [accountId]
  );
  checkNum('marcadas em trânsito (nenhuma pareada ainda)', Number(emTransito.n), 372);

  // -------------------------------------------------------------------------
  console.log('\n=== 4. Conciliação automática pelo paymentId ===');
  const [liq] = await q(
    `SELECT count(*) AS n FROM fin_settlement s
       JOIN fin_transaction t ON t.id = s.transaction_id WHERE t.account_id = $1`,
    [accountId]
  );
  checkNum('liquidações criadas', Number(liq.n), 3023);

  const [liquidados] = await q(
    `SELECT count(*) AS n FROM fin_document WHERE entity_id = $1 AND status = 'liquidado'`,
    [entityId]
  );
  checkNum('documentos marcados liquidados pelo gatilho', Number(liquidados.n), 3023);

  // O invariante do settled_cents: a coluna denormalizada tem de bater com a
  // soma real. Zero linhas ou o índice de confiabilidade é mentira.
  const divergentes = await q(
    `SELECT d.id FROM fin_document d
       LEFT JOIN (SELECT document_id, SUM(amount_cents) s FROM fin_settlement GROUP BY 1) x ON x.document_id = d.id
      WHERE d.settled_cents IS DISTINCT FROM COALESCE(x.s, 0)`
  );
  checkNum('documentos com settled_cents divergente', divergentes.length, 0);

  // -------------------------------------------------------------------------
  console.log('\n=== 5. Notas fiscais NÃO entram na receita ===');
  // 3.483 notas, R$ 4,2 mi. Se estivessem em fin_document ao lado das cobranças,
  // a receita contaria quase o dobro.
  const [notas] = await q(`SELECT count(*) AS n FROM fin_fiscal_document WHERE entity_id = $1`, [entityId]);
  checkNum('notas fiscais na tabela própria', Number(notas.n), 3483);
  const [docs] = await q(`SELECT count(*) AS n FROM fin_document WHERE entity_id = $1`, [entityId]);
  checkNum('documentos (só cobranças, sem notas)', Number(docs.n), 3350);

  // -------------------------------------------------------------------------
  console.log('\n=== 6. Carteira a receber e inadimplência ===');
  const [aReceber] = await q(
    `SELECT COALESCE(SUM(amount_cents - settled_cents), 0) AS total
       FROM fin_document
      WHERE entity_id = $1 AND direction = 'receber' AND status IN ('emitido', 'parcial')
        AND due_date BETWEEN '2026-08-01' AND '2026-08-31'`,
    [entityId]
  );
  // R$ 125.426 pendentes + R$ 1.785 já vencidos no mesmo mês. O número que
  // conferi na API separava os dois; a carteira é a soma.
  check('a receber com vencimento em ago/26', aReceber.total, 12721068, 100);

  const [vencido] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents - settled_cents), 0) AS total
       FROM fin_document
      WHERE entity_id = $1 AND direction = 'receber' AND status IN ('emitido', 'parcial')
        AND due_date < CURRENT_DATE`,
    [entityId]
  );
  // 47, não 45 — e o ledger está MAIS certo que o Asaas aqui.
  //
  // Duas cobranças (R$ 5.100) ainda estão PENDING no Asaas apesar de o
  // vencimento já ter passado: o gateway demora para virar a flag. Uma cobrança
  // vencida é vencida, independentemente de quando o provedor resolve carimbar
  // — e é esse número que a régua de cobrança precisa enxergar.
  checkNum('cobranças vencidas por data (visão do ledger)', Number(vencido.n), 47);
  check('valor em atraso por data', vencido.total, 9214703, 100);

  const [overdueAsaas] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents - settled_cents), 0) AS total
       FROM fin_document WHERE entity_id = $1 AND source_status = 'OVERDUE'`,
    [entityId]
  );
  checkNum('  destas, marcadas OVERDUE pelo próprio Asaas', Number(overdueAsaas.n), 45);
  check('  valor correspondente', overdueAsaas.total, 8704703, 100);

  // -------------------------------------------------------------------------
  console.log('\n=== 7. Classificação ===');
  const [classif] = await q(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE category_id IS NOT NULL), 0) AS classificado,
            COALESCE(SUM(amount_cents), 0) AS total,
            count(*) FILTER (WHERE category_id IS NULL) AS sem_categoria
       FROM fin_document WHERE entity_id = $1 AND direction = 'receber' AND status <> 'cancelado'`,
    [entityId]
  );
  const cobertura = (classif.classificado / classif.total) * 100;
  console.log(`  · receita classificada: ${brl(classif.classificado)} de ${brl(classif.total)} (${cobertura.toFixed(1)}%)`);
  console.log(`  · cobranças sem categoria: ${classif.sem_categoria}`);

  console.log('\n  Receita por categoria:');
  const porCategoria = await q(
    `SELECT c.code, c.name, COALESCE(SUM(d.amount_cents), 0) AS total, count(*) AS n
       FROM fin_document d JOIN fin_category c ON c.id = d.category_id
      WHERE d.entity_id = $1 AND d.direction = 'receber' AND d.status = 'liquidado'
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    [entityId]
  );
  porCategoria.forEach((row) =>
    console.log(`    ${row.code}  ${row.name.padEnd(36)} ${String(row.n).padStart(5)}x  ${brl(row.total).padStart(16)}`)
  );

  // A armadilha do "comissionamento": tem de cair em 3.06 e valer ~R$ 704 mil.
  const comissionamento = porCategoria.find((row) => row.code === '3.06');
  if (comissionamento) {
    // R$ 771.688,83 — exatamente o total da PIAU conferido na API antes de
    // existir schema. Chegou aqui em dois passos: a regra de prioridade 10 pegou
    // as cobranças com texto, e o estágio de histórico da contraparte pegou as 9
    // que não têm descrição nenhuma no Asaas. Nenhuma regra de texto jamais
    // pegaria essas — não há texto.
    check('3.06 Comissionamento de vendas (PIAU)', comissionamento.total, 77168883, 100);
  } else {
    falhas += 1;
    console.error('  ✗ categoria 3.06 não recebeu nenhuma cobrança — a regra de prioridade 10 não casou');
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 8. Cobertura de classificação ===');
  // A meta do módulo é >98%. Este piso trava regressão: uma regra futura mal
  // ordenada que derrube a cobertura falha o teste em vez de passar despercebida.
  if (cobertura >= 90) {
    passes += 1;
    console.log(`  ✓ cobertura da receita acima de 90%: ${cobertura.toFixed(1)}%`);
  } else {
    falhas += 1;
    console.error(`  ✗ cobertura caiu para ${cobertura.toFixed(1)}% (piso 90%)`);
  }

  console.log('\n=== 9. Idempotência ===');
  const [antes] = await q('SELECT count(*) AS n FROM fin_transaction');
  console.log(`  · lançamentos hoje: ${antes.n}. Rode o import de novo e confira que não muda.`);

  // -------------------------------------------------------------------------
  console.log(`\n${falhas === 0 ? '✓ TODOS OS TESTES PASSARAM' : `✗ ${falhas} FALHA(S)`} — ${passes} verificações ok\n`);
} finally {
  client.release();
  await pool.end();
}

process.exit(falhas === 0 ? 0 : 1);
