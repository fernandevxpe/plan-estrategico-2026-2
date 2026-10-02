// Reembolso recorrente do Cleber: aluguel de carro, R$ 500,00 todo mês.
//
//   node scripts/reembolso-recorrente-cleber.mjs            mostra o que faria
//   node scripts/reembolso-recorrente-cleber.mjs --aplicar  grava
//
// O dono, em 02/10/2026: "um reembolso recorrente para cleber, de R$500 aluguel
// carro todo mês deve aparecer e vamos começar com esse mês".
//
// ---------------------------------------------------------------------------
// NÃO EXISTE REEMBOLSO RECORRENTE NESTA BASE — EXISTE UM ITEM POR MÊS
// ---------------------------------------------------------------------------
// `fin_recurring` é do contas a pagar da empresa e não chega ao app do time;
// `fin_installment_plan` é compra parcelada, com total e fim. O que a casa já
// faz para "todo mês" é o que `criarSerieMensal` faz no custo previsto: gravar
// as 12 competências de uma vez. Um job mensal deixaria o compromisso invisível
// até rodar, e o job não existe.
//
// São 12 itens, de 10/2026 a 09/2027. A 0195 só oferece o item do app quando a
// competência chega, então hoje entra só o de outubro; os outros onze aparecem
// um por mês, no app do Cleber e no a-pagar.
//
// O FIM É UM CHUTE DECLARADO: o dono não disse até quando. Em setembro/2027 a
// série acaba e alguém precisa renovar — ou cancelar antes, item a item, se o
// aluguel terminar.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ENTITY = 'xpe';
const PESSOA = 'Cleber';
const DESCRICAO = 'Aluguel de carro (recorrente)';
const TIPO = 'transporte';
const CENTS = 50000;
const PRIMEIRO_MES = [2026, 10];
const MESES = 12;
const AUTOR = 'lançado pelo financeiro';
const ATOR = 'script:reembolso-recorrente-cleber';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const pool = financePool();
const client = await pool.connect();
console.log(`\n${PESSOA} — ${DESCRICAO}, R$ ${brl(CENTS)}/mês — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

try {
  await client.query('BEGIN');
  const { rows: pes } = await client.query(
    `SELECT p.id, p.entity_id FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $2
      WHERE p.name = $1 AND p.status = 'ativo'`,
    [PESSOA, ENTITY]
  );
  if (pes.length !== 1) throw new Error(`${pes.length} pessoa(s) ativa(s) chamada(s) ${PESSOA}`);
  const { id: personId, entity_id: entityId } = pes[0];

  const { rows: t } = await client.query(
    `SELECT category_id FROM fin_reimbursement_type WHERE slug = $1 AND is_active`,
    [TIPO]
  );
  if (!t[0]) throw new Error(`tipo desconhecido: ${TIPO}`);

  const aPagar = async () =>
    Number(
      (
        await client.query(
          `SELECT coalesce(sum(valor_parcela_cents), 0)::bigint AS c FROM fin_reembolso_saldo_unificado_v
            WHERE person_id = $1 AND NOT quitado AND parcelas_restantes >= 1`,
          [personId]
        )
      ).rows[0].c
    );
  const antes = await aPagar();

  for (let n = 0; n < MESES; n += 1) {
    const mes = new Date(Date.UTC(PRIMEIRO_MES[0], PRIMEIRO_MES[1] - 1 + n, 1)).toISOString().slice(0, 10);

    const { rows: repetido } = await client.query(
      `SELECT i.id FROM fin_reimbursement_item i JOIN fin_reimbursement r ON r.id = i.reimbursement_id
        WHERE r.person_id = $1 AND r.reference_month = $2::date AND i.description = $3 AND i.status <> 'cancelado'`,
      [personId, mes, DESCRICAO]
    );
    if (repetido[0]) throw new Error(`${mes.slice(0, 7)} já tem este item (${repetido[0].id}) — a série já foi lançada`);

    let { rows: cab } = await client.query(
      `SELECT id, status FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
      [personId, mes]
    );
    if (cab[0]?.status === 'pago') throw new Error(`o pedido de ${mes.slice(0, 7)} já está pago`);
    if (!cab[0]) {
      ({ rows: cab } = await client.query(
        `INSERT INTO fin_reimbursement (entity_id, person_id, reference_month, status, submitted_at, approved_at, approved_by, notes)
         VALUES ($1, $2, $3::date, 'aprovado', now(), now(), $4, 'reembolso recorrente: aluguel de carro') RETURNING id, status`,
        [entityId, personId, mes, AUTOR]
      ));
    }

    const { rows: item } = await client.query(
      `INSERT INTO fin_reimbursement_item
         (reimbursement_id, category_id, reimbursement_type, description, expense_date, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5::date, $6, 'aprovado') RETURNING id`,
      // A data do gasto é o dia 1º do próprio mês: aluguel é do mês inteiro, e
      // qualquer outro dia seria inventado.
      [cab[0].id, t[0].category_id, TIPO, DESCRICAO, mes, CENTS]
    );
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_reimbursement_item', $2, 'insert', $3::jsonb,
               ARRAY['description','amount_cents','reimbursement_type'], $4)`,
      [
        entityId,
        item[0].id,
        JSON.stringify({ person: PESSOA, reference_month: mes, description: DESCRICAO, amount_cents: CENTS, serie: `${n + 1}/${MESES}` }),
        ATOR
      ]
    );
    console.log(`  ${mes.slice(0, 7)}  item ${item[0].id}  R$ ${brl(CENTS)}${n === 0 ? '  ← entra no pagamento de agora' : ''}`);
  }

  // Pós-condição: hoje entra UMA mensalidade, não as doze.
  const depois = await aPagar();
  if (depois - antes !== CENTS) {
    throw new Error(`a-pagar foi de R$ ${brl(antes)} para R$ ${brl(depois)}; esperava subir R$ ${brl(CENTS)}`);
  }

  console.log(`\n  a pagar ao ${PESSOA} agora: R$ ${brl(antes)} → R$ ${brl(depois)}`);
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
