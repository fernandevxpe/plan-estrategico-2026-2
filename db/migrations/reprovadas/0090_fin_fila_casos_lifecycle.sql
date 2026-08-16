-- Fila de revisão como casos, evidência e ciclo de vida reproduzível.
--
-- A fotografia auditada em 16/08/2026 tinha 1.533 itens pendentes, mas:
--
--   * 350 pares documento/liquidação representavam a mesma decisão duas vezes;
--   * 398 documentos de baixa confiança já estavam confirmados pelo histórico
--     independente que o próprio importador considera suficiente (>= 90%);
--   * 16 documentos repetiam contraparte + valor de ao menos duas decisões
--     aprovadas e unânimes; 14 entradas de caixa dependiam desses documentos;
--   * três pagamentos PJBANK e um PIX de favorecido conhecido chegaram após a
--     última execução dos classificadores determinísticos.
--
-- Esta migration não escolhe categoria por nome parecido e não fecha 3.99 ou
-- 5.99 sem lastro. O histórico independente aceito aqui é deliberadamente
-- estreito: decisão humana já revisada OU regra ativa de confiança >= 80. Uma
-- classificação criada por este próprio lifecycle nunca vira prova de si
-- mesma, portanto não existe realimentação de confiança.

-- Evidência histórica é uma fotografia única. O migrador abre BEGIN antes de
-- executar o arquivo; este precisa ser o primeiro statement para que suportes
-- históricos não mudem entre seleção, locks dos alvos e revalidação.
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- A 0088 é anterior na ordem e torna a definição aplicada imutável. Recusar
-- execução avulsa sem ela é melhor que gravar classified_rule_id sem memória.
DO $$
BEGIN
  IF to_regclass('public.fin_rule_version') IS NULL
     OR to_regprocedure('fin_rule_current_version_id(bigint)') IS NULL THEN
    RAISE EXCEPTION '0090 requer a migration 0088 (versões imutáveis de fin_rule)';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 1. ESPELHO SQL TOLERANTE DO DSL, SOMENTE PARA EXPLICAR A FILA
-- --------------------------------------------------------------------------
-- O motor canônico que escreve continua sendo scripts/lib/fin-rules.mjs. Estas
-- funções fornecem uma explicação tolerante para a fotografia da fila; o teste
-- transacional compara vencedora e competidores dos 1.533 itens atuais. Elas
-- não prometem substituir o construtor de subject/fallbacks do JavaScript nem
-- são expostas como reclassificador geral. Regra/condição malformada não casa e
-- continua visível no monitor de saúde da 0088. O único uso automático de regra
-- abaixo (PJBANK) ainda exige fonte, tipo, descrição, slug, ação, confiança,
-- versão aplicada e vencedora única exatos.
CREATE OR REPLACE FUNCTION fin_review_rule_condition_matches(
  p_condition jsonb,
  p_subject jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_field text := p_condition ->> 'field';
  v_op text := p_condition ->> 'op';
  v_actual text;
  v_expected jsonb := p_condition -> 'value';
  v_scalar text;
  v_number numeric;
BEGIN
  IF v_field <> ALL (ARRAY[
    'description_norm', 'counterparty_name_norm', 'counterparty_document',
    'account_slug', 'amount_cents', 'amount_abs', 'source_kind',
    'billing_type', 'direction', 'day_of_month'
  ]) THEN
    RETURN false;
  END IF;

  v_actual := COALESCE(p_subject ->> v_field, '');
  v_scalar := CASE
    WHEN v_expected IS NULL THEN 'undefined'
    WHEN v_expected = 'null'::jsonb THEN 'null'
    WHEN jsonb_typeof(v_expected) = 'string' THEN v_expected #>> '{}'
    ELSE v_expected::text
  END;

  IF v_op = 'contains_any' THEN
    IF jsonb_typeof(v_expected) = 'array' THEN
      RETURN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_expected) x(value)
         WHERE value <> '' AND strpos(v_actual, value) > 0
      );
    END IF;
    RETURN v_scalar <> '' AND strpos(v_actual, v_scalar) > 0;

  ELSIF v_op = 'contains_all' THEN
    IF jsonb_typeof(v_expected) <> 'array' THEN
      RETURN v_scalar <> '' AND strpos(v_actual, v_scalar) > 0;
    ELSIF jsonb_array_length(v_expected) = 0 THEN
      RETURN false;
    END IF;
    RETURN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_expected) x(value)
       WHERE value = '' OR strpos(v_actual, value) = 0
    );

  ELSIF v_op = 'starts_with' THEN
    IF jsonb_typeof(v_expected) = 'array' THEN
      RETURN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_expected) x(value)
         WHERE value <> '' AND left(v_actual, length(value)) = value
      );
    END IF;
    RETURN v_scalar <> '' AND left(v_actual, length(v_scalar)) = v_scalar;

  ELSIF v_op = 'equals' THEN
    RETURN v_actual = v_scalar;

  ELSIF v_op = 'in' THEN
    IF p_subject -> v_field IS NULL OR p_subject -> v_field = 'null'::jsonb THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_expected) = 'array' THEN
      RETURN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_expected) x(value)
         WHERE value = v_actual
      );
    END IF;
    RETURN v_actual = v_scalar;

  ELSIF v_op IN ('gte', 'lte', 'between') THEN
    IF v_actual = '' OR v_actual !~ '^-?[0-9]+([.][0-9]+)?$' THEN
      RETURN false;
    END IF;
    BEGIN
      v_number := v_actual::numeric;
      IF v_op = 'gte' THEN
        RETURN v_number >= (v_expected #>> '{}')::numeric;
      ELSIF v_op = 'lte' THEN
        RETURN v_number <= (v_expected #>> '{}')::numeric;
      ELSIF jsonb_typeof(v_expected) <> 'array'
         OR jsonb_array_length(v_expected) <> 2 THEN
        RETURN false;
      END IF;
      RETURN v_number >= (v_expected ->> 0)::numeric
         AND v_number <= (v_expected ->> 1)::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN false;
    END;

  ELSIF v_op = 'regex' THEN
    BEGIN
      RETURN v_actual ~* v_scalar;
    EXCEPTION WHEN invalid_regular_expression THEN
      RETURN false;
    END;
  END IF;

  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION fin_review_rule_matches(
  p_conditions jsonb,
  p_subject jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_condition jsonb;
  v_has_all boolean := jsonb_typeof(p_conditions -> 'all') = 'array'
                       AND jsonb_array_length(p_conditions -> 'all') > 0;
  v_has_any boolean := jsonb_typeof(p_conditions -> 'any') = 'array'
                       AND jsonb_array_length(p_conditions -> 'any') > 0;
BEGIN
  IF NOT v_has_all AND NOT v_has_any THEN RETURN false; END IF;

  IF v_has_all THEN
    FOR v_condition IN SELECT value FROM jsonb_array_elements(p_conditions -> 'all') LOOP
      IF NOT fin_review_rule_condition_matches(v_condition, p_subject) THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  IF v_has_any AND NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_conditions -> 'any') x(value)
     WHERE fin_review_rule_condition_matches(value, p_subject)
  ) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_conditions -> 'none') = 'array' THEN
    FOR v_condition IN SELECT value FROM jsonb_array_elements(p_conditions -> 'none') LOOP
      IF fin_review_rule_condition_matches(v_condition, p_subject) THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  RETURN true;
END $$;

-- A construção do subject é canônica, inclusive quando a transação ainda não
-- tem fin_counterparty. São espelhos SQL das funções normalizeDescription,
-- normalizeName e classifiableText de scripts/lib/fin-normalize.mjs; o teste
-- também reconstrói cada subject diretamente em JavaScript e compara campo a
-- campo antes de avaliar qualquer regra.
CREATE OR REPLACE FUNCTION fin_review_normalize_description(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             lower(regexp_replace(
               normalize(COALESCE(p_text, ''), NFD),
               U&'[\0300-\036f]', '', 'g'
             )),
             '[^[:alnum:][:space:]]', ' ', 'g'
           ),
           '[[:space:]]+', ' ', 'g'
         ));
$$;

CREATE OR REPLACE FUNCTION fin_review_normalize_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               fin_review_normalize_description(p_text),
               '\m(ltda|me|epp|eireli|sa|s[[:space:]]+a|mei|spe|cia|ss|slu)\M',
               ' ', 'g'
             ),
             '\m(de|da|do|das|dos|e)\M', ' ', 'g'
           ),
           '[[:space:]]+', ' ', 'g'
         ));
$$;

CREATE OR REPLACE FUNCTION fin_review_classifiable_text(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_normalized text := fin_review_normalize_description(p_text);
  v_human text := substring(COALESCE(p_text, '')
                            FROM '(?is)mensagem:[[:space:]]*(.+)$');
  v_without_message text;
BEGIN
  IF v_human IS NOT NULL AND btrim(v_human) <> '' THEN
    RETURN fin_review_normalize_description(v_human);
  END IF;

  v_without_message := btrim(split_part(v_normalized, 'mensagem', 1));
  IF v_without_message LIKE 'cobranca gerada automaticamente a partir de pix recebido%'
     OR v_without_message LIKE 'cobranca gerada automaticamente%'
     OR v_without_message LIKE 'nota fiscal da fatura%' THEN
    RETURN '';
  END IF;
  RETURN v_normalized;
END $$;

CREATE VIEW fin_review_rule_subject_v AS
SELECT ri.id AS review_item_id,
       ri.entity_id,
       ri.target_table,
       ri.target_id,
       ri.amount_cents AS review_amount_cents,
       'transaction'::text AS scope,
       jsonb_build_object(
         'description_norm', COALESCE(t.description_norm, ''),
         'counterparty_name_norm', COALESCE(
           NULLIF(cp.normalized_name, ''),
           fin_review_normalize_name(t.counterparty_raw),
           ''
         ),
         'counterparty_document', COALESCE(t.counterparty_document, cp.document_number),
         'account_slug', COALESCE(a.slug, ''),
         'amount_cents', t.amount_cents,
         'amount_abs', abs(t.amount_cents),
         'source_kind', t.source_kind,
         'billing_type', NULL,
         'direction', CASE WHEN t.amount_cents >= 0 THEN 'receber' ELSE 'pagar' END,
         'day_of_month', extract(day FROM t.posted_on)::integer
       ) AS subject
  FROM fin_review_item ri
  JOIN fin_transaction t
    ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
  LEFT JOIN fin_account a ON a.id = t.account_id
 WHERE ri.status = 'pendente'
UNION ALL
SELECT ri.id,
       ri.entity_id,
       ri.target_table,
       ri.target_id,
       ri.amount_cents,
       'document'::text,
       jsonb_build_object(
         'description_norm', fin_review_classifiable_text(d.description),
         'counterparty_name_norm', COALESCE(cp.normalized_name, ''),
         -- O importador Asaas não usa documento da contraparte no estágio de
         -- texto. Preservar isso evita ativar propostas de assinatura aqui.
         'counterparty_document', NULL,
         'account_slug', COALESCE(a.slug, CASE WHEN d.source = 'asaas' THEN 'asaas' END, ''),
         'amount_cents', d.amount_cents,
         'amount_abs', abs(d.amount_cents),
         'source_kind', NULL,
         'billing_type', d.billing_type,
         'direction', d.direction,
         'day_of_month', extract(day FROM COALESCE(d.due_date, d.competence_date, d.issue_date))::integer
       )
  FROM fin_review_item ri
  JOIN fin_document d
    ON ri.target_table = 'fin_document' AND d.id = ri.target_id
  LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
  LEFT JOIN fin_account a ON a.id = d.expected_account_id
 WHERE ri.status = 'pendente';

CREATE VIEW fin_review_rule_match_v AS
SELECT s.review_item_id,
       r.id AS rule_id,
       fin_rule_current_version_id(r.id) AS rule_version_id,
       r.slug,
       r.name,
       r.priority,
       r.confidence,
       r.actions,
       row_number() OVER (
         PARTITION BY s.review_item_id ORDER BY r.priority, r.id
       ) AS match_position
  FROM fin_review_rule_subject_v s
  JOIN fin_rule r
    ON r.entity_id = s.entity_id
   AND r.status = 'ativa'
   AND r.match_scope IN ('both', s.scope)
   AND fin_review_rule_matches(r.conditions, s.subject);

CREATE VIEW fin_review_rule_result_v AS
SELECT s.review_item_id,
       winner.rule AS winner,
       COALESCE(competitors.rules, '[]'::jsonb) AS competitors
  FROM fin_review_rule_subject_v s
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
             'rule_id', m.rule_id,
             'rule_version_id', m.rule_version_id,
             'slug', m.slug,
             'name', m.name,
             'priority', m.priority,
             'confidence', m.confidence,
             'actions', m.actions
           ) AS rule
      FROM fin_review_rule_match_v m
     WHERE m.review_item_id = s.review_item_id
     ORDER BY m.match_position
     LIMIT 1
  ) winner ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'rule_id', m.rule_id,
               'rule_version_id', m.rule_version_id,
               'slug', m.slug,
               'name', m.name,
               'priority', m.priority,
               'confidence', m.confidence,
               'actions', m.actions
             ) ORDER BY m.match_position
           ) AS rules
      FROM fin_review_rule_match_v m
     WHERE m.review_item_id = s.review_item_id
       AND m.match_position BETWEEN 2 AND 6
  ) competitors ON true;

-- --------------------------------------------------------------------------
-- 2. HISTÓRICO INDEPENDENTE E CANDIDATOS CONSERVADORES
-- --------------------------------------------------------------------------
CREATE VIEW fin_review_approved_document_v AS
SELECT d.*
  FROM fin_document d
  JOIN fin_category c ON c.id = d.category_id
  LEFT JOIN fin_rule r ON r.id = d.classified_rule_id
  LEFT JOIN fin_rule_version rv
    ON (rv.id, rv.rule_id) = (d.classified_rule_version_id, d.classified_rule_id)
 WHERE d.status <> 'cancelado'
   AND d.review_status = 'ok'
   AND c.code NOT IN ('3.99', '5.99')
   AND d.counterparty_id IS NOT NULL
   AND NOT (COALESCE(d.classified_reason, '{}'::jsonb) ? 'lifecycle_0090')
   AND (
     d.classified_by = 'humano'
     OR (
       d.classified_by = 'regra'
       AND r.status = 'ativa'
       AND rv.definition ->> 'status' = 'ativa'
       AND (rv.definition ->> 'confidence')::integer >= 80
     )
   )
   AND NOT EXISTS (
     SELECT 1 FROM fin_review_item ri
      WHERE ri.target_table = 'fin_document'
        AND ri.target_id = d.id
        AND ri.status = 'pendente'
   );

CREATE VIEW fin_review_document_history_v AS
SELECT ri.id AS review_item_id,
       d.id AS document_id,
       d.counterparty_id,
       d.amount_cents,
       d.category_id AS current_category_id,
       hist.category_id AS history_category_id,
       hc.code AS history_category_code,
       hist.category_count AS history_base,
       hist.total_count AS history_total,
       hist.category_count::numeric / NULLIF(hist.total_count, 0) AS history_dominance,
       recurrence.category_id AS recurrence_category_id,
       rc.code AS recurrence_category_code,
       recurrence.base_count AS recurrence_base,
       recurrence.category_count AS recurrence_distinct_categories
  FROM fin_review_item ri
  JOIN fin_document d
    ON ri.target_table = 'fin_document' AND d.id = ri.target_id
  LEFT JOIN LATERAL (
    WITH counts AS (
      SELECT a.category_id, count(*)::integer AS n
        FROM fin_review_approved_document_v a
       WHERE a.counterparty_id = d.counterparty_id
       GROUP BY a.category_id
    ), ranked AS (
      SELECT counts.*,
             sum(n) OVER ()::integer AS total,
             row_number() OVER (ORDER BY n DESC, category_id) AS pos,
             lead(n) OVER (ORDER BY n DESC, category_id) AS second_n
        FROM counts
    )
    SELECT category_id,
           n AS category_count,
           total AS total_count
      FROM ranked
     WHERE pos = 1 AND (second_n IS NULL OR n > second_n)
  ) hist ON true
  LEFT JOIN fin_category hc ON hc.id = hist.category_id
  LEFT JOIN LATERAL (
    SELECT min(a.category_id) AS category_id,
           count(*)::integer AS base_count,
           count(DISTINCT a.category_id)::integer AS category_count
      FROM fin_review_approved_document_v a
     WHERE a.counterparty_id = d.counterparty_id
       AND a.amount_cents = d.amount_cents
  ) recurrence ON true
  LEFT JOIN fin_category rc ON rc.id = recurrence.category_id
 WHERE ri.status = 'pendente';

CREATE VIEW fin_review_lifecycle_candidate_v AS
SELECT h.*,
       ri.entity_id,
       ri.amount_cents AS review_amount_cents,
       d.classified_by,
       d.classified_rule_id,
       d.classified_rule_version_id
  FROM fin_review_document_history_v h
  JOIN fin_review_item ri ON ri.id = h.review_item_id
  JOIN fin_document d ON d.id = h.document_id
 WHERE ri.reason = 'baixa_confianca'
   AND h.current_category_id = h.history_category_id
   AND h.history_base >= 3
   AND h.history_dominance >= 0.90
   AND cardinality(d.human_locked_fields) = 0
   AND ri.assigned_to IS NULL
   AND ri.note IS NULL
   AND ri.snoozed_until IS NULL;

CREATE VIEW fin_review_recurrence_candidate_v AS
SELECT h.*,
       ri.entity_id,
       ri.amount_cents AS review_amount_cents
  FROM fin_review_document_history_v h
  JOIN fin_review_item ri ON ri.id = h.review_item_id
  JOIN fin_document d ON d.id = h.document_id
 WHERE ri.reason IN ('sem_categoria', 'texto_generico')
   AND d.category_id IS NULL
   AND h.recurrence_base >= 2
   AND h.recurrence_distinct_categories = 1
   AND h.recurrence_category_id IS NOT NULL
   AND cardinality(d.human_locked_fields) = 0
   AND ri.assigned_to IS NULL
   AND ri.note IS NULL
   AND ri.snoozed_until IS NULL;

CREATE VIEW fin_review_pjbank_candidate_v AS
SELECT ri.id AS review_item_id,
       ri.entity_id,
       t.id AS transaction_id,
       ri.amount_cents AS review_amount_cents,
       r.id AS rule_id,
       fin_rule_current_version_id(r.id) AS rule_version_id,
       c.id AS category_id,
       r.actions ->> 'nucleo' AS nucleo,
       rr.winner,
       rr.competitors
  FROM fin_review_item ri
  JOIN fin_transaction t
    ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
  JOIN fin_review_rule_result_v rr ON rr.review_item_id = ri.id
  JOIN fin_rule r
    ON r.id = (rr.winner ->> 'rule_id')::bigint
   AND r.slug = 'meios-de-pagamento'
   AND r.status = 'ativa'
   AND r.confidence >= 80
   AND r.actions ->> 'category_code' = '4.05'
  JOIN fin_category c
    ON c.entity_id = t.entity_id AND c.code = '4.05'
 WHERE ri.status = 'pendente'
   AND ri.reason = 'sem_categoria'
   AND t.source = 'inter_api'
   AND t.source_kind = 'PAGAMENTO'
   AND t.amount_cents < 0
   AND t.description_norm = 'pagamento efetuado pjbank pagamentos s a 1'
   AND jsonb_array_length(rr.competitors) = 0
   AND (t.category_id IS NULL OR EXISTS (
     SELECT 1 FROM fin_category oldc
      WHERE oldc.id = t.category_id AND oldc.code IN ('3.99', '5.99')
   ))
   AND cardinality(t.human_locked_fields) = 0
   AND ri.assigned_to IS NULL
   AND ri.note IS NULL
   AND ri.snoozed_until IS NULL;

CREATE VIEW fin_review_known_payee_candidate_v AS
WITH history AS (
  SELECT t.entity_id,
         COALESCE(t.counterparty_document, cp.document_number) AS document_number,
         t.description_norm,
         min(t.category_id) AS category_id,
         count(*)::integer AS base_count,
         count(DISTINCT t.category_id)::integer AS category_count
    FROM fin_transaction t
    LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
    JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0
     AND t.source = 'inter_api'
     AND t.source_kind = 'PIX'
     AND t.review_status = 'ok'
     AND t.classified_by = 'favorecido'
     AND c.code NOT IN ('3.99', '5.99')
     AND COALESCE(t.counterparty_document, cp.document_number) IS NOT NULL
     AND NOT (COALESCE(t.classified_reason, '{}'::jsonb) ? 'lifecycle_0090')
     AND NOT EXISTS (
       SELECT 1 FROM fin_review_item pending
        WHERE pending.target_table = 'fin_transaction'
          AND pending.target_id = t.id
          AND pending.status = 'pendente'
     )
   GROUP BY t.entity_id,
            COALESCE(t.counterparty_document, cp.document_number),
            t.description_norm
  HAVING count(*) >= 4
     AND count(DISTINCT t.category_id) = 1
)
SELECT ri.id AS review_item_id,
       ri.entity_id,
       t.id AS transaction_id,
       ri.amount_cents AS review_amount_cents,
       h.category_id,
       hc.code AS category_code,
       h.base_count
  FROM fin_review_item ri
  JOIN fin_transaction t
    ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
  JOIN history h
    ON h.entity_id = t.entity_id
   AND h.document_number = COALESCE(t.counterparty_document, cp.document_number)
   AND h.description_norm = t.description_norm
  JOIN fin_category hc ON hc.id = h.category_id
 WHERE ri.status = 'pendente'
   AND ri.reason = 'sem_categoria'
   AND t.source = 'inter_api'
   AND t.source_kind = 'PIX'
   AND t.amount_cents < 0
   AND (t.category_id IS NULL OR EXISTS (
     SELECT 1 FROM fin_category oldc
      WHERE oldc.id = t.category_id AND oldc.code IN ('3.99', '5.99')
   ))
   AND cardinality(t.human_locked_fields) = 0
   AND ri.assigned_to IS NULL
   AND ri.note IS NULL
   AND ri.snoozed_until IS NULL;

-- Documento real liquidado vence o placeholder da entrada de caixa. Para um
-- documento ainda candidato por recorrência usa-se a categoria PROPOSTA, sem
-- precisar gravá-lo antes. Em N:N só há herança quando todos os documentos
-- ligados que oferecem evidência concordam na mesma categoria.
CREATE VIEW fin_review_settlement_inheritance_candidate_v AS
WITH evidence AS (
  SELECT s.transaction_id,
         rec.document_id,
         rec.recurrence_category_id AS category_id,
         d.nucleo
    FROM fin_review_recurrence_candidate_v rec
    JOIN fin_document d ON d.id = rec.document_id
    JOIN fin_settlement s ON s.document_id = rec.document_id
  UNION
  SELECT s.transaction_id,
         d.id,
         d.category_id,
         d.nucleo
    FROM fin_settlement s
    JOIN fin_document d ON d.id = s.document_id
    JOIN fin_category c ON c.id = d.category_id
   WHERE d.review_status = 'ok'
     AND c.code NOT IN ('3.99', '5.99')
), settlement_totals AS (
  SELECT transaction_id,
         count(DISTINCT document_id)::integer AS total_documents,
         sum(abs(amount_cents))::bigint AS allocated_cents,
         count(DISTINCT kind)::integer AS distinct_kinds,
         min(kind) AS settlement_kind
    FROM fin_settlement
   GROUP BY transaction_id
), unanimous AS (
  SELECT e.transaction_id,
         min(e.category_id) AS category_id,
         min(e.nucleo) AS nucleo,
         array_agg(DISTINCT e.document_id ORDER BY e.document_id) AS document_ids,
         count(DISTINCT e.category_id)::integer AS distinct_categories,
         count(DISTINCT e.document_id)::integer AS covered_documents,
         st.total_documents,
         st.allocated_cents,
         st.distinct_kinds,
         st.settlement_kind
    FROM evidence e
    JOIN settlement_totals st ON st.transaction_id = e.transaction_id
   GROUP BY e.transaction_id, st.total_documents, st.allocated_cents,
            st.distinct_kinds, st.settlement_kind
  HAVING count(DISTINCT e.document_id) = st.total_documents
)
SELECT ri.id AS review_item_id,
       ri.entity_id,
       t.id AS transaction_id,
       ri.amount_cents AS review_amount_cents,
       u.document_ids,
       u.category_id,
       u.nucleo
  FROM fin_review_item ri
  JOIN fin_transaction t
    ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
  JOIN unanimous u ON u.transaction_id = t.id AND u.distinct_categories = 1
 WHERE ri.status = 'pendente'
   AND ri.reason = 'sem_categoria'
   AND u.allocated_cents = abs(t.amount_cents)
   AND u.distinct_kinds = 1
   AND u.settlement_kind = 'liquidacao'
   AND (t.category_id IS NULL OR EXISTS (
     SELECT 1 FROM fin_category oldc
      WHERE oldc.id = t.category_id AND oldc.code IN ('3.99', '5.99')
   ))
   AND cardinality(t.human_locked_fields) = 0
   AND ri.assigned_to IS NULL
   AND ri.note IS NULL
   AND ri.snoozed_until IS NULL;

-- --------------------------------------------------------------------------
-- 3. EVIDÊNCIA E SUGESTÃO ESTRUTURADAS
-- --------------------------------------------------------------------------
CREATE VIEW fin_review_evidence_v AS
SELECT ri.id AS review_item_id,
       ri.entity_id,
       ri.target_table,
       ri.target_id,
       ri.reason,
       ri.amount_cents,
       CASE
         WHEN lc.review_item_id IS NOT NULL THEN 'lifecycle'
         WHEN rec.review_item_id IS NOT NULL
           OR pj.review_item_id IS NOT NULL
           OR payee.review_item_id IS NOT NULL
           OR inh.review_item_id IS NOT NULL THEN 'deterministico'
         WHEN dep.dependency_code IS NOT NULL THEN 'fonte_externa'
         ELSE 'humano'
       END AS resolution_kind,
       dep.dependency_code AS external_dependency,
       jsonb_strip_nulls(jsonb_build_object(
         'schema', 'fin_review_suggestion/v1',
         'resolution_kind', CASE
           WHEN lc.review_item_id IS NOT NULL THEN 'lifecycle'
           WHEN rec.review_item_id IS NOT NULL
             OR pj.review_item_id IS NOT NULL
             OR payee.review_item_id IS NOT NULL
             OR inh.review_item_id IS NOT NULL THEN 'deterministico'
           WHEN dep.dependency_code IS NOT NULL THEN 'fonte_externa'
           ELSE 'humano'
         END,
         'rule_winner', rr.winner,
         'rule_competitors', COALESCE(rr.competitors, '[]'::jsonb),
         'history', CASE WHEN dh.review_item_id IS NULL THEN NULL ELSE
           jsonb_strip_nulls(jsonb_build_object(
             'category_code', dh.history_category_code,
             'base', dh.history_base,
             'total', dh.history_total,
             'dominance', round(dh.history_dominance, 4)
           )) END,
         'recurrence', CASE WHEN dh.review_item_id IS NULL THEN NULL ELSE
           jsonb_strip_nulls(jsonb_build_object(
             'key', 'counterparty_id+amount_cents',
             'category_code', dh.recurrence_category_code,
             'base', dh.recurrence_base,
             'distinct_categories', dh.recurrence_distinct_categories
           )) END,
         'settlement_document_ids', inh.document_ids,
         'known_payee_history', CASE WHEN payee.review_item_id IS NULL THEN NULL ELSE
           jsonb_build_object('category_code', payee.category_code, 'base', payee.base_count)
         END,
         'external_dependency', dep.dependency_code,
         'indeterminate_reason', dep.indeterminate_reason
       )) AS suggestion
  FROM fin_review_item ri
  LEFT JOIN fin_review_rule_result_v rr ON rr.review_item_id = ri.id
  LEFT JOIN fin_review_document_history_v dh ON dh.review_item_id = ri.id
  LEFT JOIN fin_review_lifecycle_candidate_v lc ON lc.review_item_id = ri.id
  LEFT JOIN fin_review_recurrence_candidate_v rec ON rec.review_item_id = ri.id
  LEFT JOIN fin_review_pjbank_candidate_v pj ON pj.review_item_id = ri.id
  LEFT JOIN fin_review_known_payee_candidate_v payee ON payee.review_item_id = ri.id
  LEFT JOIN fin_review_settlement_inheritance_candidate_v inh ON inh.review_item_id = ri.id
  LEFT JOIN fin_transaction t
    ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
  LEFT JOIN fin_document d
    ON ri.target_table = 'fin_document' AND d.id = ri.target_id
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN t.id IS NOT NULL
              AND t.source = 'inter_api'
              AND t.source_kind = 'PAGAMENTO'
              AND t.description_norm LIKE '%fatura%'
               THEN 'cartao_inter_itemizacao_ausente'
             WHEN t.id IS NOT NULL
              AND t.source = 'asaas'
              AND t.source_kind = 'TRANSFER'
              AND t.description_norm IN (
                'transferencia para conta bancaria', 'pix com chave',
                'transacao via pix com chave'
              )
               THEN 'asaas_transferencia_beneficiario_ausente'
             WHEN d.id IS NOT NULL AND d.counterparty_id IS NULL
               THEN 'asaas_contraparte_ausente'
             WHEN d.id IS NOT NULL AND ri.reason = 'texto_generico'
              AND rec.review_item_id IS NULL
               THEN 'contrato_projeto_servico_ausente'
             WHEN tag.indeterminate_reason = 'indeterminado:sem-lastro-nem-contraparte'
               THEN 'lastro_contraparte_ausente'
           END AS dependency_code,
           tag.indeterminate_reason
      FROM (
        SELECT (
          SELECT x
            FROM unnest(COALESCE(t.tags, ARRAY[]::text[])) x
           WHERE x LIKE 'indeterminado:%'
           ORDER BY x
           LIMIT 1
        ) AS indeterminate_reason
      ) tag
  ) dep ON true
 WHERE ri.status = 'pendente';

CREATE OR REPLACE FUNCTION fin_review_refresh_suggestions()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_n bigint;
BEGIN
  WITH desired AS (
    SELECT ri.id,
           COALESCE((
             SELECT jsonb_agg(item ORDER BY ordinal)
               FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(ri.suggested) = 'array'
                      THEN ri.suggested ELSE '[]'::jsonb END
               ) WITH ORDINALITY existing(item, ordinal)
              WHERE item ->> 'schema' IS DISTINCT FROM 'fin_review_suggestion/v1'
           ), '[]'::jsonb) || jsonb_build_array(e.suggestion) AS suggestion
      FROM fin_review_item ri
      JOIN fin_review_evidence_v e ON e.review_item_id = ri.id
     WHERE ri.status = 'pendente'
  ), changed AS (
    UPDATE fin_review_item ri
       SET suggested = desired.suggestion
      FROM desired
     WHERE ri.id = desired.id
       AND ri.status = 'pendente'
       AND ri.suggested IS DISTINCT FROM desired.suggestion
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM changed;
  RETURN v_n;
END $$;

-- --------------------------------------------------------------------------
-- 4. CASO = DECISÃO; ITEM BRUTO CONTINUA AUDITÁVEL
-- --------------------------------------------------------------------------
CREATE VIEW fin_review_case_v AS
WITH RECURSIVE pending AS (
  SELECT ri.*,
         ri.target_table || ':' || ri.target_id AS node_key,
         t.posted_on AS transaction_date,
         COALESCE(d.competence_date, d.due_date, d.issue_date) AS document_date,
         t.source AS transaction_source,
         d.source AS document_source,
         COALESCE(t.category_id, d.category_id) AS current_category_id
    FROM fin_review_item ri
    LEFT JOIN fin_transaction t
      ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
    LEFT JOIN fin_document d
      ON ri.target_table = 'fin_document' AND d.id = ri.target_id
   WHERE ri.status = 'pendente'
), edges AS (
  SELECT pd.node_key AS document_node,
         pt.node_key AS transaction_node,
         s.id AS settlement_id,
         abs(s.amount_cents)::bigint AS settlement_exposure_cents
    FROM fin_settlement s
    JOIN pending pd
      ON pd.target_table = 'fin_document' AND pd.target_id = s.document_id
    JOIN pending pt
      ON pt.target_table = 'fin_transaction' AND pt.target_id = s.transaction_id
), reach(seed, node) AS (
  SELECT node_key, node_key FROM pending
  UNION
  SELECT r.seed,
         CASE WHEN e.document_node = r.node
              THEN e.transaction_node ELSE e.document_node END
    FROM reach r
    JOIN edges e
      ON e.document_node = r.node OR e.transaction_node = r.node
), components AS (
  SELECT node, min(seed) AS component_anchor
    FROM reach
   GROUP BY node
), settlement_overlap AS (
  -- Somente a parcela de settlement entre dois itens ainda pendentes é
  -- duplicada na fila. Cobertura parcial não autoriza eliminar o maior lado.
  SELECT c.component_anchor,
         sum(e.settlement_exposure_cents)::bigint AS settlement_overlap_cents
    FROM edges e
    JOIN components c ON c.node = e.document_node
   GROUP BY c.component_anchor
), mapped AS (
  SELECT p.*,
         c.component_anchor,
         COALESCE(p.document_date, p.transaction_date) AS target_date,
         e.resolution_kind,
         e.external_dependency,
         e.suggestion
    FROM pending p
    JOIN components c ON c.node = p.node_key
    JOIN fin_review_evidence_v e ON e.review_item_id = p.id
), grouped AS (
  SELECT component_anchor,
         CASE
           WHEN min(target_id) FILTER (WHERE target_table = 'fin_document') IS NOT NULL
             THEN 'document:' || (
               min(target_id) FILTER (WHERE target_table = 'fin_document')
             )::text
           ELSE 'transaction:' || (
             min(target_id) FILTER (WHERE target_table = 'fin_transaction')
           )::text
         END AS case_id,
         min(entity_id) AS entity_id,
         array_agg(id ORDER BY id) AS review_item_ids,
         array_agg(target_id ORDER BY target_id)
           FILTER (WHERE target_table = 'fin_document') AS document_ids,
         array_agg(target_id ORDER BY target_id)
           FILTER (WHERE target_table = 'fin_transaction') AS transaction_ids,
         array_agg(DISTINCT target_table ORDER BY target_table) AS target_tables,
         array_agg(DISTINCT reason ORDER BY reason) AS reasons,
         array_remove(array_agg(DISTINCT COALESCE(transaction_source, document_source)
                                ORDER BY COALESCE(transaction_source, document_source)), NULL) AS sources,
         array_remove(array_agg(DISTINCT current_category_id ORDER BY current_category_id), NULL)
           AS category_ids,
         count(*) FILTER (WHERE current_category_id IS NULL)::integer AS unclassified_items,
         count(*) FILTER (WHERE current_category_id IS NOT NULL)::integer AS classified_items,
         count(*)::integer AS raw_item_count,
         sum(abs(amount_cents))::bigint AS raw_exposure_cents,
         COALESCE(sum(abs(amount_cents))
           FILTER (WHERE target_table = 'fin_document'), 0)::bigint
           AS document_exposure_cents,
         COALESCE(sum(abs(amount_cents))
           FILTER (WHERE target_table = 'fin_transaction'), 0)::bigint
           AS transaction_exposure_cents,
         min(target_date) AS period_start,
         max(target_date) AS period_end,
         array_agg(DISTINCT extract(year FROM target_date)::integer
                   ORDER BY extract(year FROM target_date)::integer) AS years,
         CASE
           WHEN bool_or(resolution_kind = 'fonte_externa') THEN 'fonte_externa'
           WHEN bool_or(resolution_kind = 'deterministico') THEN 'deterministico'
           WHEN bool_or(resolution_kind = 'lifecycle') THEN 'lifecycle'
           ELSE 'humano'
         END AS resolution_kind,
         array_remove(array_agg(DISTINCT external_dependency), NULL) AS external_dependencies,
         jsonb_agg(suggestion ORDER BY id) AS suggestions
    FROM mapped
   GROUP BY component_anchor
), measured AS (
  SELECT grouped.*,
         COALESCE(o.settlement_overlap_cents, 0)::bigint
           AS settlement_overlap_cents,
         LEAST(
           grouped.document_exposure_cents,
           grouped.transaction_exposure_cents,
           COALESCE(o.settlement_overlap_cents, 0)
         )::bigint AS duplicated_exposure_cents,
         (
           grouped.raw_exposure_cents - LEAST(
             grouped.document_exposure_cents,
             grouped.transaction_exposure_cents,
             COALESCE(o.settlement_overlap_cents, 0)
           )
         )::bigint AS case_exposure_cents
    FROM grouped
    LEFT JOIN settlement_overlap o USING (component_anchor)
)
SELECT measured.*,
       CASE
         WHEN extract(year FROM period_start) > extract(year FROM current_date)
           THEN 'futuro'
         WHEN extract(year FROM period_end) < extract(year FROM current_date)
           THEN 'legado'
         ELSE 'corrente'
       END AS period_partition
  FROM measured;

CREATE VIEW fin_review_case_summary_v AS
SELECT period_partition,
       resolution_kind,
       count(*)::integer AS cases,
       sum(raw_item_count)::bigint AS raw_items,
       sum(raw_exposure_cents)::bigint AS raw_exposure_cents,
       sum(case_exposure_cents)::bigint AS case_exposure_cents,
       sum(duplicated_exposure_cents)::bigint AS duplicated_exposure_cents
  FROM fin_review_case_v
 GROUP BY period_partition, resolution_kind;

COMMENT ON VIEW fin_review_case_v IS
  'Uma decisão de classificação. Documento e transação liquidadora pendentes ficam no mesmo '
  'case_id; raw_item_count/raw_exposure preservam M4 bruto e case_exposure remove a dupla '
  'contagem sem apagar nenhum fin_review_item.';

-- --------------------------------------------------------------------------
-- 5. APLICAÇÃO REENTRANTE, AUDITADA E SEM REALIMENTAÇÃO
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_review_lifecycle_apply(
  p_actor text DEFAULT 'fin-review-lifecycle'
) RETURNS TABLE (
  lifecycle_documents integer,
  recurrence_documents integer,
  inherited_transactions integer,
  pjbank_transactions integer,
  known_payee_transactions integer,
  resolved_items integer,
  category_changes integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx_count_before bigint;
  v_tx_cents_before bigint;
  v_doc_count_before bigint;
  v_doc_cents_before bigint;
  v_settlement_count_before bigint;
  v_settlement_cents_before bigint;
  v_account_anchor_before jsonb;
  v_tx_count_after bigint;
  v_tx_cents_after bigint;
  v_doc_count_after bigint;
  v_doc_cents_after bigint;
  v_settlement_count_after bigint;
  v_settlement_cents_after bigint;
  v_account_anchor_after jsonb;
  v_lifecycle integer := 0;
  v_recurrence integer := 0;
  v_inherited integer := 0;
  v_pjbank integer := 0;
  v_known_payee integer := 0;
  v_resolved integer := 0;
  v_category_changes integer := 0;
  v_suggestions_refreshed bigint := 0;
  v_category_delta jsonb := '[]'::jsonb;
  v_dre_delta jsonb := '[]'::jsonb;
BEGIN
  IF current_setting('transaction_isolation')
       NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION
      'fin_review_lifecycle_apply requer REPEATABLE READ ou SERIALIZABLE (atual: %)',
      current_setting('transaction_isolation');
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'fin_review_lifecycle_apply exige ator nao vazio';
  END IF;
  IF COALESCE(current_setting('fin.review_lifecycle_running', true), 'off') = 'on' THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0;
    RETURN;
  END IF;
  PERFORM set_config('fin.review_lifecycle_running', 'on', true);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('fin_review:lifecycle:v1', 9004)
  );

  -- O lifecycle é deliberadamente uma etapa global, executada uma vez depois
  -- de cada lote. REPEATABLE READ dá uma fotografia coerente, mas sozinho não
  -- impede que uma decisão humana/importador altere um suporte histórico e
  -- commite enquanto esta transação ainda classifica pelo snapshot antigo.
  -- SHARE ROW EXCLUSIVE permite leituras da UI, bloqueia writers concorrentes e
  -- continua permitindo as escritas desta própria transação. A ordem é fixa e
  -- o CLI aplica lock_timeout, portanto espera excessiva falha sem travar sync.
  LOCK TABLE fin_account,
             fin_category,
             fin_counterparty,
             fin_document,
             fin_transaction,
             fin_settlement,
             fin_review_item,
             fin_rule,
             fin_rule_version
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*), COALESCE(sum(amount_cents), 0)
    INTO v_tx_count_before, v_tx_cents_before FROM fin_transaction;
  SELECT count(*), COALESCE(sum(amount_cents), 0)
    INTO v_doc_count_before, v_doc_cents_before FROM fin_document;
  SELECT count(*), COALESCE(sum(amount_cents), 0)
    INTO v_settlement_count_before, v_settlement_cents_before FROM fin_settlement;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.account_id), '[]'::jsonb)
    INTO v_account_anchor_before
    FROM (
      SELECT a.id AS account_id,
             a.opening_balance_cents,
             a.current_balance_cents,
             count(t.id) AS ledger_rows,
             COALESCE(sum(t.amount_cents), 0) AS ledger_cents
        FROM fin_account a
        LEFT JOIN fin_transaction t ON t.account_id = a.id
       GROUP BY a.id, a.opening_balance_cents, a.current_balance_cents
    ) x;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.fin_review_lifecycle_target (
    target_table text NOT NULL,
    target_id bigint NOT NULL,
    review_item_id bigint NOT NULL,
    entity_id bigint NOT NULL,
    old_amount_cents bigint NOT NULL,
    resolution_kind text NOT NULL,
    old_category_id bigint,
    new_category_id bigint,
    old_nucleo text,
    new_nucleo text,
    old_review_status text NOT NULL,
    old_classified_by text,
    new_classified_by text,
    old_rule_id bigint,
    new_rule_id bigint,
    old_rule_version_id bigint,
    new_rule_version_id bigint,
    old_queue_status text NOT NULL,
    old_queue_suggested jsonb NOT NULL,
    old_queue_resolved_at timestamptz,
    old_queue_resolved_by text,
    evidence jsonb NOT NULL,
    suggestion jsonb NOT NULL,
    confidence smallint,
    PRIMARY KEY (target_table, target_id),
    UNIQUE (review_item_id)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.fin_review_lifecycle_target;

  INSERT INTO pg_temp.fin_review_lifecycle_target
  SELECT 'fin_document', d.id, c.review_item_id, c.entity_id, d.amount_cents, 'lifecycle',
         d.category_id, d.category_id, d.nucleo, d.nucleo,
         d.review_status, d.classified_by, d.classified_by,
         d.classified_rule_id, d.classified_rule_id,
         d.classified_rule_version_id, d.classified_rule_version_id,
         ri.status, ri.suggested, ri.resolved_at, ri.resolved_by,
         jsonb_build_object(
           'evidence_code', 'approved_counterparty_history_confirmed',
           'category_code', c.history_category_code,
           'base', c.history_base,
           'total', c.history_total,
           'dominance', round(c.history_dominance, 4)
         ),
         jsonb_build_array(jsonb_build_object(
           'schema', 'fin_review_suggestion/v1',
           'resolution_kind', 'lifecycle',
           'history', jsonb_build_object(
             'category_code', c.history_category_code,
             'base', c.history_base,
             'total', c.history_total,
             'dominance', round(c.history_dominance, 4)
           )
         )),
         LEAST(100, floor(c.history_dominance * 100))::smallint
    FROM fin_review_lifecycle_candidate_v c
    JOIN fin_document d ON d.id = c.document_id
    JOIN fin_review_item ri ON ri.id = c.review_item_id;
  GET DIAGNOSTICS v_lifecycle = ROW_COUNT;

  INSERT INTO pg_temp.fin_review_lifecycle_target
  SELECT 'fin_document', d.id, c.review_item_id, c.entity_id, d.amount_cents, 'deterministico',
         d.category_id, c.recurrence_category_id, d.nucleo, d.nucleo,
         d.review_status, d.classified_by, 'historico',
         d.classified_rule_id, NULL, d.classified_rule_version_id, NULL::bigint,
         ri.status, ri.suggested, ri.resolved_at, ri.resolved_by,
         jsonb_build_object(
           'evidence_code', 'counterparty_amount_recurrence',
           'category_code', c.recurrence_category_code,
           'key', 'counterparty_id+amount_cents',
           'base', c.recurrence_base,
           'distinct_categories', c.recurrence_distinct_categories
         ),
         jsonb_build_array(jsonb_build_object(
           'schema', 'fin_review_suggestion/v1',
           'resolution_kind', 'deterministico',
           'recurrence', jsonb_build_object(
             'key', 'counterparty_id+amount_cents',
             'category_code', c.recurrence_category_code,
             'base', c.recurrence_base,
             'distinct_categories', c.recurrence_distinct_categories
           )
         )),
         95::smallint
    FROM fin_review_recurrence_candidate_v c
    JOIN fin_document d ON d.id = c.document_id
    JOIN fin_review_item ri ON ri.id = c.review_item_id;
  GET DIAGNOSTICS v_recurrence = ROW_COUNT;

  INSERT INTO pg_temp.fin_review_lifecycle_target
  SELECT 'fin_transaction', t.id, c.review_item_id, c.entity_id, t.amount_cents, 'deterministico',
         t.category_id, c.category_id, t.nucleo, c.nucleo,
         t.review_status, t.classified_by, 'regra',
         t.classified_rule_id, c.rule_id, t.classified_rule_version_id, c.rule_version_id,
         ri.status, ri.suggested, ri.resolved_at, ri.resolved_by,
         jsonb_build_object(
           'evidence_code', 'active_rule_unique_winner',
           'rule', c.winner,
           'competitors', c.competitors
         ),
         jsonb_build_array(jsonb_build_object(
           'schema', 'fin_review_suggestion/v1',
           'resolution_kind', 'deterministico',
           'rule_winner', c.winner,
           'rule_competitors', c.competitors
         )),
         90::smallint
    FROM fin_review_pjbank_candidate_v c
    JOIN fin_transaction t ON t.id = c.transaction_id
    JOIN fin_review_item ri ON ri.id = c.review_item_id;
  GET DIAGNOSTICS v_pjbank = ROW_COUNT;

  INSERT INTO pg_temp.fin_review_lifecycle_target
  SELECT 'fin_transaction', t.id, c.review_item_id, c.entity_id, t.amount_cents, 'deterministico',
         t.category_id, c.category_id, t.nucleo, t.nucleo,
         t.review_status, t.classified_by, 'favorecido',
         t.classified_rule_id, NULL, t.classified_rule_version_id, NULL::bigint,
         ri.status, ri.suggested, ri.resolved_at, ri.resolved_by,
         jsonb_build_object(
           'evidence_code', 'known_payee_independent_history',
           'category_code', c.category_code,
           'base', c.base_count
         ),
         jsonb_build_array(jsonb_build_object(
           'schema', 'fin_review_suggestion/v1',
           'resolution_kind', 'deterministico',
           'known_payee_history', jsonb_build_object(
             'category_code', c.category_code,
             'base', c.base_count
           )
         )),
         100::smallint
    FROM fin_review_known_payee_candidate_v c
    JOIN fin_transaction t ON t.id = c.transaction_id
    JOIN fin_review_item ri ON ri.id = c.review_item_id;
  GET DIAGNOSTICS v_known_payee = ROW_COUNT;

  -- A herança usa tanto documento já aprovado quanto a categoria PROPOSTA da
  -- recorrência, portanto todos os 432 alvos existem antes da primeira escrita.
  INSERT INTO pg_temp.fin_review_lifecycle_target
  SELECT 'fin_transaction', t.id, c.review_item_id, c.entity_id, t.amount_cents,
         'deterministico',
         t.category_id, c.category_id, t.nucleo, t.nucleo,
         t.review_status, t.classified_by, 'contrato',
         t.classified_rule_id, NULL, t.classified_rule_version_id, NULL::bigint,
         ri.status, ri.suggested, ri.resolved_at, ri.resolved_by,
         jsonb_build_object(
           'evidence_code', 'settlement_inherits_document_category',
           'document_ids', c.document_ids,
           'category_code', cat.code
         ),
         jsonb_build_array(jsonb_build_object(
           'schema', 'fin_review_suggestion/v1',
           'resolution_kind', 'deterministico',
           'settlement', jsonb_build_object(
             'document_ids', c.document_ids,
             'category_code', cat.code
           )
         )),
         100::smallint
    FROM fin_review_settlement_inheritance_candidate_v c
    JOIN fin_transaction t ON t.id = c.transaction_id
    JOIN fin_category cat ON cat.id = c.category_id
    JOIN fin_review_item ri ON ri.id = c.review_item_id
  ON CONFLICT (target_table, target_id) DO NOTHING;
  GET DIAGNOSTICS v_inherited = ROW_COUNT;

  -- Ordem única de locks: documentos (inclusive lastro), lançamentos,
  -- settlements, itens de fila e regras.
  -- Nenhum fato é escrito antes de TODOS os alvos (inclusive settlement)
  -- estarem fixados. Depois da espera, cada campo relevante é relido.
  PERFORM d.id
    FROM fin_document d
    JOIN (
      SELECT x.target_id AS document_id
        FROM pg_temp.fin_review_lifecycle_target x
       WHERE x.target_table = 'fin_document'
      UNION
      SELECT value::bigint
        FROM pg_temp.fin_review_lifecycle_target x
        CROSS JOIN LATERAL jsonb_array_elements_text(
          COALESCE(x.evidence -> 'document_ids', '[]'::jsonb)
        ) ids(value)
       WHERE x.evidence ->> 'evidence_code' = 'settlement_inherits_document_category'
    ) locks ON locks.document_id = d.id
   ORDER BY d.id
   FOR UPDATE OF d;

  PERFORM t.id
    FROM fin_transaction t
    JOIN pg_temp.fin_review_lifecycle_target x
      ON x.target_table = 'fin_transaction' AND x.target_id = t.id
   ORDER BY t.id
   FOR UPDATE OF t;

  PERFORM s.id
    FROM fin_settlement s
    JOIN pg_temp.fin_review_lifecycle_target x
      ON x.target_table = 'fin_transaction'
     AND x.target_id = s.transaction_id
     AND x.evidence ->> 'evidence_code' = 'settlement_inherits_document_category'
   ORDER BY s.id
   FOR UPDATE OF s;

  PERFORM ri.id
    FROM fin_review_item ri
    JOIN pg_temp.fin_review_lifecycle_target x ON x.review_item_id = ri.id
   ORDER BY ri.id
   FOR UPDATE OF ri;

  PERFORM r.id
    FROM fin_rule r
    JOIN pg_temp.fin_review_lifecycle_target x ON x.new_rule_id = r.id
   ORDER BY r.id
   FOR SHARE OF r;

  IF EXISTS (
    SELECT 1
      FROM pg_temp.fin_review_lifecycle_target x
      LEFT JOIN fin_review_item ri ON ri.id = x.review_item_id
     WHERE ri.id IS NULL
        OR ri.entity_id IS DISTINCT FROM x.entity_id
        OR ri.target_table IS DISTINCT FROM x.target_table
        OR ri.target_id IS DISTINCT FROM x.target_id
        OR ri.amount_cents IS DISTINCT FROM x.old_amount_cents
        OR ri.status IS DISTINCT FROM x.old_queue_status
        OR ri.suggested IS DISTINCT FROM x.old_queue_suggested
        OR ri.resolved_at IS DISTINCT FROM x.old_queue_resolved_at
        OR ri.resolved_by IS DISTINCT FROM x.old_queue_resolved_by
        OR ri.assigned_to IS NOT NULL
        OR ri.note IS NOT NULL
        OR ri.snoozed_until IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'fila mudou durante a seleção do lifecycle; tente novamente';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_temp.fin_review_lifecycle_target x
      LEFT JOIN fin_document d
        ON x.target_table = 'fin_document' AND d.id = x.target_id
      LEFT JOIN fin_transaction t
        ON x.target_table = 'fin_transaction' AND t.id = x.target_id
     WHERE (
       x.target_table = 'fin_document'
       AND (
         d.id IS NULL
         OR d.entity_id IS DISTINCT FROM x.entity_id
         OR d.amount_cents IS DISTINCT FROM x.old_amount_cents
         OR d.category_id IS DISTINCT FROM x.old_category_id
         OR d.nucleo IS DISTINCT FROM x.old_nucleo
         OR d.review_status IS DISTINCT FROM x.old_review_status
         OR d.classified_by IS DISTINCT FROM x.old_classified_by
         OR d.classified_rule_id IS DISTINCT FROM x.old_rule_id
         OR d.classified_rule_version_id IS DISTINCT FROM x.old_rule_version_id
         OR cardinality(d.human_locked_fields) <> 0
       )
     ) OR (
       x.target_table = 'fin_transaction'
       AND (
         t.id IS NULL
         OR t.entity_id IS DISTINCT FROM x.entity_id
         OR t.amount_cents IS DISTINCT FROM x.old_amount_cents
         OR t.category_id IS DISTINCT FROM x.old_category_id
         OR t.nucleo IS DISTINCT FROM x.old_nucleo
         OR t.review_status IS DISTINCT FROM x.old_review_status
         OR t.classified_by IS DISTINCT FROM x.old_classified_by
         OR t.classified_rule_id IS DISTINCT FROM x.old_rule_id
         OR t.classified_rule_version_id IS DISTINCT FROM x.old_rule_version_id
         OR cardinality(t.human_locked_fields) <> 0
       )
     )
  ) THEN
    RAISE EXCEPTION 'fato financeiro mudou durante a seleção do lifecycle; tente novamente';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_temp.fin_review_lifecycle_target x
     WHERE NOT (
       (x.evidence ->> 'evidence_code' = 'approved_counterparty_history_confirmed'
        AND EXISTS (SELECT 1 FROM fin_review_lifecycle_candidate_v c
                     WHERE c.review_item_id = x.review_item_id))
       OR
       (x.evidence ->> 'evidence_code' = 'counterparty_amount_recurrence'
        AND EXISTS (SELECT 1 FROM fin_review_recurrence_candidate_v c
                     WHERE c.review_item_id = x.review_item_id
                       AND c.recurrence_category_id = x.new_category_id))
       OR
       (x.evidence ->> 'evidence_code' = 'active_rule_unique_winner'
        AND EXISTS (SELECT 1 FROM fin_review_pjbank_candidate_v c
                     WHERE c.review_item_id = x.review_item_id
                       AND c.rule_id = x.new_rule_id
                       AND c.rule_version_id = x.new_rule_version_id
                       AND c.category_id = x.new_category_id))
       OR
       (x.evidence ->> 'evidence_code' = 'known_payee_independent_history'
        AND EXISTS (SELECT 1 FROM fin_review_known_payee_candidate_v c
                     WHERE c.review_item_id = x.review_item_id
                       AND c.category_id = x.new_category_id))
       OR
       (x.evidence ->> 'evidence_code' = 'settlement_inherits_document_category'
        AND EXISTS (SELECT 1 FROM fin_review_settlement_inheritance_candidate_v c
                     WHERE c.review_item_id = x.review_item_id
                       AND c.category_id = x.new_category_id
                       AND to_jsonb(c.document_ids) = x.evidence -> 'document_ids'))
     )
  ) THEN
    RAISE EXCEPTION 'evidência determinística mudou durante a seleção; tente novamente';
  END IF;

  -- Com fila, fatos e evidência revalidados, as escritas começam.
  UPDATE fin_document d
     SET classified_reason = COALESCE(d.classified_reason, '{}'::jsonb)
                             || jsonb_build_object('lifecycle_0090', x.evidence),
         review_status = 'ok',
         updated_at = now()
    FROM pg_temp.fin_review_lifecycle_target x
   WHERE x.target_table = 'fin_document'
     AND x.resolution_kind = 'lifecycle'
     AND d.id = x.target_id;

  UPDATE fin_document d
     SET category_id = x.new_category_id,
           classified_by = x.new_classified_by,
           classified_rule_id = x.new_rule_id,
           classified_rule_version_id = x.new_rule_version_id,
           classified_reason = COALESCE(d.classified_reason, '{}'::jsonb)
                               || jsonb_build_object('lifecycle_0090', x.evidence),
           classified_at = now(),
           review_status = 'ok',
           updated_at = now()
    FROM pg_temp.fin_review_lifecycle_target x
   WHERE x.target_table = 'fin_document'
     AND x.resolution_kind = 'deterministico'
     AND d.id = x.target_id;

  UPDATE fin_transaction t
     SET category_id = x.new_category_id,
           nucleo = x.new_nucleo,
           classified_by = x.new_classified_by,
           classified_rule_id = x.new_rule_id,
           classified_rule_version_id = x.new_rule_version_id,
           classified_reason = COALESCE(t.classified_reason, '{}'::jsonb)
                               || jsonb_build_object('lifecycle_0090', x.evidence),
           classified_at = now(),
           review_status = 'ok',
           updated_at = now()
    FROM pg_temp.fin_review_lifecycle_target x
   WHERE x.target_table = 'fin_transaction' AND t.id = x.target_id;

  -- Triggers de domínio podem recusar uma categoria sem abortar o UPDATE (por
  -- exemplo, receita em uma saída). A intenção só pode fechar fila ou gerar
  -- trilha depois de provar que o estado EFETIVAMENTE persistido coincide com
  -- cada target. Qualquer recusa aborta toda a execução, sem decisão parcial.
  IF EXISTS (
    SELECT 1
      FROM pg_temp.fin_review_lifecycle_target x
      LEFT JOIN fin_document d
        ON x.target_table = 'fin_document' AND d.id = x.target_id
      LEFT JOIN fin_transaction t
        ON x.target_table = 'fin_transaction' AND t.id = x.target_id
     WHERE (
       x.target_table = 'fin_document'
       AND (
         d.id IS NULL
         OR d.category_id IS DISTINCT FROM x.new_category_id
         OR d.nucleo IS DISTINCT FROM x.new_nucleo
         OR d.review_status IS DISTINCT FROM 'ok'
         OR d.classified_by IS DISTINCT FROM x.new_classified_by
         OR d.classified_rule_id IS DISTINCT FROM x.new_rule_id
         OR d.classified_rule_version_id IS DISTINCT FROM x.new_rule_version_id
         OR d.classified_reason -> 'lifecycle_0090' IS DISTINCT FROM x.evidence
       )
     ) OR (
       x.target_table = 'fin_transaction'
       AND (
         t.id IS NULL
         OR t.category_id IS DISTINCT FROM x.new_category_id
         OR t.nucleo IS DISTINCT FROM x.new_nucleo
         OR t.review_status IS DISTINCT FROM 'ok'
         OR t.classified_by IS DISTINCT FROM x.new_classified_by
         OR t.classified_rule_id IS DISTINCT FROM x.new_rule_id
         OR t.classified_rule_version_id IS DISTINCT FROM x.new_rule_version_id
         OR t.classified_reason -> 'lifecycle_0090' IS DISTINCT FROM x.evidence
       )
     )
  ) THEN
    RAISE EXCEPTION
      'gatilho recusou estado proposto pelo lifecycle; fila e trilha permaneceram intactas';
  END IF;

  -- A fila pode ter sido fechada pelos gatilhos de fin_transaction. Reescrever
  -- resolved_by/suggested aqui preserva a causa exata e deixa o resultado igual
  -- para documento e transação.
  WITH changed AS (
    UPDATE fin_review_item ri
       SET suggested = x.suggestion,
           status = 'resolvido',
           resolved_at = COALESCE(ri.resolved_at, now()),
           resolved_by = p_actor
      FROM pg_temp.fin_review_lifecycle_target x
     WHERE ri.id = x.review_item_id
    RETURNING ri.id
  ) SELECT count(*) INTO v_resolved FROM changed;

  INSERT INTO fin_audit_log
    (entity_id, target_table, target_id, action, before, after, fields, actor)
  SELECT x.entity_id,
         x.target_table,
         x.target_id,
         'update',
         jsonb_build_object(
           'category_id', x.old_category_id,
           'nucleo', x.old_nucleo,
           'review_status', x.old_review_status,
           'classified_by', x.old_classified_by,
           'classified_rule_id', x.old_rule_id,
           'classified_rule_version_id', x.old_rule_version_id
         ),
         jsonb_build_object(
           'category_id', x.new_category_id,
           'nucleo', x.new_nucleo,
           'review_status', 'ok',
           'classified_by', x.new_classified_by,
           'classified_rule_id', x.new_rule_id,
           'classified_rule_version_id', x.new_rule_version_id,
           'evidence', x.evidence
         ),
         CASE WHEN x.resolution_kind = 'lifecycle'
              THEN ARRAY['review_status', 'classified_reason']::text[]
              ELSE ARRAY['category_id', 'nucleo', 'review_status', 'classified_by',
                         'classified_rule_id', 'classified_rule_version_id',
                         'classified_reason']::text[]
          END,
         p_actor
    FROM pg_temp.fin_review_lifecycle_target x;

  INSERT INTO fin_audit_log
    (entity_id, target_table, target_id, action, before, after, fields, actor)
  SELECT x.entity_id,
         'fin_review_item',
         x.review_item_id,
         'update',
         jsonb_strip_nulls(jsonb_build_object(
           'status', x.old_queue_status,
           'suggested', x.old_queue_suggested,
           'resolved_at', x.old_queue_resolved_at,
           'resolved_by', x.old_queue_resolved_by
         )),
         jsonb_build_object(
           'status', 'resolvido',
           'resolved_by', p_actor,
           'suggested', x.suggestion
         ),
         ARRAY['status', 'resolved_at', 'resolved_by', 'suggested']::text[],
         p_actor
    FROM pg_temp.fin_review_lifecycle_target x;

  INSERT INTO fin_classification_event
    (target_table, target_id, stage, rule_id, rule_version_id, category_id, nucleo,
     confidence, rationale, accepted, actor)
  SELECT x.target_table,
         x.target_id,
         CASE
           WHEN x.resolution_kind = 'lifecycle' THEN 'historico'
           WHEN x.new_classified_by = 'favorecido' THEN 'favorecido'
           WHEN x.new_classified_by = 'contrato' THEN 'contrato'
           WHEN x.new_rule_id IS NOT NULL THEN 'regra'
           ELSE 'historico'
         END,
         x.new_rule_id,
         x.new_rule_version_id,
         x.new_category_id,
         x.new_nucleo,
         x.confidence,
         x.evidence,
         true,
         p_actor
    FROM pg_temp.fin_review_lifecycle_target x;

  SELECT count(*) INTO v_category_changes
    FROM pg_temp.fin_review_lifecycle_target
   WHERE old_category_id IS DISTINCT FROM new_category_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(delta)
                            ORDER BY delta.target_table, delta.old_code, delta.new_code), '[]'::jsonb)
    INTO v_category_delta
    FROM (
      SELECT x.target_table,
             COALESCE(oldc.code, 'NULL') AS old_code,
             COALESCE(newc.code, 'NULL') AS new_code,
             COALESCE(oldc.dre_line, 'nao_classificado') AS old_dre_line,
             COALESCE(newc.dre_line, 'nao_classificado') AS new_dre_line,
             count(*)::integer AS items,
             sum(CASE WHEN x.target_table = 'fin_transaction'
                      THEN t.amount_cents ELSE d.amount_cents END)::bigint AS signed_cents,
             sum(abs(CASE WHEN x.target_table = 'fin_transaction'
                          THEN t.amount_cents ELSE d.amount_cents END))::bigint AS exposure_cents
        FROM pg_temp.fin_review_lifecycle_target x
        LEFT JOIN fin_category oldc ON oldc.id = x.old_category_id
        LEFT JOIN fin_category newc ON newc.id = x.new_category_id
        LEFT JOIN fin_transaction t
          ON x.target_table = 'fin_transaction' AND t.id = x.target_id
        LEFT JOIN fin_document d
          ON x.target_table = 'fin_document' AND d.id = x.target_id
       WHERE x.old_category_id IS DISTINCT FROM x.new_category_id
       GROUP BY 1, 2, 3, 4, 5
    ) delta;

  -- A DRE atual consome fin_transaction (e o subledger de cartão, que esta
  -- rotina não toca), não fin_document. Portanto o delta contábil abaixo usa
  -- somente os 18 lançamentos do ledger; os 16 documentos aparecem no delta
  -- de categoria acima, sem dupla contagem econômica.
  SELECT COALESCE(jsonb_agg(to_jsonb(delta)
                            ORDER BY delta.old_code, delta.new_code), '[]'::jsonb)
    INTO v_dre_delta
    FROM (
      SELECT COALESCE(oldc.code, 'NULL') AS old_code,
             COALESCE(newc.code, 'NULL') AS new_code,
             CASE
               WHEN EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id)
                 THEN 'fora_cartao_fatura_paga'
               WHEN oldc.id IS NULL THEN 'lacuna_ledger_sem_categoria'
               WHEN oldc.dre_line = 'receita_bruta' THEN 'receita_bruta'
               WHEN oldc.dre_line = 'deducoes' THEN 'deducoes_devolucoes'
               WHEN oldc.dre_line = 'impostos' THEN 'deducoes_impostos'
               WHEN oldc.dre_line = 'custos_servicos' THEN 'custos_diretos'
               WHEN oldc.dre_line = 'despesas_pessoal' THEN 'despesas_pessoal'
               WHEN oldc.dre_line = 'despesas_comerciais' THEN 'despesas_comerciais'
               WHEN oldc.dre_line = 'despesas_administrativas' THEN 'despesas_administrativas'
               WHEN oldc.dre_line = 'resultado_financeiro' THEN 'resultado_financeiro'
               WHEN oldc.dre_line = 'investimentos' THEN 'fora_investimento_capex'
               ELSE 'fora_movimentacao'
             END AS old_dre_line,
             CASE
               WHEN EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id)
                 THEN 'fora_cartao_fatura_paga'
               WHEN newc.id IS NULL THEN 'lacuna_ledger_sem_categoria'
               WHEN newc.dre_line = 'receita_bruta' THEN 'receita_bruta'
               WHEN newc.dre_line = 'deducoes' THEN 'deducoes_devolucoes'
               WHEN newc.dre_line = 'impostos' THEN 'deducoes_impostos'
               WHEN newc.dre_line = 'custos_servicos' THEN 'custos_diretos'
               WHEN newc.dre_line = 'despesas_pessoal' THEN 'despesas_pessoal'
               WHEN newc.dre_line = 'despesas_comerciais' THEN 'despesas_comerciais'
               WHEN newc.dre_line = 'despesas_administrativas' THEN 'despesas_administrativas'
               WHEN newc.dre_line = 'resultado_financeiro' THEN 'resultado_financeiro'
               WHEN newc.dre_line = 'investimentos' THEN 'fora_investimento_capex'
               ELSE 'fora_movimentacao'
             END AS new_dre_line,
             count(*)::integer AS items,
             sum(t.amount_cents)::bigint AS signed_cents,
             sum(abs(t.amount_cents))::bigint AS exposure_cents
        FROM pg_temp.fin_review_lifecycle_target x
        JOIN fin_transaction t
          ON x.target_table = 'fin_transaction' AND t.id = x.target_id
        LEFT JOIN fin_category oldc ON oldc.id = x.old_category_id
        LEFT JOIN fin_category newc ON newc.id = x.new_category_id
       WHERE x.old_category_id IS DISTINCT FROM x.new_category_id
       GROUP BY 1, 2, 3, 4
    ) delta;

  v_suggestions_refreshed := fin_review_refresh_suggestions();

  SELECT count(*), COALESCE(sum(amount_cents), 0)
    INTO v_tx_count_after, v_tx_cents_after FROM fin_transaction;
  SELECT count(*), COALESCE(sum(amount_cents), 0)
    INTO v_doc_count_after, v_doc_cents_after FROM fin_document;
  SELECT count(*), COALESCE(sum(amount_cents), 0)
    INTO v_settlement_count_after, v_settlement_cents_after FROM fin_settlement;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.account_id), '[]'::jsonb)
    INTO v_account_anchor_after
    FROM (
      SELECT a.id AS account_id,
             a.opening_balance_cents,
             a.current_balance_cents,
             count(t.id) AS ledger_rows,
             COALESCE(sum(t.amount_cents), 0) AS ledger_cents
        FROM fin_account a
        LEFT JOIN fin_transaction t ON t.account_id = a.id
       GROUP BY a.id, a.opening_balance_cents, a.current_balance_cents
    ) x;

  IF (v_tx_count_before, v_tx_cents_before,
      v_doc_count_before, v_doc_cents_before,
      v_settlement_count_before, v_settlement_cents_before)
     IS DISTINCT FROM
     (v_tx_count_after, v_tx_cents_after,
      v_doc_count_after, v_doc_cents_after,
      v_settlement_count_after, v_settlement_cents_after)
     OR v_account_anchor_before IS DISTINCT FROM v_account_anchor_after THEN
    RAISE EXCEPTION 'lifecycle alterou dinheiro, quantidade de fatos ou soma por conta';
  END IF;

  IF v_resolved > 0 OR v_suggestions_refreshed > 0 THEN
    INSERT INTO fin_audit_log
      (entity_id, target_table, target_id, action, after, fields, actor)
    SELECT e.id,
           'fin_review_item',
           0,
           'bulk_update',
           jsonb_build_object(
             'resolved_items', v_resolved,
             'suggestions_refreshed', v_suggestions_refreshed,
             'category_changes', v_category_changes,
             'category_delta', v_category_delta,
             'dre_delta', v_dre_delta,
             'money_anchor', jsonb_build_object(
               'transaction_count', v_tx_count_after,
               'transaction_cents', v_tx_cents_after,
               'document_count', v_doc_count_after,
               'document_cents', v_doc_cents_after,
               'settlement_count', v_settlement_count_after,
               'settlement_cents', v_settlement_cents_after,
               'accounts', v_account_anchor_after
             )
           ),
           ARRAY['status', 'suggested']::text[],
           p_actor
      FROM fin_entity e WHERE e.slug = 'xpe';
  END IF;

  PERFORM set_config('fin.review_lifecycle_running', 'off', true);
  RETURN QUERY SELECT v_lifecycle, v_recurrence, v_inherited,
                      v_pjbank, v_known_payee, v_resolved, v_category_changes;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('fin.review_lifecycle_running', 'off', true);
  RAISE;
END $$;

-- --------------------------------------------------------------------------
-- 6. PRÉ-CONDIÇÕES DA FOTOGRAFIA E PRIMEIRA APLICAÇÃO
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_n bigint;
  v_cents bigint;
  v_code text;
BEGIN
  SELECT count(*), COALESCE(sum(abs(amount_cents)), 0)
    INTO v_n, v_cents FROM fin_review_item WHERE status = 'pendente';
  IF (v_n, v_cents) <> (1533, 135376892) THEN
    RAISE EXCEPTION '0090: fila esperada 1533/135376892, encontrada %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(amount_cents)), 0)
    INTO v_n, v_cents
    FROM (
      SELECT ri.amount_cents
        FROM fin_review_item ri
        JOIN fin_transaction t
          ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
       WHERE ri.status = 'pendente'
         AND t.posted_on >= DATE '2026-01-01' AND t.posted_on < DATE '2027-01-01'
      UNION ALL
      SELECT ri.amount_cents
        FROM fin_review_item ri
        JOIN fin_document d
          ON ri.target_table = 'fin_document' AND d.id = ri.target_id
       WHERE ri.status = 'pendente'
         AND COALESCE(d.competence_date, d.due_date, d.issue_date) >= DATE '2026-01-01'
         AND COALESCE(d.competence_date, d.due_date, d.issue_date) < DATE '2027-01-01'
    ) current_scope;
  IF (v_n, v_cents) <> (502, 42469298) THEN
    RAISE EXCEPTION '0090: fila 2026 esperada 502/42469298, encontrada %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(review_amount_cents)), 0)
    INTO v_n, v_cents FROM fin_review_lifecycle_candidate_v;
  IF (v_n, v_cents) <> (398, 32552466) THEN
    RAISE EXCEPTION '0090: lifecycle esperado 398/32552466, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(review_amount_cents)), 0)
    INTO v_n, v_cents FROM fin_review_recurrence_candidate_v;
  IF (v_n, v_cents) <> (16, 7841333) THEN
    RAISE EXCEPTION '0090: recorrência esperada 16/7841333, encontrada %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(review_amount_cents)), 0)
    INTO v_n, v_cents FROM fin_review_pjbank_candidate_v;
  IF (v_n, v_cents) <> (3, 238672) THEN
    RAISE EXCEPTION '0090: PJBANK esperado 3/238672, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(review_amount_cents)), 0), min(category_code)
    INTO v_n, v_cents, v_code FROM fin_review_known_payee_candidate_v;
  IF (v_n, v_cents, v_code) <> (1, 6000, '4.03') THEN
    RAISE EXCEPTION '0090: favorecido conhecido esperado 1/6000/4.03, encontrado %/%/%',
      v_n, v_cents, v_code;
  END IF;

  SELECT count(*), COALESCE(sum(abs(c.review_amount_cents)), 0)
    INTO v_n, v_cents
    FROM fin_review_settlement_inheritance_candidate_v c;
  IF (v_n, v_cents) <> (14, 4441333) THEN
    RAISE EXCEPTION '0090: heranças esperadas 14/4441333, encontradas %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(raw_exposure_cents), 0)
    INTO v_n, v_cents FROM fin_review_case_v;
  IF (v_n, v_cents) <> (1183, 135376892) THEN
    RAISE EXCEPTION '0090: casos brutos esperados 1183/135376892, encontrados %/%', v_n, v_cents;
  END IF;

  SELECT COALESCE(sum(case_exposure_cents), 0)
    INTO v_cents FROM fin_review_case_v;
  IF v_cents <> 112252686 THEN
    RAISE EXCEPTION '0090: exposição sem dupla contagem esperada 112252686, encontrada %', v_cents;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_review_rule_result_v WHERE winner IS NOT NULL;
  IF v_n <> 494 THEN
    RAISE EXCEPTION '0090: motor esperava 494 vencedoras e encontrou %', v_n;
  END IF;
END $$;

CREATE TEMP TABLE fin_0090_first_run ON COMMIT DROP AS
SELECT * FROM fin_review_lifecycle_apply('migration-0090');

DO $$
DECLARE v fin_0090_first_run%ROWTYPE;
BEGIN
  SELECT * INTO v FROM fin_0090_first_run;
  IF (v.lifecycle_documents, v.recurrence_documents,
      v.inherited_transactions, v.pjbank_transactions,
      v.known_payee_transactions, v.resolved_items, v.category_changes)
     <> (398, 16, 14, 3, 1, 432, 34) THEN
    RAISE EXCEPTION '0090: resultado inesperado: %', row_to_json(v);
  END IF;
END $$;
DROP TABLE fin_0090_first_run;

-- --------------------------------------------------------------------------
-- 7. PÓS-CONDIÇÕES: O QUE SAIU, O QUE FICOU E POR QUÊ
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_n bigint;
  v_cents bigint;
  v_raw bigint;
BEGIN
  SELECT count(*), COALESCE(sum(abs(amount_cents)), 0)
    INTO v_n, v_cents FROM fin_review_item WHERE status = 'pendente';
  IF (v_n, v_cents) <> (1101, 90297088) THEN
    RAISE EXCEPTION '0090: pós-fila esperado 1101/90297088, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(CASE
           WHEN x.target_table = 'fin_transaction' THEN t.amount_cents
           ELSE d.amount_cents END)), 0)
    INTO v_n, v_cents
    FROM pg_temp.fin_review_lifecycle_target x
    LEFT JOIN fin_transaction t
      ON x.target_table = 'fin_transaction' AND t.id = x.target_id
    LEFT JOIN fin_document d
      ON x.target_table = 'fin_document' AND d.id = x.target_id
   WHERE x.old_category_id IS DISTINCT FROM x.new_category_id;
  IF (v_n, v_cents) <> (34, 12527338) THEN
    RAISE EXCEPTION '0090: delta de categoria esperado 34/12527338, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(t.amount_cents)), 0)
    INTO v_n, v_cents
    FROM pg_temp.fin_review_lifecycle_target x
    JOIN fin_transaction t
      ON x.target_table = 'fin_transaction' AND t.id = x.target_id
   WHERE x.old_category_id IS DISTINCT FROM x.new_category_id;
  IF (v_n, v_cents) <> (18, 4686005) THEN
    RAISE EXCEPTION '0090: delta DRE/ledger esperado 18/4686005, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(t.amount_cents), 0)
    INTO v_n, v_cents
    FROM pg_temp.fin_review_lifecycle_target x
    JOIN fin_transaction t
      ON x.target_table = 'fin_transaction' AND t.id = x.target_id
   WHERE x.old_category_id IS NULL AND x.new_category_id IS NOT NULL;
  IF (v_n, v_cents) <> (7, 446661) THEN
    RAISE EXCEPTION '0090: saída da lacuna DRE esperada 7/+446661, encontrada %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(amount_cents)), 0)
    INTO v_n, v_cents
    FROM (
      SELECT ri.amount_cents
        FROM fin_review_item ri
        JOIN fin_transaction t
          ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
       WHERE ri.status = 'pendente'
         AND t.posted_on >= DATE '2026-01-01' AND t.posted_on < DATE '2027-01-01'
      UNION ALL
      SELECT ri.amount_cents
        FROM fin_review_item ri
        JOIN fin_document d
          ON ri.target_table = 'fin_document' AND d.id = ri.target_id
       WHERE ri.status = 'pendente'
         AND COALESCE(d.competence_date, d.due_date, d.issue_date) >= DATE '2026-01-01'
         AND COALESCE(d.competence_date, d.due_date, d.issue_date) < DATE '2027-01-01'
    ) current_scope;
  IF (v_n, v_cents) <> (406, 25957090) THEN
    RAISE EXCEPTION '0090: pós-fila 2026 esperado 406/25957090, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(ri.amount_cents)), 0)
    INTO v_n, v_cents
    FROM fin_review_item ri
    JOIN fin_document d
      ON ri.target_table = 'fin_document' AND d.id = ri.target_id
   WHERE ri.status = 'pendente' AND ri.reason = 'baixa_confianca';
  IF (v_n, v_cents) <> (15, 897400) THEN
    RAISE EXCEPTION '0090 fechou/abriu caso humano: esperado 15/897400, encontrado %/%', v_n, v_cents;
  END IF;

  SELECT count(*), COALESCE(sum(abs(ri.amount_cents)), 0)
    INTO v_n, v_cents
    FROM fin_review_item ri
    JOIN fin_transaction t
      ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
    JOIN fin_category c ON c.id = t.category_id
   WHERE ri.status = 'pendente' AND c.code IN ('3.99', '5.99');
  IF (v_n, v_cents) <> (289, 15425789) THEN
    RAISE EXCEPTION '0090 alterou placeholders fora das 11 heranças: %/%', v_n, v_cents;
  END IF;

  SELECT count(*) INTO v_n FROM fin_review_item
   WHERE status = 'pendente' AND suggested = '[]'::jsonb;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0090 deixou % pendências sem evidência estruturada', v_n;
  END IF;

  SELECT count(*), COALESCE(sum(raw_exposure_cents), 0),
         COALESCE(sum(case_exposure_cents), 0)
    INTO v_n, v_raw, v_cents FROM fin_review_case_v;
  IF (v_n, v_raw, v_cents) <> (765, 90297088, 71614215) THEN
    RAISE EXCEPTION '0090: casos esperados 765/90297088/71614215, encontrados %/%/%',
      v_n, v_raw, v_cents;
  END IF;

  SELECT count(*) INTO v_n FROM fin_review_rule_result_v WHERE winner IS NOT NULL;
  IF v_n <> 474 THEN
    RAISE EXCEPTION '0090: vencedoras restantes esperadas 474, encontradas %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_audit_log
   WHERE actor = 'migration-0090';
  IF v_n <> 865 THEN
    RAISE EXCEPTION '0090: trilha esperada 865 eventos, encontrada %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_classification_event
   WHERE actor = 'migration-0090';
  IF v_n <> 432 THEN
    RAISE EXCEPTION '0090: eventos de classificação esperados 432, encontrados %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_classification_event ce
    LEFT JOIN fin_rule_version rv
      ON (rv.id, rv.rule_id) = (ce.rule_version_id, ce.rule_id)
   WHERE ce.actor = 'migration-0090'
     AND ce.rule_id IS NOT NULL
     AND rv.id IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0090: % evento(s) apontam para versão incoerente', v_n;
  END IF;

  SELECT (SELECT count(*) FROM fin_review_lifecycle_candidate_v)
       + (SELECT count(*) FROM fin_review_recurrence_candidate_v)
       + (SELECT count(*) FROM fin_review_pjbank_candidate_v)
       + (SELECT count(*) FROM fin_review_known_payee_candidate_v)
       + (SELECT count(*) FROM fin_review_settlement_inheritance_candidate_v)
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0090 não chegou ao ponto fixo: % candidato(s)', v_n;
  END IF;
END $$;

COMMENT ON FUNCTION fin_review_lifecycle_apply(text) IS
  'Resolve somente evidência independente: confirmação >=90%, recorrência exata unânime, '
  'regra final ativa, favorecido conhecido ou herança de documento liquidado. Preserva '
  'human locks, audita categoria/DRE e ancora todo dinheiro antes/depois. Deve ser chamada '
  'uma vez ao fim do lote pelo scheduler ou pelo comando explícito; deliberadamente não há '
  'trigger global por linha/statement.';
