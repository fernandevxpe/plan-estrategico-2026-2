-- Duas correções no painel de gasto descrito, e uma pós-condição que morde.
--
-- ---------------------------------------------------------------------------
-- 1. `dinheiro` estava virando "forma não informada"
-- ---------------------------------------------------------------------------
-- A 0154 acrescentou `dinheiro` ao CHECK de `fin_time_envio.pagamento`. O CASE
-- da view (0151) mapeia forma por forma e não a conhecia, então ela caía no
-- `ELSE 'indefinido'` — a tela mostrava "Forma não informada" para um gasto
-- cuja forma a pessoa tinha declarado.
--
-- ---------------------------------------------------------------------------
-- 2. Item cancelado continuava contando como gasto
-- ---------------------------------------------------------------------------
-- A 0157 criou o status `cancelado` nas duas pontas. A view só excluía
-- `rascunho`, então um custo cancelado — e um reembolso recusado, que já era
-- possível antes — seguiam somando no total de `/financeiro/custos`.
--
-- Hoje há zero linhas nesses estados, então o número na tela está certo. Ele
-- passaria a estar errado no PRIMEIRO cancelamento: exatamente quando alguém
-- usasse a funcionalidade nova, e exatamente quando ninguém estaria conferindo.
--
-- ---------------------------------------------------------------------------
-- 3. A pós-condição da 0151 não pegou nada disso, e essa é a lição
-- ---------------------------------------------------------------------------
-- Eu tinha escrito lá: "nenhuma linha sem forma de pagamento". Ela passa —
-- porque uma forma desconhecida não vira NULL, vira `'indefinido'`. A rede
-- tinha um buraco do tamanho exato do problema que ela existia para pegar, e a
-- migration seguinte passou por ele.
--
-- A checagem abaixo é outra: ela lê o CHECK do banco, extrai cada valor
-- aceito, e exige que o texto da view mencione todos. Forma de pagamento nova
-- sem mapeamento passa a QUEBRAR a migration, em vez de sumir num balde.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_gasto_descrito_v AS
SELECT e.entity_id,
       'envio'::text                       AS origem,
       e.id                                AS registro_id,
       e.code,
       e.kind,
       e.status,
       e.titulo,
       e.descricao,
       e.amount_cents,
       e.parcelas,
       e.incurred_on                       AS data,
       date_trunc('month', e.incurred_on)::date AS mes,
       e.enviado_em,
       CASE e.pagamento
         WHEN 'cartao_da_empresa'  THEN 'cartao'
         WHEN 'pix_da_empresa'     THEN 'pix'
         WHEN 'boleto'             THEN 'boleto'
         WHEN 'debito_automatico'  THEN 'debito'
         WHEN 'dinheiro'           THEN 'dinheiro'
         WHEN 'ja_paguei_do_meu'   THEN 'reembolso'
         -- `a_definir` é o único que CAI aqui de propósito: "ainda não sei"
         -- é uma resposta legítima, e agrupá-la como indefinido é honesto.
         ELSE 'indefinido'
       END                                 AS forma,
       p.id AS pessoa_id, p.name AS pessoa, e.identidade_prova,
       e.card_id, e.card_last4, c.label AS cartao_apelido, c.cor AS cartao_cor,
       c.brand AS cartao_bandeira,
       coalesce(e.card_account_id, c.card_account_id) AS conta_id,
       coalesce(i.name, a.name) AS banco,
       cat.code AS categoria_code, cat.name AS categoria, cat.kind AS categoria_kind,
       cc.id AS centro_id, cc.name AS centro, cc.kind AS centro_kind,
       NULL::text AS tipo_reembolso,
       e.fornecedor_nome AS fornecedor,
       (SELECT count(*) FROM fin_payment_attachment at
         WHERE at.target_table = 'fin_time_envio' AND at.target_id = e.id)::int AS anexos
  FROM fin_time_envio e
  JOIN fin_person p            ON p.id = e.person_id
  LEFT JOIN fin_card c         ON c.id = e.card_id
  LEFT JOIN fin_card_account a ON a.id = coalesce(e.card_account_id, c.card_account_id)
  LEFT JOIN fin_card_issuer i  ON i.id = a.issuer_id
  LEFT JOIN fin_category cat   ON cat.id = e.categoria_sugerida_id
  LEFT JOIN fin_cost_center cc ON cc.id = e.cost_center_id
 -- Gasto que não aconteceu não é gasto: rascunho nunca foi enviado, cancelado
 -- foi desfeito, recusado e devolvido não viraram despesa da casa.
 WHERE e.status NOT IN ('rascunho', 'cancelado', 'recusado', 'devolvido')

UNION ALL

SELECT r.entity_id,
       'reembolso'::text, ri.id,
       'RB-' || to_char(r.reference_month, 'YYYY-MM') || '-' || ri.id::text,
       'reembolso'::text, ri.status,
       coalesce(nullif(ri.description, ''), rt.name, 'Reembolso'),
       NULL::text, ri.amount_cents, ri.installment_total,
       ri.expense_date,
       date_trunc('month', coalesce(ri.expense_date, r.reference_month))::date,
       r.submitted_at,
       'reembolso'::text,
       p.id, p.name, 'declarada'::text,
       NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::text,
       NULL::bigint, NULL::text,
       cat.code, cat.name, cat.kind,
       NULL::bigint, NULL::text, NULL::text,
       ri.reimbursement_type,
       NULL::text,
       (SELECT count(*) FROM fin_payment_attachment at
         WHERE at.target_table = 'fin_reimbursement_item' AND at.target_id = ri.id)::int
  FROM fin_reimbursement_item ri
  JOIN fin_reimbursement r ON r.id = ri.reimbursement_id
  JOIN fin_person p        ON p.id = r.person_id
  LEFT JOIN fin_reimbursement_type rt ON rt.slug = ri.reimbursement_type
  LEFT JOIN fin_category cat          ON cat.id = ri.category_id
 -- Mesma regra: cancelado (0157) foi estornado, rejeitado a empresa não pagou.
 WHERE ri.status NOT IN ('cancelado', 'rejeitado');

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  definicao text;
  valor text;
  faltando text[] := '{}';
  n integer;
BEGIN
  SELECT pg_get_viewdef('fin_gasto_descrito_v'::regclass, true) INTO definicao;

  -- TODA forma de pagamento aceita pelo CHECK precisa aparecer na view.
  -- É esta checagem que a 0151 deveria ter tido: ela falha quando alguém
  -- acrescenta uma forma nova e esquece de mapeá-la, em vez de deixá-la cair
  -- silenciosamente em 'indefinido'.
  FOR valor IN
    -- Extrai cada literal entre aspas do texto do CHECK. A primeira tentativa
    -- apagou tudo que não fosse letra e devolveu "boletotext" — o `::text`
    -- colado no valor. `regexp_matches` com grupo é o jeito certo.
    SELECT m[1]
      FROM regexp_matches(
             (SELECT pg_get_constraintdef(oid) FROM pg_constraint
               WHERE conrelid = 'fin_time_envio'::regclass
                 AND conname = 'fin_time_envio_pagamento_check'),
             '''([a-z_]+)''', 'g') AS m
  LOOP
    -- `a_definir` é a ÚNICA exceção, e ela é declarada aqui em vez de a regra
    -- ser afrouxada: "ainda não sei por onde paguei" é resposta legítima, e
    -- agrupá-la como indefinido é o comportamento certo. Qualquer OUTRA forma
    -- que não apareça na view é esquecimento, e reprova.
    IF valor <> '' AND valor <> 'a_definir' AND position(valor IN definicao) = 0 THEN
      faltando := faltando || valor;
    END IF;
  END LOOP;
  IF array_length(faltando, 1) > 0 THEN
    RAISE EXCEPTION 'forma(s) de pagamento sem mapeamento na view: %', array_to_string(faltando, ', ');
  END IF;

  -- E os estados que não são gasto ficaram de fora mesmo.
  SELECT count(*) INTO n FROM fin_gasto_descrito_v
   WHERE status IN ('rascunho', 'cancelado', 'recusado', 'devolvido', 'rejeitado');
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) de gasto que não aconteceu na view', n; END IF;

  -- A view continua de pé e com dado.
  SELECT count(*) INTO n FROM fin_gasto_descrito_v;
  RAISE NOTICE 'fin_gasto_descrito_v: % linha(s) de gasto real', n;
END $$;
