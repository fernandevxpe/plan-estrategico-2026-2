-- Quem devolve dinheiro para a casa aparecia como se tivesse ficado com ele.
--
-- ---------------------------------------------------------------------------
-- O CASO QUE ABRIU O PROBLEMA
-- ---------------------------------------------------------------------------
-- 01/09/2026, Jonildo. A XPE paga R$ 4.848,04 de comissão pelo Nubank; o valor
-- estava R$ 243,24 acima do devido, e ele DEVOLVE os R$ 243,24 no mesmo dia,
-- pela mesma conta. Líquido: R$ 4.604,80 — que somado aos R$ 300,00 pagos pelo
-- Inter no dia seguinte dá exatamente a comissão declarada dele. O Igor fez o
-- mesmo no mesmo dia, R$ 238,24.
--
-- `fin_time_recebivel_competencia_v` (0186) filtra `amount_cents < 0`, porque
-- ela nasceu para responder "o que a casa me pagou". Com esse filtro a
-- devolução não existe: a conferência somava os R$ 4.848,04 cheios.
--
-- O Fernando, em 03/09: "recebeu valor diferente do que deveria ser a comissão
-- e devolveu a diferença... a XPE recebeu a diferença de volta".
--
-- ---------------------------------------------------------------------------
-- POR QUE A DEVOLUÇÃO ENTRA COM SINAL NEGATIVO, E NÃO NUMA COLUNA NOVA
-- ---------------------------------------------------------------------------
-- A conciliação soma `valor_cents` para saber o pago do mês. Uma devolução é
-- pagamento negativo: entrando com o sinal invertido, a soma vira LÍQUIDA sem
-- que nenhum consumidor precise saber que devoluções existem. Uma coluna nova
-- exigiria que todo leitor lembrasse de subtraí-la — e o que se esquece de
-- subtrair vira o erro seguinte.
--
-- O casamento por valor exato fica protegido de graça: previsto é sempre
-- positivo, então uma linha negativa nunca casa com nenhum, e ela entra na
-- conta como o que é — dinheiro que voltou.
--
-- ---------------------------------------------------------------------------
-- A DEVOLUÇÃO SEGUE O CICLO DA FOLHA, NÃO O CALENDÁRIO
-- ---------------------------------------------------------------------------
-- A devolução do Jonildo não tem categoria — é uma entrada nua no extrato — e
-- por isso o gatilho da 0086 a carimba com `competencia_presumida_caixa`:
-- 01/09. Mas o pagamento que ela corrige é folha, e folha do dia 1 ao 5
-- pertence ao mês anterior (0071). Deixadas como estão, as duas metades do
-- mesmo evento cairiam em competências diferentes e a devolução nunca
-- encontraria o pagamento.
--
-- Por isso a view aplica À DEVOLUÇÃO a mesma regra de folha: dia <= 5 volta um
-- mês. Não é uma terceira opinião sobre competência — é a de sempre, aplicada
-- a uma linha que o ledger não tinha como reconhecer como folha.
--
-- ---------------------------------------------------------------------------
-- O QUE **NÃO** ENTRA
-- ---------------------------------------------------------------------------
-- Nem toda entrada vinda de alguém do time é devolução de folha: pode ser
-- pagamento de empréstimo, compra, ou repasse combinado. Medido antes de
-- escrever, o filtro largo (entrada + categoria de folha ou sem categoria)
-- pegaria 5 lançamentos desde janeiro — e três deles são antigos e de natureza
-- incerta: Igor R$ 13,81 (30/03), Gabriel R$ 2.000,00 (02/05, que tem cara do
-- repasse mensal ao João) e Adryan R$ 1.066,38 (05/06).
--
-- Reinterpretar esses três mudaria meses que hoje fecham — e o Fernando foi
-- explícito em 03/09: "vamos começar a conciliar dos meses vigentes em
-- diante". Então o corte é o mesmo da conciliação nova: competência a partir de
-- agosto/2026. Isso pega as duas devoluções de 01/09 e deixa o passado como
-- está. Quando uma antiga precisar entrar, é decisão de quem olhar, não efeito
-- colateral desta migration.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_time_recebivel_competencia_v AS
WITH base AS (
  SELECT p.entity_id,
         p.id AS person_id,
         t.amount_cents,
         t.posted_on,
         cat.code AS categoria_code,
         t.competence_rule,
         COALESCE(t.description_raw, t.description_norm, ''::text) AS descricao,
         -- Saída mantém a competência do ledger. Entrada (devolução) recebe a
         -- regra da folha, para cair no mesmo ciclo do pagamento que corrige.
         CASE
           WHEN t.amount_cents > 0 AND extract(day FROM t.posted_on) <= 5
             THEN (date_trunc('month', t.posted_on) - INTERVAL '1 day')::date
           WHEN t.amount_cents > 0
             THEN t.posted_on
           ELSE t.competence_date
         END AS competencia_efetiva
    FROM fin_transaction t
    JOIN fin_person_counterparty l
      ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'::text
    JOIN fin_person p ON p.id = l.person_id
    LEFT JOIN fin_category cat ON cat.id = t.category_id
   WHERE COALESCE(t.transfer_status, 'nao'::text) = 'nao'::text
     AND (
       (t.amount_cents < 0 AND t.competence_date >= '2026-01-01'::date)
       OR (t.amount_cents > 0
           AND t.posted_on >= '2026-08-01'::date
           AND (cat.code IS NULL OR cat.code LIKE '6.%' OR cat.code = '4.01'))
     )
)
SELECT entity_id,
       person_id,
       date_trunc('month', competencia_efetiva::timestamp with time zone)::date AS competencia,
       posted_on AS pago_em,
       - amount_cents AS valor_cents,
       categoria_code,
       CASE
           WHEN amount_cents > 0 THEN 'devolucao'::text
           WHEN categoria_code = '6.01'::text THEN 'salario'::text
           WHEN categoria_code = '6.02'::text THEN 'prolabore'::text
           WHEN categoria_code = '6.06'::text THEN 'estagio'::text
           WHEN categoria_code = '4.01'::text THEN 'comissao'::text
           WHEN categoria_code = '6.05'::text THEN 'reembolso'::text
           WHEN categoria_code = ANY (ARRAY['6.03'::text, '6.04'::text]) THEN 'encargo_beneficio'::text
           ELSE 'extra'::text
       END AS natureza,
       competence_rule,
       descricao
  FROM base;

COMMENT ON VIEW fin_time_recebivel_competencia_v IS
  'O que a casa pagou a cada pessoa, por COMPETÊNCIA, já LÍQUIDO de devolução: saída entra '
  'positiva, devolução entra negativa (natureza = devolucao, só a partir de 08/2026 e com a '
  'competência resolvida pela regra da folha). Para "quanto caiu em setembro" use '
  'fin_time_recebivel_v, que agrupa por caixa.';
