-- Lista do extrato do time com parcelas, status legível e chave de agrupamento.
-- A view 0105 não traz parcelas nem um status que a pessoa entenda — só o
-- vocabulário interno do financeiro.

CREATE OR REPLACE VIEW fin_time_envio_lista_v AS
SELECT
  v.origem,
  v.origem_id,
  v.code,
  v.person_id,
  v.titulo,
  v.amount_cents,
  v.data_ref,
  v.status,
  v.estado_simples,
  v.resposta,
  v.decidido_em,
  v.decidido_por,
  v.created_at,
  v.itens,
  v.itens_com_anexo,
  CASE
    WHEN v.origem IN ('custo', 'nota_entrada') THEN te.parcelas
    WHEN v.origem = 'reembolso' THEN (
      SELECT max(i.installment_total)
        FROM fin_reimbursement_item i
       WHERE i.reimbursement_id = v.origem_id
         AND i.installment_total IS NOT NULL
    )
    ELSE NULL
  END AS parcelas_total,
  CASE
    WHEN v.origem = 'reembolso' THEN (
      SELECT max(i.installment_number)
        FROM fin_reimbursement_item i
       WHERE i.reimbursement_id = v.origem_id
         AND i.installment_number IS NOT NULL
    )
    ELSE NULL
  END AS parcela_atual,
  CASE v.estado_simples
    WHEN 'concluido' THEN 'pago'
    WHEN 'recusado' THEN 'nao_pago'
    WHEN 'devolvido' THEN 'nao_pago'
    WHEN 'rascunho' THEN 'registrado'
    WHEN 'aprovado' THEN 'aguardando'
    WHEN 'aguardando' THEN
      CASE
        WHEN v.status IN ('enviado', 'em_analise', 'enviada', 'em_cotacao') THEN 'registrado'
        ELSE 'aguardando'
      END
    ELSE 'aguardando'
  END AS status_extrato,
  CASE
    WHEN v.origem = 'compra' THEN 'compra:' || v.origem_id::text
    WHEN v.origem = 'reembolso' THEN 'reembolso:' || v.origem_id::text
    WHEN v.origem IN ('custo', 'nota_entrada') AND te.purchase_request_id IS NOT NULL
      THEN 'compra:' || te.purchase_request_id::text
    WHEN v.origem IN ('custo', 'nota_entrada') AND te.parcelas IS NOT NULL
      THEN 'envio:' || v.origem_id::text
    ELSE v.origem || ':' || v.origem_id::text
  END AS grupo_chave
FROM fin_time_envios_v v
LEFT JOIN fin_time_envio te
  ON v.origem IN ('custo', 'nota_entrada') AND te.id = v.origem_id;

COMMENT ON VIEW fin_time_envio_lista_v IS
  'Extrato do time com parcelas, status_extrato (registrado/aguardando/pago/nao_pago) e grupo_chave '
  'para ligar custo realizado a pedido de compra ou parcelas do mesmo envio. Filtrar por person_id da sessão.';

DO $$
BEGIN
  IF to_regclass('fin_time_envio_lista_v') IS NULL THEN
    RAISE EXCEPTION '0155: fin_time_envio_lista_v não foi criada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fin_time_envio_lista_v'
       AND column_name = 'status_extrato'
  ) THEN
    RAISE EXCEPTION '0155: coluna status_extrato ausente em fin_time_envio_lista_v';
  END IF;
END $$;
