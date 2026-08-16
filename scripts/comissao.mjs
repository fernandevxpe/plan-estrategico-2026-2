// Comissionamento de vendas: mede a alíquota, liga a comissão paga ao negócio,
// prevê o que ainda vai sair e faz o backtest da regra contra o que já saiu.
//
// ---------------------------------------------------------------------------
// POR QUE ESTE SCRIPT PRECISA DO erp-obras, E NÃO SÓ DO LEDGER
// ---------------------------------------------------------------------------
// No ledger financeiro a comissão é INVISÍVEL: zero lançamentos na categoria
// 4.01 "Comissão paga a vendedor" e zero com "comiss" na descrição. Ela chega
// como PIX sem identificação, no mesmo dia e para a mesma pessoa que recebe o
// fixo, e está classificada em 6.02 Pró-labore (sócios) ou 6.01 Salários (MEI).
//
// Quem sabe que aquele PIX era comissão — e de qual obra — é o erp-obras, em
// `LancamentoFinanceiro` categoria "Comissões", onde um humano rateou cada
// transferência por projeto. Um PIX de R$ 4.629,00 para o Jonildo em 03/08/2026
// virou sete linhas, uma por contrato. É esse rateio que este script traz.
//
// O erp-obras é SOMENTE LEITURA. A trava é declarativa na sessão e é conferida
// antes de qualquer consulta.
//
// ---------------------------------------------------------------------------
// O QUE ESTE SCRIPT NÃO FAZ
// ---------------------------------------------------------------------------
// Não reclassifica nada. A comissão continua onde está (6.01/6.02) e o script
// apenas GRAVA em que categoria ela está, para que a decisão fiscal — comissão
// a sócio é pró-labore ou é custo variável de venda? — seja tomada por quem
// pode tomá-la. Ver docs/AGENTE_FINANCEIRO.md §8 e a migration 0050.
//
// Uso:
//   node scripts/comissao.mjs                 dry-run (padrão): mede e relata
//   node scripts/comissao.mjs --backtest      só o backtest da regra
//   node scripts/comissao.mjs --validar       exercita a escrita em transação com ROLLBACK
//   node scripts/comissao.mjs --aplicar       grava em fin_comissao_*
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const SO_BACKTEST = process.argv.includes('--backtest');
// --validar exercita EXATAMENTE o caminho de escrita, dentro de uma transação
// que termina sempre em ROLLBACK, aplicando a migration 0076 junto. Serve para
// provar que o INSERT cabe no schema sem escrever uma linha em produção.
const VALIDAR = process.argv.includes('--validar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n) => (n == null ? '—' : `${(Number(n) * 100).toFixed(2)}%`);
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const norm = (s) =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Tolerância para dizer que duas bases implícitas são "a mesma". Medido: os
// pares que fecham ficam em 0,00%, 0,08% e 0,29%; o par que não fecha fica em
// 233%. Qualquer corte entre 1% e 100% dá o mesmo resultado; 2% é folga.
const TOLERANCIA_BASE = 0.02;

const PAPEL_POR_SUBCATEGORIA = {
  Vendedor: 'vendedor',
  'Eng. comercial': 'eng_comercial',
  'Execução / gestão': 'execucao'
};

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

// ---------------------------------------------------------------------------
// 1. Leitura do erp-obras (read-only travado)
// ---------------------------------------------------------------------------
const erp = new pg.Client({ connectionString: erpUrl(), ssl: { rejectUnauthorized: false } });
await erp.connect();
await erp.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
const {
  rows: [ro]
} = await erp.query('SHOW transaction_read_only');
if (ro.transaction_read_only !== 'on') throw new Error('trava read-only não pegou — abortando');

const { rows: parametros } = await erp.query(
  `SELECT chave, "valorNumerico"::float8 AS valor, "updatedAt"
     FROM "ParametroGlobal" WHERE grupo = 'faturamento' AND chave LIKE 'comissao%' ORDER BY ordem`
);

const { rows: lancamentos } = await erp.query(`
  SELECT l.id, l.descricao, l.valor::float8 AS valor, l.status, l.movimentacao,
         l."dataVencimento" AS venc, l."dataPagamento" AS pgto, l.beneficiado, l.subcategoria,
         l."projetoId" AS projeto_id, l."contratoId" AS contrato_id,
         l."lancamentoPaiId" AS pai_id, l.origem, l.desconsiderado
    FROM "LancamentoFinanceiro" l
   WHERE l.categoria ILIKE '%comiss%' AND l.movimentacao = 'SAIDA'
   ORDER BY l."dataVencimento", l.id`);

const { rows: projetosPct } = await erp.query(`
  SELECT p.id, p."contratoId" AS contrato_id, p.segmento,
         p."comissaoVendedorPct"::float8 AS vendedor,
         p."comissaoEngComercialPct"::float8 AS eng_comercial,
         p."comissaoExecucaoPct"::float8 AS execucao
    FROM "Projeto" p WHERE p."comissaoVendedorPct" IS NOT NULL`);
await erp.end();

// ---------------------------------------------------------------------------
// 2. Leitura do ledger
// ---------------------------------------------------------------------------
const pool = financePool();
const {
  rows: [entidade]
} = await pool.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
if (!entidade) throw new Error('entidade xpe não encontrada — banco errado?');
const ENTITY = entidade.id;

const { rows: contas } = await pool.query('SELECT count(*)::int AS n FROM fin_account');
if (contas[0].n !== 6) throw new Error(`fin_account tem ${contas[0].n} contas; o ledger certo tem 6 — banco errado`);

const { rows: transacoes } = await pool.query(`
  SELECT t.id, t.posted_on, t.amount_cents, t.description_raw, t.category_id,
         cat.code AS cat_code, t.counterparty_id, cp.name AS cp_nome,
         pc.person_id, pe.name AS pessoa, pe.normalized_name, pe.employment_type
    FROM fin_transaction t
    LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
    LEFT JOIN fin_category cat ON cat.id = t.category_id
    LEFT JOIN fin_person_counterparty pc ON pc.counterparty_id = t.counterparty_id AND pc.status = 'confirmado'
    LEFT JOIN fin_person pe ON pe.id = pc.person_id
   WHERE t.entity_id = $1 AND t.amount_cents < 0 AND t.posted_on >= '2025-01-01'`, [ENTITY]);

const { rows: pessoas } = await pool.query(
  `SELECT id, name, normalized_name, employment_type FROM fin_person WHERE entity_id = $1`, [ENTITY]);

const { rows: contratos } = await pool.query(`
  SELECT c.erp_id, c.titulo, c.eixo, c.nucleo, c.valor_contratado_cents AS valor_cents,
         c.data_assinatura, c.status_erp, c.counterparty_id, c.vendedor
    FROM erp_contrato c ORDER BY c.erp_id`);

const { rows: parcelas } = await pool.query(`
  SELECT p.erp_contrato_id AS contrato_id, p.numero, p.valor_cents, p.data_vencimento,
         d.status AS doc_status, d.settled_cents,
         (SELECT min(t.posted_on) FROM fin_settlement s
            JOIN fin_transaction t ON t.id = s.transaction_id
           WHERE s.document_id = d.id) AS recebido_em
    FROM erp_contrato_parcela p
    LEFT JOIN fin_document d ON d.id = p.fin_document_id
   ORDER BY p.erp_contrato_id, p.numero`);

const { rows: ganhos } = await pool.query(`
  SELECT id, pipedrive_deal_id, titulo, valor_cents, ganho_em, org_nome, counterparty_id
    FROM fin_pipeline_ganho WHERE entity_id = $1`, [ENTITY]);

const { rows: regras } = await pool.query(`
  SELECT id, slug, papel, nucleo, person_id, pct::float8 AS pct, base, parcela_minima,
         tranches, gatilho, defasagem_dias, vigencia_inicio, vigencia_fim, confianca, status
    FROM fin_comissao_regra WHERE entity_id = $1 ORDER BY id`, [ENTITY]).catch(() => ({ rows: [] }));

const { rows: centros } = await pool.query(
  `SELECT id, slug, source_id FROM fin_cost_center WHERE entity_id = $1 AND kind = 'projeto'`, [ENTITY]);

// ---------------------------------------------------------------------------
// 3. Alíquotas em vigor
// ---------------------------------------------------------------------------
// A alíquota de `execucao` tem DUAS respostas: 0% declarado no ERP (alterado em
// 26/07/2026) e 5% medido em três grupos de pagamento até 01/07/2026. O script
// usa a MEDIDA para reconstruir o passado — é a única que reproduz os números
// que saíram do caixa — e reporta o conflito. Trocar para a declarada muda só
// esta constante.
const ALIQUOTA = { vendedor: 0.07, eng_comercial: 0.03, execucao: 0.05 };
const ALIQUOTA_DECLARADA = Object.fromEntries(
  parametros.map((p) => [p.chave.replace('comissao_', '').replace('eng_comercial', 'eng_comercial'), p.valor])
);

console.log('\n=== 1. ALÍQUOTA DECLARADA (erp-obras ParametroGlobal, grupo faturamento) ===');
for (const p of parametros) {
  console.log(`  ${p.chave.padEnd(24)} ${pct(p.valor).padStart(7)}   atualizado ${dia(p.updatedAt)}`);
}
const porTrinca = {};
for (const p of projetosPct) {
  const k = `${p.vendedor}/${p.eng_comercial}/${p.execucao}`;
  porTrinca[k] = (porTrinca[k] || 0) + 1;
}
console.log('  Projeto.comissao*Pct (vendedor/eng/execução → nº de projetos):', porTrinca);

// ---------------------------------------------------------------------------
// 4. Casar cada lançamento de comissão do ERP com a transação do extrato
// ---------------------------------------------------------------------------
// Duas rotas, nesta ordem:
//   a) o lançamento é FILHO de um rateio (`lancamentoPaiId`) → herda a
//      transação do pai. É a rota confiável: o humano dividiu um PIX real.
//   b) o lançamento é solto → casa por valor exato + data ±3 dias, desempatando
//      pelo beneficiado. Ambíguo fica ambíguo; não se escolhe.
//
// ATENÇÃO À DUPLA CONTAGEM. Quando um PIX foi rateado, o ERP guarda o PAI (a
// transferência inteira) E os FILHOS (as partes por projeto), os dois na
// categoria "Comissões". Somar os dois conta o mesmo dinheiro duas vezes: o PIX
// de R$ 4.629,00 do Jonildo viraria R$ 9.258,00. Só as FOLHAS entram na conta.
const temFilho = new Set(lancamentos.filter((l) => l.pai_id).map((l) => l.pai_id));
const folhas = lancamentos.filter((l) => !temFilho.has(l.id));

function pessoaPorNome(nome) {
  const n = norm(nome);
  if (!n) return null;
  const exato = pessoas.find((p) => p.normalized_name === n || norm(p.name) === n);
  if (exato) return exato;
  const cands = pessoas.filter((p) => p.normalized_name.split(' ')[0] === n.split(' ')[0]);
  return cands.length === 1 ? cands[0] : null;
}

function casarTransacao(lanc) {
  const data = lanc.pgto || lanc.venc;
  if (!data) return { estado: 'sem_data', candidatos: [] };
  const cents = Math.round(lanc.valor * 100);
  let cands = transacoes.filter(
    (t) => Math.abs(t.amount_cents) === cents && Math.abs((new Date(t.posted_on) - new Date(data)) / 86400000) <= 3
  );
  if (cands.length > 1 && lanc.beneficiado) {
    const alvo = norm(lanc.beneficiado);
    const filtrado = cands.filter((t) => norm(t.pessoa).startsWith(alvo) || norm(t.description_raw).includes(alvo));
    if (filtrado.length) cands = filtrado;
  }
  if (cands.length === 1) return { estado: 'ok', tx: cands[0], candidatos: cands };
  return { estado: cands.length ? 'ambiguo' : 'sem_par', candidatos: cands };
}

const contratoPorId = new Map(contratos.map((c) => [c.erp_id, c]));
const parcelasPorContrato = new Map();
for (const p of parcelas) (parcelasPorContrato.get(p.contrato_id) || parcelasPorContrato.set(p.contrato_id, []).get(p.contrato_id)).push(p);

// Ligação contrato → negócio ganho do Pipedrive. Valor exato é a chave forte;
// a janela de data e o nome desempatam. Sem candidato único, fica NULL — um
// vínculo errado aqui pendura comissão na venda de outro cliente.
function ganhoDoContrato(c) {
  if (!c || !c.valor_cents) return null;
  let cands = ganhos.filter((g) => Number(g.valor_cents) === Number(c.valor_cents));
  if (cands.length > 1 && c.data_assinatura) {
    const base = new Date(c.data_assinatura);
    const janela = cands.filter((g) => {
      const d = (new Date(g.ganho_em) - base) / 86400000;
      return d >= -150 && d <= 90;
    });
    if (janela.length) cands = janela;
  }
  if (cands.length > 1) {
    const t = norm(c.titulo).split(' ').filter((w) => w.length > 3);
    const porNome = cands.filter((g) => t.some((w) => norm(`${g.titulo} ${g.org_nome}`).includes(w)));
    if (porNome.length) cands = porNome;
  }
  return cands.length === 1 ? cands[0] : null;
}

const registros = [];
for (const l of folhas) {
  const papel = PAPEL_POR_SUBCATEGORIA[l.subcategoria] || null;
  const contrato = l.contrato_id ? contratoPorId.get(l.contrato_id) : null;
  let tx = null;
  let vinculo = 'indeterminado';
  let confianca = 0;
  let motivo = null;

  if (l.pai_id) {
    const pai = lancamentos.find((x) => x.id === l.pai_id);
    const m = pai ? casarTransacao(pai) : { estado: 'sem_par' };
    if (m.estado === 'ok') {
      tx = m.tx;
      vinculo = 'erp_rateio';
      confianca = 0.95;
    } else {
      motivo = `rateio cujo pai (${l.pai_id}) não casou com o extrato (${m.estado})`;
    }
  } else if (l.status === 'PAGO') {
    const m = casarTransacao(l);
    if (m.estado === 'ok') {
      tx = m.tx;
      vinculo = 'erp_lancamento';
      confianca = 0.8;
    } else {
      motivo = `lançamento não casou com o extrato (${m.estado}, ${m.candidatos.length} candidato(s))`;
    }
  } else {
    motivo = 'PREVISTO — ainda não saiu do caixa';
  }

  const pessoa = (tx && tx.person_id ? { id: tx.person_id, name: tx.pessoa, employment_type: tx.employment_type } : null) || pessoaPorNome(l.beneficiado);

  const baseImplicita = papel && ALIQUOTA[papel] ? Math.round((l.valor * 100) / ALIQUOTA[papel]) : null;
  const pctImplicito = contrato && contrato.valor_cents ? (l.valor * 100) / Number(contrato.valor_cents) : null;
  const ganho = ganhoDoContrato(contrato);

  registros.push({
    lanc: l,
    papel,
    contrato,
    ganho,
    tx,
    pessoa,
    vinculo,
    confianca,
    motivo,
    baseImplicita,
    pctImplicito,
    papelConflita: false
  });
}

// ---------------------------------------------------------------------------
// 5. Detectar papel trocado
// ---------------------------------------------------------------------------
// Num mesmo contrato e mesma data, vendedor e eng. comercial têm de produzir a
// MESMA base implícita (valor ÷ alíquota). Quando não produzem mas produziriam
// se as pessoas fossem trocadas, o rótulo do ERP está errado — e o rótulo é de
// pessoa, não de papel. É o contrato 8 (Madalena Colonial).
const grupos = new Map();
for (const r of registros) {
  if (!r.papel || !r.contrato) continue;
  const k = `${r.contrato.erp_id}|${dia(r.lanc.venc)}`;
  (grupos.get(k) || grupos.set(k, []).get(k)).push(r);
}
const medicoes = [];
for (const [k, g] of grupos) {
  const v = g.find((r) => r.papel === 'vendedor');
  const e = g.find((r) => r.papel === 'eng_comercial');
  const x = g.find((r) => r.papel === 'execucao');
  if (!v || !e) continue;
  const dif = Math.abs(v.baseImplicita - e.baseImplicita) / Math.max(v.baseImplicita, e.baseImplicita);
  const trocado = Math.abs(v.lanc.valor / ALIQUOTA.eng_comercial - e.lanc.valor / ALIQUOTA.vendedor) /
    Math.max(v.lanc.valor / ALIQUOTA.eng_comercial, e.lanc.valor / ALIQUOTA.vendedor);
  const coerente = dif <= TOLERANCIA_BASE;
  if (!coerente && trocado <= TOLERANCIA_BASE) {
    v.papelConflita = true;
    e.papelConflita = true;
    v.motivo = (v.motivo ? `${v.motivo}; ` : '') + 'alíquota implícita indica papel trocado com o par';
    e.motivo = (e.motivo ? `${e.motivo}; ` : '') + 'alíquota implícita indica papel trocado com o par';
  }
  medicoes.push({
    chave: k,
    contrato: v.contrato.erp_id,
    titulo: v.contrato.titulo,
    valorContrato: Number(v.contrato.valor_cents),
    vendedor: v.lanc.valor,
    eng: e.lanc.valor,
    execucao: x ? x.lanc.valor : null,
    baseV: v.baseImplicita,
    baseE: e.baseImplicita,
    baseX: x ? x.baseImplicita : null,
    dif,
    trocado: !coerente && trocado <= TOLERANCIA_BASE,
    coerente: coerente || trocado <= TOLERANCIA_BASE
  });
}

console.log('\n=== 2. ALÍQUOTA MEDIDA — grupos com dois ou três papéis no mesmo negócio ===');
console.log('  contrato | data       | vendedor | eng.com. | execução | base(7%)  | base(3%)  | base(5%)  | divergência');
for (const m of medicoes.sort((a, b) => a.chave.localeCompare(b.chave))) {
  console.log(
    `  ${String(m.contrato).padStart(8)} | ${m.chave.split('|')[1]} | ${brl(m.vendedor * 100).padStart(8)} | ` +
      `${brl(m.eng * 100).padStart(8)} | ${(m.execucao ? brl(m.execucao * 100) : '—').padStart(8)} | ` +
      `${brl(m.baseV).padStart(9)} | ${brl(m.baseE).padStart(9)} | ${(m.baseX ? brl(m.baseX) : '—').padStart(9)} | ` +
      `${(m.dif * 100).toFixed(2)}%${m.trocado ? '  PAPÉIS TROCADOS' : m.coerente ? '' : '  NÃO É 7:3'}`
  );
}
const coerentes = medicoes.filter((m) => m.coerente).length;
console.log(`  → ${coerentes} de ${medicoes.length} grupos reproduzem a razão 7:3 dentro de ${(TOLERANCIA_BASE * 100).toFixed(0)}%`);

console.log('\n=== 3. BASE: o que a alíquota incidiu, por negócio ===');
console.log('  contrato | base implícita | valor do contrato | base/contrato | leitura');
for (const m of medicoes.sort((a, b) => a.contrato - b.contrato)) {
  const base = m.trocado ? m.eng * 100 / ALIQUOTA.vendedor : m.baseV;
  const r = m.valorContrato ? base / m.valorContrato : null;
  const leitura = r == null ? '—'
    : Math.abs(r - 1) < 0.01 ? 'contrato inteiro'
    : Math.abs(r - 0.5) < 0.01 ? 'metade do contrato'
    : r > 1 ? 'MAIOR que o contrato'
    : `${(r * 100).toFixed(1)}% do contrato`;
  console.log(`  ${String(m.contrato).padStart(8)} | ${brl(base).padStart(14)} | ${brl(m.valorContrato).padStart(17)} | ` +
    `${(r == null ? '—' : r.toFixed(4)).padStart(13)} | ${leitura}`);
}

// ---------------------------------------------------------------------------
// 6. A regra da segunda parcela
// ---------------------------------------------------------------------------
// `ParcelaContrato.status` do ERP está abandonado (1 PAGA em 471). A data em que
// o dinheiro do cliente ENTROU vem do ledger: fin_document liquidado com
// liquidação em fin_settlement.
console.log('\n=== 4. "SÓ A PARTIR DA SEGUNDA PARCELA" — conferência ===');
console.log('  contrato | assinatura | 1º receb.  | 2º receb.  | 1ª comissão | dias após assin. | após 2º receb.');
const defasagens = [];
let obedecem = 0;
let testaveis = 0;
const inconsistentes = [];
const porContrato = new Map();
for (const r of registros) {
  if (!r.contrato || r.lanc.status !== 'PAGO') continue;
  const d = r.lanc.pgto || r.lanc.venc;
  const atual = porContrato.get(r.contrato.erp_id);
  if (!atual || new Date(d) < new Date(atual)) porContrato.set(r.contrato.erp_id, d);
}
for (const [ctr, primeira] of [...porContrato.entries()].sort((a, b) => a[0] - b[0])) {
  const c = contratoPorId.get(ctr);
  const ps = (parcelasPorContrato.get(ctr) || []).filter((p) => p.recebido_em).sort((a, b) => new Date(a.recebido_em) - new Date(b.recebido_em));
  const r1 = ps[0]?.recebido_em;
  const r2 = ps[1]?.recebido_em;
  const dAssin = c?.data_assinatura ? Math.round((new Date(primeira) - new Date(c.data_assinatura)) / 86400000) : null;
  const dR2 = r2 ? Math.round((new Date(primeira) - new Date(r2)) / 86400000) : null;
  // Comissão paga ANTES da assinatura é impossível: o vínculo contrato↔lançamento
  // no ERP é que está errado, não a regra. Sai da estatística e entra na fila.
  if (dAssin != null && dAssin < 0) {
    inconsistentes.push({ ctr, dAssin, primeira, assinatura: c.data_assinatura });
  } else {
    if (dAssin != null) defasagens.push(dAssin);
    testaveis += 1;
    if (dR2 != null && dR2 >= 0) obedecem += 1;
  }
  console.log(
    `  ${String(ctr).padStart(8)} | ${dia(c?.data_assinatura)} | ${dia(r1)} | ${dia(r2)} | ${dia(primeira)}  | ` +
      `${(dAssin == null ? '—' : `${dAssin}d`).padStart(16)} | ${dR2 == null ? 'sem 2º recebimento' : `${dR2 >= 0 ? '+' : ''}${dR2}d  ${dR2 >= 0 ? 'SIM' : 'NÃO'}`}` +
      `${dAssin != null && dAssin < 0 ? '   ← comissão ANTES da assinatura: vínculo do ERP suspeito' : ''}`
  );
}
defasagens.sort((a, b) => a - b);
const mediana = defasagens.length ? defasagens[Math.floor(defasagens.length / 2)] : null;
console.log(`  → ${obedecem} de ${testaveis} contratos com 2º recebimento tiveram a comissão paga depois dele`);
console.log(`  → defasagem assinatura → 1ª comissão: [${defasagens.join(', ')}] dias · mediana ${mediana}`);
if (inconsistentes.length) {
  console.log(`  → ${inconsistentes.length} contrato(s) descartado(s) da estatística por comissão anterior à assinatura: ` +
    inconsistentes.map((i) => `${i.ctr} (${i.dAssin}d)`).join(', '));
}
const datasPagto = [...new Set(registros.filter((r) => r.lanc.status === 'PAGO').map((r) => dia(r.lanc.pgto || r.lanc.venc)))].sort();
const diasDoMes = datasPagto.map((d) => Number(d.slice(8, 10)));
console.log(`  → datas em que comissão saiu: ${datasPagto.join(', ')}`);
console.log(`  → dia do mês: mín ${Math.min(...diasDoMes)}, máx ${Math.max(...diasDoMes)} — ${diasDoMes.filter((d) => d <= 6).length}/${diasDoMes.length} até o dia 6 (lote da folha)`);

// ---------------------------------------------------------------------------
// 7. Onde a comissão está contabilizada hoje
// ---------------------------------------------------------------------------
console.log('\n=== 5. ONDE A COMISSÃO IDENTIFICADA ESTÁ NO LEDGER (observação, não reclassificação) ===');
const porCategoria = new Map();
const jaContado = new Set();
for (const r of registros) {
  if (!r.tx) continue;
  // uma transação rateada em N comissões conta uma vez pelo valor da parte
  const k = `${r.tx.cat_code}|${r.pessoa?.employment_type || '—'}`;
  const atual = porCategoria.get(k) || { n: 0, valor: 0 };
  atual.n += 1;
  atual.valor += r.lanc.valor;
  porCategoria.set(k, atual);
  jaContado.add(r.tx.id);
}
for (const [k, v] of [...porCategoria.entries()].sort()) {
  const [cat, tipo] = k.split('|');
  console.log(`  categoria ${cat.padEnd(5)} · vínculo ${tipo.padEnd(10)} · ${String(v.n).padStart(3)} comissão(ões) · ${brl(v.valor * 100)}`);
}
const { rows: [c401] } = await pool.query(
  `SELECT count(*)::int AS n FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id WHERE c.code = '4.01'`);
console.log(`  categoria 4.01 "Comissão paga a vendedor": ${c401.n} lançamento(s) no ledger inteiro`);

// ---------------------------------------------------------------------------
// 8. Previsão
// ---------------------------------------------------------------------------
// Regra usada: alíquota por papel sobre o VALOR CONTRATADO, disparada no lote
// mensal seguinte ao 2º recebimento; quando não há 2º recebimento previsto, cai
// na mediana de defasagem sobre a assinatura. A previsão só existe para OBRAS e
// AMBOS — em consultoria não há um único pagamento por negócio para calibrar.
const DEFASAGEM = mediana ?? 45;
const pagoPorContratoPapel = new Map();
for (const r of registros) {
  if (!r.contrato || r.lanc.status !== 'PAGO' || !r.papel) continue;
  const k = `${r.contrato.erp_id}|${r.papel}`;
  pagoPorContratoPapel.set(k, (pagoPorContratoPapel.get(k) || 0) + Math.round(r.lanc.valor * 100));
}

function loteSeguinte(d) {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 2)).toISOString().slice(0, 10);
}

// A previsão é POR PARCELA, não por contrato inteiro. É o modelo C do backtest
// (seção 7), o único que reproduz o passado: a comissão acompanha o caixa que
// entra, e cada parcela do cliente carrega a sua fatia de 7% + 3% + 5%.
//
// A data prevista é o LOTE do mês seguinte ao recebimento — o padrão observado
// em 6 das 10 datas de pagamento de comissão de 2026 (todas entre o dia 1 e o
// dia 6, junto com a folha). Para parcela ainda não recebida vale o vencimento.
//
// O que já foi pago é consumido em ordem cronológica de parcela, e as tranches
// consumidas nascem 'pago'. Sem isso a previsão cobraria de novo o que já saiu.
const previsoes = [];
for (const c of contratos) {
  if (!['OBRAS', 'AMBOS'].includes(c.eixo)) continue;
  if (['CANCELADO', 'RASCUNHO'].includes(c.status_erp)) continue;
  if (!c.valor_cents) continue;
  const ps = (parcelasPorContrato.get(c.erp_id) || []).slice().sort((a, b) => a.numero - b.numero);
  // Contrato sem parcela cadastrada vira uma parcela única no valor cheio, com
  // a defasagem mediana sobre a assinatura. É explícito no gatilho.
  const linhas = ps.length
    ? ps.map((p) => ({
        numero: p.numero,
        valor: Number(p.valor_cents),
        quando: p.recebido_em
          ? loteSeguinte(p.recebido_em)
          : p.data_vencimento
            ? loteSeguinte(p.data_vencimento)
            : null,
        gatilho: p.recebido_em ? 'recebimento' : 'parcela_minima'
      }))
    : [{
        numero: 1,
        valor: Number(c.valor_cents),
        quando: c.data_assinatura
          ? new Date(new Date(c.data_assinatura).getTime() + DEFASAGEM * 86400000).toISOString().slice(0, 10)
          : null,
        gatilho: 'assinatura'
      }];
  const ganho = ganhoDoContrato(c);
  const centro = centros.find((cc) => cc.source_id && String(cc.source_id) === String(c.erp_id));
  for (const papel of ['vendedor', 'eng_comercial', 'execucao']) {
    const alq = ALIQUOTA[papel];
    if (!alq) continue;
    let creditoPago = pagoPorContratoPapel.get(`${c.erp_id}|${papel}`) || 0;
    for (const [i, l] of linhas.entries()) {
      if (!l.quando) continue;
      const total = Math.round(l.valor * alq);
      const jaPago = Math.min(creditoPago, total);
      creditoPago -= jaPago;
      previsoes.push({
        contrato: c,
        ganho,
        centro,
        papel,
        base: l.valor,
        pct: alq,
        total,
        jaPago,
        restante: total - jaPago,
        data: l.quando,
        competencia: `${l.quando.slice(0, 7)}-01`,
        tranche: i + 1,
        tranchesTotal: linhas.length,
        gatilho: l.gatilho,
        estado: total - jaPago <= 0 ? 'pago' : jaPago > 0 ? 'parcial' : 'previsto'
      });
    }
  }
}

console.log('\n=== 6. PREVISÃO (7% + 3% + 5% sobre o valor contratado, obras e ambos) ===');
const abertos = previsoes.filter((p) => p.restante > 0);
const totalAberto = abertos.reduce((s, p) => s + p.restante, 0);
console.log(`  ${new Set(abertos.map((p) => p.contrato.erp_id)).size} contrato(s) com comissão a pagar · ${brl(totalAberto)} em aberto`);
const porMes = new Map();
for (const p of abertos) porMes.set(p.competencia, (porMes.get(p.competencia) || 0) + p.restante);
for (const [m, v] of [...porMes.entries()].sort()) console.log(`    ${m.slice(0, 7)}  ${brl(v).padStart(14)}`);

// ---------------------------------------------------------------------------
// 9. Backtest
// ---------------------------------------------------------------------------
// A pergunta: aplicando a regra descoberta aos meses passados, ela reproduz o
// que saiu do caixa? Duas leituras, porque erram de formas diferentes:
//   por MÊS      o modelo prevê o lote inteiro do mês?
//   por CONTRATO o modelo acerta quanto cada negócio custou de comissão?
console.log('\n=== 7. BACKTEST — regra aplicada ao passado × o que foi pago ===');
console.log('  Três modelos disputam. Todos usam as MESMAS alíquotas (7/3/5); o que muda é a BASE.');
console.log('    A  10% (7+3) sobre o valor contratado, o ciclo inteiro');
console.log('    B  15% (7+3+5) sobre o valor contratado, o ciclo inteiro');
console.log('    C  10% (7+3) sobre o que o cliente JÁ PAGOU até a data da comissão');

const pagoPorMes = new Map();
for (const r of registros) {
  if (r.lanc.status !== 'PAGO') continue;
  const m = dia(r.lanc.pgto || r.lanc.venc).slice(0, 7);
  pagoPorMes.set(m, (pagoPorMes.get(m) || 0) + Math.round(r.lanc.valor * 100));
}

function recebidoAte(ctr, ate) {
  return (parcelasPorContrato.get(ctr) || [])
    .filter((p) => p.recebido_em && new Date(p.recebido_em) <= new Date(ate))
    .reduce((s, p) => s + Number(p.settled_cents || p.valor_cents), 0);
}

// Só entram no backtest os contratos que JÁ receberam comissão. Contratos sem
// comissão nenhuma testariam a data de disparo, não a alíquota — e a data já
// foi medida na seção 4.
//
// O corte de "quanto o cliente já pagou" usa a ÚLTIMA comissão do contrato, não
// a primeira: a comissão se acumula, e cortar na primeira compararia o total
// pago contra um recebimento parcial.
const ultimaComissao = new Map();
for (const r of registros) {
  if (!r.contrato || r.lanc.status !== 'PAGO') continue;
  const d = dia(r.lanc.pgto || r.lanc.venc);
  const atual = ultimaComissao.get(r.contrato.erp_id);
  if (!atual || d > atual) ultimaComissao.set(r.contrato.erp_id, d);
}
const contratosTeste = [...porContrato.keys()].filter((c) => contratoPorId.get(c)).sort((a, b) => a - b);
const modelos = [
  { nome: 'A  10% contratado', calc: (c) => Math.round(Number(c.valor_cents) * 0.10) },
  { nome: 'B  15% contratado', calc: (c) => Math.round(Number(c.valor_cents) * 0.15) },
  { nome: 'C  10% recebido  ', calc: (c, quando) => Math.round(recebidoAte(c.erp_id, quando) * 0.10) }
];

console.log('\n  por contrato · pago = comissão efetivamente paga até hoje');
console.log('  contrato | contratado    | recebido      | pago          |   modelo A |   modelo B |   modelo C');
const acum = modelos.map(() => ({ prev: 0, abs: 0 }));
let totalPago = 0;
for (const ctr of contratosTeste) {
  const c = contratoPorId.get(ctr);
  const quando = ultimaComissao.get(ctr) || porContrato.get(ctr);
  const pg = ['vendedor', 'eng_comercial', 'execucao'].reduce((s, p) => s + (pagoPorContratoPapel.get(`${ctr}|${p}`) || 0), 0);
  totalPago += pg;
  const vals = modelos.map((m) => m.calc(c, quando));
  vals.forEach((v, i) => {
    acum[i].prev += v;
    acum[i].abs += Math.abs(v - pg);
  });
  console.log(
    `  ${String(ctr).padStart(8)} | ${brl(c.valor_cents).padStart(13)} | ${brl(recebidoAte(ctr, quando)).padStart(13)} | ` +
      `${brl(pg).padStart(13)} | ${vals.map((v) => brl(v).padStart(10)).join(' | ')}`
  );
}
console.log(`  TOTAL    | ${''.padStart(13)} | ${''.padStart(13)} | ${brl(totalPago).padStart(13)} | ` +
  acum.map((a) => brl(a.prev).padStart(10)).join(' | '));
console.log('\n  modelo             | previsto      | pago          | viés          | viés %  | erro absoluto | MAE %');
let melhor = null;
modelos.forEach((m, i) => {
  const a = acum[i];
  const vies = a.prev - totalPago;
  const mae = totalPago ? (a.abs / totalPago) * 100 : null;
  if (melhor === null || a.abs < acum[melhor].abs) melhor = i;
  console.log(
    `  ${m.nome} | ${brl(a.prev).padStart(13)} | ${brl(totalPago).padStart(13)} | ${brl(vies).padStart(13)} | ` +
      `${(totalPago ? `${((vies / totalPago) * 100).toFixed(1)}%` : '—').padStart(7)} | ${brl(a.abs).padStart(13)} | ` +
      `${mae == null ? '—' : `${mae.toFixed(1)}%`}`
  );
});
console.log(`  → melhor reprodução do passado: modelo ${modelos[melhor].nome.trim()}`);
console.log('  → LEITURA: A e B erram para CIMA porque projetam o ciclo inteiro contra pagamentos');
console.log('    que ainda estão no meio. C erra menos porque acompanha o caixa — é o modelo que');
console.log('    a previsão deve usar enquanto o contrato estiver aberto.');

console.log('\n  por mês de caixa — SÓ a comissão que tem contrato de origem, para comparar igual com igual');
const previstoPorMesC = new Map();
for (const ctr of contratosTeste) {
  const quando = ultimaComissao.get(ctr) || porContrato.get(ctr);
  const m = dia(quando).slice(0, 7);
  previstoPorMesC.set(m, (previstoPorMesC.get(m) || 0) + Math.round(recebidoAte(ctr, quando) * 0.10));
}
const pagoComContratoPorMes = new Map();
for (const r of registros) {
  if (r.lanc.status !== 'PAGO' || !r.contrato) continue;
  const m = dia(r.lanc.pgto || r.lanc.venc).slice(0, 7);
  pagoComContratoPorMes.set(m, (pagoComContratoPorMes.get(m) || 0) + Math.round(r.lanc.valor * 100));
}
const meses = [...new Set([...pagoComContratoPorMes.keys(), ...previstoPorMesC.keys()])].sort();
console.log('  mês     |      previsto |          pago |          erro | erro %');
let somaPrev = 0;
let somaPago = 0;
let somaAbs = 0;
for (const m of meses) {
  if (m > '2026-08') continue;
  const prev = previstoPorMesC.get(m) || 0;
  const pg = pagoComContratoPorMes.get(m) || 0;
  somaPrev += prev;
  somaPago += pg;
  somaAbs += Math.abs(prev - pg);
  console.log(
    `  ${m} | ${brl(prev).padStart(13)} | ${brl(pg).padStart(13)} | ${brl(prev - pg).padStart(13)} | ` +
      `${pg ? `${(((prev - pg) / pg) * 100).toFixed(1)}%` : '—'}`
  );
}
console.log(`  TOTAL   | ${brl(somaPrev).padStart(13)} | ${brl(somaPago).padStart(13)} | ${brl(somaPrev - somaPago).padStart(13)} | ` +
  `${somaPago ? `${(((somaPrev - somaPago) / somaPago) * 100).toFixed(1)}%` : '—'}`);
console.log(`  erro absoluto somado: ${brl(somaAbs)} sobre ${brl(somaPago)} pagos = ${somaPago ? ((somaAbs / somaPago) * 100).toFixed(1) : '—'}%`);
// -------- backtest do que o script realmente grava --------------------------
// Os blocos acima testam a ALÍQUOTA. Este testa o ENTREGÁVEL: a previsão por
// parcela que vai para fin_comissao_prevista, mês a mês, contra tudo que saiu
// do caixa como comissão. É o número que decide se a regra serve para prever.
console.log('\n  backtest do modelo entregue (previsão por parcela × comissão paga, todo o histórico)');
const previstoEntregue = new Map();
for (const p of previsoes) {
  const m = p.competencia.slice(0, 7);
  previstoEntregue.set(m, (previstoEntregue.get(m) || 0) + p.total);
}
const HOJE = new Date().toISOString().slice(0, 7);
const mesesE = [...new Set([...pagoPorMes.keys(), ...previstoEntregue.keys()])].filter((m) => m <= HOJE).sort();
console.log('  mês     |      previsto |          pago |          erro | erro %');
let eP = 0;
let eG = 0;
let eA = 0;
for (const m of mesesE) {
  const prev = previstoEntregue.get(m) || 0;
  const pg = pagoPorMes.get(m) || 0;
  eP += prev;
  eG += pg;
  eA += Math.abs(prev - pg);
  console.log(`  ${m} | ${brl(prev).padStart(13)} | ${brl(pg).padStart(13)} | ${brl(prev - pg).padStart(13)} | ` +
    `${pg ? `${(((prev - pg) / pg) * 100).toFixed(1)}%` : '—'}`);
}
console.log(`  TOTAL   | ${brl(eP).padStart(13)} | ${brl(eG).padStart(13)} | ${brl(eP - eG).padStart(13)} | ` +
  `${eG ? `${(((eP - eG) / eG) * 100).toFixed(1)}%` : '—'}`);
console.log(`  → VIÉS acumulado em ${mesesE.length} meses: ${brl(eP - eG)} = ${eG ? (((eP - eG) / eG) * 100).toFixed(1) : '—'}% ` +
  `(a regra acerta o NÍVEL do gasto)`);
console.log(`  → ERRO ABSOLUTO mês a mês: ${brl(eA)} = ${eG ? ((eA / eG) * 100).toFixed(1) : '—'}% do pago ` +
  `(a regra NÃO acerta o MÊS)`);
console.log('  → Conclusão: serve para orçar o ano e para dizer quanto cada obra deve de comissão;');
console.log('    NÃO serve para prever o caixa de um mês específico enquanto o lote for decidido à mão.');

const semContratoCents = [...pagoPorMes.values()].reduce((s, v) => s + v, 0) - totalPago;
console.log(`  Fora desta conta: ${brl(semContratoCents)} de comissão paga SEM contrato de origem — é o que`);
console.log('  impede a previsão mensal de fechar, e é o item nº 1 da fila humana (seção 8).');

// ---------------------------------------------------------------------------
// 10. Indeterminados
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 9b. Falso positivo: fixo mensal rotulado como comissão
// ---------------------------------------------------------------------------
// A categoria "Comissões" do erp-obras não é confiável sozinha. O Jonildo recebe
// R$ 5.879,00 + R$ 1.621,00 TODO mês desde fevereiro — é o fixo dele — e a
// instância de maio ficou marcada "Eng. comercial". Somar isso como comissão
// infla o custo variável e some com o fixo.
//
// Teste: o mesmo valor exato foi pago à mesma contraparte em 3 meses distintos?
// Então é recorrente, não comissão. Não se apaga nada — marca-se.
const recorrentes = new Map();
for (const t of transacoes) {
  if (!t.counterparty_id) continue;
  const k = `${t.counterparty_id}|${Math.abs(t.amount_cents)}`;
  (recorrentes.get(k) || recorrentes.set(k, new Set()).get(k)).add(dia(t.posted_on).slice(0, 7));
}
for (const r of registros) {
  if (!r.tx || !r.tx.counterparty_id) continue;
  const meses = recorrentes.get(`${r.tx.counterparty_id}|${Math.abs(r.tx.amount_cents)}`);
  if (meses && meses.size >= 3 && !r.contrato) {
    r.suspeitaFixo = meses.size;
    r.motivo = (r.motivo ? `${r.motivo}; ` : '') +
      `mesmo valor pago à mesma pessoa em ${meses.size} meses — provável fixo mensal rotulado como comissão`;
  }
}

console.log('\n=== 8. INDETERMINADOS ===');
const suspeitos = registros.filter((r) => r.suspeitaFixo);
if (suspeitos.length) {
  const total = suspeitos.reduce((s, r) => s + r.lanc.valor, 0) * 100;
  console.log(`  FALSO POSITIVO provável — fixo mensal rotulado "Comissões" no ERP: ${suspeitos.length} · ${brl(total)}`);
  for (const r of suspeitos) {
    console.log(`     erp ${String(r.lanc.id).padStart(5)} · ${dia(r.lanc.pgto || r.lanc.venc)} · ${brl(r.lanc.valor * 100).padStart(12)} · ` +
      `${(r.pessoa?.name || '—').padEnd(30)} · repete em ${r.suspeitaFixo} meses`);
  }
}
const semNegocio = registros.filter((r) => r.lanc.status === 'PAGO' && !r.contrato);
const semCaixa = registros.filter((r) => r.lanc.status === 'PAGO' && !r.tx);
const conflita = registros.filter((r) => r.papelConflita);
const semPessoa = registros.filter((r) => r.lanc.status === 'PAGO' && !r.pessoa);
console.log(`  comissão paga sem contrato de origem: ${semNegocio.length} · ${brl(semNegocio.reduce((s, r) => s + r.lanc.valor, 0) * 100)}`);
for (const r of semNegocio) {
  console.log(`     erp ${String(r.lanc.id).padStart(5)} · ${dia(r.lanc.pgto || r.lanc.venc)} · ${brl(r.lanc.valor * 100).padStart(12)} · ` +
    `${(r.pessoa?.name || r.lanc.beneficiado || '—').padEnd(30)} · ${r.papel || 'sem papel'}`);
}
console.log(`  comissão paga sem transação no extrato: ${semCaixa.length} · ${brl(semCaixa.reduce((s, r) => s + r.lanc.valor, 0) * 100)}`);
for (const r of semCaixa) {
  console.log(`     erp ${String(r.lanc.id).padStart(5)} · ${dia(r.lanc.pgto || r.lanc.venc)} · ${brl(r.lanc.valor * 100).padStart(12)} · ${r.motivo}`);
}
console.log(`  papel em conflito com a alíquota: ${conflita.length}`);
console.log(`  comissão paga sem pessoa identificada: ${semPessoa.length}`);
console.log(`  negócio ganho sem contrato no ERP (não dá para prever comissão): ` +
  `${ganhos.length - new Set(contratos.map((c) => ganhoDoContrato(c)?.id).filter(Boolean)).size} de ${ganhos.length}`);

// ---------------------------------------------------------------------------
// 11. Escrita
// ---------------------------------------------------------------------------
if ((!APLICAR && !VALIDAR) || SO_BACKTEST) {
  console.log(`\n[dry-run] nada foi gravado. Use --validar para testar a escrita com ROLLBACK, --aplicar para persistir.`);
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  let { rows: existeTabela } = await client.query(
    `SELECT to_regclass('public.fin_comissao_pagamento') IS NOT NULL AS ok`);
  if (!existeTabela[0].ok && VALIDAR) {
    // Na validação a migration entra dentro da própria transação e some no
    // rollback junto com os dados. Fora dela, não: aplicar migration é trabalho
    // de db:migrate, não deste script.
    console.log('  [validar] fin_comissao_* não existe; aplicando 0076 dentro da transação');
    await client.query(readFileSync(resolve('db/migrations/0076_fin_comissao.sql'), 'utf8'));
    existeTabela = [{ ok: true }];
  }
  if (!existeTabela[0].ok) throw new Error('fin_comissao_pagamento não existe — aplique a migration 0076 antes');

  const regraPorPapel = new Map(regras.filter((r) => r.status === 'ativa' || r.confianca === 'medida').map((r) => [r.papel, r.id]));
  const catPorCode = new Map();
  const { rows: cats } = await client.query(`SELECT id, code FROM fin_category WHERE entity_id = $1`, [ENTITY]);
  for (const c of cats) catPorCode.set(c.code, c.id);

  let nPag = 0;
  for (const r of registros) {
    if (r.lanc.status !== 'PAGO') continue;
    await client.query(
      `INSERT INTO fin_comissao_pagamento
         (entity_id, transaction_id, erp_lancamento_id, erp_lancamento_pai, person_id, counterparty_id,
          papel, valor_cents, pago_em, competencia, erp_contrato_id, erp_projeto_id, pipeline_ganho_id,
          cost_center_id, base_implicita_cents, pct_implicito, papel_conflita, ledger_category_id,
          vinculo, confianca, motivo, evidencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,date_trunc('month',$9::date)::date,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (entity_id, erp_lancamento_id) WHERE erp_lancamento_id IS NOT NULL DO UPDATE SET
         transaction_id = EXCLUDED.transaction_id, person_id = EXCLUDED.person_id,
         erp_contrato_id = EXCLUDED.erp_contrato_id, pipeline_ganho_id = EXCLUDED.pipeline_ganho_id,
         base_implicita_cents = EXCLUDED.base_implicita_cents, pct_implicito = EXCLUDED.pct_implicito,
         papel_conflita = EXCLUDED.papel_conflita, ledger_category_id = EXCLUDED.ledger_category_id,
         vinculo = EXCLUDED.vinculo, confianca = EXCLUDED.confianca, motivo = EXCLUDED.motivo,
         evidencia = EXCLUDED.evidencia, updated_at = now()`,
      [ENTITY, r.tx?.id ?? null, r.lanc.id, r.lanc.pai_id ?? null, r.pessoa?.id ?? null, r.tx?.counterparty_id ?? null,
       r.papel, Math.round(r.lanc.valor * 100), dia(r.lanc.pgto || r.lanc.venc), r.contrato?.erp_id ?? null,
       r.lanc.projeto_id ?? null, r.ganho?.id ?? null, null, r.baseImplicita, r.pctImplicito,
       r.papelConflita, r.tx?.category_id ?? null, r.vinculo, r.confianca, r.motivo,
       JSON.stringify({ descricao: r.lanc.descricao, subcategoria: r.lanc.subcategoria, origem: r.lanc.origem })]
    );
    nPag += 1;
  }

  await client.query(`DELETE FROM fin_comissao_prevista WHERE entity_id = $1`, [ENTITY]);
  let nPrev = 0;
  for (const p of previsoes) {
    // Tranche já quitada TAMBÉM entra, com valor_cents = 0 e estado 'pago'. Sem
    // ela o cronograma ficaria com buracos e o backtest compararia o previsto de
    // um mês contra o pago de todos — que é o erro que a view existe para evitar.
    if (p.total <= 0) continue;
    await client.query(
      `INSERT INTO fin_comissao_prevista
         (entity_id, regra_id, erp_contrato_id, pipeline_ganho_id, cost_center_id, papel, person_id,
          base_cents, pct, valor_cents, tranche, tranches_total, competencia, data_prevista, gatilho,
          estado, pago_cents, motivo, evidencia)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [ENTITY, regraPorPapel.get(p.papel) ?? null, p.contrato.erp_id, p.ganho?.id ?? null, p.centro?.id ?? null,
       p.papel, p.base, p.pct, p.restante, p.tranche, p.tranchesTotal, p.competencia, p.data, p.gatilho, p.estado, p.jaPago,
       'vendedor indeterminado: nem Pipedrive nem ERP carimbam quem vendeu',
       JSON.stringify({ total_regra_cents: p.total, ja_pago_cents: p.jaPago, defasagem_dias: DEFASAGEM })]
    );
    nPrev += 1;
  }
  const { rows: conf } = await client.query(`
    SELECT (SELECT count(*) FROM fin_comissao_pagamento)::int AS pagamentos,
           (SELECT count(*) FROM fin_comissao_prevista)::int  AS previsoes,
           (SELECT coalesce(sum(valor_cents),0) FROM fin_comissao_pagamento)::bigint AS pago_cents,
           (SELECT coalesce(sum(valor_cents),0) FROM fin_comissao_prevista)::bigint  AS previsto_cents,
           (SELECT count(*) FROM fin_comissao_indeterminado_v)::int AS fila`);
  console.log(`\n  gravado: ${conf[0].pagamentos} pagamento(s) ${brl(conf[0].pago_cents)} · ` +
    `${conf[0].previsoes} previsão(ões), ${brl(conf[0].previsto_cents)} ainda a pagar · fila humana ${conf[0].fila} item(ns)`);
  const { rows: bt } = await client.query(`SELECT * FROM fin_comissao_backtest_v ORDER BY competencia`);
  console.log('  fin_comissao_backtest_v:');
  for (const b of bt) {
    console.log(`    ${dia(b.competencia)} · previsto ${brl(b.previsto_cents)} · pago ${brl(b.pago_cents)} · ` +
      `erro ${brl(b.erro_cents)} ${b.erro_pct == null ? '' : `(${(Number(b.erro_pct) * 100).toFixed(1)}%)`}`);
  }
  if (VALIDAR) {
    await client.query('ROLLBACK');
    console.log(`\n[validar] ROLLBACK executado — nada persistido. O caminho de escrita passa no schema.`);
  } else {
    await client.query('COMMIT');
    console.log(`\n[aplicado] ${nPag} pagamento(s) e ${nPrev} previsão(ões) gravados.`);
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\n[erro] rollback:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
