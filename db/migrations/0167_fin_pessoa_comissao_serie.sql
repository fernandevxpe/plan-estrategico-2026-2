-- Comissão: várias por pessoa/mês, com descrição, e séries parceladas.
--
-- ---------------------------------------------------------------------------
-- POR QUE
-- ---------------------------------------------------------------------------
-- A 0165 criou `fin_pessoa_comissao_declarada` com UNIQUE (person_id,
-- competencia): um número por mês. Serve para o caso Audrey (um valor no PIX),
-- mas não serve para gerir a casa — uma pessoa pode ter duas comissões no mesmo
-- mês (ex.: venda A + venda B), cada uma com descrição, ou uma comissão de
-- R$ 12.000 em 6×. Forçar tudo num único valor apagava o detalhe.
--
-- Esta migration:
--   1. cria `fin_pessoa_comissao_serie` (o cabeçalho do parcelamento);
--   2. libera N linhas por pessoa×mês e liga cada parcela à série;
--   3. exige `descricao` (o "a que se refere");
--   4. regrava `fin_time_remuneracao_mes_v` para SOMAR as declarações do mês
--      (antes o JOIN lateral pegava uma linha só — com N linhas quebraria).
--
-- O total pago na view NÃO muda: só muda a capacidade de declarar. Pós-condição
-- congela o total geral medido agora (R$ 521.817,01) e o salário do Fernando.

-- ---------------------------------------------------------------------------
-- 1. Série (parcelamento)
-- ---------------------------------------------------------------------------
CREATE TABLE fin_pessoa_comissao_serie (
  id                   bigserial PRIMARY KEY,
  entity_id            bigint      NOT NULL REFERENCES fin_entity(id),
  person_id            bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  descricao            text        NOT NULL,
  total_cents          bigint      NOT NULL CHECK (total_cents > 0),
  parcelas_total       int         NOT NULL CHECK (parcelas_total >= 1 AND parcelas_total <= 60),
  valor_parcela_cents  bigint      NOT NULL CHECK (valor_parcela_cents > 0),
  primeira_competencia date        NOT NULL,
  nota                 text,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_pessoa_comissao_serie_mes_cheio
    CHECK (primeira_competencia = date_trunc('month', primeira_competencia)::date)
);

CREATE INDEX fin_pessoa_comissao_serie_pessoa_idx
  ON fin_pessoa_comissao_serie (person_id, primeira_competencia DESC);

COMMENT ON TABLE fin_pessoa_comissao_serie IS
  'Cabeçalho de comissão parcelada: descrição + total + N parcelas. As parcelas '
  'moram em fin_pessoa_comissao_declarada com serie_id preenchido. À vista = '
  'uma linha declarada sem série (parcelas_total = 1 implícito).';

-- ---------------------------------------------------------------------------
-- 2. Liberar N por mês + descrição + vínculo à série
-- ---------------------------------------------------------------------------
ALTER TABLE fin_pessoa_comissao_declarada
  DROP CONSTRAINT IF EXISTS fin_pessoa_comissao_declarada_person_id_competencia_key;

ALTER TABLE fin_pessoa_comissao_declarada
  ADD COLUMN IF NOT EXISTS descricao text,
  ADD COLUMN IF NOT EXISTS serie_id bigint REFERENCES fin_pessoa_comissao_serie(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS parcela int,
  ADD COLUMN IF NOT EXISTS parcelas_total int;

-- As 2 linhas já existentes: nota virava a única pista — promove a descrição.
UPDATE fin_pessoa_comissao_declarada
   SET descricao = COALESCE(NULLIF(btrim(nota), ''), 'Comissão (sem descrição — migrada da 0165)')
 WHERE descricao IS NULL;

ALTER TABLE fin_pessoa_comissao_declarada
  ALTER COLUMN descricao SET NOT NULL;

ALTER TABLE fin_pessoa_comissao_declarada
  ADD CONSTRAINT fin_pessoa_comissao_declarada_parcela_coerente CHECK (
    (serie_id IS NULL AND parcela IS NULL AND parcelas_total IS NULL)
    OR (serie_id IS NOT NULL AND parcela IS NOT NULL AND parcelas_total IS NOT NULL
        AND parcela >= 1 AND parcela <= parcelas_total)
  );

CREATE INDEX fin_pessoa_comissao_declarada_pessoa_mes_idx
  ON fin_pessoa_comissao_declarada (person_id, competencia DESC);

CREATE INDEX fin_pessoa_comissao_declarada_serie_idx
  ON fin_pessoa_comissao_declarada (serie_id)
  WHERE serie_id IS NOT NULL;

COMMENT ON COLUMN fin_pessoa_comissao_declarada.descricao IS
  'A que a comissão se refere (obra, venda, bônus). Obrigatória — sem ela a '
  'matriz vira um total sem lastro e ninguém investiga.';

COMMENT ON COLUMN fin_pessoa_comissao_declarada.serie_id IS
  'NULL = lançamento à vista. Preenchido = parcela de fin_pessoa_comissao_serie.';

-- ---------------------------------------------------------------------------
-- 3. View: SOMAR declarações do mês (em vez de uma linha)
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
    JOIN fin_counterparty cp ON cp.id = t.counterparty_id
    JOIN fin_person p        ON p.counterparty_id = cp.id
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
      -- 0167: SUM — várias comissões no mesmo mês somam (antes UNIQUE impedia).
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
  'O que cada pessoa recebeu por mês e por natureza. Comissão declarada = SOMA '
  'de fin_pessoa_comissao_declarada no mês (0167: N linhas por pessoa×mês). '
  'Teto no que sobrou depois de reembolso e base. Pró-labore é o resto.';

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer; v numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'fin_pessoa_comissao_serie'
  ) THEN
    RAISE EXCEPTION 'fin_pessoa_comissao_serie não foi criada';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'fin_pessoa_comissao_declarada'
       AND constraint_name = 'fin_pessoa_comissao_declarada_person_id_competencia_key'
  ) THEN
    RAISE EXCEPTION 'UNIQUE (person_id, competencia) ainda existe — N por mês não entra';
  END IF;

  SELECT count(*) INTO n FROM fin_pessoa_comissao_declarada WHERE descricao IS NULL OR btrim(descricao) = '';
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) sem descricao', n; END IF;

  SELECT count(*) INTO n FROM fin_time_remuneracao_mes_v WHERE valor_cents <= 0;
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) com valor não positivo', n; END IF;

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
      FROM fin_time_remuneracao_mes_v r GROUP BY 1, 2
  ) x WHERE bandas <> pago;
  IF n <> 0 THEN RAISE EXCEPTION '% pessoa×mês em que as bandas não somam o pago', n; END IF;

  -- Sem linha nova de declaração, o total pago não pode ter mudado.
  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v;
  IF v IS DISTINCT FROM 521817.01 THEN
    RAISE EXCEPTION 'o total geral da view mudou — esperava R$ 521.817,01, achei R$ %', v;
  END IF;

  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v
   WHERE person_id = 4 AND natureza = 'salario';
  IF v IS DISTINCT FROM 12693.09 THEN
    RAISE EXCEPTION 'salário do Fernando mudou — esperava R$ 12.693,09, achei R$ %', v;
  END IF;

  RAISE NOTICE '0167: série criada, N comissões/mês liberado, view soma declarações; totais intactos';
END $$;
