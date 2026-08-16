-- A operação de saída de dinheiro passa a existir como dado: pedido de compra,
-- fila de pagamento, alçada, lote, comprovante e conciliação.
--
-- ===========================================================================
-- 0. A REGRA QUE ESTA MIGRATION EXISTE PARA PROTEGER
-- ===========================================================================
--
--   NENHUMA LINHA DESTE SCHEMA EXECUTA PAGAMENTO.
--
-- O produto PREPARA (junta beneficiário, conta, valor, documento, projeto),
-- VALIDA (alerta duplicidade, favorecido novo, valor fora do padrão, documento
-- faltante), APROVA (alçada com segregação de funções), LOTEIA (agrupa por dia
-- e conta pagadora para conferência) e AUDITA (histórico completo, conciliação
-- posterior contra o extrato).
--
-- A AUTORIZAÇÃO JUNTO AO BANCO É HUMANA E ACONTECE FORA DAQUI.
--
-- Consequências que este arquivo assume, e que qualquer migration futura tem de
-- respeitar sob pena de invalidar a garantia:
--
--   a) Não existe coluna de credencial, endpoint, token, `api_payment_id` ou
--      qualquer campo cuja semântica seja "mandar para o banco". Se alguém
--      precisar de um, é sinal de que a regra está sendo contornada.
--
--   b) `fin_payment_execution` é REGISTRO, não ordem. Cada linha descreve um
--      pagamento que um humano JÁ FEZ no aplicativo do banco. Por isso
--      `paid_on` é obrigatório e não pode ser futuro: não se registra o que
--      ainda não aconteceu. O nome da coluna de quem registrou é
--      `registered_by`, não `executed_by`, para que a leitura do schema não
--      sugira o contrário.
--
--   c) O lote é um DOCUMENTO DE CONFERÊNCIA. `exported_at` significa "a lista
--      saiu em papel/planilha para alguém conferir e digitar", nunca "foi
--      transmitido". Por isso o lote tem `authorized_outside_system`,
--      `authorized_by` e `authorized_at` — três campos que só um humano
--      preenche, depois do fato.
--
--   d) O ledger (`fin_transaction`) continua sendo alimentado só por extrato.
--      Uma solicitação aprovada NÃO vira lançamento. A ligação entre os dois
--      mundos é a conciliação posterior (`fin_payment_execution.transaction_id`),
--      feita quando o extrato do banco trouxer a saída de verdade. Previsto
--      nunca vira realizado — a mesma invariante que a 0057 protege para as
--      recorrentes.
--
-- ===========================================================================
-- 1. O QUE SE REAPROVEITA, E POR QUÊ NÃO SE DUPLICA
-- ===========================================================================
--
--   fin_counterparty      495 contrapartes, 95,9% com documento. É o cadastro
--                         de beneficiário. Não se cria "fornecedor" aqui.
--   fin_payee_account     coordenada bancária do beneficiário (PIX/TED). Está
--                         VAZIA hoje (0 linhas) — a fila nasce sabendo disso e
--                         trata "sem conta bancária" como pendência declarada,
--                         não como campo em branco.
--   fin_category          55 categorias, com dre_line e cash_flow_group.
--   fin_cost_center       27 centros, `kind='projeto'` para obra/consultoria.
--   fin_budget_target     114 metas; o realizado sai de fin_orcado_realizado_v.
--   fin_recurring         145 recorrentes detectadas — servem para NÃO alarmar
--                         duplicidade no que é mensal por natureza.
--   fin_document          contas a pagar/receber. Uma solicitação pode apontar
--                         para um documento existente em vez de recriá-lo.
--   fin_fiscal_document   3.521 NFe. Anexo fiscal aponta para cá, não copia.
--   fin_audit_log         histórico. Os gatilhos desta migration escrevem nele,
--                         em vez de inventar uma segunda trilha.
--
-- ===========================================================================
-- 2. ALÇADA: A TABELA NASCE VAZIA DE PROPÓSITO
-- ===========================================================================
--
-- `fin_approval_rule` não recebe seed. Semear um teto ("até R$ 5.000 um
-- aprovador") seria inventar política de governança, que é decisão do dono e
-- não do schema. Enquanto não houver regra declarada, NADA pode ser aprovado —
-- e `fin_pagamento_pendencia_v` diz exatamente isso, em vez de deixar a fila
-- parada sem explicação. Vazio declarado é melhor que número inventado.

-- ---------------------------------------------------------------------------
-- 3. SOLICITAÇÃO DE COMPRA
-- ---------------------------------------------------------------------------
-- O começo da cadeia. O time pede; o financeiro converte em pagamento quando
-- (e se) a compra acontecer. Uma compra pode gerar N pagamentos (parcelas,
-- entrada+saldo), e por isso a relação é 1:N e não 1:1.

CREATE SEQUENCE IF NOT EXISTS fin_purchase_request_code_seq;

CREATE TABLE fin_purchase_request (
  id                    bigserial PRIMARY KEY,
  entity_id             bigint NOT NULL REFERENCES fin_entity(id),
  code                  text NOT NULL UNIQUE,

  -- O que se quer comprar, na língua de quem pediu.
  title                 text NOT NULL,
  description           text,
  -- Justificativa não é burocracia: é o que a tela mostra ao lado da decisão.
  -- Sem ela, aprovar vira carimbo.
  justification         text,

  -- Dimensões. Todas opcionais no rascunho e exigidas na aprovação (seção 9):
  -- obrigar projeto no momento do pedido faria o time inventar um.
  counterparty_id       bigint REFERENCES fin_counterparty(id),
  category_id           bigint REFERENCES fin_category(id),
  nucleo                text REFERENCES fin_nucleo(slug),
  cost_center_id        bigint REFERENCES fin_cost_center(id),

  -- Valor estimado e de onde saiu a estimativa. `amount_basis` separa
  -- "cotação na mão" de "chute" — e a alçada pode exigir cotação acima de X.
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  amount_basis          text NOT NULL DEFAULT 'estimativa'
                          CHECK (amount_basis IN ('cotacao', 'contrato', 'tabela', 'historico', 'estimativa')),
  quotes_count          integer NOT NULL DEFAULT 0 CHECK (quotes_count >= 0),

  needed_by             date,
  priority              text NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('critica', 'alta', 'normal', 'baixa')),

  status                text NOT NULL DEFAULT 'rascunho'
                          CHECK (status IN ('rascunho', 'enviada', 'em_cotacao', 'aprovada',
                                            'reprovada', 'cancelada', 'atendida')),

  -- Orçamento. A linha do modelo é o endereço orçamentário; o valor disponível
  -- é calculado na hora pela view, não congelado aqui — congelar produziria um
  -- número que envelhece em silêncio. O que se congela é a FOTO do momento da
  -- decisão, para a auditoria saber com que informação a pessoa decidiu.
  budget_line_slug      text,
  budget_ano            integer CHECK (budget_ano IS NULL OR (budget_ano BETWEEN 2000 AND 2100)),
  budget_periodo        integer,
  budget_snapshot       jsonb,

  requested_by          text NOT NULL,
  requested_person_id   bigint REFERENCES fin_person(id),
  requested_at          timestamptz NOT NULL DEFAULT now(),

  decided_by            text,
  decided_at            timestamptz,
  decision_reason       text,

  source                text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'app_time', 'clickup', 'importacao')),
  source_id             text,
  tags                  text[] NOT NULL DEFAULT '{}',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Decisão exige autor e data juntos. Meia decisão gravada é pior que
  -- nenhuma: a fila some da tela sem que ninguém tenha assinado.
  CONSTRAINT fin_purchase_decisao_completa
    CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT fin_purchase_decidida_tem_autor
    CHECK (status NOT IN ('aprovada', 'reprovada') OR decided_by IS NOT NULL),
  CONSTRAINT fin_purchase_orcamento_coerente
    CHECK ((budget_line_slug IS NULL) = (budget_ano IS NULL)
           AND (budget_line_slug IS NULL) = (budget_periodo IS NULL)),
  CONSTRAINT fin_purchase_budget_line_fk
    FOREIGN KEY (entity_id, budget_line_slug) REFERENCES fin_model_line(entity_id, slug) ON UPDATE CASCADE
);

CREATE INDEX fin_purchase_request_fila_idx
  ON fin_purchase_request (entity_id, status, needed_by)
  WHERE status IN ('enviada', 'em_cotacao', 'aprovada');
CREATE INDEX fin_purchase_request_counterparty_idx ON fin_purchase_request (counterparty_id);
CREATE INDEX fin_purchase_request_cost_center_idx ON fin_purchase_request (cost_center_id);
CREATE UNIQUE INDEX fin_purchase_request_source_idx
  ON fin_purchase_request (entity_id, source, source_id) WHERE source_id IS NOT NULL;

COMMENT ON TABLE fin_purchase_request IS
  'Pedido de compra do time. Não é compromisso de caixa: só vira saída quando um '
  'fin_payment_request nasce a partir dele. Somar as duas camadas conta duas vezes.';
COMMENT ON COLUMN fin_purchase_request.budget_snapshot IS
  'Foto do orçamento disponível no instante da decisão (meta, realizado, comprometido). '
  'Existe para a auditoria saber com que informação a pessoa decidiu — o número corrente '
  'sai sempre de fin_orcamento_disponivel_v.';

-- ---------------------------------------------------------------------------
-- 4. SOLICITAÇÃO DE PAGAMENTO — a fila
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS fin_payment_request_code_seq;

CREATE TABLE fin_payment_request (
  id                    bigserial PRIMARY KEY,
  entity_id             bigint NOT NULL REFERENCES fin_entity(id),
  code                  text NOT NULL UNIQUE,

  -- De onde veio. No máximo UMA origem — senão a mesma obrigação entra na fila
  -- por dois caminhos e o caixa previsto dobra (a lição da 0045 e da 0057).
  purchase_request_id   bigint REFERENCES fin_purchase_request(id),
  document_id           bigint REFERENCES fin_document(id),
  recurring_id          bigint REFERENCES fin_recurring(id) ON DELETE SET NULL,
  reimbursement_id      bigint REFERENCES fin_reimbursement(id),
  card_bill_id          bigint REFERENCES fin_card_bill(id),

  -- Beneficiário. `counterparty_id` é obrigatório: pagar para "não sei quem" é
  -- exatamente o buraco que esta fila existe para fechar.
  counterparty_id       bigint NOT NULL REFERENCES fin_counterparty(id),
  payee_account_id      bigint REFERENCES fin_payee_account(id),
  -- Snapshot da coordenada bancária no momento em que foi escolhida. Sem isto,
  -- editar a conta do fornecedor reescreve retroativamente para onde o dinheiro
  -- foi — que é a assinatura clássica da fraude de troca de favorecido.
  payee_snapshot        jsonb,
  payee_fingerprint     text,

  description           text NOT NULL,
  description_norm      text NOT NULL,

  category_id           bigint REFERENCES fin_category(id),
  nucleo                text REFERENCES fin_nucleo(slug),
  cost_center_id        bigint REFERENCES fin_cost_center(id),

  competence_date       date,
  due_date              date NOT NULL,
  scheduled_for         date,

  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  discount_cents        bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  interest_cents        bigint NOT NULL DEFAULT 0 CHECK (interest_cents >= 0),
  fine_cents            bigint NOT NULL DEFAULT 0 CHECK (fine_cents >= 0),
  net_cents             bigint GENERATED ALWAYS AS
                          (amount_cents - discount_cents + interest_cents + fine_cents) STORED,
  -- Mantido por gatilho a partir de fin_payment_execution. Nunca escrito à mão.
  paid_cents            bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),

  method                text CHECK (method IN ('pix', 'ted', 'boleto', 'debito_automatico', 'cartao', 'dinheiro')),
  from_account_id       bigint REFERENCES fin_account(id),

  priority              text NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('critica', 'alta', 'normal', 'baixa')),

  -- A máquina de estados. `aguardando_autorizacao` é o estado em que o produto
  -- termina o seu trabalho: o lote saiu, a pessoa está no aplicativo do banco.
  -- Nenhuma transição a partir dele é automática.
  status                text NOT NULL DEFAULT 'rascunho'
                          CHECK (status IN ('rascunho', 'em_aprovacao', 'aprovada', 'em_lote',
                                            'aguardando_autorizacao', 'pago_parcial', 'pago',
                                            'rejeitada', 'cancelada', 'devolvida')),
  hold_reason           text,

  budget_line_slug      text,
  budget_ano            integer CHECK (budget_ano IS NULL OR (budget_ano BETWEEN 2000 AND 2100)),
  budget_periodo        integer,
  budget_snapshot       jsonb,

  requested_by          text NOT NULL,
  requested_person_id   bigint REFERENCES fin_person(id),
  requested_at          timestamptz NOT NULL DEFAULT now(),

  -- Alçada resolvida no momento em que a solicitação entrou em aprovação.
  -- Congelada de propósito: mudar a régua no meio do caminho não pode
  -- invalidar nem revalidar o que já foi assinado.
  approval_rule_id      bigint,
  levels_required       smallint CHECK (levels_required IS NULL OR levels_required BETWEEN 1 AND 3),
  levels_done           smallint NOT NULL DEFAULT 0 CHECK (levels_done BETWEEN 0 AND 3),

  cancelled_by          text,
  cancelled_at          timestamptz,
  cancel_reason         text,

  source                text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'app_time', 'compra', 'documento',
                                            'recorrente', 'reembolso', 'fatura_cartao', 'importacao')),
  source_id             text,
  tags                  text[] NOT NULL DEFAULT '{}',
  human_locked_fields   text[] NOT NULL DEFAULT '{}',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_payment_origem_unica CHECK (
    (CASE WHEN purchase_request_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN document_id         IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN recurring_id        IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN reimbursement_id    IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN card_bill_id        IS NOT NULL THEN 1 ELSE 0 END) <= 1
  ),
  CONSTRAINT fin_payment_pago_nao_excede CHECK (paid_cents <= net_cents),
  CONSTRAINT fin_payment_cancelada_completa
    CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
  CONSTRAINT fin_payment_cancelada_tem_autor
    CHECK (status NOT IN ('cancelada', 'rejeitada') OR cancelled_by IS NOT NULL OR levels_done > 0),
  -- Cancelar o que já saiu do caixa é reescrever a história. Estorno é outro
  -- fato, com outra linha.
  CONSTRAINT fin_payment_cancelada_sem_caixa
    CHECK (status <> 'cancelada' OR paid_cents = 0),
  CONSTRAINT fin_payment_orcamento_coerente
    CHECK ((budget_line_slug IS NULL) = (budget_ano IS NULL)
           AND (budget_line_slug IS NULL) = (budget_periodo IS NULL)),
  CONSTRAINT fin_payment_budget_line_fk
    FOREIGN KEY (entity_id, budget_line_slug) REFERENCES fin_model_line(entity_id, slug) ON UPDATE CASCADE
);

CREATE INDEX fin_payment_request_fila_idx
  ON fin_payment_request (entity_id, status, due_date)
  WHERE status IN ('rascunho', 'em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao', 'pago_parcial');
CREATE INDEX fin_payment_request_vencimento_idx ON fin_payment_request (entity_id, due_date);
CREATE INDEX fin_payment_request_counterparty_idx ON fin_payment_request (counterparty_id, due_date DESC);
CREATE INDEX fin_payment_request_cost_center_idx ON fin_payment_request (cost_center_id);
CREATE INDEX fin_payment_request_desc_trgm_idx ON fin_payment_request USING gin (description_norm gin_trgm_ops);
CREATE INDEX fin_payment_request_tags_idx ON fin_payment_request USING gin (tags);
CREATE UNIQUE INDEX fin_payment_request_source_idx
  ON fin_payment_request (entity_id, source, source_id) WHERE source_id IS NOT NULL;
-- Uma cobrança/documento não pode entrar duas vezes na fila enquanto viva.
CREATE UNIQUE INDEX fin_payment_request_documento_vivo_idx
  ON fin_payment_request (document_id)
  WHERE document_id IS NOT NULL AND status NOT IN ('rejeitada', 'cancelada');

COMMENT ON TABLE fin_payment_request IS
  'Fila de pagamento. PREPARA, VALIDA, APROVA, LOTEIA e AUDITA — nunca paga. '
  'A autorização junto ao banco é humana e acontece fora do sistema.';
COMMENT ON COLUMN fin_payment_request.payee_fingerprint IS
  'Hash estável da coordenada bancária escolhida (chave PIX ou banco+agência+conta). '
  'Mudança de fingerprint entre pagamentos do mesmo beneficiário é o sinal de '
  'alteração de favorecido — o alerta mais caro de perder.';
COMMENT ON COLUMN fin_payment_request.paid_cents IS
  'Soma das execuções REGISTRADAS (fin_payment_execution). Mantido por gatilho. '
  'Registro do que um humano já fez no banco, nunca ordem de pagamento.';
COMMENT ON COLUMN fin_payment_request.status IS
  'aguardando_autorizacao é onde o produto termina: o lote saiu para conferência e '
  'a pessoa está no aplicativo do banco. Nenhuma transição a partir daí é automática.';

-- ---------------------------------------------------------------------------
-- 5. ALÇADA (segregação de funções)
-- ---------------------------------------------------------------------------
-- A régua: faixa de valor + dimensões opcionais → quantos níveis de aprovação e
-- quem pode assinar cada um.
--
-- `permite_autoaprovacao` existe porque em empresa pequena o dono é o único
-- aprovador, e um bloqueio cego travaria a operação inteira. Mas ele é FALSE
-- por padrão e precisa ser ligado regra a regra: a exceção fica declarada, com
-- nome e faixa, em vez de virar meio-termo silencioso.

CREATE TABLE fin_approval_rule (
  id                     bigserial PRIMARY KEY,
  entity_id              bigint NOT NULL REFERENCES fin_entity(id),
  slug                   text NOT NULL,
  name                   text NOT NULL,
  aplica_a               text NOT NULL DEFAULT 'pagamento'
                           CHECK (aplica_a IN ('compra', 'pagamento', 'ambos')),
  ordem                  integer NOT NULL DEFAULT 100,

  min_cents              bigint NOT NULL DEFAULT 0 CHECK (min_cents >= 0),
  max_cents              bigint CHECK (max_cents IS NULL OR max_cents > 0),

  category_id            bigint REFERENCES fin_category(id),
  nucleo                 text REFERENCES fin_nucleo(slug),
  cost_center_id         bigint REFERENCES fin_cost_center(id),
  counterparty_id        bigint REFERENCES fin_counterparty(id),

  niveis_exigidos        smallint NOT NULL DEFAULT 1 CHECK (niveis_exigidos BETWEEN 1 AND 3),
  aprovadores_nivel1     text[] NOT NULL DEFAULT '{}',
  aprovadores_nivel2     text[] NOT NULL DEFAULT '{}',
  aprovadores_nivel3     text[] NOT NULL DEFAULT '{}',

  permite_autoaprovacao  boolean NOT NULL DEFAULT false,
  exige_documento        boolean NOT NULL DEFAULT true,
  exige_conta_bancaria   boolean NOT NULL DEFAULT true,
  exige_centro_custo     boolean NOT NULL DEFAULT false,
  exige_cotacao_acima_cents bigint CHECK (exige_cotacao_acima_cents IS NULL OR exige_cotacao_acima_cents > 0),
  -- Teto por transação da exceção segura descrita no backlog D2: valor fixo,
  -- beneficiário fixo, recorrência declarada — ainda assim com teto e alerta
  -- quando o valor mudar em relação ao mês anterior.
  teto_por_transacao_cents bigint CHECK (teto_por_transacao_cents IS NULL OR teto_por_transacao_cents > 0),

  is_active              boolean NOT NULL DEFAULT true,
  notes                  text,
  created_by             text NOT NULL DEFAULT 'sistema',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, slug),
  CONSTRAINT fin_approval_rule_faixa CHECK (max_cents IS NULL OR max_cents > min_cents),
  CONSTRAINT fin_approval_rule_nivel2_povoado
    CHECK (niveis_exigidos < 2 OR cardinality(aprovadores_nivel2) > 0),
  CONSTRAINT fin_approval_rule_nivel3_povoado
    CHECK (niveis_exigidos < 3 OR cardinality(aprovadores_nivel3) > 0)
);

CREATE INDEX fin_approval_rule_busca_idx ON fin_approval_rule (entity_id, aplica_a, ordem) WHERE is_active;

COMMENT ON TABLE fin_approval_rule IS
  'Alçada. Nasce VAZIA de propósito: semear um teto seria inventar política de '
  'governança, que é decisão do dono. Sem regra declarada nada é aprovável, e '
  'fin_pagamento_pendencia_v diz isso em voz alta em vez de deixar a fila parada.';

ALTER TABLE fin_payment_request
  ADD CONSTRAINT fin_payment_request_approval_rule_fkey
  FOREIGN KEY (approval_rule_id) REFERENCES fin_approval_rule(id);
ALTER TABLE fin_purchase_request
  ADD COLUMN approval_rule_id bigint REFERENCES fin_approval_rule(id);

-- ---------------------------------------------------------------------------
-- 6. APROVAÇÕES — uma linha por assinatura, append-only na prática
-- ---------------------------------------------------------------------------

CREATE TABLE fin_payment_approval (
  id                    bigserial PRIMARY KEY,
  payment_request_id    bigint REFERENCES fin_payment_request(id) ON DELETE CASCADE,
  purchase_request_id   bigint REFERENCES fin_purchase_request(id) ON DELETE CASCADE,
  level                 smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  approval_rule_id      bigint REFERENCES fin_approval_rule(id),

  decision              text NOT NULL CHECK (decision IN ('aprovado', 'rejeitado', 'devolvido')),
  approver              text NOT NULL,
  approver_person_id    bigint REFERENCES fin_person(id),
  decided_at            timestamptz NOT NULL DEFAULT now(),
  reason                text,

  -- O que a pessoa VIU quando assinou. Se o valor ou o favorecido mudarem
  -- depois, a assinatura é invalidada por gatilho (seção 9) — assinar
  -- R$ 1.000 para o fornecedor A não autoriza R$ 40.000 para o fornecedor B.
  amount_at_decision_cents  bigint NOT NULL,
  payee_at_decision         text,
  alerts_at_decision        jsonb,

  superseded_at         timestamptz,
  superseded_reason     text,

  CONSTRAINT fin_payment_approval_alvo_unico CHECK (
    (payment_request_id IS NOT NULL) <> (purchase_request_id IS NOT NULL)
  )
);

-- Uma assinatura viva por nível. Reprovar e reaprovar cria linha nova; a
-- anterior fica com `superseded_at` preenchido, nunca é apagada.
CREATE UNIQUE INDEX fin_payment_approval_nivel_vivo_pag_idx
  ON fin_payment_approval (payment_request_id, level)
  WHERE payment_request_id IS NOT NULL AND superseded_at IS NULL;
CREATE UNIQUE INDEX fin_payment_approval_nivel_vivo_compra_idx
  ON fin_payment_approval (purchase_request_id, level)
  WHERE purchase_request_id IS NOT NULL AND superseded_at IS NULL;
CREATE INDEX fin_payment_approval_approver_idx ON fin_payment_approval (approver, decided_at DESC);

COMMENT ON COLUMN fin_payment_approval.amount_at_decision_cents IS
  'Valor no instante da assinatura. Mudar o valor depois invalida a aprovação '
  '(gatilho fin_pagamento_invalida_aprovacao) — assinar R$ 1.000 não autoriza R$ 40.000.';

-- ---------------------------------------------------------------------------
-- 7. LOTE
-- ---------------------------------------------------------------------------
-- Agrupa o que vai ser digitado no banco de uma vez, por dia e conta pagadora.
-- É documento de conferência, não canal de transmissão.

CREATE SEQUENCE IF NOT EXISTS fin_payment_batch_code_seq;

CREATE TABLE fin_payment_batch (
  id                    bigserial PRIMARY KEY,
  entity_id             bigint NOT NULL REFERENCES fin_entity(id),
  code                  text NOT NULL UNIQUE,
  label                 text,

  scheduled_for         date NOT NULL,
  from_account_id       bigint REFERENCES fin_account(id),

  status                text NOT NULL DEFAULT 'aberto'
                          CHECK (status IN ('aberto', 'fechado', 'exportado',
                                            'autorizado', 'liquidado', 'cancelado')),

  -- Mantidos por gatilho a partir dos itens.
  item_count            integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total_cents           bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  paid_cents            bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),

  -- "Exportado" = a lista saiu em arquivo/planilha para conferência humana.
  -- NÃO significa transmitido. Não existe, e não pode existir, coluna de
  -- protocolo de banco aqui.
  export_format         text CHECK (export_format IN ('planilha', 'pdf', 'texto', 'cnab240_rascunho')),
  exported_at           timestamptz,
  exported_by           text,
  export_checksum       text,

  -- A autorização. Três campos que só humano preenche, DEPOIS do fato.
  authorized_outside_system boolean NOT NULL DEFAULT false,
  authorized_by         text,
  authorized_at         timestamptz,
  authorization_note    text,

  closed_by             text,
  closed_at             timestamptz,
  cancelled_by          text,
  cancelled_at          timestamptz,
  cancel_reason         text,
  notes                 text,
  created_by            text NOT NULL DEFAULT 'sistema',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_batch_export_completo
    CHECK ((exported_at IS NULL) = (exported_by IS NULL)),
  CONSTRAINT fin_batch_autorizacao_completa
    CHECK (authorized_outside_system = false
           OR (authorized_by IS NOT NULL AND authorized_at IS NOT NULL)),
  CONSTRAINT fin_batch_status_autorizado
    CHECK (status NOT IN ('autorizado', 'liquidado') OR authorized_outside_system)
);

CREATE INDEX fin_payment_batch_agenda_idx ON fin_payment_batch (entity_id, scheduled_for DESC, status);

COMMENT ON TABLE fin_payment_batch IS
  'Lote de pagamento: DOCUMENTO DE CONFERÊNCIA para um humano digitar no banco. '
  'exported_at = a lista saiu em papel/planilha, nunca "foi transmitida". '
  'authorized_outside_system/by/at só um humano preenche, e sempre depois do fato.';

CREATE TABLE fin_payment_batch_item (
  id                    bigserial PRIMARY KEY,
  batch_id              bigint NOT NULL REFERENCES fin_payment_batch(id) ON DELETE CASCADE,
  payment_request_id    bigint NOT NULL REFERENCES fin_payment_request(id) ON DELETE CASCADE,
  -- Loteia-se um VALOR, não necessariamente a solicitação inteira: pagamento
  -- parcial negociado entra como item de valor menor, e o saldo segue na fila.
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  sort_order            integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'incluido'
                          CHECK (status IN ('incluido', 'removido', 'pago', 'devolvido')),
  removed_by            text,
  removed_at            timestamptz,
  removal_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (batch_id, payment_request_id)
);

CREATE INDEX fin_payment_batch_item_req_idx ON fin_payment_batch_item (payment_request_id);
-- Uma solicitação viva em um lote de cada vez.
CREATE UNIQUE INDEX fin_payment_batch_item_vivo_idx
  ON fin_payment_batch_item (payment_request_id)
  WHERE status IN ('incluido', 'pago');

-- ---------------------------------------------------------------------------
-- 8. EXECUÇÃO REGISTRADA e CONCILIAÇÃO POSTERIOR
-- ---------------------------------------------------------------------------
-- LEIA O NOME COM CUIDADO: esta tabela guarda o que JÁ ACONTECEU no banco.
-- Ela não dispara nada. `paid_on` não pode ser futuro exatamente para que o
-- schema recuse "registrar" um pagamento que ainda não foi feito.

CREATE TABLE fin_payment_execution (
  id                    bigserial PRIMARY KEY,
  payment_request_id    bigint NOT NULL REFERENCES fin_payment_request(id) ON DELETE CASCADE,
  batch_id              bigint REFERENCES fin_payment_batch(id),

  paid_on               date NOT NULL,
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  from_account_id       bigint REFERENCES fin_account(id),
  method                text CHECK (method IN ('pix', 'ted', 'boleto', 'debito_automatico', 'cartao', 'dinheiro')),
  end_to_end_id         text,
  bank_reference        text,

  -- Conciliação posterior: a linha do extrato que provou a saída.
  transaction_id        bigint REFERENCES fin_transaction(id),
  settlement_id         bigint REFERENCES fin_settlement(id),
  reconciled_at         timestamptz,
  reconciled_by         text,
  reconcile_confidence  smallint CHECK (reconcile_confidence BETWEEN 0 AND 100),

  receipt_attachment_id bigint,

  registered_by         text NOT NULL,
  registered_at         timestamptz NOT NULL DEFAULT now(),
  notes                 text,

  -- A trava "paid_on não pode ser futuro" mora num gatilho, e não num CHECK,
  -- porque CURRENT_DATE dentro de CHECK sobrevive ao INSERT e volta a ser
  -- avaliado num restore de dump — um backup restaurado meses depois falharia
  -- em linhas que eram válidas quando gravadas. Ver fin_pagamento_valida_execucao.
  CONSTRAINT fin_payment_execution_conciliacao_completa
    CHECK ((transaction_id IS NULL) = (reconciled_at IS NULL))
);

CREATE INDEX fin_payment_execution_req_idx ON fin_payment_execution (payment_request_id);
CREATE INDEX fin_payment_execution_data_idx ON fin_payment_execution (paid_on DESC);
CREATE UNIQUE INDEX fin_payment_execution_transacao_idx
  ON fin_payment_execution (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX fin_payment_execution_e2e_idx
  ON fin_payment_execution (end_to_end_id) WHERE end_to_end_id IS NOT NULL;

COMMENT ON TABLE fin_payment_execution IS
  'REGISTRO de pagamento já efetuado por um humano no aplicativo do banco. Não é ordem, '
  'não dispara nada, e paid_on não pode ser futuro. A coluna de autor chama-se '
  'registered_by, e não executed_by, para que ler o schema não sugira o contrário.';

-- ---------------------------------------------------------------------------
-- 9. ANEXOS E COMPROVANTES
-- ---------------------------------------------------------------------------

CREATE TABLE fin_payment_attachment (
  id                    bigserial PRIMARY KEY,
  entity_id             bigint NOT NULL REFERENCES fin_entity(id),
  target_table          text NOT NULL
                          CHECK (target_table IN ('fin_purchase_request', 'fin_payment_request',
                                                  'fin_payment_batch', 'fin_payment_execution')),
  target_id             bigint NOT NULL,

  kind                  text NOT NULL
                          CHECK (kind IN ('nota_fiscal', 'boleto', 'contrato', 'cotacao',
                                          'comprovante', 'recibo', 'ordem_servico', 'outro')),
  -- NFe já existente aponta, não copia: são 3.521 em fin_fiscal_document.
  fiscal_document_id    bigint REFERENCES fin_fiscal_document(id),

  storage_key           text,
  file_name             text,
  file_sha256           char(64),
  file_bytes            bigint CHECK (file_bytes IS NULL OR file_bytes >= 0),
  mime_type             text,
  external_url          text,

  uploaded_by           text NOT NULL,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  notes                 text,

  -- Anexo tem de apontar para ALGUMA coisa: arquivo, NFe existente ou URL.
  -- Linha vazia serviria para fingir que o documento existe.
  CONSTRAINT fin_attachment_tem_conteudo
    CHECK (storage_key IS NOT NULL OR fiscal_document_id IS NOT NULL OR external_url IS NOT NULL)
);

CREATE INDEX fin_payment_attachment_alvo_idx ON fin_payment_attachment (target_table, target_id);
CREATE UNIQUE INDEX fin_payment_attachment_sha_idx
  ON fin_payment_attachment (target_table, target_id, file_sha256) WHERE file_sha256 IS NOT NULL;

ALTER TABLE fin_payment_execution
  ADD CONSTRAINT fin_payment_execution_receipt_fkey
  FOREIGN KEY (receipt_attachment_id) REFERENCES fin_payment_attachment(id);

-- ---------------------------------------------------------------------------
-- 10. ALERTAS: a detecção é derivada, a DECISÃO sobre ela é guardada
-- ---------------------------------------------------------------------------
-- Não se persiste o alerta: alerta persistido envelhece e passa a acusar o que
-- já foi corrigido. O que se persiste é o que um humano DECIDIU sobre uma
-- detecção — "já verifiquei, é o aluguel mesmo" —, com nome e motivo.
--
-- A chave é (solicitação, tipo, impressão digital da evidência): se a evidência
-- mudar, o "já verifiquei" não vale mais e o alerta volta a aparecer.

CREATE TABLE fin_payment_alert_ack (
  id                    bigserial PRIMARY KEY,
  payment_request_id    bigint NOT NULL REFERENCES fin_payment_request(id) ON DELETE CASCADE,
  kind                  text NOT NULL
                          CHECK (kind IN ('duplicidade', 'favorecido_alterado', 'favorecido_documento_divergente',
                                          'valor_fora_do_padrao', 'vencimento_proximo', 'vencido',
                                          'documento_faltante', 'sem_conta_bancaria', 'orcamento_estourado',
                                          'sem_centro_custo', 'segregacao_violada', 'acima_do_teto')),
  evidence_fingerprint  text NOT NULL,
  resolution            text NOT NULL
                          CHECK (resolution IN ('corrigido', 'justificado', 'falso_positivo')),
  reason                text,
  acked_by              text NOT NULL,
  acked_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (payment_request_id, kind, evidence_fingerprint)
);

COMMENT ON TABLE fin_payment_alert_ack IS
  'A decisão humana sobre uma detecção, não a detecção. Alerta persistido envelhece e '
  'passa a acusar o que já foi corrigido; por isso a detecção mora nas views e só o '
  '"já verifiquei, e por isto" mora aqui — chaveado pela impressão digital da evidência, '
  'de modo que evidência nova reabre o alerta.';

-- ---------------------------------------------------------------------------
-- 11. GATILHOS
-- ---------------------------------------------------------------------------

CREATE TRIGGER fin_purchase_request_touch BEFORE UPDATE ON fin_purchase_request
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_payment_request_touch BEFORE UPDATE ON fin_payment_request
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_approval_rule_touch BEFORE UPDATE ON fin_approval_rule
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_payment_batch_touch BEFORE UPDATE ON fin_payment_batch
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Código legível. Gente conversa por "PG-2026-0142", não por id 87.
CREATE OR REPLACE FUNCTION fin_pagamento_codigo() RETURNS trigger AS $$
DECLARE
  v_prefixo text;
  v_seq     text;
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'fin_purchase_request' THEN
    v_prefixo := 'SC'; v_seq := 'fin_purchase_request_code_seq';
  ELSIF TG_TABLE_NAME = 'fin_payment_request' THEN
    v_prefixo := 'PG'; v_seq := 'fin_payment_request_code_seq';
  ELSE
    v_prefixo := 'LT'; v_seq := 'fin_payment_batch_code_seq';
  END IF;
  NEW.code := v_prefixo || '-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY')
              || '-' || lpad(nextval(v_seq)::text, 4, '0');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_purchase_request_codigo BEFORE INSERT ON fin_purchase_request
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_codigo();
CREATE TRIGGER fin_payment_request_codigo BEFORE INSERT ON fin_payment_request
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_codigo();
CREATE TRIGGER fin_payment_batch_codigo BEFORE INSERT ON fin_payment_batch
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_codigo();

-- description_norm acompanha description sem depender de quem escreve.
-- Normalização mínima (lower + colapso de espaço), que é o que o resto do
-- módulo já assume nas colunas *_norm.
CREATE OR REPLACE FUNCTION fin_payment_request_norm() RETURNS trigger AS $$
BEGIN
  NEW.description_norm := btrim(regexp_replace(lower(coalesce(NEW.description, '')), '\s+', ' ', 'g'));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_request_norm_trg BEFORE INSERT OR UPDATE OF description
  ON fin_payment_request FOR EACH ROW EXECUTE FUNCTION fin_payment_request_norm();

-- Registro de pagamento no futuro é agenda de execução disfarçada. A tabela
-- descreve o passado, e o gatilho é onde isso vira regra viva.
CREATE OR REPLACE FUNCTION fin_pagamento_valida_execucao() RETURNS trigger AS $$
BEGIN
  IF NEW.paid_on > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'fin_payment_execution registra pagamento JÁ FEITO: paid_on % é futuro', NEW.paid_on;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_execution_valida BEFORE INSERT OR UPDATE OF paid_on
  ON fin_payment_execution FOR EACH ROW EXECUTE FUNCTION fin_pagamento_valida_execucao();

-- Documento apontado tem de ser conta A PAGAR. Apontar para um 'receber' faria
-- a fila de saída consumir um recebível — e o caixa previsto inverteria o sinal.
CREATE OR REPLACE FUNCTION fin_payment_valida_documento() RETURNS trigger AS $$
DECLARE v_dir text;
BEGIN
  IF NEW.document_id IS NULL THEN RETURN NEW; END IF;
  SELECT direction INTO v_dir FROM fin_document WHERE id = NEW.document_id;
  IF v_dir <> 'pagar' THEN
    RAISE EXCEPTION 'fin_payment_request.document_id % é direction=% — a fila de pagamento só aceita documentos a pagar', NEW.document_id, v_dir;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_request_documento BEFORE INSERT OR UPDATE OF document_id
  ON fin_payment_request FOR EACH ROW EXECUTE FUNCTION fin_payment_valida_documento();

-- Segregação de funções, no ponto onde ela vale dinheiro.
--
-- Sem regra de alçada não há aprovação: preferir travar a fila a deixar passar
-- sem régua. Quem aprova não pode ser quem pediu, salvo se a regra DECLARAR a
-- exceção. E o aprovador tem de estar na lista do nível.
CREATE OR REPLACE FUNCTION fin_pagamento_valida_aprovacao() RETURNS trigger AS $$
DECLARE
  v_solicitante text;
  v_regra       fin_approval_rule%ROWTYPE;
  v_permitidos  text[];
BEGIN
  IF NEW.payment_request_id IS NOT NULL THEN
    SELECT requested_by, approval_rule_id INTO v_solicitante, NEW.approval_rule_id
      FROM fin_payment_request WHERE id = NEW.payment_request_id;
  ELSE
    SELECT requested_by, approval_rule_id INTO v_solicitante, NEW.approval_rule_id
      FROM fin_purchase_request WHERE id = NEW.purchase_request_id;
  END IF;

  IF NEW.approval_rule_id IS NULL THEN
    RAISE EXCEPTION 'sem alçada declarada: resolva fin_approval_rule antes de aprovar (fin_pagamento_pendencia_v explica)';
  END IF;

  SELECT * INTO v_regra FROM fin_approval_rule WHERE id = NEW.approval_rule_id;

  IF NEW.decision = 'aprovado'
     AND lower(btrim(NEW.approver)) = lower(btrim(coalesce(v_solicitante, '')))
     AND NOT v_regra.permite_autoaprovacao THEN
    RAISE EXCEPTION 'segregação de funções: % pediu e não pode aprovar (regra % não permite autoaprovação)',
      NEW.approver, v_regra.slug;
  END IF;

  v_permitidos := CASE NEW.level
                    WHEN 1 THEN v_regra.aprovadores_nivel1
                    WHEN 2 THEN v_regra.aprovadores_nivel2
                    ELSE v_regra.aprovadores_nivel3 END;
  IF cardinality(v_permitidos) = 0 THEN
    RAISE EXCEPTION 'regra % não declara aprovadores para o nível %', v_regra.slug, NEW.level;
  END IF;
  IF NOT (lower(btrim(NEW.approver)) = ANY (SELECT lower(btrim(x)) FROM unnest(v_permitidos) x)) THEN
    RAISE EXCEPTION '% não está na lista de aprovadores de nível % da regra %', NEW.approver, NEW.level, v_regra.slug;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_approval_valida BEFORE INSERT ON fin_payment_approval
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_valida_aprovacao();

-- Mudou o valor ou o favorecido depois de assinado? A assinatura cai.
--
-- Este é o gatilho que impede o golpe mais barato do mundo: aprovar R$ 1.000
-- para o fornecedor certo e editar para R$ 40.000 na conta de outro antes do
-- lote sair.
--
-- POR QUE SÃO DOIS GATILHOS, E NÃO UM
--
-- A primeira versão fazia tudo num BEFORE UPDATE: rebaixava o status e, na
-- mesma passada, marcava as assinaturas como superadas. O UPDATE nas
-- assinaturas disparava fin_pagamento_conta_niveis, que por sua vez tentava
-- escrever na MESMA linha de fin_payment_request que ainda estava sendo
-- modificada — e o Postgres aborta com "tuple to be updated was already
-- modified by an operation triggered by the current command".
--
-- A separação resolve pela ordem natural: o BEFORE mexe só na própria linha
-- (que é o que BEFORE existe para fazer), e o AFTER, com a linha já gravada,
-- mexe nas filhas. A recontagem que volta é inofensiva porque os dois gatilhos
-- são declarados com UPDATE OF nas colunas de valor e favorecido — mudar
-- levels_done não os acorda de novo.
CREATE OR REPLACE FUNCTION fin_pagamento_invalida_aprovacao() RETURNS trigger AS $$
BEGIN
  IF NEW.net_cents IS DISTINCT FROM OLD.net_cents
     OR NEW.payee_fingerprint IS DISTINCT FROM OLD.payee_fingerprint
     OR NEW.counterparty_id IS DISTINCT FROM OLD.counterparty_id THEN
    IF OLD.levels_done > 0 THEN
      NEW.levels_done := 0;
      IF NEW.status IN ('aprovada', 'em_lote', 'aguardando_autorizacao') THEN
        NEW.status := 'em_aprovacao';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_request_invalida
  BEFORE UPDATE OF amount_cents, discount_cents, interest_cents, fine_cents,
                   payee_fingerprint, counterparty_id
  ON fin_payment_request FOR EACH ROW EXECUTE FUNCTION fin_pagamento_invalida_aprovacao();

CREATE OR REPLACE FUNCTION fin_pagamento_supera_assinaturas() RETURNS trigger AS $$
BEGIN
  IF NEW.net_cents IS DISTINCT FROM OLD.net_cents
     OR NEW.payee_fingerprint IS DISTINCT FROM OLD.payee_fingerprint
     OR NEW.counterparty_id IS DISTINCT FROM OLD.counterparty_id THEN
    UPDATE fin_payment_approval
       SET superseded_at = now(),
           superseded_reason = 'valor ou favorecido alterado após a assinatura'
     WHERE payment_request_id = NEW.id AND superseded_at IS NULL;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_request_supera
  AFTER UPDATE OF amount_cents, discount_cents, interest_cents, fine_cents,
                  payee_fingerprint, counterparty_id
  ON fin_payment_request FOR EACH ROW EXECUTE FUNCTION fin_pagamento_supera_assinaturas();

-- levels_done acompanha as assinaturas vivas.
CREATE OR REPLACE FUNCTION fin_pagamento_conta_niveis() RETURNS trigger AS $$
DECLARE v_id bigint;
BEGIN
  v_id := COALESCE(NEW.payment_request_id, OLD.payment_request_id);
  IF v_id IS NOT NULL THEN
    UPDATE fin_payment_request p
       SET levels_done = (
             SELECT count(*) FROM fin_payment_approval a
              WHERE a.payment_request_id = v_id AND a.superseded_at IS NULL AND a.decision = 'aprovado')
     WHERE p.id = v_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_approval_conta AFTER INSERT OR UPDATE OR DELETE ON fin_payment_approval
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_conta_niveis();

-- paid_cents e o status de pagamento saem das execuções registradas.
CREATE OR REPLACE FUNCTION fin_pagamento_refresh_pago() RETURNS trigger AS $$
DECLARE
  v_id    bigint;
  v_pago  bigint;
  v_net   bigint;
BEGIN
  v_id := COALESCE(NEW.payment_request_id, OLD.payment_request_id);
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_pago
    FROM fin_payment_execution WHERE payment_request_id = v_id;
  SELECT net_cents INTO v_net FROM fin_payment_request WHERE id = v_id;

  UPDATE fin_payment_request
     SET paid_cents = v_pago,
         -- Apagar a última execução tem de DESFAZER o "pago". Sem este ramo, um
         -- registro lançado por engano e removido deixaria a solicitação
         -- eternamente quitada com paid_cents = 0.
         status = CASE
                    WHEN v_pago = 0 AND status IN ('pago', 'pago_parcial') THEN 'aprovada'
                    WHEN v_pago = 0 THEN status
                    WHEN v_pago >= v_net THEN 'pago'
                    ELSE 'pago_parcial'
                  END
   WHERE id = v_id;

  -- O lote também tem de saber o que já saiu.
  UPDATE fin_payment_batch b
     SET paid_cents = COALESCE((SELECT SUM(e.amount_cents) FROM fin_payment_execution e
                                 WHERE e.batch_id = b.id), 0)
   WHERE b.id = COALESCE(NEW.batch_id, OLD.batch_id);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_execution_refresh AFTER INSERT OR UPDATE OR DELETE ON fin_payment_execution
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_refresh_pago();

-- Totais do lote saem dos itens.
CREATE OR REPLACE FUNCTION fin_pagamento_refresh_lote() RETURNS trigger AS $$
DECLARE v_id bigint;
BEGIN
  v_id := COALESCE(NEW.batch_id, OLD.batch_id);
  UPDATE fin_payment_batch b
     SET item_count  = COALESCE(i.n, 0),
         total_cents = COALESCE(i.total, 0)
    FROM (SELECT count(*) AS n, COALESCE(SUM(amount_cents), 0) AS total
            FROM fin_payment_batch_item
           WHERE batch_id = v_id AND status IN ('incluido', 'pago')) i
   WHERE b.id = v_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_payment_batch_item_refresh AFTER INSERT OR UPDATE OR DELETE ON fin_payment_batch_item
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_refresh_lote();

-- Histórico de alterações: reaproveita fin_audit_log em vez de abrir uma
-- segunda trilha que ninguém lembraria de consultar.
CREATE OR REPLACE FUNCTION fin_pagamento_auditoria() RETURNS trigger AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_campos text[];
  v_entity bigint;
  v_ator   text;
BEGIN
  v_before := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_after  := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key ORDER BY key) INTO v_campos
      FROM jsonb_each(v_after) n
     WHERE n.value IS DISTINCT FROM (v_before -> n.key);
    -- Só updated_at mudou: ruído, não história.
    IF v_campos IS NULL OR v_campos = ARRAY['updated_at'] THEN RETURN NULL; END IF;
  END IF;

  v_entity := NULLIF(COALESCE(v_after, v_before) ->> 'entity_id', '')::bigint;
  v_ator := COALESCE(
    NULLIF(current_setting('fin.actor', true), ''),
    v_after ->> 'approver', v_after ->> 'registered_by', v_after ->> 'uploaded_by',
    v_after ->> 'requested_by', v_after ->> 'created_by',
    'desconhecido');

  INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
  VALUES (v_entity, TG_TABLE_NAME,
          COALESCE((v_after ->> 'id')::bigint, (v_before ->> 'id')::bigint),
          lower(TG_OP), v_before, v_after, v_campos, v_ator);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fin_purchase_request_audit AFTER INSERT OR UPDATE OR DELETE ON fin_purchase_request
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_payment_request_audit AFTER INSERT OR UPDATE OR DELETE ON fin_payment_request
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_payment_approval_audit AFTER INSERT OR UPDATE OR DELETE ON fin_payment_approval
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_payment_batch_audit AFTER INSERT OR UPDATE OR DELETE ON fin_payment_batch
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_payment_batch_item_audit AFTER INSERT OR UPDATE OR DELETE ON fin_payment_batch_item
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_payment_execution_audit AFTER INSERT OR UPDATE OR DELETE ON fin_payment_execution
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_approval_rule_audit AFTER INSERT OR UPDATE OR DELETE ON fin_approval_rule
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();
CREATE TRIGGER fin_payment_attachment_audit AFTER INSERT OR UPDATE OR DELETE ON fin_payment_attachment
  FOR EACH ROW EXECUTE FUNCTION fin_pagamento_auditoria();

-- ---------------------------------------------------------------------------
-- 12. ALÇADA APLICÁVEL
-- ---------------------------------------------------------------------------
-- Qual regra rege cada solicitação viva. Primeira regra ativa, na ordem
-- declarada, cuja faixa e dimensões casam. Sem regra ⇒ NULL, e o motivo fica
-- explícito na fila em vez de virar "aprovado por omissão".

CREATE VIEW fin_alcada_aplicavel_v AS
SELECT p.id            AS payment_request_id,
       p.entity_id,
       p.net_cents,
       r.id            AS approval_rule_id,
       r.slug          AS regra,
       r.niveis_exigidos,
       r.exige_documento,
       r.exige_conta_bancaria,
       r.exige_centro_custo,
       r.permite_autoaprovacao,
       r.teto_por_transacao_cents,
       r.aprovadores_nivel1,
       r.aprovadores_nivel2,
       r.aprovadores_nivel3,
       CASE WHEN r.id IS NULL THEN 'nenhuma regra de alçada casa com esta solicitação' END AS indeterminado_motivo
  FROM fin_payment_request p
  LEFT JOIN LATERAL (
    SELECT ar.*
      FROM fin_approval_rule ar
     WHERE ar.is_active
       AND ar.entity_id = p.entity_id
       AND ar.aplica_a IN ('pagamento', 'ambos')
       AND p.net_cents >= ar.min_cents
       AND (ar.max_cents IS NULL OR p.net_cents <= ar.max_cents)
       AND (ar.category_id IS NULL OR ar.category_id = p.category_id)
       AND (ar.nucleo IS NULL OR ar.nucleo = p.nucleo)
       AND (ar.cost_center_id IS NULL OR ar.cost_center_id = p.cost_center_id)
       AND (ar.counterparty_id IS NULL OR ar.counterparty_id = p.counterparty_id)
     ORDER BY ar.ordem, ar.id
     LIMIT 1
  ) r ON true;

COMMENT ON VIEW fin_alcada_aplicavel_v IS
  'Que régua rege cada solicitação. NULL não significa "livre": significa que ninguém '
  'declarou a régua, e nesse estado o gatilho recusa qualquer aprovação.';

-- ---------------------------------------------------------------------------
-- 13. ORÇAMENTO DISPONÍVEL
-- ---------------------------------------------------------------------------
-- meta − realizado − comprometido. "Comprometido" é o que já está na fila e
-- ainda não virou caixa; contá-lo junto com o realizado dobraria a mesma
-- despesa duas vezes, e ignorá-lo faria a tela liberar dinheiro já prometido.

CREATE VIEW fin_orcamento_disponivel_v AS
WITH comprometido AS (
  SELECT p.entity_id,
         p.budget_line_slug AS line_slug,
         p.budget_ano       AS ano,
         p.budget_periodo   AS periodo,
         SUM(p.net_cents - p.paid_cents) AS cents,
         count(*)                        AS solicitacoes
    FROM fin_payment_request p
   WHERE p.budget_line_slug IS NOT NULL
     AND p.status IN ('em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao', 'pago_parcial')
   GROUP BY 1, 2, 3, 4
),
pedido AS (
  SELECT c.entity_id,
         c.budget_line_slug AS line_slug,
         c.budget_ano       AS ano,
         c.budget_periodo   AS periodo,
         SUM(c.amount_cents) AS cents,
         count(*)            AS pedidos
    FROM fin_purchase_request c
   WHERE c.budget_line_slug IS NOT NULL
     AND c.status IN ('enviada', 'em_cotacao', 'aprovada')
   GROUP BY 1, 2, 3, 4
)
SELECT o.entity_id,
       o.line_slug,
       o.linha,
       o.section,
       o.escopo,
       o.periodicidade,
       o.ano,
       o.periodo,
       o.mes_de,
       o.mes_ate,
       o.meta_cents,
       o.realizado_cents,
       o.realizado_indeterminado_motivo,
       COALESCE(cm.cents, 0)     AS comprometido_cents,
       COALESCE(cm.solicitacoes, 0)::bigint AS solicitacoes_na_fila,
       COALESCE(pd.cents, 0)     AS pedido_cents,
       COALESCE(pd.pedidos, 0)::bigint      AS pedidos_de_compra,
       -- Despesa é negativa no ledger; a meta é positiva. abs() alinha os dois
       -- sem esconder o sinal de quem consultar realizado_cents direto.
       CASE WHEN o.realizado_indeterminado_motivo IS NOT NULL THEN NULL
            ELSE o.meta_cents - abs(COALESCE(o.realizado_cents, 0)) - COALESCE(cm.cents, 0)
       END AS disponivel_cents,
       CASE WHEN o.realizado_indeterminado_motivo IS NOT NULL THEN NULL
            ELSE o.meta_cents - abs(COALESCE(o.realizado_cents, 0)) - COALESCE(cm.cents, 0) - COALESCE(pd.cents, 0)
       END AS disponivel_com_pedidos_cents
  FROM fin_orcado_realizado_v o
  LEFT JOIN comprometido cm
         ON cm.entity_id = o.entity_id AND cm.line_slug = o.line_slug
        AND cm.ano = o.ano AND cm.periodo = o.periodo
  LEFT JOIN pedido pd
         ON pd.entity_id = o.entity_id AND pd.line_slug = o.line_slug
        AND pd.ano = o.ano AND pd.periodo = o.periodo;

COMMENT ON VIEW fin_orcamento_disponivel_v IS
  'meta − realizado − comprometido (o que já está na fila e ainda não virou caixa). '
  'Escopo obras devolve NULL: o realizado daquele escopo mora no ledger do erp-obras.';

-- ---------------------------------------------------------------------------
-- 14. PADRÃO HISTÓRICO DE VALOR
-- ---------------------------------------------------------------------------
-- A base do alerta "valor fora do padrão". Sai do extrato real (fin_transaction),
-- 24 meses, só saídas que não são transferência entre contas próprias.

CREATE VIEW fin_pagamento_valor_padrao_v AS
SELECT t.counterparty_id,
       t.category_id,
       count(*)                                                          AS ocorrencias,
       min(t.posted_on)                                                  AS primeira,
       max(t.posted_on)                                                  AS ultima,
       abs(min(t.amount_cents))                                          AS maior_cents,
       abs(max(t.amount_cents))                                          AS menor_cents,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(t.amount_cents))  AS mediana_cents,
       percentile_cont(0.1) WITHIN GROUP (ORDER BY abs(t.amount_cents))  AS p10_cents,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY abs(t.amount_cents))  AS p90_cents
  FROM fin_transaction t
 WHERE t.amount_cents < 0
   AND t.transfer_status = 'nao'
   AND NOT t.is_split_parent
   AND t.counterparty_id IS NOT NULL
   AND t.posted_on >= (CURRENT_DATE - INTERVAL '24 months')::date
 GROUP BY 1, 2;

COMMENT ON VIEW fin_pagamento_valor_padrao_v IS
  'Padrão histórico de saída por contraparte e categoria, 24 meses de extrato. '
  'Com menos de 3 ocorrências a estatística não sustenta alerta — quem consome '
  'deve declarar isso como "sem base", não emitir alarme frouxo.';

-- ---------------------------------------------------------------------------
-- 15. DUPLICIDADE
-- ---------------------------------------------------------------------------
-- Mesmo beneficiário, mesmo valor, janela próxima. Contra a própria fila E
-- contra o extrato já realizado — pagar duas vezes costuma ser "já paguei e
-- esqueci", não "digitei duas vezes".
--
-- Recorrência mensal declarada é o falso positivo óbvio: aluguel repete de
-- propósito. A view não esconde o caso; ela CARIMBA `tem_recorrente_declarada`
-- para a tela rebaixar o alarme com evidência à vista.

CREATE VIEW fin_pagamento_duplicidade_v AS
SELECT p.id                      AS payment_request_id,
       p.entity_id,
       'fila'::text              AS contra,
       o.id                      AS outro_id,
       o.code                    AS outro_ref,
       o.due_date                AS outra_data,
       o.net_cents               AS outro_cents,
       abs(p.due_date - o.due_date) AS dias_entre,
       EXISTS (SELECT 1 FROM fin_recurring r
                WHERE r.counterparty_id = p.counterparty_id
                  AND r.status IN ('ativo', 'proposto')) AS tem_recorrente_declarada
  FROM fin_payment_request p
  JOIN fin_payment_request o
    ON o.id <> p.id
   AND o.counterparty_id = p.counterparty_id
   AND o.net_cents = p.net_cents
   AND o.status NOT IN ('rejeitada', 'cancelada')
   AND abs(o.due_date - p.due_date) <= 35
 WHERE p.status IN ('rascunho', 'em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao')
UNION ALL
SELECT p.id,
       p.entity_id,
       'extrato'::text,
       t.id,
       t.description_raw,
       t.posted_on,
       abs(t.amount_cents),
       abs(p.due_date - t.posted_on),
       EXISTS (SELECT 1 FROM fin_recurring r
                WHERE r.counterparty_id = p.counterparty_id
                  AND r.status IN ('ativo', 'proposto'))
  FROM fin_payment_request p
  JOIN fin_transaction t
    ON t.counterparty_id = p.counterparty_id
   AND abs(t.amount_cents) = p.net_cents
   AND t.amount_cents < 0
   AND t.transfer_status = 'nao'
   AND NOT t.is_split_parent
   AND abs(t.posted_on - p.due_date) <= 35
 WHERE p.status IN ('rascunho', 'em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao')
   -- A saída que a PRÓPRIA solicitação já produziu não é duplicata dela mesma.
   AND NOT EXISTS (SELECT 1 FROM fin_payment_execution ex
                    WHERE ex.payment_request_id = p.id AND ex.transaction_id = t.id);

COMMENT ON VIEW fin_pagamento_duplicidade_v IS
  'Mesmo beneficiário + mesmo valor em janela de 35 dias, contra a fila e contra o '
  'extrato. tem_recorrente_declarada existe para a tela rebaixar o alarme do que '
  'repete por natureza (aluguel), sem esconder o caso.';

-- ---------------------------------------------------------------------------
-- 16. ALTERAÇÃO DE FAVORECIDO
-- ---------------------------------------------------------------------------

CREATE VIEW fin_pagamento_favorecido_v AS
SELECT p.id                 AS payment_request_id,
       p.entity_id,
       p.counterparty_id,
       cp.name              AS beneficiario,
       cp.document_number   AS documento_beneficiario,
       p.payee_account_id,
       p.payee_fingerprint,
       ant.payee_fingerprint AS fingerprint_anterior,
       ant.code              AS ultimo_pagamento_ref,
       ant.due_date          AS ultimo_pagamento_data,
       (p.payee_fingerprint IS NOT NULL
        AND ant.payee_fingerprint IS NOT NULL
        AND p.payee_fingerprint <> ant.payee_fingerprint) AS favorecido_alterado,
       -- Titular da conta com documento diferente do beneficiário: pagar ao
       -- fornecedor A na conta de B. Só acusa quando os DOIS documentos existem.
       (pa.owner_document IS NOT NULL
        AND cp.document_number IS NOT NULL
        AND regexp_replace(pa.owner_document, '\D', '', 'g')
            <> regexp_replace(cp.document_number, '\D', '', 'g')) AS documento_divergente,
       pa.owner_document,
       pa.owner_name
  FROM fin_payment_request p
  JOIN fin_counterparty cp ON cp.id = p.counterparty_id
  LEFT JOIN fin_payee_account pa ON pa.id = p.payee_account_id
  LEFT JOIN LATERAL (
    SELECT a.code, a.due_date, a.payee_fingerprint
      FROM fin_payment_request a
     WHERE a.counterparty_id = p.counterparty_id
       AND a.id <> p.id
       AND a.payee_fingerprint IS NOT NULL
       AND a.status IN ('pago', 'pago_parcial', 'aprovada', 'em_lote', 'aguardando_autorizacao')
     ORDER BY a.requested_at DESC
     LIMIT 1
  ) ant ON true;

-- ---------------------------------------------------------------------------
-- 17. PENDÊNCIAS: o que falta para esta solicitação poder ser aprovada
-- ---------------------------------------------------------------------------
-- Uma linha por pendência, com o motivo em português. É o conteúdo da tela de
-- decisão: a evidência ao lado da escolha, não um "inválido" seco.

CREATE VIEW fin_pagamento_pendencia_v AS
WITH base AS (
  SELECT p.id, p.entity_id, p.code, p.status, p.net_cents, p.due_date,
         p.category_id, p.cost_center_id, p.payee_account_id, p.counterparty_id,
         al.approval_rule_id, al.regra, al.niveis_exigidos,
         al.exige_documento, al.exige_conta_bancaria, al.exige_centro_custo,
         al.teto_por_transacao_cents
    FROM fin_payment_request p
    JOIN fin_alcada_aplicavel_v al ON al.payment_request_id = p.id
   WHERE p.status IN ('rascunho', 'em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao', 'pago_parcial')
)
SELECT id AS payment_request_id, entity_id, code, 'alcada_indeterminada'::text AS pendencia, 'bloqueante'::text AS severidade,
       'nenhuma regra de alçada casa com esta solicitação — declare a régua em fin_approval_rule'::text AS motivo
  FROM base WHERE approval_rule_id IS NULL
UNION ALL
SELECT id, entity_id, code, 'sem_conta_bancaria', 'bloqueante',
       'beneficiário sem coordenada bancária escolhida (fin_payee_account)'
  FROM base WHERE payee_account_id IS NULL AND COALESCE(exige_conta_bancaria, true)
UNION ALL
SELECT id, entity_id, code, 'documento_faltante', 'bloqueante',
       'nenhum anexo fiscal (nota, boleto, contrato ou recibo) para sustentar a saída'
  FROM base b
 WHERE COALESCE(b.exige_documento, true)
   AND NOT EXISTS (SELECT 1 FROM fin_payment_attachment at
                    WHERE at.target_table = 'fin_payment_request' AND at.target_id = b.id
                      AND at.kind IN ('nota_fiscal', 'boleto', 'contrato', 'recibo'))
UNION ALL
SELECT id, entity_id, code, 'sem_categoria', 'bloqueante',
       'sem categoria: a saída não teria lugar na DRE nem no orçamento'
  FROM base WHERE category_id IS NULL
UNION ALL
SELECT id, entity_id, code, 'sem_centro_custo', 'alerta',
       'sem centro de custo: o custo não chega a projeto nenhum'
  FROM base WHERE cost_center_id IS NULL AND COALESCE(exige_centro_custo, false)
UNION ALL
SELECT id, entity_id, code, 'acima_do_teto', 'bloqueante',
       'valor acima do teto por transação declarado na regra ' || COALESCE(regra, '?')
  FROM base WHERE teto_por_transacao_cents IS NOT NULL AND net_cents > teto_por_transacao_cents
UNION ALL
SELECT id, entity_id, code, 'vencido', 'alerta',
       'vencimento já passou'
  FROM base WHERE due_date < CURRENT_DATE AND status <> 'pago'
UNION ALL
SELECT id, entity_id, code, 'vencimento_proximo', 'informativo',
       'vence em até 3 dias'
  FROM base WHERE due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + 3;

COMMENT ON VIEW fin_pagamento_pendencia_v IS
  'Uma linha por pendência, com motivo em português. É o conteúdo da tela de decisão: '
  'a evidência ao lado da escolha, não um "inválido" seco.';

-- ---------------------------------------------------------------------------
-- 18. A FILA, PRONTA PARA A TELA
-- ---------------------------------------------------------------------------

CREATE VIEW fin_pagamento_fila_v AS
SELECT p.id,
       p.entity_id,
       p.code,
       p.status,
       p.priority,
       p.description,
       p.due_date,
       p.scheduled_for,
       (p.due_date - CURRENT_DATE)          AS dias_ate_vencer,
       p.competence_date,
       p.amount_cents,
       p.net_cents,
       p.paid_cents,
       (p.net_cents - p.paid_cents)         AS saldo_cents,
       p.method,
       p.counterparty_id,
       cp.name                              AS beneficiario,
       cp.document_number                   AS documento_beneficiario,
       p.payee_account_id,
       pa.label                             AS conta_beneficiario,
       p.category_id,
       cat.code                             AS categoria_code,
       cat.name                             AS categoria,
       p.nucleo,
       p.cost_center_id,
       cc.name                              AS centro_custo,
       p.from_account_id,
       ac.name                              AS conta_pagadora,
       p.budget_line_slug,
       al.approval_rule_id,
       al.regra                             AS alcada,
       COALESCE(al.niveis_exigidos, 0)      AS niveis_exigidos,
       p.levels_done                        AS niveis_assinados,
       (al.approval_rule_id IS NOT NULL AND p.levels_done >= al.niveis_exigidos) AS alcada_completa,
       bi.batch_id,
       b.code                               AS lote,
       p.requested_by,
       p.requested_at,
       COALESCE(pend.bloqueantes, 0)        AS pendencias_bloqueantes,
       COALESCE(pend.alertas, 0)            AS pendencias_alerta,
       COALESCE(dup.n, 0)                   AS duplicidades,
       fav.favorecido_alterado,
       fav.documento_divergente,
       vp.mediana_cents                     AS mediana_historica_cents,
       vp.ocorrencias                       AS ocorrencias_historicas,
       CASE WHEN vp.ocorrencias IS NULL OR vp.ocorrencias < 3 THEN NULL
            WHEN p.net_cents > vp.p90_cents * 1.5 THEN 'acima'
            WHEN p.net_cents < vp.p10_cents * 0.5 THEN 'abaixo'
            ELSE 'normal' END               AS valor_versus_historico
  FROM fin_payment_request p
  JOIN fin_counterparty cp ON cp.id = p.counterparty_id
  LEFT JOIN fin_payee_account pa ON pa.id = p.payee_account_id
  LEFT JOIN fin_category cat ON cat.id = p.category_id
  LEFT JOIN fin_cost_center cc ON cc.id = p.cost_center_id
  LEFT JOIN fin_account ac ON ac.id = p.from_account_id
  LEFT JOIN fin_alcada_aplicavel_v al ON al.payment_request_id = p.id
  LEFT JOIN fin_payment_batch_item bi ON bi.payment_request_id = p.id AND bi.status IN ('incluido', 'pago')
  LEFT JOIN fin_payment_batch b ON b.id = bi.batch_id
  LEFT JOIN fin_pagamento_favorecido_v fav ON fav.payment_request_id = p.id
  LEFT JOIN fin_pagamento_valor_padrao_v vp
         ON vp.counterparty_id = p.counterparty_id AND vp.category_id IS NOT DISTINCT FROM p.category_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE severidade = 'bloqueante') AS bloqueantes,
           count(*) FILTER (WHERE severidade = 'alerta')     AS alertas
      FROM fin_pagamento_pendencia_v pv WHERE pv.payment_request_id = p.id
  ) pend ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM fin_pagamento_duplicidade_v dv WHERE dv.payment_request_id = p.id
  ) dup ON true;

COMMENT ON VIEW fin_pagamento_fila_v IS
  'A fila com tudo que a tela precisa mostrar ao lado da decisão: alçada, quantas '
  'assinaturas faltam, pendências bloqueantes, duplicidades, se o favorecido mudou e '
  'como o valor se compara ao histórico. Nenhuma coluna aqui autoriza pagamento.';

-- ---------------------------------------------------------------------------
-- 19. COMPROMISSO DE SAÍDA — camada declarada, NÃO somada
-- ---------------------------------------------------------------------------
-- A fila é uma afirmação sobre o futuro, como a recorrente da 0057. Ela NÃO
-- entra no saldo previsto por padrão: `fin_previsao_evento_v` já projeta a
-- mesma despesa por outros caminhos (recorrente, fatura de cartão, documento),
-- e somar as duas dobraria a saída. Quem quiser somar tem de escolher a camada
-- explicitamente — e por isso `entra_no_saldo` vem false e o motivo está aqui.

CREATE VIEW fin_pagamento_compromisso_v AS
SELECT p.entity_id,
       'fila_pagamento'::text AS camada,
       false                  AS entra_no_saldo,
       CASE
         WHEN p.recurring_id IS NOT NULL     THEN 'já projetado como recorrente'
         WHEN p.card_bill_id IS NOT NULL     THEN 'já projetado como fatura de cartão'
         WHEN p.document_id IS NOT NULL      THEN 'já projetado como conta a pagar'
         WHEN p.reimbursement_id IS NOT NULL THEN 'já projetado como reembolso'
         ELSE 'saída nova: pode ser somada se a tela declarar a camada'
       END                    AS motivo_nao_somado,
       COALESCE(p.scheduled_for, p.due_date) AS dia,
       (COALESCE(p.scheduled_for, p.due_date) - CURRENT_DATE) AS dias_a_frente,
       'saida'::text          AS sentido,
       (p.net_cents - p.paid_cents) AS valor_cents,
       p.status,
       p.counterparty_id,
       p.category_id,
       p.cost_center_id,
       p.from_account_id,
       p.code                 AS origem_ref
  FROM fin_payment_request p
 WHERE p.status IN ('aprovada', 'em_lote', 'aguardando_autorizacao', 'pago_parcial')
   AND p.net_cents > p.paid_cents;

COMMENT ON VIEW fin_pagamento_compromisso_v IS
  'A fila como camada de previsão, com entra_no_saldo=false por construção. A mesma '
  'despesa já é projetada por recorrente, cartão ou documento; somar as duas dobraria '
  'a saída. motivo_nao_somado diz, caso a caso, qual camada já a contém.';

-- ---------------------------------------------------------------------------
-- 20. CONCILIAÇÃO POSTERIOR: candidatos no extrato
-- ---------------------------------------------------------------------------

CREATE VIEW fin_pagamento_conciliacao_v AS
SELECT ex.id                       AS execution_id,
       ex.payment_request_id,
       p.code,
       ex.paid_on,
       ex.amount_cents,
       ex.transaction_id,
       t.id                        AS candidato_transaction_id,
       t.posted_on                 AS candidato_data,
       t.amount_cents              AS candidato_cents,
       t.description_raw           AS candidato_descricao,
       abs(t.posted_on - ex.paid_on) AS dias_entre,
       CASE
         WHEN ex.end_to_end_id IS NOT NULL AND t.end_to_end_id = ex.end_to_end_id THEN 'endToEndId'
         WHEN abs(t.amount_cents) = ex.amount_cents AND t.posted_on = ex.paid_on   THEN 'valor+data'
         WHEN abs(t.amount_cents) = ex.amount_cents                                THEN 'valor'
         ELSE 'fraco'
       END                         AS forca
  FROM fin_payment_execution ex
  JOIN fin_payment_request p ON p.id = ex.payment_request_id
  LEFT JOIN fin_transaction t
         ON ex.transaction_id IS NULL
        AND t.amount_cents < 0
        AND t.transfer_status = 'nao'
        AND NOT t.is_split_parent
        AND abs(t.amount_cents) = ex.amount_cents
        AND abs(t.posted_on - ex.paid_on) <= 5
        AND (ex.from_account_id IS NULL OR t.account_id = ex.from_account_id)
        AND NOT EXISTS (SELECT 1 FROM fin_payment_execution o WHERE o.transaction_id = t.id);

COMMENT ON VIEW fin_pagamento_conciliacao_v IS
  'Candidatos no extrato para cada pagamento registrado e ainda não conciliado. '
  'Sugere; não casa sozinho — casamento por coincidência de valor+data já uniu '
  'contrapartes distintas neste ledger (ver A6 do backlog).';

-- ---------------------------------------------------------------------------
-- 21. FILA DE COMPRA, pronta para a tela
-- ---------------------------------------------------------------------------

CREATE VIEW fin_compra_fila_v AS
SELECT c.id,
       c.entity_id,
       c.code,
       c.status,
       c.priority,
       c.title,
       c.description,
       c.justification,
       c.amount_cents,
       c.amount_basis,
       c.quotes_count,
       c.needed_by,
       (c.needed_by - CURRENT_DATE) AS dias_ate_precisar,
       c.counterparty_id,
       cp.name          AS fornecedor_sugerido,
       c.category_id,
       cat.code         AS categoria_code,
       cat.name         AS categoria,
       c.nucleo,
       c.cost_center_id,
       cc.name          AS centro_custo,
       c.budget_line_slug,
       od.meta_cents    AS orcamento_meta_cents,
       od.disponivel_cents AS orcamento_disponivel_cents,
       (od.disponivel_cents IS NOT NULL AND c.amount_cents > od.disponivel_cents) AS estoura_orcamento,
       c.requested_by,
       c.requested_at,
       c.decided_by,
       c.decided_at,
       (SELECT count(*) FROM fin_payment_attachment a
         WHERE a.target_table = 'fin_purchase_request' AND a.target_id = c.id) AS anexos,
       (SELECT count(*) FROM fin_payment_request p WHERE p.purchase_request_id = c.id) AS pagamentos_gerados
  FROM fin_purchase_request c
  LEFT JOIN fin_counterparty cp ON cp.id = c.counterparty_id
  LEFT JOIN fin_category cat ON cat.id = c.category_id
  LEFT JOIN fin_cost_center cc ON cc.id = c.cost_center_id
  LEFT JOIN fin_orcamento_disponivel_v od
         ON od.entity_id = c.entity_id AND od.line_slug = c.budget_line_slug
        AND od.ano = c.budget_ano AND od.periodo = c.budget_periodo;

-- ---------------------------------------------------------------------------
-- 22. LOTE, pronto para a tela
-- ---------------------------------------------------------------------------

CREATE VIEW fin_pagamento_lote_v AS
SELECT b.id,
       b.entity_id,
       b.code,
       b.label,
       b.status,
       b.scheduled_for,
       b.from_account_id,
       a.name              AS conta_pagadora,
       a.current_balance_cents AS saldo_conta_cents,
       b.item_count,
       b.total_cents,
       b.paid_cents,
       (b.total_cents - b.paid_cents) AS saldo_cents,
       b.exported_at,
       b.exported_by,
       b.authorized_outside_system,
       b.authorized_by,
       b.authorized_at,
       -- Um lote com pendência bloqueante em qualquer item não deveria sair
       -- para conferência. O número fica à vista em vez de o schema tentar
       -- adivinhar o que fazer.
       COALESCE(pd.bloqueantes, 0) AS itens_com_bloqueio,
       COALESCE(na.n, 0)           AS itens_sem_alcada_completa
  FROM fin_payment_batch b
  LEFT JOIN fin_account a ON a.id = b.from_account_id
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT pv.payment_request_id) AS bloqueantes
      FROM fin_payment_batch_item i
      JOIN fin_pagamento_pendencia_v pv ON pv.payment_request_id = i.payment_request_id
     WHERE i.batch_id = b.id AND i.status IN ('incluido', 'pago') AND pv.severidade = 'bloqueante'
  ) pd ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n
      FROM fin_payment_batch_item i
      JOIN fin_pagamento_fila_v f ON f.id = i.payment_request_id
     WHERE i.batch_id = b.id AND i.status IN ('incluido', 'pago') AND NOT f.alcada_completa
  ) na ON true;

-- ---------------------------------------------------------------------------
-- 23. COBERTURA DA OPERAÇÃO
-- ---------------------------------------------------------------------------
-- Uma linha, para a tela poder dizer "este número está desatualizado há N dias"
-- em vez de mostrar zero com cara de verdade.

CREATE VIEW fin_pagamento_cobertura_v AS
SELECT (SELECT count(*) FROM fin_approval_rule WHERE is_active)          AS alcadas_declaradas,
       (SELECT count(*) FROM fin_payee_account WHERE is_active)          AS contas_beneficiario,
       (SELECT count(*) FROM fin_purchase_request)                       AS pedidos_compra,
       (SELECT count(*) FROM fin_payment_request)                        AS solicitacoes,
       (SELECT count(*) FROM fin_payment_request
         WHERE status IN ('em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao', 'pago_parcial')) AS na_fila,
       (SELECT COALESCE(SUM(net_cents - paid_cents), 0) FROM fin_payment_request
         WHERE status IN ('em_aprovacao', 'aprovada', 'em_lote', 'aguardando_autorizacao', 'pago_parcial')) AS na_fila_cents,
       (SELECT count(*) FROM fin_payment_execution)                      AS execucoes_registradas,
       (SELECT count(*) FROM fin_payment_execution WHERE transaction_id IS NULL) AS execucoes_sem_conciliar,
       (SELECT max(requested_at) FROM fin_payment_request)               AS ultima_solicitacao_em,
       (SELECT max(registered_at) FROM fin_payment_execution)            AS ultimo_registro_em,
       (SELECT count(*) FROM fin_document WHERE direction = 'pagar')     AS documentos_a_pagar;

COMMENT ON VIEW fin_pagamento_cobertura_v IS
  'Frescor e cobertura da operação de saída. documentos_a_pagar é hoje 0: o ledger só '
  'tem contas a receber, e por isso a fila nasce sem lastro de contas a pagar.';
