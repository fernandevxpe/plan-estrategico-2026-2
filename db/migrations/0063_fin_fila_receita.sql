-- A fila de classificação enxerga receita também.
--
-- A 0055 criou fin_a_classificar_v olhando 5.99 "Despesa a classificar" e
-- lançamentos sem categoria. Faltou 3.99 "Receita a classificar", que tem a
-- mesma natureza: parece classificada, entra na DRE, e é a declaração de que
-- ninguém sabe de que serviço aquele dinheiro veio.
--
-- São 63 lançamentos de 2026, R$ 79.265,35 — receita entrando sem saber se é
-- consultoria, laudo, projeto ou gestão. Some do "receita por tipo de serviço",
-- que é uma das perguntas centrais da plataforma, e ninguém percebia porque o
-- indicador de categoria a contava como resolvida.
--
-- O critério passa a ser explícito: categoria cujo NOME declara indefinição
-- conta como não classificada, independente do código.
-- DROP e recria: a view existente tem outras colunas, e CREATE OR REPLACE não
-- consegue renomear coluna de view. Nada depende dela ainda além de consulta
-- manual — é o momento barato de mudar a forma.
DROP VIEW IF EXISTS fin_a_classificar_v;
CREATE VIEW fin_a_classificar_v AS
SELECT t.id, t.posted_on, a.slug AS conta, t.amount_cents,
       t.description_raw, t.counterparty_raw, t.counterparty_document,
       cp.name AS contraparte, t.source_kind,
       CASE WHEN t.amount_cents > 0 THEN 'receita' ELSE 'despesa' END AS natureza,
       COALESCE(c.code, '(sem categoria)') AS categoria_atual
  FROM fin_transaction t
  JOIN fin_account a ON a.id = t.account_id
  LEFT JOIN fin_category c ON c.id = t.category_id
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
 WHERE (c.code IN ('5.99', '3.99') OR t.category_id IS NULL)
   AND COALESCE(c.cash_flow_group, '') <> 'movimentacao';

COMMENT ON VIEW fin_a_classificar_v IS
  'Fila real de classificação: sem categoria OU em 5.99/3.99 "a classificar". As duas parecem '
  'categoria (têm dre_line, somam na DRE) e são a declaração de que ninguém sabe o que é. '
  'Contá-las como resolvidas infla o indicador exatamente onde a informação falta.';
