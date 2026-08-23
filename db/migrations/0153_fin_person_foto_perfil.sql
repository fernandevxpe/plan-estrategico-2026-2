-- Foto de perfil no app do time.
--
-- O blob mora em `fin_anexo_blob` como todo comprovante; aqui só a chave.
-- Medido: avatar JPEG 256×256 após encolher no celular ≈ 35 KB — aceitável
-- numa coluna de referência, e o gzip do blob comprime mais.

ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS foto_chave text;

COMMENT ON COLUMN fin_person.foto_chave IS
  'storage_key em fin_anexo_blob — avatar do app do time; só a pessoa dona altera.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fin_person' AND column_name = 'foto_chave'
  ) THEN
    RAISE EXCEPTION 'fin_person.foto_chave não foi criada';
  END IF;
END $$;
