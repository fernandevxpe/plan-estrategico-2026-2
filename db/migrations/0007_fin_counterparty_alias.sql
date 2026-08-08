-- Apelidos de contraparte: N cadastros externos → 1 contraparte.
--
-- MOTIVO CONCRETO: dos 344 clientes do Asaas, 57 cadastros compartilham 24
-- CNPJ/CPF. É o mesmo cliente registrado mais de uma vez — "EDMAR VICTOR LTDA"
-- aparece seis vezes, "CHICO BART COMERCIO..." três, com grafias diferentes.
--
-- A primeira versão tinha `asaas_customer_id` como coluna única em
-- fin_counterparty, o que forçava uma escolha ruim: ou o índice de CNPJ
-- estourava na importação (foi o que aconteceu), ou se afrouxava a unicidade do
-- documento e o cadastro passava a aceitar o mesmo CNPJ várias vezes.
--
-- A segunda opção é a pior das duas, e não por pureza de modelagem: a sugestão
-- automática por contraparte é o sinal mais forte que existe para classificar um
-- lançamento, e ela se dilui quando o histórico de um cliente fica repartido
-- entre seis cadastros. Somar "quanto este cliente já comprou" também passaria a
-- devolver um pedaço do total.
--
-- Com esta tabela, a contraparte é única por documento e cada id externo aponta
-- para ela. Unificar dois cadastros no futuro é reapontar uma linha de alias, em
-- vez de reescrever counterparty_id em documentos, lançamentos e contratos.

CREATE TABLE fin_counterparty_alias (
  id              bigserial PRIMARY KEY,
  counterparty_id bigint NOT NULL REFERENCES fin_counterparty(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('asaas', 'pipedrive', 'clickup', 'import', 'manual')),
  external_id     text NOT NULL,
  -- O nome como veio da fonte. Guardar as variantes ("CHICO BART COMERCO" vs
  -- "CHICO BART COMERCIO") é o que permite casar o extrato depois, já que o
  -- banco escreve o nome do jeito dele.
  name_raw        text,
  normalized_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX fin_counterparty_alias_cp_idx ON fin_counterparty_alias (counterparty_id);
CREATE INDEX fin_counterparty_alias_norm_idx ON fin_counterparty_alias (normalized_name text_pattern_ops);

-- A coluna sai: duas fontes de verdade para a mesma ligação divergem sempre, e
-- aqui a divergência apareceria como um cliente com dois históricos.
DROP INDEX IF EXISTS fin_counterparty_asaas_idx;
ALTER TABLE fin_counterparty DROP COLUMN IF EXISTS asaas_customer_id;
