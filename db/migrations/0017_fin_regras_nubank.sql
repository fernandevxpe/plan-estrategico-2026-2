-- Alinha as regras ao vocabulário do extrato do Nubank.
--
-- O extrato do Nubank trouxe 815 lançamentos e 686 ficaram sem categoria — não
-- porque falte regra, mas porque duas regras existentes falam outro dialeto.

-- 1. O RDB é a outra perna das Caixinhas, e o nome do tipo mudou.
--
-- A regra de 0014 casava `APLICACAO`/`RESGATE`, que é o que o extrato de
-- rendimentos carimba. Na conta corrente o mesmo movimento aparece como
-- "Aplicação RDB" / "Resgate RDB". São R$ 246 mil circulando entre a conta e a
-- reserva em 2026: sem casar, viram R$ 123 mil de despesa e R$ 123 mil de
-- receita que nunca existiram.
UPDATE fin_rule
   SET conditions = '{"any":[{"field":"source_kind","op":"in","value":["APLICACAO","RESGATE","APLICACAO_RDB","RESGATE_RDB"]}]}'::jsonb
 WHERE slug = 'aplicacao-em-caixinha';

-- 2. "PIX enviado" (Inter) e "Transferência enviada pelo Pix" (Nubank) são a
--    mesma coisa dita de dois jeitos.
--
-- A regra procurava só a forma do Inter. São 577 lançamentos no Nubank — a
-- maior parte da despesa da empresa — que passavam direto.
--
-- Confiança 60 continua: a regra distingue "é pagamento a pessoa", não QUAL
-- pagamento. Folha, pró-labore e reembolso saem todos por PIX, e confundi-los
-- estraga a DRE do mês. Vai classificado E para a fila.
UPDATE fin_rule
   SET conditions = '{"all":[{"field":"description_norm","op":"contains_any","value":["pix enviado","transferencia enviada pelo pix"]},{"field":"direction","op":"equals","value":"pagar"}]}'::jsonb
 WHERE slug = 'pix-pessoa-fisica';

-- 3. Fatura de cartão é fato estrutural, não texto.
--
-- "Pagamento de fatura" no extrato é a fatura do cartão corporativo sendo
-- quitada. O DETALHE do que se comprou está na fatura, não aqui — então isto é
-- 9.05 (movimentação de cartão) e não uma despesa classificada, senão o mesmo
-- gasto entraria duas vezes quando a fatura for detalhada.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, 'fatura-cartao-corporativo', 'Pagamento de fatura do cartão', 9, 'both',
       '{"any":[{"field":"source_kind","op":"in","value":["FATURA_CARTAO"]}]}'::jsonb,
       '{"category_code":"9.05","review":true}'::jsonb, 70, 'seed', 'ativa'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- 4. Estorno é dinheiro voltando, não receita nova.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, 'estorno-recebido', 'Estorno de pagamento', 4, 'both',
       '{"any":[{"field":"source_kind","op":"in","value":["ESTORNO"]}]}'::jsonb,
       '{"category_code":"9.02"}'::jsonb, 95, 'seed', 'ativa'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- 5. Fornecedores recorrentes que o extrato do Nubank revelou.
--    Todos com âncora inequívoca — razão social, nunca palavra genérica.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, v.slug, v.name, v.priority, 'transaction', v.cond::jsonb, v.act::jsonb, v.conf, 'seed', 'ativa'
  FROM fin_entity e
 CROSS JOIN (VALUES
   -- R$ 40 mil em 2026: o maior fornecedor da operação de obras.
   ('material-eletrico-obras', 'Material elétrico e de obra', 62,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["dimensional brasil","eletropalma","socieletro","nexer","termotecnica","vme materiais eletricos","distribuidora mix","casa do construtor","canal da construcao","shopping da construcao","classe a comercio de protecao","acesso equipamentos de seguranca","des caxanga aluguel"]}]}',
    '{"category_code":"5.07","nucleo":"obras"}', 95),
   -- Locação de veículo: R$ 24 mil em 2026, recorrente e previsível.
   ('locacao-veiculos', 'Locação de veículos', 64,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["localiza rent a car","movida","unidas"]}]}',
    '{"category_code":"5.05"}', 100),
   -- Marketplace e app: compra pulverizada de insumo e deslocamento.
   ('marketplace-e-apps', 'Compras em marketplace e aplicativos', 66,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["pix marketplace","mercado pago","amazon com br","americanas","ifood","uber do brasil","99app"]}]}',
    '{"category_code":"5.08","review":true}', 70),
   ('condominio-e-aluguel', 'Condomínio e ocupação', 68,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["loja do condominio","iguep incorporadora","4 tabeli de protesto"]}]}',
    '{"category_code":"5.01"}', 90),
   ('alimentacao-equipe', 'Alimentação da equipe', 70,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["supermercado pernambucano","bellacompra","o bom de garfo","galetinho do matuto","restaurante","emporio","o rei das coxinhas","sport burg","atacado dos presentes"]}]}',
    '{"category_code":"5.09","review":true}', 70)
 ) AS v(slug, name, priority, cond, act, conf)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;
