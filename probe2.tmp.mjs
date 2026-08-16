import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { financePool } from './scripts/lib/artifact-db.mjs';
import { loadEnv } from './scripts/lib/env.mjs';
loadEnv();
function erpUrl() {
  for (const raw of readFileSync(resolve('.env.obras'),'utf8').split(/\r?\n/)) {
    const l=raw.trim(); if(!l.startsWith('DIRECT_URL='))continue;
    let v=l.slice(11).trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
    return v;
  } throw new Error('sem DIRECT_URL');
}
const erp=new pg.Client({connectionString:erpUrl(),ssl:{rejectUnauthorized:false}});
await erp.connect(); await erp.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
const {rows:[ro]}=await erp.query('SHOW transaction_read_only'); if(ro.transaction_read_only!=='on')throw new Error('ro');
const {rows:lanc}=await erp.query(`
  SELECT l.id, l.valor::float8 valor, l.status, l."dataVencimento" venc, l."dataPagamento" pgto,
         l.beneficiado, l.subcategoria, l."projetoId" prj, l."contratoId" ctr, l."lancamentoPaiId" pai,
         l.desconsiderado, c."valorContratado"::float8 cvalor, c."dataAssinatura" assin, c.eixo, c.titulo
    FROM "LancamentoFinanceiro" l LEFT JOIN "Contrato" c ON c.id=l."contratoId"
   WHERE l.categoria ILIKE '%comiss%' AND l.movimentacao='SAIDA' ORDER BY l."dataVencimento", l.id`);
const {rows:par}=await erp.query(`SELECT "contratoId" ctr, numero, valor::float8 v, "dataVencimento" venc FROM "ParcelaContrato" ORDER BY "contratoId", numero`);
await erp.end();
const f=(n)=>n==null?'-':n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const pagos=lanc.filter(l=>l.status==='PAGO');
const prev=lanc.filter(l=>l.status==='PREVISTO');
console.log(`SAIDA comissão: ${lanc.length} · PAGO ${pagos.length} R$ ${f(pagos.reduce((s,x)=>s+x.valor,0))} · PREVISTO ${prev.length} R$ ${f(prev.reduce((s,x)=>s+x.valor,0))}`);
const porAno={}; for(const l of pagos){const y=(l.pgto||l.venc).toISOString().slice(0,7); porAno[y]=(porAno[y]||0)+l.valor;}
console.log('pago por mês:', Object.fromEntries(Object.entries(porAno).map(([k,v])=>[k,+v.toFixed(2)])));
// grupos com contrato conhecido
const comCtr=lanc.filter(l=>l.ctr);
console.log(`\ncom contrato: ${comCtr.length} de ${lanc.length}`);
const byCtr={};
for(const l of comCtr){ (byCtr[l.ctr] ||= []).push(l); }
const PAPEL={'Vendedor':'vendedor','Eng. comercial':'eng_comercial','Execução / gestão':'execucao'};
const RATE={vendedor:0.07,eng_comercial:0.03,execucao:0.05};
console.log('\ncontrato | data | papel | valor | base implícita (valor/pct) | contrato R$ | base/contrato');
for(const [ctr,ls] of Object.entries(byCtr)){
  for(const l of ls.sort((a,b)=>String(a.venc).localeCompare(String(b.venc)))){
    const p=PAPEL[l.subcategoria]; if(!p) continue;
    const base=l.valor/RATE[p];
    console.log(`${String(ctr).padStart(4)} | ${String(l.venc).slice(0,10)} | ${p.padEnd(13)} | ${f(l.valor).padStart(9)} | ${f(base).padStart(11)} | ${f(l.cvalor).padStart(10)} | ${l.cvalor?(base/l.cvalor).toFixed(4):'-'} | ${l.status}`);
  }
}
await (async()=>{})();
