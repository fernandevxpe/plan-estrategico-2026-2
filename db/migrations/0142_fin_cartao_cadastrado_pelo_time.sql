-- O time passa a poder cadastrar cartão pelo app.
--
-- Hoje NÃO EXISTE caminho de escrita para cartão na aplicação inteira: um grep
-- por `insert into fin_card` em `.ts`/`.tsx` devolve zero. Cartão só nasce por
-- migration ou por script de sync. Consequência prática: o Inter tem zero
-- plásticos, os nove Nubank não têm apelido, e quem está no caixa com um cartão
-- que o sistema não conhece não tem o que fazer além de digitar o final solto.
-- ===========================================================================

-- 1. Quem cadastrou, e por onde ------------------------------------------------
-- `fin_card` nasceu para receber dado de sync (Polp, Inter). Agora vai receber
-- dado digitado por gente, e as duas origens não podem se confundir: um sync
-- futuro que sobrescreva o apelido que alguém escreveu apagaria trabalho humano.

ALTER TABLE fin_card ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'sync';
ALTER TABLE fin_card ADD COLUMN IF NOT EXISTS cadastrado_por_person_id bigint REFERENCES fin_person(id);
ALTER TABLE fin_card ADD COLUMN IF NOT EXISTS cadastrado_em timestamptz;

ALTER TABLE fin_card DROP CONSTRAINT IF EXISTS fin_card_origem_ck;
ALTER TABLE fin_card ADD CONSTRAINT fin_card_origem_ck CHECK (origem IN ('sync', 'app_time', 'migration'));

-- Cadastro pelo app tem de dizer quem e quando. Sem isso, um plástico errado
-- fica sem ninguém a quem perguntar.
ALTER TABLE fin_card DROP CONSTRAINT IF EXISTS fin_card_app_tem_autor;
ALTER TABLE fin_card ADD CONSTRAINT fin_card_app_tem_autor
  CHECK (origem <> 'app_time' OR (cadastrado_por_person_id IS NOT NULL AND cadastrado_em IS NOT NULL));

COMMENT ON COLUMN fin_card.origem IS
  'De onde este plástico veio. `sync` é o Polp/Inter, `app_time` é alguém que cadastrou no celular. '
  'A distinção existe para um sync futuro não sobrescrever o apelido que uma pessoa escreveu — '
  'dado de máquina não apaga trabalho humano.';

-- 2. Cartão pessoal de quem ----------------------------------------------------
-- O Fernando: "o que vai para reembolso são os cartões PESSOAIS das pessoas".
-- `fin_card_account.ownership` já distingue `pj` de `pf_socio`, mas está na
-- LINHA de crédito, não no plástico — e um cartão pessoal cadastrado pelo app
-- não tem linha de crédito nenhuma, porque não vem de banco integrado.
--
-- `holder_person_id` já existe desde a 0047 e é exatamente o campo: de quem é o
-- plástico. O que faltava era poder cadastrar um sem `card_account_id`.

ALTER TABLE fin_card ALTER COLUMN card_account_id DROP NOT NULL;

-- Mas então precisa de UMA das duas âncoras: ou pertence a uma linha de crédito
-- da empresa, ou pertence a uma pessoa. Um plástico sem nenhuma das duas é um
-- registro órfão que ninguém consegue cobrar nem reembolsar.
ALTER TABLE fin_card DROP CONSTRAINT IF EXISTS fin_card_tem_dono;
ALTER TABLE fin_card ADD CONSTRAINT fin_card_tem_dono
  CHECK (card_account_id IS NOT NULL OR holder_person_id IS NOT NULL);

-- 3. Bandeira no plástico -------------------------------------------------------
-- `brand` existe em `fin_card_account` e vale para a linha inteira. Num cartão
-- pessoal não há linha, e a bandeira é do plástico. Texto livre com CHECK: o
-- vocabulário é pequeno e conhecido, e deixar aberto encheria de "mastercard",
-- "MasterCard" e "master".
ALTER TABLE fin_card ADD COLUMN IF NOT EXISTS brand text;

ALTER TABLE fin_card DROP CONSTRAINT IF EXISTS fin_card_brand_ck;
ALTER TABLE fin_card ADD CONSTRAINT fin_card_brand_ck
  CHECK (brand IS NULL OR brand IN ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra'));

-- Dois plásticos com o mesmo final na mesma linha são indistinguíveis para o
-- casamento com a fatura. Na mesma pessoa, idem.
CREATE UNIQUE INDEX IF NOT EXISTS fin_card_final_unico_por_conta
  ON fin_card (card_account_id, last4) WHERE card_account_id IS NOT NULL AND last4 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fin_card_final_unico_por_pessoa
  ON fin_card (holder_person_id, last4) WHERE card_account_id IS NULL AND holder_person_id IS NOT NULL AND last4 IS NOT NULL;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  -- Os 12 plásticos que já existem continuam válidos e marcados como sync.
  SELECT count(*) INTO n FROM fin_card WHERE origem <> 'sync';
  IF n <> 0 THEN RAISE EXCEPTION '% plástico(s) com origem diferente de sync; a coluna nasce com default', n; END IF;

  SELECT count(*) INTO n FROM fin_card WHERE card_account_id IS NULL AND holder_person_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% plástico(s) órfão(s) — sem linha e sem pessoa', n; END IF;

  -- A trava do autor recusa cadastro anônimo pelo app.
  BEGIN
    INSERT INTO fin_card (card_account_id, last4, status, origem)
    VALUES ((SELECT id FROM fin_card_account LIMIT 1), '0001', 'registrado', 'app_time');
    RAISE EXCEPTION 'cadastro pelo app sem autor foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- E a trava do órfão recusa plástico sem dono nenhum.
  BEGIN
    INSERT INTO fin_card (last4, status, origem) VALUES ('0002', 'registrado', 'sync');
    RAISE EXCEPTION 'plástico sem linha e sem pessoa foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
