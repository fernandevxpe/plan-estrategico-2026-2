-- Competencia contabil deixa de depender de uma rotina executada depois do import.
--
-- A 0071 fez o backfill historico e definiu corretamente a precedencia das
-- evidencias, mas deliberadamente nao instalou gatilho no INSERT: settlement,
-- documento e nota costumam chegar depois do lancamento. Isso deixou uma
-- janela permanente em que todo lancamento novo ficava sem competencia ate a
-- proxima chamada manual de fin_competencia_backfill(). A solucao nao e
-- congelar a presuncao no INSERT; e preencher a melhor decisao disponivel no
-- INSERT e reavaliar somente a linha atingida quando uma evidencia chega.
--
-- Esta migration preserva as sete regras e a precedencia da 0071:
--   10 nota autorizada; 20 vencimento a receber; 30 documento a pagar;
--   40 folha; 60 tarifa; 70 movimentacao; 99 caixa presumido.
-- A funcao de decisao e unica para o backfill e para os gatilhos. Assim, o
-- caminho incremental e o reparo global nao podem divergir silenciosamente.

-- ---------------------------------------------------------------------------
-- 1. DECISAO DETERMINISTICA DE UMA TRANSACAO
-- ---------------------------------------------------------------------------
-- fin_settlement e N:N por desenho. A 0071 podia usar UPDATE ... FROM sobre
-- mais de uma evidencia e, nesse caso, o PostgreSQL podia escolher qualquer
-- linha. Aqui todas as candidatas entram na mesma lista: menor precedencia
-- vence e, num empate, os menores ids de documento/nota tornam a escolha
-- estavel e auditavel.
CREATE OR REPLACE FUNCTION fin_competencia_decidir(p_transaction_id bigint)
RETURNS TABLE (regra text, competencia date)
LANGUAGE sql
STABLE
ROWS 1
AS $$
  WITH tx AS (
    SELECT t.id,
           t.posted_on,
           t.source_kind,
           c.cash_flow_group
      FROM fin_transaction t
      LEFT JOIN fin_category c ON c.id = t.category_id
     WHERE t.id = p_transaction_id
  ),
  candidatas AS (
    SELECT 'nota_fiscal_emissao'::text AS regra,
           fd.issue_date              AS competencia,
           10                         AS precedencia,
           d.id                       AS documento_id,
           fd.id                      AS evidencia_id
      FROM tx
      JOIN fin_settlement s      ON s.transaction_id = tx.id
      JOIN fin_document d        ON d.id = s.document_id
      JOIN fin_fiscal_document fd
        ON fd.document_id = d.id
       AND fd.status = 'AUTHORIZED'
       AND fd.issue_date IS NOT NULL
     WHERE d.direction = 'receber'

    UNION ALL

    SELECT 'cobranca_vencimento', d.due_date, 20, d.id, NULL::bigint
      FROM tx
      JOIN fin_settlement s ON s.transaction_id = tx.id
      JOIN fin_document d   ON d.id = s.document_id
     WHERE d.direction = 'receber'
       AND d.due_date IS NOT NULL

    UNION ALL

    SELECT 'documento_fiscal_despesa', d.issue_date, 30, d.id, NULL::bigint
      FROM tx
      JOIN fin_settlement s ON s.transaction_id = tx.id
      JOIN fin_document d   ON d.id = s.document_id
     WHERE d.direction = 'pagar'
       AND d.issue_date IS NOT NULL

    UNION ALL

    SELECT 'folha_mes_referencia',
           CASE WHEN extract(day FROM tx.posted_on) <= 5
                THEN (date_trunc('month', tx.posted_on) - INTERVAL '1 day')::date
                ELSE tx.posted_on END,
           40, NULL::bigint, NULL::bigint
      FROM tx
     WHERE tx.cash_flow_group = 'pessoal'

    UNION ALL

    SELECT 'tarifa_evento_no_caixa', tx.posted_on, 60, NULL::bigint, NULL::bigint
      FROM tx
     WHERE tx.source_kind IN (
       'PAYMENT_FEE', 'INVOICE_FEE',
       'PAYMENT_MESSAGING_NOTIFICATION_FEE',
       'INSTANT_TEXT_MESSAGE_FEE', 'TRANSFER_FEE',
       'CREDIT_BUREAU_REPORT'
     )

    UNION ALL

    SELECT 'movimentacao_neutra', tx.posted_on, 70, NULL::bigint, NULL::bigint
      FROM tx
     WHERE tx.cash_flow_group = 'movimentacao'

    UNION ALL

    SELECT 'competencia_presumida_caixa', tx.posted_on, 99,
           NULL::bigint, NULL::bigint
      FROM tx
  )
  SELECT c.regra, c.competencia
    FROM candidatas c
   WHERE c.competencia IS NOT NULL
   ORDER BY c.precedencia, c.documento_id NULLS LAST,
            c.evidencia_id NULLS LAST, c.regra
   LIMIT 1
$$;

COMMENT ON FUNCTION fin_competencia_decidir(bigint) IS
  'Aplica a precedencia canonica da 0071 a uma transacao. Em N:N, desempata por '
  'documento/nota de menor id; sempre devolve uma decisao porque posted_on e NOT NULL.';

-- Atualiza exclusivamente os ids informados. O filtro de DISTINCT evita tocar
-- updated_at quando a decisao continua igual e torna a funcao um ponto fixo:
-- depois de aplicada, chama-la novamente devolve zero.
CREATE OR REPLACE FUNCTION fin_competencia_reavaliar(p_transaction_ids bigint[])
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_linhas bigint;
BEGIN
  IF COALESCE(cardinality(p_transaction_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Ordem unica de lock evita que dois eventos concorrentes terminem com a
  -- decisao calculada antes de a evidencia concorrente ficar visivel. O SELECT
  -- seguinte e um novo comando e, em READ COMMITTED, ganha snapshot atualizado.
  PERFORM t.id
    FROM fin_transaction t
   WHERE t.id = ANY (p_transaction_ids)
   ORDER BY t.id
   FOR UPDATE;

  WITH ids AS (
    SELECT DISTINCT unnest(p_transaction_ids) AS id
  ),
  decisoes AS (
    SELECT t.id, d.regra, d.competencia
      FROM ids
      JOIN fin_transaction t ON t.id = ids.id
      CROSS JOIN LATERAL fin_competencia_decidir(t.id) d
     WHERE NOT ('competence_date' = ANY (t.human_locked_fields))
  ),
  aplicado AS (
    UPDATE fin_transaction t
       SET competence_rule = d.regra,
           competence_date = d.competencia,
           updated_at = now()
      FROM decisoes d
     WHERE t.id = d.id
       AND (t.competence_rule IS DISTINCT FROM d.regra
            OR t.competence_date IS DISTINCT FROM d.competencia)
     RETURNING 1
  )
  SELECT count(*)::bigint INTO v_linhas FROM aplicado;

  RETURN v_linhas;
END;
$$;

COMMENT ON FUNCTION fin_competencia_reavaliar(bigint[]) IS
  'Recalcula somente as transacoes informadas, respeita a trava humana de competence_date '
  'e devolve quantas linhas realmente mudaram. Uma segunda chamada identica devolve zero.';

-- ---------------------------------------------------------------------------
-- 2. NOVA TRANSACAO NASCE COM UMA DECISAO COMPLETA
-- ---------------------------------------------------------------------------
-- No BEFORE INSERT ainda nao pode existir settlement para NEW.id por causa da
-- FK. Portanto a melhor evidencia possivel e intrinseca a propria linha:
-- categoria, tipo da fonte ou, no limite, caixa presumido. Os gatilhos da secao
-- seguinte promovem essa decisao quando documento/nota chegam.
CREATE OR REPLACE FUNCTION fin_transaction_competencia_no_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cash_flow_group text;
BEGIN
  -- Competencia explicitamente travada e decisao humana. Se o par informado
  -- for invalido, a constraint da 0071 falha alto em vez de o corrigirmos.
  IF 'competence_date' = ANY (NEW.human_locked_fields) THEN
    RETURN NEW;
  END IF;

  SELECT c.cash_flow_group INTO v_cash_flow_group
    FROM fin_category c
   WHERE c.id = NEW.category_id;

  IF v_cash_flow_group = 'pessoal' THEN
    NEW.competence_rule := 'folha_mes_referencia';
    NEW.competence_date := CASE WHEN extract(day FROM NEW.posted_on) <= 5
      THEN (date_trunc('month', NEW.posted_on) - INTERVAL '1 day')::date
      ELSE NEW.posted_on END;
  ELSIF NEW.source_kind IN (
    'PAYMENT_FEE', 'INVOICE_FEE',
    'PAYMENT_MESSAGING_NOTIFICATION_FEE',
    'INSTANT_TEXT_MESSAGE_FEE', 'TRANSFER_FEE',
    'CREDIT_BUREAU_REPORT'
  ) THEN
    NEW.competence_rule := 'tarifa_evento_no_caixa';
    NEW.competence_date := NEW.posted_on;
  ELSIF v_cash_flow_group = 'movimentacao' THEN
    NEW.competence_rule := 'movimentacao_neutra';
    NEW.competence_date := NEW.posted_on;
  ELSE
    NEW.competence_rule := 'competencia_presumida_caixa';
    NEW.competence_date := NEW.posted_on;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fin_transaction_competencia_imediata ON fin_transaction;
CREATE TRIGGER fin_transaction_competencia_imediata
  BEFORE INSERT ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_transaction_competencia_no_insert();

COMMENT ON FUNCTION fin_transaction_competencia_no_insert() IS
  'Faz todo lancamento elegivel nascer com competence_date e competence_rule. '
  'Presuncao no INSERT nao congela: evidencias posteriores promovem a linha.';

-- O detalhamento do cartao tem ciclo menor (nao recebe settlement), mas sofria
-- da mesma lacuna da 0071: item sincronizado depois do backfill nascia NULL.
-- A funcao dirigida tambem evita depender da proxima rotina global quando a
-- fonte corrige purchase_date, kind ou posted_on.
CREATE OR REPLACE FUNCTION fin_card_competencia_reavaliar(p_transaction_ids bigint[])
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_linhas bigint;
BEGIN
  IF COALESCE(cardinality(p_transaction_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM ct.id
    FROM fin_card_transaction ct
   WHERE ct.id = ANY (p_transaction_ids)
   ORDER BY ct.id
   FOR UPDATE;

  WITH ids AS (
    SELECT DISTINCT unnest(p_transaction_ids) AS id
  ),
  decisoes AS (
    SELECT ct.id,
           CASE
             WHEN ct.kind = 'pagamento_fatura' THEN 'cartao_pagamento_fatura'
             WHEN ct.purchase_date IS NOT NULL THEN 'cartao_data_compra'
             ELSE 'cartao_data_lancamento'
           END AS regra,
           COALESCE(ct.purchase_date, ct.posted_on) AS competencia
      FROM ids
      JOIN fin_card_transaction ct ON ct.id = ids.id
     WHERE NOT ('competence_date' = ANY (ct.human_locked_fields))
  ),
  aplicado AS (
    UPDATE fin_card_transaction ct
       SET competence_rule = d.regra,
           competence_date = d.competencia,
           updated_at = now()
      FROM decisoes d
     WHERE ct.id = d.id
       AND (ct.competence_rule IS DISTINCT FROM d.regra
            OR ct.competence_date IS DISTINCT FROM d.competencia)
     RETURNING 1
  )
  SELECT count(*)::bigint INTO v_linhas FROM aplicado;

  RETURN v_linhas;
END;
$$;

CREATE OR REPLACE FUNCTION fin_card_transaction_competencia_no_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF 'competence_date' = ANY (NEW.human_locked_fields) THEN
    RETURN NEW;
  END IF;

  NEW.competence_rule := CASE
    WHEN NEW.kind = 'pagamento_fatura' THEN 'cartao_pagamento_fatura'
    WHEN NEW.purchase_date IS NOT NULL THEN 'cartao_data_compra'
    ELSE 'cartao_data_lancamento'
  END;
  NEW.competence_date := COALESCE(NEW.purchase_date, NEW.posted_on);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fin_card_transaction_competencia_imediata
  ON fin_card_transaction;
CREATE TRIGGER fin_card_transaction_competencia_imediata
  BEFORE INSERT ON fin_card_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_card_transaction_competencia_no_insert();

CREATE OR REPLACE FUNCTION fin_card_transaction_competencia_reavalia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fin_card_competencia_reavaliar(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fin_card_transaction_competencia_reavalia
  ON fin_card_transaction;
CREATE TRIGGER fin_card_transaction_competencia_reavalia
  AFTER UPDATE OF kind, purchase_date, posted_on, human_locked_fields
  ON fin_card_transaction
  FOR EACH ROW
  WHEN (OLD.kind IS DISTINCT FROM NEW.kind
     OR OLD.purchase_date IS DISTINCT FROM NEW.purchase_date
     OR OLD.posted_on IS DISTINCT FROM NEW.posted_on
     OR OLD.human_locked_fields IS DISTINCT FROM NEW.human_locked_fields)
  EXECUTE FUNCTION fin_card_transaction_competencia_reavalia();

COMMENT ON FUNCTION fin_card_transaction_competencia_no_insert() IS
  'Faz item de cartao nascer com a mesma decisao de competencia do backfill da 0071.';

COMMENT ON FUNCTION fin_card_competencia_reavaliar(bigint[]) IS
  'Recalcula competencia somente dos itens de cartao informados e respeita trava humana.';

-- Categoria/tipo/data podem mudar depois do INSERT. human_locked_fields entra
-- no evento para que remover a trava faca a linha voltar imediatamente a regra
-- deterministica; adicionar a trava nao altera nada porque o atualizador a ve.
CREATE OR REPLACE FUNCTION fin_transaction_competencia_reavalia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fin_competencia_reavaliar(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fin_transaction_competencia_reavalia ON fin_transaction;
CREATE TRIGGER fin_transaction_competencia_reavalia
  AFTER UPDATE OF posted_on, category_id, source_kind, human_locked_fields
  ON fin_transaction
  FOR EACH ROW
  WHEN (OLD.posted_on IS DISTINCT FROM NEW.posted_on
     OR OLD.category_id IS DISTINCT FROM NEW.category_id
     OR OLD.source_kind IS DISTINCT FROM NEW.source_kind
     OR OLD.human_locked_fields IS DISTINCT FROM NEW.human_locked_fields)
  EXECUTE FUNCTION fin_transaction_competencia_reavalia();

-- Alterar o significado contabil de uma categoria atinge somente as linhas que
-- apontam para ela. E um caso raro, mas sem este gatilho uma categoria que muda
-- de operacional para pessoal deixaria o historico com duas interpretacoes.
CREATE OR REPLACE FUNCTION fin_category_competencia_reavalia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_ids bigint[];
BEGIN
  SELECT array_agg(t.id)
    INTO v_transaction_ids
    FROM fin_transaction t
   WHERE t.category_id = NEW.id;

  PERFORM fin_competencia_reavaliar(v_transaction_ids);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fin_category_competencia_reavalia ON fin_category;
CREATE TRIGGER fin_category_competencia_reavalia
  AFTER UPDATE OF cash_flow_group ON fin_category
  FOR EACH ROW
  WHEN (OLD.cash_flow_group IS DISTINCT FROM NEW.cash_flow_group)
  EXECUTE FUNCTION fin_category_competencia_reavalia();

-- ---------------------------------------------------------------------------
-- 3. EVIDENCIA POSTERIOR REAVALIA SO AS TRANSACOES LIGADAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_settlement_competencia_reavalia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fin_competencia_reavaliar(ARRAY[NEW.transaction_id]);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM fin_competencia_reavaliar(ARRAY[OLD.transaction_id]);
  ELSE
    PERFORM fin_competencia_reavaliar(
      ARRAY[OLD.transaction_id, NEW.transaction_id]
    );
  END IF;
  RETURN NULL;
END;
$$;

-- O nome ordena este gatilho DEPOIS de fin_settlement_maintains_document (0002).
-- Ambos os caminhos passam a travar documento antes de transacao, a mesma
-- ordem de um UPDATE direto no documento, reduzindo o risco de deadlock.
DROP TRIGGER IF EXISTS fin_settlement_competencia_reavalia ON fin_settlement;
DROP TRIGGER IF EXISTS fin_settlement_reavalia_competencia ON fin_settlement;
CREATE TRIGGER fin_settlement_reavalia_competencia
  AFTER INSERT OR UPDATE OF transaction_id, document_id OR DELETE
  ON fin_settlement
  FOR EACH ROW EXECUTE FUNCTION fin_settlement_competencia_reavalia();

-- Mudar vencimento, emissao ou sentido de um documento pode trocar tanto a
-- data quanto a regra. Status/settled_cents nao participam da decisao e ficam
-- fora do evento, evitando trabalho no gatilho de manutencao da liquidacao.
CREATE OR REPLACE FUNCTION fin_document_competencia_reavalia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_ids bigint[];
BEGIN
  SELECT array_agg(DISTINCT s.transaction_id)
    INTO v_transaction_ids
    FROM fin_settlement s
   WHERE s.document_id = NEW.id;

  PERFORM fin_competencia_reavaliar(v_transaction_ids);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fin_document_competencia_reavalia ON fin_document;
CREATE TRIGGER fin_document_competencia_reavalia
  AFTER UPDATE OF direction, due_date, issue_date ON fin_document
  FOR EACH ROW
  WHEN (OLD.direction IS DISTINCT FROM NEW.direction
     OR OLD.due_date IS DISTINCT FROM NEW.due_date
     OR OLD.issue_date IS DISTINCT FROM NEW.issue_date)
  EXECUTE FUNCTION fin_document_competencia_reavalia();

-- Uma nota passa a ser evidencia quando liga a cobranca, ganha issue_date e
-- fica AUTHORIZED; deixa de ser quando qualquer uma dessas condicoes some.
-- No UPDATE os dois document_ids entram, para retirar evidencia do antigo e
-- acrescenta-la ao novo sem varrer o ledger.
CREATE OR REPLACE FUNCTION fin_fiscal_document_competencia_reavalia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_document_ids bigint[];
  v_transaction_ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_document_ids := ARRAY[NEW.document_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_document_ids := ARRAY[OLD.document_id];
  ELSE
    v_document_ids := ARRAY[OLD.document_id, NEW.document_id];
  END IF;

  SELECT array_agg(DISTINCT s.transaction_id)
    INTO v_transaction_ids
    FROM fin_settlement s
   WHERE s.document_id = ANY (v_document_ids);

  PERFORM fin_competencia_reavaliar(v_transaction_ids);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fin_fiscal_document_competencia_reavalia ON fin_fiscal_document;
CREATE TRIGGER fin_fiscal_document_competencia_reavalia
  AFTER INSERT OR UPDATE OF document_id, status, issue_date OR DELETE
  ON fin_fiscal_document
  FOR EACH ROW EXECUTE FUNCTION fin_fiscal_document_competencia_reavalia();

-- Uma unica transacao pode liquidar varios documentos. Quando as evidencias de
-- MELHOR precedencia discordam de data, uma coluna singular nao consegue
-- representar todas elas. fin_competencia_decidir usa o menor id como
-- convencao deterministica, mas a perda de informacao nao fica escondida: esta
-- view publica exatamente os casos que precisam de rateio ou decisao humana.
CREATE OR REPLACE VIEW fin_competencia_conflito_v AS
WITH evidencias AS (
  SELECT s.transaction_id,
         'nota_fiscal_emissao'::text AS regra,
         10 AS precedencia,
         fd.issue_date AS competencia,
         d.id AS document_id,
         fd.id AS fiscal_document_id
    FROM fin_settlement s
    JOIN fin_document d ON d.id = s.document_id
    JOIN fin_fiscal_document fd
      ON fd.document_id = d.id
     AND fd.status = 'AUTHORIZED'
     AND fd.issue_date IS NOT NULL
   WHERE d.direction = 'receber'

  UNION ALL

  SELECT s.transaction_id, 'cobranca_vencimento', 20, d.due_date,
         d.id, NULL::bigint
    FROM fin_settlement s
    JOIN fin_document d ON d.id = s.document_id
   WHERE d.direction = 'receber' AND d.due_date IS NOT NULL

  UNION ALL

  SELECT s.transaction_id, 'documento_fiscal_despesa', 30, d.issue_date,
         d.id, NULL::bigint
    FROM fin_settlement s
    JOIN fin_document d ON d.id = s.document_id
   WHERE d.direction = 'pagar' AND d.issue_date IS NOT NULL
),
melhor AS (
  SELECT e.transaction_id, min(e.precedencia) AS precedencia
    FROM evidencias e
   GROUP BY e.transaction_id
),
vencedoras AS (
  SELECT e.*
    FROM evidencias e
    JOIN melhor m
      ON m.transaction_id = e.transaction_id
     AND m.precedencia = e.precedencia
)
SELECT v.transaction_id,
       min(v.regra) AS regra,
       v.precedencia,
       count(*)::bigint AS evidencias,
       count(DISTINCT v.competencia)::bigint AS datas_distintas,
       array_agg(DISTINCT v.competencia ORDER BY v.competencia) AS competencias,
       array_agg(DISTINCT v.document_id ORDER BY v.document_id) AS document_ids,
       array_agg(DISTINCT v.fiscal_document_id ORDER BY v.fiscal_document_id)
         FILTER (WHERE v.fiscal_document_id IS NOT NULL) AS fiscal_document_ids,
       min(v.document_id) AS documento_escolhido_por_convencao
  FROM vencedoras v
 GROUP BY v.transaction_id, v.precedencia
HAVING count(DISTINCT v.competencia) > 1;

COMMENT ON VIEW fin_competencia_conflito_v IS
  'Transacoes N:N cujas evidencias de melhor precedencia apontam para datas diferentes. '
  'A coluna singular usa por convencao a evidencia de menor document/fiscal id; estes casos '
  'continuam explicitamente abertos para rateio ou trava humana, nunca como consenso falso.';

-- ---------------------------------------------------------------------------
-- 4. BACKFILL GLOBAL CONTINUA SENDO O REPARO E USA A MESMA DECISAO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_competencia_backfill(
  p_reavaliar_presumidas boolean DEFAULT true
) RETURNS TABLE (regra text, linhas bigint)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH alvo AS (
    SELECT t.id
      FROM fin_transaction t
     WHERE NOT ('competence_date' = ANY (t.human_locked_fields))
       AND (t.competence_date IS NULL
            OR t.competence_rule IS NULL
            OR (p_reavaliar_presumidas
                AND t.competence_rule = 'competencia_presumida_caixa'))
  ),
  decidido AS (
    SELECT t.id, d.regra, d.competencia
      FROM alvo
      JOIN fin_transaction t ON t.id = alvo.id
      CROSS JOIN LATERAL fin_competencia_decidir(t.id) d
  ),
  aplicado AS (
    UPDATE fin_transaction t
       SET competence_rule = d.regra,
           competence_date = d.competencia,
           updated_at = now()
      FROM decidido d
     WHERE t.id = d.id
       AND (t.competence_rule IS DISTINCT FROM d.regra
            OR t.competence_date IS DISTINCT FROM d.competencia)
     RETURNING d.regra
  )
  SELECT a.regra::text, count(*)::bigint
    FROM aplicado a
   GROUP BY a.regra;

  -- Itens de cartao mantem exatamente a decisao da 0071. Eles ja nascem pela
  -- importacao de fatura, e nao ganham settlement/documento posteriormente.
  RETURN QUERY
  WITH aplicado AS (
    UPDATE fin_card_transaction ct
       SET competence_rule = CASE
             WHEN ct.kind = 'pagamento_fatura' THEN 'cartao_pagamento_fatura'
             WHEN ct.purchase_date IS NOT NULL THEN 'cartao_data_compra'
             ELSE 'cartao_data_lancamento'
           END,
           competence_date = COALESCE(ct.purchase_date, ct.posted_on),
           updated_at = now()
     WHERE NOT ('competence_date' = ANY (ct.human_locked_fields))
       AND (ct.competence_date IS DISTINCT FROM COALESCE(ct.purchase_date, ct.posted_on)
            OR ct.competence_rule IS NULL)
     RETURNING CASE
       WHEN ct.kind = 'pagamento_fatura' THEN 'cartao_pagamento_fatura'
       WHEN ct.purchase_date IS NOT NULL THEN 'cartao_data_compra'
       ELSE 'cartao_data_lancamento'
     END AS regra
  )
  SELECT a.regra::text, count(*)::bigint
    FROM aplicado a
   GROUP BY a.regra;
END;
$$;

COMMENT ON FUNCTION fin_competencia_backfill(boolean) IS
  'Reparo global idempotente. Usa a mesma decisao dos gatilhos, reavalia '
  'presumidas por padrao e nunca toca competence_date travada por humano.';

-- Repara a janela aberta entre a ultima importacao e esta migration. A
-- presuncao existente tambem e promovida se ja houver evidencia ligada.
DO $$
DECLARE
  v_sem_competencia bigint;
BEGIN
  PERFORM * FROM fin_competencia_backfill(true);

  SELECT count(*) INTO v_sem_competencia
    FROM fin_transaction t
   WHERE t.competence_date IS NULL
     AND NOT ('competence_date' = ANY (t.human_locked_fields));

  IF v_sem_competencia > 0 THEN
    RAISE EXCEPTION
      'ciclo de vida deixou % transacoes elegiveis sem competencia',
      v_sem_competencia;
  END IF;
END $$;

-- A regra de fallback e total e o BEFORE INSERT preenche o par antes mesmo do
-- RETURNING. Transformar essa promessa em constraint impede que um futuro
-- importador que desabilite/renomeie o gatilho reabra a lacuna silenciosamente.
ALTER TABLE fin_transaction
  ALTER COLUMN competence_date SET NOT NULL,
  ALTER COLUMN competence_rule SET NOT NULL;

ALTER TABLE fin_card_transaction
  ALTER COLUMN competence_date SET NOT NULL,
  ALTER COLUMN competence_rule SET NOT NULL;
