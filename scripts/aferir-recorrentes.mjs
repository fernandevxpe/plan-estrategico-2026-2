// Confere o detector contra a realidade e encerra o que morreu.
//
// ---------------------------------------------------------------------------
// O ERRO QUE ISTO CORRIGE
// ---------------------------------------------------------------------------
// A primeira rodada do detector projetou R$ 99.042,13/mês de recebimento
// recorrente. O backtest contra o que de fato entrou:
//
//   abr/2026   realizado R$ 82.641,27   erro −R$ 16.400,86
//   mai/2026   realizado R$ 50.681,55   erro −R$ 48.360,58
//   jun/2026   realizado R$ 82.903,86   erro −R$ 16.138,27
//   jul/2026   realizado R$ 73.826,51   erro −R$ 25.215,62
//
// Superestimativa sistemática de ~37%. Não é ruído: é viés, e tem uma causa
// só — o detector olhava se algo ACONTECEU, nunca se ainda ACONTECE.
//
// Uma assinatura que rodou de abril a julho e parou continuava projetada para
// sempre. Numa previsão de caixa isso é o pior tipo de erro: infla a entrada,
// esconde o aperto, e some justamente quando o dinheiro faz falta.
//
// ---------------------------------------------------------------------------
// COMO SE MEDE "AINDA VIVA"
// ---------------------------------------------------------------------------
// Pela distância entre `last_seen_on` e hoje, em múltiplos da cadência. Uma
// mensal que não aparece há mais de ~2 ciclos (65 dias) não é mensal — ou
// encerrou, ou mudou de forma, e nos dois casos projetar o valor antigo é
// inventar.
//
// A linha não é apagada: vira `encerrado` com o motivo. O histórico dela
// continua explicando o passado, e se voltar a aparecer o detector a reativa.
//
// Uso:
//   node scripts/aferir-recorrentes.mjs            dry-run
//   node scripts/aferir-recorrentes.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const DIAS_SEM_APARECER = 65;   // dois ciclos mensais
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pool = financePool();
try {
  // 1. Atualiza last_seen_on com a última ocorrência real de cada recorrente.
  //    O detector gravou a data da amostra; o que importa é a última vez que a
  //    contraparte de fato movimentou naquela categoria e direção.
  const { rows: vistas } = await pool.query(
    `SELECT r.id, r.amount_cents, r.direction, cp.name,
            -- Sem filtrar por categoria, de propósito: a categoria do
            -- lançamento MUDA (reclassificação, regra nova, decisão humana), e
            -- amarrar a vivacidade a ela faz uma assinatura ativa parecer morta
            -- só porque alguém reclassificou o pagamento na semana passada. O
            -- que prova que a recorrente vive é a contraparte continuar
            -- movimentando no mesmo sentido.
            (SELECT max(t.posted_on) FROM fin_transaction t
              WHERE t.counterparty_id = r.counterparty_id
                AND ((r.direction='receber' AND t.amount_cents > 0)
                  OR (r.direction='pagar'   AND t.amount_cents < 0))) AS ultima
       FROM fin_recurring r
       LEFT JOIN fin_counterparty cp ON cp.id = r.counterparty_id
      WHERE r.status = 'ativo'`
  );

  const hoje = new Date();
  const mortas = [];
  const vivas = [];
  for (const v of vistas) {
    const dias = v.ultima ? Math.floor((hoje - new Date(v.ultima)) / 86_400_000) : 9999;
    (dias > DIAS_SEM_APARECER ? mortas : vivas).push({ ...v, dias });
  }

  const somaViva = vivas.filter((v) => v.direction === 'receber').reduce((s, v) => s + Number(v.amount_cents), 0);
  const somaMorta = mortas.filter((v) => v.direction === 'receber').reduce((s, v) => s + Number(v.amount_cents), 0);

  console.log(`\n[aferição] ${vistas.length} recorrente(s) ativa(s)`);
  console.log(`  ainda vivas ........ ${vivas.length}`);
  console.log(`  sem aparecer >${DIAS_SEM_APARECER}d .. ${mortas.length}\n`);

  if (mortas.length) {
    console.log('A ENCERRAR (não aparecem há mais de dois ciclos)');
    for (const m of mortas.sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 15)) {
      console.log(`  ${String(m.dias).padStart(4)}d  ${brl(m.amount_cents).padStart(12)}  ${(m.name ?? '?').slice(0, 40)}`);
    }
  }

  console.log(`\n  a receber projetado ANTES ... ${brl(somaViva + somaMorta)}`);
  console.log(`  a receber projetado DEPOIS .. ${brl(somaViva)}`);
  console.log(`  média realizada abr–jul ..... R$ 72.513,30  ← a régua`);

  if (!APLICAR) {
    console.log('\n[dry-run] nada gravado. Use --aplicar.\n');
    process.exit(0);
  }

  for (const m of mortas) {
    await pool.query(
      `UPDATE fin_recurring
          SET status = 'encerrado',
              last_seen_on = $2,
              notes = COALESCE(notes || E'\\n', '') ||
                      'Encerrada em 2026-08-16 pela aferição: sem ocorrência há ' || $3 || ' dias, ' ||
                      'mais de dois ciclos mensais. Projetar o valor antigo infla a entrada prevista.',
              updated_at = now()
        WHERE id = $1`,
      [m.id, m.ultima, m.dias]
    );
  }
  for (const v of vivas) {
    await pool.query(`UPDATE fin_recurring SET last_seen_on = $2, updated_at = now() WHERE id = $1`, [v.id, v.ultima]);
  }
  console.log(`\n[aplicado] ${mortas.length} encerrada(s), ${vivas.length} confirmada(s).\n`);
} finally {
  await pool.end();
}
