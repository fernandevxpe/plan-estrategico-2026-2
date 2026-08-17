// Gera as notificações a partir do estado real do ledger.
//
// ===========================================================================
// O QUE ESTE SCRIPT FAZ, E O QUE ELE DELIBERADAMENTE NÃO FAZ
// ===========================================================================
// Ele faz DUAS coisas e nada mais:
//
//   1. mede os invariantes (`test-integridade.mjs --strict --json`) e grava o
//      resultado em `fin_invariante_resultado`, porque a medição mora nos
//      scripts e a view de fatos precisa dela no banco;
//   2. chama `fin_notificacao_sync()`, que casa os fatos com a caixa.
//
// O que ele NÃO faz: decidir o que é importante. Isso está em
// `fin_notificacao_fato_v`, versionada na 0105 — se a regra vivesse aqui, ela
// seria invisível para quem lê o banco e impossível de conferir sem rodar Node.
//
// Idempotente: duas execuções seguidas não criam notificação nova. É a
// propriedade que permite pô-lo no scheduler sem medo de duplicar aviso.
//
//   node scripts/notificar.mjs             # dry-run: mostra o que faria
//   node scripts/notificar.mjs --aplicar   # grava
//   node scripts/notificar.mjs --aplicar --sem-invariantes
//
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/env.mjs';
loadEnv();

const { financePool } = await import('./lib/artifact-db.mjs');

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const APLICAR = process.argv.includes('--aplicar');
const SEM_INVARIANTES = process.argv.includes('--sem-invariantes');

const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Roda o verificador e devolve a lista de invariantes.
 *
 * Ele sai com código != 0 quando algo está quebrado — que é justamente o caso
 * que interessa aqui. Por isso o código de saída é IGNORADO e o que vale é o
 * JSON: tratar "quebrou" como falha do script faria o aviso nunca ser gerado
 * exatamente quando ele é necessário.
 */
function medirInvariantes() {
  return new Promise((resolve) => {
    const proc = spawn('node', [path.join(RAIZ, 'scripts/test-integridade.mjs'), '--strict', '--json'], {
      cwd: RAIZ,
      env: process.env
    });
    let saida = '';
    proc.stdout.on('data', (d) => { saida += d; });
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      try {
        const inicio = saida.indexOf('{');
        resolve(inicio === -1 ? null : JSON.parse(saida.slice(inicio)));
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

const pool = financePool();
const client = await pool.connect();

try {
  const existe = await client.query(`SELECT to_regclass('fin_notificacao') IS NOT NULL AS ok`);
  if (!existe.rows[0].ok) {
    console.log('A migration 0105 não está aplicada neste banco. Nada a fazer.');
    process.exit(0);
  }

  if (!SEM_INVARIANTES) {
    console.log('Medindo invariantes…');
    const medida = await medirInvariantes();
    if (!medida?.invariantes?.lista) {
      // Não inventa "está tudo bem": ausência de medição é ausência de
      // medição, e o registro anterior continua valendo com a data dele.
      console.log('  · não consegui medir; os invariantes registrados continuam com a medição anterior');
    } else {
      const lista = medida.invariantes.lista;
      const quebrados = lista.filter((c) => !c.ok);
      console.log(`  ${lista.length} invariantes · ${quebrados.length} quebrado(s)`);
      for (const c of quebrados) {
        console.log(`    ✗ [${c.id}] ${c.nome} · ${c.n} violação(ões)${c.rs ? ` · ${brl(c.rs)}` : ''}`);
      }

      if (APLICAR) {
        await client.query('BEGIN');
        // Histórico preservado: a medição de hoje entra, a de ontem deixa de
        // ser corrente. "Desde quando isto está quebrado?" é uma pergunta que
        // aparece toda vez, e um UPDATE destrutivo a tornaria irrespondível.
        await client.query(`UPDATE fin_invariante_resultado SET corrente = false WHERE corrente`);
        for (const c of lista) {
          await client.query(
            `INSERT INTO fin_invariante_resultado (codigo, nome, ok, violacoes, amount_cents, detalhe, corrente)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)`,
            [c.id, c.nome, c.ok === true, c.n ?? 0, c.rs ?? null,
             JSON.stringify({ secao: c.secao ?? null, tx: c.tx_atingidos ?? null, doc: c.doc_atingidos ?? null })]
          );
        }
        await client.query('COMMIT');
        console.log(`  gravados ${lista.length} resultados`);
      }
    }
  }

  console.log('\nFatos que merecem aviso agora:');
  const fatos = await client.query(
    `SELECT kind, count(*)::int n, sum(amount_cents)::bigint v FROM fin_notificacao_fato_v GROUP BY 1 ORDER BY n DESC`
  );
  for (const f of fatos.rows) {
    console.log(`  ${String(f.kind).padEnd(32)} ${String(f.n).padStart(5)}${f.v ? ` · ${brl(f.v)}` : ''}`);
  }
  if (fatos.rows.length === 0) console.log('  (nenhum)');

  if (!APLICAR) {
    console.log('\nDry-run. Nada foi gravado. Use --aplicar.');
    process.exit(0);
  }

  const r = await client.query(`SELECT * FROM fin_notificacao_sync($1)`, ['scheduler']);
  const { criadas, repetidas, resolvidas } = r.rows[0];
  console.log(`\n${criadas} criada(s) · ${repetidas} repetida(s) · ${resolvidas} resolvida(s) automaticamente`);

  const caixa = await client.query(
    `SELECT coalesce(recipient_perfil, 'pessoa') alvo, estado, count(*)::int n
       FROM fin_notificacao GROUP BY 1, 2 ORDER BY 1, 2`
  );
  console.log('\nCaixa depois:');
  for (const c of caixa.rows) console.log(`  ${c.alvo.padEnd(8)} ${c.estado.padEnd(10)} ${c.n}`);
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗', erro.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
