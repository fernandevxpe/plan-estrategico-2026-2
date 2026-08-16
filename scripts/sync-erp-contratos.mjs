// Espelha contratos e parcelas do erp-obras: Contrato/ParcelaContrato →
// erp_contrato/erp_contrato_parcela (migration 0045).
//
// NÃO TOCA NO LEDGER por padrão. Grava só nas tabelas de espelho, pelo mesmo
// motivo de sync-erp-obras.mjs — primeiro ver, depois confiar, só então
// promover — e por um motivo a mais, específico daqui:
//
//   233 das 471 parcelas JÁ EXISTEM neste banco como fin_document, vindas do
//   Asaas com o MESMO dinheiro. Escrever parcela como documento a receber
//   criaria 233 recebíveis fantasmas em cima de recebíveis reais, e a soma
//   pareceria plausível. A parcela entra como PREVISÃO, com a cobrança
//   correspondente resolvida ao lado — nunca no lugar dela.
//
// A promoção do CABEÇALHO do contrato para fin_contract existe, é opcional e
// vem desligada: --promover-contratos. Ela é segura porque entra com
// recurrence='unico', e as cinco consultas que leem fin_contract filtram todas
// por recurrence='mensal' (forecast.ts:216, painel.ts:469, queries.ts:254,
// indicadores.ts:208, import-clickup-compromissos.mjs) — verificado uma a uma.
// Nenhuma parcela vira documento em nenhum modo.
//
// O BANCO DO ERP É SOMENTE LEITURA — sempre, e não por disciplina nossa. A
// sessão abre com SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY, então
// qualquer escrita é recusada pelo servidor. O pooler do Supabase ignora
// PGOPTIONS na string de conexão, e a credencial disponível é superusuário; a
// trava declarativa na sessão é a única que de fato pega.
//
// Uso:
//   node scripts/sync-erp-contratos.mjs                  espelha e grava
//   node scripts/sync-erp-contratos.mjs --dry-run        mostra o que faria
//   node scripts/sync-erp-contratos.mjs --promover-contratos
//                                                        + fin_contract (opt-in)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');
const PROMOVER = process.argv.includes('--promover-contratos');

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

/**
 * CNPJ da própria XPE. Contraparte com este documento é transferência entre
 * contas próprias, jamais cliente — e o erp-obras tem um cliente cadastrado com
 * ele (id 57, "CONDOMÍNIO DO EDIFÍCIO ADERBAL JUREMA"). Sem esta recusa
 * explícita, o dia em que alguém criar a contraparte da casa com o CNPJ certo,
 * um contrato de R$ 8.400 passaria a apontar para a própria empresa e viraria
 * receita contra si mesma.
 */
const CNPJ_DA_CASA = '34776108000192';

/**
 * O que o ERP guarda no campo `cnpj` e NÃO é um CNPJ. Lista explícita, não
 * heurística de dígito verificador: um placeholder novo deve aparecer como
 * indeterminado e ser decidido, não ser silenciosamente aceito ou rejeitado por
 * uma regra de validação que ninguém releu.
 */
const DOCUMENTOS_PLACEHOLDER = new Set(['00000000000191', '00000000000000', '11111111111111']);

/**
 * eixo do contrato → (kind de fin_contract, núcleo).
 *
 * Mapa explícito e não derivação por lower(), pela mesma razão do mapa de slug
 * de conta em sync-erp-obras.mjs: equivalência é decisão, não coincidência de
 * grafia. AMBOS não tem destino — fin_contract.kind é um valor só e não há dado
 * que reparta o contrato. Fica NULL, indeterminado declarado.
 */
const EIXO = new Map([
  ['OBRAS', { kind: 'obra', nucleo: 'obras' }],
  ['CONSULTORIA', { kind: 'projeto', nucleo: 'consultoria' }],
  ['AMBOS', { kind: null, nucleo: null }]
]);

/**
 * status do Contrato → status de fin_contract.
 *
 * Lossy de propósito e sem inventar destino: RASCUNHO e CANCELADO não existem
 * em fin_contract (ativo/suspenso/encerrado), e escolher "encerrado" para um
 * cancelado misturaria contrato que terminou com contrato que nunca começou.
 * Os dois viram NULL e o status cru fica em status_erp.
 */
const STATUS = new Map([
  ['ATIVO', 'ativo'],
  ['ENCERRADO', 'encerrado'],
  ['INATIVO', 'suspenso'],
  ['RASCUNHO', null],
  ['CANCELADO', null]
]);

const soDigitos = (v) => (v ?? '').replace(/\D/g, '');

/**
 * Normalização de nome só para DETECTAR divergência entre cadastros — nunca
 * para casar. O casamento é por documento, ponto. Isto aqui só levanta a mão
 * quando o CNPJ liga dois nomes que não se parecem, para alguém olhar.
 */
function nomeChave(s) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(condominio|condomínio|do|da|de|dos|das|edificio|edifício|edf|ed|residencial|empresarial|ltda|me|epp|sa)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nomesDivergem(a, b) {
  const x = nomeChave(a);
  const y = nomeChave(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return false;
  const tx = new Set(x.split(' ').filter((t) => t.length > 2));
  const ty = new Set(y.split(' ').filter((t) => t.length > 2));
  if (!tx.size || !ty.size) return false;
  let comuns = 0;
  for (const t of tx) if (ty.has(t)) comuns += 1;
  return comuns === 0;
}

/**
 * Lê a URL do erp-obras sem poluir process.env.
 *
 * O `.env.obras` é o `.env.local` inteiro do outro projeto e traz chaves de
 * escrita (service_role do Supabase, Asaas de produção, Polp, Clicksign).
 * Carregá-lo com loadEnv() jogaria tudo em process.env, onde qualquer outro
 * trecho deste processo poderia usá-las por engano. Aqui só sai o que interessa.
 */
function erpDatabaseUrl() {
  const path = ['.env.obras', resolve(process.cwd(), '.env.obras')].find((p) => existsSync(p));
  if (!path) throw new Error('.env.obras não encontrado — é dele que sai a URL de leitura do erp-obras');

  let fallback = null;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key !== 'DIRECT_URL' && key !== 'DATABASE_URL') continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // DIRECT_URL é o session pooler (5432). O transaction pooler (6543) derruba
    // consulta analítica longa — o próprio database-url.ts do erp-obras explica.
    if (key === 'DIRECT_URL') return value;
    if (!fallback) fallback = value;
  }
  if (fallback) return fallback;
  throw new Error('DIRECT_URL/DATABASE_URL ausentes no .env.obras');
}

async function lerDoErp() {
  const client = new pg.Client({
    connectionString: erpDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000
  });
  await client.connect();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    await client.query('SET statement_timeout = 120000');

    const check = await client.query('SHOW transaction_read_only');
    if (check.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('trava de somente-leitura não pegou — abortando antes de qualquer consulta');
    }

    // Valores em centavos já na origem, como em sync-erp-obras.mjs: Decimal(14,2)
    // lá, bigint de centavos aqui. Converter na entrada evita que cada consulta
    // tenha de lembrar da regra — e que uma delas esqueça.
    const contratos = await client.query(
      `SELECT k.id, k.codigo, k.titulo, k."clienteId" AS cliente_id,
              cl."razaoSocial" AS cliente_razao_social,
              cl.cnpj          AS cliente_cnpj,
              cl."asaasCustomerId" AS cliente_asaas_id,
              k.eixo::text     AS eixo,
              k.status::text   AS status,
              round(k."valorContratado" * 100)::bigint AS valor_contratado_cents,
              COALESCE((SELECT round(sum(p.valor) * 100)::bigint
                          FROM "ParcelaContrato" p WHERE p."contratoId" = k.id), 0) AS valor_parcelas_cents,
              k."dataAssinatura", k."dataInicio", k."dataFimPrevista",
              k.vendedor, k."formaPagamento", k."prazoDias",
              k."propostaId" AS proposta_erp_id, k."clickupTaskId" AS clickup_task_id,
              k.observacoes, k."escopoServicoTexto", k."entregaveisTexto",
              k."createdAt", k."updatedAt"
         FROM "Contrato" k
         JOIN "Cliente" cl ON cl.id = k."clienteId"
        ORDER BY k.id`
    );

    const parcelas = await client.query(
      `SELECT p.id, p."contratoId" AS contrato_id, p.numero, p.descricao,
              round(p.valor * 100)::bigint AS valor_cents,
              p."dataVencimento" AS data_vencimento,
              p.status::text     AS status,
              p."asaasPaymentId" AS asaas_payment_id
         FROM "ParcelaContrato" p ORDER BY p.id`
    );

    const alocacoes = await client.query(
      `SELECT a.id, a."parcelaId" AS parcela_id, a."projetoId" AS projeto_id,
              pj.nome AS projeto_nome, pj.segmento::text AS projeto_segmento,
              round(a.valor * 100)::bigint AS valor_cents
         FROM "ParcelaContratoAlocacao" a
         LEFT JOIN "Projeto" pj ON pj.id = a."projetoId"
        ORDER BY a.id`
    );

    const servicos = await client.query(
      `SELECT cs.id, cs."contratoId" AS contrato_id, cs.codigo, cs.ordem,
              cs."tipoServicoId" AS tipo_servico_erp_id,
              ts.codigo   AS tipo_servico_codigo,
              ts.nome     AS tipo_servico_nome,
              ts.segmento::text AS tipo_servico_segmento,
              ts.familia  AS tipo_servico_familia
         FROM "ContratoServico" cs
         LEFT JOIN "TipoServico" ts ON ts.id = cs."tipoServicoId"
        ORDER BY cs.id`
    );

    return {
      contratos: contratos.rows,
      parcelas: parcelas.rows,
      alocacoes: alocacoes.rows,
      servicos: servicos.rows
    };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Resolução de identidade — tudo o que liga um lado ao outro
// ---------------------------------------------------------------------------

/**
 * Cliente do ERP → contraparte daqui, POR DOCUMENTO E SÓ POR DOCUMENTO.
 *
 * Nome nunca entra, nem com similaridade alta, nem como desempate. Medido em
 * 15/08/2026: 16 dos 17 clientes sem CNPJ têm aqui uma contraparte de nome
 * quase idêntico — ligá-los por nome resolveria 16 casos e seria exatamente o
 * erro que a frente A6 do backlog existe para desfazer.
 *
 * Devolve { id, match } onde match é o motivo declarado quando id é null.
 */
function resolverContraparte(cnpjBruto, contrapartePorDocumento) {
  const doc = soDigitos(cnpjBruto);
  if (!doc) return { id: null, doc: null, match: 'sem_documento' };
  if (doc === CNPJ_DA_CASA) return { id: null, doc, match: 'cnpj_da_casa' };
  if (DOCUMENTOS_PLACEHOLDER.has(doc)) return { id: null, doc, match: 'documento_invalido' };
  if (doc.length !== 11 && doc.length !== 14) return { id: null, doc, match: 'documento_invalido' };
  const cp = contrapartePorDocumento.get(doc);
  if (!cp) return { id: null, doc, match: 'documento_sem_par' };
  return { id: cp.id, doc, match: 'documento', nome: cp.name };
}

async function carregarIndices(pool) {
  const [{ rows: entidade }, { rows: contrapartes }, { rows: documentos }, { rows: centros }, { rows: aliases }] =
    await Promise.all([
      pool.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`),
      pool.query(
        `SELECT id, name, document_number FROM fin_counterparty
          WHERE entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe')
            AND document_number IS NOT NULL`
      ),
      pool.query(
        `SELECT id, source_id, amount_cents, status FROM fin_document
          WHERE entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe')
            AND source = 'asaas' AND source_id IS NOT NULL`
      ),
      // ATENÇÃO: source = 'erp', NÃO 'erp_obras'.
      //
      // Os dois vocabulários convivem neste banco e a busca errada devolve zero
      // linhas SEM ERRO: fin_cost_center.source é CHECK ('manual','clickup','erp')
      // e foi com 'erp' que os 20 centros de custo de projeto foram gravados,
      // enquanto fin_transaction.source usa 'erp_obras' desde a 0040. É o mesmo
      // tipo de armadilha que o mapa de slug de conta de sync-erp-obras.mjs.
      pool.query(`SELECT id, source_id, nucleo FROM fin_cost_center WHERE kind = 'projeto' AND source = 'erp'`),
      pool.query(`SELECT counterparty_id, external_id FROM fin_counterparty_alias WHERE source = 'asaas'`)
    ]);

  if (!entidade.length) throw new Error("fin_entity 'xpe' não encontrada — banco errado?");

  return {
    entityId: entidade[0].id,
    contrapartePorDocumento: new Map(contrapartes.map((c) => [c.document_number, c])),
    documentoPorPayment: new Map(documentos.map((d) => [d.source_id, d])),
    centroPorProjeto: new Map(centros.map((c) => [String(c.source_id), c])),
    contrapartePorAsaas: new Map(aliases.map((a) => [a.external_id, a.counterparty_id]))
  };
}

// ---------------------------------------------------------------------------

const erp = await lerDoErp();
console.log(
  `[erp] ${erp.contratos.length} contrato(s), ${erp.parcelas.length} parcela(s), ` +
    `${erp.alocacoes.length} alocação(ões), ${erp.servicos.length} serviço(s)`
);

const pool = financePool();

try {
  const idx = await carregarIndices(pool);

  // ── resolução ────────────────────────────────────────────────────────────
  const contratos = erp.contratos.map((k) => {
    const cp = resolverContraparte(k.cliente_cnpj, idx.contrapartePorDocumento);
    const eixo = EIXO.get(k.eixo) ?? { kind: null, nucleo: null };
    return {
      ...k,
      counterparty_id: cp.id,
      cliente_documento: cp.doc,
      counterparty_match: cp.match,
      counterparty_nome_diverge: cp.id ? nomesDivergem(k.cliente_razao_social, cp.nome) : false,
      kind_ledger: eixo.kind,
      nucleo: eixo.nucleo,
      status_ledger: STATUS.has(k.status) ? STATUS.get(k.status) : null
    };
  });

  const parcelas = erp.parcelas.map((p) => {
    if (!p.asaas_payment_id) return { ...p, fin_document_id: null, documento_match: 'sem_cobranca' };
    const d = idx.documentoPorPayment.get(p.asaas_payment_id);
    if (!d) return { ...p, fin_document_id: null, documento_match: 'payment_id_orfao' };
    return { ...p, fin_document_id: d.id, documento_match: 'asaas_payment_id', doc_amount_cents: d.amount_cents };
  });

  const alocacoes = erp.alocacoes.map((a) => ({
    ...a,
    cost_center_id: idx.centroPorProjeto.get(String(a.projeto_id))?.id ?? null
  }));

  // ── medição, antes de gravar ─────────────────────────────────────────────
  const comContraparte = contratos.filter((k) => k.counterparty_id).length;
  const motivos = new Map();
  for (const k of contratos) if (!k.counterparty_id) motivos.set(k.counterparty_match, (motivos.get(k.counterparty_match) ?? 0) + 1);

  const comPayment = parcelas.filter((p) => p.asaas_payment_id).length;
  const comDocumento = parcelas.filter((p) => p.fin_document_id).length;
  const orfaos = parcelas.filter((p) => p.documento_match === 'payment_id_orfao');
  const valorDiverge = parcelas.filter((p) => p.fin_document_id && p.doc_amount_cents !== p.valor_cents);
  const comCentro = alocacoes.filter((a) => a.cost_center_id).length;

  const totalContratado = contratos.reduce((s, k) => s + Number(k.valor_contratado_cents), 0);
  const totalParcelas = parcelas.reduce((s, p) => s + Number(p.valor_cents), 0);
  const previstoJaCobrado = parcelas.filter((p) => p.fin_document_id).reduce((s, p) => s + Number(p.valor_cents), 0);

  console.log(`\n[identidade] cliente → contraparte, POR DOCUMENTO (nome nunca)`);
  console.log(`  casaram: ${comContraparte}/${contratos.length} contrato(s) — ${pct(comContraparte, contratos.length)}`);
  for (const [motivo, n] of [...motivos].sort((a, b) => b[1] - a[1])) console.log(`  sem contraparte · ${motivo}: ${n}`);
  const divergem = contratos.filter((k) => k.counterparty_nome_diverge);
  if (divergem.length) {
    console.log(`  ATENÇÃO ${divergem.length} com documento igual e nome divergente (um dos cadastros está errado):`);
    for (const k of divergem.slice(0, 5)) console.log(`    contrato ${k.id} · ${k.cliente_razao_social} · ${k.cliente_documento}`);
  }

  console.log(`\n[cadeia] parcela → cobrança → nota`);
  console.log(`  parcelas com asaasPaymentId: ${comPayment}/${parcelas.length} — ${pct(comPayment, parcelas.length)}`);
  console.log(`  acharam fin_document (exato): ${comDocumento}/${comPayment} — ${pct(comDocumento, comPayment)}`);
  if (orfaos.length) {
    console.log(`  ÓRFÃOS ${orfaos.length}: o ERP conhece a cobrança e este banco não. Rode scripts/sync-asaas.mjs --full`);
  }
  if (valorDiverge.length) {
    console.log(`  valor diverge da cobrança em ${valorDiverge.length}:`);
    for (const p of valorDiverge.slice(0, 5)) {
      console.log(`    parcela ${p.id}: ${brl(p.valor_cents)} × cobrança ${brl(p.doc_amount_cents)}`);
    }
  }
  // Nota fiscal: derivada, não guardada. A parcela não tem coluna de nota
  // porque a nota é fato da COBRANÇA, não da parcela — guardar aqui seria uma
  // terceira cópia da mesma ligação, livre para envelhecer sozinha.
  const docsLigados = parcelas.filter((p) => p.fin_document_id).map((p) => p.fin_document_id);
  let comNota = 0;
  if (docsLigados.length) {
    const { rows } = await pool.query(
      `SELECT count(DISTINCT document_id)::int AS n FROM fin_fiscal_document
        WHERE document_id = ANY($1::bigint[])`,
      [docsLigados]
    );
    comNota = rows[0].n;
  }
  console.log(`  cobranças que chegam à NOTA FISCAL: ${comNota}/${comDocumento} — ${pct(comNota, comDocumento)}`);
  if (comNota < comDocumento) {
    // O gargalo NÃO é dado que falta no Asaas. Medido em 15/08/2026 sobre
    // data/raw/asaas-invoices.json: 200 das 233 cobranças de parcela têm nota
    // emitida (85,8%), e 3.084 das 3.521 notas têm cobrança conhecida — mas só
    // 306 têm `document_id` gravado. A ligação se perde no upsert de
    // fin_fiscal_document, que sobrescreve document_id com NULL quando a
    // cobrança não veio na janela do import daquele dia.
    console.log(`    ↑ teto real no Asaas é 200/233 (85,8%). A diferença é ligação perdida DENTRO`);
    console.log(`      deste banco: só 306 das 3.521 notas têm document_id, contra 3.084 possíveis.`);
    console.log(`      Correção: rodar 'node scripts/import-asaas.mjs' com o raw completo.`);
  }

  console.log(`  alocações com centro de custo: ${comCentro}/${alocacoes.length} — ${pct(comCentro, alocacoes.length)}` +
    `  (o resto espera a frente B1 criar o centro de custo do projeto)`);

  console.log(`\n[dinheiro] as camadas, para conferir que ninguém somou duas`);
  console.log(`  contratado (cabeçalho) ...... ${brl(totalContratado)}`);
  console.log(`  cronograma (parcelas) ....... ${brl(totalParcelas)}`);
  console.log(`  destas, JÁ VIRARAM cobrança . ${brl(previstoJaCobrado)}  ← existe também como fin_document`);
  console.log(`  previsão pura (sem cobrança)  ${brl(totalParcelas - previstoJaCobrado)}  ← só isto entra no a receber`);

  // Verificação cruzada, não fonte: o asaasCustomerId concorda com o documento?
  let concorda = 0;
  let discorda = 0;
  for (const k of erp.contratos) {
    const porAlias = idx.contrapartePorAsaas.get(k.cliente_asaas_id);
    if (!porAlias) continue;
    const porDoc = contratos.find((c) => c.id === k.id)?.counterparty_id;
    if (porDoc === porAlias) concorda += 1;
    else if (porDoc) discorda += 1;
  }
  if (concorda || discorda) {
    console.log(`\n[verificação cruzada] asaasCustomerId × documento: ${concorda} concordam, ${discorda} discordam`);
  }

  if (DRY) {
    console.log('\n[erp] --dry-run: nada gravado');
    process.exit(0);
  }

  // ── gravação: espelho, nunca ledger ──────────────────────────────────────
  let n = { contratos: 0, parcelas: 0, alocacoes: 0, servicos: 0 };

  for (const k of contratos) {
    await pool.query(
      `INSERT INTO erp_contrato (
         erp_id, codigo, titulo, cliente_erp_id, cliente_razao_social, cliente_documento,
         counterparty_id, counterparty_match, counterparty_nome_diverge,
         eixo, nucleo, kind_ledger, valor_contratado_cents, valor_parcelas_cents,
         data_assinatura, data_inicio, data_fim_prevista, vendedor, forma_pagamento,
         prazo_dias, proposta_erp_id, clickup_task_id, observacoes,
         escopo_servico_texto, entregaveis_texto, status_erp, status_ledger,
         created_at_erp, updated_at_erp, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               $20,$21,$22,$23,$24,$25,$26,$27,$28,$29, now())
       ON CONFLICT (erp_id) DO UPDATE SET
         codigo = EXCLUDED.codigo, titulo = EXCLUDED.titulo,
         cliente_erp_id = EXCLUDED.cliente_erp_id,
         cliente_razao_social = EXCLUDED.cliente_razao_social,
         cliente_documento = EXCLUDED.cliente_documento,
         counterparty_id = EXCLUDED.counterparty_id,
         counterparty_match = EXCLUDED.counterparty_match,
         counterparty_nome_diverge = EXCLUDED.counterparty_nome_diverge,
         eixo = EXCLUDED.eixo, nucleo = EXCLUDED.nucleo, kind_ledger = EXCLUDED.kind_ledger,
         valor_contratado_cents = EXCLUDED.valor_contratado_cents,
         valor_parcelas_cents = EXCLUDED.valor_parcelas_cents,
         data_assinatura = EXCLUDED.data_assinatura, data_inicio = EXCLUDED.data_inicio,
         data_fim_prevista = EXCLUDED.data_fim_prevista, vendedor = EXCLUDED.vendedor,
         forma_pagamento = EXCLUDED.forma_pagamento, prazo_dias = EXCLUDED.prazo_dias,
         proposta_erp_id = EXCLUDED.proposta_erp_id, clickup_task_id = EXCLUDED.clickup_task_id,
         observacoes = EXCLUDED.observacoes,
         escopo_servico_texto = EXCLUDED.escopo_servico_texto,
         entregaveis_texto = EXCLUDED.entregaveis_texto,
         status_erp = EXCLUDED.status_erp, status_ledger = EXCLUDED.status_ledger,
         updated_at_erp = EXCLUDED.updated_at_erp, synced_at = now()`,
      [k.id, k.codigo, k.titulo, k.cliente_id, k.cliente_razao_social, k.cliente_documento,
       k.counterparty_id, k.counterparty_match, k.counterparty_nome_diverge,
       k.eixo, k.nucleo, k.kind_ledger, k.valor_contratado_cents, k.valor_parcelas_cents,
       k.dataAssinatura, k.dataInicio, k.dataFimPrevista, k.vendedor, k.formaPagamento,
       k.prazoDias, k.proposta_erp_id, k.clickup_task_id, k.observacoes,
       k.escopoServicoTexto, k.entregaveisTexto, k.status, k.status_ledger,
       k.createdAt, k.updatedAt]
    );
    n.contratos += 1;
  }

  for (const p of parcelas) {
    await pool.query(
      `INSERT INTO erp_contrato_parcela (
         erp_id, erp_contrato_id, numero, descricao, valor_cents, data_vencimento,
         status_erp, asaas_payment_id, fin_document_id, documento_match, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (erp_id) DO UPDATE SET
         erp_contrato_id = EXCLUDED.erp_contrato_id, numero = EXCLUDED.numero,
         descricao = EXCLUDED.descricao, valor_cents = EXCLUDED.valor_cents,
         data_vencimento = EXCLUDED.data_vencimento, status_erp = EXCLUDED.status_erp,
         asaas_payment_id = EXCLUDED.asaas_payment_id,
         fin_document_id = EXCLUDED.fin_document_id,
         documento_match = EXCLUDED.documento_match, synced_at = now()`,
      [p.id, p.contrato_id, p.numero, p.descricao, p.valor_cents, p.data_vencimento,
       p.status, p.asaas_payment_id, p.fin_document_id, p.documento_match]
    );
    n.parcelas += 1;
  }

  for (const a of alocacoes) {
    await pool.query(
      `INSERT INTO erp_contrato_parcela_alocacao (
         erp_id, erp_parcela_id, projeto_erp_id, projeto_nome, projeto_segmento,
         valor_cents, cost_center_id, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (erp_id) DO UPDATE SET
         erp_parcela_id = EXCLUDED.erp_parcela_id, projeto_erp_id = EXCLUDED.projeto_erp_id,
         projeto_nome = EXCLUDED.projeto_nome, projeto_segmento = EXCLUDED.projeto_segmento,
         valor_cents = EXCLUDED.valor_cents, cost_center_id = EXCLUDED.cost_center_id,
         synced_at = now()`,
      [a.id, a.parcela_id, a.projeto_id, a.projeto_nome, a.projeto_segmento, a.valor_cents, a.cost_center_id]
    );
    n.alocacoes += 1;
  }

  for (const s of erp.servicos) {
    await pool.query(
      `INSERT INTO erp_contrato_servico (
         erp_id, erp_contrato_id, codigo, tipo_servico_erp_id, tipo_servico_codigo,
         tipo_servico_nome, tipo_servico_segmento, tipo_servico_familia, ordem, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (erp_id) DO UPDATE SET
         erp_contrato_id = EXCLUDED.erp_contrato_id, codigo = EXCLUDED.codigo,
         tipo_servico_erp_id = EXCLUDED.tipo_servico_erp_id,
         tipo_servico_codigo = EXCLUDED.tipo_servico_codigo,
         tipo_servico_nome = EXCLUDED.tipo_servico_nome,
         tipo_servico_segmento = EXCLUDED.tipo_servico_segmento,
         tipo_servico_familia = EXCLUDED.tipo_servico_familia,
         ordem = EXCLUDED.ordem, synced_at = now()`,
      [s.id, s.contrato_id, s.codigo, s.tipo_servico_erp_id, s.tipo_servico_codigo,
       s.tipo_servico_nome, s.tipo_servico_segmento, s.tipo_servico_familia, s.ordem]
    );
    n.servicos += 1;
  }

  console.log(
    `\n[espelho] ${n.contratos} contrato(s), ${n.parcelas} parcela(s), ` +
      `${n.alocacoes} alocação(ões), ${n.servicos} serviço(s) gravados`
  );

  // ── promoção opcional: SÓ o cabeçalho, SÓ com recurrence='unico' ──────────
  if (PROMOVER) {
    // recurrence='unico' não é detalhe: é a trava que torna isto seguro. As
    // cinco consultas que leem fin_contract filtram por recurrence='mensal', e
    // um contrato de obra com cronograma explícito não é recorrência nenhuma.
    // Promover 148 contratos assim não move um centavo do MRR nem inventa uma
    // linha na previsão de caixa — e o dia em que alguém trocar para 'mensal'
    // aqui, o MRR salta sem que nada tenha sido contratado.
    const alvo = contratos.filter((k) => k.status_ledger && k.counterparty_id);
    let promovidos = 0;
    for (const k of alvo) {
      const { rows } = await pool.query(
        `INSERT INTO fin_contract (
           entity_id, counterparty_id, name, direction, kind, nucleo, amount_cents,
           recurrence, start_date, end_date, confidence, status, notes, source, source_id)
         VALUES ((SELECT id FROM fin_entity WHERE slug='xpe'), $1,$2,'receber',$3,$4,$5,
                 'unico',$6,$7,$8,$9,$10,'erp_obras',$11)
         ON CONFLICT (entity_id, source, source_id) WHERE source_id IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name, counterparty_id = EXCLUDED.counterparty_id,
           amount_cents = EXCLUDED.amount_cents, start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date, status = EXCLUDED.status,
           kind = EXCLUDED.kind, nucleo = EXCLUDED.nucleo
         RETURNING id`,
        [k.counterparty_id, k.titulo, k.kind_ledger ?? 'projeto', k.nucleo,
         k.valor_contratado_cents, k.dataInicio, k.dataFimPrevista,
         k.status === 'ATIVO' ? 'contratado' : 'previsto', k.status_ledger,
         [k.codigo && `código ${k.codigo}`, k.vendedor && `vendedor ${k.vendedor}`,
          k.formaPagamento && `pagamento ${k.formaPagamento}`].filter(Boolean).join(' · ') || null,
         String(k.id)]
      );
      await pool.query(`UPDATE erp_contrato SET fin_contract_id = $1 WHERE erp_id = $2`, [rows[0].id, k.id]);
      promovidos += 1;
    }
    const semDestino = contratos.length - alvo.length;
    console.log(`[promoção] ${promovidos} contrato(s) em fin_contract com recurrence='unico'`);
    if (semDestino) {
      console.log(`[promoção] ${semDestino} NÃO promovido(s): sem contraparte ou sem status com equivalente. ` +
        `Ver erp_contrato_indeterminado_v`);
    }
  }

  // ── cobertura final, da view e não de contagem paralela ──────────────────
  const { rows: cob } = await pool.query(`SELECT * FROM erp_contrato_cobertura_v`);
  const c = cob[0];
  console.log('\n[cobertura] erp_contrato_cobertura_v');
  console.log(`  contratos ................. ${c.contratos}  contraparte ${c.contratos_com_contraparte} (${pct(c.contratos_com_contraparte, c.contratos)})`);
  console.log(`  sem núcleo (eixo AMBOS) ... ${c.contratos_sem_nucleo}`);
  console.log(`  sem cronograma ............ ${c.contratos_sem_cronograma}   parcelas não batem: ${c.contratos_parcelas_nao_batem}`);
  console.log(`  parcelas .................. ${c.parcelas}  com cobrança ${c.parcelas_com_cobranca} (${pct(c.parcelas_com_cobranca, c.parcelas)})`);
  console.log(`  parcelas com NOTA FISCAL .. ${c.parcelas_com_nota} (${pct(c.parcelas_com_nota, c.parcelas_com_cobranca)} das com cobrança)`);
  console.log(`  alocações com centro custo  ${c.alocacoes_com_centro_custo}/${c.alocacoes}`);

  const { rows: ind } = await pool.query(
    `SELECT assunto, count(*) n FROM erp_contrato_indeterminado_v GROUP BY 1 ORDER BY 2 DESC`
  );
  if (ind.length) {
    console.log('\n[indeterminado] erp_contrato_indeterminado_v — fila de decisão humana');
    for (const r of ind) console.log(`  ${r.assunto}: ${r.n}`);
  }
} finally {
  await pool.end();
}
