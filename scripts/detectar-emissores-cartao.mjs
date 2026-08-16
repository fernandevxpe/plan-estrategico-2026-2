// Varre TODAS as contas atrás de cartão de crédito que ninguém cadastrou.
//
// A pergunta que ele responde é estreita e vale a pena ser estreita: "existe
// alguma saída de caixa pagando fatura de cartão que não tem emissor modelado?"
// Se existe, há um cartão inteiro fora da base — com faturas, compras e dívida
// que não aparecem em lugar nenhum.
//
// SOMENTE LEITURA. Não escreve nada, em banco nenhum.
//
// O detector é textual porque não há alternativa: nenhuma das fontes marca
// "isto é pagamento de fatura de cartão" em campo estruturado. O Nubank escreve
// "Pagamento de fatura", o Inter escreve "Fatura cartão Inter" numa vez e
// "Pagamento Fatura - <NOME>" nas outras oito. Um enum salvaria trabalho, mas
// não existe.
//
// O filtro negativo carrega o mesmo peso que o positivo. Sem ele, as ~2.900
// linhas "Taxa de cartão - fatura nr. NNN" do Asaas entram — e elas são tarifa
// de RECEBIMENTO por cartão, o gateway cobrando da gente, nada a ver com cartão
// de crédito nosso. Foram medidas: 2.892 INVOICE_FEE + 3.015 PAYMENT_FEE.
//
// Uso:
//   node scripts/detectar-emissores-cartao.mjs
//   node scripts/detectar-emissores-cartao.mjs --detalhe   lista lançamento a lançamento
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DETALHE = process.argv.includes('--detalhe');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Precisa ser idêntico ao de fin_card_pagamento_orfao_v (migration 0074 §11).
// Se os dois divergirem, o script acusa o que a view absolve, ou pior.
const PADRAO = '(pagamento de fatura|pagamento fatura|fatura cartao|fatura do cartao|pagamento de cartao|pagto fatura|recarga do cartao|saldo do cartao)';
const RUIDO = '(taxa de (cartao|boleto|pix)|taxa do pix)';

const pool = financePool();
const client = await pool.connect();

try {
  // Sem a 0074 o erro seria "relation fin_card_issuer does not exist" com stack
  // trace. Uma linha de instrução vale mais.
  const { rows: temSchema } = await client.query(
    `SELECT to_regclass('fin_card_issuer') IS NOT NULL AS tem FROM (SELECT 1) x`
  );
  if (!temSchema[0].tem) {
    throw new Error('a migration 0074_fin_cartao_emissor.sql não está aplicada — rode `npm run db:migrate` antes');
  }

  // ── 1. o que já está modelado ──
  const { rows: modelados } = await client.query(
    `SELECT i.slug AS emissor, i.name, ca.slug AS linha, ca.nature, ca.itemization_level,
            ca.is_active, a.slug AS conta_liquidacao,
            (SELECT count(*) FROM fin_card_bill b WHERE b.card_account_id = ca.id) AS faturas,
            (SELECT count(*) FROM fin_card c WHERE c.card_account_id = ca.id) AS cartoes
       FROM fin_card_account ca
       LEFT JOIN fin_card_issuer i ON i.id = ca.issuer_id
       LEFT JOIN fin_account a ON a.id = ca.settlement_account_id
      ORDER BY i.slug NULLS FIRST, ca.slug`
  );

  console.log('\n── emissores modelados ──────────────────────────────────');
  if (!modelados.length) console.log('  (nenhum)');
  for (const m of modelados) {
    console.log(
      `  ${(m.emissor ?? 'SEM EMISSOR').padEnd(10)} ${m.linha.padEnd(22)} ${m.nature.padEnd(9)} ` +
        `${m.itemization_level.padEnd(18)} liquida em ${(m.conta_liquidacao ?? '?').padEnd(8)} ` +
        `${m.faturas} fatura(s) · ${m.cartoes} cartão(ões)${m.is_active ? '' : '  [inativa]'}`
    );
  }

  // ── 2. toda saída com cara de pagamento de fatura, esteja amarrada ou não ──
  const { rows: candidatos } = await client.query(
    `SELECT a.slug AS conta, a.id AS account_id,
            t.id, t.posted_on, t.amount_cents, t.description_raw, t.description_norm,
            cat.code AS categoria, t.transfer_status,
            b.id AS bill_id, ca.slug AS linha, i.slug AS emissor
       FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id
       LEFT JOIN fin_category cat ON cat.id = t.category_id
       LEFT JOIN fin_card_bill b ON b.paid_transaction_id = t.id
       LEFT JOIN fin_card_account ca ON ca.id = b.card_account_id
       LEFT JOIN fin_card_issuer i ON i.id = ca.issuer_id
      WHERE t.amount_cents < 0
        AND t.description_norm ~ $1
        AND t.description_norm !~ $2
      ORDER BY a.slug, t.posted_on, t.id`,
    [PADRAO, RUIDO]
  );

  // Agrupa por conta + descrição canônica, que é o mais perto de "um cartão"
  // que o texto permite chegar.
  const grupos = new Map();
  for (const c of candidatos) {
    // Colapsa o nome próprio no fim do descritor do Inter: "Pagamento Fatura -
    // FULANO" e "Pagamento Fatura - SICRANO" são o mesmo tipo de evento, e
    // separá-los produziria um "emissor" por pessoa.
    const canonica = c.description_norm
      .replace(/^pagamento efetuado /, '')
      .replace(/(pagamento fatura) .*/, '$1 <nome>')
      .slice(0, 60);
    const chave = `${c.conta}|${canonica}`;
    const g = grupos.get(chave) ?? {
      conta: c.conta,
      canonica,
      n: 0,
      total: 0,
      amarrados: 0,
      emissores: new Set(),
      de: null,
      ate: null,
      exemplos: []
    };
    g.n += 1;
    g.total += Math.abs(Number(c.amount_cents));
    if (c.bill_id) g.amarrados += 1;
    if (c.emissor) g.emissores.add(c.emissor);
    const d = String(c.posted_on).slice(0, 10);
    g.de = g.de && g.de < d ? g.de : d;
    g.ate = g.ate && g.ate > d ? g.ate : d;
    g.exemplos.push(c);
    grupos.set(chave, g);
  }

  console.log('\n── pagamentos de fatura encontrados no ledger ───────────');
  console.log(`  ${candidatos.length} lançamento(s) em ${grupos.size} padrão(ões) de descrição\n`);
  console.log(`  ${'conta'.padEnd(9)}${'padrão'.padEnd(46)}${'n'.padStart(4)}${'valor'.padStart(15)}  ${'período'.padEnd(24)}situação`);

  const orfaos = [];
  for (const g of [...grupos.values()].sort((a, b) => b.total - a.total)) {
    const situacao =
      g.amarrados === g.n
        ? `conciliado (${[...g.emissores].join(',') || '?'})`
        : g.amarrados === 0
          ? 'SEM FATURA AMARRADA'
          : `parcial ${g.amarrados}/${g.n}`;
    console.log(
      `  ${g.conta.padEnd(9)}${g.canonica.padEnd(46)}${String(g.n).padStart(4)}${brl(g.total).padStart(15)}  ` +
        `${`${g.de} → ${g.ate}`.padEnd(24)}${situacao}`
    );
    if (g.amarrados < g.n) orfaos.push(g);
  }

  // ── 3. o veredito ──
  //
  // "Órfão" não é sinônimo de "emissor novo", e a diferença é o que separa um
  // alarme útil de um alarme que se aprende a ignorar. A classificação vem da
  // própria view — `fin_card_pagamento_orfao_v.situacao` — e não é recalculada
  // aqui de propósito: `validar-cartoes.mjs` lê a mesma coluna, e duas cópias
  // da mesma regra em JavaScript divergiriam no primeiro ajuste. Foi assim que
  // a primeira versão deste script mandou rodar o sync do Inter para resolver
  // uma recarga de cartão pré-pago do Asaas, que nunca vai ter fatura.
  console.log('\n── veredito ─────────────────────────────────────────────');
  const { rows: situacoes } = await client.query(
    `SELECT conta, situacao, linha_slug, count(*) n, COALESCE(sum(amount_cents), 0) valor,
            min(description_raw) exemplo
       FROM fin_card_pagamento_orfao_v
      GROUP BY 1,2,3 ORDER BY abs(sum(amount_cents)) DESC`
  );
  if (!situacoes.length) {
    console.log('  Nenhum pagamento de fatura sem emissor modelado e sem fatura amarrada.');
  }

  let emissorNovo = 0;
  for (const s of situacoes) {
    const cabeca = `conta ${s.conta}: ${s.n} pagamento(s), ${brl(Math.abs(Number(s.valor)))}`;
    switch (s.situacao) {
      case 'emissor_nao_modelado':
        emissorNovo += 1;
        console.log(
          `  EMISSOR NÃO MODELADO  ${cabeca}\n` +
            `                        "${s.exemplo.slice(0, 70)}"\n` +
            '                        nenhuma linha de crédito liquida nesta conta.'
        );
        break;
      case 'linha_sem_sync':
        console.log(
          `  SYNC PENDENTE         ${cabeca} — linha '${s.linha_slug}' existe e é somente_pagamento.\n` +
            '                        rode: node scripts/sync-cartao-inter.mjs --aplicar'
        );
        break;
      case 'recarga_pre_pago':
        console.log(
          `  NORMAL                ${cabeca} — recarga do pré-pago '${s.linha_slug}'.\n` +
            '                        Cartão pré-pago não emite fatura: isto nunca vai ser amarrado, e está certo.'
        );
        break;
      default:
        console.log(`  CONCILIAÇÃO PENDENTE  ${cabeca} — linha '${s.linha_slug}' existe, fatura não amarrada.`);
    }
  }

  if (DETALHE) {
    console.log('\n── detalhe ──────────────────────────────────────────────');
    for (const c of candidatos) {
      console.log(
        `  ${String(c.posted_on).slice(0, 10)} ${c.conta.padEnd(9)}${brl(Math.abs(Number(c.amount_cents))).padStart(13)} ` +
          `${(c.categoria ?? '—').padEnd(6)}${(c.bill_id ? `fatura ${c.bill_id}` : 'sem fatura').padEnd(14)}` +
          c.description_raw.slice(0, 60)
      );
    }
  }

  console.log('');
  process.exitCode = emissorNovo > 0 ? 1 : 0;
  if (emissorNovo > 0) {
    console.log(`${emissorNovo} emissor(es) sem modelagem. Saindo com código 1 para o CI pegar.\n`);
  }
} finally {
  client.release();
  await pool.end();
}
