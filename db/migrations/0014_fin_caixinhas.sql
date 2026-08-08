-- Caixinhas PJ do Nubank: a conta de reserva que estava fora da vista.
--
-- O extrato de julho/26 mostra R$ 59.001,05 guardados — contra os R$ 49.826,06
-- do Asaas que a plataforma tratava como "o caixa da empresa". Metade do
-- dinheiro estava invisível, e o pior: a tela dizia "faltam R$ 231 mil para
-- completar as reservas" quando na verdade R$ 59 mil já estavam lá.
--
-- A conta entra como 'aplicacao' porque é isso que ela é. Entra em "caixa
-- disponível" (diferente de 'emprestimo'), mas o dinheiro tem dono: é a reserva.

INSERT INTO fin_account (entity_id, slug, name, institution, kind, import_adapter, sort_order)
SELECT e.id, 'nubank-caixinhas', 'Nubank — Caixinhas', 'nubank', 'aplicacao', 'manual', 6
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Categorias que faltavam para ler este extrato
-- ---------------------------------------------------------------------------
-- 9.03 já existe ("Aplicação e resgate", toc_class neutro) e serve à aplicação.
-- 9.10 já existe ("Rendimentos e juros recebidos") e serve ao rendimento.
-- Nada a criar — o plano de contas foi desenhado prevendo isto.

-- ---------------------------------------------------------------------------
-- Regras estruturais para o extrato de caixinha
-- ---------------------------------------------------------------------------
-- Prioridade na faixa dos FATOS (1–9), antes de qualquer regra de texto, porque
-- casam por `source_kind` que o parser carimba — não por descrição comercial.
--
-- A primeira é a que mais importa: sem ela, R$ 51.895 de aplicações do mês
-- entrariam como DESPESA, inventando um custo que nunca existiu e derrubando o
-- resultado da empresa em cinquenta mil reais.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, v.slug, v.name, v.priority, 'both', v.cond::jsonb, v.act::jsonb, v.conf, 'seed', 'ativa'
  FROM fin_entity e
 CROSS JOIN (VALUES
   ('aplicacao-em-caixinha', 'Aplicação em caixinha (transferência própria)', 6,
    '{"any":[{"field":"source_kind","op":"in","value":["APLICACAO","RESGATE"]}]}',
    '{"category_code":"9.03","transfer":true}', 100),
   ('rendimento-de-caixinha', 'Rendimento de caixinha', 7,
    '{"any":[{"field":"source_kind","op":"in","value":["RENDIMENTO"]}]}',
    '{"category_code":"9.10","nucleo":"corporativo"}', 100)
 ) AS v(slug, name, priority, cond, act, conf)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- As reservas passam a apontar para a conta onde o dinheiro está
-- ---------------------------------------------------------------------------
-- `current_cents` continua zerado de propósito: quanto de cada uma das quatro
-- reservas está dentro dos R$ 59 mil é rateio que só a empresa sabe fazer, e
-- inventar a divisão seria pior que deixar explícito que ela falta. O saldo
-- total da conta é o que a tela soma; a divisão por finalidade é edição de tela.
UPDATE fin_reserve r
   SET account_id = a.id
  FROM fin_account a, fin_entity e
 WHERE a.slug = 'nubank-caixinhas' AND e.slug = 'xpe'
   AND a.entity_id = e.id AND r.entity_id = e.id AND r.account_id IS NULL;
