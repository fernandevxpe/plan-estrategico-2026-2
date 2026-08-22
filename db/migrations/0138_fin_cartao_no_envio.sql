-- O envio passa a dizer QUAL cartão — e o cartão passa a ter nome.
--
-- O que faltava, e o Fernando apontou: `fin_time_envio.pagamento` sabe dizer
-- 'cartao_da_empresa', e mais nada. São nove plásticos Nubank registrados, e a
-- pessoa que comprou sabe em qual deles passou — mas não tinha onde escrever.
--
-- Sem isso, a conciliação futura entre o que o time registra e a fatura que
-- chega perde o sinal mais forte que existe: o final do cartão. `card_last4`
-- está preenchido em 793 de 795 itens de fatura, contra 37,5% de cobertura de
-- contraparte. É o campo que casa quase sempre.
-- ===========================================================================

-- 1. O cartão ganha nome ------------------------------------------------------
-- `fin_card` tem `last4` e `holder_name_raw` (nulo em 12 de 12, porque o Nubank
-- não devolve titular). Não tem apelido. "Final 7626" não diz nada para quem
-- está no caixa do mercado com o cartão na mão; "Cartão da obra" diz.
--
-- Nasce VAZIO. O nome de cada plástico é conhecimento que mora com o Fernando,
-- e semear "Cartão 1", "Cartão 2" seria preencher com ruído o campo que existe
-- justamente para ter significado.

ALTER TABLE fin_card ADD COLUMN IF NOT EXISTS label text;

COMMENT ON COLUMN fin_card.label IS
  'Apelido de uso: "cartão da obra", "virtual assinaturas". É o que a pessoa reconhece na hora '
  'da compra — o final sozinho não diz nada para quem está no caixa. Nasce vazio: nome de '
  'plástico é conhecimento humano, e semear "Cartão 1" encheria de ruído o campo que existe '
  'para ter significado. Sem apelido, a tela mostra o final.';

-- 2. O envio aponta para o plástico -------------------------------------------

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS card_id bigint REFERENCES fin_card(id);

CREATE INDEX IF NOT EXISTS fin_time_envio_card_idx ON fin_time_envio (card_id) WHERE card_id IS NOT NULL;

-- Cartão declarado sem dizer que foi no cartão é contradição: ou a pessoa
-- escolheu o plástico e a forma ficou errada, ou o contrário. Barrar aqui é
-- mais barato que descobrir depois por que a conciliação não casou.
ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_cartao_coerente;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_cartao_coerente
  CHECK (card_id IS NULL OR pagamento IN ('cartao_da_empresa', 'ja_paguei_do_meu'));

COMMENT ON COLUMN fin_time_envio.card_id IS
  'Em qual plástico passou. Vale também para ja_paguei_do_meu: gastar no cartão PESSOAL e pedir '
  'reembolso é o terceiro caso que o modelo ainda não representava, e registrar o cartão aqui é '
  'o primeiro passo para representá-lo. É o sinal mais forte para casar com a fatura depois: '
  'card_last4 existe em 793 dos 795 itens, contra 37,5% de cobertura de contraparte.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE (table_name = 'fin_card' AND column_name = 'label')
      OR (table_name = 'fin_time_envio' AND column_name = 'card_id');
  IF n <> 2 THEN RAISE EXCEPTION 'esperava as 2 colunas novas, há %', n; END IF;

  -- Nenhum apelido semeado: é ato humano.
  SELECT count(*) INTO n FROM fin_card WHERE label IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% cartão(ões) já com apelido; o nome é do Fernando, não da migration', n; END IF;

  -- A trava recusa mesmo o estado incoerente, em vez de só parecer que recusa.
  BEGIN
    INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                                incurred_on, pagamento, card_id, status)
    SELECT 1, 'custo', (SELECT id FROM fin_person LIMIT 1), 'declarada', 'teste da trava', 100,
           CURRENT_DATE, 'pix_da_empresa', (SELECT id FROM fin_card LIMIT 1), 'rascunho';
    RAISE EXCEPTION 'cartão com pagamento PIX foi aceito — a trava de coerência não está pegando';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;
