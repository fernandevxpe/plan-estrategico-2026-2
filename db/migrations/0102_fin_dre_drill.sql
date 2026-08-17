-- A DRE abre até o lançamento, e o item muda de linha sem que a DRE seja tocada.
--
-- ===========================================================================
-- A REGRA DE OURO, ESCRITA NO MODELO E NÃO SÓ NO COMENTÁRIO
-- ===========================================================================
-- Na visão CAIXA, realizado é `fin_transaction`. Sempre. Não é uma convenção
-- desta migration: é a única definição sob a qual "6/6 contas fecham" quer
-- dizer alguma coisa. Competência é REORGANIZAÇÃO TEMPORAL do mesmo dinheiro —
-- nunca dinheiro diferente.
--
-- A consequência prática, e é ela que vira asserção em §7:
--
--     Σ opening_balance  +  Σ (toda coluna da visão caixa, 64 meses)
--                                                   =  Σ current_balance
--
-- Medido nesta base ao escrever esta migration: resíduo R$ 0,00 sobre
-- R$ 30.815,21 de movimento líquido, 6 contas. Se um dia essa soma deixar de
-- fechar, a DRE parou de ser derivada do caixa e virou uma segunda verdade —
-- que é exatamente o defeito que esta migration existe para não introduzir.
--
-- ===========================================================================
-- POR QUE O DRILL É UM ÚNICO FATO AGREGADO QUATRO VEZES
-- ===========================================================================
-- `linha → categoria → contraparte → lançamento` poderia ser quatro views
-- independentes. Seriam quatro jeitos de o número divergir, e a divergência
-- apareceria só no nível que ninguém abriu.
--
-- Aqui os quatro níveis são o MESMO fato (`fin_dre_drill_v`) com GROUP BY
-- progressivamente mais fino. A soma de um nível reproduzir o de cima não é
-- uma propriedade a testar: é uma consequência de refinar um GROUP BY. O teste
-- em `scripts/test-dre-drill.mjs` continua existindo porque uma consequência
-- só vale enquanto ninguém quebra a premissa, e uma linha a mais no UNION
-- quebra a premissa em silêncio.
--
-- ===========================================================================
-- POR QUE MOVER É RECLASSIFICAR, E NUNCA EDITAR A DRE
-- ===========================================================================
-- A DRE aqui é DERIVADA: `fin_dre_mensal_v` não guarda um centavo próprio, ela
-- lê `fin_transaction` e `fin_card_transaction`. Existe exatamente um jeito de
-- um valor mudar de linha sem inventar dinheiro: mudar a CATEGORIA do
-- lançamento, porque é `fin_category.dre_line` que decide a linha.
--
-- Gravar uma correção na DRE em vez da categoria criaria uma segunda verdade:
-- a soma dos lançamentos deixaria de bater com a demonstração, e a pergunta
-- "de onde veio este número?" passaria a ter duas respostas diferentes. O
-- ledger inteiro foi construído para essa pergunta ter uma só.
--
-- ===========================================================================
-- A ORDEM QUE IMPORTA — CUSTOU UM INVARIANTE PARA SER DESCOBERTA
-- ===========================================================================
-- `fin_transaction_revisao_sincroniza` (0094) lê se existe `fin_review_item`
-- PENDENTE de motivo `baixa_confianca` antes de aceitar `review_status='ok'`.
-- É um gatilho BEFORE: ele lê a fila no instante do UPDATE.
--
-- Um UPDATE que resolve o item de fila DEPOIS de atualizar a transação — mesmo
-- na mesma transação SQL, no statement seguinte — sofre o gatilho lendo o item
-- ainda pendente, e o `'ok'` é sobrescrito de volta para `'pendente'`. Isso
-- derrubou H4 por um instante (39→38 invariantes) na sessão da 0094.
--
-- `fin_dre_mover_aplicar` faz nesta ordem, e a ordem está no código com este
-- comentário do lado para ninguém "otimizar" juntando os statements:
--
--     1. resolve o item de fila `baixa_confianca`
--     2. grava fin_classification_event + fin_audit_log com o valor anterior
--     3. só então atualiza fin_transaction
--
-- ===========================================================================
-- O GATILHO DE SINAL NÃO RECUSA — ELE APAGA. E ISSO MUDA O DESENHO.
-- ===========================================================================
-- `fin_transaction_sinal_da_categoria()` (o guardião de D2/D3) NÃO levanta
-- exceção quando a categoria é incompatível com o sinal do lançamento. Ele faz
-- `NEW.category_id := NULL` e devolve a linha.
--
-- Para um script de importação isso é o comportamento certo: melhor sem
-- categoria do que com a errada. Para uma OPERAÇÃO HUMANA de mover item é o
-- pior comportamento possível — o usuário clicaria "mover para 5.01", o UPDATE
-- voltaria sucesso, e o lançamento cairia em `lacuna_ledger_sem_categoria`. A
-- tela mostraria que moveu; a DRE mostraria que sumiu.
--
-- Por isso `fin_dre_mover_avaliar` reproduz a regra de sinal ANTES do UPDATE e
-- RECUSA com motivo em português. O gatilho continua sendo a rede de baixo; a
-- função é a porta que diz não na cara de quem empurrou.
--
-- ===========================================================================
-- "ADICIONAR ALGO À DRE" — O QUE EXISTE E O QUE NÃO EXISTE
-- ===========================================================================
-- NÃO EXISTE acrescentar linha à DRE sem lastro. Uma linha inventada é
-- resultado inventado, e o piso desta base é a quinta restrição absoluta:
-- onde não houver evidência, o valor é indeterminado, com motivo.
--
-- O que existe são duas coisas, e as duas estão implementadas:
--
--   1. CLASSIFICAR um lançamento hoje indeterminado. Traz dinheiro REAL, que
--      já está no extrato, para a linha. É `fin_dre_mover_aplicar`, e é o
--      único caminho pelo qual `lucro_liquido` muda.
--
--   2. REGISTRAR UM AJUSTE DECLARADO (`fin_dre_ajuste`), com autor, motivo e
--      data, que aparece em SEÇÃO PRÓPRIA (`ajuste`) e nunca é somado ao que
--      veio do extrato. Serve para o que o extrato não sabe: provisão que o
--      dono afirma, reclassificação gerencial que ele quer ver ao lado.
--
--      O ajuste NÃO altera saldo de conta e NÃO altera o caixa — nem por
--      acidente. As três garantias, todas estruturais:
--        · mora em tabela própria; `fin_dre_mensal_v` não a lê;
--        · um CHECK proíbe `visao='caixa'` (o caixa é o extrato, ponto);
--        · a asserção da regra de ouro em §7 roda com ajustes na base e o
--          resíduo continua zero, porque nada em `fin_account` foi tocado.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NÃO FAZ
-- ===========================================================================
-- · Não altera nenhuma view da 0072. `fin_dre_mensal_v`, `fin_dre_v`,
--   `fin_dre_dimensao_v` e `fin_dre_cobertura_v` saem daqui byte a byte iguais
--   — é o que mantém `npm run test:contabil` em 28/28 por construção.
-- · Não escreve um único centavo. É DDL mais funções; a âncora de §0 prova.
-- · Não classifica nada. Ela dá a ferramenta; quem decide é gente.
-- · Não desativa, afrouxa nem contorna gatilho nenhum. Onde um gatilho recusa,
--   a função recusa antes e com frase melhor.

-- O runner já envolve cada arquivo numa transação; não abra outra aqui.

-- ---------------------------------------------------------------------------
-- 0. ÂNCORA DE DINHEIRO — fotografada antes de qualquer coisa
-- ---------------------------------------------------------------------------
-- Esta migration é DDL: a âncora deveria ser trivialmente igual. Ela existe
-- justamente por isso — se um dia alguém acrescentar um UPDATE aqui "só para
-- corrigir dois casos", a âncora recusa o COMMIT em vez de deixar passar.
CREATE TEMP TABLE _ancora_0102 ON COMMIT DROP AS
  SELECT account_id, count(*) AS n, sum(amount_cents) AS soma
    FROM fin_transaction GROUP BY account_id;

-- ---------------------------------------------------------------------------
-- 1. DE QUE LINHA É ESTA CATEGORIA — a regra em UM lugar
-- ---------------------------------------------------------------------------
-- A 0072 traduz `fin_category.dre_line` em linha da DRE dentro de um CASE, e
-- repete esse CASE duas vezes (ledger e cartão) em `fin_dre_lancamento_v`.
-- Simular um movimento exige a MESMA tradução — e uma terceira cópia do CASE
-- seria uma terceira chance de divergir.
--
-- Esta função é a cópia canônica. A §7 assere que ela reproduz a coluna `linha`
-- da view em 100% dos lançamentos; se a 0072 mudar e esta função não, a
-- migration não passa.
CREATE OR REPLACE FUNCTION fin_dre_linha_da_categoria(
  p_category_id  bigint,
  p_paga_fatura  boolean DEFAULT false,
  p_origem       text    DEFAULT 'ledger'
) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_paga_fatura                        THEN 'fora_cartao_fatura_paga'
    WHEN p_category_id IS NULL                THEN CASE WHEN p_origem = 'cartao'
                                                        THEN 'lacuna_cartao_sem_categoria'
                                                        ELSE 'lacuna_ledger_sem_categoria' END
    ELSE COALESCE(
      (SELECT CASE c.dre_line
                WHEN 'receita_bruta'             THEN 'receita_bruta'
                WHEN 'deducoes'                  THEN 'deducoes_devolucoes'
                WHEN 'impostos'                  THEN 'deducoes_impostos'
                WHEN 'custos_servicos'           THEN 'custos_diretos'
                WHEN 'despesas_pessoal'          THEN 'despesas_pessoal'
                WHEN 'despesas_comerciais'       THEN 'despesas_comerciais'
                WHEN 'despesas_administrativas'  THEN 'despesas_administrativas'
                WHEN 'resultado_financeiro'      THEN 'resultado_financeiro'
                WHEN 'investimentos'             THEN 'fora_investimento_capex'
                ELSE 'fora_movimentacao'
              END
         FROM fin_category c WHERE c.id = p_category_id),
      -- Categoria que não existe não é "movimentação": é pedido inválido, e
      -- devolver um slug real aqui faria a simulação mentir.
      'categoria_inexistente')
  END
$$;

COMMENT ON FUNCTION fin_dre_linha_da_categoria(bigint, boolean, text) IS
  'A tradução categoria → linha da DRE, canônica. É a mesma regra que fin_dre_lancamento_v aplica '
  'no CASE da 0072; a 0102 assere a igualdade sobre 100% dos lançamentos ao ser aplicada. Use esta '
  'função para SIMULAR o destino de um movimento — nunca reescreva o CASE numa terceira cópia.';

-- ---------------------------------------------------------------------------
-- 2. O FATO DO DRILL — uma linha por lançamento, por visão
-- ---------------------------------------------------------------------------
-- `fin_dre_lancamento_v` já é o fato da DRE, mas fala em ids: `categoria_code`
-- sem nome, `counterparty_id` sem contraparte, nenhum texto do extrato. Um
-- drill que termina em "id 8123, R$ -1.204,00" não responde à pergunta que
-- levou o usuário a abrir a linha.
--
-- Esta view acrescenta os NOMES e o texto de origem, materializa as duas visões
-- (o CROSS JOIN LATERAL que a 0072 repete em três views) e marca três coisas
-- que a tela precisa e nenhum agregado carrega:
--
--   eh_lacuna ......... o valor está numa linha de lacuna
--   movivel ........... existe operação de mover para esta linha (§6)
--   travado ........... um humano já travou a categoria; mover exige saber disso
--
-- O separador de chave é U+001F (unit separator). Nome de contraparte e nome
-- de categoria são texto livre: qualquer separador imprimível — '|', '/', '::'
-- — aparece um dia dentro de um nome e parte a hierarquia no meio.
CREATE OR REPLACE VIEW fin_dre_drill_v AS
SELECT
  v.visao,
  v.mes,
  l.entity_id,
  l.origem,
  l.lancamento_id,
  l.linha,
  d.name                                   AS linha_nome,
  d.secao,
  d.ordem                                  AS linha_ordem,
  -- Categoria: o segundo nível. NULL é AUSÊNCIA declarada, não um grupo — mas
  -- ele precisa de rótulo estável, senão a tela imprime "null" e o usuário lê
  -- isso como nome de conta.
  cat.id                                   AS category_id,
  l.categoria_code,
  cat.name                                 AS categoria_nome,
  COALESCE(l.categoria_code || ' ' || cat.name, '(sem categoria)')          AS categoria_rotulo,
  (cat.id IS NULL)                         AS categoria_indeterminada,
  cat.kind                                 AS categoria_kind,
  -- Contraparte: o terceiro nível.
  l.counterparty_id,
  cp.name                                  AS contraparte_nome,
  COALESCE(cp.name, '(contraparte não identificada)')                       AS contraparte_rotulo,
  (l.counterparty_id IS NULL)              AS contraparte_indeterminada,
  -- O lançamento, com o texto que o extrato trouxe.
  COALESCE(t.posted_on, ct.purchase_date, ct.posted_on)                     AS data_origem,
  l.posted_on,
  l.competence_date,
  l.competence_rule,
  l.competencia_confianca,
  COALESCE(NULLIF(btrim(t.description_raw), ''),
           NULLIF(btrim(ct.description), ''),
           NULLIF(btrim(ct.merchant), ''),
           '(sem histórico na fonte)')                                      AS descricao,
  acc.slug                                 AS conta_slug,
  card.slug                                AS cartao_slug,
  l.nucleo,
  l.cost_center_id,
  cc.name                                  AS centro_custo_nome,
  l.amount_cents,
  (d.secao = 'lacuna')                     AS eh_lacuna,
  -- Proveniência: é ela que o badge "por quê?" lê, e é ela que diz se mover
  -- desfaz uma decisão de gente ou corrige um palpite de máquina.
  COALESCE(t.classified_by, ct.classified_by)                               AS classified_by,
  COALESCE(t.classified_rule_id, ct.classified_rule_id)                     AS classified_rule_id,
  COALESCE(t.review_status, ct.review_status)                               AS review_status,
  COALESCE('category_id' = ANY(t.human_locked_fields),
           'category_id' = ANY(ct.human_locked_fields), false)              AS travado,
  -- Mover é operação sobre a categoria do lançamento. Pai de split não tem
  -- categoria própria (os filhos têm) e nunca chega aqui; pagamento de fatura
  -- de cartão tem gatilho próprio e é recusado em §6 com motivo.
  (l.origem IN ('ledger', 'cartao'))       AS movivel,
  -- Chaves hierárquicas. Cada uma é o prefixo da seguinte: é isso que faz
  -- `?expandir=` ser um simples LIKE sobre o pai.
  l.linha                                                                   AS chave_n1,
  l.linha || E'\x1f' || COALESCE(l.categoria_code, '~sem_categoria')        AS chave_n2,
  l.linha || E'\x1f' || COALESCE(l.categoria_code, '~sem_categoria')
           || E'\x1f' || COALESCE(l.counterparty_id::text, '~sem_contraparte') AS chave_n3,
  l.linha || E'\x1f' || COALESCE(l.categoria_code, '~sem_categoria')
           || E'\x1f' || COALESCE(l.counterparty_id::text, '~sem_contraparte')
           || E'\x1f' || l.origem || ':' || l.lancamento_id                 AS chave_n4
FROM fin_dre_lancamento_v l
CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
             AS v(visao, mes)
JOIN fin_dre_linha d           ON d.slug = l.linha
LEFT JOIN fin_transaction t    ON l.origem = 'ledger' AND t.id = l.lancamento_id
LEFT JOIN fin_card_transaction ct ON l.origem = 'cartao' AND ct.id = l.lancamento_id
LEFT JOIN fin_card_account card   ON card.id = ct.card_account_id
LEFT JOIN fin_account acc      ON acc.id = l.account_id
LEFT JOIN fin_category cat     ON cat.code = l.categoria_code AND cat.entity_id = l.entity_id
LEFT JOIN fin_counterparty cp  ON cp.id = l.counterparty_id
LEFT JOIN fin_cost_center cc   ON cc.id = l.cost_center_id
WHERE v.mes IS NOT NULL;

COMMENT ON VIEW fin_dre_drill_v IS
  'A folha do drill: um lançamento, numa visão, com os NOMES que a tela precisa e as quatro chaves '
  'hierárquicas (chave_n1..n4, cada uma prefixo da seguinte, separador U+001F). FILTRE POR visao. '
  'Somar as duas visões dobra o resultado. Item de cartão só existe na visão competência, porque '
  'mes_caixa dele é NULO por construção da 0072 — é isso que mantém o invariante "item de cartão '
  'não aparece na visão caixa" sem exceção espalhada.';

-- ---------------------------------------------------------------------------
-- 3. OS QUATRO NÍVEIS — o mesmo fato, quatro GROUP BY
-- ---------------------------------------------------------------------------
-- Uma view só, com coluna `nivel`, em vez de quatro views. A razão é a mesma
-- pela qual `visao` é coluna e não duas views na 0072: quatro objetos com a
-- mesma lógica são quatro chances de divergir, e a divergência apareceria só no
-- nível que ninguém abriu.
--
-- `pai` é NULL no nível 1 e é a chave do nível de cima nos demais. Expandir é
-- `WHERE pai = $1`; a tela nunca precisa saber como a chave é montada.
--
-- A LACUNA VIAJA JUNTO, EM TODO NÍVEL, E NÃO NUM RODAPÉ.
-- `lacuna_cents` é a parte de `valor_cents` que está em linha de lacuna, e ela
-- é preenchida em TODOS os níveis. No nível 1 ela é a própria linha; nos níveis
-- 2 a 4 ela é o pedaço indeterminado daquele grupo. Um rodapé "e mais
-- R$ 54.126,76 de cartão sem categoria" é a forma elegante de esconder: quem
-- abre `despesas_administrativas` não rola até o rodapé.
CREATE OR REPLACE VIEW fin_dre_drill_nivel_v AS
WITH f AS (SELECT * FROM fin_dre_drill_v)
-- nível 1: a linha da DRE ----------------------------------------------------
SELECT
  1                                       AS nivel,
  'linha'::text                           AS nivel_nome,
  f.visao, f.mes, f.entity_id,
  f.chave_n1                              AS chave,
  NULL::text                              AS pai,
  f.linha_nome                            AS rotulo,
  f.linha, f.secao, f.linha_ordem,
  NULL::text                              AS categoria_code,
  NULL::bigint                            AS counterparty_id,
  NULL::text                              AS origem,
  NULL::bigint                            AS lancamento_id,
  sum(f.amount_cents)                     AS valor_cents,
  sum(f.amount_cents) FILTER (WHERE f.eh_lacuna)                            AS lacuna_cents_raw,
  sum(abs(f.amount_cents)) FILTER (WHERE f.eh_lacuna)                       AS lacuna_bruto_raw,
  count(*)                                AS lancamentos,
  count(*) FILTER (WHERE f.categoria_indeterminada)                         AS lancamentos_sem_categoria,
  count(*) FILTER (WHERE f.contraparte_indeterminada)                       AS lancamentos_sem_contraparte,
  count(*) FILTER (WHERE f.travado)                                         AS lancamentos_travados,
  bool_or(f.eh_lacuna)                    AS eh_lacuna,
  true                                    AS tem_filhos
FROM f GROUP BY f.visao, f.mes, f.entity_id, f.chave_n1, f.linha_nome, f.linha, f.secao, f.linha_ordem

UNION ALL
-- nível 2: a categoria dentro da linha ---------------------------------------
SELECT
  2, 'categoria', f.visao, f.mes, f.entity_id,
  f.chave_n2, f.chave_n1,
  f.categoria_rotulo,
  f.linha, f.secao, f.linha_ordem,
  f.categoria_code, NULL::bigint, NULL::text, NULL::bigint,
  sum(f.amount_cents),
  sum(f.amount_cents) FILTER (WHERE f.eh_lacuna),
  sum(abs(f.amount_cents)) FILTER (WHERE f.eh_lacuna),
  count(*),
  count(*) FILTER (WHERE f.categoria_indeterminada),
  count(*) FILTER (WHERE f.contraparte_indeterminada),
  count(*) FILTER (WHERE f.travado),
  bool_or(f.eh_lacuna),
  true
FROM f GROUP BY f.visao, f.mes, f.entity_id, f.chave_n2, f.chave_n1, f.categoria_rotulo,
                f.linha, f.secao, f.linha_ordem, f.categoria_code

UNION ALL
-- nível 3: a contraparte dentro da categoria ---------------------------------
SELECT
  3, 'contraparte', f.visao, f.mes, f.entity_id,
  f.chave_n3, f.chave_n2,
  f.contraparte_rotulo,
  f.linha, f.secao, f.linha_ordem,
  f.categoria_code, f.counterparty_id, NULL::text, NULL::bigint,
  sum(f.amount_cents),
  sum(f.amount_cents) FILTER (WHERE f.eh_lacuna),
  sum(abs(f.amount_cents)) FILTER (WHERE f.eh_lacuna),
  count(*),
  count(*) FILTER (WHERE f.categoria_indeterminada),
  count(*) FILTER (WHERE f.contraparte_indeterminada),
  count(*) FILTER (WHERE f.travado),
  bool_or(f.eh_lacuna),
  true
FROM f GROUP BY f.visao, f.mes, f.entity_id, f.chave_n3, f.chave_n2, f.contraparte_rotulo,
                f.linha, f.secao, f.linha_ordem, f.categoria_code, f.counterparty_id

UNION ALL
-- nível 4: o lançamento ------------------------------------------------------
SELECT
  4, 'lancamento', f.visao, f.mes, f.entity_id,
  f.chave_n4, f.chave_n3,
  to_char(f.data_origem, 'DD/MM/YYYY') || '  ' || left(f.descricao, 72),
  f.linha, f.secao, f.linha_ordem,
  f.categoria_code, f.counterparty_id, f.origem, f.lancamento_id,
  f.amount_cents,
  CASE WHEN f.eh_lacuna THEN f.amount_cents END,
  CASE WHEN f.eh_lacuna THEN abs(f.amount_cents) END,
  1,
  CASE WHEN f.categoria_indeterminada THEN 1 ELSE 0 END,
  CASE WHEN f.contraparte_indeterminada THEN 1 ELSE 0 END,
  CASE WHEN f.travado THEN 1 ELSE 0 END,
  f.eh_lacuna,
  false
FROM f;

COMMENT ON VIEW fin_dre_drill_nivel_v IS
  'O drill da DRE em quatro níveis (1 linha, 2 categoria, 3 contraparte, 4 lançamento), todos '
  'agregando o MESMO fato fin_dre_drill_v com GROUP BY progressivamente mais fino — por isso a soma '
  'de um nível reproduz o de cima por construção, e não por coincidência. `pai` é a chave do nível '
  'acima: expandir é WHERE pai = $1. lacuna_cents_raw é a parte indeterminada DAQUELE grupo e vem '
  'em todo nível de propósito: rodapé de lacuna é a forma elegante de esconder. FILTRE visao.';

-- Uma view de conveniência com a lacuna já sem NULL, porque `lacuna_cents` é
-- somado pela tela e NULL propagado num SUM some com o total inteiro.
CREATE OR REPLACE VIEW fin_dre_drill_arvore_v AS
SELECT n.nivel, n.nivel_nome, n.visao, n.mes, n.entity_id, n.chave, n.pai, n.rotulo,
       n.linha, n.secao, n.linha_ordem, n.categoria_code, n.counterparty_id,
       n.origem, n.lancamento_id,
       n.valor_cents,
       COALESCE(n.lacuna_cents_raw, 0)  AS lacuna_cents,
       COALESCE(n.lacuna_bruto_raw, 0)  AS lacuna_bruto_cents,
       n.lancamentos, n.lancamentos_sem_categoria, n.lancamentos_sem_contraparte,
       n.lancamentos_travados, n.eh_lacuna, n.tem_filhos,
       -- O que a tela precisa para indentar sem recalcular nada.
       (n.nivel - 1)                     AS indentacao
  FROM fin_dre_drill_nivel_v n;

COMMENT ON VIEW fin_dre_drill_arvore_v IS
  'fin_dre_drill_nivel_v com lacuna_cents já COALESCE(0) e a indentação pronta. É a view que a rota '
  'GET /api/financeiro/gerencial/dre/drill consome.';

-- ---------------------------------------------------------------------------
-- 4. A RESSALVA VEM ANTES DO NÚMERO
-- ---------------------------------------------------------------------------
-- `fin_dre_cobertura_v` já mede `folha_do_mes_ja_paga`. O problema nunca foi a
-- medida: foi o LUGAR. Uma ressalva impressa depois do número é lida depois de
-- o número já ter sido acreditado — e o mês corrente na visão competência é
-- justamente o que mais parece bom e menos é.
--
-- Medido nesta base: agosto/2026 mostra resultado com pessoal ZERO, porque a
-- folha de agosto (~R$ 93.731) sai em 01/09. O mês parece o melhor da série.
--
-- Esta view devolve as ressalvas com `posicao='antes'` e `ordem`, para a rota
-- montá-las na frente do valor em vez de num rodapé. Cada uma traz o valor em
-- jogo MEDIDO — "está otimista" sem número é opinião.
CREATE OR REPLACE VIEW fin_dre_drill_ressalva_v AS
-- 1. o mês aberto: a folha ainda não saiu ------------------------------------
SELECT c.visao, c.mes,
       'despesas_pessoal'::text                       AS linha,
       'folha_do_mes_nao_saiu'::text                  AS chave,
       'antes'::text                                  AS posicao,
       10                                             AS ordem,
       'alerta'::text                                 AS severidade,
       abs(COALESCE(c.folha_media_3m_cents, 0))       AS valor_em_jogo_cents,
       'A folha deste mês ainda não saiu — o salário sai no dia 1º do mês seguinte. '
       'O resultado exibido está OTIMISTA em torno de '
       || to_char(abs(COALESCE(c.folha_media_3m_cents, 0)) / 100.0, 'FM999G999G990D00')
       || ' (média dos 3 meses anteriores) e vai piorar.'                     AS texto
  FROM fin_dre_cobertura_v c
 WHERE NOT c.folha_do_mes_ja_paga
   AND c.folha_media_3m_cents IS NOT NULL

UNION ALL
-- 2. a lacuna de cartão, dentro do grupo a que pertence ----------------------
SELECT n.visao, n.mes, n.linha,
       'lacuna_cartao'::text, 'antes'::text, 20, 'alerta'::text,
       COALESCE(n.lacuna_bruto_raw, 0),
       'Esta linha carrega '
       || to_char(COALESCE(n.lacuna_bruto_raw, 0) / 100.0, 'FM999G999G990D00')
       || ' em ' || n.lancamentos_sem_categoria
       || ' item(ns) de cartão sem categoria. O custo existe e está no subledger; a linha em que '
       'ele cairia é que não foi decidida. Ver fin_dre_lacuna_destino_v para o destino provável '
       'com a evidência que o sustenta.'
  FROM fin_dre_drill_nivel_v n
 WHERE n.nivel = 1 AND n.linha = 'lacuna_cartao_sem_categoria' AND n.lancamentos > 0

UNION ALL
-- 3. a lacuna do ledger ------------------------------------------------------
SELECT n.visao, n.mes, n.linha,
       'lacuna_ledger'::text, 'antes'::text, 21, 'alerta'::text,
       COALESCE(n.lacuna_bruto_raw, 0),
       'Esta linha carrega '
       || to_char(COALESCE(n.lacuna_bruto_raw, 0) / 100.0, 'FM999G999G990D00')
       || ' em ' || n.lancamentos_sem_categoria
       || ' lançamento(s) bancário(s) sem categoria. É dinheiro que andou no extrato e ainda não '
       'tem linha — não é ausência de movimento.'
  FROM fin_dre_drill_nivel_v n
 WHERE n.nivel = 1 AND n.linha = 'lacuna_ledger_sem_categoria' AND n.lancamentos > 0

UNION ALL
-- 4. competência presumida ---------------------------------------------------
SELECT c.visao, c.mes, NULL::text,
       'competencia_presumida'::text, 'antes'::text, 30, 'informativo'::text,
       0::bigint,
       'Neste mês, ' || to_char(c.pct_valor_presumido, 'FM990D00')
       || '% do valor tem competência PRESUMIDA (igual ao caixa, por falta de evidência documental).'
  FROM fin_dre_cobertura_v c
 WHERE c.visao = 'competencia' AND COALESCE(c.pct_valor_presumido, 0) > 0;

COMMENT ON VIEW fin_dre_drill_ressalva_v IS
  'As ressalvas que precisam ser lidas ANTES do número, por visão, mês e linha. posicao=antes é '
  'contrato com a tela: ressalva depois do número é lida depois de o número ter sido acreditado. '
  'valor_em_jogo_cents é sempre medido — "está otimista" sem número é opinião, não ressalva.';

-- ---------------------------------------------------------------------------
-- 5. ONDE A LACUNA CAIRIA — hipótese com evidência, NUNCA somada
-- ---------------------------------------------------------------------------
-- "A lacuna aparece indentada dentro do grupo a que pertenceria" só é possível
-- honestamente se existir uma evidência que diga QUAL grupo. Inventar o grupo
-- seria o rótulo plausível que a quinta restrição proíbe.
--
-- A evidência que esta base tem é o HISTÓRICO DA PRÓPRIA CONTRAPARTE: se os 9
-- lançamentos anteriores da Ancora Imobiliária estão em 5.01, o décimo
-- provavelmente é 5.01. É exatamente o raciocínio que a 0094 registrou como
-- nota de item de fila quando não pôde escrever a categoria.
--
-- TRÊS SALVAGUARDAS, porque hipótese vira fato rápido:
--   1. esta view NUNCA é somada em lugar nenhum. `linha_provavel` não entra em
--      `fin_dre_mensal_v`, nem no drill, nem em nenhum total. §7 assere isso.
--   2. `evidencia` é obrigatória e nomeia o quê: quantos lançamentos, que valor,
--      de qual contraparte. Sem evidência, `linha_provavel` é NULL e
--      `motivo_indeterminado` diz por quê — que é a forma correta de não saber.
--   3. `concordancia_pct` mostra o quanto o histórico é unânime. 100% em 9 de 9
--      é uma coisa; 55% em 20 é outra, e a tela precisa poder distinguir.
CREATE OR REPLACE VIEW fin_dre_lacuna_destino_v AS
WITH lacuna AS (
  SELECT DISTINCT ON (f.origem, f.lancamento_id)
         f.origem, f.lancamento_id, f.entity_id, f.linha, f.mes, f.visao,
         f.counterparty_id, f.contraparte_rotulo, f.descricao, f.amount_cents, f.data_origem
    FROM fin_dre_drill_v f
   WHERE f.eh_lacuna
   ORDER BY f.origem, f.lancamento_id, f.visao
),
-- O histórico da contraparte, contado por linha da DRE, só sobre o que JÁ está
-- classificado. Uma lacuna nunca vota no destino de outra lacuna.
historico AS (
  SELECT f.counterparty_id,
         f.linha,
         count(*)                AS n,
         sum(abs(f.amount_cents)) AS bruto
    FROM fin_dre_drill_v f
   WHERE f.visao = 'competencia'
     AND NOT f.eh_lacuna
     AND f.counterparty_id IS NOT NULL
     AND f.secao = 'resultado'
   GROUP BY f.counterparty_id, f.linha
),
total AS (
  SELECT counterparty_id, sum(n) AS n_total FROM historico GROUP BY counterparty_id
),
vencedor AS (
  SELECT DISTINCT ON (h.counterparty_id)
         h.counterparty_id, h.linha, h.n, h.bruto, t.n_total
    FROM historico h JOIN total t ON t.counterparty_id = h.counterparty_id
   ORDER BY h.counterparty_id, h.n DESC, h.bruto DESC, h.linha
)
SELECT
  l.origem, l.lancamento_id, l.entity_id, l.linha AS linha_atual,
  l.counterparty_id, l.contraparte_rotulo, l.descricao, l.data_origem, l.amount_cents,
  v.linha                                                        AS linha_provavel,
  (SELECT d.name FROM fin_dre_linha d WHERE d.slug = v.linha)     AS linha_provavel_nome,
  CASE WHEN v.counterparty_id IS NULL THEN NULL
       ELSE round(100.0 * v.n / NULLIF(v.n_total, 0), 1) END      AS concordancia_pct,
  CASE WHEN v.counterparty_id IS NULL THEN NULL
       ELSE v.n || ' de ' || v.n_total || ' lançamento(s) já classificado(s) de "'
            || l.contraparte_rotulo || '" estão em ' || v.linha
            || ' (' || to_char(v.bruto / 100.0, 'FM999G999G990D00') || ')'
  END                                                             AS evidencia,
  CASE
    WHEN l.counterparty_id IS NULL THEN 'contraparte não identificada: não há histórico a consultar'
    WHEN v.counterparty_id IS NULL THEN 'a contraparte não tem nenhum lançamento já classificado nesta base'
    ELSE NULL
  END                                                             AS motivo_indeterminado
FROM lacuna l
LEFT JOIN vencedor v ON v.counterparty_id = l.counterparty_id;

COMMENT ON VIEW fin_dre_lacuna_destino_v IS
  'Para cada lançamento em lacuna, a linha da DRE em que ele PROVAVELMENTE cairia, sustentada pelo '
  'histórico já classificado da mesma contraparte, com a evidência escrita e a concordância medida. '
  'HIPÓTESE, NUNCA FATO: nenhum total desta base soma linha_provavel, e a 0102 assere isso ao ser '
  'aplicada. Sem evidência, linha_provavel é NULL e motivo_indeterminado diz por quê — que é a '
  'forma correta de não saber.';

-- ---------------------------------------------------------------------------
-- 6. MOVER ITEM DE UMA LINHA PARA OUTRA
-- ---------------------------------------------------------------------------
-- Três funções, e a separação entre elas é o desenho:
--
--   fin_dre_mover_avaliar ..... STABLE. Decide, por id, se o movimento é aceito
--                               e POR QUE não, quando não é. Não escreve nada.
--   fin_dre_mover_impacto ..... STABLE. O antes/depois na DRE, linha a linha.
--   fin_dre_mover_aplicar ..... VOLATILE. Só ela escreve, e só depois de a
--                               avaliação ter aceitado TODOS os ids.
--
-- O dry-run não é cortesia: é a única forma de a tela mostrar "isto vai tirar
-- R$ 12.400 de Administrativas e pôr em Custos diretos" ANTES de fazer.

-- 6.0 O vocabulário de evidência do cartão não tinha palavra para "gente" ----
-- `fin_card_transaction.classified_evidence` é FK para `fin_card_evidencia`,
-- que é vocabulário controlado — e o vocabulário da 0083 nomeia seis degraus
-- de evidência AUTOMÁTICA (MCC, nome do produto, plano, estorno, indícios) e
-- nenhum degrau humano. Um item classificado por uma pessoa só podia ficar com
-- `NULL` ali, ou herdar a evidência da regra que ela acabou de contradizer —
-- e essa segunda opção é o badge "por quê?" mentindo.
--
-- Acrescentar um termo ao vocabulário não é afrouxar o CHECK: é o que a tabela
-- existe para receber. `forca=100` e `decide=true` porque decisão humana com
-- motivo declarado vence qualquer degrau automático, por construção.
INSERT INTO fin_card_evidencia (slug, nome, forca, decide, descricao) VALUES
 ('decisao_humana', 'Decisão humana declarada', 100, true,
  'Uma pessoa escolheu a categoria pela tela, com autor e motivo gravados em fin_audit_log e '
  'fin_classification_event. Vence todo degrau automático: o MCC diz o que a loja vende, o nome do '
  'produto diz o que ele é, e só gente sabe para que aquela compra serviu nesta empresa.')
ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome, forca = EXCLUDED.forca, decide = EXCLUDED.decide,
      descricao = EXCLUDED.descricao;

-- 6.1 A avaliação -----------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_dre_mover_avaliar(
  p_alvo        text,
  p_ids         bigint[],
  p_category_id bigint
) RETURNS TABLE (
  alvo              text,
  id                bigint,
  aceito            boolean,
  recusa            text,
  sem_efeito        boolean,
  amount_cents      bigint,
  categoria_antes   text,
  categoria_depois  text,
  linha_antes       text,
  linha_depois      text,
  travado           boolean,
  classified_by     text
)
LANGUAGE sql STABLE AS $$
WITH destino AS (
  SELECT c.id, c.code, c.name, c.kind, c.is_active, c.entity_id
    FROM fin_category c WHERE c.id = p_category_id
),
alvos AS (
  -- ledger -----------------------------------------------------------------
  SELECT 'fin_transaction'::text                         AS alvo,
         t.id,
         t.amount_cents,
         t.entity_id,
         t.is_split_parent,
         t.description_norm,
         t.category_id                                   AS categoria_antes_id,
         cAntes.code                                     AS categoria_antes,
         fin_dre_linha_da_categoria(
           t.category_id,
           EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id),
           'ledger')                                     AS linha_antes,
         fin_dre_linha_da_categoria(
           p_category_id,
           EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id),
           'ledger')                                     AS linha_depois,
         COALESCE('category_id' = ANY(t.human_locked_fields), false) AS travado,
         t.classified_by,
         ('indeterminado:fatura-sem-itemizacao' = ANY (COALESCE(t.tags, '{}'::text[])))
           AND NOT EXISTS (SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = t.id)
                                                         AS fatura_sem_itemizacao,
         NULL::bigint                                    AS installment_plan_id
    FROM fin_transaction t
    LEFT JOIN fin_category cAntes ON cAntes.id = t.category_id
   WHERE p_alvo = 'fin_transaction' AND t.id = ANY(p_ids)

  UNION ALL
  -- cartão -----------------------------------------------------------------
  SELECT 'fin_card_transaction'::text,
         ct.id,
         -ct.amount_cents,          -- sinal já na convenção da DRE, como na 0072
         ca.entity_id,
         false,
         ct.description_norm,
         ct.category_id,
         cAntes.code,
         fin_dre_linha_da_categoria(ct.category_id, false, 'cartao'),
         fin_dre_linha_da_categoria(p_category_id, false, 'cartao'),
         COALESCE('category_id' = ANY(ct.human_locked_fields), false),
         ct.classified_by,
         false,
         ct.installment_plan_id
    FROM fin_card_transaction ct
    JOIN fin_card_account ca ON ca.id = ct.card_account_id
    LEFT JOIN fin_category cAntes ON cAntes.id = ct.category_id
   WHERE p_alvo = 'fin_card_transaction' AND ct.id = ANY(p_ids)
),
-- Todo id pedido aparece na resposta, inclusive o que não existe. Devolver 4
-- linhas para 5 ids pedidos obrigaria o chamador a descobrir qual sumiu.
pedidos AS (SELECT unnest(p_ids) AS id),
julgado AS (
  SELECT
    COALESCE(a.alvo, p_alvo)                             AS alvo,
    p.id,
    COALESCE(a.amount_cents, 0)                          AS amount_cents,
    a.categoria_antes,
    d.code                                               AS categoria_depois,
    a.linha_antes,
    a.linha_depois,
    COALESCE(a.travado, false)                           AS travado,
    a.classified_by,
    (a.categoria_antes_id IS NOT DISTINCT FROM p_category_id) AS sem_efeito,
    CASE
      WHEN p_alvo NOT IN ('fin_transaction', 'fin_card_transaction')
        THEN 'alvo desconhecido: use fin_transaction ou fin_card_transaction'
      WHEN p_category_id IS NULL
        THEN 'mover exige categoria de destino. Tirar a categoria não é mover: é devolver o '
             'lançamento à lacuna, e isso se faz pela fila de revisão, com motivo declarado'
      WHEN d.id IS NULL
        THEN 'categoria de destino não existe'
      WHEN NOT d.is_active
        THEN 'categoria de destino está inativa: mover para categoria desativada esconde o valor '
             'numa linha que ninguém mais abre'
      WHEN a.id IS NULL
        THEN 'lançamento não encontrado em ' || p_alvo
      WHEN d.entity_id IS DISTINCT FROM a.entity_id
        THEN 'categoria de outra entidade'
      WHEN a.is_split_parent
        THEN 'pai de rateio não tem categoria própria: mova as partes'
      -- D3, e a razão dele: despesa carimbada como receita infla faturamento e
      -- o tributo calculado sobre ele.
      WHEN d.kind = 'receita' AND a.amount_cents < 0
        THEN 'sinal incompatível: ' || d.code || ' é categoria de RECEITA e este lançamento é uma '
             'SAÍDA. Aceitar inflaria o faturamento e o imposto calculado sobre ele (invariante D3)'
      -- D2, e a razão dele: é a assinatura exata do bug do "POSTO".
      WHEN d.kind IN ('custo_variavel_direto','despesa_operacional','pessoal','imposto','investimento')
       AND a.amount_cents > 0
       AND lower(COALESCE(a.description_norm, '')) !~ '(estorno|reembolso|devolu|refund|cancelamento)'
        THEN 'sinal incompatível: ' || d.code || ' é categoria de DESPESA e este lançamento é uma '
             'ENTRADA. É a assinatura do bug do "POSTO" — cliente com nome de fornecedor vira '
             'despesa e some da receita (invariante D2)'
      WHEN a.fatura_sem_itemizacao AND d.code = '9.01'
        THEN 'pagamento de fatura sem itemização não vira 9.01 sem fin_card_bill ligada: a despesa '
             'sairia da DRE sem reaparecer no subledger do cartão (gatilho da 0094)'
      WHEN a.installment_plan_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM fin_card_installment_plan pl
              WHERE pl.id = a.installment_plan_id
                AND pl.category_id IS NOT NULL
                AND pl.category_id IS DISTINCT FROM p_category_id)
        THEN 'o plano de parcelamento desta compra já tem outra categoria: parcelas da MESMA compra '
             'não podem cair em linhas diferentes (0047 §2 · 0083 §12). Mova o plano inteiro'
      WHEN a.installment_plan_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM fin_card_transaction irmao
              WHERE irmao.installment_plan_id = a.installment_plan_id
                AND irmao.id <> a.id
                AND irmao.category_id IS NOT NULL
                AND irmao.category_id IS DISTINCT FROM p_category_id
                AND NOT (irmao.id = ANY(p_ids)))
        THEN 'outra parcela da MESMA compra está em categoria diferente e não veio no lote: mova o '
             'plano inteiro (0047 §2 · 0083 §12)'
      ELSE NULL
    END                                                  AS recusa
  FROM pedidos p
  LEFT JOIN alvos a ON a.id = p.id
  CROSS JOIN LATERAL (SELECT * FROM destino UNION ALL
                      SELECT NULL::bigint, NULL, NULL, NULL, NULL::boolean, NULL::bigint
                       WHERE NOT EXISTS (SELECT 1 FROM destino)) d
)
SELECT j.alvo, j.id, (j.recusa IS NULL), j.recusa, j.sem_efeito, j.amount_cents,
       j.categoria_antes, j.categoria_depois, j.linha_antes, j.linha_depois,
       j.travado, j.classified_by
  FROM julgado j
 ORDER BY j.id
$$;

COMMENT ON FUNCTION fin_dre_mover_avaliar(text, bigint[], bigint) IS
  'Dry-run por id: aceita ou recusa o movimento, com motivo em português. Reproduz D2/D3 e os '
  'gatilhos de fatura e de plano de parcelamento ANTES do UPDATE — porque o gatilho de sinal não '
  'levanta exceção, ele zera category_id, e um UPDATE bem-sucedido que manda o lançamento para a '
  'lacuna é pior que uma recusa. Todo id pedido volta na resposta, inclusive o inexistente.';

-- 6.2 O impacto na DRE, antes e depois --------------------------------------
CREATE OR REPLACE FUNCTION fin_dre_mover_impacto(
  p_alvo        text,
  p_ids         bigint[],
  p_category_id bigint
) RETURNS TABLE (
  visao         text,
  mes           date,
  linha         text,
  linha_nome    text,
  valor_antes   bigint,
  valor_depois  bigint,
  delta         bigint
)
LANGUAGE sql STABLE AS $$
WITH aceitos AS (
  SELECT * FROM fin_dre_mover_avaliar(p_alvo, p_ids, p_category_id)
   WHERE aceito AND NOT sem_efeito
),
-- Os lançamentos afetados, nas duas visões e com o mês de cada uma. O item de
-- cartão só tem mês de competência: mover um item de cartão NÃO mexe na visão
-- caixa, e isso tem de aparecer como zero medido, não como ausência.
movidos AS (
  SELECT f.visao, f.mes, f.linha AS linha_antes, a.linha_depois, f.amount_cents
    FROM fin_dre_drill_v f
    JOIN aceitos a
      ON a.id = f.lancamento_id
     AND ((a.alvo = 'fin_transaction'      AND f.origem = 'ledger')
       OR (a.alvo = 'fin_card_transaction' AND f.origem = 'cartao'))
),
-- Só as linhas tocadas: devolver as 21 linhas da DRE com delta zero em 18
-- delas obrigaria a tela a filtrar para achar o que mudou.
tocadas AS (
  SELECT DISTINCT visao, mes, linha_antes AS linha FROM movidos
  UNION
  SELECT DISTINCT visao, mes, linha_depois       FROM movidos
),
antes AS (
  SELECT n.visao, n.mes, n.linha, sum(n.valor_cents) AS v
    FROM fin_dre_drill_nivel_v n
   WHERE n.nivel = 1
   GROUP BY n.visao, n.mes, n.linha
),
delta AS (
  SELECT t.visao, t.mes, t.linha,
         COALESCE((SELECT sum(m.amount_cents) FROM movidos m
                    WHERE m.visao = t.visao AND m.mes = t.mes AND m.linha_depois = t.linha), 0)
       - COALESCE((SELECT sum(m.amount_cents) FROM movidos m
                    WHERE m.visao = t.visao AND m.mes = t.mes AND m.linha_antes = t.linha), 0) AS d
    FROM tocadas t
)
SELECT d.visao, d.mes, d.linha,
       (SELECT l.name FROM fin_dre_linha l WHERE l.slug = d.linha),
       COALESCE(a.v, 0),
       COALESCE(a.v, 0) + d.d,
       d.d
  FROM delta d
  LEFT JOIN antes a ON a.visao = d.visao AND a.mes = d.mes AND a.linha = d.linha
 ORDER BY d.visao, d.mes, (SELECT l.ordem FROM fin_dre_linha l WHERE l.slug = d.linha)
$$;

COMMENT ON FUNCTION fin_dre_mover_impacto(text, bigint[], bigint) IS
  'O antes/depois da DRE para um movimento, linha a linha, sem escrever nada. Só as linhas TOCADAS. '
  'A soma dos deltas de um (visao, mes) é sempre ZERO: mover não cria nem destrói dinheiro, só o '
  'reposiciona — e a 0102 assere isso ao ser aplicada.';

-- 6.3 A aplicação — a única que escreve -------------------------------------
CREATE OR REPLACE FUNCTION fin_dre_mover_aplicar(
  p_alvo        text,
  p_ids         bigint[],
  p_category_id bigint,
  p_motivo      text,
  p_actor       text,
  p_batch       uuid DEFAULT gen_random_uuid()
) RETURNS TABLE (
  alvo             text,
  id               bigint,
  categoria_antes  text,
  categoria_depois text,
  linha_antes      text,
  linha_depois     text,
  batch_id         uuid
)
LANGUAGE plpgsql VOLATILE AS $function$
DECLARE
  v_recusas text;
  v_n       integer;
  r         record;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'mover categoria exige autor: a trilha sem quem decidiu é decorativa';
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 8 THEN
    RAISE EXCEPTION 'mover categoria exige motivo com pelo menos 8 caracteres: '
                    '"ajuste" não é motivo, é rótulo';
  END IF;

  -- Lote é tudo ou nada. "Moveu 7 de 10 e você não percebeu" é a falha que o
  -- dry-run existe para evitar — se ele foi ignorado, a função ainda recusa.
  SELECT string_agg(a.id || ': ' || a.recusa, E'\n'), count(*)
    INTO v_recusas, v_n
    FROM fin_dre_mover_avaliar(p_alvo, p_ids, p_category_id) a
   WHERE NOT a.aceito;

  IF COALESCE(v_n, 0) > 0 THEN
    RAISE EXCEPTION 'lote recusado — % de % lançamento(s) não podem mover:%s',
      v_n, array_length(p_ids, 1), E'\n' || v_recusas;
  END IF;

  FOR r IN
    SELECT * FROM fin_dre_mover_avaliar(p_alvo, p_ids, p_category_id)
     WHERE aceito AND NOT sem_efeito
  LOOP
    -- =====================================================================
    -- PASSO 1 — RESOLVER O ITEM DE FILA. ANTES DO UPDATE. SEMPRE.
    -- =====================================================================
    -- `fin_transaction_revisao_sincroniza` (0094) é BEFORE e lê a fila no
    -- instante do UPDATE. Se este bloco vier depois, o gatilho enxerga o item
    -- ainda pendente e sobrescreve review_status='ok' de volta para
    -- 'pendente' — silenciosamente, dentro da mesma transação SQL.
    --
    -- Resolver aqui é legítimo, não é atalho: `baixa_confianca` significa
    -- "classifiquei, confirme", e um humano acabou de confirmar escolhendo a
    -- categoria com nome e motivo. É essa a resposta que o item pedia.
    IF r.alvo = 'fin_transaction' THEN
      INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after,
                                 fields, batch_id, actor)
      SELECT ri.entity_id, 'fin_review_item', ri.id, 'update',
             jsonb_build_object('status', ri.status, 'reason', ri.reason),
             jsonb_build_object('status', 'resolvido', 'reason', ri.reason,
                                'motivo', p_motivo),
             ARRAY['status'], p_batch, p_actor
        FROM fin_review_item ri
       WHERE ri.target_table = 'fin_transaction' AND ri.target_id = r.id
         AND ri.status = 'pendente' AND ri.reason = 'baixa_confianca';

      UPDATE fin_review_item ri
         SET status = 'resolvido', resolved_at = now(), resolved_by = p_actor,
             note = COALESCE(ri.note || E'\n', '') || 'mover-categoria: ' || p_motivo
       WHERE ri.target_table = 'fin_transaction' AND ri.target_id = r.id
         AND ri.status = 'pendente' AND ri.reason = 'baixa_confianca';
    END IF;

    -- =====================================================================
    -- PASSO 2 — A TRILHA, COM O VALOR ANTERIOR
    -- =====================================================================
    -- `superseded_value` é o sinal de aprendizado: sem ele não há como medir se
    -- as regras estão melhorando, e o mês 6 custa o mesmo que o mês 1.
    -- `accepted = false` quando havia uma sugestão de máquina por baixo — foi
    -- um humano trocando o que a máquina disse.
    INSERT INTO fin_classification_event
      (target_table, target_id, stage, rule_id, category_id, confidence, rationale,
       accepted, superseded_value, actor)
    VALUES
      (r.alvo, r.id, 'humano', NULL, p_category_id, 100,
       jsonb_build_object(
         'origem', 'fin_dre_mover_aplicar',
         'motivo', p_motivo,
         'linha_antes', r.linha_antes,
         'linha_depois', r.linha_depois,
         'batch_id', p_batch),
       -- `accepted` mede se o humano ACEITOU a sugestão da máquina. Havia
       -- sugestão de máquina por baixo e ele trocou ⇒ false, e é esse falso que
       -- torna a qualidade das regras mensurável. Sem sugestão prévia, nada foi
       -- rejeitado ⇒ true.
       COALESCE(r.classified_by, '') NOT IN ('regra', 'default', 'historico', 'favorecido'),
       jsonb_build_object('categoria', r.categoria_antes,
                          'classified_by', r.classified_by,
                          'linha', r.linha_antes),
       p_actor);

    IF r.alvo = 'fin_transaction' THEN
      INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after,
                                 fields, batch_id, actor)
      SELECT t.entity_id, 'fin_transaction', t.id, 'update',
             jsonb_build_object('category_id', t.category_id,
                                'categoria', r.categoria_antes,
                                'classified_by', t.classified_by,
                                'classified_rule_id', t.classified_rule_id,
                                'human_locked_fields', t.human_locked_fields,
                                'review_status', t.review_status,
                                'linha_dre', r.linha_antes),
             jsonb_build_object('category_id', p_category_id,
                                'categoria', r.categoria_depois,
                                'classified_by', 'humano',
                                'classified_rule_id', NULL,
                                'human_locked_fields',
                                  CASE WHEN 'category_id' = ANY(t.human_locked_fields)
                                       THEN t.human_locked_fields
                                       ELSE array_append(t.human_locked_fields, 'category_id'::text) END,
                                'linha_dre', r.linha_depois,
                                'motivo', p_motivo),
             ARRAY['category_id', 'classified_by', 'classified_rule_id', 'human_locked_fields'],
             p_batch, p_actor
        FROM fin_transaction t WHERE t.id = r.id;
    ELSE
      INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after,
                                 fields, batch_id, actor)
      SELECT ca.entity_id, 'fin_card_transaction', ct.id, 'update',
             jsonb_build_object('category_id', ct.category_id,
                                'categoria', r.categoria_antes,
                                'classified_by', ct.classified_by,
                                'classified_rule_id', ct.classified_rule_id,
                                'human_locked_fields', ct.human_locked_fields,
                                'linha_dre', r.linha_antes),
             jsonb_build_object('category_id', p_category_id,
                                'categoria', r.categoria_depois,
                                'classified_by', 'humano',
                                'classified_rule_id', NULL,
                                'human_locked_fields',
                                  CASE WHEN 'category_id' = ANY(ct.human_locked_fields)
                                       THEN ct.human_locked_fields
                                       ELSE array_append(ct.human_locked_fields, 'category_id'::text) END,
                                'linha_dre', r.linha_depois,
                                'motivo', p_motivo),
             ARRAY['category_id', 'classified_by', 'classified_rule_id', 'human_locked_fields'],
             p_batch, p_actor
        FROM fin_card_transaction ct
        JOIN fin_card_account ca ON ca.id = ct.card_account_id
       WHERE ct.id = r.id;
    END IF;

    -- =====================================================================
    -- PASSO 3 — SÓ AGORA A TRANSAÇÃO
    -- =====================================================================
    -- `classified_rule_id = NULL` é obrigatório junto de `classified_by =
    -- 'humano'`: o par incompleto é exatamente o que o invariante D6 pega, e
    -- deixar o ponteiro faria o badge "por quê?" dizer "decidiu a regra X"
    -- para uma categoria que a regra X não produz.
    --
    -- `array_append(human_locked_fields, 'category_id')` protege a decisão do UPSERT do
    -- sync noturno. Com `classified_by = 'humano'` no mesmo UPDATE, E1 e E2
    -- continuam satisfeitos.
    IF r.alvo = 'fin_transaction' THEN
      UPDATE fin_transaction t
         SET category_id = p_category_id,
             classified_by = 'humano',
             classified_rule_id = NULL,
             classified_at = now(),
             classified_reason = jsonb_build_object(
               'origem', 'fin_dre_mover_aplicar',
               'motivo', p_motivo,
               'actor', p_actor,
               'categoria_anterior', r.categoria_antes,
               'linha_anterior', r.linha_antes,
               'batch_id', p_batch),
             human_locked_fields =
               CASE WHEN 'category_id' = ANY(t.human_locked_fields) THEN t.human_locked_fields
                    ELSE array_append(t.human_locked_fields, 'category_id'::text) END
       WHERE t.id = r.id;
    ELSE
      UPDATE fin_card_transaction ct
         SET category_id = p_category_id,
             classified_by = 'humano',
             classified_rule_id = NULL,
             classified_at = now(),
             -- A evidência da regra anterior não pode sobreviver a uma decisão
             -- humana que a contradiz: é o par incompleto do D6, do lado do
             -- cartão. O motivo e o autor ficam em fin_audit_log e no evento.
             classified_evidence = 'decisao_humana',
             human_locked_fields =
               CASE WHEN 'category_id' = ANY(ct.human_locked_fields) THEN ct.human_locked_fields
                    ELSE array_append(ct.human_locked_fields, 'category_id'::text) END
       WHERE ct.id = r.id;
    END IF;

    alvo := r.alvo; id := r.id;
    categoria_antes := r.categoria_antes; categoria_depois := r.categoria_depois;
    linha_antes := r.linha_antes; linha_depois := r.linha_depois; batch_id := p_batch;
    RETURN NEXT;
  END LOOP;
END $function$;

COMMENT ON FUNCTION fin_dre_mover_aplicar(text, bigint[], bigint, text, text, uuid) IS
  'Move lançamentos de linha da DRE RECLASSIFICANDO a categoria — a DRE é derivada e alterá-la '
  'direto criaria uma segunda verdade. Lote é tudo ou nada: se qualquer id for recusado por '
  'fin_dre_mover_avaliar, nada é escrito. A ORDEM DOS TRÊS PASSOS É OBRIGATÓRIA: resolve o item de '
  'fila baixa_confianca, grava a trilha com o valor anterior, e SÓ ENTÃO atualiza a transação — '
  'porque o gatilho da 0094 é BEFORE e lê a fila no instante do UPDATE. Grava classified_by=humano, '
  'zera classified_rule_id (D6) e acrescenta category_id a human_locked_fields (E1/E2).';

-- ---------------------------------------------------------------------------
-- 7. AJUSTE DECLARADO — a única forma de "adicionar" sem inventar
-- ---------------------------------------------------------------------------
-- Não é lançamento. Não é caixa. Não é receita nem despesa do extrato. É uma
-- afirmação humana, datada e assinada, que a tela mostra AO LADO da DRE, numa
-- seção própria, e nunca dentro dela.
--
-- Os CHECKs não são burocracia — cada um fecha um caminho por onde o ajuste
-- viraria dinheiro de mentira:
--
--   visao = 'competencia' ........ o caixa é o extrato. Um ajuste na visão
--                                  caixa faria a soma da coluna caixa deixar de
--                                  reconstruir o saldo, que é a regra de ouro.
--   linha é de secao='resultado' e tipo='item'
--                                  ajuste em subtotal seria dupla contagem;
--                                  ajuste em 'fora' ou 'lacuna' mentiria sobre
--                                  a natureza da seção.
--   motivo com 12+ caracteres .... "ajuste" não é motivo.
--   autor não vazio .............. ajuste anônimo é ajuste sem dono.
CREATE TABLE IF NOT EXISTS fin_dre_ajuste (
  id               bigserial PRIMARY KEY,
  entity_id        bigint NOT NULL REFERENCES fin_entity(id),
  visao            text NOT NULL DEFAULT 'competencia'
                     CHECK (visao = 'competencia'),
  mes              date NOT NULL,
  linha            text NOT NULL REFERENCES fin_dre_linha(slug),
  amount_cents     bigint NOT NULL CHECK (amount_cents <> 0),
  motivo           text NOT NULL CHECK (length(btrim(motivo)) >= 12),
  autor            text NOT NULL CHECK (btrim(autor) <> ''),
  evidencia_url    text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  revogado_em      timestamptz,
  revogado_por     text,
  revogado_motivo  text,
  CHECK (mes = date_trunc('month', mes)::date),
  -- Revogar é ato com dono e motivo, como criar. Meia revogação é pior que
  -- nenhuma: some da tela sem dizer quem tirou.
  CHECK ((revogado_em IS NULL) = (revogado_por IS NULL)),
  CHECK ((revogado_em IS NULL) = (revogado_motivo IS NULL))
);

CREATE INDEX IF NOT EXISTS fin_dre_ajuste_vigente_idx
  ON fin_dre_ajuste (entity_id, visao, mes) WHERE revogado_em IS NULL;

COMMENT ON TABLE fin_dre_ajuste IS
  'Ajuste gerencial DECLARADO: uma afirmação humana com autor, motivo e data, exibida em seção '
  'PRÓPRIA e nunca misturada ao que veio do extrato. NÃO altera saldo de conta, NÃO altera o caixa '
  'e NÃO entra em fin_dre_mensal_v — três garantias estruturais, não convenções: mora em tabela '
  'que a DRE não lê, um CHECK proíbe visao=caixa, e a asserção da regra de ouro roda com ajustes '
  'na base e continua com resíduo zero. Adicionar linha à DRE sem lastro não existe nesta base; '
  'isto é o que existe no lugar, e ele se declara como o que é.';

COMMENT ON COLUMN fin_dre_ajuste.visao IS
  'Sempre competencia, por CHECK. Na visão caixa o realizado é fin_transaction, sempre — um ajuste '
  'ali quebraria a soma que reconstrói o saldo.';

CREATE OR REPLACE FUNCTION fin_dre_ajuste_guarda() RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE v_secao text; v_tipo text;
BEGIN
  SELECT secao, tipo INTO v_secao, v_tipo FROM fin_dre_linha WHERE slug = NEW.linha;
  IF v_tipo <> 'item' THEN
    RAISE EXCEPTION 'ajuste em linha de subtotal (%) contaria duas vezes: o subtotal já soma os '
                    'itens. Ajuste a linha de item.', NEW.linha;
  END IF;
  IF v_secao <> 'resultado' THEN
    RAISE EXCEPTION 'ajuste só em linha da seção resultado. A linha % é da seção "%": "fora" é o '
                    'que existe no caixa e não é resultado, e "lacuna" é o que a DRE não conseguiu '
                    'classificar — declarar ajuste ali mentiria sobre a natureza da seção.',
                    NEW.linha, v_secao;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS fin_dre_ajuste_guarda ON fin_dre_ajuste;
CREATE TRIGGER fin_dre_ajuste_guarda
  BEFORE INSERT OR UPDATE OF linha ON fin_dre_ajuste
  FOR EACH ROW EXECUTE FUNCTION fin_dre_ajuste_guarda();

CREATE OR REPLACE VIEW fin_dre_ajuste_v AS
SELECT a.id, a.entity_id, a.visao, a.mes, a.linha,
       d.name                       AS linha_nome,
       a.amount_cents, a.motivo, a.autor, a.evidencia_url, a.criado_em,
       (a.revogado_em IS NULL)      AS vigente,
       a.revogado_em, a.revogado_por, a.revogado_motivo
  FROM fin_dre_ajuste a
  JOIN fin_dre_linha d ON d.slug = a.linha;

COMMENT ON VIEW fin_dre_ajuste_v IS
  'Os ajustes declarados, vigentes e revogados, com o nome da linha. Nada aqui é somado a '
  'fin_dre_mensal_v — a separação é o ponto.';

-- A DRE com os ajustes AO LADO, nunca dentro. `secao='ajuste'` é o que a tela
-- usa para desenhar a separação, e `origem` é o que ela usa para nunca somar
-- errado: 'extrato' é dinheiro que andou, 'declarado' é afirmação humana.
CREATE OR REPLACE VIEW fin_dre_com_ajuste_v AS
SELECT v.visao, v.mes, v.entity_id, v.linha, v.linha_nome, v.secao, v.tipo, v.ordem,
       v.formula, v.valor_cents, 'extrato'::text AS origem,
       NULL::text AS motivo, NULL::text AS autor
  FROM fin_dre_v v

UNION ALL
SELECT a.visao, a.mes, a.entity_id,
       'ajuste_' || a.linha, 'Ajuste declarado · ' || a.linha_nome,
       'ajuste', 'item', 400 + d.ordem, NULL,
       a.amount_cents, 'declarado',
       a.motivo, a.autor
  FROM fin_dre_ajuste_v a
  JOIN fin_dre_linha d ON d.slug = a.linha
 WHERE a.vigente

UNION ALL
-- O subtotal dos ajustes, e o resultado COM eles. Dois números publicados lado
-- a lado, como lucro_liquido e lucro_liquido_com_lacunas: publicar só um seria
-- escolher pelo leitor.
SELECT m.visao, m.mes, m.entity_id,
       'ajustes_declarados', 'Ajustes declarados (subtotal)', 'ajuste', 'subtotal', 500, NULL,
       COALESCE(aj.total, 0), 'declarado', NULL, NULL
  FROM fin_dre_mensal_v m
  LEFT JOIN LATERAL (
    SELECT sum(a.amount_cents) AS total FROM fin_dre_ajuste a
     WHERE a.entity_id = m.entity_id AND a.visao = m.visao AND a.mes = m.mes
       AND a.revogado_em IS NULL) aj ON true

UNION ALL
SELECT m.visao, m.mes, m.entity_id,
       'lucro_liquido_com_ajuste', 'Lucro líquido com ajustes declarados', 'ajuste', 'subtotal', 510,
       'lucro_liquido + ajustes_declarados',
       m.lucro_liquido_cents + COALESCE(aj.total, 0), 'declarado', NULL, NULL
  FROM fin_dre_mensal_v m
  LEFT JOIN LATERAL (
    SELECT sum(a.amount_cents) AS total FROM fin_dre_ajuste a
     WHERE a.entity_id = m.entity_id AND a.visao = m.visao AND a.mes = m.mes
       AND a.revogado_em IS NULL) aj ON true;

COMMENT ON VIEW fin_dre_com_ajuste_v IS
  'A DRE com os ajustes declarados AO LADO, em secao=ajuste, nunca dentro das linhas do extrato. '
  'A coluna `origem` separa o que andou no banco (extrato) do que alguém afirmou (declarado); '
  'somar as duas seções sem olhar essa coluna é o erro que a separação existe para impedir. '
  'fin_dre_v e fin_dre_mensal_v continuam intocados: o ajuste não os alcança.';

-- ---------------------------------------------------------------------------
-- 8. A REGRA DE OURO, COMO VIEW QUE MEDE
-- ---------------------------------------------------------------------------
-- Uma asserção que só existe dentro de um teste morre com o teste. Esta é uma
-- view: qualquer sessão, a qualquer hora, pergunta se o caixa ainda reconstrói
-- o saldo, e recebe o resíduo em centavos.
CREATE OR REPLACE VIEW fin_dre_regra_de_ouro_v AS
WITH caixa AS (
  SELECT entity_id,
         sum(receita_bruta_cents + deducoes_cents + custos_diretos_cents
           + despesas_pessoal_cents + despesas_comerciais_cents + despesas_administrativas_cents
           + resultado_financeiro_cents + capex_cents + movimentacao_cents
           + cartao_fatura_paga_cents + lacuna_ledger_cents + lacuna_cartao_cents) AS dre_cents,
         count(*) AS meses
    FROM fin_dre_mensal_v WHERE visao = 'caixa' GROUP BY entity_id
),
ledger AS (
  SELECT entity_id, sum(amount_cents) AS ledger_cents, count(*) AS lancamentos
    FROM fin_transaction WHERE NOT is_split_parent GROUP BY entity_id
),
contas AS (
  SELECT entity_id, sum(opening_balance_cents) AS abertura, sum(current_balance_cents) AS atual
    FROM fin_account GROUP BY entity_id
)
SELECT c.entity_id, c.meses, l.lancamentos,
       c.dre_cents, l.ledger_cents,
       c.dre_cents - l.ledger_cents                       AS residuo_ledger_cents,
       s.abertura, s.atual,
       s.abertura + c.dre_cents - s.atual                 AS residuo_saldo_cents,
       (SELECT count(*) FROM fin_dre_drill_v
         WHERE visao = 'caixa' AND origem = 'cartao')     AS itens_cartao_no_caixa,
       (c.dre_cents = l.ledger_cents
        AND s.abertura + c.dre_cents = s.atual
        AND NOT EXISTS (SELECT 1 FROM fin_dre_drill_v WHERE visao = 'caixa' AND origem = 'cartao'))
                                                          AS fecha
  FROM caixa c
  JOIN ledger l ON l.entity_id = c.entity_id
  JOIN contas s ON s.entity_id = c.entity_id;

COMMENT ON VIEW fin_dre_regra_de_ouro_v IS
  'A regra de ouro medida, não afirmada: na visão CAIXA o realizado é fin_transaction, sempre. '
  'residuo_ledger_cents é a diferença entre a soma de TODAS as colunas da DRE de caixa (64 meses) e '
  'a soma do ledger; residuo_saldo_cents é abertura + DRE − saldo atual. Os dois têm de ser ZERO, e '
  'itens_cartao_no_caixa tem de ser 0 — item de cartão não tem caixa próprio. `fecha` resume os '
  'três. Se um dia der falso, a DRE parou de ser derivada do caixa e virou uma segunda verdade.';

-- ---------------------------------------------------------------------------
-- 9. AS ASSERÇÕES — a migration se recusa a commitar se qualquer uma falhar
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_divergentes bigint;
  v_residuo     bigint;
  v_n           bigint;
  v_txt         text;
BEGIN
  -- 9.1 A função de linha reproduz o CASE da 0072 em 100% dos lançamentos. Se
  -- a 0072 mudar e esta função não, a divergência aparece aqui e não em
  -- produção, três semanas depois, num número que ninguém consegue explicar.
  SELECT count(*) INTO v_divergentes
    FROM fin_dre_lancamento_v l
   WHERE l.linha IS DISTINCT FROM fin_dre_linha_da_categoria(
           (SELECT c.id FROM fin_category c WHERE c.code = l.categoria_code
             AND c.entity_id = l.entity_id),
           l.linha = 'fora_cartao_fatura_paga',
           l.origem);
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION '0102: fin_dre_linha_da_categoria diverge de fin_dre_lancamento_v em % linha(s). '
                    'A tradução categoria → linha da DRE tem duas versões, e a simulação de mover '
                    'mentiria sobre o destino.', v_divergentes;
  END IF;

  -- 9.2 Cada nível soma exatamente o de cima. É consequência de refinar um
  -- GROUP BY — e é justamente por ser consequência que precisa de asserção:
  -- uma linha a mais no UNION quebra a premissa em silêncio.
  FOR v_n IN 2..4 LOOP
    SELECT count(*) INTO v_divergentes
      FROM (
        SELECT f.visao, f.mes, f.pai, sum(f.valor_cents) AS filho, sum(f.lancamentos) AS n_filho
          FROM fin_dre_drill_nivel_v f WHERE f.nivel = v_n
         GROUP BY f.visao, f.mes, f.pai) x
      JOIN fin_dre_drill_nivel_v p
        ON p.nivel = v_n - 1 AND p.visao = x.visao AND p.mes = x.mes AND p.chave = x.pai
     WHERE x.filho IS DISTINCT FROM p.valor_cents
        OR x.n_filho IS DISTINCT FROM p.lancamentos;
    IF v_divergentes > 0 THEN
      RAISE EXCEPTION '0102: nível % não soma o nível % em % grupo(s)', v_n, v_n - 1, v_divergentes;
    END IF;
  END LOOP;

  -- 9.3 O nível 1 reproduz fin_dre_mensal_v, linha a linha. Se o drill somar
  -- certo entre si e errado contra a DRE, ele é uma segunda verdade coerente
  -- — que é pior que uma incoerente, porque não se denuncia.
  SELECT count(*) INTO v_divergentes
    FROM fin_dre_drill_nivel_v n
    JOIN fin_dre_v v ON v.visao = n.visao AND v.mes = n.mes AND v.linha = n.linha
                    AND v.entity_id = n.entity_id
   WHERE n.nivel = 1 AND v.tipo = 'item' AND v.valor_cents IS DISTINCT FROM n.valor_cents;
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION '0102: o nível 1 do drill diverge de fin_dre_v em % linha(s)', v_divergentes;
  END IF;

  -- 9.4 Toda linha de item da DRE com valor tem representação no drill. O
  -- inverso da 9.3: lá o drill não pode dizer a mais, aqui não pode dizer a
  -- menos. Uma linha com valor e sem drill devolve tela vazia e parece bug.
  SELECT count(*) INTO v_divergentes
    FROM fin_dre_v v
   WHERE v.tipo = 'item' AND v.valor_cents <> 0
     AND NOT EXISTS (SELECT 1 FROM fin_dre_drill_nivel_v n
                      WHERE n.nivel = 1 AND n.visao = v.visao AND n.mes = v.mes
                        AND n.linha = v.linha AND n.entity_id = v.entity_id);
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION '0102: % linha(s) da DRE têm valor e não abrem no drill', v_divergentes;
  END IF;

  -- 9.5 A regra de ouro.
  SELECT residuo_ledger_cents + residuo_saldo_cents + itens_cartao_no_caixa
    INTO v_residuo FROM fin_dre_regra_de_ouro_v;
  IF COALESCE(v_residuo, -1) <> 0 THEN
    SELECT 'residuo_ledger=' || residuo_ledger_cents || ' residuo_saldo=' || residuo_saldo_cents
           || ' itens_cartao_no_caixa=' || itens_cartao_no_caixa
      INTO v_txt FROM fin_dre_regra_de_ouro_v;
    RAISE EXCEPTION '0102: a regra de ouro não fecha (%). Na visão caixa o realizado é '
                    'fin_transaction, sempre — e a soma dos 64 meses tem de reconstruir o saldo.',
                    v_txt;
  END IF;

  -- 9.6 O destino provável da lacuna é hipótese e não pode ter virado total.
  -- A prova: a soma das lacunas continua inteira na seção lacuna; nenhum
  -- centavo migrou para a linha "provável".
  SELECT count(*) INTO v_divergentes
    FROM (SELECT sum(abs(amount_cents)) AS bruto FROM fin_dre_lacuna_destino_v
           WHERE linha_provavel IS NOT NULL) h
    JOIN (SELECT sum(abs(valor_cents)) AS bruto FROM fin_dre_v
           WHERE secao = 'lacuna' AND tipo = 'item' AND visao = 'competencia') d ON true
   WHERE d.bruto < h.bruto;
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION '0102: a hipótese de destino da lacuna passou a valer mais que a lacuna medida';
  END IF;

  -- 9.7 O ajuste declarado não alcança fin_dre_mensal_v. Testado de verdade:
  -- insere um ajuste, confere que a DRE não se mexeu, e desfaz.
  DECLARE
    v_antes  bigint;
    v_depois bigint;
    v_mes    date;
    v_ent    bigint;
    v_id     bigint;
  BEGIN
    SELECT entity_id, mes, lucro_liquido_cents INTO v_ent, v_mes, v_antes
      FROM fin_dre_mensal_v WHERE visao = 'competencia' ORDER BY mes DESC LIMIT 1;
    IF v_ent IS NOT NULL THEN
      INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
      VALUES (v_ent, 'competencia', v_mes, 'despesas_administrativas', -100000,
              'prova de que o ajuste declarado nao alcanca a DRE derivada', 'migration:0102')
      RETURNING id INTO v_id;

      SELECT lucro_liquido_cents INTO v_depois
        FROM fin_dre_mensal_v WHERE visao = 'competencia' AND mes = v_mes AND entity_id = v_ent;
      IF v_depois IS DISTINCT FROM v_antes THEN
        RAISE EXCEPTION '0102: o ajuste declarado mudou fin_dre_mensal_v (% → %). Ele tem de ficar '
                        'em seção própria, separado do que veio do extrato.', v_antes, v_depois;
      END IF;

      SELECT residuo_ledger_cents + residuo_saldo_cents INTO v_residuo FROM fin_dre_regra_de_ouro_v;
      IF COALESCE(v_residuo, -1) <> 0 THEN
        RAISE EXCEPTION '0102: com um ajuste declarado na base, a regra de ouro deixou de fechar. '
                        'Ajuste não pode alterar caixa nem saldo de conta.';
      END IF;

      DELETE FROM fin_dre_ajuste WHERE id = v_id;
    END IF;
  END;

  -- 9.8 O impacto de mover soma zero por (visão, mês): mover reposiciona,
  -- nunca cria nem destrói. Exercitado sobre um caso real da base.
  DECLARE
    v_tx   bigint;
    v_cat  bigint;
  BEGIN
    SELECT t.id INTO v_tx
      FROM fin_transaction t
      JOIN fin_category c ON c.id = t.category_id
     WHERE NOT t.is_split_parent AND t.amount_cents < 0
       AND c.dre_line = 'despesas_administrativas'
     ORDER BY t.id LIMIT 1;
    SELECT c.id INTO v_cat FROM fin_category c
     WHERE c.dre_line = 'custos_servicos' AND c.is_active
       AND c.kind IN ('custo_variavel_direto', 'despesa_operacional')
     ORDER BY c.code LIMIT 1;

    IF v_tx IS NOT NULL AND v_cat IS NOT NULL THEN
      SELECT count(*) INTO v_divergentes
        FROM (SELECT visao, mes, sum(delta) AS d
                FROM fin_dre_mover_impacto('fin_transaction', ARRAY[v_tx], v_cat)
               GROUP BY visao, mes) x
       WHERE x.d <> 0;
      IF v_divergentes > 0 THEN
        RAISE EXCEPTION '0102: o impacto simulado de mover não soma zero em % (visão, mês). '
                        'Mover reposiciona dinheiro; não cria nem destrói.', v_divergentes;
      END IF;

      -- E a recusa por sinal precisa realmente recusar: uma categoria de
      -- receita numa saída tem de voltar `aceito=false`, não um UPDATE que
      -- o gatilho depois zera em silêncio.
      SELECT c.id INTO v_cat FROM fin_category c
       WHERE c.kind = 'receita' AND c.is_active ORDER BY c.code LIMIT 1;
      IF v_cat IS NOT NULL THEN
        SELECT count(*) INTO v_divergentes
          FROM fin_dre_mover_avaliar('fin_transaction', ARRAY[v_tx], v_cat) WHERE aceito;
        IF v_divergentes > 0 THEN
          RAISE EXCEPTION '0102: categoria de RECEITA aceita em lançamento de SAÍDA (D3)';
        END IF;
      END IF;
    END IF;
  END;

  RAISE NOTICE '0102: asserções OK — drill soma em 4 níveis, regra de ouro fecha, ajuste isolado.';
END $$;

-- ---------------------------------------------------------------------------
-- 10. ÂNCORA — nenhum centavo mudou de lugar
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_dif integer;
BEGIN
  SELECT count(*) INTO v_dif
    FROM (
      SELECT account_id, count(*) n, sum(amount_cents) soma FROM fin_transaction GROUP BY account_id
    ) agora
    FULL OUTER JOIN _ancora_0102 antes USING (account_id)
   WHERE agora.n IS DISTINCT FROM antes.n OR agora.soma IS DISTINCT FROM antes.soma;
  IF v_dif > 0 THEN
    RAISE EXCEPTION '0102: a âncora de dinheiro mudou em % conta(s). Esta migration é DDL e não '
                    'pode mover um centavo.', v_dif;
  END IF;
END $$;
