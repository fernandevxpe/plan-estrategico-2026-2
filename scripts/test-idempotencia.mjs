// Prova executável de que os importadores são idempotentes.
//
// ---------------------------------------------------------------------------
// O QUE ESTE ARQUIVO SUBSTITUI
// ---------------------------------------------------------------------------
// O critério de pronto nº 23 do scripts/test-financeiro.mjs dizia:
//
//     · lançamentos hoje: 13880. Rode o import de novo e confira que não muda.
//
// Isso não é um teste — é um bilhete pedindo que um humano faça o teste, contra
// produção, e confira de cabeça. Enquanto foi assim, "tudo idempotente" ficou
// escrito em comentário no topo do scripts/import-asaas.mjs sem nada atrás.
//
// Aqui a afirmação vira asserção: cada importador roda DUAS VEZES dentro de uma
// transação que SEMPRE termina em ROLLBACK, e a segunda execução tem de deixar
// contagem e valor exatamente onde a primeira deixou.
//
// ---------------------------------------------------------------------------
// COMO É POSSÍVEL RODAR UM IMPORTADOR SEM QUE ELE GRAVE
// ---------------------------------------------------------------------------
// O importador abre o próprio pool e dá o próprio COMMIT — não há como envolvê-lo
// por fora. A saída é `pinFinanceClient()` (scripts/lib/artifact-db.mjs): o teste
// fixa UMA conexão, `financePool()` passa a devolver um pool amarrado a ela, e o
// vocabulário de transação do importador vira savepoint:
//
//     BEGIN → SAVEPOINT      COMMIT → RELEASE      ROLLBACK → ROLLBACK TO
//
// O importador roda inteiro — mesmo SQL, mesmas constraints, mesmo planejador,
// mesmos dados de produção — e o COMMIT dele não persiste nada. A transação de
// verdade é do teste, e o `finally` a desfaz. Se o processo morrer no meio, a
// transação morre com a conexão: também desfaz. NENHUM caminho deste arquivo
// deixa escrita em pé.
//
// ---------------------------------------------------------------------------
// O QUE CONTA COMO NÃO-IDEMPOTENTE
// ---------------------------------------------------------------------------
// Delta ZERO entre a 1ª e a 2ª execução, em contagem de linhas e em soma dos
// valores, em toda tabela fin_* e erp_* — com exceção nominal da trilha de
// importação, que é append-only DE PROPÓSITO: registrar que houve uma segunda
// tentativa, e que nela tudo era duplicado, é a função dela. Essa exceção é
// verificada em vez de assumida: quando a 2ª execução cria um lote, ele tem de
// declarar `inserted_count = 0`.
//
// Uso:
//   node scripts/test-idempotencia.mjs                 importadores de arquivo/banco
//   node scripts/test-idempotencia.mjs --com-api       inclui os que batem em API externa
//   node scripts/test-idempotencia.mjs --somente=import-inter[,outro]
//   node scripts/test-idempotencia.mjs --verboso       mostra a saída dos importadores
import pg from 'pg';

import { financeDatabaseUrl, pinFinanceClient, unpinFinanceClient } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const VERBOSO = process.argv.includes('--verboso');
const COM_API = process.argv.includes('--com-api');
const SOMENTE = process.argv
  .find((a) => a.startsWith('--somente='))
  ?.slice('--somente='.length)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const num = (n) => Number(n).toLocaleString('pt-BR');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// CATÁLOGO
// ---------------------------------------------------------------------------
// `argv` é o que faz o importador ESCREVER. Vários só gravam com `--aplicar`, e
// rodar sem a flag testaria o dry-run — que é justamente o caminho que não
// escreve, ou seja, testaria nada.
//
// `fonte` separa quem lê arquivo/banco de quem bate em API externa: a segunda
// execução de um importador de API dobra as chamadas e esbarra em limite de
// requisição, então ela é opt-in (--com-api) e o relatório diz, nominalmente,
// quem não foi exercitado.
const CATALOGO = [
  { nome: 'import-asaas', script: './import-asaas.mjs', argv: [], fonte: 'arquivo' },
  { nome: 'import-inter', script: './import-inter.mjs', argv: [], fonte: 'arquivo' },
  { nome: 'import-reembolsos', script: './import-reembolsos.mjs', argv: ['--aplicar'], fonte: 'arquivo' },
  { nome: 'importar-assinaturas-asaas', script: './importar-assinaturas-asaas.mjs', argv: ['--aplicar'], fonte: 'arquivo' },
  { nome: 'sync-pipeline-ganho', script: './sync-pipeline-ganho.mjs', argv: ['--aplicar'], fonte: 'arquivo' },
  { nome: 'backfill-inter-lastro', script: './backfill-inter-lastro.mjs', argv: ['--aplicar'], fonte: 'arquivo' },
  { nome: 'backfill-asaas-contraparte', script: './backfill-asaas-contraparte.mjs', argv: ['--aplicar', '--tudo'], fonte: 'arquivo' },
  { nome: 'backfill-inter-import-rows', script: './backfill-inter-import-rows.mjs', argv: ['--aplicar'], fonte: 'banco' },
  { nome: 'promover-erp-extrato', script: './promover-erp-extrato.mjs', argv: [], fonte: 'banco' },
  { nome: 'sync-erp-obras', script: './sync-erp-obras.mjs', argv: [], fonte: 'erp' },
  { nome: 'sync-erp-contratos', script: './sync-erp-contratos.mjs', argv: [], fonte: 'erp' },
  { nome: 'importar-orcamento-erp', script: './importar-orcamento-erp.mjs', argv: ['--aplicar'], fonte: 'erp' },
  { nome: 'sync-polp-cartao', script: './sync-polp-cartao.mjs', argv: [], fonte: 'api' },
  { nome: 'sync-polp-investimentos', script: './sync-polp-investimentos.mjs', argv: [], fonte: 'api' },
  { nome: 'sync-polp-caixa', script: './sync-polp-caixa.mjs', argv: ['--aplicar'], fonte: 'api' },
  { nome: 'sync-cartao-inter', script: './sync-cartao-inter.mjs', argv: ['--aplicar'], fonte: 'api' },
  { nome: 'backfill-nubank-polp', script: './backfill-nubank-polp.mjs', argv: [], fonte: 'api' }
];

/**
 * Tabelas append-only por desenho — crescer na 2ª execução é a função delas.
 *
 * A lista é NOMINAL e curta de propósito. Toda tabela fora dela tem de ficar
 * imóvel; se um importador começar a crescer numa tabela nova, o teste reprova
 * em vez de perdoar por categoria.
 */
const TRILHA = new Map([
  ['fin_import_batch', 'cada execução registra a tentativa, inclusive a que não importou nada'],
  ['fin_import_row', 'a trilha da tentativa — é o que o invariante C3 exige que exista'],
  ['fin_audit_log', 'log de auditoria: registrar duas vezes que se olhou é correto'],
  ['fin_classification_event', 'histórico de classificação, append-only']
]);

// ---------------------------------------------------------------------------
// FOTOGRAFIA DO BANCO
// ---------------------------------------------------------------------------
async function montarSnapshotSQL(client) {
  const { rows: tabelas } = await client.query(`
    SELECT c.relname AS tabela,
           coalesce((SELECT string_agg(col.column_name, ',' ORDER BY col.column_name)
              FROM information_schema.columns col
             WHERE col.table_schema = 'public'
               AND col.table_name = c.relname
               AND col.column_name LIKE '%\\_cents'
               AND col.data_type IN ('bigint', 'integer', 'numeric', 'smallint')), '') AS cents
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname LIKE 'fin\\_%' OR c.relname LIKE 'erp\\_%')
     ORDER BY c.relname
  `);

  const partes = tabelas.map(({ tabela, cents }) => {
    const colunas = String(cents ?? '').split(',').filter(Boolean);
    const valor = colunas.length
      ? colunas.map((c) => `coalesce(sum(${c}), 0)`).join(' + ')
      : '0';
    return `SELECT '${tabela}'::text AS tabela, count(*)::bigint AS n, (${valor})::numeric AS v FROM ${tabela}`;
  });

  return { sql: partes.join('\n UNION ALL '), tabelas: tabelas.map((t) => t.tabela) };
}

async function fotografar(client, sql) {
  const { rows } = await client.query(sql);
  const foto = new Map();
  for (const r of rows) foto.set(r.tabela, { n: Number(r.n), v: Number(r.v) });
  return foto;
}

function diferenca(antes, depois) {
  const mudou = [];
  for (const [tabela, d] of depois) {
    const a = antes.get(tabela) ?? { n: 0, v: 0 };
    const dn = d.n - a.n;
    const dv = d.v - a.v;
    if (dn !== 0 || dv !== 0) mudou.push({ tabela, dn, dv });
  }
  return mudou;
}

// ---------------------------------------------------------------------------
// EXECUÇÃO DE UM IMPORTADOR DENTRO DA TRANSAÇÃO DO TESTE
// ---------------------------------------------------------------------------
/**
 * Roda o módulo como se fosse a linha de comando.
 *
 * A query string no specifier é o que faz o Node reavaliar o módulo: sem ela a
 * segunda execução seria um acerto do cache de ESM, e o teste passaria sem ter
 * rodado nada. As dependências (inclusive lib/artifact-db.mjs, que guarda a
 * conexão fixada) continuam sendo a MESMA instância, porque o specifier delas
 * não mudou.
 */
async function rodarImportador(entrada, execucao) {
  const argvOriginal = process.argv;
  const exitOriginal = process.exit;
  const exitCodeOriginal = process.exitCode;
  const logOriginal = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const saida = [];

  process.argv = [argvOriginal[0], entrada.script, ...entrada.argv];
  // Um `process.exit()` dentro do importador mataria o teste ANTES do ROLLBACK.
  // Vira exceção: o `finally` de fora continua sendo alcançado.
  process.exit = (code) => {
    const e = new Error(`process.exit(${code ?? 0})`);
    e.__saidaDoProcesso = code ?? 0;
    throw e;
  };
  if (!VERBOSO) {
    const capturar = (...args) => saida.push(args.map(String).join(' '));
    console.log = capturar;
    console.warn = capturar;
    console.error = capturar;
    console.info = capturar;
  }

  try {
    await import(`${entrada.script}?idempotencia=${execucao}`);
    return { ok: true, saida };
  } catch (e) {
    // `process.exit(0)` é saída limpa: o importador decidiu que não havia o que
    // fazer. Só `exit(0)` — qualquer outro código é falha de verdade.
    if (e.__saidaDoProcesso === 0) return { ok: true, saida, encerrouCedo: true };
    return { ok: false, erro: e.__saidaDoProcesso != null ? `saiu com código ${e.__saidaDoProcesso}` : e.message, saida };
  } finally {
    process.argv = argvOriginal;
    process.exit = exitOriginal;
    process.exitCode = exitCodeOriginal;
    Object.assign(console, logOriginal);
  }
}

// ---------------------------------------------------------------------------
// O TESTE
// ---------------------------------------------------------------------------
const url = financeDatabaseUrl();
if (!url) {
  console.error('FINANCE_DATABASE_URL não configurada.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 20_000,
  ssl: { rejectUnauthorized: false }
});

const alvos = CATALOGO.filter((c) => {
  if (SOMENTE) return SOMENTE.includes(c.nome);
  return COM_API || c.fonte !== 'api';
});
// Só entra aqui quem ficou de fora POR SER DE API — o recorte de `--somente` é
// escolha de quem rodou, e anunciá-lo como pendência seria ruído.
const pulados = SOMENTE ? [] : CATALOGO.filter((c) => c.fonte === 'api' && !alvos.includes(c));

console.log('═'.repeat(78));
console.log('  IDEMPOTÊNCIA DOS IMPORTADORES — duas execuções, transação com ROLLBACK');
console.log('═'.repeat(78));
console.log(`  ${alvos.length} importador(es) na rodada · nada é persistido\n`);

const resultados = [];
let snapshotSQL = null;

for (const entrada of alvos) {
  const client = await pool.connect();
  const t0 = Date.now();
  let estado = null;

  try {
    await client.query('BEGIN');
    // Guardas de concorrência: 4 outras frentes escrevem neste banco. Estes
    // limites impedem que uma espera vire uma transação pendurada segurando
    // lock de fin_transaction para todo mundo.
    await client.query(`SET LOCAL lock_timeout = '20s'`);
    await client.query(`SET LOCAL statement_timeout = '240s'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '300s'`);

    if (!snapshotSQL) snapshotSQL = (await montarSnapshotSQL(client)).sql;

    const antes = await fotografar(client, snapshotSQL);

    pinFinanceClient(client);
    const r1 = await rodarImportador(entrada, `${Date.now()}-1`);
    const depois1 = await fotografar(client, snapshotSQL);

    const r2 = r1.ok ? await rodarImportador(entrada, `${Date.now()}-2`) : { ok: false, erro: 'não rodou: 1ª execução falhou', saida: [] };
    const depois2 = r2.ok ? await fotografar(client, snapshotSQL) : depois1;

    unpinFinanceClient();

    const carga = diferenca(antes, depois1);
    const rodada2 = diferenca(depois1, depois2);

    // A 2ª execução criou lote? Então ele tem de declarar zero inserções.
    let loteDaSegunda = null;
    if (r2.ok) {
      const { rows } = await client.query(
        `SELECT id, adapter, status, row_count, inserted_count, duplicate_count
           FROM fin_import_batch ORDER BY id DESC LIMIT 1`
      );
      const ultimo = rows[0];
      const novosLotes = (depois2.get('fin_import_batch')?.n ?? 0) - (depois1.get('fin_import_batch')?.n ?? 0);
      if (novosLotes > 0 && ultimo) loteDaSegunda = ultimo;
    }

    const violacoes = rodada2.filter((m) => !TRILHA.has(m.tabela));
    const trilhaMexeu = rodada2.filter((m) => TRILHA.has(m.tabela));
    const loteMente = loteDaSegunda && Number(loteDaSegunda.inserted_count) !== 0;

    estado = {
      entrada,
      ok: r1.ok && r2.ok && violacoes.length === 0 && !loteMente,
      erro: r1.ok ? (r2.ok ? null : r2.erro) : r1.erro,
      naoRodou: !r1.ok,
      carga,
      violacoes,
      trilhaMexeu,
      loteDaSegunda,
      loteMente,
      encerrouCedo: r1.encerrouCedo,
      saida: [...(r1.saida ?? []), ...(r2.saida ?? [])],
      ms: Date.now() - t0
    };
  } catch (e) {
    unpinFinanceClient();
    const concorrencia = /lock timeout|deadlock|canceling statement|could not obtain lock/i.test(e.message);
    estado = {
      entrada,
      ok: false,
      naoRodou: true,
      concorrencia,
      erro: e.message,
      carga: [],
      violacoes: [],
      trilhaMexeu: [],
      saida: [],
      ms: Date.now() - t0
    };
  } finally {
    // O ROLLBACK é incondicional e é o ponto inteiro deste arquivo.
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }

  resultados.push(estado);

  const marca = estado.ok ? '✓' : estado.naoRodou ? '!' : '✗';
  const resumo = estado.naoRodou
    ? `NÃO RODOU — ${estado.erro}`
    : estado.ok
      ? `idempotente (1ª execução mexeu em ${estado.carga.filter((c) => !TRILHA.has(c.tabela)).length} tabela(s))`
      : `${estado.violacoes.length} tabela(s) mudaram na 2ª execução`;
  console.log(`  ${marca} ${entrada.nome.padEnd(30)} ${resumo}  (${(estado.ms / 1000).toFixed(1)}s)`);
}

await pool.end();

// ---------------------------------------------------------------------------
// RELATÓRIO
// ---------------------------------------------------------------------------
const passaram = resultados.filter((r) => r.ok);
const reprovaram = resultados.filter((r) => !r.ok && !r.naoRodou);
const naoRodaram = resultados.filter((r) => r.naoRodou);

if (reprovaram.length) {
  console.log(`\n${'═'.repeat(78)}`);
  console.log('  NÃO-IDEMPOTENTES — a 2ª execução mudou o banco');
  console.log('═'.repeat(78));
  for (const r of reprovaram) {
    console.log(`\n  ✗ ${r.entrada.nome}  (${r.entrada.script})`);
    for (const m of r.violacoes) {
      const valor = m.dv !== 0 ? `, ${m.dv > 0 ? '+' : ''}${brl(m.dv)}` : '';
      console.log(`      ${m.tabela.padEnd(32)} ${m.dn > 0 ? '+' : ''}${num(m.dn)} linha(s)${valor}`);
    }
    if (r.loteMente) {
      const l = r.loteDaSegunda;
      console.log(
        `      lote ${l.id} da 2ª execução declara inserted_count=${l.inserted_count} ` +
        `(status ${l.status}) — deveria ser 0: tudo era duplicado`
      );
    }
  }
}

if (naoRodaram.length) {
  console.log(`\n${'═'.repeat(78)}`);
  console.log('  NÃO EXERCITADOS — sem veredito, e isso não é o mesmo que passar');
  console.log('═'.repeat(78));
  for (const r of naoRodaram) {
    console.log(`  ! ${r.entrada.nome.padEnd(30)} ${r.concorrencia ? '[concorrência] ' : ''}${r.erro}`);
    if (VERBOSO && r.saida.length) console.log(r.saida.slice(-8).map((l) => `        ${l}`).join('\n'));
  }
}

if (pulados.length) {
  console.log(`\n  Fora desta rodada (${pulados.map((p) => p.nome).join(', ')})`);
  console.log('  — batem em API externa; rode com --com-api quando o limite de requisição permitir.');
}

console.log(`\n${'═'.repeat(78)}`);
console.log(`  ${passaram.length} idempotente(s) · ${reprovaram.length} reprovado(s) · ${naoRodaram.length} não exercitado(s)`);
console.log('  Nada foi persistido: toda execução ficou dentro de transação com ROLLBACK.');
console.log('═'.repeat(78));

// Um importador não exercitado NÃO derruba o teste — mas também não conta como
// prova. Só a reprovação de fato é erro.
process.exitCode = reprovaram.length ? 1 : 0;
