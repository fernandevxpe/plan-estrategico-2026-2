-- Parcela de mês FUTURO do app não é oferecida para pagamento antes da hora.
--
-- O DEFEITO, MEDIDO EM 02/10/2026
-- -------------------------------
-- O Igor lançou pelo app "Materiais Fe síndico", R$ 1.400,34 em 3×. O app grava
-- o valor CHEIO num item só, com `installment_number = 1` e `_total = 3`, sem
-- plano e sem as parcelas 2 e 3 (`lib/financeiro/time.ts`, no INSERT de
-- `criarReembolsoDoTime`). A plataforma ofereceria R$ 1.400,34 de uma vez; o
-- dono corrigiu: "deveria ser dividido em 3 parcelas".
--
-- O caminho da casa para parcelado é o de `criarItemReembolso`
-- (`lib/financeiro/reembolsos.ts`): um plano e UM ITEM POR MÊS, cada um no
-- reembolso do seu mês. Só que a 0179 não tem eixo de tempo do lado do app —
-- soma todo item não pago, de qualquer competência. Gravar as parcelas 2 e 3
-- hoje as poria as três no pagamento de outubro: R$ 466,78 × 3, o mesmo
-- R$ 1.400,34 que se queria dividir.
--
-- A REGRA
-- -------
-- Item do app entra no saldo quando a competência dele CHEGOU: mês do pedido
-- <= mês corrente, no fuso de São Paulo (o servidor vive em UTC e na virada do
-- mês estaria um mês atrasado por três horas).
--
-- Medido antes de aplicar: ZERO pedidos com competência futura na base. Esta
-- migration não muda nenhum número hoje — ela só abre o lugar para a parcela
-- futura existir sem ser cobrada antes.
--
-- O QUE ISTO NÃO RESOLVE
-- ----------------------
-- O lado da PLANILHA continua oferecendo a parcela da série todo mês enquanto
-- `parcela < parcelas_total` na última linha, e a última linha parou em julho.
-- O contador dela não anda sozinho — é o item aberto das séries, e não é desta
-- migration.

CREATE OR REPLACE VIEW fin_reembolso_saldo_unificado_v AS
SELECT 'planilha'::text                        AS origem,
       s.person_id,
       s.pessoa,
       s.slug,
       s.descricao,
       s.categoria_livre,
       s.ultima_competencia,
       s.parcela,
       s.parcelas_total,
       s.valor_parcela_cents,
       s.parcelas_restantes,
       s.saldo_cents,
       s.quitado,
       NULL::text                              AS status_pedido,
       false                                   AS tem_comprovante
  FROM fin_reembolso_saldo_v s

UNION ALL

SELECT 'app'::text                             AS origem,
       r.person_id,
       p.name                                  AS pessoa,
       'app-' || i.id::text                    AS slug,
       i.description                           AS descricao,
       NULL::text                              AS categoria_livre,
       date_trunc('month', r.reference_month)::date AS ultima_competencia,
       COALESCE(i.installment_number, 1)       AS parcela,
       COALESCE(i.installment_total, 1)        AS parcelas_total,
       i.amount_cents                          AS valor_parcela_cents,
       1                                       AS parcelas_restantes,
       i.amount_cents                          AS saldo_cents,
       false                                   AS quitado,
       COALESCE(r.status, 'aprovado')          AS status_pedido,
       (i.receipt_artifact_key IS NOT NULL)    AS tem_comprovante
  FROM fin_reimbursement_item i
  JOIN fin_reimbursement r ON r.id = i.reimbursement_id
  JOIN fin_person p        ON p.id = r.person_id
 WHERE COALESCE(r.status, 'aprovado') NOT IN ('pago', 'rejeitado')
   AND COALESCE(i.status, 'aprovado') NOT IN ('pago', 'rejeitado', 'cancelado')
   AND r.reference_month <= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
   AND NOT EXISTS (
     SELECT 1
       FROM fin_reembolso_item a
      WHERE a.person_id = r.person_id
        AND a.competencia = date_trunc('month', r.reference_month)::date
        AND (a.valor_parcela_cents = i.amount_cents
             OR lower(btrim(a.descricao)) = lower(btrim(i.description)))
   );

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_futuros int; v_na_view int;
BEGIN
  -- Não pode haver competência futura na base agora: é o que garante que esta
  -- migration não tirou dinheiro de ninguém da fila.
  SELECT count(*) INTO v_futuros
    FROM fin_reimbursement
   WHERE reference_month > date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_futuros > 0 THEN
    RAISE EXCEPTION '0195: % pedido(s) com competência futura — a medição mudou, reveja antes de filtrar', v_futuros;
  END IF;

  SELECT count(*) INTO v_na_view
    FROM fin_reembolso_saldo_unificado_v
   WHERE origem = 'app'
     AND ultima_competencia > date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_na_view > 0 THEN
    RAISE EXCEPTION '0195: % item(ns) de competência futura ainda aparecem no saldo', v_na_view;
  END IF;

  RAISE NOTICE '0195: saldo do app limitado à competência corrente; nenhum número mudou';
END $$;
