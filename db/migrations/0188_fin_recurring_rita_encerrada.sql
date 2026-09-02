-- Rita já entra na composição da folha (salário R$ 1.000 em duas parcelas, 0187).
-- A recorrente 400 (R$ 1.040, categoria 4.03, status proposto) era palpite
-- antigo e duplicava a pessoa na agenda — inclusive no balde "sem favorecido"
-- quando a composição e a recorrente brigavam pela mesma chave.
-- ===========================================================================

UPDATE fin_recurring
   SET status = 'encerrado',
       status_motivo = 'Substituída pela composição da folha (fin_person:107) e parcelas 0187 — 01/09/2026',
       status_alterado_em = now(),
       status_alterado_por = 'migration:0188'
 WHERE id = 400
   AND status = 'proposto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fin_recurring WHERE id = 400 AND status = 'encerrado'
  ) THEN
    RAISE EXCEPTION '0188: fin_recurring 400 deveria estar encerrada';
  END IF;
END $$;
