-- Regras de classificação iniciais.
--
-- Derivadas da varredura das 3.023 cobranças recebidas. A ORDEM É O PRODUTO:
-- todas as regras abaixo casariam contra o mesmo texto se a prioridade estivesse
-- errada, e duas colisões neste dado são especialmente traiçoeiras.
--
-- COLISÃO 1 — "comissionamento" ≠ "comissão".
--   Um LAUDO DE COMISSIONAMENTO é inspeção técnica de entrega de instalação.
--   "Comissionamento de vendas referente ao mês de X" é a comissão que a PIAU
--   paga — R$ 772 mil no histórico, 20,3% de toda a receita da empresa.
--   Mesmo radical, categorias opostas. Por isso prioridade 10, antes de
--   qualquer regra com "laudo" ou "comiss".
--
-- COLISÃO 2 — "estudo".
--   "Estudo de Disponibilidade de Carga" é R$ 465 mil. Qualquer regra genérica
--   com "estudo" escrita no futuro engoliria essa receita inteira. Prioridade
--   20 reserva o termo específico antes que isso aconteça.
--
-- A confiança abaixo de 100 manda a linha para a fila de revisão mesmo tendo
-- casado — é o que diferencia "tenho certeza" de "é o meu melhor palpite".

INSERT INTO fin_rule (entity_id, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, v.name, v.priority, 'both', v.conditions::jsonb, v.actions::jsonb, v.confidence, 'seed', 'ativa'
  FROM fin_entity e
 CROSS JOIN (VALUES

  -- ------------------------------------------------------------------ 10..29
  -- Termos específicos que precisam vencer os genéricos
  ('Comissionamento de vendas (PIAU)', 10,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["comissionamento de vendas","comissionamento referente","comissao de vendas referente"]}]}',
   '{"category_code":"3.06","nucleo":"consultoria"}', 100),

  ('Estudo de Disponibilidade de Carga', 20,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["disponibilidade de carga","estudo de disponibilidade","qualidade de energia"]}]}',
   '{"category_code":"3.03","nucleo":"consultoria"}', 100),

  -- ------------------------------------------------------------------ 30..99
  -- Famílias de serviço, da mais específica para a mais ampla
  ('Laudos e inspeções', 30,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["laudo","inspecao tecnica","inspecao termografica","termografia","gestao de risco"]}]}',
   '{"category_code":"3.02","nucleo":"consultoria"}', 100),

  ('Projetos e subestações', 40,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["subestacao","padrao de entrada","projeto eletrico","spda","diagrama unifilar","projeto de moderniza","readequacao do padrao"]}]}',
   '{"category_code":"3.04","nucleo":"consultoria"}', 100),

  ('Obras, adequações e ampliações', 50,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["adequacao eletrica","adequacao das instalacoes","correcao adequacao","moderniza","ampliacao da capacidade","reforma","execucao da obra","centros de medicao","cdm"]}]}',
   '{"category_code":"3.05","nucleo":"obras"}', 100),

  ('Melhorias elétricas', 55,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["melhorias eletricas","melhorias na infra","correcao pontual","ajuste do disjuntor"]}]}',
   '{"category_code":"3.11","nucleo":"obras"}', 100),

  ('Planejamento energético', 58,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["planejamento energetico","planejamento eletrico"]}]}',
   '{"category_code":"3.10","nucleo":"consultoria"}', 100),

  ('Consultoria e auditoria', 60,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["consultoria","auditoria","assessoria","acompanhamento tecnico","art "]}]}',
   '{"category_code":"3.01","nucleo":"consultoria"}', 95),

  ('Medição e monitoramento', 70,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["medidor","medicao","monitor","sm3f","analisador","sistema de gerenciamento inteligente","telemetria"]}]}',
   '{"category_code":"3.07","nucleo":"tecnologia"}', 95),

  ('Mercado livre de energia', 80,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["mercado livre","migracao de mercado","acl "]}]}',
   '{"category_code":"3.08","nucleo":"consultoria"}', 100),

  ('Gestão de faturas e rateio', 85,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["fatura de rateio","rateio de energia","faturas individualizadas","gestao e auditoria de faturas","geracao das faturas","geracao de fatura","demonstrativos de faturas"]}]}',
   '{"category_code":"3.09","nucleo":"tecnologia"}', 100),

  ('Smart charging e carregadores', 88,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["carregador","smart charging","veiculo eletrico","gestao de carga","controle de potencia"]}]}',
   '{"category_code":"3.14","nucleo":"tecnologia"}', 100),

  ('Eventos e patrocínios', 90,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["patrocinio","evento","palestra","curso"]},{"field":"direction","op":"equals","value":"receber"}]}',
   '{"category_code":"3.12","nucleo":"corporativo"}', 90),

  ('Gestão de usina solar e GD', 92,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["usina solar","geracao distribuida","creditos de energia","fotovoltaic","neoenergia"]}]}',
   '{"category_code":"3.09","nucleo":"tecnologia"}', 95),

  ('Manutenção e PCM', 94,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["manutencao preventiva","pcm","plano de manutencao"]}]}',
   '{"category_code":"3.13","nucleo":"obras"}', 95),

  -- --------------------------------------------------------------- 120..149
  -- NÃO é receita. A regra mais importante deste seed depois da colisão 1.
  --
  -- "Parcela 4 de 12. Compra da Impressora 3D" chega como cobrança do Asaas
  -- porque foi assim que se cobrou o colaborador. Classificada como receita,
  -- infla o faturamento E a base do Simples Nacional — a empresa pagaria
  -- imposto sobre dinheiro que é devolução de despesa.
  --
  -- Confiança 70 de propósito: manda para a fila mesmo casando, porque a
  -- fronteira entre "vendemos um equipamento" e "colaborador devolveu parcela"
  -- é de julgamento, não de texto.
  ('Recuperação de despesa (equipamento de colaborador)', 120,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["compra da impressora","impressora 3d","notebook","monitor ","cadeira","microfone","ar cond","gela agua","pedestal","tv "]},{"field":"direction","op":"equals","value":"receber"}]}',
   '{"category_code":"9.02","review":true}', 70),

  -- --------------------------------------------------------------- 200..299
  -- Fatos estruturais do extrato (independem de descrição comercial)
  ('Tarifas do Asaas', 200,
   '{"any":[{"field":"source_kind","op":"in","value":["PAYMENT_FEE","INVOICE_FEE","PAYMENT_MESSAGING_NOTIFICATION_FEE","INSTANT_TEXT_MESSAGE_FEE","TRANSFER_FEE","CREDIT_BUREAU_REPORT"]}]}',
   '{"category_code":"4.05","nucleo":"corporativo"}', 100),

  ('Transferência entre contas próprias', 210,
   '{"any":[{"field":"source_kind","op":"in","value":["TRANSFER"]}]}',
   '{"category_code":"9.01","transfer":true}', 100),

  ('Estorno de PIX', 220,
   '{"any":[{"field":"source_kind","op":"in","value":["PIX_TRANSACTION_DEBIT_REFUND","PAYMENT_REFUND","REFUND"]}]}',
   '{"category_code":"3.90"}', 100),

  ('Recarga de cartão Asaas', 230,
   '{"any":[{"field":"source_kind","op":"in","value":["ASAAS_CARD_RECHARGE","ASAAS_CARD_BALANCE_REFUND"]}]}',
   '{"category_code":"9.01"}', 100),

  ('Pagamento de contas pelo Asaas', 240,
   '{"any":[{"field":"source_kind","op":"in","value":["BILL_PAYMENT"]}]}',
   '{"category_code":"5.99","review":true}', 60),

  -- --------------------------------------------------------------- 300..399
  -- Contrapartes conhecidas, quando a descrição não ajuda
  ('CREA e conselhos', 300,
   '{"any":[{"field":"description_norm","op":"contains_any","value":["conselho regional de engenharia","crea"]}]}',
   '{"category_code":"5.10","nucleo":"corporativo"}', 95)

 ) AS v(name, priority, conditions, actions, confidence)
 WHERE e.slug = 'xpe';
