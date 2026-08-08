-- Configuração inicial: empresa, núcleos, centros de custo e contas.
--
-- Isto é CONFIGURAÇÃO, não dado. Vive numa migration para que os ids sejam os
-- mesmos em desenvolvimento, homologação e produção. A alternativa — um INSERT
-- ad-hoc no primeiro script de importação — faz os ids divergirem já no dia um,
-- e aí nenhuma consulta escrita à mão funciona nos dois ambientes.
--
-- Tudo com ON CONFLICT DO NOTHING: reaplicar não estraga nada, e editar nome ou
-- ordem depois é trabalho da tela, não desta migration.

INSERT INTO fin_entity (slug, legal_name, trade_name, cnpj, tax_regime)
VALUES ('xpe', 'XP ENERGY SERVICOS DE MEDICAO DE ENERGIA LTDA', 'XPE Tecnologia', '34776108000192', 'simples')
ON CONFLICT (slug) DO NOTHING;

-- Núcleos de resultado. 'corporativo' é o de overhead: na visão Throughput ele é
-- o bloco não alocado; na visão DRE é a origem do rateio.
INSERT INTO fin_nucleo (slug, name, is_overhead, sort_order) VALUES
  ('obras',       'Obras',       false, 1),
  ('consultoria', 'Consultoria', false, 2),
  ('tecnologia',  'Tecnologia',  false, 3),
  ('corporativo', 'Corporativo', true,  4)
ON CONFLICT (slug) DO NOTHING;

-- Centros de custo funcionais, ortogonais ao núcleo.
INSERT INTO fin_cost_center (entity_id, slug, name, sort_order)
SELECT e.id, v.slug, v.name, v.sort_order
  FROM fin_entity e
 CROSS JOIN (VALUES
   ('comercial',      'Comercial',      1),
   ('marketing',      'Marketing',      2),
   ('operacoes',      'Operações',      3),
   ('administrativo', 'Administrativo', 4),
   ('pessoas',        'Pessoas',        5),
   ('infraestrutura', 'Infraestrutura', 6),
   ('financeiro',     'Financeiro',     7)
 ) AS v(slug, name, sort_order)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- As cinco contas.
--
-- O Asaas é o único com adapter de API — é 100% da receita e 0% da despesa, e é
-- por isso que as outras quatro precisam existir desde já mesmo sem movimento:
-- é a ausência delas que o Índice de Confiabilidade tem de denunciar, não a
-- ausência de cadastro.
--
-- 'caixa-emprestimo' é kind='emprestimo' e fica FORA de "caixa disponível":
-- saldo negativo ali é normal e somá-lo faria o runway mentir.
INSERT INTO fin_account (entity_id, slug, name, institution, kind, import_adapter, sort_order)
SELECT e.id, v.slug, v.name, v.institution, v.kind, v.adapter, v.sort_order
  FROM fin_entity e
 CROSS JOIN (VALUES
   ('asaas',            'Asaas',              'asaas',  'gateway',        'asaas_api',  1),
   ('nubank',           'Nubank',             'nubank', 'conta_corrente', 'nubank_csv', 2),
   ('inter',            'Inter',              'inter',  'conta_corrente', 'inter_ofx',  3),
   ('caixa-aplicacao',  'Caixa — Aplicação',  'caixa',  'aplicacao',      'caixa_ofx',  4),
   ('caixa-emprestimo', 'Caixa — Empréstimo', 'caixa',  'emprestimo',     'caixa_ofx',  5)
 ) AS v(slug, name, institution, kind, adapter, sort_order)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- As quatro reservas nomeadas da Projeção Financeira v3.1.
--
-- Sem elas, o primeiro número que aparece na tela ("saldo disponível") mostra
-- como livre um dinheiro que já tem dono. Os valores são os da planilha e devem
-- ser conferidos e mantidos pela tela daqui em diante.
INSERT INTO fin_reserve (entity_id, slug, name, target_cents, sort_order)
SELECT e.id, v.slug, v.name, v.target_cents, v.sort_order
  FROM fin_entity e
 CROSS JOIN (VALUES
   ('caixa',           'Reserva de Caixa',            12203772::bigint, 1),
   ('brindes-clientes','Reserva de Brindes Clientes',  6510609::bigint, 2),
   ('eventos',         'Reserva de Eventos',           3255304::bigint, 3),
   ('brindes-membros', 'Reserva de Brindes Membros',   1085101::bigint, 4)
 ) AS v(slug, name, target_cents, sort_order)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;
