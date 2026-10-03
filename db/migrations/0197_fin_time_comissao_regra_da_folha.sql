-- Na conferência do app do time, comissão paga no início do mês é do mês anterior.
--
-- O DEFEITO, MEDIDO EM 02/10/2026
-- -------------------------------
-- `categorizar-pagamento-por-ordem.mjs` passou a gravar 4.01 no PIX que pagou
-- uma ordem de comissão (antes ele ficava em 6.01/6.02, pela regra do vínculo,
-- e o app acusava "faltou" o que tinha sido pago). Só que 4.01 é do grupo
-- `custos-diretos`, e a competência dele é o dia do PIX
-- (`competencia_presumida_caixa`). As categorias de folha — 6.01, 6.02, 6.05 —
-- são `pessoal`, e o PIX dos primeiros dias vira o mês anterior
-- (`folha_mes_referencia`).
--
-- O app concilia a competência M contra o que caiu no caixa de M+1. Com 4.01 no
-- dia do PIX, a comissão de setembro paga em 02/10 caía em OUTUBRO: o Jonildo
-- via R$ 8.074,61 "a mais" num mês e o Gabriel R$ 5.093,81 "faltando" no outro.
--
-- POR QUE AQUI, E NÃO NA CATEGORIA
-- --------------------------------
-- Para a DRE, comissão é custo direto e a competência de caixa é a certa — não
-- se mexe em `fin_category` nem em `competence_date` por causa de uma tela. O
-- que muda é só a LEITURA do app: comissão paga a alguém do time até o dia 5
-- segue a regra da folha, a mesma que esta view já aplica às devoluções.

CREATE OR REPLACE VIEW fin_time_recebivel_competencia_v AS
WITH base AS (
  SELECT p.entity_id,
         p.id AS person_id,
         t.amount_cents,
         t.posted_on,
         cat.code AS categoria_code,
         t.competence_rule,
         COALESCE(t.description_raw, t.description_norm, ''::text) AS descricao,
         CASE
           WHEN t.amount_cents > 0 AND EXTRACT(day FROM t.posted_on) <= 5
             THEN (date_trunc('month', t.posted_on::timestamp with time zone) - '1 day'::interval)::date
           WHEN t.amount_cents > 0 THEN t.posted_on
           -- 0197: comissão ao time segue a folha na conferência.
           WHEN cat.code = '4.01' AND EXTRACT(day FROM t.posted_on) <= 5
             THEN (date_trunc('month', t.posted_on::timestamp with time zone) - '1 day'::interval)::date
           ELSE t.competence_date
         END AS competencia_efetiva
    FROM fin_transaction t
    JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
    JOIN fin_person p ON p.id = l.person_id
    LEFT JOIN fin_category cat ON cat.id = t.category_id
   WHERE COALESCE(t.transfer_status, 'nao') = 'nao'
     AND (   (t.amount_cents < 0 AND t.competence_date >= '2026-01-01'::date)
          OR (t.amount_cents > 0
              AND t.posted_on >= '2026-08-01'::date
              AND (cat.code IS NULL OR cat.code LIKE '6.%' OR cat.code = '4.01')))
)
SELECT entity_id,
       person_id,
       date_trunc('month', competencia_efetiva::timestamp with time zone)::date AS competencia,
       posted_on AS pago_em,
       - amount_cents AS valor_cents,
       categoria_code,
       CASE
         WHEN amount_cents > 0 THEN 'devolucao'
         WHEN categoria_code = '6.01' THEN 'salario'
         WHEN categoria_code = '6.02' THEN 'prolabore'
         WHEN categoria_code = '6.06' THEN 'estagio'
         WHEN categoria_code = '4.01' THEN 'comissao'
         WHEN categoria_code = '6.05' THEN 'reembolso'
         WHEN categoria_code = ANY (ARRAY['6.03', '6.04']) THEN 'encargo_beneficio'
         ELSE 'extra'
       END AS natureza,
       competence_rule,
       descricao
  FROM base;

DO $$
DECLARE v_fora int;
BEGIN
  -- Nenhuma comissão ao time paga até o dia 5 pode continuar no mês do PIX.
  SELECT count(*) INTO v_fora
    FROM fin_time_recebivel_competencia_v
   WHERE natureza = 'comissao'
     AND EXTRACT(day FROM pago_em) <= 5
     AND competencia = date_trunc('month', pago_em)::date;
  IF v_fora > 0 THEN
    RAISE EXCEPTION '0197: % comissão(ões) do início do mês ainda no mês do PIX', v_fora;
  END IF;
  RAISE NOTICE '0197: comissão ao time segue a regra da folha na conferência do app';
END $$;
