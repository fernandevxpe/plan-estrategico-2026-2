-- Linhas individuais de um lote de importação de extrato.
--
-- O preview precisa ser um OBJETO no banco, não um JSON na memória do browser:
-- a conferência acontece no celular, pode ser interrompida por uma ligação e
-- retomada meia hora depois — e o "importar mesmo assim" por linha precisa de
-- um lugar durável para gravar a decisão antes do confirmar.
CREATE TABLE fin_import_row (
  id              bigserial PRIMARY KEY,
  batch_id        bigint NOT NULL REFERENCES fin_import_batch(id) ON DELETE CASCADE,
  row_number      int,
  -- A linha como o parser a viu, para depuração e reprocessamento. Sem isto,
  -- "por que esta linha entrou com valor errado?" exigiria reabrir o arquivo
  -- original — que a essa altura já foi apagado do celular.
  raw             jsonb NOT NULL,
  posted_on       date,
  amount_cents    bigint,
  description_raw text,
  dedupe_hash     text,
  -- 'novo'      → vai entrar no confirmar
  -- 'duplicado' → já existe no ledger; fica de fora, salvo "importar mesmo assim"
  -- 'forcado'   → duplicado que o humano mandou entrar (ganha ordinal além dos existentes)
  -- 'importado' → entrou; transaction_id aponta o lançamento criado
  -- 'ignorado'  → o humano tirou do lote antes de confirmar
  status          text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'duplicado', 'forcado', 'importado', 'ignorado')),
  -- Sem FK de propósito: reverter o lote apaga os lançamentos, e a linha deve
  -- sobreviver como registro histórico do que foi importado (o id é anulado
  -- pela reversão, não pelo banco).
  transaction_id  bigint NULL,
  message         text
);

CREATE INDEX fin_import_row_batch_idx ON fin_import_row (batch_id, status);

-- O índice de "arquivo já importado" de 0002 era absoluto: qualquer lote com o
-- mesmo sha256 na mesma conta bloqueava para sempre — inclusive depois de uma
-- REVERSÃO, que existe justamente para permitir importar de novo. Um preview
-- descartado também prendia o hash. Recriado parcial: só um lote CONFIRMADO
-- ocupa o hash; reverter o lote libera o arquivo para reimportação.
DROP INDEX IF EXISTS fin_import_batch_file_idx;
CREATE UNIQUE INDEX fin_import_batch_file_idx
  ON fin_import_batch (account_id, file_sha256)
  WHERE file_sha256 IS NOT NULL AND status = 'confirmado';
