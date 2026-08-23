-- Cancelamento de item de reembolso com estorno: a pessoa devolve o que a
-- empresa já pagou. Não é faturamento — é recuperação de caixa (devolução).

-- ---------------------------------------------------------------------------
-- 1. Item do app pode ser cancelado (parcelas futuras param de existir)
-- ---------------------------------------------------------------------------
ALTER TABLE fin_reimbursement_item
  DROP CONSTRAINT IF EXISTS fin_reimbursement_item_status_check;

ALTER TABLE fin_reimbursement_item
  ADD CONSTRAINT fin_reimbursement_item_status_check
  CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'pago', 'cancelado'));

-- ---------------------------------------------------------------------------
-- 2. Estorno — dívida da pessoa com a empresa após cancelar a compra
-- ---------------------------------------------------------------------------
CREATE TABLE fin_reembolso_estorno (
  id                  bigserial PRIMARY KEY,
  entity_id           bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  person_id           bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,

  item_fonte          text NOT NULL CHECK (item_fonte IN ('app', 'planilha')),
  item_id             bigint NOT NULL,
  slug                text,

  titulo              text NOT NULL CHECK (length(btrim(titulo)) > 0),
  motivo_categoria    text NOT NULL DEFAULT 'outro'
    CHECK (motivo_categoria IN ('devolucao', 'erro_compra', 'desistencia', 'outro')),
  motivo              text NOT NULL CHECK (length(btrim(motivo)) >= 3),

  valor_cents         bigint NOT NULL CHECK (valor_cents >= 0),
  parcelas_pagas      integer NOT NULL DEFAULT 0 CHECK (parcelas_pagas >= 0),
  parcelas_detalhe    jsonb NOT NULL DEFAULT '[]'::jsonb,

  status              text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'parcial', 'quitado', 'cancelado_admin')),

  pix_chave           text NOT NULL,
  pix_tipo            text NOT NULL DEFAULT 'CNPJ',
  pix_nome_recebedor  text NOT NULL,
  brcode              text,
  conta_sugerida_id   bigint REFERENCES fin_account(id) ON DELETE SET NULL,

  document_id         bigint REFERENCES fin_document(id) ON DELETE SET NULL,
  transaction_id      bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  match_sugerido_id   bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  match_confianca     text CHECK (match_confianca IN ('alta', 'media', 'baixa')),

  criado_por          text NOT NULL,
  quitado_em          timestamptz,
  quitado_por         text,
  criado_em           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (item_fonte, item_id)
);

CREATE INDEX fin_reembolso_estorno_pessoa_ix ON fin_reembolso_estorno (person_id, status, criado_em DESC);
CREATE INDEX fin_reembolso_estorno_aberto_ix ON fin_reembolso_estorno (entity_id, status)
  WHERE status IN ('aberto', 'parcial');

COMMENT ON TABLE fin_reembolso_estorno IS
  'Devolução à empresa após cancelar compra reembolsada. valor_cents = soma do já pago; '
  'não é receita — é recuperação de caixa. Uma linha por item cancelado.';

-- Slug da planilha cancelado: previsão de reembolso futuro ignora estes slugs.
CREATE TABLE fin_reembolso_slug_cancelado (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  person_id   bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  slug        text NOT NULL CHECK (length(btrim(slug)) > 0),
  estorno_id  bigint NOT NULL REFERENCES fin_reembolso_estorno(id) ON DELETE CASCADE,
  cancelado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, slug)
);

-- View estreita para o app do time (perfil-guard: sem ledger cru).
CREATE OR REPLACE VIEW fin_time_reembolso_estorno_v AS
SELECT
  e.id,
  e.person_id,
  e.item_fonte,
  e.item_id,
  e.titulo,
  e.motivo_categoria,
  e.motivo,
  e.valor_cents,
  e.parcelas_pagas,
  e.parcelas_detalhe,
  e.status,
  e.pix_chave,
  e.pix_tipo,
  e.pix_nome_recebedor,
  e.brcode,
  e.conta_sugerida_id,
  e.criado_em,
  e.quitado_em
FROM fin_reembolso_estorno e
WHERE e.status <> 'cancelado_admin';

COMMENT ON VIEW fin_time_reembolso_estorno_v IS
  'Estornos de reembolso visíveis ao dono no app. Filtrar por person_id da sessão.';

-- Documento a receber usa source própria (não é faturamento).
ALTER TABLE fin_document DROP CONSTRAINT IF EXISTS fin_document_source_check;
ALTER TABLE fin_document ADD CONSTRAINT fin_document_source_check
  CHECK (source IN (
    'asaas', 'import_csv', 'import_ofx', 'manual', 'contrato', 'folha',
    'reembolso', 'reembolso_estorno', 'implicito', 'clickup'
  ));

DO $$
BEGIN
  IF to_regclass('fin_reembolso_estorno') IS NULL THEN
    RAISE EXCEPTION '0157: fin_reembolso_estorno não foi criada';
  END IF;
  IF to_regclass('fin_reembolso_slug_cancelado') IS NULL THEN
    RAISE EXCEPTION '0157: fin_reembolso_slug_cancelado não foi criada';
  END IF;
  IF to_regclass('fin_time_reembolso_estorno_v') IS NULL THEN
    RAISE EXCEPTION '0157: fin_time_reembolso_estorno_v não foi criada';
  END IF;
END $$;
