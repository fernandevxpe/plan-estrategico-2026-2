-- O recebível do time POR COMPETÊNCIA — e não pela data em que o Pix saiu.
--
-- POR QUE ESTA VIEW EXISTE
--
-- `fin_time_recebivel_v` (0161) diz `mes = date_trunc('month', posted_on)`: o
-- mês em que o dinheiro SAIU. Para "quanto entrou na minha conta em setembro"
-- isso é o certo, e ela continua sendo a fonte disso.
--
-- Para CONCILIAR contra o previsto, está errado. Medido em 01/09/2026 na base
-- real: o Fernando recebeu R$ 4.379,00 e R$ 1.440,76 no dia 01/09, e os dois
-- lançamentos têm `competence_date` em AGOSTO — eles liquidam a folha de
-- agosto, não a de setembro. Comparar o previsto de setembro contra eles
-- acusou uma diferença de R$ 354,24 que não existe.
--
-- E a regra não é "sempre o mês anterior": dos 492 lançamentos 6.01/6.02/6.05
-- de 2026, 392 têm competência no mês anterior ao pagamento e 100 no mesmo mês.
-- `fin_transaction.competence_date` já resolve isso caso a caso, com
-- `competence_rule = 'folha_mes_referencia'` marcando quem é folha. A casa já
-- tinha a resposta; faltava ela chegar ao app do time.
--
-- POR QUE UMA VIEW NOVA, E NÃO UMA COLUNA NA 0161
--
-- `fin_time_recebivel_v` é lida por `lib/financeiro/time.ts` e alimenta o
-- gráfico, o histórico e o total do mês. Mexer nela para acrescentar competência
-- arriscaria os três por uma necessidade que é de uma tela só. Esta nasce ao
-- lado, aditiva, e quem não precisa dela não sabe que ela existe.
--
-- ELA É ESTREITA DE PROPÓSITO: não expõe `transaction_id`. É a mesma regra da
-- 0161 e do `perfil-guard` — id de lançamento do ledger não desce para o
-- celular.
--
-- O ELO COM A PESSOA é `fin_person_counterparty` com `status = 'confirmado'`,
-- idêntico ao de `fin_pessoa_remuneracao_v`. Não é casamento por nome na
-- descrição: é a contraparte que alguém confirmou ser aquela pessoa. Isso é o
-- que sustenta dizer "foi confirmado indo para a pessoa cadastrada".

CREATE VIEW fin_time_recebivel_competencia_v AS
SELECT
  p.entity_id,
  p.id AS person_id,
  date_trunc('month', t.competence_date)::date AS competencia,
  t.posted_on AS pago_em,
  -- Saída da empresa é negativa no ledger; para quem recebe, é positiva.
  -t.amount_cents AS valor_cents,
  cat.code AS categoria_code,
  CASE
    WHEN cat.code = '6.01' THEN 'salario'
    WHEN cat.code = '6.02' THEN 'prolabore'
    WHEN cat.code = '6.06' THEN 'estagio'
    WHEN cat.code = '4.01' THEN 'comissao'
    WHEN cat.code = '6.05' THEN 'reembolso'
    WHEN cat.code IN ('6.03', '6.04') THEN 'encargo_beneficio'
    ELSE 'extra'
  END AS natureza,
  -- A regra que o classificador usou. A tela mostra "folha de agosto" com
  -- confiança quando ela é `folha_mes_referencia`, e se cala quando não é.
  t.competence_rule,
  COALESCE(t.description_raw, t.description_norm, '') AS descricao
FROM fin_transaction t
JOIN fin_person_counterparty l
  ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
JOIN fin_person p ON p.id = l.person_id
LEFT JOIN fin_category cat ON cat.id = t.category_id
WHERE t.amount_cents < 0
  AND t.competence_date >= '2026-01-01'
  AND COALESCE(t.transfer_status, 'nao') = 'nao';

COMMENT ON VIEW fin_time_recebivel_competencia_v IS
  'O que a casa pagou a cada pessoa, agrupado pela COMPETÊNCIA do lançamento e não pela data do Pix. Estreita: sem transaction_id. Use para conciliar previsto x pago; para "quanto caiu no mês", use fin_time_recebivel_v.';

DO $$
DECLARE
  n_total  bigint;
  n_desloc bigint;
BEGIN
  IF to_regclass('fin_time_recebivel_competencia_v') IS NULL THEN
    RAISE EXCEPTION 'fin_time_recebivel_competencia_v não foi criada';
  END IF;

  -- Estreita: `transaction_id` não pode aparecer, nunca.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_time_recebivel_competencia_v'
       AND column_name = 'transaction_id'
  ) THEN
    RAISE EXCEPTION 'a view expõe transaction_id — id do ledger não desce para o app do time';
  END IF;

  SELECT count(*) INTO n_total FROM fin_time_recebivel_competencia_v;
  IF n_total = 0 THEN
    RAISE EXCEPTION 'a view nasceu vazia — o elo com fin_person_counterparty quebrou';
  END IF;

  -- A prova de que ela NÃO é cópia da 0161: tem de existir pagamento cuja
  -- competência cai em mês diferente do mês em que ele saiu. Se este número
  -- for zero, a view não está resolvendo nada e a conciliação erraria igual.
  SELECT count(*) INTO n_desloc
    FROM fin_time_recebivel_competencia_v
   WHERE competencia <> date_trunc('month', pago_em)::date;
  IF n_desloc = 0 THEN
    RAISE EXCEPTION 'nenhum lançamento tem competência fora do mês do pagamento — competence_date não está sendo usado';
  END IF;

  RAISE NOTICE 'fin_time_recebivel_competencia_v: % linhas, % com competência deslocada do mês do pagamento', n_total, n_desloc;
END $$;
