// Espelha o extrato do erp-obras para cá: LancamentoFinanceiro → erp_extrato_linha.
//
// NÃO TOCA NO LEDGER. Grava só na tabela de staging da migration 0038, para que
// a troca de fonte do Nubank (CSV manual → Polp, pelo erp-obras) possa ser
// conferida antes de ser promovida. Enquanto este script roda, `/financeiro`
// continua lendo exatamente o que lia.
//
// O BANCO DO ERP É SOMENTE LEITURA — sempre, e não por disciplina nossa. A
// sessão abre com SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY, então
// qualquer escrita é recusada pelo servidor. O pooler do Supabase ignora
// PGOPTIONS na string de conexão, e a credencial disponível é superusuário; a
// trava declarativa na sessão é a única que de fato pega.
//
// Uso:
//   node scripts/sync-erp-obras.mjs             espelha e grava
//   node scripts/sync-erp-obras.mjs --dry-run   mostra o que faria
//   node scripts/sync-erp-obras.mjs --desde=2026-01-01
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');
const desdeArg = process.argv.find((a) => a.startsWith('--desde='));
const DESDE = desdeArg ? desdeArg.slice('--desde='.length) : '2025-12-01';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Os dois lados nomeiam as contas de forma diferente: lá `ContaBancaria.slug` é
 * NUBANK/INTER/ASAAS em caixa alta; aqui `fin_account.slug` é minúsculo e tem
 * contas que lá não existem (nubank-caixinhas, caixa-*).
 *
 * O mapa é explícito e não um `lower()` porque a equivalência é uma decisão, não
 * uma coincidência de grafia — no dia em que o ERP criar uma conta nova, o
 * fallback avisa em vez de inventar um slug que não existe deste lado.
 */
const CONTA_ERP_PARA_LEDGER = new Map([
  ['NUBANK', 'nubank'],
  ['INTER', 'inter'],
  ['ASAAS', 'asaas']
]);

const contasDesconhecidas = new Set();
function contaLedger(slugErp) {
  const mapeada = CONTA_ERP_PARA_LEDGER.get(slugErp);
  if (mapeada) return mapeada;
  contasDesconhecidas.add(slugErp);
  return slugErp.toLowerCase();
}

/**
 * Lê a URL do erp-obras sem poluir process.env.
 *
 * O `.env.obras` é o `.env.local` inteiro do outro projeto e traz chaves de
 * escrita (service_role do Supabase, Asaas de produção, Polp, Clicksign).
 * Carregá-lo com loadEnv() jogaria tudo em process.env, onde qualquer outro
 * trecho deste processo poderia usá-las por engano. Aqui só sai o que interessa.
 */
const descascar = (v) =>
  v && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    ? v.slice(1, -1)
    : v;

function erpDatabaseUrl() {
  // O ambiente vem primeiro, e por necessidade: desde que esta fonte virou
  // etapa do botão (e do agendador), ela precisa rodar no Railway — onde
  // `.env.obras` não existe, porque `.env*` é ignorado pelo git e o arquivo é o
  // `.env.local` INTEIRO do outro projeto, que não tem por que ser publicado.
  //
  // O nome é `ERP_OBRAS_DIRECT_URL` e não `DIRECT_URL` de propósito. Existe uma
  // `DIRECT_URL` no painel do Railway e ninguém neste repositório sabe dizer,
  // olhando, se ela aponta para o erp-obras ou para o banco desta plataforma.
  // Um nome ambíguo aqui erraria de banco em silêncio até a primeira consulta
  // a "LancamentoFinanceiro"; um nome próprio não tem como ser confundido.
  //
  // As aspas são descascadas aqui pelo mesmo motivo que o parser do arquivo as
  // descasca: no `.env.obras` o valor está entre aspas, e quem for copiá-lo
  // para o painel do Railway copia a linha inteira. Uma aspa a mais vira
  // `hostname: 'base'` num erro de driver que não menciona aspas em lugar
  // nenhum — medido ao testar este caminho.
  const doAmbiente = descascar(process.env.ERP_OBRAS_DIRECT_URL?.trim());
  if (doAmbiente) return doAmbiente;

  const path = ['.env.obras', resolve(process.cwd(), '.env.obras')].find((p) => existsSync(p));
  if (!path) {
    throw new Error(
      'sem ERP_OBRAS_DIRECT_URL no ambiente e .env.obras não encontrado — é de um dos dois que sai a URL de leitura do erp-obras'
    );
  }

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
    // DIRECT_URL é o session pooler (5432). O transaction pooler (6543) derruba
    // consulta analítica longa — o próprio database-url.ts do erp-obras explica.
    if (key === 'DIRECT_URL') return value;
    if (!erpDatabaseUrl.fallback) erpDatabaseUrl.fallback = value;
  }
  if (erpDatabaseUrl.fallback) return erpDatabaseUrl.fallback;
  throw new Error('DIRECT_URL/DATABASE_URL ausentes no .env.obras, e ERP_OBRAS_DIRECT_URL ausente no ambiente');
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
    await client.query('SET statement_timeout = 120000');

    const check = await client.query('SHOW transaction_read_only');
    if (check.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('trava de somente-leitura não pegou — abortando antes de qualquer consulta');
    }

    // O sentido do valor mora em `movimentacao` lá e no sinal aqui, como em
    // fin_transaction. Converter na origem evita que cada consulta tenha de
    // lembrar da regra — e que uma delas esqueça.
    const { rows } = await client.query(
      `SELECT l."extratoLinhaKey"        AS erp_linha_key,
              l.id                       AS erp_lancamento_id,
              cb.slug                    AS conta_slug,
              COALESCE(l."dataPagamento", l."dataVencimento")::date AS posted_on,
              (CASE WHEN l.movimentacao = 'ENTRADA' THEN 1 ELSE -1 END
                 * round(l.valor * 100))::bigint AS amount_cents,
              l.descricao, l.categoria, l.beneficiado,
              l."projetoId"              AS projeto_id,
              p.nome                     AS projeto_nome,
              p.segmento::text           AS projeto_segmento,
              l.status::text             AS status,
              l.origem::text             AS origem,
              l."extratoIdentificador"   AS extrato_identificador
         FROM "LancamentoFinanceiro" l
         JOIN "ContaBancaria" cb ON cb.id = l."contaBancariaId"
         LEFT JOIN "Projeto" p   ON p.id  = l."projetoId"
        WHERE l.origem = 'EXTRATO'
          AND l."extratoLinhaKey" IS NOT NULL
          AND COALESCE(l."dataPagamento", l."dataVencimento") >= $1::date
        ORDER BY 4, 1`,
      [DESDE]
    );
    return rows;
  } finally {
    await client.end();
  }
}

const linhas = await lerDoErp();
console.log(`[erp] ${linhas.length} linha(s) de extrato desde ${DESDE}`);

if (!linhas.length) {
  console.log('[erp] nada a espelhar');
  process.exit(0);
}

const comProjeto = linhas.filter((l) => l.projeto_id).length;
console.log(`[erp] com projeto identificado: ${comProjeto} (${((100 * comProjeto) / linhas.length).toFixed(1)}%)`);

if (DRY) {
  const porConta = new Map();
  for (const l of linhas) porConta.set(l.conta_slug, (porConta.get(l.conta_slug) ?? 0) + 1);
  for (const [conta, n] of porConta) console.log(`  ${conta}: ${n}`);
  console.log('[erp] --dry-run: nada gravado');
  process.exit(0);
}

const pool = financePool();
let inseridos = 0;
let atualizados = 0;

try {
  for (const l of linhas) {
    // Idempotência pela chave estável do lado de lá ("data|valor|id|índice").
    // O extratoIdentificador (id do Nubank) NÃO serve: repete em estorno, e o
    // próprio schema do erp-obras avisa.
    const r = await pool.query(
      `INSERT INTO erp_extrato_linha (
         erp_linha_key, erp_lancamento_id, conta_slug, posted_on, amount_cents,
         descricao, categoria, beneficiado, projeto_id, projeto_nome,
         projeto_segmento, status, origem, extrato_identificador, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (erp_linha_key) DO UPDATE SET
         erp_lancamento_id = EXCLUDED.erp_lancamento_id,
         conta_slug        = EXCLUDED.conta_slug,
         posted_on         = EXCLUDED.posted_on,
         amount_cents      = EXCLUDED.amount_cents,
         descricao         = EXCLUDED.descricao,
         categoria         = EXCLUDED.categoria,
         beneficiado       = EXCLUDED.beneficiado,
         projeto_id        = EXCLUDED.projeto_id,
         projeto_nome      = EXCLUDED.projeto_nome,
         projeto_segmento  = EXCLUDED.projeto_segmento,
         status            = EXCLUDED.status,
         origem            = EXCLUDED.origem,
         extrato_identificador = EXCLUDED.extrato_identificador,
         synced_at         = now()
       RETURNING (xmax = 0) AS inserido`,
      [l.erp_linha_key, l.erp_lancamento_id, contaLedger(l.conta_slug), l.posted_on, l.amount_cents,
       l.descricao, l.categoria, l.beneficiado, l.projeto_id, l.projeto_nome,
       l.projeto_segmento, l.status, l.origem, l.extrato_identificador]
    );
    if (r.rows[0]?.inserido) inseridos += 1;
    else atualizados += 1;
  }

  console.log(`[erp] ${inseridos} inserida(s), ${atualizados} atualizada(s)`);
  if (contasDesconhecidas.size) {
    console.warn(`[erp] AVISO conta(s) sem equivalente mapeado: ${[...contasDesconhecidas].join(', ')}`);
  }

  const { rows: rec } = await pool.query(
    `SELECT to_char(mes,'YYYY-MM') AS mes, linhas_aqui, linhas_erp, delta_linhas,
            delta_cents, com_projeto, paridade
       FROM erp_extrato_reconciliacao_v ORDER BY mes`
  );
  console.log('\n[reconciliação] nubank: este ledger × espelho do erp-obras');
  for (const r of rec) {
    const marca = r.paridade ? '=' : (r.delta_linhas > 0 ? '+' : '!');
    console.log(
      `  ${marca} ${r.mes}  aqui ${String(r.linhas_aqui).padStart(4)}  erp ${String(r.linhas_erp).padStart(4)}` +
      `  Δ ${String(r.delta_linhas).padStart(4)} linha(s) ${brl(r.delta_cents).padStart(14)}  projeto ${r.com_projeto}`
    );
  }
} finally {
  await pool.end();
}
