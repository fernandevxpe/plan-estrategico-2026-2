-- Reembolsos solicitados pelo time passam a aprovados por padrão.
-- O financeiro audita e reprova/cancela se necessário.

UPDATE fin_reimbursement
   SET status = 'aprovado',
       approved_at = coalesce(approved_at, now()),
       approved_by = coalesce(approved_by, 'sistema')
 WHERE status IN ('enviado', 'rascunho');

UPDATE fin_reimbursement_item
   SET status = 'aprovado'
 WHERE status = 'pendente';

DO $$
BEGIN
  PERFORM count(*) FROM fin_reimbursement;
  PERFORM count(*) FROM fin_reimbursement_item;
END $$;
