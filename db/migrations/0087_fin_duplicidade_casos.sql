-- Repeticao visual deixa de ser tratada como dinheiro duplicado.
--
-- O monitor M12 agrupava (conta, data, valor, descricao normalizada) e chamava
-- toda linha depois da primeira de "excedente". A assinatura e um bom detector
-- de algo que merece revisao, mas nao decide identidade economica: 18 PIX iguais
-- no mesmo dia podem ser 18 pagamentos reais, e foi exatamente o que o
-- endToEndId demonstrou no acervo atual.
--
-- Auditoria de 16/08/2026, antes desta migration:
--
--   54 assinaturas · 168 membros · 114 repeticoes · R$ 80.499,81 nominais
--   47 grupos distintos por evidencia ja persistida no banco
--    7 grupos do PDF Nubank aguardando o artefato original ficar duravel
--    0 duplicatas tecnicas comprovadas
--
-- Esta migration cria CASO + MEMBROS + EVENTOS e muda somente o significado do
-- monitor operacional. Nao apaga, nao neutraliza, nao altera um unico centavo e
-- nao cria uma view "efetiva" que consumidores possam usar pela metade. A
-- neutralizacao fica explicitamente guardada como INDISPONIVEL ate que todos os
-- consumidores monetarios migrem juntos em outra migration.

-- ---------------------------------------------------------------------------
-- 1. FUNCOES DE ASSINATURA VERSIONADA
-- ---------------------------------------------------------------------------
-- md5 nao e usado como prova de identidade ou seguranca. Ele apenas compacta a
-- assinatura para exibicao e para detectar mudanca de membros. As colunas que
-- formam a assinatura continuam armazenadas e protegidas por UNIQUE proprio.
CREATE OR REPLACE FUNCTION fin_duplicate_signature_v1(
  p_account_id bigint,
  p_posted_on date,
  p_amount_cents bigint,
  p_description_norm text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'sig-v1:' || md5(
    p_account_id::text || E'\x1f' ||
    p_posted_on::text || E'\x1f' ||
    p_amount_cents::text || E'\x1f' ||
    p_description_norm
  )
$$;

CREATE OR REPLACE FUNCTION fin_duplicate_members_fingerprint_v1(p_ids bigint[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'members-v1:' || md5(
    COALESCE((
      SELECT string_agg(x.id::text, ',' ORDER BY x.id)
        FROM unnest(COALESCE(p_ids, '{}'::bigint[])) AS x(id)
    ), '')
  )
$$;

COMMENT ON FUNCTION fin_duplicate_signature_v1(bigint, date, bigint, text) IS
  'Assinatura visual v1 do M12. Detecta caso para revisao; nunca prova duplicidade.';

COMMENT ON FUNCTION fin_duplicate_members_fingerprint_v1(bigint[]) IS
  'Fingerprint ordenado dos membros atuais. Mudou o conjunto, o caso revisado reabre.';

-- ---------------------------------------------------------------------------
-- 2. CASO, MEMBROS E TRILHA APPEND-ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE fin_duplicate_case (
  id                           bigserial PRIMARY KEY,
  entity_id                    bigint NOT NULL REFERENCES fin_entity(id),
  account_id                   bigint NOT NULL,
  signature_version            smallint NOT NULL DEFAULT 1 CHECK (signature_version = 1),
  signature_fingerprint        text NOT NULL CHECK (signature_fingerprint ~ '^sig-v1:[0-9a-f]{32}$'),
  posted_on                    date NOT NULL,
  amount_cents                 bigint NOT NULL,
  description_norm             text NOT NULL,

  member_count                 integer NOT NULL CHECK (member_count >= 0),
  member_fingerprint           text NOT NULL CHECK (member_fingerprint ~ '^members-v1:[0-9a-f]{32}$'),

  workflow_status              text NOT NULL CHECK (workflow_status IN (
                                  'novo', 'reaberto', 'aguardando_evidencia', 'revisado'
                                )),
  verdict                      text CHECK (verdict IN (
                                  'transacoes_distintas', 'duplicata_tecnica', 'misto', 'indeterminado'
                                )),
  evidence_strength            text CHECK (evidence_strength IN ('limitada', 'forte')),
  evidence                     jsonb NOT NULL DEFAULT '{}'::jsonb
                               CHECK (jsonb_typeof(evidence) = 'object'),

  reviewed_member_fingerprint  text CHECK (
                                  reviewed_member_fingerprint IS NULL OR
                                  reviewed_member_fingerprint ~ '^members-v1:[0-9a-f]{32}$'
                                ),
  reviewed_at                  timestamptz,
  reviewed_by                  text,
  first_detected_at            timestamptz NOT NULL DEFAULT now(),
  last_detected_at             timestamptz NOT NULL DEFAULT now(),
  created_by                   text NOT NULL,
  last_actor                   text NOT NULL,
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (account_id, entity_id) REFERENCES fin_account(id, entity_id),
  UNIQUE (account_id, signature_version, posted_on, amount_cents, description_norm),
  UNIQUE (account_id, signature_version, signature_fingerprint),

  -- Um veredito so vale para o conjunto que foi efetivamente revisado. Caso a
  -- fingerprint mude, fin_duplicate_cases_refresh limpa a decisao e reabre.
  CHECK (
    (workflow_status = 'revisado' AND verdict IS NOT NULL
      AND evidence_strength IS NOT NULL
      AND reviewed_member_fingerprint = member_fingerprint
      AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    OR
    (workflow_status <> 'revisado' AND verdict IS NULL
      AND reviewed_member_fingerprint IS NULL
      AND reviewed_at IS NULL AND reviewed_by IS NULL)
  )
);

COMMENT ON TABLE fin_duplicate_case IS
  'Caso de revisao por assinatura visual do M12. Repeticao e detector, nao veredito. '
  'workflow_status=revisado tira o caso do alarme somente enquanto a fingerprint dos membros nao muda.';

COMMENT ON COLUMN fin_duplicate_case.verdict IS
  'duplicata_tecnica significa duas representacoes locais do mesmo evento externo. '
  'Pagamento empresarial feito duas vezes tem dois eventos bancarios e continua como transacoes_distintas.';

CREATE INDEX fin_duplicate_case_workflow_idx
  ON fin_duplicate_case (workflow_status, last_detected_at DESC);

CREATE TABLE fin_duplicate_case_member (
  id                 bigserial PRIMARY KEY,
  case_id            bigint NOT NULL REFERENCES fin_duplicate_case(id) ON DELETE RESTRICT,
  -- transaction_ref_id preserva a identidade historica mesmo se a linha crua
  -- for legitimamente removida por reversao de lote. A FK fica nula pelo
  -- proprio DELETE e o gatilho por statement fecha o membro como nao atual.
  transaction_ref_id bigint NOT NULL,
  transaction_id     bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  is_current         boolean NOT NULL DEFAULT true,
  review_status      text NOT NULL DEFAULT 'pendente'
                     CHECK (review_status IN ('pendente', 'confirmado_distinto', 'suspeito_tecnico')),
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(evidence) = 'object'),
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  removed_at         timestamptz,
  UNIQUE (case_id, transaction_ref_id),
  CHECK ((is_current AND removed_at IS NULL) OR (NOT is_current AND removed_at IS NOT NULL))
);

CREATE UNIQUE INDEX fin_duplicate_member_current_tx_idx
  ON fin_duplicate_case_member (transaction_id) WHERE is_current;
CREATE INDEX fin_duplicate_member_case_idx
  ON fin_duplicate_case_member (case_id, is_current, transaction_id);

COMMENT ON TABLE fin_duplicate_case_member IS
  'Membros observados do caso, inclusive os que deixaram de pertencer a assinatura. '
  'Nenhum status desta tabela altera o efeito monetario de fin_transaction.';

CREATE TABLE fin_duplicate_case_event (
  id                  bigserial PRIMARY KEY,
  case_id             bigint NOT NULL REFERENCES fin_duplicate_case(id) ON DELETE RESTRICT,
  event_kind          text NOT NULL CHECK (event_kind IN (
                        'detectado', 'reaberto', 'aguardando_evidencia', 'revisado', 'atualizado'
                      )),
  member_fingerprint  text NOT NULL,
  before_state        jsonb,
  after_state         jsonb NOT NULL,
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor               text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_duplicate_case_event_case_idx
  ON fin_duplicate_case_event (case_id, created_at DESC, id DESC);

COMMENT ON TABLE fin_duplicate_case_event IS
  'Trilha append-only das deteccoes, reaberturas e revisoes. Desfazer uma decisao '
  'futura cria novo evento; nunca apaga o anterior.';

CREATE OR REPLACE FUNCTION fin_duplicate_case_event_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_after := jsonb_build_object(
    'workflow_status', NEW.workflow_status,
    'verdict', NEW.verdict,
    'evidence_strength', NEW.evidence_strength,
    'member_count', NEW.member_count,
    'member_fingerprint', NEW.member_fingerprint
  );

  IF TG_OP = 'INSERT' THEN
    v_kind := 'detectado';
    v_before := NULL;
  ELSE
    v_before := jsonb_build_object(
      'workflow_status', OLD.workflow_status,
      'verdict', OLD.verdict,
      'evidence_strength', OLD.evidence_strength,
      'member_count', OLD.member_count,
      'member_fingerprint', OLD.member_fingerprint
    );

    IF OLD.workflow_status IS NOT DISTINCT FROM NEW.workflow_status
       AND OLD.verdict IS NOT DISTINCT FROM NEW.verdict
       AND OLD.evidence_strength IS NOT DISTINCT FROM NEW.evidence_strength
       AND OLD.member_fingerprint IS NOT DISTINCT FROM NEW.member_fingerprint
       AND OLD.evidence IS NOT DISTINCT FROM NEW.evidence THEN
      RETURN NEW;
    END IF;

    v_kind := CASE
      WHEN NEW.workflow_status = 'reaberto' THEN 'reaberto'
      WHEN NEW.workflow_status = 'aguardando_evidencia' THEN 'aguardando_evidencia'
      WHEN NEW.workflow_status = 'revisado' THEN 'revisado'
      ELSE 'atualizado'
    END;
  END IF;

  INSERT INTO fin_duplicate_case_event (
    case_id, event_kind, member_fingerprint, before_state, after_state, evidence, actor
  ) VALUES (
    NEW.id, v_kind, NEW.member_fingerprint, v_before, v_after, NEW.evidence, NEW.last_actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER fin_duplicate_case_event_insert
AFTER INSERT ON fin_duplicate_case
FOR EACH ROW EXECUTE FUNCTION fin_duplicate_case_event_trigger();

CREATE TRIGGER fin_duplicate_case_event_update
AFTER UPDATE OF workflow_status, verdict, evidence_strength, member_fingerprint, evidence
ON fin_duplicate_case
FOR EACH ROW EXECUTE FUNCTION fin_duplicate_case_event_trigger();

CREATE OR REPLACE FUNCTION fin_duplicate_case_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fin_duplicate_case_event e append-only; % nao permitido', TG_OP;
END;
$$;

CREATE TRIGGER fin_duplicate_case_event_no_update_delete
BEFORE UPDATE OR DELETE ON fin_duplicate_case_event
FOR EACH ROW EXECUTE FUNCTION fin_duplicate_case_event_immutable();

CREATE TRIGGER fin_duplicate_case_event_no_truncate
BEFORE TRUNCATE ON fin_duplicate_case_event
FOR EACH STATEMENT EXECUTE FUNCTION fin_duplicate_case_event_immutable();

COMMENT ON FUNCTION fin_duplicate_case_event_immutable() IS
  'Guarda material da trilha append-only: recusa UPDATE, DELETE e TRUNCATE.';

-- ---------------------------------------------------------------------------
-- 3. ESTADO ATUAL E REFRESH IDEMPOTENTE
-- ---------------------------------------------------------------------------
CREATE VIEW fin_duplicate_case_current_state_v AS
SELECT c.id AS case_id,
       count(t.id)::integer AS member_count,
       COALESCE(array_agg(t.id ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL), '{}'::bigint[]) AS member_ids,
       fin_duplicate_members_fingerprint_v1(
         COALESCE(array_agg(t.id ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL), '{}'::bigint[])
       ) AS member_fingerprint
  FROM fin_duplicate_case c
  LEFT JOIN fin_transaction t
    ON t.account_id = c.account_id
   AND t.posted_on = c.posted_on
   AND t.amount_cents = c.amount_cents
   AND t.description_norm = c.description_norm
   AND NOT t.is_split_parent
   -- Filho de split e rateio contabil, nao uma linha independente do extrato.
   AND t.parent_id IS NULL
 GROUP BY c.id;

COMMENT ON VIEW fin_duplicate_case_current_state_v IS
  'Recalcula os membros diretamente do ledger cru. Nao usa nem cria qualquer filtro monetario.';

-- O refresh recebe poucas assinaturas em operacao normal. Este indice evita
-- que cada statement procure seus membros no ledger inteiro; description_norm
-- fica como filtro final para nao sujeitar o btree ao tamanho livre do texto.
CREATE INDEX fin_transaction_duplicate_lookup_idx
  ON fin_transaction (account_id, posted_on, amount_cents)
  WHERE NOT is_split_parent AND parent_id IS NULL;

-- Atualiza APENAS as assinaturas informadas. Os gatilhos por statement chamam
-- esta funcao uma vez por INSERT/UPDATE/DELETE, ainda que um import grave 10 mil
-- linhas. Assim, um membro novo reabre o caso no mesmo commit sem executar uma
-- varredura de 13,8 mil transacoes para cada linha.
CREATE OR REPLACE FUNCTION fin_duplicate_cases_refresh_signatures(
  p_keys jsonb,
  p_actor text
)
RETURNS TABLE (
  novos integer,
  reabertos integer,
  casos_tocados integer,
  membros_atuais integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_novos integer := 0;
  v_reabertos integer := 0;
BEGIN
  IF p_keys IS NULL OR jsonb_typeof(p_keys) <> 'array' THEN
    RAISE EXCEPTION 'fin_duplicate_cases_refresh_signatures exige array JSON';
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'fin_duplicate_cases_refresh_signatures exige ator nao vazio';
  END IF;

  IF jsonb_array_length(p_keys) = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  -- Um unico lock transacional serializa o lifecycle inteiro. Ele evita tanto
  -- caso ausente quanto overwrite de fingerprint entre statements concorrentes
  -- e custa uma entrada de pg_locks mesmo num import de milhares de linhas.
  -- Trade-off consciente: writes concorrentes no ledger esperam o commit do
  -- anterior; neste volume, corretude e memoria limitada vencem throughput.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('fin_duplicate_cases:lifecycle:v1', 8707)
  );

  -- So assinaturas informadas com duas ou mais linhas nascem como caso. Caso
  -- existente permanece historico mesmo se cair para zero/uma linha.
  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
     WHERE k.account_id IS NOT NULL
       AND k.posted_on IS NOT NULL
       AND k.amount_cents IS NOT NULL
       AND k.description_norm IS NOT NULL
  ), detectados AS (
    SELECT min(t.entity_id) AS entity_id,
           t.account_id,
           t.posted_on,
           t.amount_cents,
           t.description_norm,
           array_agg(t.id ORDER BY t.id) AS member_ids,
           count(*)::integer AS member_count
      FROM keys k
      JOIN fin_transaction t
        ON t.account_id = k.account_id
       AND t.posted_on = k.posted_on
       AND t.amount_cents = k.amount_cents
       AND t.description_norm = k.description_norm
     WHERE NOT t.is_split_parent
       AND t.parent_id IS NULL
     GROUP BY t.account_id, t.posted_on, t.amount_cents, t.description_norm
    HAVING count(*) > 1
  )
  INSERT INTO fin_duplicate_case (
    entity_id, account_id, signature_version, signature_fingerprint,
    posted_on, amount_cents, description_norm,
    member_count, member_fingerprint, workflow_status,
    evidence, created_by, last_actor
  )
  SELECT d.entity_id,
         d.account_id,
         1,
         fin_duplicate_signature_v1(d.account_id, d.posted_on, d.amount_cents, d.description_norm),
         d.posted_on,
         d.amount_cents,
         d.description_norm,
         d.member_count,
         fin_duplicate_members_fingerprint_v1(d.member_ids),
         'novo',
         jsonb_build_object('detector', 'conta+data+valor+descricao_norm', 'signature_version', 1),
         p_actor,
         p_actor
    FROM detectados d
  ON CONFLICT (account_id, signature_version, posted_on, amount_cents, description_norm)
  DO NOTHING;
  GET DIAGNOSTICS v_novos = ROW_COUNT;

  -- Conta quantas decisoes deixam de valer ANTES de atualizar. Caso novo que
  -- ganhou membro continua novo; revisado/aguardando vira explicitamente
  -- reaberto e perde o veredito associado a fingerprint antiga.
  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
  )
  SELECT count(*)::integer
    INTO v_reabertos
    FROM fin_duplicate_case c
    JOIN keys k
      ON k.account_id = c.account_id
     AND k.posted_on = c.posted_on
     AND k.amount_cents = c.amount_cents
     AND k.description_norm = c.description_norm
    JOIN fin_duplicate_case_current_state_v s ON s.case_id = c.id
   WHERE c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
     AND c.workflow_status IN ('revisado', 'aguardando_evidencia');

  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
  ), states AS (
    SELECT s.*
      FROM fin_duplicate_case c
      JOIN keys k
        ON k.account_id = c.account_id
       AND k.posted_on = c.posted_on
       AND k.amount_cents = c.amount_cents
       AND k.description_norm = c.description_norm
      JOIN fin_duplicate_case_current_state_v s ON s.case_id = c.id
  )
  UPDATE fin_duplicate_case c
     SET member_count = s.member_count,
         member_fingerprint = s.member_fingerprint,
         workflow_status = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN 'reaberto'
           ELSE c.workflow_status
         END,
         verdict = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN NULL
           ELSE c.verdict
         END,
         evidence_strength = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN NULL
           ELSE c.evidence_strength
         END,
         evidence = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN jsonb_build_object(
                    'motivo', 'conjunto de membros mudou; decisao anterior esta no evento de reabertura',
                    'previous_member_fingerprint', c.member_fingerprint,
                    'current_member_fingerprint', s.member_fingerprint
                  )
           ELSE c.evidence
         END,
         reviewed_member_fingerprint = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN NULL
           ELSE c.reviewed_member_fingerprint
         END,
         reviewed_at = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN NULL
           ELSE c.reviewed_at
         END,
         reviewed_by = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint
            AND c.workflow_status IN ('revisado', 'aguardando_evidencia')
             THEN NULL
           ELSE c.reviewed_by
         END,
         last_detected_at = CASE WHEN s.member_count > 1 THEN now() ELSE c.last_detected_at END,
         last_actor = p_actor,
         updated_at = CASE
           WHEN c.member_fingerprint IS DISTINCT FROM s.member_fingerprint THEN now()
           ELSE c.updated_at
         END
    FROM states s
   WHERE s.case_id = c.id;

  -- Membro que mudou de assinatura nao some da historia; apenas deixa de ser o
  -- membro atual daquele caso.
  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
  ), states AS (
    SELECT s.*
      FROM fin_duplicate_case c
      JOIN keys k
        ON k.account_id = c.account_id
       AND k.posted_on = c.posted_on
       AND k.amount_cents = c.amount_cents
       AND k.description_norm = c.description_norm
      JOIN fin_duplicate_case_current_state_v s ON s.case_id = c.id
  )
  UPDATE fin_duplicate_case_member m
     SET is_current = false,
         removed_at = now(),
         last_seen_at = now()
    FROM states s
   WHERE s.case_id = m.case_id
     AND m.is_current
     AND (m.transaction_id IS NULL OR NOT (m.transaction_id = ANY (s.member_ids)));

  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
  ), states AS (
    SELECT s.*
      FROM fin_duplicate_case c
      JOIN keys k
        ON k.account_id = c.account_id
       AND k.posted_on = c.posted_on
       AND k.amount_cents = c.amount_cents
       AND k.description_norm = c.description_norm
      JOIN fin_duplicate_case_current_state_v s ON s.case_id = c.id
  )
  INSERT INTO fin_duplicate_case_member (
    case_id, transaction_ref_id, transaction_id,
    is_current, review_status, first_seen_at, last_seen_at, removed_at
  )
  SELECT s.case_id, u.transaction_id, u.transaction_id,
         true, 'pendente', now(), now(), NULL
    FROM states s
    CROSS JOIN LATERAL unnest(s.member_ids) AS u(transaction_id)
  ON CONFLICT (case_id, transaction_ref_id) DO UPDATE
     SET transaction_id = EXCLUDED.transaction_id,
         is_current = true,
         last_seen_at = now(),
         removed_at = NULL;

  -- Uma fingerprint nova invalida a conclusao sobre o conjunto inteiro, nao so
  -- sobre o membro que acabou de chegar.
  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
  ), touched AS (
    SELECT c.id
      FROM fin_duplicate_case c
      JOIN keys k
        ON k.account_id = c.account_id
       AND k.posted_on = c.posted_on
       AND k.amount_cents = c.amount_cents
       AND k.description_norm = c.description_norm
  )
  UPDATE fin_duplicate_case_member m
     SET review_status = 'pendente',
         evidence = '{}'::jsonb,
         last_seen_at = now()
    FROM fin_duplicate_case c
    JOIN touched x ON x.id = c.id
   WHERE c.id = m.case_id
     AND m.is_current
     AND c.workflow_status IN ('novo', 'reaberto', 'aguardando_evidencia')
     AND (m.review_status <> 'pendente' OR m.evidence <> '{}'::jsonb);

  RETURN QUERY
  WITH keys AS (
    SELECT DISTINCT k.account_id, k.posted_on, k.amount_cents, k.description_norm
      FROM jsonb_to_recordset(p_keys) AS k(
        account_id bigint,
        posted_on date,
        amount_cents bigint,
        description_norm text
      )
  ), touched AS (
    SELECT c.id
      FROM fin_duplicate_case c
      JOIN keys k
        ON k.account_id = c.account_id
       AND k.posted_on = c.posted_on
       AND k.amount_cents = c.amount_cents
       AND k.description_norm = c.description_norm
  )
  SELECT v_novos,
         v_reabertos,
         count(*)::integer,
         COALESCE(sum(c.member_count), 0)::integer
    FROM fin_duplicate_case c
    JOIN touched x ON x.id = c.id;
END;
$$;

COMMENT ON FUNCTION fin_duplicate_cases_refresh_signatures(jsonb, text) IS
  'Refresh direcionado das assinaturas afetadas. E o caminho dos gatilhos por statement; '
  'nunca faz scan global por linha importada.';

-- Varredura explicita para seed, manutencao e teste de ponto fixo. Ela monta a
-- lista uma vez e delega ao mesmo caminho direcionado dos gatilhos.
CREATE OR REPLACE FUNCTION fin_duplicate_cases_refresh(
  p_actor text DEFAULT 'system:duplicate-case-refresh'
)
RETURNS TABLE (
  novos integer,
  reabertos integer,
  casos integer,
  membros_atuais integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_keys jsonb;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'fin_duplicate_cases_refresh exige ator nao vazio';
  END IF;

  WITH signatures AS (
    SELECT c.account_id, c.posted_on, c.amount_cents, c.description_norm
      FROM fin_duplicate_case c
    UNION
    SELECT t.account_id, t.posted_on, t.amount_cents, t.description_norm
      FROM fin_transaction t
     WHERE NOT t.is_split_parent AND t.parent_id IS NULL
     GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'account_id', s.account_id,
             'posted_on', s.posted_on,
             'amount_cents', s.amount_cents,
             'description_norm', s.description_norm
           )),
           '[]'::jsonb
         )
    INTO v_keys
    FROM signatures s;

  RETURN QUERY
  SELECT r.novos, r.reabertos, r.casos_tocados, r.membros_atuais
    FROM fin_duplicate_cases_refresh_signatures(v_keys, p_actor) r;
END;
$$;

COMMENT ON FUNCTION fin_duplicate_cases_refresh(text) IS
  'Detecta assinaturas repetidas, sincroniza membros e reabre decisoes cuja fingerprint mudou. '
  'Idempotente e sem qualquer efeito sobre somas ou inclusao no ledger.';

-- ---------------------------------------------------------------------------
-- 3a. CICLO DE VIDA AUTOMATICO, UMA CHAMADA POR STATEMENT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_duplicate_tx_insert_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_keys jsonb;
  v_actor text;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'account_id', x.account_id,
           'posted_on', x.posted_on,
           'amount_cents', x.amount_cents,
           'description_norm', x.description_norm
         )), '[]'::jsonb)
    INTO v_keys
    FROM (
      SELECT DISTINCT account_id, posted_on, amount_cents, description_norm
        FROM new_duplicate_rows
       WHERE NOT is_split_parent AND parent_id IS NULL
    ) x;

  IF jsonb_array_length(v_keys) = 0 THEN RETURN NULL; END IF;
  v_actor := COALESCE(NULLIF(current_setting('app.actor', true), ''), 'trigger:fin_transaction:insert');
  PERFORM fin_duplicate_cases_refresh_signatures(v_keys, v_actor);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fin_duplicate_tx_delete_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_keys jsonb;
  v_actor text;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'account_id', x.account_id,
           'posted_on', x.posted_on,
           'amount_cents', x.amount_cents,
           'description_norm', x.description_norm
         )), '[]'::jsonb)
    INTO v_keys
    FROM (
      SELECT DISTINCT account_id, posted_on, amount_cents, description_norm
        FROM old_duplicate_rows
       WHERE NOT is_split_parent AND parent_id IS NULL
    ) x;

  IF jsonb_array_length(v_keys) = 0 THEN RETURN NULL; END IF;
  v_actor := COALESCE(NULLIF(current_setting('app.actor', true), ''), 'trigger:fin_transaction:delete');
  PERFORM fin_duplicate_cases_refresh_signatures(v_keys, v_actor);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fin_duplicate_tx_update_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_keys jsonb;
  v_actor text;
BEGIN
  -- UPDATE de categoria, competencia ou conciliacao nao toca a assinatura e
  -- termina aqui. So mudanca de conta/data/valor/texto/split entra na fila.
  WITH changed AS (
    SELECT o.account_id AS old_account_id,
           o.posted_on AS old_posted_on,
           o.amount_cents AS old_amount_cents,
           o.description_norm AS old_description_norm,
           o.is_split_parent AS old_is_split_parent,
           o.parent_id AS old_parent_id,
           n.account_id AS new_account_id,
           n.posted_on AS new_posted_on,
           n.amount_cents AS new_amount_cents,
           n.description_norm AS new_description_norm,
           n.is_split_parent AS new_is_split_parent,
           n.parent_id AS new_parent_id
      FROM old_duplicate_rows o
      JOIN new_duplicate_rows n ON n.id = o.id
     WHERE ROW(o.account_id, o.posted_on, o.amount_cents, o.description_norm,
               o.is_split_parent, o.parent_id)
           IS DISTINCT FROM
           ROW(n.account_id, n.posted_on, n.amount_cents, n.description_norm,
               n.is_split_parent, n.parent_id)
  ), affected AS (
    SELECT old_account_id AS account_id,
           old_posted_on AS posted_on,
           old_amount_cents AS amount_cents,
           old_description_norm AS description_norm
      FROM changed
     WHERE NOT old_is_split_parent AND old_parent_id IS NULL
    UNION
    SELECT new_account_id, new_posted_on, new_amount_cents, new_description_norm
      FROM changed
     WHERE NOT new_is_split_parent AND new_parent_id IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'account_id', a.account_id,
           'posted_on', a.posted_on,
           'amount_cents', a.amount_cents,
           'description_norm', a.description_norm
         )), '[]'::jsonb)
    INTO v_keys
    FROM affected a;

  IF jsonb_array_length(v_keys) = 0 THEN RETURN NULL; END IF;
  v_actor := COALESCE(NULLIF(current_setting('app.actor', true), ''), 'trigger:fin_transaction:update');
  PERFORM fin_duplicate_cases_refresh_signatures(v_keys, v_actor);
  RETURN NULL;
END;
$$;

CREATE TRIGGER fin_duplicate_tx_insert_stmt
AFTER INSERT ON fin_transaction
REFERENCING NEW TABLE AS new_duplicate_rows
FOR EACH STATEMENT EXECUTE FUNCTION fin_duplicate_tx_insert_statement();

CREATE TRIGGER fin_duplicate_tx_delete_stmt
AFTER DELETE ON fin_transaction
REFERENCING OLD TABLE AS old_duplicate_rows
FOR EACH STATEMENT EXECUTE FUNCTION fin_duplicate_tx_delete_statement();

-- Sem lista UPDATE OF porque PostgreSQL nao permite transition tables junto de
-- coluna-lista. A funcao compara old/new e sai sem consulta ao ledger quando a
-- assinatura nao mudou.
CREATE TRIGGER fin_duplicate_tx_update_stmt
AFTER UPDATE ON fin_transaction
REFERENCING OLD TABLE AS old_duplicate_rows NEW TABLE AS new_duplicate_rows
FOR EACH STATEMENT EXECUTE FUNCTION fin_duplicate_tx_update_statement();

-- ---------------------------------------------------------------------------
-- 4. VISOES DE FILA E MONITOR
-- ---------------------------------------------------------------------------
CREATE VIEW fin_duplicate_case_v AS
SELECT c.*,
       GREATEST(c.member_count - 1, 0) AS repeated_count,
       abs(c.amount_cents) * GREATEST(c.member_count - 1, 0)::bigint AS exposure_cents,
       COALESCE(
         array_agg(m.transaction_id ORDER BY m.transaction_id) FILTER (WHERE m.is_current),
         '{}'::bigint[]
       ) AS current_transaction_ids
  FROM fin_duplicate_case c
  LEFT JOIN fin_duplicate_case_member m ON m.case_id = c.id
 GROUP BY c.id;

COMMENT ON VIEW fin_duplicate_case_v IS
  'Fila dos casos M12. exposure_cents e valor nominal para revisao, nunca afirmacao de saldo inflado.';

CREATE VIEW fin_duplicate_monitor_v AS
WITH raw_groups AS (
  SELECT t.account_id,
         t.posted_on,
         t.amount_cents,
         t.description_norm,
         count(*)::integer AS n
    FROM fin_transaction t
   WHERE NOT t.is_split_parent
     AND t.parent_id IS NULL
   GROUP BY 1, 2, 3, 4
  HAVING count(*) > 1
), raw AS (
  SELECT count(*)::integer AS raw_groups,
         COALESCE(sum(n), 0)::bigint AS raw_members,
         COALESCE(sum(n - 1), 0)::bigint AS raw_repeated,
         COALESCE(sum(abs(amount_cents) * (n - 1)), 0)::bigint AS raw_cents
    FROM raw_groups
), untracked AS (
  -- Dois INSERTs concorrentes podem, sob READ COMMITTED, observar uma linha
  -- cada e terminar sem criar o caso. O proximo refresh corrige, mas ate la a
  -- corrida precisa ficar vermelha em vez de desaparecer do M12 operacional.
  SELECT count(*)::integer AS untracked_raw_cases,
         COALESCE(sum(rg.n - 1), 0)::bigint AS untracked_raw_repeated,
         COALESCE(sum(abs(rg.amount_cents) * (rg.n - 1)), 0)::bigint AS untracked_raw_cents
    FROM raw_groups rg
    LEFT JOIN fin_duplicate_case c
      ON c.account_id = rg.account_id
     AND c.signature_version = 1
     AND c.posted_on = rg.posted_on
     AND c.amount_cents = rg.amount_cents
     AND c.description_norm = rg.description_norm
   WHERE c.id IS NULL
), stale AS (
  -- Segundo fail-safe: o caso existe, mas uma corrida/isolation snapshot pode
  -- ter deixado a decisao revisada sobre uma fingerprint antiga.
  SELECT count(*)::integer AS stale_tracked_cases,
         COALESCE(sum(GREATEST(s.member_count - 1, 0)), 0)::bigint AS stale_tracked_repeated,
         COALESCE(sum(abs(c.amount_cents) * GREATEST(s.member_count - 1, 0)), 0)::bigint
           AS stale_tracked_cents
    FROM fin_duplicate_case c
    JOIN fin_duplicate_case_current_state_v s ON s.case_id = c.id
   WHERE c.workflow_status IN ('revisado', 'aguardando_evidencia')
     AND (c.member_count IS DISTINCT FROM s.member_count
       OR c.member_fingerprint IS DISTINCT FROM s.member_fingerprint)
), cases AS (
  SELECT count(*) FILTER (WHERE workflow_status IN ('novo', 'reaberto') AND member_count > 1)::integer
           AS tracked_unreviewed_cases,
         COALESCE(sum(GREATEST(member_count - 1, 0)) FILTER (
           WHERE workflow_status IN ('novo', 'reaberto') AND member_count > 1
         ), 0)::bigint AS tracked_unreviewed_repeated,
         COALESCE(sum(abs(amount_cents) * GREATEST(member_count - 1, 0)) FILTER (
           WHERE workflow_status IN ('novo', 'reaberto') AND member_count > 1
         ), 0)::bigint AS tracked_unreviewed_cents,
         count(*) FILTER (WHERE workflow_status = 'aguardando_evidencia' AND member_count > 1)::integer
           AS awaiting_evidence_cases,
         COALESCE(sum(GREATEST(member_count - 1, 0)) FILTER (
           WHERE workflow_status = 'aguardando_evidencia' AND member_count > 1
         ), 0)::bigint AS awaiting_evidence_repeated,
         COALESCE(sum(abs(amount_cents) * GREATEST(member_count - 1, 0)) FILTER (
           WHERE workflow_status = 'aguardando_evidencia' AND member_count > 1
         ), 0)::bigint AS awaiting_evidence_cents,
         count(*) FILTER (WHERE workflow_status = 'revisado'
                           AND verdict = 'transacoes_distintas')::integer AS reviewed_distinct_cases,
         count(*) FILTER (WHERE workflow_status = 'revisado'
                           AND verdict IN ('duplicata_tecnica', 'misto'))::integer AS technical_verdict_cases
    FROM fin_duplicate_case
)
SELECT raw.*,
       cases.tracked_unreviewed_cases,
       cases.tracked_unreviewed_repeated,
       cases.tracked_unreviewed_cents,
       untracked.untracked_raw_cases,
       untracked.untracked_raw_repeated,
       untracked.untracked_raw_cents,
       stale.stale_tracked_cases,
       stale.stale_tracked_repeated,
       stale.stale_tracked_cents,
       cases.tracked_unreviewed_cases + untracked.untracked_raw_cases
         + stale.stale_tracked_cases AS unreviewed_cases,
       cases.tracked_unreviewed_repeated + untracked.untracked_raw_repeated
         + stale.stale_tracked_repeated AS unreviewed_repeated,
       cases.tracked_unreviewed_cents + untracked.untracked_raw_cents
         + stale.stale_tracked_cents AS unreviewed_cents,
       cases.awaiting_evidence_cases,
       cases.awaiting_evidence_repeated,
       cases.awaiting_evidence_cents,
       cases.reviewed_distinct_cases,
       cases.technical_verdict_cases
  FROM raw CROSS JOIN cases CROSS JOIN untracked CROSS JOIN stale;

COMMENT ON VIEW fin_duplicate_monitor_v IS
  'M12 bruto permanece diagnostico. O M12 operacional conta somente novo/reaberto; '
  'tambem conta grupo bruto sem caso e caso revisado com fingerprint stale. '
  'aguardando_evidencia fica separado e repeticao revisada legitima nao volta a alarmar.';

-- ---------------------------------------------------------------------------
-- 5. GUARDA EXPLICITA: NENHUMA NEUTRALIZACAO EXISTE NESTA MIGRATION
-- ---------------------------------------------------------------------------
CREATE VIEW fin_duplicate_ledger_guard_v AS
SELECT false AS neutralization_enabled,
       0::bigint AS active_resolutions,
       '0087 apenas revisa identidade. Nao existe tabela, coluna ou view que exclua '
       'transacoes do ledger. Habilitar exige migration futura que mova TODOS os '
       'consumidores monetarios para uma visao efetiva e prove os totais antes/depois.'::text AS reason;

COMMENT ON VIEW fin_duplicate_ledger_guard_v IS
  'Guarda nao configuravel. Impede confundir caso revisado com dinheiro neutralizado.';

-- ---------------------------------------------------------------------------
-- 6. DETECCAO E SEED CONSERVADOR DO ACERVO ATUAL
-- ---------------------------------------------------------------------------
SELECT * FROM fin_duplicate_cases_refresh('migration-0087');

-- Evidencia forte que ja vive no banco. A regra e deliberadamente especifica
-- por fonte; source_id diferente em uma fonte futura nao vira prova por analogia.
WITH member_evidence AS (
  SELECT c.id AS case_id,
         count(*)::integer AS n,
         count(t.source_id)::integer AS source_ids,
         count(DISTINCT t.source_id)::integer AS distinct_source_ids,
         count(t.end_to_end_id)::integer AS e2e_ids,
         count(DISTINCT t.end_to_end_id)::integer AS distinct_e2e_ids,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM fin_import_row ir WHERE ir.transaction_id = t.id
         ))::integer AS import_rows,
         bool_and(t.source = 'asaas') AS all_asaas,
         bool_and(t.source = 'inter_api') AS all_inter,
         bool_and(t.source = 'erp_obras') AS all_erp,
         bool_and(t.source = 'polp') AS all_polp,
         bool_and(COALESCE(t.lastro_match = 'grupo_homogeneo', false)) AS all_homogeneous,
         bool_and(t.source_kind = 'PIX') AS all_pix,
         min(t.import_batch_id) AS min_batch,
         max(t.import_batch_id) AS max_batch
    FROM fin_duplicate_case c
    JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.is_current
    JOIN fin_transaction t ON t.id = m.transaction_id
   GROUP BY c.id
), proof AS (
  SELECT me.*,
         CASE
           WHEN all_asaas AND source_ids = n AND distinct_source_ids = n
             THEN 'asaas_financial_transaction_id_distintos'
           WHEN all_inter AND source_ids = n AND distinct_source_ids = n
                AND (NOT all_pix OR (e2e_ids = n AND distinct_e2e_ids = n))
             THEN 'inter_ids_estaveis_e_e2e_distintos'
           WHEN all_erp AND source_ids = n AND distinct_source_ids = n AND all_homogeneous
             THEN 'erp_linha_key_e_contagem_polp'
           WHEN all_polp AND source_ids = n AND distinct_source_ids = n
             THEN 'espelho_polp_ids_distintos'
           WHEN all_homogeneous AND import_rows = n
                AND min_batch = 10 AND max_batch = 10
             THEN 'pdf_com_contagem_homogenea_no_polp'
           ELSE NULL
         END AS proof_kind
    FROM member_evidence me
)
UPDATE fin_duplicate_case c
   SET workflow_status = 'revisado',
       verdict = 'transacoes_distintas',
       evidence_strength = 'forte',
       evidence = jsonb_build_object(
         'proof_kind', p.proof_kind,
         'source_ids', p.source_ids,
         'distinct_source_ids', p.distinct_source_ids,
         'end_to_end_ids', p.e2e_ids,
         'distinct_end_to_end_ids', p.distinct_e2e_ids,
         'import_rows', p.import_rows,
         'basis', 'ids externos diferentes provam eventos bancarios distintos; repeticao visual nao neutraliza caixa'
       ),
       reviewed_member_fingerprint = c.member_fingerprint,
       reviewed_at = now(),
       reviewed_by = 'migration-0087',
       last_actor = 'migration-0087',
       updated_at = now()
  FROM proof p
 WHERE p.case_id = c.id
   AND p.proof_kind IS NOT NULL
   AND c.workflow_status = 'novo';

UPDATE fin_duplicate_case_member m
   SET review_status = 'confirmado_distinto',
       evidence = jsonb_build_object('inherited_from_case', c.id),
       last_seen_at = now()
  FROM fin_duplicate_case c
 WHERE c.id = m.case_id
   AND m.is_current
   AND c.workflow_status = 'revisado'
   AND c.verdict = 'transacoes_distintas';

-- Os sete casos restantes foram conferidos no PDF cujo SHA esta no lote 10,
-- mas raw_artifact_key ainda e NULL. Eles ficam fora do M12 operacional e
-- aparecem no M12E; o script arquivar-nubank-pdf.mjs so os revisa depois de
-- reler o binario, conferir SHA/tamanho e grava-lo em xpe_artifacts.
WITH waiting AS (
  SELECT c.id,
         array_agg(ir.row_number ORDER BY ir.row_number) AS row_numbers
    FROM fin_duplicate_case c
    JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.is_current
    JOIN fin_transaction t ON t.id = m.transaction_id
    JOIN fin_import_row ir ON ir.transaction_id = t.id AND ir.batch_id = 10
   WHERE c.workflow_status = 'novo'
   GROUP BY c.id
  HAVING count(*) = c.member_count
)
UPDATE fin_duplicate_case c
   SET workflow_status = 'aguardando_evidencia',
       evidence_strength = 'limitada',
       evidence = jsonb_build_object(
         'proof_kind', 'nubank_pdf_aguardando_arquivo_duravel',
         'batch_id', 10,
         'expected_sha256', '75eee8665ccfbf7d1c36fd921e60dbe93d6392b6a802d50b232f701aad2fbf7c',
         'row_numbers', to_jsonb(w.row_numbers),
         'reason', 'fin_import_row preserva as ocorrencias, mas fin_import_batch.raw_artifact_key ainda esta nulo'
       ),
       last_actor = 'migration-0087',
       updated_at = now()
  FROM waiting w
 WHERE w.id = c.id;

-- ---------------------------------------------------------------------------
-- 7. ASSERTIVAS ESTRUTURAIS, SEM CONGELAR O BANCO NUM NUMERO DE 16/08
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans integer;
  v_stale integer;
  v_guard record;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM fin_duplicate_case_member m
    LEFT JOIN fin_duplicate_case c ON c.id = m.case_id
    LEFT JOIN fin_transaction t ON t.id = m.transaction_id
   WHERE c.id IS NULL
      OR (m.is_current AND (m.transaction_id IS NULL OR t.id IS NULL));
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION '0087: % membro(s) orfao(s)', v_orphans;
  END IF;

  SELECT count(*) INTO v_stale
    FROM fin_duplicate_case c
    JOIN fin_duplicate_case_current_state_v s ON s.case_id = c.id
   WHERE c.member_count IS DISTINCT FROM s.member_count
      OR c.member_fingerprint IS DISTINCT FROM s.member_fingerprint;
  IF v_stale <> 0 THEN
    RAISE EXCEPTION '0087: % caso(s) nasceram com fingerprint divergente', v_stale;
  END IF;

  SELECT * INTO v_guard FROM fin_duplicate_ledger_guard_v;
  IF v_guard.neutralization_enabled OR v_guard.active_resolutions <> 0 THEN
    RAISE EXCEPTION '0087: guarda monetaria nasceu habilitada';
  END IF;
END;
$$;
