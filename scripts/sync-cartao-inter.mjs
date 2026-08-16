// Registra a linha de crédito do cartão Inter a partir da ÚNICA evidência que
// existe: os pagamentos de fatura na conta corrente do Inter.
//
// ---------------------------------------------------------------------------
// POR QUE ESTE SCRIPT NÃO CHAMA A API DO INTER
// ---------------------------------------------------------------------------
// Porque não há o que chamar. Medido em 16/08/2026, com token válido em mãos:
//
//   /oauth/v2/token  scope=extrato.read                   → 200
//   /oauth/v2/token  scope=cartao.read | cartoes.read
//                    | cartao-corporativo.read
//                    | cartao-credito.read | fatura.read  → 401
//                    "No registered scope value for this client has been requested"
//   /banking/v2/extrato          (com o token de 200)     → 200   rota existe
//   /banking/v2/cartoes                                    → 404   rota NÃO existe
//   /banking/v2/cartao/faturas                             → 404
//   /banking/v2/cartao/lancamentos                         → 404
//   /banking/v2/cartao/transacoes                          → 404
//   /banking/v2/cartao-credito/faturas                     → 404
//   /banking/v1/cartoes · /cartoes/v1/* · /cartao/v1/*     → 404
//   /cartao-corporativo/v1/*  · /banking/v2/faturas        → 404
//
// O par 401/404 é o que dá valor ao teste: o roteador do Inter devolve 404
// ANTES de olhar o token, então rota inexistente e rota sem permissão se
// distinguem. As de cartão são inexistentes.
//
// Rodar `node scripts/sync-cartao-inter.mjs --provar-api` refaz essa medição na
// hora, para quando alguém quiser conferir sem acreditar neste comentário.
//
// ---------------------------------------------------------------------------
// O QUE ELE FAZ, ENTÃO
// ---------------------------------------------------------------------------
// Transforma cada saída "pagamento de fatura" da conta do Inter em uma fatura
// com `bill_source = 'derivada_do_pagamento'`, ligada ao lançamento que a
// originou. Isso registra a OBRIGAÇÃO (o cartão existe e custa dinheiro por
// mês) e registra a AUSÊNCIA (zero itens, lacuna cheia) no mesmo lugar.
//
// O que ele NÃO faz, e cada "não" é deliberado:
//
//   · não cria fin_card_transaction. Não há compra conhecida. Fabricar uma
//     despesa de R$ 40.862,41 para "fechar" a linha inventaria a DRE inteira do
//     cartão. A lacuna fica visível em unitemized_amount_cents.
//   · não escreve em fin_transaction. Os 9 lançamentos ficam como estão. A 0047
//     §5 já explicou por quê: promovê-los a 'pareado' os tiraria do índice do
//     ledger e a saída real sumiria do caixa.
//   · não inventa vencimento. `due_date` recebe a data do PAGAMENTO, e
//     `bill_source` diz que foi assim que ela nasceu. Vencimento de verdade a
//     fonte não dá.
//   · não decide de quem é o cartão. O descritor diz "Pagamento Fatura -
//     FERNANDO DE SIQUEIRA CAMPOS SILVA"; a linha fica com
//     ownership = 'indeterminado' até alguém dizer. Ver o aviso no fim da saída.
//
// Uso:
//   node scripts/sync-cartao-inter.mjs --dry-run     mede e não grava (padrão)
//   node scripts/sync-cartao-inter.mjs --aplicar     grava
//   node scripts/sync-cartao-inter.mjs --provar-api  refaz a sonda da API
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const PROVAR = process.argv.includes('--provar-api');
const CONTA_SLUG = 'inter-cartao';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// A sonda, sob demanda
// ---------------------------------------------------------------------------
// Fica atrás de uma flag porque bate no rate limit do /oauth/v2/token (medido:
// o 5º pedido de token em menos de um minuto volta 429) e porque o resultado
// não muda de um dia para o outro. Mas existe: uma afirmação sobre a API que
// não pode ser reconferida é uma afirmação que envelhece escondida.
const ROTAS_DE_CARTAO = [
  '/banking/v2/cartoes',
  '/banking/v2/cartao',
  '/banking/v2/cartao/faturas',
  '/banking/v2/cartao/lancamentos',
  '/banking/v2/cartao/transacoes',
  '/banking/v2/cartao-credito/faturas',
  '/banking/v1/cartoes',
  '/cartoes/v1/cartoes',
  '/cartao/v1/faturas',
  '/cartao-corporativo/v1/faturas',
  '/banking/v2/faturas'
];
const ESCOPOS_DE_CARTAO = [
  'cartao.read',
  'cartoes.read',
  'cartao-corporativo.read',
  'cartao-credito.read',
  'fatura.read'
];

/**
 * Sonda dedicada, com cliente próprio.
 *
 * Não usa `createInterClient` porque ele só expõe extrato e saldo — de
 * propósito, para que nenhum caminho do sync mande path arbitrário. Aqui path
 * arbitrário é justamente o ponto, e o método é fixo em GET.
 *
 * Nada abaixo imprime credencial, token ou corpo de requisição.
 */
async function provarApi() {
  const { existsSync, readdirSync, readFileSync } = await import('node:fs');
  const { request } = await import('node:https');
  const { resolve } = await import('node:path');

  const HOST = 'cdpj.partners.bancointer.com.br';
  const lerCredencial = (varB64, varPath, ext, rotulo) => {
    const b64 = process.env[varB64];
    if (b64) return Buffer.from(b64, 'base64').toString('utf8');
    const explicito = process.env[varPath];
    if (explicito) return readFileSync(resolve(explicito), 'utf8');
    const dir = resolve('secrets');
    const achados = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext)) : [];
    if (achados.length === 1) return readFileSync(resolve(dir, achados[0]), 'utf8');
    throw new Error(`${rotulo} não resolvido (${achados.length} candidatos em secrets/)`);
  };
  const cert = lerCredencial('INTER_CERT_B64', 'INTER_CERT_PATH', '.crt', 'certificado');
  const key = lerCredencial('INTER_KEY_B64', 'INTER_KEY_PATH', '.key', 'chave privada');

  const pedir = ({ path, method, headers = {}, body }) =>
    new Promise((ok, falha) => {
      const req = request({ host: HOST, path, method, headers, cert, key, timeout: 45_000 }, (res) => {
        let dados = '';
        res.on('data', (c) => (dados += c));
        res.on('end', () => ok({ status: res.statusCode, body: dados }));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', falha);
      if (body) req.write(body);
      req.end();
    });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  const pedirToken = async (scope) => {
    const corpo = new URLSearchParams({
      client_id: process.env.INTER_CLIENT_ID,
      client_secret: process.env.INTER_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope
    }).toString();
    const r = await pedir({
      path: '/oauth/v2/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) },
      body: corpo
    });
    // A mensagem nunca ecoa o corpo enviado: ali vai o client_secret.
    if (r.status !== 200) return { status: r.status, erro: r.body.replace(/\s+/g, ' ').slice(0, 120) };
    return { status: 200, token: JSON.parse(r.body).access_token };
  };

  console.log('\n── sonda da API do Inter (somente GET) ──────────────────');
  console.log('   escopos: um token por escopo, 20s entre pedidos');
  console.log('   (o 5º pedido de token em menos de um minuto volta 429)\n');

  for (const escopo of ESCOPOS_DE_CARTAO) {
    const r = await pedirToken(escopo);
    console.log(`  ${String(r.status).padEnd(4)} escopo ${escopo.padEnd(26)} ${r.status === 200 ? 'ACEITO' : r.erro}`);
    await espera(20_000);
  }

  // O controle. Sem ele os 404 abaixo não provam nada: poderiam ser credencial
  // ruim, mTLS quebrado ou host errado.
  const t = await pedirToken('extrato.read');
  if (t.status !== 200) {
    console.log(`\n  ${t.status} escopo extrato.read falhou: ${t.erro}`);
    console.log('  Sem o controle verde a sonda não conclui nada. Pare aqui.\n');
    return;
  }
  console.log('\n  200  escopo extrato.read                     ACEITO (controle)');

  const hoje = new Date().toISOString().slice(0, 10);
  const semana = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const auth = { Authorization: `Bearer ${t.token}`, Accept: 'application/json' };

  const ctrl = await pedir({
    path: `/banking/v2/extrato?dataInicio=${semana}&dataFim=${hoje}`,
    method: 'GET',
    headers: auth
  });
  // Só o tamanho da resposta: o conteúdo é extrato bancário.
  console.log(`  ${ctrl.status}  /banking/v2/extrato${' '.repeat(24)}${ctrl.status === 200 ? `[${ctrl.body.length} bytes] rota existe` : 'controle falhou'}`);
  await espera(7000);

  for (const rota of ROTAS_DE_CARTAO) {
    const r = await pedir({ path: rota, method: 'GET', headers: auth });
    const veredito =
      r.status === 404 ? 'rota NÃO existe' : r.status === 403 ? 'rota existe, sem permissão' : r.body.replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  ${r.status}  ${rota.padEnd(42)}${veredito}`);
    await espera(7000);
  }

  console.log('\n  → 404 com token válido é ausência de rota, não falta de escopo.');
  console.log('    A API do Inter não expõe cartão. A linha existe só pelo extrato.\n');
}

if (PROVAR) {
  await provarApi();
  // Provar a API é um ato completo por si só, e é o que alguém roda para
  // conferir a afirmação "o Inter não tem cartão" sem precisar do banco. Só
  // segue para a parte que lê o ledger se isso tiver sido pedido.
  if (!APLICAR && !process.argv.includes('--dry-run')) process.exit(0);
}

// ---------------------------------------------------------------------------
// A evidência: os pagamentos de fatura na conta do Inter
// ---------------------------------------------------------------------------
// O critério é textual e estreito. Ele é a mesma regra da view
// fin_card_pagamento_orfao_v, e as duas precisam continuar iguais: se
// divergirem, o detector passa a acusar como órfão o que este script acabou de
// registrar.
const PADRAO = '(pagamento de fatura|pagamento fatura|fatura cartao|fatura do cartao|pagamento de cartao|pagto fatura)';
const RUIDO = '(taxa de (cartao|boleto|pix)|taxa do pix)';

const pool = financePool();
const client = await pool.connect();

/**
 * Sem a 0074 este script explode com "column does not exist" e um stack trace
 * de 30 linhas, que não diz o que fazer. Custa seis linhas transformar isso em
 * uma instrução.
 */
async function exigeMigration0074() {
  const { rows } = await client.query(
    `SELECT to_regclass('fin_card_issuer') IS NOT NULL AS tem
       FROM (SELECT 1) x`
  );
  if (!rows[0].tem) {
    throw new Error(
      'a migration 0074_fin_cartao_emissor.sql não está aplicada — rode `npm run db:migrate` antes'
    );
  }
}

try {
  await exigeMigration0074();
  const { rows: contaRows } = await client.query(
    `SELECT ca.id, ca.entity_id, ca.slug, ca.settlement_account_id, ca.itemization_level,
            ca.ownership, ca.holder_name_raw, a.slug AS conta_slug
       FROM fin_card_account ca
       JOIN fin_account a ON a.id = ca.settlement_account_id
      WHERE ca.slug = $1`,
    [CONTA_SLUG]
  );
  if (!contaRows.length) {
    throw new Error(`linha de crédito '${CONTA_SLUG}' não existe — aplique a migration 0074 antes`);
  }
  const linha = contaRows[0];

  if (linha.itemization_level !== 'somente_pagamento') {
    // Se um dia a fonte passar a itemizar, este script vira o caminho errado:
    // ele criaria faturas derivadas por cima das faturas de verdade.
    throw new Error(
      `'${CONTA_SLUG}' está com itemization_level='${linha.itemization_level}'. ` +
        'Este script só serve para linha somente_pagamento — havendo fonte melhor, use o sync dela.'
    );
  }

  const { rows: pagamentos } = await client.query(
    `SELECT t.id, t.posted_on, t.amount_cents, t.description_raw, t.category_id, t.transfer_status
       FROM fin_transaction t
      WHERE t.account_id = $1
        AND t.amount_cents < 0
        AND t.description_norm ~ $2
        AND t.description_norm !~ $3
      ORDER BY t.posted_on, t.id`,
    [linha.settlement_account_id, PADRAO, RUIDO]
  );

  console.log('\n── cartão Inter: evidência no extrato ───────────────────');
  console.log(`  conta de liquidação: ${linha.conta_slug}`);
  console.log(`  ${pagamentos.length} pagamento(s) de fatura, ${brl(pagamentos.reduce((s, p) => s + Math.abs(Number(p.amount_cents)), 0))}\n`);
  for (const p of pagamentos) {
    console.log(
      `   ${String(p.posted_on).slice(0, 10)}  ${brl(Math.abs(Number(p.amount_cents))).padStart(13)}  ` +
        `${p.description_raw.slice(0, 62)}`
    );
  }

  // Mais de um pagamento no mesmo mês: não dá para saber se são duas faturas ou
  // uma fatura paga em duas vezes. Isso vira lacuna declarada, não um palpite.
  const porMes = new Map();
  for (const p of pagamentos) {
    const m = String(p.posted_on).slice(0, 7);
    porMes.set(m, (porMes.get(m) ?? 0) + 1);
  }
  const mesesDuplos = [...porMes.entries()].filter(([, n]) => n > 1);

  console.log('');
  console.log('── o que será gravado ───────────────────────────────────');
  console.log(`  ${pagamentos.length} fatura(s) com bill_source='derivada_do_pagamento'`);
  console.log(`  0 item(ns) — a fonte não tem nenhum, e nenhum será inventado`);
  console.log(`  lacuna declarada: ${brl(pagamentos.reduce((s, p) => s + Math.abs(Number(p.amount_cents)), 0))} sem itemização`);
  if (mesesDuplos.length) {
    console.log(
      `  ATENÇÃO ${mesesDuplos.length} mês(es) com mais de um pagamento ` +
        `(${mesesDuplos.map(([m, n]) => `${m}×${n}`).join(', ')}) — ` +
        'fronteira de fatura incerta, entra em fin_card_lacuna_v'
    );
  }

  if (!APLICAR) {
    console.log('\n[inter-cartao] --dry-run (padrão): nada gravado. Use --aplicar para gravar.\n');
    process.exit(0);
  }

  await client.query('BEGIN');
  await client.query("SELECT set_config('fin.sync_mode', 'on', true)");

  let inseridas = 0;
  let atualizadas = 0;
  for (const p of pagamentos) {
    const valor = Math.abs(Number(p.amount_cents));
    const dia = String(p.posted_on).slice(0, 10);
    const r = await client.query(
      `INSERT INTO fin_card_bill (
         card_account_id, external_source, external_id,
         due_date, reference_month, total_amount_cents,
         itemized_amount_cents, paid_amount_cents, paid_on,
         paid_transaction_id, match_method, match_confidence,
         status, bill_source, unreconciled_reason, synced_at)
       VALUES ($1, 'ledger', $2,
               $3::date, date_trunc('month', $3::date)::date, $4,
               0, $4, $3::date,
               $5, 'importado', 100,
               'paga', 'derivada_do_pagamento', $6, now())
       ON CONFLICT (external_source, external_id) DO UPDATE SET
         due_date            = EXCLUDED.due_date,
         reference_month     = EXCLUDED.reference_month,
         total_amount_cents  = EXCLUDED.total_amount_cents,
         paid_amount_cents   = EXCLUDED.paid_amount_cents,
         paid_on             = EXCLUDED.paid_on,
         paid_transaction_id = EXCLUDED.paid_transaction_id,
         unreconciled_reason = EXCLUDED.unreconciled_reason,
         synced_at           = now()
       RETURNING (xmax = 0) AS inserida`,
      [
        linha.id,
        // O id do lançamento é a chave de idempotência: uma fatura derivada por
        // pagamento, para sempre, mesmo que o valor ou a data mudem depois.
        `fin_transaction:${p.id}`,
        dia,
        valor,
        p.id,
        'Fatura nunca vista: a API do Inter não expõe cartão. total_amount_cents é IGUAL ao pago por construção — o valor real da fatura é desconhecido.'
      ]
    );
    if (r.rows[0]?.inserida) inseridas += 1;
    else atualizadas += 1;
  }

  // Marca a linha como "olhada hoje" sem fingir que há saldo sincronizado: os
  // limites continuam zerados porque continuam desconhecidos.
  await client.query(
    `UPDATE fin_card_account
        SET first_seen_on = (SELECT min(paid_on) FROM fin_card_bill WHERE card_account_id = $1),
            last_seen_on  = (SELECT max(paid_on) FROM fin_card_bill WHERE card_account_id = $1)
      WHERE id = $1`,
    [linha.id]
  );

  await client.query('COMMIT');

  const { rows: conf } = await client.query(
    `SELECT count(*) n, sum(total_amount_cents) total, sum(unitemized_amount_cents) lacuna,
            count(*) FILTER (WHERE paid_transaction_id IS NULL) sem_lastro
       FROM fin_card_bill WHERE card_account_id = $1`,
    [linha.id]
  );

  console.log('');
  console.log(`[inter-cartao] ${inseridas} fatura(s) inserida(s), ${atualizadas} atualizada(s)`);
  console.log(`[inter-cartao] conferência: ${conf[0].n} fatura(s), ${brl(conf[0].total)} declarado, ${brl(conf[0].lacuna)} sem itemização, ${conf[0].sem_lastro} sem lastro`);
  if (Number(conf[0].sem_lastro) > 0) {
    console.warn('[inter-cartao] AVISO fatura derivada sem lançamento — não deveria acontecer, a constraint impede');
  }
  console.log('');
  console.log('[inter-cartao] PENDENTE DE DECISÃO HUMANA:');
  console.log(`   a linha está com ownership='${linha.ownership}' e titular declarado pela fonte`);
  console.log(`   "${linha.holder_name_raw}". Enquanto isso não for resolvido, os ${pagamentos.length}`);
  console.log('   pagamentos não têm categoria certa: 9.01 (transferência entre contas próprias,');
  console.log('   se o cartão é da empresa) ou 9.05 (retirada de sócio, se é pessoal). A escolha');
  console.log('   muda o resultado da empresa e por isso não é feita aqui.');
  console.log('');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
