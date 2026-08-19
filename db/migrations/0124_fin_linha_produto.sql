-- Linha de produto — a segunda pergunta que o dinheiro responde.
--
-- O plano de contas (fin_category) responde "que natureza de dinheiro é isto?"
-- — taxonomia contábil, por tipo de serviço (3.01 Consultoria e Auditoria, 3.05
-- Obras e Adequações, 3.07 Medição e Monitoramento...). A planilha "Revisão -
-- Gestão & Finanças - XPE 2026.xlsx" que o Fernando trouxe faz outra pergunta:
-- "que produto vendemos?" — Assinatura Low Cost, Locação de Usinas,
-- Consultorias com Base em Economia. Uma linha de produto AGRUPA categorias
-- (Adequação Tarifária + Obras + Consultoria Condomínios + Auditorias +
-- Comissão Mercado Livre = uma linha só), e várias linhas da planilha original
-- estão mortas (modelagem antiga reaproveitada, dito pelo próprio Fernando).
--
-- NASCE VAZIA, DE PROPÓSITO
--
-- O Fernando foi explícito: "quero permitir unificar algumas ou mudar o nome
-- depois... isso tudo planejado na interface." Ele quer criar, renomear,
-- unificar e desativar linhas ELE MESMO, pela tela, iterativamente — não uma
-- migration que decide por ele. A própria planilha está incompleta ("faltou
-- continuar fazendo ficaram sem preenchimento"). Codificar um mapeamento fixo
-- aqui seria uma migration que mente no dia 1. Mesmo padrão de
-- fin_cash_flow_group (0001): nasceu vazia porque "os nomes exatos ainda são
-- pendência com o negócio".
--
-- O MAPEAMENTO MORA NA CATEGORIA, NÃO NO LANÇAMENTO
--
-- fin_category.product_line_id, nullable. Zero backfill nos ~14.000
-- lançamentos existentes — eles já têm category_id; só ~14 categorias
-- precisam de uma atribuição, feita pela tela. Categoria → linha é N:1: cada
-- lançamento pertence a exatamente uma linha (a da sua categoria), e as somas
-- se preservam por construção.
--
-- ESTA MIGRATION NÃO MUDA UM CENTAVO DA DRE ATUAL
--
-- A seção de pós-condições prova isso comparando fin_dre_mensal_v inteira,
-- linha a linha, com um retrato tirado antes de qualquer DDL — dentro da
-- mesma transação.

-- ---------------------------------------------------------------------------
-- 0. O retrato de antes — para provar ausência de regressão, não só
--    autoconsistência
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _0124_dre_antes ON COMMIT DROP AS
  SELECT visao, mes, entity_id, receita_bruta_cents, lucro_liquido_cents, lancamentos
    FROM fin_dre_mensal_v;

-- ---------------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------------
-- id bigserial, não slug: fin_audit_log.target_id é bigint NOT NULL (0004),
-- e sem PK numérica não há trilha honesta de quem criou/renomeou o quê. É
-- também a convenção do schema: fin_nucleo/fin_cash_flow_group (slug PK) são
-- vocabulário de sistema sem tela de gestão; fin_category/fin_account/
-- fin_cost_center (id bigserial + UNIQUE(entity_id,slug)) são objetos que o
-- usuário cria pela tela. Linha de produto é do segundo grupo.
CREATE TABLE IF NOT EXISTS fin_product_line (
  id         bigserial PRIMARY KEY,
  entity_id  bigint NOT NULL REFERENCES fin_entity(id),
  slug       text NOT NULL,
  name       text NOT NULL,
  descricao  text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, slug),
  CONSTRAINT fin_product_line_slug_formato   CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT fin_product_line_nome_nao_vazio CHECK (btrim(name) <> '')
);

-- Duas linhas ATIVAS com o mesmo nome viram duas fatias idênticas e
-- indistinguíveis no relatório por dimensão — e é exatamente o risco deste
-- pedido: o plano do Fernando é CONVERGIR nomes ("Monitor BT e Monitor AT
-- seriam juntos"). Unir é MOVER as categorias de uma linha para a outra e
-- desativar a que ficou vazia — nunca dar o mesmo nome a duas linhas ativas.
CREATE UNIQUE INDEX IF NOT EXISTS fin_product_line_nome_ativo_unico
  ON fin_product_line (entity_id, lower(btrim(name))) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. A coluna em fin_category
-- ---------------------------------------------------------------------------
ALTER TABLE fin_category
  ADD COLUMN IF NOT EXISTS product_line_id bigint REFERENCES fin_product_line(id);

CREATE INDEX IF NOT EXISTS fin_category_product_line_idx
  ON fin_category (product_line_id) WHERE product_line_id IS NOT NULL;

-- 3.99 e 5.99 são marcadores de indecisão, não linhas do plano de contas
-- (comentário da 0101 explica por quê). Atribuir linha de produto a elas
-- diria que R$ 112 mil de dinheiro que ninguém classificou pertencem a um
-- produto. O gatilho fin_category_marcador_indecisao_guard (0101) trava
-- code/name/kind/cash_flow_group/dre_line/parent_id/is_active para essas duas
-- linhas e não conhece esta coluna nova — um CHECK fecha o flanco sem
-- reescrever a função inteira.
ALTER TABLE fin_category
  ADD CONSTRAINT fin_category_marcador_sem_linha_produto
  CHECK (product_line_id IS NULL OR code NOT IN ('3.99', '5.99'));

-- ---------------------------------------------------------------------------
-- 3. fin_linha_produto_uso_v — a régua única de desativação
-- ---------------------------------------------------------------------------
-- Espelha fin_categoria_uso_v (0101): o uso vivo é reaproveitado dessa view
-- (LEFT JOIN LATERAL), não recontado — recontar foi o que fez o M13 chamar
-- 5.11 de linha morta enquanto um item de cartão de R$ 1.222,56 vivia nela
-- (0094). A função de escrita e a tela leem a mesma régua: pode_desativar e
-- motivo_bloqueio nascem aqui uma vez só.
CREATE OR REPLACE VIEW fin_linha_produto_uso_v AS
WITH uso AS (
  SELECT pl.id,
         count(c.id)                                          AS n_categorias,
         count(c.id) FILTER (WHERE c.is_active)                AS n_categorias_ativas,
         COALESCE(array_agg(c.code ORDER BY c.code) FILTER (WHERE c.id IS NOT NULL), '{}') AS categorias_codes,
         COALESCE(sum(u.n_vivo), 0)                            AS n_vivo,
         COALESCE(sum(u.valor_vivo_cents), 0)                  AS valor_vivo_cents
    FROM fin_product_line pl
    LEFT JOIN fin_category c ON c.product_line_id = pl.id
    LEFT JOIN LATERAL (
      SELECT cu.n_vivo, cu.valor_vivo_cents
        FROM fin_categoria_uso_v cu
       WHERE cu.id = c.id
    ) u ON true
   GROUP BY pl.id
)
SELECT pl.id, pl.entity_id, pl.slug, pl.name, pl.descricao, pl.sort_order, pl.is_active,
       u.n_categorias, u.n_categorias_ativas, u.categorias_codes, u.n_vivo, u.valor_vivo_cents,
       (u.n_categorias_ativas = 0)                             AS pode_desativar,
       CASE
         WHEN u.n_categorias_ativas = 0 THEN NULL
         ELSE format('%s categoria(s) ainda apontam para ela — %s, somando %s vivo(s) (%s)',
                      u.n_categorias_ativas,
                      array_to_string(u.categorias_codes, ', '),
                      u.n_vivo,
                      to_char(u.valor_vivo_cents / 100.0, 'FM999G999G990D00'))
       END                                                     AS motivo_bloqueio
  FROM fin_product_line pl
  JOIN uso u ON u.id = pl.id;

COMMENT ON VIEW fin_linha_produto_uso_v IS
  'Uso de cada linha de produto, medido pelas categorias atribuídas a ela — reaproveita '
  'fin_categoria_uso_v (0101) em vez de recontar. pode_desativar é a régua que a rota de '
  'escrita e a tela leem, as duas, sem duplicar a conta.';

-- ---------------------------------------------------------------------------
-- 4. fin_categoria_uso_v — REPLACE, 2 colunas apendadas no FIM
-- ---------------------------------------------------------------------------
-- Corpo copiado verbatim da 0101 (linhas 452-505). CREATE OR REPLACE VIEW não
-- reordena nem insere no meio — a coluna nova vai no fim, sempre.
CREATE OR REPLACE VIEW fin_categoria_uso_v AS
WITH uso AS (
  SELECT c.id,
         (SELECT count(*) FROM fin_transaction      t WHERE t.category_id = c.id AND NOT t.is_split_parent) AS n_lancamento,
         (SELECT count(*) FROM fin_document         d WHERE d.category_id = c.id) AS n_documento,
         (SELECT count(*) FROM fin_card_transaction x WHERE x.category_id = c.id) AS n_item_cartao,
         (SELECT COALESCE(sum(abs(t.amount_cents)), 0) FROM fin_transaction      t WHERE t.category_id = c.id AND NOT t.is_split_parent) AS v_lancamento,
         (SELECT COALESCE(sum(abs(d.amount_cents)), 0) FROM fin_document         d WHERE d.category_id = c.id) AS v_documento,
         (SELECT COALESCE(sum(abs(x.amount_cents)), 0) FROM fin_card_transaction x WHERE x.category_id = c.id) AS v_item_cartao,
         (SELECT count(*) FROM fin_classification_event e WHERE e.category_id = c.id) AS n_eventos,
         (SELECT count(*) FROM fin_rule r
           WHERE r.status <> 'arquivada' AND r.actions->>'category_code' = c.code) AS n_regras,
         (SELECT count(*) FROM fin_card_classificacao_regra cr WHERE cr.category_id = c.id AND cr.is_active) AS n_regras_cartao,
         (SELECT count(*) FROM fin_counterparty p WHERE p.default_category_id = c.id) AS n_contrapartes
    FROM fin_category c
)
SELECT c.id,
       c.code,
       c.name,
       c.kind,
       c.cash_flow_group,
       c.dre_line,
       c.default_nucleo,
       c.is_active,
       u.n_lancamento, u.n_documento, u.n_item_cartao,
       (u.n_lancamento + u.n_documento + u.n_item_cartao)          AS n_vivo,
       (u.v_lancamento + u.v_documento + u.v_item_cartao)          AS valor_vivo_cents,
       u.n_eventos, u.n_regras, u.n_regras_cartao, u.n_contrapartes,
       (c.code IN ('3.99', '5.99'))                                AS marcador_de_indecisao,
       CASE
         WHEN c.code IN ('3.99', '5.99')                    THEN false
         WHEN u.n_lancamento + u.n_documento + u.n_item_cartao > 0 THEN false
         WHEN u.n_regras + u.n_regras_cartao + u.n_contrapartes > 0 THEN false
         ELSE true
       END                                                        AS pode_desativar,
       CASE
         WHEN c.code IN ('3.99', '5.99')
           THEN 'marcador de indecisão: não é linha do plano de contas e o H3 depende do código'
         WHEN u.n_lancamento + u.n_documento + u.n_item_cartao > 0
           THEN format('%s item(ns) vivo(s) apontam para ela — %s lançamento, %s documento, %s cartão',
                       u.n_lancamento + u.n_documento + u.n_item_cartao,
                       u.n_lancamento, u.n_documento, u.n_item_cartao)
         WHEN u.n_regras + u.n_regras_cartao + u.n_contrapartes > 0
           THEN format('%s regra(s) de lançamento, %s regra(s) de cartão e %s contraparte(s) ainda a produzem',
                       u.n_regras, u.n_regras_cartao, u.n_contrapartes)
         ELSE NULL
       END                                                        AS motivo_bloqueio,
       (u.n_eventos > 0)                                          AS tem_trilha,
       -- Apêndice 0124. Coluna nova vai no FIM: CREATE OR REPLACE VIEW não
       -- reordena nem insere no meio da lista.
       c.product_line_id,
       pl.name                                                    AS linha_produto
  FROM fin_category c
  JOIN uso u ON u.id = c.id
  LEFT JOIN fin_product_line pl ON pl.id = c.product_line_id;

COMMENT ON VIEW fin_categoria_uso_v IS
  'Uso de cada categoria nos TRÊS universos, mais trilha e dependências. '
  'Existe porque "ociosa" e "pode sair do plano" são perguntas diferentes: o '
  'M13 chamou 5.11 de linha morta lendo só duas tabelas, e havia um item de '
  'cartão de R$ 1.222,56 nela (0094). pode_desativar é o que o gatilho '
  'fin_category_desativacao_guard aplica — a view e a recusa leem a mesma régua. '
  'product_line_id/linha_produto (0124) são apêndice: a categoria pode pertencer '
  'a uma linha de produto, opcional.';

-- ---------------------------------------------------------------------------
-- 5. fin_dre_lancamento_v — REPLACE, 1 coluna apendada nos DOIS ramos do
--    UNION ALL
-- ---------------------------------------------------------------------------
-- Corpo copiado verbatim da 0072. UNION ALL exige aridade idêntica nos dois
-- ramos — os dois já fazem LEFT JOIN fin_category (c/ledger, c/cartão), então
-- c.product_line_id está disponível nos dois. NÃO é NULL::bigint no ramo do
-- cartão: "margem por linha de produto" inclui custo de cartão, e um NULL ali
-- ficaria silenciosamente errado assim que uma categoria de custo com linha
-- atribuída receber um item de cartão.
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
  t.amount_cents,
  c.product_line_id                                    AS linha_produto_id
FROM fin_transaction t
LEFT JOIN fin_category c        ON c.id = t.category_id
LEFT JOIN fin_competence_rule cr ON cr.slug = t.competence_rule
LEFT JOIN fin_card_bill cb      ON cb.paid_transaction_id = t.id
WHERE NOT t.is_split_parent

UNION ALL

-- --- itens de cartão -------------------------------------------------------
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
  -ct.amount_cents,
  c.product_line_id
FROM fin_card_transaction ct
JOIN fin_card_account ca         ON ca.id = ct.card_account_id
LEFT JOIN fin_category c         ON c.id = ct.category_id
LEFT JOIN fin_competence_rule cr ON cr.slug = ct.competence_rule
WHERE ct.kind <> 'pagamento_fatura';

COMMENT ON VIEW fin_dre_lancamento_v IS
  'O fato da DRE: uma linha por lançamento do ledger e por item de cartão, já com a linha da DRE, '
  'as duas datas (caixa e competência) e as três dimensões (núcleo, cliente, centro de custo). '
  'mes_caixa NULO = o item não tem caixa próprio (cartão); ele existe só na visão competência. '
  'Sinal natural: receita positiva, custo negativo — os itens de cartão já vêm invertidos aqui. '
  'linha_produto_id (0124) é apêndice: vem da categoria do lançamento, opcional.';

-- ---------------------------------------------------------------------------
-- 6. fin_dre_dimensao_v — REPLACE, linha_produto como 4ª dimensão
-- ---------------------------------------------------------------------------
-- Corpo copiado verbatim da 0072, com linha_produto_id na CTE base e
-- linha_produto_id/linha_produto apendados no fim do SELECT externo.
CREATE OR REPLACE VIEW fin_dre_dimensao_v AS
WITH base AS (
  SELECT v.visao, v.mes, l.entity_id, l.nucleo, l.counterparty_id, l.cost_center_id,
         l.linha, l.amount_cents, l.linha_produto_id
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
  count(*)                                                                                AS lancamentos,
  b.linha_produto_id,
  pl.name                                                                                 AS linha_produto
FROM base b
LEFT JOIN fin_counterparty cp ON cp.id = b.counterparty_id
LEFT JOIN fin_cost_center  cc ON cc.id = b.cost_center_id
LEFT JOIN fin_product_line pl ON pl.id = b.linha_produto_id
GROUP BY b.visao, b.mes, b.entity_id, b.nucleo, b.counterparty_id, cp.name,
         b.cost_center_id, cc.name, b.linha_produto_id, pl.name;

COMMENT ON VIEW fin_dre_dimensao_v IS
  'DRE no grão mais fino: visão × mês × núcleo × cliente × centro de custo × linha de produto. '
  'Agregue para obter o corte que quiser; a soma sobre todas as dimensões reproduz '
  'fin_dre_mensal_v exatamente. NULL em qualquer dimensão é AUSÊNCIA dela, não um grupo — '
  'filtrar por uma dimensão esconde essas linhas e o total deixa de fechar, que é o '
  'comportamento correto e precisa estar à vista. Cobertura hoje: núcleo 90,3%, cliente 37,6%, '
  'centro de custo 0,8%, linha de produto 0% (0124, dimensão nasce vazia).';

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_entity_id       bigint;
  v_n                integer;
  v_categoria_id     bigint;
  v_categoria_code   text;
  v_linha_id         bigint;
  v_receita          bigint;
  v_soma_mensal      bigint;
  v_soma_dimensao    bigint;
  v_pode_desativar   boolean;
  v_motivo           text;
BEGIN
  -- 1. A tabela nasce vazia.
  SELECT count(*) INTO v_n FROM fin_product_line;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0124] fin_product_line devia nascer vazia, achei % linha(s)', v_n;
  END IF;

  -- 2. Nenhuma categoria pré-atribuída.
  SELECT count(*) INTO v_n FROM fin_category WHERE product_line_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0124] esperava 0 categorias com product_line_id, achei %', v_n;
  END IF;

  -- 3. fin_dre_mensal_v não mudou NADA — prova contra o retrato de antes, não
  --    autoconsistência.
  SELECT count(*) INTO v_n
    FROM _0124_dre_antes a
    FULL OUTER JOIN fin_dre_mensal_v d
      ON d.visao = a.visao AND d.mes = a.mes AND d.entity_id = a.entity_id
   WHERE a.receita_bruta_cents IS DISTINCT FROM d.receita_bruta_cents
      OR a.lucro_liquido_cents IS DISTINCT FROM d.lucro_liquido_cents
      OR a.lancamentos         IS DISTINCT FROM d.lancamentos
      OR a.visao IS NULL OR d.visao IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0124] fin_dre_mensal_v mudou em % linha(s) — a migration não pode alterar a DRE', v_n;
  END IF;

  -- 4. A soma de fin_dre_dimensao_v reproduz fin_dre_mensal_v, nas duas
  --    visões.
  SELECT COALESCE(sum(receita_bruta_cents), 0) INTO v_soma_mensal FROM fin_dre_mensal_v WHERE visao = 'caixa';
  SELECT COALESCE(sum(receita_bruta_cents), 0) INTO v_soma_dimensao FROM fin_dre_dimensao_v WHERE visao = 'caixa';
  IF v_soma_mensal IS DISTINCT FROM v_soma_dimensao THEN
    RAISE EXCEPTION '[0124] receita_bruta_cents (caixa): mensal % != dimensao %', v_soma_mensal, v_soma_dimensao;
  END IF;

  SELECT COALESCE(sum(lucro_liquido_cents), 0) INTO v_soma_mensal FROM fin_dre_mensal_v WHERE visao = 'competencia';
  SELECT COALESCE(sum(lucro_liquido_cents), 0) INTO v_soma_dimensao FROM fin_dre_dimensao_v WHERE visao = 'competencia';
  IF v_soma_mensal IS DISTINCT FROM v_soma_dimensao THEN
    RAISE EXCEPTION '[0124] lucro_liquido_cents (competencia): mensal % != dimensao %', v_soma_mensal, v_soma_dimensao;
  END IF;

  -- 5. A SONDA: cria uma linha, atribui a primeira categoria de receita
  --    não-marcadora, confirma que fin_dre_dimensao_v a enxerga com dinheiro
  --    de verdade — e desfaz tudo antes de terminar.
  SELECT id INTO v_entity_id FROM fin_entity WHERE slug = 'xpe';

  INSERT INTO fin_product_line (entity_id, slug, name, sort_order)
  VALUES (v_entity_id, 'sonda-0124', 'Sonda de migration (0124)', 999)
  RETURNING id INTO v_linha_id;

  SELECT id, code INTO v_categoria_id, v_categoria_code
    FROM fin_category
   WHERE entity_id = v_entity_id AND kind = 'receita' AND code NOT IN ('3.99', '5.99')
   ORDER BY code LIMIT 1;

  IF v_categoria_id IS NULL THEN
    RAISE EXCEPTION '[0124] sonda: não achei nenhuma categoria de receita não-marcadora para testar';
  END IF;

  UPDATE fin_category SET product_line_id = v_linha_id WHERE id = v_categoria_id;

  SELECT COALESCE(sum(receita_bruta_cents), 0) INTO v_receita
    FROM fin_dre_dimensao_v
   WHERE visao = 'caixa' AND linha_produto_id = v_linha_id;

  IF v_receita = 0 THEN
    RAISE EXCEPTION '[0124] sonda: categoria % atribuída à linha sonda, mas fin_dre_dimensao_v não enxergou dinheiro nenhum', v_categoria_code;
  END IF;

  -- 6. fin_linha_produto_uso_v recusa desativar a linha em uso, com motivo.
  SELECT pode_desativar, motivo_bloqueio INTO v_pode_desativar, v_motivo
    FROM fin_linha_produto_uso_v WHERE id = v_linha_id;

  IF v_pode_desativar OR v_motivo IS NULL THEN
    RAISE EXCEPTION '[0124] sonda: esperava pode_desativar=false com motivo, achei pode_desativar=% motivo=%', v_pode_desativar, v_motivo;
  END IF;

  -- 7. 3.99/5.99 recusam receber linha de produto.
  BEGIN
    UPDATE fin_category SET product_line_id = v_linha_id WHERE code = '3.99' AND entity_id = v_entity_id;
    RAISE EXCEPTION '[0124] sonda: atribuir linha de produto a 3.99 devia falhar com check_violation e não falhou';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- 8. Desfaz a sonda por completo.
  UPDATE fin_category SET product_line_id = NULL WHERE id = v_categoria_id;
  DELETE FROM fin_product_line WHERE id = v_linha_id;

  SELECT count(*) INTO v_n FROM fin_product_line;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0124] sonda: fin_product_line devia voltar a 0 linhas depois do desfazer, achei %', v_n;
  END IF;

  RAISE NOTICE '[0124] linha de produto: tabela vazia, DRE intacta, fiação provada e desfeita';
END $$;
