// REPARO PONTUAL — leia antes de rodar.
//
// ---------------------------------------------------------------------------
// O QUE ACONTECEU, EM 17/08/2026
// ---------------------------------------------------------------------------
// A 0108 estava sendo escrita nesta árvore quando OUTRO processo da mesma
// árvore rodou o runner de migrations e a aplicou. O registro conta a história:
//
//     xpe_migrations · 0108_fin_custo_fixo_catalogo.sql
//     applied_at  2026-08-17 11:27:15      applied_by  web
//
// A frente que escrevia o arquivo não pediu isso e não estava pronta. É o mesmo
// acidente de coordenação que o §6 do `docs/CONTINUACAO.md` já registra em
// outras direções: numa árvore com N frentes, qualquer comando que varre o
// diretório de migrations carrega o trabalho inacabado das outras.
//
// Duas consequências, e a segunda é a que trava gente:
//
//   1. O BANCO FICOU COM AS VIEWS DE UMA VERSÃO INTERMEDIÁRIA. Duas correções
//      entraram no arquivo DEPOIS das 11:27 e não estão no banco:
//        · o valor sugerido do custo de volume passou a ser o do último mês
//          COMPARÁVEL. No banco de agora a Claro sugere R$ 204,72 — o mês em
//          que caíram duas faturas — em vez dos R$ 99,90 que ela custa;
//        · o parcelamento de cartão passou a exigir parcela em aberto. No banco
//          de agora ele soma R$ 1.402,72/mês em vez de R$ 976,95, porque conta
//          três planos já quitados.
//
//   2. `npm run db:migrate` ESTÁ TRAVADO PARA TODAS AS FRENTES. O runner recusa
//      arquivo que mudou depois de aplicado — e está certo em recusar. Enquanto
//      o checksum registrado não bater com o do arquivo, nenhuma migration nova
//      entra, de nenhuma frente.
//
// ---------------------------------------------------------------------------
// O QUE ESTE SCRIPT FAZ
// ---------------------------------------------------------------------------
// Põe o banco em acordo com o ARQUIVO, e só ele:
//
//   · aplica a 0108 — SOZINHA. Não usa `db:migrate`, que arrastaria a 0107 da
//     frente fiscal junto (§6 do CONTINUACAO: "aplique só o que está declarado
//     concluído"). A 0108 é idempotente por construção (§6b dela): derruba e
//     recria as próprias views, e a semeadura é guardada por ON CONFLICT.
//   · corrige o checksum registrado, destravando `db:migrate`.
//   · ABORTA se a soma por conta ou o total do ledger mudarem em um centavo.
//
// Medido em dry-run antes de existir este arquivo: nenhuma linha muda de
// contagem, o ledger não se move, a âncora das 6 contas é idêntica. O que muda
// é definição de view e uma linha de metadados.
//
// A ALTERNATIVA — desfazer em vez de completar — foi considerada e recusada: a
// semeadura já sobrescreveu as colunas de evidência das 11 recorrentes que a
// v1 tinha criado, e não há backup dessas colunas. Desfazer restauraria o
// schema e perderia dado; completar não perde nada.
//
// Uso:
//   node scripts/reparo-0108-checksum.mjs             dry-run (padrão)
//   node scripts/reparo-0108-checksum.mjs --aplicar   grava
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ID = '0108_fin_custo_fixo_catalogo.sql';
const sql = readFileSync(resolve(RAIZ, 'db/migrations', ID), 'utf8');

// Mesma normalização de `scripts/lib/migrate.mjs`. Um checksum calculado de
// outro jeito "consertaria" o drift gravando um valor que o runner não
// reconhece — e o próximo db:migrate voltaria a travar.
const normalizado = sql.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
const checksum = createHash('sha256').update(normalizado).digest('hex');
const brl = (v) => (Number(v || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ANCORA = `SELECT a.slug, COALESCE(SUM(t.amount_cents), 0) AS calc
                  FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
                 GROUP BY 1 ORDER BY 1`;
const FOTO = `SELECT
  (SELECT count(*) FROM fin_recurring WHERE direction='pagar')                     AS rec_pagar,
  (SELECT count(*) FROM fin_recurring WHERE direction='pagar' AND status='ativo')  AS rec_pagar_ativa,
  (SELECT count(*) FROM fin_recurring WHERE direction='receber')                   AS rec_receber,
  (SELECT COALESCE(sum(amount_cents),0) FROM fin_transaction)                      AS ledger_cents,
  (SELECT count(*) FROM fin_transaction)                                           AS lancamentos,
  (SELECT count(*) FROM fin_recurring_observation)                                 AS observacoes`;

const pool = financePool();
const c = await pool.connect();

try {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout = '30s'");

  const ancoraAntes = (await c.query(ANCORA)).rows;
  const antes = (await c.query(FOTO)).rows[0];
  const { rows: [reg] } = await c.query(
    `SELECT checksum_sha256, applied_at, applied_by FROM xpe_migrations WHERE id = $1`, [ID]);

  console.log('\n── ANTES ──────────────────────────────────────────────────');
  console.log(`  registrada .......... ${reg ? `${reg.checksum_sha256.slice(0, 12)}… por "${reg.applied_by}"` : '(não registrada)'}`);
  console.log(`  arquivo de hoje ..... ${checksum.slice(0, 12)}…`);
  console.log(`  drift ............... ${reg && reg.checksum_sha256 !== checksum ? 'SIM — db:migrate travado' : 'não'}`);
  console.log(`  ${JSON.stringify(antes)}`);

  await c.query(sql);

  const depois = (await c.query(FOTO)).rows[0];
  const ancoraDepois = (await c.query(ANCORA)).rows;
  const ancoraIgual = JSON.stringify(ancoraAntes) === JSON.stringify(ancoraDepois);

  console.log('\n── DEPOIS ─────────────────────────────────────────────────');
  console.log(`  ${JSON.stringify(depois)}`);
  for (const a of ancoraAntes) console.log(`    ${a.slug.padEnd(20)} ${brl(a.calc)}`);
  console.log(`  âncora por conta idêntica ... ${ancoraIgual ? 'SIM' : 'NÃO'}`);

  if (!ancoraIgual) throw new Error('a soma por conta mudou — nada será gravado');
  if (String(antes.ledger_cents) !== String(depois.ledger_cents)
   || String(antes.lancamentos)  !== String(depois.lancamentos)) {
    throw new Error('o ledger mudou — nada será gravado');
  }

  await c.query(
    `UPDATE xpe_migrations SET checksum_sha256 = $2, applied_at = now(), applied_by = $3 WHERE id = $1`,
    [ID, checksum, 'reparo:frente-catalogo-custo-fixo']);

  if (APLICAR) {
    await c.query('COMMIT');
    console.log('\n[aplicado] banco em acordo com o arquivo · checksum corrigido · db:migrate destravado\n');
  } else {
    await c.query('ROLLBACK');
    console.log('\n[dry-run] nada gravado. Use --aplicar quando quiser destravar.\n');
  }
} catch (erro) {
  await c.query('ROLLBACK').catch(() => {});
  console.error(`\nERRO: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
