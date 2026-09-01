// Acrescenta reembolsos informados pelo dono, sem tocar no que já existe.
//
//   node scripts/adicionar-reembolsos.mjs            mostra o que faria
//   node scripts/adicionar-reembolsos.mjs --aplicar  grava
//
// ---------------------------------------------------------------------------
// ESCREVE NA `fin_reimbursement` + `fin_reimbursement_item`, E SÓ NELAS
// ---------------------------------------------------------------------------
// São DUAS tabelas para reembolso nesta base, e o AGENTS.md marca isso como a
// decisão perigosa em aberto: `fin_reimbursement_item` (193 linhas) e
// `fin_reembolso_item` (194), com 192 pares idênticos. "Qualquer soma nova que
// toque as duas conta dobrado."
//
// Este script escreve no par que os DOIS caminhos vivos usam — o app do time
// (`lib/financeiro/time.ts:1041`) e o importador de planilha
// (`scripts/import-reembolsos.mjs:181`). Nada aqui encosta em
// `fin_reembolso_item`, que é a tabela da planilha antiga.
//
// ---------------------------------------------------------------------------
// A ARMADILHA DO DEDUPE, E POR QUE ESTE SCRIPT CONFERE ANTES
// ---------------------------------------------------------------------------
// `fin_reembolso_saldo_unificado_v` (0179) SUPRIME um item do app quando existe,
// na mesma pessoa e competência, um item da planilha com o mesmo VALOR **ou** a
// mesma DESCRIÇÃO. É proposital — evita contar o mesmo Uber duas vezes — mas
// significa que um item novo pode ser gravado e nunca aparecer.
//
// Medido antes desta carga: zero itens em agosto e setembro/2026 para estas seis
// pessoas nas duas tabelas. Sem colisão. Ainda assim o script confere de novo na
// hora, porque o estado pode mudar entre uma execução e outra.
//
// ---------------------------------------------------------------------------
// AS DUAS DATAS SÃO DIFERENTES, E DE PROPÓSITO
// ---------------------------------------------------------------------------
//   expense_date     31/08/2026 — quando o gasto aconteceu
//   reference_month  09/2026    — a competência do reembolso
//
// Foi o que o dono pediu, em duas frases: "adicione todos como dia 31/agosto" e
// depois "tudo isso é para reembolso de setembro".
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ENTITY = 'xpe';
const COMPETENCIA = '2026-09-01';
const DATA_GASTO = '2026-08-31';
const AUTOR = 'lançado pelo financeiro';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

/*
 * `tipo` é FK para `fin_reimbursement_type(slug)`. Onde não há slug que
 * descreva o gasto, vai NULL — inventar um tipo por aproximação ("material de
 * marketing" virar "equipamentos") mentiria na categoria contábil, que sai do
 * tipo. A descrição carrega o que o tipo não sabe dizer.
 */
const CARGA = [
  ['Cleber',  [['Transporte', 47500, 'transporte'], ['Alimentação', 3300, 'alimentacao']]],
  ['Audrey',  [['Transporte', 21600, 'transporte'], ['Material de marketing', 2417, null]]],
  ['Belo',    [['Transporte', 5292, 'transporte'],  ['Internet para marketing', 3000, 'plano-telefone-internet']]],
  ['Diogo',   [['Transporte', 5528, 'transporte'],  ['Material para consultoria', 41254, null]]],
  ['Jonildo', [['Transporte', 34016, 'transporte']]],
  ['Gabriel', [['Transporte', 21852, 'transporte'], ['Plano celular', 9299, 'plano-telefone-internet']]]
];

const pool = financePool();
const client = await pool.connect();

console.log(`\nReembolsos — competência ${COMPETENCIA.slice(0, 7)}, gasto em ${DATA_GASTO}`);
console.log(`${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

let totalGeral = 0;
let itensGeral = 0;
const avisos = [];

try {
  await client.query('BEGIN');

  const { rows: ent } = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
  const entityId = ent[0]?.id;
  if (!entityId) throw new Error(`entidade ${ENTITY} não existe`);

  for (const [nome, itens] of CARGA) {
    const { rows: pes } = await client.query(
      `SELECT id, name FROM fin_person WHERE name = $1 AND status = 'ativo'`,
      [nome]
    );
    if (pes.length !== 1) {
      avisos.push(`${nome}: ${pes.length} pessoa(s) ativa(s) com este nome — pulei`);
      continue;
    }
    const pessoa = pes[0];
    const total = itens.reduce((s, [, cents]) => s + cents, 0);

    console.log(`  ${pessoa.name} (id ${pessoa.id})`);
    for (const [descricao, cents, tipo] of itens) {
      // A colisão que faria o item sumir da view unificada.
      const { rows: colide } = await client.query(
        `SELECT a.descricao, a.valor_parcela_cents
           FROM fin_reembolso_item a
          WHERE a.person_id = $1 AND a.competencia = $2::date
            AND (a.valor_parcela_cents = $3 OR lower(btrim(a.descricao)) = lower(btrim($4)))
          LIMIT 1`,
        [pessoa.id, COMPETENCIA, cents, descricao]
      );
      if (colide[0]) {
        avisos.push(
          `${pessoa.name} / ${descricao}: colide com a planilha ("${colide[0].descricao}", ` +
            `R$ ${brl(colide[0].valor_parcela_cents)}) — seria gravado e NÃO apareceria no saldo`
        );
      }
      console.log(
        `    ${descricao.padEnd(28)} R$ ${brl(cents).padStart(9)}  ${tipo ?? '(sem tipo — só descrição)'}`
      );
      itensGeral += 1;
    }
    console.log(`    ${''.padEnd(28)} R$ ${brl(total).padStart(9)}  total da pessoa\n`);
    totalGeral += total;

    if (APLICAR) {
      const { rows: cab } = await client.query(
        `INSERT INTO fin_reimbursement
           (entity_id, person_id, reference_month, status, total_cents,
            submitted_at, approved_at, approved_by, notes)
         VALUES ($1, $2, $3::date, 'aprovado', $4, now(), now(), $5, $6)
         RETURNING id`,
        [entityId, pessoa.id, COMPETENCIA, total, AUTOR, `gasto em ${DATA_GASTO}`]
      );
      const reimbursementId = cab[0].id;
      for (const [descricao, cents, tipo] of itens) {
        await client.query(
          `INSERT INTO fin_reimbursement_item
             (reimbursement_id, reimbursement_type, description, expense_date, amount_cents, status)
           VALUES ($1, $2, $3, $4::date, $5, 'aprovado')`,
          [reimbursementId, tipo, descricao, DATA_GASTO, cents]
        );
      }
    }
  }

  console.log(`  ${itensGeral} item(ns), ${CARGA.length} pessoa(s), R$ ${brl(totalGeral)}\n`);

  if (avisos.length) {
    console.log('  AVISOS:');
    for (const a of avisos) console.log(`    ! ${a}`);
    console.log('');
  }

  if (APLICAR) {
    // Pós-condição: o que entrou tem de estar VISÍVEL no saldo, senão o dedupe
    // engoliu em silêncio e o dinheiro some da fila de pagamento.
    const { rows: v } = await client.query(
      `SELECT count(*)::int AS n, COALESCE(SUM(valor_parcela_cents),0)::bigint AS cents
         FROM fin_reembolso_saldo_unificado_v s
         JOIN fin_person p ON p.id = s.person_id
        WHERE p.name = ANY($1) AND NOT s.quitado`,
      [CARGA.map(([n]) => n)]
    );
    console.log(`  no saldo unificado agora: ${v[0].n} item(ns), R$ ${brl(v[0].cents)}`);
    if (Number(v[0].cents) < totalGeral) {
      throw new Error(
        `o saldo (R$ ${brl(v[0].cents)}) é menor que o inserido (R$ ${brl(totalGeral)}) — o dedupe comeu alguma linha`
      );
    }
    await client.query('COMMIT');
    console.log('\n  ✓ gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('  Para aplicar: node scripts/adicionar-reembolsos.mjs --aplicar\n');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ✗ nada foi gravado: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
