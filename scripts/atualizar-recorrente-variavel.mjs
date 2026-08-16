// Recorrentes de valor variável: a previsão é o ÚLTIMO recebido, não a média.
//
// ---------------------------------------------------------------------------
// A REGRA, E DE ONDE ELA VEM
// ---------------------------------------------------------------------------
// Do Fernando, sobre a BRA (cadastrada como PIAU SERVIÇOS DE ENGENHARIA):
//
//   "é um parceiro que paga recorrente mas o valor médio pode considerar a
//    previsão dos próximos meses igual a do mês anterior — se a BRA me pagou
//    agosto 22 mil, o previsto para setembro vai ser 22k. Quando receber o
//    próximo, atualiza a projeção."
//
// É uma regra de negócio, não um detalhe técnico: para receita que varia com
// volume (rateio de energia, faturas geradas), o mês passado prevê o próximo
// melhor que a média de dois anos. A média suaviza justamente a informação
// nova, que é a que importa.
//
// O caso mede o custo de errar isso. A projeção da BRA estava em R$ 20.850,40,
// calculada pela mediana de 32 meses. Os últimos oito meses reais:
//
//   dez/25  19.205,00     abr/26  12.650,35
//   jan/26  16.919,05     mai/26  14.320,37
//   fev/26  19.790,28     jun/26  16.032,63
//   mar/26  14.621,87     jul/26  15.278,75
//
// Nenhum mês recente chegou perto de R$ 20.850. A mediana carregava um passado
// que não descreve o presente, e inflava o segundo maior recebimento do mês.
//
// ---------------------------------------------------------------------------
// POR QUE ISTO É SCRIPT E NÃO MIGRATION
// ---------------------------------------------------------------------------
// Porque tem de rodar de novo a cada pagamento. Uma migration corrigiria hoje e
// a projeção voltaria a envelhecer amanhã. Este script roda junto do sync e
// mantém a previsão colada no último fato conhecido.
//
// Uso:
//   node scripts/atualizar-recorrente-variavel.mjs            dry-run
//   node scripts/atualizar-recorrente-variavel.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pool = financePool();
try {
  // Alvo: recorrente de valor variável — a que veio de detecção, não de
  // subscription do Asaas. Assinatura tem valor contratado e não se mexe nela;
  // parcelamento tem valor fixo por definição.
  const { rows } = await pool.query(
    `SELECT r.id, r.label, r.amount_cents AS atual, r.counterparty_id, cp.name,
            u.ultimo_cents, u.ultimo_mes
       FROM fin_recurring r
       JOIN fin_counterparty cp ON cp.id = r.counterparty_id
       CROSS JOIN LATERAL (
         SELECT sum(t.amount_cents) AS ultimo_cents,
                to_char(date_trunc('month', max(t.posted_on)), 'YYYY-MM') AS ultimo_mes
           FROM fin_transaction t
           LEFT JOIN fin_category c ON c.id = t.category_id
          WHERE t.counterparty_id = r.counterparty_id
            AND t.amount_cents > 0
            AND COALESCE(c.cash_flow_group,'') <> 'movimentacao'
            AND date_trunc('month', t.posted_on) = (
                  SELECT date_trunc('month', max(t2.posted_on))
                    FROM fin_transaction t2
                    LEFT JOIN fin_category c2 ON c2.id = t2.category_id
                   WHERE t2.counterparty_id = r.counterparty_id
                     AND t2.amount_cents > 0
                     AND COALESCE(c2.cash_flow_group,'') <> 'movimentacao')
       ) u
      WHERE r.status = 'ativo'
        AND r.direction = 'receber'
        AND r.source = 'deteccao_historico'
        AND u.ultimo_cents IS NOT NULL
        AND u.ultimo_cents <> r.amount_cents`
  );

  console.log(`\n[variável] ${rows.length} recorrente(s) com valor desatualizado\n`);
  console.log('  projetado hoje   último recebido   diferença      mês     cliente');
  let somaAntes = 0;
  let somaDepois = 0;
  for (const r of rows.sort((a, b) => Math.abs(b.ultimo_cents - b.atual) - Math.abs(a.ultimo_cents - a.atual))) {
    const dif = Number(r.ultimo_cents) - Number(r.atual);
    somaAntes += Number(r.atual);
    somaDepois += Number(r.ultimo_cents);
    console.log(
      `  ${brl(r.atual).padStart(14)}  ${brl(r.ultimo_cents).padStart(15)}  ` +
      `${(dif >= 0 ? '+' : '') + brl(dif).padStart(12)}  ${r.ultimo_mes}  ${(r.name ?? '').slice(0, 30)}`
    );
  }
  console.log(`\n  previsto/mês antes .... ${brl(somaAntes)}`);
  console.log(`  previsto/mês depois ... ${brl(somaDepois)}`);

  if (!APLICAR) { console.log('\n[dry-run] nada gravado. Use --aplicar.\n'); process.exit(0); }

  for (const r of rows) {
    await pool.query(
      `UPDATE fin_recurring
          SET amount_cents = $2,
              amount_basis = 'media_janela',
              last_seen_on = CURRENT_DATE,
              notes = COALESCE(notes || E'\\n','') ||
                      'Valor atualizado em ' || CURRENT_DATE || ' para o último recebido (' || $3 ||
                      '): receita variável projeta pelo mês anterior, não pela média — a média ' ||
                      'suaviza justamente a informação nova.',
              updated_at = now()
        WHERE id = $1`,
      [r.id, r.ultimo_cents, r.ultimo_mes]
    );
  }
  console.log(`\n[aplicado] ${rows.length} recorrente(s) atualizada(s).\n`);
} finally {
  await pool.end();
}
