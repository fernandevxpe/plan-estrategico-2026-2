-- O mês do reembolso, quando o item não tem data.
--
-- A 0151 usou `ri.expense_date` para data e para mês, e medido depois: dos 193
-- itens de reembolso, ZERO têm `expense_date`. Eles vieram de importação de
-- planilha, e a planilha trazia o mês da prestação de contas, não o dia da
-- compra. Resultado: R$ 42.320,34 — todo o histórico de reembolso da casa —
-- caindo num balde "sem mês" no eixo do tempo.
--
-- `fin_reimbursement.reference_month` está preenchido em 81 de 81. É o mês de
-- COMPETÊNCIA, e para agrupar por período é exatamente o certo.
--
-- MÊS CAI PARA A COMPETÊNCIA, DATA NÃO.
-- A distinção não é preciosismo: mostrar "01/07/2026" numa coluna chamada Data,
-- para uma compra que aconteceu num dia qualquer de julho, é afirmar um dia que
-- ninguém sabe. O mês é verdade — o item pertence àquele mês de reembolso; o
-- dia não existe no dado. Então `mes` cai para a competência e `data` fica
-- nula, e a tela escreve "—" em vez de um dia inventado.
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
         WHEN 'ja_paguei_do_meu'   THEN 'reembolso'
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
 WHERE e.status <> 'rascunho'

UNION ALL

SELECT r.entity_id,
       'reembolso'::text, ri.id,
       'RB-' || to_char(r.reference_month, 'YYYY-MM') || '-' || ri.id::text,
       'reembolso'::text, ri.status,
       coalesce(nullif(ri.description, ''), rt.name, 'Reembolso'),
       NULL::text, ri.amount_cents, ri.installment_total,
       -- Data continua sendo só o dia REAL da despesa. Nulo é nulo.
       ri.expense_date,
       -- Mês cai para a competência do reembolso: é verdade sobre o período,
       -- e é o que faz R$ 42 mil de histórico entrarem no eixo do tempo.
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
  LEFT JOIN fin_category cat          ON cat.id = ri.category_id;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  sem_mes integer;
  total integer;
BEGIN
  SELECT count(*) INTO total FROM fin_gasto_descrito_v;
  SELECT count(*) INTO sem_mes FROM fin_gasto_descrito_v WHERE mes IS NULL;
  IF sem_mes <> 0 THEN
    RAISE EXCEPTION '% de % linha(s) ainda sem mês — o eixo do tempo não fecha', sem_mes, total;
  END IF;

  -- E a data continua honesta: não pode ter ganhado dia nenhum de brinde.
  SELECT count(*) INTO sem_mes
    FROM fin_gasto_descrito_v v
    JOIN fin_reimbursement_item ri ON ri.id = v.registro_id AND v.origem = 'reembolso'
   WHERE ri.expense_date IS NULL AND v.data IS NOT NULL;
  IF sem_mes <> 0 THEN RAISE EXCEPTION '% item(ns) ganharam data que não existe no dado', sem_mes; END IF;

  RAISE NOTICE 'eixo do tempo fechado: % linha(s), 0 sem mês', total;
END $$;
