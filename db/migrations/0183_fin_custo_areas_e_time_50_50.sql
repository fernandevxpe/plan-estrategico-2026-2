-- Áreas novas no catálogo da empresa, e o time 50/50 Consultoria+Obras.
--
-- As cinco áreas (Impostos, Material de obras, Material consultoria,
-- Serviços terceirizados, Escritório) são o que o dono vai marcar na
-- matriz de Custo da empresa. Moram em `fin_area_empresa` — o mesmo
-- catálogo de Pessoas — para não haver duas listas. Não atribui ninguém.
--
-- `consultoria_obras` no CHECK de fin_custo_empresa.area é o time que
-- CONTA metade em cada linha de negócio. Sem este valor, o select da
-- matriz não tem onde gravar "é dos dois", e o gráfico ou chutaria 100%
-- numa ponta ou inventaria uma quinta barra.

INSERT INTO fin_area_empresa (entity_id, slug, nome, ordem)
SELECT e.id, v.slug, v.nome, v.ordem
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('impostos',                 'Impostos',                 150),
    ('material_obras',           'Material de obras',        160),
    ('material_consultoria',     'Material consultoria',     170),
    ('servicos_terceirizados',   'Serviços Terceirizados',   180),
    ('escritorio',               'Escritório',               190)
  ) AS v(slug, nome, ordem)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO UPDATE
   SET nome = EXCLUDED.nome,
       ordem = EXCLUDED.ordem,
       ativo = true;

-- CHECK da 0182 era unnamed. O nome automático do Postgres é
-- fin_custo_empresa_area_check, mas se o nome for outro o DROP por nome
-- deixa o CHECK velho e consultoria_obras continua recusado.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'fin_custo_empresa'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%administrativo%'
       AND pg_get_constraintdef(oid) NOT LIKE '%consultoria_obras%'
  LOOP
    EXECUTE format('ALTER TABLE fin_custo_empresa DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE fin_custo_empresa DROP CONSTRAINT IF EXISTS fin_custo_empresa_area_check;
ALTER TABLE fin_custo_empresa ADD CONSTRAINT fin_custo_empresa_area_check
  CHECK (area IS NULL OR area IN
         ('consultoria', 'obras', 'administrativo', 'outros', 'consultoria_obras'));

COMMENT ON COLUMN fin_custo_empresa.area IS
  'consultoria | obras | administrativo | outros | consultoria_obras. '
  'consultoria_obras conta 50/50 nas duas linhas no gráfico. NULL é pendência.';

DO $$
DECLARE
  n integer;
  def text;
BEGIN
  SELECT count(*) INTO n
    FROM fin_area_empresa a
    JOIN fin_entity e ON e.id = a.entity_id
   WHERE e.slug = 'xpe' AND a.ativo AND a.slug IN (
     'impostos', 'material_obras', 'material_consultoria',
     'servicos_terceirizados', 'escritorio'
   );
  IF n <> 5 THEN
    RAISE EXCEPTION 'as 5 áreas novas deveriam existir no catálogo xpe, tem %', n;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'fin_custo_empresa'::regclass
     AND conname = 'fin_custo_empresa_area_check';
  IF def IS NULL OR def NOT LIKE '%consultoria_obras%' THEN
    RAISE EXCEPTION 'CHECK deveria aceitar consultoria_obras, tem %', def;
  END IF;
END $$;
