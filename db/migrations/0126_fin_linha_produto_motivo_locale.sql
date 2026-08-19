-- Corrige o formato do valor em fin_linha_produto_uso_v.motivo_bloqueio.
--
-- A 0124 usava to_char(..., 'FM999G999G990D00') pra formatar o valor vivo em
-- reais dentro da frase — e o lc_numeric deste banco produz separador de
-- milhar como vírgula e decimal como ponto ("27,400.00"), o formato
-- americano, não o brasileiro que o resto da plataforma usa em toda parte
-- (brlPrecise, toLocaleString('pt-BR')). Pego em teste manual antes de
-- qualquer usuário ver, ao atribuir uma categoria de teste e olhar a
-- mensagem de bloqueio de verdade.
--
-- fin_categoria_uso_v (0101), a view irmã que esta migration espelhou, NUNCA
-- embutiu valor formatado na frase — só contagens ("%s item(ns) vivo(s)...").
-- A correção segue o mesmo padrão em vez de brigar com o locale do banco: o
-- valor em reais já aparece certo na tela, na coluna "valor" (valorVivoCents,
-- formatado em TypeScript). O texto da recusa não precisa repeti-lo.

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
         ELSE format('%s categoria(s) ainda apontam para ela — %s, somando %s item(ns) vivo(s)',
                      u.n_categorias_ativas,
                      array_to_string(u.categorias_codes, ', '),
                      u.n_vivo)
       END                                                     AS motivo_bloqueio
  FROM fin_product_line pl
  JOIN uso u ON u.id = pl.id;

COMMENT ON VIEW fin_linha_produto_uso_v IS
  'Uso de cada linha de produto, medido pelas categorias atribuídas a ela — reaproveita '
  'fin_categoria_uso_v (0101) em vez de recontar. pode_desativar é a régua que a rota de '
  'escrita e a tela leem, as duas, sem duplicar a conta. motivo_bloqueio traz só contagens '
  '(0126) — o valor em reais já aparece formatado em pt-BR na coluna da tela.';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_tem_virgula_ponto boolean;
BEGIN
  -- Nenhuma mensagem de bloqueio pode conter o padrão "dígito,dígito...dígito.dígito"
  -- (a assinatura do formato americano que causou o bug).
  SELECT bool_or(motivo_bloqueio ~ '\d,\d{3}.*\.\d{2}\M')
    INTO v_tem_virgula_ponto
    FROM fin_linha_produto_uso_v
   WHERE motivo_bloqueio IS NOT NULL;

  IF v_tem_virgula_ponto THEN
    RAISE EXCEPTION '[0126] ainda achei motivo_bloqueio em formato numérico americano';
  END IF;

  RAISE NOTICE '[0126] motivo_bloqueio de fin_linha_produto_uso_v não embute mais valor formatado';
END $$;
