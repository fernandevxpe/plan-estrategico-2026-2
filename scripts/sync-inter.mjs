// Sync do Banco Inter: API Banking → data/raw/inter-extrato.json
//
// Separado da importação para o banco (scripts/import-inter.mjs) pelo mesmo
// motivo do Asaas: uma carga que falha no meio se reexecuta sem bater na API de
// novo, e o JSON bruto fica diffável quando um número na tela não bate.
//
// O que este script substitui: alguém entrando no Internet Banking, baixando OFX
// e arrastando para a tela de importação. Enquanto isso dependia de memória
// humana, o extrato atrasava — e é exatamente por isso que existe o alarme de
// "extrato parado há N dias".
//
// Uso:
//   node scripts/sync-inter.mjs              janela incremental (45 dias)
//   node scripts/sync-inter.mjs --full       histórico inteiro (INTER_HISTORICO_DESDE)
//   node scripts/sync-inter.mjs --desde=2026-01-01
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { loadEnv } from './lib/env.mjs';
import { createInterClient, fatiarPeriodo } from './lib/inter.mjs';
import { rawDirUrl, ensureDataDirs } from './lib/paths.mjs';

ensureDataDirs();
loadEnv();

const ARQUIVO = 'inter-extrato.json';
const FULL = process.argv.includes('--full') || process.env.INTER_FULL_SYNC === '1';
const argDesde = process.argv.find((a) => a.startsWith('--desde='))?.slice('--desde='.length);
const JANELA_DIAS = Number(process.env.INTER_SYNC_WINDOW_DAYS ?? 45);
/** O módulo financeiro começa em 2025-09; antes disso não há contrapartida. */
const HISTORICO_DESDE = process.env.INTER_HISTORICO_DESDE ?? '2025-09-01';

const hoje = new Date();
const iso = (d) => d.toISOString().slice(0, 10);

function inicioDoPeriodo() {
  if (argDesde) return argDesde;
  if (FULL) return HISTORICO_DESDE;
  return iso(new Date(hoje.getTime() - JANELA_DIAS * 86_400_000));
}

const inicio = inicioDoPeriodo();
const fim = iso(hoje);

const outDir = rawDirUrl;
await mkdir(outDir, { recursive: true });

async function lerAnterior() {
  try {
    return JSON.parse(await readFile(new URL(ARQUIVO, outDir), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Chave de deduplicação: o `idTransacao` do extrato completo.
 *
 * O extrato simples (`/banking/v2/extrato`) não traz identificador — só data,
 * tipo, valor e descrição. Dois PIX iguais no mesmo dia ficariam
 * indistinguíveis e um deles seria apagado na deduplicação: na primeira carga,
 * 150 transações da API viravam 142. Por isso o sync usa `/extrato/completo`.
 *
 * O fallback por conteúdo só existe para transação sem id — se acontecer, é
 * melhor arriscar um merge do que deixar o sync quebrar.
 */
function chaveTransacao(t) {
  if (t.idTransacao) return `id:${t.idTransacao}`;
  return [
    'conteudo',
    t.dataTransacao ?? t.dataEntrada ?? '',
    t.tipoTransacao ?? '',
    t.tipoOperacao ?? '',
    t.valor ?? '',
    (t.titulo ?? '').trim(),
    (t.descricao ?? '').trim()
  ].join('|');
}

const client = createInterClient();
const janelas = fatiarPeriodo(inicio, fim);

console.log(`[inter] extrato de ${inicio} a ${fim} (${janelas.length} janela(s))`);

const coletadas = [];
for (const [i, janela] of janelas.entries()) {
  const lista = await client.extratoCompleto(janela.inicio, janela.fim, {
    onPagina: ({ pagina, totalPaginas, nesta }) => {
      if (totalPaginas > 1) console.log(`      página ${pagina}/${totalPaginas}: ${nesta}`);
    }
  });
  coletadas.push(...lista);
  console.log(`  [${i + 1}/${janelas.length}] ${janela.inicio} → ${janela.fim}: ${lista.length}`);
}

const semId = coletadas.filter((t) => !t.idTransacao).length;
if (semId) console.warn(`[inter] ${semId} transação(ões) sem idTransacao — deduplicadas por conteúdo`);

// Une com o que já existia: a janela incremental não enxerga o histórico, e
// sobrescrever o arquivo com 45 dias apagaria o resto.
const anterior = await lerAnterior();
const porChave = new Map();
for (const t of anterior?.data ?? []) porChave.set(chaveTransacao(t), t);
const antesDoMerge = porChave.size;
for (const t of coletadas) porChave.set(chaveTransacao(t), t);

const transacoes = [...porChave.values()].sort((a, b) =>
  String(a.dataTransacao ?? a.dataEntrada ?? '').localeCompare(String(b.dataTransacao ?? b.dataEntrada ?? ''))
);

let saldo = null;
try {
  saldo = await client.saldo();
} catch (e) {
  // Saldo é conferência, não o dado principal: não vale derrubar o sync.
  console.warn(`[inter] saldo indisponível (${e.message}) — extrato salvo mesmo assim`);
}

await writeFile(
  new URL(ARQUIVO, outDir),
  JSON.stringify(
    {
      syncedAt: new Date().toISOString(),
      periodo: { inicio, fim, full: FULL },
      saldo,
      data: transacoes
    },
    null,
    2
  )
);

const novas = porChave.size - antesDoMerge;
console.log(
  `[inter] ${transacoes.length} transação(ões) no arquivo (${novas} nova(s)) → data/raw/${ARQUIVO}`
);
