-- Classificação manual do custo da empresa: time + área, como em Pessoas.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA NOVA
-- ---------------------------------------------------------------------------
-- A matriz de Pessoas grava time em `fin_person.area` e departamento em
-- `fin_pessoa_area_empresa`. Um aluguel não é pessoa: reusar aquelas tabelas
-- exigiria inventar um `fin_person` para a Ancora Imobiliária, e a TIME_SQL
-- passaria a contar o aluguel como headcount.
--
-- `fin_recurring.nucleo` também não serve: cobre só o que o detector achou
-- (47 linhas), e 83% está nulo. A lista da tela é o EXTRATO — 115 pares
-- (contraparte × categoria) em 2026, medido em 31/08. A classificação tem
-- de viver nesse grão, não no catálogo.
--
-- Ninguém nasce classificado. O dono marca na matriz, um a um. Seed aqui
-- seria chute — o mesmo erro de inventar o salário do sócio.

CREATE TABLE IF NOT EXISTS fin_custo_empresa (
  id              bigserial PRIMARY KEY,
  entity_id       bigint NOT NULL REFERENCES fin_entity(id),
  counterparty_id bigint REFERENCES fin_counterparty(id),
  category_id     bigint NOT NULL REFERENCES fin_category(id),
  -- O mesmo vocabulário de fin_person.area depois da 0170.
  area            text,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  text,
  CONSTRAINT fin_custo_empresa_chave UNIQUE NULLS NOT DISTINCT (entity_id, counterparty_id, category_id),
  CHECK (area IS NULL OR area IN ('consultoria', 'obras', 'administrativo', 'outros'))
);

COMMENT ON TABLE fin_custo_empresa IS
  'Classificação de um custo da empresa (contraparte × categoria): time de entrega. '
  'NÃO é pessoa; NÃO entra na TIME_SQL. Área de departamento fica em fin_custo_empresa_area.';

COMMENT ON COLUMN fin_custo_empresa.area IS
  'consultoria | obras | administrativo | outros. NULL é pendência, não "sem time" como afirmação.';

COMMENT ON COLUMN fin_custo_empresa.counterparty_id IS
  'NULL é lançamento sem favorecido no extrato (ex.: DAS sem contraparte). '
  'UNIQUE NULLS NOT DISTINCT garante um cadastro só por (entidade, contraparte, categoria).';

CREATE INDEX IF NOT EXISTS fin_custo_empresa_area_idx ON fin_custo_empresa (entity_id, area);
CREATE INDEX IF NOT EXISTS fin_custo_empresa_cat_idx ON fin_custo_empresa (category_id);

CREATE TABLE IF NOT EXISTS fin_custo_empresa_area (
  custo_id   bigint NOT NULL REFERENCES fin_custo_empresa(id) ON DELETE CASCADE,
  area_id    bigint NOT NULL REFERENCES fin_area_empresa(id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (custo_id, area_id)
);

COMMENT ON TABLE fin_custo_empresa_area IS
  'Um custo da empresa, N áreas (Marketing, Vendas…). Vazio é pendência de cadastro. '
  'O catálogo é fin_area_empresa — o mesmo de Pessoas, para o dono não manter duas listas.';

CREATE INDEX IF NOT EXISTS fin_custo_empresa_area_area_idx ON fin_custo_empresa_area (area_id);

DO $$
DECLARE
  n integer;
BEGIN
  IF to_regclass('fin_custo_empresa') IS NULL THEN
    RAISE EXCEPTION 'fin_custo_empresa não foi criada';
  END IF;
  IF to_regclass('fin_custo_empresa_area') IS NULL THEN
    RAISE EXCEPTION 'fin_custo_empresa_area não foi criada';
  END IF;
  IF to_regclass('fin_area_empresa') IS NULL THEN
    RAISE EXCEPTION 'fin_area_empresa sumiu — a 0182 não deveria tê-la tocado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_person' AND column_name = 'area'
  ) THEN
    RAISE EXCEPTION 'fin_person.area sumiu — a 0182 não deveria tê-la tocado';
  END IF;

  SELECT count(*) INTO n FROM fin_custo_empresa;
  IF n <> 0 THEN
    RAISE EXCEPTION 'fin_custo_empresa nasceu preenchida (% linha(s)) — a 0182 não classifica ninguém', n;
  END IF;
  SELECT count(*) INTO n FROM fin_custo_empresa_area;
  IF n <> 0 THEN
    RAISE EXCEPTION 'fin_custo_empresa_area nasceu preenchida (% linha(s))', n;
  END IF;
END $$;
