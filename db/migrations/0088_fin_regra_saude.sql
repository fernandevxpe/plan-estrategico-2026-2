-- Saúde e memória das regras de classificação.
--
-- Esta migration corrige quatro problemas diferentes, sem reclassificar um
-- único fato financeiro:
--
--   1. hits_count contava somente fin_transaction. As 23 regras de documento
--      apareciam mortas mesmo explicando 2.617 recebíveis;
--   2. editar uma fin_rule reescrevia silenciosamente a explicação de tudo
--      que ela classificou. A partir daqui a definição aplicada é imutável;
--   3. "zero hit" não distinguia regra quebrada, fonte ausente e sombra de
--      prioridade. Asserções datadas passam a declarar essa diferença;
--   4. duas regras criadas pelo qualificar-cli jamais poderiam casar, porque
--      guardaram o nome cru onde o motor sempre usa normalizeName(). Ambas já
--      têm substitutas mais fortes e são arquivadas com trilha.
--
-- NÃO há UPDATE em category_id, nucleo, classified_rule_id ou qualquer valor
-- monetário. O Inter não é reclassificado.

-- ==========================================================================
-- 1. VERSÃO IMUTÁVEL DA DEFINIÇÃO
-- ==========================================================================

CREATE OR REPLACE FUNCTION fin_rule_definition_payload(p_rule fin_rule)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'entity_id',   p_rule.entity_id,
    'slug',        p_rule.slug,
    'name',        p_rule.name,
    'priority',    p_rule.priority,
    'match_scope', p_rule.match_scope,
    'conditions',  p_rule.conditions,
    'actions',     p_rule.actions,
    'confidence',  p_rule.confidence,
    'source',      p_rule.source,
    'status',      p_rule.status
  )
$$;

COMMENT ON FUNCTION fin_rule_definition_payload(fin_rule) IS
  'Forma canônica do comportamento de uma regra. Exclui hits_count, last_hit_at, '
  'updated_at, notes e autoria: telemetria e texto editorial não criam versão.';

CREATE TABLE fin_rule_version (
  id                     bigserial PRIMARY KEY,
  rule_id                bigint NOT NULL REFERENCES fin_rule(id) ON DELETE RESTRICT,
  version_no             integer NOT NULL CHECK (version_no > 0),
  definition             jsonb NOT NULL,
  definition_fingerprint char(32) NOT NULL,
  change_kind            text NOT NULL CHECK (change_kind IN ('baseline', 'criacao', 'definicao')),
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, version_no),
  UNIQUE (id, rule_id),
  CHECK (definition_fingerprint = md5(definition::text))
);

COMMENT ON TABLE fin_rule_version IS
  'Versões append-only da definição aplicada. O fingerprint detecta deriva; '
  'a prova forte é o próprio payload jsonb, preservado integralmente.';

INSERT INTO fin_rule_version
  (rule_id, version_no, definition, definition_fingerprint, change_kind, created_by, created_at)
SELECT r.id,
       1,
       fin_rule_definition_payload(r),
       md5(fin_rule_definition_payload(r)::text),
       'baseline',
       'migration-0088',
       now()
  FROM fin_rule r;

-- Não há ponteiro fin_rule.current_version_id. Ele criaria uma FK circular e,
-- pior, faria INSERT de nova regra depender de uma versão que só pode nascer
-- DEPOIS que a própria regra existe. A versão corrente é derivada pelo maior
-- version_no, uma ordem imutável e única por regra.
CREATE OR REPLACE FUNCTION fin_rule_current_version_id(p_rule_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT v.id
    FROM fin_rule_version v
   WHERE v.rule_id = p_rule_id
   ORDER BY v.version_no DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION fin_rule_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fin_rule_version é append-only: publique nova versão em vez de alterar/apagar';
END $$;

CREATE TRIGGER fin_rule_version_immutable
  BEFORE UPDATE OR DELETE ON fin_rule_version
  FOR EACH ROW EXECUTE FUNCTION fin_rule_version_immutable();

CREATE OR REPLACE FUNCTION fin_rule_versiona_definicao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_definition jsonb;
  v_version_no integer;
  v_actor text;
BEGIN
  v_definition := fin_rule_definition_payload(NEW);

  IF TG_OP = 'UPDATE'
     AND v_definition = fin_rule_definition_payload(OLD) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1
    INTO v_version_no
    FROM fin_rule_version
   WHERE rule_id = NEW.id;

  v_actor := COALESCE(
    NULLIF(current_setting('fin.actor', true), ''),
    NULLIF(NEW.created_by, ''),
    current_user
  );

  INSERT INTO fin_rule_version
    (rule_id, version_no, definition, definition_fingerprint,
     change_kind, created_by)
  VALUES
    (NEW.id, v_version_no, v_definition, md5(v_definition::text),
     CASE WHEN TG_OP = 'INSERT' THEN 'criacao' ELSE 'definicao' END,
     v_actor);

  RETURN NULL;
END $$;

CREATE TRIGGER fin_rule_versiona_definicao
  AFTER INSERT OR UPDATE OF entity_id, slug, name, priority, match_scope,
                            conditions, actions, confidence, source, status
  ON fin_rule
  FOR EACH ROW EXECUTE FUNCTION fin_rule_versiona_definicao();

COMMENT ON FUNCTION fin_rule_versiona_definicao() IS
  'Publica versão somente quando o payload comportamental muda. UPDATE de '
  'hits_count, last_hit_at, updated_at, notes ou created_by não cria versão.';

-- Rede diferível: o AFTER acima cria a versão no mesmo comando; no fim da
-- transação toda regra precisa ter uma versão corrente cujo payload seja
-- exatamente sua definição. Também cobre INSERT real de regra nova.
CREATE OR REPLACE FUNCTION fin_rule_version_corrente_coerente() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_rule fin_rule%ROWTYPE;
  v_definition jsonb;
BEGIN
  -- O evento diferido guarda NEW no instante de cada comando. Se a mesma
  -- regra mudar duas vezes na transação, esse NEW já é histórico; releia a
  -- linha final para todos os eventos validarem o mesmo estado de commit.
  SELECT r.* INTO v_rule
    FROM fin_rule r
   WHERE r.id = NEW.id;

  SELECT v.definition
    INTO v_definition
    FROM fin_rule_version v
   WHERE v.rule_id = NEW.id
   ORDER BY v.version_no DESC
   LIMIT 1;

  IF v_rule.id IS NULL
     OR v_definition IS NULL
     OR v_definition IS DISTINCT FROM fin_rule_definition_payload(v_rule) THEN
    RAISE EXCEPTION 'regra % não possui versão corrente coerente', NEW.id;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER fin_rule_version_corrente_coerente
  AFTER INSERT OR UPDATE ON fin_rule
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fin_rule_version_corrente_coerente();

-- O ponteiro da linha passa a guardar QUAL definição decidiu. O baseline é a
-- única versão reconstruível para o passado; daqui para a frente o gatilho
-- carimba a versão corrente em toda nova decisão.
ALTER TABLE fin_transaction ADD COLUMN classified_rule_version_id bigint;
ALTER TABLE fin_document ADD COLUMN classified_rule_version_id bigint;
ALTER TABLE fin_classification_event ADD COLUMN rule_version_id bigint;

UPDATE fin_transaction t
   SET classified_rule_version_id = fin_rule_current_version_id(r.id)
  FROM fin_rule r
 WHERE r.id = t.classified_rule_id;

UPDATE fin_document d
   SET classified_rule_version_id = fin_rule_current_version_id(r.id)
  FROM fin_rule r
 WHERE r.id = d.classified_rule_id;

UPDATE fin_classification_event e
   SET rule_version_id = fin_rule_current_version_id(r.id)
  FROM fin_rule r
 WHERE r.id = e.rule_id;

ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_rule_version_paridade
    CHECK ((classified_rule_id IS NULL) = (classified_rule_version_id IS NULL)),
  ADD CONSTRAINT fin_transaction_rule_version_fkey
    FOREIGN KEY (classified_rule_version_id, classified_rule_id)
    REFERENCES fin_rule_version(id, rule_id) ON DELETE RESTRICT;
ALTER TABLE fin_document
  ADD CONSTRAINT fin_document_rule_version_paridade
    CHECK ((classified_rule_id IS NULL) = (classified_rule_version_id IS NULL)),
  ADD CONSTRAINT fin_document_rule_version_fkey
    FOREIGN KEY (classified_rule_version_id, classified_rule_id)
    REFERENCES fin_rule_version(id, rule_id) ON DELETE RESTRICT;
ALTER TABLE fin_classification_event
  ADD CONSTRAINT fin_classification_event_rule_version_paridade
    CHECK ((rule_id IS NULL) = (rule_version_id IS NULL)),
  ADD CONSTRAINT fin_classification_event_rule_version_fkey
    FOREIGN KEY (rule_version_id, rule_id)
    REFERENCES fin_rule_version(id, rule_id) ON DELETE RESTRICT;

CREATE INDEX fin_transaction_rule_version_idx
  ON fin_transaction (classified_rule_version_id)
  WHERE classified_rule_version_id IS NOT NULL;
CREATE INDEX fin_document_rule_version_idx
  ON fin_document (classified_rule_version_id)
  WHERE classified_rule_version_id IS NOT NULL;
CREATE INDEX fin_classification_event_rule_version_idx
  ON fin_classification_event (rule_version_id)
  WHERE rule_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fin_classified_rule_version_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_current_version_id bigint;
BEGIN
  IF NEW.classified_rule_id IS NULL THEN
    NEW.classified_rule_version_id := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.classified_rule_id IS DISTINCT FROM OLD.classified_rule_id
     OR NEW.classified_rule_version_id IS NULL THEN
    v_current_version_id := fin_rule_current_version_id(NEW.classified_rule_id);

    IF v_current_version_id IS NULL THEN
      RAISE EXCEPTION 'regra % não possui versão corrente', NEW.classified_rule_id;
    END IF;
    NEW.classified_rule_version_id := v_current_version_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM fin_rule_version v
     WHERE v.id = NEW.classified_rule_version_id
       AND v.rule_id = NEW.classified_rule_id
  ) THEN
    RAISE EXCEPTION 'versão % não pertence à regra %',
      NEW.classified_rule_version_id, NEW.classified_rule_id;
  END IF;

  RETURN NEW;
END $$;

-- Prefixo zz: precisa rodar depois de fin_*_human_locks, que pode restaurar o
-- classified_rule_id durante um sync. A versão sempre acompanha o id final.
CREATE TRIGGER zz_fin_transaction_rule_version
  BEFORE INSERT OR UPDATE OF classified_rule_id, classified_rule_version_id
  ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_classified_rule_version_sincroniza();

CREATE TRIGGER zz_fin_document_rule_version
  BEFORE INSERT OR UPDATE OF classified_rule_id, classified_rule_version_id
  ON fin_document
  FOR EACH ROW EXECUTE FUNCTION fin_classified_rule_version_sincroniza();

COMMENT ON FUNCTION fin_classified_rule_version_sincroniza() IS
  'Carimba a versão ao inserir, trocar rule_id ou receber versão NULL. Alterar '
  'classified_at não reescreve memória histórica; reavaliação explícita da '
  'mesma regra deve enviar classified_rule_version_id=NULL.';

CREATE OR REPLACE FUNCTION fin_classification_event_rule_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_id IS NULL THEN
    NEW.rule_version_id := NULL;
  ELSIF NEW.rule_version_id IS NULL THEN
    NEW.rule_version_id := fin_rule_current_version_id(NEW.rule_id);
  ELSIF NOT EXISTS (
    SELECT 1 FROM fin_rule_version v
     WHERE v.id = NEW.rule_version_id AND v.rule_id = NEW.rule_id
  ) THEN
    RAISE EXCEPTION 'versão % não pertence à regra %', NEW.rule_version_id, NEW.rule_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fin_classification_event_rule_version
  BEFORE INSERT OR UPDATE OF rule_id, rule_version_id
  ON fin_classification_event
  FOR EACH ROW EXECUTE FUNCTION fin_classification_event_rule_version();

-- ==========================================================================
-- 2. HITS ATUAIS = TRANSAÇÕES + DOCUMENTOS
-- ==========================================================================

CREATE OR REPLACE FUNCTION fin_rule_hits_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.classified_rule_id IS NOT NULL THEN
      UPDATE fin_rule
         SET hits_count = hits_count + 1,
             last_hit_at = now()
       WHERE id = NEW.classified_rule_id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.classified_rule_id IS NOT NULL THEN
      UPDATE fin_rule
         SET hits_count = GREATEST(hits_count - 1, 0)
       WHERE id = OLD.classified_rule_id;
    END IF;

  ELSIF OLD.classified_rule_id IS DISTINCT FROM NEW.classified_rule_id THEN
    IF OLD.classified_rule_id IS NOT NULL THEN
      UPDATE fin_rule
         SET hits_count = GREATEST(hits_count - 1, 0)
       WHERE id = OLD.classified_rule_id;
    END IF;
    IF NEW.classified_rule_id IS NOT NULL THEN
      UPDATE fin_rule
         SET hits_count = hits_count + 1,
             last_hit_at = now()
       WHERE id = NEW.classified_rule_id;
    END IF;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_rule_hits ON fin_transaction;
CREATE TRIGGER fin_transaction_rule_hits
  AFTER INSERT OR UPDATE OF classified_rule_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_rule_hits_sincroniza();

CREATE TRIGGER fin_transaction_rule_hits_delete
  AFTER DELETE ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_rule_hits_sincroniza();

CREATE TRIGGER fin_document_rule_hits
  AFTER INSERT OR UPDATE OF classified_rule_id ON fin_document
  FOR EACH ROW EXECUTE FUNCTION fin_rule_hits_sincroniza();

CREATE TRIGGER fin_document_rule_hits_delete
  AFTER DELETE ON fin_document
  FOR EACH ROW EXECUTE FUNCTION fin_rule_hits_sincroniza();

WITH ponteiros AS (
  SELECT classified_rule_id AS rule_id,
         COALESCE(classified_at, updated_at) AS hit_at
    FROM fin_transaction
   WHERE classified_rule_id IS NOT NULL
  UNION ALL
  SELECT classified_rule_id,
         COALESCE(classified_at, updated_at)
    FROM fin_document
   WHERE classified_rule_id IS NOT NULL
), uso AS (
  SELECT r.id,
         count(p.rule_id)::integer AS hits,
         max(p.hit_at) AS ultimo
    FROM fin_rule r
    LEFT JOIN ponteiros p ON p.rule_id = r.id
   GROUP BY r.id
)
UPDATE fin_rule r
   SET hits_count = u.hits,
       last_hit_at = CASE
         WHEN u.ultimo IS NULL THEN r.last_hit_at
         ELSE GREATEST(r.last_hit_at, u.ultimo)
       END
  FROM uso u
 WHERE u.id = r.id
   AND (
     r.hits_count IS DISTINCT FROM u.hits
     OR (u.ultimo IS NOT NULL
         AND r.last_hit_at IS DISTINCT FROM GREATEST(r.last_hit_at, u.ultimo))
   );

COMMENT ON FUNCTION fin_rule_hits_sincroniza() IS
  'Mantém hits_count como quantidade ATUAL de ponteiros em fin_transaction + '
  'fin_document. INSERT/UPDATE/DELETE são simétricos. Não mede histórico.';

-- ==========================================================================
-- 3. DUAS REGRAS INEXEQUÍVEIS, JÁ SUBSTITUÍDAS
-- ==========================================================================

DO $$
DECLARE
  v_invalidas integer;
  v_referencias bigint;
BEGIN
  WITH pares(regra_antiga, regra_substituta, category_code, valor_impossivel) AS (
    VALUES
      ('qualificacao-conselho-regional-de-engenharia-e-agronomia',
       'crea-conselhos', '5.10', 'conselho regional de engenharia e agronomia'),
      ('qualificacao-lyra-m2m-ltda',
       'fornecedor-lyra-m2m', '5.03', 'lyra m2m ltda')
  )
  SELECT count(*) INTO v_invalidas
    FROM pares p
    LEFT JOIN fin_entity e ON e.slug = 'xpe'
    LEFT JOIN fin_rule antiga
      ON antiga.entity_id = e.id AND antiga.slug = p.regra_antiga
    LEFT JOIN fin_rule substituta
      ON substituta.entity_id = e.id AND substituta.slug = p.regra_substituta
   WHERE antiga.id IS NULL
      OR substituta.id IS NULL
      OR antiga.status <> 'ativa'
      OR substituta.status <> 'ativa'
      OR antiga.match_scope <> 'transaction'
      OR antiga.conditions #>> '{all,0,field}' <> 'counterparty_name_norm'
      OR antiga.conditions #>> '{all,0,op}' <> 'equals'
      OR antiga.conditions #>> '{all,0,value}' <> p.valor_impossivel
      OR antiga.actions->>'category_code' IS DISTINCT FROM p.category_code
      OR substituta.actions->>'category_code' IS DISTINCT FROM p.category_code;

  IF v_invalidas <> 0 THEN
    RAISE EXCEPTION
      '0088 recusada: regra inexequível/substituta ausente, alterada ou com categoria divergente';
  END IF;

  SELECT count(*) INTO v_referencias
    FROM fin_rule r
   WHERE r.slug IN (
     'qualificacao-conselho-regional-de-engenharia-e-agronomia',
     'qualificacao-lyra-m2m-ltda'
   )
     AND (
       EXISTS (SELECT 1 FROM fin_transaction t WHERE t.classified_rule_id = r.id)
       OR EXISTS (SELECT 1 FROM fin_document d WHERE d.classified_rule_id = r.id)
     );

  IF v_referencias <> 0 THEN
    RAISE EXCEPTION
      '0088 recusada: existe classificação apontando para regra que seria arquivada';
  END IF;
END $$;

WITH pares(regra_antiga, regra_substituta) AS (
  VALUES
    ('qualificacao-conselho-regional-de-engenharia-e-agronomia', 'crea-conselhos'),
    ('qualificacao-lyra-m2m-ltda', 'fornecedor-lyra-m2m')
), alvo AS (
  SELECT antiga.id,
         antiga.entity_id,
         antiga.status AS old_status,
         antiga.notes AS old_notes,
         antiga.conditions AS old_conditions,
         antiga.actions AS old_actions,
         substituta.id AS substituta_id,
         substituta.slug AS substituta_slug
    FROM pares p
    JOIN fin_entity e ON e.slug = 'xpe'
    JOIN fin_rule antiga
      ON antiga.entity_id = e.id AND antiga.slug = p.regra_antiga
    JOIN fin_rule substituta
      ON substituta.entity_id = e.id AND substituta.slug = p.regra_substituta
), mudanca AS (
  UPDATE fin_rule r
     SET status = 'arquivada',
         notes = concat_ws(
           E'\n',
           r.notes,
           format(
             'Arquivada pela 0088: condição inexequível por não usar normalizeName(); substituída por %s.',
             a.substituta_slug
           )
         )
    FROM alvo a
   WHERE r.id = a.id
   RETURNING r.id, r.entity_id,
             a.old_status, a.old_notes, a.old_conditions, a.old_actions,
             r.status AS new_status, r.notes AS new_notes,
             a.substituta_id, a.substituta_slug
)
INSERT INTO fin_audit_log
  (entity_id, target_table, target_id, action,
   before, after, fields, actor)
SELECT entity_id,
       'fin_rule',
       id,
       'update',
       jsonb_build_object(
         'status', old_status,
         'notes', old_notes,
         'conditions', old_conditions,
         'actions', old_actions
       ),
       jsonb_build_object(
         'status', new_status,
         'notes', new_notes,
         'substituida_por_id', substituta_id,
         'substituida_por_slug', substituta_slug
       ),
       ARRAY['status', 'notes']::text[],
       'migration-0088'
  FROM mudanca;

-- ==========================================================================
-- 4. ASSERÇÕES DE SAÚDE: DATADAS, IMUTÁVEIS E PRESAS À VERSÃO
-- ==========================================================================

CREATE TABLE fin_rule_health_assertion (
  id                       bigserial PRIMARY KEY,
  rule_id                  bigint NOT NULL REFERENCES fin_rule(id) ON DELETE RESTRICT,
  rule_version_id          bigint NOT NULL,
  health_state             text NOT NULL CHECK (health_state IN (
                               'zero_esperado',
                               'sombra_esperada',
                               'aguardando_fonte',
                               'sombreada_nao_justificada'
                             )),
  reason_code              text NOT NULL,
  justification            text NOT NULL,
  evidence                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_until              timestamptz NOT NULL,
  supersedes_assertion_id  bigint UNIQUE
                             REFERENCES fin_rule_health_assertion(id) ON DELETE RESTRICT,
  asserted_by              text NOT NULL,
  asserted_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > asserted_at),
  CHECK (jsonb_typeof(evidence) = 'object'),
  FOREIGN KEY (rule_version_id, rule_id)
    REFERENCES fin_rule_version(id, rule_id) ON DELETE RESTRICT
);

CREATE INDEX fin_rule_health_assertion_latest_idx
  ON fin_rule_health_assertion (rule_id, asserted_at DESC, id DESC);

CREATE OR REPLACE FUNCTION fin_rule_health_assertion_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'fin_rule_health_assertion é append-only: insira nova asserção com supersedes_assertion_id';
END $$;

CREATE TRIGGER fin_rule_health_assertion_immutable
  BEFORE UPDATE OR DELETE ON fin_rule_health_assertion
  FOR EACH ROW EXECUTE FUNCTION fin_rule_health_assertion_immutable();

-- A asserção não pode ser presa à versão de outra regra.
CREATE OR REPLACE FUNCTION fin_rule_health_assertion_coerente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fin_rule_version v
     WHERE v.id = NEW.rule_version_id AND v.rule_id = NEW.rule_id
  ) THEN
    RAISE EXCEPTION 'versão % não pertence à regra %',
      NEW.rule_version_id, NEW.rule_id;
  END IF;

  IF NEW.supersedes_assertion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fin_rule_health_assertion a
     WHERE a.id = NEW.supersedes_assertion_id AND a.rule_id = NEW.rule_id
  ) THEN
    RAISE EXCEPTION 'asserção substituída não pertence à mesma regra';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fin_rule_health_assertion_coerente
  BEFORE INSERT ON fin_rule_health_assertion
  FOR EACH ROW EXECUTE FUNCTION fin_rule_health_assertion_coerente();

-- A fotografia abaixo é conferida contra o banco ANTES de virar asserção.
-- Divergência aborta a migration: não se conserva um diagnóstico velho como
-- se fosse verdade atual.
DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
    FROM fin_transaction t
   WHERE t.amount_cents < 0
     AND t.description_norm LIKE '%fgts%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0088: regra FGTS ganhou % candidatos; reaudite antes de afirmar fonte ausente', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_person p
   WHERE p.status = 'ativo' AND p.employment_type = 'clt';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0088: existem % pessoas CLT; FGTS não pode ser marcado aguardando fonte sem reauditoria', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_document d
   WHERE d.description_norm LIKE ANY (ARRAY[
     '%manutencao preventiva%', '% pcm %', 'pcm %', '% pcm', '%plano de manutencao%'
   ]);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0088: Manutenção/PCM ganhou % candidatos; reaudite', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM fin_document WHERE direction = 'pagar';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0088: já existem % documentos a pagar; reaudite CREA-documento', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_document d
   WHERE d.description_norm LIKE '%conselho regional de engenharia%'
      OR d.description_norm LIKE '%crea%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0088: CREA-documento ganhou % candidatos; reaudite', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_document d
   WHERE d.description_norm LIKE ANY (ARRAY[
     '%usina solar%', '%geracao distribuida%', '%creditos de energia%',
     '%fotovoltaic%', '%neoenergia%'
   ]);
  IF v_n <> 52 THEN
    RAISE EXCEPTION '0088: Solar/GD esperava 52 candidatos e encontrou %; reaudite a sombra', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_document d
   WHERE d.description_norm ~ '(^|\s)art(\s|$)';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0088: ART esperava 1 candidato e encontrou %; reaudite a sombra', v_n;
  END IF;
END $$;

INSERT INTO fin_rule_health_assertion
  (rule_id, rule_version_id, health_state, reason_code,
   justification, evidence, valid_until, asserted_by)
SELECT r.id,
       fin_rule_current_version_id(r.id),
       x.health_state,
       x.reason_code,
       x.justification,
       x.evidence,
       now() + interval '30 days',
       'migration-0088'
  FROM fin_rule r
  JOIN fin_entity e ON e.id = r.entity_id AND e.slug = 'xpe'
  JOIN (
    VALUES
      ('fgts',
       'aguardando_fonte',
       'folha_fgts_ausente',
       'Zero candidato no ledger e zero CLT cadastrado; falta confirmar folha/eSocial/guias antes de chamar o zero de esperado.',
       jsonb_build_object(
         'candidatos', 0,
         'pessoas_clt_ativas', 0,
         'fonte_necessaria', 'folha/eSocial/guias FGTS'
       )),
      ('manutencao-e-pcm',
       'aguardando_fonte',
       'catalogo_servico_ausente',
       'Nenhum documento casa e a categoria 3.13 nunca foi usada; falta confirmar catálogo/contratos/NFs.',
       jsonb_build_object(
         'candidatos', 0,
         'fonte_necessaria', 'catálogo de serviços, contratos e NFs'
       )),
      ('crea-e-conselhos',
       'aguardando_fonte',
       'documentos_pagar_ausentes',
       'A regra é de documento, mas o universo atual possui somente recebíveis; falta ingestão de contas a pagar.',
       jsonb_build_object(
         'candidatos', 0,
         'documentos_pagar', 0,
         'fonte_necessaria', 'documentos de fornecedores/contas a pagar'
       )),
      ('gestao-de-usina-solar-e-gd',
       'sombreada_nao_justificada',
       'conflito_prioridade_receita',
       '52 documentos casam, mas regras anteriores vencem. Alterar prioridade moveria receita entre 3.01/3.09 e exige decisão humana.',
       jsonb_build_object(
         'candidatos', 52,
         'vencedores_atuais', jsonb_build_object(
           'consultoria-e-auditoria', 43,
           'projetos-e-subestacoes', 3,
           'estudo-de-disponibilidade-de-carga', 3,
           'laudos-e-inspecoes', 3
         )
       )),
      ('art-anotacao-responsabilidade-tecnica',
       'sombreada_nao_justificada',
       'conflito_prioridade_servico_principal',
       'Um documento casa com ART e Smart Charging; falta declarar se o serviço principal vence a obrigação acessória.',
       jsonb_build_object(
         'candidatos', 1,
         'vencedor_atual', 'smart-charging-e-carregadores'
       ))
  ) AS x(slug, health_state, reason_code, justification, evidence)
    ON x.slug = r.slug
 WHERE r.status = 'ativa';

-- Função parametrizada para o teste provar expiração sem dormir nem mexer
-- no relógio. A view de produção simplesmente pergunta no instante atual.
CREATE OR REPLACE FUNCTION fin_rule_health(p_at timestamptz DEFAULT now())
RETURNS TABLE (
  rule_id bigint,
  rule_version_id bigint,
  slug text,
  name text,
  match_scope text,
  hits_total integer,
  hits_current_version integer,
  last_hit_at timestamptz,
  health_state text,
  reason_code text,
  justification text,
  evidence jsonb,
  assertion_id bigint,
  asserted_at timestamptz,
  valid_until timestamptz,
  is_blocking boolean,
  is_external_gap boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id,
         cv.rule_version_id,
         r.slug,
         r.name,
         r.match_scope,
         r.hits_count,
         current_hits.hits,
         r.last_hit_at,
         CASE
           WHEN current_hits.hits > 0 THEN 'produtiva'
           WHEN a.id IS NULL THEN 'zero_inesperado'
           WHEN a.rule_version_id <> cv.rule_version_id THEN 'assercao_invalidada'
           WHEN a.valid_until <= p_at THEN 'assercao_expirada'
           ELSE a.health_state
         END AS health_state,
         CASE WHEN current_hits.hits > 0 THEN 'ponteiro_versao_atual'
              ELSE a.reason_code END,
         CASE WHEN current_hits.hits > 0
              THEN 'Ao menos um fato atual aponta para esta regra/versão.'
              ELSE a.justification END,
         CASE WHEN current_hits.hits > 0
              THEN jsonb_build_object(
                'hits_total', r.hits_count,
                'hits_versao_atual', current_hits.hits
              )
              ELSE COALESCE(a.evidence, '{}'::jsonb) END,
         a.id,
         a.asserted_at,
         a.valid_until,
         CASE
           WHEN current_hits.hits > 0 THEN false
           WHEN a.id IS NULL THEN true
           WHEN a.rule_version_id <> cv.rule_version_id THEN true
           WHEN a.valid_until <= p_at THEN true
           WHEN a.health_state = 'sombreada_nao_justificada' THEN true
           ELSE false
         END AS is_blocking,
         CASE
           WHEN current_hits.hits = 0
            AND a.rule_version_id = cv.rule_version_id
            AND a.valid_until > p_at
            AND a.health_state = 'aguardando_fonte'
           THEN true ELSE false
         END AS is_external_gap
    FROM fin_rule r
    CROSS JOIN LATERAL (
      SELECT fin_rule_current_version_id(r.id) AS rule_version_id
    ) cv
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS hits
        FROM (
          SELECT t.id
            FROM fin_transaction t
           WHERE t.classified_rule_version_id = cv.rule_version_id
          UNION ALL
          SELECT d.id
            FROM fin_document d
           WHERE d.classified_rule_version_id = cv.rule_version_id
        ) fatos
    ) current_hits
    LEFT JOIN LATERAL (
      SELECT h.*
        FROM fin_rule_health_assertion h
       WHERE h.rule_id = r.id
         AND h.asserted_at <= p_at
       ORDER BY h.asserted_at DESC, h.id DESC
       LIMIT 1
    ) a ON true
   WHERE r.status = 'ativa'
$$;

CREATE VIEW fin_rule_health_v AS
SELECT * FROM fin_rule_health(now());

COMMENT ON VIEW fin_rule_health_v IS
  'Exatamente uma linha por regra ativa. Zero sem asserção vigente e presa '
  'à versão é falha; fonte externa ausente nunca é convertida em zero esperado.';

-- ==========================================================================
-- 5. PÓS-CONDIÇÕES DA FOTOGRAFIA ATUAL
-- ==========================================================================

DO $$
DECLARE
  v_total integer;
  v_produtivas integer;
  v_externas integer;
  v_sombras integer;
  v_divergencias integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE health_state = 'produtiva'),
         count(*) FILTER (WHERE health_state = 'aguardando_fonte'),
         count(*) FILTER (WHERE health_state = 'sombreada_nao_justificada')
    INTO v_total, v_produtivas, v_externas, v_sombras
    FROM fin_rule_health_v;

  IF (v_total, v_produtivas, v_externas, v_sombras) <> (58, 53, 3, 2) THEN
    RAISE EXCEPTION
      '0088: fotografia inesperada (ativas %, produtivas %, externas %, sombras %); reaudite',
      v_total, v_produtivas, v_externas, v_sombras;
  END IF;

  WITH ponteiros AS (
    SELECT classified_rule_id AS rule_id FROM fin_transaction
     WHERE classified_rule_id IS NOT NULL
    UNION ALL
    SELECT classified_rule_id FROM fin_document
     WHERE classified_rule_id IS NOT NULL
  ), real AS (
    SELECT rule_id, count(*)::integer AS hits
      FROM ponteiros GROUP BY rule_id
  )
  SELECT count(*) INTO v_divergencias
    FROM fin_rule r
    LEFT JOIN real x ON x.rule_id = r.id
   WHERE r.hits_count IS DISTINCT FROM COALESCE(x.hits, 0);

  IF v_divergencias <> 0 THEN
    RAISE EXCEPTION '0088: % regras divergiram da recontagem combinada', v_divergencias;
  END IF;

  SELECT count(*) INTO v_divergencias
    FROM fin_rule r
    LEFT JOIN fin_rule_version v ON v.id = fin_rule_current_version_id(r.id)
   WHERE v.rule_id IS DISTINCT FROM r.id
      OR v.definition IS DISTINCT FROM fin_rule_definition_payload(r);

  IF v_divergencias <> 0 THEN
    RAISE EXCEPTION '0088: % regras ficaram sem versão corrente coerente', v_divergencias;
  END IF;

  SELECT count(*) INTO v_divergencias
    FROM fin_transaction t
    JOIN fin_rule_version v ON v.id = t.classified_rule_version_id
   WHERE v.rule_id IS DISTINCT FROM t.classified_rule_id;
  IF v_divergencias <> 0 THEN
    RAISE EXCEPTION '0088: versão incoerente em % transações', v_divergencias;
  END IF;

  SELECT count(*) INTO v_divergencias
    FROM fin_document d
    JOIN fin_rule_version v ON v.id = d.classified_rule_version_id
   WHERE v.rule_id IS DISTINCT FROM d.classified_rule_id;
  IF v_divergencias <> 0 THEN
    RAISE EXCEPTION '0088: versão incoerente em % documentos', v_divergencias;
  END IF;
END $$;
