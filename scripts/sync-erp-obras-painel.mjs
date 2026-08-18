// Espelha os agregados que alimentam a guia de Obras (migration 0121):
// erp_projeto, erp_reserva_projeto, erp_projeto_compra, erp_custo_categoria,
// erp_meta_orcamento_projeto. Sempre AGREGADO — nunca a linha de execução da
// obra (isso fica só no erp-obras, de propósito, para não competir com a
// futura guia dele).
//
// O BANCO DO ERP É SOMENTE LEITURA — sempre. A sessão abre com SET SESSION
// CHARACTERISTICS AS TRANSACTION READ ONLY, conferida com SHOW antes de
// qualquer SELECT, mesmo padrão de sync-erp-contratos.mjs e sync-erp-reservas.mjs.
//
// Uso:
//   node scripts/sync-erp-obras-painel.mjs              espelha e grava
//   node scripts/sync-erp-obras-painel.mjs --dry-run     mostra o que faria

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

    const projetos = await client.query(`
      SELECT id, nome, slug, segmento::text AS segmento, status::text AS status,
             "clienteNome" AS cliente_nome, "contratoId" AS contrato_erp_id, ativo
        FROM "Projeto"
       ORDER BY id`);

    const reservaProjeto = await client.query(`
      WITH mov AS (
        SELECT "reservaDestinoId" AS reserva_id, "projetoId" AS projeto_id, valor AS sinal
          FROM "LancamentoFinanceiro"
         WHERE "reservaDestinoId" IS NOT NULL AND status = 'PAGO' AND desconsiderado = false
         UNION ALL
        SELECT "reservaOrigemId" AS reserva_id, "projetoId" AS projeto_id, -valor AS sinal
          FROM "LancamentoFinanceiro"
         WHERE "reservaOrigemId" IS NOT NULL AND status = 'PAGO' AND desconsiderado = false
      )
      SELECT reserva_id, projeto_id, round(sum(sinal) * 100)::bigint AS saldo_cents
        FROM mov
       GROUP BY reserva_id, projeto_id`);

    const compraProjeto = await client.query(`
      SELECT "projetoId" AS projeto_id, round(sum("valorTotal") * 100)::bigint AS total_cents, count(*)::int AS linhas
        FROM "LinhaCompra"
       WHERE "projetoId" IS NOT NULL
       GROUP BY "projetoId"`);

    const custoCategoria = await client.query(`
      SELECT p.segmento::text AS segmento, lf.categoria,
             round(sum(lf.valor) * 100)::bigint AS valor_cents, count(*)::int AS lancamentos
        FROM "LancamentoFinanceiro" lf
        JOIN "Projeto" p ON p.id = lf."projetoId"
       WHERE lf.status = 'PAGO' AND lf.movimentacao = 'SAIDA' AND lf.desconsiderado = false
         AND lf.categoria IS NOT NULL AND lf.categoria <> 'Reserva de caixa'
       GROUP BY p.segmento, lf.categoria`);

    const metaOrcamento = await client.query(`
      SELECT "projetoId" AS projeto_id, round(sum("valorMeta") * 100)::bigint AS total_cents, count(*)::int AS metas
        FROM "MetaOrcamentoProjeto"
       WHERE ativo = true
       GROUP BY "projetoId"`);

    return {
      projetos: projetos.rows,
      reservaProjeto: reservaProjeto.rows,
      compraProjeto: compraProjeto.rows,
      custoCategoria: custoCategoria.rows,
      metaOrcamento: metaOrcamento.rows
    };
  } finally {
    await client.end();
  }
}

async function gravar(dados) {
  const pool = financePool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const p of dados.projetos) {
      await client.query(
        `INSERT INTO erp_projeto (erp_id, nome, slug, segmento, status_erp, cliente_nome, contrato_erp_id, ativo, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (erp_id) DO UPDATE SET
           nome=EXCLUDED.nome, slug=EXCLUDED.slug, segmento=EXCLUDED.segmento, status_erp=EXCLUDED.status_erp,
           cliente_nome=EXCLUDED.cliente_nome, contrato_erp_id=EXCLUDED.contrato_erp_id, ativo=EXCLUDED.ativo,
           synced_at=now()`,
        [p.id, p.nome, p.slug, p.segmento, p.status, p.cliente_nome, p.contrato_erp_id, p.ativo]
      );
    }

    // erp_reserva_projeto referencia erp_projeto por FK — só grava linha cujo
    // projeto (quando houver) já foi upsertado acima nesta mesma transação.
    for (const r of dados.reservaProjeto) {
      await client.query(
        `INSERT INTO erp_reserva_projeto (reserva_erp_id, projeto_erp_id, saldo_pago_cents, synced_at)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (reserva_erp_id, projeto_erp_id) DO UPDATE SET
           saldo_pago_cents=EXCLUDED.saldo_pago_cents, synced_at=now()`,
        [r.reserva_id, r.projeto_id, Number(r.saldo_cents)]
      );
    }

    for (const c of dados.compraProjeto) {
      await client.query(
        `INSERT INTO erp_projeto_compra (projeto_erp_id, total_comprado_cents, linhas, synced_at)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (projeto_erp_id) DO UPDATE SET
           total_comprado_cents=EXCLUDED.total_comprado_cents, linhas=EXCLUDED.linhas, synced_at=now()`,
        [c.projeto_id, Number(c.total_cents), c.linhas]
      );
    }

    for (const c of dados.custoCategoria) {
      await client.query(
        `INSERT INTO erp_custo_categoria (segmento, categoria, valor_pago_cents, lancamentos, synced_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (segmento, categoria) DO UPDATE SET
           valor_pago_cents=EXCLUDED.valor_pago_cents, lancamentos=EXCLUDED.lancamentos, synced_at=now()`,
        [c.segmento, c.categoria, Number(c.valor_cents), c.lancamentos]
      );
    }

    for (const m of dados.metaOrcamento) {
      await client.query(
        `INSERT INTO erp_meta_orcamento_projeto (projeto_erp_id, valor_meta_total_cents, metas_ativas, synced_at)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (projeto_erp_id) DO UPDATE SET
           valor_meta_total_cents=EXCLUDED.valor_meta_total_cents, metas_ativas=EXCLUDED.metas_ativas, synced_at=now()`,
        [m.projeto_id, Number(m.total_cents), m.metas]
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

const dados = await lerDoErp();
const obras = dados.projetos.filter((p) => p.segmento === 'OBRAS');
console.log(`${dados.projetos.length} projeto(s) lido(s) (${obras.length} em OBRAS)`);
console.log(`${dados.reservaProjeto.length} linha(s) de reserva-por-projeto`);
console.log(`${dados.compraProjeto.length} projeto(s) com compra registrada`);
console.log(`${dados.custoCategoria.length} categoria(s) de custo pago`);
console.log(`${dados.metaOrcamento.length} projeto(s) com meta de orçamento ativa`);
console.log(DRY ? '\n--dry-run: nada gravado' : '');
await gravar(dados);
if (!DRY) console.log('\ngravado em erp_projeto, erp_reserva_projeto, erp_projeto_compra, erp_custo_categoria, erp_meta_orcamento_projeto');
