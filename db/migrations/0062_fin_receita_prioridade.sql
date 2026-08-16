-- O que não pode deixar de entrar este mês.
--
-- ---------------------------------------------------------------------------
-- A PERGUNTA QUE ISTO RESPONDE
-- ---------------------------------------------------------------------------
-- Do Fernando: "quero ver por grupo e todo detalhe dos principais, facilitando
-- saber quais receitas são importantes não deixar de receber do mês".
--
-- Uma lista de 255 cobranças ordenada por valor não responde isso. O que
-- responde é a CONCENTRAÇÃO: normalmente uns poucos clientes carregam a maior
-- parte do mês, e são esses que, se atrasarem, quebram o caixa. Os outros
-- duzentos, somados, importam menos que os cinco primeiros.
--
-- Por isso a view entrega o percentual acumulado (curva ABC) junto com o valor:
--
--   faixa A  até 80% do mês  — se um destes falhar, o mês sente
--   faixa B  de 80% a 95%    — acompanhar
--   faixa C  os últimos 5%   — cauda longa, não vale perseguir
--
-- Com isso a tela pode abrir mostrando só a faixa A e ainda estar mostrando a
-- maior parte do dinheiro.
--
-- ---------------------------------------------------------------------------
-- O AGRUPAMENTO É POR CONTRAPARTE, NÃO POR COBRANÇA
-- ---------------------------------------------------------------------------
-- Um cliente pode ter três cobranças no mesmo mês — assinatura, parcela de
-- projeto e um serviço avulso. Para "quem não pode falhar", o que importa é o
-- total daquele cliente, não cada boleto isolado. O detalhe de cada cobrança
-- continua disponível em fin_previsao_recebimento_v, para o drill-down.

CREATE OR REPLACE VIEW fin_receita_prioridade_v AS
WITH base AS (
  SELECT p.mes,
         p.counterparty_id,
         COALESCE(p.contraparte, '(sem contraparte identificada)') AS contraparte,
         sum(p.amount_cents)                                       AS total_cents,
         count(*)                                                  AS cobrancas,
         -- Onde a certeza é diferente dentro do mesmo cliente, a MENOR manda:
         -- um cliente com boleto emitido e projeção no mesmo mês é tão firme
         -- quanto a parte projetada dele.
         min(CASE p.certeza WHEN 'firme' THEN 3 WHEN 'provavel' THEN 2 ELSE 1 END) AS certeza_ord,
         string_agg(DISTINCT p.camada, ' + ' ORDER BY p.camada)    AS camadas,
         min(p.data_prevista)                                      AS primeira_data,
         max(p.data_prevista)                                      AS ultima_data
    FROM fin_previsao_recebimento_v p
   WHERE p.camada <> 'vencido_a_receber'   -- atrasado tem tela própria
   GROUP BY p.mes, p.counterparty_id, COALESCE(p.contraparte, '(sem contraparte identificada)')
),
ranqueado AS (
  SELECT b.*,
         sum(b.total_cents) OVER (PARTITION BY b.mes)                          AS mes_total_cents,
         row_number()       OVER (PARTITION BY b.mes ORDER BY b.total_cents DESC) AS posicao,
         sum(b.total_cents) OVER (PARTITION BY b.mes ORDER BY b.total_cents DESC
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado_cents
    FROM base b
)
SELECT
  r.mes,
  r.posicao,
  r.counterparty_id,
  r.contraparte,
  r.total_cents,
  r.cobrancas,
  r.camadas,
  r.primeira_data,
  r.ultima_data,
  CASE r.certeza_ord WHEN 3 THEN 'firme' WHEN 2 THEN 'provavel' ELSE 'observado' END AS certeza,
  r.mes_total_cents,
  round(100.0 * r.total_cents     / NULLIF(r.mes_total_cents, 0), 1) AS pct_do_mes,
  round(100.0 * r.acumulado_cents / NULLIF(r.mes_total_cents, 0), 1) AS pct_acumulado,
  -- A faixa usa o acumulado ATÉ a linha anterior, senão o primeiro cliente de um
  -- mês concentrado (que sozinho passa de 80%) cairia em B e ninguém veria o
  -- item mais importante do mês na faixa mais importante.
  CASE
    WHEN round(100.0 * (r.acumulado_cents - r.total_cents) / NULLIF(r.mes_total_cents, 0), 1) < 80 THEN 'A'
    WHEN round(100.0 * (r.acumulado_cents - r.total_cents) / NULLIF(r.mes_total_cents, 0), 1) < 95 THEN 'B'
    ELSE 'C'
  END AS faixa
  FROM ranqueado r;

COMMENT ON VIEW fin_receita_prioridade_v IS
  'Receita prevista por cliente e mês, com curva de concentração. faixa A = até 80% do mês '
  '(se um destes falhar, o mês sente); B = 80–95%; C = cauda. Agrupa por contraparte porque '
  'um cliente pode ter assinatura, parcela e avulso no mesmo mês, e o que importa para '
  '"quem não pode falhar" é o total dele. O detalhe por cobrança está em '
  'fin_previsao_recebimento_v. Exclui vencido_a_receber, que é cobrança de outra natureza.';

-- ---------------------------------------------------------------------------
-- E o mesmo corte por GRUPO de receita
-- ---------------------------------------------------------------------------
-- "Por grupo" tem dois sentidos aqui, e os dois interessam: por natureza do que
-- se recebe (assinatura, parcelamento, avulso) e por linha de negócio. Esta
-- view responde a primeira; a segunda depende da categoria da cobrança, que
-- nem toda previsão tem.
CREATE OR REPLACE VIEW fin_receita_por_grupo_v AS
SELECT p.mes,
       p.camada                                   AS grupo,
       p.certeza,
       count(*)                                   AS itens,
       count(DISTINCT p.counterparty_id)          AS clientes,
       sum(p.amount_cents)                        AS total_cents,
       round(100.0 * sum(p.amount_cents) /
             NULLIF(sum(sum(p.amount_cents)) OVER (PARTITION BY p.mes), 0), 1) AS pct_do_mes
  FROM fin_previsao_recebimento_v p
 GROUP BY p.mes, p.camada, p.certeza;

COMMENT ON VIEW fin_receita_por_grupo_v IS
  'Receita prevista por mês e natureza (cobranca_emitida, assinatura, parcelamento, '
  'ativo_de_fato, vencido_a_receber), com participação de cada grupo no mês. Responde "de onde '
  'vem o dinheiro deste mês" antes de "de quem".';
