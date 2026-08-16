// O gap entre vender e faturar: negócio ganho no Pipedrive sem cobrança no Asaas.
//
// ---------------------------------------------------------------------------
// A PERGUNTA
// ---------------------------------------------------------------------------
// Do Fernando: "tem o que foi fechado no pipe mas ainda vai virar cobranças no
// asaas — mostre isso também".
//
// Ganho no Pipedrive é compromisso do cliente. Cobrança no Asaas é compromisso
// com data. Entre um e outro há trabalho administrativo, e o tamanho dessa fila
// é um número de gestão: quanto já foi vendido e ainda não está a caminho.
//
// ---------------------------------------------------------------------------
// POR QUE ISTO NÃO É PREVISÃO DE CAIXA
// ---------------------------------------------------------------------------
// O valor fica em tabela própria e NÃO entra em fin_previsao_recebimento_v. Um
// negócio ganho não tem data de vencimento nem forma de pagamento definida —
// pode virar entrada única, parcelamento em 12x ou assinatura, e cada uma
// dessas cai no caixa de um jeito diferente. Somar ao previsto seria antecipar
// dinheiro cuja data ninguém sabe.
//
// ---------------------------------------------------------------------------
// O CASAMENTO
// ---------------------------------------------------------------------------
// Por documento da organização do Pipedrive → fin_counterparty. Onde a
// organização não tem CNPJ cadastrado, o negócio entra com contraparte nula e
// fica visível como indeterminado — some do relatório seria pior que aparecer
// sem dono.
//
// A conciliação com o Asaas é por contraparte + janela de tempo, e é
// deliberadamente conservadora: só marca como faturado o que tem cobrança da
// MESMA contraparte emitida DEPOIS do ganho. Casar por valor exato falharia em
// todo negócio que virou parcelamento, que é a maioria.
//
// Uso:
//   node scripts/sync-pipeline-ganho.mjs            dry-run
//   node scripts/sync-pipeline-ganho.mjs --aplicar
import { readFileSync } from 'node:fs';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ler = (f) => { const d = JSON.parse(readFileSync(`data/raw/${f}`, 'utf8')); return Array.isArray(d) ? d : (d.data ?? []); };

const deals = ler('pipedrive-deals.json').filter((d) => (d.status || '') === 'won');
const orgs = ler('pipedrive-organizations.json');

// O CNPJ da organização mora num campo CUSTOMIZADO do Pipedrive, cuja chave é um
// hash. A chave certa vem de pipedrive-organization-fields.json, procurando pelo
// NOME do campo — aqui "CNPJ+".
//
// A primeira versão procurava por formato (14 dígitos em qualquer campo) e casou
// ZERO organizações, porque pegava `update_time`: "2024-02-29 14:24:07" sem os
// não-dígitos tem exatamente 14 caracteres. Detectar por formato sem contexto
// casa qualquer coisa que tenha o tamanho certo.
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const camposOrg = ler('pipedrive-organization-fields.json');
const chavesDoc = camposOrg
  .filter((f) => /cnpj|cpf|documento/i.test(f.name ?? ''))
  .map((f) => f.key);
if (!chavesDoc.length) throw new Error('nenhum campo de CNPJ/CPF encontrado em organization-fields');
console.log(`[pipedrive] campo(s) de documento: ${chavesDoc.join(', ')}`);

const docDaOrg = new Map();
for (const o of orgs) {
  for (const k of chavesDoc) {
    const d = soDigitos(o[k]);
    if (d.length === 14 || d.length === 11) { docDaOrg.set(o.id, d); break; }
  }
}

const pool = financePool();
try {
  const { rows: [ent] } = await pool.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  const { rows: cps } = await pool.query(
    `SELECT id, name, regexp_replace(COALESCE(document_number,''),'[^0-9]','','g') AS doc
       FROM fin_counterparty WHERE document_number IS NOT NULL AND is_active`);
  const cpPorDoc = new Map(cps.map((c) => [c.doc, c.id]));

  let comContraparte = 0;
  let semContraparte = 0;
  let totalCents = 0;
  const linhas = [];

  for (const d of deals) {
    const cents = Math.round(Number(d.value || 0) * 100);
    if (cents <= 0) continue;
    const ganho = String(d.won_time || d.close_time || d.update_time || '').slice(0, 10);
    if (!ganho) continue;
    const orgId = d.org_id?.value ?? d.org_id;
    const doc = docDaOrg.get(orgId) ?? null;
    const cp = doc ? cpPorDoc.get(doc) ?? null : null;
    if (cp) comContraparte += 1; else semContraparte += 1;
    totalCents += cents;
    linhas.push({
      deal: d.id, titulo: d.title || `Negócio ${d.id}`, cents, ganho,
      org: d.org_name ?? (d.org_id?.name ?? null), doc, cp
    });
  }

  console.log(`\n[pipedrive] ${linhas.length} negócio(s) ganho(s), ${brl(totalCents)}`);
  console.log(`  com contraparte casada por documento .. ${comContraparte}`);
  console.log(`  sem contraparte (org sem CNPJ) ........ ${semContraparte}`);

  if (!APLICAR) { console.log('\n[dry-run] nada gravado. Use --aplicar.\n'); process.exit(0); }

  let n = 0;
  for (const l of linhas) {
    await pool.query(
      `INSERT INTO fin_pipeline_ganho (entity_id, pipedrive_deal_id, titulo, valor_cents,
                                       ganho_em, org_nome, org_document, counterparty_id,
                                       conciliacao, motivo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               CASE WHEN $8::bigint IS NULL THEN 'sem_correspondencia' ELSE 'pendente' END,
               CASE WHEN $8::bigint IS NULL
                    THEN 'organização do Pipedrive sem CNPJ cadastrado — sem como casar com contraparte'
                    ELSE NULL END)
       ON CONFLICT (entity_id, pipedrive_deal_id) DO UPDATE SET
         titulo = EXCLUDED.titulo, valor_cents = EXCLUDED.valor_cents,
         counterparty_id = COALESCE(fin_pipeline_ganho.counterparty_id, EXCLUDED.counterparty_id),
         synced_at = now()`,
      [ent.id, l.deal, l.titulo, l.cents, l.ganho, l.org, l.doc, l.cp]
    );
    n += 1;
  }

  // Conciliação conservadora: cobrança da mesma contraparte emitida a partir do
  // mês do ganho. Não casa por valor porque a maioria vira parcelamento, e
  // exigir valor exato marcaria como "não faturado" o que já está.
  const { rowCount: conc } = await pool.query(
    `UPDATE fin_pipeline_ganho g
        SET faturado_cents = COALESCE(f.total, 0),
            conciliacao = CASE
              WHEN COALESCE(f.total,0) = 0                 THEN 'pendente'
              WHEN COALESCE(f.total,0) >= g.valor_cents    THEN 'completa'
              ELSE 'parcial' END,
            synced_at = now()
       FROM (SELECT d.counterparty_id, sum(d.amount_cents) AS total
               FROM fin_document d
              WHERE d.direction='receber' AND d.counterparty_id IS NOT NULL
              GROUP BY 1) f
      WHERE f.counterparty_id = g.counterparty_id
        AND g.conciliacao <> 'ignorado'`);

  console.log(`\n[aplicado] ${n} negócio(s), ${conc} conciliado(s) com cobrança.\n`);
} finally {
  await pool.end();
}
