-- Duas linhas de folha ficaram na competência do caixa. Elas voltam para agosto.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECEU, NA ORDEM
-- ---------------------------------------------------------------------------
-- 01/09/2026, 22h: o extrato do Nubank importa dois PIX de folha — Jonildo
-- R$ 4.848,04 e Gabriel R$ 3.493,11. Nascem SEM contraparte e sem categoria, e
-- o gatilho da 0086 faz o que deve: sem categoria não há folha, então
-- `competencia_presumida_caixa`, competência = 01/09.
--
-- 23h25: `identificar-extrato-nubank` liga as duas à pessoa. Aí o gatilho
-- `fin_transaction_categoria_pessoa` roda BEFORE UPDATE OF counterparty_id e
-- grava `NEW.category_id = 6.02` sozinho. A linha vira folha nesse instante —
-- mas o gatilho que reavalia a competência é `AFTER UPDATE OF category_id`, e
-- naquela versão do script a coluna não estava na lista do comando. Gatilho
-- AFTER dispara pela lista de colunas do UPDATE, não pelo que um BEFORE mudou.
-- Resultado: categoria de folha, competência de caixa.
--
-- O SCRIPT JÁ FOI CORRIGIDO — ele hoje cita `category_id = category_id` no SET
-- exatamente para isso, e o comentário lá explica que a omissão "custou um
-- invariante". Reproduzido em transação revertida: pelo caminho de hoje, as
-- mesmas duas linhas saem com `folha_mes_referencia` e competência 31/08.
--
-- O que ninguém fez foi voltar para as duas que passaram pela versão antiga.
-- Esta migration é essa volta.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISSO IMPORTA, E NÃO É COSMÉTICO
-- ---------------------------------------------------------------------------
-- Folha paga do dia 1 ao 5 pertence ao mês anterior (0071). Com a competência
-- em setembro, os R$ 4.848,04 do Jonildo sumiram da conciliação da folha de
-- agosto — a tela dele mostrou "a receber R$ 2.406,50" com o dinheiro já na
-- conta. O Fernando, em 03/09: "parece que está devendo ou faltando receber um
-- dinheiro que não existe".
--
-- ---------------------------------------------------------------------------
-- POR QUE UPDATE NENHUM, E SIM A FUNÇÃO CANÔNICA
-- ---------------------------------------------------------------------------
-- `fin_competencia_reavaliar` é a MESMA função que os gatilhos chamam. Escrever
-- aqui um UPDATE com a data na mão criaria uma segunda opinião sobre
-- competência, e o dia em que a regra mudasse elas divergiriam em silêncio.
--
-- Ela também é um ponto fixo: só toca linha cuja decisão difere da gravada, e
-- respeita `human_locked_fields`. Rodar de novo devolve zero. Por isso o filtro
-- é a DIVERGÊNCIA, não os dois ids: se existir uma terceira linha nesse estado
-- hoje, ela é da mesma doença e vai junto. Medido antes de escrever: são
-- exatamente 2 no banco inteiro, R$ 8.341,15.
-- ===========================================================================

DO $$
DECLARE
  v_ids     bigint[];
  v_mudadas bigint;
BEGIN
  SELECT array_agg(t.id ORDER BY t.id)
    INTO v_ids
    FROM fin_transaction t
    CROSS JOIN LATERAL fin_competencia_decidir(t.id) d
   WHERE NOT ('competence_date' = ANY (t.human_locked_fields))
     AND (t.competence_rule IS DISTINCT FROM d.regra
          OR t.competence_date IS DISTINCT FROM d.competencia);

  v_mudadas := fin_competencia_reavaliar(COALESCE(v_ids, ARRAY[]::bigint[]));
  RAISE NOTICE '0192: % linha(s) voltaram para a competência canônica', v_mudadas;
END $$;

-- Pós-condição: depois desta migration, NENHUMA linha destravada pode divergir
-- da decisão canônica. Se sobrar alguma, a reavaliação não é ponto fixo e o
-- problema é maior que estas duas — melhor falhar aqui do que descobrir pela
-- tela de alguém.
DO $$
DECLARE
  v_resto int;
BEGIN
  SELECT count(*) INTO v_resto
    FROM fin_transaction t
    CROSS JOIN LATERAL fin_competencia_decidir(t.id) d
   WHERE NOT ('competence_date' = ANY (t.human_locked_fields))
     AND (t.competence_rule IS DISTINCT FROM d.regra
          OR t.competence_date IS DISTINCT FROM d.competencia);

  IF v_resto <> 0 THEN
    RAISE EXCEPTION '0192 não fechou: % linha(s) ainda divergem da competência canônica', v_resto;
  END IF;
END $$;
