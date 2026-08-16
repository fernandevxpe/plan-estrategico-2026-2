// Ingere o cartão de crédito do Polp: faturas, itens, compras não faturadas e
// parcelamentos. Escreve SÓ nas tabelas fin_card_* da migration 0047.
//
// NÃO TOCA NO LEDGER. `fin_transaction` é lida (para achar o "Pagamento de
// fatura" que casa com cada fatura) e nunca escrita. Isso não é cautela: é a
// regra que impede a dupla contagem. A saída de caixa do cartão já está no
// ledger como uma linha na conta corrente; as 795 compras são o DETALHAMENTO
// dessa linha, não outras saídas. Somar as duas coisas conta o mesmo gasto
// duas vezes — ver §1 e §3 da 0047.
//
// A API do Polp é acessada SOMENTE com GET.
//
// Uso:
//   node scripts/sync-polp-cartao.mjs --dry-run    mede e não grava
//   node scripts/sync-polp-cartao.mjs              grava
//   node scripts/sync-polp-cartao.mjs --conta=nubank-cartao
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const CONTA_SLUG = argOf('conta', 'nubank-cartao');

const brl = (cents) =>
  (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// Credenciais: só o que interessa, e nunca impressas
// ---------------------------------------------------------------------------
// O `.env.obras` é o `.env.local` inteiro do outro projeto e traz chaves de
// ESCRITA (service_role do Supabase, Asaas de produção, Clicksign). Carregá-lo
// com um loader jogaria tudo em process.env, onde qualquer outro trecho deste
// processo poderia usá-las por engano. Aqui saem quatro chaves, e só elas.
const POLP_KEYS = new Set([
  'POLP_API_CLIENT',
  'POLP_API_SECRET',
  'POLP_API_BASE_URL',
  'POLP_INTEGRATION_ID',
  'POLP_CREDIT_ACCOUNT_ID'
]);

function lerPolpEnv() {
  const path = ['.env.obras', resolve(process.cwd(), '.env.obras')].find((p) => existsSync(p));
  if (!path) throw new Error('.env.obras não encontrado — é dele que saem as credenciais do Polp');
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!POLP_KEYS.has(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  if (!out.POLP_API_CLIENT || !out.POLP_API_SECRET) {
    throw new Error('POLP_API_CLIENT/POLP_API_SECRET ausentes no .env.obras');
  }
  return out;
}

const POLP = lerPolpEnv();
const BASE = POLP.POLP_API_BASE_URL || 'https://api.polp.com.br/api/v1';

/** GET, e só GET. Não existe caminho neste arquivo que escreva na API. */
async function polpGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-client': POLP.POLP_API_CLIENT,
      'x-api-secret': POLP.POLP_API_SECRET
    }
  });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

/** Segue a paginação do Laravel até o fim. */
async function polpGetAll(path) {
  const sep = path.includes('?') ? '&' : '?';
  const out = [];
  let page = 1;
  for (;;) {
    const j = await polpGet(`${path}${sep}page=${page}`);
    out.push(...(j.data ?? []));
    const meta = j.meta ?? {};
    if (!meta.last_page || page >= meta.last_page) break;
    page += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalização e chaves
// ---------------------------------------------------------------------------
const SUFIXO_PARCELA = /\s*\d+\s*\/\s*\d+\s*$/;

/**
 * Identidade da compra parcelada.
 *
 * Colapsa espaço repetido e baixa a caixa ANTES de comparar. Não é preciosismo:
 * a mesma compra chega como "HUBLA *MEGABLACKEL" e "HUBLA  *MEGABLACKEL" (dois
 * espaços), e sem colapsar um plano de 12 parcelas vira dois planos de 7 e 5 —
 * foi o que aconteceu na primeira medição.
 *
 * NÃO inclui o final do cartão: ele muda no meio do plano em 15 dos 24 casos,
 * porque o cartão é reemitido e a compra continua sob outro final.
 */
const normalizaDescricao = (d) =>
  (d || '').replace(SUFIXO_PARCELA, '').replace(/\s+/g, ' ').trim().toLowerCase();

const purchaseKey = (cm, descricao) =>
  `${normalizaDescricao(descricao)}|${cm.purchaseDate.slice(0, 10)}|${cm.totalInstallments}`;

const mesDe = (iso) => `${iso.slice(0, 7)}-01`;

/** Soma meses a um 'YYYY-MM-01'. */
function somaMeses(mes, k) {
  const y = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7)) + k;
  const ay = y + Math.floor((m - 1) / 12);
  const am = ((m - 1) % 12 + 12) % 12 + 1;
  return `${String(ay).padStart(4, '0')}-${String(am).padStart(2, '0')}-01`;
}

const cents = (v) => Math.round(Number(v || 0) * 100);

/**
 * Natureza da linha. A separação que mais importa é 'pagamento_fatura': a fonte
 * devolve o pagamento DENTRO da própria fatura, e ele não é gasto. Toda soma de
 * despesa precisa excluí-lo, senão a fatura de agosto (R$ 10.107,31) apareceria
 * como dez mil reais de crédito.
 */
function classificaKind(t) {
  const d = (t.description || '').toLowerCase();
  if (d.includes('pagamento recebido')) return 'pagamento_fatura';
  if (d.startsWith('estorno')) return 'estorno';
  if (d.includes('iof')) return 'iof';
  if (d.includes('juros') || d.includes('multa') || d.includes('encargo')) return 'encargo';
  return t.amount < 0 ? 'estorno' : 'compra';
}

// ---------------------------------------------------------------------------
// Leitura da API
// ---------------------------------------------------------------------------
const contaCreditoId = POLP.POLP_CREDIT_ACCOUNT_ID;
const integrationId = POLP.POLP_INTEGRATION_ID;

if (!contaCreditoId && !integrationId) {
  throw new Error('defina POLP_CREDIT_ACCOUNT_ID ou POLP_INTEGRATION_ID no .env.obras');
}

/** Acha a conta CREDIT e devolve o bloco credit_data inteiro. */
async function lerContaCredito() {
  if (integrationId) {
    const j = await polpGet(`/integrations/${integrationId}/accounts`);
    const contas = j.data ?? j;
    const credito = contas.find(
      (c) => c.type === 'CREDIT' && (!contaCreditoId || String(c.id) === String(contaCreditoId))
    );
    if (credito) return credito;
  }
  const j = await polpGet(`/accounts/${contaCreditoId}`);
  return j.data ?? j;
}

console.log(`[cartao] lendo API do Polp (GET)…`);
const conta = await lerContaCredito();
const cd = conta.credit_data ?? {};

const [faturas, transacoes] = await Promise.all([
  polpGetAll(`/accounts/${conta.id}/bills`),
  polpGetAll(`/accounts/${conta.id}/transactions`)
]);

console.log(`[cartao] conta CREDIT ${conta.id} · ${faturas.length} faturas · ${transacoes.length} transações`);

// ---------------------------------------------------------------------------
// Cartões: registrados hoje x só no histórico
// ---------------------------------------------------------------------------
const registrados = new Set(
  [conta.number, ...(cd.additionalCards ?? []).map((c) => c.number)].filter(Boolean).map(String)
);
const cartoes = new Map(); // last4 -> { last4, status, is_primary, first, last, n }
for (const t of transacoes) {
  const last4 = t.credit_card_metadata?.cardNumber;
  if (!last4) continue;
  const dia = t.date.slice(0, 10);
  const prev = cartoes.get(last4) ?? { last4, first: dia, last: dia, n: 0 };
  prev.first = dia < prev.first ? dia : prev.first;
  prev.last = dia > prev.last ? dia : prev.last;
  prev.n += 1;
  cartoes.set(last4, prev);
}
for (const last4 of registrados) if (!cartoes.has(last4)) cartoes.set(last4, { last4, first: null, last: null, n: 0 });
for (const c of cartoes.values()) {
  c.status = registrados.has(c.last4) ? 'registrado' : 'historico';
  c.is_primary = String(conta.number) === c.last4;
}

// ---------------------------------------------------------------------------
// Faturas
// ---------------------------------------------------------------------------
const faturaPorId = new Map(faturas.map((b) => [b.id, b]));
const venceEm = new Map(faturas.map((b) => [b.id, b.due_date.slice(0, 10)]));

// Mês da PRÓXIMA fatura, que o Polp ainda não criou. É onde caem as compras do
// ciclo aberto. Derivado do vencimento mais recente + 1 mês.
const ultimoVenc = faturas.map((b) => b.due_date.slice(0, 10)).sort().at(-1);
const mesProximaFatura = ultimoVenc ? somaMeses(mesDe(ultimoVenc), 1) : null;

// ---------------------------------------------------------------------------
// Itens e parcelamentos
// ---------------------------------------------------------------------------
const itens = [];

for (const t of transacoes) {
  const cm = t.credit_card_metadata ?? {};
  const kind = classificaKind(t);
  const parcelada = cm.installmentNumber != null && cm.totalInstallments != null && cm.purchaseDate;

  let competencia = null;
  let base = null;

  if (parcelada) {
    // A REGRA DE AGENDAMENTO. Não usa o campo `date` da fonte: para parcela
    // futura ele é carimbado com a abertura do ciclo (6 das 21 vinham com
    // 02/08/2026) e não com o mês da cobrança. purchaseDate + número da parcela
    // acertou 135/135 das parcelas já faturadas, onde o mês real é conhecido.
    competencia = somaMeses(mesDe(cm.purchaseDate.slice(0, 10)), cm.installmentNumber);
    base = purchaseKey(cm, t.description);
  } else if (t.bill_id && venceEm.has(t.bill_id)) {
    competencia = mesDe(venceEm.get(t.bill_id));
  } else if (t.status === 'PENDING') {
    // Compra do ciclo aberto: cai na próxima fatura.
    competencia = mesProximaFatura;
  }

  itens.push({
    plano_base: base,
    plano_key: null,
    plano_label: parcelada
      ? (t.description || '').replace(SUFIXO_PARCELA, '').replace(/\s+/g, ' ').trim()
      : null,
    external_id: String(t.id),
    provider_id: t.provider_id ?? null,
    bill_external_id: t.bill_id ? String(t.bill_id) : null,
    posted_on: t.date.slice(0, 10),
    amount_cents: cents(t.amount),
    description: t.description || '(sem descrição)',
    description_norm: normalizaDescricao(t.description),
    merchant: t.merchant ?? null,
    mcc: cm.payeeMCC ?? null,
    card_last4: cm.cardNumber ?? null,
    status: t.status,
    kind,
    installment_number: parcelada ? cm.installmentNumber : null,
    installments_total: parcelada ? cm.totalInstallments : null,
    purchase_date: parcelada ? cm.purchaseDate.slice(0, 10) : null,
    competence_month: competencia,
    source_category: t.category?.description ?? null
  });
}

// ---------------------------------------------------------------------------
// Duas compras podem cair na mesma chave — e caem
// ---------------------------------------------------------------------------
// Medido: "Loja das Bolsas", 06/09/2025, duas compras em 3x no mesmo dia, uma de
// R$ 80,00 e outra de R$ 26,6x. Mesma descrição, mesma data, mesmo total: uma
// chave só, seis parcelas, e um "plano de 3 parcelas" com 6 — que a constraint
// fin_card_plan_contagem_coerente da 0047 recusa, como deve.
//
// A tentação é pôr o valor na chave. Não serve: dentro de UM plano o valor
// varia (a primeira parcela difere das demais em até 11 centavos no acervo — MP
// *ALIEXPRESS 70,24 contra 70,13), e qualquer arredondamento que separe R$ 80 de
// R$ 26 também parte Ryndack 137,52 de Ryndack 137,45. Testado: quebra.
//
// O critério que funciona não depende de limiar. Se o número de parcela se
// repete dentro da chave, então existem N compras distintas; distribui-se cada
// ocorrência entre elas por valor decrescente. Determinístico, estável entre
// execuções, e sem número mágico.
const planos = new Map();
const porBase = new Map();
for (const it of itens) {
  if (!it.plano_base) continue;
  if (!porBase.has(it.plano_base)) porBase.set(it.plano_base, []);
  porBase.get(it.plano_base).push(it);
}

for (const [base, lista] of porBase) {
  const porNumero = new Map();
  for (const it of lista) {
    if (!porNumero.has(it.installment_number)) porNumero.set(it.installment_number, []);
    porNumero.get(it.installment_number).push(it);
  }
  const compras = Math.max(...[...porNumero.values()].map((v) => v.length));

  for (const mesmas of porNumero.values()) {
    mesmas.sort((a, b) => b.amount_cents - a.amount_cents);
    mesmas.forEach((it, i) => {
      it.plano_key = compras > 1 ? `${base}#${i + 1}` : base;
    });
  }

  for (const it of lista) {
    const p = planos.get(it.plano_key) ?? {
      key: it.plano_key,
      merchant_label: it.plano_label,
      description_norm: it.description_norm,
      purchase_date: it.purchase_date,
      installments_total: it.installments_total,
      parcelas: []
    };
    p.parcelas.push({ n: it.installment_number, amount_cents: it.amount_cents, status: it.status });
    planos.set(it.plano_key, p);
  }
}

// Fecha os números de cada plano.
for (const p of planos.values()) {
  const faturadas = p.parcelas.filter((x) => x.status === 'POSTED');
  const abertas = p.parcelas.filter((x) => x.status === 'PENDING');
  // Valor da parcela: a MAIS RECENTE faturada, não a primeira. A primeira
  // costuma diferir em centavos das demais (arredondamento do parcelamento).
  const ref = p.parcelas.slice().sort((a, b) => b.n - a.n)[0];
  p.installments_billed = faturadas.length;
  p.installments_open = abertas.length;
  p.open_amount_cents = abertas.reduce((s, x) => s + x.amount_cents, 0);
  p.installment_amount_cents = ref?.amount_cents ?? 0;
  // Declaradamente estimado: credit_card_metadata.totalAmount vem null em 795/795.
  p.total_amount_cents = p.installment_amount_cents * p.installments_total;
  p.status = p.installments_open > 0 ? 'ativo' : 'quitado';
  const meses = p.parcelas.map((x) => somaMeses(mesDe(p.purchase_date), x.n)).sort();
  p.first_competence_month = meses[0];
  p.last_competence_month = somaMeses(mesDe(p.purchase_date), p.installments_total);
}

// Quanto cada fatura tem de item — para gravar a lacuna em vez de escondê-la.
const itemizadoPorFatura = new Map();
for (const it of itens) {
  if (!it.bill_external_id || it.kind === 'pagamento_fatura') continue;
  const k = it.bill_external_id;
  itemizadoPorFatura.set(k, (itemizadoPorFatura.get(k) ?? 0) + it.amount_cents);
}

// ---------------------------------------------------------------------------
// Relatório (sempre, dry-run ou não)
// ---------------------------------------------------------------------------
const pend = itens.filter((i) => i.status === 'PENDING' && i.kind !== 'pagamento_fatura');
const parcelasAbertas = pend.filter((i) => i.installment_number != null);
const comprasCiclo = pend.filter((i) => i.installment_number == null);
const totalFaturado = faturas.reduce((s, b) => s + cents(b.total_amount), 0);
const totalItemizado = [...itemizadoPorFatura.values()].reduce((s, v) => s + v, 0);

console.log('');
console.log('── cartões ──────────────────────────────────────────────');
for (const c of [...cartoes.values()].sort((a, b) => b.n - a.n)) {
  console.log(`  ${c.last4}  ${String(c.n).padStart(3)} transações  ${c.status}${c.is_primary ? '  (titular)' : ''}`);
}

console.log('');
console.log('── faturas ──────────────────────────────────────────────');
console.log(`  ${faturas.length} faturas · faturado ${brl(totalFaturado)}`);
console.log(`  explicado por itens ${brl(totalItemizado)} (${((100 * totalItemizado) / totalFaturado).toFixed(1)}%)`);
console.log(`  NÃO ITEMIZADO pela fonte ${brl(totalFaturado - totalItemizado)} — gravado em unitemized_amount_cents`);
for (const b of faturas.slice().sort((x, y) => x.due_date.localeCompare(y.due_date))) {
  const pago = b.payments?.[0];
  const it = itemizadoPorFatura.get(String(b.id)) ?? 0;
  const dif = pago ? cents(b.total_amount) - cents(pago.amount) : null;
  console.log(
    `   venc ${b.due_date.slice(0, 10)}  fatura ${brl(cents(b.total_amount)).padStart(13)}` +
      `  itens ${brl(it).padStart(13)}` +
      (pago ? `  pago ${b.payments[0].paymentDate.slice(0, 10)} ${brl(cents(pago.amount)).padStart(13)}` : '  NÃO PAGA') +
      (dif ? `  Δ ${brl(dif)}` : '')
  );
}

console.log('');
console.log('── parcelamento ─────────────────────────────────────────');
console.log(`  ${planos.size} compras parceladas · ${[...planos.values()].reduce((s, p) => s + p.parcelas.length, 0)} parcelas observadas`);
console.log(`  ${[...planos.values()].filter((p) => p.status === 'ativo').length} planos com parcela em aberto · ${parcelasAbertas.length} parcelas a vencer`);

console.log('');
console.log('── COMPROMISSO POR MÊS FUTURO ───────────────────────────');
const porMes = new Map();
for (const i of pend) {
  const m = i.competence_month ?? 'indeterminado';
  const g = porMes.get(m) ?? { parcela: 0, ciclo: 0, n: 0, itens: [] };
  if (i.installment_number != null) g.parcela += i.amount_cents;
  else g.ciclo += i.amount_cents;
  g.n += 1;
  g.itens.push(i);
  porMes.set(m, g);
}
let acumulado = 0;
for (const m of [...porMes.keys()].sort()) {
  const g = porMes.get(m);
  acumulado += g.parcela + g.ciclo;
  console.log(
    `  ${m.slice(0, 7)}  total ${brl(g.parcela + g.ciclo).padStart(13)}` +
      `  (parcelas ${brl(g.parcela)} · ciclo aberto ${brl(g.ciclo)})  ${g.n} itens`
  );
  for (const i of g.itens.filter((x) => x.installment_number != null).sort((a, b) => b.amount_cents - a.amount_cents)) {
    const faltam = i.installments_total - i.installment_number;
    console.log(
      `        ${i.description.replace(SUFIXO_PARCELA, '').trim().slice(0, 30).padEnd(30)}` +
        ` ${String(i.installment_number)}/${i.installments_total}` +
        `  ${brl(i.amount_cents).padStart(11)}  faltam ${faltam} depois desta`
    );
  }
}
console.log(`  ${'—'.repeat(56)}`);
console.log(`  total comprometido ${brl(acumulado)}`);
console.log(
  `  saldo da conta CREDIT informado pela fonte ${brl(cents(cd.usedAmount ?? conta.balance))}` +
    `  ·  resíduo ${brl(cents(conta.balance) - acumulado)}`
);

if (DRY) {
  console.log('');
  console.log(`[cartao] --dry-run: nada gravado. Escreveria ${faturas.length} faturas, ${itens.length} itens, ${planos.size} planos, ${cartoes.size} cartões.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Gravação — só em fin_card_*
// ---------------------------------------------------------------------------
const pool = financePool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Liga a trava de campos travados por humano: o sync não desfaz classificação
  // feita por gente.
  await client.query("SELECT set_config('fin.sync_mode', 'on', true)");

  const { rows: contaRows } = await client.query(
    `UPDATE fin_card_account
        SET credit_limit_cents    = $2,
            used_limit_cents      = $3,
            available_limit_cents = $4,
            minimum_payment_cents = $5,
            next_due_date         = $6,
            brand                 = COALESCE($7, brand),
            external_id           = COALESCE(external_id, $8),
            balance_synced_at     = now()
      WHERE slug = $1
      RETURNING id, entity_id`,
    [
      CONTA_SLUG,
      cents(cd.creditLimit),
      cents(cd.usedAmount ?? conta.balance),
      cents(cd.availableCreditLimit),
      cents(cd.minimumPayment),
      cd.balanceDueDate ?? null,
      cd.brand ?? null,
      String(conta.id)
    ]
  );
  if (!contaRows.length) throw new Error(`conta de cartão '${CONTA_SLUG}' não existe — rode a migration 0047`);
  const cardAccountId = contaRows[0].id;

  // ── cartões ──
  const idPorLast4 = new Map();
  for (const c of cartoes.values()) {
    const { rows } = await client.query(
      `INSERT INTO fin_card (card_account_id, last4, status, is_primary, first_seen_on, last_seen_on)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (card_account_id, last4) DO UPDATE SET
         status       = EXCLUDED.status,
         is_primary   = EXCLUDED.is_primary,
         first_seen_on = LEAST(fin_card.first_seen_on, EXCLUDED.first_seen_on),
         last_seen_on  = GREATEST(fin_card.last_seen_on, EXCLUDED.last_seen_on)
       RETURNING id`,
      [cardAccountId, c.last4, c.status, c.is_primary, c.first, c.last]
    );
    idPorLast4.set(c.last4, rows[0].id);
  }

  // ── faturas ──
  const idPorFaturaExterna = new Map();
  for (const b of faturas) {
    const pago = b.payments?.[0] ?? null;
    const venc = b.due_date.slice(0, 10);
    const encargos = (b.finance_charges ?? []).reduce((s, f) => s + cents(f.amount ?? 0), 0);
    // `status` vem do que a FONTE diz sobre a própria fatura — o banco afirmando
    // um fato dele. Não é o sync decidindo que algo foi pago: a conciliação com
    // o NOSSO caixa é o passo seguinte, e ela é separada de propósito.
    const status = pago
      ? cents(pago.amount) >= cents(b.total_amount)
        ? 'paga'
        : 'paga_parcial'
      : 'fechada';
    const { rows } = await client.query(
      `INSERT INTO fin_card_bill (
         card_account_id, external_id, due_date, reference_month, total_amount_cents,
         minimum_payment_cents, itemized_amount_cents, paid_amount_cents, paid_on,
         payment_mode, payment_value_type, status, finance_charges_cents, synced_at)
       VALUES ($1,$2,$3,date_trunc('month',$3::date)::date,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (external_source, external_id) DO UPDATE SET
         due_date              = EXCLUDED.due_date,
         reference_month       = EXCLUDED.reference_month,
         total_amount_cents    = EXCLUDED.total_amount_cents,
         minimum_payment_cents = EXCLUDED.minimum_payment_cents,
         itemized_amount_cents = EXCLUDED.itemized_amount_cents,
         paid_amount_cents     = EXCLUDED.paid_amount_cents,
         paid_on               = EXCLUDED.paid_on,
         payment_mode          = EXCLUDED.payment_mode,
         payment_value_type    = EXCLUDED.payment_value_type,
         status                = EXCLUDED.status,
         finance_charges_cents = EXCLUDED.finance_charges_cents,
         synced_at             = now()
       RETURNING id`,
      [
        cardAccountId,
        String(b.id),
        venc,
        cents(b.total_amount),
        cents(b.minimum_payment_amount),
        itemizadoPorFatura.get(String(b.id)) ?? 0,
        pago ? cents(pago.amount) : null,
        pago ? pago.paymentDate.slice(0, 10) : null,
        pago?.paymentMode ?? null,
        pago?.valueType ?? null,
        status,
        encargos
      ]
    );
    idPorFaturaExterna.set(String(b.id), rows[0].id);
  }

  // ── planos ──
  const idPorPlanoKey = new Map();
  for (const p of planos.values()) {
    const { rows } = await client.query(
      `INSERT INTO fin_card_installment_plan (
         card_account_id, purchase_key, merchant_label, description_norm, purchase_date,
         installments_total, installment_amount_cents, total_amount_cents, total_is_estimated,
         installments_billed, installments_open, open_amount_cents,
         first_competence_month, last_competence_month, status, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (card_account_id, purchase_key) DO UPDATE SET
         merchant_label           = EXCLUDED.merchant_label,
         installment_amount_cents = EXCLUDED.installment_amount_cents,
         total_amount_cents       = EXCLUDED.total_amount_cents,
         installments_billed      = EXCLUDED.installments_billed,
         installments_open        = EXCLUDED.installments_open,
         open_amount_cents        = EXCLUDED.open_amount_cents,
         first_competence_month   = EXCLUDED.first_competence_month,
         last_competence_month    = EXCLUDED.last_competence_month,
         status                   = EXCLUDED.status,
         synced_at                = now()
       RETURNING id`,
      [
        cardAccountId, p.key, p.merchant_label, p.description_norm, p.purchase_date,
        p.installments_total, p.installment_amount_cents, p.total_amount_cents,
        p.installments_billed, p.installments_open, p.open_amount_cents,
        p.first_competence_month, p.last_competence_month, p.status
      ]
    );
    idPorPlanoKey.set(p.key, rows[0].id);
  }

  // ── itens ──
  let inseridos = 0;
  let atualizados = 0;
  for (const it of itens) {
    const r = await client.query(
      `INSERT INTO fin_card_transaction (
         card_account_id, bill_id, external_id, provider_id, posted_on, amount_cents,
         description, description_norm, merchant, mcc, card_last4, card_id, status, kind,
         installment_plan_id, installment_number, installments_total, purchase_date,
         competence_month, source_category, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
       ON CONFLICT (external_source, external_id) DO UPDATE SET
         bill_id             = EXCLUDED.bill_id,
         posted_on           = EXCLUDED.posted_on,
         amount_cents        = EXCLUDED.amount_cents,
         description         = EXCLUDED.description,
         description_norm    = EXCLUDED.description_norm,
         merchant            = EXCLUDED.merchant,
         mcc                 = EXCLUDED.mcc,
         card_last4          = EXCLUDED.card_last4,
         card_id             = EXCLUDED.card_id,
         status              = EXCLUDED.status,
         kind                = EXCLUDED.kind,
         installment_plan_id = EXCLUDED.installment_plan_id,
         installment_number  = EXCLUDED.installment_number,
         installments_total  = EXCLUDED.installments_total,
         purchase_date       = EXCLUDED.purchase_date,
         competence_month    = EXCLUDED.competence_month,
         source_category     = EXCLUDED.source_category,
         synced_at           = now()
       RETURNING (xmax = 0) AS inserido`,
      [
        cardAccountId,
        it.bill_external_id ? idPorFaturaExterna.get(it.bill_external_id) ?? null : null,
        it.external_id, it.provider_id, it.posted_on, it.amount_cents,
        it.description, it.description_norm, it.merchant, it.mcc,
        it.card_last4, it.card_last4 ? idPorLast4.get(it.card_last4) ?? null : null,
        it.status, it.kind,
        it.plano_key ? idPorPlanoKey.get(it.plano_key) ?? null : null,
        it.installment_number, it.installments_total, it.purchase_date,
        it.competence_month, it.source_category
      ]
    );
    if (r.rows[0]?.inserido) inseridos += 1;
    else atualizados += 1;
  }

  // ── conciliação: fatura ↔ saída na conta corrente ──
  //
  // Fecha o ciclo do cartão. O critério é DETERMINÍSTICO e estreito de
  // propósito: mesma conta de liquidação, mesmo dia do pagamento informado pela
  // fatura, mesmo valor ao centavo, e UM ÚNICO candidato. Medido em 15/08/2026:
  // casa 8 de 8, incluindo as duas faturas pagas a menor por causa de estorno.
  //
  // Duas coisas que este bloco NÃO faz, e ambas são a mesma regra do avesso:
  //
  //   · não escreve em fin_transaction. O lançamento fica exatamente como está,
  //     'em_transito' e categoria 9.01. Promovê-lo a 'pareado' o tiraria de
  //     fin_transaction_ledger_idx e faria a saída real sumir do caixa.
  //   · não inventa vínculo. Se houver zero ou mais de um candidato, o vínculo
  //     fica nulo e o script avisa. Um cartão conciliado por aproximação é pior
  //     que um cartão não conciliado, porque some da lista do que falta fazer.
  //
  // E nunca sobrescreve vínculo feito à mão: `match_method = 'manual'` é ato
  // humano e o sync não desfaz ato humano.
  let conciliadas = 0;
  const semCandidato = [];
  const ambiguas = [];
  for (const b of faturas) {
    const pago = b.payments?.[0];
    if (!pago) continue;
    const { rows } = await client.query(
      `SELECT t.id
         FROM fin_transaction t
         JOIN fin_card_account ca ON ca.id = $1
        WHERE t.account_id = ca.settlement_account_id
          AND t.posted_on  = $2::date
          AND t.amount_cents = $3
          AND NOT EXISTS (
                SELECT 1 FROM fin_card_bill x
                 WHERE x.paid_transaction_id = t.id AND x.external_id <> $4)`,
      [cardAccountId, pago.paymentDate.slice(0, 10), -cents(pago.amount), String(b.id)]
    );
    if (rows.length === 0) { semCandidato.push(b); continue; }
    if (rows.length > 1) { ambiguas.push(b); continue; }
    const r = await client.query(
      `UPDATE fin_card_bill
          SET paid_transaction_id = $2, match_method = 'auto_valor_data', match_confidence = 100
        WHERE id = $1 AND COALESCE(match_method,'') <> 'manual'`,
      [idPorFaturaExterna.get(String(b.id)), rows[0].id]
    );
    conciliadas += r.rowCount;
  }

  await client.query('COMMIT');

  console.log('');
  console.log(`[cartao] ${inseridos} item(ns) inserido(s), ${atualizados} atualizado(s)`);
  console.log(`[cartao] ${faturas.length} fatura(s), ${planos.size} plano(s), ${cartoes.size} cartão(ões)`);
  console.log(`[cartao] conciliação fatura↔caixa: ${conciliadas} de ${faturas.filter((b) => b.payments?.length).length} paga(s)`);
  if (semCandidato.length) {
    console.warn(`[cartao] AVISO ${semCandidato.length} fatura(s) paga(s) SEM lançamento correspondente na conta corrente:`);
    for (const b of semCandidato) {
      console.warn(`   venc ${b.due_date.slice(0, 10)} pago ${b.payments[0].paymentDate.slice(0, 10)} ${brl(cents(b.payments[0].amount))}`);
    }
    console.warn('   (esperado enquanto o extrato da conta não cobrir o período — não é erro por si só)');
  }
  if (ambiguas.length) {
    console.warn(`[cartao] AVISO ${ambiguas.length} fatura(s) com MAIS DE UM candidato — deixadas sem vínculo, resolver à mão`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
