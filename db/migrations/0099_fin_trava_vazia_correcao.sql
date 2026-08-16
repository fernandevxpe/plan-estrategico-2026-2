-- A 0098 travou 2 linhas no vazio. Corrigindo o próprio erro.
--
-- ---------------------------------------------------------------------------
-- A CADEIA COMPLETA, RECONSTRUÍDA PELO fin_audit_log
-- ---------------------------------------------------------------------------
-- Lançamentos 76675 e 76826:
--   1. 2026-08-11 19:48 — scripts/qualificar.mjs classifica por evidência,
--      classified_by='humano'. Sem human_locked_fields (o bug que a 0098
--      corrigiu).
--   2. Em algum momento depois — um processo automático de pareamento de
--      transferência SOBRESCREVE category_id para 49 e marca
--      transfer_status='pareado'. Livre para fazer isso porque a trava nunca
--      existiu. classified_by continua 'humano', mas já é metadado velho: a
--      decisão que ele descreve não é mais a que está gravada.
--   3. 2026-08-16 00:35 — migration-0044 (par falso) detecta que o par de
--      transferência era coincidência de valor+data, não a mesma pessoa.
--      Faz rollback correto: category_id volta a NULL, transfer_status='nao'.
--      Não mexe em classified_by, porque não era dele mexer.
--   4. Esta migration, 0098, viu classified_by='humano' e travou category_id
--      — sem checar que category_id já estava NULL. Human_locked_fields
--      passou a conter 'category_id' apontando para o vazio, que é
--      exatamente o que E2 existe para proibir: "travar um campo e deixá-lo
--      nulo congela o vazio, a linha nunca mais é classificada por ninguém."
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO EDITAR A 0098
-- ---------------------------------------------------------------------------
-- Ela já está aplicada e registrada no ledger com checksum. Editar o arquivo
-- geraria drift e derrubaria o boot na checagem de integridade das
-- migrations. A correção é uma migration nova, como qualquer outra.
--
-- ---------------------------------------------------------------------------
-- ESCOPO: SÓ o vazio. Nada mais muda.
-- ---------------------------------------------------------------------------
-- Medido: exatamente 2 linhas no sistema inteiro têm 'category_id' travado
-- com category_id NULL. As outras 215 da 0098 continuam travadas — a decisão
-- humana delas é real e atual. As duas já têm fin_review_item pendente desde
-- 2026-08-11 (H4 já satisfeito): destravar aqui não tira nada da fila, só
-- devolve a possibilidade de alguém classificar de novo.

DO $$
DECLARE
  v_alvo   bigint;
  v_tocado bigint;
BEGIN
  SELECT count(*) INTO v_alvo
    FROM fin_transaction
   WHERE 'category_id' = ANY (human_locked_fields) AND category_id IS NULL;

  IF v_alvo <> 2 THEN
    RAISE EXCEPTION '[0099] esperava 2 linhas travadas no vazio (medido em 16/08/2026), achou %. '
      'A base mudou — confira antes de seguir.', v_alvo;
  END IF;

  WITH alvo AS (
    UPDATE fin_transaction t
       SET human_locked_fields = array_remove(t.human_locked_fields, 'category_id')
     WHERE 'category_id' = ANY (t.human_locked_fields)
       AND t.category_id IS NULL
    RETURNING t.id
  )
  SELECT count(*) INTO v_tocado FROM alvo;

  RAISE NOTICE '[0099] % linha(s) destravadas do vazio', v_tocado;

  IF v_tocado <> 2 THEN
    RAISE EXCEPTION '[0099] tocou % linha(s), esperava 2', v_tocado;
  END IF;
END $$;
