-- Sócio tem salário E pró-labore, e o ledger não sabe separar.
--
-- ---------------------------------------------------------------------------
-- O FATO, DITO PELO DONO
-- ---------------------------------------------------------------------------
-- "quando o membro é um sócio, que é meu caso, ele tem salário (que geralmente
-- é o mínimo) e tem o pró-labore e ainda tem os reembolsos."
--
-- O ledger põe tudo em 6.02: os 27 lançamentos do Fernando em 2026 estão lá, e
-- a descrição de todos é a mesma string. `pago_salarios_cents` = 0 nos 8 meses.
-- Nenhum dos 4 sócios tem 6.01, enquanto os MEIs têm (88 meses com 6.01 na base
-- contra 72 com 6.02).
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA, E NÃO UM PALPITE NA VIEW
-- ---------------------------------------------------------------------------
-- Dava para deduzir: R$ 1.621,00 aparece nos 8 meses do Fernando, e o resto
-- completa para valores redondos. Conferido contra os PIX reais: o pró-labore
-- calculado com essa base É um lançamento que existe em 6 dos 8 meses (jan e
-- jul têm pagamentos extras que quebram o casamento exato).
--
-- Mas dedução some do registro. Salário base é FATO CONTRATUAL, muda quando o
-- mínimo muda, e quem lê a tela daqui a um ano precisa saber de onde veio o
-- número. Então vira linha, com vigência e nota — e a nota diz quem afirmou.
--
-- A vigência existe porque o mínimo muda todo janeiro: em 2027 entra outra
-- linha, e os meses de 2026 continuam calculando com a de 2026.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS fin_pessoa_salario_base (
  id            bigserial PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES fin_entity(id),
  person_id     bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  vigente_desde date        NOT NULL,
  valor_cents   bigint      NOT NULL CHECK (valor_cents > 0),
  nota          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, vigente_desde)
);

COMMENT ON TABLE fin_pessoa_salario_base IS
  'O salário base contratado de cada pessoa, com vigência. Existe porque o ledger não '
  'separa salário de pró-labore nos sócios — põe os dois em 6.02 — e essa divisão é fato '
  'contratual, não coisa de deduzir do extrato. Quem NÃO tem linha aqui continua sendo '
  'classificado pela categoria do lançamento.';

COMMENT ON COLUMN fin_pessoa_salario_base.vigente_desde IS
  'A partir de quando este valor vale. O mínimo muda todo janeiro: a linha nova não apaga '
  'a antiga, e os meses passados continuam calculando com a vigência deles.';

-- O caso conhecido, afirmado pelo próprio ------------------------------------

INSERT INTO fin_pessoa_salario_base (entity_id, person_id, vigente_desde, valor_cents, nota)
SELECT p.entity_id, p.id, DATE '2026-01-01', 162100,
       'Salário mínimo. Afirmado pelo Fernando em 23/08/2026; confere com o PIX de '
       'R$ 1.621,00 presente nos 8 meses de 2026.'
  FROM fin_person p
  JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
 WHERE p.id = 4
ON CONFLICT (person_id, vigente_desde) DO NOTHING;

-- A view passa a separar -------------------------------------------------------

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
      -- A base vigente NAQUELE mês: a linha mais recente que já começou.
      LEFT JOIN LATERAL (
        SELECT sb.valor_cents
          FROM fin_pessoa_salario_base sb
         WHERE sb.person_id = pg.person_id
           AND sb.vigente_desde <= pg.mes
         ORDER BY sb.vigente_desde DESC
         LIMIT 1
      ) base ON TRUE
      CROSS JOIN LATERAL (
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
        SELECT pg.total_cents
               - coalesce(pg.salario_cents, 0)
               - coalesce(pg.estagio_cents, 0)
               - coalesce(pg.comissao_cents, 0)
               - coalesce(pg.encargo_cents, 0)
               - coalesce(pg.extra_cents, 0)
               - r2.reembolso AS sobra
      ) s
      CROSS JOIN LATERAL (
        -- Onde há base registrada, ela morde PRIMEIRO a sobra: o salário é o
        -- compromisso fixo, e o pró-labore é o que vem além dele. `LEAST`
        -- porque num mês magro a pessoa pode receber menos que a base — aí
        -- tudo que caiu é salário, e o pró-labore é zero. Foi o que aconteceu
        -- com o Fernando em fevereiro: R$ 1.346,09 de remuneração contra uma
        -- base de R$ 1.621,00.
        SELECT CASE WHEN base.valor_cents IS NULL THEN 0
                    ELSE LEAST(base.valor_cents, GREATEST(s.sobra, 0)) END AS salario_base
      ) sb2
      CROSS JOIN LATERAL (
        VALUES
          ('salario',  coalesce(pg.salario_cents, 0) + sb2.salario_base),
          ('estagio',  coalesce(pg.estagio_cents, 0)),
          ('comissao', coalesce(pg.comissao_cents, 0)),
          ('encargo_beneficio', coalesce(pg.encargo_cents, 0)),
          ('extra',    coalesce(pg.extra_cents, 0)),
          ('reembolso', r2.reembolso),
          ('prolabore', s.sobra - sb2.salario_base)
      ) AS v(natureza, valor_cents)
  ) g
 WHERE g.valor_cents > 0;

COMMENT ON VIEW fin_time_remuneracao_mes_v IS
  'O que cada pessoa recebeu por mês e por natureza. O REEMBOLSO vem da folha '
  '(fin_reimbursement, competência + 1 mês) em vez da categoria do ledger, que mistura '
  'reembolso com pró-labore quando os dois são pagos juntos. O SALÁRIO vem de '
  'fin_pessoa_salario_base quando a pessoa tem base registrada — é o caso dos sócios, que '
  'têm salário e pró-labore mas aparecem só como 6.02 no ledger. O pró-labore é o resto '
  'por construção, então a soma das naturezas é sempre o valor pago.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE n integer; v bigint;
BEGIN
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

  SELECT (SELECT coalesce(sum(valor_cents), 0) FROM fin_time_remuneracao_mes_v)
       - (SELECT coalesce(sum(valor_cents), 0) FROM fin_pessoa_remuneracao_v) INTO v;
  IF v <> 0 THEN RAISE EXCEPTION 'a view move R$ % do total pago', round(v / 100.0, 2); END IF;

  -- O salário do Fernando tem de ter nascido: se a base não pegou, a divisão
  -- que esta migration existe para fazer não aconteceu, e ela passaria calada.
  SELECT count(*) INTO n FROM fin_time_remuneracao_mes_v WHERE person_id = 4 AND natureza = 'salario';
  IF n = 0 THEN RAISE EXCEPTION 'a base do Fernando não produziu nenhum mês de salário'; END IF;

  RAISE NOTICE 'salário separado em % mês(es) do Fernando, R$ %', n,
    (SELECT round(sum(valor_cents) / 100.0, 2) FROM fin_time_remuneracao_mes_v
      WHERE person_id = 4 AND natureza = 'salario');
END $$;
