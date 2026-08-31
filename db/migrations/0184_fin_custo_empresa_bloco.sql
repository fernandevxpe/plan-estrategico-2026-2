-- Bloco da matriz (Aluguel, Impostos, Material de obras…).
--
-- A regra em custo-empresa-partes.ts agrupa por nome e categoria. Errar um
-- item (Ancora em Aluguel quando era Imposto) não tinha onde gravar a
-- correção — a heurística devolvia o mesmo bloco no refresh. `bloco` é o
-- override do dono; NULL continua sendo a regra automática.

ALTER TABLE fin_custo_empresa ADD COLUMN IF NOT EXISTS bloco text;

ALTER TABLE fin_custo_empresa DROP CONSTRAINT IF EXISTS fin_custo_empresa_bloco_check;
ALTER TABLE fin_custo_empresa ADD CONSTRAINT fin_custo_empresa_bloco_check
  CHECK (bloco IS NULL OR bloco IN (
    'aluguel', 'impostos', 'utilidades', 'embrasul', 'flyeron',
    'juridico_contabil', 'taxas', 'tecnologia', 'financeiro',
    'material_obras', 'deslocamento_obras', 'terceiros_obras', 'outros_obras',
    'material_consultoria', 'outros_consultoria', 'resto'
  ));

COMMENT ON COLUMN fin_custo_empresa.bloco IS
  'Override do bloco da matriz (aluguel, impostos, material_obras…). '
  'NULL = heurística por nome + categoria + área.';

DO $$
DECLARE
  def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_custo_empresa' AND column_name = 'bloco'
  ) THEN
    RAISE EXCEPTION 'fin_custo_empresa.bloco não foi criada';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'fin_custo_empresa'::regclass
     AND conname = 'fin_custo_empresa_bloco_check';
  IF def IS NULL OR def NOT LIKE '%aluguel%' OR def NOT LIKE '%material_obras%' THEN
    RAISE EXCEPTION 'CHECK de bloco incompleto: %', def;
  END IF;
END $$;
