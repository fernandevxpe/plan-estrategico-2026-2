-- Onda 2: o eixo DESTINO passa a existir de verdade.
--
-- Diagnóstico em docs/MAPA_CLASSIFICACAO.md: das catorze categorias que o
-- Fernando pediu, dez são a MESMA pergunta — "para qual núcleo/produto foi este
-- custo?" — e ela não é sobre natureza. Material de consultoria vs de obra,
-- alimentação de obra vs de consultoria, manutenção de medidor vs de escritório,
-- automação de consultoria. Criar categoria para responder isso multiplicaria o
-- plano de contas para codificar destino, que é o erro que a planilha já comete
-- ("Cartão de Crédito" como linha de custo de R$ 12.331 em janeiro).
--
-- O destino tem três níveis, e os três existiam vazios ou quase:
--   fin_nucleo         4 linhas, 1.152 lançamentos sem núcleo
--   fin_cost_center    28 linhas, 13.853 de 13.972 lançamentos SEM
--   fin_product_line   0 linhas
--
-- Esta migration faz quatro coisas. Nenhuma delas classifica nada
-- retroativamente: classificar 13.978 lançamentos depois é exatamente o que não
-- funcionou até aqui.
-- ===========================================================================

-- 1. As linhas de serviço -----------------------------------------------------
-- LDC e LIE não são natureza de custo: são o que a XPE VENDE. Estão em
-- base-estrategica/03-clientes-e-recorrencia.md com os nomes que o comercial
-- usa, e é por eles que o time vai reconhecê-las.
--
-- `fin_product_line` foi criada vazia pela 0124 de propósito ("o Fernando quer
-- criar/renomear/unificar pela tela"). O que entra aqui é só o vocabulário que
-- JÁ está em uso nos contratos — não é catálogo novo, é o que existe escrito.

INSERT INTO fin_product_line (entity_id, slug, name, descricao, sort_order)
SELECT e.id, v.slug, v.name, v.descricao, v.sort_order
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('ldc',   'LDC — Laudo de Disponibilidade de Carga',  'O maior produto da casa: 3.03, R$ 941.218,37 em receita.', 10),
    ('lie',   'LIE — Laudo de Instalações Elétricas',     'Hoje dentro do balde 3.02 "Laudos e Inspeções".',           20),
    ('clie',  'CLIE — Certificação de Instalações Elétricas', NULL,                                                   30),
    ('lcc',   'LCC — Laudo de Carga e Consumo',           NULL,                                                       40),
    ('lgr',   'LGR — Laudo de Gestão de Risco',           NULL,                                                       50),
    ('lspda', 'LSPDA — Laudo de SPDA',                    'Sistema de proteção contra descargas atmosféricas.',       60),
    ('icv',   'ICV — Inspeção de Carregador Veicular',    'O motor de volume do H2 segundo o plano comercial.',       70),
    ('pie',   'PIE — Projeto de Infraestrutura Elétrica', 'Eletrocalha e emergência.',                                80),
    ('obra',  'Obra e adequação',                         'Execução: 3.05.',                                          90),
    ('medicao','Medição e monitoramento',                 'Recorrente: 3.07.',                                       100)
  ) AS v(slug, name, descricao, sort_order)
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (SELECT 1 FROM fin_product_line pl WHERE pl.entity_id = e.id AND pl.slug = v.slug);

-- Só a 3.03 ganha linha agora, e só porque ela É exatamente o LDC. A 3.02 é um
-- balde que cobre LIE, CLIE, LCC, LGR, LSPDA e ICV ao mesmo tempo, e
-- `product_line_id` é N:1 — apontá-la para uma das seis seria escolher no
-- escuro. Ela fica sem linha até alguém separar as categorias, e a lacuna
-- aparece na tela em vez de virar um palpite gravado.
UPDATE fin_category c
   SET product_line_id = pl.id
  FROM fin_product_line pl, fin_entity e
 WHERE e.slug = 'xpe' AND c.entity_id = e.id AND pl.entity_id = e.id
   AND c.code = '3.03' AND pl.slug = 'ldc' AND c.product_line_id IS NULL;

-- 2. O envio do app passa a carregar destino ----------------------------------
-- `fin_time_envio` tinha `categoria_sugerida_id` e mais nada do eixo destino.
-- Ou seja: o app perguntava "o que é" e nunca "para quê" — justamente o
-- indicador que está em 0,0%.
--
-- Os dois são NULOS por escolha. O Fernando foi explícito: "não quero uma
-- burocracia grande de preenchimento". Campo obrigatório num formulário de rua
-- é campo preenchido com qualquer coisa, e qualquer coisa é pior que vazio
-- declarado.

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS cost_center_id  bigint REFERENCES fin_cost_center(id);
ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS product_line_id bigint REFERENCES fin_product_line(id);

CREATE INDEX IF NOT EXISTS fin_time_envio_centro_idx ON fin_time_envio (cost_center_id) WHERE cost_center_id IS NOT NULL;

COMMENT ON COLUMN fin_time_envio.cost_center_id IS
  'A obra ou o projeto que consumiu. UM TOQUE, e preenche dois eixos: o núcleo sai daqui pelo '
  'gatilho da 0049, e a linha de produto sai do projeto. É o único campo de destino que vale '
  'insistir — o resto é derivado ou fica declarado como vazio.';

COMMENT ON COLUMN fin_time_envio.product_line_id IS
  'A linha de serviço, quando NÃO há projeto. Combustível para rodar um LIE acontece antes do '
  'contrato existir, ou cobre três laudos de clientes diferentes no mesmo dia — e aí não há obra '
  'para escolher. Havendo projeto, isto se deriva dele e não se pergunta.';

-- 3. As quatro naturezas que faltavam de verdade -------------------------------
-- Das catorze pedidas, só estas quatro são natureza. As outras dez eram
-- destino, e o item 2 acabou de dar lugar a elas.

INSERT INTO fin_category (entity_id, code, name, kind, toc_class, dre_line, cash_flow_group, default_nucleo, sort_order)
SELECT e.id, v.code, v.name, v.kind, v.toc, v.dre, v.cfg, v.nucleo, v.ord
  FROM fin_entity e
  CROSS JOIN (VALUES
    -- A 0133 tirou "atacado dos presentes" (MCC 5331: brinquedo, armarinho,
    -- papelaria) da regra de alimentação e não tinha para onde mandá-lo. Aqui.
    ('5.12', 'Materiais de eventos e datas comemorativas',
     'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'corporativo', 312),
    -- Existem SEIS regras de cartão nomeando anthropic, openai, cursor,
    -- openrouter e trae — todas apontando para 5.03, junto com hospedagem e
    -- CRM. O gasto era reconhecido e não tinha onde ser somado.
    ('5.13', 'IA e automação',
     'despesa_operacional', 'despesa_operacional', 'despesas_administrativas', 'estrutura', 'tecnologia', 313),
    -- fin_budget_category_map id 14 já registrava a lacuna por escrito:
    -- "escritorio-infra é 5.08 do escritório. Manutenção de equipamento de obra
    -- é outra coisa e não tem linha."
    ('4.06', 'Manutenção de equipamento em campo',
     'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', NULL, 206)
  ) AS v(code, name, kind, toc, dre, cfg, nucleo, ord)
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (SELECT 1 FROM fin_category c WHERE c.entity_id = e.id AND c.code = v.code);

-- 4. A 5.07 estava morta por falta de quem decidisse ---------------------------
-- Ela existe desde a 0005 e tem ZERO lançamentos, zero documentos, zero itens de
-- cartão. As oito regras de cartão que apontam para ela são todas `mcc_indicio`,
-- que por construção NUNCA decidem sozinhas — então nada nunca chegou lá.
--
-- Esta migration não cria regra automática para ela. O MCC 5411 (mercado) aponta
-- ao mesmo tempo para 6.04 (comida da equipe) e 5.07 (copa), e a 0128 já mediu o
-- custo de adivinhar nesse terreno: uma regra por janela de folha pegaria 74
-- lançamentos com 16 errados, 22%. O que destrava a 5.07 é o app perguntando na
-- hora da compra, não uma heurística nova sobre o passado.

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM fin_product_line;
  IF n < 10 THEN RAISE EXCEPTION 'esperava ao menos 10 linhas de produto, há %', n; END IF;

  SELECT count(*) INTO n FROM fin_category WHERE code IN ('5.12', '5.13', '4.06');
  IF n <> 3 THEN RAISE EXCEPTION 'esperava as 3 categorias novas, há %', n; END IF;

  SELECT count(*) INTO n FROM fin_category c JOIN fin_product_line pl ON pl.id = c.product_line_id
   WHERE c.code = '3.03' AND pl.slug = 'ldc';
  IF n <> 1 THEN RAISE EXCEPTION '3.03 não ficou ligada ao LDC'; END IF;

  -- A 3.02 NÃO pode ter ganhado linha: ela cobre seis serviços distintos, e
  -- escolher um seria gravar um palpite.
  SELECT count(*) INTO n FROM fin_category WHERE code = '3.02' AND product_line_id IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION '3.02 recebeu linha de produto; ela é um balde de seis serviços'; END IF;

  -- Os marcadores de indecisão continuam proibidos de ter linha (CHECK da 0124).
  SELECT count(*) INTO n FROM fin_category WHERE code IN ('3.99', '5.99') AND product_line_id IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'marcador de indecisão com linha de produto'; END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'fin_time_envio' AND column_name IN ('cost_center_id', 'product_line_id');
  IF n <> 2 THEN RAISE EXCEPTION 'fin_time_envio não recebeu as duas colunas de destino'; END IF;
END $$;
