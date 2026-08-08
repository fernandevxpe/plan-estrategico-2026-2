-- O ledger: importação, documentos (competência), lançamentos (caixa),
-- liquidação e notas fiscais.
--
-- PARTIDA SIMPLES, não dobrada. Extrato bancário é unilateral por natureza;
-- sintetizar a contrapartida de 12 mil linhas por heurística daria a forma da
-- partida dobrada sem nenhuma das suas garantias. O balancete que se perde é
-- recuperado por fin_balance_snapshot: se o ledger reconstrói o saldo de
-- fechamento de cada conta todo dia e bate com o extrato, a completude é
-- demonstrável — e vira KPI, não asserção.
--
-- DUAS DATAS E DUAS TABELAS BASE. Fluxo de caixa parte de fin_transaction por
-- posted_on; DRE parte de fin_document por competence_date. Não é o mesmo dado
-- com filtro diferente: implementar o alternador como um CASE sobre uma tabela
-- só faz os dois relatórios nunca fecharem.

-- ---------------------------------------------------------------------------
-- Lotes de importação
-- ---------------------------------------------------------------------------
-- Importar rápido só é seguro quando desfazer é um botão. Sem reversão, ninguém
-- confirma um extrato sem conferir linha a linha — e aí a importação diária
-- custa mais que colar na planilha, que é exatamente o fracasso a evitar.
CREATE TABLE fin_import_batch (
  id                     bigserial PRIMARY KEY,
  entity_id              bigint NOT NULL REFERENCES fin_entity(id),
  account_id             bigint REFERENCES fin_account(id),
  adapter                text NOT NULL,
  file_name              text,
  -- Camada 3 da idempotência: reenviar o mesmo arquivo é detectado ANTES de
  -- parsear ("este extrato já foi importado em 12/07, 143 lançamentos").
  file_sha256            char(64),
  file_bytes             bigint,
  period_start           date,
  period_end             date,
  -- A conferência que pega linha faltando antes de o dado envenenar o ledger.
  declared_balance_cents bigint,
  computed_balance_cents bigint,
  variance_cents         bigint,
  row_count              integer NOT NULL DEFAULT 0,
  inserted_count         integer NOT NULL DEFAULT 0,
  duplicate_count        integer NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'confirmado', 'descartado', 'revertido', 'erro')),
  raw_artifact_key       text,
  error                  text,
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  committed_at           timestamptz,
  reverted_at            timestamptz
);

CREATE UNIQUE INDEX fin_import_batch_file_idx
  ON fin_import_batch (account_id, file_sha256) WHERE file_sha256 IS NOT NULL;

-- Qual faixa de dias cada extrato realmente cobre.
--
-- Sem isto, "cobertura de contas" seria inferida de dias com movimento — e um
-- domingo sem lançamento contaria como buraco. Um índice que penaliza um dia
-- parado é um índice que ninguém leva a sério.
CREATE TABLE fin_statement_coverage (
  id              bigserial PRIMARY KEY,
  account_id      bigint NOT NULL REFERENCES fin_account(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  source          text NOT NULL CHECK (source IN ('extrato', 'api', 'manual')),
  import_batch_id bigint REFERENCES fin_import_batch(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_statement_coverage_account_idx ON fin_statement_coverage (account_id, period_start, period_end);

-- ---------------------------------------------------------------------------
-- Documentos: a camada de competência (recebíveis e pagáveis)
-- ---------------------------------------------------------------------------
CREATE TABLE fin_document (
  id                   bigserial PRIMARY KEY,
  entity_id            bigint NOT NULL REFERENCES fin_entity(id),
  direction            text NOT NULL CHECK (direction IN ('receber', 'pagar')),
  counterparty_id      bigint REFERENCES fin_counterparty(id),
  contract_id          bigint REFERENCES fin_contract(id),
  category_id          bigint REFERENCES fin_category(id),
  nucleo               text REFERENCES fin_nucleo(slug),
  cost_center_id       bigint REFERENCES fin_cost_center(id),
  description          text NOT NULL,
  description_norm     text NOT NULL,
  competence_date      date NOT NULL,
  issue_date           date,
  due_date             date NOT NULL,

  -- due_date é a data NOMINAL e não responde "tenho dinheiro no dia 10?":
  -- boleto liquida ~D+1 útil, cartão ~D+30, vencimento em fim de semana anda.
  expected_cash_date   date,
  cash_date_basis      text CHECK (cash_date_basis IN ('vencimento', 'vencimento_mais_lag', 'liquidacao_gateway', 'manual')),
  -- Curva de recuperação: 45 cobranças vencidas somam R$ 87 mil e 54% passam de
  -- 90 dias. Tratar tudo como 100% superestima o caixa em ~R$ 40 mil hoje.
  cash_confidence      numeric(4,3) NOT NULL DEFAULT 1.000 CHECK (cash_confidence BETWEEN 0 AND 1),
  -- De qual conta sai/entra. Saldo no Nubank não paga boleto agendado no Inter,
  -- então a pergunta do dia 10 é por conta, não consolidada.
  expected_account_id  bigint REFERENCES fin_account(id),
  -- O que se usa de verdade no dia 8 quando o dia 10 está apertado.
  flexibility          text NOT NULL DEFAULT 'negociavel' CHECK (flexibility IN ('fixo', 'negociavel', 'adiavel')),

  -- Sempre positivo: o sentido do dinheiro mora em `direction`, não no sinal.
  amount_cents         bigint NOT NULL CHECK (amount_cents > 0),
  -- Juros e multa recebidos acima do principal, e desconto concedido. Hoje
  -- zerados em todas as 3.023 cobranças recebidas, mas inevitáveis quando a
  -- régua de cobrança dos R$ 87 mil vencidos for ligada.
  --
  -- NÃO existe fee_cents de propósito: no Asaas a tarifa é uma transação
  -- própria (R$ 11.170,22 no histórico) e PAYMENT_RECEIVED é o valor BRUTO,
  -- idêntico a payments.value. Guardar a tarifa aqui também a contaria duas
  -- vezes. A liquidação é pelo bruto e a tarifa é despesa financeira própria —
  -- que é como ela aparece na DRE em vez de sumir num arredondamento.
  interest_cents       bigint NOT NULL DEFAULT 0,
  fine_cents           bigint NOT NULL DEFAULT 0,
  discount_cents       bigint NOT NULL DEFAULT 0,
  -- Mantido pelo gatilho a partir de fin_settlement. Ver o fim deste arquivo.
  settled_cents        bigint NOT NULL DEFAULT 0,

  -- 'vencido' NÃO é status: é função de due_date e da data de hoje, e nada o
  -- transicionaria — um índice que o listasse casaria zero linhas para sempre e
  -- o aging perderia os R$ 87 mil em silêncio. Derive com
  -- `status IN ('emitido','parcial') AND due_date < current_date`.
  --
  -- 'confirmado' = pagamento compensado mas ainda não creditado (cartão D+30).
  -- Sem ele, ou entra no runway dinheiro que não chegou, ou o recebível parece
  -- vencido. 'estornado' = foi recebido e devolvido; não é liquidado nem
  -- cancelado.
  status               text NOT NULL DEFAULT 'previsto' CHECK (status IN (
                         'previsto', 'emitido', 'confirmado', 'parcial', 'liquidado', 'estornado', 'cancelado')),
  -- O status cru da fonte, nunca interpretado. O Asaas tem 12 estados e este
  -- schema tem 7; sem guardar o original, re-derivar exigiria ressincronizar
  -- 3.350 cobranças contra uma API cuja chave será rotacionada.
  source_status        text,
  -- Cancelar depois de receber é estorno, não cancelamento. Sem esta restrição,
  -- todo `WHERE status <> 'cancelado'` descartaria caixa que de fato se moveu.
  CONSTRAINT fin_document_cancelado_sem_caixa CHECK (status <> 'cancelado' OR settled_cents = 0),

  source               text NOT NULL CHECK (source IN ('asaas', 'import_csv', 'import_ofx', 'manual', 'contrato', 'folha', 'reembolso', 'implicito')),
  source_id            text,
  billing_type         text,
  installment_group_id text,
  installment_number   integer,
  installment_total    integer,
  CONSTRAINT fin_document_parcela_coerente CHECK (
    installment_number IS NULL OR installment_total IS NULL OR installment_number <= installment_total),

  -- Só preenchida quando o pagamento foi registrado ANTES de o dinheiro sair.
  --
  -- É a única coluna irrecuperável deste schema: o componente "cobertura de
  -- planejamento" do índice precisa provar precedência, e created_at não serve
  -- de proxy porque o backfill histórico grava data de hoje para pagamento de
  -- 2025.
  planned_at           timestamptz,

  -- Proveniência da classificação. Sem estas colunas, o badge "por quê?" da
  -- Fatia 1 não tem como existir e a fila de revisão não distingue "a regra R7
  -- classificou" de "ninguém classificou, é o padrão da categoria". Backfillar
  -- "qual regra casou e em que trecho" depois é impossível.
  classified_by        text CHECK (classified_by IN (
                         'humano', 'trava', 'fato_estrutural', 'contrato', 'favorecido', 'historico', 'regra', 'default')),
  classified_rule_id   bigint,
  classified_reason    jsonb,
  classified_at        timestamptz,

  -- Colunas que um humano editou. O UPSERT do sync noturno pula tudo listado
  -- aqui, e o gatilho fin_preserve_human_locks é a rede de segurança.
  --
  -- Sem isto, a sincronização diária apaga toda decisão de classificação da
  -- véspera e a fila de revisão vira trabalho de Sísifo.
  human_locked_fields  text[] NOT NULL DEFAULT '{}',
  review_status        text NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok', 'pendente', 'adiado', 'ignorado')),
  tags                 text[] NOT NULL DEFAULT '{}',
  external_url         text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text
);

CREATE UNIQUE INDEX fin_document_source_idx ON fin_document (source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX fin_document_due_idx ON fin_document (entity_id, direction, due_date);
-- Aging: entidade + sentido + vencimento, só o que está aberto. 281 de 3.350
-- linhas, então é um índice ~8% do tamanho que responde as faixas por range scan.
CREATE INDEX fin_document_open_idx
  ON fin_document (entity_id, direction, due_date) WHERE status IN ('emitido', 'parcial', 'confirmado');
CREATE INDEX fin_document_cash_date_idx
  ON fin_document (entity_id, direction, expected_cash_date)
  WHERE status IN ('previsto', 'emitido', 'confirmado', 'parcial');
CREATE INDEX fin_document_competence_idx ON fin_document (entity_id, competence_date);
CREATE INDEX fin_document_counterparty_idx ON fin_document (counterparty_id);
CREATE INDEX fin_document_review_idx ON fin_document (entity_id, review_status) WHERE review_status = 'pendente';
CREATE INDEX fin_document_installment_idx ON fin_document (installment_group_id) WHERE installment_group_id IS NOT NULL;
CREATE INDEX fin_document_tags_idx ON fin_document USING gin (tags);

DO $$
BEGIN
  CREATE INDEX fin_document_desc_trgm_idx ON fin_document USING gin (description_norm gin_trgm_ops);
EXCEPTION WHEN undefined_object OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm indisponível; dry-run de regra sobre documentos fará varredura';
END $$;

DROP TRIGGER IF EXISTS fin_document_touch ON fin_document;
CREATE TRIGGER fin_document_touch BEFORE UPDATE ON fin_document
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

DROP TRIGGER IF EXISTS fin_document_human_locks ON fin_document;
CREATE TRIGGER fin_document_human_locks BEFORE UPDATE ON fin_document
  FOR EACH ROW EXECUTE FUNCTION fin_preserve_human_locks();

-- ---------------------------------------------------------------------------
-- Notas fiscais — tabela SEPARADA, e isso não é preciosismo
-- ---------------------------------------------------------------------------
-- São 3.483 NFS-e, das quais 99,6% apontam para uma cobrança, somando R$ 4,2
-- milhões. Se entrassem em fin_document ao lado das 3.350 cobranças, ambas com
-- source='asaas' e direction='receber', o índice único ficaria satisfeito (ids
-- distintos) e `SUM(amount_cents) WHERE direction='receber'` devolveria QUASE O
-- DOBRO da receita.
--
-- É a mesma armadilha das 372 transferências internas, e o teste de aceite da
-- Fatia 1 (2025 = R$ 1,184 mi) falharia com um número perto de 2× — levando a
-- suspeita para a neutralização de transferências, que estaria correta.
--
-- Além disso a nota tem vida própria: 447 canceladas, 114 com erro, 117
-- agendadas até 2027, mais número, série, RPS, ISS e inscrição municipal, que a
-- Fase 4 precisa para o DAS sobre RBT12.
CREATE TABLE fin_fiscal_document (
  id                   bigserial PRIMARY KEY,
  entity_id            bigint NOT NULL REFERENCES fin_entity(id),
  -- A cobrança que esta nota documenta.
  document_id          bigint REFERENCES fin_document(id) ON DELETE SET NULL,
  counterparty_id      bigint REFERENCES fin_counterparty(id),
  kind                 text NOT NULL DEFAULT 'nfse' CHECK (kind IN ('nfse', 'nfe', 'recibo')),
  number               text,
  serie                text,
  rps_number           text,
  issue_date           date,
  competence_date      date,
  service_amount_cents bigint NOT NULL DEFAULT 0,
  deductions_cents     bigint NOT NULL DEFAULT 0,
  iss_rate             numeric(6,3),
  iss_cents            bigint NOT NULL DEFAULT 0,
  iss_withheld         boolean NOT NULL DEFAULT false,
  municipal_service_code text,
  municipal_service_name text,
  status               text NOT NULL,
  source               text NOT NULL DEFAULT 'asaas',
  source_id            text,
  pdf_url              text,
  xml_url              text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX fin_fiscal_document_source_idx ON fin_fiscal_document (source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX fin_fiscal_document_doc_idx ON fin_fiscal_document (document_id);
CREATE INDEX fin_fiscal_document_comp_idx ON fin_fiscal_document (entity_id, competence_date);

DROP TRIGGER IF EXISTS fin_fiscal_document_touch ON fin_fiscal_document;
CREATE TRIGGER fin_fiscal_document_touch BEFORE UPDATE ON fin_fiscal_document
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Lançamentos: a camada de caixa
-- ---------------------------------------------------------------------------
CREATE TABLE fin_transaction (
  id                   bigserial PRIMARY KEY,
  entity_id            bigint NOT NULL,
  account_id           bigint NOT NULL,

  -- O DIA-CALENDÁRIO em que o dinheiro se moveu. É por aqui que TUDO agrega.
  --
  -- Não é timestamptz de propósito. O Asaas devolve paymentDate/date como
  -- "2026-07-01" — dia de calendário, sem hora e sem fuso. Guardado como
  -- timestamptz isso vira 2026-07-01T00:00Z, que lido em BRT é 30/06 21h, e
  -- date_trunc joga a receita no mês anterior. O teste de aceite (jul/26 =
  -- R$ 240.906) falharia parecendo erro de regra de classificação.
  posted_on            date NOT NULL,
  -- O carimbo real, quando a fonte tem um (OFX e CSV do Nubank têm hora).
  -- Informativo: NUNCA usar em GROUP BY.
  posted_at            timestamptz,

  value_date           date,
  -- Só usada quando não há documento ligado. Com documento, a competência é a
  -- dele — a verdade sobre "quando foi ganho" mora num lugar só.
  competence_date      date,
  -- Assinado: positivo entra, negativo sai. Zero não é lançamento.
  amount_cents         bigint NOT NULL CHECK (amount_cents <> 0),
  description_raw      text NOT NULL,
  description_norm     text NOT NULL,
  counterparty_raw     text,
  counterparty_id      bigint REFERENCES fin_counterparty(id),
  category_id          bigint REFERENCES fin_category(id),
  nucleo               text REFERENCES fin_nucleo(slug),
  cost_center_id       bigint REFERENCES fin_cost_center(id),
  balance_after_cents  bigint,
  -- O tipo cru da fonte (financialTransaction.type do Asaas, TRNTYPE do OFX).
  -- Cru e não interpretado: é o campo de que a neutralização de transferências
  -- depende, e um importador escrevendo 'TRANSFER' contra uma consulta buscando
  -- 'transfer' faria a regra nº 1 do ledger casar nada, em silêncio.
  source_kind          text,

  -- Rateio de um lançamento em vários: um PIX que paga fornecedor de Obras e de
  -- Consultoria, uma fatura de cartão com 12 compras. Acontece toda semana e é
  -- irrepresentável com uma categoria só. O pai continua visível no extrato (é
  -- o que o banco mostra); os filhos carregam categoria e núcleo.
  --
  -- INVARIANTE: toda soma de dinheiro leva `AND NOT is_split_parent`.
  parent_id            bigint REFERENCES fin_transaction(id) ON DELETE CASCADE,
  is_split_parent      boolean NOT NULL DEFAULT false,

  -- Transferência entre contas próprias.
  --
  -- Booleano não bastava. Na Fatia 1 só o Asaas é importado: as 372 saídas
  -- (−R$ 3,82 mi) seriam marcadas como internas e sumiriam das agregações, mas
  -- a perna que chega no Nubank ainda não existe — o saldo consolidado ficaria
  -- menor sem explicação, na primeira tela que alguém abre.
  --
  -- 'em_transito' = saiu de uma conta e ainda não foi visto chegando. Continua
  -- visível, que é o número honesto. Só 'pareado' é neutralizado.
  transfer_status      text NOT NULL DEFAULT 'nao' CHECK (transfer_status IN ('nao', 'em_transito', 'pareado')),
  transfer_group_id    text,
  CONSTRAINT fin_transaction_transfer_group CHECK (transfer_status <> 'pareado' OR transfer_group_id IS NOT NULL),

  import_batch_id      bigint REFERENCES fin_import_batch(id) ON DELETE SET NULL,
  source               text NOT NULL CHECK (source IN ('asaas', 'import_csv', 'import_ofx', 'manual')),
  source_id            text,
  source_status        text,
  -- A receita do hash muda quando normalizeDescription mudar. Sem versão, os
  -- hashes antigos ficam irrecomputáveis: a próxima importação do Nubank geraria
  -- hashes novos para linhas que já existem, o índice único não dispararia, e o
  -- histórico inteiro da conta entraria duplicado sem ninguém notar.
  dedupe_version       smallint NOT NULL DEFAULT 1,
  dedupe_hash          text NOT NULL,
  reconciled_status    text NOT NULL DEFAULT 'nao_conciliado' CHECK (reconciled_status IN ('nao_conciliado', 'auto', 'manual', 'ignorado')),
  -- Onde o lançamento avulso vai parar. Às 8h da manhã, "o sócio pôs R$ 5.000 do
  -- bolso para material de obra" precisa entrar com data, valor, texto e conta e
  -- sumir da tela. Exigir cadastro de categoria e contraparte antes empurra para
  -- a planilha "só dessa vez" — e é assim que se perde.
  review_status        text NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok', 'pendente', 'adiado', 'ignorado')),

  classified_by        text CHECK (classified_by IN (
                         'humano', 'trava', 'fato_estrutural', 'contrato', 'favorecido', 'historico', 'regra', 'default')),
  classified_rule_id   bigint,
  classified_reason    jsonb,
  classified_at        timestamptz,

  tags                 text[] NOT NULL DEFAULT '{}',
  human_locked_fields  text[] NOT NULL DEFAULT '{}',
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,

  -- FK composta: sem isto um lançamento na conta do Asaas (empresa 1) podia
  -- carregar entity_id = 2, e todo relatório por empresa discordaria de todo
  -- relatório por conta.
  FOREIGN KEY (account_id, entity_id) REFERENCES fin_account (id, entity_id)
);

-- Camada 1 da idempotência: chave natural da fonte. Para as 12.181 transações
-- do Asaas e para OFX (FITID é a chave de idempotência do próprio banco), esta é
-- a dedupe CORRETA; dedupe_hash é o fallback para CSV sem id estável.
CREATE UNIQUE INDEX fin_transaction_source_idx ON fin_transaction (source, source_id) WHERE source_id IS NOT NULL;
-- Camada 2: última linha de defesa para as fontes sem id.
CREATE UNIQUE INDEX fin_transaction_dedupe_idx ON fin_transaction (account_id, dedupe_version, dedupe_hash);

CREATE INDEX fin_transaction_account_date_idx ON fin_transaction (account_id, posted_on DESC);
-- O índice do extrato e de toda agregação mensal de receita/despesa.
CREATE INDEX fin_transaction_ledger_idx
  ON fin_transaction (entity_id, posted_on DESC)
  WHERE transfer_status <> 'pareado' AND NOT is_split_parent;
CREATE INDEX fin_transaction_nucleo_idx ON fin_transaction (entity_id, nucleo, posted_on);
CREATE INDEX fin_transaction_category_idx ON fin_transaction (category_id, posted_on);
CREATE INDEX fin_transaction_counterparty_idx ON fin_transaction (counterparty_id);
CREATE INDEX fin_transaction_transfer_idx ON fin_transaction (transfer_group_id) WHERE transfer_group_id IS NOT NULL;
-- Pareamento de transferências: mesmo |valor|, sinais opostos, ±3 dias.
CREATE INDEX fin_transaction_transfer_match_idx
  ON fin_transaction (entity_id, (abs(amount_cents)), posted_on) WHERE transfer_group_id IS NULL;
CREATE INDEX fin_transaction_parent_idx ON fin_transaction (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX fin_transaction_unreconciled_idx ON fin_transaction (account_id, reconciled_status) WHERE reconciled_status = 'nao_conciliado';
-- A fila de revisão é ordenada por R$ em jogo, não por data: o Pareto faz as
-- ~100 primeiras decisões cobrirem a maior parte dos R$ 531 mil.
CREATE INDEX fin_transaction_review_idx
  ON fin_transaction (entity_id, (abs(amount_cents)) DESC)
  WHERE category_id IS NULL AND transfer_status = 'nao';
CREATE INDEX fin_transaction_import_idx ON fin_transaction (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX fin_transaction_tags_idx ON fin_transaction USING gin (tags);

DO $$
BEGIN
  CREATE INDEX fin_transaction_desc_trgm_idx ON fin_transaction USING gin (description_norm gin_trgm_ops);
EXCEPTION WHEN undefined_object OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm indisponível; busca no extrato fará varredura';
END $$;

DROP TRIGGER IF EXISTS fin_transaction_touch ON fin_transaction;
CREATE TRIGGER fin_transaction_touch BEFORE UPDATE ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

DROP TRIGGER IF EXISTS fin_transaction_human_locks ON fin_transaction;
CREATE TRIGGER fin_transaction_human_locks BEFORE UPDATE ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_preserve_human_locks();

-- ---------------------------------------------------------------------------
-- Liquidação: que dinheiro pagou que documento
-- ---------------------------------------------------------------------------
-- N:N de propósito. Um PIX pode quitar duas faturas; uma fatura pode ser paga em
-- duas transferências.
--
-- CONVENÇÃO DE SINAL, escrita aqui e não num commit: amount_cents é POSITIVO em
-- 'liquidacao' e NEGATIVO em 'estorno'. O sentido do dinheiro vem de
-- fin_document.direction; o sinal do caixa vem de fin_transaction.amount_cents.
-- Sem isto fixado, dois desenvolvedores escolhem diferente e a divergência só
-- aparece quando um documento a pagar mostra −R$ 40.000 liquidados.
CREATE TABLE fin_settlement (
  id             bigserial PRIMARY KEY,
  transaction_id bigint NOT NULL REFERENCES fin_transaction(id) ON DELETE CASCADE,
  document_id    bigint NOT NULL REFERENCES fin_document(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'liquidacao' CHECK (kind IN ('liquidacao', 'estorno')),
  amount_cents   bigint NOT NULL,
  CONSTRAINT fin_settlement_sinal CHECK (
    (kind = 'liquidacao' AND amount_cents > 0) OR (kind = 'estorno' AND amount_cents < 0)),
  method         text NOT NULL CHECK (method IN ('auto_asaas', 'auto_transferencia', 'auto_regra', 'sugestao_aceita', 'manual')),
  -- smallint 0..100, não numeric: numeric volta como string se o parser de tipo
  -- não estiver registrado, e a escala ficaria ambígua (0.87 ou 87?).
  confidence     smallint CHECK (confidence BETWEEN 0 AND 100),
  matched_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,
  UNIQUE (transaction_id, document_id)
);

CREATE INDEX fin_settlement_document_idx ON fin_settlement (document_id);

-- settled_cents e status derivam de fin_settlement e são mantidos por GATILHO,
-- não pela aplicação. Três razões, e a terceira decide:
--
--   (a) liquidações são escritas de pelo menos quatro lugares — sync noturno,
--       importação de extrato, tela de conciliação manual e o futuro
--       reconhecedor de pagamentos;
--   (b) qualquer um deles esquecer produz divergência silenciosa entre o aging
--       e a conciliação, que leva semanas para alguém notar;
--   (c) ON DELETE CASCADE não passa pela aplicação. Reverter uma importação
--       (`DELETE FROM fin_transaction WHERE import_batch_id = 47`) apaga as
--       liquidações em cascata e deixaria documentos marcados 'liquidado' com
--       zero liquidações. Gatilho AFTER DELETE dispara em cascata; código não.
CREATE OR REPLACE FUNCTION fin_document_refresh_settlement(p_document_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s bigint;
  doc fin_document%ROWTYPE;
BEGIN
  SELECT * INTO doc FROM fin_document WHERE id = p_document_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO s FROM fin_settlement WHERE document_id = p_document_id;

  UPDATE fin_document d
     SET settled_cents = s,
         status = CASE
           WHEN d.status = 'cancelado' THEN 'cancelado'
           -- Já houve caixa e agora a soma zerou: foi devolvido.
           WHEN s = 0 AND d.settled_cents <> 0 THEN 'estornado'
           WHEN s = 0 AND d.status = 'previsto' THEN 'previsto'
           WHEN s = 0 THEN 'emitido'
           -- O desconto concedido reduz o que falta liquidar. A liquidação é
           -- pelo BRUTO (a tarifa do Asaas é transação própria), então não há
           -- tolerância a inventar: bruto contra bruto fecha exato.
           WHEN s + d.discount_cents >= d.amount_cents THEN 'liquidado'
           ELSE 'parcial'
         END,
         updated_at = now()
   WHERE d.id = p_document_id;
END $$;

CREATE OR REPLACE FUNCTION fin_settlement_maintain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM fin_document_refresh_settlement(OLD.document_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM fin_document_refresh_settlement(NEW.document_id); END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER fin_settlement_maintains_document
  AFTER INSERT OR UPDATE OR DELETE ON fin_settlement
  FOR EACH ROW EXECUTE FUNCTION fin_settlement_maintain();

-- ---------------------------------------------------------------------------
-- Fotografia diária de saldo
-- ---------------------------------------------------------------------------
CREATE TABLE fin_balance_snapshot (
  id             bigserial PRIMARY KEY,
  account_id     bigint NOT NULL REFERENCES fin_account(id) ON DELETE CASCADE,
  date           date NOT NULL,
  balance_cents  bigint NOT NULL,
  source         text NOT NULL CHECK (source IN ('extrato', 'api', 'calculado')),
  computed_cents bigint,
  variance_cents bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, date, source)
);

CREATE INDEX fin_balance_snapshot_date_idx ON fin_balance_snapshot (date DESC);

-- ---------------------------------------------------------------------------
-- Definições canônicas
-- ---------------------------------------------------------------------------
-- "Receita" precisa ter UMA definição no banco, não uma por tela.
--
-- O teste de aceite diz 2025 = R$ 1,184 mi, mas nada no schema diz se isso é
-- caixa ou competência — e os dois números diferem. Toda futura discussão de
-- "esta tela não bate com aquela" é uma variante de duas consultas definindo
-- receita de um jeito ligeiramente diferente. O script de teste, /financeiro,
-- /financeiro/receitas e /financeiro/indicadores leem daqui.
CREATE OR REPLACE VIEW fin_revenue_cash_v AS
SELECT t.entity_id,
       t.posted_on,
       date_trunc('month', t.posted_on)::date AS month,
       t.nucleo,
       t.category_id,
       t.counterparty_id,
       t.amount_cents
  FROM fin_transaction t
 WHERE t.amount_cents > 0
   AND t.transfer_status <> 'pareado'
   AND NOT t.is_split_parent;

COMMENT ON VIEW fin_revenue_cash_v IS
  'Receita em regime de CAIXA: entradas que não são transferência pareada nem pai de rateio.';

CREATE OR REPLACE VIEW fin_revenue_accrual_v AS
SELECT d.entity_id,
       d.competence_date,
       date_trunc('month', d.competence_date)::date AS month,
       d.nucleo,
       d.category_id,
       d.counterparty_id,
       d.amount_cents
  FROM fin_document d
 WHERE d.direction = 'receber'
   AND d.status <> 'cancelado';

COMMENT ON VIEW fin_revenue_accrual_v IS
  'Receita em regime de COMPETÊNCIA: documentos a receber não cancelados. Nunca somar com fin_fiscal_document — a nota fiscal espelha a cobrança e dobraria o valor.';
