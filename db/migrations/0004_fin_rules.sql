-- Motor de classificação, fila de revisão, auditoria e visões salvas.
--
-- A classificação é o problema central deste módulo: 1.015 cobranças, R$ 531 mil
-- (14% da receita), não casam por descrição. Isso não se resolve com regex
-- melhor — resolve-se com um motor auditável e uma fila onde cada decisão
-- humana vira regra permanente.

-- ---------------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------------
-- Condições num DSL em jsonb com vocabulário FECHADO (campos e operadores
-- fixos), nunca SQL nem expressão livre. Três razões: é auditável, é editável
-- pela tela sem deploy, e o mesmo avaliador roda no servidor para o dry-run
-- ("esta regra classificaria mais 187 cobranças, R$ 94.300").
--
-- Exemplo de `conditions`:
--   {"all":[{"field":"description_norm","op":"contains_any",
--            "value":["estudo de disponibilidade","disponibilidade de carga"]},
--           {"field":"direction","op":"equals","value":"receber"}],
--    "none":[{"field":"description_norm","op":"contains_any","value":["cancelado"]}]}
CREATE TABLE fin_rule (
  id           bigserial PRIMARY KEY,
  entity_id    bigint REFERENCES fin_entity(id),
  name         text NOT NULL,
  -- Menor roda primeiro. Explícito e nunca implícito, porque duas colisões
  -- reais neste dado dependem só disto:
  --
  --   · "comissionamento de vendas" (receita da PIAU, 20% do faturamento) tem
  --     de casar ANTES de "laudo" e de "comiss" — laudo de comissionamento é
  --     inspeção técnica, coisa completamente diferente;
  --   · "estudo de disponibilidade de carga" (R$ 465 mil) antes de qualquer
  --     regra genérica com "estudo".
  priority     integer NOT NULL,
  match_scope  text NOT NULL DEFAULT 'both' CHECK (match_scope IN ('transaction', 'document', 'both')),
  conditions   jsonb NOT NULL,
  actions      jsonb NOT NULL,
  confidence   smallint NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  -- 'sugestao_llm' entra sempre como proposta inativa: um LLM nunca escreve
  -- classificação, só propõe regra para um humano aprovar. Classificação tem de
  -- ser reproduzível — a DRE de ontem e a de hoje precisam bater.
  source       text NOT NULL DEFAULT 'humano' CHECK (source IN ('seed', 'humano', 'sugestao_llm')),
  status       text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'proposta', 'arquivada')),
  hits_count   integer NOT NULL DEFAULT 0,
  last_hit_at  timestamptz,
  notes        text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_rule_order_idx ON fin_rule (priority, id) WHERE status = 'ativa';

CREATE TRIGGER fin_rule_touch BEFORE UPDATE ON fin_rule
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

ALTER TABLE fin_transaction ADD CONSTRAINT fin_transaction_rule_fk
  FOREIGN KEY (classified_rule_id) REFERENCES fin_rule(id) ON DELETE SET NULL;
ALTER TABLE fin_document ADD CONSTRAINT fin_document_rule_fk
  FOREIGN KEY (classified_rule_id) REFERENCES fin_rule(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Eventos de classificação
-- ---------------------------------------------------------------------------
-- Histórico completo: nada é sobrescrito.
--
-- Serve a dois propósitos que justificam a tabela sozinhos. É a fonte do badge
-- "por quê?" — qual etapa disparou, qual regra, que trecho do texto casou e
-- quais outras regras casaram mas perderam na prioridade. E é o SINAL DE
-- APRENDIZADO: sem registrar que um humano sobrescreveu uma sugestão, a
-- qualidade das regras nunca é mensurável e o mês 6 custa o mesmo que o mês 1.
-- Esse sinal é irreconstituível depois.
CREATE TABLE fin_classification_event (
  id              bigserial PRIMARY KEY,
  target_table    text NOT NULL CHECK (target_table IN ('fin_transaction', 'fin_document')),
  target_id       bigint NOT NULL,
  stage           text NOT NULL CHECK (stage IN (
                    'humano', 'trava', 'fato_estrutural', 'contrato', 'favorecido', 'historico', 'regra', 'default')),
  rule_id         bigint REFERENCES fin_rule(id) ON DELETE SET NULL,
  category_id     bigint REFERENCES fin_category(id),
  nucleo          text REFERENCES fin_nucleo(slug),
  confidence      smallint CHECK (confidence BETWEEN 0 AND 100),
  -- {"trecho":"laudo","offset":14,"campo":"description_norm",
  --  "tambem_casaram":[{"rule_id":33,"priority":60}]}
  rationale       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Falso quando um humano trocou o que a máquina sugeriu. É esta coluna que
  -- mede se as regras estão melhorando.
  accepted        boolean NOT NULL DEFAULT true,
  superseded_value jsonb,
  actor           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_classification_event_target_idx ON fin_classification_event (target_table, target_id, created_at DESC);
CREATE INDEX fin_classification_event_rule_idx ON fin_classification_event (rule_id) WHERE rule_id IS NOT NULL;
CREATE INDEX fin_classification_event_rejeitadas_idx ON fin_classification_event (created_at DESC) WHERE NOT accepted;

-- ---------------------------------------------------------------------------
-- Fila de revisão
-- ---------------------------------------------------------------------------
-- Em termos de TOC isto é INVENTÁRIO INVISÍVEL: uma pilha de decisões não
-- tomadas com valor mensurável em reais. Por isso é ordenada por R$ em jogo e
-- não por data — o Pareto faz as ~100 primeiras decisões cobrirem a maior parte
-- dos R$ 531 mil.
CREATE TABLE fin_review_item (
  id            bigserial PRIMARY KEY,
  entity_id     bigint NOT NULL REFERENCES fin_entity(id),
  target_table  text NOT NULL CHECK (target_table IN ('fin_transaction', 'fin_document')),
  target_id     bigint NOT NULL,
  reason        text NOT NULL CHECK (reason IN (
                  'sem_categoria', 'baixa_confianca', 'sem_documento', 'divergencia_valor',
                  'texto_generico', 'possivel_nao_receita', 'saida_nao_planejada', 'lancamento_avulso')),
  amount_cents  bigint NOT NULL,
  -- Top-3 sugestões com o motivo, para a linha chegar preenchida em vez de em
  -- branco. Para as cobranças de texto genérico do Asaas, vem do histórico da
  -- contraparte e do agrupamento por valor.
  suggested     jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido', 'adiado', 'ignorado')),
  snoozed_until date,
  assigned_to   text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text,
  UNIQUE (target_table, target_id)
);

CREATE INDEX fin_review_item_fila_idx
  ON fin_review_item (entity_id, (abs(amount_cents)) DESC) WHERE status = 'pendente';
CREATE INDEX fin_review_item_reason_idx ON fin_review_item (reason) WHERE status = 'pendente';

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
-- Guarda o `before`, e é isso que torna o desfazer possível.
--
-- Não é burocracia: é o que dá coragem para classificar rápido. Sem desfazer,
-- cada decisão é ponderada duas vezes e a fila de 1.015 itens nunca esvazia.
--
-- `batch_id` agrupa uma ação em lote inteira, para desfazer 40 linhas
-- classificadas de uma vez com um clique.
CREATE TABLE fin_audit_log (
  id           bigserial PRIMARY KEY,
  entity_id    bigint REFERENCES fin_entity(id),
  target_table text NOT NULL,
  target_id    bigint NOT NULL,
  action       text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'bulk_update', 'import', 'rollback')),
  before       jsonb,
  after        jsonb,
  fields       text[],
  batch_id     uuid,
  -- Enquanto a autenticação for uma senha compartilhada, isto é 'desconhecido'
  -- e a trilha é decorativa. O middleware com múltiplos pares usuário:senha é o
  -- que a torna real — e é o mesmo mecanismo que depois vira alçada de
  -- aprovação de pagamento.
  actor        text NOT NULL DEFAULT 'desconhecido',
  created_at   timestamptz NOT NULL DEFAULT now(),
  undone_at    timestamptz
);

CREATE INDEX fin_audit_target_idx ON fin_audit_log (target_table, target_id, created_at DESC);
CREATE INDEX fin_audit_batch_idx ON fin_audit_log (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX fin_audit_recent_idx ON fin_audit_log (created_at DESC) WHERE undone_at IS NULL;

-- ---------------------------------------------------------------------------
-- Visões salvas
-- ---------------------------------------------------------------------------
-- Filtro que se remonta todos os dias é exatamente o atrito que a planilha não
-- tem. A querystring É a serialização: "salvar visão" grava a querystring atual,
-- e toda visão é um link colável.
--
-- `period` é SEMPRE relativo ({"kind":"mes_corrente"}, {"kind":"ultimos_dias","n":90}).
-- Guardar data absoluta faz a visão apodrecer em 30 dias.
CREATE TABLE fin_saved_view (
  id           bigserial PRIMARY KEY,
  entity_id    bigint NOT NULL REFERENCES fin_entity(id),
  scope        text NOT NULL CHECK (scope IN (
                 'lancamentos', 'despesas', 'receitas', 'pagamentos', 'reembolsos',
                 'fluxo', 'orcamento', 'indicadores', 'revisao')),
  slug         text NOT NULL,
  name         text NOT NULL,
  regime       text NOT NULL DEFAULT 'caixa' CHECK (regime IN ('caixa', 'competencia')),
  period       jsonb NOT NULL DEFAULT '{"kind":"mes_corrente"}'::jsonb,
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  group_by     text[] NOT NULL DEFAULT '{}',
  columns      text[],
  sort         jsonb,
  is_pinned    boolean NOT NULL DEFAULT false,
  owner        text,
  -- Faz a barra superior mostrar as 3 mais usadas em vez de 20 abas.
  use_count    integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, scope, slug)
);

-- ---------------------------------------------------------------------------
-- Gráficos salvos
-- ---------------------------------------------------------------------------
-- "Personalizado" aqui significa: medida × dimensão × grão de data × filtro ×
-- tipo × comparação. Vocabulário FECHADO compilado em SQL parametrizado no
-- servidor — nunca query builder livre, porque um GROUP BY por contraparte e dia
-- sem `top_n` derruba a página.
CREATE TABLE fin_chart (
  id            bigserial PRIMARY KEY,
  entity_id     bigint NOT NULL REFERENCES fin_entity(id),
  slug          text NOT NULL,
  title         text NOT NULL,
  subtitle      text,
  chart_type    text NOT NULL CHECK (chart_type IN (
                  'linha', 'barra', 'barra_empilhada', 'barra_100', 'area', 'pizza', 'waterfall', 'kpi', 'tabela')),
  source        text NOT NULL CHECK (source IN ('transacao', 'documento', 'fluxo_diario', 'orcamento', 'reembolso', 'folha')),
  measure       text NOT NULL CHECK (measure IN (
                  'valor', 'valor_absoluto', 'contagem', 'saldo', 'throughput', 'margem', 'pct_receita')),
  regime        text NOT NULL DEFAULT 'caixa' CHECK (regime IN ('caixa', 'competencia')),
  dimension     text CHECK (dimension IN (
                  'nucleo', 'categoria', 'categoria_pai', 'centro_custo', 'contraparte', 'conta',
                  'cash_flow_group', 'toc_class', 'dre_line', 'pessoa', 'status')),
  date_grain    text NOT NULL DEFAULT 'mes' CHECK (date_grain IN ('dia', 'semana', 'mes', 'trimestre', 'semestre', 'ano')),
  period        jsonb NOT NULL DEFAULT '{"kind":"ultimos_meses","n":12}'::jsonb,
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  compare       text CHECK (compare IN ('ano_anterior', 'periodo_anterior', 'meta', 'orcamento')),
  -- "top 8 + Outros". Sem isto, agrupar por contraparte gera 344 séries.
  top_n         integer,
  saved_view_id bigint REFERENCES fin_saved_view(id) ON DELETE SET NULL,
  is_pinned     boolean NOT NULL DEFAULT false,
  dashboard_slot integer,
  owner         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, slug)
);

-- ---------------------------------------------------------------------------
-- Placar de confiabilidade, congelado
-- ---------------------------------------------------------------------------
-- A série histórica precisa ser CONGELADA, não recalculada.
--
-- Março é classificado em abril. Se a série fosse recomputada, o passado se
-- reescreveria e o índice sempre pareceria ter estado ótimo — um placar que
-- nunca mostra derrota não governa nada.
CREATE TABLE fin_reliability_snapshot (
  entity_id       bigint NOT NULL REFERENCES fin_entity(id),
  date            date NOT NULL,
  component       text NOT NULL CHECK (component IN ('contas', 'classificacao', 'conciliacao', 'planejamento', 'composto')),
  numerator_cents bigint,
  denominator_cents bigint,
  pct             numeric(5,2),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, date, component)
);

-- ---------------------------------------------------------------------------
-- Notas datadas
-- ---------------------------------------------------------------------------
-- A "anotação na margem" da planilha. Parece supérfluo até virar o log de
-- cobrança dos R$ 87 mil vencidos: "liguei dia 3, prometeram pagar dia 10".
CREATE TABLE fin_note (
  id           bigserial PRIMARY KEY,
  target_table text NOT NULL,
  target_id    bigint NOT NULL,
  body         text NOT NULL,
  pinned       boolean NOT NULL DEFAULT false,
  author       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_note_target_idx ON fin_note (target_table, target_id, created_at DESC);
