// Detecta o que se repete todo mês, e mede a confiança de cada detecção.
//
// ---------------------------------------------------------------------------
// O QUE ISTO NÃO PODE SER
// ---------------------------------------------------------------------------
// A tentação é marcar como recorrente tudo que apareceu duas vezes. O resultado
// seria uma previsão de caixa cheia de compromissos que não existem — e, pior,
// que ninguém consegue distinguir dos verdadeiros depois.
//
// Por isso cada candidato passa por quatro medidas, e todas ficam gravadas na
// linha para que a decisão possa ser auditada depois:
//
//   ocorrencias  quantas vezes aconteceu
//   span_meses   por quantos meses, do primeiro ao último
//   densidade    ocorrências ÷ meses do span. 1,0 = todo mês sem falhar
//   dispersao    variação do valor (desvio ÷ média). 0 = valor idêntico sempre
//   day_concentration  qual fração cai na mesma janela de dia do mês
//
// Um aluguel tem densidade ~1, dispersão ~0 e concentração alta. Uma compra que
// por acaso repetiu tem densidade baixa e dispersão alta. A diferença é
// mensurável, e é isso que separa recorrência de coincidência.
//
// ---------------------------------------------------------------------------
// A JANELA COMEÇA EM SETEMBRO/2025
// ---------------------------------------------------------------------------
// Não é arbitrário: é quando o extrato do Nubank começa na Polp (04/09/2025), a
// fonte mais antiga com cobertura contínua das contas operacionais. Antes disso
// só há Asaas, e uma "recorrência" detectada só no Asaas seria recorrência de
// cobrança, não de pagamento.
//
// Uso:
//   node scripts/detectar-recorrentes.mjs            dry-run (padrão)
//   node scripts/detectar-recorrentes.mjs --aplicar  grava em fin_recurring
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const DETECTOR_VERSAO = 'v1-2026-08-16';
const DESDE = '2025-09-01';

// Limiares. Estão aqui em cima, nomeados, porque são a definição operacional de
// "recorrente" — e alguém vai querer discutir cada um deles.
const MIN_OCORRENCIAS = 4;    // três pode ser coincidência; quatro já é hábito
const MIN_SPAN_MESES  = 4;
const MIN_DENSIDADE   = 0.60; // falhou até 2 meses em 5 e ainda conta
const MAX_DISPERSAO   = 0.35; // valor pode variar até ~35% (conta de luz varia)
const MIN_CONCENTRACAO = 0.50; // metade das vezes na mesma janela de 5 dias

// `confidence` é vocabulário, não número: firme, provavel, observado. A escala
// contínua serve para ordenar e explicar; o rótulo é o que a tela lê, e um
// número de 0 a 1 numa tela de decisão só transfere a dúvida para quem olha.
// start_month é mês, não data: guardar 24/04 onde se espera 01/04 faria a
// previsão começar no dia errado e o CHECK avisa antes disso acontecer.
const primeiroDiaDoMes = (d) => `${String(d).slice(0, 7)}-01`;

const grauDeConfianca = (c) => (c >= 0.90 ? 'firme' : c >= 0.75 ? 'provavel' : 'observado');

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pool = financePool();

try {
  const { rows: [ent] } = await pool.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);

  // Agrupa por contraparte + categoria: a mesma empresa pode ter uma assinatura
  // mensal E compras avulsas, e tratá-las como uma coisa só produziria dispersão
  // alta o bastante para descartar as duas.
  const { rows: candidatos } = await pool.query(
    `WITH base AS (
       SELECT t.counterparty_id, t.category_id, t.nucleo, t.account_id,
              CASE WHEN t.amount_cents < 0 THEN 'pagar' ELSE 'receber' END AS direction,
              date_trunc('month', t.posted_on)::date AS mes,
              extract(day FROM t.posted_on)::int AS dia,
              abs(t.amount_cents) AS cents,
              t.posted_on
         FROM fin_transaction t
         LEFT JOIN fin_category c ON c.id = t.category_id
        WHERE t.counterparty_id IS NOT NULL
          AND t.posted_on >= $1::date
          AND COALESCE(c.cash_flow_group, '') <> 'movimentacao'
          AND t.amount_cents <> 0
     )
     SELECT counterparty_id, category_id, direction,
            max(nucleo)                    AS nucleo,
            mode() WITHIN GROUP (ORDER BY account_id) AS account_id,
            count(*)                       AS ocorrencias,
            count(DISTINCT mes)            AS meses_distintos,
            min(posted_on)                 AS amostra_de,
            max(posted_on)                 AS amostra_ate,
            (extract(year FROM age(max(posted_on), min(posted_on)))*12
             + extract(month FROM age(max(posted_on), min(posted_on))))::int + 1 AS span_meses,
            avg(cents)::bigint             AS media_cents,
            COALESCE(stddev_pop(cents), 0) AS desvio_cents,
            mode() WITHIN GROUP (ORDER BY dia) AS dia_moda,
            array_agg(dia)                 AS dias
       FROM base
      GROUP BY counterparty_id, category_id, direction
     HAVING count(*) >= $2 AND count(DISTINCT mes) >= $3`,
    [DESDE, MIN_OCORRENCIAS, MIN_SPAN_MESES]
  );

  const avaliados = candidatos.map((c) => {
    const span = Math.max(Number(c.span_meses), 1);
    const densidade = Math.min(Number(c.meses_distintos) / span, 1);
    const media = Number(c.media_cents);
    const dispersao = media > 0 ? Number(c.desvio_cents) / media : 1;
    // Concentração: fração dos lançamentos que cai a até 2 dias da moda,
    // tratando a virada do mês (dia 30 e dia 1 estão a 2 dias de distância).
    const moda = Number(c.dia_moda);
    const perto = c.dias.filter((d) => {
      const dist = Math.abs(Number(d) - moda);
      return Math.min(dist, 31 - dist) <= 2;
    }).length;
    const concentracao = perto / c.dias.length;

    const aprovado = densidade >= MIN_DENSIDADE
                  && dispersao <= MAX_DISPERSAO
                  && concentracao >= MIN_CONCENTRACAO;

    // Confiança combina as três medidas em vez de escolher uma. Nenhuma sozinha
    // separa bem: valor estável com data errática é parcelamento, não assinatura;
    // data certa com valor errático é conta de consumo, que é recorrente mas não
    // previsível pelo valor.
    const confianca = (0.4 * Math.min(densidade, 1)
                                      + 0.3 * (1 - Math.min(dispersao, 1))
                                      + 0.3 * concentracao);

    return { ...c, densidade, dispersao, concentracao, aprovado, confianca, media_cents: media };
  });

  const aprovados = avaliados.filter((a) => a.aprovado);
  const recusados = avaliados.filter((a) => !a.aprovado);

  console.log(`\n[detector ${DETECTOR_VERSAO}] janela desde ${DESDE}`);
  console.log(`  candidatos ......... ${avaliados.length}`);
  console.log(`  aprovados .......... ${aprovados.length}`);
  console.log(`  recusados .......... ${recusados.length}\n`);

  console.log('APROVADOS (o que entra como recorrente)');
  console.log('  conf  ocorr  dens  disp  conc   valor médio    dia   contraparte');
  for (const a of aprovados.sort((x, y) => y.confianca - x.confianca)) {
    const { rows: [cp] } = await pool.query(`SELECT name FROM fin_counterparty WHERE id=$1`, [a.counterparty_id]);
    console.log(
      `  ${String(Math.round(a.confianca*100)).padStart(3)}  ${String(a.ocorrencias).padStart(5)}` +
      `  ${a.densidade.toFixed(2)}  ${a.dispersao.toFixed(2)}  ${a.concentracao.toFixed(2)}` +
      `  ${brl(a.media_cents).padStart(13)}  dia ${String(a.dia_moda).padStart(2)}  ${(cp?.name ?? '?').slice(0, 34)}`
    );
  }

  console.log('\nRECUSADOS (e por quê)');
  for (const r of recusados.slice(0, 12)) {
    const motivos = [];
    if (r.densidade < MIN_DENSIDADE) motivos.push(`falha meses (dens ${r.densidade.toFixed(2)})`);
    if (r.dispersao > MAX_DISPERSAO) motivos.push(`valor instável (disp ${r.dispersao.toFixed(2)})`);
    if (r.concentracao < MIN_CONCENTRACAO) motivos.push(`data errática (conc ${r.concentracao.toFixed(2)})`);
    const { rows: [cp] } = await pool.query(`SELECT name FROM fin_counterparty WHERE id=$1`, [r.counterparty_id]);
    console.log(`  ${(cp?.name ?? '?').slice(0, 30).padEnd(32)} ${motivos.join(' · ')}`);
  }

  if (!APLICAR) {
    console.log('\n[dry-run] nada gravado. Use --aplicar para gravar em fin_recurring.\n');
    process.exit(0);
  }

  let gravadas = 0;
  for (const a of aprovados) {
    await pool.query(
      `INSERT INTO fin_recurring (
         entity_id, label, direction, counterparty_id, category_id, nucleo, account_id,
         cadence, day_of_month, start_month, amount_cents, amount_basis, confidence, status,
         ocorrencias, span_meses, densidade, dispersao, day_concentration,
         amostra_de, amostra_ate, last_seen_on, source, detector_versao, detectado_em, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'mensal',$8,$9,$10,'media_janela',$11,$20,
               $12,$13,$14,$15,$16,$17,$18,$18,'deteccao_historico',$19, now(), 'detectar-recorrentes')
       ON CONFLICT DO NOTHING`,
      [ent.id,
       `Recorrente mensal — contraparte ${a.counterparty_id}`,
       a.direction, a.counterparty_id, a.category_id, a.nucleo, a.account_id,
       a.dia_moda, primeiroDiaDoMes(a.amostra_de), a.media_cents, grauDeConfianca(a.confianca),
       a.ocorrencias, a.span_meses, a.densidade.toFixed(4), a.dispersao.toFixed(4),
       a.concentracao.toFixed(4), a.amostra_de, a.amostra_ate, DETECTOR_VERSAO,
       // 'observado' entra como proposto, nunca ativo: o CHECK
       // fin_recurring_observado_nao_ativa exige que confiança fraca só seja
       // ativa quando o valor for DECLARADO por alguém, não estimado da média.
       grauDeConfianca(a.confianca) === 'observado' ? 'proposto' : 'ativo']
    );
    gravadas += 1;
  }
  console.log(`\n[aplicado] ${gravadas} recorrente(s) em fin_recurring.\n`);
} finally {
  await pool.end();
}
