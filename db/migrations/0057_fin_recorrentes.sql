-- O que se repete todo mês passa a existir como dado — sem virar caixa.
--
-- Medido em 15/08/2026 sobre 5.144 lançamentos de jun/2025 a ago/2026
-- (`transfer_status='nao'`, sem 9.01/9.03), agrupados por contraparte+categoria:
--
--     138 propostas de saída em 4 meses de backtest cego (abr–jul/2026)
--      90,6% delas de fato ocorreram no mês previsto
--       4,5% de viés na soma mensal (R$ 378.911,60 previsto × R$ 362.421,96 real)
--       6,5% de erro mediano por linha; 1 dia de erro mediano na data
--      51 recorrentes de saída vigentes hoje: 21 firmes, 18 prováveis, 12 observados
--
-- ---------------------------------------------------------------------------
-- 1. A INVARIANTE QUE ESTA MIGRATION EXISTE PARA PROTEGER
-- ---------------------------------------------------------------------------
-- Previsto nunca vira realizado. Uma recorrente é uma AFIRMAÇÃO SOBRE O FUTURO
-- e não pode, em hipótese alguma, entrar em `fin_transaction` — se entrar, o
-- caixa passa a contar dinheiro que não saiu (nem entrou), e o princípio do
-- projeto — "caixa é a validação máxima, extrato batendo, nada de estimativa" —
-- vira letra morta no lugar exato onde mais importa.
--
-- Por isso não existe `fin_transaction.recurring_id`. A ligação, quando
-- necessária, é feita no sentido oposto e apenas como EVIDÊNCIA:
-- `fin_recurring_observation` aponta para as transações que sustentaram a
-- detecção. Evidência é um ponteiro para o passado; ela não soma.
--
-- ---------------------------------------------------------------------------
-- 2. A SEGUNDA INVARIANTE: NÃO SOMAR CAMADAS (a 0045 documenta a regra)
-- ---------------------------------------------------------------------------
-- O mesmo dinheiro aparece em várias tabelas deste banco, cada uma respondendo
-- uma pergunta diferente. Uma recorrente detectada do histórico pode ser a
-- MESMA obrigação que já mora em outra camada — e aí somar as duas dobra.
--
-- Os quatro choques que a detecção realmente produz, medidos:
--
--   a) RECEITA RECORRENTE. 110 grupos de entrada passaram no detector. Todos
--      são cobranças do Asaas que JÁ estão em `fin_document` e em
--      `fin_receber_aberto_v`. Pior: 27 dos 28 contratos de assinatura ativos
--      (`fin_contract`, `recurrence='mensal'`) têm cobrança futura aberta para a
--      mesma contraparte. Somar recorrente + cobrança + contrato triplicaria.
--      O backtest também mostra que a camada de cobrança é melhor: a entrada
--      "provável" só ocorreu em 36,9% dos meses (viés de +208,6% no valor),
--      contra 88,2% da saída. A curva de aging de `forecast.ts` já modela isso
--      melhor do que uma média histórica jamais modelaria.
--
--   b) FATURA DE CARTÃO. O "Pagamento de fatura" sai da corrente todo mês
--      (8 ocorrências em 2026, R$ 66.738,34) e é exatamente o padrão que um
--      detector de recorrência adora. Ele está fora por construção: a categoria
--      9.01 é excluída do universo de detecção, porque fatura não é despesa —
--      é liquidação do que `fin_card_transaction` já detalha (0047).
--
--   c) FOLHA DECLARADA. `fin_person_compensation` tem, para ago/2026,
--      R$ 61.100,00 de fixo 'contratado' em 20 pessoas mais R$ 11.843,25 de
--      comissão. A detecção encontra R$ 80.244,59/mês em categorias 6.x sobre
--      22 grupos. Os dois números descrevem a mesma folha por caminhos
--      diferentes e NÃO batem. A divergência fica declarada, não resolvida
--      (ver seção 6).
--
--   d) PAGAMENTO RECORRENTE DO ERP. `PagamentoRecorrente` no erp-obras declara
--      5 pagamentos ativos (R$ 16.650,00/mês). São os mesmos que a detecção
--      encontra no ledger — não linhas adicionais. Entram aqui como
--      CORROBORAÇÃO externa (`declarado_erp_id`), nunca como linha própria.
--
-- A guarda contra (a) é estrutural, não documental: `conflito_camada` não pode
-- ser nulo e a linha estar ativa ao mesmo tempo. Uma recorrente que colide com
-- outra camada É REGISTRADA — o conhecimento não se perde — mas o banco recusa
-- ativá-la, e nenhuma view de previsão a soma. Ver o CHECK abaixo.
--
-- ---------------------------------------------------------------------------
-- 3. POR QUE TRÊS FAIXAS DE CONFIANÇA, E NÃO UM LIMIAR
-- ---------------------------------------------------------------------------
-- Um limiar único obriga a escolher entre acertar muito sobre pouco e acertar
-- pouco sobre muito. Medido, com treino cego (só meses anteriores ao mês
-- testado), sobre SAÍDAS, abr–jul/2026:
--
--   faixa       propostas   ocorreu   APE mediana   ±20%    erro de dia   viés Σ
--   firme            62      93,5%        4,4%      79,3%       0 dia     +0,9%
--   provável         76      88,2%       10,6%      56,7%       2 dias    +8,6%
--   observado        38      71,1%       46,4%      29,6%       6 dias   +11,9%
--
-- "Observado" acerta a existência da despesa em 71% dos meses mas erra o valor
-- pela metade. É informação — não é previsão de caixa. Fica gravado com a
-- etiqueta que diz isso, e as views de previsão o excluem por padrão.
--
-- Os critérios de cada faixa, aplicados sobre o total mensal do grupo
-- (contraparte × categoria × sentido):
--
--   firme      >= 4 meses com ocorrência, densidade >= 0,90, MAD/mediana <= 0,20,
--              ocorreu no último mês da janela
--   provável   >= 3 meses, densidade >= 0,75, MAD/mediana <= 0,40,
--              ocorreu num dos 2 últimos meses
--   observado  >= 3 meses, densidade >= 0,60, sem teto de dispersão
--
-- densidade = meses com ocorrência ÷ meses entre a primeira e a última.
-- Dispersão robusta (MAD sobre mediana) e não desvio-padrão sobre média: um
-- único mês fora da curva — 13º, rescisão, compra de material atípica —
-- destruiria a média e mataria uma recorrência verdadeira.
--
-- TRÊS OCORRÊNCIAS É O PISO ABSOLUTO. Duas ocorrências não são cadência: são
-- duas coincidências. O detector recusa por construção (`ocorrencias >= 3` é
-- CHECK de tabela, não regra de script).
--
-- ---------------------------------------------------------------------------
-- 4. POR QUE O VALOR É A MEDIANA DOS 3 ÚLTIMOS MESES
-- ---------------------------------------------------------------------------
-- Cinco bases de valor, mesmas 138 propostas, mesmo backtest cego:
--
--   base                       viés na soma Σ   erro mediano por linha   ±20%
--   mediana dos 3 últimos           +4,5%              6,5%             67,2%
--   média dos 3 últimos             +2,0%             14,0%             60,8%
--   mediana da janela inteira       +3,9%              6,7%             69,6%
--   média da janela inteira         +1,6%             13,3%             57,6%
--   último mês observado            +5,6%              7,7%             63,2%
--
-- As duas médias ganham no agregado e perdem em cada linha: erram para os dois
-- lados e os erros se cancelam na soma. Para "em que dia o caixa aperta" o que
-- importa é a linha, não a soma — um mês certo no total com o aluguel errado
-- em 14% põe o aperto no dia errado. Ficam as medianas.
--
-- Entre as duas medianas o dado atual NÃO decide: 4,5% × 3,9% de viés e 6,5% ×
-- 6,7% de erro por linha, com 14 meses de histórico e 4 meses de teste. A de 3
-- meses é a escolhida por um motivo que este backtest é curto demais para
-- medir: ela segue um reajuste em dois meses, enquanto a da janela inteira
-- carrega o aluguel antigo por meio ano. A escolha fica registrada em
-- `amount_basis`, e trocar de base é reprocessar, não migrar.
--
-- ---------------------------------------------------------------------------
-- 5. POR QUE UM DIA SÓ, SE A FOLHA SAI EM VÁRIAS PARCELAS
-- ---------------------------------------------------------------------------
-- 31 dos 51 grupos vigentes têm mais de 1,5 lançamento por mês — a folha de uma
-- pessoa sai em 3 a 6 pedaços. A pergunta é se a previsão precisa de todos.
-- Medido: no dia-âncora (o do maior lançamento do mês) cai 92,5% do total
-- mensal do grupo, mediana. E o erro do dia-âncora previsto contra o realizado
-- é de 1 dia (mediana), com 72,8% dentro de 3 dias.
--
-- Um dia só, então, com 92,5% do valor no lugar certo. Modelar a cauda exigiria
-- um histograma por grupo cuja manutenção não se paga contra 7,5% de valor
-- deslocado em poucos dias. A escolha fica registrada em `day_concentration`,
-- por linha: quem quiser saber o quanto essa simplificação custa naquela linha
-- lê a coluna em vez de descobrir na prática.
--
-- ---------------------------------------------------------------------------
-- 6. O QUE FICA INDETERMINADO, DE PROPÓSITO
-- ---------------------------------------------------------------------------
--   · Folha detectada (R$ 80.244,59) × folha declarada (R$ 72.943,25). Não há
--     evidência aqui que diga qual das duas é a folha. Nenhuma das duas é
--     escolhida: a recorrente carrega `divergencia_declarada_cents` e a
--     pergunta vai para o Fernando.
--   · Categoria: os 51 grupos de saída vigentes têm todos categoria no ledger
--     (0 sem categoria, medido). Do lado da entrada há 6 grupos sem categoria —
--     e é mais um motivo para a receita não sair daqui. A coluna `category_id`
--     continua anulável e o CHECK exige categoria só para ativar: recorrente
--     sem categoria não entra em orçamento nem em DRE.
--   · A cobertura da previsão de saída sobe com o histórico: 45,8% do gasto
--     identificado de abr, 74,0% do de jul. Não é 100% e não deve parecer:
--     `fin_caixa_previsto_dia_v` (0058) publica a cobertura ao lado do saldo.

-- ===========================================================================
-- fin_recurring — a obrigação que se repete
-- ===========================================================================
CREATE TABLE fin_recurring (
  id              bigserial PRIMARY KEY,
  entity_id       bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,

  -- Nome legível. Não é derivado da contraparte de propósito: "Aluguel da sala"
  -- é o que o Fernando procura, "Ancora Imobiliária" é quem recebe.
  label           text   NOT NULL,

  -- Mesmo vocabulário de fin_document e fin_contract. Sem sinal negativo em
  -- lugar nenhum: `amount_cents` é sempre positivo e o sentido é `direction`.
  -- Guardar o sinal em duas colunas é a receita para uma delas mentir.
  direction       text   NOT NULL CHECK (direction IN ('pagar','receber')),

  counterparty_id bigint REFERENCES fin_counterparty(id) ON DELETE SET NULL,
  category_id     bigint REFERENCES fin_category(id) ON DELETE SET NULL,
  nucleo          text   REFERENCES fin_nucleo(slug) ON UPDATE CASCADE,
  cost_center_id  bigint REFERENCES fin_cost_center(id) ON DELETE SET NULL,

  -- De onde sai (ou entra) o dinheiro. Nulo = ainda não se sabe; a previsão
  -- diária soma no caixa consolidado e declara que não sabe a conta.
  account_id      bigint REFERENCES fin_account(id) ON DELETE SET NULL,

  cadence         text   NOT NULL DEFAULT 'mensal'
                    CHECK (cadence IN ('mensal','bimestral','trimestral','semestral','anual')),
  day_of_month    int    NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  -- O que fazer quando o dia cai em fim de semana ou não existe no mês (31 em
  -- fevereiro). 'exato' trunca para o último dia do mês; os outros dois andam
  -- para o dia útil vizinho.
  due_day_rule    text   NOT NULL DEFAULT 'exato'
                    CHECK (due_day_rule IN ('exato','antecipa','posterga')),
  -- Mês da primeira e da última competência em que a recorrente vale. Sempre
  -- dia 1: é competência, não data de pagamento.
  start_month     date   NOT NULL CHECK (date_trunc('month', start_month) = start_month),
  end_month       date   CHECK (end_month IS NULL OR date_trunc('month', end_month) = end_month),

  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  amount_basis    text   NOT NULL
                    CHECK (amount_basis IN ('mediana_3m','media_janela','declarado','contrato')),

  -- Faixa medida no backtest, não adjetivo. Ver seção 3.
  confidence      text   NOT NULL CHECK (confidence IN ('firme','provavel','observado')),

  -- 'proposto' é o estado de nascimento de tudo que veio de detecção: o
  -- detector propõe, um humano ativa. `fin_caixa_previsto_dia_v` só soma
  -- 'ativo'.
  status          text   NOT NULL DEFAULT 'proposto'
                    CHECK (status IN ('proposto','ativo','suspenso','encerrado','recusado')),

  -- ── A guarda contra o duplo cômputo, em forma de CHECK ──────────────────
  -- Qual outra camada já contém este mesmo dinheiro. Preenchido, a linha existe
  -- como conhecimento mas o banco recusa ativá-la. É o que impede que a receita
  -- recorrente detectada seja somada por cima da cobrança que já a representa.
  conflito_camada text CHECK (conflito_camada IN
                     ('cobranca','previsao_contrato','contrato_assinatura',
                      'fatura_cartao','folha_declarada','pagamento_recorrente_erp')),
  conflito_motivo text,

  -- ── Evidência da detecção: o que sustenta a afirmação ───────────────────
  ocorrencias     int    NOT NULL CHECK (ocorrencias >= 3),   -- nunca a partir de duas
  span_meses      int    NOT NULL CHECK (span_meses >= 3),
  densidade       numeric(4,3) NOT NULL CHECK (densidade > 0 AND densidade <= 1),
  dispersao       numeric(6,3) NOT NULL CHECK (dispersao >= 0),   -- MAD ÷ mediana
  day_concentration numeric(4,3) CHECK (day_concentration BETWEEN 0 AND 1),
  amostra_de      date   NOT NULL,
  amostra_ate     date   NOT NULL,
  last_seen_on    date,
  CHECK (amostra_ate >= amostra_de),

  -- Corroboração externa. `PagamentoRecorrente.id` do erp-obras quando a mesma
  -- obrigação está declarada lá; a diferença entre o declarado e o detectado
  -- fica explícita em vez de ser mediada por uma escolha silenciosa.
  declarado_erp_id       int,
  declarado_cents        bigint,
  divergencia_declarada_cents bigint,

  source          text   NOT NULL DEFAULT 'deteccao_historico'
                    CHECK (source IN ('deteccao_historico','erp_obras','contrato','manual')),
  source_id       text,
  detector_versao text,
  detectado_em    timestamptz,

  human_locked_fields text[] NOT NULL DEFAULT '{}',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,

  -- A guarda estrutural. Uma linha que colide com outra camada NUNCA fica ativa.
  CONSTRAINT fin_recurring_conflito_nao_ativa
    CHECK (conflito_camada IS NULL OR status <> 'ativo'),

  -- Uma recorrente 'ativa' precisa saber o que é, para onde vai e quanto vale.
  CONSTRAINT fin_recurring_ativa_precisa_categoria
    CHECK (status <> 'ativo' OR category_id IS NOT NULL),

  -- 'observado' é diagnóstico, não previsão: erra o valor em 46% na mediana.
  -- Ativar exigiria decidir o valor à mão — e aí a base passa a ser 'declarado'.
  CONSTRAINT fin_recurring_observado_nao_ativa
    CHECK (status <> 'ativo' OR confidence <> 'observado' OR amount_basis = 'declarado'),

  -- Um par (contraparte, categoria, sentido) descreve uma obrigação só. Duas
  -- linhas ativas para o mesmo par são duplo cômputo por definição.
  -- Índice parcial abaixo, porque só vale entre as ativas.
  UNIQUE (entity_id, source, source_id)
);

CREATE UNIQUE INDEX fin_recurring_ativa_unica_ix
  ON fin_recurring (entity_id, direction, counterparty_id, category_id)
  WHERE status = 'ativo';

CREATE INDEX fin_recurring_status_ix   ON fin_recurring (entity_id, status, direction);
CREATE INDEX fin_recurring_cp_ix       ON fin_recurring (counterparty_id);
CREATE INDEX fin_recurring_categoria_ix ON fin_recurring (category_id);

CREATE TRIGGER fin_recurring_touch BEFORE UPDATE ON fin_recurring
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

CREATE TRIGGER fin_recurring_human_locks BEFORE UPDATE ON fin_recurring
  FOR EACH ROW EXECUTE FUNCTION fin_preserve_human_locks();

-- ===========================================================================
-- fin_recurring_observation — a evidência, mês a mês
-- ===========================================================================
-- Sem isto, "de onde saiu R$ 5.252,23 de aluguel" só se responde rodando o
-- detector de novo sobre um histórico que já mudou. Com isto, a afirmação fica
-- auditável na data em que foi feita — e a taxa de acerto passa a ser medível
-- depois, comparando `cents` do mês previsto com o que aconteceu.
--
-- Note o que esta tabela NÃO tem: nenhuma coluna que possa ser somada como
-- caixa. `cents` aqui é o total observado de um mês PASSADO, agregado; a soma
-- de dinheiro continua saindo de fin_transaction e de lugar nenhum mais.
CREATE TABLE fin_recurring_observation (
  id            bigserial PRIMARY KEY,
  recurring_id  bigint NOT NULL REFERENCES fin_recurring(id) ON DELETE CASCADE,
  competencia   date   NOT NULL CHECK (date_trunc('month', competencia) = competencia),
  cents         bigint NOT NULL,
  n_lancamentos int    NOT NULL CHECK (n_lancamentos > 0),
  dia_ancora    int    NOT NULL CHECK (dia_ancora BETWEEN 1 AND 31),
  -- A transação de maior valor do mês. Ponteiro de auditoria, nunca de soma.
  transaction_id bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  UNIQUE (recurring_id, competencia)
);

CREATE INDEX fin_recurring_observation_comp_ix
  ON fin_recurring_observation (competencia);

-- ===========================================================================
-- fin_recorrente_v — a leitura, com a etiqueta de camada colada
-- ===========================================================================
-- Toda linha carrega `camada='recorrente'` e `procedencia='projetado'`. Não é
-- enfeite: é o que torna impossível uma consulta somar isto com realizado sem
-- ter as duas palavras na tela. A obrigação de distinguir projetado de
-- realizado deixa de depender de quem escreve a consulta.
CREATE VIEW fin_recorrente_v AS
SELECT
  r.id,
  r.entity_id,
  'recorrente'::text AS camada,
  'projetado'::text  AS procedencia,
  r.label,
  r.direction,
  r.status,
  r.confidence,
  r.conflito_camada,
  cp.name  AS contraparte,
  c.code   AS categoria_code,
  c.name   AS categoria,
  r.nucleo,
  r.cost_center_id,
  a.slug   AS conta,
  r.cadence,
  r.day_of_month,
  r.due_day_rule,
  r.amount_cents,
  r.start_month,
  r.end_month,
  r.ocorrencias,
  r.span_meses,
  r.densidade,
  r.dispersao,
  r.day_concentration,
  r.last_seen_on,
  r.declarado_cents,
  r.divergencia_declarada_cents
FROM fin_recurring r
LEFT JOIN fin_counterparty cp ON cp.id = r.counterparty_id
LEFT JOIN fin_category     c  ON c.id  = r.category_id
LEFT JOIN fin_account      a  ON a.id  = r.account_id;

COMMENT ON TABLE  fin_recurring IS
  'Obrigação que se repete. PREVISÃO, nunca caixa: não pode virar fin_transaction.';
COMMENT ON COLUMN fin_recurring.conflito_camada IS
  'Outra camada que já contém este dinheiro. Preenchido ⇒ o CHECK impede status=ativo.';
COMMENT ON COLUMN fin_recurring.dispersao IS
  'MAD ÷ mediana dos totais mensais. Robusto a um mês fora da curva.';
COMMENT ON COLUMN fin_recurring.day_concentration IS
  'Fração do total mensal que cai no dia previsto. Mede o custo de usar um dia só.';
COMMENT ON TABLE  fin_recurring_observation IS
  'Evidência mês a mês da detecção. Ponteiro de auditoria — nenhuma coluna soma caixa.';
