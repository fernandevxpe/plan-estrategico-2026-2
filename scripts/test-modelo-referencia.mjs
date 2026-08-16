// Prova o caminho de sucesso do importador da planilha sem persistir nada.
//
// O workbook disponível não é a fonte do modelo atual — corretamente, o
// importador o recusa com 1/87 rótulos. Para exercitar também o caminho válido,
// este teste reduz TEMPORARIAMENTE o modelo a uma única linha que o workbook
// realmente contém, roda a importação duas vezes na mesma conexão fixada e
// desfaz tudo no final. A segunda foto precisa ser idêntica à primeira.
//
// Se a 0082 ainda estiver pendente, ela é carregada dentro da mesma transação.
// Nenhuma migration é registrada como aplicada por este teste.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  financeDatabaseUrl,
  pinFinanceClient,
  unpinFinanceClient
} from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const url = financeDatabaseUrl();
if (!url) throw new Error('FINANCE_DATABASE_URL não configurada');

const workbook = fileURLToPath(new URL('../Projeção Financeira_v3.1 (2).xlsx', import.meta.url));
const migration = fileURLToPath(new URL('../db/migrations/0082_fin_modelo_referencia_proveniencia.sql', import.meta.url));
const artefato = 'Projeção Financeira_v3.1 (2).xlsx';
const aba = 'Resumão Geral';

const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 20_000,
  application_name: 'fin-test-modelo-referencia',
  ssl: { rejectUnauthorized: false }
});

const client = await pool.connect();
let fixado = false;

function igual(a, b, mensagem) {
  if (String(a) !== String(b)) throw new Error(`${mensagem}: ${a} != ${b}`);
}

async function fotoDaFonte() {
  const { rows: [r] } = await client.query(
    `SELECT count(*)::int AS celulas,
            COALESCE(sum(abs(valor_cents)), 0)::bigint AS massa_cents,
            count(*) FILTER (
              WHERE origem_status = 'rastreada'
                AND origem_checksum_sha256 ~ '^[0-9a-f]{64}$'
            )::int AS rastreadas
       FROM fin_model_value
      WHERE procedencia = 'referencia'
        AND ano = 2026
        AND origem_artefato = $1
        AND origem_aba = $2`,
    [artefato, aba]
  );
  return r;
}

async function importar(rodada) {
  const argv = process.argv;
  const exitCode = process.exitCode;
  process.argv = [argv[0], 'scripts/import-modelo-referencia.mjs', workbook, '--aba', aba, '--ano', '2026', '--aplicar'];
  process.exitCode = undefined;
  try {
    await import(`./import-modelo-referencia.mjs?teste-modelo=${rodada}-${Date.now()}`);
    if (process.exitCode) throw new Error(`importador terminou com código ${process.exitCode}`);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
  }
}

try {
  await client.query('BEGIN');
  await client.query(`SET LOCAL lock_timeout = '20s'`);
  await client.query(`SET LOCAL statement_timeout = '180s'`);
  await client.query(`SET LOCAL idle_in_transaction_session_timeout = '240s'`);

  const { rows: [temOrigem] } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'fin_model_value'
          AND column_name = 'origem_status'
     ) AS ok`
  );
  if (!temOrigem.ok) await client.query(await readFile(migration, 'utf8'));

  const { rows: [linha] } = await client.query(
    `SELECT l.id, l.slug
       FROM fin_model_line l JOIN fin_entity e ON e.id = l.entity_id
      WHERE e.slug = 'xpe' AND l.origem_linha = 9
      ORDER BY l.id LIMIT 1`
  );
  if (!linha) throw new Error('linha de ensaio (origem_linha=9) não encontrada');

  const { rows: [manualAntes] } = await client.query(
    `SELECT count(*)::int AS n, COALESCE(sum(abs(valor_cents)), 0)::bigint AS massa
       FROM fin_model_value WHERE procedencia = 'manual'`
  );

  // Faz uma cópia estrutural mínima dentro do rollback: 1/1 rótulo casa e a
  // linha 9 do Resumão tem doze células mensais numéricas.
  await client.query(
    `UPDATE fin_model_line l
        SET origem_linha = NULL
       FROM fin_entity e
      WHERE e.id = l.entity_id AND e.slug = 'xpe'`
  );
  await client.query(
    `UPDATE fin_model_line
        SET origem_linha = 9, name = 'Assinaturas', kind = 'item', section = 'receita'
      WHERE id = $1`,
    [linha.id]
  );

  pinFinanceClient(client);
  fixado = true;

  await importar(1);
  const primeira = await fotoDaFonte();
  if (Number(primeira.celulas) === 0) throw new Error('primeira foto não gravou células');
  igual(primeira.celulas, primeira.rastreadas, 'célula sem proveniência completa');

  await importar(2);
  const segunda = await fotoDaFonte();
  igual(primeira.celulas, segunda.celulas, 'segunda importação mudou a contagem');
  igual(primeira.massa_cents, segunda.massa_cents, 'segunda importação mudou a massa monetária');
  igual(segunda.celulas, segunda.rastreadas, 'segunda foto perdeu proveniência');

  const { rows: [manualDepois] } = await client.query(
    `SELECT count(*)::int AS n, COALESCE(sum(abs(valor_cents)), 0)::bigint AS massa
       FROM fin_model_value WHERE procedencia = 'manual'`
  );
  igual(manualAntes.n, manualDepois.n, 'importação tocou a contagem manual');
  igual(manualAntes.massa, manualDepois.massa, 'importação tocou o valor manual');

  const { rows: [auditoria] } = await client.query(
    `SELECT count(*)::int AS n
       FROM fin_audit_log
      WHERE actor = 'import-modelo-referencia'
        AND after->>'origem_artefato' = $1
        AND after->>'origem_aba' = $2`,
    [artefato, aba]
  );
  if (Number(auditoria.n) < 2) throw new Error('as duas fotos não deixaram trilha agregada');

  console.log('✓ primeira foto rastreada:', primeira);
  console.log('✓ segunda foto idêntica:', segunda);
  console.log('✓ valores manuais intactos e duas trilhas de importação presentes');
  console.log('✓ nada persistido: ensaio inteiro termina em ROLLBACK');
} finally {
  if (fixado) unpinFinanceClient();
  await client.query('ROLLBACK').catch(() => {});
  client.release();
  await pool.end();
}
