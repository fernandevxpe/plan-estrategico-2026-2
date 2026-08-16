// O painel de prontidão: onde a base financeira está, medido e não estimado.
//
// Existe como script e não como consulta avulsa porque é rodado a cada ciclo de
// trabalho — antes de escolher a frente, e de novo depois de executá-la. Duas
// medições escritas em lugares diferentes acabam discordando exatamente no dia
// em que a diferença importa.
//
// A REGRA ZERO vem primeiro e não é um indicador entre outros: se o caixa de
// alguma conta não fecha, o resto do painel é decoração. Um ledger 100%
// categorizado sobre saldo que não bate vale zero.
//
// E "fecha" não é "está em dia": a conta pode fechar aritmeticamente no dia em
// que o extrato termina e ainda mentir sobre hoje. Por isso o painel mostra
// também há quantos dias cada conta está parada.
//
// Uso:
//   node scripts/painel-financeiro.mjs
//   node scripts/painel-financeiro.mjs --json    para comparar dois momentos
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const JSON_OUT = process.argv.includes('--json');
// O escopo de trabalho é 2026: o Fernando declarou o histórico anterior fora de
// escopo, e medir tudo junto esconde isso. O Asaas carrega 8.400 linhas de
// 2021–2025 que arrastam qualquer percentual para baixo sem que haja trabalho a
// fazer nelas. `--tudo` mostra a base inteira quando alguém quiser conferir.
const TUDO = process.argv.includes('--tudo');
const DESDE = TUDO ? '1900-01-01' : '2026-01-01';
const ESCOPO = TUDO ? 'base inteira' : 'ano de 2026';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n) => `${Number(n).toFixed(1)}%`;

const META = 90;

const pool = financePool();

try {
  // -------------------------------------------------------------------------
  // Regra zero: o caixa fecha?
  // -------------------------------------------------------------------------
  const { rows: contas } = await pool.query(
    `SELECT a.slug,
            a.opening_balance_cents,
            a.opening_balance_date,
            a.current_balance_cents,
            a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS calculado,
            max(t.posted_on) AS ultimo_lancamento,
            count(t.id) AS lancamentos
       FROM fin_account a
       LEFT JOIN fin_transaction t ON t.account_id = a.id
            AND (a.opening_balance_date IS NULL OR t.posted_on >= a.opening_balance_date)
      GROUP BY a.id, a.slug, a.opening_balance_cents, a.opening_balance_date, a.current_balance_cents
      ORDER BY a.id`
  );

  const hoje = new Date();
  const contasAvaliadas = contas.map((c) => {
    const fecha = Number(c.calculado) === Number(c.current_balance_cents ?? 0);
    const diasParado = c.ultimo_lancamento
      ? Math.floor((hoje - new Date(c.ultimo_lancamento)) / 86_400_000)
      : null;
    return { ...c, fecha, diasParado };
  });
  const fecham = contasAvaliadas.filter((c) => c.fecha).length;

  // -------------------------------------------------------------------------
  // Indicadores de organização do ledger
  // -------------------------------------------------------------------------
  // Núcleo e centro de custo medem organização de RESULTADO, e por isso a base
  // deles exclui `movimentacao`.
  //
  // Não é a régua sendo afrouxada para o número ficar bonito: núcleo é o eixo da
  // DRE, e transferência entre contas próprias, aplicação e resgate não entram em
  // DRE nenhuma — são o mesmo dinheiro mudando de lugar. Exigir núcleo delas é
  // exigir classificação de algo que não é classificável, e o indicador passaria
  // a nunca fechar por um motivo errado.
  //
  // Medido em 15/08: a régua sobre tudo dava 88,9%; sobre o que entra em DRE,
  // 92,2%. As 498 linhas de diferença são todas movimentação.
  // A coluna nasce na 0044. O painel é a ferramenta que diz se as migrations
  // precisam rodar, então ele não pode ser o primeiro a quebrar quando falta
  // uma: sem a coluna, tudo que estiver em trânsito conta como acionável, que é
  // exatamente o que se sabia antes de a 0044 separar os dois casos.
  const { rows: [temMotivo] } = await pool.query(
    `SELECT count(*) n FROM information_schema.columns
      WHERE table_name = 'fin_transaction' AND column_name = 'transfer_unresolved_reason'`
  );
  const COL_MOTIVO = Number(temMotivo.n) > 0 ? 't.transfer_unresolved_reason' : 'NULL::text';

  const { rows: [ind] } = await pool.query(
    `SELECT count(*)::numeric                                                        AS total,
            count(*) FILTER (WHERE t.counterparty_id IS NOT NULL)                    AS contraparte,
            count(*) FILTER (WHERE t.category_id IS NOT NULL)                        AS categoria,
            count(*) FILTER (WHERE t.source_kind IS NOT NULL)                        AS lastro,
            count(*) FILTER (WHERE t.review_status IS NOT NULL AND t.review_status <> 'pendente') AS revisao,
            count(*) FILTER (WHERE t.transfer_status <> 'em_transito')               AS transferencia,
            -- A 0044 separou dois vazios que este indicador somava como um só.
            -- Uma perna em trânsito porque ninguém pareou ainda é trabalho; uma
            -- em trânsito porque o extrato do outro lado NÃO EXISTE (Asaas de
            -- 2022–2025, quando Inter e Nubank não estão no ledger; PIX para a
            -- conta da Caixa que ninguém importou) é impossibilidade declarada.
            --
            -- As duas continuam contando contra o indicador — de propósito.
            -- Trocar o rótulo delas por um status novo levaria o número de 98,0%
            -- para 99,2% sem que um fato tivesse sido estabelecido, que é a
            -- versão elegante de esconder. O que muda aqui é só a LEITURA: quem
            -- olha o painel passa a saber quanto do que falta é acionável.
            count(*) FILTER (WHERE t.transfer_status = 'em_transito'
                               AND ${COL_MOTIVO} IS NOT NULL)                        AS sem_cobertura,
            count(*) FILTER (WHERE t.transfer_status = 'em_transito'
                               AND ${COL_MOTIVO} IS NULL)                            AS transito_acionavel,
            count(*) FILTER (WHERE COALESCE(c.cash_flow_group,'') <> 'movimentacao')::numeric AS base_dre,
            count(*) FILTER (WHERE COALESCE(c.cash_flow_group,'') <> 'movimentacao'
                               AND t.nucleo IS NOT NULL)                             AS nucleo_dre,
            count(*) FILTER (WHERE COALESCE(c.cash_flow_group,'') <> 'movimentacao'
                               AND t.cost_center_id IS NOT NULL)                     AS centro_dre,
            count(*) FILTER (WHERE COALESCE(c.cash_flow_group,'') <> 'movimentacao'
                               AND t.counterparty_id IS NOT NULL)                     AS contraparte_dre
       FROM fin_transaction t
       LEFT JOIN fin_category c ON c.id = t.category_id
      WHERE t.posted_on >= $1::date`,
    [DESDE]
  );

  const indicadores = [
    ['centro de custo (projeto)', ind.centro_dre, ind.base_dre],
    // Contraparte também mede sobre a base de resultado, e pelo mesmo motivo do
    // núcleo: transferência entre contas próprias, aplicação e resgate não TÊM
    // contraparte externa a identificar. A empresa não é contraparte de si mesma
    // — regra que o projeto já aplica desde o import do Inter ("o CNPJ da
    // própria empresa não é contraparte").
    //
    // Medido em 16/08: das 512 linhas de 2026 sem contraparte, 161 carregam o
    // CNPJ da casa (100% das que têm documento) e o resto é aplicação/resgate de
    // RDB, onde a outra ponta é o próprio banco. Sobre todas as linhas o
    // indicador dava 86,8%; sobre o que pode ter contraparte, 98,5%.
    ['contraparte identificada', ind.contraparte_dre, ind.base_dre],
    ['núcleo definido', ind.nucleo_dre, ind.base_dre],
    ['revisão concluída', ind.revisao, ind.total],
    ['lastro de origem', ind.lastro, ind.total],
    ['categoria atribuída', ind.categoria, ind.total],
    ['transferência resolvida', ind.transferencia, ind.total]
  ].map(([nome, ok, base]) => ({
    nome,
    ok: Number(ok),
    total: Number(base),
    pct: (100 * Number(ok)) / Number(base)
  })).sort((a, b) => a.pct - b.pct);

  const abaixoDaMeta = indicadores.filter((i) => i.pct < META);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      medido_em: hoje.toISOString(),
      caixa: { fecham, total: contasAvaliadas.length,
               contas: contasAvaliadas.map((c) => ({ slug: c.slug, fecha: c.fecha, dias_parado: c.diasParado })) },
      indicadores: indicadores.map((i) => ({ nome: i.nome, ok: i.ok, total: i.total, pct: Number(i.pct.toFixed(1)) })),
      transferencia: {
        em_transito: Number(ind.sem_cobertura) + Number(ind.transito_acionavel),
        acionavel: Number(ind.transito_acionavel),
        sem_cobertura_declarada: Number(ind.sem_cobertura)
      },
      pronto: fecham === contasAvaliadas.length && abaixoDaMeta.length === 0
    }, null, 2));
    process.exit(0);
  }

  console.log('\n══ REGRA ZERO — o caixa fecha? ══\n');
  for (const c of contasAvaliadas) {
    const marca = c.fecha ? '✓' : '✗';
    const dias = c.diasParado === null ? 'sem lançamento'
      : c.diasParado === 0 ? 'hoje'
      : `há ${c.diasParado} dia(s)`;
    const delta = c.fecha ? '' : `  Δ ${brl(Number(c.calculado) - Number(c.current_balance_cents ?? 0))}`;
    console.log(`  ${marca} ${c.slug.padEnd(18)} ${brl(c.calculado).padStart(14)}   último: ${dias}${delta}`);
  }
  console.log(`\n  ${fecham}/${contasAvaliadas.length} contas fecham`);
  if (fecham < contasAvaliadas.length) {
    console.log('  ⚠ enquanto uma conta não fecha, os indicadores abaixo não valem nada');
  }

  console.log(`\n══ INDICADORES (meta 90%) — ${ESCOPO} ══\n`);
  for (const i of indicadores) {
    const barra = '█'.repeat(Math.round(i.pct / 5)).padEnd(20, '·');
    const marca = i.pct >= META ? '✓' : '·';
    console.log(`  ${marca} ${i.nome.padEnd(28)} ${barra} ${pct(i.pct).padStart(6)}  (${i.ok}/${i.total})`);
  }

  // O que falta para "transferência resolvida" fechar, aberto em trabalho e
  // impossibilidade. O percentual acima não muda com esta linha — ela só diz
  // qual parte do que falta alguém consegue atacar.
  const semCobertura = Number(ind.sem_cobertura);
  const acionavel = Number(ind.transito_acionavel);
  if (semCobertura + acionavel > 0) {
    console.log(`\n    das ${semCobertura + acionavel} pernas ainda em trânsito:`);
    console.log(`      ${String(acionavel).padStart(4)} acionáveis — falta parear`);
    console.log(`      ${String(semCobertura).padStart(4)} sem cobertura declarada — o extrato do outro lado não existe no ledger`);
  }

  console.log('\n══ VEREDITO ══\n');
  if (fecham === contasAvaliadas.length && abaixoDaMeta.length === 0) {
    console.log('  Base pronta: caixa fecha em todas as contas e nenhum indicador abaixo de 90%.');
  } else {
    if (fecham < contasAvaliadas.length) {
      console.log(`  Caixa: ${contasAvaliadas.length - fecham} conta(s) não fecham — resolver antes de tudo.`);
    }
    if (abaixoDaMeta.length) {
      console.log(`  Abaixo da meta: ${abaixoDaMeta.map((i) => `${i.nome} (${pct(i.pct)})`).join(', ')}`);
    }
  }
  console.log('');
} finally {
  await pool.end();
}
