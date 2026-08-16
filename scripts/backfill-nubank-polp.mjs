// Enriquece o extrato do Nubank com o que o Polp entrega e o CSV nunca teve:
// lastro de origem, documento da contraparte e vínculo com projeto.
//
// ===========================================================================
// O QUE ESTE SCRIPT RESOLVE
// ===========================================================================
// A conta `nubank` entrou por CSV, e o CSV do Nubank tem data, valor e uma
// descrição em texto corrido — nada mais. Medido em 16/08/2026, em 2026:
//
//     854 lançamentos, dos quais 703 sem `source_kind`, 854 sem documento da
//     contraparte, 823 sem centro de custo e 461 na fila de revisão — a maior
//     fila do ledger.
//
// O Polp (open finance do Nubank) tem tudo isso e entrega por GET.
// A migration 0052 abriu o lugar. Este script preenche.
//
// ===========================================================================
// O QUE ELE NÃO FAZ, E POR QUÊ
// ===========================================================================
// Não classifica, não mexe em categoria, não mexe em `transfer_status`, não
// pareia transferência e não move um centavo. Ele grava EVIDÊNCIA. Quem decide
// o que a evidência significa é `scripts/reclassificar.mjs`, onde a decisão
// nasce com lote, trilha e desfazer.
//
// Há duas exceções, e as duas são de VÍNCULO, não de classificação:
//
//   · `counterparty_id`, quando o documento identifica uma contraparte já
//     cadastrada e a linha está sem vínculo. Ligar as duas não decide nada —
//     registra uma identidade que o documento prova. Nunca sobrescreve.
//   · `cost_center_id`, quando o espelho do erp-obras já atribuiu projeto
//     àquela linha. O projeto é fato do ERP, não juízo daqui.
//
// ATENÇÃO — o vínculo de contraparte tem um efeito de segunda ordem legítimo e
// documentado: o gatilho `fin_transaction_categoria_pessoa` (0029) atribui a
// categoria padrão da pessoa a DESPESAS sem categoria quando a contraparte é
// uma pessoa cadastrada. O relatório abaixo conta quantas linhas isso alcançou,
// para que não seja uma surpresa encontrada depois no painel.
//
// ===========================================================================
// AS QUATRO COISAS QUE PODEM DAR MUITO ERRADO — e a trava de cada uma
// ===========================================================================
//
// 1. A PAGINAÇÃO DA FONTE ENTREGANDO MENOS DO QUE DIZ.
//    Em `/integrations/{id}/investments` o Polp declara `meta.total=66`,
//    devolve 66 linhas em 5 páginas e só 62 são distintas — e uma das
//    invisíveis estava ACTIVE com R$ 1.291,20. Testado neste endpoint em
//    16/08/2026: 865 declaradas, 865 entregues, 865 distintas, em três
//    varreduras e dois tamanhos de página. O defeito não está aqui — mas a
//    verificação roda em toda execução, porque "não tinha" não é "não terá".
//
// 2. O FUSO COMENDO 62 PARES.
//    O Polp entrega `date` em UTC; o ledger guarda data local. Comparar a data
//    crua joga fora tudo que foi feito entre 21h e 24h locais: 704 pares
//    firmes contra 766 depois de converter. A conversão é obrigatória.
//
// 3. LER A PONTA ERRADA DO PAGAMENTO.
//    Em toda saída o pagador somos nós; em toda entrada, o recebedor. E em
//    CONVENIO_ARRECADACAO / RESGATE_APLIC_FINANCEIRA / OUTROS a ponta da
//    contraparte vem NULA — o único documento presente é o nosso. Um fallback
//    "pega o que tiver" gravaria o CNPJ da casa em 14 pagamentos de DAS-SIMPLES
//    NACIONAL, que a regra da 0042 então converteria em transferência entre
//    contas próprias: imposto pago sumindo da DRE. Sem a ponta certa, não há
//    documento.
//
// 4. ESCOLHER NO AMBÍGUO.
//    Mesmo dia e mesmo valor com duas linhas de cada lado não se resolve por
//    sorteio. Quando as linhas do Polp do grupo dizem todas a MESMA coisa, o
//    conteúdo é aproveitado e o pareamento individual fica declarado como
//    ambíguo (`polp_transaction_id` NULL). Quando dizem coisas diferentes,
//    nada é gravado e a linha é marcada `lastro_match='ambiguo'`.
//
// SOMENTE GET NA API. O banco do erp-obras não é tocado — nem para ler: o que
// se lê é o espelho `erp_extrato_linha`, que já vive no banco financeiro.
//
// USO
//   node scripts/backfill-nubank-polp.mjs                  dry-run (padrão)
//   node scripts/backfill-nubank-polp.mjs --aplicar        grava, em UMA transação
//   node scripts/backfill-nubank-polp.mjs --cache=arq.json reusa dump local
//   node scripts/backfill-nubank-polp.mjs --dump=arq.json  salva o dump cru
//   node scripts/backfill-nubank-polp.mjs --de=2026-01-01 --ate=2026-12-31
import { readFile, writeFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const CONTA_SLUG = 'nubank';
const ENTITY_SLUG = 'xpe';
const ATOR = 'script:backfill-nubank-polp';

// ------------------------------------------------------------------- flags
const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome, padrao) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};

const APLICAR = flag('aplicar');
const DRY = !APLICAR;
const CACHE = valor('cache', null);
const DUMP = valor('dump', null);
const DE = valor('de', '2026-01-01');
const ATE = valor('ate', '2026-12-31');

const conhecidas = /^--(aplicar|dry-run|ajuda|help)$|^--(cache|dump|de|ate|conta)=/;
const desconhecidas = argv.filter((a) => !conhecidas.test(a));
if (desconhecidas.length || flag('ajuda') || flag('help')) {
  if (desconhecidas.length) console.error(`[nubank-polp] opção desconhecida: ${desconhecidas.join(', ')}\n`);
  console.log([
    'uso: node scripts/backfill-nubank-polp.mjs [--dry-run | --aplicar] [opções]',
    '',
    '  --dry-run       (padrão) executa tudo numa transação e faz ROLLBACK',
    '  --aplicar       grava, em uma única transação, com trilha em fin_audit_log',
    '  --cache=arq     reusa um dump local do Polp em vez de chamar a API',
    '  --dump=arq      salva o dump cru da API',
    '  --de / --ate    janela do ledger a enriquecer (padrão: 2026 inteiro)'
  ].join('\n'));
  process.exit(desconhecidas.length ? 1 : 0);
}

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const titulo = (t) => `\n${'━'.repeat(78)}\n${t}\n${'━'.repeat(78)}`;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

// --------------------------------------------------------------- utilidades
/**
 * Reais → centavos inteiros, por string decimal.
 * `Math.round(1.005 * 100)` é 100 e não 101 — binário. Num ledger de centavos
 * um erro de arredondamento é indistinguível de dinheiro faltando.
 */
function centavos(v) {
  if (v === null || v === undefined) return 0;
  const texto = typeof v === 'number' ? v.toFixed(6) : String(v).trim();
  const neg = texto.startsWith('-');
  const [inteira, decimal = ''] = texto.replace(/^[+-]/, '').split('.');
  let cent = BigInt(inteira || '0') * 100n + BigInt((decimal + '00').slice(0, 2));
  if (Number((decimal + '000').slice(2, 3) || '0') >= 5) cent += 1n;
  const num = Number(neg ? -cent : cent);
  if (!Number.isSafeInteger(num)) throw new Error(`valor fora da faixa segura: ${v}`);
  return num;
}

/**
 * A data LOCAL de uma transação do Polp.
 *
 * O Polp entrega `date` como timestamp UTC. O ledger guarda `posted_on` como
 * data local. Sem esta conversão, toda transação feita entre 21h e 24h locais
 * cai no dia seguinte e não casa com nada: 704 pares firmes contra 766.
 * -03:00 é o fuso de Recife/São Paulo, que não tem horário de verão desde 2019.
 */
const diaLocal = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const somaDias = (dia, d) => new Date(new Date(`${dia}T12:00:00Z`).getTime() + d * 86400000).toISOString().slice(0, 10);

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const tipoDeDocumento = (d) => (d.length === 14 ? 'cnpj' : d.length === 11 ? 'cpf' : null);

/**
 * O documento da CONTRAPARTE de uma transação do Polp — direcional.
 *
 * Medido nas 865 transações de 2025-09 a 2026-08:
 *
 *   operação                      n    receiver            payer
 *   PIX DEBIT                   597    externo 595         a casa 597
 *   PIX CREDIT                  106    a casa 106          externo 22 / casa 84
 *   RESGATE_APLIC_FINANCEIRA    120    null 66 / casa 54   casa 66 / null 54
 *   BOLETO DEBIT                 15    externo 15          a casa 15
 *   CONVENIO_ARRECADACAO         14    NULL 14             a casa 14
 *   OUTROS                       13    null 12 / casa 1    casa 12 / null 1
 *
 * Em toda SAÍDA o pagador somos nós; em toda ENTRADA, o recebedor. Por isso
 * DEBIT lê `receiver` e CREDIT lê `payer`, e nunca o contrário.
 *
 * Quando a ponta certa vem nula — CONVENIO_ARRECADACAO, RESGATE e OUTROS — o
 * resultado é `null`, e não o documento que sobrou. O documento que sobra
 * nesses casos é o NOSSO, e gravá-lo faria a regra `transferencia-cnpj-proprio`
 * (0042) converter 14 pagamentos de tributo em transferência entre contas
 * próprias — despesa real desaparecendo da DRE. Melhor sem documento do que
 * com o documento errado: sem documento a linha continua na fila; com o
 * documento errado ela sai da fila mentindo.
 *
 * O BOLETO é o contrário do Inter: lá `cpfCnpj` é o pagador e o beneficiário só
 * aparece por nome (0042); aqui o beneficiário vem em `receiver` E em
 * `merchant.cnpj`, nas 15 linhas. Aqui o documento do boleto é confiável.
 */
export function documentoDaContraparte(tx) {
  const pd = tx.payment_data || {};
  const recebedor = digitos(pd.receiver?.documentNumber?.value);
  const pagador = digitos(pd.payer?.documentNumber?.value);
  const comerciante = digitos(tx.merchant?.cnpj);
  const ponta = tx.type === 'DEBIT' ? [recebedor, comerciante] : [pagador];
  for (const d of ponta) if (tipoDeDocumento(d)) return d;
  return null;
}

/** O conteúdo que uma linha do Polp entrega. Duas linhas com a mesma carga são
 *  intercambiáveis para efeito de enriquecimento — e é isso que torna um grupo
 *  ambíguo aproveitável sem que ninguém escolha nada. */
const carga = (tx) => `${tx.operation_type}|${documentoDaContraparte(tx) ?? ''}`;

// ------------------------------------------------------------- credenciais
/**
 * Lê APENAS as chaves do Polp do `.env.obras`.
 *
 * O arquivo é o `.env.local` inteiro do erp-obras: traz service_role do
 * Supabase, Asaas de produção e Clicksign. Carregá-lo com um loader que joga
 * tudo em `process.env` daria a este processo credencial de ESCRITA em três
 * sistemas de produção que ele não tem motivo nenhum para tocar. Por isso o
 * parser é por chave, o valor nunca é impresso, e nada vai para `process.env`.
 */
async function credenciaisPolp() {
  const querido = ['POLP_API_CLIENT', 'POLP_API_SECRET', 'POLP_API_BASE_URL', 'POLP_BANK_ACCOUNT_ID'];
  const achado = Object.fromEntries(querido.map((k) => [k, process.env[k] ?? null]));

  if (!achado.POLP_API_CLIENT || !achado.POLP_API_SECRET) {
    let texto = '';
    try {
      texto = await readFile(new URL('../.env.obras', import.meta.url), 'utf8');
    } catch {
      throw new Error('sem POLP_API_CLIENT/POLP_API_SECRET no ambiente e .env.obras não encontrado');
    }
    for (const linha of texto.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (!m || !querido.includes(m[1])) continue;
      if (achado[m[1]]) continue;
      achado[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') || null;
    }
  }
  if (!achado.POLP_API_CLIENT || !achado.POLP_API_SECRET) throw new Error('credenciais do Polp ausentes');

  return {
    client: achado.POLP_API_CLIENT,
    secret: achado.POLP_API_SECRET,
    base: (achado.POLP_API_BASE_URL || 'https://api.polp.com.br/api/v1').replace(/\/$/, ''),
    conta: valor('conta', achado.POLP_BANK_ACCOUNT_ID || '2588')
  };
}

/**
 * SOMENTE GET. Não existe caminho neste arquivo que faça POST/PUT/PATCH/DELETE
 * na Polp, e não deve passar a existir.
 */
function clientePolp(cred) {
  const headers = { Accept: 'application/json', 'x-api-client': cred.client, 'x-api-secret': cred.secret };
  return async function get(caminho) {
    const resposta = await fetch(`${cred.base}${caminho}`, { method: 'GET', headers });
    // A URL entra no erro, os headers NUNCA.
    if (!resposta.ok) throw new Error(`GET ${caminho} → HTTP ${resposta.status}`);
    return resposta.json();
  };
}

/**
 * Percorre todas as páginas deduplicando por `id`, e CONFERE contra
 * `meta.total`. A conferência é o ponto: em `/investments` a fonte devolve a
 * contagem certa com o conteúdo errado, e somar o que ela entrega dá um número
 * plausível e falso.
 */
async function coletarTransacoes(get, conta) {
  const porId = new Map();
  let pagina = 1, ultima = 1, total = null, brutas = 0;
  while (pagina <= ultima && pagina <= 200) {
    const corpo = await get(`/accounts/${conta}/transactions?per_page=500&page=${pagina}`);
    const linhas = corpo?.data ?? [];
    brutas += linhas.length;
    for (const l of linhas) if (!porId.has(l.id)) porId.set(l.id, l);
    ultima = Number(corpo?.meta?.last_page ?? 1) || 1;
    total = corpo?.meta?.total ?? total;
    pagina += 1;
  }
  return { itens: [...porId.values()], total: total === null ? null : Number(total), brutas, paginas: ultima };
}

// =========================================================================
// 1. FONTE
// =========================================================================
const relatorio = { avisos: [] };
const aviso = (m) => relatorio.avisos.push(m);

let transacoes, integridade;
if (CACHE) {
  transacoes = JSON.parse(await readFile(CACHE, 'utf8'));
  integridade = { total: transacoes.length, distintas: transacoes.length, brutas: transacoes.length, cache: true };
} else {
  const cred = await credenciaisPolp();
  const { itens, total, brutas, paginas } = await coletarTransacoes(clientePolp(cred), cred.conta);
  transacoes = itens;
  integridade = { total, distintas: itens.length, brutas, paginas, cache: false };
  if (DUMP) await writeFile(DUMP, JSON.stringify(itens, null, 1));
}

// A trava da paginação. Perder linha aqui não dá erro: dá um enriquecimento
// menor que passa por completo.
if (integridade.total !== null && integridade.distintas < integridade.total) {
  throw new Error(
    `paginação instável em /accounts/*/transactions: meta.total=${integridade.total} mas ` +
    `${integridade.distintas} distintas em ${integridade.brutas} linhas entregues. ` +
    'É o mesmo defeito de /investments. Não prossiga sem varrer por id.'
  );
}

const daJanela = transacoes
  .map((t) => ({ ...t, dia: diaLocal(t.date), cents: centavos(t.amount) }))
  .filter((t) => t.dia >= DE && t.dia <= ATE);

// =========================================================================
// 2. BANCO
// =========================================================================
const pool = financePool();
const client = await pool.connect();
let gravadas = 0;

try {
  await client.query('BEGIN');

  // Rede do banco: com sync_mode ligado, fin_preserve_human_locks devolve
  // qualquer coluna travada por humano ao valor anterior. Lastro não é campo de
  // decisão e não deveria estar travado — mas se estiver, a trava vence.
  await client.query(`SET LOCAL fin.sync_mode = 'on'`);

  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.entity_id, e.cnpj
       FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
      WHERE a.slug = $1 AND e.slug = $2`,
    [CONTA_SLUG, ENTITY_SLUG]
  );
  if (!contaRows.length) throw new Error(`conta '${CONTA_SLUG}' não encontrada`);
  const { id: accountId, entity_id: entityId } = contaRows[0];
  const cnpjProprio = digitos(contaRows[0].cnpj) || null;
  if (!cnpjProprio) throw new Error('entidade sem CNPJ: sem ele não há como separar transferência própria de terceiro');

  // As colunas da 0052 têm de existir. Sem esta checagem o script morreria no
  // meio do UPDATE com uma mensagem do Postgres sobre coluna inexistente, e
  // quem estivesse rodando não saberia que o que falta é uma migration.
  const { rows: colunas } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fin_transaction' AND column_name IN ('polp_transaction_id','lastro_match')`
  );
  let ddlEnsaiado = false;
  if (colunas.length !== 2) {
    if (APLICAR) {
      throw new Error('colunas de lastro ausentes — aplique db/migrations/0052_fin_nubank_lastro.sql antes');
    }
    // No ensaio, a 0052 é aplicada DENTRO da transação que será revertida.
    // É o que permite medir o efeito do backfill antes de a migration ir para
    // produção — que é a ordem certa: ninguém deveria migrar para descobrir
    // depois quanto o backfill alcança. Nada disto sobrevive ao ROLLBACK.
    await client.query(await readFile(new URL('../db/migrations/0052_fin_nubank_lastro.sql', import.meta.url), 'utf8'));
    ddlEnsaiado = true;
  }

  // --------------------------------------------- âncora de dinheiro (ANTES)
  // Sobre a tabela INTEIRA, não só sobre a conta: um UPDATE mal escrito não
  // avisa que passou do alvo. Este é o número que precisa sair idêntico do
  // outro lado.
  const somaPorConta = async () => {
    const { rows } = await client.query(
      `SELECT a.slug, count(t.id)::int AS linhas, COALESCE(sum(t.amount_cents), 0)::bigint AS soma
         FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
        GROUP BY a.slug ORDER BY a.slug`
    );
    return rows.map((r) => ({ slug: r.slug, linhas: Number(r.linhas), soma: String(r.soma) }));
  };
  const dinheiroAntes = await somaPorConta();

  // ------------------------------------------------------------- indicadores
  const medir = async () => {
    const { rows: [m] } = await client.query(
      `SELECT count(*)::int                                                   AS total,
              count(*) FILTER (WHERE source_kind IS NOT NULL)::int            AS lastro,
              count(*) FILTER (WHERE counterparty_id IS NOT NULL)::int        AS contraparte,
              count(*) FILTER (WHERE counterparty_document IS NOT NULL)::int  AS documento,
              count(*) FILTER (WHERE cost_center_id IS NOT NULL)::int         AS centro,
              count(*) FILTER (WHERE category_id IS NOT NULL)::int            AS categoria,
              count(*) FILTER (WHERE review_status = 'pendente')::int         AS pendentes
         FROM fin_transaction
        WHERE account_id = $1 AND posted_on BETWEEN $2 AND $3`,
      [accountId, DE, ATE]
    );
    return m;
  };
  const antes = await medir();

  // ------------------------------------------------------------------ ledger
  const { rows: linhas } = await client.query(
    `SELECT t.id, t.posted_on, t.amount_cents, t.source, t.source_id, t.source_kind,
            t.counterparty_id, t.counterparty_document, t.counterparty_document_type,
            t.cost_center_id, t.category_id, t.review_status, t.human_locked_fields,
            t.polp_transaction_id, t.lastro_match
       FROM fin_transaction t
      WHERE t.account_id = $1 AND t.posted_on BETWEEN $2 AND $3
      ORDER BY t.posted_on, t.id`,
    [accountId, DE, ATE]
  );
  const led = linhas.map((r) => ({
    ...r,
    id: Number(r.id),
    dia: String(r.posted_on).slice(0, 10),
    cents: Number(r.amount_cents),
    travadas: r.human_locked_fields ?? []
  }));

  // -------------------------------------------------- espelho do erp-obras
  // Somente leitura, e do ESPELHO — o banco do Adryan não é tocado.
  const { rows: espelhoRows } = await client.query(
    `SELECT e.erp_linha_key, e.posted_on, e.amount_cents, e.projeto_id, e.projeto_nome, c.id AS cost_center_id
       FROM erp_extrato_linha e
       LEFT JOIN fin_cost_center c
         ON c.kind = 'projeto' AND c.source = 'erp' AND c.source_id = e.projeto_id::text
      WHERE e.conta_slug = $1 AND e.posted_on BETWEEN $2 AND $3`,
    [CONTA_SLUG, DE, ATE]
  );
  const espelho = espelhoRows.map((e) => ({
    key: e.erp_linha_key,
    dia: String(e.posted_on).slice(0, 10),
    cents: Number(e.amount_cents),
    projetoId: e.projeto_id,
    projetoNome: e.projeto_nome,
    cc: e.cost_center_id === null || e.cost_center_id === undefined ? null : Number(e.cost_center_id)
  }));

  // ------------------------------------------------- contrapartes por documento
  const { rows: cpRows } = await client.query(
    `SELECT id, document_number, name FROM fin_counterparty WHERE document_number IS NOT NULL`
  );
  const contraparteporDoc = new Map();
  for (const c of cpRows) {
    const d = digitos(c.document_number);
    // Documento repetido em duas contrapartes seria vínculo ambíguo: melhor
    // nenhum. Medido em 16/08/2026: zero repetidos nas 433 com documento.
    if (contraparteporDoc.has(d)) contraparteporDoc.set(d, null);
    else contraparteporDoc.set(d, { id: Number(c.id), nome: c.name });
  }

  // =======================================================================
  // 3. CASAMENTO — data local + valor, em duas passadas
  // =======================================================================
  const usadoP = new Set(), usadoL = new Set();
  const decisao = new Map(); // ledger.id -> { tx, match, polpId }

  const indexar = (lista, tol) => {
    const idx = new Map();
    for (const r of lista) {
      for (let d = -tol; d <= tol; d += 1) {
        const k = `${somaDias(r.dia, d)}|${r.cents}`;
        if (!idx.has(k)) idx.set(k, new Set());
        idx.get(k).add(r);
      }
    }
    return idx;
  };
  const agrupar = (polpLista, ledLista, tol) => {
    const idx = indexar(ledLista, tol);
    const g = new Map();
    for (const t of polpLista) {
      const k = `${t.dia}|${t.cents}`;
      if (!g.has(k)) g.set(k, { polp: [], led: [...(idx.get(k) ?? [])] });
      g.get(k).polp.push(t);
    }
    return g;
  };

  // PASSADA 1 — mesmo dia local, mesmo valor.
  let ambiguosIndeterminados = [];
  for (const [, g] of agrupar(daJanela, led, 0)) {
    if (!g.led.length) continue;
    if (g.polp.length === 1 && g.led.length === 1) {
      decisao.set(g.led[0].id, { tx: g.polp[0], match: 'exato', polpId: g.polp[0].id });
      usadoP.add(g.polp[0].id); usadoL.add(g.led[0].id);
      continue;
    }
    const cargas = new Set(g.polp.map(carga));
    // Carga única NÃO basta: o grupo precisa FECHAR EM TAMANHO.
    //
    // Medido em 16/08/2026: 3 grupos têm carga única e mais linhas no ledger do
    // que no Polp. Num deles — 02/06, -R$ 70,00 — o Polp traz um único PIX para
    // GJM LANCHONETES e o ledger traz dois lançamentos: um para a GJM (pelo
    // nome fantasia, "SPORT BURG") e outro para uma pessoa física. A segunda
    // linha do ledger não tem contrapartida nenhuma nesse grupo: ela é uma
    // transação feita depois da meia-noite que o banco lançou no dia anterior.
    //
    // Sem esta condição, o CNPJ da lanchonete seria carimbado no PIX da pessoa
    // — documento falso numa coluna que a regra `transferencia-cnpj-proprio`
    // (0042) lê como fato. "Todas dizem a mesma coisa" só torna o pareamento
    // irrelevante quando existe uma linha do Polp para cada linha do ledger.
    if (cargas.size === 1 && g.polp.length === g.led.length) {
      // Pareamento ambíguo, resultado não: qualquer atribuição possível dentro
      // do grupo produz exatamente o mesmo conteúdo. `polp_transaction_id`
      // fica NULL porque qual-é-qual continua desconhecido.
      for (const l of g.led) decisao.set(l.id, { tx: g.polp[0], match: 'grupo_homogeneo', polpId: null });
      for (const p of g.polp) usadoP.add(p.id);
      for (const l of g.led) usadoL.add(l.id);
    } else {
      for (const l of g.led) decisao.set(l.id, { tx: null, match: 'ambiguo', polpId: null });
      for (const p of g.polp) usadoP.add(p.id);
      for (const l of g.led) usadoL.add(l.id);
      ambiguosIndeterminados.push({
        dia: g.led[0].dia, cents: g.led[0].cents, np: g.polp.length, nl: g.led.length,
        cargas: [...cargas],
        motivo: cargas.size === 1 ? 'o grupo não fecha em tamanho' : 'conteúdos diferentes'
      });
    }
  }

  // PASSADA 2 — só o resíduo, tolerância de 1 dia, exigindo par único dos dois
  // lados. São as transações feitas depois da meia-noite local, que o extrato
  // do Nubank lança no dia anterior. Abrir a janela para TODO mundo pioraria:
  // os pares firmes caem de 766 para 754 e a ambiguidade triplica.
  const restoP = daJanela.filter((t) => !usadoP.has(t.id));
  const restoL = led.filter((l) => !usadoL.has(l.id));
  for (const [, g] of agrupar(restoP, restoL, 1)) {
    const livresL = g.led.filter((l) => !usadoL.has(l.id));
    const livresP = g.polp.filter((p) => !usadoP.has(p.id));
    if (livresP.length === 1 && livresL.length === 1) {
      decisao.set(livresL[0].id, { tx: livresP[0], match: 'residuo_1d', polpId: livresP[0].id });
      usadoP.add(livresP[0].id); usadoL.add(livresL[0].id);
    }
  }

  // O que sobrou do lado do ledger não tem par no Polp — e isso é um resultado,
  // não um vazio.
  for (const l of led) if (!decisao.has(l.id)) decisao.set(l.id, { tx: null, match: 'sem_par', polpId: null });

  // =======================================================================
  // 4. CENTRO DE CUSTO — o projeto que o erp-obras já atribuiu
  // =======================================================================
  // Casa o espelho INTEIRO contra o ledger, não só as linhas que têm projeto.
  // Casar só as com projeto inflaria: um grupo de mesmo dia e valor com uma
  // linha do espelho e duas do ledger carimbaria projeto nas duas, quando só
  // uma delas é aquela linha.
  const ccAlvo = new Map();
  const usadoE = new Set();

  // (a) determinístico: a linha do ledger que NASCEU do espelho carrega a
  //     chave dele em `source_id`.
  const espPorKey = new Map(espelho.map((e) => [e.key, e]));
  for (const l of led) {
    if (l.source !== 'erp_obras' || !l.source_id) continue;
    const e = espPorKey.get(l.source_id);
    if (!e) continue;
    usadoE.add(e.key);
    if (e.cc) ccAlvo.set(l.id, { cc: e.cc, projeto: e.projetoNome, via: 'source_id' });
  }

  // (b) o resto, por data + valor
  const gLed = new Map(), gEsp = new Map();
  for (const l of led) {
    if (ccAlvo.has(l.id) || l.source === 'erp_obras') continue;
    const k = `${l.dia}|${l.cents}`;
    if (!gLed.has(k)) gLed.set(k, []);
    gLed.get(k).push(l);
  }
  for (const e of espelho) {
    if (usadoE.has(e.key)) continue;
    const k = `${e.dia}|${e.cents}`;
    if (!gEsp.has(k)) gEsp.set(k, []);
    gEsp.get(k).push(e);
  }
  let ccIndeterminado = 0;
  for (const [k, es] of gEsp) {
    const ls = gLed.get(k) ?? [];
    if (!ls.length) continue;
    const comProjeto = es.filter((e) => e.cc);
    if (!comProjeto.length) continue;
    if (es.length === 1 && ls.length === 1) {
      ccAlvo.set(ls[0].id, { cc: es[0].cc, projeto: es[0].projetoNome, via: 'data_valor' });
      continue;
    }
    // Em grupo, só carimba se TODO o espelho aponta o mesmo centro de custo E
    // os dois lados têm a mesma contagem. Fora disso não se sabe qual é qual.
    const ccs = new Set(es.map((e) => e.cc ?? 0));
    if (ccs.size === 1 && es.length === ls.length && es[0].cc) {
      for (const l of ls) ccAlvo.set(l.id, { cc: es[0].cc, projeto: es[0].projetoNome, via: 'grupo_homogeneo' });
    } else {
      ccIndeterminado += comProjeto.length;
    }
  }

  // =======================================================================
  // 5. O QUE SERÁ GRAVADO
  // =======================================================================
  const atualizacoes = [];
  const r = {
    novoLastro: 0, lastroJaTinha: 0, lastroDivergente: [],
    novoDoc: 0, docCasa: 0, semDoc: 0, docJaTinha: 0,
    novoVinculo: [], novoCC: 0, ccJaTinha: 0,
    ambiguo: 0, semPar: 0, travadas: [], porOperacao: new Map()
  };

  for (const l of led) {
    const d = decisao.get(l.id);
    const cc = ccAlvo.get(l.id);
    const travada = (campo) => l.travadas.includes(campo);

    const novo = {
      source_kind: l.source_kind,
      counterparty_document: l.counterparty_document,
      counterparty_document_type: l.counterparty_document_type,
      counterparty_id: l.counterparty_id,
      cost_center_id: l.cost_center_id,
      polp_transaction_id: l.polp_transaction_id,
      lastro_match: d.match
    };

    if (d.match === 'ambiguo') r.ambiguo += 1;
    if (d.match === 'sem_par') r.semPar += 1;

    if (d.tx) {
      r.porOperacao.set(d.tx.operation_type, (r.porOperacao.get(d.tx.operation_type) ?? 0) + 1);
      novo.polp_transaction_id = d.polpId;

      // --- lastro de origem: só onde está vazio. Nunca sobrescreve.
      // 143 linhas já têm `source_kind` com valor diferente do Polp, e não é
      // divergência: é vocabulário mais rico. O ledger distingue APLICACAO_RDB
      // de RESGATE_RDB — a direção do dinheiro — onde o Polp diz apenas
      // RESGATE_APLIC_FINANCEIRA para os dois. Padronizar perderia informação.
      if (!l.source_kind) {
        if (!travada('source_kind')) { novo.source_kind = d.tx.operation_type; r.novoLastro += 1; }
      } else {
        r.lastroJaTinha += 1;
        if (l.source_kind !== d.tx.operation_type) {
          r.lastroDivergente.push({ id: l.id, ledger: l.source_kind, polp: d.tx.operation_type });
        }
      }

      // --- documento da contraparte
      const doc = documentoDaContraparte(d.tx);
      if (!doc) r.semDoc += 1;
      else if (l.counterparty_document) r.docJaTinha += 1;
      else if (!travada('counterparty_document')) {
        novo.counterparty_document = doc;
        novo.counterparty_document_type = tipoDeDocumento(doc);
        if (doc === cnpjProprio) r.docCasa += 1; else r.novoDoc += 1;

        // --- vínculo, quando o documento identifica alguém já cadastrado.
        // Não decide nada: registra identidade que o documento prova. E nunca
        // liga o CNPJ da casa a uma contraparte — a casa não é terceiro.
        if (!l.counterparty_id && doc !== cnpjProprio && !travada('counterparty_id')) {
          const cp = contraparteporDoc.get(doc);
          if (cp) { novo.counterparty_id = cp.id; r.novoVinculo.push({ id: l.id, cp: cp.nome }); }
        }
      }
    }

    // --- centro de custo
    if (cc && !l.cost_center_id && !travada('cost_center_id')) {
      novo.cost_center_id = cc.cc; r.novoCC += 1;
    } else if (l.cost_center_id) r.ccJaTinha += 1;

    const mudou = ['source_kind', 'counterparty_document', 'counterparty_document_type',
      'counterparty_id', 'cost_center_id', 'polp_transaction_id', 'lastro_match']
      .some((c) => String(novo[c] ?? '') !== String(l[c] ?? ''));
    if (mudou) atualizacoes.push({ linha: l, novo });
  }

  // =======================================================================
  // 6. ESCRITA — uma transação só
  // =======================================================================
  let categoriaPorGatilho = 0;
  if (atualizacoes.length) {
    const { rows: escritas } = await client.query(
      `UPDATE fin_transaction t SET
          source_kind                = d.source_kind,
          counterparty_document      = d.counterparty_document,
          counterparty_document_type = d.counterparty_document_type,
          counterparty_id            = d.counterparty_id,
          cost_center_id             = d.cost_center_id,
          polp_transaction_id        = d.polp_transaction_id,
          lastro_match               = d.lastro_match
        FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::text[])
             AS d(id, source_kind, counterparty_document, counterparty_document_type,
                  counterparty_id, cost_center_id, polp_transaction_id, lastro_match)
       WHERE t.id = d.id
       RETURNING t.id, t.source_kind, t.counterparty_document, t.counterparty_document_type,
                 t.counterparty_id, t.cost_center_id, t.polp_transaction_id, t.lastro_match, t.category_id`,
      [
        atualizacoes.map((a) => a.linha.id),
        atualizacoes.map((a) => a.novo.source_kind),
        atualizacoes.map((a) => a.novo.counterparty_document),
        atualizacoes.map((a) => a.novo.counterparty_document_type),
        atualizacoes.map((a) => a.novo.counterparty_id),
        atualizacoes.map((a) => a.novo.cost_center_id),
        atualizacoes.map((a) => a.novo.polp_transaction_id),
        atualizacoes.map((a) => a.novo.lastro_match)
      ]
    );
    gravadas = escritas.length;

    // O RETURNING é o resultado REAL, não a intenção: se uma trava humana
    // devolveu o valor antigo, é aqui que se vê.
    const porId = new Map(escritas.map((e) => [Number(e.id), e]));
    for (const a of atualizacoes) {
      const depois = porId.get(a.linha.id);
      if (!depois) continue;
      for (const campo of ['source_kind', 'counterparty_document', 'counterparty_id', 'cost_center_id']) {
        if (String(a.novo[campo] ?? '') !== String(depois[campo] ?? '')) {
          r.travadas.push({ id: a.linha.id, campo });
        }
      }
      // efeito de segunda ordem do gatilho da 0029
      if (!a.linha.category_id && depois.category_id) categoriaPorGatilho += 1;
    }

    // --------------------------------------------------------------- trilha
    const CAMPOS = ['source_kind', 'counterparty_document', 'counterparty_document_type',
      'counterparty_id', 'cost_center_id', 'polp_transaction_id', 'lastro_match'];
    const trilha = atualizacoes.map((a) => ({
      id: a.linha.id,
      antes: Object.fromEntries(CAMPOS.map((c) => [c, a.linha[c] ?? null])),
      depois: Object.fromEntries(CAMPOS.map((c) => [c, porId.get(a.linha.id)?.[c] ?? null]))
    }));
    const PEDACO = 500;
    for (let i = 0; i < trilha.length; i += PEDACO) {
      const pedaco = trilha.slice(i, i + PEDACO);
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         SELECT $1::bigint, 'fin_transaction', d.id, 'bulk_update', d.antes, d.depois, $5::text[], $6::text
           FROM unnest($2::bigint[], $3::jsonb[], $4::jsonb[]) AS d(id, antes, depois)`,
        [entityId, pedaco.map((t) => t.id), pedaco.map((t) => JSON.stringify(t.antes)),
          pedaco.map((t) => JSON.stringify(t.depois)), CAMPOS, ATOR]
      );
    }
  }

  // ---------------------------------------------- âncora de dinheiro (DEPOIS)
  // A prova, não a promessa. Este script não tem motivo nenhum para tocar em
  // `amount_cents`, e é exatamente por isso que a verificação é barata e
  // obrigatória: o erro que ela pega é o UPDATE que passou do alvo.
  const dinheiroDepois = await somaPorConta();
  const divergencias = [];
  for (const antesConta of dinheiroAntes) {
    const depoisConta = dinheiroDepois.find((d) => d.slug === antesConta.slug);
    if (!depoisConta) { divergencias.push(`conta ${antesConta.slug} sumiu`); continue; }
    if (depoisConta.soma !== antesConta.soma) {
      divergencias.push(`${antesConta.slug}: ${brl(antesConta.soma)} → ${brl(depoisConta.soma)}`);
    }
    if (depoisConta.linhas !== antesConta.linhas) {
      divergencias.push(`${antesConta.slug}: ${n(antesConta.linhas)} → ${n(depoisConta.linhas)} linhas`);
    }
  }
  if (divergencias.length) {
    throw new Error(`ÂNCORA DE DINHEIRO ROMPIDA — ${divergencias.join(' · ')}`);
  }

  const depois = await medir();

  // =======================================================================
  // 7. RELATÓRIO
  // =======================================================================
  const out = [];
  out.push(titulo('1. FONTE — POLP (somente GET)'));
  if (integridade.cache) {
    out.push(`  dump local ............. ${n(transacoes.length)} transações (--cache)`);
  } else {
    out.push(`  meta.total ............. ${n(integridade.total)}`);
    out.push(`  linhas entregues ....... ${n(integridade.brutas)} em ${integridade.paginas} página(s)`);
    out.push(`  ids distintos .......... ${n(integridade.distintas)}`);
    out.push(`  perda por paginação .... ${n(integridade.total - integridade.distintas)}  ${integridade.total === integridade.distintas ? '← íntegro' : '← DEFEITO'}`);
  }
  out.push(`  dentro de ${DE}..${ATE} .... ${n(daJanela.length)}`);

  out.push(titulo('2. CASAMENTO — data local + valor'));
  const conta = (m) => [...decisao.values()].filter((d) => d.match === m).length;
  out.push(`  ledger no período ...... ${n(led.length)}`);
  out.push(`  exato (mesmo dia) ...... ${n(conta('exato'))}`);
  out.push(`  resíduo ±1 dia ......... ${n(conta('residuo_1d'))}`);
  out.push(`  grupo homogêneo ........ ${n(conta('grupo_homogeneo'))}  (pareamento ambíguo, conteúdo idêntico)`);
  out.push(`  AMBÍGUO — indeterminado  ${n(conta('ambiguo'))}  em ${ambiguosIndeterminados.length} grupo(s)`);
  out.push(`  sem par no Polp ........ ${n(conta('sem_par'))}`);
  const alcancadas = conta('exato') + conta('residuo_1d') + conta('grupo_homogeneo');
  out.push(`  → alcançadas com evidência: ${n(alcancadas)} de ${n(led.length)} (${pct(alcancadas, led.length)})`);
  out.push(`  Polp sem par no ledger . ${n(daJanela.filter((t) => !usadoP.has(t.id)).length)}`);

  if (ambiguosIndeterminados.length) {
    out.push('');
    out.push('  Os ambíguos, um a um — nada foi gravado em nenhum deles:');
    for (const a of ambiguosIndeterminados) {
      out.push(`    ${a.dia}  ${brl(a.cents).padStart(14)}  ${a.np} Polp × ${a.nl} ledger — ${a.motivo}`);
      for (const c of a.cargas) out.push(`        ${c.replace('|', '  doc ') || '(sem documento)'}`);
    }
  }

  out.push(titulo('3. O QUE SERIA GRAVADO'));
  out.push(`  linhas a atualizar ..... ${n(atualizacoes.length)}`);
  out.push(`    ganham source_kind ... ${n(r.novoLastro)}`);
  out.push(`    já tinham (intactas) . ${n(r.lastroJaTinha)}${r.lastroDivergente.length ? `, das quais ${n(r.lastroDivergente.length)} com valor diferente do Polp` : ''}`);
  out.push(`    ganham documento ..... ${n(r.novoDoc)} de terceiro + ${n(r.docCasa)} da própria casa`);
  out.push(`    Polp não dá documento  ${n(r.semDoc)}  (ponta da contraparte nula na fonte)`);
  out.push(`    ganham counterparty_id ${n(r.novoVinculo.length)}`);
  out.push(`    ganham centro de custo ${n(r.novoCC)}`);
  if (ccIndeterminado) out.push(`    projeto indeterminado  ${n(ccIndeterminado)}  (grupo do espelho não fecha com o do ledger)`);
  if (r.porOperacao.size) {
    out.push('  por operation_type do Polp:');
    for (const [k, v] of [...r.porOperacao].sort((a, b) => b[1] - a[1])) out.push(`    ${String(n(v)).padStart(5)}  ${k}`);
  }
  if (r.lastroDivergente.length) {
    out.push('');
    out.push('  source_kind divergente — NÃO sobrescrito (o do ledger é mais específico):');
    const agrup = new Map();
    for (const d of r.lastroDivergente) {
      const k = `${d.ledger} × ${d.polp}`;
      agrup.set(k, (agrup.get(k) ?? 0) + 1);
    }
    for (const [k, v] of [...agrup].sort((a, b) => b[1] - a[1])) out.push(`    ${String(n(v)).padStart(5)}  ledger ${k}`);
  }
  if (categoriaPorGatilho) {
    out.push('');
    out.push(`  EFEITO DE SEGUNDA ORDEM: ${n(categoriaPorGatilho)} linha(s) ganharam categoria`);
    out.push('  pelo gatilho fin_transaction_categoria_pessoa (0029) — a categoria padrão da');
    out.push('  pessoa cadastrada, aplicada a despesa sem categoria ao ganhar contraparte.');
  }
  if (r.travadas.length) {
    out.push('');
    out.push(`  TRAVADAS POR DECISÃO HUMANA (a trava venceu): ${n(r.travadas.length)}`);
    for (const t of r.travadas.slice(0, 10)) out.push(`    #${t.id} em ${t.campo}`);
  }

  out.push(titulo(`4. INDICADORES — conta ${CONTA_SLUG}, ${DE} a ${ATE}`));
  const linhaInd = (nome, a, b) => {
    const base = Number(antes.total);
    out.push(
      `  ${nome.padEnd(24)} ${String(n(a)).padStart(5)} → ${String(n(b)).padStart(5)}` +
      `   ${pct(a, base).padStart(6)} → ${pct(b, base).padStart(6)}   ${b > a ? `+${n(b - a)}` : b < a ? `${n(b - a)}` : '—'}`
    );
  };
  out.push(`  (base: ${n(antes.total)} lançamentos)`);
  linhaInd('lastro de origem', antes.lastro, depois.lastro);
  linhaInd('documento da contraparte', antes.documento, depois.documento);
  linhaInd('contraparte identificada', antes.contraparte, depois.contraparte);
  linhaInd('centro de custo', antes.centro, depois.centro);
  linhaInd('categoria atribuída', antes.categoria, depois.categoria);
  linhaInd('fila de revisão (pendente)', antes.pendentes, depois.pendentes);

  out.push(titulo('5. DINHEIRO — não pode mudar'));
  for (const d of dinheiroDepois) {
    const a = dinheiroAntes.find((x) => x.slug === d.slug);
    const igual = a && a.soma === d.soma && a.linhas === d.linhas;
    out.push(`  ${String(d.slug).padEnd(18)} ${String(n(d.linhas)).padStart(7)} linhas  ${brl(d.soma).padStart(18)}  ${igual ? '=' : '≠ MUDOU'}`);
  }
  out.push('');
  out.push(`  âncora: ${divergencias.length ? 'ROMPIDA' : 'intacta em todas as contas'}`);
  out.push(`  linhas efetivamente escritas: ${n(gravadas)}`);

  if (relatorio.avisos.length) {
    out.push(titulo('AVISOS'));
    for (const a of relatorio.avisos) out.push(`  ! ${a}`);
  }

  out.push(titulo('6. O QUE ISTO NÃO DECIDIU'));
  out.push(`  ${n(conta('ambiguo'))} linha(s) ficaram lastro_match='ambiguo' e ${n(conta('sem_par'))} 'sem_par'.`);
  out.push('  Nenhuma delas recebeu conteúdo. Para listá-las:');
  out.push("    SELECT id, posted_on, amount_cents, description_raw, lastro_match");
  out.push("      FROM fin_transaction WHERE lastro_match IN ('ambiguo','sem_par');");
  out.push('');
  out.push('  Este script não classificou nada. Quem aplica regra é:');
  out.push('    node scripts/reclassificar.mjs --conta=nubank');
  out.push(`  e ele vai reconhecer ${n(r.docCasa)} linha(s) com o CNPJ da casa como transferência`);
  out.push('  entre contas próprias (regra da 0042). Isso move receita — faça como lote consciente.');

  console.log(out.join('\n'));

  if (DRY) {
    await client.query('ROLLBACK');
    console.log('\n[nubank-polp] DRY-RUN — ROLLBACK executado, nada foi gravado. Use --aplicar para valer.');
    if (ddlEnsaiado) {
      console.log('[nubank-polp] a 0052 ainda NÃO está aplicada: o DDL rodou dentro da transação revertida,');
      console.log('              só para o ensaio. Aplique a migration antes de --aplicar.');
    }
  } else {
    await client.query('COMMIT');
    console.log(`\n[nubank-polp] APLICADO — ${n(gravadas)} lançamentos atualizados.`);
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('[nubank-polp] abortado, nada foi gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
