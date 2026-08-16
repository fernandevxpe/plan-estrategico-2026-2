-- As categorias de pessoal ganham o núcleo que a irmã delas já tinha.
--
-- ---------------------------------------------------------------------------
-- A LACUNA
-- ---------------------------------------------------------------------------
-- 6.02 Pró-labore tem default_nucleo='corporativo' desde a 0003. Suas irmãs do
-- mesmo grupo — 6.01 Salários, 6.04 Benefícios, 6.06 Estágio — não têm nenhum.
-- O resultado é que folha de pagamento aparece com núcleo em algumas linhas e
-- sem núcleo em outras, sem que nada no negócio justifique a diferença.
--
-- São 48 lançamentos de 2026 nessa situação. Nenhum deles tem pessoa vinculada
-- (medido: 0 de 48), então o núcleo não pode vir de fin_person.default_nucleo —
-- tem de vir da categoria, como já vem no pró-labore.
--
-- 'corporativo' e não 'obras' porque é o mesmo critério que a 0003 usou para o
-- pró-labore: folha sem alocação declarada é custo de estrutura. Quando a pessoa
-- estiver vinculada e tiver núcleo próprio, ele vence — o gatilho da 0049 só
-- preenche o que está vazio, nunca sobrescreve.
--
-- 3.90 Estornos e 4.03 Terceirização entram junto: também são categorias
-- órfãs de núcleo, e pelo mesmo motivo (ninguém preencheu), não por decisão.

UPDATE fin_category
   SET default_nucleo = 'corporativo'
 WHERE code IN ('6.01', '6.04', '6.06', '6.03', '6.05', '6.07', '6.08')
   AND default_nucleo IS NULL;

UPDATE fin_category
   SET default_nucleo = 'corporativo'
 WHERE code IN ('3.90', '4.03')
   AND default_nucleo IS NULL;

-- Aplica retroativamente ao que já está no ledger. O gatilho da 0049 cuida do
-- que entrar daqui em diante.
UPDATE fin_transaction t
   SET nucleo = c.default_nucleo, updated_at = now()
  FROM fin_category c
 WHERE c.id = t.category_id
   AND t.nucleo IS NULL
   AND c.default_nucleo IS NOT NULL
   AND COALESCE(c.cash_flow_group, '') <> 'movimentacao';

-- ---------------------------------------------------------------------------
-- E 5.99 CONTINUA SEM NÚCLEO, DE PROPÓSITO
-- ---------------------------------------------------------------------------
-- "Despesa a classificar" tem cash_flow_group='estrutura' e
-- dre_line='despesas_administrativas', o que a faz PARECER classificada: ela
-- entra na DRE, ocupa uma linha, soma num total.
--
-- Mas ela é a declaração de que ninguém sabe o que é aquilo. Dar núcleo a ela
-- seria escolher um dono para 239 despesas de 2026 sem nenhuma evidência — e
-- pior, o número ficaria bonito exatamente onde a informação não existe.
--
-- Ela fica sem núcleo para continuar aparecendo como trabalho a fazer. A view
-- abaixo é essa fila, ordenada por onde o dinheiro está.
CREATE OR REPLACE VIEW fin_a_classificar_v AS
SELECT t.id, t.posted_on, a.slug AS conta, t.amount_cents,
       t.description_raw, t.counterparty_raw, t.counterparty_document,
       cp.name AS contraparte, t.source_kind
  FROM fin_transaction t
  JOIN fin_account a ON a.id = t.account_id
  LEFT JOIN fin_category c ON c.id = t.category_id
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
 WHERE (c.code = '5.99' OR t.category_id IS NULL)
   AND COALESCE(c.cash_flow_group, '') <> 'movimentacao';

COMMENT ON VIEW fin_a_classificar_v IS
  'A fila real de classificação: sem categoria OU em 5.99 "a classificar". A 5.99 entra aqui '
  'porque ela parece classificada (tem dre_line, soma na DRE) e não está — é a declaração de '
  'que ninguém sabe o que é. Contá-la como categorizada infla o indicador exatamente onde a '
  'informação falta.';
