-- Material, equipamentos e insumos — uma conta para cada destino.
--
-- ---------------------------------------------------------------------------
-- O BURACO, E O SINTOMA QUE O DENUNCIAVA
-- ---------------------------------------------------------------------------
-- O Fernando: "nas opções de categorias não tem Material, Equipamentos e
-- Insumos para Comercial, ou para o Marketing, ou para Consultoria ou para
-- Obras". Conferido no banco, é exatamente isso:
--
--   Obras       4.02 existe — 209 lançamentos, R$ 197.042. É a conta mais
--               usada da casa depois da folha.
--   Consultoria NADA. O material para rodar um LDC, um LIE, um laudo não tem
--               conta, mesmo sendo o serviço que a empresa mais vende.
--   Comercial   NADA. Banner de estande, brinde, o cabo comprado para uma
--               apresentação: sem casa.
--   Marketing   NADA. 5.05 é "Marketing e publicidade" — anúncio e serviço de
--               agência, não a caixa de impressos que chegou.
--
-- O sintoma que denunciava o buraco estava à vista e ninguém tinha lido:
-- **5.07 "Material de escritório e copa" tem ZERO lançamentos**. Não é que a
-- casa não compre material — é que a única conta de material que existia é
-- estreita demais para o que ela compra, e o gasto ia para 5.99, para 8.01, ou
-- para lugar nenhum.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO CONTRADIZ O QUE EU TINHA ESCRITO, E POR QUE ELE ESTÁ CERTO
-- ---------------------------------------------------------------------------
-- Na revisão do plano de contas eu argumentei o oposto: "não multiplique
-- categoria por área; a categoria diz O QUE, a área diz PARA QUEM, e custo por
-- área sai do cruzamento dos dois". O argumento é bom em tese e falha nesta
-- casa por um motivo medido:
--
--   o eixo de área tem 2,1% de preenchimento (67 de 3.120 despesas em 2026).
--
-- Um segundo eixo que ninguém preenche não produz visão por área nenhuma. Uma
-- categoria que já nomeia o destino é preenchida, porque é UMA escolha, numa
-- lista que a pessoa abre de qualquer jeito. Trocar pureza de modelagem por
-- dado que existe é o negócio certo aqui — e continua sendo verdade que
-- espalhar TODAS as 33 contas por área seria demais. Estas são quatro, sobre a
-- natureza de gasto mais comum que existe.
--
-- 4.02 é RENOMEADA, não recriada: mesmo id, mesmos 209 lançamentos, mesmo
-- histórico. Só o rótulo muda, para as quatro lerem como família no seletor do
-- celular — "Material específico de obra" solto no meio de três "Material,
-- equipamentos e insumos — X" faria a pessoa achar que obra é outra coisa.
--
-- ---------------------------------------------------------------------------
-- A FRONTEIRA COM 8.01, QUE O NOME NÃO RESOLVE SOZINHO
-- ---------------------------------------------------------------------------
-- Estas contas dizem "equipamentos" e 8.01 também. A linha é DURABILIDADE, não
-- palavra: o que se consome ou se gasta no uso entra aqui; o que vira
-- patrimônio e serve por anos continua em 8.01. Notebook, veículo e bancada
-- são 8.01. Broca, EPI, cabo de apresentação, ferramenta que quebra e se
-- repõe, são estas.
--
-- Está escrito no COMMENT de cada uma porque é a dúvida que vai aparecer, e
-- porque o catálogo que vai no prompt da leitura automática lê o nome — não
-- este comentário.
-- ===========================================================================

-- 1. Obras: renomeia para a família ler junto ---------------------------------
UPDATE fin_category c
   SET name = 'Material, equipamentos e insumos — Obras'
  FROM fin_entity e
 WHERE e.id = c.entity_id AND e.slug = 'xpe' AND c.code = '4.02';

-- 2. Consultoria: custo direto, como obra -------------------------------------
-- O material para rodar um laudo é atribuível ao serviço entregue, igual ao
-- material de obra. Fica em 4.x e em `custo_totalmente_variavel` porque sobe
-- com a entrega — é isso que o mantém fora da despesa fixa na leitura por TOC.
INSERT INTO fin_category
  (entity_id, code, name, kind, toc_class, dre_line, cash_flow_group, sort_order, is_active)
SELECT e.id, '4.07', 'Material, equipamentos e insumos — Consultoria',
       'custo_variavel_direto', 'custo_totalmente_variavel', 'custos_servicos', 'custos-diretos', 407, true
  FROM fin_entity e
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (SELECT 1 FROM fin_category x WHERE x.entity_id = e.id AND x.code = '4.07');

-- 3. Comercial e Marketing: despesa comercial ---------------------------------
-- Não são custo direto: acontecem tendo contrato ou não, e é justamente por
-- isso que precisam ser visíveis separados — é gasto que a casa escolhe fazer
-- para vender, e alguém decide o tamanho dele.
INSERT INTO fin_category
  (entity_id, code, name, kind, toc_class, dre_line, cash_flow_group, sort_order, is_active)
SELECT e.id, v.code, v.name, 'despesa_operacional', 'despesa_operacional',
       'despesas_comerciais', 'comercial-marketing', v.sort_order, true
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('5.14', 'Material, equipamentos e insumos — Comercial', 514),
    ('5.15', 'Material, equipamentos e insumos — Marketing', 515)
  ) AS v(code, name, sort_order)
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (SELECT 1 FROM fin_category x WHERE x.entity_id = e.id AND x.code = v.code);

-- 4. A fronteira, escrita onde quem consulta o banco vai ler ------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.code FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
     WHERE c.code IN ('4.02', '4.07', '5.14', '5.15')
  LOOP
    EXECUTE format(
      'COMMENT ON COLUMN fin_category.name IS %L',
      'Nome da conta. A família "Material, equipamentos e insumos — X" (4.02 Obras, 4.07 Consultoria, '
      '5.14 Comercial, 5.15 Marketing) separa o mesmo tipo de gasto pelo DESTINO, porque o eixo de '
      'centro de custo tem 2,1% de preenchimento e não produz essa visão sozinho. A fronteira com '
      '8.01 é durabilidade: o que se consome entra na família; o que vira patrimônio e serve por '
      'anos fica em 8.01.');
  END LOOP;
END $$;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  r record;
BEGIN
  SELECT count(*) INTO n FROM fin_category c
    JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
   WHERE c.name LIKE 'Material, equipamentos e insumos — %';
  IF n <> 4 THEN RAISE EXCEPTION 'esperava 4 contas na família de material, há %', n; END IF;

  -- A renomeação NÃO pode ter perdido lançamento: é o teste que separa
  -- "renomeei" de "criei outra e abandonei a antiga".
  SELECT count(*) INTO n FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
   WHERE c.code = '4.02';
  IF n < 200 THEN RAISE EXCEPTION '4.02 ficou com % lançamentos; esperava os 209 do histórico', n; END IF;

  -- Todas visíveis para quem lança pelo celular: `opcoesDoTime` filtra por
  -- prefixo 4/5/8 e is_active. Uma conta nova inativa seria criada para
  -- ninguém.
  FOR r IN
    SELECT c.code, c.is_active FROM fin_category c
      JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
     WHERE c.code IN ('4.07', '5.14', '5.15')
  LOOP
    IF NOT r.is_active THEN RAISE EXCEPTION '% nasceu inativa', r.code; END IF;
  END LOOP;

  -- E nenhuma delas pode ter caído em receita por engano de dre_line.
  SELECT count(*) INTO n FROM fin_category c
    JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
   WHERE c.code IN ('4.07', '5.14', '5.15')
     AND c.dre_line NOT IN ('custos_servicos', 'despesas_comerciais');
  IF n <> 0 THEN RAISE EXCEPTION '% conta(s) da família com dre_line fora do esperado', n; END IF;

  RAISE NOTICE 'família de material: 4.02 Obras · 4.07 Consultoria · 5.14 Comercial · 5.15 Marketing';
END $$;
