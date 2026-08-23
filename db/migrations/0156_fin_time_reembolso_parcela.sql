-- Histórico de parcelas de reembolso para o app do time — view estreita sobre a
-- planilha (0129). A rota não toca fin_reembolso_item nem fin_transaction direto.

CREATE OR REPLACE VIEW fin_time_reembolso_parcela_v AS
SELECT
  person_id,
  id AS item_id,
  slug,
  descricao,
  competencia,
  parcela,
  parcelas_total,
  valor_parcela_cents,
  (parcela >= parcelas_total) AS quitado
FROM fin_reembolso_item;

COMMENT ON VIEW fin_time_reembolso_parcela_v IS
  'Parcelas pagas por slug na planilha de reembolso. Filtrar por person_id da sessão.';

DO $$
BEGIN
  IF to_regclass('fin_time_reembolso_parcela_v') IS NULL THEN
    RAISE EXCEPTION '0156: fin_time_reembolso_parcela_v não foi criada';
  END IF;
END $$;
