-- Refeição estava em duas categorias ao mesmo tempo, e a culpa é da 0128.
--
-- O QUE EU FIZ ERRADO NA 0128
-- ---------------------------
-- Criei quatro regras mandando fornecedor de refeição para `6.05 Reembolsos a
-- colaboradores`: Rita de Cássia, Robson, São Braz Delicatessen e O Rei das
-- Coxinhas. Na hora pareceu coerente, porque o ClickUp rotula esses pagamentos
-- como "Alimentação" e a planilha de gestão junta tudo numa linha só
-- ("Alimentação, Transporte e Reembolsos").
--
-- Só que `6.04 Benefícios` já era, na prática, a categoria de refeição: hoje
-- ela contém EXCLUSIVAMENTE estabelecimentos de alimentação — Rosimere (28
-- pagamentos), O Bom de Garfo, Supermercado Pernambucano, Sport Burg,
-- Bellacompra, Galetinho do Matuto, Empório Muro Alto. Nenhum benefício no
-- sentido clássico (plano de saúde, vale) passou por ali em 2026.
--
-- Resultado: almoço da equipe ficou dividido entre 6.04 e 6.05, sem critério.
-- As duas caem em `despesas_pessoal` no DRE, então o resultado não mudou — mas
-- a organização, que é justamente o que o Fernando pediu, ficou pior.
--
-- O CRITÉRIO QUE ESTA MIGRATION ADOTA
-- -----------------------------------
--   6.04  o dinheiro foi para o ESTABELECIMENTO. Restaurante, mercado,
--         delicatessen — pessoa jurídica que vende comida. A empresa pagou a
--         refeição direto.
--
--   6.05  o dinheiro foi para a PESSOA. Alguém do time gastou e a empresa
--         devolveu. É reembolso, e é por isso que a categoria se chama
--         "Reembolsos a colaboradores".
--
-- É uma régua que se aplica sozinha: basta olhar quem recebeu. Rita de Cássia
-- (CPF …11092367438) e Robson José de Santana são pessoas físicas e continuam
-- em 6.05; São Braz e O Rei das Coxinhas são estabelecimentos e passam a 6.04.
--
-- ROSIMERE
-- --------
-- "Rosimere Batista dos Santos" tem cara de pessoa e é empresa: CNPJ
-- 49.809.872/0001-94, cadastrada como fornecedor. O Fernando confirmou que é
-- um local de almoço, não alguém da equipe. São 28 pagamentos e R$2.506,95 em
-- 2026 — de longe o fornecedor de refeição mais recorrente da casa, e o que
-- mais merecia uma regra desde o início.
--
-- Nome que parece de pessoa física é exatamente o caso em que a regra por
-- contraparte paga por si: sem ela, todo mês alguém precisa lembrar que
-- Rosimere é restaurante.

-- ---------------------------------------------------------------------------
-- 1. As duas regras de estabelecimento da 0128 apontam para 6.04, não 6.05
-- ---------------------------------------------------------------------------
UPDATE fin_rule
   SET actions = jsonb_build_object('category_code', '6.04'),
       updated_at = now(),
       notes = notes || ' | 0130: destino corrigido de 6.05 para 6.04. O dinheiro vai para o '
                     || 'ESTABELECIMENTO, não para a pessoa — 6.05 é reembolso a colaborador.'
 WHERE slug IN ('categorizacao-sao-braz-nova-delicatessen', 'categorizacao-o-rei-das-coxinhas');

-- ---------------------------------------------------------------------------
-- 2. Rosimere ganha regra própria
-- ---------------------------------------------------------------------------
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions,
                      confidence, source, status, created_by, notes)
SELECT e.id,
       'categorizacao-rosimere-batista-santos',
       'Categorização: Rosimere — refeições da equipe',
       120,
       'transaction',
       jsonb_build_object('all', jsonb_build_array(
         jsonb_build_object('op','equals','field','counterparty_name_norm','value','rosimere batista santos'),
         jsonb_build_object('op','equals','field','direction','value','pagar')
       )),
       jsonb_build_object('category_code', '6.04'),
       70, 'humano', 'ativa', 'migration-0130',
       'Local de almoço da equipe, confirmado pelo Fernando. É pessoa JURÍDICA (CNPJ '
       '49.809.872/0001-94, cadastrada como fornecedor) apesar do nome parecer de pessoa física — '
       'e é justamente por isso que a regra importa: 28 pagamentos e R$2.506,95 em 2026, todos '
       'já em 6.04, e sem regra alguém teria de lembrar todo mês que Rosimere é restaurante.'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO UPDATE
   SET conditions = EXCLUDED.conditions, actions = EXCLUDED.actions,
       status = 'ativa', notes = EXCLUDED.notes, updated_at = now();

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_mistura int;
BEGIN
  -- A regra da Rosimere tem de casar o acervo dela inteiro.
  SELECT count(*) INTO v_n
    FROM fin_transaction t JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE cp.normalized_name = 'rosimere batista santos' AND t.amount_cents < 0;
  IF v_n < 20 THEN
    RAISE EXCEPTION 'regra da Rosimere alcança só % lançamento(s); esperado 28 ou mais', v_n;
  END IF;

  -- Nenhuma regra ativa pode mandar estabelecimento de alimentação para 6.05:
  -- é a incoerência que esta migration corrige, e ela não pode voltar.
  SELECT count(*) INTO v_mistura
    FROM fin_rule r
   WHERE r.status = 'ativa'
     AND r.actions->>'category_code' = '6.05'
     AND r.conditions::text ~ '(delicatessen|coxinha|restaurante|supermercado|rosimere)';
  IF v_mistura > 0 THEN
    RAISE EXCEPTION '% regra(s) ativa(s) ainda mandam estabelecimento de alimentação para 6.05', v_mistura;
  END IF;
END $$;
