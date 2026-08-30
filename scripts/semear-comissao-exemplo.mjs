// Comissões de EXEMPLO para o Fernando, para as telas terem o que desenhar.
//
// POR QUE EXISTE
// --------------
// A guia de Comissões e os gráficos de projeção só se provam com dado dentro.
// O Fernando é quem revisa as telas e é justamente quem não tem comissão — as
// dele somam R$ 3,00. Sem valores espalhados no tempo, o gráfico é uma barra
// só e a projeção é uma linha reta: não dá para ver se a tela funciona.
//
// TUDO É PEQUENO E MARCADO. Os valores vão de R$ 1,00 a R$ 8,00 — visíveis num
// gráfico, irrelevantes em qualquer soma da casa. E toda linha leva
// `[exemplo]` na nota, que é como `--remover` as encontra: nenhuma comissão de
// verdade é apagada por engano, porque a marca não existe fora daqui.
//
// COBRE OS SEIS TIPOS e as três formas de pagamento, incluindo uma série com
// entrada — senão o detalhamento de "entrada + parcelas" fica sem caso de uso
// na tela que existe para mostrá-lo.
//
// Uso:
//   node scripts/semear-comissao-exemplo.mjs             dry-run
//   node scripts/semear-comissao-exemplo.mjs --aplicar
//   node scripts/semear-comissao-exemplo.mjs --remover --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { randomUUID } from 'node:crypto';

loadEnv();
const APLICAR = process.argv.includes('--aplicar');
const REMOVER = process.argv.includes('--remover');
const PESSOA = 4; // Fernando
const MARCA = '[exemplo]';
const ATOR = 'script:semear-comissao-exemplo';
const brl = (c) => 'R$ ' + (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// Avulsas: passado e futuro, um tipo diferente em cada, para a legenda do
// gráfico exercitar as seis cores.
const AVULSAS = [
  { mes: '2026-05', cents: 300, tipo: 'vendas_consultoria', cliente: 'Terra Brasilis',   desc: 'Consultoria — diagnóstico' },
  { mes: '2026-06', cents: 500, tipo: 'vendas_obras',       cliente: 'Edf Aurora',       desc: 'Obra — assinatura' },
  { mes: '2026-07', cents: 200, tipo: 'diarias_servico',    cliente: 'Selecta Alimentos',desc: 'Diária de inspeção' },
  { mes: '2026-08', cents: 800, tipo: 'vendas_lotes',       cliente: 'Loteamento Sul',   desc: 'Venda de lote' },
  { mes: '2026-09', cents: 400, tipo: 'gestao',             cliente: 'Usina Caruaru',    desc: 'Gestão de usina' },
  { mes: '2026-10', cents: 100, tipo: 'outros',             cliente: null,               desc: 'Indicação' },
  { mes: '2026-11', cents: 600, tipo: 'vendas_obras',       cliente: 'Edf Ficus',        desc: 'Obra — medição' }
];

// Uma série com ENTRADA: R$ 6,00 = entrada de R$ 3,00 + 3× R$ 1,00.
const SERIE = {
  tipo: 'vendas_obras', cliente: 'Residencial Exemplo', desc: 'Obra — entrada e parcelas',
  totalCents: 600, entradaCents: 300, primeira: '2026-09',
  parcelas: [
    { mes: '2026-09', cents: 300, n: 1, entrada: true },
    { mes: '2026-10', cents: 100, n: 2, entrada: false },
    { mes: '2026-11', cents: 100, n: 3, entrada: false },
    { mes: '2026-12', cents: 100, n: 4, entrada: false }
  ]
};

const pool = financePool();
const cli = await pool.connect();
try {
  const { rows: [ent] } = await cli.query(`SELECT entity_id FROM fin_person WHERE id=$1`, [PESSOA]);
  const entityId = ent.entity_id;

  if (REMOVER) {
    const { rows: alvo } = await cli.query(
      `SELECT id, to_char(competencia,'YYYY-MM') mes, valor_cents, descricao
         FROM fin_pessoa_comissao_declarada
        WHERE person_id=$1 AND nota LIKE $2 ORDER BY competencia`, [PESSOA, `${MARCA}%`]);
    const { rows: series } = await cli.query(
      `SELECT id FROM fin_pessoa_comissao_serie WHERE person_id=$1 AND nota LIKE $2`, [PESSOA, `${MARCA}%`]);
    console.log(`=== Remover exemplos do Fernando ===\n  ${alvo.length} lançamento(s), ${series.length} série(s)`);
    for (const a of alvo) console.log(`    ${a.mes}  ${brl(a.valor_cents)}  ${a.descricao}`);
    if (!APLICAR) { console.log('\nDRY-RUN — nada removido. Use --remover --aplicar.'); process.exit(0); }
    await cli.query('BEGIN');
    await cli.query(`DELETE FROM fin_pessoa_comissao_declarada WHERE person_id=$1 AND nota LIKE $2`, [PESSOA, `${MARCA}%`]);
    await cli.query(`DELETE FROM fin_pessoa_comissao_serie WHERE person_id=$1 AND nota LIKE $2`, [PESSOA, `${MARCA}%`]);
    await cli.query('COMMIT');
    console.log(`\n✓ removidos. Nenhuma comissão sem a marca "${MARCA}" foi tocada.`);
    process.exit(0);
  }

  const total = AVULSAS.reduce((s, a) => s + a.cents, 0) + SERIE.totalCents;
  console.log(`=== Comissões de exemplo — Fernando ===\n`);
  for (const a of AVULSAS) console.log(`  ${a.mes}  ${brl(a.cents).padStart(10)}  ${a.tipo.padEnd(20)}${a.desc}${a.cliente ? ' · ' + a.cliente : ''}`);
  console.log(`  série  ${brl(SERIE.totalCents).padStart(10)}  ${SERIE.tipo.padEnd(20)}${SERIE.desc} · ${SERIE.cliente}`);
  for (const p of SERIE.parcelas) console.log(`     ${p.mes}  ${brl(p.cents).padStart(10)}  ${p.entrada ? 'entrada' : `parcela ${p.n}/4`}`);
  console.log(`\n  TOTAL ${brl(total)} · todos marcados com "${MARCA}" na nota`);

  if (!APLICAR) { console.log('\nDRY-RUN — nada gravado. Use --aplicar.'); process.exit(0); }

  const lote = randomUUID();
  await cli.query('BEGIN');
  const nota = `${MARCA} dado de demonstração — apagar com --remover`;
  const gravar = async (mes, cents, tipo, cliente, desc, serieId, parcela, parcelasTotal) => {
    const { rows: [l] } = await cli.query(
      `INSERT INTO fin_pessoa_comissao_declarada
         (entity_id, person_id, competencia, valor_cents, descricao, nota, tipo_slug, cliente,
          serie_id, parcela, parcelas_total)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [entityId, PESSOA, `${mes}-01`, cents, desc, nota, tipo, cliente, serieId, parcela, parcelasTotal]);
    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, batch_id, actor)
       VALUES ($1,'fin_pessoa_comissao_declarada',$2,'insert',$3::jsonb,ARRAY['*'],$4,$5)`,
      [entityId, l.id, JSON.stringify({ mes, cents, tipo, cliente, exemplo: true }), lote, ATOR]);
    return l.id;
  };

  for (const a of AVULSAS) await gravar(a.mes, a.cents, a.tipo, a.cliente, a.desc, null, null, null);

  const { rows: [s] } = await cli.query(
    `INSERT INTO fin_pessoa_comissao_serie
       (entity_id, person_id, descricao, total_cents, parcelas_total, valor_parcela_cents,
        primeira_competencia, nota, tipo_slug, cliente, entrada_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11) RETURNING id`,
    [entityId, PESSOA, SERIE.desc, SERIE.totalCents, SERIE.parcelas.length, 100,
     `${SERIE.primeira}-01`, nota, SERIE.tipo, SERIE.cliente, SERIE.entradaCents]);
  for (const p of SERIE.parcelas) {
    await gravar(p.mes, p.cents, SERIE.tipo, SERIE.cliente,
      `${SERIE.desc}${p.entrada ? ' (entrada)' : ` (${p.n}/4)`}`, s.id, p.n, SERIE.parcelas.length);
  }
  await cli.query('COMMIT');
  console.log(`\n✓ ${AVULSAS.length} avulsas + 1 série de ${SERIE.parcelas.length} parcelas gravadas.`);
  console.log(`  apagar depois: node scripts/semear-comissao-exemplo.mjs --remover --aplicar`);
} finally { cli.release(); await pool.end(); }
