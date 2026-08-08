-- Corrige categorias erradas nas regras de despesa da 0017.
--
-- Ao escrever a 0017 eu chutei os códigos em vez de ler o plano de contas, e o
-- resultado é o pior tipo de erro num financeiro: valor certo no balde errado.
-- A tela mostrava "Marketing e publicidade R$ 24.554" quando era locação de
-- veículo, e "Seguros R$ 3.605" quando era comida da equipe.
--
-- Número errado é obviamente errado e alguém corrige. Número certo no lugar
-- errado é confiantemente errado, atravessa uma reunião inteira e vira decisão.
--
-- As categorias corretas já existiam desde a 0005 — o plano de contas foi
-- desenhado com custo totalmente variável separado de despesa operacional
-- justamente para o Throughput fazer sentido.

-- Material de obra é CUSTO TOTALMENTE VARIÁVEL (4.02), não material de copa.
-- Só existe porque a obra existe, e é isso que a torna dedutível do throughput.
UPDATE fin_rule SET actions = '{"category_code":"4.02","nucleo":"obras"}'::jsonb
 WHERE slug = 'material-eletrico-obras';

-- Locação de veículo é deslocamento atribuível a serviço (4.04) — a frota
-- existe para a equipe chegar na obra. Não é marketing.
UPDATE fin_rule SET actions = '{"category_code":"4.04"}'::jsonb
 WHERE slug = 'locacao-veiculos';

-- Marketplace e apps: compra pulverizada, majoritariamente insumo de obra e
-- deslocamento. Vai para 5.99 "a classificar" com review, porque agrupar
-- Mercado Pago, Uber e Amazon sob um rótulo só seria inventar precisão.
UPDATE fin_rule SET actions = '{"category_code":"5.99","review":true}'::jsonb
 WHERE slug = 'marketplace-e-apps';

-- Alimentação da equipe é benefício (6.04), não seguro.
UPDATE fin_rule SET actions = '{"category_code":"6.04","review":true}'::jsonb
 WHERE slug = 'alimentacao-equipe';

-- Fatura de cartão não é retirada de sócio. É transferência da conta para o
-- cartão: o gasto real está no detalhamento da fatura, e lançá-lo aqui como
-- despesa contaria duas vezes quando a fatura entrar.
UPDATE fin_rule SET actions = '{"category_code":"9.01","transfer":true}'::jsonb
 WHERE slug = 'fatura-cartao-corporativo';

-- Reclassifica o que já entrou com o código errado. Sem isto a correção só
-- valeria para o próximo extrato, e os R$ 190 mil já importados ficariam
-- errados para sempre.
UPDATE fin_transaction t
   SET category_id = c.id, nucleo = COALESCE(t.nucleo, 'obras'), updated_at = now()
  FROM fin_category c, fin_rule r
 WHERE r.slug = 'material-eletrico-obras' AND t.classified_rule_id = r.id
   AND c.entity_id = t.entity_id AND c.code = '4.02'
   AND NOT ('category_id' = ANY (t.human_locked_fields));

UPDATE fin_transaction t
   SET category_id = c.id, updated_at = now()
  FROM fin_category c, fin_rule r
 WHERE r.slug = 'locacao-veiculos' AND t.classified_rule_id = r.id
   AND c.entity_id = t.entity_id AND c.code = '4.04'
   AND NOT ('category_id' = ANY (t.human_locked_fields));

UPDATE fin_transaction t
   SET category_id = c.id, updated_at = now()
  FROM fin_category c, fin_rule r
 WHERE r.slug = 'marketplace-e-apps' AND t.classified_rule_id = r.id
   AND c.entity_id = t.entity_id AND c.code = '5.99'
   AND NOT ('category_id' = ANY (t.human_locked_fields));

UPDATE fin_transaction t
   SET category_id = c.id, updated_at = now()
  FROM fin_category c, fin_rule r
 WHERE r.slug = 'alimentacao-equipe' AND t.classified_rule_id = r.id
   AND c.entity_id = t.entity_id AND c.code = '6.04'
   AND NOT ('category_id' = ANY (t.human_locked_fields));

UPDATE fin_transaction t
   SET category_id = c.id, transfer_status = 'em_transito', updated_at = now()
  FROM fin_category c, fin_rule r
 WHERE r.slug = 'fatura-cartao-corporativo' AND t.classified_rule_id = r.id
   AND c.entity_id = t.entity_id AND c.code = '9.01'
   AND NOT ('category_id' = ANY (t.human_locked_fields));
