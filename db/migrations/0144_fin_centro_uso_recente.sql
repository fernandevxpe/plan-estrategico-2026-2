-- A segunda superfície estreita: quanto cada centro de custo foi usado.
--
-- Mesma história da 0143, outro campo. `opcoesDoTime` ordenava os centros por
-- uso recente contando `fin_transaction` direto, e o guard reprovou de novo — e
-- de novo com razão. A ordenação precisa de UM número por centro; não precisa
-- do ledger.
--
-- O que esta view expõe: o id do centro e quantos lançamentos ele recebeu nos
-- últimos 90 dias. Sem valor, sem data, sem contraparte. Saber que a obra X
-- teve 40 lançamentos e a obra Y teve 2 é o que quem trabalha nas obras já
-- sabe, porque foi quem gerou os lançamentos.
--
-- POR QUE ORDENAR POR USO, E NÃO POR NOME
-- Medido: os cinco centros mais usados nos últimos 90 dias cobrem 61,2% dos
-- lançamentos que têm centro de custo. A ordenação transforma uma busca entre
-- 28 opções em cinco toques prováveis — e não decide nada, que é a diferença
-- entre ajudar e chutar.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_centro_uso_recente_v AS
SELECT cc.id AS cost_center_id,
       (SELECT count(*)::int FROM fin_transaction t
         WHERE t.cost_center_id = cc.id
           AND t.posted_on > now() - interval '90 days') AS recentes
  FROM fin_cost_center cc;

COMMENT ON VIEW fin_centro_uso_recente_v IS
  'Centro de custo → quantos lançamentos nos últimos 90 dias, para o app do time ordenar a lista '
  'de destino sem tocar no ledger. Só contagem: nunca valor, data ou id de lançamento.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  colunas text;
BEGIN
  -- Toda linha de fin_cost_center tem de aparecer: um centro fora da view
  -- some da lista do app, e o campo que tira o destino dos 0,0% volta a ficar
  -- incompleto.
  SELECT count(*) INTO n FROM fin_cost_center;
  IF (SELECT count(*) FROM fin_centro_uso_recente_v) <> n THEN
    RAISE EXCEPTION 'a view perdeu centro de custo: % na tabela, % na view',
      n, (SELECT count(*) FROM fin_centro_uso_recente_v);
  END IF;

  -- E não pode ganhar coluna de dinheiro amanhã.
  SELECT string_agg(column_name, ',') INTO colunas
    FROM information_schema.columns WHERE table_name = 'fin_centro_uso_recente_v';
  IF colunas ~ '(cents|valor|amount|saldo)' THEN
    RAISE EXCEPTION 'a view de uso expõe coluna de dinheiro: %', colunas;
  END IF;

  RAISE NOTICE 'fin_centro_uso_recente_v: % centro(s), % com uso nos últimos 90 dias',
    n, (SELECT count(*) FROM fin_centro_uso_recente_v WHERE recentes > 0);
END $$;
