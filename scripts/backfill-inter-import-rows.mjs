// Reconstrói a trilha da linha crua dos lotes do Inter — invariante C3.
//
// ---------------------------------------------------------------------------
// O DEFEITO
// ---------------------------------------------------------------------------
// scripts/import-inter.mjs criava o lote, gravava os lançamentos, marcava o lote
// como 'confirmado' e nunca escrevia uma linha em fin_import_row. Três lotes
// ficaram assim:
//
//   lote 17  inter_api  671 lidas · 521 inseridas · R$ 1.329.437,85 · 0 linhas cruas
//   lote 15  inter_api  150 lidas · 150 inseridas · R$   462.384,98 · 0 linhas cruas
//   lote 30  inter_api  161 lidas ·  13 inseridas · R$     9.594,69 · 0 linhas cruas
//
// Sem a linha crua não há preview, o dedupe não é auditável, e o desfazer do
// lote promete reverter algo que não sabe descrever. O importador já foi
// corrigido; este script trata o passado.
//
// ---------------------------------------------------------------------------
// O QUE DÁ PARA RECONSTRUIR, E O QUE NÃO DÁ
// ---------------------------------------------------------------------------
// data/raw/inter-extrato.json tem 671 transações, período 2026-01-01 a
// 2026-08-04, syncedAt 2026-08-10 — o arquivo EXATO que o lote 17 leu
// (row_count 671, mesmas datas, mesmo dia). Os 150 lançamentos do lote 15 são
// os mesmos idTransacao, num recorte anterior do mesmo arquivo.
//
// A reconstrução é fiel porque a chave é o `idTransacao` do próprio Inter e o
// payload é o que a API devolveu — não é um resumo montado a partir do que já
// está no ledger. Cada linha crua é ligada ao lançamento que ela produziu.
//
// O LOTE 30 NÃO É RECUPERÁVEL. Ele rodou em 2026-08-15 sobre uma versão do
// arquivo que cobria até 2026-08-14; o arquivo em disco foi sobrescrito e
// termina em 2026-08-04. Os 13 lançamentos que ele inseriu (todos de 14/08) não
// têm payload em lugar nenhum — nem no arquivo, nem no ledger, que não guarda
// raw. Inventar um payload a partir das colunas do lançamento seria fabricar
// justamente a evidência que a trilha existe para provar. Fica declarado como
// perda, e a próxima sincronização do Inter já nasce com trilha.
//
// Uso:
//   node scripts/backfill-inter-import-rows.mjs            dry-run (padrão)
//   node scripts/backfill-inter-import-rows.mjs --aplicar
import { readFile } from 'node:fs/promises';
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ACCOUNT_SLUG = 'inter';
const ARQUIVO = new URL('../data/raw/inter-extrato.json', import.meta.url);

const dia = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '—'));

const pool = financePool();
const client = await pool.connect();

try {
  const arquivo = JSON.parse(await readFile(ARQUIVO, 'utf8'));
  const transacoes = arquivo.data ?? [];
  if (!transacoes.length) {
    console.log('[backfill] data/raw/inter-extrato.json vazio — rode antes: npm run sync:inter');
    process.exit(1);
  }

  const { rows: contas } = await client.query(`SELECT id FROM fin_account WHERE slug = $1`, [ACCOUNT_SLUG]);
  const accountId = contas[0]?.id;
  if (!accountId) throw new Error(`conta ${ACCOUNT_SLUG} não existe`);

  // De qual lançamento (e de qual lote) veio cada idTransacao do arquivo.
  const { rows: existentes } = await client.query(
    `SELECT id, source_id, import_batch_id, posted_on, amount_cents, description_raw, dedupe_hash
       FROM fin_transaction WHERE account_id = $1 AND source_id IS NOT NULL`,
    [accountId]
  );
  const porSourceId = new Map(existentes.map((t) => [t.source_id, t]));

  // Lotes confirmados do Inter sem nenhuma linha crua.
  const { rows: lotes } = await client.query(
    `SELECT b.id, b.row_count, b.inserted_count, b.period_start, b.period_end,
            (SELECT count(*) FROM fin_transaction t WHERE t.import_batch_id = b.id) AS tx
       FROM fin_import_batch b
      WHERE b.adapter = 'inter_api' AND b.status = 'confirmado'
        AND NOT EXISTS (SELECT 1 FROM fin_import_row r WHERE r.batch_id = b.id)
      ORDER BY b.id`
  );

  if (!lotes.length) {
    console.log('[backfill] nenhum lote do Inter sem trilha — nada a fazer.');
    process.exit(0);
  }

  console.log(`\nArquivo: ${transacoes.length} transações (${arquivo.periodo?.inicio} a ${arquivo.periodo?.fim}, syncedAt ${arquivo.syncedAt})`);
  console.log(`Lotes confirmados sem trilha: ${lotes.map((l) => l.id).join(', ')}\n`);

  // Um lote só é reconstruível se o arquivo cobre os lançamentos que ele
  // inseriu. Fora isso não há payload, e não se inventa payload.
  const plano = new Map(lotes.map((l) => [Number(l.id), []]));
  let semPayload = 0;

  for (const [i, t] of transacoes.entries()) {
    const tx = porSourceId.get(t.idTransacao);
    if (!tx) { semPayload += 1; continue; }
    const lote = Number(tx.import_batch_id);
    if (!plano.has(lote)) continue;
    plano.get(lote).push({ i, t, tx });
  }

  // O lote 17 LEU o arquivo inteiro (row_count = 671) e inseriu 521: as outras
  // 150 já existiam pelo lote 15 e para ele foram duplicadas. A trilha dele tem
  // de contar as 671, senão o "leu 671, inseriu 521" continua sem lastro.
  const loteMaisAmplo = lotes.reduce((a, b) => (Number(a.row_count) >= Number(b.row_count) ? a : b));
  const cobreArquivoInteiro = Number(loteMaisAmplo.row_count) === transacoes.length;

  let inseridas = 0;
  const naoRecuperaveis = [];

  if (!APLICAR) console.log('DRY-RUN — nada será escrito. Use --aplicar para valer.\n');
  if (APLICAR) await client.query('BEGIN');

  for (const lote of lotes) {
    const id = Number(lote.id);
    const proprias = plano.get(id) ?? [];

    if (!proprias.length) {
      naoRecuperaveis.push(lote);
      console.log(
        `  ✗ lote ${id}: ${lote.row_count} lidas, ${lote.inserted_count} inseridas ` +
        `(${dia(lote.period_start)} a ${dia(lote.period_end)}) — NENHUM payload no arquivo. Trilha irrecuperável.`
      );
      continue;
    }

    // Para o lote que leu o arquivo inteiro, a trilha é o arquivo inteiro.
    const linhas = (cobreArquivoInteiro && id === Number(loteMaisAmplo.id))
      ? transacoes.map((t, i) => ({ i, t, tx: porSourceId.get(t.idTransacao) ?? null }))
      : proprias;

    for (const { i, t, tx } of linhas) {
      // 'importado' só para o que ESTE lote de fato inseriu. O resto ele leu e
      // descartou por já existir — que é exatamente o que 'duplicado' significa.
      const meu = tx && Number(tx.import_batch_id) === id;
      const status = meu ? 'importado' : 'duplicado';
      if (APLICAR) {
        await client.query(
          `INSERT INTO fin_import_row
             (batch_id, row_number, raw, posted_on, amount_cents, description_raw,
              dedupe_hash, status, transaction_id, message)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id, i + 1, JSON.stringify(t),
            tx?.posted_on ?? null, tx?.amount_cents ?? null, tx?.description_raw ?? null,
            tx?.dedupe_hash ?? null, status, meu ? tx.id : null,
            'trilha reconstruída de data/raw/inter-extrato.json pelo backfill-inter-import-rows'
          ]
        );
      }
      inseridas += 1;
    }
    const nMeu = linhas.filter(({ tx }) => tx && Number(tx.import_batch_id) === id).length;
    console.log(
      `  ✓ lote ${id}: ${linhas.length} linhas cruas (${nMeu} importadas, ${linhas.length - nMeu} duplicadas) ` +
      `— declara ${lote.row_count} lidas, ${lote.inserted_count} inseridas, ${lote.tx} lançamentos vivos`
    );
  }

  if (APLICAR) {
    await client.query('COMMIT');
    console.log(`\n✓ ${inseridas} linhas cruas gravadas.`);
  } else {
    console.log(`\nDRY-RUN: ${inseridas} linhas cruas seriam gravadas.`);
  }

  if (semPayload) console.log(`· ${semPayload} transações do arquivo não têm lançamento no ledger (não entram na trilha de lote nenhum).`);

  if (naoRecuperaveis.length) {
    console.log('\n' + '─'.repeat(76));
    console.log('BLOQUEIO DE DADO — não é preguiça, é payload que não existe mais:');
    for (const l of naoRecuperaveis) {
      console.log(
        `  · lote ${l.id} (${dia(l.period_start)} a ${dia(l.period_end)}): ${l.tx} lançamentos vivos.\n` +
        `    O arquivo bruto que ele leu foi sobrescrito pela sincronização seguinte, e\n` +
        `    fin_transaction não guarda raw. Reconstruir a partir das colunas do ledger\n` +
        `    fabricaria a evidência que a trilha existe para provar.\n` +
        `    Saída possível: re-sincronizar o Inter no período e reimportar — o importador\n` +
        `    corrigido grava a trilha, e o dedupe garante que nada duplica.`
      );
    }
  }
} catch (error) {
  if (APLICAR) await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
