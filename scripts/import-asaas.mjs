// Importação: data/raw/asaas-*.json → tabelas fin_*
//
// Separado do sync porque uma carga que falha no meio pode ser reexecutada sem
// bater na API de novo, e o JSON bruto fica diffável quando um número na tela
// não bate.
//
// A ORDEM IMPORTA e é de dependência: contrapartes → cobranças (documentos) →
// notas fiscais → extrato (lançamentos) → liquidações → classificação.
//
// Tudo idempotente: rodar duas vezes seguidas não muda nada na segunda. Isso é
// verificado pelo scripts/test-financeiro.mjs, não prometido em comentário.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import { classifiableText, dedupeHash, normalizeDescription, normalizeName } from './lib/fin-normalize.mjs';
import { classify } from './lib/fin-rules.mjs';
import { rawDir } from './lib/paths.mjs';

loadEnv();
registerFinanceTypeParsers();

const ENTITY_SLUG = 'xpe';
const ACCOUNT_SLUG = 'asaas';

const cents = (value) => Math.round(Number(value ?? 0) * 100);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Insere em lotes de múltiplas linhas por comando.
 *
 * A primeira versão fazia um INSERT por registro. Com 3.350 cobranças, 3.483
 * notas e 12.181 lançamentos, isso é ~19 mil viagens de ida e volta até um
 * Postgres remoto — medido em ~50 minutos, contra um watchdog de 20 minutos por
 * passo no scripts/scheduler.mjs. O sync noturno nunca terminaria.
 *
 * Em lotes de 500 são ~40 comandos. O limite de 65.535 parâmetros por comando do
 * protocolo é respeitado dividindo por (500 * nº de colunas).
 *
 * @param {string} sqlHead  INSERT INTO ... ( colunas ) VALUES
 * @param {string} sqlTail  ON CONFLICT ... (usa EXCLUDED normalmente)
 * @param {number} columns  quantas colunas por linha
 * @param {Array<Array>} rows
 * @param {(chunkResult: import('pg').QueryResult) => void} [onChunk]
 */
async function insertBatched(client, sqlHead, sqlTail, columns, rows, onChunk) {
  const maxRows = Math.max(1, Math.min(500, Math.floor(65_000 / columns)));
  for (let start = 0; start < rows.length; start += maxRows) {
    const chunk = rows.slice(start, start + maxRows);
    const placeholders = chunk
      .map((_, rowIndex) => `(${Array.from({ length: columns }, (_, col) => `$${rowIndex * columns + col + 1}`).join(',')})`)
      .join(',');
    const result = await client.query(`${sqlHead} ${placeholders} ${sqlTail}`, chunk.flat());
    if (onChunk) onChunk(result);
  }
}

async function readRaw(name) {
  try {
    return JSON.parse(await readFile(`${rawDir}/${name}`, 'utf8')).data ?? [];
  } catch {
    console.warn(`[import] ${name} ausente; pulando`);
    return [];
  }
}

/**
 * Status do Asaas → status do nosso documento.
 *
 * O Asaas tem 12 estados e nós temos 7, então o mapeamento é lossy — por isso o
 * bruto vai para `source_status` e nunca se perde.
 *
 * Duas distinções que parecem preciosismo e não são:
 *   · CONFIRMED ≠ RECEIVED. Confirmado é compensado mas ainda não creditado
 *     (cartão D+30). Tratar como liquidado põe no runway dinheiro que não
 *     chegou; tratar como emitido faz o recebível parecer vencido.
 *   · REFUNDED não é cancelado nem liquidado: foi recebido e devolvido.
 *
 * 'liquidado' NÃO é atribuído aqui: quem o define é o gatilho de fin_settlement,
 * a partir do dinheiro que realmente entrou. Isso mantém uma fonte de verdade
 * só para "foi pago".
 */
function mapPaymentStatus(status, deleted) {
  if (deleted) return 'cancelado';
  switch (status) {
    case 'CONFIRMED':
    // Recebida fora do Asaas (dinheiro ou transferência direta): o dinheiro
    // existe mas não gera lançamento neste extrato, então nunca haverá
    // liquidação enquanto as outras contas não forem importadas. 'emitido'
    // faria 46 cobranças e R$ 125 mil aparecerem como inadimplência.
    case 'RECEIVED_IN_CASH':
      return 'confirmado';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'estornado';
    default:
      // PENDING, RECEIVED, RECEIVED_IN_CASH, OVERDUE, DUNNING_*, AWAITING_*
      // 'vencido' não existe como status: é derivado de due_date < hoje.
      return 'emitido';
  }
}

/**
 * Qual estágio da cadeia classificou, de verdade.
 *
 * Antes era literal — 'regra' nos documentos e 'fato_estrutural' nos
 * lançamentos. O CHECK em 0002 enumera os oito estágios justamente para que
 * `WHERE classified_by = 'fato_estrutural'` signifique "veio da fonte, confiável
 * sem revisão". Carimbar isso num palpite de texto sobre o sobrenome de um
 * cliente esvazia a distinção.
 */
const estagioDe = (hit) => {
  if (!hit) return null;
  return hit.rationale.campo === 'source_kind' ? 'fato_estrutural' : 'regra';
};

/** Regras que estouraram durante o lote — precisam aparecer, não sumir. */
const regrasQuebradas = new Map();
const registrarRegraQuebrada = ({ rule_id, name, erro }) => regrasQuebradas.set(rule_id, { name, erro });

const pool = financePool();
const client = await pool.connect();
const batchId = randomUUID();
const startedAt = new Date();
const report = {};

try {
  // TUDO numa transação só.
  //
  // São seis fases dependentes. Sem transação, uma falha na quinta deixava
  // contrapartes, 3.350 documentos, 3.483 notas e 12.181 lançamentos já
  // gravados, sem snapshot de saldo, sem cobertura de extrato e sem registro em
  // auditoria — um estado que ninguém projetou. Com 22 mil linhas em 65
  // segundos, e sendo o único processo que escreve nestas tabelas, o custo de
  // envolver é irrelevante perto disso.
  await client.query('BEGIN');

  // `true` = escopo de TRANSAÇÃO, não de sessão.
  //
  // Com escopo de sessão, um SIGTERM do watchdog devolveria ao pool uma conexão
  // com fin.sync_mode ligado — e a próxima requisição da tela teria o gatilho
  // fin_preserve_human_locks ativo, revertendo em silêncio a edição de um humano
  // e reportando sucesso. É a pior falha possível desse gatilho.
  await client.query("SELECT set_config('fin.sync_mode', 'on', true)");

  const { rows: ctx } = await client.query(
    `SELECT e.id AS entity_id, a.id AS account_id
       FROM fin_entity e JOIN fin_account a ON a.entity_id = e.id AND a.slug = $2
      WHERE e.slug = $1`,
    [ENTITY_SLUG, ACCOUNT_SLUG]
  );
  if (!ctx.length) throw new Error('empresa ou conta Asaas não encontrada — rode as migrations primeiro');
  const { entity_id: entityId, account_id: accountId } = ctx[0];

  const { rows: categories } = await client.query('SELECT id, code FROM fin_category WHERE entity_id = $1', [entityId]);
  const categoryByCode = new Map(categories.map((row) => [row.code, row.id]));

  const { rows: rules } = await client.query(
    `SELECT id, name, priority, match_scope, conditions, actions, confidence
       FROM fin_rule WHERE status = 'ativa' ORDER BY priority, id`
  );

  // -------------------------------------------------------------------------
  // 1. Contrapartes
  // -------------------------------------------------------------------------
  // Unificadas por documento: 57 dos 344 cadastros do Asaas compartilham 24
  // CNPJ/CPF — é o mesmo cliente registrado várias vezes, às vezes com grafias
  // diferentes. Cada id do Asaas vira um alias apontando para uma contraparte
  // só, senão o histórico do cliente fica repartido e a sugestão automática por
  // contraparte — o sinal mais forte de classificação — perde força.
  const customers = await readRaw('asaas-customers.json');
  const counterpartyByAsaas = new Map();
  let unificados = 0;

  for (const customer of customers) {
    const document = customer.cpfCnpj?.replace(/\D/g, '') || null;
    const name = customer.name?.trim() || '(sem nome)';
    let counterpartyId = null;

    if (document) {
      const { rows: found } = await client.query(
        'SELECT id FROM fin_counterparty WHERE entity_id = $1 AND document_number = $2',
        [entityId, document]
      );
      if (found.length) {
        counterpartyId = found[0].id;
        unificados += 1;
      }
    }

    if (!counterpartyId) {
      const { rows: created } = await client.query(
        `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number)
         VALUES ($1, 'cliente', $2, $3, $4, $5) RETURNING id`,
        [entityId, name, normalizeName(name), document ? (document.length > 11 ? 'cnpj' : 'cpf') : null, document]
      );
      counterpartyId = created[0].id;
    }

    await client.query(
      `INSERT INTO fin_counterparty_alias (counterparty_id, source, external_id, name_raw, normalized_name)
       VALUES ($1, 'asaas', $2, $3, $4)
       ON CONFLICT (source, external_id) DO UPDATE SET name_raw = EXCLUDED.name_raw, normalized_name = EXCLUDED.normalized_name`,
      [counterpartyId, customer.id, name, normalizeName(name)]
    );
    counterpartyByAsaas.set(customer.id, { id: counterpartyId, normalized_name: normalizeName(name) });
  }
  report.contrapartes = { cadastros_asaas: customers.length, unificados_por_documento: unificados };

  // -------------------------------------------------------------------------
  // 2. Cobranças → documentos (competência)
  // -------------------------------------------------------------------------
  const payments = await readRaw('asaas-payments.json');
  const documentIdByPayment = new Map();
  const documentRows = [];
  let ignorados = 0;

  for (const payment of payments) {
    if (cents(payment.value) <= 0) {
      // amount_cents é sempre positivo (o sentido mora em `direction`). Cobrança
      // de valor zero não é documento — é ruído de cadastro.
      ignorados += 1;
      continue;
    }
    const counterparty = counterpartyByAsaas.get(payment.customer);
    const description = payment.description?.trim() || '(sem descrição)';
    const subject = {
      scope: 'document',
      description_norm: classifiableText(description) || normalizeDescription(description),
      counterparty_name_norm: counterparty?.normalized_name ?? '',
      counterparty_document: null,
      account_slug: ACCOUNT_SLUG,
      amount_cents: cents(payment.value),
      amount_abs: Math.abs(cents(payment.value)),
      source_kind: null,
      billing_type: payment.billingType ?? null,
      direction: 'receber',
      day_of_month: payment.dueDate ? Number(payment.dueDate.slice(8, 10)) : null
    };
    const hit = classify(rules, subject, { onRuleError: registrarRegraQuebrada });
    const actions = hit?.actions ?? {};
    const categoryId = actions.category_code ? categoryByCode.get(actions.category_code) ?? null : null;

    // Competência = vencimento. Num parcelamento ("Parcela 3 de 6"), cada
    // parcela compete ao seu próprio mês — é como a Projeção v3.1 já distribui
    // ("1/4 cai no mês") e é o que faz a DRE mensal ter sentido para serviço
    // entregue ao longo do pagamento.
    documentRows.push([
      entityId,
      'receber',
      counterparty?.id ?? null,
      categoryId,
      actions.nucleo ?? null,
      description,
      normalizeDescription(description),
      payment.dueDate,
      payment.dateCreated?.slice(0, 10) ?? null,
      payment.dueDate,
      payment.paymentDate ?? payment.clientPaymentDate ?? null,
      payment.dueDate,
      'vencimento',
      cents(payment.value),
      mapPaymentStatus(payment.status, payment.deleted),
      payment.status,
      'asaas',
      payment.id,
      payment.billingType ?? null,
      payment.installment ?? null,
      payment.installmentNumber ?? null,
      null,
      payment.invoiceUrl ?? null,
      !categoryId || (hit && hit.confidence < 80) ? 'pendente' : 'ok',
      estagioDe(hit),
      hit?.rule.id ?? null,
      hit ? JSON.stringify(hit.rationale) : null,
      hit ? startedAt : null
    ]);
  }

  await insertBatched(
    client,
    `INSERT INTO fin_document (
       entity_id, direction, counterparty_id, category_id, nucleo, description, description_norm,
       competence_date, issue_date, due_date, paid_on, expected_cash_date, cash_date_basis,
       amount_cents, status, source_status, source, source_id, billing_type,
       installment_group_id, installment_number, installment_total, external_url,
       review_status, classified_by, classified_rule_id, classified_reason, classified_at
     ) VALUES`,
    `ON CONFLICT (entity_id, source, source_id) WHERE source_id IS NOT NULL
     DO UPDATE SET
       -- Fatos da fonte: sempre sobrescrevem. Humano nenhum trava um fato.
       source_status = EXCLUDED.source_status,
       amount_cents  = EXCLUDED.amount_cents,
       due_date      = EXCLUDED.due_date,
       paid_on       = EXCLUDED.paid_on,
       description   = EXCLUDED.description,
       status        = CASE WHEN fin_document.settled_cents <> 0 THEN fin_document.status ELSE EXCLUDED.status END,
       -- Decisões: só quando o humano não travou. O gatilho
       -- fin_preserve_human_locks é a rede para a coluna que alguém esquecer aqui.
       -- COALESCE, não atribuição direta: EXCLUDED pode vir NULL legitimamente.
       -- O cadastro de clientes é SUBSTITUÍDO a cada sync e GET /customers não
       -- devolve excluídos — 28 cobranças já apontam para um cliente ausente do
       -- arquivo. Sem o COALESCE, o dia em que a PIAU sumisse do cadastro
       -- zeraria a contraparte de todas as cobranças históricas dela.
       category_id     = CASE WHEN 'category_id'     = ANY (fin_document.human_locked_fields) THEN fin_document.category_id     ELSE COALESCE(EXCLUDED.category_id, fin_document.category_id) END,
       nucleo          = CASE WHEN 'nucleo'          = ANY (fin_document.human_locked_fields) THEN fin_document.nucleo          ELSE COALESCE(EXCLUDED.nucleo, fin_document.nucleo) END,
       counterparty_id = CASE WHEN 'counterparty_id' = ANY (fin_document.human_locked_fields) THEN fin_document.counterparty_id ELSE COALESCE(EXCLUDED.counterparty_id, fin_document.counterparty_id) END,
       -- Sem estas quatro, acrescentar uma regra e reimportar dava categoria à
       -- cobrança mas deixava review_status='pendente' e a regra vencedora
       -- desatualizada — a fila de revisão nunca encolhia pelo lado do import.
       review_status      = CASE
         WHEN fin_document.review_status IN ('adiado', 'ignorado') THEN fin_document.review_status
         WHEN COALESCE(EXCLUDED.category_id, fin_document.category_id) IS NULL THEN 'pendente'
         WHEN fin_document.classified_by = 'humano' THEN 'ok'
         ELSE EXCLUDED.review_status END,
       classified_by      = COALESCE(EXCLUDED.classified_by, fin_document.classified_by),
       classified_rule_id = COALESCE(EXCLUDED.classified_rule_id, fin_document.classified_rule_id),
       classified_reason  = COALESCE(EXCLUDED.classified_reason, fin_document.classified_reason),
       classified_at      = COALESCE(EXCLUDED.classified_at, fin_document.classified_at),
       updated_at = now()
     RETURNING id, source_id`,
    28,
    documentRows,
    (result) => result.rows.forEach((row) => documentIdByPayment.set(row.source_id, row.id))
  );
  report.documentos = { inseridos: documentRows.length, ignorados_valor_zero: ignorados };

  // -------------------------------------------------------------------------
  // 3. Notas fiscais — tabela SEPARADA
  // -------------------------------------------------------------------------
  // 3.483 notas, 99,6% apontando para uma cobrança, R$ 4,2 mi. Se entrassem em
  // fin_document ao lado das cobranças, a receita contaria quase o dobro e o
  // teste de aceite falharia culpando a neutralização de transferências.
  const invoices = await readRaw('asaas-invoices.json');
  const invoiceRows = invoices.map((invoice) => [
    entityId,
    invoice.payment ? documentIdByPayment.get(invoice.payment) ?? null : null,
    counterpartyByAsaas.get(invoice.customer)?.id ?? null,
    'nfse',
    invoice.number ?? null,
    invoice.rpsSerie ?? null,
    invoice.rpsNumber ? String(invoice.rpsNumber) : null,
    invoice.effectiveDate ?? null,
    invoice.effectiveDate ?? null,
    cents(invoice.value),
    cents(invoice.deductions),
    invoice.taxes?.iss ?? null,
    Math.round(cents(invoice.value) * ((invoice.taxes?.iss ?? 0) / 100)),
    invoice.taxes?.retainIss ?? false,
    invoice.municipalServiceCode ?? null,
    invoice.municipalServiceName ?? null,
    invoice.status,
    'asaas',
    invoice.id,
    invoice.pdfUrl ?? null,
    invoice.xmlUrl ?? null
  ]);

  await insertBatched(
    client,
    `INSERT INTO fin_fiscal_document (
       entity_id, document_id, counterparty_id, kind, number, serie, rps_number,
       issue_date, competence_date, service_amount_cents, deductions_cents,
       iss_rate, iss_cents, iss_withheld, municipal_service_code, municipal_service_name,
       status, source, source_id, pdf_url, xml_url
     ) VALUES`,
    `ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status, number = EXCLUDED.number, document_id = EXCLUDED.document_id,
                   pdf_url = EXCLUDED.pdf_url, xml_url = EXCLUDED.xml_url, updated_at = now()`,
    21,
    invoiceRows
  );
  report.notas_fiscais = invoiceRows.length;

  // -------------------------------------------------------------------------
  // 4. Extrato → lançamentos (caixa)
  // -------------------------------------------------------------------------
  const transactions = await readRaw('asaas-financial-transactions.json');
  const transactionIdByAsaas = new Map();
  const transactionRows = [];
  const paymentIdByAsaasTx = new Map();
  let zerados = 0;

  for (const tx of transactions) {
    if (cents(tx.value) === 0) {
      zerados += 1;
      continue;
    }
    const description = tx.description?.trim() || tx.type;
    const subject = {
      scope: 'transaction',
      description_norm: normalizeDescription(description),
      counterparty_name_norm: '',
      counterparty_document: null,
      account_slug: ACCOUNT_SLUG,
      amount_cents: cents(tx.value),
      amount_abs: Math.abs(cents(tx.value)),
      source_kind: tx.type,
      billing_type: null,
      direction: cents(tx.value) >= 0 ? 'receber' : 'pagar',
      day_of_month: tx.date ? Number(tx.date.slice(8, 10)) : null
    };
    const hit = classify(rules, subject, { onRuleError: registrarRegraQuebrada });
    const actions = hit?.actions ?? {};
    const categoryId = actions.category_code ? categoryByCode.get(actions.category_code) ?? null : null;

    // Transferência entra como 'em_transito', NUNCA 'pareado'.
    //
    // Só o Asaas está importado: as 372 saídas (−R$ 3,82 mi) existem, mas a
    // perna que chega no Nubank/Inter ainda não. Marcá-las como pareadas as
    // tiraria de toda agregação e o saldo consolidado ficaria menor sem
    // explicação, na primeira tela que alguém abre. 'em_transito' continua
    // visível — é o número honesto — e vira 'pareado' quando o outro extrato
    // chegar e o par for encontrado.
    const isTransfer = actions.transfer === true;

    if (tx.type === 'PAYMENT_RECEIVED' && tx.paymentId) {
      paymentIdByAsaasTx.set(tx.id, { paymentId: tx.paymentId, value: cents(tx.value) });
    }

    transactionRows.push([
      entityId,
      accountId,
      tx.date,
      cents(tx.value),
      description,
      normalizeDescription(description),
      categoryId,
      actions.nucleo ?? null,
      cents(tx.balance),
      tx.type,
      isTransfer ? 'em_transito' : 'nao',
      'asaas',
      tx.id,
      tx.type,
      dedupeHash({ accountSlug: ACCOUNT_SLUG, sourceId: tx.id }),
      !categoryId ? 'pendente' : 'ok',
      estagioDe(hit),
      hit?.rule.id ?? null,
      hit ? JSON.stringify(hit.rationale) : null,
      hit ? startedAt : null
    ]);
  }

  await insertBatched(
    client,
    `INSERT INTO fin_transaction (
       entity_id, account_id, posted_on, amount_cents, description_raw, description_norm,
       category_id, nucleo, balance_after_cents, source_kind, transfer_status,
       source, source_id, source_status, dedupe_hash, review_status,
       classified_by, classified_rule_id, classified_reason, classified_at
     ) VALUES`,
    `ON CONFLICT (account_id, dedupe_version, dedupe_hash)
     DO UPDATE SET
       balance_after_cents = EXCLUDED.balance_after_cents,
       source_kind         = EXCLUDED.source_kind,
       source_status       = EXCLUDED.source_status,
       -- transfer_status PRECISA ser reavaliado: quando uma regra de
       -- classificação muda, a reimportação tem de refletir. Mas 'pareado' é
       -- resultado de conciliação com a outra ponta e não pode ser rebaixado
       -- para 'em_transito' por um sync — isso desfaria a neutralização e a
       -- receita voltaria a contar em dobro.
       transfer_status = CASE WHEN fin_transaction.transfer_status = 'pareado'
                              THEN fin_transaction.transfer_status ELSE EXCLUDED.transfer_status END,
       -- COALESCE: quem classificou continua sendo quem classificou. Sem isto o
       -- sync apagava 'humano' e a linha passava a dizer que ninguém a
       -- classificou, enquanto a categoria (travada) era a da pessoa.
       classified_by      = COALESCE(EXCLUDED.classified_by, fin_transaction.classified_by),
       classified_rule_id = COALESCE(EXCLUDED.classified_rule_id, fin_transaction.classified_rule_id),
       classified_reason  = COALESCE(EXCLUDED.classified_reason, fin_transaction.classified_reason),
       classified_at      = COALESCE(EXCLUDED.classified_at, fin_transaction.classified_at),
       -- review_status DERIVA da categoria que sobrou, não da que a regra achou
       -- nesta rodada. As regras de texto não rodam contra o extrato, então
       -- EXCLUDED vem sempre 'pendente' — atribuir direto devolvia à fila 3 mil
       -- lançamentos já classificados por herança, toda madrugada.
       --
       -- 'adiado' e 'ignorado' são decisões humanas e vencem tudo.
       review_status = CASE
         WHEN fin_transaction.review_status IN ('adiado', 'ignorado') THEN fin_transaction.review_status
         WHEN COALESCE(EXCLUDED.category_id, fin_transaction.category_id) IS NULL THEN 'pendente'
         ELSE 'ok' END,
       category_id = CASE WHEN 'category_id' = ANY (fin_transaction.human_locked_fields) THEN fin_transaction.category_id ELSE COALESCE(EXCLUDED.category_id, fin_transaction.category_id) END,
       nucleo      = CASE WHEN 'nucleo'      = ANY (fin_transaction.human_locked_fields) THEN fin_transaction.nucleo      ELSE COALESCE(EXCLUDED.nucleo, fin_transaction.nucleo) END,
       updated_at = now()
     RETURNING id, source_id`,
    20,
    transactionRows,
    (result) => result.rows.forEach((row) => transactionIdByAsaas.set(row.source_id, row.id))
  );
  report.lancamentos = { inseridos: transactionRows.length, ignorados_valor_zero: zerados };

  // -------------------------------------------------------------------------
  // 5. Liquidações
  // -------------------------------------------------------------------------
  // O Asaas dá `paymentId` na transação: a ligação é EXATA, sem heurística de
  // valor e data. É o melhor caso de conciliação que este módulo vai ver — os
  // extratos de CSV vão precisar de pontuação por similaridade.
  //
  // Liquida pelo BRUTO: PAYMENT_RECEIVED é exatamente payments.value
  // (R$ 3.798.664,15 dos dois lados, conferido), e a tarifa é lançamento
  // próprio. Liquidar pelo líquido deixaria todo documento eternamente
  // 'parcial' e a cobertura de conciliação nunca sairia do chão.
  const settlementRows = [];
  for (const [asaasTxId, info] of paymentIdByAsaasTx) {
    const transactionId = transactionIdByAsaas.get(asaasTxId);
    const documentId = documentIdByPayment.get(info.paymentId);
    if (!transactionId || !documentId) continue;
    settlementRows.push([transactionId, documentId, 'liquidacao', info.value, 'auto_asaas', 100, 'paymentId']);
  }

  // Em lotes, mas por outro motivo: o gatilho fin_settlement_maintains_document
  // roda POR LINHA e atualiza fin_document. São ~3.000 UPDATEs disparados aqui —
  // agrupá-los em poucos comandos evita 3.000 viagens de rede, ainda que o
  // trabalho no servidor seja o mesmo.
  await insertBatched(
    client,
    `INSERT INTO fin_settlement (transaction_id, document_id, kind, amount_cents, method, confidence, matched_by) VALUES`,
    'ON CONFLICT (transaction_id, document_id) DO NOTHING',
    7,
    settlementRows
  );
  const settled = settlementRows.length;
  await client.query(
    `UPDATE fin_transaction SET reconciled_status = 'auto'
      WHERE account_id = $1 AND reconciled_status = 'nao_conciliado'
        AND id IN (SELECT transaction_id FROM fin_settlement)`,
    [accountId]
  );

  // A entrada de caixa herda a categoria da cobrança que ela pagou.
  //
  // Sem isto, as 3.023 linhas de PAYMENT_RECEIVED ficavam sem categoria: as
  // regras de texto rodam sobre a descrição comercial da COBRANÇA ("Laudo das
  // Instalações Elétricas"), enquanto o extrato traz só "Cobrança recebida -
  // fatura nr. 851190761". O índice de classificação marcava 1% e a tela dizia
  // que R$ 3,8 milhões estavam sem categoria — quando na verdade estavam
  // classificados, só que no documento.
  //
  // A regra é conceitualmente certa, não um remendo: o dinheiro que entrou
  // pertence à categoria do serviço que o gerou.
  const { rowCount: herdadas } = await client.query(
    `UPDATE fin_transaction t
        SET category_id = d.category_id,
            nucleo = COALESCE(t.nucleo, d.nucleo),
            counterparty_id = COALESCE(t.counterparty_id, d.counterparty_id),
            classified_by = 'contrato',
            classified_reason = jsonb_build_object('origem', 'herdado do documento liquidado', 'document_id', d.id),
            review_status = CASE WHEN d.category_id IS NULL THEN 'pendente' ELSE 'ok' END,
            updated_at = now()
       FROM fin_settlement s
       JOIN fin_document d ON d.id = s.document_id
      WHERE s.transaction_id = t.id
        AND t.account_id = $1
        AND NOT ('category_id' = ANY (t.human_locked_fields))
        AND d.category_id IS DISTINCT FROM t.category_id`,
    [accountId]
  );
  report.liquidacoes = settled;
  report.categorias_herdadas_do_documento = herdadas;

  // -------------------------------------------------------------------------
  // 5b. Assinaturas → contratos recorrentes
  // -------------------------------------------------------------------------
  // As 27 assinaturas ativas somam R$ 9 mil/mês — só ~5% da receita, mas são a
  // única recorrência que a API conhece, e é delas + dos contratos manuais
  // (PIAU, na migration 0011) que a camada L2 da previsão de caixa se alimenta.
  // Upsert pela chave asaas_subscription_id: assinatura cancelada vira contrato
  // encerrado, nunca é apagada — histórico de recorrência é dado, não lixo.
  const subscriptions = await readRaw('asaas-subscriptions.json');
  let contratosAtivos = 0;
  for (const sub of subscriptions) {
    const cp = counterpartyByAsaas.get(sub.customer);
    const ativo = sub.status === 'ACTIVE' && !sub.deleted;
    if (ativo) contratosAtivos += 1;
    await client.query(
      `INSERT INTO fin_contract (
         entity_id, counterparty_id, name, direction, kind, amount_cents,
         recurrence, day_of_month, asaas_subscription_id, confidence, status, notes
       ) VALUES ($1, $2, $3, 'receber', 'assinatura', $4, 'mensal', $5, $6, 'contratado', $7, $8)
       ON CONFLICT (entity_id, asaas_subscription_id) WHERE asaas_subscription_id IS NOT NULL
       DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
                     status = EXCLUDED.status,
                     day_of_month = EXCLUDED.day_of_month,
                     updated_at = now()`,
      [
        entityId,
        cp?.id ?? null,
        (sub.description?.trim() || 'Assinatura Asaas').slice(0, 140),
        cents(sub.value),
        sub.nextDueDate ? Number(sub.nextDueDate.slice(8, 10)) : null,
        sub.id,
        ativo ? 'ativo' : 'encerrado',
        null
      ]
    );
  }
  report.contratos_recorrentes = { assinaturas: subscriptions.length, ativas: contratosAtivos };

  // -------------------------------------------------------------------------
  // 6. Histórico da contraparte — o estágio que fecha a maior parte da lacuna
  // -------------------------------------------------------------------------
  // Das 850 cobranças sem categoria, 648 (R$ 357 mil) simplesmente NÃO TÊM
  // descrição no Asaas. Nenhuma regra de texto jamais vai pegá-las — não há
  // texto.
  //
  // Mas o cliente é conhecido. Se as 33 cobranças classificadas da PIAU são
  // todas 3.06, as 9 sem descrição dela (R$ 85.450) também são. Esse é o sinal
  // mais forte que existe depois do texto explícito, e é uma consulta, não um
  // problema de aprendizado de máquina.
  //
  // Roda DEPOIS das regras, de propósito: palavra-chave explícita é evidência
  // mais forte que hábito do cliente. Só entra onde a regra não chegou.
  //
  // Dois limiares: 80% de dominância e no mínimo 3 cobranças de base. Abaixo de
  // 90% a linha vai para a fila mesmo classificada — é sugestão, não certeza.
  const { rowCount: porHistorico } = await client.query(
    `WITH hist AS (
       SELECT d.counterparty_id, d.category_id, d.nucleo, count(*) AS n,
              count(*)::numeric / SUM(count(*)) OVER (PARTITION BY d.counterparty_id) AS share
         FROM fin_document d
        WHERE d.entity_id = $1 AND d.direction = 'receber'
          AND d.category_id IS NOT NULL AND d.status <> 'cancelado'
        GROUP BY 1, 2, 3
     ),
     top AS (SELECT DISTINCT ON (counterparty_id) * FROM hist ORDER BY counterparty_id, n DESC)
     UPDATE fin_document d
        SET category_id = top.category_id,
            nucleo = COALESCE(d.nucleo, top.nucleo),
            classified_by = 'historico',
            classified_at = now(),
            classified_reason = jsonb_build_object(
              'estagio', 'historico da contraparte',
              'dominancia', round(top.share, 3),
              'base', top.n),
            review_status = CASE WHEN top.share >= 0.9 THEN 'ok' ELSE 'pendente' END,
            updated_at = now()
       FROM top
      WHERE top.counterparty_id = d.counterparty_id
        AND d.entity_id = $1 AND d.category_id IS NULL
        AND top.share >= 0.8 AND top.n >= 3
        AND NOT ('category_id' = ANY (d.human_locked_fields))`,
    [entityId]
  );
  report.classificadas_por_historico = porHistorico;

  // As entradas de caixa herdam de novo, agora que o histórico preencheu mais
  // documentos.
  await client.query(
    `UPDATE fin_transaction t
        SET category_id = d.category_id,
            nucleo = COALESCE(t.nucleo, d.nucleo),
            classified_by = 'contrato',
            review_status = 'ok',
            updated_at = now()
       FROM fin_settlement s
       JOIN fin_document d ON d.id = s.document_id
      WHERE s.transaction_id = t.id AND t.account_id = $1
        AND d.category_id IS NOT NULL AND t.category_id IS NULL
        AND NOT ('category_id' = ANY (t.human_locked_fields))`,
    [accountId]
  );

  // -------------------------------------------------------------------------
  // 7. Saldo, cobertura e fila de revisão
  // -------------------------------------------------------------------------
  const account = await readRaw('asaas-account.json');
  const balanceCents = cents(account?.balance?.balance);
  // `total` reconstrói o saldo, e reconstruir exige a abertura: a variância
  // existe para acusar buraco de cobertura, e nasceria valendo o saldo inicial
  // se ele ficasse de fora. No Asaas a abertura é zero (o ledger carrega desde
  // 2021), mas ler a coluna em vez de assumir zero é o que impede que a conta
  // quebre no dia em que ela deixar de ser.
  const { rows: computed } = await client.query(
    `SELECT COALESCE(a.opening_balance_cents, 0)
            + COALESCE((SELECT SUM(t.amount_cents) FROM fin_transaction t WHERE t.account_id = a.id), 0) AS total,
            (SELECT MIN(t.posted_on) FROM fin_transaction t WHERE t.account_id = a.id) AS first,
            (SELECT MAX(t.posted_on) FROM fin_transaction t WHERE t.account_id = a.id) AS last
       FROM fin_account a WHERE a.id = $1`,
    [accountId]
  );

  if (balanceCents) {
    await client.query(
      `INSERT INTO fin_balance_snapshot (account_id, date, balance_cents, source, computed_cents, variance_cents)
       VALUES ($1, CURRENT_DATE, $2, 'api', $3, $4)
       ON CONFLICT (account_id, date, source) DO UPDATE SET
         balance_cents = EXCLUDED.balance_cents, computed_cents = EXCLUDED.computed_cents,
         variance_cents = EXCLUDED.variance_cents`,
      [accountId, balanceCents, computed[0].total, balanceCents - computed[0].total]
    );
  }

  if (computed[0].first) {
    await client.query(
      `INSERT INTO fin_statement_coverage (account_id, period_start, period_end, source)
       VALUES ($1, $2, $3, 'api')
       ON CONFLICT (account_id, source, period_start)
       DO UPDATE SET period_end = GREATEST(fin_statement_coverage.period_end, EXCLUDED.period_end)`,
      [accountId, computed[0].first, computed[0].last]
    );
    await client.query('UPDATE fin_account SET last_statement_at = now(), current_balance_cents = $2 WHERE id = $1', [
      accountId,
      balanceCents || computed[0].total
    ]);
  }

  // A fila é o inventário invisível: decisões não tomadas, com valor em reais.
  // Por isso é ordenada por R$ e não por data.
  await client.query(
    `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents)
     SELECT $1, 'fin_document', d.id,
            -- 'texto_generico' precisa incluir a descrição VAZIA: são 648 das
            -- 850 sem categoria, e é justamente esse grupo que depende do
            -- histórico da contraparte em vez de regra de texto. Roteá-lo como
            -- 'sem_categoria' mandava para a fila errada quem mais precisava da
            -- estratégia certa.
            CASE WHEN d.category_id IS NULL AND (
                        d.description_norm IN ('', 'sem descricao')
                     OR d.description_norm LIKE 'cobranca gerada automaticamente%') THEN 'texto_generico'
                 WHEN d.category_id IS NULL THEN 'sem_categoria'
                 ELSE 'baixa_confianca' END,
            d.amount_cents
       FROM fin_document d
      WHERE d.entity_id = $1 AND d.review_status = 'pendente'
     ON CONFLICT (target_table, target_id) DO NOTHING`,
    [entityId]
  );
  await client.query(
    `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents)
     SELECT $1, 'fin_transaction', t.id, 'sem_categoria', t.amount_cents
       FROM fin_transaction t
      WHERE t.entity_id = $1 AND t.review_status = 'pendente'
     ON CONFLICT (target_table, target_id) DO NOTHING`,
    [entityId]
  );

  // Item cuja causa desapareceu sai da fila. Sem isto ela só crescia: uma regra
  // nova classificava a cobrança e o item continuava lá, pendente para sempre.
  await client.query(
    `UPDATE fin_review_item ri
        SET status = 'resolvido', resolved_at = now(), resolved_by = 'import'
      WHERE ri.entity_id = $1 AND ri.status = 'pendente'
        AND ((ri.target_table = 'fin_document'
              AND EXISTS (SELECT 1 FROM fin_document d WHERE d.id = ri.target_id AND d.review_status = 'ok'))
          OR (ri.target_table = 'fin_transaction'
              AND EXISTS (SELECT 1 FROM fin_transaction t WHERE t.id = ri.target_id AND t.review_status = 'ok')))`,
    [entityId]
  );

  if (regrasQuebradas.size) {
    report.regras_quebradas = [...regrasQuebradas.values()];
  }

  const { rows: fila } = await client.query(
    `SELECT count(*) n, COALESCE(SUM(abs(amount_cents)),0) v FROM fin_review_item WHERE entity_id = $1 AND status = 'pendente'`,
    [entityId]
  );
  report.fila_revisao = { itens: Number(fila[0].n), valor: brl(Number(fila[0].v)) };
  report.saldo_api = brl(balanceCents);
  report.saldo_calculado = brl(computed[0].total);
  report.divergencia = brl(balanceCents - computed[0].total);

  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, batch_id, actor)
     VALUES ($1, 'fin_transaction', 0, 'import', $2::jsonb, $3, 'sync-asaas')`,
    [entityId, JSON.stringify(report), batchId]
  );

  await client.query('COMMIT');
  console.log(JSON.stringify({ duracao_s: Math.round((Date.now() - startedAt) / 1000), ...report }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  // sync_mode é transacional: some com o COMMIT ou o ROLLBACK, sem precisar de
  // limpeza explícita.
  client.release();
  await pool.end();
}
