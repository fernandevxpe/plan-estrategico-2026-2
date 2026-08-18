-- O cartao dentro da saida de caixa, e o caminho ate o item.
--
-- ===========================================================================
-- O PEDIDO
-- ===========================================================================
-- "na parte de despesas saidas do caixa, quero que mostre tbm os valores de
--  cartoes, historico de cartao e tbm permita ver o detalhe de cartoes por
--  banco ou conta e ate detalhamento de cartoes online, sub cartoes se for
--  possivel... quero maximo de detalhamento"
--
-- ===========================================================================
-- A REGRA QUE GOVERNA O ARQUIVO INTEIRO, E QUE ELE EXISTE PARA PROTEGER
-- ===========================================================================
-- FATURA E ITEM SAO O MESMO DINHEIRO VISTO DE DOIS LUGARES. NAO SE SOMAM.
--
--   a FATURA e o que saiu do caixa .......... fin_transaction, uma linha por mes
--   os ITENS sao a composicao dela .......... fin_card_transaction, 795 linhas
--
-- Somar os dois conta a mesma despesa duas vezes. O banco ja recusa a versao
-- mais grosseira desse erro por tres caminhos independentes:
--
--   1. `fin_account.kind` tem CHECK que NAO aceita 'cartao' — cartao nao e
--      conta, entao nao tem saldo nem extrato proprio;
--   2. item de cartao nunca vira `fin_transaction`: as duas tabelas nao tem
--      ponteiro uma para a outra, e o UNICO ponto de contato do subledger com
--      o ledger e `fin_card_bill.paid_transaction_id`;
--   3. o gatilho `fin_transaction_fatura_sem_itemizacao` recusa que um
--      pagamento de fatura sem itemizacao vire 9.01 sem `fin_card_bill`
--      ligada — a despesa sairia da DRE sem reaparecer no subledger.
--
-- O que faltava era a QUARTA defesa: uma tela que mostre os dois lados ao
-- mesmo tempo. Enquanto o unico jeito de ver o gasto de cartao for somar
-- numeros a mao, alguem vai somar os errados. Estas views entregam os dois
-- lados em colunas separadas, com o motivo escrito na propria linha.
--
-- ===========================================================================
-- O DEFEITO MEDIDO QUE ESTA MIGRATION CORRIGE
-- ===========================================================================
-- `lib/financeiro/contratos/cartao.ts` media o caixa do cartao assim:
--
--     WHERE c.code = '9.01' AND t.amount_cents < 0
--
-- Os 9 pagamentos de fatura do Inter — R$ 40.862,41 — tem `category_id` NULO,
-- justamente porque o gatilho da 0094 os barrou ate existir `fin_card_bill`
-- ligada (hoje existe; a decisao de carimbar 9.01 continua humana). Medir o
-- caixa do cartao por categoria, portanto, esconde 38% do que sai. A ancora
-- certa e o PONTEIRO, nao o rotulo: `fin_card_bill.paid_transaction_id`.
-- `fin_card_saida_caixa_v`, abaixo, usa o ponteiro.
--
-- ===========================================================================
-- POR QUE A ARVORE E emissor -> linha -> FATURA -> subcartao -> item
-- ===========================================================================
-- O pedido dizia "por banco ou conta e ate ... sub cartoes". A ordem natural
-- pareceria emissor -> linha -> subcartao -> fatura -> item. O dado nao aceita:
-- **fatura pertence a linha de credito, nao ao subcartao**. As 12 faturas do
-- Nubank misturam de 5 a 8 finais diferentes cada uma. Pendurar a fatura
-- debaixo do subcartao obrigaria a uma de duas mentiras — repetir a fatura
-- inteira sob cada final (e multiplicar o total por 7), ou inventar uma
-- "fatura do final 7626" que nenhum emissor jamais mandou.
--
-- Entao a arvore desce pela fatura e, DENTRO dela, abre por subcartao. O
-- subcartao continua sendo um nivel navegavel — e a serie mensal
-- (`fin_card_serie_mensal_v`) da a ele o eixo do tempo, que e onde a pergunta
-- "quanto este plastico gasta" de fato mora.
--
-- ===========================================================================
-- A PARTE NAO ITEMIZADA E UM NO, NUNCA UMA DIFERENCA DILUIDA
-- ===========================================================================
-- R$ 54.607,28 de R$ 130.108,74 (42,0%) das faturas nao e explicado por item
-- nenhum. Isso NAO e erro de conta: e a fonte que nao itemiza (o Inter nao tem
-- rota de cartao na API; o Polp nao devolve parte das compras do Nubank).
--
-- A tentacao e fechar por diferenca — distribuir o buraco entre os itens
-- conhecidos ou entre os subcartoes. Isso daria um total bonito e uma base
-- errada: gasto sem dono viraria gasto com dono inventado. Aqui o buraco e um
-- no irmao dos subcartoes, com valor proprio e motivo proprio, e soma no pai
-- exatamente como qualquer outro filho.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO FAZ
-- ===========================================================================
-- Nao cria tabela, nao escreve um centavo, nao mexe em gatilho, nao toca
-- `fin_account`, `fin_transaction`, `fin_card_transaction` nem `fin_card_bill`.
-- Sao SEIS VIEWS de leitura sobre o que a 0047, a 0074 e a 0083 ja modelaram.
-- Nenhum titular e deduzido, nenhuma categoria e adivinhada: onde a fonte cala,
-- a coluna vem NULA com o motivo ao lado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. fin_card_saida_caixa_v — a UNICA linha do cartao que e caixa
-- ---------------------------------------------------------------------------
-- Uma linha por pagamento de fatura que tem lancamento no extrato. A ancora e
-- `b.paid_transaction_id`, nao a categoria: ver o cabecalho.
--
-- `saiu_cents` e positivo (quanto saiu). `amount_cents` preserva o sinal do
-- ledger. As duas colunas existem porque a tela soma uma e o confronto com o
-- extrato usa a outra — converter no meio do caminho e como se perde sinal.
DROP VIEW IF EXISTS fin_card_saida_caixa_v CASCADE;
CREATE VIEW fin_card_saida_caixa_v AS
SELECT ca.entity_id,
       t.id                                   AS transaction_id,
       acc.slug                               AS conta,
       acc.name                               AS conta_nome,
       t.posted_on,
       date_trunc('month', t.posted_on)::date AS mes,
       (-t.amount_cents)                      AS saiu_cents,
       t.amount_cents,
       t.description_raw,
       cat.code                               AS categoria_code,
       cat.name                               AS categoria,
       -- Nao e "sem categoria" por descuido: e a decisao humana que o gatilho
       -- da 0094 protege. Dizer isso na linha evita que alguem "conserte" com
       -- um UPDATE em massa.
       CASE WHEN t.category_id IS NULL THEN
         'Pagamento de fatura ainda sem categoria. O gatilho fin_transaction_fatura_sem_itemizacao '
         || 'so aceita 9.01 com fin_card_bill ligada — a ligacao existe, o carimbo e decisao humana.'
       END                                    AS categoria_motivo,
       i.slug                                 AS emissor_slug,
       i.name                                 AS emissor,
       ca.id                                  AS card_account_id,
       ca.slug                                AS linha_slug,
       ca.name                                AS linha,
       ca.itemization_level                   AS nivel_detalhe,
       b.id                                   AS bill_id,
       b.bill_source                          AS origem_fatura,
       b.reference_month,
       b.due_date,
       b.status                               AS status_fatura,
       b.total_amount_cents                   AS fatura_cents,
       b.itemized_amount_cents                AS itemizado_cents,
       b.unitemized_amount_cents              AS nao_itemizado_cents,
       CASE WHEN b.total_amount_cents = 0 THEN NULL
            ELSE round(100.0 * b.itemized_amount_cents::numeric / b.total_amount_cents::numeric, 1)
       END                                    AS pct_explicado,
       b.unreconciled_reason,
       -- Quando o pago diverge do declarado, a fatura ficou parcial. A tela
       -- precisa da diferenca com nome, nao de um total que ja a absorveu.
       (b.total_amount_cents - b.paid_amount_cents) AS diferenca_declarado_pago_cents
  FROM fin_card_bill b
  JOIN fin_transaction   t   ON t.id  = b.paid_transaction_id
  JOIN fin_card_account  ca  ON ca.id = b.card_account_id
  JOIN fin_account       acc ON acc.id = t.account_id
  LEFT JOIN fin_card_issuer i   ON i.id   = ca.issuer_id
  LEFT JOIN fin_category    cat ON cat.id = t.category_id;

COMMENT ON VIEW fin_card_saida_caixa_v IS
  'O cartao dentro da saida de caixa: uma linha por pagamento de fatura com lancamento no extrato. '
  'NUNCA somar com fin_card_transaction — sao o mesmo dinheiro visto de dois lugares.';

-- ---------------------------------------------------------------------------
-- 2. fin_card_item_v — o item com o caminho inteiro e a ignorancia declarada
-- ---------------------------------------------------------------------------
-- A folha da arvore. `pagamento_fatura` fica FORA: no extrato do cartao ele e o
-- espelho do debito na corrente, e soma-lo aos gastos zeraria o mes.
DROP VIEW IF EXISTS fin_card_item_v CASCADE;
CREATE VIEW fin_card_item_v AS
SELECT ca.entity_id,
       i.slug            AS emissor_slug,
       i.name            AS emissor,
       ca.id             AS card_account_id,
       ca.slug           AS linha_slug,
       ca.name           AS linha,
       t.card_id,
       t.card_last4      AS last4,
       c.status          AS status_cartao,
       c.is_primary,
       p.name            AS titular,
       c.holder_name_raw AS titular_declarado_pela_fonte,
       CASE WHEN c.id IS NOT NULL AND c.holder_person_id IS NULL THEN
         'A fonte nao devolve titular (owner, tax_number e holderType nulos). Exige alguem dizer de quem e o plastico.'
       END               AS titular_motivo,
       t.bill_id,
       b.reference_month,
       b.due_date,
       b.bill_source     AS origem_fatura,
       t.id,
       t.posted_on,
       t.competence_month,
       t.competence_date,
       t.purchase_date,
       t.description,
       t.merchant,
       t.mcc,
       t.kind,
       t.status,
       t.amount_cents,
       t.category_id,
       cat.code          AS categoria_code,
       cat.name          AS categoria,
       CASE WHEN t.category_id IS NULL THEN
         'Item de fatura sem categoria. Sem isto o cartao nao entra na DRE por competencia.'
       END               AS categoria_motivo,
       t.cost_center_id,
       CASE WHEN t.cost_center_id IS NULL THEN
         'Item de fatura sem projeto/centro de custo. Sem isto o gasto nao chega a margem por obra.'
       END               AS centro_custo_motivo,
       t.nucleo,
       t.installment_plan_id,
       t.installment_number,
       t.installments_total,
       pl.merchant_label AS plano,
       t.classified_by,
       t.classified_evidence
  FROM fin_card_transaction t
  JOIN fin_card_account ca ON ca.id = t.card_account_id
  LEFT JOIN fin_card_issuer         i   ON i.id   = ca.issuer_id
  LEFT JOIN fin_card                c   ON c.id   = t.card_id
  LEFT JOIN fin_person              p   ON p.id   = c.holder_person_id
  LEFT JOIN fin_card_bill           b   ON b.id   = t.bill_id
  LEFT JOIN fin_category            cat ON cat.id = t.category_id
  LEFT JOIN fin_card_installment_plan pl ON pl.id = t.installment_plan_id
 WHERE t.kind <> 'pagamento_fatura';

COMMENT ON VIEW fin_card_item_v IS
  'Um item de cartao com o caminho emissor/linha/subcartao/fatura e o motivo de cada campo ausente. '
  'Exclui kind=pagamento_fatura: no subledger ele e o espelho do debito na corrente.';

-- ---------------------------------------------------------------------------
-- 3. fin_card_arvore_v — o drill, com cada nivel somando o de cima
-- ---------------------------------------------------------------------------
-- emissor -> linha -> fatura -> subcartao -> item, mais o no `nao_itemizado`
-- como IRMAO dos subcartoes dentro da fatura (ver o cabecalho).
--
-- `chave`/`chave_pai` sao texto de proposito: a arvore atravessa cinco tabelas
-- com espacos de id independentes, e um id numerico "solto" nao diz de que
-- nivel ele e. `ordem` existe para a tela nao ter de reimplementar o criterio
-- de ordenacao em cada nivel.
DROP VIEW IF EXISTS fin_card_arvore_v CASCADE;
CREATE VIEW fin_card_arvore_v AS
WITH item AS (
  SELECT * FROM fin_card_item_v
),
-- Uma "fatura" por bill, mais uma pseudo-fatura por linha para o que ainda nao
-- foi faturado (71 parcelas futuras + 1 item posterior ao ultimo fechamento).
-- Ela nao finge ser fatura: `origem_fatura='ainda_sem_fatura'` e o rotulo diz.
fatura AS (
  SELECT b.id::text                       AS bill_key,
         b.id                             AS bill_id,
         b.card_account_id,
         b.reference_month,
         b.due_date,
         b.bill_source,
         b.total_amount_cents,
         b.itemized_amount_cents,
         b.unitemized_amount_cents,
         b.status
    FROM fin_card_bill b
  UNION ALL
  SELECT 'futuro:' || ca.id::text, NULL, ca.id, NULL::date, NULL::date, 'ainda_sem_fatura',
         COALESCE(sum(t.amount_cents), 0)::bigint, COALESCE(sum(t.amount_cents), 0)::bigint, 0::bigint, 'aberta'
    FROM fin_card_account ca
    JOIN item t ON t.card_account_id = ca.id AND t.bill_id IS NULL
   GROUP BY ca.id
),
item_no AS (
  SELECT t.*,
         COALESCE(t.bill_id::text, 'futuro:' || t.card_account_id::text) AS bill_key
    FROM item t
),
sub AS (
  SELECT t.entity_id, t.emissor_slug, t.card_account_id, t.bill_key, t.card_id, t.last4,
         t.titular, t.titular_motivo,
         count(*)                                                        AS itens,
         sum(t.amount_cents)                                             AS valor_cents,
         count(*) FILTER (WHERE t.category_id IS NOT NULL)               AS itens_com_categoria,
         COALESCE(sum(t.amount_cents) FILTER (WHERE t.category_id IS NOT NULL), 0) AS valor_com_categoria_cents
    FROM item_no t
   GROUP BY 1,2,3,4,5,6,7,8
)
-- nivel 1: emissor
SELECT ca.entity_id,
       1                                     AS profundidade,
       'emissor'                             AS nivel,
       'emissor:' || i.slug                  AS chave,
       NULL::text                            AS chave_pai,
       i.name                                AS rotulo,
       count(DISTINCT ca.id)::text || ' linha(s) de credito' AS detalhe,
       COALESCE(sum(f.total_amount_cents), 0)::bigint        AS valor_cents,
       COALESCE(sum(f.itemized_amount_cents), 0)::bigint     AS itemizado_cents,
       COALESCE(sum(f.unitemized_amount_cents), 0)::bigint   AS nao_itemizado_cents,
       NULL::bigint                          AS itens,
       NULL::text                            AS motivo,
       min(i.slug)                           AS ordem
  FROM fin_card_account ca
  JOIN fin_card_issuer i ON i.id = ca.issuer_id
  LEFT JOIN fatura f ON f.card_account_id = ca.id
 GROUP BY ca.entity_id, i.slug, i.name

UNION ALL
-- nivel 2: linha de credito
SELECT ca.entity_id, 2, 'linha',
       'linha:' || ca.id::text,
       'emissor:' || i.slug,
       ca.name,
       ca.itemization_level || ' · liquida em ' || COALESCE(acc.slug, 'conta nao declarada'),
       COALESCE(sum(f.total_amount_cents), 0)::bigint,
       COALESCE(sum(f.itemized_amount_cents), 0)::bigint,
       COALESCE(sum(f.unitemized_amount_cents), 0)::bigint,
       NULL::bigint,
       CASE WHEN ca.itemization_level = 'somente_pagamento'
            THEN COALESCE(ca.itemization_note,
                 'A fonte nao entrega compras desta linha. Resolver exige extrato do cartao fora de API (PDF/CSV) ou acesso que hoje nao existe.')
       END,
       ca.slug
  FROM fin_card_account ca
  JOIN fin_card_issuer i ON i.id = ca.issuer_id
  LEFT JOIN fin_account acc ON acc.id = ca.settlement_account_id
  LEFT JOIN fatura f ON f.card_account_id = ca.id
 GROUP BY ca.entity_id, ca.id, ca.name, ca.slug, ca.itemization_level, ca.itemization_note, i.slug, acc.slug

UNION ALL
-- nivel 3: fatura (ou o ciclo que ainda nao virou fatura)
SELECT ca.entity_id, 3, 'fatura',
       'fatura:' || f.bill_key,
       'linha:' || ca.id::text,
       CASE WHEN f.bill_id IS NULL THEN 'ainda sem fatura'
            ELSE to_char(f.reference_month, 'MM/YYYY')
       END,
       CASE WHEN f.bill_id IS NULL
            THEN 'parcelas e compras posteriores ao ultimo fechamento'
            ELSE f.status || ' · vence ' || to_char(f.due_date, 'DD/MM/YYYY')
                 || CASE WHEN f.bill_source = 'derivada_do_pagamento' THEN ' · derivada do pagamento' ELSE '' END
       END,
       f.total_amount_cents, f.itemized_amount_cents, f.unitemized_amount_cents,
       NULL::bigint,
       CASE WHEN f.bill_source = 'derivada_do_pagamento'
            THEN 'Fatura nunca vista: a fonte nao expoe o cartao. O total e IGUAL ao pago por construcao — o valor real da fatura e desconhecido.'
            WHEN f.bill_id IS NULL
            THEN 'Nao e fatura: e o que ja esta comprometido e ainda nao fechou. Nao ha total declarado pelo emissor.'
       END,
       COALESCE(to_char(f.reference_month, 'YYYY-MM'), '9999-99') || ':' || f.bill_key
  FROM fatura f
  JOIN fin_card_account ca ON ca.id = f.card_account_id

UNION ALL
-- nivel 4a: subcartao dentro da fatura
SELECT s.entity_id, 4, 'subcartao',
       'sub:' || s.bill_key || ':' || COALESCE(s.card_id::text, 'sem-cartao'),
       'fatura:' || s.bill_key,
       CASE WHEN s.last4 IS NULL THEN 'final nao informado' ELSE 'final ' || s.last4 END,
       COALESCE(s.titular, 'titular nao declarado')
         || ' · ' || s.itens_com_categoria::text || ' de ' || s.itens::text || ' com categoria',
       s.valor_cents::bigint, s.valor_com_categoria_cents::bigint,
       (s.valor_cents - s.valor_com_categoria_cents)::bigint,
       s.itens,
       s.titular_motivo,
       COALESCE(s.last4, 'zzzz')
  FROM sub s

UNION ALL
-- nivel 4b: a parte que nenhum item explica — IRMA dos subcartoes, com motivo.
-- Nunca diluida entre eles: gasto sem dono viraria gasto com dono inventado.
SELECT ca.entity_id, 4, 'nao_itemizado',
       'naoitem:' || f.bill_key,
       'fatura:' || f.bill_key,
       'nao itemizado',
       'a fonte declara o total e nao entrega as compras',
       f.unitemized_amount_cents, 0::bigint, f.unitemized_amount_cents,
       NULL::bigint,
       'A fonte declara ' || to_char(f.total_amount_cents / 100.0, 'FM999G999D00')
         || ' e itemiza ' || to_char(f.itemized_amount_cents / 100.0, 'FM999G999D00')
         || '. A diferenca NAO e fechada por ajuste — ver 0047 §3.',
       'zzzzz'
  FROM fatura f
  JOIN fin_card_account ca ON ca.id = f.card_account_id
 WHERE f.unitemized_amount_cents <> 0

UNION ALL
-- nivel 5: o item
SELECT t.entity_id, 5, 'item',
       'item:' || t.id::text,
       'sub:' || t.bill_key || ':' || COALESCE(t.card_id::text, 'sem-cartao'),
       COALESCE(t.merchant, t.description, 'sem descricao na fonte'),
       to_char(t.posted_on, 'DD/MM')
         || COALESCE(' · ' || t.categoria_code || ' ' || t.categoria, '')
         || CASE WHEN t.installments_total IS NOT NULL
                 THEN ' · parcela ' || t.installment_number::text || '/' || t.installments_total::text
                 ELSE '' END
         || CASE WHEN t.kind <> 'compra' THEN ' · ' || t.kind ELSE '' END,
       t.amount_cents,
       CASE WHEN t.category_id IS NOT NULL THEN t.amount_cents ELSE 0 END,
       CASE WHEN t.category_id IS NULL     THEN t.amount_cents ELSE 0 END,
       1::bigint,
       t.categoria_motivo,
       to_char(t.posted_on, 'YYYY-MM-DD') || ':' || lpad(t.id::text, 12, '0')
  FROM item_no t;

COMMENT ON VIEW fin_card_arvore_v IS
  'Drill emissor -> linha -> fatura -> subcartao -> item. Cada nivel soma o de cima. '
  'A parte nao itemizada e um no irmao dos subcartoes, com motivo — nunca uma diferenca diluida.';

-- ---------------------------------------------------------------------------
-- 4. fin_card_serie_mensal_v — o historico por COMPETENCIA
-- ---------------------------------------------------------------------------
-- Grao mais fino que a tela precisa: mes x linha x subcartao. A faixa
-- `nao_itemizado` entra como linha propria, com card_id NULO — porque nao se
-- sabe de qual plastico ela e, e fingir que se sabe e o erro que esta base
-- inteira foi construida para nao cometer.
--
-- Esta view NAO tem coluna de caixa, e isso e desenho: sem uma coluna de caixa
-- ao lado nao existe o GROUP BY distraido que soma as duas.
DROP VIEW IF EXISTS fin_card_serie_mensal_v CASCADE;
CREATE VIEW fin_card_serie_mensal_v AS
SELECT t.entity_id, t.emissor_slug, t.emissor, t.card_account_id, t.linha_slug,
       t.competence_month AS mes,
       'item'::text       AS faixa,
       t.card_id, t.last4, t.titular,
       count(*)                                                         AS itens,
       sum(t.amount_cents)                                              AS valor_cents,
       COALESCE(sum(t.amount_cents) FILTER (WHERE t.category_id IS NOT NULL), 0) AS com_categoria_cents,
       count(*) FILTER (WHERE t.category_id IS NULL)                    AS itens_sem_categoria,
       count(*) FILTER (WHERE t.installment_plan_id IS NOT NULL)        AS itens_parcelados,
       count(*) FILTER (WHERE t.status = 'PENDING')                     AS itens_futuros,
       NULL::text                                                       AS motivo
  FROM fin_card_item_v t
 WHERE t.competence_month IS NOT NULL
 GROUP BY 1,2,3,4,5,6,8,9,10

UNION ALL

SELECT ca.entity_id, i.slug, i.name, ca.id, ca.slug,
       b.reference_month, 'nao_itemizado',
       NULL::bigint, NULL::text, NULL::text,
       0::bigint, b.unitemized_amount_cents, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
       'A fonte declara ' || to_char(b.total_amount_cents / 100.0, 'FM999G999D00')
         || ' e itemiza ' || to_char(b.itemized_amount_cents / 100.0, 'FM999G999D00')
         || '. A diferenca NAO e fechada por ajuste — ver 0047 §3.'
  FROM fin_card_bill b
  JOIN fin_card_account ca ON ca.id = b.card_account_id
  LEFT JOIN fin_card_issuer i ON i.id = ca.issuer_id
 WHERE b.unitemized_amount_cents <> 0 AND b.reference_month IS NOT NULL;

COMMENT ON VIEW fin_card_serie_mensal_v IS
  'Historico de COMPETENCIA por mes/linha/subcartao. Sem coluna de caixa de proposito: '
  'a serie de caixa e fin_card_caixa_mensal_v, e as duas nunca se somam.';

-- ---------------------------------------------------------------------------
-- 5. fin_card_caixa_mensal_v — o historico por CAIXA
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS fin_card_caixa_mensal_v CASCADE;
CREATE VIEW fin_card_caixa_mensal_v AS
SELECT s.entity_id, s.emissor_slug, s.emissor, s.card_account_id, s.linha_slug, s.conta,
       s.mes,
       count(*)                  AS pagamentos,
       sum(s.saiu_cents)         AS saiu_cents,
       sum(s.fatura_cents)       AS fatura_declarada_cents,
       sum(s.itemizado_cents)    AS itemizado_cents,
       sum(s.nao_itemizado_cents) AS nao_itemizado_cents,
       count(*) FILTER (WHERE s.categoria_code IS NULL) AS pagamentos_sem_categoria
  FROM fin_card_saida_caixa_v s
 GROUP BY 1,2,3,4,5,6,7;

COMMENT ON VIEW fin_card_caixa_mensal_v IS
  'Historico de CAIXA: o que saiu da conta corrente pagando fatura, por mes de pagamento.';

-- ---------------------------------------------------------------------------
-- 6. fin_card_plano_parcela_v — o parcelamento inteiro, inclusive quando ele
--    atravessa a reemissao do plastico
-- ---------------------------------------------------------------------------
-- 16 de 25 planos atravessam mais de um final e continuam sendo UM plano. Quem
-- olha o extrato ve "Mercadolivre 3/6" no final 7626 e "4/6" no 3148 e conclui
-- que sao duas compras. Sao a mesma. `finais` e `atravessa_reemissao` existem
-- para a tela conseguir dizer isso em voz alta.
--
-- `fin_card.replaces_card_id` e `replaced_by_card_id` estao NULOS nos 12
-- subcartoes: a reemissao NAO esta declarada em lugar nenhum, ela e INFERIDA
-- pela continuidade do plano. `reemissao_declarada` diz qual dos dois e o caso,
-- para ninguem confundir deducao com registro.
DROP VIEW IF EXISTS fin_card_plano_parcela_v CASCADE;
CREATE VIEW fin_card_plano_parcela_v AS
WITH plano AS (
  SELECT p.id,
         p.card_account_id,
         p.merchant_label,
         p.purchase_date,
         p.installments_total,
         p.installments_billed,
         p.installments_open,
         p.installment_amount_cents,
         p.total_amount_cents,
         p.total_is_estimated,
         p.first_competence_month,
         p.last_competence_month,
         p.status,
         p.category_id,
         (SELECT string_agg(DISTINCT t.card_last4, ' → ' ORDER BY t.card_last4)
            FROM fin_card_transaction t WHERE t.installment_plan_id = p.id) AS finais,
         (SELECT count(DISTINCT t.card_last4)
            FROM fin_card_transaction t WHERE t.installment_plan_id = p.id) AS finais_distintos,
         (SELECT bool_or(c.replaces_card_id IS NOT NULL OR c.replaced_by_card_id IS NOT NULL)
            FROM fin_card_transaction t
            JOIN fin_card c ON c.id = t.card_id
           WHERE t.installment_plan_id = p.id) AS reemissao_declarada
    FROM fin_card_installment_plan p
)
SELECT ca.entity_id,
       i.slug   AS emissor_slug,
       ca.slug  AS linha_slug,
       pl.id    AS plano_id,
       pl.merchant_label,
       pl.purchase_date,
       pl.installments_total,
       pl.installments_billed,
       pl.installments_open,
       pl.installment_amount_cents,
       pl.total_amount_cents,
       pl.total_is_estimated,
       pl.first_competence_month,
       pl.last_competence_month,
       pl.status,
       pl.finais,
       (pl.finais_distintos > 1)                       AS atravessa_reemissao,
       COALESCE(pl.reemissao_declarada, false)         AS reemissao_declarada,
       CASE WHEN pl.finais_distintos > 1 AND NOT COALESCE(pl.reemissao_declarada, false) THEN
         'O plano aparece em ' || pl.finais_distintos::text || ' finais diferentes e continua sendo UM plano. '
         || 'A troca de plastico NAO esta declarada em fin_card (replaces_card_id nulo): ela e inferida pela '
         || 'continuidade da numeracao das parcelas.'
       END                                             AS reemissao_motivo,
       cat.code AS categoria_code,
       cat.name AS categoria,
       CASE WHEN pl.category_id IS NULL THEN
         'Plano sem categoria: as parcelas dele nao chegam a DRE por competencia.'
       END      AS categoria_motivo,
       -- a parcela
       t.id                AS item_id,
       t.installment_number,
       t.card_last4        AS last4_da_parcela,
       t.card_id,
       t.posted_on,
       t.competence_month,
       t.bill_id,
       t.amount_cents,
       t.status            AS status_parcela,
       (t.status = 'PENDING') AS futura
  FROM plano pl
  JOIN fin_card_account ca ON ca.id = pl.card_account_id
  LEFT JOIN fin_card_issuer i   ON i.id   = ca.issuer_id
  LEFT JOIN fin_category    cat ON cat.id = pl.category_id
  LEFT JOIN fin_card_transaction t ON t.installment_plan_id = pl.id;

COMMENT ON VIEW fin_card_plano_parcela_v IS
  'Uma linha por parcela, com o cabecalho do plano. atravessa_reemissao distingue o plano que muda '
  'de final; reemissao_declarada distingue deducao (hoje: sempre) de registro.';

-- ---------------------------------------------------------------------------
-- 7. fin_card_prova_nao_soma_v — a prova, na tela e no teste
-- ---------------------------------------------------------------------------
-- Um mes por linha, com as tres medidas em COLUNAS SEPARADAS e a frase que diz
-- por que a soma delas nao existe. Esta view e o que a tela mostra e o que o
-- teste confere: se alguem um dia somar competencia com caixa, a diferenca
-- aparece aqui antes de aparecer num relatorio.
DROP VIEW IF EXISTS fin_card_prova_nao_soma_v CASCADE;
CREATE VIEW fin_card_prova_nao_soma_v AS
WITH meses AS (
  SELECT entity_id, emissor_slug, card_account_id, linha_slug, mes FROM fin_card_serie_mensal_v
  UNION
  SELECT entity_id, emissor_slug, card_account_id, linha_slug, mes FROM fin_card_caixa_mensal_v
)
SELECT m.entity_id, m.emissor_slug, m.linha_slug, m.card_account_id, m.mes,
       COALESCE(comp.itens_cents, 0)          AS competencia_itens_cents,
       COALESCE(comp.nao_itemizado_cents, 0)  AS competencia_nao_itemizado_cents,
       COALESCE(comp.itens, 0)                AS itens,
       cx.saiu_cents                          AS caixa_saiu_cents,
       cx.pagamentos                          AS caixa_pagamentos,
       cx.conta                               AS caixa_conta,
       'A coluna de competencia e a composicao da fatura; a de caixa e o debito que a pagou. '
       'Sao o MESMO dinheiro visto de dois lugares e em meses diferentes (a fatura de marco '
       'e paga em marco, com compras de fevereiro). Somar as duas conta a despesa duas vezes.'
                                              AS porque_nao_soma
  FROM meses m
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(s.valor_cents) FILTER (WHERE s.faixa = 'item'), 0)          AS itens_cents,
           COALESCE(sum(s.valor_cents) FILTER (WHERE s.faixa = 'nao_itemizado'), 0) AS nao_itemizado_cents,
           COALESCE(sum(s.itens), 0)                                                AS itens
      FROM fin_card_serie_mensal_v s
     WHERE s.card_account_id = m.card_account_id AND s.mes = m.mes
  ) comp ON true
  LEFT JOIN LATERAL (
    SELECT sum(k.saiu_cents) AS saiu_cents, sum(k.pagamentos) AS pagamentos,
           string_agg(DISTINCT k.conta, ', ') AS conta
      FROM fin_card_caixa_mensal_v k
     WHERE k.card_account_id = m.card_account_id AND k.mes = m.mes
  ) cx ON true;

COMMENT ON VIEW fin_card_prova_nao_soma_v IS
  'Competencia e caixa lado a lado, em colunas separadas, com a frase que explica por que a soma '
  'das duas nao existe. E a prova que a tela mostra e que o teste confere.';

-- ===========================================================================
-- ASSERCOES — a migration se recusa a commitar se qualquer uma cair
-- ===========================================================================
DO $$
DECLARE
  v_n            bigint;
  v_a            numeric;
  v_b            numeric;
  v_txt          text;
BEGIN
  -- 1. O INVARIANTE CENTRAL: cartao nao e conta. Se o CHECK afrouxar, o cartao
  --    ganha saldo e extrato proprios e a dupla contagem vira estrutural.
  SELECT count(*) INTO v_n FROM fin_account WHERE kind = 'cartao';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % fin_account com kind=cartao — o cartao nao pode ser conta', v_n;
  END IF;

  -- E o CHECK tem de continuar recusando o valor. Ler a definicao em vez de
  -- tentar um INSERT de sonda e de proposito: `fin_account` tem gatilhos e a
  -- sonda pegaria ACCESS EXCLUSIVE numa tabela viva so para provar um texto.
  SELECT pg_get_constraintdef(oid) INTO v_txt
    FROM pg_constraint WHERE conrelid = 'fin_account'::regclass AND conname = 'fin_account_kind_check';
  IF v_txt IS NULL OR v_txt LIKE '%''cartao''%' THEN
    RAISE EXCEPTION '0114: o CHECK de fin_account.kind sumiu ou passou a aceitar cartao — a defesa 1 caiu (%)', v_txt;
  END IF;

  -- 2. ITEM DE CARTAO NUNCA VIRA LANCAMENTO. O unico contato entre o subledger
  --    e o ledger e o ponteiro do pagamento da fatura, e ele e 1:1.
  SELECT count(*) INTO v_n FROM (
    SELECT transaction_id FROM fin_card_saida_caixa_v GROUP BY 1 HAVING count(*) > 1
  ) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % lancamento(s) pagando mais de uma fatura — o ponteiro deixou de ser 1:1', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM fin_card_saida_caixa_v s
    JOIN fin_card_item_v i ON i.id = s.transaction_id AND i.linha_slug = s.linha_slug;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % linha(s) aparecendo como item E como saida de caixa', v_n;
  END IF;

  -- 3. O CAIXA DO CARTAO NAO PODE SER MEDIDO POR CATEGORIA. Esta assercao
  --    documenta o defeito que a view corrige: se um dia todo pagamento tiver
  --    9.01, ela cai e a linha do contrato pode voltar a ser por categoria.
  SELECT count(*) INTO v_n FROM fin_card_saida_caixa_v WHERE categoria_code IS NULL;
  IF v_n = 0 THEN
    RAISE NOTICE '0114: todos os pagamentos de fatura ja tem categoria — medir por 9.01 voltaria a dar o mesmo numero';
  ELSE
    SELECT sum(saiu_cents) INTO v_a FROM fin_card_saida_caixa_v WHERE categoria_code IS NULL;
    RAISE NOTICE '0114: % pagamento(s) de fatura sem categoria, % em caixa — medir por 9.01 esconderia isso',
      v_n, to_char(v_a / 100.0, 'FM999G999D00');
  END IF;

  -- 4. A ARVORE SOMA. Emissor = soma das linhas = soma das faturas.
  SELECT COALESCE(sum(valor_cents), 0) INTO v_a FROM fin_card_arvore_v WHERE nivel = 'emissor';
  SELECT COALESCE(sum(valor_cents), 0) INTO v_b FROM fin_card_arvore_v WHERE nivel = 'linha';
  IF v_a <> v_b THEN
    RAISE EXCEPTION '0114: emissor soma % e linha soma % — a arvore nao fecha', v_a, v_b;
  END IF;

  SELECT COALESCE(sum(valor_cents), 0) INTO v_b FROM fin_card_arvore_v WHERE nivel = 'fatura';
  IF v_a <> v_b THEN
    RAISE EXCEPTION '0114: linha soma % e fatura soma % — a arvore nao fecha', v_a, v_b;
  END IF;

  -- 5. DENTRO DA FATURA: subcartoes + nao itemizado = a fatura. E aqui que a
  --    parte nao explicada prova que esta no lugar, e nao diluida.
  SELECT count(*) INTO v_n FROM (
    SELECT f.chave,
           f.valor_cents AS fatura,
           COALESCE(sum(k.valor_cents), 0) AS filhos
      FROM fin_card_arvore_v f
      LEFT JOIN fin_card_arvore_v k ON k.chave_pai = f.chave
     WHERE f.nivel = 'fatura'
     GROUP BY f.chave, f.valor_cents
    HAVING f.valor_cents <> COALESCE(sum(k.valor_cents), 0)
  ) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % fatura(s) em que subcartoes + nao itemizado nao dao o total da fatura', v_n;
  END IF;

  -- 6. E o subcartao = a soma dos seus itens.
  SELECT count(*) INTO v_n FROM (
    SELECT s.chave, s.valor_cents AS sub, COALESCE(sum(it.valor_cents), 0) AS itens
      FROM fin_card_arvore_v s
      LEFT JOIN fin_card_arvore_v it ON it.chave_pai = s.chave
     WHERE s.nivel = 'subcartao'
     GROUP BY s.chave, s.valor_cents
    HAVING s.valor_cents <> COALESCE(sum(it.valor_cents), 0)
  ) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % subcartao(oes) cujo valor nao e a soma dos itens', v_n;
  END IF;

  -- 7. TODO ITEM TEM PAI. Uma folha orfa desapareceria da tela sem nenhum aviso
  --    — que e exatamente como R$ 194 mil ficaram invisiveis antes da 0083.
  SELECT count(*) INTO v_n
    FROM fin_card_arvore_v it
   WHERE it.nivel = 'item'
     AND NOT EXISTS (SELECT 1 FROM fin_card_arvore_v p WHERE p.chave = it.chave_pai);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % item(ns) sem no pai na arvore', v_n;
  END IF;

  -- 8. A SERIE MENSAL DE ITENS RECONTA A TABELA. Sem isto o historico poderia
  --    perder um mes inteiro em silencio.
  SELECT COALESCE(sum(valor_cents), 0) INTO v_a FROM fin_card_serie_mensal_v WHERE faixa = 'item';
  SELECT COALESCE(sum(amount_cents), 0) INTO v_b FROM fin_card_transaction
   WHERE kind <> 'pagamento_fatura' AND competence_month IS NOT NULL;
  IF v_a <> v_b THEN
    RAISE EXCEPTION '0114: serie mensal soma % e a tabela soma % — o historico perdeu dinheiro', v_a, v_b;
  END IF;

  -- 9. A SERIE DE CAIXA RECONTA OS PAGAMENTOS COM LANCAMENTO.
  SELECT COALESCE(sum(saiu_cents), 0) INTO v_a FROM fin_card_caixa_mensal_v;
  SELECT COALESCE(sum(-t.amount_cents), 0) INTO v_b
    FROM fin_card_bill b JOIN fin_transaction t ON t.id = b.paid_transaction_id;
  IF v_a <> v_b THEN
    RAISE EXCEPTION '0114: caixa mensal soma % e os lancamentos somam % ', v_a, v_b;
  END IF;

  -- 10. AS DUAS SERIES NAO PODEM SER IGUAIS. Se um dia forem, alguem ligou uma
  --     na outra e a separacao virou decoracao.
  SELECT COALESCE(sum(valor_cents), 0) INTO v_a FROM fin_card_serie_mensal_v;
  SELECT COALESCE(sum(saiu_cents), 0)  INTO v_b FROM fin_card_caixa_mensal_v;
  IF v_a = v_b AND v_a <> 0 THEN
    RAISE EXCEPTION '0114: competencia e caixa deram o MESMO numero (%) — uma das duas esta lendo a outra', v_a;
  END IF;

  -- 11. O PLANO ATRAVESSA A REEMISSAO E CONTINUA UM SO. Isto ja custou caro
  --     para funcionar (0083). A assercao existe para nao regredir.
  SELECT count(DISTINCT plano_id) INTO v_n FROM fin_card_plano_parcela_v WHERE atravessa_reemissao;
  IF v_n = 0 THEN
    RAISE EXCEPTION '0114: nenhum plano atravessando reemissao — o acervo tem 16, a deteccao quebrou';
  END IF;

  SELECT count(*) INTO v_n FROM (
    SELECT plano_id FROM fin_card_plano_parcela_v WHERE item_id IS NOT NULL
     GROUP BY plano_id, installments_total HAVING count(*) > max(installments_total)
  ) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % plano(s) com mais parcelas observadas que o contratado', v_n;
  END IF;

  -- 12. A REEMISSAO E DEDUZIDA, E A VIEW TEM DE DIZER ISSO. Se um dia alguem
  --     declarar replaces_card_id, esta assercao cai e o motivo some sozinho.
  SELECT count(*) INTO v_n FROM fin_card_plano_parcela_v
   WHERE atravessa_reemissao AND NOT reemissao_declarada AND reemissao_motivo IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % parcela(s) atravessando reemissao inferida sem motivo declarado', v_n;
  END IF;

  -- 13. NENHUM TITULAR E DEDUZIDO. Onde ha titular tem de haver pessoa ligada.
  SELECT count(*) INTO v_n
    FROM fin_card_item_v i
   WHERE i.titular IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM fin_card c WHERE c.id = i.card_id AND c.holder_person_id IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % item(ns) com titular sem pessoa ligada — titular deduzido', v_n;
  END IF;

  -- 14. TODO CAMPO AUSENTE TEM MOTIVO. E a regra 5 do projeto, virada em teste.
  SELECT count(*) INTO v_n FROM fin_card_item_v
   WHERE (category_id IS NULL AND categoria_motivo IS NULL)
      OR (card_id IS NOT NULL AND titular IS NULL AND titular_motivo IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % item(ns) com campo ausente e sem motivo declarado', v_n;
  END IF;

  -- 15. A PROVA COBRE TODO MES QUE TEM ALGUMA DAS DUAS MEDIDAS.
  SELECT count(*) INTO v_n FROM fin_card_prova_nao_soma_v WHERE porque_nao_soma IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0114: % linha(s) da prova sem a frase que explica por que nao soma', v_n;
  END IF;

  SELECT string_agg(x, ' · ') INTO v_txt FROM (
    SELECT to_char(count(*), 'FM999') || ' no(s) ' || nivel AS x
      FROM fin_card_arvore_v GROUP BY nivel ORDER BY min(profundidade)
  ) y;

  RAISE NOTICE '0114: arvore do cartao — %', v_txt;
  RAISE NOTICE '0114: competencia % · caixa % · nao itemizado % — tres numeros, nenhuma soma',
    to_char((SELECT COALESCE(sum(valor_cents),0) FROM fin_card_serie_mensal_v WHERE faixa='item') / 100.0, 'FM999G999D00'),
    to_char((SELECT COALESCE(sum(saiu_cents),0)  FROM fin_card_caixa_mensal_v) / 100.0, 'FM999G999D00'),
    to_char((SELECT COALESCE(sum(valor_cents),0) FROM fin_card_serie_mensal_v WHERE faixa='nao_itemizado') / 100.0, 'FM999G999D00');
END $$;
