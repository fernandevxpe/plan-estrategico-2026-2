// Ingere a Caixa via Polp: conta corrente (extrato) e aplicação (posições).
//
// ===========================================================================
// O QUE ESTE SCRIPT NÃO FAZ SOZINHO
// ===========================================================================
// A Polp só lê o que o titular autorizou. Hoje a única integração é Nubank
// Empresas (#2906). Sem `conectar-polp-caixa.mjs` + autorização no internet
// banking da Caixa, não há o que ingestir — e este arquivo se recusa a
// inventar. Dry-run é o padrão.
//
// Conta corrente → fin_account slug `caixa` (migration 0113).
// Aplicação     → fin_account slug `caixa-aplicacao` (já existia, sem extrato).
// Empréstimo    → só RELATADO. O Pronampe já está em fin_emprestimo (0110);
//                 uma linha de /loans não vira saldo de conta.
//
// Duas contas CHECKING na mesma integração: aborta. Não escolhe.
//
// Uso:
//   node scripts/sync-polp-caixa.mjs                 dry-run
//   node scripts/sync-polp-caixa.mjs --aplicar       grava
//   node scripts/sync-polp-caixa.mjs --dump=arq.json  salva o cru
import { writeFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { dedupeHash, normalizeDescription, normalizeName } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import {
  POLP_INSTITUICAO_CAIXA_EMPRESAS,
  credenciaisPolp,
  clientePolp,
  paginar,
  exigirPaginaCompleta,
  centavos,
  diaLocal,
  dia,
  documentoDaContraparte,
  nomeDaContraparte,
  valorAssinadoCents,
  descricaoPolp,
  tipoDeDocumento
} from './lib/polp.mjs';

loadEnv();
registerFinanceTypeParsers();

const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome, padrao) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};

const APLICAR = flag('aplicar');
const DUMP = valor('dump', null);
const CORRENTE_SLUG = valor('corrente', 'caixa');
const APLICACAO_SLUG = valor('aplicacao', 'caixa-aplicacao');
const ENTITY_SLUG = valor('entidade', 'xpe');

const brl = (c) =>
  (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Date().toISOString().slice(0, 10);

const STATUS_INVEST = {
  ACTIVE: 'ativa',
  TOTAL_WITHDRAWAL: 'liquidada',
  PARTIAL_WITHDRAWAL: 'ativa',
  MATURED: 'vencida',
  EXPIRED: 'vencida'
};

async function acharIntegracaoCaixa(get) {
  const { itens } = await paginar(get, '/integrations');
  const caixa = itens.filter((i) => Number(i.institution_id) === POLP_INSTITUICAO_CAIXA_EMPRESAS);
  if (caixa.length > 1) {
    throw new Error(
      `há ${caixa.length} integrações Caixa Empresas (${caixa.map((i) => '#' + i.id).join(', ')}). ` +
        'Não escolho qual. Passe --integracao=ID quando isso for verdade.'
    );
  }
  const idFlag = valor('integracao', null);
  if (idFlag) {
    const corpo = await get(`/integrations/${idFlag}`);
    return corpo?.data ?? corpo;
  }
  return caixa[0] ?? null;
}

async function coletarPosicoes(get, integracaoId) {
  const coletado = await paginar(get, `/integrations/${integracaoId}/investments`);
  const { itens, total, linhasBrutas } = coletado;
  console.log(
    `[polp-caixa] investimentos: ${linhasBrutas} linha(s) → ${itens.length} distinta(s); meta.total=${total}`
  );

  const porId = new Map(itens.map((i) => [i.id, i]));
  if (total !== null && porId.size < Number(total)) {
    const ids = [...porId.keys()].sort((a, b) => a - b);
    console.log(
      `  ! paginação instável (${Number(total) - porId.size} perdida(s)). Varrendo por id.`
    );
    for (let id = ids[0]; id <= ids[ids.length - 1]; id += 1) {
      if (porId.has(id)) continue;
      try {
        const corpo = await get(`/investments/${id}`);
        const item = corpo?.data ?? corpo;
        if (item?.id === id && String(item.integration_id) === String(integracaoId)) {
          porId.set(id, item);
        }
      } catch {
        /* furo legítimo na sequência */
      }
      if (porId.size >= Number(total)) break;
    }
  }
  if (total !== null && porId.size < Number(total)) {
    throw new Error(
      `a fonte declara ${total} posições e só foi possível reunir ${porId.size}. Gravar agora produziria saldo menor que o real.`
    );
  }
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

function normalizarPosicao(p) {
  const status = STATUS_INVEST[p.status] ?? 'desconhecida';
  const gross = centavos(p.amount);
  const taxes = centavos(p.taxes ?? 0);
  const balance = centavos(p.balance ?? p.amount);
  if (balance !== gross - taxes) {
    throw new Error(
      `posição ${p.id}: balance ${balance} ≠ amount ${gross} − taxes ${taxes}. Não invento a identidade.`
    );
  }
  const quotedOn = dia(p.date) || hoje();
  return {
    externalId: String(p.id),
    name: p.name ?? `${p.subtype ?? p.type ?? 'aplicação'} ${p.id}`,
    productType: p.type ?? 'FIXED_INCOME',
    productSubtype: p.subtype ?? p.type ?? 'UNKNOWN',
    issuer: p.issuer ?? null,
    status,
    issueDate: dia(p.issue_date) || quotedOn,
    graceDate: dia(p.grace_period_date),
    dueDate: dia(p.due_date),
    rateType: p.rate_type ?? null,
    ratePercent: p.rate ?? null,
    principal: centavos(p.amount_original ?? p.amount),
    gross,
    taxes,
    balance,
    quotedOn
  };
}

async function garantirContrapartes(client, entityId, transacoes, cnpjProprio) {
  const porDocumento = new Map();
  for (const t of transacoes) {
    const nome = nomeDaContraparte(t);
    const doc = documentoDaContraparte(t);
    if (!nome && !doc) continue;
    if (cnpjProprio && doc === cnpjProprio) continue;
    const chave = doc || `nome:${normalizeName(nome || '')}`;
    if (!porDocumento.has(chave)) {
      porDocumento.set(chave, {
        nome: nome || `documento ${doc}`,
        documento: doc,
        tipoDocumento: tipoDeDocumento(doc || ''),
        saida: t.type === 'DEBIT'
      });
    }
  }

  const idContraparte = new Map();
  for (const [chave, c] of porDocumento) {
    let id = null;
    if (c.documento) {
      const { rows } = await client.query(
        `SELECT id FROM fin_counterparty WHERE entity_id=$1 AND document_number=$2`,
        [entityId, c.documento]
      );
      id = rows[0]?.id ?? null;
    }
    if (!id) {
      const { rows } = await client.query(
        `SELECT id FROM fin_counterparty WHERE entity_id=$1 AND normalized_name=$2 LIMIT 1`,
        [entityId, normalizeName(c.nome)]
      );
      id = rows[0]?.id ?? null;
      if (id && c.documento) {
        await client.query(
          `UPDATE fin_counterparty
              SET document_type = COALESCE(document_type, $2),
                  document_number = COALESCE(document_number, $3),
                  updated_at = now()
            WHERE id = $1`,
          [id, c.tipoDocumento, c.documento]
        );
      }
    }
    if (!id) {
      const { rows } = await client.query(
        `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          entityId,
          c.saida ? 'fornecedor' : 'outro',
          c.nome,
          normalizeName(c.nome),
          c.tipoDocumento,
          c.documento
        ]
      );
      id = rows[0].id;
    }
    idContraparte.set(chave, id);
  }
  return idContraparte;
}

async function ingestirCorrente(client, { entityId, conta, transacoes, saldoCents, cnpjProprio }) {
  const rel = { lidas: transacoes.length, inseridas: 0, atualizadas: 0, proprias: 0, comLastro: 0 };
  if (!transacoes.length) return rel;

  const datas = transacoes.map((t) => t.postedOn).sort();
  const periodoInicio = datas[0];
  const periodoFim = datas[datas.length - 1];

  const { rows: loteRows } = await client.query(
    `INSERT INTO fin_import_batch
       (entity_id, account_id, adapter, file_name, period_start, period_end, row_count, status, created_by)
     VALUES ($1,$2,'polp_api',$3,$4,$5,$6,'preview','sync-polp-caixa')
     RETURNING id`,
    [entityId, conta.id, `polp-caixa:${conta.external_id ?? ''}`, periodoInicio, periodoFim, transacoes.length]
  );
  const batchId = loteRows[0].id;

  const idContraparte = await garantirContrapartes(
    client,
    entityId,
    transacoes.map((t) => t.cru),
    cnpjProprio
  );

  for (const [i, t] of transacoes.entries()) {
    const proprio = Boolean(cnpjProprio && t.documento === cnpjProprio);
    const chave = proprio ? null : t.documento || (t.nome ? `nome:${normalizeName(t.nome)}` : null);
    const hash = dedupeHash({ accountSlug: CORRENTE_SLUG, sourceId: t.sourceId });

    const gravado = await client.query(
      `INSERT INTO fin_transaction (
         entity_id, account_id, posted_on, amount_cents, description_raw, description_norm,
         counterparty_raw, counterparty_id, source_kind, source, source_id, dedupe_hash,
         review_status, import_batch_id, transfer_status,
         counterparty_document, counterparty_document_type, end_to_end_id,
         polp_transaction_id, lastro_match
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'polp',$10,$11,'pendente',$12,$13,$14,$15,NULL,$16,'exato')
       ON CONFLICT (account_id, dedupe_version, dedupe_hash) DO UPDATE SET
         source_kind = EXCLUDED.source_kind,
         counterparty_document      = COALESCE(fin_transaction.counterparty_document, EXCLUDED.counterparty_document),
         counterparty_document_type = COALESCE(fin_transaction.counterparty_document_type, EXCLUDED.counterparty_document_type),
         polp_transaction_id        = COALESCE(fin_transaction.polp_transaction_id, EXCLUDED.polp_transaction_id),
         lastro_match               = COALESCE(fin_transaction.lastro_match, EXCLUDED.lastro_match),
         transfer_status = CASE WHEN fin_transaction.transfer_status = 'pareado'
                                THEN fin_transaction.transfer_status ELSE fin_transaction.transfer_status END,
         counterparty_id = COALESCE(fin_transaction.counterparty_id, EXCLUDED.counterparty_id),
         review_status = CASE
           WHEN fin_transaction.review_status IN ('adiado', 'ignorado') THEN fin_transaction.review_status
           WHEN fin_transaction.category_id IS NULL THEN 'pendente'
           ELSE 'ok' END,
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserido`,
      [
        entityId,
        conta.id,
        t.postedOn,
        t.cents,
        t.desc,
        normalizeDescription(t.desc),
        t.nome,
        chave ? idContraparte.get(chave) ?? null : null,
        t.sourceKind,
        t.sourceId,
        hash,
        batchId,
        proprio ? 'em_transito' : 'nao',
        t.documento,
        tipoDeDocumento(t.documento || ''),
        t.polpId
      ]
    );
    if (proprio) rel.proprias += 1;
    if (t.documento) rel.comLastro += 1;
    if (gravado.rows[0]?.inserido) rel.inseridas += 1;
    else rel.atualizadas += 1;

    await client.query(
      `INSERT INTO fin_import_row
         (batch_id, row_number, raw, posted_on, amount_cents, description_raw,
          dedupe_hash, status, transaction_id)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)`,
      [
        batchId,
        i + 1,
        JSON.stringify(t.cru),
        t.postedOn,
        t.cents,
        t.desc,
        hash,
        gravado.rows[0]?.inserido ? 'importado' : 'duplicado',
        gravado.rows[0]?.id ?? null
      ]
    );
  }

  await client.query(
    `UPDATE fin_import_batch
        SET status = CASE WHEN $2::int > 0 THEN 'confirmado' ELSE 'descartado' END,
            inserted_count = $2, duplicate_count = $3, committed_at = now()
      WHERE id = $1`,
    [batchId, rel.inseridas, rel.atualizadas]
  );

  await client.query(`UPDATE fin_account SET last_statement_at = $2, external_id = COALESCE(external_id, $3)
                       WHERE id = $1`, [conta.id, periodoFim, String(conta.polpId ?? '')]);

  await client.query(
    `INSERT INTO fin_statement_coverage (account_id, period_start, period_end, source)
     VALUES ($1,$2,$3,'api')
     ON CONFLICT (account_id, source, period_start) DO UPDATE
       SET period_end = GREATEST(fin_statement_coverage.period_end, EXCLUDED.period_end)`,
    [conta.id, periodoInicio, periodoFim]
  );

  if (saldoCents != null) {
    await client.query(`UPDATE fin_account SET current_balance_cents = $2 WHERE id = $1`, [
      conta.id,
      saldoCents
    ]);
    await client.query(
      `INSERT INTO fin_balance_snapshot (account_id, date, balance_cents, source, computed_cents, variance_cents)
       SELECT $1, $2::date, $3::bigint, 'api', r.reconstruido, $3::bigint - r.reconstruido
         FROM (SELECT COALESCE(a.opening_balance_cents, 0)
                      + COALESCE((SELECT sum(t.amount_cents) FROM fin_transaction t
                                   WHERE t.account_id = a.id AND NOT t.is_split_parent), 0)
                        AS reconstruido
                 FROM fin_account a WHERE a.id = $1) r
       ON CONFLICT DO NOTHING`,
      [conta.id, periodoFim, saldoCents]
    );
  }
  return rel;
}

async function ingestirAplicacao(client, { entityId, conta, posicoes }) {
  const alvoCents = posicoes.reduce((s, p) => s + p.balance, 0);
  const quotedOn = posicoes.reduce((max, p) => (p.quotedOn > max ? p.quotedOn : max), hoje());

  let inseridas = 0;
  for (const p of posicoes) {
    const { rows: [r] } = await client.query(
      `INSERT INTO fin_investment (
         entity_id, account_id, provider, external_id, name, product_type, product_subtype, issuer,
         status, issue_date, grace_date, due_date, rate_type, rate_percent,
         principal_cents, gross_cents, taxes_cents, balance_cents, quoted_on)
       VALUES ($1,$2,'polp',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (provider, external_id) DO UPDATE SET
         status = EXCLUDED.status, due_date = EXCLUDED.due_date,
         principal_cents = EXCLUDED.principal_cents, gross_cents = EXCLUDED.gross_cents,
         taxes_cents = EXCLUDED.taxes_cents, balance_cents = EXCLUDED.balance_cents,
         quoted_on = EXCLUDED.quoted_on, updated_at = now()
       RETURNING id, (xmax = 0) AS inserido`,
      [
        entityId, conta.id, p.externalId, p.name, p.productType, p.productSubtype, p.issuer,
        p.status, p.issueDate, p.graceDate, p.dueDate, p.rateType, p.ratePercent,
        p.principal, p.gross, p.taxes, p.balance, p.quotedOn
      ]
    );
    if (r.inserido) inseridas += 1;
  }

  // Sem histórico de lançamentos, o saldo de abertura É a foto da carteira.
  // Inventar um lançamento de "rendimento" do tamanho do saldo faria o DRE
  // nascer mentindo no dia da primeira leitura. Sem foto, G1 e a igualdade
  // da 0043 não podem valer ao mesmo tempo — então a abertura declara a foto.
  if (!conta.opening_balance_date) {
    await client.query(
      `UPDATE fin_account
          SET opening_balance_cents = $2,
              opening_balance_date = $3,
              current_balance_cents = $2,
              last_statement_at = $3,
              import_adapter = 'polp_api'
        WHERE id = $1`,
      [conta.id, alvoCents, quotedOn]
    );
  } else {
    const { rows: [ledger] } = await client.query(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) AS soma
         FROM fin_transaction WHERE account_id = $1`,
      [conta.id]
    );
    const reconstruido = conta.opening_balance_cents + Number(ledger.soma);
    if (reconstruido !== alvoCents) {
      // Não absorvo a diferença num "ajuste" sem teto: na primeira conexão da
      // Caixa não há conciliação dia a dia com a corrente (não há RDB
      // rotulado). A igualdade da 0043 manda o saldo da conta SER a soma das
      // posições; o resíduo fica no snapshot, não escondido em 9.12.
      await client.query(`UPDATE fin_account SET current_balance_cents = $2, last_statement_at = $3
                           WHERE id = $1`, [conta.id, alvoCents, quotedOn]);
      await client.query(
        `INSERT INTO fin_balance_snapshot (account_id, date, balance_cents, source, computed_cents, variance_cents)
         VALUES ($1,$2::date,$3::bigint,'api',$4::bigint,$3::bigint - $4::bigint)
         ON CONFLICT DO NOTHING`,
        [conta.id, quotedOn, alvoCents, reconstruido]
      );
    } else {
      await client.query(`UPDATE fin_account SET current_balance_cents = $2, last_statement_at = $3
                           WHERE id = $1`, [conta.id, alvoCents, quotedOn]);
    }
  }

  return { inseridas, alvoCents, quotedOn };
}

// ------------------------------------------------------------------ principal
const cred = await credenciaisPolp();
const get = clientePolp(cred);
const integracao = await acharIntegracaoCaixa(get);

if (!integracao) {
  console.log('[polp-caixa] nenhuma integração Caixa Empresas.');
  console.log('  1. node scripts/conectar-polp-caixa.mjs --conectar --cpf=SEU_CPF');
  console.log('  2. autorize no internet banking da Caixa');
  console.log('  3. rode este script de novo');
  process.exit(0);
}

console.log(
  `[polp-caixa] integração #${integracao.id}  ${integracao.institution?.name ?? 'Caixa'}  ${integracao.status}` +
    (integracao.execution_status ? ` (${integracao.execution_status})` : '')
);

if (integracao.status === 'WAITING_USER_INPUT') {
  const det = (await get(`/integrations/${integracao.id}`))?.data ?? integracao;
  console.log('[polp-caixa] aguardando autorização do titular.');
  if (det.url_to_authenticate) {
    console.log(det.url_to_authenticate);
    if (det.url_to_authenticate_expires_at) console.log(`(expira em ${det.url_to_authenticate_expires_at})`);
  } else {
    console.log('  URL ausente neste GET. Rode: node scripts/conectar-polp-caixa.mjs');
  }
  process.exit(0);
}

if (integracao.status === 'UPDATING') {
  console.log('[polp-caixa] sincronização ainda em andamento. Tente de novo em alguns minutos.');
  process.exit(0);
}
if (integracao.status !== 'UPDATED') {
  console.log(`[polp-caixa] status=${integracao.status} — não ingest. LOGIN_ERROR/OUTDATED exigem reautorizar.`);
  process.exit(integracao.status === 'LOGIN_ERROR' ? 1 : 0);
}

const contasPolp = await paginar(get, `/integrations/${integracao.id}/accounts`);
exigirPaginaCompleta(`/integrations/${integracao.id}/accounts`, contasPolp);
const investimentosCru = await coletarPosicoes(get, integracao.id);
const emprestimos = await paginar(get, `/integrations/${integracao.id}/loans`);

const correntes = contasPolp.itens.filter((a) => a.subtype === 'CHECKING_ACCOUNT');
const outrasBank = contasPolp.itens.filter(
  (a) => a.type === 'BANK' && a.subtype !== 'CHECKING_ACCOUNT'
);
const cartoes = contasPolp.itens.filter((a) => a.type === 'CREDIT');

console.log('');
console.log('CONTAS NA FONTE');
for (const a of contasPolp.itens) {
  console.log(
    `  #${a.id}  ${a.type}/${a.subtype}  ${a.name ?? ''}  nº ${a.number ?? '—'}  saldo ${brl(centavos(a.balance))}`
  );
}
console.log(`  investimentos: ${investimentosCru.length} posição(ões)`);
console.log(`  empréstimos:   ${emprestimos.itens.length}`);
for (const e of emprestimos.itens) {
  console.log(`    #${e.id}  ${e.name ?? e.type ?? ''}  ${brl(centavos(e.balance ?? e.outstanding_balance))}`);
}

if (correntes.length > 1) {
  throw new Error(
    `${correntes.length} contas CHECKING na Caixa. Não escolho qual vira '${CORRENTE_SLUG}'. ` +
      `Ids: ${correntes.map((a) => a.id).join(', ')}`
  );
}
if (outrasBank.length) {
  console.log(
    `  outras BANK (não corrente): ${outrasBank.map((a) => `#${a.id} ${a.subtype}`).join(', ')}`
  );
}

const correntePolp = correntes[0] ?? null;
const posicoes = investimentosCru.map(normalizarPosicao);
const saldoAplicacao = posicoes.reduce((s, p) => s + p.balance, 0);
const ativas = posicoes.filter((p) => p.status === 'ativa');

let transacoesCorrente = [];
if (correntePolp) {
  const coletado = await paginar(get, `/accounts/${correntePolp.id}/transactions`, {
    limitePaginas: 200,
    perPage: 500
  });
  exigirPaginaCompleta(`/accounts/${correntePolp.id}/transactions`, coletado);
  transacoesCorrente = coletado.itens
    .map((t) => {
      const cents = valorAssinadoCents(t);
      return {
        cru: t,
        polpId: t.id,
        sourceId: String(t.id),
        postedOn: diaLocal(t.date),
        cents,
        desc: descricaoPolp(t),
        sourceKind: t.operation_type ?? t.type ?? null,
        documento: documentoDaContraparte(t),
        nome: nomeDaContraparte(t)
      };
    })
    .filter((t) => t.cents && t.postedOn);
  console.log(`  extrato corrente: ${transacoesCorrente.length} lançamento(s) com valor`);
}

if (DUMP) {
  await writeFile(
    DUMP,
    JSON.stringify(
      { lidoEm: new Date().toISOString(), integracao, contas: contasPolp.itens, investimentos: investimentosCru, emprestimos: emprestimos.itens },
      null,
      1
    )
  );
  console.log(`[polp-caixa] dump → ${DUMP}`);
}

console.log('');
console.log('MAPEAMENTO');
console.log(`  corrente  ${correntePolp ? `#${correntePolp.id} → ${CORRENTE_SLUG}` : '(nenhuma)'}  ${correntePolp ? brl(centavos(correntePolp.balance)) : ''}`);
console.log(`  aplicação ${investimentosCru.length ? `${posicoes.length} posições (${ativas.length} ativas) → ${APLICACAO_SLUG}` : '(nenhuma)'}  ${brl(saldoAplicacao)}`);
if (cartoes.length) {
  console.log(`  cartão    ${cartoes.map((c) => '#' + c.id).join(', ')}  (não ingestido — não há fin_account de cartão Caixa)`);
}

const pool = financePool();
const client = await pool.connect();
let saida = 0;

try {
  await client.query('BEGIN');
  await client.query(`SET LOCAL fin.sync_mode = 'on'`);

  const { rows: [entidade] } = await client.query(`SELECT id, cnpj FROM fin_entity WHERE slug = $1`, [
    ENTITY_SLUG
  ]);
  if (!entidade) throw new Error(`entidade "${ENTITY_SLUG}" não encontrada`);
  const cnpjProprio = String(entidade.cnpj ?? '').replace(/\D/g, '') || null;

  const { rows: contas } = await client.query(
    `SELECT id, slug, kind, opening_balance_cents, opening_balance_date, current_balance_cents, external_id
       FROM fin_account WHERE entity_id = $1 AND slug = ANY($2)`,
    [entidade.id, [CORRENTE_SLUG, APLICACAO_SLUG]]
  );
  const contaCorrente = contas.find((c) => c.slug === CORRENTE_SLUG);
  const contaAplic = contas.find((c) => c.slug === APLICACAO_SLUG);

  if (correntePolp && !contaCorrente) {
    throw new Error(
      `conta '${CORRENTE_SLUG}' não existe no ledger. Aplique db/migrations/0113_fin_caixa_polp.sql`
    );
  }
  if (posicoes.length && !contaAplic) {
    throw new Error(`conta '${APLICACAO_SLUG}' não encontrada`);
  }

  let relCorrente = null;
  let relAplic = null;

  if (correntePolp && contaCorrente) {
    contaCorrente.polpId = correntePolp.id;
    relCorrente = await ingestirCorrente(client, {
      entityId: entidade.id,
      conta: contaCorrente,
      transacoes: transacoesCorrente,
      saldoCents: centavos(correntePolp.balance),
      cnpjProprio
    });
    console.log('');
    console.log('CORRENTE');
    console.log(
      `  ${relCorrente.lidas} lidas · ${relCorrente.inseridas} gravadas · ${relCorrente.atualizadas} já existiam · ` +
        `${relCorrente.proprias} entre contas próprias · ${relCorrente.comLastro} com documento`
    );
    console.log(`  saldo da fonte ${brl(centavos(correntePolp.balance))}`);
  }

  if (posicoes.length && contaAplic) {
    relAplic = await ingestirAplicacao(client, {
      entityId: entidade.id,
      conta: contaAplic,
      posicoes
    });
    console.log('');
    console.log('APLICAÇÃO');
    console.log(`  ${posicoes.length} posições (${ativas.length} ativas) · ${relAplic.inseridas} novas`);
    console.log(`  saldo da carteira ${brl(relAplic.alvoCents)} em ${relAplic.quotedOn}`);
    console.log(`  saldo exibido hoje ${brl(contaAplic.current_balance_cents)}`);
  }

  if (!APLICAR) {
    await client.query('ROLLBACK');
    console.log('');
    console.log('[dry-run] nada gravado. Para gravar: --aplicar');
  } else {
    await client.query('COMMIT');
    console.log('');
    console.log('[polp-caixa] gravado');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('[polp-caixa] abortado, nada foi gravado:', e.message);
  saida = 1;
} finally {
  client.release();
  await pool.end();
}

process.exit(saida);
