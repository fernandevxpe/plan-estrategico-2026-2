// Espelha os TOTAIS de ReservaFinanceira do erp-obras → erp_reserva_financeira
// (migration 0120). Só as 4 caixinhas do Nubank (Impostos, Comissões,
// Reserva de obras, Caixa livre) — nunca o detalhe por projeto de obra, que
// fica de propósito fora daqui: vai morar na futura guia de Obras, que
// espelha o erp-obras projeto a projeto, e duplicar aqui criaria dois
// lugares dizendo a mesma coisa de jeitos diferentes.
//
// O BANCO DO ERP É SOMENTE LEITURA — sempre, e não por disciplina nossa. A
// sessão abre com SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY,
// conferido com SHOW antes de qualquer SELECT, mesmo padrão de
// sync-erp-contratos.mjs.
//
// Uso:
//   node scripts/sync-erp-reservas.mjs              espelha e grava
//   node scripts/sync-erp-reservas.mjs --dry-run     mostra o que faria

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Os únicos 4 nomes que existem no app do Nubank (0117). Mapeamento fixo por
// slug — casamento fuzzy por nome esconderia erro de digitação em vez de
// estourar.
const NUBANK_CAIXINHA_POR_SLUG = {
  impostos: 'Impostos e tributos',
  reserva_obras: 'reserva de obras',
  comissoes: 'Comissionamento',
  lucro: 'Caixa Livre'
};

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
    await client.query('SET statement_timeout = 60000');

    const check = await client.query('SHOW transaction_read_only');
    if (check.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('trava de somente-leitura não pegou — abortando antes de qualquer consulta');
    }

    const reservas = await client.query(`SELECT id, nome, tipo::text AS tipo, status::text AS status, slug FROM "ReservaFinanceira" ORDER BY id`);

    const { rows: saldos } = await client.query(`
      WITH entradas AS (
        SELECT "reservaDestinoId" AS reserva_id, round(sum(valor) * 100)::bigint AS total
          FROM "LancamentoFinanceiro"
         WHERE "reservaDestinoId" IS NOT NULL AND status = 'PAGO' AND desconsiderado = false
         GROUP BY "reservaDestinoId"
      ),
      saidas AS (
        SELECT "reservaOrigemId" AS reserva_id, round(sum(valor) * 100)::bigint AS total
          FROM "LancamentoFinanceiro"
         WHERE "reservaOrigemId" IS NOT NULL AND status = 'PAGO' AND desconsiderado = false
         GROUP BY "reservaOrigemId"
      )
      SELECT r.id AS reserva_id,
             COALESCE(e.total, 0) AS entradas_cents,
             COALESCE(s.total, 0) AS saidas_cents
        FROM "ReservaFinanceira" r
        LEFT JOIN entradas e ON e.reserva_id = r.id
        LEFT JOIN saidas s ON s.reserva_id = r.id
    `);

    const saldoPorReserva = new Map(saldos.map((s) => [s.reserva_id, s]));

    return reservas.rows.map((r) => {
      const s = saldoPorReserva.get(r.id) ?? { entradas_cents: 0, saidas_cents: 0 };
      return {
        erp_id: r.id,
        nome: r.nome,
        slug: r.slug,
        tipo: r.tipo,
        status_erp: r.status,
        nubank_caixinha_nome: r.slug ? NUBANK_CAIXINHA_POR_SLUG[r.slug] ?? null : null,
        entradas_pagas_cents: Number(s.entradas_cents),
        saidas_pagas_cents: Number(s.saidas_cents),
        saldo_pago_cents: Number(s.entradas_cents) - Number(s.saidas_cents)
      };
    });
  } finally {
    await client.end();
  }
}

async function gravar(reservas) {
  const pool = financePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of reservas) {
      await client.query(
        `INSERT INTO erp_reserva_financeira
           (erp_id, nome, slug, tipo, status_erp, nubank_caixinha_nome,
            saldo_pago_cents, entradas_pagas_cents, saidas_pagas_cents, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (erp_id) DO UPDATE SET
           nome = EXCLUDED.nome, slug = EXCLUDED.slug, tipo = EXCLUDED.tipo,
           status_erp = EXCLUDED.status_erp, nubank_caixinha_nome = EXCLUDED.nubank_caixinha_nome,
           saldo_pago_cents = EXCLUDED.saldo_pago_cents,
           entradas_pagas_cents = EXCLUDED.entradas_pagas_cents,
           saidas_pagas_cents = EXCLUDED.saidas_pagas_cents,
           synced_at = now()`,
        [r.erp_id, r.nome, r.slug, r.tipo, r.status_erp, r.nubank_caixinha_nome,
         r.saldo_pago_cents, r.entradas_pagas_cents, r.saidas_pagas_cents]
      );
    }
    if (DRY) await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

const reservas = await lerDoErp();
console.log(`${reservas.length} reserva(s) lida(s) do erp-obras:\n`);
for (const r of reservas) {
  console.log(
    `  ${String(r.nome).padEnd(20)} ${r.status_erp.padEnd(10)} ${brl(r.saldo_pago_cents).padStart(14)}` +
      (r.nubank_caixinha_nome ? `  ← caixinha "${r.nubank_caixinha_nome}"` : '  (sem par no app)')
  );
}
console.log(DRY ? '\n--dry-run: nada gravado' : '');
await gravar(reservas);
if (!DRY) console.log(`\n${reservas.length} linha(s) gravada(s) em erp_reserva_financeira`);
