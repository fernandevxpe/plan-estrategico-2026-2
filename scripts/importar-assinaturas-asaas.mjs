// As três camadas do que se repete, cada uma pelo que ela é.
//
// ---------------------------------------------------------------------------
// POR QUE TRÊS, E NÃO UMA
// ---------------------------------------------------------------------------
// O detector estatístico tratava tudo como a mesma coisa e errou 37% para cima:
// um contrato pago em 12x tem densidade 1,00, dispersão 0,00 e concentração
// 1,00 — indistinguível de uma mensalidade. A diferença é que ele ACABA.
//
//   1. ASSINATURA   subscription do Asaas. Não tem fim declarado. Projeta até
//                   alguém cancelar. São 11 ativas, R$ 4.940,71/mês.
//
//   2. PARCELAMENTO installment do Asaas, com installmentCount. Tem fim
//                   conhecido: projeta até a última parcela e para. São 200.
//
//   3. ATIVO DE FATO cliente que paga há 12+ meses seguidos e continua, sem
//                   subscription formal. Não é inferência frouxa: doze meses
//                   ininterruptos é evidência de relação continuada, e o
//                   Fernando confirmou que esses devem entrar como ativos.
//
// A camada fica gravada em `source`, então a previsão sabe o que está somando e
// qualquer tela consegue separar "contratado" de "observado".
//
// Uso:
//   node scripts/importar-assinaturas-asaas.mjs            dry-run
//   node scripts/importar-assinaturas-asaas.mjs --aplicar
import { readFileSync } from 'node:fs';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const MESES_PARA_ATIVO = 12;
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ler = (f) => { const d = JSON.parse(readFileSync(`data/raw/${f}`, 'utf8')); return Array.isArray(d) ? d : (d.data ?? []); };

const subs = ler('asaas-subscriptions.json');
const insts = ler('asaas-installments.json');
const custs = ler('asaas-customers.json');
const docPorCliente = new Map(custs.map((c) => [c.id, (c.cpfCnpj || '').replace(/\D/g, '')]));

const pool = financePool();
try {
  const { rows: [ent] } = await pool.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  const { rows: cps } = await pool.query(
    `SELECT id, regexp_replace(COALESCE(document_number,''),'[^0-9]','','g') AS doc
       FROM fin_counterparty WHERE document_number IS NOT NULL AND is_active`);
  const cpPorDoc = new Map(cps.map((c) => [c.doc, c.id]));
  // A categoria é obrigatória para status='ativo' (CHECK
  // fin_recurring_ativa_precisa_categoria) — e faz sentido: uma recorrente sem
  // categoria não sabe em que linha da DRE vai cair, então projetaria dinheiro
  // sem destino. 3.07 "Medição e Monitoramento" é receita-recorrente, que é
  // exatamente a natureza de assinatura de gestão; parcelamento de projeto entra
  // como 3.04. Quem souber o serviço exato corrige na tela, sem quebrar nada.
  const { rows: [catRec] } = await pool.query(`SELECT id FROM fin_category WHERE code='3.07' LIMIT 1`);
  const { rows: [catProj] } = await pool.query(`SELECT id FROM fin_category WHERE code='3.04' LIMIT 1`);
  if (!catRec || !catProj) throw new Error('categorias de receita 3.07/3.04 não encontradas');

  const contraparteDe = (customerId) => cpPorDoc.get(docPorCliente.get(customerId)) ?? null;

  // ---- 1. Assinaturas ------------------------------------------------------
  const ativas = subs.filter((s) => (s.status || '').toUpperCase() === 'ACTIVE' && !s.deleted);
  const linhas = [];

  for (const s of ativas) {
    const cp = contraparteDe(s.customer);
    const cents = Math.round(Number(s.value || 0) * 100);
    if (!cp || cents <= 0) continue;
    const dia = Number(String(s.nextDueDate || '').slice(8, 10)) || 1;
    linhas.push({
      camada: 'assinatura', source: 'contrato', label: `Assinatura Asaas — ${s.description || s.id}`,
      cp, cents, dia, start: String(s.dateCreated || s.nextDueDate).slice(0, 7) + '-01',
      end: null, confidence: 'firme', source_id: s.id
    });
  }

  // ---- 2. Parcelamentos ----------------------------------------------------
  // O fim é calculado, não adivinhado: primeira parcela + (installmentCount − 1)
  // meses. Sem isso a projeção continuaria para sempre, que é exatamente o erro
  // que derrubou a primeira versão.
  for (const i of insts) {
    if (i.deleted) continue;
    const cp = contraparteDe(i.customer);
    // paymentValue é a PARCELA; value é o total do parcelamento. Somar `value`
    // como mensalidade multiplicava o compromisso pelo número de parcelas —
    // dava R$ 1,68 milhão/mês onde o real é uma fração disso.
    const cents = Math.round(Number(i.paymentValue || 0) * 100);
    const n = Number(i.installmentCount || 0);
    if (!cp || cents <= 0 || n <= 1) continue;
    const inicio = String(i.paymentDate || i.dateCreated || '').slice(0, 7);
    if (!inicio) continue;
    const [ano, mes] = inicio.split('-').map(Number);
    const fimMes = new Date(Date.UTC(ano, mes - 1 + (n - 1), 1));
    // Parcelamento que já terminou não é compromisso futuro. Sem este corte a
    // previsão carregaria para sempre contratos encerrados há meses.
    const hojeMes = new Date();
    if (fimMes < new Date(Date.UTC(hojeMes.getUTCFullYear(), hojeMes.getUTCMonth(), 1))) continue;

    linhas.push({
      camada: 'parcelamento', source: 'contrato', label: `Parcelado ${n}x — ${i.description || i.id}`,
      cp, cents, dia: Number(i.expirationDay) || 10, start: `${inicio}-01`,
      end: `${fimMes.getUTCFullYear()}-${String(fimMes.getUTCMonth() + 1).padStart(2, '0')}-01`,
      confidence: 'firme', source_id: i.id
    });
  }

  // ---- 3. Ativos de fato ---------------------------------------------------
  const { rows: longos } = await pool.query(
    `SELECT t.counterparty_id, cp.name,
            count(DISTINCT date_trunc('month', t.posted_on)) AS meses,
            max(t.posted_on) AS ultima,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY t.amount_cents)::bigint AS mediana,
            mode() WITHIN GROUP (ORDER BY extract(day FROM t.posted_on)) AS dia
       FROM fin_transaction t
       JOIN fin_counterparty cp ON cp.id = t.counterparty_id
       LEFT JOIN fin_category c ON c.id = t.category_id
      WHERE t.amount_cents > 0 AND COALESCE(c.cash_flow_group,'') <> 'movimentacao'
      GROUP BY 1,2
     HAVING count(DISTINCT date_trunc('month', t.posted_on)) >= $1
        AND max(t.posted_on) >= (CURRENT_DATE - INTERVAL '45 days')`,
    [MESES_PARA_ATIVO]
  );
  for (const l of longos) {
    linhas.push({
      camada: 'ativo_de_fato', source: 'deteccao_historico',
      label: `Cliente ativo há ${l.meses} meses — ${l.name}`,
      cp: l.counterparty_id, cents: Number(l.mediana), dia: Number(l.dia) || 10,
      start: '2026-01-01', end: null, confidence: 'provavel', source_id: null
    });
  }

  const porCamada = new Map();
  for (const l of linhas) {
    const a = porCamada.get(l.camada) ?? { n: 0, cents: 0 };
    a.n += 1; a.cents += l.cents; porCamada.set(l.camada, a);
  }
  console.log('\n  camada           linhas      valor/mês');
  for (const [k, v] of porCamada) console.log(`  ${k.padEnd(16)} ${String(v.n).padStart(5)}   ${brl(v.cents).padStart(14)}`);
  console.log(`\n  parcelamentos têm fim declarado — não entram no mês seguinte ao término.`);

  if (!APLICAR) { console.log('\n[dry-run] nada gravado. Use --aplicar.\n'); process.exit(0); }

  let n = 0;
  for (const l of linhas) {
    await pool.query(
      `INSERT INTO fin_recurring (
         entity_id, label, direction, counterparty_id, category_id, cadence, day_of_month,
         start_month, end_month, amount_cents, amount_basis, confidence, status,
         ocorrencias, span_meses, densidade, dispersao, day_concentration,
         amostra_de, amostra_ate, last_seen_on, source, source_id, detector_versao, detectado_em, created_by)
       VALUES ($1,$2,'receber',$3,$4,'mensal',$5,$6,$7,$8,'declarado',$9,'ativo',
               3,3,1.0,0,1.0,$6,CURRENT_DATE,CURRENT_DATE,$10,$11,'camadas-v1',now(),'importar-assinaturas-asaas')
       ON CONFLICT DO NOTHING`,
      [ent.id, l.label, l.cp, (l.camada === 'parcelamento' ? catProj.id : catRec.id), Math.min(28, l.dia), l.start, l.end, l.cents,
       l.confidence, l.source, l.source_id]
    );
    n += 1;
  }
  console.log(`\n[aplicado] ${n} linha(s) em fin_recurring.\n`);
} finally {
  await pool.end();
}
