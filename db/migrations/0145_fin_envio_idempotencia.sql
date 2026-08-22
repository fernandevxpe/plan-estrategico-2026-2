-- Uma tentativa de envio cria no máximo um envio.
--
-- O BURACO, MEDIDO
--
-- No navegador o duplo toque está coberto: três toques em "enviar custo" com a
-- resposta atrasada em 2,2s produziram UM POST, porque o botão vira "enviando…"
-- antes do segundo toque. Isso protege contra o dedo, não contra a rede.
--
-- O caso real: a transação faz COMMIT, e a resposta se perde na volta — 4G que
-- cai, aba que dorme, proxy que corta. O cliente mostra erro, a pessoa toca de
-- novo, e nasce um SEGUNDO custo idêntico. Ninguém percebe, porque os dois
-- estão certos: mesma compra, mesmo valor, mesma data. Quem for conciliar com a
-- fatura vai encontrar dois lançamentos para uma linha do extrato e não vai
-- saber qual apagar.
--
-- Este é o app de gente que compra NA RUA, com o celular na mão e sinal ruim.
-- A conexão instável não é o caso raro aqui, é o caso comum.
--
-- POR QUE CHAVE DO CLIENTE, E NÃO DEDUPLICAÇÃO POR CONTEÚDO
--
-- Deduplicar por (pessoa, valor, data, título) recusaria uma compra legítima:
-- dois cafés de R$ 12 no mesmo dia, duas corridas de app para o mesmo lugar.
-- A chave separa "é a mesma tentativa" de "são duas compras iguais" — só o
-- cliente sabe a diferença, e só ele pode dizer.
-- ===========================================================================

ALTER TABLE fin_time_envio ADD COLUMN IF NOT EXISTS idempotency_key uuid;

COMMENT ON COLUMN fin_time_envio.idempotency_key IS
  'UUID gerado pelo cliente UMA VEZ por tentativa de envio e reenviado em cada retentativa. '
  'O índice único abaixo faz a segunda gravação falhar, e a rota devolve o envio que já existia '
  'em vez de criar outro. NULL nos envios anteriores à 0145 e em qualquer cliente que não mande '
  'a chave — a coluna não pode ser obrigatória sem invalidar o histórico.';

-- Parcial: os envios antigos têm NULL, e NULL não colide com NULL em índice
-- único de qualquer forma — a cláusula deixa isso explícito para quem lê.
CREATE UNIQUE INDEX IF NOT EXISTS fin_time_envio_idempotencia
  ON fin_time_envio (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  chave uuid := gen_random_uuid();
  pid bigint := (SELECT id FROM fin_person LIMIT 1);
BEGIN
  -- A trava recusa mesmo, em vez de só parecer que recusa.
  INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                              incurred_on, pagamento, status, idempotency_key)
  VALUES (1, 'custo', pid, 'declarada', 'teste da idempotência', 100, CURRENT_DATE, 'a_definir',
          'rascunho', chave);
  BEGIN
    INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                                incurred_on, pagamento, status, idempotency_key)
    VALUES (1, 'custo', pid, 'declarada', 'teste da idempotência', 100, CURRENT_DATE, 'a_definir',
            'rascunho', chave);
    RAISE EXCEPTION 'a mesma chave foi aceita duas vezes';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- E duas chaves diferentes passam: a trava é sobre a tentativa, não sobre a
  -- compra. Dois cafés iguais no mesmo dia continuam sendo dois lançamentos.
  INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, amount_cents,
                              incurred_on, pagamento, status, idempotency_key)
  VALUES (1, 'custo', pid, 'declarada', 'teste da idempotência', 100, CURRENT_DATE, 'a_definir',
          'rascunho', gen_random_uuid());

  DELETE FROM fin_time_envio WHERE titulo = 'teste da idempotência';
  IF (SELECT count(*) FROM fin_time_envio WHERE titulo = 'teste da idempotência') <> 0 THEN
    RAISE EXCEPTION 'os envios de teste não foram removidos';
  END IF;
END $$;
