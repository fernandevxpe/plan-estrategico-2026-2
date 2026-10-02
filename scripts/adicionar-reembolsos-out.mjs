// Reembolsos que o dono ditou em 02/10/2026, para sair no pagamento de outubro.
//
//   node scripts/adicionar-reembolsos-out.mjs            mostra o que faria
//   node scripts/adicionar-reembolsos-out.mjs --aplicar  grava
//
// Três pessoas que não lançaram pelo app ("tiveram problema de acesso"):
// Belo (chip, R$ 30,00 todo mês), Audrey (R$ 244,97) e Flavio (R$ 244,51).
// Escreve em `fin_reimbursement` + `fin_reimbursement_item`, as tabelas que o
// app do time lê — é por isso que o lançamento aparece no celular de cada um.
//
// ---------------------------------------------------------------------------
// A COMPETÊNCIA NÃO É A MESMA PARA OS TRÊS, E O MOTIVO É O MESMO DO APP
// ---------------------------------------------------------------------------
// O gasto é de setembro, e o Flavio entra em 09/2026 como todo mundo. Belo e
// Audrey já têm o pedido de 09/2026 PAGO (as ordens de 02/09), e
// `fin_reembolso_saldo_unificado_v` ignora item de pedido pago — gravado ali, o
// dinheiro sumiria da fila. A regra do app para esse caso é "o reembolso de
// 09/2026 já foi pago — lance no mês corrente" (`criarReembolsoDoTime`), e é a
// que vale aqui: os dois vão para 10/2026. A data do gasto continua 30/09.
//
// ---------------------------------------------------------------------------
// O VALOR DA AUDREY FICA NUM ITEM SÓ
// ---------------------------------------------------------------------------
// O dono deu um número para três coisas — "transporte, alimentação e curso do
// Canva", R$ 244,97. Repartir em três itens seria inventar a divisão. Vai um
// item, sem tipo: tipo decide a categoria contábil, e nenhum dos três é o todo.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ENTITY = 'xpe';
const MES_DO_GASTO = '2026-09-01';
const MES_CORRENTE = '2026-10-01';
const DATA_GASTO = '2026-09-30';
const AUTOR = 'lançado pelo financeiro';
const ATOR = 'script:adicionar-reembolsos-out';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const CARGA = [
  ['Belo',   'Chip (plano de celular)',                       3000,  'plano-telefone-internet'],
  ['Audrey', 'Transporte, alimentação e curso do Canva',      24497, null],
  ['Flavio', 'Transporte',                                    24451, 'transporte']
];

const pool = financePool();
const client = await pool.connect();
console.log(`\nReembolsos ditados pelo dono — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

try {
  await client.query('BEGIN');
  const { rows: ent } = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
  const entityId = ent[0]?.id;
  if (!entityId) throw new Error(`entidade ${ENTITY} não existe`);

  let total = 0;
  const criados = [];

  for (const [nome, descricao, cents, tipo] of CARGA) {
    const { rows: pes } = await client.query(
      `SELECT id FROM fin_person WHERE name = $1 AND status = 'ativo' AND entity_id = $2`,
      [nome, entityId]
    );
    if (pes.length !== 1) throw new Error(`${nome}: ${pes.length} pessoa(s) ativa(s) com este nome`);
    const personId = pes[0].id;

    let categoryId = null;
    if (tipo) {
      const { rows: t } = await client.query(
        `SELECT category_id FROM fin_reimbursement_type WHERE slug = $1 AND is_active`,
        [tipo]
      );
      if (!t[0]) throw new Error(`tipo desconhecido: ${tipo}`);
      categoryId = t[0].category_id;
    }

    const { rows: doMes } = await client.query(
      `SELECT status FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
      [personId, MES_DO_GASTO]
    );
    const mes = doMes[0]?.status === 'pago' ? MES_CORRENTE : MES_DO_GASTO;

    // O dedupe da view: item do app some se a planilha tiver, na mesma pessoa e
    // competência, o mesmo valor ou a mesma descrição.
    const { rows: colide } = await client.query(
      `SELECT 1 FROM fin_reembolso_item a
        WHERE a.person_id = $1 AND a.competencia = $2::date
          AND (a.valor_parcela_cents = $3 OR lower(btrim(a.descricao)) = lower(btrim($4)))`,
      [personId, mes, cents, descricao]
    );
    if (colide[0]) throw new Error(`${nome}: colide com a planilha em ${mes.slice(0, 7)} — não apareceria no saldo`);

    // Repetição: rodar duas vezes não pode dobrar o reembolso de ninguém.
    const { rows: repetido } = await client.query(
      `SELECT i.id FROM fin_reimbursement_item i JOIN fin_reimbursement r ON r.id = i.reimbursement_id
        WHERE r.person_id = $1 AND r.reference_month = $2::date AND i.amount_cents = $3 AND i.description = $4
          AND i.status <> 'cancelado'`,
      [personId, mes, cents, descricao]
    );
    if (repetido[0]) throw new Error(`${nome}: este item já existe (item ${repetido[0].id})`);

    let { rows: cab } = await client.query(
      `SELECT id, status FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
      [personId, mes]
    );
    if (cab[0]?.status === 'pago') throw new Error(`${nome}: o pedido de ${mes.slice(0, 7)} também está pago`);
    if (!cab[0]) {
      ({ rows: cab } = await client.query(
        `INSERT INTO fin_reimbursement (entity_id, person_id, reference_month, status, submitted_at, approved_at, approved_by, notes)
         VALUES ($1, $2, $3::date, 'aprovado', now(), now(), $4, $5) RETURNING id, status`,
        [entityId, personId, mes, AUTOR, `gasto em ${DATA_GASTO}`]
      ));
    }

    const { rows: item } = await client.query(
      `INSERT INTO fin_reimbursement_item
         (reimbursement_id, category_id, reimbursement_type, description, expense_date, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5::date, $6, 'aprovado') RETURNING id`,
      [cab[0].id, categoryId, tipo, descricao, DATA_GASTO, cents]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_reimbursement_item', $2, 'insert', $3::jsonb,
               ARRAY['description','amount_cents','reimbursement_type'], $4)`,
      [
        entityId,
        item[0].id,
        JSON.stringify({ person: nome, reference_month: mes, description: descricao, amount_cents: cents, reimbursement_type: tipo }),
        ATOR
      ]
    );

    criados.push(item[0].id);
    total += cents;
    console.log(
      `  ${nome.padEnd(7)} competência ${mes.slice(0, 7)}  R$ ${brl(cents).padStart(7)}  ${descricao}` +
        (tipo ? `  [${tipo}]` : '  [sem tipo]')
    );
  }

  // Pós-condição: os três têm de estar VISÍVEIS no a-pagar, pelo valor inteiro.
  const { rows: v } = await client.query(
    `SELECT count(*)::int AS n, coalesce(sum(valor_parcela_cents), 0)::bigint AS cents
       FROM fin_reembolso_saldo_unificado_v WHERE origem = 'app' AND slug = ANY($1::text[])`,
    [criados.map((id) => `app-${id}`)]
  );
  if (v[0].n !== CARGA.length || Number(v[0].cents) !== total) {
    throw new Error(`só ${v[0].n} item(ns), R$ ${brl(v[0].cents)}, aparecem no saldo — esperava ${CARGA.length}, R$ ${brl(total)}`);
  }

  console.log(`\n  ${CARGA.length} itens · R$ ${brl(total)} · todos visíveis no a-pagar`);
  if (APLICAR) {
    await client.query('COMMIT');
    console.log('  gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('  nada gravado — rode com --aplicar.\n');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n  ABORTADO, nada gravado: ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
