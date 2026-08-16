// Ingestão das aplicações (caixinhas PJ do Nubank) pela API do Polp.
//
// ===========================================================================
// O QUE ESTE SCRIPT CONSERTA
// ===========================================================================
// `nubank-caixinhas` exibia R$ 59.001,05 contra R$ 27.700,17 reais: R$ 31.300,88
// de caixa que não existe, numa conta de reserva, errando para cima. A conta
// fechava aritmeticamente — a abertura da 0039 mais os 19 lançamentos do PDF de
// julho dão exatamente 59.001,05 — e mesmo assim mentia, porque o extrato
// termina em 31/07 e agosto inteiro nunca entrou.
//
// Aqui agosto entra, posição a posição, e o saldo passa a ser a soma da
// carteira lida na fonte.
//
// ===========================================================================
// AS TRÊS COISAS QUE PODEM DAR MUITO ERRADO — e as travas de cada uma
// ===========================================================================
//
// 1. DUPLA CONTAGEM ENTRE A CARTEIRA E A CONTA.
//    `fin_investment.balance_cents` NÃO é uma parcela do caixa ao lado do saldo
//    da conta: ele É o saldo da conta. Quem soma o caixa da empresa soma
//    `fin_account`, e só. Este script grava `current_balance_cents` como a soma
//    das posições e depois exige que `abertura + Σ lançamentos` dê o mesmo
//    número — se não der, faz ROLLBACK em vez de escolher um dos dois.
//
// 2. DUPLA CONTAGEM ENTRE A CORRENTE E A CAIXINHA.
//    Toda aplicação já existe na conta corrente como saída e todo resgate como
//    entrada. O espelho criado aqui é a OUTRA perna do mesmo fato, com sinal
//    oposto: somadas, dão zero, que é o efeito correto de mover dinheiro de
//    bolso. As duas pernas nascem pareadas no mesmo `transfer_group_id` e
//    categorizadas em 9.03 (neutra), de modo que nem receita nem despesa se
//    mexem. Só é espelhada linha da conta corrente que ainda NÃO tenha par —
//    as 18 de julho já foram pareadas contra o PDF e são deixadas em paz.
//
// 3. A PAGINAÇÃO DA FONTE ENTREGANDO UM NÚMERO ERRADO COM CARA DE CERTO.
//    `GET /integrations/{id}/investments` diz `meta.total = 66`, devolve 66
//    linhas em 5 páginas e apenas 62 são distintas: a ordenação é instável, 4
//    posições vêm duas vezes e 4 nunca aparecem. Somar o que a paginação
//    entrega dá R$ 26.408,97 — R$ 1.291,20 a MENOS que o real, porque uma das
//    invisíveis (a 10121, de 22/06) está ACTIVE. Outras duas (10140 e 10141,
//    de 29/07) são as aplicações de R$ 10.000,00 e R$ 1.136,00 que o PDF do
//    Nubank imprime, e sem elas três dias de agosto pareciam divergir.
//    Por isso `coletarPosicoes()` varre a faixa de ids, busca individualmente
//    todo id ausente e SE RECUSA a prosseguir enquanto a contagem final for
//    menor que `meta.total`.
//
// ===========================================================================
// A PROVA QUE AUTORIZA A ESCRITA — medida, não assumida
// ===========================================================================
// Conciliação dia a dia entre o fluxo de RDB da conta corrente neste ledger e
// os BUY/SELL do Polp, em 15/08/2026: 54 dos 55 dias batem AO CENTAVO.
//
//   resgates   ledger R$ 150.245,76  ·  SELL Polp R$ 150.245,76   zero
//   aplicações ledger R$ 170.181,29  ·  BUY  Polp R$ 177.481,29   R$ 7.300,00
//
// A única diferença é 28/12/2025, a compra que ABRE a caixinha — anterior ao
// início do extrato do Nubank aqui (02/01/2026) e já rastreada pela 0039 no
// erp-obras. Fora da janela coberta, portanto reportada e não bloqueante.
//
// Dentro da janela (da abertura da conta para cá) a exigência é ZERO
// divergência. Qualquer dia que não bata aborta antes de gravar: um saldo que
// só fecha porque o ajuste absorveu a diferença é o erro que este módulo
// existe para não cometer.
//
// O ajuste de marcação existe e é declarado, não escondido: R$ 2,57 no período
// 01–15/08 (0,009% do saldo). Ele é o rendimento apropriado DENTRO das
// aplicações, que nunca passa pela conta corrente. O teto dele é o rendimento
// total não realizado que a própria fonte reporta — se o resíduo passar disso,
// não é rendimento, é erro, e o script aborta.
//
// ===========================================================================
// SOMENTE GET NA API. O banco do erp-obras não é tocado — nem para ler.
// ===========================================================================
//
// Uso:
//   node scripts/sync-polp-investimentos.mjs                 dry-run (padrão)
//   node scripts/sync-polp-investimentos.mjs --dry-run       idem, explícito
//   node scripts/sync-polp-investimentos.mjs --aplicar       grava
//   node scripts/sync-polp-investimentos.mjs --cache=arq.json  reusa dump local
//   node scripts/sync-polp-investimentos.mjs --dump=arq.json   salva o dump cru
//   node scripts/sync-polp-investimentos.mjs --json            saída de máquina
import { readFile, writeFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { dedupeHash, normalizeDescription } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

// --------------------------------------------------------------------- flags
const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome, padrao) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};

// Dry-run é o PADRÃO, e `--dry-run` é aceito só para quem prefere dizer em voz
// alta. Um ingestor que grava por omissão transforma "deixa eu ver o que ele
// faria" no pior acidente possível deste módulo.
const APLICAR = flag('aplicar');
const JSON_OUT = flag('json');
const CACHE = valor('cache', null);
const DUMP = valor('dump', null);
const CONTA_SLUG = valor('conta', 'nubank-caixinhas');
const CONTA_CORRENTE_SLUG = valor('corrente', 'nubank');
const ENTITY_SLUG = valor('entidade', 'xpe');

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Date().toISOString().slice(0, 10);
const dia = (v) => (typeof v === 'string' ? v.slice(0, 10) : v?.toISOString().slice(0, 10) ?? null);

const relatorio = { modo: APLICAR ? 'aplicar' : 'dry-run', etapas: [], avisos: [], erros: [] };
const log = (...args) => { if (!JSON_OUT) console.log(...args); };
const aviso = (msg) => { relatorio.avisos.push(msg); log(`  ! ${msg}`); };

/**
 * Reais → centavos inteiros.
 *
 * A API devolve `balance: 899.22` como número JSON. `Math.round(899.22 * 100)`
 * é 89922, mas `Math.round(1.005 * 100)` é 100 e não 101 — binário. Passar por
 * string decimal elimina a classe inteira de erro, e num ledger de centavos um
 * erro de arredondamento é indistinguível de dinheiro faltando.
 */
function centavos(valorEmReais) {
  if (valorEmReais === null || valorEmReais === undefined) return 0;
  const texto = typeof valorEmReais === 'number' ? valorEmReais.toFixed(6) : String(valorEmReais).trim();
  const negativo = texto.startsWith('-');
  const [inteira, decimal = ''] = texto.replace(/^[+-]/, '').split('.');
  const cent = BigInt(inteira || '0') * 100n + BigInt((decimal + '00').slice(0, 2));
  const resto = Number((decimal + '000').slice(2, 3) || '0');
  const arredondado = resto >= 5 ? cent + 1n : cent;
  const n = Number(negativo ? -arredondado : arredondado);
  if (!Number.isSafeInteger(n)) throw new Error(`valor fora da faixa segura: ${valorEmReais}`);
  return n;
}

// ---------------------------------------------------------------- credenciais
/**
 * Lê APENAS as chaves do Polp do `.env.obras`.
 *
 * O arquivo é o `.env.local` inteiro do erp-obras: traz service_role do
 * Supabase, Asaas de produção e Clicksign. Carregá-lo com um loader que joga
 * tudo em `process.env` daria a este processo credencial de ESCRITA em três
 * sistemas de produção que ele não tem motivo nenhum para tocar. Por isso o
 * parser é por chave, o valor nunca é impresso, e nada vai para `process.env`.
 *
 * `process.env` tem precedência: em produção as chaves devem ser injetadas
 * pelo ambiente, e o arquivo é só a conveniência local.
 */
async function credenciaisPolp() {
  const querido = ['POLP_API_CLIENT', 'POLP_API_SECRET', 'POLP_API_BASE_URL', 'POLP_INTEGRATION_ID'];
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
    integracao: valor('integracao', achado.POLP_INTEGRATION_ID || '2906')
  };
}

// ------------------------------------------------------------------ API (GET)
/**
 * SOMENTE GET. Não existe caminho neste arquivo que faça POST/PUT/PATCH/DELETE
 * na Polp, e não deve passar a existir: criar webhook, disparar sync ou emitir
 * ordem a partir de um script de leitura é irreversível do lado de fora.
 */
function clientePolp(cred) {
  const headers = {
    Accept: 'application/json',
    'x-api-client': cred.client,
    'x-api-secret': cred.secret
  };
  return async function get(caminho) {
    const url = `${cred.base}${caminho}`;
    const resposta = await fetch(url, { method: 'GET', headers });
    if (!resposta.ok) {
      // A URL entra no erro, os headers NUNCA.
      throw new Error(`GET ${caminho} → HTTP ${resposta.status}`);
    }
    return resposta.json();
  };
}

/** Percorre todas as páginas de um endpoint paginado, deduplicando por id. */
async function paginar(get, caminho, limitePaginas = 80) {
  const porId = new Map();
  let pagina = 1;
  let ultima = 1;
  let total = null;
  let linhasBrutas = 0;

  while (pagina <= ultima && pagina <= limitePaginas) {
    const sep = caminho.includes('?') ? '&' : '?';
    const corpo = await get(`${caminho}${sep}page=${pagina}`);
    const linhas = corpo?.data ?? [];
    linhasBrutas += linhas.length;
    for (const linha of linhas) if (!porId.has(linha.id)) porId.set(linha.id, linha);
    ultima = Number(corpo?.meta?.last_page ?? 1) || 1;
    total = corpo?.meta?.total ?? total;
    pagina += 1;
  }
  return { itens: [...porId.values()], total, linhasBrutas };
}

/**
 * Coleta as posições e FECHA O BURACO DA PAGINAÇÃO.
 *
 * A varredura por id é possível porque os ids do Polp são sequenciais dentro da
 * integração. Ela é limitada à faixa efetivamente devolvida — não sai pescando
 * ids de outras integrações — e só dispara quando `meta.total` acusa que falta
 * alguém, para não gastar 60 GETs em toda execução.
 */
async function coletarPosicoes(get, integracao) {
  const { itens, total, linhasBrutas } = await paginar(get, `/integrations/${integracao}/investments`);
  log(`[polp] ${linhasBrutas} linha(s) em páginas → ${itens.length} posição(ões) distinta(s); meta.total = ${total}`);

  const porId = new Map(itens.map((i) => [i.id, i]));
  if (total !== null && porId.size < Number(total)) {
    const faltam = Number(total) - porId.size;
    aviso(`paginação instável: ${linhasBrutas} linhas com ${porId.size} distintas, ${faltam} posição(ões) perdida(s). Varrendo por id.`);
    const ids = [...porId.keys()].sort((a, b) => a - b);
    const buracos = [];
    for (let id = ids[0]; id <= ids[ids.length - 1]; id += 1) if (!porId.has(id)) buracos.push(id);

    for (const id of buracos) {
      try {
        const corpo = await get(`/investments/${id}`);
        const item = corpo?.data ?? corpo;
        // Um id da faixa pode pertencer a outra integração. Sem este filtro a
        // varredura importaria posição de outra conta como se fosse caixinha.
        if (item?.id === id && String(item.integration_id) === String(integracao)) porId.set(id, item);
      } catch {
        /* id inexistente na faixa: esperado, a sequência tem furos legítimos */
      }
      if (porId.size >= Number(total)) break;
    }
    log(`[polp] varredura recuperou ${porId.size - itens.length} posição(ões)`);
  }

  if (total !== null && porId.size < Number(total)) {
    throw new Error(
      `a fonte declara ${total} posições e só foi possível reunir ${porId.size}. ` +
      'Gravar agora produziria um saldo menor que o real — abortado.'
    );
  }
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

async function coletarMovimentos(get, posicoes) {
  const movimentos = [];
  for (const p of posicoes) {
    const { itens } = await paginar(get, `/investments/${p.id}/transactions`);
    for (const m of itens) movimentos.push(m);
  }
  return movimentos;
}

// --------------------------------------------------------------- normalização
const STATUS = {
  ACTIVE: 'ativa',
  TOTAL_WITHDRAWAL: 'liquidada',
  PARTIAL_WITHDRAWAL: 'ativa',
  MATURED: 'vencida',
  EXPIRED: 'vencida'
};

function normalizarPosicao(p) {
  const status = STATUS[p.status] ?? 'desconhecida';
  if (status === 'desconhecida') aviso(`status novo na fonte para a posição ${p.id}: "${p.status}" — gravado como 'desconhecida'`);
  const gross = centavos(p.amount);
  const taxes = centavos(p.taxes);
  const balance = centavos(p.balance);
  // A fonte já entrega os três; a identidade é conferida aqui porque o CHECK da
  // 0043 derruba a transação inteira, e uma mensagem de constraint no meio de um
  // lote de 66 não diz qual posição estragou.
  if (balance !== gross - taxes) {
    throw new Error(`posição ${p.id}: balance ${balance} ≠ amount ${gross} − taxes ${taxes}`);
  }
  return {
    externalId: String(p.id),
    name: p.name ?? `${p.subtype ?? 'CDB'} ${p.id}`,
    productType: p.type ?? 'FIXED_INCOME',
    productSubtype: p.subtype ?? 'CDB',
    issuer: p.issuer ?? null,
    status,
    issueDate: dia(p.issue_date),
    graceDate: dia(p.grace_period_date),
    dueDate: dia(p.due_date),
    rateType: p.rate_type ?? null,
    ratePercent: p.rate ?? null,
    principal: centavos(p.amount_original),
    gross,
    taxes,
    balance,
    quotedOn: dia(p.date) ?? hoje()
  };
}

function normalizarMovimento(m) {
  return {
    externalId: String(m.id),
    investimento: String(m.investment_id),
    direction: m.type === 'BUY' ? 'aplicacao' : 'resgate',
    tradeDate: dia(m.trade_date ?? m.date),
    // net_amount é o líquido de despesas da operação — o que de fato andou.
    amount: centavos(m.net_amount ?? m.amount),
    quantity: m.quantity ?? null
  };
}

// ------------------------------------------------------------------ principal
const pool = financePool();
let saida = 0;

try {
  const { rows: [entidade] } = await pool.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY_SLUG]);
  if (!entidade) throw new Error(`entidade "${ENTITY_SLUG}" não encontrada`);
  const entityId = entidade.id;

  const { rows: contas } = await pool.query(
    `SELECT id, slug, kind, opening_balance_cents, opening_balance_date, current_balance_cents
       FROM fin_account WHERE entity_id = $1 AND slug = ANY($2)`,
    [entityId, [CONTA_SLUG, CONTA_CORRENTE_SLUG]]
  );
  const conta = contas.find((c) => c.slug === CONTA_SLUG);
  const corrente = contas.find((c) => c.slug === CONTA_CORRENTE_SLUG);
  if (!conta) throw new Error(`conta "${CONTA_SLUG}" não encontrada`);
  if (!corrente) throw new Error(`conta corrente "${CONTA_CORRENTE_SLUG}" não encontrada`);
  if (!conta.opening_balance_date) throw new Error(`"${CONTA_SLUG}" sem opening_balance_date: sem âncora, nada reconcilia`);

  const { rows: [{ existe: temSchema }] } = await pool.query(
    `SELECT to_regclass('public.fin_investment') IS NOT NULL AS existe`
  );
  if (!temSchema) {
    aviso('as tabelas da migration 0043 ainda não existem. O dry-run mede tudo; --aplicar exige a migration aplicada.');
    if (APLICAR) throw new Error('rode a migration 0043 antes de --aplicar');
  }

  // ---------------------------------------------------------------- 1. fonte
  let cru;
  if (CACHE) {
    cru = JSON.parse(await readFile(CACHE, 'utf8'));
    log(`[polp] cache: ${cru.posicoes.length} posição(ões), ${cru.movimentos.length} movimento(s)`);
  } else {
    const cred = await credenciaisPolp();
    const get = clientePolp(cred);
    const posicoes = await coletarPosicoes(get, cred.integracao);
    const movimentos = await coletarMovimentos(get, posicoes);
    cru = { lidoEm: new Date().toISOString(), integracao: cred.integracao, posicoes, movimentos };
    log(`[polp] ${posicoes.length} posição(ões), ${movimentos.length} movimento(s)`);
  }
  if (DUMP) await writeFile(DUMP, JSON.stringify(cru, null, 1));

  const posicoes = cru.posicoes.map(normalizarPosicao);
  const movimentos = cru.movimentos.map(normalizarMovimento);

  const alvoCents = posicoes.reduce((s, p) => s + p.balance, 0);
  const fluxoLiquido = movimentos.reduce((s, m) => s + (m.direction === 'aplicacao' ? m.amount : -m.amount), 0);
  // Tudo que está no saldo e nunca passou por caixa nenhum: é o rendimento
  // apropriado dentro das aplicações. Vira o TETO do ajuste lá embaixo.
  const rendimentoNaoRealizado = alvoCents - fluxoLiquido;
  const ativas = posicoes.filter((p) => p.status === 'ativa');

  log('');
  log('CARTEIRA (fonte: API do Polp)');
  log(`  posições ................. ${posicoes.length} (${ativas.length} ativas)`);
  log(`  saldo real ............... ${brl(alvoCents)}`);
  log(`  principal ................ ${brl(posicoes.reduce((s, p) => s + p.principal, 0))}`);
  log(`  IR/IOF provisionado ...... ${brl(posicoes.reduce((s, p) => s + p.taxes, 0))}`);
  log(`  rendimento não realizado . ${brl(rendimentoNaoRealizado)}`);
  log(`  saldo exibido hoje ....... ${brl(conta.current_balance_cents)}`);
  log(`  ERRO ATUAL ............... ${brl(conta.current_balance_cents - alvoCents)}`);
  relatorio.etapas.push({
    etapa: 'carteira', posicoes: posicoes.length, ativas: ativas.length,
    saldo_real_cents: alvoCents, saldo_exibido_cents: conta.current_balance_cents,
    erro_cents: conta.current_balance_cents - alvoCents, rendimento_nao_realizado_cents: rendimentoNaoRealizado
  });

  // ------------------------------------------------- 2. conciliação dia a dia
  // O fluxo de RDB da conta corrente é a contraprova externa: cada aplicação e
  // cada resgate aparece lá com o rótulo do próprio banco. Se os dois lados
  // batem dia a dia, o saldo da caixinha não é uma afirmação nova — é a
  // consequência de dois extratos que já concordam.
  const { rows: pernasCorrente } = await pool.query(
    `SELECT id, posted_on, amount_cents, transfer_status, transfer_group_id, category_id, description_raw
       FROM fin_transaction
      WHERE account_id = $1 AND NOT is_split_parent
        AND description_norm ~ '^(aplicacao|resgate) rdb'
      ORDER BY posted_on, id`,
    [corrente.id]
  );

  const porDia = new Map();
  const pega = (d) => {
    if (!porDia.has(d)) porDia.set(d, { ledgerAplic: 0, ledgerResg: 0, polpAplic: 0, polpResg: 0 });
    return porDia.get(d);
  };
  for (const t of pernasCorrente) {
    const c = pega(dia(t.posted_on));
    if (t.amount_cents < 0) c.ledgerAplic += -t.amount_cents; else c.ledgerResg += t.amount_cents;
  }
  for (const m of movimentos) {
    const c = pega(m.tradeDate);
    if (m.direction === 'aplicacao') c.polpAplic += m.amount; else c.polpResg += m.amount;
  }

  const abertura = dia(conta.opening_balance_date);
  const dentro = [];
  const fora = [];
  for (const [d, c] of [...porDia].sort()) {
    const dAplic = c.ledgerAplic - c.polpAplic;
    const dResg = c.ledgerResg - c.polpResg;
    if (dAplic === 0 && dResg === 0) continue;
    (d > abertura ? dentro : fora).push({ dia: d, aplicacao_cents: dAplic, resgate_cents: dResg });
  }

  log('');
  log(`CONCILIAÇÃO ledger × Polp — ${porDia.size} dia(s) com movimento`);
  log(`  janela coberta (após ${abertura}) .. ${dentro.length ? `${dentro.length} DIVERGENTE(S)` : 'todos batem ao centavo'}`);
  for (const d of dentro) log(`      ${d.dia}  aplicação ${brl(d.aplicacao_cents)}  resgate ${brl(d.resgate_cents)}`);
  log(`  anterior à abertura ............... ${fora.length} dia(s) fora da janela`);
  for (const d of fora) {
    log(`      ${d.dia}  aplicação ${brl(d.aplicacao_cents)}  resgate ${brl(d.resgate_cents)}  (dentro do saldo de abertura)`);
  }
  relatorio.etapas.push({ etapa: 'conciliacao', dias: porDia.size, divergentes_na_janela: dentro, fora_da_janela: fora });

  if (dentro.length) {
    throw new Error(
      `${dentro.length} dia(s) de RDB não batem entre o extrato da conta corrente e a API do Polp dentro da ` +
      'janela coberta. Gravar agora faria o ajuste de marcação absorver a diferença e o saldo fecharia por ' +
      'construção, não por verdade. Investigue os dias acima antes de insistir.'
    );
  }

  // --------------------------------------------- 3. o que falta espelhar
  // Só linha da conta corrente que (a) é posterior à abertura da caixinha — o
  // que veio antes já está DENTRO do saldo de abertura e espelhar de novo
  // contaria duas vezes — e (b) ainda não tem par.
  const aEspelhar = pernasCorrente.filter((t) => dia(t.posted_on) > abertura && !t.transfer_group_id);
  const jaPareadas = pernasCorrente.filter((t) => t.transfer_group_id).length;
  const anteriores = pernasCorrente.filter((t) => dia(t.posted_on) <= abertura).length;
  const deltaEspelho = aEspelhar.reduce((s, t) => s + -t.amount_cents, 0);
  const semCategoria = aEspelhar.filter((t) => !t.category_id);

  // O dia da leitura, e a identidade do lançamento de marcação daquele dia.
  const lidoEm = posicoes.reduce((max, p) => (p.quotedOn > max ? p.quotedOn : max), abertura);
  const marcacaoSourceId = `marcacao:${lidoEm}`;

  // A soma do ledger EXCLUI a marcação do próprio dia, de propósito.
  //
  // Sem essa exclusão o ajuste vira incremental sobre si mesmo: rodar duas
  // vezes no mesmo dia, com o saldo da fonte tendo mudado no meio, calcularia
  // o delta contra um ledger que já contém o ajuste anterior e o UPSERT o
  // SUBSTITUIRIA pelo delta — perdendo a parte antiga. Excluindo, o valor
  // gravado é sempre o ajuste ABSOLUTO daquele dia, e reexecutar converge.
  const { rows: [ledgerAtual] } = await pool.query(
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) AS soma,
            count(*) AS n, max(posted_on) AS ate
       FROM fin_transaction
      WHERE account_id = $1 AND coalesce(source_id, '') <> $2`,
    [conta.id, marcacaoSourceId]
  );

  const reconstruido = conta.opening_balance_cents + ledgerAtual.soma + deltaEspelho;
  const ajusteCents = alvoCents - reconstruido;

  log('');
  log('ESPELHO NA CAIXINHA');
  log(`  linhas de RDB na corrente ......... ${pernasCorrente.length}`);
  log(`    já pareadas (julho) ............. ${jaPareadas}`);
  log(`    anteriores à abertura ........... ${anteriores}  (dentro do saldo de abertura, não espelhadas)`);
  log(`    A ESPELHAR ...................... ${aEspelhar.length}  líquido ${brl(deltaEspelho)}`);
  log(`      sem categoria na corrente ..... ${semCategoria.length}`);
  log('');
  log('FECHAMENTO DA CONTA');
  log(`  abertura (${abertura}) ......... ${brl(conta.opening_balance_cents)}`);
  log(`  ledger atual (${ledgerAtual.n} linhas, até ${dia(ledgerAtual.ate)}) ... ${brl(ledgerAtual.soma)}`);
  log(`  espelho de agosto ................. ${brl(deltaEspelho)}`);
  log(`  = reconstruído .................... ${brl(reconstruido)}`);
  log(`  saldo real (Polp) ................. ${brl(alvoCents)}`);
  log(`  ⇒ ajuste de marcação .............. ${brl(ajusteCents)}   (teto: ${brl(rendimentoNaoRealizado)})`);

  relatorio.etapas.push({
    etapa: 'fechamento',
    a_espelhar: aEspelhar.length, espelho_liquido_cents: deltaEspelho,
    abertura_cents: conta.opening_balance_cents, ledger_cents: ledgerAtual.soma,
    reconstruido_cents: reconstruido, alvo_cents: alvoCents, ajuste_cents: ajusteCents,
    teto_ajuste_cents: rendimentoNaoRealizado
  });

  // O ajuste é rendimento apropriado dentro da aplicação. Ele NÃO pode ser
  // maior do que o rendimento que a fonte diz existir — se for, o que sobrou
  // não é rendimento, é movimento faltando, e absorver isso num "ajuste" seria
  // exatamente o número redondo que esconde o que ninguém determinou.
  if (Math.abs(ajusteCents) > Math.abs(rendimentoNaoRealizado)) {
    throw new Error(
      `resíduo de ${brl(ajusteCents)} maior que o rendimento não realizado da carteira ` +
      `(${brl(rendimentoNaoRealizado)}). Isso não é marcação — é movimento faltando. Abortado.`
    );
  }

  if (!APLICAR) {
    log('');
    log('[dry-run] nada gravado. Para gravar: --aplicar');
    if (JSON_OUT) console.log(JSON.stringify(relatorio, null, 2));
    process.exit(0);
  }

  // --------------------------------------------------------------- 4. escrita
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    // ÂNCORA. A soma por conta é medida antes e depois, dentro da mesma
    // transação. Este script só pode mexer no saldo da caixinha; se qualquer
    // outra conta mudar de soma, algo saiu do lugar e o COMMIT não acontece.
    const { rows: antes } = await cliente.query(
      `SELECT account_id, coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) soma
         FROM fin_transaction GROUP BY account_id ORDER BY account_id`
    );

    // 4.1 posições
    let posInseridas = 0;
    const idPorExterno = new Map();
    for (const p of posicoes) {
      const { rows: [r] } = await cliente.query(
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
        [entityId, conta.id, p.externalId, p.name, p.productType, p.productSubtype, p.issuer,
         p.status, p.issueDate, p.graceDate, p.dueDate, p.rateType, p.ratePercent,
         p.principal, p.gross, p.taxes, p.balance, p.quotedOn]
      );
      idPorExterno.set(p.externalId, r.id);
      if (r.inserido) posInseridas += 1;
    }

    // 4.2 movimentos
    let movInseridos = 0;
    for (const m of movimentos) {
      const investimentoId = idPorExterno.get(m.investimento);
      if (!investimentoId) throw new Error(`movimento ${m.externalId} aponta para posição ${m.investimento} que não veio na coleta`);
      const { rows: [r] } = await cliente.query(
        `INSERT INTO fin_investment_flow (entity_id, investment_id, provider, external_id, direction, trade_date, amount_cents, quantity)
         VALUES ($1,$2,'polp',$3,$4,$5,$6,$7)
         ON CONFLICT (provider, external_id) DO UPDATE SET
           direction = EXCLUDED.direction, trade_date = EXCLUDED.trade_date,
           amount_cents = EXCLUDED.amount_cents, updated_at = now()
         RETURNING id, (xmax = 0) AS inserido`,
        [entityId, investimentoId, m.externalId, m.direction, m.tradeDate, m.amount, m.quantity]
      );
      if (r.inserido) movInseridos += 1;
    }

    // 4.3 o espelho, com o par nascendo junto
    //
    // `source_kind` APLICACAO/RESGATE é o que a regra 30 lê para carimbar 9.03
    // com transfer:true — a mesma decisão, pela mesma evidência, que classificou
    // as 18 linhas de julho. `source_id` diz de qual linha este espelho é a
    // outra perna, o que torna a reexecução idempotente sem depender de hash
    // por conteúdo.
    const { rows: [regra] } = await cliente.query(
      `SELECT id, name, priority FROM fin_rule WHERE entity_id = $1 AND slug = 'aplicacao-em-caixinha'`, [entityId]
    );
    const { rows: [regraDesc] } = await cliente.query(
      `SELECT id, name, priority FROM fin_rule WHERE entity_id = $1 AND slug = 'rdb-pela-descricao'`, [entityId]
    );
    const { rows: [cat903] } = await cliente.query(
      `SELECT id FROM fin_category WHERE entity_id = $1 AND code = '9.03'`, [entityId]
    );
    const { rows: [cat912] } = await cliente.query(
      `SELECT id FROM fin_category WHERE entity_id = $1 AND code = '9.12'`, [entityId]
    );
    if (!regra || !regraDesc || !cat903 || !cat912) throw new Error('regras/categorias da 0043 ausentes — migration não aplicada?');

    let espelhadas = 0;
    let classificadas = 0;
    for (const perna of aEspelhar) {
      const aplicacao = perna.amount_cents < 0;
      const kind = aplicacao ? 'APLICACAO' : 'RESGATE';
      const texto = aplicacao
        ? 'Aplicação na caixinha (transferência da conta corrente)'
        : 'Resgate da caixinha (transferência para a conta corrente)';
      const sourceId = `espelho:${perna.id}`;

      const { rows: [nova] } = await cliente.query(
        `INSERT INTO fin_transaction (
           entity_id, account_id, posted_on, amount_cents, description_raw, description_norm,
           category_id, source_kind, source, source_id, dedupe_hash,
           classified_by, classified_rule_id, classified_reason, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'polp',$9,$10,'fato_estrutural',$11,$12,'ok')
         ON CONFLICT (account_id, dedupe_version, dedupe_hash) DO UPDATE SET updated_at = now()
         RETURNING id, (xmax = 0) AS inserido`,
        [entityId, conta.id, dia(perna.posted_on), -perna.amount_cents, texto, normalizeDescription(texto),
         cat903.id, kind, sourceId,
         dedupeHash({ accountSlug: CONTA_SLUG, sourceId }),
         regra.id,
         JSON.stringify({ campo: 'source_kind', regra: regra.name, trecho: kind, prioridade: regra.priority, tambem_casaram: [] })]
      );
      if (nova.inserido) espelhadas += 1;

      const grupo = `tg:${Math.min(nova.id, perna.id)}-${Math.max(nova.id, perna.id)}`;
      await cliente.query(
        `UPDATE fin_transaction SET transfer_status = 'pareado', transfer_group_id = $2, updated_at = now()
          WHERE id = ANY($1)`,
        [[nova.id, perna.id], grupo]
      );

      // As 21 linhas que a A1 promoveu do erp-obras chegaram sem categoria
      // porque o `source_kind` delas guarda a origem no ERP ('EXTRATO') e não o
      // tipo de operação. Quem as classifica é a regra nova, pelo rótulo que o
      // próprio Nubank escreveu na descrição.
      if (!perna.category_id) {
        await cliente.query(
          `UPDATE fin_transaction
              SET category_id = $2, classified_by = 'regra', classified_rule_id = $3,
                  classified_reason = $4, classified_at = now(), updated_at = now()
            WHERE id = $1 AND category_id IS NULL`,
          [perna.id, cat903.id, regraDesc.id,
           JSON.stringify({
             campo: 'description_norm', regra: regraDesc.name, prioridade: regraDesc.priority,
             trecho: normalizeDescription(perna.description_raw).slice(0, 12), offset: 0, tambem_casaram: []
           })]
        );
        classificadas += 1;
      }
    }

    // 4.4 ligação flow → perna da corrente, só quando é possível dizer QUAL
    //
    // Casa por (dia, valor, direção) e apenas quando o par é único dos dois
    // lados. Em 11/05 dezessete liquidações viraram um crédito só: ali não
    // existe "qual", e inventar um seria a mesma classe de erro dos pareamentos
    // falsos da A6 — casar por coincidência de valor e data.
    let ligados = 0;
    const chaveDe = (d, cents, direcao) => `${d}|${cents}|${direcao}`;
    const contagemLedger = new Map();
    const idLedger = new Map();
    for (const t of pernasCorrente) {
      const k = chaveDe(dia(t.posted_on), Math.abs(t.amount_cents), t.amount_cents < 0 ? 'aplicacao' : 'resgate');
      contagemLedger.set(k, (contagemLedger.get(k) ?? 0) + 1);
      idLedger.set(k, t.id);
    }
    const contagemPolp = new Map();
    for (const m of movimentos) {
      const k = chaveDe(m.tradeDate, m.amount, m.direction);
      contagemPolp.set(k, (contagemPolp.get(k) ?? 0) + 1);
    }
    for (const m of movimentos) {
      const k = chaveDe(m.tradeDate, m.amount, m.direction);
      if (contagemLedger.get(k) !== 1 || contagemPolp.get(k) !== 1) continue;
      await cliente.query(
        `UPDATE fin_investment_flow SET settlement_transaction_id = $2, updated_at = now()
          WHERE provider = 'polp' AND external_id = $1`,
        [m.externalId, idLedger.get(k)]
      );
      ligados += 1;
    }

    // 4.5 o ajuste de marcação
    let ajusteId = null;
    if (ajusteCents !== 0) {
      const quando = lidoEm;
      const texto = `Ajuste de rendimento acumulado (marcação Polp ${quando})`;
      const sourceId = marcacaoSourceId;
      const { rows: [r] } = await cliente.query(
        `INSERT INTO fin_transaction (
           entity_id, account_id, posted_on, amount_cents, description_raw, description_norm,
           category_id, nucleo, source_kind, source, source_id, dedupe_hash,
           classified_by, classified_rule_id, classified_reason, review_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'corporativo','AJUSTE_RENDIMENTO','polp',$8,$9,'fato_estrutural',$10,$11,'ok',$12)
         ON CONFLICT (account_id, dedupe_version, dedupe_hash) DO UPDATE SET
           amount_cents = EXCLUDED.amount_cents, updated_at = now()
         RETURNING id`,
        [entityId, conta.id, quando, ajusteCents, texto, normalizeDescription(texto),
         cat912.id, sourceId, dedupeHash({ accountSlug: CONTA_SLUG, sourceId }),
         (await cliente.query(`SELECT id FROM fin_rule WHERE entity_id=$1 AND slug='ajuste-de-marcacao'`, [entityId])).rows[0]?.id ?? null,
         JSON.stringify({ campo: 'source_kind', regra: 'Ajuste de marcação de aplicação', trecho: 'AJUSTE_RENDIMENTO', prioridade: 9, tambem_casaram: [] }),
         `Rendimento apropriado dentro das aplicações, que nunca passa pela conta corrente. ` +
         `Medido como saldo da carteira na fonte (${brl(alvoCents)}) menos o reconstruído pelo ` +
         `ledger (${brl(reconstruido)}). Teto declarado: rendimento não realizado da carteira, ${brl(rendimentoNaoRealizado)}.`]
      );
      ajusteId = r.id;
    } else {
      // Ajuste zerado com marcação já gravada hoje: a linha antiga passou a
      // sobrar e deixá-la ali desencaixaria o saldo pelo valor dela.
      // `amount_cents <> 0` é CHECK desde a 0002, então não há "gravar zero".
      await cliente.query(
        `DELETE FROM fin_transaction WHERE account_id = $1 AND source_id = $2`,
        [conta.id, marcacaoSourceId]
      );
    }

    // 4.6 o invariante G1, conferido AQUI e não pelo teste noturno
    const { rows: [{ soma: somaFinal }] } = await cliente.query(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) soma
         FROM fin_transaction WHERE account_id = $1`, [conta.id]
    );
    const { rows: [{ soma: somaPosicoes }] } = await cliente.query(
      `SELECT coalesce(sum(balance_cents), 0) soma FROM fin_investment WHERE account_id = $1`, [conta.id]
    );
    const fechado = conta.opening_balance_cents + Number(somaFinal);
    if (fechado !== Number(somaPosicoes)) {
      throw new Error(
        `o ledger reconstruiria ${brl(fechado)} e a carteira soma ${brl(somaPosicoes)}. ` +
        'Não vou forçar nenhum dos dois — ROLLBACK.'
      );
    }

    await cliente.query(
      `UPDATE fin_account SET current_balance_cents = $2, last_statement_at = $3 WHERE id = $1`,
      [conta.id, Number(somaPosicoes), `${lidoEm}T00:00:00Z`]
    );

    // Cobertura: sem ela o invariante F3 acusa lançamento fora de janela
    // declarada — que é como um lote entrar por caminho não registrado.
    //
    // O início vem do MENOR posted_on que esta fonte já gravou nesta conta, e
    // não do lote de hoje. Usar o lote abriria uma janela nova a cada execução
    // ('api' de 08/16 a 08/16 amanhã), fatiando a cobertura em pedaços que só
    // por sorte não deixam buraco.
    const { rows: [janela] } = await cliente.query(
      `SELECT min(posted_on) AS inicio FROM fin_transaction WHERE account_id = $1 AND source = 'polp'`,
      [conta.id]
    );
    if (janela?.inicio) {
      await cliente.query(
        `INSERT INTO fin_statement_coverage (account_id, period_start, period_end, source)
         VALUES ($1,$2,$3,'api')
         ON CONFLICT (account_id, source, period_start) DO UPDATE SET period_end = EXCLUDED.period_end`,
        [conta.id, dia(janela.inicio), lidoEm]
      );
    }

    // O snapshot é a declaração "neste dia a fonte externa dizia isto".
    // variance = 0 é o que o invariante G2 exige, e aqui ele é verdade medida.
    await cliente.query(
      `INSERT INTO fin_balance_snapshot (account_id, date, balance_cents, source, computed_cents, variance_cents)
       VALUES ($1,$2,$3,'api',$4,$5)
       ON CONFLICT (account_id, date, source) DO UPDATE SET
         balance_cents = EXCLUDED.balance_cents, computed_cents = EXCLUDED.computed_cents,
         variance_cents = EXCLUDED.variance_cents`,
      [conta.id, lidoEm, Number(somaPosicoes), fechado, fechado - Number(somaPosicoes)]
    );

    // ÂNCORA, segunda medição.
    const { rows: depois } = await cliente.query(
      `SELECT account_id, coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) soma
         FROM fin_transaction GROUP BY account_id ORDER BY account_id`
    );
    const mapaAntes = new Map(antes.map((r) => [r.account_id, Number(r.soma)]));
    for (const r of depois) {
      const anterior = mapaAntes.get(r.account_id) ?? 0;
      if (r.account_id === conta.id) continue;
      if (Number(r.soma) !== anterior) {
        throw new Error(`a conta ${r.account_id} mudou de ${brl(anterior)} para ${brl(r.soma)}. ROLLBACK.`);
      }
    }

    await cliente.query('COMMIT');

    log('');
    log('GRAVADO');
    log(`  posições ................. ${posInseridas} nova(s) de ${posicoes.length}`);
    log(`  movimentos ............... ${movInseridos} novo(s) de ${movimentos.length}`);
    log(`  espelhos criados ......... ${espelhadas} (pareados 1:1 com a conta corrente)`);
    log(`  linhas classificadas ..... ${classificadas} na conta corrente`);
    log(`  flows ligados à corrente . ${ligados} de ${movimentos.length}`);
    log(`  ajuste de marcação ....... ${ajusteId ? `${brl(ajusteCents)} (tx ${ajusteId})` : 'nenhum'}`);
    log(`  SALDO ${CONTA_SLUG} ...... ${brl(conta.current_balance_cents)} → ${brl(Number(somaPosicoes))}`);
    relatorio.etapas.push({
      etapa: 'gravado', posicoes_novas: posInseridas, movimentos_novos: movInseridos,
      espelhos: espelhadas, classificadas, flows_ligados: ligados,
      ajuste_cents: ajusteCents, saldo_final_cents: Number(somaPosicoes)
    });
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
} catch (erro) {
  relatorio.erros.push(erro.message);
  if (!JSON_OUT) console.error(`\n[erro] ${erro.message}`);
  saida = 1;
} finally {
  if (JSON_OUT) console.log(JSON.stringify(relatorio, null, 2));
  await pool.end();
  process.exit(saida);
}
