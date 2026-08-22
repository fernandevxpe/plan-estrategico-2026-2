-- O cartão do Inter é da empresa — e o envio passa a poder dizer só o banco.
--
-- Decisão do Fernando em 22/08/2026, respondendo à pendência `card_sem_titular`
-- que a 0137 registrou: o cartão está no nome da EMPRESA. O que vai para
-- reembolso são os cartões PESSOAIS das pessoas, não este.
-- ===========================================================================

-- 1. A titularidade decidida ----------------------------------------------------
-- A 0074 recusou deduzir isto do `holder_name_raw` ("FERNANDO DE SIQUEIRA
-- CAMPOS SILVA"), e estava certa: nome não prova titularidade. O que faltava era
-- alguém que sabe dizer. Agora disse.
--
-- CONSEQUÊNCIA, e ela não é boa: com `pj` confirmado, os 9 pagamentos de fatura
-- de 2026 (R$ 40.862,41) estão CERTOS como 9.01 — transferência entre contas
-- próprias, que não é despesa. A despesa real seriam as compras dentro da
-- fatura. Só que o Inter é `somente_pagamento` e não itemiza nada.
--
-- Ou seja: R$ 40.862,41 saíram do caixa em 2026 e não aparecem como custo em
-- lugar nenhum do resultado. Isso deixa de ser uma dúvida em aberto e passa a
-- ser um buraco medido. O que o fecha é o app: alguém registrar o que compra
-- nesse cartão, no momento da compra — que é exatamente o item 2 abaixo.

UPDATE fin_card_account
   SET ownership = 'pj'
 WHERE slug = 'inter-cartao' AND ownership = 'indeterminado';

-- 2. O envio pode dizer só o BANCO ---------------------------------------------
-- A 0138 deu `card_id` ao envio, que aponta para o plástico. Mas o Inter tem
-- ZERO plásticos cadastrados — a fonte não os expõe —, então ele simplesmente
-- não aparecia na lista, e não havia como registrar uma compra feita nele.
--
-- E há um problema humano antes do técnico: a pessoa sempre sabe em qual BANCO
-- passou; nem sempre sabe qual dos nove plásticos Nubank estava na mão. Exigir
-- o final para poder registrar é transformar um dado bom num campo em branco.
--
-- Então o destino tem dois níveis, como o eixo de custo: a linha de crédito
-- (Inter, Nubank) é o que se pergunta, e o plástico é o detalhe a mais quando
-- se sabe.

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS card_account_id bigint REFERENCES fin_card_account(id);

CREATE INDEX IF NOT EXISTS fin_time_envio_card_conta_idx
  ON fin_time_envio (card_account_id) WHERE card_account_id IS NOT NULL;

-- Plástico sem banco é incoerente: todo plástico pertence a uma linha, e gravar
-- um sem a outra deixaria a consulta por banco cega justamente nos registros
-- mais detalhados.
ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_cartao_tem_banco;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_cartao_tem_banco
  CHECK (card_id IS NULL OR card_account_id IS NOT NULL);

-- A mesma regra da 0138, agora para o banco: só faz sentido com pagamento em
-- cartão.
ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_banco_coerente;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_banco_coerente
  CHECK (card_account_id IS NULL OR pagamento IN ('cartao_da_empresa', 'ja_paguei_do_meu'));

COMMENT ON COLUMN fin_time_envio.card_account_id IS
  'Em qual linha de crédito passou — Inter, Nubank. É o que se PERGUNTA: a pessoa sempre sabe o '
  'banco, nem sempre sabe qual dos nove plásticos estava na mão. O plástico (card_id) é o detalhe '
  'a mais quando se sabe, e é derivado deste quando vem preenchido.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  conta bigint;
BEGIN
  SELECT count(*) INTO n FROM fin_card_account WHERE slug = 'inter-cartao' AND ownership = 'pj';
  IF n <> 1 THEN RAISE EXCEPTION 'o Inter não ficou como pj'; END IF;

  SELECT count(*) INTO n FROM fin_card_account WHERE ownership = 'indeterminado';
  IF n <> 0 THEN RAISE EXCEPTION 'ainda há % linha(s) de cartão sem titularidade decidida', n; END IF;

  -- A trava de coerência recusa mesmo o plástico sem banco.
  SELECT id INTO conta FROM fin_card_account LIMIT 1;
  BEGIN
    INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                                incurred_on, pagamento, card_id, status)
    VALUES (1, 'custo', (SELECT id FROM fin_person LIMIT 1), 'declarada', 'teste da trava', 100,
            CURRENT_DATE, 'cartao_da_empresa', (SELECT id FROM fin_card LIMIT 1), 'rascunho');
    RAISE EXCEPTION 'plástico sem banco foi aceito — a trava não está pegando';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;
