-- Transferência acionável deixa de se misturar com subledger e fonte ausente.
--
-- O monitor M6/M7 tratava toda linha `em_transito` como uma perna bancária que
-- deveria encontrar a contraparte em minutos. A auditoria de 16/08/2026 provou
-- quatro populações diferentes dentro das 252 linhas:
--
--   167 transferências Asaas de 2022–2025, já declaradas sem extrato destino;
--    67 aplicações/resgates RDB anteriores à cobertura das caixinhas;
--     8 pagamentos de fatura, todos ligados à respectiva fin_card_bill;
--     5 PIX para conta Caixa fora do ledger;
--     4 transferências Asaas de 2026 para conta própria não identificada;
--     1 PIX Inter para fornecedor, com CNPJ diferente do CNPJ da empresa.
--
-- Pagamento de fatura não tem uma segunda perna de caixa: ele baixa o banco e
-- liquida o subledger do cartão. O PIX para fornecedor tampouco é transferência
-- própria. Ambos voltam a `transfer_status='nao'`, mas continuam integralmente
-- no caixa e nas filas existentes. As demais linhas permanecem `em_transito`
-- e recebem um motivo verificável. Nenhum valor, categoria ou conciliação muda.

-- ---------------------------------------------------------------------------
-- 1. VOCABULÁRIO DA LACUNA
-- ---------------------------------------------------------------------------
ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_transfer_unresolved_reason_vocab;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_transfer_unresolved_reason_vocab CHECK (
    transfer_unresolved_reason IS NULL
    OR transfer_unresolved_reason = 'sem_cobertura_extrato'
    OR transfer_unresolved_reason LIKE 'sem_cobertura_extrato:%'
    OR transfer_unresolved_reason LIKE 'destino_fora_do_ledger:%'
  ) NOT VALID;

COMMENT ON COLUMN fin_transaction.transfer_unresolved_reason IS
  'Por que uma perna em_transito não pode ser pareada agora. '
  'sem_cobertura_extrato[:detalhe] = falta o outro extrato; '
  'destino_fora_do_ledger:<conta> = a fonte declarou conta que este ledger não possui. '
  'NULL significa pendência acionável, nunca ausência presumida.';

-- ---------------------------------------------------------------------------
-- 2. PRÉ-CONDIÇÕES: SE A FOTOGRAFIA MUDOU, REAUDITAR EM VEZ DE FORÇAR
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n bigint;
  v_cents bigint;
BEGIN
  SELECT count(*), COALESCE(sum(t.amount_cents), 0)
    INTO v_n, v_cents
    FROM fin_transaction t
    JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
   WHERE t.id = 76646
     AND t.source = 'inter_api'
     AND t.posted_on = DATE '2026-04-13'
     AND t.amount_cents = -15990
     AND t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL
     AND t.end_to_end_id IS NOT NULL
     AND t.counterparty_document IS NOT NULL
     AND t.counterparty_document IS DISTINCT FROM regexp_replace(e.cnpj, '[^0-9]', '', 'g')
     AND t.category_id IS NULL;
  IF (v_n, v_cents) <> (1, -15990) THEN
    RAISE EXCEPTION
      '0089: PIX fornecedor esperado 1/-15990, encontrado %/%; reaudite', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(t.amount_cents), 0)
    INTO v_n, v_cents
    FROM fin_transaction t
   WHERE t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL
     AND t.source_kind = 'FATURA_CARTAO'
     AND EXISTS (
       SELECT 1
         FROM fin_card_bill b
        WHERE b.paid_transaction_id = t.id
       GROUP BY b.paid_transaction_id
       HAVING count(*) = 1
     );
  IF (v_n, v_cents) <> (8, -6673834) THEN
    RAISE EXCEPTION
      '0089: faturas esperadas 8/-6673834, encontrado %/%; reaudite', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(t.amount_cents), 0)
    INTO v_n, v_cents
    FROM fin_transaction t
    JOIN fin_account a ON a.id = t.account_id AND a.slug = 'nubank'
   WHERE t.source = 'import_csv'
     AND t.source_kind IN ('APLICACAO_RDB', 'RESGATE_RDB')
     AND t.posted_on < DATE '2026-07-10'
     AND t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL;
  IF (v_n, v_cents) <> (67, 66150) THEN
    RAISE EXCEPTION
      '0089: RDB sem histórico esperado 67/66150, encontrado %/%; reaudite', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(t.amount_cents), 0)
    INTO v_n, v_cents
    FROM fin_transaction t
    JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
    JOIN fin_account a ON a.id = t.account_id AND a.slug = 'asaas'
   WHERE t.posted_on >= DATE '2026-01-01'
     AND t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL
     AND t.counterparty_id IS NULL
     AND t.description_norm LIKE '%xp energy servicos de medicao de energia ltda%'
     AND NOT EXISTS (
       SELECT 1
         FROM fin_transaction other
        WHERE other.account_id <> t.account_id
          AND other.amount_cents = -t.amount_cents
          AND other.posted_on BETWEEN t.posted_on - 3 AND t.posted_on + 3
     );
  IF (v_n, v_cents) <> (4, -2412000) THEN
    RAISE EXCEPTION
      '0089: Asaas sem destino esperado 4/-2412000, encontrado %/%; reaudite', v_n, v_cents;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. MUDANÇAS DE ESTADO, TODAS COM TRILHA
-- ---------------------------------------------------------------------------
WITH alvo AS (
  SELECT t.id,
         t.entity_id,
         t.transfer_status AS old_status,
         t.transfer_unresolved_reason AS old_reason,
         'nao'::text AS new_status,
         NULL::text AS new_reason,
         'cnpj_contraparte_diferente_da_empresa'::text AS evidence_code
    FROM fin_transaction t
    JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
   WHERE t.id = 76646
     AND t.source = 'inter_api'
     AND t.transfer_status = 'em_transito'
     AND t.counterparty_document IS DISTINCT FROM regexp_replace(e.cnpj, '[^0-9]', '', 'g')
), mudanca AS (
  UPDATE fin_transaction t
     SET transfer_status = a.new_status,
         transfer_unresolved_reason = a.new_reason,
         updated_at = now()
    FROM alvo a
   WHERE t.id = a.id
  RETURNING t.id, a.entity_id, a.old_status, a.old_reason,
            a.new_status, a.new_reason, a.evidence_code
)
INSERT INTO fin_audit_log
  (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT entity_id,
       'fin_transaction',
       id,
       'update',
       jsonb_build_object('transfer_status', old_status,
                          'transfer_unresolved_reason', old_reason),
       jsonb_build_object('transfer_status', new_status,
                          'transfer_unresolved_reason', new_reason,
                          'evidence_code', evidence_code),
       ARRAY['transfer_status', 'transfer_unresolved_reason']::text[],
       'migration-0089'
  FROM mudanca;

WITH alvo AS (
  SELECT t.id,
         t.entity_id,
         t.transfer_status AS old_status,
         t.transfer_unresolved_reason AS old_reason,
         'nao'::text AS new_status,
         NULL::text AS new_reason,
         b.id AS bill_id
    FROM fin_transaction t
    JOIN fin_card_bill b ON b.paid_transaction_id = t.id
   WHERE t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL
     AND t.source_kind = 'FATURA_CARTAO'
), mudanca AS (
  UPDATE fin_transaction t
     SET transfer_status = a.new_status,
         transfer_unresolved_reason = a.new_reason,
         updated_at = now()
    FROM alvo a
   WHERE t.id = a.id
  RETURNING t.id, a.entity_id, a.old_status, a.old_reason,
            a.new_status, a.new_reason, a.bill_id
)
INSERT INTO fin_audit_log
  (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT entity_id,
       'fin_transaction',
       id,
       'update',
       jsonb_build_object('transfer_status', old_status,
                          'transfer_unresolved_reason', old_reason),
       jsonb_build_object('transfer_status', new_status,
                          'transfer_unresolved_reason', new_reason,
                          'evidence_code', 'liquidacao_subledger_cartao',
                          'card_bill_id', bill_id),
       ARRAY['transfer_status', 'transfer_unresolved_reason']::text[],
       'migration-0089'
  FROM mudanca;

WITH alvo AS (
  SELECT t.id,
         t.entity_id,
         t.transfer_status AS old_status,
         t.transfer_unresolved_reason AS old_reason,
         'sem_cobertura_extrato:nubank-caixinhas-antes-2026-07-10'::text AS new_reason
    FROM fin_transaction t
    JOIN fin_account a ON a.id = t.account_id AND a.slug = 'nubank'
   WHERE t.source = 'import_csv'
     AND t.source_kind IN ('APLICACAO_RDB', 'RESGATE_RDB')
     AND t.posted_on < DATE '2026-07-10'
     AND t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL
), mudanca AS (
  UPDATE fin_transaction t
     SET transfer_unresolved_reason = a.new_reason,
         updated_at = now()
    FROM alvo a
   WHERE t.id = a.id
  RETURNING t.id, a.entity_id, a.old_status, a.old_reason, a.new_reason
)
INSERT INTO fin_audit_log
  (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT entity_id,
       'fin_transaction',
       id,
       'update',
       jsonb_build_object('transfer_status', old_status,
                          'transfer_unresolved_reason', old_reason),
       jsonb_build_object('transfer_status', old_status,
                          'transfer_unresolved_reason', new_reason,
                          'evidence_code', 'cobertura_caixinhas_inicia_2026-07-10'),
       ARRAY['transfer_unresolved_reason']::text[],
       'migration-0089'
  FROM mudanca;

WITH alvo AS (
  SELECT t.id,
         t.entity_id,
         t.transfer_status AS old_status,
         t.transfer_unresolved_reason AS old_reason,
         'sem_cobertura_extrato:conta-destino-nao-identificada'::text AS new_reason
    FROM fin_transaction t
    JOIN fin_account a ON a.id = t.account_id AND a.slug = 'asaas'
   WHERE t.posted_on >= DATE '2026-01-01'
     AND t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NULL
     AND t.description_norm LIKE '%xp energy servicos de medicao de energia ltda%'
     AND NOT EXISTS (
       SELECT 1
         FROM fin_transaction other
        WHERE other.account_id <> t.account_id
          AND other.amount_cents = -t.amount_cents
          AND other.posted_on BETWEEN t.posted_on - 3 AND t.posted_on + 3
     )
), mudanca AS (
  UPDATE fin_transaction t
     SET transfer_unresolved_reason = a.new_reason,
         updated_at = now()
    FROM alvo a
   WHERE t.id = a.id
  RETURNING t.id, a.entity_id, a.old_status, a.old_reason, a.new_reason
)
INSERT INTO fin_audit_log
  (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT entity_id,
       'fin_transaction',
       id,
       'update',
       jsonb_build_object('transfer_status', old_status,
                          'transfer_unresolved_reason', old_reason),
       jsonb_build_object('transfer_status', old_status,
                          'transfer_unresolved_reason', new_reason,
                          'evidence_code', 'cnpj_proprio_sem_perna_em_conta_coberta'),
       ARRAY['transfer_unresolved_reason']::text[],
       'migration-0089'
  FROM mudanca;

ALTER TABLE fin_transaction
  VALIDATE CONSTRAINT fin_transaction_transfer_unresolved_reason_vocab;

-- ---------------------------------------------------------------------------
-- 4. LEITURA OPERACIONAL: AÇÃO E LACUNA SÃO PERGUNTAS DIFERENTES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_transfer_monitor_v AS
SELECT count(*) FILTER (WHERE transfer_status = 'pareado')::bigint AS paired_legs,
       count(*) FILTER (WHERE transfer_status = 'anulado')::bigint AS reversed_legs,
       count(*) FILTER (
         WHERE transfer_status = 'em_transito'
           AND transfer_unresolved_reason IS NULL
       )::bigint AS actionable_legs,
       COALESCE(sum(abs(amount_cents)) FILTER (
         WHERE transfer_status = 'em_transito'
           AND transfer_unresolved_reason IS NULL
       ), 0)::bigint AS actionable_cents,
       count(*) FILTER (
         WHERE transfer_status = 'em_transito'
           AND transfer_unresolved_reason IS NOT NULL
       )::bigint AS declared_gap_legs,
       COALESCE(sum(abs(amount_cents)) FILTER (
         WHERE transfer_status = 'em_transito'
           AND transfer_unresolved_reason IS NOT NULL
       ), 0)::bigint AS declared_gap_cents,
       round(
         100.0 * count(*) FILTER (WHERE transfer_status IN ('pareado', 'anulado'))
         / NULLIF(count(*) FILTER (
             WHERE transfer_status IN ('pareado', 'anulado')
                OR (transfer_status = 'em_transito' AND transfer_unresolved_reason IS NULL)
           ), 0),
         2
       ) AS actionable_resolution_pct
  FROM fin_transaction;

COMMENT ON VIEW fin_transfer_monitor_v IS
  'M6 operacional: resolvido contra pendência ainda acionável. Pernas sem fonte '
  'ficam em declared_gap_* e nunca são convertidas em sucesso ou zero.';

CREATE OR REPLACE VIEW fin_transfer_gap_v AS
SELECT transfer_unresolved_reason AS reason,
       count(*)::bigint AS legs,
       sum(amount_cents)::bigint AS net_cents,
       sum(abs(amount_cents))::bigint AS absolute_cents,
       min(posted_on) AS from_date,
       max(posted_on) AS to_date,
       array_agg(DISTINCT account_id ORDER BY account_id) AS account_ids
  FROM fin_transaction
 WHERE transfer_status = 'em_transito'
   AND transfer_unresolved_reason IS NOT NULL
 GROUP BY transfer_unresolved_reason;

COMMENT ON VIEW fin_transfer_gap_v IS
  'Fontes ausentes que impedem pareamento. Cada linha continua no caixa; a view '
  'não neutraliza nem projeta a perna que não existe.';

-- ---------------------------------------------------------------------------
-- 5. PÓS-CONDIÇÕES E ÂNCORAS DE SEMÂNTICA
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_monitor record;
  v_n bigint;
BEGIN
  SELECT * INTO v_monitor FROM fin_transfer_monitor_v;
  IF v_monitor.paired_legs <> 368
     OR v_monitor.reversed_legs <> 8
     OR v_monitor.actionable_legs <> 0
     OR v_monitor.declared_gap_legs <> 243
     OR v_monitor.actionable_resolution_pct <> 100.00 THEN
    RAISE EXCEPTION
      '0089: estado inesperado pareadas %, anuladas %, acionáveis %, lacunas %, pct %',
      v_monitor.paired_legs, v_monitor.reversed_legs,
      v_monitor.actionable_legs, v_monitor.declared_gap_legs,
      v_monitor.actionable_resolution_pct;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_transaction t
   WHERE t.source_kind = 'FATURA_CARTAO'
     AND t.transfer_status <> 'nao';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0089: % pagamento(s) de fatura ainda simulam perna bancária', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_transaction t
    JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
   WHERE t.id = 76646
     AND (t.transfer_status <> 'nao'
       OR t.counterparty_document = regexp_replace(e.cnpj, '[^0-9]', '', 'g'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0089: PIX fornecedor continuou como transferência própria';
  END IF;
END $$;
