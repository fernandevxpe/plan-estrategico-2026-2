-- A previsão passa a ter erro medido: aferir é comparar dentro da cobertura.
--
-- ============================================================================
-- O DEFEITO — 0 de 91 dias aferíveis com uma foto gravada
-- ============================================================================
--
-- Medido em 16/08/2026:
--
--   fin_cash_forecast ........ 91 linhas · 1 foto · gerado_em = 2026-08-16
--                              dias 2026-08-16 → 2026-11-14
--   fin_previsao_afericao_v .. 91 dias · 0 aferíveis · erro_dia sempre NULL
--   último posted_on ......... 2026-08-15
--
-- A primeira leitura ("o predicado de junção está errado") está REFUTADA:
-- `f.entity_id = r.entity_id` casa (só existe entity_id = 1) e `f.dia = r.dia`
-- é a junção certa. O que acontece é mais simples e mais constrangedor: a única
-- foto foi tirada HOJE e o CHECK `fin_cash_forecast_dia_futuro (dia >= gerado_em)`
-- garante que todos os 91 dias dela estejam no futuro. O ledger vai até ontem.
-- A interseção entre "o que a foto prevê" e "o que o ledger já viu" é vazia por
-- construção. Não há defeito de junção: há ausência de foto antiga.
--
-- MAS existe um defeito de verdade, e ele é o motivo desta migration:
--
--   aferivel := (r.dia IS NOT NULL)
--
-- `realizado_dia` só produz linha para dia que teve lançamento. Logo:
--
--   · um dia DENTRO da cobertura e SEM movimento (fim de semana, feriado) vira
--     "não aferível", quando na verdade é o acerto mais fácil de todos: a
--     previsão disse líquido X, a realidade disse zero, e o erro é X. Medido:
--     1 dos 15 dias de 01–15/08 não tem nenhum lançamento;
--   · um dia FORA da cobertura viraria "aferível" no instante em que qualquer
--     lançamento com data futura fosse gravado, medindo previsão contra um dia
--     que ainda está sendo escrito.
--
-- Os dois erros são o mesmo erro, e é o erro que este projeto já nomeou:
-- **ausência de dado não é zero**. `r.dia IS NULL` estava respondendo às duas
-- perguntas ao mesmo tempo — "não houve movimento" e "ainda não sei" — com o
-- mesmo NULL.
--
-- A correção: aferibilidade é uma afirmação sobre a COBERTURA DO EXTRATO, não
-- sobre a existência de linha. Um dia é aferível quando todo extrato que compõe
-- a âncora já passou por ele. Aí, e só aí, ausência de lançamento é zero.
--
-- ============================================================================
-- O QUE ESTA MIGRATION NÃO FAZ — e por que
-- ============================================================================
--
-- **Não fabrica foto retroativa.** A pergunta foi medida antes de ser
-- respondida, e a resposta é não, com cinco evidências:
--
--   1. `fin_recurring` tem 145 linhas e ZERO criadas antes de 2026-08-01. A
--      camada de despesa recorrente não existia; reconstruí-la seria rodar hoje
--      um detector que não existia na data da foto.
--   2. `fin_forecast_scenario.vigente_de = 2026-08-16`, versão 1, única versão.
--      Não há conjunto de premissas anterior para reconstruir COM.
--   3. Duas das seis premissas são ajustadas sobre janela: `das_aliquota`
--      (2025-12-01 → 2026-07-01) e `cartao_fator` (2026-03-01 → 2026-08-01).
--      Uma foto retrodatada para julho usaria, para prever julho, uma alíquota
--      medida em julho. Isso não é previsão, é gabarito.
--   4. `fin_audit_log` tem 0 linhas de nível de registro para `fin_document` e
--      para `fin_recurring`: o estado passado desses dois não foi historiado.
--   5. Toda a cadeia de views (`fin_previsao_recebimento_v`,
--      `fin_previsao_evento_v`, `fin_previsao_cenario_v`, `fin_folha_previsao_v`,
--      `fin_receber_aberto_v`) fixa `hoje := now() AT TIME ZONE
--      'America/Sao_Paulo'`. Nenhuma aceita data de referência.
--
-- Foto sintética retrodatada provaria o mecanismo e mediria nada. Não entra.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ EM VEZ DISSO
-- ============================================================================
--
-- Uma camada da previsão — a maior, `cobranca_emitida`, R$ 381.303,67 de
-- R$ 481.338,47 de entrada que soma no saldo (79%) — é reconstruível de forma
-- DETERMINÍSTICA, sem estimar nada, porque `fin_document` guarda as três datas
-- que a definem:
--
--   existia em D          ⟺  issue_date <= D          (100% preenchida)
--   ainda estava aberta   ⟺  paid_on IS NULL OR paid_on > D
--   entrava no horizonte  ⟺  due_date IN (D, D+H]
--
-- E não há documento `cancelado` na base (3.048 liquidado · 311 emitido ·
-- 47 confirmado), então a única data de estado que faltaria — a do cancelamento
-- — não é necessária.
--
-- Isso não é uma foto: é um backtest, e ele não é gravado em
-- `fin_cash_forecast`. Fica em view própria, calculada da evidência a cada
-- leitura, e declara o que a foto real declararia: o que caiu dentro do
-- horizonte, o que não caiu, e o que ainda não dá para saber.
--
-- ============================================================================
-- SEM ESCRITA EM DADO DE CAIXA
-- ============================================================================
--
-- Nenhum UPDATE/DELETE em `fin_transaction`, `fin_document`, `fin_account` ou
-- `fin_cash_forecast`. Cria três views, uma tabela de linha de base e semeia
-- duas linhas nela. A âncora de soma por conta não pode mudar porque nada de
-- caixa é tocado — e a pós-condição confere isso mesmo assim.

-- ---------------------------------------------------------------------------
-- 1. ATÉ QUANDO O LEDGER SABE — a régua da aferibilidade
-- ---------------------------------------------------------------------------
-- Mesmo universo de contas da âncora de `prever-caixa.mjs`: ativas e não
-- 'emprestimo'. `MIN` sobre `last_statement_at` porque o consolidado só está
-- fechado até a conta MAIS ATRASADA — prever o líquido do dia e comparar com um
-- dia em que só metade das contas foi importada mede o importador, não o
-- detector.
--
-- Duas contas ativas (`caixa-aplicacao`, `caixa-emprestimo`) não têm extrato
-- nenhum: é o invariante F1, bloqueio de dado da dúvida 5. `MIN` ignora NULL, e
-- deixar que ignore é deliberado — as duas somam 0 lançamentos e R$ 0,00, e
-- fazer a cobertura inteira virar NULL por causa delas calaria o instrumento
-- por um motivo alheio. A ressalva viaja junto, em `contas_sem_extrato`, para
-- que ninguém leia a cobertura sem ver de quantas contas ela fala.
DROP VIEW IF EXISTS fin_previsao_cobertura_v CASCADE;
CREATE VIEW fin_previsao_cobertura_v AS
SELECT a.entity_id,
       MIN(a.last_statement_at)::date                                   AS cobertura_ate,
       count(*) FILTER (WHERE a.last_statement_at IS NOT NULL)::int      AS contas_com_extrato,
       count(*) FILTER (WHERE a.last_statement_at IS NULL)::int          AS contas_sem_extrato,
       count(*)::int                                                     AS contas_na_ancora
  FROM fin_account a
 WHERE a.is_active AND a.kind <> 'emprestimo'
 GROUP BY a.entity_id;

COMMENT ON VIEW fin_previsao_cobertura_v IS
  'Até que dia o ledger consegue arbitrar uma previsão. É o MIN de '
  'last_statement_at sobre as contas da âncora (ativas, não emprestimo): o '
  'consolidado do dia só está fechado quando a conta mais atrasada passou por '
  'ele. contas_sem_extrato é a ressalva de F1 viajando junto do número.';

-- ---------------------------------------------------------------------------
-- 2. A AFERIÇÃO — aferível é o que a cobertura alcança
-- ---------------------------------------------------------------------------
-- Mudanças em relação à versão da 0079:
--
--   · `aferivel` deixa de ser "existe linha realizada" e passa a ser "o dia
--     está dentro da cobertura". Dia coberto sem lançamento realiza ZERO, que é
--     um fato, e entra na conta.
--   · `nao_aferivel_motivo` diz por que, em vez de deixar NULL explicar-se
--     sozinho. Quem lê a view não precisa saber que existe uma tabela de
--     contas para entender o vazio.
--   · os acumulados param de somar dia não aferível como se ele fosse zero: o
--     realizado acumulado só avança dentro da cobertura, e o previsto acumulado
--     é apresentado ao lado dele na mesma janela.
--
-- O universo do realizado é o mesmo da 0079 e não muda: fora perna pareada
-- (as duas metades se anulam no consolidado) e fora pai de rateio (os filhos
-- já contam). Perna `em_transito` CONTINUA entrando — ela move o saldo de uma
-- conta de verdade e a outra metade não existe neste ledger; é o caso das 243
-- lacunas declaradas de M7·fonte.
DROP VIEW IF EXISTS fin_previsao_afericao_v CASCADE;
CREATE VIEW fin_previsao_afericao_v AS
WITH realizado_dia AS (
  SELECT t.entity_id,
         t.posted_on                                              AS dia,
         sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0)     AS entrada_cents,
         sum(-t.amount_cents) FILTER (WHERE t.amount_cents < 0)    AS saida_cents,
         sum(t.amount_cents)                                       AS liquido_cents
    FROM fin_transaction t
   WHERE t.transfer_status <> 'pareado' AND NOT t.is_split_parent
   GROUP BY t.entity_id, t.posted_on
),
base AS (
  SELECT f.entity_id,
         f.gerado_em,
         f.cenario,
         f.premissas_versao,
         f.algoritmo_versao,
         f.dia,
         (f.dia - f.gerado_em)                                     AS dias_a_frente,
         cob.cobertura_ate,
         cob.contas_sem_extrato,
         (f.dia <= cob.cobertura_ate)                              AS aferivel,
         f.saldo_previsto_cents,
         f.entrada_cents                                           AS entrada_prevista_cents,
         f.saida_cents                                             AS saida_prevista_cents,
         (f.entrada_cents - f.saida_cents)                          AS liquido_previsto_cents,
         -- Dentro da cobertura, ausência de linha é zero medido, não vazio.
         CASE WHEN f.dia <= cob.cobertura_ate
              THEN COALESCE(r.entrada_cents, 0) END                AS entrada_realizada_cents,
         CASE WHEN f.dia <= cob.cobertura_ate
              THEN COALESCE(r.saida_cents, 0) END                  AS saida_realizada_cents,
         CASE WHEN f.dia <= cob.cobertura_ate
              THEN COALESCE(r.liquido_cents, 0) END                AS liquido_realizado_cents
    FROM fin_cash_forecast f
    JOIN fin_previsao_cobertura_v cob ON cob.entity_id = f.entity_id
    LEFT JOIN realizado_dia r ON r.entity_id = f.entity_id AND r.dia = f.dia
)
SELECT b.entity_id,
       b.gerado_em,
       b.cenario,
       b.premissas_versao,
       b.algoritmo_versao,
       b.dia,
       b.dias_a_frente,
       b.cobertura_ate,
       b.aferivel,
       CASE
         WHEN b.aferivel THEN NULL
         WHEN b.cobertura_ate IS NULL THEN 'nenhuma conta da âncora tem extrato (F1, dúvida 5)'
         ELSE 'dia ainda não coberto: o extrato mais atrasado vai até ' || b.cobertura_ate
       END                                                          AS nao_aferivel_motivo,
       b.contas_sem_extrato,
       b.saldo_previsto_cents,
       b.entrada_prevista_cents,
       b.saida_prevista_cents,
       b.liquido_previsto_cents,
       b.entrada_realizada_cents,
       b.saida_realizada_cents,
       b.liquido_realizado_cents,
       CASE WHEN b.aferivel
            THEN b.liquido_previsto_cents - b.liquido_realizado_cents END
                                                                    AS erro_dia_cents,
       sum(b.liquido_previsto_cents) FILTER (WHERE b.aferivel)
         OVER (PARTITION BY b.entity_id, b.gerado_em, b.cenario ORDER BY b.dia ROWS UNBOUNDED PRECEDING)
                                                                    AS previsto_acum_cents,
       sum(b.liquido_realizado_cents) FILTER (WHERE b.aferivel)
         OVER (PARTITION BY b.entity_id, b.gerado_em, b.cenario ORDER BY b.dia ROWS UNBOUNDED PRECEDING)
                                                                    AS realizado_acum_cents,
       CASE WHEN b.aferivel THEN
         sum(b.liquido_previsto_cents) FILTER (WHERE b.aferivel)
           OVER (PARTITION BY b.entity_id, b.gerado_em, b.cenario ORDER BY b.dia ROWS UNBOUNDED PRECEDING)
         - sum(b.liquido_realizado_cents) FILTER (WHERE b.aferivel)
           OVER (PARTITION BY b.entity_id, b.gerado_em, b.cenario ORDER BY b.dia ROWS UNBOUNDED PRECEDING)
       END                                                          AS erro_acum_cents
  FROM base b;

COMMENT ON VIEW fin_previsao_afericao_v IS
  'Previsto contra realizado, dia a dia, por foto. aferivel = o dia está dentro '
  'da cobertura de extrato (fin_previsao_cobertura_v) — NÃO "existe lançamento". '
  'Dia coberto e sem movimento realiza zero, que é medida; dia fora da cobertura '
  'realiza NULL e diz o motivo. Erro positivo = a previsão foi otimista.';

-- ---------------------------------------------------------------------------
-- 3. RESUMO POR FOTO — o número que vira monitor
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS fin_previsao_afericao_resumo_v CASCADE;
CREATE VIEW fin_previsao_afericao_resumo_v AS
SELECT a.entity_id,
       a.gerado_em,
       a.cenario,
       a.premissas_versao,
       a.algoritmo_versao,
       count(*)::int                                               AS dias_na_foto,
       count(*) FILTER (WHERE a.aferivel)::int                     AS dias_aferiveis,
       max(a.dias_a_frente) FILTER (WHERE a.aferivel)::int         AS horizonte_aferido,
       min(a.cobertura_ate)                                        AS cobertura_ate,
       sum(a.liquido_previsto_cents) FILTER (WHERE a.aferivel)::bigint  AS previsto_cents,
       sum(a.liquido_realizado_cents) FILTER (WHERE a.aferivel)::bigint AS realizado_cents,
       (sum(a.liquido_previsto_cents) FILTER (WHERE a.aferivel)
        - sum(a.liquido_realizado_cents) FILTER (WHERE a.aferivel))::bigint AS erro_cents,
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(a.erro_dia_cents)))::bigint
                                                                   AS erro_dia_mediano_cents,
       -- Viés: positivo = previu mais dinheiro do que entrou. É o sinal que
       -- importa, porque erro para cima só dói na hora de contar com o dinheiro.
       CASE WHEN sum(abs(a.liquido_realizado_cents)) FILTER (WHERE a.aferivel) > 0
            THEN round(100.0 * (sum(a.liquido_previsto_cents) FILTER (WHERE a.aferivel)
                              - sum(a.liquido_realizado_cents) FILTER (WHERE a.aferivel))
                     / sum(abs(a.liquido_realizado_cents)) FILTER (WHERE a.aferivel), 1)
       END                                                          AS vies_pct
  FROM fin_previsao_afericao_v a
 GROUP BY a.entity_id, a.gerado_em, a.cenario, a.premissas_versao, a.algoritmo_versao;

COMMENT ON VIEW fin_previsao_afericao_resumo_v IS
  'Uma linha por foto: quantos dias já podem ser cobrados, o erro acumulado e o '
  'viés. dias_aferiveis = 0 significa que a foto ainda é jovem demais, não que '
  'ela acertou.';

-- ---------------------------------------------------------------------------
-- 4. BACKTEST DETERMINÍSTICO DA COBRANÇA EMITIDA
-- ---------------------------------------------------------------------------
-- A camada `cobranca_emitida` é a única reconstruível sem estimar: ela é
-- exatamente "documento a receber, aberto na data de referência, com vencimento
-- dentro do horizonte, pelo valor de face" — e as três datas que definem isso
-- estão gravadas no documento desde a origem no Asaas.
--
-- A régua da 0061 continua valendo por construção: aqui só entra documento,
-- então não há recorrente projetando por cima de boleto emitido. Esta view NÃO
-- soma camada nenhuma além dela mesma, e o nome diz isso.
--
-- `mensuravel` é o mesmo cuidado da §2: um horizonte que termina depois da
-- cobertura não mede acerto, mede o quanto do extrato já chegou. Sem essa trava
-- a leitura de 16/06 + 90 dias daria "65,6% de acerto" quando o que houve é que
-- 30 dias do horizonte ainda não aconteceram.
DROP VIEW IF EXISTS fin_previsao_cobranca_backtest_v CASCADE;
CREATE VIEW fin_previsao_cobranca_backtest_v AS
WITH cob AS (SELECT entity_id, cobertura_ate FROM fin_previsao_cobertura_v),
refs AS (
  -- Uma referência por mês fechado, no dia 16, até a cobertura. O dia 16 não é
  -- arbitrário: é o dia em que a única foto real foi tirada, e comparar fotos
  -- tiradas no mesmo dia do mês tira o ciclo de vencimento do meio do erro.
  SELECT c.entity_id, c.cobertura_ate, gs::date AS ref
    FROM cob c
    CROSS JOIN LATERAL generate_series(
      date_trunc('month', c.cobertura_ate - interval '12 month')::date + 15,
      c.cobertura_ate,
      interval '1 month') gs
),
grade AS (
  SELECT r.entity_id, r.ref, r.cobertura_ate, h.dias AS horizonte_dias
    FROM refs r CROSS JOIN (VALUES (30), (60), (90)) h(dias)
)
SELECT g.entity_id,
       g.ref                                                        AS referencia,
       g.horizonte_dias,
       (g.ref + g.horizonte_dias)                                   AS ate,
       (g.ref + g.horizonte_dias) <= g.cobertura_ate                AS mensuravel,
       CASE WHEN (g.ref + g.horizonte_dias) > g.cobertura_ate
            THEN 'horizonte termina depois da cobertura (' || g.cobertura_ate || ')'
       END                                                          AS nao_mensuravel_motivo,
       count(d.id)::int                                             AS documentos,
       COALESCE(sum(d.amount_cents), 0)::bigint                     AS previsto_cents,
       CASE WHEN (g.ref + g.horizonte_dias) <= g.cobertura_ate
            THEN COALESCE(sum(d.amount_cents) FILTER (
                   WHERE d.paid_on IS NOT NULL
                     AND d.paid_on <= g.ref + g.horizonte_dias), 0)::bigint END
                                                                    AS realizado_cents,
       CASE WHEN (g.ref + g.horizonte_dias) <= g.cobertura_ate
            THEN (COALESCE(sum(d.amount_cents), 0)
                - COALESCE(sum(d.amount_cents) FILTER (
                    WHERE d.paid_on IS NOT NULL
                      AND d.paid_on <= g.ref + g.horizonte_dias), 0))::bigint END
                                                                    AS erro_cents,
       CASE WHEN (g.ref + g.horizonte_dias) <= g.cobertura_ate AND sum(d.amount_cents) > 0
            THEN round(100.0 * COALESCE(sum(d.amount_cents) FILTER (
                   WHERE d.paid_on IS NOT NULL
                     AND d.paid_on <= g.ref + g.horizonte_dias), 0)
                   / sum(d.amount_cents), 1) END                    AS acerto_pct
  FROM grade g
  LEFT JOIN fin_document d
    ON d.entity_id = g.entity_id
   AND d.direction = 'receber'
   AND d.due_date IS NOT NULL
   AND d.issue_date IS NOT NULL
   AND d.issue_date <= g.ref                        -- o boleto existia na data
   AND d.due_date   >  g.ref                        -- ainda não vencido: é 'cobranca_emitida'
   AND d.due_date   <= g.ref + g.horizonte_dias     -- e cai dentro do horizonte
   AND (d.paid_on IS NULL OR d.paid_on > g.ref)     -- e estava aberto na data
 GROUP BY g.entity_id, g.ref, g.horizonte_dias, g.cobertura_ate;

COMMENT ON VIEW fin_previsao_cobranca_backtest_v IS
  'Backtest determinístico da camada cobranca_emitida, reconstruído das três '
  'datas do próprio documento (issue_date, due_date, paid_on) — nenhuma '
  'estimativa, nenhuma foto sintética. acerto_pct abaixo de 100 significa que a '
  'cobrança emitida a vencer NÃO entra toda pelo valor de face no vencimento, '
  'que é exatamente o que a premissa receber_fator = 1,000 assume.';

-- ---------------------------------------------------------------------------
-- 5. A LINHA DE BASE — o erro que a próxima versão tem de bater
-- ---------------------------------------------------------------------------
-- Sem linha de base gravada, "melhoramos a previsão" é uma frase. O projeto já
-- pagou por isso duas vezes: os +37% da receita recorrente e os +75% da
-- comissão só viraram trabalho quando alguém escreveu o número errado em algum
-- lugar de onde ele pudesse ser cobrado.
--
-- Cada linha guarda a MEDIDA, a data, a consulta que a produziu e o alvo. Nunca
-- um número plausível: `valor` é NOT NULL e `base_medida` também, para que não
-- exista linha de base sem como refazê-la.
CREATE TABLE IF NOT EXISTS fin_previsao_linha_base (
  id            bigserial PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  metrica       text        NOT NULL,
  medido_em     date        NOT NULL,
  valor         numeric     NOT NULL,
  unidade       text        NOT NULL,
  alvo          numeric,
  alvo_sentido  text        NOT NULL DEFAULT 'maior_melhor',
  em_jogo_cents bigint,
  base_medida   text        NOT NULL,
  fonte         text        NOT NULL,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_previsao_linha_base_sentido_ck
    CHECK (alvo_sentido IN ('maior_melhor', 'menor_melhor')),
  CONSTRAINT fin_previsao_linha_base_key UNIQUE (entity_id, metrica, medido_em)
);

COMMENT ON TABLE fin_previsao_linha_base IS
  'O erro medido da previsão numa data, com a consulta que o produziu. Serve '
  'para cobrar a próxima versão do detector: sem linha de base, "melhorou" não '
  'tem como ser contestado.';

-- Os dois valores são MEDIDOS aqui, não copiados de documento. É a regra do §10
-- de CONTINUACAO.md aplicada à própria linha de base: um baseline transcrito à
-- mão envelhece igual a um doc, e aí ninguém sabe mais se o detector melhorou
-- ou se a régua mudou de lugar.
WITH ent AS (
  SELECT id FROM fin_entity WHERE slug = 'xpe'
),
-- (a) Cobertura da saída prevista — a mesma conta do bloco COBERTURA DA SAÍDA de
--     prever-caixa.mjs, reescrita em SQL para não existirem duas definições.
saida AS (
  SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY r.cents))::numeric AS real_mediana_cents,
         (SELECT sum(valor_cents) FROM fin_previsao_evento_v
           WHERE sentido = 'saida' AND entra_no_saldo AND dias_a_frente <= 90)::numeric / 3
                                                                          AS prev_mes_cents
    FROM (
      SELECT date_trunc('month', t.posted_on)::date AS mes, sum(-t.amount_cents) AS cents
        FROM fin_transaction t
       WHERE t.amount_cents < 0 AND t.transfer_status = 'nao' AND NOT t.is_split_parent
         AND t.posted_on >= date_trunc('month', CURRENT_DATE) - interval '7 month'
         AND t.posted_on <  date_trunc('month', CURRENT_DATE)
       GROUP BY 1
    ) r
),
-- (b) Acerto da cobrança emitida a 30 dias — mediana das células mensuráveis.
--     Mediana e não média: uma referência atípica não pode definir a régua que
--     as próximas versões vão ter de bater.
acerto AS (
  SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY b.acerto_pct))::numeric AS mediana_pct,
         count(*)::int                                                        AS celulas,
         min(b.referencia)                                                    AS de,
         max(b.referencia)                                                    AS ate
    FROM fin_previsao_cobranca_backtest_v b
   WHERE b.mensuravel AND b.horizonte_dias = 30 AND b.acerto_pct IS NOT NULL
)
INSERT INTO fin_previsao_linha_base
  (entity_id, metrica, medido_em, valor, unidade, alvo, alvo_sentido,
   em_jogo_cents, base_medida, fonte, notas)
SELECT ent.id, v.metrica, CURRENT_DATE, v.valor, '%', 100::numeric, 'maior_melhor',
       v.em_jogo, v.base_medida, v.fonte, v.notas
  FROM ent, saida s, acerto a,
  LATERAL (VALUES
    ('cobertura_da_saida_prevista',
     round(100 * s.prev_mes_cents / nullif(s.real_mediana_cents, 0), 1),
     round(s.real_mediana_cents - s.prev_mes_cents)::bigint,
     'saída prevista que entra no saldo nos próximos 90 dias ÷ 3 ('
       || round(s.prev_mes_cents / 100.0, 2)
       || ') sobre a mediana da saída realizada dos 7 meses fechados ('
       || round(s.real_mediana_cents / 100.0, 2) || ')',
     'scripts/prever-caixa.mjs, bloco COBERTURA DA SAÍDA; fórmula replicada na 0097',
     'Cobertura abaixo de 100% quer dizer saldo previsto ALTO demais, e erro para '
     'cima é o que dói: só aparece na hora de contar com o dinheiro. A parte '
     'declarada do buraco é a dúvida 34 — NÃO feche com mediana sem decisão do '
     'Fernando; a lacuna visível vale mais que uma camada estimada. O número da '
     'documentação de 16/08 (71,7% e R$ 43.059,77/mês) não bate com este porque '
     'a mediana da saída realizada subiu quando julho fechou: o denominador se '
     'moveu, o detector não regrediu.'),
    ('acerto_cobranca_emitida_30d',
     a.mediana_pct,
     NULL::bigint,
     'mediana de acerto_pct sobre ' || a.celulas || ' referência(s) mensuráveis de '
       || a.de || ' a ' || a.ate || ', horizonte 30 dias',
     'fin_previsao_cobranca_backtest_v (0097)',
     'Primeiro erro medido da previsão de recebimento em toda a base. A premissa '
     'receber_fator = 1,000 assume que cobrança emitida a vencer entra INTEIRA '
     'pelo valor de face na data de vencimento; o backtest determinístico diz que '
     'não entra. E a série piora com o tempo — as referências de 2026 estão '
     'sistematicamente abaixo das de 2025. Não ajuste a premissa sem antes '
     'separar atraso de inadimplência: a camada vencido_a_receber existe para '
     'isso e de propósito NÃO soma no saldo (decisão da 0058).')
  ) AS v(metrica, valor, em_jogo, base_medida, fonte, notas)
ON CONFLICT (entity_id, metrica, medido_em) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. PÓS-CONDIÇÕES
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cob    record;
  v_res    record;
  v_n      bigint;
  v_cents  bigint;
BEGIN
  -- 6.1 A cobertura existe e conhece as duas contas sem extrato (F1).
  SELECT * INTO v_cob FROM fin_previsao_cobertura_v c
    JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe';
  IF v_cob.cobertura_ate IS NULL THEN
    RAISE EXCEPTION '0097: cobertura nula — nenhuma conta da âncora tem extrato';
  END IF;
  IF v_cob.contas_sem_extrato <> 1 THEN
    RAISE EXCEPTION
      '0097: esperava 1 conta ativa sem extrato na âncora (caixa-aplicacao, F1), achei %',
      v_cob.contas_sem_extrato;
  END IF;

  -- 6.2 A foto de 16/08 continua com 0 dias aferíveis — e agora POR MOTIVO
  -- ESCRITO, não por NULL. Se este número mudar sem uma foto nova, alguém
  -- retrodatou algo.
  SELECT * INTO v_res FROM fin_previsao_afericao_resumo_v r
    JOIN fin_entity e ON e.id = r.entity_id AND e.slug = 'xpe'
   WHERE r.gerado_em = DATE '2026-08-16' AND r.cenario = 'base';
  IF v_res IS NULL THEN
    RAISE EXCEPTION '0097: a foto de 2026-08-16 sumiu do resumo';
  END IF;
  IF v_res.dias_na_foto <> 91 THEN
    RAISE EXCEPTION '0097: esperava 91 dias na foto de 16/08, achei %', v_res.dias_na_foto;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_previsao_afericao_v a
   WHERE a.gerado_em = DATE '2026-08-16'
     AND NOT a.aferivel
     AND a.nao_aferivel_motivo IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0097: % dia(s) não aferível(is) sem motivo escrito', v_n;
  END IF;

  -- 6.3 O backtest produz leitura mensurável — este é o ponto da migration.
  SELECT count(*) INTO v_n
    FROM fin_previsao_cobranca_backtest_v b
   WHERE b.mensuravel AND b.acerto_pct IS NOT NULL;
  IF v_n < 12 THEN
    RAISE EXCEPTION
      '0097: backtest devolveu só % célula(s) mensurável(is); esperava ao menos 12', v_n;
  END IF;

  -- E nenhuma célula não mensurável pode fingir que mediu.
  SELECT count(*) INTO v_n
    FROM fin_previsao_cobranca_backtest_v b
   WHERE NOT b.mensuravel AND (b.acerto_pct IS NOT NULL OR b.realizado_cents IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0097: % célula(s) fora da cobertura devolveram acerto', v_n;
  END IF;

  -- 6.4 A linha de base ficou gravada com as duas métricas, e nenhuma delas
  -- pode ter valor nulo ou fora de 0–100: baseline sem número não cobra nada.
  SELECT count(*) INTO v_n
    FROM fin_previsao_linha_base
   WHERE medido_em = CURRENT_DATE AND valor > 0 AND valor <= 100;
  IF v_n <> 2 THEN
    RAISE EXCEPTION
      '0097: esperava 2 linhas de base medidas hoje com valor em (0,100], achei %', v_n;
  END IF;

  -- 6.5 ÂNCORA DE DINHEIRO. Nada aqui escreve em caixa; conferir mesmo assim é
  -- o padrão da casa. A fórmula é a MESMA de painel-financeiro.mjs — a régua
  -- zero tem uma definição só, e não é esta migration que vai criar a segunda.
  SELECT count(*) INTO v_n
    FROM (
      SELECT a.id,
             a.current_balance_cents,
             a.opening_balance_cents + COALESCE(sum(t.amount_cents), 0) AS calculado
        FROM fin_account a
        LEFT JOIN fin_transaction t ON t.account_id = a.id
             AND (a.opening_balance_date IS NULL OR t.posted_on >= a.opening_balance_date)
       GROUP BY a.id, a.opening_balance_cents, a.current_balance_cents
    ) c
   WHERE c.calculado IS DISTINCT FROM COALESCE(c.current_balance_cents, 0);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0097: % conta(s) deixaram de fechar', v_n;
  END IF;

  SELECT sum(t.amount_cents) INTO v_cents FROM fin_transaction t;
  RAISE NOTICE '0097 ok · cobertura até % · backtest mensurável · soma do ledger % centavos',
    v_cob.cobertura_ate, v_cents;
END $$;
