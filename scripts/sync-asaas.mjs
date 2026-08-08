// Sync do Asaas: API → data/raw/asaas-*.json
//
// Separado da importação para o banco (scripts/import-asaas.mjs) pelo mesmo
// motivo que o resto do pipeline separa sync de analyze: uma carga que falha no
// meio pode ser reexecutada sem bater na API de novo, e o JSON bruto fica
// diffável quando um número na tela não bate.
//
// O Asaas é a fonte mais valiosa que a empresa tem: 100% da receita, cinco anos
// de histórico, notas fiscais com ISS e a carteira a vencer. Também é a única
// que atualiza sozinha, sem ninguém baixar arquivo.
//
// Uso:
//   node scripts/sync-asaas.mjs           incremental (janela de 45 dias)
//   node scripts/sync-asaas.mjs --full    histórico inteiro, desde 2021
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { loadEnv } from './lib/env.mjs';
import { createJsonFetcher, fetchAllPages } from './lib/http.mjs';
import { rawDirUrl, ensureDataDirs } from './lib/paths.mjs';

ensureDataDirs();
loadEnv();

const API_BASE = (process.env.ASAAS_API_URL || 'https://api.asaas.com/v3').replace(/\/$/, '');
const API_KEY = process.env.ASAAS_API_KEY;
if (!API_KEY) throw new Error('ASAAS_API_KEY ausente em .env.local');

const FULL = process.argv.includes('--full') || process.env.ASAAS_FULL_SYNC === '1';
const WINDOW_DAYS = Number(process.env.ASAAS_SYNC_WINDOW_DAYS ?? 45);

const outDir = rawDirUrl;
await mkdir(outDir, { recursive: true });

const now = new Date().toISOString();
const headers = { access_token: API_KEY, 'User-Agent': 'xpe-plataforma/financeiro' };
const fetchJson = createJsonFetcher({ label: 'asaas' });
const getJson = (url) => fetchJson(url, { headers });

const report = {};

async function writeJson(name, data, extra = {}) {
  await writeFile(new URL(name, outDir), JSON.stringify({ syncedAt: now, ...extra, data }, null, 2));
}

async function readPrevious(name) {
  try {
    return JSON.parse(await readFile(new URL(name, outDir), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Busca uma coleção paginada inteira, tolerando falta de permissão.
 *
 * A chave em uso hoje é somente-leitura para movimentação: /transfers, /bill e
 * /pix/transactions respondem 403. Isso é uma PROTEÇÃO enquanto não houver
 * perfis de acesso — chave vazada não move dinheiro. Registrar o 403 em vez de
 * estourar deixa o sync pronto para o dia em que a chave for ampliada, sem
 * mudar código.
 */
async function collect(label, path, params = {}) {
  const buildUrl = (offset, limit) => {
    const search = new URLSearchParams({ ...params, limit: String(limit), offset: String(offset) });
    return `${API_BASE}${path}?${search}`;
  };
  try {
    const rows = await fetchAllPages(getJson, buildUrl, {
      limit: 100,
      onPage: (count, total) => {
        if (total && total > 500) process.stdout.write(`\r  ${label}: ${count}/${total}   `);
      }
    });
    process.stdout.write(`\r  ${label}: ${rows.length} registros${' '.repeat(24)}\n`);
    report[label] = rows.length;
    return rows;
  } catch (error) {
    if (/insufficient_permission|\b403\b/.test(error.message)) {
      console.warn(`  ${label}: sem permissão na chave atual (403) — pulando`);
      report[label] = 'sem_permissao';
      return [];
    }
    throw error;
  }
}

/**
 * Janela incremental generosa de propósito.
 *
 * Lançamento bancário chega atrasado, cobrança muda de status dias depois, e o
 * `dedupe_hash` torna a sobreposição gratuita. Economizar requisição aqui só
 * cria buraco silencioso no dado.
 */
function windowStart(lastSyncedAt) {
  const base = lastSyncedAt ? new Date(lastSyncedAt) : new Date();
  return new Date(base.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

const previousPayments = await readPrevious('asaas-payments.json');
const lastSyncedAt = previousPayments?.syncedAt ?? null;
const since = FULL ? '2021-01-01' : windowStart(lastSyncedAt);

console.log(
  `[asaas] modo=${FULL ? 'completo' : 'incremental'} desde=${since}` +
    (lastSyncedAt ? ` (último sync ${lastSyncedAt.slice(0, 10)})` : ' (primeira execução)')
);

// ---------------------------------------------------------------------------
// Cadastros — pequenos, sempre completos
// ---------------------------------------------------------------------------
await writeJson('asaas-customers.json', await collect('customers', '/customers'));
await writeJson('asaas-subscriptions.json', await collect('subscriptions', '/subscriptions'));
await writeJson('asaas-installments.json', await collect('installments', '/installments'));

// ---------------------------------------------------------------------------
// Cobranças — três passadas
// ---------------------------------------------------------------------------
// O STATUS de uma cobrança muda sem que o dateCreated mude. Um filtro só por
// data de criação perderia para sempre o instante em que um PENDING vira
// RECEIVED — e é exatamente esse instante que interessa para o caixa.
//
//   1. criadas recentemente     → cobranças novas
//   2. pagas recentemente       → cobranças antigas que acabaram de entrar
//   3. carteira aberta inteira  → ~280 registros; rebuscar toda noite é de
//                                 graça e garante que o aging nunca envelhece
const paymentsById = new Map();
const absorb = (rows) => rows.forEach((row) => paymentsById.set(row.id, row));

if (FULL) {
  absorb(await collect('payments (histórico completo)', '/payments'));
} else {
  // Sem a base anterior, um incremental jogaria fora todo o histórico.
  for (const row of previousPayments?.data ?? []) paymentsById.set(row.id, row);
  absorb(await collect('payments (criadas)', '/payments', { 'dateCreated[ge]': since }));
  absorb(await collect('payments (pagas)', '/payments', { 'paymentDate[ge]': since }));
}
absorb(await collect('payments (pendentes)', '/payments', { status: 'PENDING' }));
absorb(await collect('payments (vencidas)', '/payments', { status: 'OVERDUE' }));

const payments = [...paymentsById.values()];
report.payments_total = payments.length;
await writeJson('asaas-payments.json', payments, { mode: FULL ? 'full' : 'incremental', since });

// ---------------------------------------------------------------------------
// Extrato — a origem do ledger
// ---------------------------------------------------------------------------
const previousTx = await readPrevious('asaas-financial-transactions.json');
const txById = new Map((previousTx?.data ?? []).map((row) => [row.id, row]));
for (const row of await collect('financialTransactions', '/financialTransactions', FULL ? {} : { startDate: since })) {
  txById.set(row.id, row);
}
const transactions = [...txById.values()];
report.financialTransactions_total = transactions.length;
await writeJson('asaas-financial-transactions.json', transactions, { mode: FULL ? 'full' : 'incremental', since });

// ---------------------------------------------------------------------------
// Notas fiscais — a camada de competência, já pronta
// ---------------------------------------------------------------------------
// 3.483 NFS-e com ISS, data efetiva e status (inclusive agendadas até 2027).
// É competência e base tributária sem ninguém digitar nada.
const previousInvoices = await readPrevious('asaas-invoices.json');
const invoiceById = new Map((previousInvoices?.data ?? []).map((row) => [row.id, row]));
for (const row of await collect('invoices (NFS-e)', '/invoices')) invoiceById.set(row.id, row);
const invoices = [...invoiceById.values()];
report.invoices_total = invoices.length;
await writeJson('asaas-invoices.json', invoices);

// ---------------------------------------------------------------------------
// Saldo e regime tributário
// ---------------------------------------------------------------------------
const balance = await getJson(`${API_BASE}/finance/balance`);
const fiscalInfo = await getJson(`${API_BASE}/fiscalInfo`).catch(() => null);
await writeJson('asaas-account.json', { balance, fiscalInfo });
report.balance = balance?.balance;

// Endpoints de movimentação: hoje 403. Tentar mesmo assim é o que avisa, no dia
// em que a chave for ampliada, que dá para ligar pagamento automático.
const transfers = await collect('transfers', '/transfers');
if (transfers.length) await writeJson('asaas-transfers.json', transfers);

console.log('\n' + JSON.stringify({ syncedAt: now, mode: FULL ? 'full' : 'incremental', since, ...report }, null, 2));
