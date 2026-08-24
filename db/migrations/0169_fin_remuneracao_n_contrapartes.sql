-- Remuneração: uma pessoa, N contrapartes confirmadas.
--
-- ---------------------------------------------------------------------------
-- O BUG
-- ---------------------------------------------------------------------------
-- Desde a 0160, `fin_pessoa_remuneracao_v` e (depois) `fin_time_remuneracao_mes_v`
-- ligam o ledger assim:
--
--     JOIN fin_person p ON p.counterparty_id = cp.id
--
-- `fin_person.counterparty_id` é o ponteiro da contraparte PRIMÁRIA (CPF). Depois
-- da abertura do MEI, o PIX passa a sair no CNPJ — segunda linha confirmada em
-- `fin_person_counterparty`. A view não vê esses lançamentos.
--
-- Medido em 24/08/2026 (só `status = 'confirmado'`):
--
--   Pessoa   | meses na view | meses via links | faltando na view
--   ---------|---------------|-----------------|------------------
--   Igor     | 5             | 8               | R$ 65.602,09
--   Flavio   | 1             | 8               | R$ 32.257,71
--   Cleber   | 1             | 8               | R$ 22.321,84
--   Diogo    | 1             | 8               | R$ 20.952,84
--   Igor A   | 1             | 8               | R$ 11.903,00
--   Evera    | 1             | 8               | R$ 10.500,00
--   Σ 6 MEIs |               |                 | R$ 163.537,48
--
-- Total da view: R$ 521.817,01 → R$ 685.354,49. Zero lançamento com duas
-- pessoas confirmadas na mesma contraparte — a troca não cria soma dupla.
--
-- A tela `/financeiro/pessoas` (células) JÁ soma por `fin_person_counterparty`
-- confirmado — decisão 3 de `lib/financeiro/pessoas.ts`, desde a 0026. A matriz
-- de bandas lia a view e contradizia a tabela do lado. Esta migration alinha
-- as duas portas.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO MUDA
-- ---------------------------------------------------------------------------
-- · Fórmula das bandas (reembolso competência+1, salário-base, comissão
--   declarada, pró-labore = resto) — só o CTE `pago` passa a enxergar o CNPJ.
-- · Fernando (person_id = 4) tem UMA contraparte confirmada: salário R$ 12.693,09
--   permanece. É a âncora da pós-condição.
-- · Links 'proposto' / 'rejeitado' continuam FORA — decisão 2: banco proposto
--   misturaria várias pessoas numa só.

-- ---------------------------------------------------------------------------
-- 1. Pagamentos linha a linha
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_pessoa_remuneracao_v AS
SELECT p.entity_id,
       p.id                                   AS person_id,
       p.name                                 AS pessoa,
       t.id                                   AS transaction_id,
       t.posted_on                            AS data,
       date_trunc('month', t.posted_on)::date AS mes,
       (-t.amount_cents)::bigint              AS valor_cents,
       cat.code                               AS categoria_code,
       cat.name                               AS categoria,
       CASE
         WHEN cat.code = '6.01' THEN 'salario'
         WHEN cat.code = '6.02' THEN 'prolabore'
         WHEN cat.code = '6.06' THEN 'estagio'
         WHEN cat.code = '4.01' THEN 'comissao'
         WHEN cat.code = '6.05' THEN 'reembolso'
         WHEN cat.code IN ('6.03', '6.04') THEN 'encargo_beneficio'
         ELSE 'extra'
       END                                    AS natureza,
       coalesce(a.name, 'conta não identificada') AS conta,
       a.slug                                 AS conta_slug,
       coalesce(t.description_raw, t.description_norm, '') AS descricao
  FROM fin_transaction t
  JOIN fin_person_counterparty l
    ON l.counterparty_id = t.counterparty_id
   AND l.status = 'confirmado'
  JOIN fin_person p ON p.id = l.person_id
  LEFT JOIN fin_category cat ON cat.id = t.category_id
  LEFT JOIN fin_account a    ON a.id = t.account_id
 WHERE t.amount_cents < 0
   AND t.posted_on >= DATE '2026-01-01'
   AND coalesce(t.transfer_status, 'nao') = 'nao';

COMMENT ON VIEW fin_pessoa_remuneracao_v IS
  'Tudo que a casa pagou a cada pessoa de 2026 em diante. Liga o ledger por '
  'fin_person_counterparty confirmado — CPF e CNPJ do mesmo MEI somam na mesma '
  'pessoa (0169). LEITURA de fin_transaction; não guarda cópia.';

-- ---------------------------------------------------------------------------
-- 2. Bandas mês × natureza (mesma fórmula da 0167; só o CTE pago muda)
-- ---------------------------------------------------------------------------
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
    JOIN fin_person_counterparty l
      ON l.counterparty_id = t.counterparty_id
     AND l.status = 'confirmado'
    JOIN fin_person p ON p.id = l.person_id
    LEFT JOIN fin_category cat ON cat.id = t.category_id
   WHERE t.amount_cents < 0
     AND t.posted_on >= DATE '2026-01-01'
     AND coalesce(t.transfer_status, 'nao') = 'nao'
   GROUP BY 1, 2, 3
),
reemb AS (
  SELECT r.person_id,
         (r.reference_month + INTERVAL '1 mon')::date AS mes,
         r.reference_month::date                      AS competencia,
         r.status,
         r.total_cents::bigint
    FROM fin_reimbursement r
)
SELECT g.entity_id, g.person_id, g.mes, g.natureza, g.valor_cents, g.competencia, g.reembolso_status
  FROM (
    SELECT pg.entity_id, pg.person_id, pg.mes,
           v.natureza, v.valor_cents,
           CASE WHEN v.natureza = 'reembolso' THEN rb.competencia END AS competencia,
           CASE WHEN v.natureza = 'reembolso' THEN rb.status END      AS reembolso_status
      FROM pago pg
      LEFT JOIN reemb rb ON rb.person_id = pg.person_id AND rb.mes = pg.mes
      LEFT JOIN LATERAL (
        SELECT sb.valor_cents
          FROM fin_pessoa_salario_base sb
         WHERE sb.person_id = pg.person_id
           AND sb.vigente_desde <= pg.mes
         ORDER BY sb.vigente_desde DESC
         LIMIT 1
      ) base ON TRUE
      LEFT JOIN LATERAL (
        SELECT coalesce(sum(cd.valor_cents), 0)::bigint AS valor_cents
          FROM fin_pessoa_comissao_declarada cd
         WHERE cd.person_id = pg.person_id
           AND cd.competencia = pg.mes
      ) decl ON TRUE
      CROSS JOIN LATERAL (
        SELECT (pg.total_cents
                - coalesce(pg.estagio_cents, 0)
                - CASE WHEN base.valor_cents IS NULL THEN coalesce(pg.salario_cents, 0) ELSE 0 END
                - coalesce(pg.comissao_cents, 0)
                - coalesce(pg.encargo_cents, 0)
                - coalesce(pg.extra_cents, 0)) AS bruta
      ) sbr
      CROSS JOIN LATERAL (
        SELECT LEAST(coalesce(rb.total_cents, 0), GREATEST(sbr.bruta, 0)) AS reembolso
      ) r2
      CROSS JOIN LATERAL (
        SELECT sbr.bruta - r2.reembolso AS pos_reembolso
      ) s1
      CROSS JOIN LATERAL (
        SELECT CASE WHEN base.valor_cents IS NULL THEN 0
                    ELSE LEAST(base.valor_cents, GREATEST(s1.pos_reembolso, 0)) END AS salario_base
      ) sb2
      CROSS JOIN LATERAL (
        SELECT s1.pos_reembolso - sb2.salario_base AS pos_salario
      ) s2
      CROSS JOIN LATERAL (
        SELECT LEAST(coalesce(decl.valor_cents, 0), GREATEST(s2.pos_salario, 0)) AS comissao_decl
      ) cd2
      CROSS JOIN LATERAL (
        VALUES
          ('salario', CASE WHEN base.valor_cents IS NULL THEN coalesce(pg.salario_cents, 0) ELSE sb2.salario_base END),
          ('estagio',  coalesce(pg.estagio_cents, 0)),
          ('comissao', coalesce(pg.comissao_cents, 0) + cd2.comissao_decl),
          ('encargo_beneficio', coalesce(pg.encargo_cents, 0)),
          ('extra',    coalesce(pg.extra_cents, 0)),
          ('reembolso', r2.reembolso),
          ('prolabore', s2.pos_salario - cd2.comissao_decl)
      ) AS v(natureza, valor_cents)
  ) g
 WHERE g.valor_cents > 0;

COMMENT ON VIEW fin_time_remuneracao_mes_v IS
  'O que cada pessoa recebeu por mês e por natureza. CTE pago soma TODAS as '
  'contrapartes confirmadas (0169: CPF+CNPJ do MEI). Comissão declarada = SOMA '
  'do mês (0167). Teto no que sobrou depois de reembolso e base. Pró-labore é o resto.';

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
  v numeric;
BEGIN
  -- 1. Nada negativo / zero (a view já filtra, mas o CASE pode inventar).
  SELECT count(*) INTO n FROM fin_time_remuneracao_mes_v WHERE valor_cents <= 0;
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) com valor não positivo', n; END IF;

  -- 2. Bandas = pago, agora pelo MESMO join (todas as confirmadas).
  SELECT count(*) INTO n FROM (
    SELECT r.person_id, r.mes, sum(r.valor_cents) AS bandas,
           (SELECT sum(-t.amount_cents)
              FROM fin_transaction t
              JOIN fin_person_counterparty l
                ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
             WHERE l.person_id = r.person_id
               AND date_trunc('month', t.posted_on)::date = r.mes
               AND t.amount_cents < 0
               AND coalesce(t.transfer_status, 'nao') = 'nao'
               AND t.posted_on >= DATE '2026-01-01') AS pago
      FROM fin_time_remuneracao_mes_v r GROUP BY 1, 2
  ) x WHERE bandas IS DISTINCT FROM pago;
  IF n <> 0 THEN RAISE EXCEPTION '% pessoa×mês em que as bandas não somam o pago', n; END IF;

  -- 3. As duas views batem entre si (mesma base de lançamentos).
  SELECT (SELECT coalesce(sum(valor_cents), 0) FROM fin_time_remuneracao_mes_v)
       - (SELECT coalesce(sum(valor_cents), 0) FROM fin_pessoa_remuneracao_v)
    INTO v;
  IF v <> 0 THEN
    RAISE EXCEPTION 'bandas e remuneração linha a linha divergem em R$ %', round(v / 100.0, 2);
  END IF;

  -- 4. Total medido em 24/08: os 6 MEIs entram de volta.
  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v;
  IF v IS DISTINCT FROM 685354.49 THEN
    RAISE EXCEPTION 'total geral — esperava R$ 685.354,49, achei R$ %', v;
  END IF;

  -- 5. Cleber (id 6): 8 meses, não só janeiro.
  SELECT count(DISTINCT mes) INTO n
    FROM fin_time_remuneracao_mes_v WHERE person_id = 6;
  IF n <> 8 THEN
    RAISE EXCEPTION 'Cleber deveria ter 8 meses na view, tem %', n;
  END IF;

  SELECT round(sum(valor_cents) / 100.0, 2) INTO v
    FROM fin_time_remuneracao_mes_v WHERE person_id = 6;
  IF v IS DISTINCT FROM 23321.84 THEN
    RAISE EXCEPTION 'Cleber — esperava R$ 23.321,84, achei R$ %', v;
  END IF;

  -- 6. Evera, Diogo, Igor A: também 8 meses (o sintoma da tela).
  SELECT count(*) INTO n FROM (
    SELECT person_id, count(DISTINCT mes) AS meses
      FROM fin_time_remuneracao_mes_v
     WHERE person_id IN (
       SELECT id FROM fin_person WHERE name IN ('Evera', 'Diogo', 'Igor A')
     )
     GROUP BY person_id
    HAVING count(DISTINCT mes) <> 8
  ) x;
  IF n <> 0 THEN
    RAISE EXCEPTION '% dos (Evera, Diogo, Igor A) ainda não tem 8 meses', n;
  END IF;

  -- 7. Âncora: Fernando, uma só contraparte — salário intacto.
  SELECT round(sum(valor_cents) / 100.0, 2) INTO v
    FROM fin_time_remuneracao_mes_v WHERE person_id = 4 AND natureza = 'salario';
  IF v IS DISTINCT FROM 12693.09 THEN
    RAISE EXCEPTION 'salário do Fernando mudou — esperava R$ 12.693,09, achei R$ %', v;
  END IF;

  -- 8. Nenhum lançamento atribuído a duas pessoas confirmadas.
  SELECT count(*) INTO n FROM (
    SELECT t.id
      FROM fin_transaction t
      JOIN fin_person_counterparty l
        ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
     WHERE t.amount_cents < 0
       AND t.posted_on >= DATE '2026-01-01'
       AND coalesce(t.transfer_status, 'nao') = 'nao'
     GROUP BY t.id
    HAVING count(DISTINCT l.person_id) > 1
  ) x;
  IF n <> 0 THEN
    RAISE EXCEPTION '% lançamento(s) com 2+ pessoas confirmadas — a view dobraria', n;
  END IF;

  RAISE NOTICE '0169: remuneração via N contrapartes confirmadas; total R$ 685.354,49; Cleber 8 meses';
END $$;
