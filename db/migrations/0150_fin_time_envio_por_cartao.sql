-- O que o app lançou, visto POR CARTÃO.
--
-- ---------------------------------------------------------------------------
-- A PERGUNTA QUE NÃO TINHA TELA
-- ---------------------------------------------------------------------------
-- O Fernando: "qual link para ver os custos descritos para cartão?". Não havia.
-- Duas telas chegam perto e nenhuma responde:
--
--   /financeiro/cartoes  monta a fatura a partir do que o BANCO sincroniza.
--                        Não conhece `fin_time_envio` — o que o time digitou
--                        no celular não aparece ali.
--   /financeiro/time     lista o que o time mandou, e nem seleciona o cartão.
--                        Pior: filtra `status IN ('enviado','em_analise')`, e
--                        um custo aprovado desaparece da tela.
--
-- Ou seja: a pessoa fotografa a compra, marca o cartão, o dado entra no banco
-- — e não existe lugar onde ela veja aquilo agrupado por cartão. É o buraco
-- entre "registrei" e "conferi".
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA VIEW, E O QUE ELA DELIBERADAMENTE NÃO FAZ
-- ---------------------------------------------------------------------------
-- Ela NÃO soma com a fatura. `fin_card_*_v` monta o que o banco cobrou;
-- isto aqui é o que uma pessoa DESCREVEU. Os dois falam do mesmo gasto por
-- caminhos diferentes, e somá-los contaria a mesma compra duas vezes — que é
-- o erro que a tela de cartões inteira foi desenhada para não cometer.
--
-- Este é o lado "descrito". A conciliação entre os dois lados é outro
-- trabalho, e ter os dois separados e nomeados é o que a torna possível.
--
-- O CARTÃO PODE SER SÓ QUATRO DÍGITOS. Quando a pessoa digita um final que não
-- casa com plástico nenhum, `card_id` fica nulo e `card_last4` não — e esse
-- lançamento continua sendo sobre um cartão. Agrupar só por `card_id` o
-- esconderia justamente nos casos em que o cadastro está incompleto, que são
-- os que mais precisam ser vistos.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_time_envio_cartao_v AS
SELECT e.entity_id,
       e.id                AS envio_id,
       e.code,
       e.kind,
       e.status,
       e.titulo,
       e.descricao,
       e.amount_cents,
       e.parcelas,
       e.incurred_on,
       e.enviado_em,
       e.pagamento,
       p.name              AS pessoa,
       e.identidade_prova,
       e.card_id,
       e.card_last4,
       c.label             AS cartao_apelido,
       c.cor               AS cartao_cor,
       c.brand             AS cartao_bandeira,
       coalesce(e.card_account_id, c.card_account_id) AS conta_id,
       coalesce(i.name, a.name)                       AS banco,
       cat.code            AS categoria_code,
       cat.name            AS categoria,
       cc.name             AS centro,
       -- A chave de agrupamento da tela: o plástico quando conhecido, o final
       -- digitado quando não, e o banco quando nem final houve.
       coalesce('card:' || e.card_id::text,
                'final:' || e.card_last4,
                'conta:' || coalesce(e.card_account_id, c.card_account_id)::text,
                'sem-cartao')                          AS chave_cartao,
       (SELECT count(*) FROM fin_payment_attachment at
         WHERE at.target_table = 'fin_time_envio' AND at.target_id = e.id)::int AS anexos
  FROM fin_time_envio e
  JOIN fin_person p        ON p.id = e.person_id
  LEFT JOIN fin_card c     ON c.id = e.card_id
  LEFT JOIN fin_card_account a ON a.id = coalesce(e.card_account_id, c.card_account_id)
  LEFT JOIN fin_card_issuer i  ON i.id = a.issuer_id
  LEFT JOIN fin_category cat   ON cat.id = e.categoria_sugerida_id
  LEFT JOIN fin_cost_center cc ON cc.id = e.cost_center_id
 WHERE e.status <> 'rascunho'
   -- Só o que a pessoa disse ter sido pago em cartão, ou que casou com um
   -- plástico. Um PIX na lista de cartão é ruído.
   AND (e.card_id IS NOT NULL OR e.card_last4 IS NOT NULL OR e.card_account_id IS NOT NULL);

COMMENT ON VIEW fin_time_envio_cartao_v IS
  'O lado DESCRITO do cartão: o que o time lançou pelo app, agrupável por plástico, por final '
  'digitado ou por banco. NÃO somar com fin_card_*_v — aquelas montam o que o banco cobrou, e os '
  'dois lados falam da mesma compra por caminhos diferentes.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  colunas text;
BEGIN
  SELECT count(*) INTO n FROM fin_time_envio_cartao_v;
  RAISE NOTICE 'fin_time_envio_cartao_v: % lançamento(s) de cartão descritos pelo app', n;

  -- Nada sem cartão pode entrar: a view existe para agrupar por cartão, e uma
  -- linha sem cartão viraria um grupo "sem-cartao" que não é sobre nada.
  SELECT count(*) INTO n FROM fin_time_envio_cartao_v WHERE chave_cartao = 'sem-cartao';
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) sem cartão na view de cartão', n; END IF;

  -- Rascunho não aparece: é envio que a pessoa não terminou.
  SELECT count(*) INTO n FROM fin_time_envio_cartao_v WHERE status = 'rascunho';
  IF n <> 0 THEN RAISE EXCEPTION '% rascunho(s) vazando', n; END IF;

  -- E a view não pode ganhar saldo nem id de lançamento do ledger amanhã.
  SELECT string_agg(column_name, ',') INTO colunas
    FROM information_schema.columns WHERE table_name = 'fin_time_envio_cartao_v';
  IF colunas ~ '(saldo|balance|transaction_id)' THEN
    RAISE EXCEPTION 'a view de cartão descrito encostou no ledger: %', colunas;
  END IF;
END $$;
