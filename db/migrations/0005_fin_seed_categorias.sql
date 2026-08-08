-- Plano de contas e grupos de fluxo de caixa.
--
-- As receitas não foram inventadas: saíram da varredura das 3.023 cobranças
-- recebidas do Asaas, com o valor histórico de cada uma anotado ao lado. As
-- despesas são o esqueleto que a Fatia 2 vai preencher quando os extratos de
-- Nubank, Inter e Caixa entrarem — hoje o Asaas entrega 100% da receita e 0% da
-- despesa.
--
-- DUAS ARMADILHAS QUE ESTE SEED EXISTE PARA EVITAR:
--
--   · Comissão PAGA a vendedor é CUSTO TOTALMENTE VARIÁVEL, não despesa
--     operacional. O doc 17_throughput_accounting_xpe.md lista "comissão
--     variável" explicitamente. Semeada como despesa fixa, o Throughput fica
--     superestimado em silêncio, e a decisão de aceitar ou recusar um serviço
--     passa a ser tomada com o número errado.
--
--   · "Compra da Impressora 3D 4/12" chegando como cobrança do Asaas NÃO é
--     receita — é colaborador devolvendo parcela de equipamento. Lançada como
--     receita, infla o faturamento E a base do Simples Nacional. Por isso existe
--     9.02, com toc_class 'neutro'.

-- ---------------------------------------------------------------------------
-- Grupos de fluxo de caixa
-- ---------------------------------------------------------------------------
-- PROVISÓRIOS. São a leitura que a análise dos dados sugere; os nomes exatos das
-- 8 categorias hoje preenchidas à mão na planilha ainda são pendência com o
-- negócio. Renomear é UPDATE de uma linha pela tela — o que a FK garante é que
-- ninguém digite duas variantes do mesmo grupo e a conferência contra a planilha
-- deixe de fechar sem ninguém perceber.
INSERT INTO fin_cash_flow_group (slug, name, direction, sort_order) VALUES
  ('receita-servicos',    'Receita de serviços',        'entrada', 1),
  ('receita-recorrente',  'Receita recorrente',         'entrada', 2),
  ('custos-diretos',      'Custos diretos',             'saida',   3),
  ('pessoal',             'Pessoal',                    'saida',   4),
  ('estrutura',           'Estrutura e administrativo', 'saida',   5),
  ('comercial-marketing', 'Comercial e marketing',      'saida',   6),
  ('impostos',            'Impostos',                   'saida',   7),
  ('investimentos',       'Investimentos',              'saida',   8),
  ('movimentacao',        'Movimentação financeira',    'ambos',   9)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Plano de contas
-- ---------------------------------------------------------------------------
INSERT INTO fin_category (entity_id, code, name, kind, toc_class, dre_line, cash_flow_group, default_nucleo, sort_order)
SELECT e.id, v.code, v.name, v.kind, v.toc_class, v.dre_line, v.cfg, v.nucleo, v.sort_order
  FROM fin_entity e
 CROSS JOIN (VALUES
   -- RECEITAS ---------------------------------------------------------------
   -- (valor histórico recebido entre parênteses, para dar noção de peso)
   ('3.01', 'Consultoria e Auditoria',            'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'consultoria',  101),  -- R$ 512 mil
   ('3.02', 'Laudos e Inspeções',                 'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'consultoria',  102),  -- R$ 559 mil
   ('3.03', 'Estudo de Disponibilidade de Carga', 'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'consultoria',  103),  -- R$ 465 mil
   ('3.04', 'Projetos e Subestações',             'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'consultoria',  104),  -- R$ 219 mil
   ('3.05', 'Obras e Adequações',                 'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'obras',        105),  -- R$ 617 mil
   ('3.06', 'Comissionamento de vendas',          'receita', 'throughput_receita', 'receita_bruta', 'receita-recorrente', 'consultoria',  106),  -- R$ 704 mil — PIAU, 20% da receita
   ('3.07', 'Medição e Monitoramento',            'receita', 'throughput_receita', 'receita_bruta', 'receita-recorrente', 'tecnologia',   107),  -- R$ 127 mil
   ('3.08', 'Mercado Livre de Energia',           'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'consultoria',  108),  -- R$ 55 mil
   ('3.09', 'Gestão de Faturas e Rateio',         'receita', 'throughput_receita', 'receita_bruta', 'receita-recorrente', 'tecnologia',   109),
   ('3.10', 'Planejamento Energético',            'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'consultoria',  110),
   ('3.11', 'Melhorias Elétricas',                'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'obras',        111),
   ('3.12', 'Eventos e Patrocínios',              'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'corporativo',  112),
   ('3.13', 'Manutenção e PCM',                   'receita', 'throughput_receita', 'receita_bruta', 'receita-recorrente', 'obras',        113),
   ('3.14', 'Smart Charging e Carregadores',      'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   'tecnologia',   114),
   ('3.99', 'Receita a classificar',              'receita', 'throughput_receita', 'receita_bruta', 'receita-servicos',   NULL,           199),

   ('3.90', 'Estornos e devoluções',              'deducao_receita', 'throughput_receita', 'deducoes', 'receita-servicos', NULL,          190),

   -- CUSTOS TOTALMENTE VARIÁVEIS ---------------------------------------------
   ('4.01', 'Comissão paga a vendedor',           'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', NULL, 201),
   ('4.02', 'Material específico de obra',        'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', 'obras', 202),
   ('4.03', 'Terceirização e subcontratação',     'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', NULL, 203),
   ('4.04', 'Deslocamento atribuível a serviço',  'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', NULL, 204),
   ('4.05', 'Tarifas bancárias e de cobrança',    'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', 'corporativo', 205),  -- R$ 11,2 mil no histórico

   -- DESPESAS OPERACIONAIS ---------------------------------------------------
   ('5.01', 'Aluguel e condomínio',               'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 301),
   ('5.02', 'Energia, água e internet',           'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 302),
   ('5.03', 'Softwares e assinaturas',            'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 303),
   ('5.04', 'Contabilidade e jurídico',           'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 304),
   ('5.05', 'Marketing e publicidade',            'despesa_operacional', 'despesa_operacional', 'despesas_comerciais',      'comercial-marketing', 'corporativo', 305),
   ('5.06', 'Viagens e representação',            'despesa_operacional', 'despesa_operacional', 'despesas_comerciais',      'comercial-marketing', 'corporativo', 306),
   ('5.07', 'Material de escritório e copa',      'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 307),
   ('5.08', 'Manutenção e infraestrutura',        'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 308),
   ('5.09', 'Seguros',                            'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 309),
   ('5.10', 'Taxas, anuidades e conselhos',       'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 310),  -- CREA
   ('5.11', 'Frete e logística',                  'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', NULL,          311),
   ('5.99', 'Despesa a classificar',              'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', NULL,          399),

   -- PESSOAL -----------------------------------------------------------------
   ('6.01', 'Salários',                           'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 401),
   ('6.02', 'Pró-labore',                         'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', 'corporativo', 402),
   ('6.03', 'Encargos (INSS, FGTS)',              'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 403),
   ('6.04', 'Benefícios',                         'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 404),
   ('6.05', 'Reembolsos a colaboradores',         'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 405),
   ('6.06', 'Estágio',                            'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 406),
   ('6.07', 'Treinamento e capacitação',          'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 407),
   ('6.08', '13º e férias',                       'pessoal', 'despesa_operacional', 'despesas_pessoal', 'pessoal', NULL, 408),

   -- IMPOSTOS ----------------------------------------------------------------
   -- Tributo sobre faturamento varia direto com a receita, então é custo
   -- totalmente variável na leitura TOC — que é como a Projeção v3.1 já tratava
   -- (16% deduzidos do ticket antes da margem).
   ('7.01', 'Simples Nacional (DAS)',             'imposto', 'custo_totalmente_variavel', 'impostos', 'impostos', NULL, 501),
   ('7.02', 'ISS',                                'imposto', 'custo_totalmente_variavel', 'impostos', 'impostos', NULL, 502),
   ('7.03', 'Retenções (IRRF, CSLL, PIS/COFINS)', 'imposto', 'custo_totalmente_variavel', 'impostos', 'impostos', NULL, 503),

   -- INVESTIMENTOS -----------------------------------------------------------
   ('8.01', 'Equipamentos e ferramentas',         'investimento', 'investimento', 'investimentos', 'investimentos', NULL, 601),
   ('8.02', 'Infraestrutura e reformas',          'investimento', 'investimento', 'investimentos', 'investimentos', 'corporativo', 602),  -- aba Reformas da v3.1
   ('8.03', 'Veículos',                           'investimento', 'investimento', 'investimentos', 'investimentos', NULL, 603),
   ('8.04', 'Licenças e software perpétuo',       'investimento', 'investimento', 'investimentos', 'investimentos', NULL, 604),

   -- MOVIMENTAÇÃO FINANCEIRA (neutra: não é receita nem despesa) --------------
   ('9.01', 'Transferência entre contas próprias','movimentacao_financeira', 'neutro', 'nao_operacional', 'movimentacao', NULL, 701),
   ('9.02', 'Recuperação de despesa',             'movimentacao_financeira', 'neutro', 'nao_operacional', 'movimentacao', NULL, 702),
   ('9.03', 'Aplicação e resgate',                'movimentacao_financeira', 'neutro', 'nao_operacional', 'movimentacao', NULL, 703),
   ('9.04', 'Amortização de empréstimo',          'movimentacao_financeira', 'neutro', 'nao_operacional', 'movimentacao', NULL, 704),
   ('9.05', 'Aporte e retirada de sócio',         'movimentacao_financeira', 'neutro', 'nao_operacional', 'movimentacao', NULL, 705),

   -- RESULTADO FINANCEIRO ----------------------------------------------------
   ('9.10', 'Rendimentos e juros recebidos',      'receita', 'neutro', 'resultado_financeiro', 'movimentacao', 'corporativo', 710),
   ('9.11', 'Juros e multas pagos',               'despesa_operacional', 'despesa_operacional', 'resultado_financeiro', 'movimentacao', 'corporativo', 711)
 ) AS v(code, name, kind, toc_class, dre_line, cfg, nucleo, sort_order)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, code) DO NOTHING;
