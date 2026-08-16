-- O cartão de crédito passa a existir — sem virar caixa por engano.
--
-- Medido em 15/08/2026 contra a API do Polp (somente GET), conta CREDIT 2589:
--
--     12 faturas          R$ 89.246,33 faturados de 09/2025 a 08/2026
--    795 transações       722 POSTED (com fatura) + 73 PENDING (sem fatura)
--     11 finais de cartão  9 registrados hoje + 2 que só existem no histórico
--     25 compras parceladas, 156 parcelas observadas, 21 ainda em aberto
--      8 pagamentos de fatura já no ledger, batendo 8/8 com a API
--
-- ---------------------------------------------------------------------------
-- 1. POR QUE NÃO É UMA `fin_account`
-- ---------------------------------------------------------------------------
-- `fin_account.kind` aceita 'cartao' desde a 0001 e nunca foi usado (0 linhas).
-- A tentação é óbvia: criar a sétima conta e pronto. Ela quebra o caixa em
-- silêncio, e dá para apontar as cinco linhas exatas onde isso acontece:
--
--   lib/financeiro/indicadores.ts:115   SUM(current_balance_cents) WHERE kind <> 'emprestimo'
--   lib/financeiro/queries.ts:266       filter(kind !== 'emprestimo').reduce(+saldo)
--   lib/financeiro/forecast.ts:239      filter(kind !== 'emprestimo').reduce(+saldo)
--   lib/financeiro/painel.ts:379        lista toda conta is_active
--   scripts/painel-financeiro.mjs:38    regra zero, SEM filtro nenhum de kind
--
-- Todas essas somas tratam "conta ativa que não é empréstimo" como DINHEIRO QUE
-- A EMPRESA TEM. O saldo do cartão é R$ 8.740,74 de DÍVIDA. Somá-lo ao caixa
-- inventaria oito mil e setecentos reais que não existem, e a regra zero
-- passaria a exigir que uma sétima conta "fechasse" — com o agravante de que o
-- painel diria 7/7 enquanto o dinheiro contado estaria errado. Erro para cima,
-- que é o mais perigoso.
--
-- E não é só o saldo. Se as 795 compras virassem `fin_transaction`, elas
-- entrariam no mesmo ledger onde já está o "Pagamento de fatura" da conta
-- corrente — R$ 66.738,34 em 8 saídas. O gasto contaria duas vezes. A 0017 e a
-- 0018 já tinham chegado a essa conclusão por outro caminho, e vale citar a
-- 0018 na íntegra porque ela é a decisão que esta migration respeita:
--
--     "Fatura de cartão não é retirada de sócio. É transferência da conta para
--      o cartão: o gasto real está no detalhamento da fatura, e lançá-lo aqui
--      como despesa contaria duas vezes quando a fatura entrar."
--
-- Então: tabelas próprias. `fin_card_transaction` é o detalhamento que a 0018
-- previu, e ele não é caixa — nunca soma com `fin_transaction`.
--
-- ---------------------------------------------------------------------------
-- 2. POR QUE UMA LINHA DE CRÉDITO, E NÃO NOVE CARTÕES
-- ---------------------------------------------------------------------------
-- A conta 2589 tem 9 cartões registrados (3148, 0343, 5711, 2841, 6872, 0880,
-- 1113, 7626, 2782) e o histórico mostra mais 2 que já não constam (2288 com 95
-- transações, 9452 com 9). A pergunta é se cada final vira uma conta.
--
-- Não vira, e o dado é categórico:
--
--   a) O limite é UM. `disaggregatedCreditLimits[]` repete, para os 9 cartões,
--      exatamente os mesmos números: limitAmount 17.900, usedAmount 8.740,74,
--      availableAmount 9.159,26. Não existe limite por cartão na fonte. Nove
--      contas exigiriam nove saldos inventados.
--   b) A fatura é UMA. 12 faturas cobrindo todos os cartões juntos.
--   c) O pagamento é UM. Uma saída por mês na conta corrente.
--   d) O final do cartão NÃO É ESTÁVEL. Em 16 dos 25 parcelamentos o cardNumber
--      MUDA no meio do plano — o cartão é reemitido e a mesma compra continua
--      sob outro final. Ex.: "Ryndack Comp*Biscredit" de 24/10/2025, parcela 1
--      no 3148, parcelas 2 a 9 no 7626, parcela 10 de volta no 3148. Modelar
--      por cartão partiria UMA compra em três contas.
--
-- Por isso `fin_card` existe como dimensão (quem gastou), não como conta. E o
-- final entra em `fin_card_transaction.card_last4` como TEXTO, sem chave
-- estrangeira obrigatória: 2288 e 9452 não existem mais na conta e uma FK
-- rígida recusaria o histórico verdadeiro.
--
-- ---------------------------------------------------------------------------
-- 3. A FATURA É A AUTORIDADE; OS ITENS SÃO A EXPLICAÇÃO — E ELES NÃO FECHAM
-- ---------------------------------------------------------------------------
-- Medido: a soma dos itens de todas as faturas dá R$ 75.501,46 contra os
-- R$ 89.246,33 que as faturas declaram. Faltam R$ 13.744,87 — 15,4% — que o
-- Polp simplesmente não itemiza. Nenhuma fatura fecha pela soma dos itens; a
-- diferença vai de R$ 126,00 (10/2025) a R$ 2.126,93 (05/2026).
--
-- Não é erro de paginação: `meta.total` é 795 e as duas páginas trazem 795.
-- Não é erro de sinal: DEBIT vem positivo, CREDIT vem negativo, conferido.
--
-- A consequência de modelagem é a parte que importa: `total_amount_cents` é
-- COPIADO da fatura e nunca derivado da soma dos itens. Uma tela que somasse
-- itens para dizer "quanto devo" erraria 15% para MENOS. Por isso a lacuna fica
-- gravada e visível em `itemized_amount_cents` / `unitemized_amount_cents`, em
-- vez de escondida — é um indeterminado declarado, não um número redondo.
--
-- ---------------------------------------------------------------------------
-- 4. O QUE SAI DO CAIXA É O PAGO, NÃO O FATURADO
-- ---------------------------------------------------------------------------
-- Dez das 12 faturas foram pagas pelo valor cheio. Duas não, e a diferença
-- reconcilia à vírgula com estornos que caíram entre o fechamento e o pagamento:
--
--   fatura 9625  fechada 8.665,89  paga 8.619,44  Δ 46,45
--                = estorno "CURSOR, AI POWERED IDE" 44,88 + estorno do IOF 1,57
--   fatura 9624  fechada 8.927,74  paga 8.479,86  Δ 447,88
--                = estorno de compra 447,88 em 04/06/2026
--
-- Os 8 lançamentos "Pagamento de fatura" do Nubank batem com o PAGO, não com o
-- faturado — inclusive nesses dois. Por isso as duas colunas existem separadas:
-- `total_amount_cents` é o compromisso, `paid_amount_cents` é o caixa.
-- Confundi-las erraria R$ 494,33 em dois meses.
--
-- ---------------------------------------------------------------------------
-- 5. O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- NÃO mexe em `fin_transaction`. Os 8 pagamentos continuam como estão:
-- categoria 9.01 e `transfer_status = 'em_transito'`, como a 0018 deixou.
--
-- Em particular NÃO os promove a 'pareado'. Seria tentador — "achei a outra
-- perna". Mas `fin_transaction_ledger_idx` exclui o que é 'pareado', e a perna
-- de chegada aqui não é uma conta de caixa: é dívida sendo quitada. Parear
-- faria os R$ 66.738,34 de saída real DESAPARECEREM do ledger. Cair de
-- 'em_transito' (que o ledger conta) para 'pareado' (que o ledger ignora) sem
-- que exista uma conta do outro lado é como o caixa some sem ninguém ver.
--
-- O vínculo mora em `fin_card_bill.paid_transaction_id`, que aponta para o
-- lançamento sem alterá-lo.

-- ---------------------------------------------------------------------------
-- 6. A LINHA DE CRÉDITO
-- ---------------------------------------------------------------------------
CREATE TABLE fin_card_account (
  id                     bigserial PRIMARY KEY,
  entity_id              bigint NOT NULL REFERENCES fin_entity(id),
  slug                   text   NOT NULL,
  name                   text   NOT NULL,
  institution            text   NOT NULL,
  brand                  text,

  -- Id da conta CREDIT no Polp (2589). É por ele que o sync acha o resto.
  external_id            text,
  external_source        text NOT NULL DEFAULT 'polp',

  -- Todos vindos de `credit_data`, e todos da linha inteira — não do plástico.
  credit_limit_cents     bigint NOT NULL DEFAULT 0,
  used_limit_cents       bigint NOT NULL DEFAULT 0,
  available_limit_cents  bigint NOT NULL DEFAULT 0,
  minimum_payment_cents  bigint NOT NULL DEFAULT 0,

  -- Dia de vencimento observado. As 12 faturas vencem dia 9, 10 ou 11 (o 9 cai
  -- em fim de semana e anda). Guardar o dia nominal permite projetar a fatura
  -- seguinte, que o Polp ainda não criou.
  due_day                smallint CHECK (due_day BETWEEN 1 AND 31),
  next_due_date          date,

  -- Conta corrente de onde a fatura é debitada (paymentMode DEBIT_ACCOUNT em
  -- 12/12). Serve para a previsão saber de QUAL caixa o dinheiro sai.
  settlement_account_id  bigint REFERENCES fin_account(id),

  is_active              boolean NOT NULL DEFAULT true,
  balance_synced_at      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, slug),
  -- Idempotência do sync: uma conta por id externo.
  UNIQUE (external_source, external_id)
);

COMMENT ON TABLE fin_card_account IS
  'Linha de crédito do cartão. NÃO é fin_account: o saldo aqui é dívida, e toda soma de caixa em lib/financeiro trata conta ativa não-empréstimo como dinheiro disponível.';
COMMENT ON COLUMN fin_card_account.used_limit_cents IS
  'Dívida em aberto informada pela fonte (8.740,74 em 15/08/2026). Positivo = deve.';

-- ---------------------------------------------------------------------------
-- 7. OS PLÁSTICOS
-- ---------------------------------------------------------------------------
-- Dimensão de "quem gastou", não conta. Sem limite e sem saldo próprios, porque
-- a fonte não tem nenhum dos dois por cartão.
CREATE TABLE fin_card (
  id                bigserial PRIMARY KEY,
  card_account_id   bigint NOT NULL REFERENCES fin_card_account(id) ON DELETE CASCADE,
  last4             text   NOT NULL,

  -- 'registrado'  aparece em credit_data hoje
  -- 'historico'   só aparece em transação antiga (2288, 9452) — cartão trocado
  status            text   NOT NULL DEFAULT 'registrado'
                    CHECK (status IN ('registrado', 'historico', 'cancelado')),
  is_primary        boolean NOT NULL DEFAULT false,

  -- Quem carrega o plástico. Fica nulo até alguém dizer — é dado que exige
  -- memória de quem estava lá, e inventar dono de cartão é pior que não ter.
  holder_person_id  bigint REFERENCES fin_person(id),

  -- Default de rateio quando o cartão é de uma frente só. Nulo = decide no item.
  default_nucleo         text   REFERENCES fin_nucleo(slug),
  default_cost_center_id bigint REFERENCES fin_cost_center(id),

  first_seen_on     date,
  last_seen_on      date,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (card_account_id, last4)
);

COMMENT ON COLUMN fin_card.status IS
  'historico = final que só existe em transação passada e não consta mais na conta. Medido: 2288 (95 transações) e 9452 (9). O cartão é reemitido e o final muda no meio de um parcelamento em 16 dos 25 planos.';

-- ---------------------------------------------------------------------------
-- 8. AS FATURAS
-- ---------------------------------------------------------------------------
CREATE TABLE fin_card_bill (
  id                     bigserial PRIMARY KEY,
  card_account_id        bigint NOT NULL REFERENCES fin_card_account(id) ON DELETE CASCADE,

  external_id            text,
  external_source        text NOT NULL DEFAULT 'polp',

  due_date               date NOT NULL,
  -- Mês de referência: chave humana da fatura ("a fatura de agosto"). Derivado
  -- do vencimento, e é por ele que a previsão agrupa.
  reference_month        date NOT NULL,

  -- O Polp não devolve data de fechamento (`balanceCloseDate` é null). Fica
  -- nulo e declarado, em vez de estimado a partir do vencimento.
  closing_date           date,

  -- AUTORIDADE. Copiado de `total_amount`, nunca somado dos itens (§3).
  total_amount_cents     bigint NOT NULL,
  minimum_payment_cents  bigint,

  -- Quanto os itens explicam, e quanto não explicam. Guardar a lacuna é o que
  -- separa "não sei" de "achei que sabia".
  itemized_amount_cents   bigint NOT NULL DEFAULT 0,
  unitemized_amount_cents bigint GENERATED ALWAYS AS (total_amount_cents - itemized_amount_cents) STORED,

  -- CAIXA. O que de fato saiu, que difere do faturado quando cai estorno entre
  -- o fechamento e o pagamento (§4).
  paid_amount_cents      bigint,
  paid_on                date,
  payment_mode           text,
  payment_value_type     text,

  -- O elo com o caixa. Aponta para a saída na conta corrente sem alterá-la.
  paid_transaction_id    bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  -- Como o elo foi feito, para que uma conciliação automática nunca se disfarce
  -- de decisão humana.
  match_method           text CHECK (match_method IN ('auto_valor_data', 'manual', 'importado')),
  match_confidence       smallint CHECK (match_confidence BETWEEN 0 AND 100),

  status                 text NOT NULL DEFAULT 'aberta'
                         CHECK (status IN ('aberta', 'fechada', 'paga', 'paga_parcial', 'atrasada')),

  finance_charges_cents  bigint NOT NULL DEFAULT 0,
  synced_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (external_source, external_id),
  UNIQUE (card_account_id, due_date),

  -- Uma fatura paga tem valor e data de pagamento. Sem isto "paga" viraria um
  -- rótulo sem dinheiro atrás.
  CONSTRAINT fin_card_bill_paga_tem_caixa
    CHECK (status NOT IN ('paga', 'paga_parcial') OR (paid_amount_cents IS NOT NULL AND paid_on IS NOT NULL))
);

-- O caminho da previsão: "que faturas vencem daqui para frente".
CREATE INDEX fin_card_bill_venc_idx ON fin_card_bill (card_account_id, due_date DESC);
-- O caminho da conciliação: fatura fechada esperando o pagamento aparecer.
CREATE INDEX fin_card_bill_aberta_idx ON fin_card_bill (card_account_id, due_date)
  WHERE paid_transaction_id IS NULL;

COMMENT ON COLUMN fin_card_bill.total_amount_cents IS
  'O que a fatura declara. NUNCA derivar somando fin_card_transaction: medido em 15/08/2026, os itens explicam só 84,6% do faturado.';
COMMENT ON COLUMN fin_card_bill.paid_amount_cents IS
  'O que saiu do caixa. Difere de total_amount_cents quando cai estorno entre fechamento e pagamento — aconteceu em 2 das 12 faturas, R$ 494,33.';

-- ---------------------------------------------------------------------------
-- 9. OS ITENS
-- ---------------------------------------------------------------------------
-- Isto NÃO é caixa e não pode ser somado com fin_transaction. É o detalhamento
-- que a 0018 previu: responde "sobre o que foi o gasto", não "quanto saiu".
CREATE TABLE fin_card_transaction (
  id                bigserial PRIMARY KEY,
  card_account_id   bigint NOT NULL REFERENCES fin_card_account(id) ON DELETE CASCADE,

  -- Nulo enquanto PENDING: a compra existe mas ainda não foi faturada.
  bill_id           bigint REFERENCES fin_card_bill(id) ON DELETE SET NULL,

  external_id       text NOT NULL,
  external_source   text NOT NULL DEFAULT 'polp',
  provider_id       text,

  posted_on         date NOT NULL,

  -- Sinal igual ao da fonte e igual ao sentido da DÍVIDA:
  --   positivo = aumenta o que se deve (compra, IOF)
  --   negativo = reduz (estorno, pagamento da fatura)
  -- Note que é o INVERSO de fin_transaction, onde negativo é saída de caixa.
  -- São grandezas diferentes e o comentário existe para que ninguém as some.
  amount_cents      bigint NOT NULL,

  description       text NOT NULL,
  description_norm  text NOT NULL,
  merchant          text,
  mcc               text,

  -- Final do cartão como TEXTO e sem FK obrigatória: 2288 e 9452 não constam
  -- mais na conta, e uma FK rígida recusaria o histórico verdadeiro.
  card_last4        text,
  card_id           bigint REFERENCES fin_card(id) ON DELETE SET NULL,

  -- 'POSTED'  já faturado
  -- 'PENDING' ainda não faturado — inclui as parcelas futuras, que o Polp já
  --           lista antecipadamente (§10)
  status            text NOT NULL CHECK (status IN ('POSTED', 'PENDING')),

  kind              text NOT NULL DEFAULT 'compra'
                    CHECK (kind IN ('compra', 'estorno', 'iof', 'encargo', 'pagamento_fatura', 'ajuste')),

  -- Parcelamento (§10). Nulo em compra à vista.
  installment_plan_id bigint,
  installment_number  integer,
  installments_total  integer,
  purchase_date       date,

  -- Mês da fatura em que este item cai. Para parcela, é derivado
  -- (mês da compra + número da parcela) e não do campo `date` da fonte, que é
  -- inconsistente para parcela futura (§10).
  competence_month    date,

  -- Dimensão de resultado. Existe aqui para que o DRE por competência possa
  -- consumir o cartão sem passar pelo caixa. Fica nulo até ser classificado.
  category_id       bigint REFERENCES fin_category(id),
  nucleo            text   REFERENCES fin_nucleo(slug),
  cost_center_id    bigint REFERENCES fin_cost_center(id),
  counterparty_id   bigint REFERENCES fin_counterparty(id),

  -- Categoria crua do Polp, guardada como veio. É pista, não verdade.
  source_category   text,

  classified_by     text CHECK (classified_by IN ('humano','trava','fato_estrutural','contrato','favorecido','historico','regra','default')),
  classified_rule_id bigint REFERENCES fin_rule(id) ON DELETE SET NULL,
  classified_at     timestamptz,
  human_locked_fields text[] NOT NULL DEFAULT '{}',
  review_status     text NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok','pendente','adiado','ignorado')),

  notes             text,
  synced_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Idempotência do sync.
  UNIQUE (external_source, external_id),

  CONSTRAINT fin_card_transaction_parcela_coerente
    CHECK (installment_number IS NULL OR installments_total IS NULL
           OR installment_number <= installments_total),
  -- Parcela sem data de compra não dá para agendar. Se a fonte parar de mandar
  -- purchaseDate, é melhor falhar na ingestão que produzir previsão sem lastro.
  CONSTRAINT fin_card_transaction_parcela_tem_compra
    CHECK (installment_number IS NULL OR purchase_date IS NOT NULL)
);

CREATE INDEX fin_card_transaction_bill_idx  ON fin_card_transaction (bill_id);
CREATE INDEX fin_card_transaction_data_idx  ON fin_card_transaction (card_account_id, posted_on DESC);
CREATE INDEX fin_card_transaction_plan_idx  ON fin_card_transaction (installment_plan_id) WHERE installment_plan_id IS NOT NULL;
-- O caminho da pergunta do Fernando: o que ainda vai chegar, por mês.
CREATE INDEX fin_card_transaction_futuro_idx ON fin_card_transaction (competence_month)
  WHERE status = 'PENDING';
CREATE INDEX fin_card_transaction_sem_categoria_idx ON fin_card_transaction (card_account_id, abs(amount_cents) DESC)
  WHERE category_id IS NULL;
CREATE INDEX fin_card_transaction_desc_trgm_idx ON fin_card_transaction USING gin (description_norm gin_trgm_ops);

COMMENT ON TABLE fin_card_transaction IS
  'Detalhamento da fatura. NÃO É CAIXA: somar isto com fin_transaction conta o mesmo gasto duas vezes, porque a saída já está lá como "Pagamento de fatura".';
COMMENT ON COLUMN fin_card_transaction.amount_cents IS
  'Sinal no sentido da dívida: positivo aumenta o que se deve. É o INVERSO de fin_transaction.amount_cents.';
COMMENT ON COLUMN fin_card_transaction.kind IS
  'pagamento_fatura marca a linha "Pagamento recebido" que a fonte devolve dentro da própria fatura. Toda soma de GASTO precisa excluí-la.';

-- ---------------------------------------------------------------------------
-- 10. O PARCELAMENTO
-- ---------------------------------------------------------------------------
-- A pergunta do Fernando é "quanto tenho a pagar nos próximos meses, sobre o
-- que, e quantas parcelas faltam". Três achados decidem o desenho:
--
-- (a) NÃO PRECISA INFERIR. `credit_card_metadata` traz installmentNumber,
--     totalInstallments e purchaseDate em 156 das 795 transações. Conferido nos
--     dois sentidos contra o "N/M" que o Nubank escreve na descrição:
--     156/156 dos que têm metadata têm "N/M", e ZERO dos 639 sem metadata têm
--     "N/M". Acerto de 100%, sem heurística. (`totalAmount` vem null em 795/795
--     — o valor original da compra é reconstruído como parcela × total, e é
--     aproximação: a primeira parcela costuma diferir das demais em centavos.)
--
-- (b) O POLP JÁ LISTA A PARCELA FUTURA. As 21 parcelas em aberto vêm como
--     transações PENDING, com data até 18/03/2027. Não é preciso projetar nada
--     — é preciso não jogar fora. Por isso a parcela futura é linha de
--     `fin_card_transaction` com status PENDING, e não uma tabela de previsão
--     separada que discordaria da fonte no mês seguinte.
--
-- (c) A DATA DA PARCELA FUTURA NÃO SERVE PARA AGENDAR. Seis das 21 vêm
--     carimbadas com 02/08/2026, a data de abertura do ciclo, e não com o mês
--     em que serão cobradas. O agendamento confiável é:
--
--         mês da fatura = mês(purchaseDate) + installmentNumber
--
--     Conferido contra as 135 parcelas já faturadas, onde o mês real é
--     conhecido: 135/135. É essa regra que preenche `competence_month`.
--
-- A identidade da compra é (descrição normalizada, purchaseDate, total de
-- parcelas) — deliberadamente SEM o final do cartão, porque ele muda no meio
-- (§2d). A normalização precisa colapsar espaço repetido e caixa: a mesma
-- compra aparece como "HUBLA *MEGABLACKEL" e "HUBLA  *MEGABLACKEL" (dois
-- espaços), e tratá-las como compras diferentes partiria um plano de 12 em dois
-- de 7 e 5 — foi exatamente o que aconteceu na primeira medição.
CREATE TABLE fin_card_installment_plan (
  id                    bigserial PRIMARY KEY,
  card_account_id       bigint NOT NULL REFERENCES fin_card_account(id) ON DELETE CASCADE,

  -- Chave natural da compra. `purchase_key` é o hash estável que o sync usa
  -- para reencontrar o plano sem depender do id de nenhuma parcela.
  purchase_key          text NOT NULL,
  merchant_label        text NOT NULL,
  description_norm      text NOT NULL,
  purchase_date         date NOT NULL,

  installments_total    integer NOT NULL CHECK (installments_total > 1),
  installment_amount_cents bigint NOT NULL CHECK (installment_amount_cents > 0),

  -- Reconstruído (parcela × total). Aproximação declarada: a fonte não devolve
  -- o valor original da compra em nenhum campo.
  total_amount_cents    bigint NOT NULL,
  total_is_estimated    boolean NOT NULL DEFAULT true,

  installments_billed   integer NOT NULL DEFAULT 0,
  installments_open     integer NOT NULL DEFAULT 0,
  open_amount_cents     bigint  NOT NULL DEFAULT 0,

  first_competence_month date,
  last_competence_month  date,

  category_id           bigint REFERENCES fin_category(id),
  nucleo                text   REFERENCES fin_nucleo(slug),
  cost_center_id        bigint REFERENCES fin_cost_center(id),
  counterparty_id       bigint REFERENCES fin_counterparty(id),

  status                text NOT NULL DEFAULT 'ativo'
                        CHECK (status IN ('ativo', 'quitado', 'cancelado')),

  notes                 text,
  synced_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (card_account_id, purchase_key),

  CONSTRAINT fin_card_plan_contagem_coerente
    CHECK (installments_billed + installments_open <= installments_total)
);

CREATE INDEX fin_card_plan_aberto_idx ON fin_card_installment_plan (card_account_id, status)
  WHERE status = 'ativo';

ALTER TABLE fin_card_transaction
  ADD CONSTRAINT fin_card_transaction_plan_fk
  FOREIGN KEY (installment_plan_id) REFERENCES fin_card_installment_plan(id) ON DELETE SET NULL;

COMMENT ON COLUMN fin_card_installment_plan.total_is_estimated IS
  'true porque credit_card_metadata.totalAmount vem null em 795/795. O total é parcela × número de parcelas, e a primeira parcela costuma diferir em centavos.';
COMMENT ON COLUMN fin_card_installment_plan.purchase_key IS
  'Identidade da compra: descrição normalizada (espaço colapsado, minúscula, sufixo N/M removido) + data da compra + total de parcelas. NÃO inclui o final do cartão: ele muda no meio do plano em 16 dos 25 casos medidos.';

-- ---------------------------------------------------------------------------
-- 11. A CONSULTA QUE O FERNANDO PEDIU
-- ---------------------------------------------------------------------------
-- "Quanto tenho a pagar nos próximos meses, sobre o que, e quantas parcelas
-- faltam." Uma linha por mês e por compromisso, já separando o que é parcela de
-- compra antiga do que é compra nova ainda não faturada — porque as duas coisas
-- chegam na mesma fatura mas têm naturezas diferentes: a parcela é dívida já
-- contratada e inevitável; a compra do ciclo aberto ainda é do mês corrente.
CREATE VIEW fin_card_compromisso_mensal_v AS
SELECT
  ca.entity_id,
  ca.id                                        AS card_account_id,
  ca.slug                                      AS card_account_slug,
  t.competence_month,
  CASE WHEN t.installment_plan_id IS NOT NULL THEN 'parcela' ELSE 'compra_do_ciclo' END AS tipo,
  t.installment_plan_id,
  COALESCE(p.merchant_label, t.description)    AS sobre_o_que,
  t.installment_number,
  t.installments_total,
  -- Quantas ainda faltam DEPOIS desta, para que a linha responda sozinha.
  CASE WHEN t.installments_total IS NOT NULL
       THEN t.installments_total - t.installment_number END AS parcelas_restantes,
  t.purchase_date,
  t.card_last4,
  t.amount_cents,
  t.category_id,
  t.nucleo,
  t.cost_center_id
FROM fin_card_transaction t
JOIN fin_card_account ca ON ca.id = t.card_account_id
LEFT JOIN fin_card_installment_plan p ON p.id = t.installment_plan_id
WHERE t.status = 'PENDING'
  -- A fonte devolve o pagamento da fatura DUAS vezes: uma dentro da fatura
  -- (POSTED) e outra solta como PENDING sem bill_id. Medido em 04/08/2026,
  -- R$ 10.107,31 nos dois. Sem este filtro o compromisso do mês nasceria
  -- dez mil reais negativo.
  AND t.kind <> 'pagamento_fatura';

COMMENT ON VIEW fin_card_compromisso_mensal_v IS
  'Compromisso de cartão por mês futuro: uma linha por parcela em aberto ou compra ainda não faturada. Some amount_cents por competence_month para o total do mês.';

-- ---------------------------------------------------------------------------
-- 12. A TRAVA QUE IMPEDE O ERRO DE VOLTAR
-- ---------------------------------------------------------------------------
-- `fin_account.kind` aceita 'cartao' desde a 0001 e nunca foi usado. Depois de
-- §1, deixá-lo aberto é deixar uma armadilha carregada: a próxima pessoa que
-- quiser "só cadastrar o cartão" vai encontrar o valor no CHECK, concluir que é
-- o caminho previsto, e inflar o caixa em R$ 8.740,74 sem que nada reclame.
--
-- Fechar o valor transforma a decisão em erro de banco, na hora, com mensagem.
-- Só age se ninguém tiver criado uma conta assim antes — se alguém tiver, esta
-- migration avisa e segue, porque derrubar o boot de todo mundo por causa de
-- uma linha de dado é pior que o problema que ela evita.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM fin_account WHERE kind = 'cartao';
  IF n > 0 THEN
    RAISE NOTICE '0047: % conta(s) com kind=cartao já existem; CHECK mantido aberto. Migre-as para fin_card_account e feche o valor à mão.', n;
  ELSE
    ALTER TABLE fin_account DROP CONSTRAINT fin_account_kind_check;
    ALTER TABLE fin_account ADD CONSTRAINT fin_account_kind_check
      CHECK (kind IN ('gateway', 'conta_corrente', 'aplicacao', 'emprestimo', 'caixa_fisico'));
  END IF;
END $$;

COMMENT ON CONSTRAINT fin_account_kind_check ON fin_account IS
  '0047 removeu ''cartao'': cartão de crédito é dívida, não caixa, e vive em fin_card_account. Ver §1 da 0047 para as 5 somas de caixa que uma conta de cartão corromperia.';

-- ---------------------------------------------------------------------------
-- 13. GATILHOS DE updated_at, iguais aos do resto do schema
-- ---------------------------------------------------------------------------
CREATE TRIGGER fin_card_account_touch      BEFORE UPDATE ON fin_card_account
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_card_bill_touch         BEFORE UPDATE ON fin_card_bill
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_card_transaction_touch  BEFORE UPDATE ON fin_card_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();
CREATE TRIGGER fin_card_plan_touch         BEFORE UPDATE ON fin_card_installment_plan
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Trava humana no detalhamento, igual à de fin_transaction: classificação feita
-- por gente não é reescrita por sync.
CREATE TRIGGER fin_card_transaction_human_locks BEFORE UPDATE ON fin_card_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_preserve_human_locks();

-- ---------------------------------------------------------------------------
-- 14. A LINHA DE CRÉDITO QUE EXISTE HOJE
-- ---------------------------------------------------------------------------
-- Só a conta. Faturas, itens e planos entram por scripts/sync-polp-cartao.mjs,
-- que lê a API e é idempotente — semear dado medido dentro de migration o
-- congelaria no dia em que foi escrita.
--
-- Os saldos ficam ZERADOS de propósito. Preenchê-los aqui com os números de
-- 15/08/2026 faria a tabela nascer mentindo em qualquer dia que não seja hoje;
-- `balance_synced_at` nulo diz "ninguém sincronizou ainda", que é a verdade.
INSERT INTO fin_card_account (
  entity_id, slug, name, institution, brand, external_id, due_day, settlement_account_id
)
SELECT e.id, 'nubank-cartao', 'Cartão de crédito Nubank', 'Nu Pagamentos S.A.', 'MASTERCARD',
       '2589', 9,
       (SELECT a.id FROM fin_account a WHERE a.entity_id = e.id AND a.slug = 'nubank')
  FROM fin_entity e
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;
