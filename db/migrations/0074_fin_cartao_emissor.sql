-- Cartão por EMISSOR → linha de crédito → subcartão. E o Inter entra sem itens.
--
-- A 0047 modelou o cartão do Nubank e acertou a parte difícil: cartão não é
-- `fin_account`, fatura não é caixa, item não soma com lançamento. O que ela
-- deixou em aberto é a camada de cima — ela nasceu com UMA linha de crédito e
-- guardou o emissor como texto livre em `fin_card_account.institution`. Com um
-- emissor só isso não incomoda. Com dois passa a incomodar na primeira pergunta
-- de negócio ("quanto a empresa deve em cartão, por banco?"), porque a resposta
-- vira agrupamento por string.
--
-- ---------------------------------------------------------------------------
-- 1. O QUE FOI MEDIDO EM 16/08/2026
-- ---------------------------------------------------------------------------
-- (a) A API do Inter NÃO expõe cartão. Não é suposição: foi testado.
--
--     · /oauth/v2/token com `extrato.read`      → HTTP 200, scope=extrato.read
--     · /oauth/v2/token com `cartao.read`,
--       `cartoes.read`, `cartao-corporativo.read`,
--       `cartao-credito.read`, `fatura.read`    → HTTP 401
--       "No registered scope value for this client has been requested"
--     · com o MESMO token válido:
--         /banking/v2/extrato                    → HTTP 200 (rota existe)
--         /banking/v2/cartoes                    → HTTP 404 "page not found"
--         /banking/v2/cartao                     → HTTP 404
--         /banking/v2/cartao/faturas             → HTTP 404
--         /banking/v2/cartoes/faturas            → HTTP 404
--         /banking/v2/cartao-credito/faturas     → HTTP 404
--         /banking/v2/cartao/lancamentos         → HTTP 404
--         /banking/v2/cartao/transacoes          → HTTP 404
--         /banking/v1/cartoes                    → HTTP 404
--         /cartoes/v1/cartoes                    → HTTP 404
--         /cartao/v1/faturas                     → HTTP 404
--         /cartoes/v2/faturas                    → HTTP 404
--         /cartao-corporativo/v1/{cartoes,faturas} → HTTP 404
--         /banking/v2/faturas                    → HTTP 404
--         /banking/v2/limites                    → HTTP 404
--
--     O 401 e o 404 separam duas coisas diferentes, e é isso que dá valor ao
--     teste: rota que existe e recusa credencial devolve 401; rota que não
--     existe devolve 404 ANTES de olhar o token. As rotas de cartão devolvem
--     404 com token bom. Elas não existem — não é falta de escopo.
--
--     (De quebra: `/banking/v3/extrato/completo` também dá 404. A rota real é
--      a v2, que é a que `scripts/lib/inter.mjs` usa. O docs/AGENTE_FINANCEIRO.md
--      cita v3 e está errado nesse ponto.)
--
--     O portal do Inter Empresas confirma pelo outro lado: os produtos
--     documentados são Extrato, Saldos, Pagamentos, Pix e Cobrança. Cartão não
--     está na lista.
--
-- (b) O CARTÃO DO INTER EXISTE ASSIM MESMO, e o extrato prova. Nove saídas da
--     conta corrente do Inter, R$ 40.862,41 entre 04/01 e 04/08/2026:
--
--        2026-01-04   4.191,06   "Fatura cartão Inter"
--        2026-02-06   5.330,88   "Pagamento Fatura - FERNANDO ..."
--        2026-03-04   4.763,97   idem
--        2026-04-07   5.051,58   idem
--        2026-05-11   9.413,80   idem
--        2026-06-05     248,69   idem
--        2026-07-02   5.590,05   idem
--        2026-07-06      53,05   idem
--        2026-08-04   6.219,33   idem
--
--     Uma linha de crédito que é paga todo mês existe. O que não existe é o
--     detalhamento dela — e é exatamente isso que esta migration grava como
--     lacuna, em vez de fabricar despesa para fechar a conta.
--
-- (c) NÃO HÁ TERCEIRO EMISSOR. Varredura em todas as 6 contas, 13.880
--     lançamentos, atrás de descrição de pagamento de fatura:
--
--        nubank   8 lançamentos   R$ 66.738,34   (já modelado pela 0047)
--        inter    9 lançamentos   R$ 40.862,41   (esta migration)
--        asaas    2 lançamentos   R$  6.100,00   cartão PRÉ-PAGO, ver §8
--
--     Nada de Itaú, Bradesco, Santander, Amex, C6, Mercado Pago ou qualquer
--     outro. Os nomes de banco que aparecem no ledger são o banco do FAVORECIDO
--     dentro da descrição de Pix ("... - BCO BRADESCO S.A."), não emissor de
--     cartão nosso.
--
--     Confirmado também pelo lado da fonte: a integração do Polp tem UMA
--     conexão (Nubank Empresas, id 2906) com DUAS contas — 2588 CHECKING e
--     2589 CREDIT. Não existe outra instituição conectada.
--
-- (d) O LIMITE CONTINUA SENDO UM SÓ. Reconferido hoje em `credit_data`:
--     `disaggregatedCreditLimits[]` repete limitAmount 17.900, usedAmount
--     8.740,74 e availableAmount 9.159,26 para TODOS os finais. Não há limite
--     por subcartão na fonte, e esta migration não cria coluna para inventá-lo.
--     `limit_is_consolidated` existe justamente para dizer isso em voz alta.
--
-- (e) TITULAR: a fonte não tem. `owner`, `tax_number`, `holderType` e
--     `credit_data.level` vêm todos null na conta 2589, e o `name` da conta é a
--     string "company". Os 11 finais seguem sem dono, e seguem declarados como
--     sem dono. Inventar titular de cartão é pior que não ter.
--
-- ---------------------------------------------------------------------------
-- 2. O EMISSOR VIRA TABELA
-- ---------------------------------------------------------------------------
-- Poderia ser só um `institution` normalizado. Não é, por três motivos que já
-- aparecem com dois emissores:
--
--   · a linha de crédito herda comportamento do emissor (dia de vencimento,
--     conta de liquidação, se a fonte itemiza), e isso quer um lugar;
--   · o mesmo emissor pode ter mais de uma linha (cartão PJ e cartão pré-pago
--     no Asaas são o mesmo emissor e naturezas diferentes);
--   · "quanto devemos por banco" é pergunta de tesouraria, e agrupar por texto
--     livre é como o mesmo banco vira duas linhas no relatório.
CREATE TABLE fin_card_issuer (
  id           bigserial PRIMARY KEY,
  entity_id    bigint NOT NULL REFERENCES fin_entity(id),
  slug         text   NOT NULL,
  name         text   NOT NULL,
  legal_name   text,

  -- CNPJ do emissor. Fica NULO de propósito: nenhuma das fontes que temos
  -- (Polp, extrato do Inter, Asaas) devolve o documento do emissor em nenhum
  -- campo, e o número existir "de conhecimento geral" não é lastro. O detector
  -- preenche quando um pagamento vier carimbado com o CNPJ.
  document     text CHECK (document IS NULL OR document ~ '^[0-9]{14}$'),

  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, slug)
);

COMMENT ON TABLE fin_card_issuer IS
  'Instituição emissora. Um emissor tem N linhas de crédito; uma linha tem N subcartões. Ver §2 da 0074.';
COMMENT ON COLUMN fin_card_issuer.document IS
  'Nulo enquanto nenhuma fonte devolver o CNPJ do emissor. Não preencher de memória.';

-- ---------------------------------------------------------------------------
-- 3. A LINHA DE CRÉDITO GANHA EMISSOR, NATUREZA E NÍVEL DE DETALHE
-- ---------------------------------------------------------------------------
ALTER TABLE fin_card_account
  ADD COLUMN issuer_id bigint REFERENCES fin_card_issuer(id),

  -- Nem todo cartão é crédito. O do Asaas era pré-pago: o saldo dele era
  -- dinheiro NOSSO já debitado da conta, não dívida. Tratar os dois com o mesmo
  -- sinal inverteria R$ 6.100 no balanço.
  ADD COLUMN nature text NOT NULL DEFAULT 'credito'
      CHECK (nature IN ('credito', 'pre_pago')),

  -- Quanto a fonte explica. É o campo que impede a tela de mentir por omissão.
  --   itens             a fonte lista compras (Nubank/Polp — e ainda assim só 84,6%)
  --   somente_fatura    sabemos o total da fatura, não as compras
  --   somente_pagamento só sabemos o que saiu da conta corrente (Inter)
  ADD COLUMN itemization_level text NOT NULL DEFAULT 'itens'
      CHECK (itemization_level IN ('itens', 'somente_fatura', 'somente_pagamento')),
  ADD COLUMN itemization_note text,

  -- De onde o dado vem. 'api_polp', 'extrato_conta_corrente', 'manual'.
  ADD COLUMN data_source text NOT NULL DEFAULT 'api_polp',

  -- De quem é a linha. 'pj' = da empresa; 'pf_socio' = de pessoa física e paga
  -- pela empresa (o que muda a classificação de 9.01 para 9.05 e muda o
  -- resultado); 'indeterminado' = não há evidência que separe.
  ADD COLUMN ownership text NOT NULL DEFAULT 'indeterminado'
      CHECK (ownership IN ('pj', 'pf_socio', 'indeterminado')),
  ADD COLUMN holder_person_id bigint REFERENCES fin_person(id),
  ADD COLUMN holder_name_raw  text,

  ADD COLUMN product_name text,
  ADD COLUMN first_seen_on date,
  ADD COLUMN last_seen_on  date,

  -- Diz explicitamente que credit_limit_cents é da LINHA e não do plástico.
  -- Ver §1(d): a fonte repete o mesmo limite para os 9 finais.
  ADD COLUMN limit_is_consolidated boolean NOT NULL DEFAULT true;

-- Cartão pré-pago não tem limite de crédito nem dívida. Sem esta trava, um sync
-- distraído gravaria "limite 0, usado 6.100" e o painel passaria a mostrar
-- R$ 6.100 de dívida que nunca existiu.
ALTER TABLE fin_card_account
  ADD CONSTRAINT fin_card_account_prepago_sem_divida
  CHECK (nature <> 'pre_pago' OR (credit_limit_cents = 0 AND used_limit_cents = 0));

CREATE INDEX fin_card_account_issuer_idx ON fin_card_account (issuer_id);

COMMENT ON COLUMN fin_card_account.itemization_level IS
  'somente_pagamento = a fonte não entrega fatura nem compra; o único fato é a saída na conta corrente. É o caso do Inter (§1a). A lacuna vira unitemized_amount_cents, nunca diferença fechada.';
COMMENT ON COLUMN fin_card_account.ownership IS
  'indeterminado enquanto não houver evidência de que a linha é da empresa ou de pessoa física. A escolha muda a categoria do pagamento (9.01 transferência × 9.05 retirada de sócio) e portanto muda o resultado — é decisão humana.';
COMMENT ON COLUMN fin_card_account.limit_is_consolidated IS
  'true: o limite é da linha inteira. A fonte repete o mesmo limite para todos os finais em disaggregatedCreditLimits[], então não existe limite por subcartão para gravar.';

-- ---------------------------------------------------------------------------
-- 4. O SUBCARTÃO GANHA TIPO, ID ESTÁVEL E O ELO DE REEMISSÃO
-- ---------------------------------------------------------------------------
ALTER TABLE fin_card
  -- físico / virtual / adicional. Fica 'desconhecido' porque a fonte não diz:
  -- o Polp devolve os finais dentro de disaggregatedCreditLimits[] e não há
  -- campo de tipo em lugar nenhum do payload. Deduzir "virtual" de um final que
  -- durou pouco seria inventar.
  ADD COLUMN kind text NOT NULL DEFAULT 'desconhecido'
      CHECK (kind IN ('fisico', 'virtual', 'adicional', 'digital', 'desconhecido')),

  -- Id estável da fonte, quando ela der um. O Polp identifica o cartão pelo
  -- próprio final (`identificationNumber`), que é justamente o que NÃO é
  -- estável — por isso a coluna existe separada e fica nula até aparecer coisa
  -- melhor.
  ADD COLUMN external_id     text,
  ADD COLUMN external_source text,

  ADD COLUMN holder_name_raw text,
  ADD COLUMN valid_thru      date,

  -- Reemissão. Declarativo, e NUNCA inferido — ver §13.
  ADD COLUMN replaces_card_id    bigint REFERENCES fin_card(id) ON DELETE SET NULL,
  ADD COLUMN replaced_by_card_id bigint REFERENCES fin_card(id) ON DELETE SET NULL,
  ADD COLUMN reissue_source text CHECK (reissue_source IN ('humano', 'fonte')),

  ADD COLUMN notes      text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX fin_card_external_idx ON fin_card (external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Um cartão não substitui a si mesmo. Erro de digitação vira ciclo, e ciclo
-- trava qualquer leitura da cadeia.
ALTER TABLE fin_card
  ADD CONSTRAINT fin_card_reemissao_nao_reflexiva
  CHECK (replaces_card_id IS DISTINCT FROM id AND replaced_by_card_id IS DISTINCT FROM id);
-- Elo declarado sem dizer quem declarou não serve para auditar depois.
ALTER TABLE fin_card
  ADD CONSTRAINT fin_card_reemissao_tem_origem
  CHECK ((replaces_card_id IS NULL AND replaced_by_card_id IS NULL) OR reissue_source IS NOT NULL);

CREATE TRIGGER fin_card_touch BEFORE UPDATE ON fin_card
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

COMMENT ON COLUMN fin_card.kind IS
  'desconhecido é o valor honesto: o Polp não devolve tipo de cartão em campo nenhum. Preencher exige alguém dizer.';
COMMENT ON COLUMN fin_card.replaced_by_card_id IS
  'Elo de reemissão DECLARADO. O dado não permite inferir: 16 dos 25 parcelamentos atravessam mais de um final, mas o final volta atrás (parcela 1 no 3148, 2-9 no 7626, 10 no 3148 de novo), o que não é uma cadeia. Ver fin_card_reemissao_v para a evidência crua.';

-- ---------------------------------------------------------------------------
-- 5. A FATURA PRECISA DIZER DE ONDE ELA VEIO
-- ---------------------------------------------------------------------------
-- Uma fatura do Nubank é um objeto que a fonte devolveu: valor, vencimento,
-- mínimo, pagamento. Uma "fatura" do Inter é outra coisa — é a sombra de um
-- pagamento observado na conta corrente. As duas caem na mesma tabela e NÃO
-- podem valer o mesmo em nenhuma soma que diga "a empresa deve X".
ALTER TABLE fin_card_bill
  ADD COLUMN bill_source text NOT NULL DEFAULT 'fonte'
      CHECK (bill_source IN ('fonte', 'derivada_do_pagamento')),
  -- Motivo textual quando a conciliação com o caixa não fecha, para que a fila
  -- humana mostre "por quê" e não só "faltou".
  ADD COLUMN unreconciled_reason text;

-- Fatura derivada só pode existir se houver o lançamento que a originou. Sem
-- ele ela não tem lastro nenhum — seria um número escrito à mão.
ALTER TABLE fin_card_bill
  ADD CONSTRAINT fin_card_bill_derivada_tem_lastro
  CHECK (bill_source <> 'derivada_do_pagamento' OR paid_transaction_id IS NOT NULL);

-- Fatura derivada nunca tem item: se um dia tiver, é porque alguém confundiu o
-- pagamento com a compra, e essa confusão é a dupla contagem da 0047 §1.
ALTER TABLE fin_card_bill
  ADD CONSTRAINT fin_card_bill_derivada_sem_itens
  CHECK (bill_source <> 'derivada_do_pagamento' OR itemized_amount_cents = 0);

COMMENT ON COLUMN fin_card_bill.bill_source IS
  'derivada_do_pagamento = a fatura em si NUNCA foi vista. Existe porque uma saída rotulada como pagamento de fatura apareceu na conta corrente. total_amount_cents é igual ao pago por construção, e o valor real da fatura permanece desconhecido.';

-- A 0047 criou UNIQUE (card_account_id, due_date), e para fatura de verdade
-- está certo: uma linha de crédito vence uma vez por data. Para fatura derivada
-- a regra deixa de valer, porque ali `due_date` não é vencimento — é a data em
-- que alguém pagou, e nada impede dois pagamentos no mesmo dia. Hoje os dois de
-- julho/2026 caem em 02 e 06 e escapam por acaso; no dia em que caírem juntos, a
-- ingestão quebraria com violação de unicidade e o cartão pararia de sincronizar
-- por causa de uma regra que não era sobre ele.
--
-- A unicidade vira parcial: continua valendo integralmente para bill_source =
-- 'fonte', e some para as derivadas — que já são únicas por
-- (external_source, external_id), onde external_id é o id do lançamento.
ALTER TABLE fin_card_bill DROP CONSTRAINT fin_card_bill_card_account_id_due_date_key;
CREATE UNIQUE INDEX fin_card_bill_venc_unico_idx
  ON fin_card_bill (card_account_id, due_date)
  WHERE bill_source = 'fonte';

COMMENT ON INDEX fin_card_bill_venc_unico_idx IS
  'Uma fatura por vencimento — só para fatura vinda da fonte. Fatura derivada de pagamento usa a data do pagamento em due_date, e dois pagamentos no mesmo dia são possíveis.';

-- ---------------------------------------------------------------------------
-- 6. OS EMISSORES QUE EXISTEM
-- ---------------------------------------------------------------------------
INSERT INTO fin_card_issuer (entity_id, slug, name, legal_name, is_active, notes)
SELECT e.id, v.slug, v.name, v.legal_name, v.ativo, v.notes
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('nubank', 'Nubank', 'Nu Pagamentos S.A. - Instituição de Pagamento', true,
     'Fonte: Polp/open finance, integração 2906 "Nubank Empresas". Itemiza compras.'),
    ('inter',  'Banco Inter', NULL, true,
     'A API do Inter não expõe cartão (§1a da 0074). O que se sabe da linha vem do extrato da conta corrente.'),
    ('asaas',  'Asaas', NULL, false,
     'Cartão pré-pago XPE ASAAS final 3797, recarregado 2022-2024 e encerrado. GET /asaasCards devolve totalCount 0 em 16/08/2026.')
  ) AS v(slug, name, legal_name, ativo, notes)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- A linha do Nubank já existe desde a 0047: ganha o emissor e o que se sabe
-- dela. `ownership = 'pj'` tem lastro: a conta CREDIT do Polp vem com
-- `name: "company"`.
UPDATE fin_card_account ca
   SET issuer_id         = i.id,
       nature            = 'credito',
       itemization_level = 'itens',
       itemization_note  = 'A fonte itemiza 84,6% do faturado. Os 15,4% restantes (R$ 13.744,87 em 12 faturas) ficam em unitemized_amount_cents. Ver §3 da 0047.',
       data_source       = 'api_polp',
       ownership         = 'pj',
       product_name      = 'company',
       limit_is_consolidated = true
  FROM fin_card_issuer i
 WHERE i.entity_id = ca.entity_id
   AND i.slug = 'nubank'
   AND ca.slug = 'nubank-cartao';

-- ---------------------------------------------------------------------------
-- 7. A LINHA DE CRÉDITO DO INTER
-- ---------------------------------------------------------------------------
-- Só a linha, sem faturas. As 9 faturas derivadas entram por
-- `scripts/sync-cartao-inter.mjs`, que lê o ledger e é idempotente — pelo mesmo
-- motivo da 0047 §14: semear dado medido dentro de migration congela o número
-- no dia em que ela foi escrita.
--
-- Três campos nascem declaradamente vazios, e cada um por um motivo diferente:
--
--   credit_limit_cents = 0  não há fonte. O Inter não expõe o limite por API e
--                           o extrato não o revela. Zero aqui significa "não
--                           sei", e é por isso que `balance_synced_at` fica
--                           nulo — nada foi sincronizado, e a tela deve dizer
--                           isso em vez de mostrar um limite inventado.
--   due_day = NULL          os pagamentos caem entre o dia 2 e o 11. Isso é a
--                           data em que ALGUÉM PAGOU, não o vencimento. Derivar
--                           vencimento de data de pagamento é confundir as duas
--                           colunas que a 0047 §4 separou de propósito.
--   holder_person_id = NULL o descritor traz "FERNANDO DE SIQUEIRA CAMPOS
--                           SILVA", e há uma fin_person 'Fernando' (id 4). O
--                           nome bate, mas nome batendo não prova titularidade
--                           — e aqui a consequência é grande: ver §14(d).
INSERT INTO fin_card_account (
  entity_id, issuer_id, slug, name, institution, brand,
  external_id, external_source, data_source,
  nature, itemization_level, itemization_note,
  ownership, holder_name_raw,
  settlement_account_id, limit_is_consolidated, is_active
)
SELECT e.id, i.id, 'inter-cartao', 'Cartão de crédito Inter', 'Banco Inter S.A.', NULL,
       NULL, 'ledger', 'extrato_conta_corrente',
       'credito', 'somente_pagamento',
       'A API do Inter não tem rota de cartão: todas as candidatas devolvem 404 com token válido, e nenhum escopo de cartão está registrado para a aplicação (§1a). Não há fatura, não há compra, não há final de cartão. O único fato é a saída na conta corrente.',
       'indeterminado', 'FERNANDO DE SIQUEIRA CAMPOS SILVA',
       (SELECT a.id FROM fin_account a WHERE a.entity_id = e.id AND a.slug = 'inter'),
       true, true
  FROM fin_entity e
  JOIN fin_card_issuer i ON i.entity_id = e.id AND i.slug = 'inter'
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. O CARTÃO PRÉ-PAGO DO ASAAS
-- ---------------------------------------------------------------------------
-- Ele entra porque a pergunta era "quais emissores existem", e a resposta
-- honesta inclui um que já não existe mais. Entra com `nature = 'pre_pago'` e
-- limite zero: o saldo dele nunca foi dívida.
--
-- O que sobra em aberto é pequeno e é real: R$ 6.100,00 recarregados
-- (17/01/2022 e 24/10/2024) contra R$ 5.573,21 estornados no encerramento
-- (24/10/2024). Os R$ 526,79 de diferença foram gastos no cartão, e as compras
-- não estão em fonte nenhuma — o `/financialTransactions` do Asaas devolve a
-- recarga e o estorno, nunca o extrato do plástico. Fica como lacuna declarada
-- e NÃO é fechado por diferença.
INSERT INTO fin_card_account (
  entity_id, issuer_id, slug, name, institution, brand,
  external_source, data_source,
  nature, itemization_level, itemization_note,
  ownership, product_name,
  credit_limit_cents, used_limit_cents, available_limit_cents,
  settlement_account_id, limit_is_consolidated, is_active
)
SELECT e.id, i.id, 'asaas-cartao-prepago', 'Cartão pré-pago XPE Asaas (final 3797)',
       'Asaas Gestão Financeira', NULL,
       'ledger', 'extrato_conta_corrente',
       'pre_pago', 'somente_pagamento',
       'Encerrado. R$ 6.100,00 recarregados e R$ 5.573,21 estornados; R$ 526,79 gastos sem itemização em nenhuma fonte. GET /asaasCards devolve totalCount 0.',
       'pj', 'Cartão Asaas pré-pago',
       0, 0, 0,
       (SELECT a.id FROM fin_account a WHERE a.entity_id = e.id AND a.slug = 'asaas'),
       false, false
  FROM fin_entity e
  JOIN fin_card_issuer i ON i.entity_id = e.id AND i.slug = 'asaas'
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- O plástico do Asaas é o único cujo final a fonte declara na própria descrição
-- ("Final 3797"), então ele é o único subcartão que nasce fora do Nubank.
INSERT INTO fin_card (card_account_id, last4, status, is_primary, kind, first_seen_on, last_seen_on, notes)
SELECT ca.id, '3797', 'cancelado', true, 'fisico', DATE '2022-01-17', DATE '2024-10-24',
       'Final lido da descrição do lançamento no Asaas. Encerrado com estorno de saldo em 24/10/2024.'
  FROM fin_card_account ca
  JOIN fin_entity e ON e.id = ca.entity_id AND e.slug = 'xpe'
 WHERE ca.slug = 'asaas-cartao-prepago'
ON CONFLICT (card_account_id, last4) DO NOTHING;

CREATE TRIGGER fin_card_issuer_touch BEFORE UPDATE ON fin_card_issuer
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. A HIERARQUIA, LEGÍVEL DE UMA VEZ
-- ---------------------------------------------------------------------------
-- emissor → linha → subcartão, com a linha aparecendo mesmo quando não tem
-- subcartão nenhum (é o caso do Inter, e escondê-lo seria esconder justamente o
-- que falta).
CREATE VIEW fin_card_hierarquia_v AS
SELECT
  i.entity_id,
  i.slug                       AS emissor_slug,
  i.name                       AS emissor,
  ca.id                        AS card_account_id,
  ca.slug                      AS linha_slug,
  ca.name                      AS linha,
  ca.nature                    AS natureza,
  ca.itemization_level         AS nivel_detalhe,
  ca.ownership                 AS titularidade,
  ca.is_active                 AS linha_ativa,
  ca.credit_limit_cents,
  ca.used_limit_cents,
  ca.limit_is_consolidated,
  acc.slug                     AS conta_liquidacao,
  c.id                         AS card_id,
  c.last4,
  c.kind                       AS tipo_cartao,
  c.status                     AS status_cartao,
  c.is_primary,
  c.holder_person_id,
  p.name                       AS titular,
  COALESCE(c.holder_name_raw, ca.holder_name_raw) AS titular_declarado_pela_fonte,
  c.first_seen_on,
  c.last_seen_on,
  c.replaces_card_id,
  c.replaced_by_card_id,
  c.default_nucleo,
  c.default_cost_center_id,
  (SELECT count(*)  FROM fin_card_transaction t WHERE t.card_id = c.id) AS itens,
  (SELECT COALESCE(sum(t.amount_cents), 0) FROM fin_card_transaction t
    WHERE t.card_id = c.id AND t.kind <> 'pagamento_fatura')            AS itens_cents
FROM fin_card_issuer  i
JOIN fin_card_account ca  ON ca.issuer_id = i.id
LEFT JOIN fin_account acc ON acc.id = ca.settlement_account_id
LEFT JOIN fin_card    c   ON c.card_account_id = ca.id
LEFT JOIN fin_person  p   ON p.id = c.holder_person_id;

COMMENT ON VIEW fin_card_hierarquia_v IS
  'Emissor → linha de crédito → subcartão. LEFT JOIN em fin_card de propósito: uma linha sem subcartão conhecido (Inter) tem de aparecer, porque a ausência é o achado.';

-- ---------------------------------------------------------------------------
-- 10. VALIDAÇÃO: FATURA DECLARADA × ITENS × DIFERENÇA NÃO EXPLICADA
-- ---------------------------------------------------------------------------
-- A regra que esta view protege é a da 0047 §3: `total_amount_cents` é a
-- autoridade e NUNCA é derivado da soma dos itens. Aqui as duas grandezas
-- aparecem lado a lado com a diferença explícita, para que ninguém precise
-- subtrair de cabeça e para que a diferença nunca seja "resolvida" com um
-- lançamento de ajuste.
CREATE VIEW fin_card_fatura_conciliacao_v AS
SELECT
  ca.entity_id,
  i.slug                          AS emissor_slug,
  ca.slug                         AS linha_slug,
  ca.itemization_level            AS nivel_detalhe,
  b.id                            AS bill_id,
  b.bill_source                   AS origem_fatura,
  b.reference_month,
  b.due_date,
  b.status,
  b.total_amount_cents            AS fatura_cents,
  b.itemized_amount_cents         AS itens_cents,
  b.unitemized_amount_cents       AS nao_explicado_cents,
  CASE WHEN b.total_amount_cents = 0 THEN NULL
       ELSE round(100.0 * b.itemized_amount_cents / b.total_amount_cents, 1) END AS pct_explicado,
  -- Conferência independente: soma os itens de verdade, em vez de confiar no
  -- acumulador que o sync gravou. Se os dois discordarem, o sync está errado.
  COALESCE((SELECT sum(t.amount_cents) FROM fin_card_transaction t
             WHERE t.bill_id = b.id AND t.kind <> 'pagamento_fatura'), 0) AS itens_recontados_cents,
  b.paid_amount_cents,
  b.paid_on,
  b.paid_transaction_id,
  tx.amount_cents                 AS saida_caixa_cents,
  tx.posted_on                    AS saida_caixa_em,
  acc.slug                        AS conta_saida,
  b.match_method,
  b.match_confidence,
  b.unreconciled_reason,
  -- O veredito, em uma palavra, para a fila humana ordenar por ele.
  -- 'fora_da_cobertura' existe para não misturar "o extrato ainda não chegou
  -- lá" com "pagou e sumiu": a primeira resolve carregando histórico, a segunda
  -- exige alguém olhar.
  CASE
    WHEN b.paid_amount_cents IS NULL                      THEN 'nao_paga'
    WHEN b.paid_transaction_id IS NULL
         AND b.paid_on < cob.desde                        THEN 'fora_da_cobertura'
    WHEN b.paid_transaction_id IS NULL                    THEN 'paga_sem_lancamento'
    WHEN tx.amount_cents <> -b.paid_amount_cents          THEN 'lancamento_diverge'
    WHEN acc.id IS DISTINCT FROM ca.settlement_account_id THEN 'conta_inesperada'
    ELSE 'conciliada'
  END AS veredito
FROM fin_card_bill    b
JOIN fin_card_account ca ON ca.id = b.card_account_id
LEFT JOIN fin_card_issuer i ON i.id = ca.issuer_id
LEFT JOIN fin_transaction tx ON tx.id = b.paid_transaction_id
LEFT JOIN fin_account acc ON acc.id = tx.account_id
LEFT JOIN LATERAL (
  SELECT min(t.posted_on) AS desde
    FROM fin_transaction t
   WHERE t.account_id = ca.settlement_account_id
) cob ON true;

COMMENT ON VIEW fin_card_fatura_conciliacao_v IS
  'Fatura declarada × itens que a explicam × diferença não explicada × saída de caixa. `itens_recontados_cents` existe para pegar o sync mentindo: se divergir de itens_cents, o acumulador está errado.';

-- ---------------------------------------------------------------------------
-- 11. VALIDAÇÃO: O DETECTOR DE EMISSOR NÃO MODELADO
-- ---------------------------------------------------------------------------
-- Toda saída de qualquer conta que se pareça com pagamento de fatura de cartão
-- e que NÃO esteja amarrada a uma fatura. Duas coisas caem aqui, e as duas
-- interessam: fatura nossa ainda não conciliada, e emissor que ninguém
-- cadastrou.
--
-- O filtro negativo não é decoração: sem ele, as ~2.900 linhas "Taxa de cartão
-- - fatura nr. NNN" do Asaas (que são tarifa de recebimento por cartão, receita
-- do gateway, nada a ver com cartão de crédito nosso) afogariam o sinal.
CREATE VIEW fin_card_pagamento_orfao_v AS
SELECT
  t.entity_id,
  t.id            AS transaction_id,
  a.slug          AS conta,
  t.posted_on,
  t.amount_cents,
  t.description_raw,
  t.category_id,
  cat.code        AS categoria,
  t.transfer_status,
  -- Palpite de emissor a partir do texto. É PALPITE e o nome da coluna diz
  -- isso; serve para ordenar a fila humana, nunca para cadastrar sozinho.
  CASE
    WHEN t.description_norm ~ 'nubank|nu pagamentos' THEN 'nubank'
    WHEN t.description_norm ~ 'inter'                THEN 'inter'
    WHEN t.description_norm ~ 'asaas'                THEN 'asaas'
    ELSE NULL
  END AS emissor_suspeito,
  -- Nota: sem filtro de `is_active`. Uma linha encerrada continua explicando os
  -- pagamentos que ela gerou enquanto existia — o cartão pré-pago do Asaas está
  -- inativo desde 2024 e as duas recargas dele não são emissor desconhecido.
  (l.card_account_id IS NOT NULL) AS conta_liquida_algum_cartao,
  l.slug AS linha_slug,
  -- O motivo de estar nesta fila, decidido aqui e não em cada consumidor, para
  -- que o script de validação e o detector nunca discordem sobre o mesmo fato.
  CASE
    WHEN l.card_account_id IS NULL                THEN 'emissor_nao_modelado'
    WHEN t.description_norm ~ '(recarga do cartao|saldo do cartao)'
                                                  THEN 'recarga_pre_pago'
    WHEN l.itemization_level = 'somente_pagamento' THEN 'linha_sem_sync'
    ELSE 'conciliacao_pendente'
  END AS situacao
FROM fin_transaction t
JOIN fin_account a ON a.id = t.account_id
LEFT JOIN fin_category cat ON cat.id = t.category_id
-- A linha de crédito que liquida nesta conta, se houver. Quando houver mais de
-- uma, a ativa ganha: é a que ainda gera pagamento.
LEFT JOIN LATERAL (
  SELECT ca.id AS card_account_id, ca.slug, ca.itemization_level
    FROM fin_card_account ca
   WHERE ca.settlement_account_id = t.account_id
   ORDER BY ca.is_active DESC, ca.id
   LIMIT 1
) l ON true
WHERE t.amount_cents < 0
  AND t.description_norm ~ '(pagamento de fatura|pagamento fatura|fatura cartao|fatura do cartao|pagamento de cartao|pagto fatura|recarga do cartao|saldo do cartao)'
  AND t.description_norm !~ '(taxa de (cartao|boleto|pix)|taxa do pix)'
  AND NOT EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id);

COMMENT ON VIEW fin_card_pagamento_orfao_v IS
  'Saída com cara de pagamento de fatura sem fatura amarrada. `situacao` separa o que é alarme (emissor_nao_modelado) do que é trabalho pendente (linha_sem_sync) e do que é normal e nunca terá fatura (recarga_pre_pago).';

-- ---------------------------------------------------------------------------
-- 12. VALIDAÇÃO: PARCELAS FUTURAS
-- ---------------------------------------------------------------------------
-- Agrega o que a fin_card_compromisso_mensal_v já separa por linha, e só do mês
-- corrente para frente — "o que ainda vai chegar".
CREATE VIEW fin_card_parcela_futura_v AS
SELECT
  ca.entity_id,
  i.slug                      AS emissor_slug,
  ca.slug                     AS linha_slug,
  v.competence_month          AS mes,
  count(*) FILTER (WHERE v.tipo = 'parcela')          AS parcelas,
  count(*) FILTER (WHERE v.tipo = 'compra_do_ciclo')  AS compras_do_ciclo,
  COALESCE(sum(v.amount_cents) FILTER (WHERE v.tipo = 'parcela'), 0)         AS parcelas_cents,
  COALESCE(sum(v.amount_cents) FILTER (WHERE v.tipo = 'compra_do_ciclo'), 0) AS ciclo_cents,
  sum(v.amount_cents)                                 AS total_cents,
  count(*) FILTER (WHERE v.category_id IS NULL)       AS sem_categoria,
  count(*) FILTER (WHERE v.cost_center_id IS NULL)    AS sem_centro_custo
FROM fin_card_compromisso_mensal_v v
JOIN fin_card_account ca ON ca.id = v.card_account_id
LEFT JOIN fin_card_issuer i ON i.id = ca.issuer_id
WHERE v.competence_month >= date_trunc('month', CURRENT_DATE)::date
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW fin_card_parcela_futura_v IS
  'Compromisso de cartão por mês, do mês corrente para frente. Só cobre linha com itemization_level = itens: linha somente_pagamento não tem parcela para listar, e isso é lacuna, não zero.';

-- ---------------------------------------------------------------------------
-- 13. A EVIDÊNCIA DE REEMISSÃO — SEM CONCLUIR NADA
-- ---------------------------------------------------------------------------
-- A pergunta "o final mudou no meio do parcelamento?" tem resposta medida: sim,
-- em 16 dos 25 planos. A pergunta seguinte — "então 3148 virou 7626?" — NÃO tem
-- resposta no dado, porque o final volta atrás (parcela 1 em 3148, 2 a 9 em
-- 7626, 10 em 3148 outra vez). Uma cadeia de reemissão não faz isso.
--
-- Então esta view mostra a evidência crua e para aí. E, de quebra, é o teste que
-- prova que o plano NÃO quebrou: se `finais_distintos > 1` e o plano continua
-- sendo UM (uma linha aqui, não várias), a chave de identidade da 0047 §10
-- está fazendo o trabalho dela.
CREATE VIEW fin_card_reemissao_v AS
SELECT
  ca.entity_id,
  ca.slug                                   AS linha_slug,
  p.id                                      AS plan_id,
  p.merchant_label,
  p.purchase_date,
  p.installments_total,
  count(t.id)                               AS parcelas_observadas,
  count(DISTINCT t.card_last4)              AS finais_distintos,
  string_agg(DISTINCT t.card_last4, ',' ORDER BY t.card_last4) AS finais,
  min(t.installment_number)                 AS primeira,
  max(t.installment_number)                 AS ultima,
  p.status
FROM fin_card_installment_plan p
JOIN fin_card_account ca ON ca.id = p.card_account_id
LEFT JOIN fin_card_transaction t ON t.installment_plan_id = p.id
GROUP BY 1, 2, 3, 4, 5, 6, p.status;

COMMENT ON VIEW fin_card_reemissao_v IS
  'Evidência de troca de final dentro de um mesmo parcelamento. Uma linha por PLANO: se um plano com finais_distintos > 1 aparece uma vez só, a reemissão não partiu a compra.';

-- ---------------------------------------------------------------------------
-- 14. A FILA DE LACUNAS — O QUE FALTA, DITO EM VOZ ALTA
-- ---------------------------------------------------------------------------
-- Isto não é relatório: é a tela de decisão. Cada linha é uma coisa que a base
-- NÃO sabe, com quanto dinheiro está pendurado nela e o que resolveria.
-- Fechar qualquer uma delas por estimativa é o erro que o §2 do
-- docs/AGENTE_FINANCEIRO.md proíbe.
CREATE VIEW fin_card_lacuna_v AS
-- (a) linha de crédito sem itemização nenhuma
SELECT
  ca.entity_id,
  'linha_sem_itemizacao'::text AS lacuna,
  ca.slug                      AS escopo,
  COALESCE((SELECT sum(b.total_amount_cents) FROM fin_card_bill b WHERE b.card_account_id = ca.id), 0) AS valor_cents,
  COALESCE((SELECT count(*) FROM fin_card_bill b WHERE b.card_account_id = ca.id), 0) AS itens,
  COALESCE(
    ca.itemization_note,
    'A fonte não entrega compras desta linha. Resolver exige extrato do cartão fora de API (PDF/CSV) ou acesso que hoje não existe.'
  ) AS motivo
FROM fin_card_account ca
WHERE ca.itemization_level = 'somente_pagamento'

UNION ALL
-- (b) fatura cujos itens não explicam o total
SELECT ca.entity_id, 'fatura_nao_explicada', ca.slug || ' ' || to_char(b.reference_month, 'YYYY-MM'),
       b.unitemized_amount_cents, 1,
       'A fonte declara ' || to_char(b.total_amount_cents / 100.0, 'FM999G999D00') ||
       ' e itemiza ' || to_char(b.itemized_amount_cents / 100.0, 'FM999G999D00') ||
       '. A diferença NÃO é fechada por ajuste — ver 0047 §3.'
FROM fin_card_bill b
JOIN fin_card_account ca ON ca.id = b.card_account_id
WHERE b.unitemized_amount_cents <> 0
  AND b.bill_source = 'fonte'

UNION ALL
-- (c) subcartão sem titular
SELECT ca.entity_id, 'cartao_sem_titular', ca.slug || ' final ' || c.last4,
       COALESCE((SELECT sum(abs(t.amount_cents)) FROM fin_card_transaction t
                  WHERE t.card_id = c.id AND t.kind <> 'pagamento_fatura'), 0),
       COALESCE((SELECT count(*) FROM fin_card_transaction t WHERE t.card_id = c.id), 0),
       'A fonte não devolve titular (owner, tax_number e holderType nulos). Exige alguém dizer de quem é o plástico.'
FROM fin_card c
JOIN fin_card_account ca ON ca.id = c.card_account_id
WHERE c.holder_person_id IS NULL

UNION ALL
-- (d) linha de crédito de titularidade indeterminada
SELECT ca.entity_id, 'linha_sem_titularidade', ca.slug,
       COALESCE((SELECT sum(b.total_amount_cents) FROM fin_card_bill b WHERE b.card_account_id = ca.id), 0),
       1,
       'Não há evidência de que a linha seja da empresa ou de pessoa física. A escolha muda a categoria do pagamento (9.01 × 9.05) e portanto muda o resultado.'
FROM fin_card_account ca
WHERE ca.ownership = 'indeterminado'

UNION ALL
-- (e) compra sem categoria
SELECT ca.entity_id, 'compra_sem_categoria', ca.slug,
       COALESCE(sum(abs(t.amount_cents)), 0), count(*),
       'Item de fatura sem categoria. Sem isto o cartão não entra na DRE por competência.'
FROM fin_card_transaction t
JOIN fin_card_account ca ON ca.id = t.card_account_id
WHERE t.category_id IS NULL AND t.kind <> 'pagamento_fatura'
GROUP BY ca.entity_id, ca.slug
HAVING count(*) > 0

UNION ALL
-- (f) compra sem centro de custo
SELECT ca.entity_id, 'compra_sem_centro_custo', ca.slug,
       COALESCE(sum(abs(t.amount_cents)), 0), count(*),
       'Item de fatura sem projeto/centro de custo. Sem isto o gasto não chega à margem por obra.'
FROM fin_card_transaction t
JOIN fin_card_account ca ON ca.id = t.card_account_id
WHERE t.cost_center_id IS NULL AND t.kind <> 'pagamento_fatura'
GROUP BY ca.entity_id, ca.slug
HAVING count(*) > 0

UNION ALL
-- (g) fatura paga sem lançamento de caixa amarrado
--
-- Duas causas MUITO diferentes caem aqui, e confundi-las faria a fila mentir.
-- Se a fatura foi paga ANTES do primeiro lançamento que a conta de liquidação
-- tem no ledger, não há o que conciliar: é buraco de cobertura do extrato, e
-- some sozinho quando o histórico for carregado. É o caso das 4 faturas de
-- 2025 (o extrato do Nubank começa em 02/01/2026). Se foi paga DENTRO do
-- período coberto e mesmo assim não achou par, aí sim alguém precisa olhar.
SELECT ca.entity_id,
       CASE WHEN b.paid_on < cob.desde THEN 'fatura_fora_da_cobertura'
            ELSE 'fatura_sem_lancamento' END,
       ca.slug || ' ' || to_char(b.reference_month, 'YYYY-MM'),
       b.paid_amount_cents, 1,
       COALESCE(
         b.unreconciled_reason,
         CASE WHEN b.paid_on < cob.desde
              THEN 'Paga em ' || to_char(b.paid_on, 'DD/MM/YYYY') ||
                   ', antes do início do extrato da conta de liquidação (' ||
                   to_char(cob.desde, 'DD/MM/YYYY') || '). Resolve carregando o histórico, não à mão.'
              ELSE 'Fatura marcada como paga sem saída correspondente na conta de liquidação, dentro de um período que o extrato cobre.'
         END)
FROM fin_card_bill b
JOIN fin_card_account ca ON ca.id = b.card_account_id
LEFT JOIN LATERAL (
  SELECT min(t.posted_on) AS desde
    FROM fin_transaction t
   WHERE t.account_id = ca.settlement_account_id
) cob ON true
WHERE b.paid_amount_cents IS NOT NULL AND b.paid_transaction_id IS NULL

UNION ALL
-- (h) mês com mais de um pagamento numa linha sem fatura: fronteira incerta
SELECT ca.entity_id, 'fronteira_de_fatura_incerta', ca.slug || ' ' || to_char(b.reference_month, 'YYYY-MM'),
       sum(b.paid_amount_cents), count(*),
       'Mais de um pagamento no mesmo mês numa linha sem fatura da fonte: não dá para saber se são duas faturas ou uma paga em duas parcelas.'
FROM fin_card_bill b
JOIN fin_card_account ca ON ca.id = b.card_account_id
WHERE b.bill_source = 'derivada_do_pagamento'
GROUP BY ca.entity_id, ca.slug, b.reference_month
HAVING count(*) > 1;

COMMENT ON VIEW fin_card_lacuna_v IS
  'Fila de indeterminados do cartão. Cada linha é um "não sei" declarado com valor e motivo. Esvaziar por estimativa é pior que deixar cheia.';
