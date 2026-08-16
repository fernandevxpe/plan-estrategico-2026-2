-- Comissionamento de vendas: a regra, a previsão e o vínculo comissão ↔ negócio.
--
-- ===========================================================================
-- 0. O QUE FOI MEDIDO ANTES DE ESCREVER ESTE ARQUIVO (16/08/2026)
-- ===========================================================================
--
-- O ponto de partida descrito pelo dono era: "é um percentual sobre o vendido;
-- em obras só recebe a partir da segunda parcela; em consultoria recebe mais
-- rápido; dá para prever pelo que foi fechado". Cada parte foi conferida no
-- dado. O resultado abaixo é o que a base sustenta, e ele NÃO é idêntico ao
-- ponto de partida.
--
-- --- (a) O PERCENTUAL EXISTE E ESTÁ DECLARADO, mas em três papéis, não um ----
--
-- `ParametroGlobal` do erp-obras, grupo `faturamento`, lido em 16/08/2026:
--
--   comissao_vendedor        0,07   (7%)   atualizado 2026-07-20
--   comissao_eng_comercial   0,03   (3%)   atualizado 2026-07-20
--   comissao_execucao        0,00   (0%)   atualizado 2026-07-26 01:30
--
-- E `Projeto` carrega a mesma trinca por obra: 13 projetos com 7/3/0, 2 com
-- 10/0/0, 1 com 0/0/0 e 191 (de 207) com NULL.
--
-- O HISTÓRICO PAGO CONTRADIZ o zero de `comissao_execucao`. Em 3 grupos de
-- pagamento distintos a razão vendedor : eng. comercial : execução saiu
-- exatamente 7 : 3 : 5:
--
--   venc 2026-05-01, contrato 143   1.386,00 / 594,00 / 990,00   → base 19.800,00
--   venc 2026-07-01, sem contrato   1.246,00 / 534,00 / 890,00   → base 17.800,00
--   venc 2026-05-01, sem contrato     437,50 / 187,50 / 312,50   → base  6.250,00
--
-- Em cada um deles a base implícita (valor ÷ alíquota) é IDÊNTICA nos três
-- papéis, o que só acontece se as alíquotas forem 7%, 3% e 5%. Por isso este
-- schema registra 5% para `execucao` com `confianca='medida'` e o parâmetro do
-- ERP (0%) fica ao lado, com `confianca='declarada'`, em vez de um escolher o
-- outro. Qual dos dois vale hoje é pergunta para o dono, não para uma migration.
--
-- --- (b) A ALÍQUOTA É ESTÁVEL; A BASE É QUE NÃO É -------------------------
--
-- Dos 8 grupos de comissão que dá para medir (mesmo contrato, mesma data, pelo
-- menos dois papéis), 7 reproduzem a razão 7:3 dentro de 0,3%:
--
--   contrato   vendedor    eng.com.   base(7%)    base(3%)   divergência
--        2       280,00     120,00     4.000,00    4.000,00   exata
--        5       315,00     135,00     4.500,00    4.500,00   exata
--        7       854,70     366,00    12.210,00   12.200,00   0,08%
--        8       675,00   1.575,00     9.642,86   52.500,00   PAPÉIS TROCADOS
--      139       241,50     103,50     3.450,00    3.450,00   exata
--      143       566,30     242,00     8.090,00    8.066,67   0,29%
--      143     1.386,00     594,00    19.800,00   19.800,00   exata (com execução)
--       14     2.087,50   2.087,50    29.821,43   69.583,33   NÃO É 7:3
--
-- O contrato 8 (Madalena Colonial, R$ 45.000) fecha exatamente se as pessoas
-- forem trocadas: 1.575,00 = 7% × 22.500 e 675,00 = 3% × 22.500 — 22.500 é a
-- entrada do contrato. Ou seja, naquele negócio quem vendeu foi o Jonildo e
-- quem fez a engenharia comercial foi o Igor, ao contrário do rótulo que o ERP
-- guarda na subcategoria. A subcategoria do erp-obras é rótulo DE PESSOA
-- (Igor sempre "Vendedor", Jonildo sempre "Eng. comercial"), não papel no
-- negócio. É por isso que `fin_comissao_pagamento` guarda papel E pessoa
-- separados, e que existe `papel_conflita` para marcar exatamente este caso.
--
-- O contrato 14 (Reserva do Poço, R$ 83.500) é o único fora de 7:3: vendedor,
-- eng. comercial e execução receberam R$ 4.175,00 cada — 5% para cada um,
-- pagos em duas metades de 2,5% (2026-05-01 e 2026-08-03). É a regra alternativa
-- semeada abaixo como `reserva-do-poco` com `confianca='medida'`.
--
-- A BASE, essa sim, muda a cada negócio. Base implícita ÷ valor do contrato:
--
--   contrato 5    1,0000   contrato inteiro, de uma vez
--   contrato 7    0,4996   metade
--   contrato 8    0,5000   metade (= a entrada)
--   contrato 143  0,4990   metade
--   contrato 2    0,1667   um sexto (= uma parcela de seis)
--   contrato 139  0,1484   nem contrato, nem parcela — contrato é AMBOS
--   contrato 143  1,2230   MAIOR que o contrato (lançamento de 2026-05-01)
--
-- Não existe função que produza essas sete bases. Elas são decisão humana no
-- momento de montar o lote. Por isso `fin_comissao_regra.base` tem o valor
-- 'indeterminado' e ele é o DEFAULT honesto: a alíquota é regra, a base é fila.
--
-- --- (c) "A PARTIR DA SEGUNDA PARCELA": PARCIALMENTE CONFIRMADO -----------
--
-- Cruzando a data de cada comissão com a data em que o dinheiro do cliente
-- entrou de verdade (fin_document liquidado, não `ParcelaContrato.status` — que
-- está abandonado: 1 PAGA em 471 parcelas):
--
--   contrato  assinatura  1º receb.  2º receb.  comissão   depois do 2º receb.
--       14    2026-03-10  03-12      04-24      05-01      +7 dias      SIM
--        8    2026-06-04  06-18      07-27      08-03      +7 dias      SIM
--        7    2026-06-18  06-19      07-21      08-02      +12 dias     SIM
--      143    2026-06-18  06-19      07-21      08-02      +12 dias     SIM
--        2    2026-06-26  07-06      08-10      08-03      −7 dias      NÃO
--      139    2026-06-26  07-14      (não veio) 08-02      —            NÃO
--        5    2026-06-17  06-12      (não há)   08-03      —            NÃO
--
-- 4 de 7 obedecem. Os 3 que não obedecem têm a mesma explicação: a comissão saiu
-- no LOTE MENSAL. Todas as datas de pagamento de comissão de 2026 caem entre o
-- dia 1 e o dia 6 do mês (01-29, 02-02, 03-06, 05-01, 05-04, 08-02, 08-03) — as
-- mesmas datas da folha. O gatilho real observado é "entrou dinheiro do cliente
-- no mês anterior ⇒ entra no lote do mês seguinte", e a segunda parcela é
-- consequência do prazo, não causa. `fin_comissao_regra.parcela_minima` existe
-- para representar a regra declarada; `gatilho` registra qual das duas leituras
-- gerou cada previsão.
--
-- Defasagem medida assinatura → primeira comissão: 37, 38, 45, 45, 47, 52 e 60
-- dias. Mediana 45. É esse número que a previsão usa enquanto o dono não
-- confirmar a regra.
--
-- --- (d) CONSULTORIA: NÃO HÁ UM ÚNICO REGISTRO POR NEGÓCIO ---------------
--
-- Os 53 lançamentos de comissão do erp-obras são todos de contrato OBRAS ou
-- AMBOS. No único AMBOS (139, Ficus PCM+CLIE) a comissão foi alocada ao projeto
-- de OBRAS (230, CLIE), não ao de consultoria (238, PCM).
--
-- Mas a comissão de consultoria EXISTE como valor: a planilha "Comissionamento -
-- XPE 2026" traz `comissao_consultoria` contratada de R$ 2.626,25 (Gabriel),
-- R$ 2.875,00 (Igor) e R$ 425,00 (Jonildo) — já gravados em
-- fin_person_compensation. E a aba "Projeção Biel Ajustada" da planilha de
-- projeção assume 5% sobre o faturamento, pago em 4 parcelas iguais.
--
-- Nenhum desses três valores se reconstrói como percentual de contrato assinado
-- nem de receita realizada em nenhum mês de 2026 (testado com 2,5%, 5% e 7%
-- sobre contratos de consultoria assinados por mês e sobre a receita de
-- consultoria do ledger). Fica `confianca='indeterminada'` e entra na fila.
--
-- --- (e) O VENDEDOR NÃO ESTÁ NO PIPEDRIVE --------------------------------
--
-- `pipedrive-deals.json` tem 274 negócios ganhos e `user_id` em 100% deles —
-- mas o Pipedrive desta conta só tem DOIS usuários, e os dois são caixas
-- genéricas da empresa: "Vendas" (vendas@xpenergy.com.br, 251 ganhos) e
-- "Pre vendas XPE" (prevendas@xpenergy.com.br, 23 ganhos). `creator_user_id` é
-- o mesmo par. Não há um único campo customizado de vendedor
-- (`pipedrive-deal-fields.json` tem só "Custo" e "Vagas", ambos vazios nos
-- ganhos). CONCLUSÃO: o CRM não sabe quem vendeu.
--
-- Quem sabe é o erp-obras, em dois lugares, e mal: `Contrato.vendedor` está
-- preenchido em 22 de 148 contratos e em 19 deles o valor é a razão social da
-- própria XPE; só "Gabriel" (2 contratos) e "Igor" (1) são pessoas. O resto da
-- atribuição vem do rateio manual de cada PIX em `LancamentoFinanceiro`.
--
-- Por isso `fin_comissao_pagamento.person_id` é a chave de vendedor deste
-- modelo, e ela nasce do PAGAMENTO (quem recebeu), não do negócio. O caminho
-- inverso — do negócio para o vendedor — fica indeterminado até o dono decidir
-- onde o vendedor passa a ser carimbado.
--
-- --- (f) O QUE O LEDGER MOSTRA HOJE, E QUE ESTA MIGRATION NÃO MEXE -------
--
--   fin_transaction com category_id = 4.01 "Comissão paga a vendedor":  0
--   fin_transaction com "comiss" na descrição:                          0
--
-- As comissões chegam ao banco como PIX sem identificação, misturadas com o
-- fixo do mês, e estão classificadas em 6.02 Pró-labore (sócios: Gabriel,
-- Jonildo, Adryan) e 6.01 Salários (MEI: Igor). Do que este trabalho conseguiu
-- identificar, R$ 38.984,00 estão em 6.02 e R$ 7.457,50 em 6.01.
--
-- ISSO NÃO É RECLASSIFICADO AQUI, DE PROPÓSITO. Pró-labore e salário são eixos
-- fiscais separados (0050), e comissão paga a sócio pode legitimamente sair como
-- pró-labore. Mover R$ 38.984,00 de 6.02 para 4.01 mudaria a base de INSS e o
-- resultado do mês com base em heurística. `fin_comissao_pagamento` GUARDA a
-- categoria em que o lançamento está (`ledger_category_id`) como observação, e
-- `fin_comissao_reclassificar_v` lista o que um humano precisaria decidir.
--
-- ===========================================================================
-- 1. POR QUE TRÊS TABELAS, E NÃO UMA
-- ===========================================================================
--
--   fin_comissao_regra      o que a empresa PROMETEU pagar. Vive por vigência,
--                           porque 7%/3%/5% já mudou uma vez (execução foi a
--                           zero em 2026-07-26) e vai mudar de novo.
--   fin_comissao_prevista   o que se ESPERA pagar por negócio. É derivada:
--                           apaga e recalcula sem perder história.
--   fin_comissao_pagamento  o que FOI pago, ligado ao negócio que o originou.
--                           É fato, nasce do extrato + do rateio do ERP, e
--                           nunca é recalculada.
--
-- Juntar previsto e realizado numa tabela só é o erro que a 0057 já evitou nas
-- recorrentes: no dia em que a previsão erra, ninguém consegue mais dizer se o
-- número guardado era a expectativa ou o fato.

-- ---------------------------------------------------------------------------
-- 2. Papéis
-- ---------------------------------------------------------------------------
-- Tabela e não CHECK porque o mapeamento vindo do erp-obras
-- (`LancamentoFinanceiro.subcategoria`) é dado de integração e vai mudar sem
-- deploy. Os três slugs são os literais que aparecem no ERP hoje.
CREATE TABLE IF NOT EXISTS fin_comissao_papel (
  slug            text PRIMARY KEY,
  name            text NOT NULL,
  -- rótulo literal usado por LancamentoFinanceiro.subcategoria no erp-obras
  erp_subcategoria text,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true
);

INSERT INTO fin_comissao_papel (slug, name, erp_subcategoria, sort_order) VALUES
  ('vendedor',      'Vendedor',              'Vendedor',          1),
  ('eng_comercial', 'Engenharia comercial',  'Eng. comercial',    2),
  ('execucao',      'Execução / gestão',     'Execução / gestão', 3)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. A regra
-- ---------------------------------------------------------------------------
-- Dimensões de aplicação, todas opcionais e todas NULL = "vale para qualquer":
--
--   nucleo        obras / consultoria / tecnologia / corporativo
--   person_id     regra específica de um vendedor (nenhuma hoje; a razão está
--                 em (b): a alíquota não mudou por pessoa em nenhum grupo)
--   valor_min/max faixa de valor do negócio. Também sem uso hoje — os sete
--                 contratos medidos vão de R$ 4.500 a R$ 83.500 e todos usam a
--                 mesma alíquota. A coluna existe porque o dono levantou a
--                 hipótese; deixá-la de fora obrigaria migration para testá-la.
--
-- `base` é o que separa uma regra que prevê de uma que só descreve:
--   valor_contratado  % sobre o valor do contrato inteiro
--   valor_recebido    % sobre o que o cliente já pagou
--   parcela           % sobre cada parcela, conforme ela entra
--   indeterminado     mediu-se a alíquota, não a base — é o caso de hoje
--
-- `parcela_minima` e `gatilho` guardam a regra da segunda parcela. `gatilho`
-- diz o que DISPARA o pagamento; `parcela_minima` diz a partir de qual parcela
-- recebida a comissão começa a contar. São coisas diferentes: um negócio pode
-- disparar no lote mensal (gatilho) e ainda assim só remunerar da 2ª em diante.
CREATE TABLE IF NOT EXISTS fin_comissao_regra (
  id               bigserial PRIMARY KEY,
  entity_id        bigint NOT NULL REFERENCES fin_entity(id),
  slug             text NOT NULL,
  papel            text NOT NULL REFERENCES fin_comissao_papel(slug),
  nucleo           text REFERENCES fin_nucleo(slug),
  person_id        bigint REFERENCES fin_person(id),
  valor_min_cents  bigint CHECK (valor_min_cents IS NULL OR valor_min_cents >= 0),
  valor_max_cents  bigint CHECK (valor_max_cents IS NULL OR valor_max_cents > 0),
  pct              numeric(7,5) NOT NULL CHECK (pct >= 0 AND pct <= 1),
  base             text NOT NULL DEFAULT 'indeterminado'
                     CHECK (base IN ('valor_contratado','valor_recebido','parcela','indeterminado')),
  -- a partir de qual parcela RECEBIDA do cliente a comissão passa a existir.
  -- 1 = desde a entrada; 2 = a regra que o dono descreveu para obras.
  parcela_minima   integer NOT NULL DEFAULT 1 CHECK (parcela_minima >= 1),
  -- em quantas parcelas a própria comissão é quitada. Medido: 2 no contrato 14
  -- (2,5% + 2,5%), 1 no contrato 5, 4 na premissa da planilha de projeção.
  tranches         integer NOT NULL DEFAULT 1 CHECK (tranches >= 1),
  gatilho          text NOT NULL DEFAULT 'lote_mensal'
                     CHECK (gatilho IN ('assinatura','recebimento','parcela_minima','lote_mensal','indeterminado')),
  -- defasagem mediana medida entre o gatilho e o pagamento, em dias.
  defasagem_dias   integer,
  vigencia_inicio  date NOT NULL,
  vigencia_fim     date,
  -- de onde saiu o número. Nunca vazio: sem procedência a regra vira folclore.
  fonte            text NOT NULL,
  confianca        text NOT NULL
                     CHECK (confianca IN ('declarada','medida','proposta','indeterminada')),
  evidencia        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'proposta'
                     CHECK (status IN ('ativa','proposta','revogada')),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_comissao_regra_faixa CHECK (
    valor_min_cents IS NULL OR valor_max_cents IS NULL OR valor_max_cents > valor_min_cents),
  CONSTRAINT fin_comissao_regra_vigencia CHECK (
    vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE (entity_id, slug)
);

CREATE INDEX IF NOT EXISTS fin_comissao_regra_aplica_idx
  ON fin_comissao_regra (entity_id, papel, nucleo, vigencia_inicio DESC) WHERE status = 'ativa';

DROP TRIGGER IF EXISTS fin_comissao_regra_touch ON fin_comissao_regra;
CREATE TRIGGER fin_comissao_regra_touch BEFORE UPDATE ON fin_comissao_regra
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. A previsão, por negócio
-- ---------------------------------------------------------------------------
-- Três âncoras possíveis para "o negócio", porque as três existem e nenhuma
-- cobre tudo:
--
--   erp_contrato_id     148 contratos do erp-obras. É a única fonte que tem
--                       valor, parcelas e alíquota juntos.
--   pipeline_ganho_id   274 negócios ganhos do Pipedrive. Tem o momento do
--                       ganho, que o contrato não tem quando não foi assinado.
--   cost_center_id      o projeto como centro de custo, para a margem por obra.
--
-- Pelo menos uma tem de estar preenchida — o CHECK abaixo garante. Uma comissão
-- prevista sem negócio de origem é o número solto que esta tabela existe para
-- impedir.
CREATE TABLE IF NOT EXISTS fin_comissao_prevista (
  id                 bigserial PRIMARY KEY,
  entity_id          bigint NOT NULL REFERENCES fin_entity(id),
  regra_id           bigint REFERENCES fin_comissao_regra(id),
  erp_contrato_id    integer REFERENCES erp_contrato(erp_id) ON DELETE CASCADE,
  pipeline_ganho_id  bigint REFERENCES fin_pipeline_ganho(id) ON DELETE SET NULL,
  cost_center_id     bigint REFERENCES fin_cost_center(id),
  papel              text NOT NULL REFERENCES fin_comissao_papel(slug),
  -- NULL enquanto não se souber QUEM vende aquele negócio. Ver (e): o Pipedrive
  -- não sabe e o ERP quase nunca sabe. Previsão sem pessoa continua valendo
  -- para o caixa; só não serve para a conta individual.
  person_id          bigint REFERENCES fin_person(id),
  base_cents         bigint NOT NULL CHECK (base_cents > 0),
  pct                numeric(7,5) NOT NULL CHECK (pct >= 0 AND pct <= 1),
  valor_cents        bigint NOT NULL CHECK (valor_cents >= 0),
  tranche            integer NOT NULL DEFAULT 1 CHECK (tranche >= 1),
  tranches_total     integer NOT NULL DEFAULT 1 CHECK (tranches_total >= 1),
  competencia        date NOT NULL
                       CHECK (competencia = date_trunc('month', competencia)::date),
  data_prevista      date NOT NULL,
  gatilho            text NOT NULL
                       CHECK (gatilho IN ('assinatura','recebimento','parcela_minima','lote_mensal','indeterminado')),
  estado             text NOT NULL DEFAULT 'previsto'
                       CHECK (estado IN ('previsto','parcial','pago','cancelado','indeterminado')),
  pago_cents         bigint NOT NULL DEFAULT 0 CHECK (pago_cents >= 0),
  motivo             text,
  evidencia          jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_comissao_prevista_tem_negocio CHECK (
    erp_contrato_id IS NOT NULL OR pipeline_ganho_id IS NOT NULL OR cost_center_id IS NOT NULL),
  CONSTRAINT fin_comissao_prevista_tranche_coerente CHECK (tranche <= tranches_total)
);

-- Uma previsão por (negócio, papel, pessoa, tranche). `coalesce` nos nulos
-- porque índice único ignora linha com NULL e deixaria duplicar sem erro.
CREATE UNIQUE INDEX IF NOT EXISTS fin_comissao_prevista_unica_idx
  ON fin_comissao_prevista (
    entity_id, coalesce(erp_contrato_id, -1), coalesce(pipeline_ganho_id, -1),
    papel, coalesce(person_id, -1), tranche);
CREATE INDEX IF NOT EXISTS fin_comissao_prevista_competencia_idx
  ON fin_comissao_prevista (entity_id, competencia, estado);
CREATE INDEX IF NOT EXISTS fin_comissao_prevista_pessoa_idx
  ON fin_comissao_prevista (person_id, competencia) WHERE person_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. A comissão paga, ligada ao negócio
-- ---------------------------------------------------------------------------
-- `transaction_id` é o caixa: a linha do extrato. `erp_lancamento_id` é o
-- rateio: a parte daquele PIX que o humano atribuiu a um projeto no erp-obras.
-- Um PIX de R$ 4.629,00 para o Jonildo em 2026-08-03 virou SETE linhas de
-- comissão, uma por contrato. Todas as sete apontam para a MESMA
-- `transaction_id`, e é justamente por isso que valor_cents delas não pode ser
-- confundido com o valor da transação.
--
-- `ledger_category_id` é observação, não classificação: guarda em que categoria
-- o lançamento está HOJE no ledger (6.01/6.02), para que
-- fin_comissao_reclassificar_v consiga mostrar a distância entre o que o
-- dinheiro é (comissão) e onde ele está contabilizado, sem que ninguém precise
-- mover nada para descobrir isso.
--
-- `papel_conflita` marca o contrato 8: a alíquota implícita da pessoa não bate
-- com o papel que o rótulo do ERP dá a ela. Sem esta coluna o caso vira "erro
-- de 233%" num relatório de aderência e some.
CREATE TABLE IF NOT EXISTS fin_comissao_pagamento (
  id                  bigserial PRIMARY KEY,
  entity_id           bigint NOT NULL REFERENCES fin_entity(id),
  transaction_id      bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  erp_lancamento_id   integer,
  erp_lancamento_pai  integer,
  person_id           bigint REFERENCES fin_person(id),
  counterparty_id     bigint REFERENCES fin_counterparty(id),
  papel               text REFERENCES fin_comissao_papel(slug),
  valor_cents         bigint NOT NULL CHECK (valor_cents > 0),
  pago_em             date NOT NULL,
  competencia         date
                        CHECK (competencia IS NULL OR competencia = date_trunc('month', competencia)::date),
  erp_contrato_id     integer REFERENCES erp_contrato(erp_id) ON DELETE SET NULL,
  erp_projeto_id      integer,
  pipeline_ganho_id   bigint REFERENCES fin_pipeline_ganho(id) ON DELETE SET NULL,
  cost_center_id      bigint REFERENCES fin_cost_center(id),
  prevista_id         bigint REFERENCES fin_comissao_prevista(id) ON DELETE SET NULL,
  -- base implícita = valor ÷ alíquota do papel. NULL quando não há papel ou
  -- não há alíquota vigente — e aí a linha é evidência, não medição.
  base_implicita_cents bigint CHECK (base_implicita_cents IS NULL OR base_implicita_cents > 0),
  -- alíquota implícita = valor ÷ valor do contrato. É o número que responde
  -- "quanto por cento do vendido isso foi", medido, sem premissa.
  pct_implicito       numeric(9,6),
  papel_conflita      boolean NOT NULL DEFAULT false,
  ledger_category_id  bigint REFERENCES fin_category(id),
  vinculo             text NOT NULL DEFAULT 'indeterminado'
                        CHECK (vinculo IN ('erp_rateio','erp_lancamento','valor_data','humano','indeterminado')),
  confianca           numeric(4,3) NOT NULL DEFAULT 0
                        CHECK (confianca >= 0 AND confianca <= 1),
  motivo              text,
  evidencia           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- O lançamento do ERP é a chave natural do rateio: reimportar não pode duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS fin_comissao_pagamento_erp_idx
  ON fin_comissao_pagamento (entity_id, erp_lancamento_id) WHERE erp_lancamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_comissao_pagamento_tx_idx
  ON fin_comissao_pagamento (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_comissao_pagamento_contrato_idx
  ON fin_comissao_pagamento (erp_contrato_id) WHERE erp_contrato_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_comissao_pagamento_pessoa_idx
  ON fin_comissao_pagamento (person_id, pago_em DESC) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_comissao_pagamento_pendente_idx
  ON fin_comissao_pagamento (entity_id, pago_em) WHERE vinculo = 'indeterminado';

DROP TRIGGER IF EXISTS fin_comissao_pagamento_touch ON fin_comissao_pagamento;
CREATE TRIGGER fin_comissao_pagamento_touch BEFORE UPDATE ON fin_comissao_pagamento
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- A soma das partes rateadas não pode passar o valor da transação que as
-- originou. Sem isso, um rateio importado duas vezes com ids diferentes duplica
-- despesa sem que nenhuma linha pareça errada.
CREATE OR REPLACE FUNCTION fin_comissao_rateio_cabe() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_soma bigint; v_tx bigint;
BEGIN
  IF NEW.transaction_id IS NULL THEN RETURN NEW; END IF;
  SELECT abs(amount_cents) INTO v_tx FROM fin_transaction WHERE id = NEW.transaction_id;
  SELECT coalesce(sum(valor_cents), 0) INTO v_soma
    FROM fin_comissao_pagamento
   WHERE transaction_id = NEW.transaction_id AND id <> coalesce(NEW.id, -1);
  IF v_soma + NEW.valor_cents > v_tx THEN
    RAISE EXCEPTION 'rateio de comissão (% + %) excede a transação % (%)',
      v_soma, NEW.valor_cents, NEW.transaction_id, v_tx;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_comissao_rateio_cabe_trg ON fin_comissao_pagamento;
CREATE TRIGGER fin_comissao_rateio_cabe_trg
  BEFORE INSERT OR UPDATE OF valor_cents, transaction_id ON fin_comissao_pagamento
  FOR EACH ROW EXECUTE FUNCTION fin_comissao_rateio_cabe();

-- ---------------------------------------------------------------------------
-- 6. As regras que a medição sustenta
-- ---------------------------------------------------------------------------
-- Nada aqui é escolha. Cada linha traz `fonte` com o lugar exato e a data de
-- leitura, e `confianca` diz se o número foi DECLARADO pela empresa ou MEDIDO
-- no histórico. Onde os dois discordam (execução: 0% declarado × 5% medido) as
-- DUAS linhas entram, e é o dono quem revoga uma.
INSERT INTO fin_comissao_regra
  (entity_id, slug, papel, nucleo, pct, base, parcela_minima, tranches, gatilho,
   defasagem_dias, vigencia_inicio, fonte, confianca, status, evidencia, notes)
SELECT e.id, v.slug, v.papel, v.nucleo, v.pct, v.base, v.pmin, v.tranches, v.gatilho,
       v.defasagem, v.inicio, v.fonte, v.confianca, v.status, v.evidencia::jsonb, v.notes
  FROM fin_entity e, (VALUES
    ('obras-vendedor-7', 'vendedor', 'obras', 0.07000, 'indeterminado', 1, 1, 'lote_mensal', 45,
     DATE '2026-01-01',
     'erp-obras ParametroGlobal.faturamento.comissao_vendedor, lido 16/08/2026 (updatedAt 2026-07-20)',
     'declarada', 'ativa',
     '{"projetos_com_pct":13,"razao_confirmada_em_grupos":6,"contratos":[2,5,7,8,139,143]}',
     'Confirmada em 6 grupos de pagamento; base implícita idêntica à do eng. comercial em todos.'),

    ('obras-eng-comercial-3', 'eng_comercial', 'obras', 0.03000, 'indeterminado', 1, 1, 'lote_mensal', 45,
     DATE '2026-01-01',
     'erp-obras ParametroGlobal.faturamento.comissao_eng_comercial, lido 16/08/2026 (updatedAt 2026-07-20)',
     'declarada', 'ativa',
     '{"projetos_com_pct":13,"razao_confirmada_em_grupos":6,"contratos":[2,5,7,8,139,143]}',
     'Razão vendedor:eng = 7:3 exata em 2, 5, 139 e 143(mai); dentro de 0,3% em 7 e 143(ago).'),

    ('obras-execucao-5-medida', 'execucao', 'obras', 0.05000, 'indeterminado', 1, 1, 'lote_mensal', 45,
     DATE '2026-01-01',
     'medido: 3 grupos de pagamento com base implícita idêntica aos 7% e 3% (990/19.800, 890/17.800, 312,50/6.250)',
     'medida', 'proposta',
     '{"grupos":[{"venc":"2026-05-01","contrato":143,"base":19800},{"venc":"2026-07-01","base":17800},{"venc":"2026-05-01","base":6250}]}',
     'CONFLITA com ParametroGlobal.comissao_execucao = 0,00 (alterado 2026-07-26). Decisão do dono.'),

    ('obras-execucao-0-declarada', 'execucao', 'obras', 0.00000, 'indeterminado', 1, 1, 'lote_mensal', 45,
     DATE '2026-07-26',
     'erp-obras ParametroGlobal.faturamento.comissao_execucao, lido 16/08/2026 (updatedAt 2026-07-26 01:30)',
     'declarada', 'proposta',
     '{"conflita_com":"obras-execucao-5-medida","pagamentos_a_5pct_ate":"2026-07-01"}',
     'Se valer, a comissão de execução acabou em 26/07/2026. Nenhum pagamento posterior a essa data confirma ou nega.'),

    ('obras-vendedor-10-projeto', 'vendedor', 'obras', 0.10000, 'valor_contratado', 1, 1, 'lote_mensal', 45,
     DATE '2026-07-15',
     'erp-obras Projeto.comissaoVendedorPct = 0,10 nos projetos 227 e 245',
     'declarada', 'proposta',
     '{"projetos":[227,245],"contratos":[141,151],"valores":[1500000,790000]}',
     'Dois projetos com 10% no vendedor e 0% nos demais papéis. Nenhum pagamento ainda — não dá para medir.'),

    ('reserva-do-poco-5-5-5', 'vendedor', 'obras', 0.05000, 'valor_contratado', 1, 2, 'parcela_minima', 52,
     DATE '2026-03-10',
     'medido: contrato 14 (Reserva do Poço, R$ 83.500) — vendedor, eng. e execução receberam R$ 4.175,00 cada, em 2 tranches de 2,5%',
     'medida', 'proposta',
     '{"contrato":14,"valor_contratado":8350000,"por_papel":417500,"tranches":[{"pago_em":"2026-05-01"},{"pago_em":"2026-08-03"}]}',
     'Único contrato fora de 7:3. Regra específica ou exceção negociada — o dado não separa.'),

    ('consultoria-5-projecao', 'vendedor', 'consultoria', 0.05000, 'indeterminado', 1, 4, 'indeterminado', NULL,
     DATE '2026-01-01',
     'planilha Projeção Financeira v3.1, aba "Projeção Biel Ajustada" linha 22 (Comissão prevista = 5%, dividida em 4 parcelas)',
     'indeterminada', 'proposta',
     '{"comissao_consultoria_contratada":{"gabriel":262625,"igor":287500,"jonildo":42500},"pagamentos_por_negocio":0}',
     'PREMISSA, não medição. Zero comissões de consultoria com negócio identificado em 53 lançamentos do ERP. Os valores contratados da planilha não se reconstroem como 2,5%, 5% nem 7% de nenhuma base testada.')
  ) AS v(slug, papel, nucleo, pct, base, pmin, tranches, gatilho, defasagem, inicio, fonte, confianca, status, evidencia, notes)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Leituras
-- ---------------------------------------------------------------------------

-- O percentual MEDIDO, negócio a negócio. É o que responde "quanto por cento do
-- vendido a XPE paga de comissão", sem premissa: soma o que foi pago por
-- contrato e divide pelo valor do contrato.
CREATE OR REPLACE VIEW fin_comissao_medida_v AS
SELECT c.erp_id                                   AS erp_contrato_id,
       c.titulo,
       c.eixo,
       c.valor_contratado_cents,
       c.data_assinatura,
       p.papel,
       pe.name                                    AS pessoa,
       sum(p.valor_cents)                         AS pago_cents,
       round(sum(p.valor_cents)::numeric / nullif(c.valor_contratado_cents, 0), 6) AS pct_sobre_contrato,
       min(p.pago_em)                             AS primeira_comissao,
       max(p.pago_em)                             AS ultima_comissao,
       min(p.pago_em) - c.data_assinatura         AS dias_apos_assinatura,
       bool_or(p.papel_conflita)                  AS papel_conflita
  FROM fin_comissao_pagamento p
  JOIN erp_contrato c ON c.erp_id = p.erp_contrato_id
  LEFT JOIN fin_person pe ON pe.id = p.person_id
 GROUP BY c.erp_id, c.titulo, c.eixo, c.valor_contratado_cents, c.data_assinatura, p.papel, pe.name;

-- Backtest: previsto × pago por mês de competência. `erro_cents` é o que a
-- regra errou; `erro_pct` normaliza pelo pago. Uma regra que não reproduz o
-- passado não serve para prever o futuro — esta view é o teste.
CREATE OR REPLACE VIEW fin_comissao_backtest_v AS
WITH prev AS (
  SELECT entity_id, competencia, sum(valor_cents) AS previsto_cents, count(*) AS n_previsto
    FROM fin_comissao_prevista WHERE estado <> 'cancelado' GROUP BY 1, 2
), pago AS (
  SELECT entity_id, date_trunc('month', pago_em)::date AS competencia,
         sum(valor_cents) AS pago_cents, count(*) AS n_pago
    FROM fin_comissao_pagamento GROUP BY 1, 2
)
SELECT coalesce(prev.entity_id, pago.entity_id)         AS entity_id,
       coalesce(prev.competencia, pago.competencia)     AS competencia,
       coalesce(prev.previsto_cents, 0)                 AS previsto_cents,
       coalesce(pago.pago_cents, 0)                     AS pago_cents,
       coalesce(prev.previsto_cents, 0) - coalesce(pago.pago_cents, 0) AS erro_cents,
       CASE WHEN coalesce(pago.pago_cents, 0) = 0 THEN NULL
            ELSE round((coalesce(prev.previsto_cents, 0) - pago.pago_cents)::numeric
                       / pago.pago_cents, 4) END       AS erro_pct,
       coalesce(prev.n_previsto, 0)                     AS n_previsto,
       coalesce(pago.n_pago, 0)                         AS n_pago
  FROM prev FULL OUTER JOIN pago
    ON pago.entity_id = prev.entity_id AND pago.competencia = prev.competencia;

-- A fila humana. Não é relatório: é a tela de decisão (ver PROMPT_CONCLUSAO_BASE).
-- Cada linha é uma pergunta objetiva com as opções já levantadas.
CREATE OR REPLACE VIEW fin_comissao_indeterminado_v AS
SELECT 'pagamento_sem_negocio'                    AS tipo,
       p.id                                       AS ref_id,
       p.pago_em                                  AS data,
       p.valor_cents,
       coalesce(pe.name, cp.name, '(sem contraparte)') AS quem,
       coalesce(p.motivo, 'comissão paga sem contrato de origem identificado') AS motivo
  FROM fin_comissao_pagamento p
  LEFT JOIN fin_person pe ON pe.id = p.person_id
  LEFT JOIN fin_counterparty cp ON cp.id = p.counterparty_id
 WHERE p.erp_contrato_id IS NULL AND p.pipeline_ganho_id IS NULL
UNION ALL
SELECT 'pagamento_sem_caixa', p.id, p.pago_em, p.valor_cents,
       coalesce(pe.name, '(sem pessoa)'),
       'rateio do ERP sem transação correspondente no extrato'
  FROM fin_comissao_pagamento p
  LEFT JOIN fin_person pe ON pe.id = p.person_id
 WHERE p.transaction_id IS NULL
UNION ALL
SELECT 'papel_conflita', p.id, p.pago_em, p.valor_cents,
       coalesce(pe.name, '(sem pessoa)'),
       'a alíquota implícita não bate com o papel que o ERP dá à pessoa'
  FROM fin_comissao_pagamento p
  LEFT JOIN fin_person pe ON pe.id = p.person_id
 WHERE p.papel_conflita
UNION ALL
SELECT 'regra_em_conflito', r.id, r.vigencia_inicio, 0,
       r.slug, 'duas regras vigentes para ' || r.papel || '/' || coalesce(r.nucleo, 'qualquer') ||
       ' com alíquotas diferentes'
  FROM fin_comissao_regra r
 WHERE r.status = 'proposta' AND r.confianca IN ('medida', 'declarada')
   AND EXISTS (SELECT 1 FROM fin_comissao_regra o
                WHERE o.id <> r.id AND o.entity_id = r.entity_id AND o.papel = r.papel
                  AND coalesce(o.nucleo, '') = coalesce(r.nucleo, '') AND o.pct <> r.pct
                  AND o.status IN ('ativa', 'proposta'));

-- O que um humano precisaria decidir sobre CLASSIFICAÇÃO — e que esta migration
-- deliberadamente não decidiu. Mostra a comissão identificada e a categoria em
-- que ela está hoje. Enquanto 4.01 estiver zerado e o dinheiro estiver em 6.01/
-- 6.02, o custo variável de venda não aparece na DRE como custo variável.
CREATE OR REPLACE VIEW fin_comissao_reclassificar_v AS
SELECT cat.code                        AS categoria_atual,
       cat.name                        AS categoria_nome,
       pe.employment_type,
       count(*)                        AS n,
       sum(p.valor_cents)              AS valor_cents,
       min(p.pago_em)                  AS de,
       max(p.pago_em)                  AS ate
  FROM fin_comissao_pagamento p
  LEFT JOIN fin_category cat ON cat.id = p.ledger_category_id
  LEFT JOIN fin_person pe ON pe.id = p.person_id
 GROUP BY cat.code, cat.name, pe.employment_type;

COMMENT ON TABLE fin_comissao_regra IS
  'Alíquota de comissão por papel/núcleo/pessoa/faixa, com vigência e procedência. Alíquota é regra; base é fila.';
COMMENT ON TABLE fin_comissao_prevista IS
  'Comissão esperada por negócio. Derivada — recalculável. Nunca vira realizado por atualização de estado.';
COMMENT ON TABLE fin_comissao_pagamento IS
  'Comissão paga ligada ao negócio que a originou. Fato: nasce do extrato mais o rateio manual do erp-obras.';
COMMENT ON COLUMN fin_comissao_pagamento.ledger_category_id IS
  'Observação da categoria em que o lançamento está no ledger (6.01/6.02). NÃO é reclassificação.';
COMMENT ON COLUMN fin_comissao_pagamento.papel_conflita IS
  'Alíquota implícita incompatível com o papel rotulado pelo ERP — ver contrato 8 (Madalena Colonial).';
