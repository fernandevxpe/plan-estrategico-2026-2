-- A leitura gerencial da DRE: percentual, crescimento e composição.
--
-- O QUE FALTAVA
-- -------------
-- `fin_dre_mensal_v` responde "quanto"; `fin_dre_dimensao_v` responde "de
-- quem". Nenhuma das duas responde as perguntas que alguém faz na frente de
-- uma DRE aberta: quanto isso representa da receita, cresceu ou caiu em
-- relação ao mês passado, e qual área puxou.
--
-- Dá para calcular tudo isso em TypeScript a cada requisição. O problema é que
-- margem calculada na tela diverge de margem calculada no relatório assim que
-- alguém muda um denominador — e essa divergência é invisível até alguém
-- comparar duas telas. Aqui a conta existe uma vez.
--
-- O DENOMINADOR É SEMPRE A RECEITA BRUTA DO MÊS
-- ---------------------------------------------
-- Percentual de custo sobre receita LÍQUIDA é mais ortodoxo, mas a XPE lê o
-- resultado contra o faturamento — é assim que a planilha do Fernando calcula
-- margem, e é assim que a conversa acontece. Manter o mesmo denominador dos
-- dois lados é o que permite comparar sem traduzir.
--
-- Mês sem receita devolve NULL, não zero: divisão por zero disfarçada de "0%"
-- é a forma mais fácil de um painel mentir.
--
-- CRESCIMENTO: MÊS ANTERIOR E MESMO MÊS DO ANO ANTERIOR
-- -----------------------------------------------------
-- O mês anterior mostra tendência curta; o ano anterior tira a sazonalidade.
-- Numa operação onde março faturou R$251 mil e abril R$154 mil, olhar só o MoM
-- diria "caiu 38%" sem dizer que março foi atípico.

CREATE OR REPLACE VIEW fin_analise_mensal_v AS
WITH base AS (
  SELECT v.visao, v.mes, l.entity_id,
         sum(l.amount_cents) FILTER (WHERE l.linha = 'receita_bruta')                     AS receita_bruta,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'deducoes_devolucoes')              AS devolucoes,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'deducoes_impostos')                AS impostos,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'custos_diretos')                   AS custos_diretos,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'despesas_pessoal')                 AS pessoal,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'despesas_comerciais')              AS comerciais,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'despesas_administrativas')         AS administrativas,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'resultado_financeiro')             AS financeiro,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'fora_investimento_capex')          AS capex,
         sum(-l.amount_cents) FILTER (WHERE l.linha = 'fora_cartao_fatura_paga')          AS cartao,
         sum(-l.amount_cents) FILTER (WHERE l.linha IN
              ('lacuna_ledger_sem_categoria','lacuna_cartao_sem_categoria'))              AS lacunas,
         count(*)                                                                          AS lancamentos
    FROM fin_dre_lancamento_v l
    CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
                 AS v(visao, mes)
   WHERE v.mes IS NOT NULL
   GROUP BY v.visao, v.mes, l.entity_id
),
calc AS (
  SELECT b.*,
         COALESCE(b.receita_bruta, 0) - COALESCE(b.devolucoes, 0)                          AS receita_liquida,
         COALESCE(b.receita_bruta, 0) - COALESCE(b.devolucoes, 0) - COALESCE(b.custos_diretos, 0) AS margem_contribuicao,
         COALESCE(b.custos_diretos, 0) + COALESCE(b.pessoal, 0)
           + COALESCE(b.comerciais, 0) + COALESCE(b.administrativas, 0)                    AS custo_operacional
    FROM base b
),
res AS (
  SELECT c.*,
         c.receita_liquida - c.custo_operacional                                           AS ebitda,
         c.receita_liquida - c.custo_operacional - COALESCE(c.impostos, 0)
           - COALESCE(c.financeiro, 0)                                                     AS lucro_liquido,
         c.receita_liquida - c.custo_operacional - COALESCE(c.impostos, 0)
           - COALESCE(c.cartao, 0) - COALESCE(c.capex, 0)                                  AS resultado_caixa
    FROM calc c
)
SELECT
  r.visao, r.mes, r.entity_id,
  r.receita_bruta      AS receita_bruta_cents,
  r.devolucoes         AS devolucoes_cents,
  r.receita_liquida    AS receita_liquida_cents,
  r.custos_diretos     AS custos_diretos_cents,
  r.margem_contribuicao AS margem_contribuicao_cents,
  r.pessoal            AS pessoal_cents,
  r.comerciais         AS comerciais_cents,
  r.administrativas    AS administrativas_cents,
  r.custo_operacional  AS custo_operacional_cents,
  r.ebitda             AS ebitda_cents,
  r.impostos           AS impostos_cents,
  r.financeiro         AS financeiro_cents,
  r.lucro_liquido      AS lucro_liquido_cents,
  r.capex              AS capex_cents,
  r.cartao             AS cartao_cents,
  r.resultado_caixa    AS resultado_caixa_cents,
  r.lacunas            AS lacunas_cents,
  r.lancamentos,

  -- Percentuais sobre a receita bruta. NULL quando não há receita: um mês sem
  -- faturamento não tem margem "de 0%", tem margem indefinida.
  CASE WHEN r.receita_bruta > 0 THEN round(r.custos_diretos    * 100.0 / r.receita_bruta, 2) END AS pct_custos_diretos,
  CASE WHEN r.receita_bruta > 0 THEN round(r.pessoal           * 100.0 / r.receita_bruta, 2) END AS pct_pessoal,
  CASE WHEN r.receita_bruta > 0 THEN round(r.comerciais        * 100.0 / r.receita_bruta, 2) END AS pct_comerciais,
  CASE WHEN r.receita_bruta > 0 THEN round(r.administrativas   * 100.0 / r.receita_bruta, 2) END AS pct_administrativas,
  CASE WHEN r.receita_bruta > 0 THEN round(r.custo_operacional * 100.0 / r.receita_bruta, 2) END AS pct_custo_operacional,
  CASE WHEN r.receita_bruta > 0 THEN round(r.impostos          * 100.0 / r.receita_bruta, 2) END AS pct_impostos,
  CASE WHEN r.receita_bruta > 0 THEN round(r.margem_contribuicao * 100.0 / r.receita_bruta, 2) END AS margem_contribuicao_pct,
  CASE WHEN r.receita_bruta > 0 THEN round(r.ebitda            * 100.0 / r.receita_bruta, 2) END AS margem_ebitda_pct,
  CASE WHEN r.receita_bruta > 0 THEN round(r.lucro_liquido     * 100.0 / r.receita_bruta, 2) END AS margem_liquida_pct,

  -- Crescimento. LAG dentro da mesma visão e entidade, ordenado por mês.
  lag(r.receita_bruta) OVER w   AS receita_mes_anterior_cents,
  CASE WHEN lag(r.receita_bruta) OVER w > 0
       THEN round((r.receita_bruta - lag(r.receita_bruta) OVER w) * 100.0 / lag(r.receita_bruta) OVER w, 2) END
                                AS receita_variacao_pct,
  lag(r.custo_operacional) OVER w AS custo_mes_anterior_cents,
  CASE WHEN lag(r.custo_operacional) OVER w > 0
       THEN round((r.custo_operacional - lag(r.custo_operacional) OVER w) * 100.0 / lag(r.custo_operacional) OVER w, 2) END
                                AS custo_variacao_pct,
  CASE WHEN lag(r.ebitda) OVER w <> 0
       THEN round((r.ebitda - lag(r.ebitda) OVER w) * 100.0 / abs(lag(r.ebitda) OVER w), 2) END
                                AS ebitda_variacao_pct,

  -- Mesmo mês do ano anterior: tira sazonalidade de uma operação em que um
  -- único mês (março) pode valer 60% mais que o seguinte.
  lag(r.receita_bruta, 12) OVER w AS receita_ano_anterior_cents,
  CASE WHEN lag(r.receita_bruta, 12) OVER w > 0
       THEN round((r.receita_bruta - lag(r.receita_bruta, 12) OVER w) * 100.0 / lag(r.receita_bruta, 12) OVER w, 2) END
                                AS receita_yoy_pct,

  -- Média móvel de 3 meses: o número que se olha quando o mês é atípico.
  round(avg(r.receita_bruta) OVER (PARTITION BY r.visao, r.entity_id ORDER BY r.mes ROWS BETWEEN 2 PRECEDING AND CURRENT ROW))
                                AS receita_media3_cents,
  round(avg(r.ebitda) OVER (PARTITION BY r.visao, r.entity_id ORDER BY r.mes ROWS BETWEEN 2 PRECEDING AND CURRENT ROW))
                                AS ebitda_media3_cents
FROM res r
WINDOW w AS (PARTITION BY r.visao, r.entity_id ORDER BY r.mes);

COMMENT ON VIEW fin_analise_mensal_v IS
  'DRE mensal com percentuais sobre receita bruta, variação contra o mês anterior e contra o '
  'mesmo mês do ano anterior, e média móvel de 3 meses. O denominador é a receita BRUTA porque '
  'é assim que a operação lê margem — mesma régua da planilha de gestão. Mês sem receita devolve '
  'NULL nos percentuais, nunca zero (0131).';

-- ---------------------------------------------------------------------------
-- Composição por núcleo: qual área puxou o resultado
-- ---------------------------------------------------------------------------
-- `fin_dre_dimensao_v` já quebra por núcleo, mas sem o percentual de
-- participação — e "Obras representou 31% da receita" é a frase que se diz numa
-- reunião, não "Obras somou R$ 78.412,00".
CREATE OR REPLACE VIEW fin_analise_nucleo_v AS
WITH d AS (
  SELECT v.visao, v.mes, l.entity_id,
         COALESCE(l.nucleo, 'sem_nucleo')                                        AS nucleo,
         sum(l.amount_cents) FILTER (WHERE l.linha = 'receita_bruta')            AS receita,
         sum(-l.amount_cents) FILTER (WHERE l.linha IN
             ('custos_diretos','despesas_pessoal','despesas_comerciais','despesas_administrativas')) AS custo,
         count(*)                                                                AS lancamentos
    FROM fin_dre_lancamento_v l
    CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
                 AS v(visao, mes)
   WHERE v.mes IS NOT NULL
   GROUP BY v.visao, v.mes, l.entity_id, COALESCE(l.nucleo, 'sem_nucleo')
)
SELECT d.visao, d.mes, d.entity_id, d.nucleo,
       n.name                                        AS nucleo_nome,
       n.is_overhead,
       COALESCE(d.receita, 0)                        AS receita_cents,
       COALESCE(d.custo, 0)                          AS custo_cents,
       COALESCE(d.receita, 0) - COALESCE(d.custo, 0) AS resultado_cents,
       d.lancamentos,
       CASE WHEN sum(d.receita) OVER (PARTITION BY d.visao, d.mes, d.entity_id) > 0
            THEN round(COALESCE(d.receita, 0) * 100.0
                       / sum(d.receita) OVER (PARTITION BY d.visao, d.mes, d.entity_id), 2) END
                                                     AS participacao_receita_pct,
       CASE WHEN sum(d.custo) OVER (PARTITION BY d.visao, d.mes, d.entity_id) > 0
            THEN round(COALESCE(d.custo, 0) * 100.0
                       / sum(d.custo) OVER (PARTITION BY d.visao, d.mes, d.entity_id), 2) END
                                                     AS participacao_custo_pct,
       CASE WHEN COALESCE(d.receita, 0) > 0
            THEN round((COALESCE(d.receita, 0) - COALESCE(d.custo, 0)) * 100.0 / d.receita, 2) END
                                                     AS margem_pct
  FROM d
  LEFT JOIN fin_nucleo n ON n.slug = d.nucleo;

COMMENT ON VIEW fin_analise_nucleo_v IS
  'Receita, custo e margem por núcleo, com a participação de cada um no mês. is_overhead marca '
  'o núcleo que não tem receita própria (Corporativo) — margem ali é sempre negativa por '
  'construção, e comparar com Obras seria erro de leitura (0131).';

-- ---------------------------------------------------------------------------
-- Receita por categoria, com participação e recorrência
-- ---------------------------------------------------------------------------
-- Separa o que se repete do que é evento único. Um mês puxado por um projeto
-- grande e um mês puxado por assinatura têm a mesma receita e significados
-- opostos — e a XPE tem os dois: contrato de obra pontual e Monitor BT mensal.
CREATE OR REPLACE VIEW fin_analise_receita_v AS
WITH r AS (
  SELECT v.visao, v.mes, l.entity_id, l.categoria_code,
         sum(l.amount_cents) AS valor,
         count(*)            AS lancamentos,
         count(DISTINCT l.counterparty_id) AS clientes
    FROM fin_dre_lancamento_v l
    CROSS JOIN LATERAL (VALUES ('caixa', l.mes_caixa), ('competencia', l.mes_competencia))
                 AS v(visao, mes)
   WHERE v.mes IS NOT NULL AND l.linha = 'receita_bruta'
   GROUP BY v.visao, v.mes, l.entity_id, l.categoria_code
)
SELECT r.visao, r.mes, r.entity_id, r.categoria_code,
       c.name                     AS categoria_nome,
       pl.name                    AS linha_produto,
       r.valor                    AS receita_cents,
       r.lancamentos, r.clientes,
       CASE WHEN sum(r.valor) OVER (PARTITION BY r.visao, r.mes, r.entity_id) > 0
            THEN round(r.valor * 100.0 / sum(r.valor) OVER (PARTITION BY r.visao, r.mes, r.entity_id), 2) END
                                  AS participacao_pct,
       lag(r.valor) OVER (PARTITION BY r.visao, r.entity_id, r.categoria_code ORDER BY r.mes)
                                  AS mes_anterior_cents,
       -- Em quantos dos últimos 6 meses esta categoria teve receita. 6 de 6 é
       -- recorrente; 1 de 6 é evento. É o que separa assinatura de projeto.
       count(*) FILTER (WHERE r.valor > 0) OVER (
         PARTITION BY r.visao, r.entity_id, r.categoria_code
         ORDER BY r.mes ROWS BETWEEN 5 PRECEDING AND CURRENT ROW)
                                  AS meses_com_receita_em_6
  FROM r
  LEFT JOIN fin_category c ON c.code = r.categoria_code
  LEFT JOIN fin_product_line pl ON pl.id = c.product_line_id;

COMMENT ON VIEW fin_analise_receita_v IS
  'Receita por categoria com participação no mês e recorrência medida (em quantos dos últimos 6 '
  'meses houve receita). Recorrência é o que separa assinatura de projeto pontual — dois meses '
  'com a mesma receita e significados opostos (0131).';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_receita_analise bigint; v_receita_dre bigint; v_nucleo bigint; v_pct numeric;
BEGIN
  -- 1. A análise não pode inventar nem perder receita: tem de bater com a DRE.
  SELECT COALESCE(sum(receita_bruta_cents), 0) INTO v_receita_analise
    FROM fin_analise_mensal_v WHERE visao = 'caixa';
  SELECT COALESCE(sum(amount_cents), 0) INTO v_receita_dre
    FROM fin_dre_lancamento_v WHERE linha = 'receita_bruta' AND mes_caixa IS NOT NULL;
  IF v_receita_analise <> v_receita_dre THEN
    RAISE EXCEPTION 'fin_analise_mensal_v soma % de receita; fin_dre_lancamento_v soma %',
      v_receita_analise, v_receita_dre;
  END IF;

  -- 2. A quebra por núcleo tem de fechar com o total.
  SELECT COALESCE(sum(receita_cents), 0) INTO v_nucleo
    FROM fin_analise_nucleo_v WHERE visao = 'caixa';
  IF v_nucleo <> v_receita_dre THEN
    RAISE EXCEPTION 'fin_analise_nucleo_v soma % de receita; esperado %', v_nucleo, v_receita_dre;
  END IF;

  -- 3. Participação por núcleo tem de somar 100% em todo mês com receita —
  --    é o teste que pega denominador errado numa window function.
  SELECT max(abs(t - 100)) INTO v_pct FROM (
    SELECT mes, sum(participacao_receita_pct) t
      FROM fin_analise_nucleo_v
     WHERE visao = 'caixa' AND participacao_receita_pct IS NOT NULL
     GROUP BY mes) s;
  IF v_pct IS NOT NULL AND v_pct > 0.5 THEN
    RAISE EXCEPTION 'participação por núcleo não fecha 100%%: desvio máximo de %', v_pct;
  END IF;

  -- 4. Percentual nunca pode existir sem receita: NULL, não zero.
  IF EXISTS (SELECT 1 FROM fin_analise_mensal_v
              WHERE COALESCE(receita_bruta_cents, 0) <= 0 AND margem_ebitda_pct IS NOT NULL) THEN
    RAISE EXCEPTION 'existe margem calculada em mês sem receita — divisão por zero disfarçada';
  END IF;
END $$;
