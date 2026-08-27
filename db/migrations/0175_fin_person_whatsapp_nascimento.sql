-- WhatsApp e aniversário no cadastro da pessoa — mesma base do app do time,
-- editável pelo admin na tela de Pendências de cadastro.

ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS birth_date date;

COMMENT ON COLUMN fin_person.whatsapp IS
  'Telefone WhatsApp (só dígitos, com DDD). Usado para contato; não é chave PIX.';

COMMENT ON COLUMN fin_person.birth_date IS
  'Data de nascimento — cadastro administrativo; a tela do perfil já reserva o campo.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_person' AND column_name = 'whatsapp'
  ) THEN
    RAISE EXCEPTION 'fin_person.whatsapp não foi criada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_person' AND column_name = 'birth_date'
  ) THEN
    RAISE EXCEPTION 'fin_person.birth_date não foi criada';
  END IF;
END $$;
