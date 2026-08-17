-- O lançamento reivindicado por um custo realizado não se apaga.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO É UMA MIGRATION NOVA, E NÃO UMA EDIÇÃO DA 0100
-- ---------------------------------------------------------------------------
-- A 0100 nasceu com `ON DELETE SET NULL` e foi aplicada. Minutos depois a
-- frente que a escreveu percebeu que RESTRICT é o correto e editou o arquivo —
-- que já estava aplicado e checksumado no ledger.
--
-- O resultado imediato foi drift: `db:migrate:status` acusou "ALTERADAS DEPOIS
-- DE APLICADAS", e drift derruba o /financeiro no boot, porque o runner marca
-- o schema como inválido antes de o Next subir. O arquivo 0100 foi restaurado
-- ao conteúdo que está no banco, e a melhoria vem aqui.
--
-- A causa foi minha: apliquei a 0100 enquanto a frente dela ainda trabalhava.
-- Migration aplicada é imutável; a regra ficou registrada em CONTINUACAO.md §6.
--
-- ---------------------------------------------------------------------------
-- E POR QUE RESTRICT É MELHOR — o argumento é da frente que escreveu a 0100
-- ---------------------------------------------------------------------------
-- Com SET NULL, apagar um lançamento dispararia um UPDATE em
-- `fin_custo_previsto` que o CHECK do estado 'realizado' recusaria de qualquer
-- jeito. A proteção existiria, mas com a mensagem errada: falaria de "aponta
-- para lançamento inexistente" a respeito de uma operação que era um DELETE em
-- OUTRA tabela, e quem lesse o erro procuraria o defeito no lugar errado.
--
-- RESTRICT diz a verdade na primeira linha: um lançamento reivindicado por um
-- custo previsto não se apaga sem antes desfazer a reivindicação.

DO $$
DECLARE
  v_nome text;
  v_acao text;
BEGIN
  SELECT c.conname, c.confdeltype INTO v_nome, v_acao
    FROM pg_constraint c
   WHERE c.conrelid = 'fin_custo_previsto'::regclass
     AND c.contype = 'f'
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'fin_custo_previsto'::regclass
                              AND attname = 'realizado_transaction_id')]::smallint[];

  IF v_nome IS NULL THEN
    RAISE EXCEPTION '[0106] FK de realizado_transaction_id não encontrada — a 0100 mudou de forma';
  END IF;

  -- 'r' = RESTRICT. Se já estiver assim, não há o que fazer: a migration é
  -- idempotente de propósito, porque pode ser reaplicada num banco restaurado
  -- de backup posterior à correção.
  IF v_acao = 'r' THEN
    RAISE NOTICE '[0106] FK % já está em RESTRICT, nada a fazer', v_nome;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE fin_custo_previsto DROP CONSTRAINT %I', v_nome);
  ALTER TABLE fin_custo_previsto
    ADD CONSTRAINT fin_custo_previsto_realizado_transaction_id_fkey
    FOREIGN KEY (realizado_transaction_id) REFERENCES fin_transaction(id) ON DELETE RESTRICT;

  RAISE NOTICE '[0106] FK % trocada de % para RESTRICT', v_nome, v_acao;
END $$;

-- Pós-condição: sem isto, um erro futuro que recriasse a FK errada passaria
-- despercebido até alguém apagar um lançamento em produção.
DO $$
DECLARE v_acao text;
BEGIN
  SELECT c.confdeltype INTO v_acao
    FROM pg_constraint c
   WHERE c.conrelid = 'fin_custo_previsto'::regclass
     AND c.contype = 'f'
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'fin_custo_previsto'::regclass
                              AND attname = 'realizado_transaction_id')]::smallint[];
  IF v_acao IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION '[0106] FK ficou em % em vez de RESTRICT', COALESCE(v_acao, '(ausente)');
  END IF;
END $$;
