-- Cobrança do contas a pagar: favorito da CONTRAPARTE e anexo do MÊS.
--
-- A tela de previstos (Ancora, Compesa, DAS) precisa guardar o boleto e a
-- NF-e da obrigação, ler o que o arquivo afirma, e lembrar o que se paga
-- todo mês. `fin_payment_attachment` não serve: o `target_id` é bigint e a
-- identidade da agenda (`chave_dedupe`) é texto; alargar o CHECK dela para
-- um alvo que não existe misturaria "anexo da ordem" com "anexo da conta
-- que ainda nem virou ordem".
--
-- São DUAS chaves de propósito:
--   fin_conta_favorito.chave     — o fornecedor (Ancora continua estrela em outubro)
--   fin_conta_cobranca.chave_dedupe — a obrigação DESTE mês (o boleto de setembro)
--
-- Bytes ficam em fin_anexo_blob, o mesmo saco de 0105. Aqui só o vínculo e o
-- que a leitura devolveu. Campo que o arquivo não leu fica NULL.

CREATE TABLE fin_conta_favorito (
  entity_id  bigint NOT NULL REFERENCES fin_entity(id),
  chave      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, chave)
);

COMMENT ON TABLE fin_conta_favorito IS
  'Estrela do contas a pagar. chave = cp:<id> ou nome:<normalizado>. É o fornecedor, não o mês.';

CREATE TABLE fin_conta_cobranca (
  id           bigserial PRIMARY KEY,
  entity_id    bigint NOT NULL REFERENCES fin_entity(id),
  chave_dedupe text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, chave_dedupe)
);

COMMENT ON TABLE fin_conta_cobranca IS
  'A obrigação do mês (chave_dedupe da 0104) que ganhou boleto ou NF-e. Sem anexo ela não existe.';

CREATE TABLE fin_conta_cobranca_anexo (
  id               bigserial PRIMARY KEY,
  cobranca_id      bigint NOT NULL REFERENCES fin_conta_cobranca(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('boleto', 'nota_fiscal')),
  storage_key      text NOT NULL,
  file_name        text,
  mime_type        text,
  file_bytes       bigint CHECK (file_bytes IS NULL OR file_bytes > 0),
  -- Lido do arquivo. NULL se não leu — nunca chutado. A agenda continua
  -- sendo a fonte do valor a pagar; estes campos só CONFEREM.
  valor_lido_cents bigint CHECK (valor_lido_cents IS NULL OR valor_lido_cents >= 0),
  vencimento_lido  date,
  emitente_lido    text,
  forma_lida       text CHECK (forma_lida IS NULL OR forma_lida IN (
    'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'dinheiro', 'indeterminado'
  )),
  uploaded_by      text NOT NULL,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cobranca_id, kind)
);

CREATE INDEX fin_conta_cobranca_anexo_storage_idx ON fin_conta_cobranca_anexo (storage_key);

COMMENT ON TABLE fin_conta_cobranca_anexo IS
  'Um boleto e uma NF-e por obrigação do mês. UNIQUE (cobranca_id, kind): o segundo arquivo substitui o primeiro.';

COMMENT ON COLUMN fin_conta_cobranca_anexo.valor_lido_cents IS
  'O que o arquivo afirmou. Não substitui fin_agenda_dia_v.valor_cents.';

DO $$
BEGIN
  IF to_regclass('fin_conta_favorito') IS NULL THEN
    RAISE EXCEPTION 'fin_conta_favorito não foi criada';
  END IF;
  IF to_regclass('fin_conta_cobranca') IS NULL THEN
    RAISE EXCEPTION 'fin_conta_cobranca não foi criada';
  END IF;
  IF to_regclass('fin_conta_cobranca_anexo') IS NULL THEN
    RAISE EXCEPTION 'fin_conta_cobranca_anexo não foi criada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'fin_conta_cobranca_anexo'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%cobranca_id%'
       AND pg_get_constraintdef(oid) LIKE '%kind%'
  ) THEN
    RAISE EXCEPTION 'UNIQUE (cobranca_id, kind) não existe em fin_conta_cobranca_anexo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_conta_cobranca_anexo' AND column_name = 'valor_lido_cents'
  ) THEN
    RAISE EXCEPTION 'fin_conta_cobranca_anexo.valor_lido_cents não foi criada';
  END IF;
END $$;
