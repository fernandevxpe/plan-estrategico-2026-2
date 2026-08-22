-- A superfície estreita que o app do time pode ler para sugerir categoria.
--
-- POR QUE UMA VIEW, E NÃO UMA CONSULTA DIRETA
--
-- `scripts/test-perfil-guard.mjs` proíbe o módulo do time de mencionar
-- `fin_transaction` — e a regra está certa, não é burocracia. O prefixo
-- `/api/time` é o único caminho de escrita que o perfil comum tem, e o que o
-- sustenta é ele não alcançar o ledger. Escrevi a sugestão lendo
-- `fin_transaction` direto, o guard reprovou, e a resposta certa é respeitar a
-- regra em vez de mover o SQL para outro arquivo até o grep parar de ver.
--
-- Esta view expõe TRÊS COISAS e nada mais: um documento (CNPJ/CPF), a categoria
-- que ele mais recebeu, e quantas vezes. Sem valor, sem data, sem id de
-- lançamento, sem saldo. Alguém que consultasse todos os CNPJs do Brasil
-- descobriria com quais fornecedores a casa gasta e em que rubrica — que é
-- exatamente o que o time já sabe, porque é o time que compra.
--
-- ---------------------------------------------------------------------------
-- O NÚMERO QUE JUSTIFICA EXISTIR
-- ---------------------------------------------------------------------------
-- Backtest prospectivo sobre lançamentos rotulados por HUMANO (os rotulados por
-- regra de contraparte seriam circulares — a regra medindo a si mesma):
--
--   contraparte com ≥5 lançamentos anteriores ....... 76,4% de acerto
--   chute cego (categoria mais comum das despesas) .. 26,7%
--
-- Um em quatro vem errado. Por isso a view devolve `vezes` e `total`: a tela
-- mostra a razão ("você já classificou isto assim, 7 de 8 vezes") e a pessoa
-- decide. Preencher em silêncio com 76% transformaria um em cada quatro custos
-- num erro que ninguém confere, porque já veio preenchido.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_sugestao_categoria_v AS
WITH classificado AS (
  SELECT c.id AS counterparty_id,
         regexp_replace(coalesce(c.document_number, ''), '[^0-9]', '', 'g') AS documento,
         c.name AS contraparte,
         t.category_id
    FROM fin_transaction t
    JOIN fin_counterparty c ON c.id = t.counterparty_id
    JOIN fin_category cat ON cat.id = t.category_id
   WHERE t.category_id IS NOT NULL
     -- Marcadores de indecisão não são resposta: sugerir "a classificar" é
     -- devolver a pergunta com outro nome.
     AND cat.code NOT IN ('3.99', '5.99')
     -- Só despesa. Sugerir categoria de RECEITA num formulário de custo é o
     -- erro do "posto": no acervo, buscar posto devolve 16× mais receita que
     -- despesa, porque a casa tem clientes chamados Posto.
     AND cat.kind IN ('custo_variavel_direto', 'despesa_operacional', 'pessoal', 'investimento')
     AND length(regexp_replace(coalesce(c.document_number, ''), '[^0-9]', '', 'g')) IN (11, 14)
),
contagem AS (
  SELECT documento, contraparte, category_id, count(*)::int AS vezes
    FROM classificado
   GROUP BY 1, 2, 3
),
total AS (
  SELECT documento, sum(vezes)::int AS total FROM contagem GROUP BY 1
)
SELECT DISTINCT ON (c.documento)
       c.documento,
       c.contraparte,
       c.category_id,
       cat.code  AS categoria_code,
       cat.name  AS categoria_nome,
       c.vezes,
       t.total,
       -- Abaixo de 70% a contraparte não tem padrão, e a tela mostra isso como
       -- "mas nem sempre" em vez de vender maioria simples como certeza.
       (c.vezes::numeric / greatest(t.total, 1) >= 0.7) AS forte
  FROM contagem c
  JOIN total t ON t.documento = c.documento
  JOIN fin_category cat ON cat.id = c.category_id
 -- Duas ocorrências é o piso: uma só é coincidência, e sugerir a partir dela
 -- ensina a pessoa a desconfiar de toda sugestão.
 WHERE c.vezes >= 2
 ORDER BY c.documento, c.vezes DESC, cat.code;

COMMENT ON VIEW fin_sugestao_categoria_v IS
  'Documento → categoria mais frequente, para o app do time sugerir sem tocar no ledger. Expõe '
  'documento, contraparte, categoria e contagem — nunca valor, data ou id de lançamento. É a '
  'superfície estreita que test-perfil-guard permite ao prefixo /api/time.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  colunas text;
BEGIN
  SELECT count(*) INTO n FROM fin_sugestao_categoria_v;
  RAISE NOTICE 'fin_sugestao_categoria_v cobre % documento(s)', n;

  -- A view não pode vazar dinheiro. Se alguém acrescentar uma coluna de valor
  -- amanhã, esta asserção reprova a migration que o fizer.
  SELECT string_agg(column_name, ',') INTO colunas
    FROM information_schema.columns WHERE table_name = 'fin_sugestao_categoria_v';
  IF colunas ~ '(cents|valor|amount|saldo|total_cents)' THEN
    RAISE EXCEPTION 'a view de sugestão expõe coluna de dinheiro: %', colunas;
  END IF;

  -- E não pode sugerir receita num formulário de custo.
  SELECT count(*) INTO n FROM fin_sugestao_categoria_v WHERE categoria_code LIKE '3.%';
  IF n <> 0 THEN RAISE EXCEPTION '% sugestão(ões) de RECEITA na view de custo', n; END IF;
END $$;
