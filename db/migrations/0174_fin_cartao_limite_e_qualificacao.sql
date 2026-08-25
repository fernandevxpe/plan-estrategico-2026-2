-- A tela de cartões ganha o que faltava para ser administrável: limite por
-- plástico e um vocabulário aprendido de qualificação.
--
-- ---------------------------------------------------------------------------
-- 1. LIMITE POR PLÁSTICO — o que `fin_card_account` não consegue responder
-- ---------------------------------------------------------------------------
-- `fin_card_account` JÁ tem `credit_limit_cents`, e ele é real: o Nubank vem
-- com R$ 17.900 de limite, R$ 8.740,74 usados. Mas ele é da LINHA DE CRÉDITO,
-- e `limit_is_consolidated = true` diz exatamente o problema — os nove plásticos
-- do Nubank dividem um limite só, e a fonte não reparte.
--
-- O pedido é outro: "botar limite TEÓRICO dos cartões (...) e assim monitorar %
-- do limite". Teórico é a palavra que importa. É um número que a pessoa
-- ATRIBUI ao plástico para se cobrar ("este final não deveria passar de R$ 2 mil
-- por mês"), não um número que o emissor informa.
--
-- Por isso coluna nova em vez de reusar a da linha: são grandezas diferentes com
-- autoridades diferentes. `credit_limit_cents` é fato da fonte e o sync
-- sobrescreve; `limite_cents` é decisão humana e nada automático pode tocar.
-- Guardá-los no mesmo campo faria o próximo sync apagar a decisão.
--
-- NULL é o estado normal e significa "ninguém definiu" — diferente de zero, que
-- significaria "este cartão não pode gastar nada". A tela precisa distinguir os
-- dois para não desenhar uma barra de 100% de uso em cartão sem limite definido.
ALTER TABLE fin_card
  ADD COLUMN limite_cents bigint,
  ADD COLUMN limite_definido_por text,
  ADD COLUMN limite_definido_em timestamptz;

ALTER TABLE fin_card
  ADD CONSTRAINT fin_card_limite_positivo
    CHECK (limite_cents IS NULL OR limite_cents > 0);

-- Quem definiu vem junto com o quanto. Um limite teórico é uma decisão, e
-- decisão sem autor não se discute depois — é o mesmo princípio de
-- `fin_pessoa_mes_ajuste.confirmado_por`.
ALTER TABLE fin_card
  ADD CONSTRAINT fin_card_limite_tem_autor
    CHECK (limite_cents IS NULL OR (limite_definido_por IS NOT NULL AND limite_definido_em IS NOT NULL));

COMMENT ON COLUMN fin_card.limite_cents IS
  'Limite TEÓRICO atribuído por uma pessoa a este plástico, para monitorar % de uso. '
  'Não é o limite do emissor — esse é fin_card_account.credit_limit_cents, que o sync '
  'sobrescreve. NULL = ninguém definiu (diferente de zero).';

-- ---------------------------------------------------------------------------
-- 2. O VOCABULÁRIO APRENDIDO DE QUALIFICAÇÃO
-- ---------------------------------------------------------------------------
-- Estado medido hoje: dos 774 itens de compra do cartão, 234 estão sem
-- categoria (R$ 13.478,68) e 461 sem núcleo (R$ 49.703,98). Não é pouco — é
-- quase metade do valor sem saber de que área é.
--
-- Pedido: "usuário pode selecionar, escrever a qualificação e a ferramenta busca
-- o apropriado, ou adiciona para próximas buscas, isso para a categoria e também
-- para a área ou projeto".
--
-- É a mesma ideia de `fin_padrao_categoria_fornecedor` (0172), que já funciona
-- para o app do time — mas ali a chave é o FORNECEDOR lido de uma foto, e o alvo
-- é sempre categoria. Aqui a chave é a DESCRIÇÃO que o banco mandou
-- ("Facebk *Va4u4frll2", "Mercadolivre*Mercadol") e o alvo pode ser três coisas
-- diferentes: categoria, núcleo ou centro de custo.
--
-- Uma tabela com `alvo_tipo` em vez de três tabelas quase iguais: a busca por
-- proximidade é idêntica nos três casos, e três cópias divergiriam no primeiro
-- ajuste de limiar.
CREATE TABLE fin_padrao_qualificacao (
  id            bigserial PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES fin_entity(id),
  -- O texto que dispara o reconhecimento, normalizado (minúsculo, sem acento,
  -- espaços colapsados) — mesma normalização de fornecedor_norm na 0172.
  texto_norm    text        NOT NULL,
  alvo_tipo     text        NOT NULL CHECK (alvo_tipo IN ('categoria', 'nucleo', 'centro')),
  -- Exatamente UM destes três é preenchido, conforme `alvo_tipo`. Colunas
  -- tipadas com FK de verdade em vez de um `alvo_id bigint` genérico: o banco
  -- recusa um centro de custo que não existe, e um id órfão aqui viraria uma
  -- sugestão que a tela não consegue rotular.
  category_id   bigint      REFERENCES fin_category(id),
  nucleo        text        REFERENCES fin_nucleo(slug),
  cost_center_id bigint     REFERENCES fin_cost_center(id),
  vezes         int         NOT NULL DEFAULT 1 CHECK (vezes > 0),
  criado_por    text        NOT NULL,
  primeira_vez_em timestamptz NOT NULL DEFAULT now(),
  ultima_vez_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_padrao_qualificacao_alvo_coerente CHECK (
    (alvo_tipo = 'categoria' AND category_id IS NOT NULL AND nucleo IS NULL AND cost_center_id IS NULL) OR
    (alvo_tipo = 'nucleo'    AND nucleo IS NOT NULL AND category_id IS NULL AND cost_center_id IS NULL) OR
    (alvo_tipo = 'centro'    AND cost_center_id IS NOT NULL AND category_id IS NULL AND nucleo IS NULL)
  )
);

-- Um padrão por (texto, tipo de alvo, alvo). O contador é o que separa "já
-- escolhi isso 8 vezes" de "escolhi uma vez e pode ter sido engano".
CREATE UNIQUE INDEX fin_padrao_qualificacao_unico_idx
  ON fin_padrao_qualificacao (entity_id, texto_norm, alvo_tipo,
                              coalesce(category_id, 0),
                              coalesce(nucleo, ''),
                              coalesce(cost_center_id, 0));

-- Busca por proximidade, não igualdade: "Facebk *Va4u4frll2" e
-- "Facebk* 9he9jf9ll2" são o MESMO fornecedor com sufixo aleatório por
-- transação — igualdade exata nunca casaria, e é justamente esse o caso que
-- mais se repete no acervo (13 lançamentos do Facebook em 2026).
CREATE INDEX fin_padrao_qualificacao_trgm_idx
  ON fin_padrao_qualificacao USING gin (texto_norm gin_trgm_ops);

COMMENT ON TABLE fin_padrao_qualificacao IS
  'Vocabulário aprendido de qualificação: que categoria/núcleo/centro uma pessoa já '
  'escolheu para uma descrição parecida. Alimentado a cada qualificação manual na tela '
  'de cartões; consultado por semelhança de trigrama (pg_trgm) para sugerir a próxima.';

-- O outro lado da busca — achar "itens parecidos com este" entre os 795
-- lançamentos — JÁ tem índice: `fin_card_transaction_desc_trgm_idx`, criado na
-- 0047 junto com a própria tabela. Recriá-lo aqui só quebraria a migration com
-- "already exists", que foi exatamente o que aconteceu na primeira tentativa.

-- ---------------------------------------------------------------------------
-- POST-CONDIÇÕES
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
  v numeric;
BEGIN
  -- Esta migration só ACRESCENTA. Nenhum número do acervo pode ter mudado.
  SELECT count(*) INTO n FROM fin_card_transaction;
  IF n <> 795 THEN
    RAISE EXCEPTION 'fin_card_transaction mudou de tamanho — esperava 795 linhas, achei %', n;
  END IF;

  SELECT round(sum(amount_cents) / 100.0, 2) INTO v
    FROM fin_card_transaction
   WHERE kind IN ('compra','iof','estorno') AND status = 'POSTED'
     AND competence_month >= DATE '2026-01-01' AND competence_month < DATE '2027-01-01';
  IF v IS DISTINCT FROM 55420.26 THEN
    RAISE EXCEPTION 'o gasto POSTED de 2026 mudou — esperava R$ 55.420,26, achei R$ %', v;
  END IF;

  SELECT count(*) INTO n FROM fin_card;
  IF n <> 15 THEN
    RAISE EXCEPTION 'fin_card mudou de tamanho — esperava 15 plásticos, achei %', n;
  END IF;

  -- Limite nasce indefinido em TODOS: a coluna é nova e nada a preencheu.
  -- Um default acidental aqui viraria "%.0f% do limite" mentiroso na tela.
  SELECT count(*) INTO n FROM fin_card WHERE limite_cents IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% cartões nasceram com limite preenchido — a coluna deveria começar vazia', n;
  END IF;

  SELECT count(*) INTO n FROM fin_padrao_qualificacao;
  IF n <> 0 THEN
    RAISE EXCEPTION 'fin_padrao_qualificacao deveria nascer vazia, tem % linhas', n;
  END IF;

  RAISE NOTICE '0174: limite por plástico + vocabulário de qualificação; acervo intacto (795 itens, R$ 55.420,26 em 2026)';
END $$;
