// Tira a foto datada da previsão de caixa — e, depois, mede o quanto ela errou.
//
// POR QUE UMA FOTO, SE A VIEW JÁ RESPONDE
//
// `fin_caixa_previsto_dia_v` responde "o que eu acho hoje". Ela não consegue
// responder "o que eu achava em 16/08, e quanto eu errei", porque amanhã ela já
// mudou de ideia sem deixar rastro. Uma previsão que ninguém pode cobrar volta
// a ser palpite — e o princípio do projeto não aceita estimativa passando por
// fato nem quando a estimativa é sobre o futuro.
//
// É o mesmo raciocínio da 0034 sobre guardar `referencia` em vez de reimportar
// a planilha: foto datada é comparável, alvo móvel não é.
//
// O QUE ESTE SCRIPT NÃO FAZ
//
// Não escreve em `fin_transaction`. Não ativa recorrente. Não altera premissa.
// Ele lê views e grava linhas em `fin_cash_forecast`, que é tabela de previsão
// e não de caixa — nenhuma consulta de saldo a soma.
//
// Uso:
//   node scripts/prever-caixa.mjs                      dry-run (padrão)
//   node scripts/prever-caixa.mjs --cenario=todos      os três cenários
//   node scripts/prever-caixa.mjs --horizonte=180
//   node scripts/prever-caixa.mjs --aplicar            grava a foto
//   node scripts/prever-caixa.mjs --aferir             mede o erro das fotos antigas
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const ALGORITMO = 'previsao-caixa/1.0.0';

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const AFERIR = args.includes('--aferir');
const HORIZONTE = Number(args.find((a) => a.startsWith('--horizonte='))?.split('=')[1] ?? 90);
const CENARIO_ARG = args.find((a) => a.startsWith('--cenario='))?.split('=')[1] ?? 'base';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s).padStart(n);
const linha = (n = 78) => console.log('─'.repeat(n));

const pool = financePool();

async function main() {
  const cli = await pool.connect();
  try {
    const { rows: [ent] } = await cli.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
    if (!ent) throw new Error('entidade xpe não encontrada — banco errado?');

    const { rows: [hoje] } = await cli.query(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`
    );

    const cenarios = CENARIO_ARG === 'todos'
      ? ['base', 'conservador', 'otimista']
      : [CENARIO_ARG];

    console.log(`\nPREVISÃO DE CAIXA — gerado para ${hoje.d}, horizonte ${HORIZONTE} dias`);
    console.log(`algoritmo ${ALGORITMO} · cenário(s): ${cenarios.join(', ')}`);
    console.log(APLICAR ? '\n*** MODO APLICAR: a foto será gravada ***' : '\n(dry-run — nada será gravado)');

    // ── âncora ────────────────────────────────────────────────────────────
    const { rows: [anc] } = await cli.query(`
      SELECT SUM(a.current_balance_cents)::bigint AS saldo_cents,
             MIN(a.last_statement_at)::date::text AS ancora_ate,
             MAX(a.last_statement_at)::date::text AS ancora_mais_novo
        FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
       WHERE e.slug = 'xpe' AND a.is_active AND a.kind <> 'emprestimo'`);
    const { rows: [res] } = await cli.query(`
      SELECT COALESCE(SUM(r.target_cents), 0)::bigint AS minima_cents
        FROM fin_reserve r JOIN fin_entity e ON e.id = r.entity_id
       WHERE e.slug = 'xpe' AND r.is_active AND r.is_committed`);

    linha();
    console.log(`Âncora de saldo      R$ ${pad(brl(anc.saldo_cents), 14)}`);
    console.log(`Extratos cobrem até  ${anc.ancora_ate}${anc.ancora_ate < hoje.d ? `  ← ${diasEntre(anc.ancora_ate, hoje.d)} dia(s) de atraso: "fecha" ≠ "está em dia"` : ''}`);
    console.log(`Reserva comprometida R$ ${pad(brl(res.minima_cents), 14)}  (alvo declarado em fin_reserve)`);

    // ── camadas ───────────────────────────────────────────────────────────
    const { rows: camadas } = await cli.query(`
      SELECT natureza, camada, confianca, entra_no_saldo,
             COUNT(*)::int AS n, SUM(valor_cents)::bigint AS total
        FROM fin_previsao_evento_v
       WHERE dias_a_frente <= $1
       GROUP BY 1,2,3,4 ORDER BY 1,2,3`, [HORIZONTE]);

    linha();
    console.log(`CAMADAS — próximos ${HORIZONTE} dias\n`);
    console.log(`  ${'natureza'.padEnd(14)}${'camada'.padEnd(28)}${'confiança'.padEnd(12)}${pad('n', 4)}  ${pad('valor', 14)}  soma?`);
    for (const c of camadas) {
      console.log(`  ${c.natureza.padEnd(14)}${c.camada.padEnd(28)}${c.confianca.padEnd(12)}${pad(c.n, 4)}  ${pad(brl(c.total), 14)}  ${c.entra_no_saldo ? 'sim' : 'NÃO'}`);
    }

    // ── a checagem que importa: a saída prevista bate com a real? ─────────
    const { rows: [cob] } = await cli.query(`
      WITH real AS (
        SELECT date_trunc('month', t.posted_on)::date AS mes, SUM(-t.amount_cents) AS cents
          FROM fin_transaction t
         WHERE t.amount_cents < 0 AND t.transfer_status = 'nao' AND NOT t.is_split_parent
           AND t.posted_on >= date_trunc('month', CURRENT_DATE) - interval '7 month'
           AND t.posted_on <  date_trunc('month', CURRENT_DATE)
         GROUP BY 1
      ), prev AS (
        SELECT SUM(valor_cents) AS cents FROM fin_previsao_evento_v
         WHERE sentido = 'saida' AND entra_no_saldo AND dias_a_frente <= 90
      )
      SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.cents))::bigint AS real_mediana_cents,
             (SELECT cents FROM prev)::bigint AS prev_90_cents
        FROM real r`);
    const prevMes = Number(cob.prev_90_cents) / 3;
    linha();
    console.log('COBERTURA DA SAÍDA — a pergunta que reprova a previsão\n');
    console.log(`  saída realizada, mediana dos 7 meses fechados   R$ ${pad(brl(cob.real_mediana_cents), 14)}/mês`);
    console.log(`  saída prevista que entra no saldo (90d ÷ 3)     R$ ${pad(brl(prevMes), 14)}/mês`);
    console.log(`  cobertura                                       ${pad(((100 * prevMes) / Number(cob.real_mediana_cents)).toFixed(1), 14)}%`);
    console.log(`  faltando por mês                                R$ ${pad(brl(Number(cob.real_mediana_cents) - prevMes), 14)}`);
    console.log('\n  Cobertura abaixo de 100% significa saldo previsto ALTO demais.');
    console.log('  Erro para cima é o mais perigoso: só dói na hora de contar com o dinheiro.');

    // ── série diária por cenário ──────────────────────────────────────────
    const fotos = [];
    for (const cen of cenarios) {
      const { rows: prem } = await cli.query(`
        SELECT p.chave, p.valor::text, p.unidade, p.base_medida, s.versao
          FROM fin_forecast_premise p
          JOIN fin_forecast_scenario s ON s.id = p.scenario_id
          JOIN fin_entity e ON e.id = s.entity_id
         WHERE e.slug = 'xpe' AND s.slug = $1 ORDER BY p.chave`, [cen]);
      if (!prem.length) throw new Error(`cenário '${cen}' sem premissas — a 0079 foi aplicada?`);

      const { rows: dias } = await cli.query(`
        WITH dias AS (
          SELECT gs::date AS dia
            FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date,
                                 (now() AT TIME ZONE 'America/Sao_Paulo')::date + $2::int,
                                 interval '1 day') gs
        ),
        mov AS (
          SELECT c.dia,
                 SUM(c.valor_cenario_cents) FILTER (WHERE c.sentido = 'entrada' AND c.entra_no_saldo) AS entrada,
                 SUM(c.valor_cenario_cents) FILTER (WHERE c.sentido = 'saida'   AND c.entra_no_saldo) AS saida,
                 jsonb_object_agg(c.camada, c.total) FILTER (WHERE c.entra_no_saldo) AS por_camada
            FROM (
              SELECT dia, sentido, camada, entra_no_saldo,
                     SUM(valor_cenario_cents) AS valor_cenario_cents,
                     SUM(valor_cenario_cents) AS total
                FROM fin_previsao_cenario_v
               WHERE cenario = $1 AND dias_a_frente <= $2::int
               GROUP BY 1,2,3,4
            ) c
           GROUP BY c.dia
        )
        SELECT d.dia::text,
               COALESCE(m.entrada, 0)::bigint AS entrada_cents,
               COALESCE(m.saida, 0)::bigint   AS saida_cents,
               COALESCE(m.por_camada, '{}'::jsonb) AS por_camada,
               ($3::bigint + SUM(COALESCE(m.entrada,0) - COALESCE(m.saida,0))
                 OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING))::bigint AS saldo_previsto_cents
          FROM dias d LEFT JOIN mov m ON m.dia = d.dia
         ORDER BY d.dia`, [cen, HORIZONTE, anc.saldo_cents]);

      const menor = dias.reduce((a, b) => (Number(b.saldo_previsto_cents) < Number(a.saldo_previsto_cents) ? b : a));
      const aperto = dias.find((d) => Number(d.saldo_previsto_cents) < Number(res.minima_cents));
      const ruptura = dias.find((d) => Number(d.saldo_previsto_cents) < 0);
      const fim = dias[dias.length - 1];

      linha();
      console.log(`CENÁRIO ${cen.toUpperCase()}  (premissas v${prem[0].versao})\n`);
      for (const p of prem) {
        console.log(`  ${p.chave.padEnd(24)} ${pad(p.valor, 10)} ${p.unidade.padEnd(9)} ${p.base_medida.slice(0, 74)}`);
      }
      console.log('');
      console.log(`  saldo em ${fim.dia}         R$ ${pad(brl(fim.saldo_previsto_cents), 14)}`);
      console.log(`  menor saldo do horizonte     R$ ${pad(brl(menor.saldo_previsto_cents), 14)}  em ${menor.dia}`);
      console.log(`  caixa livre no pior dia      R$ ${pad(brl(Number(menor.saldo_previsto_cents) - Number(res.minima_cents)), 14)}  (menor saldo − reserva)`);
      console.log(`  primeiro dia abaixo da reserva  ${aperto ? aperto.dia : '— nenhum'}`);
      console.log(`  primeiro dia negativo           ${ruptura ? ruptura.dia : '— nenhum'}`);

      fotos.push({
        cenario: cen,
        versao: prem[0].versao,
        premissas: Object.fromEntries(prem.map((p) => [p.chave, p.valor])),
        dias
      });
    }

    // ── resumo mensal ─────────────────────────────────────────────────────
    const { rows: meses } = await cli.query(`
      SELECT mes::text, saldo_inicial_cents, entrada_cents, saida_folha_cents,
             saida_imposto_cents, saida_cartao_cents, saida_despesa_cents,
             saida_cents, saldo_final_cents, menor_saldo_cents,
             dia_menor_saldo::text, dia_do_aperto::text, reserva_minima_cents
        FROM fin_caixa_previsto_mes_v
       WHERE mes <= (date_trunc('month', CURRENT_DATE) + ($1::int || ' day')::interval)::date
       ORDER BY mes`, [HORIZONTE]);
    linha();
    console.log('RESUMO MENSAL (cenário base)\n');
    console.log(`  ${'mês'.padEnd(9)}${pad('abertura', 13)}${pad('entradas', 13)}${pad('folha', 12)}${pad('imposto', 11)}${pad('cartão', 11)}${pad('despesa', 11)}${pad('fechamento', 13)}  aperto`);
    for (const m of meses) {
      console.log(`  ${m.mes.slice(0, 7).padEnd(9)}${pad(brl(m.saldo_inicial_cents), 13)}${pad(brl(m.entrada_cents), 13)}${pad(brl(m.saida_folha_cents), 12)}${pad(brl(m.saida_imposto_cents), 11)}${pad(brl(m.saida_cartao_cents), 11)}${pad(brl(m.saida_despesa_cents), 11)}${pad(brl(m.saldo_final_cents), 13)}  ${m.dia_do_aperto ?? '—'}`);
    }

    // ── gravação ──────────────────────────────────────────────────────────
    linha();
    const totalLinhas = fotos.reduce((s, f) => s + f.dias.length, 0);
    if (!APLICAR) {
      console.log(`GRAVARIA ${totalLinhas} linha(s) em fin_cash_forecast (${fotos.length} cenário(s) × ${HORIZONTE + 1} dias).`);
      console.log('Nada foi gravado. Rode com --aplicar para gravar a foto.');
    } else {
      await cli.query('BEGIN');
      for (const f of fotos) {
        for (const d of f.dias) {
          await cli.query(`
            INSERT INTO fin_cash_forecast
              (entity_id, gerado_em, cenario, dia, ancora_ate, ancora_saldo_cents,
               entrada_cents, saida_cents, saldo_previsto_cents, por_camada,
               premissas, premissas_versao, horizonte_dias, algoritmo_versao,
               reserva_minima_cents)
            VALUES ($1, $2::date, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (entity_id, gerado_em, cenario, dia) DO UPDATE SET
              entrada_cents = EXCLUDED.entrada_cents,
              saida_cents = EXCLUDED.saida_cents,
              saldo_previsto_cents = EXCLUDED.saldo_previsto_cents,
              por_camada = EXCLUDED.por_camada,
              premissas = EXCLUDED.premissas`,
            [ent.id, hoje.d, f.cenario, d.dia, anc.ancora_ate, anc.saldo_cents,
             d.entrada_cents, d.saida_cents, d.saldo_previsto_cents, d.por_camada,
             JSON.stringify(f.premissas), f.versao, HORIZONTE, ALGORITMO, res.minima_cents]);
        }
      }
      await cli.query('COMMIT');
      console.log(`Gravadas ${totalLinhas} linha(s) em fin_cash_forecast.`);
    }

    // ── aferição ──────────────────────────────────────────────────────────
    //
    // Duas leituras, e elas respondem coisas diferentes:
    //
    //   1. AFERIÇÃO DAS FOTOS — o que a foto de um dia dizia contra o que
    //      aconteceu depois. É o backtest de verdade, e ele só começa a existir
    //      quando houver foto ANTIGA: uma foto tirada hoje só prevê o futuro, e
    //      o CHECK `fin_cash_forecast_dia_futuro` garante isso. Enquanto o
    //      scheduler não acumular dias, `dias` é 0 — e 0 aqui significa "ainda
    //      não dá para cobrar", nunca "acertou".
    //
    //   2. BACKTEST DETERMINÍSTICO DA COBRANÇA EMITIDA — este já tem número
    //      hoje, porque não depende de foto: é reconstruído das três datas do
    //      próprio documento (0097). É a maior camada de entrada da previsão, e
    //      é a única reconstruível sem estimar nada.
    if (AFERIR) {
      const { rows: [temResumo] } = await cli.query(
        `SELECT to_regclass('public.fin_previsao_afericao_resumo_v') IS NOT NULL AS ok`
      );
      linha();
      if (!temResumo.ok) {
        console.log('AFERIÇÃO: a migration 0097 ainda não foi aplicada — sem resumo e sem backtest.');
      } else {
        const { rows: erros } = await cli.query(`
          SELECT gerado_em::text, cenario, dias_na_foto, dias_aferiveis,
                 horizonte_aferido, cobertura_ate::text,
                 previsto_cents, realizado_cents, erro_cents,
                 erro_dia_mediano_cents, vies_pct
            FROM fin_previsao_afericao_resumo_v
           ORDER BY gerado_em DESC, cenario`);
        console.log('AFERIÇÃO DAS FOTOS — o que a foto dizia contra o que aconteceu\n');
        if (!erros.length) {
          console.log('  nenhuma foto gravada ainda. Rode --aplicar primeiro.');
        } else {
          console.log(`  ${'foto'.padEnd(12)}${'cenário'.padEnd(13)}${pad('dias', 6)}${pad('previsto', 14)}${pad('realizado', 14)}${pad('erro', 14)}${pad('viés', 8)}`);
          for (const e of erros) {
            const dias = `${e.dias_aferiveis}/${e.dias_na_foto}`;
            console.log(`  ${e.gerado_em.padEnd(12)}${e.cenario.padEnd(13)}${pad(dias, 6)}${pad(brl(e.previsto_cents), 14)}${pad(brl(e.realizado_cents), 14)}${pad(brl(e.erro_cents), 14)}${pad(e.vies_pct === null ? '—' : `${e.vies_pct}%`, 8)}`);
          }
          const mudos = erros.filter((e) => e.dias_aferiveis === 0);
          if (mudos.length) {
            console.log(`\n  ${mudos.length} foto(s) com 0 dias aferíveis: o extrato mais atrasado cobre até`);
            console.log(`  ${erros[0].cobertura_ate} e a foto só fala de dias posteriores a ela.`);
            console.log('  Isso NÃO é acerto — é foto jovem demais para ser cobrada.');
          }
        }

        const { rows: bt } = await cli.query(`
          SELECT horizonte_dias,
                 count(*) FILTER (WHERE mensuravel)::int AS celulas,
                 count(*) FILTER (WHERE NOT mensuravel)::int AS fora_da_cobertura,
                 (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY acerto_pct))::numeric AS mediana_pct,
                 MIN(acerto_pct) AS pior_pct, MAX(acerto_pct) AS melhor_pct,
                 SUM(previsto_cents) FILTER (WHERE mensuravel)::bigint AS previsto_cents,
                 SUM(realizado_cents) FILTER (WHERE mensuravel)::bigint AS realizado_cents
            FROM fin_previsao_cobranca_backtest_v
           GROUP BY 1 ORDER BY 1`);
        linha();
        console.log('BACKTEST DA COBRANÇA EMITIDA — determinístico, sem foto sintética\n');
        console.log(`  ${'horizonte'.padEnd(11)}${pad('refs', 6)}${pad('previsto', 14)}${pad('realizado', 14)}${pad('mediana', 10)}${pad('pior', 8)}${pad('melhor', 8)}  fora da cobertura`);
        for (const b of bt) {
          console.log(`  ${`${b.horizonte_dias} dias`.padEnd(11)}${pad(b.celulas, 6)}${pad(brl(b.previsto_cents), 14)}${pad(brl(b.realizado_cents), 14)}${pad(`${b.mediana_pct}%`, 10)}${pad(`${b.pior_pct}%`, 8)}${pad(`${b.melhor_pct}%`, 8)}  ${b.fora_da_cobertura}`);
        }
        console.log('\n  Abaixo de 100% significa que cobrança emitida a vencer NÃO entra toda');
        console.log('  pelo valor de face no vencimento — que é o que receber_fator = 1,000 assume.');

        const { rows: lb } = await cli.query(`
          SELECT metrica, medido_em::text, valor, unidade, alvo, base_medida
            FROM fin_previsao_linha_base ORDER BY metrica, medido_em DESC`);
        if (lb.length) {
          linha();
          console.log('LINHA DE BASE — o erro que a próxima versão tem de bater\n');
          for (const l of lb) {
            console.log(`  ${l.metrica.padEnd(30)}${pad(`${l.valor}${l.unidade}`, 8)}  alvo ${l.alvo}${l.unidade}   medido em ${l.medido_em}`);
            console.log(`    ${l.base_medida}`);
          }
        }
      }
    }
    console.log('');
  } finally {
    cli.release();
    await pool.end();
  }
}

function diasEntre(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

main().catch((e) => { console.error(e); process.exit(1); });
