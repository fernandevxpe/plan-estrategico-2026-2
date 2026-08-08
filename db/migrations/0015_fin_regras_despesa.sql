-- Regras de classificação do lado da DESPESA.
--
-- O primeiro extrato de conta corrente (Inter, março/26) trouxe 79 lançamentos
-- e R$ 131 mil de saída. Sem regra nenhuma, os 79 caem na fila e alguém
-- classifica um a um — e no mês seguinte, de novo.
--
-- POR QUE ESTAS PODEM LER O EXTRATO E AS DE RECEITA NÃO:
--
-- A descrição de um lançamento bancário é o NOME DE QUEM RECEBEU. Classificar
-- receita por aí foi o bug que este módulo cometeu duas vezes ("medicao" casando
-- a razão social da própria empresa; "art " casando "smart charging" e
-- "Art Foods"), e por isso toda regra de texto de receita ficou restrita a
-- documento.
--
-- Do lado da despesa é o contrário: quem recebeu É a informação. "RECEITA
-- FEDERAL" é imposto, ponto. A diferença não é o mecanismo, é a natureza do
-- dado — e por isso estas regras usam âncoras inequívocas (órgão, instituição,
-- razão social própria), nunca palavra genérica.

INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, v.slug, v.name, v.priority, 'transaction', v.cond::jsonb, v.act::jsonb, v.conf, 'seed', 'ativa'
  FROM fin_entity e
 CROSS JOIN (VALUES

  -- ---------------------------------------------------------------- 8..9
  -- Transferência para a PRÓPRIA empresa. R$ 27 mil em março: R$ 21.055 para
  -- "Xp Energy Servicos de Medicao de Energia" e R$ 6.000 para "XPE Tecnologia".
  -- É dinheiro andando entre contas da casa — se entrar como despesa, inventa
  -- R$ 27 mil de custo que não existe. Prioridade 8, à frente de tudo que é
  -- texto, porque é fato societário e não julgamento.
  ('transferencia-para-si-mesma', 'Transferência para conta própria', 8,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["xp energy","xpe tecnologia","xpe consultoria"]}]}',
   '{"category_code":"9.01","transfer":true}', 100),

  -- ---------------------------------------------------------------- 20..49
  -- Tributos: âncora em órgão arrecadador e sigla de guia. Inequívoco.
  ('tributos-receita-federal', 'Tributos federais (DAS, DARF, INSS)', 20,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["receita federal","darf","das simples","simples nacional","previdencia social","inss"]}]}',
   '{"category_code":"7.01","nucleo":"corporativo"}', 100),

  ('fgts', 'FGTS', 22,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["fgts","caixa economica federal fgts"]}]}',
   '{"category_code":"6.03","nucleo":"corporativo"}', 95),

  ('iss-municipal', 'ISS e tributos municipais', 24,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["prefeitura","iss ","secretaria de financas","municipio do recife"]}]}',
   '{"category_code":"7.02","nucleo":"corporativo"}', 90),

  -- ---------------------------------------------------------------- 50..79
  -- Conselhos, energia, telecom: fornecedores nomeados, sem ambiguidade.
  ('crea-conselhos', 'CREA e conselhos profissionais', 50,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["conselho regional de engenharia","crea ","confea"]}]}',
   '{"category_code":"5.10","nucleo":"corporativo"}', 100),

  ('energia-concessionaria', 'Energia elétrica', 52,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["neoenergia","celpe","companhia energetica","enel"]}]}',
   '{"category_code":"5.02","nucleo":"corporativo"}', 95),

  ('telecom-internet', 'Telefonia e internet', 54,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["vivo","claro s a","tim s a","oi s a","net servicos","algar"]}]}',
   '{"category_code":"5.02","nucleo":"corporativo"}', 85),

  ('software-assinaturas', 'Softwares e assinaturas', 56,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["google","microsoft","adobe","autodesk","openai","anthropic","aws","amazon web","railway","vercel","clickup","pipedrive"]}]}',
   '{"category_code":"5.03","nucleo":"tecnologia"}', 95),

  ('meios-de-pagamento', 'Meios de pagamento e bancos', 58,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["pjbank","asaas","cielo","stone","pagseguro","getnet"]}]}',
   '{"category_code":"4.05","nucleo":"corporativo"}', 90),

  ('combustivel', 'Combustível', 60,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["posto ","ipiranga","petrobras distribuidora","shell "]}]}',
   '{"category_code":"5.06","nucleo":"operacoes"}', 85),

  -- ---------------------------------------------------------------- 200
  -- PIX para pessoa física é quase sempre folha, pró-labore ou reembolso — mas
  -- QUAL das três depende da pessoa e do mês. Confiança 60 manda para a fila
  -- mesmo casando: a categoria proposta é um palpite bom, não um fato, e num
  -- lançamento de folha o erro custa a DRE inteira do mês.
  ('pix-pessoa-fisica', 'PIX para pessoa física (folha, pró-labore ou reembolso)', 200,
   '{"all":[{"field":"description_norm","op":"contains_any","value":["pix enviado"]},{"field":"direction","op":"equals","value":"pagar"}]}',
   '{"category_code":"6.01","review":true}', 60)

 ) AS v(slug, name, priority, cond, act, conf)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;
