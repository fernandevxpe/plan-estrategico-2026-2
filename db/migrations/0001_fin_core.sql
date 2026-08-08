-- Dimensões do módulo financeiro: empresa, núcleos, centros de custo, contas,
-- plano de contas, contrapartes, favorecidos, contratos e reservas.
--
-- Três decisões transversais, porque não são óbvias lendo só o schema:
--
-- 1. DINHEIRO EM bigint DE CENTAVOS, nunca float, nunca numeric. O driver `pg`
--    devolve numeric e bigint como string, e somar dinheiro vira concatenação
--    silenciosa. scripts/lib/fin-types.mjs registra os parsers uma vez, para os
--    scripts e para a aplicação — se só um lado registrasse, a mesma consulta
--    devolveria 1184000 num e "1184000" no outro.
--
-- 2. DIMENSÃO QUE A TELA CRIA É TABELA; DIMENSÃO QUE O CÓDIGO RAMIFICA É CHECK.
--    Núcleo, centro de custo e grupo de fluxo de caixa são criados pela tela →
--    tabela com FK por slug (as consultas seguem legíveis: WHERE nucleo='obras').
--    toc_class, dre_line, direction e kind têm um ramo de código por valor →
--    CHECK. A primeira versão tinha núcleo como CHECK repetido em cinco tabelas,
--    o que faria criar um quinto núcleo custar cinco ACCESS EXCLUSIVE na tabela
--    mais quente, dentro de um deploy — contra um INSERT.
--
-- 3. NADA DE `IF NOT EXISTS` A PARTIR DA 0002. Aqui é aceitável porque é a
--    primeira migration. Depois, `IF NOT EXISTS` transforma "esta migration
--    rodou pela metade" em sucesso silencioso.

-- ---------------------------------------------------------------------------
-- Funções compartilhadas
-- ---------------------------------------------------------------------------

-- updated_at não se mantém sozinho. Sem isto, toda consulta incremental ("o que
-- mudou desde o último sync", "editado recentemente") lê a data de criação.
CREATE OR REPLACE FUNCTION fin_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Protege as colunas que um humano editou contra o UPSERT do sync noturno.
--
-- O UPSERT do importador já faz isso campo a campo, mas depende de todo autor
-- futuro lembrar de acrescentar o CASE ao adicionar coluna. Este gatilho é a
-- rede: durante o sync (fin.sync_mode = 'on'), qualquer coluna listada em
-- human_locked_fields é restaurada a partir de OLD.
--
-- Um nome de coluna inválido — 'categoria_id' em vez de 'category_id' — estoura
-- alto no primeiro sync, em vez de proteger nada em silêncio para sempre.
--
-- A UI nunca liga fin.sync_mode, então edição humana passa direto e pode
-- legitimamente alterar uma coluna travada.
CREATE OR REPLACE FUNCTION fin_preserve_human_locks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
  old_j jsonb;
  new_j jsonb;
BEGIN
  IF COALESCE(current_setting('fin.sync_mode', true), 'off') <> 'on' THEN RETURN NEW; END IF;
  IF array_length(OLD.human_locked_fields, 1) IS NULL THEN RETURN NEW; END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);
  FOREACH col IN ARRAY OLD.human_locked_fields LOOP
    IF NOT old_j ? col THEN
      RAISE EXCEPTION 'human_locked_fields aponta para coluna inexistente em %: %', TG_TABLE_NAME, col;
    END IF;
    new_j := jsonb_set(new_j, ARRAY[col], old_j -> col);
  END LOOP;
  new_j := jsonb_set(new_j, '{human_locked_fields}', to_jsonb(OLD.human_locked_fields));
  RETURN jsonb_populate_record(NEW, new_j);
END $$;

-- Busca aproximada de nome na conciliação. Degrada para prefixo se a extensão
-- não estiver disponível — não pode derrubar o boot.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm indisponível; conciliação por nome usará prefixo';
END $$;

-- ---------------------------------------------------------------------------
-- Empresa
-- ---------------------------------------------------------------------------
-- Hoje existe uma só (XPE Tecnologia / XP Energy). entity_id aparece em tudo
-- mesmo assim: é barato agora e caríssimo de retrofitar se o núcleo de Obras um
-- dia virar CNPJ próprio. E é NOT NULL em toda parte de propósito — nullable
-- desliga silenciosamente os índices únicos que dependem dele, porque num índice
-- único NULLs são distintos entre si.
CREATE TABLE IF NOT EXISTS fin_entity (
  id         bigserial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  trade_name text,
  cnpj       text UNIQUE,
  tax_regime text NOT NULL DEFAULT 'simples' CHECK (tax_regime IN ('simples', 'presumido', 'real')),
  timezone   text NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Dimensões criadas pela tela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_nucleo (
  slug        text PRIMARY KEY,
  name        text NOT NULL,
  -- Núcleo que recebe o que não pertence a nenhum outro: na visão Throughput é
  -- o bloco não alocado, na visão DRE é o alvo do rateio.
  is_overhead boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS fin_cost_center (
  id         bigserial PRIMARY KEY,
  entity_id  bigint NOT NULL REFERENCES fin_entity(id),
  slug       text NOT NULL,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (entity_id, slug)
);

-- As 8 categorias de fluxo de caixa hoje preenchidas à mão na planilha.
--
-- Ganham tabela porque são o critério de aceite da migração ("verificável linha
-- a linha"). Como texto livre, "Custos Fixos" e "Custos fixos" seriam grupos
-- diferentes e a conferência contra a planilha nunca fecharia — silenciosamente.
--
-- Nasce vazia: os nomes exatos ainda são uma pendência com o negócio. A FK já
-- protege contra digitação divergente enquanto isso.
CREATE TABLE IF NOT EXISTS fin_cash_flow_group (
  slug       text PRIMARY KEY,
  name       text NOT NULL,
  direction  text NOT NULL CHECK (direction IN ('entrada', 'saida', 'ambos')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Contas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_account (
  id                    bigserial PRIMARY KEY,
  entity_id             bigint NOT NULL REFERENCES fin_entity(id),
  slug                  text NOT NULL,
  name                  text NOT NULL,
  institution           text NOT NULL,
  -- 'emprestimo' fica fora de "caixa disponível": saldo negativo ali é normal, e
  -- somá-lo faria o runway mentir.
  kind                  text NOT NULL CHECK (kind IN ('gateway', 'conta_corrente', 'aplicacao', 'emprestimo', 'cartao', 'caixa_fisico')),
  import_adapter        text NOT NULL CHECK (import_adapter IN ('asaas_api', 'nubank_csv', 'inter_csv', 'inter_ofx', 'caixa_ofx', 'caixa_csv', 'manual')),
  currency              char(3) NOT NULL DEFAULT 'BRL',
  opening_balance_cents bigint NOT NULL DEFAULT 0,
  opening_balance_date  date,
  current_balance_cents bigint NOT NULL DEFAULT 0,
  -- Alimenta o alarme de "extrato parado há N dias" — a restrição real do
  -- sistema enquanto a importação for manual.
  last_statement_at     timestamptz,
  external_id           text,
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, slug),
  -- Alvo da FK composta de fin_transaction. Sem ela um lançamento na conta do
  -- Asaas (empresa 1) poderia carregar entity_id = 2, e todo relatório por
  -- empresa discordaria de todo relatório por conta — sem erro nenhum.
  UNIQUE (id, entity_id)
);

-- ---------------------------------------------------------------------------
-- Plano de contas: uma árvore, três projeções
-- ---------------------------------------------------------------------------
-- O nó é classificado UMA vez e lido de três formas, o que permite mostrar
-- Throughput e DRE lado a lado sem ninguém reetiquetar nada:
--   toc_class       → visão TOC (gestao-xpe/17_throughput_accounting_xpe.md)
--   dre_line        → DRE convencional
--   cash_flow_group → as 8 categorias da planilha
CREATE TABLE IF NOT EXISTS fin_category (
  id                     bigserial PRIMARY KEY,
  entity_id              bigint NOT NULL REFERENCES fin_entity(id),
  parent_id              bigint REFERENCES fin_category(id),
  code                   text NOT NULL,
  name                   text NOT NULL,
  kind                   text NOT NULL CHECK (kind IN (
                           'receita', 'deducao_receita', 'custo_variavel_direto', 'despesa_operacional',
                           'pessoal', 'imposto', 'investimento', 'movimentacao_financeira')),
  toc_class              text NOT NULL CHECK (toc_class IN (
                           'throughput_receita', 'custo_totalmente_variavel', 'despesa_operacional',
                           'investimento', 'neutro')),
  dre_line               text NOT NULL CHECK (dre_line IN (
                           'receita_bruta', 'deducoes', 'custos_servicos', 'despesas_comerciais',
                           'despesas_administrativas', 'despesas_pessoal', 'resultado_financeiro',
                           'impostos', 'investimentos', 'nao_operacional')),
  cash_flow_group        text REFERENCES fin_cash_flow_group(slug),
  default_nucleo         text REFERENCES fin_nucleo(slug),
  default_cost_center_id bigint REFERENCES fin_cost_center(id),
  requires_nfe           boolean NOT NULL DEFAULT false,
  is_active              boolean NOT NULL DEFAULT true,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, code)
);

CREATE INDEX IF NOT EXISTS fin_category_parent_idx ON fin_category (parent_id);
CREATE INDEX IF NOT EXISTS fin_category_toc_idx ON fin_category (toc_class) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Contrapartes e favorecidos
-- ---------------------------------------------------------------------------
-- Cliente, fornecedor e colaborador na mesma tabela porque o mundo real não os
-- separa: a PIAU é cliente e parceira; um colaborador recebe salário e devolve
-- parcela de equipamento. Separar obrigaria a duplicar CNPJ e a conciliar dois
-- cadastros do mesmo nome.
CREATE TABLE IF NOT EXISTS fin_counterparty (
  id                     bigserial PRIMARY KEY,
  entity_id              bigint NOT NULL REFERENCES fin_entity(id),
  kind                   text NOT NULL CHECK (kind IN ('cliente', 'fornecedor', 'colaborador', 'governo', 'socio', 'instituicao_financeira', 'outro')),
  name                   text NOT NULL,
  -- Minúscula, sem acento, sem pontuação, sem forma societária. Produzida por
  -- scripts/lib/fin-normalize.mjs → normalizeName().
  normalized_name        text NOT NULL,
  document_type          text CHECK (document_type IN ('cnpj', 'cpf')),
  document_number        text,
  asaas_customer_id      text,
  pipedrive_org_id       bigint,
  default_category_id    bigint REFERENCES fin_category(id),
  default_nucleo         text REFERENCES fin_nucleo(slug),
  default_cost_center_id bigint REFERENCES fin_cost_center(id),
  tags                   text[] NOT NULL DEFAULT '{}',
  notes                  text,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fin_counterparty_document_idx
  ON fin_counterparty (entity_id, document_number) WHERE document_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fin_counterparty_asaas_idx
  ON fin_counterparty (entity_id, asaas_customer_id) WHERE asaas_customer_id IS NOT NULL;

-- btree simples só serve para `=`. A conciliação precisa casar "CONDOMINIO
-- EDIFICIO X" do extrato com o cadastro, o que exige prefixo (text_pattern_ops)
-- e semelhança (trigram).
CREATE INDEX IF NOT EXISTS fin_counterparty_norm_prefix_idx
  ON fin_counterparty (normalized_name text_pattern_ops);
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS fin_counterparty_norm_trgm_idx
    ON fin_counterparty USING gin (normalized_name gin_trgm_ops);
EXCEPTION WHEN undefined_object OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm indisponível; casamento de nome ficará por prefixo';
END $$;

DROP TRIGGER IF EXISTS fin_counterparty_touch ON fin_counterparty;
CREATE TRIGGER fin_counterparty_touch BEFORE UPDATE ON fin_counterparty
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Dados bancários dos favorecidos.
--
-- Esta tabela é a chave para descontinuar o Inter: ele sobrevive porque os
-- beneficiários estão cadastrados e favoritados lá, não por função bancária.
-- Com o cadastro aqui, dá para exportar a lista e recadastrar tudo no Asaas de
-- uma vez, em vez de um por um sob pressão de pagamento.
--
-- As colunas são deliberadamente as que POST /transfers do Asaas consome, para
-- que ligar pagamento automático seja acrescentar um executor, não remodelar
-- cadastro.
CREATE TABLE IF NOT EXISTS fin_payee_account (
  id                   bigserial PRIMARY KEY,
  counterparty_id      bigint NOT NULL REFERENCES fin_counterparty(id) ON DELETE CASCADE,
  label                text,
  operation_type       text NOT NULL DEFAULT 'PIX' CHECK (operation_type IN ('PIX', 'TED')),
  pix_address_key      text,
  pix_address_key_type text CHECK (pix_address_key_type IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP')),
  bank_code            text,
  bank_name            text,
  agency               text,
  account_number       text,
  account_digit        text,
  account_type         text CHECK (account_type IN ('CONTA_CORRENTE', 'CONTA_POUPANCA')),
  owner_name           text,
  owner_document       text,
  -- Marca o que já migrou do Inter para o Asaas.
  registered_at_asaas  boolean NOT NULL DEFAULT false,
  is_default           boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_payee_account_counterparty_idx ON fin_payee_account (counterparty_id) WHERE is_active;

-- Um favorecido padrão por contraparte. Sem esta restrição, quando o pagamento
-- automático chegar, POST /transfers escolheria uma entre duas chaves marcadas
-- como padrão — e o dinheiro iria para o lugar errado, em silêncio.
CREATE UNIQUE INDEX IF NOT EXISTS fin_payee_default_idx
  ON fin_payee_account (counterparty_id) WHERE is_default AND is_active;

-- ---------------------------------------------------------------------------
-- Contratos e recorrência
-- ---------------------------------------------------------------------------
-- Existe sobretudo por causa da PIAU: R$ 772 mil no histórico, ~20% da receita,
-- ~R$ 15 mil/mês — e NÃO é assinatura do Asaas, chega como cobrança avulsa. Uma
-- previsão baseada em GET /subscriptions enxergaria 3% da recorrência real
-- (R$ 9 mil/mês das 27 assinaturas) e ignoraria a maior dependência da empresa.
CREATE TABLE IF NOT EXISTS fin_contract (
  id                    bigserial PRIMARY KEY,
  entity_id             bigint NOT NULL REFERENCES fin_entity(id),
  counterparty_id       bigint REFERENCES fin_counterparty(id),
  name                  text NOT NULL,
  direction             text NOT NULL DEFAULT 'receber' CHECK (direction IN ('receber', 'pagar')),
  kind                  text NOT NULL CHECK (kind IN ('assinatura', 'retainer', 'comissionamento', 'obra', 'projeto', 'despesa_recorrente')),
  category_id           bigint REFERENCES fin_category(id),
  nucleo                text REFERENCES fin_nucleo(slug),
  cost_center_id        bigint REFERENCES fin_cost_center(id),
  account_id            bigint REFERENCES fin_account(id),
  amount_cents          bigint NOT NULL DEFAULT 0,
  recurrence            text NOT NULL DEFAULT 'mensal' CHECK (recurrence IN ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual', 'unico')),
  day_of_month          integer CHECK (day_of_month BETWEEN 1 AND 31),
  -- Dia 31 num contrato mensal é legítimo (aluguel "todo dia 31"); o gerador
  -- resolve fevereiro grampeando no último dia do mês. Regra documentada aqui
  -- para não ser reinventada em cada lugar que gera parcela.
  due_day_rule          text NOT NULL DEFAULT 'posterga' CHECK (due_day_rule IN ('antecipa', 'posterga', 'exato')),
  start_date            date,
  end_date              date,
  asaas_subscription_id text,
  confidence            text NOT NULL DEFAULT 'contratado' CHECK (confidence IN ('contratado', 'previsto')),
  status                text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'encerrado')),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fin_contract_asaas_idx
  ON fin_contract (entity_id, asaas_subscription_id) WHERE asaas_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_contract_status_idx ON fin_contract (entity_id, status, direction);

DROP TRIGGER IF EXISTS fin_contract_touch ON fin_contract;
CREATE TRIGGER fin_contract_touch BEFORE UPDATE ON fin_contract
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Reservas nomeadas
-- ---------------------------------------------------------------------------
-- A planilha v3.1 tem quatro, não uma: Caixa R$ 122.037,72 · Brindes Clientes
-- R$ 65.106,09 · Eventos R$ 32.553,04 · Brindes Membros R$ 10.851,01.
--
-- Sem esta tabela o primeiro número que aparece na tela ("saldo disponível") já
-- está errado, porque mostra como livre um dinheiro que tem dono.
CREATE TABLE IF NOT EXISTS fin_reserve (
  id            bigserial PRIMARY KEY,
  entity_id     bigint NOT NULL REFERENCES fin_entity(id),
  slug          text NOT NULL,
  name          text NOT NULL,
  account_id    bigint REFERENCES fin_account(id),
  target_cents  bigint NOT NULL DEFAULT 0,
  current_cents bigint NOT NULL DEFAULT 0,
  is_committed  boolean NOT NULL DEFAULT true,
  notes         text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (entity_id, slug)
);
