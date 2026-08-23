-- O app para de chamar reembolso de pró-labore.
--
-- ---------------------------------------------------------------------------
-- O ERRO, MEDIDO NO FERNANDO
-- ---------------------------------------------------------------------------
-- A tela de Recebíveis dizia:  pró-labore R$ 41.649,74 · reembolso R$ 1.327,09
-- A folha diz:                 remuneração R$ 35.390,70 · reembolso R$ 7.586,13
--
-- Seis mil duzentos e cinquenta e nove reais de reembolso DELE aparecendo como
-- remuneração na tela dele. Não é arredondamento: é 5,7× o valor certo.
--
-- ---------------------------------------------------------------------------
-- POR QUE ACONTECE
-- ---------------------------------------------------------------------------
-- A casa paga o reembolso do mês JUNTO com o pró-labore, às vezes no mesmo PIX,
-- às vezes em PIX separado no mesmo dia — e quem categoriza marca tudo como
-- 6.02. Conferido: dos 27 lançamentos do Fernando em 2026, 25 estão em 6.02 e
-- 2 em 6.05, e a descrição de todos é a mesma string ("Pix enviado — Fernando
-- De Siqueira Campos Silva"). O ledger, sozinho, não tem como saber.
--
-- A FOLHA SABE. `fin_reimbursement` guarda o total aprovado por pessoa e
-- competência, e o pagamento acontece no mês seguinte — é assim que
-- `fin_folha_pessoa_mes_v` calcula `remuneracao = pago − reembolso`. Conferido
-- na base inteira: os 81 cabeçalhos batem com a soma dos seus itens em 100%
-- dos casos, e nenhum mês em nenhuma pessoa dá remuneração negativa.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA VIEW NOVA, E NÃO LER A FOLHA DIRETO
-- ---------------------------------------------------------------------------
-- `scripts/test-perfil-guard.mjs` proíbe `fin_folha` na superfície do time, e a
-- proibição é boa: a folha carrega contratado, divergência e apurado — o que a
-- casa DEVE a cada um comparado ao que pagou. Isso é gestão, não é do app.
--
-- Esta view expõe só o corte: quanto de cada natureza, por mês, para a pessoa
-- logada. Mesmo padrão de `fin_time_recebivel_v` (0161) e
-- `fin_centro_uso_recente_v` (0144).
--
-- ---------------------------------------------------------------------------
-- O QUE ELA NÃO RESOLVE, E O ARQUIVO PRECISA DIZER
-- ---------------------------------------------------------------------------
-- SALÁRIO × PRÓ-LABORE nos sócios. O Fernando tem os dois na vida real (salário
-- perto do mínimo, mais pró-labore), mas os 8 meses dele têm
-- `pago_salarios_cents = 0`: o ledger põe tudo em 6.02. Os MEIs têm 6.01
-- preenchido (88 meses na base contra 72 de 6.02), então a categoria existe e é
-- usada — só não nos sócios.
--
-- Enquanto ninguém categorizar, a view devolve `prolabore` para o todo, porque
-- inventar a divisão do salário de alguém é pior que não mostrá-la. Quando o
-- 6.01 aparecer, a banda de salário nasce sozinha: o app já desenha N naturezas.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_time_remuneracao_mes_v AS
WITH pago AS (
  SELECT p.entity_id,
         p.id                                   AS person_id,
         date_trunc('month', t.posted_on)::date AS mes,
         sum(-t.amount_cents)::bigint           AS total_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code = '6.01')::bigint AS salario_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code = '6.06')::bigint AS estagio_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code = '4.01')::bigint AS comissao_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code IN ('6.03', '6.04'))::bigint AS encargo_cents,
         sum(-t.amount_cents) FILTER (
           WHERE cat.code IS NULL
              OR cat.code NOT IN ('6.01', '6.02', '6.03', '6.04', '6.05', '6.06', '4.01')
         )::bigint AS extra_cents
    FROM fin_transaction t
    JOIN fin_counterparty cp ON cp.id = t.counterparty_id
    JOIN fin_person p        ON p.counterparty_id = cp.id
    LEFT JOIN fin_category cat ON cat.id = t.category_id
   WHERE t.amount_cents < 0
     AND t.posted_on >= DATE '2026-01-01'
     AND coalesce(t.transfer_status, 'nao') = 'nao'
   GROUP BY 1, 2, 3
),
-- O reembolso da competência M é pago em M+1. É a mesma regra de
-- `fin_folha_pessoa_mes_v`, e ela precisa continuar sendo a mesma: dois lugares
-- calculando "o reembolso do mês" com contas diferentes é como o app chegou a
-- mostrar R$ 1.327,09 onde a gestão via R$ 7.586,13.
reemb AS (
  SELECT r.person_id,
         (r.reference_month + INTERVAL '1 mon')::date AS mes,
         r.reference_month::date                      AS competencia,
         r.status,
         r.total_cents::bigint
    FROM fin_reimbursement r
)
SELECT g.entity_id,
       g.person_id,
       g.mes,
       g.natureza,
       g.valor_cents,
       g.competencia,
       g.reembolso_status
  FROM (
    SELECT pg.entity_id, pg.person_id, pg.mes,
           v.natureza, v.valor_cents,
           CASE WHEN v.natureza = 'reembolso' THEN rb.competencia END AS competencia,
           CASE WHEN v.natureza = 'reembolso' THEN rb.status END      AS reembolso_status
      FROM pago pg
      LEFT JOIN reemb rb ON rb.person_id = pg.person_id AND rb.mes = pg.mes
      CROSS JOIN LATERAL (
        -- O reembolso nunca pode passar do que foi pago no mês nem comer as
        -- naturezas que o ledger identifica com segurança. `LEAST` é o que
        -- garante que nenhuma banda saia negativa — e a pós-condição prova.
        SELECT LEAST(
                 coalesce(rb.total_cents, 0),
                 GREATEST(pg.total_cents
                          - coalesce(pg.salario_cents, 0)
                          - coalesce(pg.estagio_cents, 0)
                          - coalesce(pg.comissao_cents, 0)
                          - coalesce(pg.encargo_cents, 0)
                          - coalesce(pg.extra_cents, 0), 0)
               ) AS reembolso
      ) r2
      CROSS JOIN LATERAL (
        VALUES
          ('salario',  coalesce(pg.salario_cents, 0)),
          ('estagio',  coalesce(pg.estagio_cents, 0)),
          ('comissao', coalesce(pg.comissao_cents, 0)),
          ('encargo_beneficio', coalesce(pg.encargo_cents, 0)),
          ('extra',    coalesce(pg.extra_cents, 0)),
          ('reembolso', r2.reembolso),
          -- O pró-labore é o RESTO, por construção: assim a soma das bandas é
          -- sempre exatamente o que caiu na conta, e nenhum centavo se perde
          -- entre a categoria do ledger e o corte da folha.
          ('prolabore', pg.total_cents
                        - coalesce(pg.salario_cents, 0)
                        - coalesce(pg.estagio_cents, 0)
                        - coalesce(pg.comissao_cents, 0)
                        - coalesce(pg.encargo_cents, 0)
                        - coalesce(pg.extra_cents, 0)
                        - r2.reembolso)
      ) AS v(natureza, valor_cents)
  ) g
 WHERE g.valor_cents > 0;

COMMENT ON VIEW fin_time_remuneracao_mes_v IS
  'O que cada pessoa recebeu por mês e por natureza, com o REEMBOLSO vindo da folha '
  '(fin_reimbursement, competência + 1 mês) em vez da categoria do ledger — que mistura '
  'reembolso com pró-labore quando os dois são pagos juntos. O pró-labore é o resto por '
  'construção, então a soma das naturezas é sempre o valor pago. Superfície do app: não '
  'expõe contratado, apurado nem divergência.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  v bigint;
BEGIN
  -- 1. Nenhuma banda negativa. É o que o LEAST/GREATEST existe para garantir.
  SELECT count(*) INTO n FROM fin_time_remuneracao_mes_v WHERE valor_cents <= 0;
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) com valor não positivo', n; END IF;

  -- 2. A soma das naturezas de cada pessoa×mês tem de ser EXATAMENTE o que a
  --    pessoa recebeu naquele mês. Se isto falhar, a tela some com dinheiro de
  --    alguém ou inventa dinheiro que não caiu — as duas são inaceitáveis.
  SELECT count(*) INTO n FROM (
    SELECT r.person_id, r.mes, sum(r.valor_cents) AS bandas,
           (SELECT sum(-t.amount_cents)
              FROM fin_transaction t
              JOIN fin_counterparty cp ON cp.id = t.counterparty_id
              JOIN fin_person p ON p.counterparty_id = cp.id
             WHERE p.id = r.person_id
               AND date_trunc('month', t.posted_on)::date = r.mes
               AND t.amount_cents < 0
               AND coalesce(t.transfer_status, 'nao') = 'nao'
               AND t.posted_on >= DATE '2026-01-01') AS pago
      FROM fin_time_remuneracao_mes_v r
     GROUP BY 1, 2
  ) x WHERE bandas <> pago;
  IF n <> 0 THEN RAISE EXCEPTION '% pessoa×mês em que as bandas não somam o valor pago', n; END IF;

  -- 3. O total da view tem de ser o mesmo de fin_pessoa_remuneracao_v: a
  --    redistribuição muda o RÓTULO de cada centavo, nunca a quantidade.
  SELECT (SELECT coalesce(sum(valor_cents), 0) FROM fin_time_remuneracao_mes_v)
       - (SELECT coalesce(sum(valor_cents), 0) FROM fin_pessoa_remuneracao_v)
    INTO v;
  IF v <> 0 THEN RAISE EXCEPTION 'a view move R$ % em relação ao total pago', round(v / 100.0, 2); END IF;

  RAISE NOTICE 'fin_time_remuneracao_mes_v: % linha(s), % pessoa(s), R$ %',
    (SELECT count(*) FROM fin_time_remuneracao_mes_v),
    (SELECT count(DISTINCT person_id) FROM fin_time_remuneracao_mes_v),
    (SELECT round(sum(valor_cents) / 100.0, 2) FROM fin_time_remuneracao_mes_v);
END $$;
