-- Aplicações: a caixinha deixa de ser um saldo e vira uma carteira de posições.
--
-- ===========================================================================
-- O ERRO QUE ESTA MIGRATION EXISTE PARA MATAR
-- ===========================================================================
-- `nubank-caixinhas` exibe R$ 59.001,05. O saldo real hoje, medido na API do
-- Polp posição a posição, é R$ 27.700,17. São R$ 31.300,88 de caixa que não
-- existe, numa conta de RESERVA, errando para cima — a pior direção possível,
-- porque um saldo alto demais só dói na hora de contar com o dinheiro.
--
-- A conta FECHA aritmeticamente (0039 declarou a abertura de R$ 7.003,18 em
-- 30/06 e 7.003,18 + 51.997,87 = 59.001,05, exatamente o que o PDF de julho
-- imprime). O que ela não faz é cobrir o presente: o extrato de caixinhas
-- termina em 31/07, e agosto inteiro — R$ 27.581,05 aplicados e R$ 58.879,36
-- resgatados — nunca entrou. "Fecha" nunca foi sinônimo de "está em dia".
--
-- ===========================================================================
-- POR QUE UMA TABELA DE POSIÇÃO, E NÃO UMA CONTA POR RDB NEM UMA DIMENSÃO
-- ===========================================================================
-- Três desenhos foram considerados, e a diferença entre eles não é de gosto:
--
-- (a) UMA `fin_account` POR RDB — 66 contas hoje, ~10 novas por mês, 48 já
--     mortas. `fin_account` é a dimensão mais estável do módulo: o painel
--     fecha "as 6 contas", o seletor de conta é uma lista curta, e cada conta
--     carrega adapter, abertura e cobertura de extrato. Um RDB não tem nada
--     disso — nasce, rende, é liquidado e some em três semanas. Transformar
--     ciclo de vida em cadastro é o que faz a lista de contas virar log.
--
-- (b) O RDB COMO DIMENSÃO DE `fin_transaction` (coluna ou tag). Barato, e
--     insuficiente pelo motivo que decide tudo: **a posição muda de valor sem
--     que exista lançamento**. Rendimento de RDB é creditado dentro da própria
--     aplicação e nunca passa pela conta corrente — R$ 464,64 hoje. Dimensão
--     de lançamento não carrega saldo; carrega rótulo. Onde o dinheiro está
--     deixaria de ser respondível de novo.
--
-- (c) TABELA DE POSIÇÃO (`fin_investment`) LIGADA À CONTA — escolhida.
--     A conta continua sendo o LUGAR ("Nubank — Caixinhas"); a posição é O QUE
--     o dinheiro é (principal, rendimento apropriado, IR/IOF provisionado,
--     emissão, carência, vencimento, taxa, status). Cada tabela responde uma
--     pergunta só:
--
--       fin_account          quanto tem na caixinha
--       fin_investment       em quais RDBs, vencendo quando, rendendo quanto
--       fin_investment_flow  quando cada real entrou e saiu de cada RDB
--       fin_transaction      o movimento de caixa que o banco imprime
--
-- ===========================================================================
-- A REGRA DE OURO: O SALDO DA CONTA **É** A SOMA DAS POSIÇÕES — NUNCA SOMA COM
-- ===========================================================================
-- Este é o ponto onde o desenho pode inventar R$ 27 mil sem nenhuma tela
-- acusar. Existem três caminhos de dupla contagem, e cada um tem uma trava:
--
-- 1. CORRENTE × CAIXINHA. Uma aplicação sai da conta corrente e entra na
--    caixinha: −R$ X em `nubank`, +R$ X em `nubank-caixinhas`. Somar as duas
--    contas dá o total certo (o dinheiro mudou de bolso), mas classificar
--    qualquer das pernas como despesa ou receita duplicaria o resultado. A
--    trava é antiga e já funciona: a regra 30 carimba 9.03 com `transfer:true`
--    e o pareamento neutraliza as duas pernas juntas. Em julho isso já vale
--    para 18 das 19 linhas.
--
-- 2. POSIÇÃO × CONTA. Se `fin_investment.balance_cents` virar mais uma parcela
--    do caixa **ao lado** de `fin_account.current_balance_cents`, o dinheiro
--    aplicado conta duas vezes. A trava é definicional e está escrita abaixo,
--    em CHECK, COMMENT e view: a soma das posições de uma conta É o saldo
--    daquela conta. Uma é a outra. Nenhum relatório soma as duas — quem quiser
--    o total da empresa soma `fin_account`, e só.
--
-- 3. GIRO INTERNO. O Nubank liquida um RDB e reaplica no mesmo dia (em 14/08,
--    R$ 927,52 saem e voltam). As duas pernas aparecem na conta corrente e se
--    anulam no saldo, mas inflariam qualquer métrica de "quanto foi aplicado".
--    A trava é `fin_investment_flow.settlement_transaction_id`: o giro fica
--    visível como dois flows apontando para o mesmo dia e contas próprias.
--
-- ===========================================================================
-- A PROVA: 54 DOS 55 DIAS DE MOVIMENTO BATEM AO CENTAVO
-- ===========================================================================
-- Conciliação medida em 15/08/2026 entre o fluxo de RDB da conta corrente
-- neste ledger (119 lançamentos "Aplicação RDB" / "Resgate RDB", jan–ago) e os
-- 163 movimentos BUY/SELL das 66 posições do Polp, dia a dia:
--
--   resgates   ledger R$ 150.245,76   ·   SELL Polp R$ 150.245,76   diferença ZERO
--   aplicações ledger R$ 170.181,29   ·   BUY  Polp R$ 177.481,29   diferença R$ 7.300,00
--
-- A única divergência é 28/12/2025: a compra de R$ 7.300,00 que ABRE a
-- caixinha, anterior ao início do extrato do Nubank neste ledger (02/01/2026).
-- É o mesmo lançamento que a 0039 já havia rastreado no erp-obras (id 716) e
-- declarado como o primeiro movimento de RDB de toda a base. Duas fontes
-- independentes, o mesmo dia e o mesmo centavo.
--
-- E a abertura da 0039 sai CONFIRMADA por um caminho que ela não tinha:
--
--   principal acumulado no Polp em 30/06 (BUY−SELL) ....... R$ 6.638,50
--   principal rastreado pela 0039 no erp-obras ............ R$ 6.638,50   igual
--   abertura declarada pela 0039 (do cabeçalho do PDF) .... R$ 7.003,18
--   ⇒ rendimento apropriado dentro da caixinha em 30/06 ... R$   364,68
--
-- A 0039 chamou esses R$ 364,68 de "inferido". Não é mais: é a diferença entre
-- dois números medidos. E o teste independente fecha — o PDF de julho imprime
-- "Rendimento até essa data R$ 102,53", e
--
--   rendimento em 31/07 = 59.001,05 (PDF) − 58.533,84 (principal Polp) = 467,21
--   467,21 − 364,68 = R$ 102,53                                          exato
--
-- Três fontes (PDF do Nubank, extrato da conta corrente, API do Polp) e o
-- mesmo centavo. A abertura de 30/06 fica como está.
--
-- ===========================================================================
-- A ARMADILHA QUE QUASE ENTROU AQUI COMO VERDADE
-- ===========================================================================
-- `GET /integrations/2906/investments` responde `meta.total = 66` e devolve 66
-- linhas em 5 páginas — das quais 62 são distintas. A ordenação é instável:
-- 4 posições vêm DUAS vezes e 4 posições NUNCA aparecem. Somar o que a
-- paginação entrega dá R$ 26.408,97 e parece perfeitamente sólido.
--
-- Uma das quatro invisíveis é a posição 10121, emitida em 22/06/2026,
-- **ACTIVE, com R$ 1.291,20**. As outras três estão liquidadas — e duas delas
-- (10140 e 10141, de 29/07) são exatamente as aplicações de R$ 10.000,00 e
-- R$ 1.136,00 que o PDF do Nubank imprime e que "faltavam" na conciliação.
--
-- Ou seja: a paginação sozinha erra R$ 1.291,20 para BAIXO e faz três dias de
-- movimento parecerem divergentes. Por isso o ingestor não confia na
-- paginação: ele varre a faixa de ids devolvida, busca individualmente todo id
-- ausente, e se recusa a gravar enquanto a contagem final for menor que
-- `meta.total`. Um número que a fonte entrega errado é pior que um vazio.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NÃO FAZ
-- ===========================================================================
-- Ela NÃO mexe em `current_balance_cents` e NÃO insere lançamento nenhum.
-- Corrigir o saldo exige, na mesma transação: espelhar os 34 movimentos de RDB
-- de agosto na caixinha, pareá-los com a perna da conta corrente, lançar o
-- ajuste de rendimento e só então gravar o saldo — com um invariante que
-- derruba o COMMIT se `abertura + Σ lançamentos ≠ Σ posições`. Isso é trabalho
-- de `scripts/sync-polp-investimentos.mjs`, que faz tudo dentro de uma
-- transação e tem dry-run por padrão. Uma migration que gravasse o saldo certo
-- sem os lançamentos deixaria a conta fechada e mentindo pelo outro lado.

-- ---------------------------------------------------------------------------
-- A posição
-- ---------------------------------------------------------------------------
CREATE TABLE fin_investment (
  id                bigserial PRIMARY KEY,
  entity_id         bigint NOT NULL REFERENCES fin_entity(id),
  -- ONDE a posição mora. É esta FK que torna "o saldo da conta é a soma das
  -- posições" uma frase verificável em SQL, e não uma convenção de leitura.
  account_id        bigint NOT NULL,

  provider          text NOT NULL,
  -- O id na fonte. Junto com `provider`, é a identidade: o nome do produto
  -- muda, o id não.
  external_id       text NOT NULL,

  name              text NOT NULL,
  product_type      text NOT NULL,
  product_subtype   text NOT NULL,
  issuer            text,
  issuer_document   text,

  -- Vocabulário próprio, não o da fonte. O Polp diz ACTIVE/TOTAL_WITHDRAWAL;
  -- mapear na ingestão é o que permite trocar de provedor sem reescrever toda
  -- consulta. 'desconhecida' existe para status novo da fonte não virar
  -- silenciosamente 'liquidada' — que zeraria dinheiro vivo.
  status            text NOT NULL CHECK (status IN ('ativa', 'liquidada', 'vencida', 'desconhecida')),

  issue_date        date NOT NULL,
  -- Data a partir da qual o resgate é possível. No RDB de resgate imediato ela
  -- é igual à emissão; num CDB travado, não. É a diferença entre "dinheiro que
  -- posso usar amanhã" e "dinheiro que existe no papel" — a previsão de caixa
  -- (C3) precisa dela, e sem coluna a distinção se perde.
  grace_date        date,
  due_date          date,

  rate_type         text,
  -- 100 = 100% do CDI. numeric e não bigint porque não é dinheiro.
  rate_percent      numeric(9,4),

  -- Os quatro números, e a identidade que os liga.
  --
  --   principal + rendimento bruto − impostos = saldo
  --
  -- `balance_cents` é o único que é CAIXA: é o que volta para a conta corrente
  -- se a posição for resgatada hoje, já líquido de IR e IOF. Guardar o bruto e
  -- deixar o líquido para a tela calcular seria a forma mais fácil de exibir
  -- caixa que não existe — de novo, e pelo mesmo motivo de sempre.
  principal_cents   bigint NOT NULL,
  gross_cents       bigint NOT NULL,
  taxes_cents       bigint NOT NULL CHECK (taxes_cents >= 0),
  balance_cents     bigint NOT NULL CHECK (balance_cents >= 0),
  CONSTRAINT fin_investment_balance_identidade CHECK (balance_cents = gross_cents - taxes_cents),

  -- Saldo de aplicação é marcação: vale para o dia em que foi lido. Sem esta
  -- coluna, um sync que falhou há três semanas exibe o número de três semanas
  -- atrás com a mesma cara de número de hoje.
  quoted_on         date NOT NULL,

  notes             text,
  human_locked_fields text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_investment_provider_external_key UNIQUE (provider, external_id),
  -- Mesma FK composta de fin_transaction, mesmo motivo: sem ela uma posição na
  -- conta da empresa 1 podia carregar entity_id 2, e todo relatório por empresa
  -- discordaria de todo relatório por conta.
  CONSTRAINT fin_investment_account_entity_fkey FOREIGN KEY (account_id, entity_id) REFERENCES fin_account(id, entity_id)
);

CREATE INDEX fin_investment_account_idx ON fin_investment (account_id, status);
CREATE INDEX fin_investment_vencimento_idx ON fin_investment (due_date) WHERE status = 'ativa';

CREATE TRIGGER fin_investment_touch BEFORE UPDATE ON fin_investment
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_investment_locks BEFORE UPDATE ON fin_investment
  FOR EACH ROW EXECUTE FUNCTION fin_preserve_human_locks();

COMMENT ON TABLE fin_investment IS
  'Posições de aplicação (RDB/CDB) dentro de uma fin_account. INVARIANTE: para '
  'uma conta kind=''aplicacao'' sincronizada, fin_account.current_balance_cents = '
  'SUM(fin_investment.balance_cents). É IGUALDADE, não parcela — somar as duas '
  'coisas no caixa da empresa conta o dinheiro aplicado duas vezes.';
COMMENT ON COLUMN fin_investment.balance_cents IS
  'O que volta ao caixa se resgatado hoje, líquido de IR/IOF. É o único dos '
  'quatro valores que pode ser somado como dinheiro.';
COMMENT ON COLUMN fin_investment.principal_cents IS
  'Capital ainda aplicado (amount_original do Polp). Não é o valor comprado: '
  'resgate parcial reduz o principal da posição.';
COMMENT ON COLUMN fin_investment.quoted_on IS
  'Dia da leitura na fonte. Saldo de aplicação é marcação, não fato imutável.';

-- ---------------------------------------------------------------------------
-- O movimento de cada posição
-- ---------------------------------------------------------------------------
-- Por que separado de `fin_transaction`, se os dois falam de dinheiro andando:
-- a granularidade é diferente e não é conciliável linha a linha. Em 11/05 a
-- conta corrente recebeu UM crédito de R$ 8.619,44 e o Polp registra DEZESSETE
-- liquidações naquele dia. Forçar 1:1 quebraria o invariante B2 (todo grupo de
-- transferência tem exatamente duas pernas) ou obrigaria a inventar rateio.
--
-- Então: `fin_transaction` guarda o que o banco imprime no extrato, e é ele que
-- fecha o saldo; `fin_investment_flow` guarda o que aconteceu DENTRO da
-- caixinha, e é ele que diz de qual RDB o dinheiro saiu. A ponte é
-- `settlement_transaction_id`, N:1 e deliberadamente nullable.
CREATE TABLE fin_investment_flow (
  id                bigserial PRIMARY KEY,
  entity_id         bigint NOT NULL REFERENCES fin_entity(id),
  investment_id     bigint NOT NULL REFERENCES fin_investment(id) ON DELETE CASCADE,

  provider          text NOT NULL,
  external_id       text NOT NULL,

  direction         text NOT NULL CHECK (direction IN ('aplicacao', 'resgate')),
  trade_date        date NOT NULL,
  -- Sempre positivo: o sinal está em `direction`. Espelha o net_amount do Polp,
  -- que já é líquido das despesas da operação.
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  -- Quantidade de cotas. No RDB do Nubank a cota vale R$ 0,01 na emissão e
  -- quantity é o principal em centavos — conferido nas 66 posições. Guardado
  -- assim mesmo para não depender dessa coincidência em outro produto.
  quantity          numeric(20,6),

  -- A perna na conta corrente que liquidou este movimento, quando é possível
  -- afirmar QUAL. NULL não é falha: é o caso normal do resgate consolidado, em
  -- que N liquidações viram um crédito só. A conciliação real é por dia.
  settlement_transaction_id bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_investment_flow_provider_external_key UNIQUE (provider, external_id)
);

CREATE INDEX fin_investment_flow_investment_idx ON fin_investment_flow (investment_id, trade_date);
CREATE INDEX fin_investment_flow_data_idx ON fin_investment_flow (trade_date);
CREATE INDEX fin_investment_flow_liquidacao_idx ON fin_investment_flow (settlement_transaction_id)
  WHERE settlement_transaction_id IS NOT NULL;

CREATE TRIGGER fin_investment_flow_touch BEFORE UPDATE ON fin_investment_flow
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

COMMENT ON TABLE fin_investment_flow IS
  'BUY/SELL por posição. NÃO é ledger de caixa e NUNCA deve ser somado ao '
  'caixa: quem fecha saldo é fin_transaction. Serve para responder de qual RDB '
  'o dinheiro saiu e para conciliar, por dia, contra o extrato da conta corrente.';
COMMENT ON COLUMN fin_investment_flow.settlement_transaction_id IS
  'Perna na conta corrente, quando identificável 1:1. NULL é esperado no '
  'resgate consolidado (17 liquidações → 1 crédito em 11/05/2026).';

-- ---------------------------------------------------------------------------
-- A view que torna o invariante consultável
-- ---------------------------------------------------------------------------
-- Existe para que "a conta bate com a carteira?" seja uma linha de SQL e não
-- uma reunião. `delta_cents <> 0` é sempre defeito: ou o sync não rodou, ou
-- alguém mexeu no saldo à mão, ou entrou posição sem lançamento.
CREATE VIEW fin_investment_posicao AS
SELECT a.id                                             AS account_id,
       a.slug                                           AS account_slug,
       a.current_balance_cents                          AS saldo_conta_cents,
       coalesce(sum(i.balance_cents), 0)                AS soma_posicoes_cents,
       a.current_balance_cents - coalesce(sum(i.balance_cents), 0) AS delta_cents,
       count(i.id) FILTER (WHERE i.status = 'ativa')     AS posicoes_ativas,
       coalesce(sum(i.principal_cents), 0)              AS principal_cents,
       coalesce(sum(i.gross_cents - i.principal_cents), 0) AS rendimento_bruto_cents,
       coalesce(sum(i.taxes_cents), 0)                  AS impostos_provisionados_cents,
       max(i.quoted_on)                                 AS lido_em,
       min(i.due_date) FILTER (WHERE i.status = 'ativa') AS proximo_vencimento
  FROM fin_account a
  LEFT JOIN fin_investment i ON i.account_id = a.id
 WHERE a.kind = 'aplicacao'
 GROUP BY a.id, a.slug, a.current_balance_cents;

COMMENT ON VIEW fin_investment_posicao IS
  'Conta de aplicação × carteira. delta_cents <> 0 é sempre defeito. NUNCA '
  'some saldo_conta_cents com soma_posicoes_cents: são o mesmo dinheiro.';

-- ---------------------------------------------------------------------------
-- A conta deixa de ser manual
-- ---------------------------------------------------------------------------
-- `nubank-caixinhas` está como 'manual' desde a 0014 porque a única fonte era
-- um PDF arrastado para a tela. É por isso que ela atrasou 15 dias sem que nada
-- reclamasse: adapter 'manual' é a declaração de que ninguém vai buscar.
ALTER TABLE fin_account DROP CONSTRAINT fin_account_import_adapter_check;
ALTER TABLE fin_account
  ADD CONSTRAINT fin_account_import_adapter_check
  CHECK (import_adapter IN ('asaas_api', 'nubank_csv', 'inter_csv', 'inter_ofx', 'inter_api',
                            'caixa_ofx', 'caixa_csv', 'polp_api', 'manual'));

UPDATE fin_account a
   SET import_adapter = 'polp_api'
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'nubank-caixinhas';

-- `source` de fin_transaction é CHECK fechado desde a 0002, pelo mesmo motivo
-- que a 0040 precisou abri-lo para 'erp_obras': o ledger diz de onde cada linha
-- veio, e um valor a mais é uma linha de migration contra uma coluna de texto
-- livre onde 'polp', 'Polp' e 'polp_api' conviveriam.
ALTER TABLE fin_transaction DROP CONSTRAINT fin_transaction_source_check;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_source_check
  CHECK (source IN ('asaas', 'import_csv', 'import_ofx', 'inter_api', 'polp', 'manual', 'erp_obras'));

-- ---------------------------------------------------------------------------
-- A categoria que faltava: marcação não é rendimento recebido
-- ---------------------------------------------------------------------------
-- O saldo de uma aplicação anda sem lançamento, nos dois sentidos. Sobe quando
-- rende; DESCE quando uma posição com rendimento apropriado é resgatada, porque
-- o rendimento vai junto no dinheiro que volta e deixa de estar aplicado.
--
-- 9.10 ("Rendimentos e juros recebidos") tem kind='receita' e por isso não
-- serve: uma marcação negativa carimbada como receita cai direto no invariante
-- D3 ("nenhuma categoria de receita em lançamento de SAÍDA"), e com razão —
-- receita negativa é a assinatura de despesa disfarçada.
--
-- 9.03 ("Aplicação e resgate") também não serve: marcação não é aplicação nem
-- resgate, e enfiá-la lá faria o volume aplicado no mês mentir.
--
-- Então 9.12, neutra nos dois sinais, dentro do resultado financeiro. O valor
-- do período 01–15/08 é de R$ 2,57 — 0,009% do saldo — e continua aparecendo
-- com nome próprio em vez de sumir dentro de um número redondo.
INSERT INTO fin_category (entity_id, code, name, kind, toc_class, dre_line, cash_flow_group, sort_order)
SELECT e.id, '9.12', 'Ajuste de marcação de aplicação',
       'movimentacao_financeira', 'neutro', 'resultado_financeiro', 'movimentacao', 712
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------------
-- A regra 30 já cobre APLICACAO/RESGATE/APLICACAO_RDB/RESGATE_RDB por
-- `source_kind`, que é a evidência mais forte que existe: veio carimbado da
-- fonte. Ela não alcança as 21 linhas de RDB que a A1 promoveu do erp-obras,
-- porque ali `source_kind` guarda a ORIGEM no ERP ('EXTRATO') e não o tipo de
-- operação do banco. São R$ 17.684,09 de movimento de RDB parados sem
-- categoria — e, pior, insensíveis à regra que existe exatamente para eles.
--
-- Reescrever o `source_kind` daquelas linhas seria apagar o que a fonte disse
-- para fazer a regra casar. A saída é uma segunda regra, de prioridade menor,
-- que lê a descrição — que nestes casos é o rótulo de operação do próprio
-- Nubank ("Aplicação RDB", "Resgate RDB"), não texto comercial livre. Presa às
-- duas contas de Nubank para que nenhuma descrição parecida em outro banco
-- entre por acidente.
--
-- Prioridade 8: depois das duas que decidem por `source_kind` (6 e 7), ainda
-- dentro da faixa dos FATOS (1–9) e antes de qualquer regra de texto comercial.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, 'rdb-pela-descricao', 'Aplicação/resgate de RDB pelo rótulo do banco', 8, 'both',
       '{"all":[{"field":"account_slug","op":"in","value":["nubank","nubank-caixinhas"]}],
         "any":[{"field":"description_norm","op":"starts_with","value":["aplicacao rdb","resgate rdb"]}]}'::jsonb,
       '{"category_code":"9.03","transfer":true}'::jsonb,
       100, 'seed', 'ativa'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- O ajuste de marcação tem carimbo próprio na fonte (`source_kind` =
-- 'AJUSTE_RENDIMENTO', escrito pelo ingestor) para que a decisão continue sendo
-- fato estrutural e não palpite sobre texto — o que o invariante D5 exige.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, 'ajuste-de-marcacao', 'Ajuste de marcação de aplicação', 9, 'both',
       '{"any":[{"field":"source_kind","op":"in","value":["AJUSTE_RENDIMENTO"]}]}'::jsonb,
       '{"category_code":"9.12","nucleo":"corporativo"}'::jsonb,
       100, 'seed', 'ativa'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;
