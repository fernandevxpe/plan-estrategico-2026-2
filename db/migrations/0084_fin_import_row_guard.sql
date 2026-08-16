-- Um lote confirmado não pode existir sem a trilha das linhas que leu.
--
-- O lote 30 do Inter provou que monitorar depois não basta: por um dia o banco
-- afirmou `status='confirmado'`, 161 linhas lidas e 13 inseridas, mas não tinha
-- um único `fin_import_row`. O payload foi recuperado da API em 16/08/2026 e as
-- 13 linhas inseridas foram ligadas novamente por `idTransacao`; o importador
-- também foi corrigido. Esta migration transforma C3 de alarme em guarda.
--
-- O trigger é DEFERRED porque o fluxo correto cria o lote, grava as linhas e só
-- então confirma, tudo na mesma transação. Conferir no fim permite essa ordem e
-- recusa apenas o estado final impossível.

CREATE OR REPLACE FUNCTION fin_batch_confirmado_exige_trilha()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_id bigint;
  v_batch_ids bigint[];
  v_status text;
  v_row_count integer;
  v_rows bigint;
BEGIN
  IF TG_TABLE_NAME = 'fin_import_batch' THEN
    v_batch_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    v_batch_ids := ARRAY[OLD.batch_id];
  ELSE
    -- Ao mover uma linha, tanto o lote que perdeu quanto o que ganhou precisam
    -- continuar válidos no estado final.
    v_batch_ids := ARRAY[OLD.batch_id, NEW.batch_id];
  END IF;

  FOREACH v_batch_id IN ARRAY v_batch_ids LOOP
    SELECT status, row_count
      INTO v_status, v_row_count
      FROM fin_import_batch
     WHERE id = v_batch_id;

    -- DELETE CASCADE do próprio lote: quando a checagem diferida rodar, o pai
    -- já não existe e não há afirmação de lote confirmado para proteger.
    IF NOT FOUND OR v_status <> 'confirmado' THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_rows
      FROM fin_import_row
     WHERE batch_id = v_batch_id;

    IF v_row_count > 0 AND v_rows = 0 THEN
      RAISE EXCEPTION
        'lote % não pode ficar confirmado: declara % linha(s) lida(s) e não tem fin_import_row',
        v_batch_id, v_row_count
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS fin_import_batch_confirmado_exige_trilha ON fin_import_batch;
CREATE CONSTRAINT TRIGGER fin_import_batch_confirmado_exige_trilha
AFTER INSERT OR UPDATE OF status, row_count ON fin_import_batch
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fin_batch_confirmado_exige_trilha();

-- A guarda simétrica impede apagar ou mover a última linha crua de um lote já
-- confirmado. Inserção não precisa de trigger: ela só melhora a trilha.
DROP TRIGGER IF EXISTS fin_import_row_preserva_lote_confirmado ON fin_import_row;
CREATE CONSTRAINT TRIGGER fin_import_row_preserva_lote_confirmado
AFTER DELETE OR UPDATE OF batch_id ON fin_import_row
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fin_batch_confirmado_exige_trilha();

COMMENT ON FUNCTION fin_batch_confirmado_exige_trilha() IS
  'Guarda C3: ao final da transação, lote confirmado com row_count > 0 precisa ter ao menos uma linha em fin_import_row.';
