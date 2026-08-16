-- As 81 transferências próprias saem de "a classificar".
--
-- ---------------------------------------------------------------------------
-- POR QUE O RECLASSIFICADOR NÃO RESOLVEU ISTO SOZINHO
-- ---------------------------------------------------------------------------
-- O motor de regras tem uma proteção deliberada: ele PREENCHE categoria vazia,
-- mas não TROCA categoria existente sem que a regra tenha confiança para tanto.
-- É a proteção certa — foi ela que impediu, hoje mesmo, que 205 lançamentos de
-- pró-labore virassem salário por uma regra genérica.
--
-- O efeito colateral é que 5.99 "Despesa a classificar" se comporta como
-- categoria de verdade para essa proteção. Uma linha que alguém marcou como "não
-- sei o que é" fica congelada nesse estado mesmo depois que a evidência aparece.
--
-- ---------------------------------------------------------------------------
-- A EVIDÊNCIA QUE APARECEU
-- ---------------------------------------------------------------------------
-- Depois da 0042 (lastro do PIX) e da 0052 (Nubank pelo Polp), estas linhas
-- passaram a carregar `counterparty_document`. E 81 delas, somando
-- R$ 966.069,29, têm o documento da PRÓPRIA EMPRESA — 34776108000192, a única
-- fin_entity cadastrada:
--
--   "Pix recebido — Xp Energy Servicos De Medicao" ... 8 linhas de R$ 30.000,00
--
-- São repasses do Asaas para o Inter. Não é interpretação: é o mesmo CNPJ nas
-- duas pontas, que por definição não é receita nem despesa — é o mesmo dinheiro
-- mudando de conta.
--
-- Deixá-las em 5.99 tem consequência direta: 5.99 tem
-- dre_line='despesas_administrativas', então quase um milhão de reais de
-- transferência interna estava computado como DESPESA na DRE.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO É UMA TROCA SEGURA, E AS OUTRAS NÃO SERIAM
-- ---------------------------------------------------------------------------
-- A troca só acontece onde o documento da contraparte é igual ao CNPJ da
-- entidade — não por nome, não por valor, não por padrão de descrição. É a mesma
-- tese da 0042: o documento resolve o que o nome esconde. "XPE Tecnologia" e
-- "XP ENERGY SERVICOS" são a mesma empresa, e nenhuma comparação de texto diria
-- isso.
--
-- E o CNPJ é lido de fin_entity, não digitado aqui: se um dia a empresa mudar,
-- não fica um literal errado escondido numa migration antiga.

UPDATE fin_transaction t
   SET category_id = (SELECT id FROM fin_category WHERE code = '9.01' LIMIT 1),
       nucleo = NULL,                         -- movimentação não tem núcleo (0049)
       classified_by = 'fato_estrutural',
       classified_reason = jsonb_build_object(
         'origem', 'documento_da_contraparte',
         'motivo', 'contraparte tem o CNPJ da propria entidade: transferencia entre contas proprias',
         'documento', t.counterparty_document),
       classified_at = now(),
       updated_at = now()
  FROM fin_category c, fin_entity e
 WHERE c.id = t.category_id
   AND c.code = '5.99'
   AND e.id = t.entity_id
   AND t.counterparty_document = regexp_replace(e.cnpj, '[^0-9]', '', 'g')
   -- decisão humana explícita nunca é sobrescrita
   AND NOT ('category_id' = ANY (COALESCE(t.human_locked_fields, ARRAY[]::text[])));

-- Sem categoria e com o CNPJ da casa é o mesmo fato, só que ainda mais claro:
-- não há nem o rótulo de "a classificar" para preservar.
UPDATE fin_transaction t
   SET category_id = (SELECT id FROM fin_category WHERE code = '9.01' LIMIT 1),
       classified_by = 'fato_estrutural',
       classified_reason = jsonb_build_object(
         'origem', 'documento_da_contraparte',
         'motivo', 'contraparte tem o CNPJ da propria entidade: transferencia entre contas proprias',
         'documento', t.counterparty_document),
       classified_at = now(),
       updated_at = now()
  FROM fin_entity e
 WHERE t.category_id IS NULL
   AND e.id = t.entity_id
   AND t.counterparty_document = regexp_replace(e.cnpj, '[^0-9]', '', 'g')
   AND NOT ('category_id' = ANY (COALESCE(t.human_locked_fields, ARRAY[]::text[])));
