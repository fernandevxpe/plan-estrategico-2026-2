-- Tudo que uma PESSOA descreveu, por qualquer meio, num lugar só.
--
-- ---------------------------------------------------------------------------
-- O PEDIDO
-- ---------------------------------------------------------------------------
-- O Fernando: "quero na parte de cartões uma dashboard detalhada com histórico,
-- valores somados, detalhamento por tipo por área... também quero dos PIX e
-- quaisquer outros... quero na área de custos todo esse detalhamento incluindo
-- até os reembolsos... vai ficar claro com o que são feitos os gastos e quem
-- são, quais tipos".
--
-- A 0150 resolveu isso para cartão. Mas cartão é UM canal, e a pergunta é sobre
-- o gasto — que sai por cartão, por PIX, por boleto, por débito, e também pelo
-- bolso de alguém que depois pede reembolso. Uma view por canal significaria
-- somar quatro consultas na tela para responder "quanto a área Comercial
-- gastou", e cada nova forma de pagamento exigiria mais uma.
--
-- ---------------------------------------------------------------------------
-- DUAS ORIGENS, UM FORMATO
-- ---------------------------------------------------------------------------
-- `fin_time_envio`        o custo e a nota que o time lança pelo app.
-- `fin_reimbursement_item` o que alguém pagou do próprio bolso.
--
-- São tabelas diferentes por um bom motivo — o reembolso tem que devolver
-- dinheiro para uma pessoa, o custo não — e são o mesmo fato para quem pergunta
-- "no que a casa gastou". Unir na leitura mantém as duas escritas separadas e
-- responde a pergunta uma vez só.
--
-- REEMBOLSO É UMA FORMA DE PAGAMENTO AQUI, e isso é deliberado: do ponto de
-- vista do gasto, "saiu do bolso do Marcelo" está no mesmo eixo que "saiu do
-- cartão do Inter" — é a resposta para "por onde o dinheiro saiu".
--
-- ---------------------------------------------------------------------------
-- O QUE ELA NÃO É
-- ---------------------------------------------------------------------------
-- Não é o ledger e não substitui a DRE. É o lado DESCRITO: o que gente contou.
-- `fin_transaction` é o que aconteceu na conta. Os dois convergem quando o
-- financeiro decide sobre cada envio, e antes disso divergem de propósito —
-- essa divergência é a fila de trabalho, não um erro.
--
-- Por isso não somar esta view com nada de `fin_transaction` nem com
-- `fin_card_*_v`: seria contar a mesma compra duas vezes.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_gasto_descrito_v AS
-- 1. O que o time lançou pelo app -------------------------------------------
SELECT e.entity_id,
       'envio'::text                       AS origem,
       e.id                                AS registro_id,
       e.code,
       e.kind,
       e.status,
       e.titulo,
       e.descricao,
       e.amount_cents,
       e.parcelas,
       e.incurred_on                       AS data,
       date_trunc('month', e.incurred_on)::date AS mes,
       e.enviado_em,
       -- A FORMA, normalizada. `a_definir` vira 'indefinido' em vez de sumir:
       -- gasto sem forma declarada é um fato sobre o preenchimento, e escondê-lo
       -- faria os totais por forma não fecharem com o total geral.
       CASE e.pagamento
         WHEN 'cartao_da_empresa'  THEN 'cartao'
         WHEN 'pix_da_empresa'     THEN 'pix'
         WHEN 'boleto'             THEN 'boleto'
         WHEN 'debito_automatico'  THEN 'debito'
         WHEN 'ja_paguei_do_meu'   THEN 'reembolso'
         ELSE 'indefinido'
       END                                 AS forma,
       p.id                                AS pessoa_id,
       p.name                              AS pessoa,
       e.identidade_prova,
       e.card_id,
       e.card_last4,
       c.label                             AS cartao_apelido,
       c.cor                               AS cartao_cor,
       c.brand                             AS cartao_bandeira,
       coalesce(e.card_account_id, c.card_account_id) AS conta_id,
       coalesce(i.name, a.name)            AS banco,
       cat.code                            AS categoria_code,
       cat.name                            AS categoria,
       cat.kind                            AS categoria_kind,
       cc.id                               AS centro_id,
       cc.name                             AS centro,
       cc.kind                             AS centro_kind,
       NULL::text                          AS tipo_reembolso,
       e.fornecedor_nome                   AS fornecedor,
       (SELECT count(*) FROM fin_payment_attachment at
         WHERE at.target_table = 'fin_time_envio' AND at.target_id = e.id)::int AS anexos
  FROM fin_time_envio e
  JOIN fin_person p            ON p.id = e.person_id
  LEFT JOIN fin_card c         ON c.id = e.card_id
  LEFT JOIN fin_card_account a ON a.id = coalesce(e.card_account_id, c.card_account_id)
  LEFT JOIN fin_card_issuer i  ON i.id = a.issuer_id
  LEFT JOIN fin_category cat   ON cat.id = e.categoria_sugerida_id
  LEFT JOIN fin_cost_center cc ON cc.id = e.cost_center_id
 WHERE e.status <> 'rascunho'

UNION ALL

-- 2. O que saiu do bolso de alguém -------------------------------------------
SELECT r.entity_id,
       'reembolso'::text                   AS origem,
       ri.id                               AS registro_id,
       -- Reembolso não tem código próprio por item; o do mês identifica.
       'RB-' || to_char(r.reference_month, 'YYYY-MM') || '-' || ri.id::text AS code,
       'reembolso'::text                   AS kind,
       ri.status,
       coalesce(nullif(ri.description, ''), rt.name, 'Reembolso') AS titulo,
       NULL::text                          AS descricao,
       ri.amount_cents,
       ri.installment_total                AS parcelas,
       ri.expense_date                     AS data,
       date_trunc('month', ri.expense_date)::date AS mes,
       r.submitted_at                      AS enviado_em,
       'reembolso'::text                   AS forma,
       p.id                                AS pessoa_id,
       p.name                              AS pessoa,
       'declarada'::text                   AS identidade_prova,
       NULL::bigint AS card_id, NULL::text AS card_last4, NULL::text AS cartao_apelido,
       NULL::text AS cartao_cor, NULL::text AS cartao_bandeira,
       NULL::bigint AS conta_id, NULL::text AS banco,
       cat.code                            AS categoria_code,
       cat.name                            AS categoria,
       cat.kind                            AS categoria_kind,
       -- O item de reembolso não aponta para centro de custo. NULL honesto: o
       -- eixo de área existe e este caminho não o preenche, e é isso que faz o
       -- "sem área" da tela ser verdadeiro em vez de otimista.
       NULL::bigint AS centro_id, NULL::text AS centro, NULL::text AS centro_kind,
       ri.reimbursement_type               AS tipo_reembolso,
       NULL::text                          AS fornecedor,
       (SELECT count(*) FROM fin_payment_attachment at
         WHERE at.target_table = 'fin_reimbursement_item' AND at.target_id = ri.id)::int AS anexos
  FROM fin_reimbursement_item ri
  JOIN fin_reimbursement r ON r.id = ri.reimbursement_id
  JOIN fin_person p        ON p.id = r.person_id
  LEFT JOIN fin_reimbursement_type rt ON rt.slug = ri.reimbursement_type
  LEFT JOIN fin_category cat          ON cat.id = ri.category_id;

COMMENT ON VIEW fin_gasto_descrito_v IS
  'O lado DESCRITO do gasto: custo e nota lançados pelo app mais reembolso, num formato só, com '
  'forma de pagamento, categoria, área, pessoa e mês. NÃO somar com fin_transaction nem com '
  'fin_card_*_v — aquilo é o que aconteceu na conta, isto é o que gente contou, e a divergência '
  'entre os dois é a fila de trabalho do financeiro.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  m integer;
BEGIN
  -- O total por FORMA tem de fechar com o total geral. Se uma forma nova
  -- aparecer amanhã em `fin_time_envio.pagamento` e o CASE não a cobrir, ela
  -- cai em 'indefinido' — nunca some. Esta asserção é o que garante isso.
  SELECT count(*) INTO n FROM fin_gasto_descrito_v;
  SELECT count(*) INTO m FROM fin_gasto_descrito_v WHERE forma IS NULL;
  IF m <> 0 THEN RAISE EXCEPTION '% linha(s) sem forma de pagamento', m; END IF;

  -- Nenhuma linha sem pessoa: "quem gastou" é metade da pergunta.
  SELECT count(*) INTO m FROM fin_gasto_descrito_v WHERE pessoa IS NULL;
  IF m <> 0 THEN RAISE EXCEPTION '% linha(s) sem pessoa', m; END IF;

  -- Rascunho não vaza.
  SELECT count(*) INTO m FROM fin_gasto_descrito_v WHERE origem = 'envio' AND status = 'rascunho';
  IF m <> 0 THEN RAISE EXCEPTION '% rascunho(s) na view', m; END IF;

  -- A soma das partes é o todo: se o UNION duplicasse alguma origem, isto
  -- pegaria.
  SELECT count(*) INTO m FROM (
    SELECT origem, registro_id, count(*) FROM fin_gasto_descrito_v
     GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF m <> 0 THEN RAISE EXCEPTION '% registro(s) duplicado(s) no UNION', m; END IF;

  RAISE NOTICE 'fin_gasto_descrito_v: % linha(s) — % de envio, % de reembolso',
    n,
    (SELECT count(*) FROM fin_gasto_descrito_v WHERE origem = 'envio'),
    (SELECT count(*) FROM fin_gasto_descrito_v WHERE origem = 'reembolso');
END $$;
