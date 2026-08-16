// Traz as metas de orçamento do erp-obras para fin_budget_target.
//
// São 124 metas de 2026: 111 mensais, 12 trimestrais e 1 anual, somando
// R$ 634.500,00 de teto declarado. É o "orçado" que faltava para a plataforma
// responder "estou dentro ou fora do que planejei".
//
// ---------------------------------------------------------------------------
// O MAPEAMENTO É HONESTO SOBRE O QUE NÃO SABE
// ---------------------------------------------------------------------------
// O plano de contas do erp-obras tem 19 categorias; o modelo de gestão daqui tem
// 91 linhas. Eles não se correspondem um a um, e fingir que sim produziria um
// "orçado × realizado" que compara coisas diferentes.
//
// Por isso a migration 0058 trouxe fin_budget_category_map com o grau de cada
// correspondência declarado:
//
//   exato          "Contabilidade" → juridico-contabil, "Software" → cloud-servico
//   aproximado     "Salários" → equipe-obras (a meta cobre mais que a linha)
//   indeterminado  "Comissões", "Reembolsos", "Outros custos operacionais"
//   recusado       "Pagamento de Fatura" — não é despesa, é liquidação de cartão
//
// A meta indeterminada ENTRA mesmo assim, com line_slug nulo e o motivo gravado.
// Deixá-la de fora esconderia orçamento que existe; ligá-la a uma linha errada
// contaminaria a comparação. O CHECK fin_budget_destino_coerente garante que
// line_slug e mapeamento não se contradigam.
//
// Uso:
//   node scripts/importar-orcamento-erp.mjs            dry-run
//   node scripts/importar-orcamento-erp.mjs --aplicar
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function erpUrl() {
  const path = ['.env.obras', resolve(process.cwd(), '.env.obras')].find((p) => existsSync(p));
  if (!path) throw new Error('.env.obras não encontrado');
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('DIRECT_URL=')) continue;
    let v = line.slice('DIRECT_URL='.length).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  throw new Error('DIRECT_URL ausente no .env.obras');
}

// Lê do erp-obras com a trava de somente-leitura na sessão.
const erp = new pg.Client({ connectionString: erpUrl(), ssl: { rejectUnauthorized: false } });
await erp.connect();
await erp.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
const { rows: [ro] } = await erp.query('SHOW transaction_read_only');
if (ro.transaction_read_only !== 'on') throw new Error('trava read-only não pegou — abortando');

const { rows: metas } = await erp.query(
  `SELECT categoria, tipo, ano, mes, valor FROM "MetaOrcamentoCategoria" ORDER BY categoria, ano, mes`
);
await erp.end();

console.log(`\n[erp] ${metas.length} meta(s) de orçamento`);

const pool = financePool();
try {
  const { rows: [ent] } = await pool.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  const { rows: mapa } = await pool.query(
    `SELECT source_categoria, line_slug, mapeamento, motivo FROM fin_budget_category_map WHERE source='erp_obras'`
  );
  const porCategoria = new Map(mapa.map((m) => [m.source_categoria, m]));

  const resumo = new Map();
  let gravadas = 0;
  let recusadas = 0;

  for (const m of metas) {
    const mp = porCategoria.get(m.categoria);
    if (!mp) {
      resumo.set('sem mapa', (resumo.get('sem mapa') ?? 0) + 1);
      continue;
    }
    if (mp.mapeamento === 'recusado') {
      recusadas += 1;
      resumo.set('recusado', (resumo.get('recusado') ?? 0) + 1);
      continue;
    }

    // ERP: MENSAL/TRIMESTRAL/ANUAL com `mes`. Aqui: periodicidade + periodo,
    // e o CHECK exige periodo=0 no anual, 1..4 no trimestral, 1..12 no mensal.
    const periodicidade = m.tipo === 'MENSAL' ? 'mensal' : m.tipo === 'TRIMESTRAL' ? 'trimestral' : 'anual';
    const periodo = periodicidade === 'anual' ? 0
                  : periodicidade === 'trimestral' ? Math.max(1, Math.ceil(Number(m.mes || 1) / 3))
                  : Math.min(12, Math.max(1, Number(m.mes || 1)));
    const cents = Math.round(Number(m.valor) * 100);

    resumo.set(mp.mapeamento, (resumo.get(mp.mapeamento) ?? 0) + 1);
    if (!APLICAR) { gravadas += 1; continue; }

    await pool.query(
      `INSERT INTO fin_budget_target (
         entity_id, escopo, line_slug, mapeamento, mapeamento_motivo,
         periodicidade, ano, periodo, valor_cents, origem, source_categoria, motivo, updated_by)
       VALUES ($1,'obras',$2,$3,$4,$5,$6,$7,$8,'erp_obras',$9,$10,'importar-orcamento-erp')
       ON CONFLICT DO NOTHING`,
      [ent.id, mp.line_slug, mp.mapeamento, mp.motivo,
       periodicidade, Number(m.ano), periodo, cents, m.categoria,
       `Meta ${m.tipo} do erp-obras para "${m.categoria}"`]
    );
    gravadas += 1;
  }

  console.log('\n  por grau de mapeamento:');
  for (const [k, v] of [...resumo].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
  console.log(`\n  ${gravadas} meta(s) ${APLICAR ? 'gravada(s)' : 'seriam gravadas'} · ${recusadas} recusada(s) por natureza`);

  if (APLICAR) {
    const { rows: [tot] } = await pool.query(
      `SELECT count(*) AS n, to_char(sum(valor_cents)/100.0,'FM999G999G999D00') AS total
         FROM fin_budget_target`);
    console.log(`  fin_budget_target: ${tot.n} linha(s), R$ ${tot.total} de teto declarado\n`);
  } else {
    console.log('\n[dry-run] nada gravado. Use --aplicar.\n');
  }
} finally {
  await pool.end();
}
