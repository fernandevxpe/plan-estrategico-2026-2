-- Índice de trigrama para a sugestão de categoria por TEXTO digitado
-- (título/descrição), sem precisar de foto nenhuma.
--
-- ---------------------------------------------------------------------------
-- POR QUE
-- ---------------------------------------------------------------------------
-- `sugerirCategoriaPorTexto` (lib/financeiro/time.ts) compara o que a pessoa
-- está digitando contra `titulo`/`descricao` de todo `fin_time_envio` já
-- classificado, usando `word_similarity` — a mesma extensão `pg_trgm` que já
-- sustenta `fin_padrao_categoria_fornecedor` (0172), só que aqui a busca é
-- por PALAVRA dentro de uma frase longa, não a frase inteira.
--
-- Roda a cada 600ms de pausa ao digitar (debounce na tela) — sem índice, cada
-- toque de pausa varre `fin_time_envio` inteira calculando trigrama linha a
-- linha. A tabela ainda é pequena, mas o padrão do resto do banco é indexar
-- ANTES de doer, não depois.
--
-- A expressão indexada é a MESMA da consulta, de propósito: um índice de
-- expressão só serve se casar exatamente com o que o planejador vê no WHERE.
CREATE INDEX fin_time_envio_texto_trgm_idx
  ON fin_time_envio USING gin ((coalesce(titulo, '') || ' ' || coalesce(descricao, '')) gin_trgm_ops);

COMMENT ON INDEX fin_time_envio_texto_trgm_idx IS
  'Suporta a busca por semelhança (word_similarity) de sugerirCategoriaPorTexto — sugestão de '
  'categoria a partir do título/descrição digitados, sem depender de foto ou fornecedor.';

DO $$
DECLARE
  v_existe boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'fin_time_envio_texto_trgm_idx'
  ) INTO v_existe;

  IF NOT v_existe THEN
    RAISE EXCEPTION 'fin_time_envio_texto_trgm_idx não foi criado';
  END IF;

  RAISE NOTICE '0173: fin_time_envio_texto_trgm_idx criado';
END $$;
