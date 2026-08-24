-- Times: consultoria, obras e sem time.
--
-- ---------------------------------------------------------------------------
-- POR QUE
-- ---------------------------------------------------------------------------
-- Em 24/08/2026 o dono fechou o eixo: "vamos ter praticamente 2 times hoje,
-- consultoria, obras e sem time". Software e hardware deixam de ser times —
-- quem estava neles conta como consultoria.
--
-- Correções de cadastro:
--   · Leon (id 92) — sócio investidor: não é de consultoria; sem área/núcleo.
--   · Tiago (id 7) — não é de consultoria nem hardware; sem área/núcleo.
--   · Flavio (id 10) e demais hardware/software ativos: area + núcleo
--     consultoria (a TIME_SQL em lib/financeiro/pessoas.ts também mapeia
--     hardware/software → consultoria, para quem ainda tiver o valor antigo).
--
-- Rita (administrativo) e Kevin (marketing) já caíam em sem_time; intactos.

-- ---------------------------------------------------------------------------
-- 1. Leon e Tiago → sem time
-- ---------------------------------------------------------------------------
UPDATE fin_person
   SET area = NULL,
       default_nucleo = NULL,
       updated_at = now()
 WHERE id IN (92, 7)
   AND name IN ('Leon', 'Tiago');

-- ---------------------------------------------------------------------------
-- 2. Software / hardware ativos → consultoria
-- ---------------------------------------------------------------------------
-- Tiago já saiu no passo 1. Inativos (Kalebe) não mexemos: não aparecem no
-- recorte ativo e o histórico do cadastro deles fica.
UPDATE fin_person
   SET area = 'consultoria',
       default_nucleo = 'consultoria',
       updated_at = now()
 WHERE status = 'ativo'
   AND (area IN ('hardware', 'software')
     OR default_nucleo IN ('hardware', 'software'));

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
  t text;
BEGIN
  -- Leon e Tiago sem área/núcleo.
  SELECT count(*) INTO n
    FROM fin_person
   WHERE id IN (7, 92)
     AND (area IS NOT NULL OR default_nucleo IS NOT NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION 'Leon/Tiago ainda têm area ou núcleo — % linha(s)', n;
  END IF;

  -- Nenhum ativo com área software/hardware.
  SELECT count(*) INTO n
    FROM fin_person
   WHERE status = 'ativo' AND area IN ('hardware', 'software');
  IF n <> 0 THEN
    RAISE EXCEPTION '% ativo(s) ainda com area software/hardware', n;
  END IF;

  -- Flavio em consultoria.
  SELECT area INTO t FROM fin_person WHERE id = 10 AND name = 'Flavio';
  IF t IS DISTINCT FROM 'consultoria' THEN
    RAISE EXCEPTION 'Flavio deveria estar em consultoria, area=%', t;
  END IF;

  -- A expressão de time (espelho de TIME_SQL) só produz os três buckets.
  SELECT count(*) INTO n FROM (
    SELECT CASE
             WHEN p.area IN ('hardware', 'software') THEN 'consultoria'
             WHEN p.default_nucleo IN ('obras', 'consultoria') THEN p.default_nucleo
             WHEN p.area IN ('obras', 'consultoria') THEN p.area
             ELSE 'sem_time'
           END AS time
      FROM fin_person p
     WHERE p.status = 'ativo'
  ) x
  WHERE time NOT IN ('consultoria', 'obras', 'sem_time');
  IF n <> 0 THEN
    RAISE EXCEPTION '% ativo(s) com time fora de consultoria/obras/sem_time', n;
  END IF;

  -- Leon e Tiago resolvem para sem_time.
  SELECT count(*) INTO n FROM (
    SELECT p.name,
           CASE
             WHEN p.area IN ('hardware', 'software') THEN 'consultoria'
             WHEN p.default_nucleo IN ('obras', 'consultoria') THEN p.default_nucleo
             WHEN p.area IN ('obras', 'consultoria') THEN p.area
             ELSE 'sem_time'
           END AS time
      FROM fin_person p
     WHERE p.id IN (7, 92)
  ) x WHERE time <> 'sem_time';
  IF n <> 0 THEN
    RAISE EXCEPTION 'Leon/Tiago não resolveram para sem_time';
  END IF;

  RAISE NOTICE '0170: times = consultoria | obras | sem_time; Leon e Tiago fora';
END $$;
