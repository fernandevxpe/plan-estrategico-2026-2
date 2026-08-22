-- A cor do plástico, para a miniatura mostrar o cartão que a pessoa tem na mão.
--
-- ---------------------------------------------------------------------------
-- POR QUE COR É DADO, E NÃO ENFEITE
-- ---------------------------------------------------------------------------
-- O Nubank tem nove plásticos cadastrados e nenhum apelido. Na tela eles são
-- nove retângulos roxos idênticos com quatro dígitos diferentes, e quem está no
-- caixa precisa comparar número a número para achar o seu.
--
-- Cor é o primeiro atributo que qualquer pessoa usa para identificar o próprio
-- cartão — "o preto", "o dourado" —, muito antes do final. Guardá-la faz a
-- lista virar reconhecimento em vez de leitura.
--
-- E ela é um dado que a casa NÃO tinha como obter: o sync do banco não expõe, e
-- os quatro últimos dígitos não dizem nada sobre o plástico. Só olhando o
-- cartão. Por isso ela chega junto com a leitura da foto do próprio cartão.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO ENTRA AQUI, E ISSO IMPORTA MAIS QUE O QUE ENTRA
-- ---------------------------------------------------------------------------
-- A foto de um cartão contém o NÚMERO COMPLETO. Guardar essa imagem seria
-- guardar PAN, com tudo que isso implica de PCI-DSS — e a casa não tem, nem
-- quer ter, essa responsabilidade.
--
-- Então a imagem é lida em memória e descartada na mesma requisição: não vai
-- para `fin_anexo_blob`, não vira anexo, não é gravada em lugar nenhum. O que
-- sobrevive são estes campos — cor, bandeira, emissor e os quatro últimos —,
-- que é exatamente o que já era permitido guardar antes de existir foto.
-- ===========================================================================

ALTER TABLE fin_card ADD COLUMN IF NOT EXISTS cor text;

-- Vocabulário fechado: cor de cartão é um conjunto pequeno e conhecido, e texto
-- livre encheria de "preto", "Preto", "black" e "escuro" — quatro grafias da
-- mesma coisa, que quebram o agrupamento e a miniatura.
ALTER TABLE fin_card DROP CONSTRAINT IF EXISTS fin_card_cor_ck;
ALTER TABLE fin_card ADD CONSTRAINT fin_card_cor_ck
  CHECK (cor IS NULL OR cor IN (
    'preto', 'branco', 'cinza', 'prata', 'dourado',
    'roxo', 'azul', 'verde', 'vermelho', 'laranja', 'rosa', 'transparente'
  ));

COMMENT ON COLUMN fin_card.cor IS
  'A cor do plástico, como a pessoa o descreveria. Existe porque os nove Nubank sem apelido são '
  'retângulos idênticos na tela, e cor é como se reconhece um cartão antes de ler o número. '
  'Preenchida pela leitura da FOTO DO CARTÃO — e a foto é descartada na mesma requisição, porque '
  'contém o número completo e guardá-la seria guardar PAN.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  -- Os plásticos que já existem continuam válidos com cor nula.
  SELECT count(*) INTO n FROM fin_card WHERE cor IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% plástico(s) já com cor; a coluna nasce vazia', n; END IF;

  -- A trava recusa grafia livre em vez de só parecer que recusa.
  BEGIN
    UPDATE fin_card SET cor = 'Preto' WHERE id = (SELECT id FROM fin_card LIMIT 1);
    RAISE EXCEPTION 'cor com maiúscula foi aceita — o vocabulário precisa ser único';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE fin_card SET cor = 'azul-marinho' WHERE id = (SELECT id FROM fin_card LIMIT 1);
    RAISE EXCEPTION 'cor fora da lista foi aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- E aceita o que está na lista.
  UPDATE fin_card SET cor = 'preto' WHERE id = (SELECT id FROM fin_card ORDER BY id LIMIT 1);
  UPDATE fin_card SET cor = NULL WHERE cor = 'preto';
END $$;
