// Roteia o custo de gente para a categoria certa, em vez de tudo em "Salários".
//
// O problema que resolve: 281 lançamentos estavam empilhados em 6.01 Salários
// enquanto Pró-labore, Estágio, Comissão, Reembolsos e Terceirização tinham
// ZERO uso. Não faltava categoria — faltava roteamento.
//
// A regra vem de decisão do dono (10/08/2026), não de heurística:
//
//   sócio e sócio adm ....... 6.02 Pró-labore
//   MEI do time ............. 6.01 Salários
//   estagiário .............. 6.06 Estágio
//   irregular/indefinido .... 6.01 Salários (é time; o vínculo é que falta)
//   terceirizados ........... categoria do SERVIÇO, não folha
//
// Sobre somar pró-labore com salário: o dono pediu que a visão de gestão some
// os dois ("contabilmente é que vai ser diferente"). Por isso a separação vive
// na CATEGORIA e a soma vive na TELA — o inverso obrigaria a escolher entre uma
// DRE correta e um número de gestão útil.
//
// Quem é terceirizado NÃO deixa de ser pessoa: Rita é do quadro de gente da
// empresa, mas o custo dela é serviço de limpeza. Pessoa e natureza do custo
// são eixos diferentes, e confundi-los foi o que produziu "Salários" com
// fornecedor dentro.
//
// Uso:
//   node scripts/classificar-custo-pessoas.mjs            dry-run (padrão)
//   node scripts/classificar-custo-pessoas.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Vínculo → categoria, para quem é do time. */
const POR_VINCULO = {
  socio: '6.02',
  socio_adm: '6.02',
  mei: '6.01',
  pj: '6.01',
  clt: '6.01',
  estagiario: '6.06',
  irregular: '6.01',
  indefinido: '6.01'
};

/**
 * Terceirizados, por nome normalizado da PESSOA.
 *
 * Vence o vínculo: Rita é MEI, mas o custo dela é limpeza e não folha.
 */
const TERCEIRIZADOS_PESSOA = {
  rita: '4.03', // limpeza do escritório
  kevin: '5.05' // marketing
};

/** Fornecedores que não são pessoas, por trecho do nome normalizado. */
const FORNECEDORES = [
  { padrao: 'flyer on', categoria: '5.05', o_que: 'tráfego pago' },
  { padrao: 'startlaw', categoria: '5.04', o_que: 'jurídico' },
  { padrao: 'agilize', categoria: '5.04', o_que: 'contabilidade' }
];

const pool = financePool();
const client = await pool.connect();
const resumo = new Map();

function conta(chave, cents) {
  const atual = resumo.get(chave) ?? { n: 0, v: 0 };
  atual.n += 1;
  atual.v += Math.abs(Number(cents));
  resumo.set(chave, atual);
}

try {
  await client.query('BEGIN');

  const { rows: cats } = await client.query(`SELECT id, code, name FROM fin_category`);
  const idPorCodigo = new Map(cats.map((c) => [c.code, c.id]));
  const nomePorCodigo = new Map(cats.map((c) => [c.code, c.name]));

  // ------------------------------------------------------------- pessoas
  const { rows: pessoas } = await client.query(
    `SELECT p.id, p.name, p.normalized_name, p.employment_type, pc.counterparty_id
       FROM fin_person p
       JOIN fin_person_counterparty pc ON pc.person_id = p.id
      WHERE pc.status = 'confirmado'`
  );

  for (const pe of pessoas) {
    const terceiro = Object.entries(TERCEIRIZADOS_PESSOA).find(([nome]) =>
      pe.normalized_name.includes(nome)
    );
    const codigo = terceiro ? terceiro[1] : POR_VINCULO[pe.employment_type];
    const categoriaId = idPorCodigo.get(codigo);
    if (!categoriaId) continue;

    // 'adiado' e 'ignorado' são decisão humana e vencem. human_locked_fields
    // também — mesma convenção dos importadores.
    const { rows } = await client.query(
      `UPDATE fin_transaction
          SET category_id = $2,
              review_status = CASE WHEN review_status IN ('adiado','ignorado')
                                   THEN review_status ELSE 'ok' END,
              -- 'favorecido' e não 'regra': nenhuma fin_rule decidiu isto. Quem
              -- decide é o VÍNCULO de quem recebeu, lido do cadastro. Carimbar
              -- 'regra' sem classified_rule_id quebrava o invariante D6 em 371
              -- lançamentos (R$ 548.652,57) e fazia o badge "por quê?" prometer
              -- uma regra que a tela nunca conseguiria abrir.
              classified_by = 'favorecido',
              classified_reason = jsonb_build_object(
                'campo','fin_person.employment_type',
                'motivo','custo de pessoa roteado por vínculo','pessoa',$3::text),
              classified_at = now(),
              updated_at = now()
        WHERE counterparty_id = $1
          AND amount_cents < 0
          AND transfer_status = 'nao'
          AND NOT ('category_id' = ANY (human_locked_fields))
          AND (category_id IS NULL OR category_id <> $2)
        RETURNING amount_cents`,
      [pe.counterparty_id, categoriaId, pe.name]
    );
    rows.forEach((r) => conta(`${codigo} ${nomePorCodigo.get(codigo)}`, r.amount_cents));
  }

  // -------------------------------------------------------- fornecedores
  for (const f of FORNECEDORES) {
    const categoriaId = idPorCodigo.get(f.categoria);
    const { rows } = await client.query(
      `UPDATE fin_transaction t
          SET category_id = $2,
              review_status = CASE WHEN t.review_status IN ('adiado','ignorado')
                                   THEN t.review_status ELSE 'ok' END,
              -- Mesmo motivo do bloco acima: quem decide é o FORNECEDOR casado
              -- por nome normalizado, não uma fin_rule.
              classified_by = 'favorecido',
              classified_reason = jsonb_build_object(
                'campo','fin_counterparty.normalized_name',
                'motivo','fornecedor conhecido','servico',$3::text),
              classified_at = now(),
              updated_at = now()
         FROM fin_counterparty c
        WHERE c.id = t.counterparty_id
          AND c.normalized_name LIKE '%' || $1 || '%'
          AND t.amount_cents < 0
          AND t.transfer_status = 'nao'
          AND NOT ('category_id' = ANY (t.human_locked_fields))
          AND (t.category_id IS NULL OR t.category_id <> $2)
        RETURNING t.amount_cents`,
      [f.padrao, categoriaId, f.o_que]
    );
    rows.forEach((r) => conta(`${f.categoria} ${nomePorCodigo.get(f.categoria)}`, r.amount_cents));
  }

  console.log('\nRoteamento do custo de gente\n');
  const total = [...resumo.values()].reduce((s, x) => s + x.v, 0);
  const linhas = [...resumo.entries()].sort((a, b) => b[1].v - a[1].v);
  for (const [cat, x] of linhas) {
    console.log(`  ${cat.padEnd(40)}${String(x.n).padStart(5)} lanç.  ${brl(x.v).padStart(15)}`);
  }
  console.log(`  ${''.padEnd(40)}${String([...resumo.values()].reduce((s, x) => s + x.n, 0)).padStart(5)}         ${brl(total).padStart(15)}`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar para gravar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
