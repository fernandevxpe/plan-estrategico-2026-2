-- fin_obras_pipeline_v (0121) contava parcela marcada PAGA-sem-documento como
-- "nunca cobrado" — e isso é falso: o erp-obras registrou um pagamento, só
-- não achou o documento Asaas que confirma. São coisas diferentes.
--
-- Achado ao validar a view recém-criada: 1 parcela de R$ 5.000,00
-- (status_erp='PAGA', sem fin_document_id casado, vencida) estava inflando
-- nunca_cobrado_cents em R$ 5.000,00 e escondendo o próprio caso.
--
-- A view ganha uma quarta categoria — marcado_pago_sem_documento_cents —
-- em vez de espalhar essa parcela numa das outras quatro. Nenhuma linha
-- muda de lugar por acidente; a que não se encaixa vira categoria própria.

CREATE OR REPLACE VIEW fin_obras_pipeline_v AS
WITH parcelas AS (
  SELECT p.valor_cents,
         p.data_vencimento,
         p.status_erp,
         d.status AS doc_status
    FROM erp_contrato_parcela p
    JOIN erp_contrato c ON c.erp_id = p.erp_contrato_id
    LEFT JOIN fin_document d ON d.id = p.fin_document_id
   -- status_erp = 'ATIVO' de proposito: contratado_cents/cronograma_cents ja
   -- filtravam so ATIVO (0121). Sem este filtro aqui, as parcelas de contratos
   -- ENCERRADO/INATIVO entravam nas quatro categorias mas nao no cronograma
   -- que deveria fecha-las — a pos-condicao abaixo pegou R$ 15.300,00 de
   -- diferenca antes de isto ir para producao.
   WHERE c.eixo = 'OBRAS' AND c.status_erp = 'ATIVO'
)
SELECT
  (SELECT COALESCE(sum(valor_contratado_cents), 0) FROM erp_contrato WHERE eixo = 'OBRAS' AND status_erp = 'ATIVO') AS contratado_cents,
  (SELECT COALESCE(sum(valor_parcelas_cents), 0) FROM erp_contrato WHERE eixo = 'OBRAS' AND status_erp = 'ATIVO') AS cronograma_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status = 'liquidado'), 0) AS recebido_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status = 'emitido'), 0) AS emitido_cents,
  -- nunca_cobrado_cents agora exclui a PAGA-sem-documento (ver
  -- marcado_pago_sem_documento_cents, no fim — apendice de proposito, ver
  -- comentario da 0118 sobre CREATE OR REPLACE VIEW nao aceitar reordenar).
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status IS NULL AND status_erp <> 'PAGA'), 0) AS nunca_cobrado_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status = 'emitido' AND data_vencimento < current_date), 0) AS inadimplencia_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status IS NULL AND status_erp <> 'PAGA' AND data_vencimento < current_date), 0) AS vencido_sem_cobranca_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status IS NULL AND status_erp = 'PAGA'), 0) AS marcado_pago_sem_documento_cents
FROM parcelas;

COMMENT ON VIEW fin_obras_pipeline_v IS
  'A ponte contratado -> recebido para OBRAS. Sai de erp_contrato/erp_contrato_parcela '
  '(0045) casado com fin_document (Asaas) — nenhuma tabela nova. Quatro destinos '
  'mutuamente exclusivos: recebido (liquidado), emitido (aguardando), marcado pago no erp '
  'sem documento (raro, precisa de olhar humano) e nunca cobrado. Inadimplência é só o '
  'emitido vencido; vencido-sem-cobrança é falha de processo, não do cliente.';

DO $$
DECLARE v_soma_partes bigint; v_cronograma bigint;
BEGIN
  SELECT recebido_cents + emitido_cents + marcado_pago_sem_documento_cents + nunca_cobrado_cents,
         cronograma_cents
    INTO v_soma_partes, v_cronograma
    FROM fin_obras_pipeline_v;
  IF v_soma_partes <> v_cronograma THEN
    RAISE EXCEPTION '[0122] as quatro categorias somam % mas o cronograma e % — parcela sumiu ou dobrou',
      v_soma_partes, v_cronograma;
  END IF;
  RAISE NOTICE '[0122] fin_obras_pipeline_v: 4 categorias mutuamente exclusivas, somam R$ %',
    to_char(v_soma_partes / 100.0, 'FM999G999G999D00');
END $$;
