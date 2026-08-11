// Tira de "Salários" quem não é do time.
//
// A regra 42 (`pix-pessoa-fisica`) manda para 6.01 tudo que começa com "Pix
// enviado", sem olhar documento nem cadastro. Medição contra gabarito humano:
// precisão de 15,2%. Resultado: MAFEMA, JAGUAR, KGMLAN, NEOCHARGE e mais uma
// dúzia de fornecedores dentro da folha, inflando o custo de gente.
//
// O critério é do dono, dado em 10/08/2026: quem está em `fin_person` é gente;
// quem não está é fornecedor. Agora que o cadastro existe e as ligações estão
// confirmadas, ele é aplicável por dado, e não por heurística de texto.
//
// PARA ONDE VÃO — e por que não é Terceirização:
//
// A descrição desses lançamentos não diz o que a empresa fornece ("Transferência
// enviada pelo Pix — JAGUAR - 00.815.532/0001-87 - ITAÚ"). Chutar 4.03
// Terceirização acertaria nos prestadores de serviço e erraria em todo
// fornecedor de material — trocaria um erro conhecido por outro, com a mesma
// aparência de certeza.
//
// 5.99 "Despesa a classificar" é o que a plataforma tem para dizer "sei que não
// é salário e não sei o que é". Com item de fila, vira pergunta visível em vez
// de número errado silencioso. Sair da folha já é o ganho: é lá que o erro
// distorce a decisão.
//
// Uso:
//   node scripts/desinflar-folha.mjs            dry-run (padrão)
//   node scripts/desinflar-folha.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const { rows: [antes] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(-t.amount_cents),0) v
       FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
      WHERE c.code IN ('6.01','6.02','6.06') AND t.amount_cents < 0`
  );

  // Quem sai: está em categoria de folha e NÃO tem pessoa confirmada.
  const { rows: alvo } = await client.query(
    `SELECT t.id, t.entity_id, t.amount_cents, t.category_id,
            COALESCE(cp.name, t.counterparty_raw, '(sem contraparte)') AS quem
       FROM fin_transaction t
       JOIN fin_category c ON c.id = t.category_id
       LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
       LEFT JOIN fin_person_counterparty pc
              ON pc.counterparty_id = t.counterparty_id AND pc.status = 'confirmado'
      WHERE c.code IN ('6.01','6.02','6.06')
        AND t.amount_cents < 0
        AND pc.id IS NULL
        -- Decisão humana vence: quem foi classificado à mão ou travado fica.
        AND t.classified_by IS DISTINCT FROM 'humano'
        AND NOT ('category_id' = ANY (t.human_locked_fields))`
  );

  const { rows: [aclassificar] } = await client.query(`SELECT id FROM fin_category WHERE code = '5.99'`);

  const porQuem = new Map();
  for (const t of alvo) {
    const atual = porQuem.get(t.quem) ?? { n: 0, v: 0 };
    atual.n += 1;
    atual.v += Math.abs(Number(t.amount_cents));
    porQuem.set(t.quem, atual);

    // Trilha antes de mexer, com a categoria anterior — sem isto não há como
    // desfazer nem explicar depois por que a linha mudou.
    await client.query(
      `INSERT INTO fin_classification_event
         (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
       VALUES ('fin_transaction', $1, 'regra', $2, false,
               jsonb_build_object('category_id', $3::bigint),
               jsonb_build_object('motivo','fora da folha: contraparte sem pessoa no cadastro',
                                  'criterio','quem está em fin_person é gente, quem não está é fornecedor'),
               'desinflar-folha')`,
      [t.id, aclassificar.id, t.category_id]
    );

    await client.query(
      `UPDATE fin_transaction
          SET category_id = $2, review_status = 'pendente',
              classified_by = 'regra', classified_reason = jsonb_build_object('motivo','saiu da folha: não é pessoa do cadastro'),
              classified_at = now(), updated_at = now()
        WHERE id = $1`,
      [t.id, aclassificar.id]
    );

    await client.query(
      `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, status)
       SELECT $1, 'fin_transaction', $2, 'sem_categoria', $3, 'pendente'
        WHERE NOT EXISTS (SELECT 1 FROM fin_review_item ri
                           WHERE ri.target_table='fin_transaction' AND ri.target_id=$2 AND ri.status='pendente')`,
      [t.entity_id, t.id, t.amount_cents]
    );
  }

  console.log('\nSaindo da folha — contrapartes sem pessoa no cadastro\n');
  [...porQuem.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 15).forEach(([quem, x]) =>
    console.log(`  ${String(quem).slice(0, 38).padEnd(40)}${String(x.n).padStart(4)}  ${brl(x.v).padStart(13)}`)
  );

  const { rows: [depois] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(-t.amount_cents),0) v
       FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
      WHERE c.code IN ('6.01','6.02','6.06') AND t.amount_cents < 0`
  );
  console.log(`\n  folha antes:  ${String(antes.n).padStart(4)}  ${brl(antes.v)}`);
  console.log(`  folha depois: ${String(depois.n).padStart(4)}  ${brl(depois.v)}`);
  console.log(`  saíram:       ${String(alvo.length).padStart(4)}  ${brl(Number(antes.v) - Number(depois.v))}`);

  const { rows: [total] } = await client.query(`SELECT sum(amount_cents) v FROM fin_transaction`);
  console.log(`\n  âncora — soma do ledger: ${brl(total.v)} (não pode mudar)`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
