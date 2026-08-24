-- Comissão declarada, e a base-salário deixa de ser exclusiva do sócio.
--
-- ---------------------------------------------------------------------------
-- O CASO QUE A 0164 NÃO PREVIA
-- ---------------------------------------------------------------------------
-- A 0164 resolveu o sócio: 6.01 vazio, tudo em 6.02, e a base "puxa" salário de
-- dentro da sobra. Funciona porque o 6.01 dele é zero — a sobra inteira fica
-- livre para a base reivindicar.
--
-- A Audrey (consultoria, MEI) é o caso oposto: cada PIX dela já cai em 6.01,
-- porque o banco não sabe separar salário de comissão de reembolso dentro da
-- MESMA transferência — ela recebe tudo junto, uma vez por mês. Com a fórmula
-- da 0164, `salario_cents` (6.01) já consumia a sobra INTEIRA antes de qualquer
-- redistribuição rodar: declarar comissão para ela não tinha de onde puxar,
-- porque não sobrava nada.
--
-- ---------------------------------------------------------------------------
-- A MUDANÇA
-- ---------------------------------------------------------------------------
-- Quando a pessoa TEM base declarada, o 6.01 do ledger entra no bolo a
-- redistribuir em vez de ser salário direto — o mesmo tratamento que o 6.02 do
-- sócio já recebia. Quem NÃO tem base continua exatamente como antes: 6.01 é
-- salário puro, sem desvio (provado abaixo — o total do Fernando não muda um
-- centavo).
--
-- A ordem de quem reivindica a sobra, do mais certo para o mais residual:
--   reembolso (é devolução, não remuneração; e já tem valor registrado em
--   `fin_reimbursement` — não depende de recategorizar transação nenhuma)
--   → base salarial (o fixo contratado)
--   → comissão declarada (o variável do mês, com teto no que sobrou)
--   → pró-labore (o resíduo, sempre foi assim)
--
-- Cada etapa usa LEAST/GREATEST contra o que sobrou da anterior — a mesma
-- disciplina da 0164. Isso é o que garante, por construção, que a soma das
-- bandas nunca passa do que a pessoa recebeu: ninguém "ganha" dinheiro que não
-- caiu na conta, e declarar comissão maior que a sobra dá só o que existe.
--
-- ---------------------------------------------------------------------------
-- fin_pessoa_comissao_declarada
-- ---------------------------------------------------------------------------
-- Por que uma tabela nova e não `fin_comissao_prevista`/`fin_comissao_pagamento`
-- (0076): aquelas são sobre comissão de VENDA — amarradas a contrato, negócio
-- do pipe, papel de vendedor/eng. comercial/execução, com % sobre uma base de
-- projeto. Forçar o caso da Audrey ali significaria inventar contrato e papel
-- que não existem. Esta tabela é deliberadamente burra: pessoa, mês, valor,
-- nota — o mesmo espírito de `fin_pessoa_salario_base`, para o mesmo tipo de
-- fato (alguém do financeiro afirma um número, com vigência de mês).

CREATE TABLE IF NOT EXISTS fin_pessoa_comissao_declarada (
  id            bigserial PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES fin_entity(id),
  person_id     bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  competencia   date        NOT NULL,
  valor_cents   bigint      NOT NULL CHECK (valor_cents > 0),
  nota          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, competencia)
);

COMMENT ON TABLE fin_pessoa_comissao_declarada IS
  'Comissão do mês, afirmada por quem paga — não deduzida do extrato. Existe para MEIs '
  'de consultoria (ex.: Audrey) cujo PIX mensal mistura salário, comissão e reembolso na '
  'MESMA transferência, sem categoria própria por natureza. A view fin_time_remuneracao_mes_v '
  'usa isto para separar, com teto no que sobrou depois de reembolso e salário-base.';

COMMENT ON COLUMN fin_pessoa_comissao_declarada.competencia IS
  'Primeiro dia do mês a que a comissão se refere — o mesmo mês em que caiu no banco, '
  'diferente do reembolso (que é sempre competência do mês anterior ao pagamento).';

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
      -- A base vigente NAQUELE mês.
      LEFT JOIN LATERAL (
        SELECT sb.valor_cents
          FROM fin_pessoa_salario_base sb
         WHERE sb.person_id = pg.person_id
           AND sb.vigente_desde <= pg.mes
         ORDER BY sb.vigente_desde DESC
         LIMIT 1
      ) base ON TRUE
      -- A comissão declarada NAQUELE mês (competência = mês do pagamento, ao
      -- contrário do reembolso — a comissão não tem o atraso de um ciclo).
      LEFT JOIN LATERAL (
        SELECT cd.valor_cents
          FROM fin_pessoa_comissao_declarada cd
         WHERE cd.person_id = pg.person_id
           AND cd.competencia = pg.mes
      ) decl ON TRUE
      -- Sobra bruta: SEM base, o 6.01 já é salário puro (comportamento de
      -- sempre, preservado). COM base, o 6.01 entra no bolo a redistribuir —
      -- é o que faz o caso da Audrey funcionar sem recategorizar transação
      -- nenhuma: a fórmula não olha a categoria do PIX, olha o que sobrou.
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
  'O que cada pessoa recebeu por mês e por natureza. O REEMBOLSO vem da folha '
  '(fin_reimbursement, competência + 1 mês). O SALÁRIO vem de fin_pessoa_salario_base quando '
  'a pessoa tem base registrada — sócio (6.02 sem separação) ou MEI de consultoria (6.01 '
  'misturado com comissão e reembolso no mesmo PIX, caso da 0165). A COMISSÃO soma o que '
  'está em 4.01 no ledger mais o que foi declarado em fin_pessoa_comissao_declarada, com '
  'teto no que sobrou depois de reembolso e base. O pró-labore é o resto por construção, '
  'então a soma das naturezas é sempre o valor pago.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE n integer; v numeric;
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

  -- Regressão: o salário do Fernando é o caso que já tinha base (0164) e não
  -- pode ter mudado — para ele o CASE novo é sempre um no-op (salario_cents
  -- dele já era zero). Medido antes desta migration: R$ 12.693,09.
  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v
   WHERE person_id = 4 AND natureza = 'salario';
  IF v IS DISTINCT FROM 12693.09 THEN
    RAISE EXCEPTION 'salário do Fernando mudou — esperava R$ 12.693,09 (valor antes desta migration), achei R$ %', v;
  END IF;

  -- Regressão do total geral: nenhuma migration de redistribuição pode criar
  -- nem destruir dinheiro. Medido antes desta migration: R$ 521.817,01.
  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v;
  IF v IS DISTINCT FROM 521817.01 THEN
    RAISE EXCEPTION 'o total geral da view mudou — esperava R$ 521.817,01, achei R$ %', v;
  END IF;

  RAISE NOTICE 'fin_pessoa_comissao_declarada criada; view regravada; Fernando e o total geral confirmados inalterados';
END $$;
