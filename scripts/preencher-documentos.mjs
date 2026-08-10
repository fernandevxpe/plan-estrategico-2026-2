// Preenche o documento da contraparte a partir do que já está no extrato.
//
// A causa raiz de toda fragmentação de identidade nesta base: no extrato do
// Inter, `tipoTransacao='PIX'` traz `cpfCnpjRecebedor`, mas `PAGAMENTO`
// (boleto) NÃO traz documento nenhum — só a razão social como o cedente a
// registrou, normalmente abreviada. O Nubank é o mesmo buraco com outra roupa:
// traz CPF mascarado (`•••.650.314-••`).
//
// Resultado: a mesma empresa vira dois cadastros — um pelo PIX, com documento,
// outro pelo boleto, sem. Foi assim que Startlaw, Lyra M2M, CREA, Embrasul e
// mais seis se partiram, e foi assim que o Adryan virou duas pessoas.
//
// Este script não funde nada. Ele só PREENCHE o documento que já está escrito
// no texto do lançamento — depois disso, a busca por documento do importador
// passa a casar sozinha, e a fragmentação para de nascer.
//
// Uso:
//   node scripts/preencher-documentos.mjs            dry-run (padrão)
//   node scripts/preencher-documentos.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  // 1. CNPJ escrito na descrição, cadastro sem documento.
  //
  // Só age quando TODOS os lançamentos daquela contraparte apontam para o mesmo
  // CNPJ. Dois CNPJs diferentes no histórico significam que a contraparte já
  // está misturando entidades — preencher ali escolheria uma e esconderia o
  // problema.
  const { rows: candidatos } = await client.query(
    `WITH extraido AS (
       SELECT c.id, c.name,
              (regexp_match(t.description_raw, '([0-9]{2}\\.[0-9]{3}\\.[0-9]{3}/[0-9]{4}-[0-9]{2})'))[1] AS cnpj
         FROM fin_counterparty c
         JOIN fin_transaction t ON t.counterparty_id = c.id
        WHERE c.document_number IS NULL
          AND t.description_raw ~ '[0-9]{2}\\.[0-9]{3}\\.[0-9]{3}/[0-9]{4}-[0-9]{2}')
     SELECT id, name, count(DISTINCT cnpj) variantes,
            min(replace(replace(replace(cnpj,'.',''),'/',''),'-','')) documento
       FROM extraido WHERE cnpj IS NOT NULL
      GROUP BY 1,2`
  );

  console.log('\n1. CNPJ escrito no texto, cadastro sem documento\n');
  let preenchidas = 0;
  for (const c of candidatos) {
    if (Number(c.variantes) > 1) {
      console.log(`  ⚠ ${String(c.name).slice(0, 34).padEnd(36)} ${c.variantes} CNPJs diferentes — NÃO preenchido`);
      continue;
    }
    // Se o documento já pertence a outra contraparte, preencher violaria o
    // único parcial (entity_id, document_number). Isso não é erro: é a
    // fragmentação aparecendo, e a fusão é decisão à parte.
    const { rows: dono } = await client.query(
      `SELECT id, name FROM fin_counterparty WHERE document_number = $1 AND id <> $2`,
      [c.documento, c.id]
    );
    if (dono.length) {
      console.log(`  ↔ ${String(c.name).slice(0, 34).padEnd(36)} documento já é de "${dono[0].name}" (id ${dono[0].id}) — candidata a FUSÃO`);
      continue;
    }
    await client.query(
      `UPDATE fin_counterparty
          SET document_type = 'cnpj', document_number = $2,
              notes = COALESCE(notes || ' | ', '') || 'documento extraído do texto do lançamento',
              updated_at = now()
        WHERE id = $1`,
      [c.id, c.documento]
    );
    console.log(`  ✓ ${String(c.name).slice(0, 34).padEnd(36)} ${c.documento}`);
    preenchidas += 1;
  }

  // 2. Contrapartes da MESMA pessoa em que uma tem documento e a outra não.
  //
  // A ligação pessoa↔contraparte já foi confirmada por humano; propagar o
  // documento dentro dela não inventa identidade nova, só termina de escrever a
  // que já foi decidida. Sem isto, a próxima reimportação recria a duplicata:
  // foi exatamente o que aconteceu com o Adryan.
  console.log('\n2. Documento faltando em contraparte de pessoa já identificada\n');
  const { rows: pares } = await client.query(
    `SELECT pe.id person_id, pe.name pessoa,
            com.counterparty_id com_doc, cc.document_number, cc.document_type,
            sem.counterparty_id sem_doc, cs.name sem_nome
       FROM fin_person pe
       JOIN fin_person_counterparty com ON com.person_id = pe.id AND com.status = 'confirmado'
       JOIN fin_counterparty cc ON cc.id = com.counterparty_id AND cc.document_number IS NOT NULL
       JOIN fin_person_counterparty sem ON sem.person_id = pe.id AND sem.status = 'confirmado'
       JOIN fin_counterparty cs ON cs.id = sem.counterparty_id AND cs.document_number IS NULL`
  );

  let propagadas = 0;
  for (const par of pares) {
    // O documento não pode ser duplicado: se já houver outra contraparte com
    // ele, o certo é fundir, não copiar.
    const { rows: existe } = await client.query(
      `SELECT id FROM fin_counterparty WHERE document_number = $1 AND id <> $2`,
      [par.document_number, par.sem_doc]
    );
    if (existe.length) {
      console.log(`  ↔ ${String(par.pessoa).padEnd(20)} "${par.sem_nome}" — documento já em uso, caso de FUSÃO`);
      continue;
    }
    await client.query(
      `UPDATE fin_counterparty
          SET document_type = $2, document_number = $3,
              notes = COALESCE(notes || ' | ', '') || 'documento herdado da outra contraparte da mesma pessoa (ligação confirmada por humano)',
              updated_at = now()
        WHERE id = $1`,
      [par.sem_doc, par.document_type, par.document_number]
    );
    console.log(`  ✓ ${String(par.pessoa).padEnd(20)} "${String(par.sem_nome).slice(0, 30)}" ← ${par.document_number}`);
    propagadas += 1;
  }

  const { rows: [resto] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(-t.amount_cents),0) v
       FROM fin_transaction t JOIN fin_counterparty c ON c.id = t.counterparty_id
      WHERE c.document_number IS NULL AND t.amount_cents < 0`
  );

  console.log(`\n  preenchidas por texto: ${preenchidas}`);
  console.log(`  propagadas por pessoa: ${propagadas}`);
  console.log(`  ainda sem documento:   ${resto.n} lançamentos, ${brl(resto.v)}\n`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('  ROLLBACK — dry-run. Use --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
