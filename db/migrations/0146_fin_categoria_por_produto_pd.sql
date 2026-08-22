-- Uma conta para cada produto que está sendo desenvolvido.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO DAVA PARA RESPONDER
-- ---------------------------------------------------------------------------
-- A base estratégica descreve dois produtos de hardware com roadmap e gente
-- alocada — Smart Charging (Controlador de Carga V1.0→V1.1 e Central 2.0→2.1,
-- com piloto em cliente real) e o SA3F1.0, o analisador próprio que a XPE quer
-- para não ter de expandir os quatro analisadores convencionais.
--
-- E não havia UMA conta onde lançar a placa que queimou no teste. Componente
-- de protótipo não é 4.02 (aquilo é material de OBRA, de um contrato assinado),
-- não é 8.01 (equipamento vira patrimônio; a peça do protótipo é consumida
-- para aprender), e cair em 5.99 "a classificar" é o mesmo que não registrar.
--
-- A pergunta que isso impedia: "quanto já foi para o Controlador de Carga?" —
-- que é exatamente a pergunta que decide continuar ou parar.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA POR PRODUTO, E NÃO UMA "P&D" SÓ
-- ---------------------------------------------------------------------------
-- Decisão do Fernando, e ela está certa pelo motivo que importa: os dois
-- produtos têm decisões INDEPENDENTES. O Smart Charging pode se pagar e o
-- Analisador não, e uma conta única de "P&D" esconderia exatamente isso —
-- somaria dois destinos que ninguém decide junto.
--
-- Eu havia proposto o contrário: uma ÁREA de P&D, mantendo o gasto espalhado
-- pelas categorias existentes. O argumento era não multiplicar conta por
-- destino. Ele não se aplica aqui: destino são dois produtos concretos, não
-- oito áreas cruzadas com trinta e três categorias.
--
-- ---------------------------------------------------------------------------
-- SEM SALÁRIO DENTRO, E O QUE ISSO MUDA NA LEITURA
-- ---------------------------------------------------------------------------
-- Também decisão do Fernando: o salário do firmware e do hardware fica na
-- folha, onde já está. Então estas contas respondem "quanto foi gasto EM Smart
-- Charging", não "quanto o Smart Charging custou" — a segunda incluiria as
-- horas do time.
--
-- É a leitura certa para a decisão que se toma toda semana, que é sobre
-- material e fornecedor. O custo do time já é visível na folha e não muda com
-- o produto. Quem for calcular retorno total um dia precisa lembrar de somar
-- os dois lados — e é por isso que está escrito aqui.
--
-- POR QUE EM 8 (INVESTIMENTO)
-- O gasto cria capacidade de faturar depois. Em 5 ele derrubaria a margem do
-- mês em que o protótipo foi montado, como se fosse conta de luz; em 8 ele fica
-- ao lado de equipamentos e ferramentas — dinheiro que sai agora para render
-- depois. `toc_class = investimento` mantém a leitura por TOC coerente: não é
-- custo totalmente variável, porque não sobe com a entrega de serviço.
-- ===========================================================================

INSERT INTO fin_category
  (entity_id, code, name, kind, toc_class, dre_line, cash_flow_group, sort_order, is_active)
SELECT e.id, v.code, v.name, 'investimento', 'investimento', 'investimentos', 'investimentos',
       v.sort_order, true
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('8.05', 'Smart Charging — desenvolvimento', 605),
    ('8.06', 'Analisador XPE (SA3F1.0) — desenvolvimento', 606)
  ) AS v(code, name, sort_order)
 WHERE e.slug = 'xpe'
   -- Idempotente: a migration é aplicada uma vez, mas o mesmo arquivo roda em
   -- ambiente novo, e um code duplicado quebraria o índice.
   AND NOT EXISTS (
     SELECT 1 FROM fin_category c WHERE c.entity_id = e.id AND c.code = v.code
   );

COMMENT ON TABLE fin_category IS
  'Plano de contas da XPE. 8.05 e 8.06 são contas de PRODUTO em desenvolvimento: guardam o '
  'material, o componente, a montagem e a homologação de cada hardware — nunca o salário de quem '
  'desenvolve, que fica em 6.x. Somam "quanto foi gasto no produto", não "quanto o produto custou".';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  cat record;
BEGIN
  SELECT count(*) INTO n FROM fin_category c
    JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
   WHERE c.code IN ('8.05', '8.06');
  IF n <> 2 THEN RAISE EXCEPTION 'esperava as 2 contas de produto, há %', n; END IF;

  -- Elas PRECISAM aparecer para quem lança pelo celular, senão foram criadas
  -- para ninguém: `opcoesDoTime` e `catalogoDeClassificacao` filtram por
  -- '4.%', '5.%' e '8.%' e por is_active. Se um dia esse filtro mudar, esta
  -- asserção não pega — mas o prefixo 8 e o is_active, que é o que está sob
  -- controle desta migration, ficam garantidos aqui.
  FOR cat IN
    SELECT c.code, c.is_active, c.kind FROM fin_category c
      JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
     WHERE c.code IN ('8.05', '8.06')
  LOOP
    IF NOT cat.is_active THEN RAISE EXCEPTION '% nasceu inativa e não apareceria no app', cat.code; END IF;
    IF cat.kind <> 'investimento' THEN RAISE EXCEPTION '% com kind %', cat.code, cat.kind; END IF;
  END LOOP;

  -- E não podem colidir com o bloco que já existia.
  SELECT count(*) INTO n FROM fin_category c
    JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
   WHERE c.code LIKE '8.%';
  IF n <> 6 THEN RAISE EXCEPTION 'esperava 6 contas em 8.x depois desta, há %', n; END IF;

  RAISE NOTICE '8.05 Smart Charging e 8.06 Analisador XPE criadas e visíveis no app do time';
END $$;
