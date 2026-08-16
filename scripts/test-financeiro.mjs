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

// ---------------------------------------------------------------------------
// PISO e INVARIANTE — os dois jeitos de afirmar sobre número que CRESCE.
//
// Metade das verificações deste arquivo travou em 08/08/2026 e falhou em 16/08
// por um motivo que não é defeito: o Asaas sincronizou de novo. 3.023 cobranças
// viraram 3.048, 3.483 notas viraram 3.521, e o histórico de receita subiu
// R$ 48.038,89. Conferido linha a linha — todas as diferenças têm created_at
// entre 11 e 15/08, nenhuma toca o passado.
//
// Recongelar o número novo só agenda a mesma falha para a próxima
// sincronização. Para inventário que só cresce, o que se afirma é:
//
//   · PISO — "nunca menos que isto". O que este teste tem de pegar é
//     lançamento SUMINDO (import que apaga, dedupe largo demais, reversão
//     errada). Crescer é o funcionamento normal; encolher é o defeito.
//   · INVARIANTE — a relação entre dois números, que não envelhece nunca.
//     "Tantas liquidações quantos documentos liquidados" vale com 3.023, com
//     3.048 e com 30.000.
// ---------------------------------------------------------------------------
function checkPiso(nome, atual, piso, medidoEm) {
  if (atual >= piso) {
    passes += 1;
    const excedente = atual - piso;
    console.log(`  ✓ ${nome}: ${atual}${excedente ? ` (piso ${piso} de ${medidoEm}, +${excedente} desde então)` : ` (= piso de ${medidoEm})`}`);
  } else {
    falhas += 1;
    console.error(`  ✗ ${nome}: ${atual} — ABAIXO do piso ${piso} medido em ${medidoEm}. Inventário não encolhe: ${piso - atual} sumiram.`);
  }
}

function checkPisoBrl(nome, atual, piso, medidoEm) {
  if (atual >= piso) {
    passes += 1;
    console.log(`  ✓ ${nome}: ${brl(atual)} (piso ${brl(piso)} de ${medidoEm})`);
  } else {
    falhas += 1;
    console.error(`  ✗ ${nome}: ${brl(atual)} — ABAIXO do piso ${brl(piso)} medido em ${medidoEm}, delta ${brl(atual - piso)}`);
  }
}

function checkInvariante(nome, ok, detalhe) {
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${nome}${detalhe ? `: ${detalhe}` : ''}`);
  } else {
    falhas += 1;
    console.error(`  ✗ ${nome}${detalhe ? `: ${detalhe}` : ''}`);
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
  // Julho fechou: a janela é passado e o número não pode mais mexer. Aqui a
  // igualdade exata continua sendo a afirmação certa.
  check('  julho/2026', await receitaPorCredito('2026-07-01', '2026-07-31'), 22746451, 100);
  // O histórico completo é janela ABERTA — termina em "agora". Crescer é o
  // funcionamento normal, e foi o que aconteceu: R$ 379.866.415 medidos em
  // 08/08 mais R$ 4.803.889 creditados entre 11 e 15/08 (25 lançamentos,
  // conferidos por created_at) dão exatamente os R$ 384.670.304 de hoje.
  checkPisoBrl('  histórico completo (janela aberta)', await receitaPorCredito('2000-01-01', '2100-01-01'), 379866415, '08/08/2026');

  // -------------------------------------------------------------------------
  console.log('\n=== 3. Neutralização de transferências ===');
  // Sem isto o ledger conta R$ 3,82 mi em dobro e a receita fecha em zero.
  //
  // A PREMISSA DESTE BLOCO CAIU, e é uma boa notícia. Ele dizia:
  //
  //   "Como só o Asaas está importado, a perna que chega nos outros bancos
  //    ainda não existe: o esperado é 'em_transito', NÃO 'pareado'."
  //
  // Inter e Nubank entraram desde então, e o pareamento rodou: das 377 pernas,
  // 105 acharam a irmã e viraram 'pareado', 97 foram identificadas como saída
  // para terceiro ('nao'), 4 anuladas, 171 seguem em trânsito. Exigir 372 em
  // trânsito hoje é exigir que a conciliação NÃO tenha funcionado.
  //
  // O que não envelhece é a PARTIÇÃO: toda perna tem de estar em exatamente um
  // dos quatro estados. Perna fora deles é transferência que não é contada nem
  // como neutralizada nem como despesa — some das duas pontas.
  const [transf] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents), 0) AS total,
            count(*) FILTER (WHERE transfer_status IN ('em_transito','pareado','nao','anulado')) AS particionadas,
            count(*) FILTER (WHERE transfer_status = 'em_transito') AS em_transito,
            count(*) FILTER (WHERE transfer_status = 'pareado') AS pareado,
            count(*) FILTER (WHERE transfer_status = 'nao') AS nao,
            count(*) FILTER (WHERE transfer_status = 'anulado') AS anulado
       FROM fin_transaction WHERE account_id = $1 AND source_kind = 'TRANSFER'`,
    [accountId]
  );
  checkPiso('transferências identificadas', Number(transf.n), 372, '08/08/2026');
  checkInvariante(
    'toda perna em exatamente um estado (em_transito · pareado · nao · anulado)',
    Number(transf.particionadas) === Number(transf.n),
    `${transf.em_transito} em trânsito · ${transf.pareado} pareadas · ${transf.nao} a terceiro · ${transf.anulado} anuladas = ${transf.n}`
  );
  // Transferência é SAÍDA da conta do Asaas para outra conta: o total é
  // negativo, sempre. Sinal positivo aqui seria perna entrando classificada
  // como transferência de saída, e o valor apareceria somado em vez de abatido.
  checkInvariante('valor transferido é saída líquida', Number(transf.total) < 0, brl(transf.total));

  // -------------------------------------------------------------------------
  console.log('\n=== 4. Conciliação automática pelo paymentId ===');
  // 3.023 em 08/08, 3.048 hoje — 25 cobranças novas liquidadas entre 11 e 15/08.
  // O que este bloco existe para provar não é o número: é que o GATILHO ligou
  // liquidação a documento. E isso se afirma pela relação entre os dois lados,
  // que vale em qualquer volume.
  const [liq] = await q(
    `SELECT count(*) AS n FROM fin_settlement s
       JOIN fin_transaction t ON t.id = s.transaction_id WHERE t.account_id = $1`,
    [accountId]
  );
  const [liquidados] = await q(
    `SELECT count(*) AS n FROM fin_document WHERE entity_id = $1 AND status = 'liquidado'`,
    [entityId]
  );
  checkPiso('liquidações criadas', Number(liq.n), 3023, '08/08/2026');
  checkInvariante(
    'uma liquidação por documento liquidado (o gatilho fechou o par)',
    Number(liq.n) === Number(liquidados.n),
    `${liq.n} liquidações · ${liquidados.n} documentos liquidados`
  );

  // O gatilho nos dois sentidos. Sem o segundo ramo, um documento pago ficaria
  // "emitido" para sempre e continuaria contando na carteira a receber.
  const [gatilho] = await q(
    `SELECT count(*) FILTER (WHERE status = 'liquidado' AND settled_cents < amount_cents) AS liquidado_sem_baixa,
            count(*) FILTER (WHERE status NOT IN ('liquidado','cancelado')
                               AND amount_cents > 0 AND settled_cents >= amount_cents) AS baixado_sem_status,
            count(*) FILTER (WHERE amount_cents > 0 AND settled_cents > amount_cents) AS superliquidado
       FROM fin_document WHERE entity_id = $1`,
    [entityId]
  );
  checkInvariante("nenhum documento 'liquidado' sem baixa integral", Number(gatilho.liquidado_sem_baixa) === 0);
  checkInvariante('nenhum documento com baixa integral fora de liquidado', Number(gatilho.baixado_sem_status) === 0);
  checkInvariante('nenhum documento recebe mais do que vale', Number(gatilho.superliquidado) === 0);

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
  // 3.483 notas em 08/08, 3.521 hoje; 3.350 documentos viraram 3.406. Ambos
  // cresceram pela sincronização, e o título da seção não fala de quantidade —
  // fala de SEPARAÇÃO. O defeito que ela existe para pegar é a nota vazando
  // para fin_document e a receita contando quase o dobro. Isso se afirma sem
  // número: interseção vazia.
  const [notas] = await q(`SELECT count(*) AS n FROM fin_fiscal_document WHERE entity_id = $1`, [entityId]);
  const [docs] = await q(`SELECT count(*) AS n FROM fin_document WHERE entity_id = $1`, [entityId]);
  checkPiso('notas fiscais na tabela própria', Number(notas.n), 3483, '08/08/2026');
  checkPiso('documentos (só cobranças, sem notas)', Number(docs.n), 3350, '08/08/2026');

  const [vazamento] = await q(
    `SELECT count(*) AS n FROM fin_document d
      WHERE d.entity_id = $1 AND d.source_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM fin_fiscal_document f
                     WHERE f.entity_id = d.entity_id AND f.source_id = d.source_id)`,
    [entityId]
  );
  checkInvariante('nenhuma nota fiscal vazou para fin_document', Number(vazamento.n) === 0);

  // -------------------------------------------------------------------------
  console.log('\n=== 6. Carteira a receber e inadimplência ===');
  //
  // ESTA SEÇÃO INTEIRA ERA UM SNAPSHOT SOBRE CURRENT_DATE, e por isso não podia
  // passar duas vezes. `due_date < CURRENT_DATE` muda de resposta TODO DIA: uma
  // cobrança que vence hoje entra amanhã na conta de vencidas sem que nada no
  // sistema tenha mexido. Congelar "47 vencidas · R$ 92.147,03" foi congelar o
  // dia 08/08. Em 16/08 são 56 e R$ 75.986,86, e nenhum dos dois movimentos é
  // defeito: 9 venceram, e as que sumiram do valor foram pagas.
  //
  // Recongelar em 56 marcaria o teste para falhar de novo amanhã. O que a seção
  // sabe de verdade — e o comentário original já dizia — é uma RELAÇÃO entre o
  // ledger e o Asaas, e ela não tem data.
  const [carteira] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents - settled_cents), 0) AS total
       FROM fin_document
      WHERE entity_id = $1 AND direction = 'receber' AND status IN ('emitido', 'parcial')
        AND due_date >= date_trunc('month', CURRENT_DATE)
        AND due_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'`,
    [entityId]
  );
  console.log(`  · a receber vencendo no mês corrente: ${brl(carteira.total)} em ${carteira.n} cobranças`);
  // O saldo em aberto de uma cobrança nunca é negativo: seria recebimento maior
  // que o valor devido, e a carteira passaria a abater dinheiro que não existe.
  const [negativas] = await q(
    `SELECT count(*) AS n FROM fin_document
      WHERE entity_id = $1 AND direction = 'receber' AND status IN ('emitido','parcial')
        AND amount_cents - settled_cents < 0`,
    [entityId]
  );
  checkInvariante('nenhuma cobrança em aberto com saldo negativo', Number(negativas.n) === 0);

  const [vencido] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents - settled_cents), 0) AS total
       FROM fin_document
      WHERE entity_id = $1 AND direction = 'receber' AND status IN ('emitido', 'parcial')
        AND due_date < CURRENT_DATE`,
    [entityId]
  );
  const [overdueAsaas] = await q(
    `SELECT count(*) AS n, COALESCE(SUM(amount_cents - settled_cents), 0) AS total,
            count(*) FILTER (WHERE due_date >= CURRENT_DATE) AS futuras
       FROM fin_document WHERE entity_id = $1 AND source_status = 'OVERDUE'`,
    [entityId]
  );
  console.log(`  · vencidas pelo ledger: ${vencido.n} (${brl(vencido.total)}) · marcadas OVERDUE pelo Asaas: ${overdueAsaas.n}`);

  // O invariante que o comentário original já descrevia, agora dito como
  // relação: "47, não 45 — e o ledger está MAIS certo que o Asaas aqui. Duas
  // cobranças ainda estão PENDING apesar de o vencimento já ter passado: o
  // gateway demora para virar a flag."
  //
  // Ou seja: o ledger enxerga a inadimplência ANTES do gateway, nunca depois.
  // Se um dia o ledger vir MENOS vencidas que o Asaas, é o ledger que está
  // atrasado — e é essa régua que a cobrança usa.
  checkInvariante(
    'o ledger vê a inadimplência antes do gateway, nunca depois',
    Number(vencido.n) >= Number(overdueAsaas.n),
    `ledger ${vencido.n} ≥ Asaas ${overdueAsaas.n}`
  );
  // E o outro lado: o Asaas não pode marcar OVERDUE o que ainda não venceu.
  // Se marcar, é a data do ledger que está errada.
  checkInvariante(
    'nenhuma OVERDUE do Asaas com vencimento no futuro',
    Number(overdueAsaas.futuras) === 0
  );

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
