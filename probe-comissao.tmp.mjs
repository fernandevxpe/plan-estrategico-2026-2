import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { financePool } from '/Users/fernandoxpe/Fernandev/plan-estrategico-2026.2/scripts/lib/artifact-db.mjs';
import { loadEnv } from '/Users/fernandoxpe/Fernandev/plan-estrategico-2026.2/scripts/lib/env.mjs';
loadEnv();
function erpUrl() {
  const p = resolve('/Users/fernandoxpe/Fernandev/plan-estrategico-2026.2', '.env.obras');
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l.startsWith('DIRECT_URL=')) continue;
    let v = l.slice(11).trim();
    if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    return v;
  }
  throw new Error('sem DIRECT_URL');
}
const erp = new pg.Client({ connectionString: erpUrl(), ssl:{rejectUnauthorized:false} });
await erp.connect();
await erp.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
const { rows:[ro] } = await erp.query('SHOW transaction_read_only');
if (ro.transaction_read_only !== 'on') throw new Error('read-only nao pegou');

const { rows: lanc } = await erp.query(`
  SELECT l.id, l.descricao, l.valor::float8 AS valor, l.status, l."dataVencimento" AS venc,
         l."dataPagamento" AS pgto, l.beneficiado, l.subcategoria, l."projetoId" AS projeto_id,
         l."contratoId" AS contrato_id, l."lancamentoPaiId" AS pai_id, l.origem, l.desconsiderado,
         c."valorContratado"::float8 AS contrato_valor, c."dataAssinatura" AS assinatura, c.eixo, c.titulo AS contrato_titulo
    FROM "LancamentoFinanceiro" l LEFT JOIN "Contrato" c ON c.id=l."contratoId"
   WHERE l.categoria ILIKE '%comiss%' AND l.movimentacao='SAIDA'
   ORDER BY l."dataVencimento", l.id`);
await erp.end();

const pool = financePool();
const { rows: tx } = await pool.query(`
  SELECT t.id, t.posted_on, t.amount_cents, t.description_raw, t.category_id, cat.code AS cat_code,
         t.counterparty_id, cp.name AS cp_nome, p.id AS person_id, p.name AS pessoa, p.employment_type
    FROM fin_transaction t
    LEFT JOIN fin_counterparty cp ON cp.id=t.counterparty_id
    LEFT JOIN fin_category cat ON cat.id=t.category_id
    LEFT JOIN fin_person_counterparty pc ON pc.counterparty_id=t.counterparty_id AND pc.status='confirmado'
    LEFT JOIN fin_person p ON p.id=pc.person_id
   WHERE t.amount_cents<0 AND t.posted_on>='2025-11-01'`);

const norm = (s) => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const pagos = lanc.filter(l=>l.status==='PAGO');
console.log(`lançamentos comissão SAIDA: ${lanc.length} (PAGO ${pagos.length})`);
let ok=0, amb=0, nao=0;
const linhas=[];
for (const l of pagos) {
  const dia = (l.pgto||l.venc);
  const cents = Math.round(l.valor*100);
  const cands = tx.filter(t => Math.abs(t.amount_cents) === cents
    && Math.abs((new Date(t.posted_on) - new Date(dia))/86400000) <= 3);
  // desempate por beneficiado
  let escolha = cands;
  if (cands.length>1 && l.beneficiado) {
    const f = cands.filter(t => norm(t.pessoa).includes(norm(l.beneficiado)) || norm(t.description_raw).includes(norm(l.beneficiado)));
    if (f.length) escolha=f;
  }
  const st = escolha.length===1?'ok':(escolha.length>1?'ambiguo':'sem_par');
  if (st==='ok') ok++; else if (st==='ambiguo') amb++; else nao++;
  linhas.push({ erp:l.id, dia, valor:l.valor, benef:l.beneficiado, sub:l.subcategoria, ctr:l.contrato_id, prj:l.projeto_id,
    st, tx: escolha.length===1?escolha[0].id:null, pessoa: escolha.length===1?escolha[0].pessoa:null,
    cat: escolha.length===1?escolha[0].cat_code:null, tipo: escolha.length===1?escolha[0].employment_type:null,
    n: escolha.length });
}
console.table(linhas);
console.log({ok, amb, nao});
// distribuicao de categoria das comissoes pagas identificadas
const porCat={}; const porTipo={};
for (const x of linhas) if (x.st==='ok'){ porCat[x.cat]=(porCat[x.cat]||0)+x.valor; porTipo[x.tipo]=(porTipo[x.tipo]||0)+x.valor; }
console.log('valor por categoria do ledger:', porCat);
console.log('valor por vínculo:', porTipo);
await pool.end();
