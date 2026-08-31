// Fecha o ciclo: a ordem que você aprovou no app do Inter virou dinheiro que
// saiu? Este script responde com PROVA — a linha do extrato.
//
//   npm run conciliar:pagamentos            mostra o que casaria
//   npm run conciliar:pagamentos:aplicar    registra a execução
//
// Antes rode `npm run sync:inter && npm run import:inter` para o extrato estar
// fresco. Sem isso ele concilia contra o que baixou da última vez.
//
// ---------------------------------------------------------------------------
// O ELO: `codigoSolicitacao`
// ---------------------------------------------------------------------------
// Quando a plataforma cria um pagamento, o Inter devolve um `codigoSolicitacao`,
// que `pagar-programar.ts` guarda como marcador em `fin_payment_request.tags`
// (`inter-solicitacao:<codigo>`). E o extrato completo do Inter traz o MESMO
// campo em `detalhes.codigoSolicitacao` — medido: 540 das 699 transações do
// extrato local o têm.
//
// É por isso que a conciliação aqui não é heurística de valor e data (que erra
// quando duas pessoas recebem o mesmo valor no mesmo dia, o que acontece toda
// folha). É igualdade de identificador, ponta a ponta.
//
// ---------------------------------------------------------------------------
// ESTE SCRIPT NÃO PAGA E NÃO AFIRMA NADA SEM EXTRATO
// ---------------------------------------------------------------------------
// Ele é o ÚNICO lugar do repositório que insere em `fin_payment_execution`, e
// insere só quando as três coisas existem:
//
//   1. uma ordem em `aguardando_autorizacao` com `codigoSolicitacao` gravado;
//   2. uma transação no extrato do Inter com o MESMO código;
//   3. a linha correspondente já importada em `fin_transaction`.
//
// Sem (3) ele não grava. O CHECK `fin_payment_execution_conciliacao_completa`
// exige `transaction_id` junto de `reconciled_at`, então "conciliado sem lastro"
// é impossível por schema, não por disciplina.
//
// E o status vira 'pago' SOZINHO: o gatilho `fin_pagamento_refresh_pago`
// (0075:860) recalcula `paid_cents` e move o estado quando a soma alcança
// `net_cents`. Nenhuma linha deste arquivo escreve 'pago' — é o banco que
// conclui, a partir da evidência.
import { readFileSync } from 'node:fs';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { dedupeHash } from './lib/fin-normalize.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = 'data/raw/inter-extrato.json';
const ACCOUNT_SLUG = 'inter';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function acharTransacoes(o) {
  if (Array.isArray(o) && o.length && typeof o[0] === 'object') return o;
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) {
      const r = acharTransacoes(v);
      if (r) return r;
    }
  }
  return null;
}

let bruto;
try {
  bruto = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
} catch (e) {
  console.error(`\nNão consegui ler ${ARQUIVO}: ${e.message}`);
  console.error('Rode `npm run sync:inter` antes.\n');
  process.exit(1);
}

// codigoSolicitacao → a transação do extrato que o carrega.
const porCodigo = new Map();
for (const t of acharTransacoes(bruto) ?? []) {
  const cod = String(t.detalhes?.codigoSolicitacao ?? '').trim();
  if (cod) porCodigo.set(cod, t);
}

const pool = financePool();

console.log(`\nConciliação de pagamentos — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}`);
console.log(`  ${porCodigo.size} códigos de solicitação no extrato local\n`);

const { rows: ordens } = await pool.query(
  `SELECT pr.id, pr.code, pr.net_cents, pr.status, pr.method,
          cp.name AS favorecido,
          (SELECT t FROM unnest(pr.tags) AS t WHERE t LIKE 'inter-solicitacao:%' LIMIT 1) AS marcador
     FROM fin_payment_request pr
     JOIN fin_entity e ON e.id = pr.entity_id AND e.slug = 'xpe'
     LEFT JOIN fin_counterparty cp ON cp.id = pr.counterparty_id
    WHERE pr.status = 'aguardando_autorizacao'
      AND pr.paid_cents = 0
    ORDER BY pr.id`
);

if (ordens.length === 0) {
  console.log('  Nenhuma ordem esperando confirmação. Nada a conciliar.\n');
  await pool.end();
  process.exit(0);
}

const contas = await pool.query(
  `SELECT a.id FROM fin_account a
     JOIN fin_entity e ON e.id = a.entity_id AND e.slug = 'xpe'
    WHERE a.slug = $1 LIMIT 1`,
  [ACCOUNT_SLUG]
);
const contaInterId = contas.rows[0]?.id ?? null;

let conciliadas = 0;
let semExtrato = 0;
let semLastro = 0;

for (const o of ordens) {
  const codigo = String(o.marcador ?? '').replace('inter-solicitacao:', '').trim();
  const rotulo = `${o.code} ${String(o.favorecido ?? '—').slice(0, 26).padEnd(26)} ${brl(o.net_cents).padStart(13)}`;

  if (!codigo) {
    semExtrato += 1;
    console.log(`  ?  ${rotulo}  sem codigoSolicitacao gravado — não dá para casar`);
    continue;
  }

  const tx = porCodigo.get(codigo);
  if (!tx) {
    semExtrato += 1;
    console.log(`  ·  ${rotulo}  ainda não aparece no extrato (não aprovada, ou extrato desatualizado)`);
    continue;
  }

  // (3) a linha tem de existir no ledger. A chave é a MESMA que
  // `import-inter.mjs` usa: sha256("inter|id:<idTransacao>").
  const hash = dedupeHash({ accountSlug: ACCOUNT_SLUG, sourceId: `id:${tx.idTransacao}` });
  const { rows: lastro } = await pool.query(
    `SELECT t.id, t.posted_on::text AS posted_on, -t.amount_cents AS cents, t.end_to_end_id
       FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id AND a.slug = $1
      WHERE t.dedupe_hash = $2
      LIMIT 1`,
    [ACCOUNT_SLUG, hash]
  );
  const linha = lastro[0];
  if (!linha) {
    semLastro += 1;
    console.log(`  !  ${rotulo}  está no extrato mas NÃO no ledger — rode \`npm run import:inter\``);
    continue;
  }

  const divergencia = Number(linha.cents) !== Number(o.net_cents);
  conciliadas += 1;
  console.log(
    `  +  ${rotulo}  pago em ${linha.posted_on}${divergencia ? `  ⚠ extrato ${brl(linha.cents)} ≠ ordem ${brl(o.net_cents)}` : ''}`
  );

  if (APLICAR) {
    /*
     * O valor gravado é o do EXTRATO, não o da ordem. Se saiu diferente do que
     * se pediu, é o extrato que diz a verdade sobre o caixa — e a divergência
     * fica visível porque `paid_cents` não alcança `net_cents` e o gatilho
     * deixa a ordem em `pago_parcial` em vez de `pago`.
     */
    await pool.query(
      `INSERT INTO fin_payment_execution
         (payment_request_id, paid_on, amount_cents, from_account_id, method,
          end_to_end_id, bank_reference, transaction_id, reconciled_at, reconciled_by,
          reconcile_confidence, registered_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, 100, $9, $10)
       ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING`,
      [
        o.id,
        linha.posted_on,
        Number(linha.cents),
        contaInterId,
        o.method ?? 'pix',
        linha.end_to_end_id,
        codigo,
        linha.id,
        'conciliar-pagamentos',
        `casado por codigoSolicitacao=${codigo} contra idTransacao=${tx.idTransacao}`
      ]
    );
  }
}

console.log(
  `\n  ${conciliadas} conciliada(s) · ${semExtrato} ainda sem linha no extrato · ${semLastro} no extrato mas fora do ledger`
);

if (APLICAR && conciliadas > 0) {
  // Pós-condição: o gatilho tinha de ter movido o estado. Se não moveu, alguma
  // premissa caiu e é melhor saber agora.
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n FROM fin_payment_request
      WHERE entity_id = (SELECT id FROM fin_entity WHERE slug='xpe')
      GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log('\n  Estado das ordens depois:');
  for (const r of rows) console.log(`    ${String(r.status).padEnd(24)} ${r.n}`);
}

console.log(APLICAR ? '' : '\n  Para aplicar: npm run conciliar:pagamentos:aplicar\n');
await pool.end();
