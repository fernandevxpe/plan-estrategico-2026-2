// Preenche o núcleo (área) do lançamento, para a DRE por área existir.
//
// O problema: `fin_transaction.nucleo` está nulo em R$ 5,27 milhões — 99,5% do
// dinheiro. A estrutura existe desde a 0001 (quatro núcleos cadastrados, dez
// linhas de DRE) e nunca foi alimentada. Sem ela, "DRE de consultoria" e "DRE
// de obras" são a mesma tela vazia.
//
// TRÊS PONTES, da mais forte para a mais fraca. A ordem importa: cada uma só
// age no que a anterior não alcançou, e o script grava QUAL pontes decidiu cada
// linha, para que a confiança seja auditável depois.
//
//   1. PESSOA — o lançamento é para alguém do time, e a pessoa tem área.
//      É a mais forte: a área foi confirmada pelo dono, uma a uma.
//   2. CONTRAPARTE — fornecedor cujo núcleo é sempre o mesmo (aluguel é
//      corporativo, Receita Federal é corporativo).
//   3. CATEGORIA — a categoria de custo carrega o núcleo por natureza
//      (material de obra é obras).
//
// O que NÃO é feito aqui, de propósito: rateio. Despesa que serve a empresa
// inteira — aluguel, contabilidade, energia — não pertence a um núcleo, e
// atribuí-la a um faria a margem daquele núcleo mentir. Rateio é decisão de
// negócio (por receita? por headcount?) e precisa de quem manda, não de
// heurística.
//
// Uso:
//   node scripts/preencher-nucleo.mjs            dry-run (padrão)
//   node scripts/preencher-nucleo.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Área da pessoa → núcleo do ledger.
 *
 * `fin_nucleo` tem quatro: obras, consultoria, tecnologia, corporativo. As
 * áreas do time são mais granulares (software e hardware são ambos tecnologia;
 * marketing e administrativo são corporativo), e é isso que este mapa resolve.
 */
const AREA_PARA_NUCLEO = {
  consultoria: 'consultoria',
  obras: 'obras',
  software: 'tecnologia',
  hardware: 'tecnologia',
  marketing: 'corporativo',
  administrativo: 'corporativo'
};

/** Fornecedor cujo núcleo é sempre o mesmo, por natureza do que fornece. */
const CONTRAPARTE_PARA_NUCLEO = [
  { padrao: 'ancora imobiliaria', nucleo: 'corporativo', porque: 'aluguel da sede' },
  { padrao: 'receita federal', nucleo: 'corporativo', porque: 'tributo da empresa' },
  { padrao: 'ministerio da fazenda', nucleo: 'corporativo', porque: 'tributo da empresa' },
  { padrao: 'prefeitura', nucleo: 'corporativo', porque: 'tributo da empresa' },
  { padrao: 'elaine barbosa', nucleo: 'corporativo', porque: 'contabilidade' },
  { padrao: 'startlaw', nucleo: 'corporativo', porque: 'jurídico' },
  { padrao: 'agilize', nucleo: 'corporativo', porque: 'contabilidade anterior' },
  { padrao: 'flyer on', nucleo: 'corporativo', porque: 'marketing' },
  { padrao: 'localiza', nucleo: 'corporativo', porque: 'locação de veículo da empresa' },
  { padrao: 'crea', nucleo: 'consultoria', porque: 'anuidade de engenheiro' },
  { padrao: 'embrasul', nucleo: 'consultoria', porque: 'equipamento de medição' },
  { padrao: 'celpe', nucleo: 'corporativo', porque: 'energia da sede' },
  { padrao: 'neoenergia', nucleo: 'corporativo', porque: 'energia da sede' },
  { padrao: 'compesa', nucleo: 'corporativo', porque: 'água da sede' },
  { padrao: 'claro', nucleo: 'corporativo', porque: 'telecom' }
];

/** Categoria cujo núcleo é da natureza da despesa. */
const CATEGORIA_PARA_NUCLEO = {
  '4.02': 'obras', // material específico de obra
  '5.01': 'corporativo', // aluguel e condomínio
  '5.02': 'corporativo', // energia, água, internet
  '5.04': 'corporativo', // contabilidade e jurídico
  '5.05': 'corporativo', // marketing
  '5.07': 'corporativo', // material de escritório
  '5.10': 'consultoria', // taxas, anuidades e conselhos
  '4.05': 'corporativo' // tarifas bancárias
};

const pool = financePool();
const client = await pool.connect();
const passos = [];

try {
  await client.query('BEGIN');

  const { rows: [antes] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(-amount_cents),0) v FROM fin_transaction
      WHERE nucleo IS NULL AND amount_cents < 0 AND transfer_status = 'nao'`
  );

  // 1. Pela pessoa.
  for (const [area, nucleo] of Object.entries(AREA_PARA_NUCLEO)) {
    const { rows } = await client.query(
      `UPDATE fin_transaction t
          SET nucleo = $2, updated_at = now()
         FROM fin_person_counterparty pc
         JOIN fin_person pe ON pe.id = pc.person_id
        WHERE pc.counterparty_id = t.counterparty_id
          AND pc.status = 'confirmado'
          AND pe.area = $1
          AND t.nucleo IS NULL
          AND t.amount_cents < 0
          AND NOT ('nucleo' = ANY (t.human_locked_fields))
        RETURNING t.amount_cents`,
      [area, nucleo]
    );
    if (rows.length) passos.push({ ponte: `pessoa · ${area}`, nucleo, n: rows.length, v: rows.reduce((s, r) => s + Math.abs(Number(r.amount_cents)), 0) });
  }

  // 2. Pela contraparte.
  for (const c of CONTRAPARTE_PARA_NUCLEO) {
    const { rows } = await client.query(
      `UPDATE fin_transaction t
          SET nucleo = $2, updated_at = now()
         FROM fin_counterparty cp
        WHERE cp.id = t.counterparty_id
          AND cp.normalized_name LIKE '%' || $1 || '%'
          AND t.nucleo IS NULL
          AND t.amount_cents < 0
          AND NOT ('nucleo' = ANY (t.human_locked_fields))
        RETURNING t.amount_cents`,
      [c.padrao, c.nucleo]
    );
    if (rows.length) passos.push({ ponte: `contraparte · ${c.padrao}`, nucleo: c.nucleo, n: rows.length, v: rows.reduce((s, r) => s + Math.abs(Number(r.amount_cents)), 0) });
  }

  // 3. Pela categoria.
  for (const [code, nucleo] of Object.entries(CATEGORIA_PARA_NUCLEO)) {
    const { rows } = await client.query(
      `UPDATE fin_transaction t
          SET nucleo = $2, updated_at = now()
         FROM fin_category c
        WHERE c.id = t.category_id
          AND c.code = $1
          AND t.nucleo IS NULL
          AND t.amount_cents < 0
          AND NOT ('nucleo' = ANY (t.human_locked_fields))
        RETURNING t.amount_cents`,
      [code, nucleo]
    );
    if (rows.length) passos.push({ ponte: `categoria · ${code}`, nucleo, n: rows.length, v: rows.reduce((s, r) => s + Math.abs(Number(r.amount_cents)), 0) });
  }

  console.log('\nPreenchimento de núcleo\n');
  for (const p of passos) {
    console.log(`  ${p.ponte.padEnd(34)}→ ${p.nucleo.padEnd(13)}${String(p.n).padStart(5)}  ${brl(p.v).padStart(14)}`);
  }

  const { rows: [depois] } = await client.query(
    `SELECT count(*) n, COALESCE(sum(-amount_cents),0) v FROM fin_transaction
      WHERE nucleo IS NULL AND amount_cents < 0 AND transfer_status = 'nao'`
  );
  const cobriu = Number(antes.v) - Number(depois.v);
  console.log(`\n  sem núcleo antes:  ${String(antes.n).padStart(5)}  ${brl(antes.v)}`);
  console.log(`  sem núcleo depois: ${String(depois.n).padStart(5)}  ${brl(depois.v)}`);
  console.log(`  cobertura ganha:   ${(100 * cobriu / Number(antes.v)).toFixed(1)}%  (${brl(cobriu)})`);

  const { rows: resumo } = await client.query(
    `SELECT COALESCE(nucleo,'(sem núcleo)') nucleo, count(*) n, sum(-amount_cents) v
       FROM fin_transaction WHERE amount_cents < 0 AND transfer_status='nao'
      GROUP BY 1 ORDER BY 3 DESC`
  );
  console.log('\n  DESPESA POR NÚCLEO:');
  resumo.forEach((r) => console.log(`    ${String(r.nucleo).padEnd(16)}${String(r.n).padStart(5)}  ${brl(r.v).padStart(15)}`));

  // Âncora: preencher núcleo não move dinheiro.
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
