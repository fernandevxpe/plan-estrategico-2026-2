-- Parcelas no envio, o final do cartão digitado, e o CLIE que não existe.
--
-- Três coisas que o Fernando apontou usando o app no aparelho, e que nenhum
-- teste pegaria porque as três são sobre o que o formulário NÃO oferece.
-- ===========================================================================

-- 1. Parcelas -------------------------------------------------------------------
-- O pedido original falava em "parcelada em quantas, tipo uma calculadora", e o
-- formulário nunca teve o campo. Sem ele, uma compra de R$ 1.200 em 12x entra
-- como R$ 1.200 num mês só — e a previsão de caixa erra por onze meses.
--
-- NULL é à vista. Não é 1: "uma parcela" e "à vista" são fatos diferentes na
-- fatura, e usar 1 para os dois apagaria a distinção logo na origem.

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS parcelas smallint;

ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_parcelas_ck;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_parcelas_ck
  CHECK (parcelas IS NULL OR (parcelas BETWEEN 2 AND 48));

COMMENT ON COLUMN fin_time_envio.parcelas IS
  'Em quantas vezes. NULL é à vista — não 1: "uma parcela" e "à vista" são fatos diferentes na '
  'fatura. O valor em amount_cents é sempre o TOTAL da compra, nunca o da parcela: o total é o que '
  'a pessoa vê na tela do caixa, e derivar a parcela dele é divisão, enquanto o contrário é '
  'multiplicação que perde centavo no arredondamento.';

-- 2. O final do cartão, digitado ------------------------------------------------
-- O Inter tem ZERO plásticos cadastrados e o Nubank tem nove sem apelido. Hoje,
-- se o cartão não está na lista, não há onde escrever qual foi — e o dado que a
-- pessoa TEM na mão (os quatro dígitos impressos) se perde.
--
-- Guardar o final digitado resolve os dois lados: casa com a fatura mesmo sem
-- cadastro prévio, e é a semente para cadastrar o plástico depois, com evidência
-- de uso em vez de palpite.

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS card_last4 char(4);

ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_last4_ck;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_last4_ck
  CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');

COMMENT ON COLUMN fin_time_envio.card_last4 IS
  'Os quatro dígitos que a pessoa digitou. Quando casam com um fin_card registrado, card_id é '
  'preenchido junto; quando não casam, isto fica sozinho e vira a evidência para cadastrar o '
  'plástico depois. O dado que a pessoa tem na mão não pode se perder por falta de cadastro.';

-- 3. CLIE não existe --------------------------------------------------------------
-- Eu semeei dez linhas de serviço na 0136 lendo os contratos da base
-- estratégica, e inclui CLIE. O Fernando diz que não existe. Desativa em vez de
-- apagar: `fin_category.product_line_id` pode apontar para ela, e um DELETE
-- quebraria a referência — além de apagar a evidência de que ela chegou a ser
-- proposta e foi recusada.

UPDATE fin_product_line SET is_active = false WHERE slug = 'clie';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM fin_product_line WHERE slug = 'clie' AND is_active;
  IF n <> 0 THEN RAISE EXCEPTION 'o CLIE continua ativo'; END IF;

  SELECT count(*) INTO n FROM fin_product_line WHERE is_active;
  IF n <> 9 THEN RAISE EXCEPTION 'esperava 9 linhas ativas depois de tirar o CLIE, há %', n; END IF;

  -- As travas recusam mesmo, em vez de só parecer que recusam.
  BEGIN
    INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                                incurred_on, pagamento, parcelas, status)
    VALUES (1, 'custo', (SELECT id FROM fin_person LIMIT 1), 'declarada', 'teste da trava', 100,
            CURRENT_DATE, 'a_definir', 1, 'rascunho');
    RAISE EXCEPTION 'parcelas=1 foi aceito — à vista tem de ser NULL';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                                incurred_on, pagamento, card_last4, status)
    VALUES (1, 'custo', (SELECT id FROM fin_person LIMIT 1), 'declarada', 'teste da trava', 100,
            CURRENT_DATE, 'a_definir', 'abcd', 'rascunho');
    RAISE EXCEPTION 'final não numérico foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
