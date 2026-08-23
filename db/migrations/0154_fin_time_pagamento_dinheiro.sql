-- Forma de pagamento em espécie no envio do time.
-- A UI passa a oferecer "Dinheiro" além das opções já existentes.

ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_pagamento_check;

ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_pagamento_check
  CHECK (pagamento IN (
    'ja_paguei_do_meu',
    'cartao_da_empresa',
    'boleto',
    'pix_da_empresa',
    'debito_automatico',
    'dinheiro',
    'a_definir'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fin_time_envio_pagamento_check'
      AND conrelid = 'fin_time_envio'::regclass
  ) THEN
    RAISE EXCEPTION '0154: constraint fin_time_envio_pagamento_check ausente';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fin_time_envio
    WHERE pagamento NOT IN (
      'ja_paguei_do_meu', 'cartao_da_empresa', 'boleto', 'pix_da_empresa',
      'debito_automatico', 'dinheiro', 'a_definir'
    )
  ) THEN
    RAISE EXCEPTION '0154: pagamento fora do conjunto permitido';
  END IF;
END $$;
