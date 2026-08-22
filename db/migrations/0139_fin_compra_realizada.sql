-- A compra aprovada vira compra A REALIZAR, e o custo aprovado vira previsto.
--
-- Dois buracos que o Fernando apontou, e os dois são o mesmo buraco: aprovar
-- não produzia nada. `decidirEnvioDoTime` mudava `status` e escrevia auditoria,
-- e parava aí. Um custo aprovado era uma decisão registrada que não chegava na
-- DRE nem na previsão; uma compra aprovada era uma decisão que não dizia a
-- ninguém que havia compra para fazer.
-- ===========================================================================

-- 1. O elo entre a compra pedida e a compra feita -------------------------------
-- O ciclo passa a ser:
--
--   enviada → aprovada → [alguém compra de verdade] → atendida
--                            └→ cria um fin_time_envio (custo) com o que
--                               REALMENTE foi gasto, apontando de volta.
--
-- Os dois valores convivem de propósito: `fin_purchase_request.amount_cents` é
-- o que se PEDIU, e o custo criado é o que se GASTOU. Sobrescrever o pedido com
-- o realizado apagaria a única evidência de quando a estimativa erra — que é
-- exatamente o que uma fila de compras precisa aprender sobre si mesma.
--
-- Os estados `aprovada` e `atendida` já existiam na 0075. Nada de vocabulário
-- novo: o que faltava era o ponteiro.

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS purchase_request_id bigint REFERENCES fin_purchase_request(id);

CREATE INDEX IF NOT EXISTS fin_time_envio_compra_idx
  ON fin_time_envio (purchase_request_id) WHERE purchase_request_id IS NOT NULL;

-- Uma compra é atendida uma vez. Sem isto, dois cliques no botão criariam dois
-- custos para a mesma solicitação e o gasto apareceria dobrado.
CREATE UNIQUE INDEX IF NOT EXISTS fin_time_envio_compra_unica
  ON fin_time_envio (purchase_request_id) WHERE purchase_request_id IS NOT NULL;

-- Só custo fecha compra. Nota de entrada e reembolso são outros fatos: nota é
-- documento que chegou, reembolso é dinheiro a devolver para a pessoa.
ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_compra_e_custo;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_compra_e_custo
  CHECK (purchase_request_id IS NULL OR kind = 'custo');

COMMENT ON COLUMN fin_time_envio.purchase_request_id IS
  'Qual solicitação de compra este custo atendeu. O valor daqui é o que se GASTOU; o de '
  'fin_purchase_request.amount_cents é o que se PEDIU, e os dois ficam — a diferença entre eles é '
  'a única medida de quanto a estimativa erra. Único por solicitação: compra atendida duas vezes '
  'seria o mesmo gasto contado em dobro.';

-- 2. Nada de tabela nova para o previsto ---------------------------------------
-- `fin_custo_previsto` (0100) já existe com tudo: `origem='derivado'` +
-- `origem_ref`, o estado ('previsto' → 'confirmado' → 'realizado'), o ponteiro
-- `realizado_transaction_id` para o lançamento do extrato, e um índice único
-- parcial que impede dois previstos reivindicarem o mesmo lançamento.
--
-- Ela tem ZERO linhas hoje. O que faltava não era modelo — era alguém escrever
-- nela. O código de aprovação passa a fazer isso com
-- `origem_ref = 'fin_time_envio:<id>'`, que é o formato que a 0100 espera.

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  compra bigint;
  pessoa bigint;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'fin_time_envio' AND column_name = 'purchase_request_id';
  IF n <> 1 THEN RAISE EXCEPTION 'a coluna de vínculo com a compra não entrou'; END IF;

  SELECT id INTO compra FROM fin_purchase_request LIMIT 1;
  SELECT id INTO pessoa FROM fin_person LIMIT 1;

  IF compra IS NOT NULL THEN
    -- A trava de tipo recusa mesmo, em vez de só parecer que recusa.
    BEGIN
      INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                                  incurred_on, pagamento, purchase_request_id, status)
      VALUES (1, 'nota_entrada', pessoa, 'declarada', 'teste da trava', 100,
              CURRENT_DATE, 'a_definir', compra, 'rascunho');
      RAISE EXCEPTION 'nota de entrada fechou uma compra — a trava de tipo não está pegando';
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;
  END IF;
END $$;
