// Liga cada lançamento do Asaas à sua contraparte, pelo caminho exato da fonte.
//
// O PROBLEMA QUE ESTE ARQUIVO RESOLVE
// -----------------------------------
// A conta `asaas` tem 2.285 lançamentos em 2026 e 1.762 deles (77,1%) não sabem
// quem é a outra ponta. É o maior buraco isolado do ano.
//
// A informação nunca faltou — ela só nunca foi atravessada. `import-asaas.mjs`
// já cria as contrapartes a partir dos clientes (unificando por documento) e já
// liga COBRANÇA → cliente. O que ninguém ligou foi o EXTRATO → cobrança, e é um
// caminho de duas pontes, ambas dadas pela própria fonte:
//
//   fin_transaction.source_id  (= financialTransaction.id)
//     ├─ ftn.paymentId → payment.customer → customer.cpfCnpj ......... 1.061
//     └─ ftn.invoiceId → invoice.customer → customer.cpfCnpj ........... 503
//                                     └─ (invoice.payment como reserva)
//
// Sem heurística de valor e data em lugar nenhum — que é como nasceram os dois
// pareamentos falsos da A6.
//
// O QUE A MEDIÇÃO DESMENTIU
// -------------------------
// O PLANO_2026 registra que "as transações sem paymentId são taxas do Asaas".
// É o contrário: as taxas TÊM `paymentId` (a taxa nasce de uma cobrança
// específica). Medido no arquivo de 15/08, sobre as 1.762 linhas:
//
//   PAYMENT_FEE ......................... 552  ┐
//   PAYMENT_MESSAGING_NOTIFICATION_FEE .. 456  ├ têm paymentId
//   PAYMENT_RECEIVED .....................53  ┘
//   INVOICE_FEE ......................... 504    tem invoiceId (503 resolvem)
//   TRANSFER ............................ 139  ┐
//   INSTANT_TEXT_MESSAGE_FEE .............53  ├ sem nenhum vínculo na fonte
//   PIX_TRANSACTION_DEBIT_REFUND ..........4  │
//   BILL_PAYMENT ..........................1  ┘
//
// Teto exato: 1.564 de 1.762 (88,8%), e todos caem em documentos que JÁ estão
// entre as 433 contrapartes cadastradas — zero cadastro novo a criar.
//
// A DECISÃO QUE ESTE SCRIPT NÃO TOMA SOZINHO
// ------------------------------------------
// Dos 1.564, apenas 53 são recebimento de cliente. Os outros 1.511 são TAXA, e
// na taxa "o cliente" não é a outra ponta: quem recebeu os R$ 1,99 foi o Asaas.
// O cliente é a causa do custo.
//
// Por isso a política das taxas é um PARÂMETRO (`--taxas`) e não uma escolha
// embutida, e por isso `origin_document_id` (migration 0051) é gravada em
// qualquer política: a atribuição ao cliente fica registrada como fato, e mudar
// de ideia depois é rodar de novo, não redescobrir o dado.
//
// `counterparty_document` NUNCA recebe o documento do cliente numa taxa — em
// nenhuma das políticas. Aquela coluna é documentada na 0042 como "documento da
// OUTRA ponta" e é lida por uma regra determinística de prioridade 0
// (`transferencia-cnpj-proprio`). Gravar ali o CNPJ de quem não recebeu o
// dinheiro é plantar um fato falso na única coluna que uma regra automática
// trata como prova.
//
// O QUE ELE NÃO FAZ
// -----------------
// Não classifica, não mexe em categoria, núcleo, `transfer_status` nem em
// `fin_settlement`. Grava VÍNCULO e EVIDÊNCIA. Não toca `amount_cents` em linha
// nenhuma — e não pede que se acredite nisso: a soma por conta é medida antes e
// depois, dentro da mesma transação, e qualquer diferença aborta tudo.
//
// USO
//   node scripts/backfill-asaas-contraparte.mjs                 dry-run (padrão)
//   node scripts/backfill-asaas-contraparte.mjs --aplicar       grava
//   node scripts/backfill-asaas-contraparte.mjs --taxas=cliente política alternativa
//   node scripts/backfill-asaas-contraparte.mjs --tudo          inclui anos anteriores
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';
import { rawDirUrl } from './lib/paths.mjs';

loadEnv();
registerFinanceTypeParsers();

const ACCOUNT_SLUG = 'asaas';
const ENTITY_SLUG = 'xpe';
const ATOR = 'script:backfill-asaas-contraparte';
const ASAAS_NORM = 'asaas ip';

// Os quatro tipos em que o Asaas cobra de nós. O `type` vem da fonte e é fato
// estrutural — não é palpite sobre texto de descrição.
const TIPOS_TAXA = new Set([
  'PAYMENT_FEE',
  'INVOICE_FEE',
  'PAYMENT_MESSAGING_NOTIFICATION_FEE',
  'INSTANT_TEXT_MESSAGE_FEE'
]);

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const DRY = !APLICAR;
const TUDO = argv.includes('--tudo');
const DESDE = TUDO ? '1900-01-01' : (argv.find((a) => a.startsWith('--desde='))?.slice(8) ?? '2026-01-01');
const TAXAS = argv.find((a) => a.startsWith('--taxas='))?.slice(8) ?? 'asaas';

const conhecidas = /^--(aplicar|dry-run|tudo|ajuda|help|taxas=.*|desde=.*)$/;
const desconhecidas = argv.filter((a) => !conhecidas.test(a));
if (desconhecidas.length || argv.includes('--ajuda') || argv.includes('--help') || !['asaas', 'cliente', 'nulo'].includes(TAXAS)) {
  if (desconhecidas.length) console.error(`[asaas-cp] opção desconhecida: ${desconhecidas.join(', ')}\n`);
  if (!['asaas', 'cliente', 'nulo'].includes(TAXAS)) console.error(`[asaas-cp] --taxas inválido: ${TAXAS}\n`);
  console.log(
    [
      'uso: node scripts/backfill-asaas-contraparte.mjs [opções]',
      '',
      '  --dry-run        (padrão) roda tudo numa transação e faz ROLLBACK',
      '  --aplicar        grava, em UMA transação, com trilha em fin_audit_log',
      '  --desde=AAAA-MM-DD  recorte de data (padrão 2026-01-01)',
      '  --tudo           sem recorte de data (inclui 2021–2025)',
      '  --taxas=POLÍTICA quem é a contraparte de uma taxa do Asaas:',
      '                     asaas   (padrão) o Asaas recebeu o dinheiro;',
      '                             o cliente fica em origin_document_id',
      '                     cliente o cliente que originou a cobrança',
      '                     nulo    não carimba contraparte na taxa;',
      '                             só grava origin_document_id'
    ].join('\n')
  );
  process.exit(desconhecidas.length ? 1 : 0);
}

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const titulo = (t) => `\n${'━'.repeat(78)}\n${t}\n${'━'.repeat(78)}`;

const soDigitos = (d) => (d ?? '').replace(/\D/g, '') || null;
const docValido = (d) => !!d && (d.length === 11 || d.length === 14);
const tipoDoc = (d) => (d.length === 14 ? 'cnpj' : 'cpf');

// ---------------------------------------------------------------------------
// Arquivos brutos
// ---------------------------------------------------------------------------
const ler = async (nome) => (JSON.parse(await readFile(new URL(nome, rawDirUrl), 'utf8')).data ?? []);

const transacoes = await ler('asaas-financial-transactions.json');
const cobrancas = await ler('asaas-payments.json');
const notas = await ler('asaas-invoices.json');
const clientes = await ler('asaas-customers.json');

if (!transacoes.length) {
  console.log('[asaas-cp] nada em data/raw/asaas-financial-transactions.json — rode antes: npm run sync:asaas');
  process.exit(0);
}

const ftPorId = new Map(transacoes.map((t) => [t.id, t]));
const cobrancaPorId = new Map(cobrancas.map((p) => [p.id, p]));
const notaPorId = new Map(notas.map((i) => [i.id, i]));
const clientePorId = new Map(clientes.map((c) => [c.id, c]));

/**
 * O caminho exato, e só ele.
 *
 * Devolve { paymentId, documento, tipo, nome, via } ou null. `paymentId` é o da
 * cobrança de origem — é ele que vira `origin_document_id`; `documento` é o do
 * cliente, normalizado.
 *
 * Ordem deliberada: `paymentId` antes de `invoiceId`. Quando os dois existem, o
 * `paymentId` é o vínculo direto e a nota é apenas mais um passo até a mesma
 * cobrança — preferir o caminho curto elimina um salto onde nada pode se perder.
 */
function origemDe(ft) {
  if (ft.paymentId) {
    const cobranca = cobrancaPorId.get(ft.paymentId);
    const cliente = cobranca?.customer ? clientePorId.get(cobranca.customer) : null;
    const documento = soDigitos(cliente?.cpfCnpj);
    if (!docValido(documento)) return null;
    return { paymentId: ft.paymentId, documento, tipo: tipoDoc(documento), nome: cliente.name?.trim() || null, via: 'paymentId' };
  }
  if (ft.invoiceId) {
    const nota = notaPorId.get(ft.invoiceId);
    if (!nota) return null;
    // `invoice.customer` primeiro: é o cliente da própria nota. `invoice.payment`
    // é reserva para as notas emitidas sem cliente direto — 5 das 504, medido.
    const clienteId = nota.customer ?? (nota.payment ? cobrancaPorId.get(nota.payment)?.customer : null) ?? null;
    const cliente = clienteId ? clientePorId.get(clienteId) : null;
    const documento = soDigitos(cliente?.cpfCnpj);
    if (!docValido(documento)) return null;
    return { paymentId: nota.payment ?? null, documento, tipo: tipoDoc(documento), nome: cliente.name?.trim() || null, via: 'invoiceId' };
  }
  return null;
}

// ---------------------------------------------------------------------------
const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  // Rede do banco: com sync_mode ligado, fin_preserve_human_locks devolve
  // qualquer coluna travada por humano ao valor anterior. O RETURNING abaixo
  // mostra o resultado real, não a intenção.
  await client.query(`SET LOCAL fin.sync_mode = 'on'`);

  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.entity_id, e.cnpj
       FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
      WHERE a.slug = $1 AND e.slug = $2`,
    [ACCOUNT_SLUG, ENTITY_SLUG]
  );
  if (!contaRows.length) throw new Error(`conta '${ACCOUNT_SLUG}' não encontrada — banco errado? o certo tem 6 contas`);
  const { id: accountId, entity_id: entityId } = contaRows[0];
  const cnpjProprio = soDigitos(contaRows[0].cnpj);

  // A 0051 precisa estar aplicada. Sem esta checagem o script morreria no meio
  // do UPDATE com uma mensagem do Postgres sobre coluna inexistente, e quem
  // rodou não saberia que o que falta é uma migration.
  const { rows: col } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'fin_transaction' AND column_name = 'origin_document_id'`
  );
  if (!col.length) throw new Error('coluna origin_document_id ausente — aplique db/migrations/0051_fin_contraparte_asaas.sql antes');

  const { rows: inst } = await client.query(
    `SELECT id, name, document_number FROM fin_counterparty
      WHERE entity_id = $1 AND normalized_name = $2`,
    [entityId, ASAAS_NORM]
  );
  if (inst.length !== 1) {
    throw new Error(`esperava exatamente 1 contraparte '${ASAAS_NORM}', achei ${inst.length} — aplique a 0051`);
  }
  const asaasId = Number(inst[0].id);

  // ------------------------------------------------------------------ ÂNCORA
  // A soma por conta ANTES. Medida sobre a tabela inteira e dentro da mesma
  // transação da escrita, para que a comparação no fim seja com o mesmo
  // instantâneo — e não com um valor lido de uma conexão diferente, que outro
  // processo poderia ter mexido no meio.
  const somaPorConta = async () => {
    const { rows } = await client.query(
      // count(t.id), não count(*): com LEFT JOIN uma conta vazia apareceria
      // como "1 linha", que é número inventado num relatório cujo propósito é
      // provar que nada mudou.
      `SELECT a.slug, count(t.id)::int AS linhas, COALESCE(sum(t.amount_cents), 0)::bigint AS soma
         FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
        GROUP BY a.slug ORDER BY a.slug`
    );
    return rows;
  };
  const dinheiroAntes = await somaPorConta();

  // -------------------------------------------------------------- INDICADOR
  const medirIndicador = async () => {
    const { rows } = await client.query(
      `SELECT
         count(*) FILTER (WHERE posted_on >= '2026-01-01')                                    AS n2026,
         count(*) FILTER (WHERE posted_on >= '2026-01-01' AND counterparty_id IS NOT NULL)    AS c2026,
         count(*)                                                                             AS ntot,
         count(*) FILTER (WHERE counterparty_id IS NOT NULL)                                  AS ctot,
         count(*) FILTER (WHERE account_id = $1 AND posted_on >= '2026-01-01')                 AS na2026,
         count(*) FILTER (WHERE account_id = $1 AND posted_on >= '2026-01-01'
                            AND counterparty_id IS NOT NULL)                                  AS ca2026
         FROM fin_transaction`,
      [accountId]
    );
    return rows[0];
  };
  const antes = await medirIndicador();

  // ------------------------------------------------------------------ leitura
  const { rows: linhas } = await client.query(
    `SELECT t.id, t.source_id, t.source_kind, t.posted_on, t.amount_cents,
            t.counterparty_id, t.counterparty_document, t.counterparty_document_type,
            t.origin_document_id, t.human_locked_fields
       FROM fin_transaction t
      WHERE t.account_id = $1 AND t.source_id IS NOT NULL
        AND t.posted_on >= $2::date
        AND t.counterparty_id IS NULL`,
    [accountId, DESDE]
  );

  // Contrapartes por DOCUMENTO normalizado. Nunca por nome: o nome é o que a
  // outra ponta digitou e se fragmenta em grafias; o documento é o que a
  // Receita carimbou. É também o que faz os 33 cadastros repetidos do Asaas
  // convergirem para uma contraparte só.
  const { rows: cadastro } = await client.query(
    `SELECT id, document_number, name FROM fin_counterparty
      WHERE entity_id = $1 AND document_number IS NOT NULL`,
    [entityId]
  );
  const porDocumento = new Map(cadastro.map((c) => [soDigitos(c.document_number), Number(c.id)]));

  // paymentId → fin_document.id, para `origin_document_id`.
  const { rows: docs } = await client.query(
    `SELECT id, source_id FROM fin_document
      WHERE entity_id = $1 AND source = 'asaas' AND source_id IS NOT NULL`,
    [entityId]
  );
  const documentoPorPayment = new Map(docs.map((d) => [d.source_id, Number(d.id)]));

  // ------------------------------------------------------------------ decisão
  const atualizacoes = [];
  const rel = {
    candidatas: linhas.length,
    semFtNoArquivo: 0,
    semCaminho: new Map(),
    recebimentos: 0,
    taxas: 0,
    outros: 0,
    ganhaOrigem: 0,
    docNovoNecessario: new Map(),
    travadas: [],
    semMudanca: 0,
    documentoDaCasa: []
  };
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const linha of linhas) {
    const ft = ftPorId.get(linha.source_id);
    if (!ft) {
      rel.semFtNoArquivo += 1;
      continue;
    }
    const ehTaxa = TIPOS_TAXA.has(ft.type);
    const origem = origemDe(ft);

    if (!origem && !ehTaxa) {
      // Sem vínculo na fonte e não é taxa: TRANSFER, estorno de PIX, pagamento
      // de conta. Indeterminado — e indeterminado fica visível, não preenchido
      // por semelhança de nome.
      bump(rel.semCaminho, ft.type);
      continue;
    }

    let contraparteId = null;
    let documento = linha.counterparty_document;
    let tipo = linha.counterparty_document_type;

    if (origem) {
      // Trava de sanidade: um cliente do Asaas com o CNPJ da casa faria a regra
      // de prioridade 0 `transferencia-cnpj-proprio` transformar a linha em
      // transferência entre contas próprias na primeira reclassificação — e a
      // receita sumiria da DRE. Medido hoje: 0 dos 349 clientes. Se um dia
      // aparecer, a linha sai do alcance e vira relatório.
      if (cnpjProprio && origem.documento === cnpjProprio) {
        rel.documentoDaCasa.push({ linha, origem });
        continue;
      }
      contraparteId = porDocumento.get(origem.documento) ?? null;
      if (!contraparteId) {
        // Medido: 0 necessárias — os 1.564 caem todos em documento já
        // cadastrado. Se esta contagem sair de zero, o relatório grita e a
        // linha não é escrita: criar contraparte é cadastro, e cadastro novo
        // aparecendo num backfill é sinal de que a premissa mudou.
        bump(rel.docNovoNecessario, `${origem.documento} · ${origem.nome ?? '(sem nome)'}`);
        continue;
      }
    }

    if (ehTaxa) {
      rel.taxas += 1;
      // O cliente vira ORIGEM, não contraparte — em qualquer política.
      // `counterparty_document` fica como está: o cliente não recebeu a taxa, e
      // aquela coluna é lida por regra determinística como "quem está do outro
      // lado deste dinheiro".
      if (TAXAS === 'asaas') contraparteId = asaasId;
      else if (TAXAS === 'nulo') contraparteId = null;
      // TAXAS === 'cliente' mantém o contraparteId do cliente já resolvido.
      documento = linha.counterparty_document;
      tipo = linha.counterparty_document_type;
    } else if (ft.type === 'PAYMENT_RECEIVED') {
      rel.recebimentos += 1;
      // Aqui o cliente É a outra ponta: ele pagou, o dinheiro entrou. O
      // documento é verdadeiro e pode ser gravado.
      documento = linha.counterparty_document ?? origem.documento;
      tipo = linha.counterparty_document_type ?? origem.tipo;
    } else {
      rel.outros += 1;
      documento = linha.counterparty_document ?? origem.documento;
      tipo = linha.counterparty_document_type ?? origem.tipo;
    }

    const origemDocumentoId = origem?.paymentId ? documentoPorPayment.get(origem.paymentId) ?? null : null;
    const alvo = {
      counterparty_id: contraparteId ?? linha.counterparty_id,
      counterparty_document: documento,
      counterparty_document_type: tipo,
      origin_document_id: linha.origin_document_id ?? origemDocumentoId
    };

    const mudou =
      alvo.counterparty_id !== linha.counterparty_id ||
      alvo.counterparty_document !== linha.counterparty_document ||
      alvo.counterparty_document_type !== linha.counterparty_document_type ||
      alvo.origin_document_id !== linha.origin_document_id;
    if (!mudou) {
      rel.semMudanca += 1;
      continue;
    }

    // Trava humana em qualquer coluna que este script escreve tira a linha do
    // alcance — mesma invariante de import-asaas.mjs e backfill-inter-lastro.mjs.
    const travados = linha.human_locked_fields ?? [];
    const colisao = travados.filter((c) =>
      ['counterparty_id', 'counterparty_document', 'counterparty_document_type', 'origin_document_id'].includes(c)
    );
    if (colisao.length) {
      rel.travadas.push({ linha, campos: colisao });
      continue;
    }

    if (!linha.origin_document_id && alvo.origin_document_id) rel.ganhaOrigem += 1;
    atualizacoes.push({ linha, alvo });
  }

  // ------------------------------------------------------------------ escrita
  let gravadas = 0;
  if (atualizacoes.length) {
    // unnest de arrays paralelos: um comando por lote e não uma viagem de rede
    // por linha, e cada array com tipo declarado — numa lista VALUES os
    // parâmetros chegam como `text` e o INSERT da trilha falha em entity_id.
    const { rows: escritas } = await client.query(
      `UPDATE fin_transaction t
          SET counterparty_id            = d.contraparte,
              counterparty_document      = d.documento,
              counterparty_document_type = d.tipo,
              origin_document_id         = d.origem,
              updated_at                 = now()
         FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::bigint[])
              AS d(id, contraparte, documento, tipo, origem)
        WHERE t.id = d.id
        RETURNING t.id, t.counterparty_id, t.counterparty_document, t.counterparty_document_type, t.origin_document_id`,
      [
        atualizacoes.map((a) => a.linha.id),
        atualizacoes.map((a) => a.alvo.counterparty_id),
        atualizacoes.map((a) => a.alvo.counterparty_document),
        atualizacoes.map((a) => a.alvo.counterparty_document_type),
        atualizacoes.map((a) => a.alvo.origin_document_id)
      ]
    );
    gravadas = escritas.length;

    // Trilha. O `after` vem do RETURNING, nunca do que pretendíamos escrever:
    // uma trilha que descreve a intenção faz o desfazer mentir se um gatilho
    // recusar parte da mudança.
    const porId = new Map(escritas.map((e) => [Number(e.id), e]));
    const trilha = [];
    for (const { linha } of atualizacoes) {
      const depois = porId.get(Number(linha.id));
      if (!depois) continue;
      trilha.push({
        id: linha.id,
        antes: {
          counterparty_id: linha.counterparty_id,
          counterparty_document: linha.counterparty_document,
          counterparty_document_type: linha.counterparty_document_type,
          origin_document_id: linha.origin_document_id
        },
        depois: {
          counterparty_id: depois.counterparty_id,
          counterparty_document: depois.counterparty_document,
          counterparty_document_type: depois.counterparty_document_type,
          origin_document_id: depois.origin_document_id
        }
      });
    }

    const CAMPOS = ['counterparty_id', 'counterparty_document', 'counterparty_document_type', 'origin_document_id'];
    const PEDACO = 500;
    for (let i = 0; i < trilha.length; i += PEDACO) {
      const pedaco = trilha.slice(i, i + PEDACO);
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         SELECT $1::bigint, 'fin_transaction', d.id, 'bulk_update', d.antes, d.depois, $5::text[], $6::text
           FROM unnest($2::bigint[], $3::jsonb[], $4::jsonb[]) AS d(id, antes, depois)`,
        [entityId, pedaco.map((t) => t.id), pedaco.map((t) => JSON.stringify(t.antes)), pedaco.map((t) => JSON.stringify(t.depois)), CAMPOS, ATOR]
      );
    }
  }

  const depois = await medirIndicador();
  const dinheiroDepois = await somaPorConta();

  // ------------------------------------------------------- ÂNCORA: o dinheiro
  // Não pode mudar. Este script não escreve `amount_cents` em lugar nenhum, mas
  // a diferença entre acreditar e saber é esta comparação — e ela é barata.
  // Qualquer divergência aborta ANTES do COMMIT, inclusive no --aplicar.
  // Comparação em Number, não BigInt: `fin-types.mjs` já converte bigint e
  // numeric para Number, que é exato até 2^53 centavos (≈ R$ 90 trilhões).
  // `BigInt()` sobre um Number não inteiro lançaria — e a âncora tem de acusar
  // divergência, não morrer com TypeError antes de chegar ao relatório.
  const antesPorConta = new Map(dinheiroAntes.map((d) => [d.slug, d]));
  const quebras = [];
  for (const d of dinheiroDepois) {
    const a = antesPorConta.get(d.slug);
    if (!a || Number(a.soma) !== Number(d.soma) || Number(a.linhas) !== Number(d.linhas)) {
      quebras.push({ slug: d.slug, antes: a, depois: d });
    }
  }
  if (antesPorConta.size !== dinheiroDepois.length) {
    quebras.push({ slug: '(contagem de contas mudou)', antes: antesPorConta.size, depois: dinheiroDepois.length });
  }

  // ---------------------------------------------------------------- relatório
  const out = [];
  out.push(titulo('0. PARÂMETROS'));
  out.push(`  modo .................. ${DRY ? 'DRY-RUN (rollback ao final)' : 'APLICAR'}`);
  out.push(`  recorte ............... ${TUDO ? 'todo o histórico' : `posted_on >= ${DESDE}`}`);
  out.push(`  política das taxas .... --taxas=${TAXAS}`);
  out.push(`  contraparte do Asaas .. #${asaasId} "${inst[0].name}" (documento: ${inst[0].document_number ?? 'não cadastrado'})`);

  out.push(titulo('1. ESCOPO'));
  out.push(`  arquivo bruto ................. ${n(transacoes.length)} financialTransactions`);
  out.push(`  ledger, sem contraparte ....... ${n(rel.candidatas)} lançamentos no recorte`);
  out.push(`  sem correspondência no arquivo  ${n(rel.semFtNoArquivo)}`);

  out.push(titulo('2. O QUE SERIA GRAVADO'));
  out.push(`  linhas atualizadas ............ ${n(atualizacoes.length)}`);
  out.push(`    taxas do Asaas .............. ${n(rel.taxas)}  → contraparte: ${TAXAS}`);
  out.push(`    recebimentos de cliente ..... ${n(rel.recebimentos)}  → contraparte: o cliente (documento gravado)`);
  if (rel.outros) out.push(`    outros com caminho exato .... ${n(rel.outros)}`);
  out.push(`  ganham origin_document_id ..... ${n(rel.ganhaOrigem)}`);
  out.push(`  sem nada a mudar .............. ${n(rel.semMudanca)}`);

  out.push(titulo('3. INDETERMINADO — sem caminho exato na fonte (não tocado)'));
  let semTotal = 0;
  for (const [k, v] of [...rel.semCaminho].sort((a, b) => b[1] - a[1])) {
    out.push(`    ${String(v).padStart(5)}  ${k}`);
    semTotal += v;
  }
  out.push(`    ${String(semTotal).padStart(5)}  TOTAL`);
  out.push('');
  out.push('  Nenhuma delas tem paymentId nem invoiceId. O `/transfers` do Asaas');
  out.push('  responde 403, então não há dado que resolva sem o Fernando.');

  if (rel.docNovoNecessario.size) {
    out.push(titulo('ATENÇÃO — DOCUMENTOS SEM CONTRAPARTE CADASTRADA (não escritos)'));
    out.push('  A medição dizia 0. Se aparecem aqui, a premissa mudou — rode');
    out.push('  `npm run import:asaas` antes, que é quem cadastra cliente.');
    for (const [k, v] of [...rel.docNovoNecessario].slice(0, 20)) out.push(`    ${String(v).padStart(4)}×  ${k}`);
  }
  if (rel.documentoDaCasa.length) {
    out.push(titulo('ATENÇÃO — CLIENTE COM O CNPJ DA CASA (não tocado)'));
    out.push('  Carimbar contraparte aqui faria a regra de prioridade 0 virar a');
    out.push('  linha em transferência própria, e a receita sumiria da DRE.');
    for (const d of rel.documentoDaCasa.slice(0, 20)) out.push(`    #${d.linha.id} ${brl(d.linha.amount_cents)} ${d.origem.nome ?? ''}`);
  }
  if (rel.travadas.length) {
    out.push(titulo('TRAVADAS POR DECISÃO HUMANA (não tocadas)'));
    for (const t of rel.travadas.slice(0, 20)) out.push(`    #${t.linha.id} travada em ${t.campos.join(', ')}`);
  }

  out.push(titulo('4. INDICADOR "CONTRAPARTE IDENTIFICADA"'));
  const linhaInd = (rot, ca, na, cd, nd) =>
    `  ${rot.padEnd(24)} ${String(n(ca)).padStart(6)}/${String(n(na)).padEnd(6)} ${pct(ca, na).padStart(6)}` +
    `   →   ${String(n(cd)).padStart(6)}/${String(n(nd)).padEnd(6)} ${pct(cd, nd).padStart(6)}`;
  out.push(`  ${''.padEnd(24)} ${'ANTES'.padStart(20)}       ${'DEPOIS'.padStart(20)}`);
  out.push(linhaInd('conta asaas · 2026', antes.ca2026, antes.na2026, depois.ca2026, depois.na2026));
  out.push(linhaInd('todas as contas · 2026', antes.c2026, antes.n2026, depois.c2026, depois.n2026));
  out.push(linhaInd('todas as contas · total', antes.ctot, antes.ntot, depois.ctot, depois.ntot));

  out.push(titulo('5. ÂNCORA — O DINHEIRO NÃO PODE MUDAR'));
  for (const d of dinheiroDepois) {
    const a = antesPorConta.get(d.slug);
    const ok = a && Number(a.soma) === Number(d.soma) && Number(a.linhas) === Number(d.linhas);
    out.push(`  ${ok ? '✓' : '✗'} ${String(d.slug).padEnd(18)} ${String(n(d.linhas)).padStart(7)} linhas  ${brl(d.soma).padStart(18)}`);
  }
  out.push('');
  out.push(`  linhas efetivamente escritas: ${n(gravadas)}`);
  console.log(out.join('\n'));

  if (quebras.length) {
    console.error('\n[asaas-cp] ÂNCORA QUEBRADA — a soma por conta mudou. Abortando sem gravar:');
    for (const q of quebras) console.error('   ', JSON.stringify(q));
    await client.query('ROLLBACK');
    process.exitCode = 1;
  } else if (DRY) {
    await client.query('ROLLBACK');
    console.log('\n[asaas-cp] DRY-RUN — ROLLBACK executado, nada foi gravado. Use --aplicar para valer.');
  } else {
    await client.query('COMMIT');
    console.log(`\n[asaas-cp] APLICADO — ${n(gravadas)} lançamentos atualizados.`);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('[asaas-cp] abortado, nada foi gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
