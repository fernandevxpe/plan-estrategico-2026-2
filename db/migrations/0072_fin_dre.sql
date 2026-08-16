-- A DRE sai do banco — nas duas visões, e dizendo o que ela não cobre.
--
-- ---------------------------------------------------------------------------
-- POR QUE SÃO DUAS VISÕES E NÃO UMA
-- ---------------------------------------------------------------------------
-- A 0071 deu competência a todo lançamento. Isso não torna a visão de caixa
-- obsoleta — torna as duas legíveis lado a lado, que é diferente.
--
--   caixa .......... quando o dinheiro se moveu (posted_on). É o que a
--                    tesouraria precisa e o que o extrato confirma.
--   competencia .... quando o fato econômico aconteceu (competence_date, com a
--                    regra declarada). É o que responde "este mês deu lucro".
--
-- Nenhuma das duas é "a certa". O erro é ter só uma e chamar de DRE.
--
-- `visao` é uma coluna, não duas views. Quem esquecer de filtrar soma as duas e
-- dobra o resultado — por isso ela é a PRIMEIRA coluna de toda view aqui, e por
-- isso o COMMENT de cada uma repete o aviso.
--
-- ---------------------------------------------------------------------------
-- CONVENÇÃO DE SINAL: NATURAL, SEMPRE
-- ---------------------------------------------------------------------------
-- Receita positiva, despesa negativa, como no ledger. Subtotal é SOMA, nunca
-- subtração. Assim:
--
--   receita_liquida       = receita_bruta + deducoes         (deduções < 0)
--   margem_contribuicao   = receita_liquida + custos_diretos (custos < 0)
--   resultado_operacional = margem + pessoal + comercial + administrativas
--   lair                  = resultado_operacional + resultado_financeiro
--   lucro_liquido         = lair + irpj_csll
--
-- A alternativa (guardar despesa em positivo e subtrair) foi descartada porque
-- inverte o sinal em relação a `fin_transaction.amount_cents` e cria uma classe
-- inteira de bug que não aparece em teste: o número fecha, com o sinal trocado.
--
-- ---------------------------------------------------------------------------
-- ONDE OS IMPOSTOS ENTRAM, E POR QUE O IRPJ/CSLL É ZERO
-- ---------------------------------------------------------------------------
-- 7.01 (DAS), 7.02 (ISS) e 7.03 (retenções) entram em DEDUÇÕES DA RECEITA
-- BRUTA, não depois do resultado operacional. É o tratamento padrão de tributo
-- sobre faturamento, e é o que faz "receita líquida" significar o que o nome
-- diz.
--
-- Consequência que precisa estar escrita, senão parece bug: a linha `irpj_csll`
-- vem ZERO em toda a série. Não é lacuna — é o Simples Nacional. O DAS é guia
-- única e já carrega IRPJ e CSLL dentro dele, então cobrá-los de novo depois do
-- LAIR contaria o mesmo imposto duas vezes. `lucro_liquido = lair` enquanto a
-- empresa estiver no Simples. Se migrar para Presumido ou Real, esta linha
-- passa a ter conteúdo e a 7.x se divide.
--
-- ---------------------------------------------------------------------------
-- OS TRÊS INVARIANTES QUE ESTA MIGRATION NÃO PODE VIOLAR
-- ---------------------------------------------------------------------------
-- 1. TRANSFERÊNCIA ENTRE CONTAS PRÓPRIAS É NEUTRA.
--    cash_flow_group='movimentacao' (9.01 a 9.05) não entra em nenhuma linha da
--    cadeia. Aparece só na seção `fora`, informativa, para que R$ 2,36 milhões
--    não sumam da tela sem explicação.
--
-- 2. FATURA DE CARTÃO NÃO É DESPESA.
--    O custo vem dos ITENS (fin_card_transaction) na competência da COMPRA. O
--    pagamento da fatura é caixa e só caixa — e no ledger ele já está como 9.01,
--    portanto neutro. As duas coisas aparecem em linhas `fora` distintas:
--      fora_cartao_fatura_paga ..... o que saiu do banco (visão caixa)
--      lacuna_cartao_sem_categoria . o custo dos itens (visão competência)
--    Elas NÃO se somam: são o mesmo dinheiro em momentos diferentes.
--    Estado medido hoje: 781 itens de cartão, R$ 84.058,09 de custo, e ZERO com
--    categoria. Por isso o custo do cartão inteiro cai em `lacuna`, e não nas
--    linhas de despesa. Classificar os itens é o que move esse número de lugar.
--
-- 3. AS QUATRO CAMADAS DA RECEITA NÃO SE SOMAM.
--    Esta DRE lê UMA delas: o caixa recebido (fin_transaction), reposicionado no
--    tempo pela competência. Contrato, parcela e cobrança em aberto continuam em
--    fin_receita_camadas_v e fin_receber_aberto_v e NÃO entram aqui. Receita
--    faturada e não recebida não é receita desta DRE — é contas a receber, e
--    está no balanço da 0073.
--
-- ---------------------------------------------------------------------------
-- O QUE A DRE NÃO COBRE — E FICA VISÍVEL EM VEZ DE SUMIR
-- ---------------------------------------------------------------------------
-- Seção `lacuna`, somada em `lucro_liquido_com_lacunas`:
--
--   lacuna_ledger_sem_categoria .... 418 lançamentos, R$ -152.871,15
--   lacuna_cartao_sem_categoria .... 781 itens,       R$  -84.058,09
--
-- O leitor recebe DOIS resultados: `lucro_liquido` (só o que está classificado)
-- e `lucro_liquido_com_lacunas` (o piso, se tudo que falta for despesa). O
-- verdadeiro está entre os dois. Publicar um só seria escolher pelo leitor.
--
-- E o aviso que o AGENTE_FINANCEIRO exige: isto é uma DRE **GERENCIAL**. Não é
-- contábil oficial, não tem partida dobrada, não tem depreciação (não há
-- registro de imobilizado: os R$ 8.x de CAPEX são baixados direto, não
-- capitalizados), e a competência de 5,6% das linhas é presumida. Publique
-- fin_dre_cobertura_v junto — sem ela o número parece mais firme do que é.

-- ---------------------------------------------------------------------------
-- 1. AS LINHAS DA DRE COMO DADO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_dre_linha (
  slug     text PRIMARY KEY,
  name     text NOT NULL,
  secao    text NOT NULL CHECK (secao IN ('resultado', 'fora', 'lacuna')),
  tipo     text NOT NULL CHECK (tipo IN ('item', 'subtotal')),
  ordem    integer NOT NULL UNIQUE,
  formula  text,
  descricao text NOT NULL
);

COMMENT ON TABLE fin_dre_linha IS
  'As linhas da DRE gerencial, em ordem de apresentação. secao=resultado é a cadeia que vai de '
  'receita bruta a lucro líquido; secao=fora é o que existe no caixa e não é resultado (CAPEX, '
  'movimentação, pagamento de fatura); secao=lacuna é o que a DRE não conseguiu classificar.';

INSERT INTO fin_dre_linha (slug, name, secao, tipo, ordem, formula, descricao) VALUES
 ('receita_bruta',            'Receita bruta',              'resultado', 'item',     10, NULL,
  'Categorias com dre_line=receita_bruta (3.01 a 3.99). Só o que virou caixa, reposicionado pela competência.'),
 ('deducoes_devolucoes',      'Devoluções e estornos',      'resultado', 'item',     20, NULL,
  'dre_line=deducoes (3.90). Esperado negativo.'),
 ('deducoes_impostos',        'Impostos sobre a receita',   'resultado', 'item',     30, NULL,
  'dre_line=impostos (7.01 DAS, 7.02 ISS, 7.03 retenções). Tributo sobre faturamento deduz da receita bruta.'),
 ('receita_liquida',          'Receita líquida',            'resultado', 'subtotal', 40,
  'receita_bruta + deducoes_devolucoes + deducoes_impostos', 'Receita depois dos tributos sobre faturamento e das devoluções.'),
 ('custos_diretos',           'Custos diretos',             'resultado', 'item',     50, NULL,
  'dre_line=custos_servicos (4.01 a 4.05). Custo que só existe porque o serviço foi prestado.'),
 ('margem_contribuicao',      'Margem de contribuição',     'resultado', 'subtotal', 60,
  'receita_liquida + custos_diretos', 'O que sobra para pagar a estrutura.'),
 ('despesas_pessoal',         'Pessoal',                    'resultado', 'item',     70, NULL,
  'dre_line=despesas_pessoal (6.01 a 6.08). Competência pela convenção da folha (ver fin_competence_rule).'),
 ('despesas_comerciais',      'Comerciais',                 'resultado', 'item',     80, NULL,
  'dre_line=despesas_comerciais (5.05 marketing, 5.06 viagens e representação).'),
 ('despesas_administrativas', 'Administrativas',            'resultado', 'item',     90, NULL,
  'dre_line=despesas_administrativas (5.01 a 5.11 e 5.99).'),
 ('resultado_operacional',    'Resultado operacional',      'resultado', 'subtotal', 100,
  'margem_contribuicao + despesas_pessoal + despesas_comerciais + despesas_administrativas',
  'EBIT gerencial. Sem depreciação, porque não há registro de imobilizado — o CAPEX é baixado direto.'),
 ('resultado_financeiro',     'Resultado financeiro',       'resultado', 'item',     110, NULL,
  'dre_line=resultado_financeiro (9.10 rendimentos, 9.11 juros e multas, 9.12 marcação).'),
 ('lair',                     'LAIR',                       'resultado', 'subtotal', 120,
  'resultado_operacional + resultado_financeiro', 'Lucro antes do imposto de renda.'),
 ('irpj_csll',                'IRPJ e CSLL',                'resultado', 'item',     130, NULL,
  'ZERO por construção no Simples Nacional: IRPJ e CSLL já estão dentro do DAS, que foi deduzido da '
  'receita bruta. Cobrá-los aqui contaria o mesmo imposto duas vezes.'),
 ('lucro_liquido',            'Lucro líquido',              'resultado', 'subtotal', 140,
  'lair + irpj_csll', 'Resultado do que está classificado. Ler junto com lucro_liquido_com_lacunas.'),

 ('fora_investimento_capex',  'CAPEX (fora da DRE)',        'fora',      'item',     200, NULL,
  'dre_line=investimentos (8.01 a 8.04). Saída de caixa que vira ativo, não despesa do período. '
  'Sem registro de imobilizado nem política de depreciação, não há como amortizar — fica fora e visível.'),
 ('fora_movimentacao',        'Movimentação financeira',    'fora',      'item',     210, NULL,
  'cash_flow_group=movimentacao (9.01 a 9.05) exceto pagamento de fatura. Transferência entre contas '
  'próprias, aplicação, resgate, aporte, amortização. NEUTRA na DRE por invariante.'),
 ('fora_cartao_fatura_paga',  'Faturas de cartão pagas',    'fora',      'item',     220, NULL,
  'Lançamentos do ledger que liquidam fatura de cartão (fin_card_bill.paid_transaction_id). É caixa, '
  'não é despesa: o custo está nos itens. NUNCA somar com lacuna_cartao_sem_categoria.'),

 ('lacuna_ledger_sem_categoria', 'Ledger sem categoria',    'lacuna',    'item',     300, NULL,
  'Lançamentos bancários com category_id nulo. Não dá para colocá-los em linha nenhuma sem inventar.'),
 ('lacuna_cartao_sem_categoria', 'Cartão sem categoria',    'lacuna',    'item',     310, NULL,
  'Itens de cartão sem categoria, na competência da compra. Hoje é 100% dos itens.'),
 ('lucro_liquido_com_lacunas','Lucro líquido com lacunas',  'lacuna',    'subtotal', 320,
  'lucro_liquido + lacuna_ledger_sem_categoria + lacuna_cartao_sem_categoria',
  'O piso do resultado, supondo que TODA lacuna seja despesa. O número verdadeiro está entre este e '
  'lucro_liquido. Publicar só um dos dois é escolher pelo leitor.')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, secao = EXCLUDED.secao, tipo = EXCLUDED.tipo,
      ordem = EXCLUDED.ordem, formula = EXCLUDED.formula, descricao = EXCLUDED.descricao;

-- ---------------------------------------------------------------------------
-- 2. O FATO — uma linha por lançamento, já com a linha de DRE e as dimensões
-- ---------------------------------------------------------------------------
-- Tudo que vem depois agrega esta view. Se um número da DRE estiver estranho, é
-- aqui que se acha o lançamento: filtre por linha e mês e veja o id.
--
-- `mes_caixa` NULO significa "não tem data de caixa própria" — é o caso dos
-- itens de cartão, cujo caixa é o pagamento da fatura, um lançamento diferente.
-- Isso é o que mantém o item fora da visão de caixa sem precisar de exceção
-- espalhada por cada consumidor.
CREATE OR REPLACE VIEW fin_dre_lancamento_v AS
-- --- ledger bancário -------------------------------------------------------
SELECT
  'ledger'::text                                       AS origem,
  t.id                                                 AS lancamento_id,
  t.entity_id,
  t.account_id,
  date_trunc('month', t.posted_on)::date               AS mes_caixa,
  date_trunc('month', t.competence_date)::date         AS mes_competencia,
  t.posted_on,
  t.competence_date,
  t.competence_rule,
  cr.confianca                                         AS competencia_confianca,
  CASE
    WHEN cb.id IS NOT NULL                             THEN 'fora_cartao_fatura_paga'
    WHEN c.id IS NULL                                  THEN 'lacuna_ledger_sem_categoria'
    WHEN c.dre_line = 'receita_bruta'                  THEN 'receita_bruta'
    WHEN c.dre_line = 'deducoes'                       THEN 'deducoes_devolucoes'
    WHEN c.dre_line = 'impostos'                       THEN 'deducoes_impostos'
    WHEN c.dre_line = 'custos_servicos'                THEN 'custos_diretos'
    WHEN c.dre_line = 'despesas_pessoal'               THEN 'despesas_pessoal'
    WHEN c.dre_line = 'despesas_comerciais'            THEN 'despesas_comerciais'
    WHEN c.dre_line = 'despesas_administrativas'       THEN 'despesas_administrativas'
    WHEN c.dre_line = 'resultado_financeiro'           THEN 'resultado_financeiro'
    WHEN c.dre_line = 'investimentos'                  THEN 'fora_investimento_capex'
    ELSE 'fora_movimentacao'
  END                                                  AS linha,
  c.code                                               AS categoria_code,
  t.nucleo,
  t.counterparty_id,
  t.cost_center_id,
  t.amount_cents
FROM fin_transaction t
LEFT JOIN fin_category c        ON c.id = t.category_id
LEFT JOIN fin_competence_rule cr ON cr.slug = t.competence_rule
LEFT JOIN fin_card_bill cb      ON cb.paid_transaction_id = t.id
WHERE NOT t.is_split_parent

UNION ALL

-- --- itens de cartão -------------------------------------------------------
-- Sinal invertido: em fin_card_transaction a compra é POSITIVA (é dívida no
-- cartão) e o pagamento é negativo. Na DRE, custo é negativo. A inversão
-- acontece aqui, uma vez, e não em cada consumidor.
--
-- `pagamento_fatura` fica de fora: é liquidação dentro do extrato do cartão, e
-- somá-lo anularia o custo dos itens que ele pagou.
SELECT
  'cartao'::text,
  ct.id,
  ca.entity_id,
  NULL::bigint                                         AS account_id,
  NULL::date                                           AS mes_caixa,
  date_trunc('month', ct.competence_date)::date        AS mes_competencia,
  NULL::date                                           AS posted_on,
  ct.competence_date,
  ct.competence_rule,
  cr.confianca,
  CASE
    WHEN c.id IS NULL                                  THEN 'lacuna_cartao_sem_categoria'
    WHEN c.dre_line = 'receita_bruta'                  THEN 'receita_bruta'
    WHEN c.dre_line = 'deducoes'                       THEN 'deducoes_devolucoes'
    WHEN c.dre_line = 'impostos'                       THEN 'deducoes_impostos'
    WHEN c.dre_line = 'custos_servicos'                THEN 'custos_diretos'
    WHEN c.dre_line = 'despesas_pessoal'               THEN 'despesas_pessoal'
    WHEN c.dre_line = 'despesas_comerciais'            THEN 'despesas_comerciais'
    WHEN c.dre_line = 'despesas_administrativas'       THEN 'despesas_administrativas'
    WHEN c.dre_line = 'resultado_financeiro'           THEN 'resultado_financeiro'
    WHEN c.dre_line = 'investimentos'                  THEN 'fora_investimento_capex'
    ELSE 'fora_movimentacao'
  END,
  c.code,
  ct.nucleo,
  ct.counterparty_id,
  ct.cost_center_id,
  -ct.amount_cents
FROM fin_card_transaction ct
JOIN fin_card_account ca         ON ca.id = ct.card_account_id
LEFT JOIN fin_category c         ON c.id = ct.category_id
LEFT JOIN fin_competence_rule cr ON cr.slug = ct.competence_rule
WHERE ct.kind <> 'pagamento_fatura';

COMMENT ON VIEW fin_dre_lancamento_v IS
  'O fato da DRE: uma linha por lançamento do ledger e por item de cartão, já com a linha da DRE, '
  'as duas datas (caixa e competência) e as três dimensões (núcleo, cliente, centro de custo). '
  'mes_caixa NULO = o item não tem caixa próprio (cartão); ele existe só na visão competência. '
  'Sinal natural: receita positiva, custo negativo — os itens de cartão já vêm invertidos aqui.';

-- ---------------------------------------------------------------------------
-- 3. A DRE MENSAL — formato largo, uma linha por visão e mês
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_dre_mensal_v AS
WITH base AS (
  SELECT v.visao, v.mes, l.linha, l.amount_cents, l.entity_id
    FROM fin_dre_lancamento_v l
    CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
                 AS v(visao, mes)
   WHERE v.mes IS NOT NULL
),
g AS (
  SELECT visao, mes, entity_id,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'receita_bruta'), 0)               AS receita_bruta_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'deducoes_devolucoes'), 0)         AS deducoes_devolucoes_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'deducoes_impostos'), 0)           AS deducoes_impostos_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'custos_diretos'), 0)              AS custos_diretos_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'despesas_pessoal'), 0)            AS despesas_pessoal_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'despesas_comerciais'), 0)         AS despesas_comerciais_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'despesas_administrativas'), 0)    AS despesas_administrativas_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'resultado_financeiro'), 0)        AS resultado_financeiro_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'fora_investimento_capex'), 0)     AS capex_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'fora_movimentacao'), 0)           AS movimentacao_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'fora_cartao_fatura_paga'), 0)     AS cartao_fatura_paga_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'lacuna_ledger_sem_categoria'), 0) AS lacuna_ledger_cents,
    COALESCE(sum(amount_cents) FILTER (WHERE linha = 'lacuna_cartao_sem_categoria'), 0) AS lacuna_cartao_cents,
    count(*)                                                                            AS lancamentos
  FROM base GROUP BY visao, mes, entity_id
)
SELECT g.visao, g.mes, g.entity_id,
  g.receita_bruta_cents,
  g.deducoes_devolucoes_cents,
  g.deducoes_impostos_cents,
  (g.deducoes_devolucoes_cents + g.deducoes_impostos_cents)             AS deducoes_cents,
  (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents)                                       AS receita_liquida_cents,
  g.custos_diretos_cents,
  (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents + g.custos_diretos_cents)              AS margem_contribuicao_cents,
  g.despesas_pessoal_cents,
  g.despesas_comerciais_cents,
  g.despesas_administrativas_cents,
  (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents + g.custos_diretos_cents
     + g.despesas_pessoal_cents + g.despesas_comerciais_cents
     + g.despesas_administrativas_cents)                                AS resultado_operacional_cents,
  g.resultado_financeiro_cents,
  (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents + g.custos_diretos_cents
     + g.despesas_pessoal_cents + g.despesas_comerciais_cents
     + g.despesas_administrativas_cents + g.resultado_financeiro_cents) AS lair_cents,
  0::bigint                                                             AS irpj_csll_cents,
  (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents + g.custos_diretos_cents
     + g.despesas_pessoal_cents + g.despesas_comerciais_cents
     + g.despesas_administrativas_cents + g.resultado_financeiro_cents) AS lucro_liquido_cents,
  g.capex_cents,
  g.movimentacao_cents,
  g.cartao_fatura_paga_cents,
  g.lacuna_ledger_cents,
  g.lacuna_cartao_cents,
  (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents + g.custos_diretos_cents
     + g.despesas_pessoal_cents + g.despesas_comerciais_cents
     + g.despesas_administrativas_cents + g.resultado_financeiro_cents
     + g.lacuna_ledger_cents + g.lacuna_cartao_cents)                   AS lucro_liquido_com_lacunas_cents,
  -- Margem sobre receita líquida. NULL quando não há receita — dividir por zero
  -- e devolver 0% diria "margem zero", que é uma afirmação diferente de "não dá
  -- para calcular".
  round(100.0 * (g.receita_bruta_cents + g.deducoes_devolucoes_cents
     + g.deducoes_impostos_cents + g.custos_diretos_cents
     + g.despesas_pessoal_cents + g.despesas_comerciais_cents
     + g.despesas_administrativas_cents + g.resultado_financeiro_cents)
    / NULLIF(g.receita_bruta_cents + g.deducoes_devolucoes_cents
             + g.deducoes_impostos_cents, 0)::numeric, 2)               AS margem_liquida_pct,
  g.lancamentos
FROM g;

COMMENT ON VIEW fin_dre_mensal_v IS
  'DRE gerencial mensal em formato largo. FILTRE POR visao: ''caixa'' (posted_on) ou '
  '''competencia'' (competence_date da 0071). Somar as duas dobra o resultado. Sinal natural: '
  'despesas são negativas e os subtotais são somas. lucro_liquido cobre só o que está '
  'classificado; lucro_liquido_com_lacunas é o piso se toda lacuna for despesa — o número real '
  'está entre os dois. Não é DRE contábil: sem partida dobrada, sem depreciação, e com 5,6% das '
  'competências presumidas (ver fin_competencia_cobertura_v).';

-- ---------------------------------------------------------------------------
-- 4. FORMATO LONGO — uma linha por linha da DRE, para renderizar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_dre_v AS
SELECT m.visao, m.mes, m.entity_id, d.slug AS linha, d.name AS linha_nome,
       d.secao, d.tipo, d.ordem, d.formula,
       CASE d.slug
         WHEN 'receita_bruta'               THEN m.receita_bruta_cents
         WHEN 'deducoes_devolucoes'         THEN m.deducoes_devolucoes_cents
         WHEN 'deducoes_impostos'           THEN m.deducoes_impostos_cents
         WHEN 'receita_liquida'             THEN m.receita_liquida_cents
         WHEN 'custos_diretos'              THEN m.custos_diretos_cents
         WHEN 'margem_contribuicao'         THEN m.margem_contribuicao_cents
         WHEN 'despesas_pessoal'            THEN m.despesas_pessoal_cents
         WHEN 'despesas_comerciais'         THEN m.despesas_comerciais_cents
         WHEN 'despesas_administrativas'    THEN m.despesas_administrativas_cents
         WHEN 'resultado_operacional'       THEN m.resultado_operacional_cents
         WHEN 'resultado_financeiro'        THEN m.resultado_financeiro_cents
         WHEN 'lair'                        THEN m.lair_cents
         WHEN 'irpj_csll'                   THEN m.irpj_csll_cents
         WHEN 'lucro_liquido'               THEN m.lucro_liquido_cents
         WHEN 'fora_investimento_capex'     THEN m.capex_cents
         WHEN 'fora_movimentacao'           THEN m.movimentacao_cents
         WHEN 'fora_cartao_fatura_paga'     THEN m.cartao_fatura_paga_cents
         WHEN 'lacuna_ledger_sem_categoria' THEN m.lacuna_ledger_cents
         WHEN 'lacuna_cartao_sem_categoria' THEN m.lacuna_cartao_cents
         WHEN 'lucro_liquido_com_lacunas'   THEN m.lucro_liquido_com_lacunas_cents
       END AS valor_cents
  FROM fin_dre_mensal_v m
  CROSS JOIN fin_dre_linha d;

COMMENT ON VIEW fin_dre_v IS
  'fin_dre_mensal_v em formato longo, uma linha por linha da DRE, com seção, tipo e fórmula. '
  'ORDER BY ordem devolve a demonstração na sequência de leitura. Filtre visao.';

-- ---------------------------------------------------------------------------
-- 5. ACUMULADO — do início do ano até o mês
-- ---------------------------------------------------------------------------
-- Acumulado do EXERCÍCIO (reinicia em janeiro), que é o que a DRE acumulada
-- significa. Quem quiser 12 meses móveis usa a janela sobre fin_dre_mensal_v.
CREATE OR REPLACE VIEW fin_dre_acumulado_v AS
SELECT visao, mes, entity_id,
  date_trunc('year', mes)::date AS exercicio,
  sum(receita_bruta_cents)             OVER w AS receita_bruta_cents,
  sum(deducoes_cents)                  OVER w AS deducoes_cents,
  sum(receita_liquida_cents)           OVER w AS receita_liquida_cents,
  sum(custos_diretos_cents)            OVER w AS custos_diretos_cents,
  sum(margem_contribuicao_cents)       OVER w AS margem_contribuicao_cents,
  sum(despesas_pessoal_cents)          OVER w AS despesas_pessoal_cents,
  sum(despesas_comerciais_cents)       OVER w AS despesas_comerciais_cents,
  sum(despesas_administrativas_cents)  OVER w AS despesas_administrativas_cents,
  sum(resultado_operacional_cents)     OVER w AS resultado_operacional_cents,
  sum(resultado_financeiro_cents)      OVER w AS resultado_financeiro_cents,
  sum(lair_cents)                      OVER w AS lair_cents,
  sum(irpj_csll_cents)                 OVER w AS irpj_csll_cents,
  sum(lucro_liquido_cents)             OVER w AS lucro_liquido_cents,
  sum(capex_cents)                     OVER w AS capex_cents,
  sum(lacuna_ledger_cents + lacuna_cartao_cents) OVER w AS lacunas_cents,
  sum(lucro_liquido_com_lacunas_cents) OVER w AS lucro_liquido_com_lacunas_cents
FROM fin_dre_mensal_v
WINDOW w AS (PARTITION BY visao, entity_id, date_trunc('year', mes) ORDER BY mes
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);

COMMENT ON VIEW fin_dre_acumulado_v IS
  'DRE acumulada do exercício (reinicia em janeiro), por visão e mês. Para 12 meses móveis, use '
  'uma janela própria sobre fin_dre_mensal_v — acumulado de exercício e móvel respondem perguntas '
  'diferentes e nunca devem ser comparados entre si.';

-- ---------------------------------------------------------------------------
-- 6. OS CORTES: núcleo, cliente e centro de custo
-- ---------------------------------------------------------------------------
-- Grão mais fino possível. Quem quiser um corte só agrega o que precisa e
-- ignora o resto — o contrário (view por corte) multiplicaria a mesma lógica
-- por três e criaria três jeitos de o número divergir.
--
-- AVISO DE COBERTURA, que precisa acompanhar todo uso desta view:
--   núcleo ......... 90,3% dos lançamentos (97,7% dos que chegam à DRE)
--   cliente ........ 37,6% — quase toda a receita tem, quase nenhuma despesa
--   centro de custo .. 0,8% (35 lançamentos dos 12.786 que chegam à DRE)
-- Cortar despesa por centro de custo hoje devolve quase tudo em NULL. Isso é
-- limitação de FONTE, não desta view: o erp-obras carimba projeto sobretudo em
-- movimento de tesouraria.
CREATE OR REPLACE VIEW fin_dre_dimensao_v AS
WITH base AS (
  SELECT v.visao, v.mes, l.entity_id, l.nucleo, l.counterparty_id, l.cost_center_id,
         l.linha, l.amount_cents
    FROM fin_dre_lancamento_v l
    CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
                 AS v(visao, mes)
   WHERE v.mes IS NOT NULL
)
SELECT b.visao, b.mes, b.entity_id,
  b.nucleo,
  b.counterparty_id,
  cp.name                     AS cliente,
  b.cost_center_id,
  cc.name                     AS centro_custo,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'receita_bruta'), 0)               AS receita_bruta_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha IN ('deducoes_devolucoes','deducoes_impostos')), 0) AS deducoes_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'custos_diretos'), 0)              AS custos_diretos_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'despesas_pessoal'), 0)            AS despesas_pessoal_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'despesas_comerciais'), 0)         AS despesas_comerciais_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'despesas_administrativas'), 0)    AS despesas_administrativas_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'resultado_financeiro'), 0)        AS resultado_financeiro_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha IN
      ('receita_bruta','deducoes_devolucoes','deducoes_impostos','custos_diretos',
       'despesas_pessoal','despesas_comerciais','despesas_administrativas',
       'resultado_financeiro')), 0)                                                       AS lucro_liquido_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'fora_investimento_capex'), 0)     AS capex_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'fora_movimentacao'), 0)           AS movimentacao_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha = 'fora_cartao_fatura_paga'), 0)     AS cartao_fatura_paga_cents,
  COALESCE(sum(b.amount_cents) FILTER (WHERE b.linha IN
      ('lacuna_ledger_sem_categoria','lacuna_cartao_sem_categoria')), 0)                  AS lacunas_cents,
  count(*)                                                                                AS lancamentos
FROM base b
LEFT JOIN fin_counterparty cp ON cp.id = b.counterparty_id
LEFT JOIN fin_cost_center  cc ON cc.id = b.cost_center_id
GROUP BY b.visao, b.mes, b.entity_id, b.nucleo, b.counterparty_id, cp.name,
         b.cost_center_id, cc.name;

COMMENT ON VIEW fin_dre_dimensao_v IS
  'DRE no grão mais fino: visão × mês × núcleo × cliente × centro de custo. Agregue para obter o '
  'corte que quiser; a soma sobre todas as dimensões reproduz fin_dre_mensal_v exatamente. NULL em '
  'nucleo/cliente/centro de custo é AUSÊNCIA de dimensão, não um grupo — filtrar por uma dimensão '
  'esconde essas linhas e o total deixa de fechar, que é o comportamento correto e precisa estar à '
  'vista. Cobertura hoje: núcleo 90,3%, cliente 37,6%, centro de custo 0,8%.';

-- ---------------------------------------------------------------------------
-- 7. COBERTURA — o que sustenta cada número da DRE
-- ---------------------------------------------------------------------------
-- Esta view é obrigatória junto de qualquer publicação da DRE. Ela responde,
-- por mês: quanto do resultado depende de competência presumida, quanto de
-- dinheiro a DRE não conseguiu classificar, e qual fração tem dimensão.
--
-- E responde uma quarta pergunta, que só aparece quando a competência é
-- DERIVADA do caixa — como é o caso aqui, porque não há lançamento contábil
-- independente do extrato:
--
--   O MÊS CORRENTE ESTÁ SEMPRE INCOMPLETO NA VISÃO COMPETÊNCIA.
--
-- O exemplo que salta aos olhos é a folha. Salário de agosto é pago no dia 1º
-- de setembro; até lá, agosto aparece com R$ 0,00 de pessoal e um lucro
-- espetacular que não existe. Medido nesta base em 15/08/2026: agosto mostra
-- R$ 41.280,36 de resultado operacional com pessoal ZERO, enquanto os meses
-- fechados carregam R$ 82 mil a R$ 106 mil de folha.
--
-- A coluna `folha_do_mes_ja_paga` responde isso diretamente: FALSE significa
-- "este mês ainda não viu a folha dele, o resultado está superestimado". Não
-- estimamos a folha faltante — estimar é o que esta plataforma não faz. Diz-se
-- que falta, e quanto costuma ser (`folha_media_3m_cents`).

CREATE OR REPLACE VIEW fin_dre_cobertura_v AS
WITH base AS (
  SELECT v.visao, v.mes, l.*
    FROM fin_dre_lancamento_v l
    CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
                 AS v(visao, mes)
   WHERE v.mes IS NOT NULL
),
resultado AS (
  SELECT visao, mes,
         count(*) AS linhas,
         sum(abs(amount_cents)) AS bruto_cents,
         count(*) FILTER (WHERE competencia_confianca = 'presumida')            AS linhas_presumidas,
         sum(abs(amount_cents)) FILTER (WHERE competencia_confianca = 'presumida') AS bruto_presumido_cents,
         count(*) FILTER (WHERE competencia_confianca = 'convencao')            AS linhas_convencao,
         count(*) FILTER (WHERE nucleo IS NOT NULL)                             AS linhas_com_nucleo,
         count(*) FILTER (WHERE counterparty_id IS NOT NULL)                    AS linhas_com_cliente,
         count(*) FILTER (WHERE cost_center_id IS NOT NULL)                     AS linhas_com_centro_custo
    FROM base
   WHERE linha NOT IN ('fora_movimentacao', 'fora_cartao_fatura_paga')
   GROUP BY visao, mes
)
SELECT r.visao, r.mes,
  r.linhas,
  r.bruto_cents,
  r.linhas_presumidas,
  round(100.0 * r.linhas_presumidas / NULLIF(r.linhas, 0), 2)                AS pct_linhas_presumidas,
  round(100.0 * r.bruto_presumido_cents / NULLIF(r.bruto_cents, 0), 2)       AS pct_valor_presumido,
  r.linhas_convencao,
  round(100.0 * r.linhas_com_nucleo / NULLIF(r.linhas, 0), 2)                AS pct_nucleo,
  round(100.0 * r.linhas_com_cliente / NULLIF(r.linhas, 0), 2)               AS pct_cliente,
  round(100.0 * r.linhas_com_centro_custo / NULLIF(r.linhas, 0), 2)          AS pct_centro_custo,
  m.lucro_liquido_cents,
  m.lacuna_ledger_cents + m.lacuna_cartao_cents                              AS lacunas_cents,
  -- Quanto o resultado pode piorar se toda lacuna for despesa, em % do próprio
  -- resultado. É a medida honesta de "quão firme é este lucro".
  round(100.0 * abs(m.lacuna_ledger_cents + m.lacuna_cartao_cents)
        / NULLIF(abs(m.lucro_liquido_cents), 0), 2)                          AS lacuna_sobre_resultado_pct,
  -- Na visão caixa o mês fecha quando o mês acaba. Na visão competência ele só
  -- fecha quando o caixa que o alimenta acontece — e a folha é o caso mais
  -- caro. Sem esta coluna, o mês corrente parece o melhor da série.
  (r.visao = 'caixa' OR m.despesas_pessoal_cents <> 0)                       AS folha_do_mes_ja_paga,
  (SELECT round(avg(x.despesas_pessoal_cents))
     FROM fin_dre_mensal_v x
    WHERE x.visao = r.visao AND x.mes < r.mes AND x.mes >= r.mes - INTERVAL '3 months'
      AND x.despesas_pessoal_cents <> 0)::bigint                             AS folha_media_3m_cents
FROM resultado r
JOIN fin_dre_mensal_v m ON m.visao = r.visao AND m.mes = r.mes;

COMMENT ON VIEW fin_dre_cobertura_v IS
  'O que sustenta cada mês da DRE: fração de linhas e de valor cuja competência é PRESUMIDA '
  '(igual ao caixa por falta de evidência), fração com convenção declarada, cobertura das três '
  'dimensões, e o tamanho da lacuna sobre o resultado. Publicar a DRE sem esta view é apresentar '
  'como firme um número que tem suposição dentro. folha_do_mes_ja_paga=false marca mês de '
  'competência ainda incompleto: a folha dele será paga no mês seguinte e o resultado exibido '
  'está superestimado em torno de folha_media_3m_cents.';

-- ---------------------------------------------------------------------------
-- 8. COERÊNCIA DE SINAL — o diagnóstico que impede número bonito e errado
-- ---------------------------------------------------------------------------
-- Uma linha de dedução positiva INFLA a receita líquida. Um custo positivo
-- infla a margem. Nenhum dos dois quebra soma nenhuma, e é exatamente por isso
-- que precisam de uma view que os aponte pelo nome.
--
-- Caso conhecido nesta base, encontrado ao escrever esta migration: 7 estornos
-- de PIX de DÉBITO (source_kind='PIX_TRANSACTION_DEBIT_REFUND', R$ +23.650,83)
-- estão em 3.90 "Estornos e devoluções", que é `deducao_receita`. São devoluções
-- de dinheiro que a EMPRESA pagou — recuperação de despesa (9.02), não dedução
-- de receita. Classificados como estão, aumentam a receita líquida em vez de
-- reduzir despesa. Não foram reclassificados aqui: mexer em classificação exige
-- evidência do lançamento original e é decisão de outra frente. Ficam apontados.
CREATE OR REPLACE VIEW fin_dre_coerencia_v AS
SELECT l.visao, l.mes, l.linha, l.sinal_esperado,
       count(*) AS lancamentos, sum(l.amount_cents) AS valor_cents
  FROM (
    SELECT v.visao, v.mes, b.linha, b.amount_cents,
           CASE b.linha
             WHEN 'receita_bruta'            THEN 'positivo'
             WHEN 'deducoes_devolucoes'      THEN 'negativo'
             WHEN 'deducoes_impostos'        THEN 'negativo'
             WHEN 'custos_diretos'           THEN 'negativo'
             WHEN 'despesas_pessoal'         THEN 'negativo'
             WHEN 'despesas_comerciais'      THEN 'negativo'
             WHEN 'despesas_administrativas' THEN 'negativo'
             ELSE NULL
           END AS sinal_esperado
      FROM fin_dre_lancamento_v b
      CROSS JOIN LATERAL (VALUES ('caixa', b.mes_caixa), ('competencia', b.mes_competencia))
                   AS v(visao, mes)
     WHERE v.mes IS NOT NULL
  ) l
 WHERE l.sinal_esperado IS NOT NULL
   AND ((l.sinal_esperado = 'positivo' AND l.amount_cents < 0)
     OR (l.sinal_esperado = 'negativo' AND l.amount_cents > 0))
 GROUP BY l.visao, l.mes, l.linha, l.sinal_esperado;

COMMENT ON VIEW fin_dre_coerencia_v IS
  'Lançamentos cujo sinal contradiz a natureza da linha da DRE: dedução positiva, custo positivo, '
  'receita negativa. Não quebram nenhuma soma — por isso passam despercebidos e por isso esta view '
  'existe. Linha aqui é classificação a revisar, não erro de cálculo.';
