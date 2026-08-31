-- Áreas da empresa: Marketing, Vendas, Sucesso… — e uma pessoa cabe em várias.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA NOVA, E NÃO fin_person.area
-- ---------------------------------------------------------------------------
-- `fin_person.area` (e `default_nucleo`) é o EIXO DE TIME: consultoria | obras |
-- sem_time. A TIME_SQL em lib/financeiro/pessoas.ts lê literalmente esses
-- valores. Reusar a coluna para "Marketing" jogaria Rita e Kevin para sem_time
-- ou, pior, inventaria um quarto time — o defeito que a 0170 fechou.
--
-- E uma coluna só não cabe: a mesma pessoa entrega em Consultoria e atua em
-- Marketing E Vendas. Por isso o catálogo (`fin_area_empresa`) e a ligação
-- (`fin_pessoa_area_empresa`) são N:N. Ninguém nasce ligado — o dono atribui
-- um a um na matriz. Inventar a área de alguém seria o mesmo erro de inventar
-- o salário do sócio.
--
-- O catálogo é fechado o bastante para a tela oferecer as 14 de hoje, e
-- aberto o bastante para nascer a 15ª sem migration: a API cria a linha se
-- o slug ainda não existir (mesma receita do campo livre de 0026, com slug
-- normalizado para não virar "Marketing" / "marketing" / "marketing ").

CREATE TABLE IF NOT EXISTS fin_area_empresa (
  id         bigserial PRIMARY KEY,
  entity_id  bigint      NOT NULL REFERENCES fin_entity(id),
  slug       text        NOT NULL,
  nome       text        NOT NULL,
  ordem      integer     NOT NULL DEFAULT 100,
  ativo      boolean     NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, slug),
  CHECK (slug ~ '^[a-z0-9_]+$'),
  CHECK (char_length(nome) BETWEEN 1 AND 80)
);

COMMENT ON TABLE fin_area_empresa IS
  'Departamento da casa (Marketing, Vendas, Sucesso…), NÃO o time de entrega. '
  'fin_person.area continua sendo consultoria/obras; esta tabela nunca entra na TIME_SQL.';

CREATE TABLE IF NOT EXISTS fin_pessoa_area_empresa (
  person_id  bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  area_id    bigint      NOT NULL REFERENCES fin_area_empresa(id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, area_id)
);

COMMENT ON TABLE fin_pessoa_area_empresa IS
  'Uma pessoa, N áreas da empresa. Vazio é o estado inicial — pendência de cadastro, '
  'não "sem área" como afirmação.';

CREATE INDEX IF NOT EXISTS fin_pessoa_area_empresa_area_idx
  ON fin_pessoa_area_empresa (area_id);

INSERT INTO fin_area_empresa (entity_id, slug, nome, ordem)
SELECT e.id, v.slug, v.nome, v.ordem
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('marketing',       'Marketing',        10),
    ('vendas',          'Vendas',           20),
    ('sucesso',         'Sucesso',          30),
    ('projetos',        'Projetos',         40),
    ('gestao_energia',  'Gestão Energia',   50),
    ('diretoria',       'Diretoria',        60),
    ('financeiro',      'Financeiro',       70),
    ('campo',           'Campo',            80),
    ('automacoes',      'Automações',       90),
    ('limpeza',         'Limpeza',         100),
    ('tecnologia',      'Tecnologia',      110),
    ('juridico',        'Jurídico',        120),
    ('emprestimo',      'Empréstimo',      130),
    ('dividendo',       'Dividendo',       140)
  ) AS v(slug, nome, ordem)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

DO $$
DECLARE
  n integer;
  t integer;
BEGIN
  IF to_regclass('fin_area_empresa') IS NULL THEN
    RAISE EXCEPTION 'fin_area_empresa não foi criada';
  END IF;
  IF to_regclass('fin_pessoa_area_empresa') IS NULL THEN
    RAISE EXCEPTION 'fin_pessoa_area_empresa não foi criada';
  END IF;

  SELECT count(*) INTO n
    FROM fin_area_empresa a
    JOIN fin_entity e ON e.id = a.entity_id
   WHERE e.slug = 'xpe' AND a.slug IN (
     'marketing', 'vendas', 'sucesso', 'projetos', 'gestao_energia',
     'diretoria', 'financeiro', 'campo', 'automacoes', 'limpeza',
     'tecnologia', 'juridico', 'emprestimo', 'dividendo'
   );
  IF n <> 14 THEN
    RAISE EXCEPTION 'catálogo de áreas da empresa deveria ter 14 linhas, tem %', n;
  END IF;

  -- Ninguém atribuído: o dono liga um a um. Uma seed aqui seria chute.
  SELECT count(*) INTO t FROM fin_pessoa_area_empresa;
  IF t <> 0 THEN
    RAISE EXCEPTION 'ligação pessoa↔área nasceu preenchida (% linha(s)) — a 0180 não atribui ninguém', t;
  END IF;

  -- A coluna de time não foi tocada: consultoria/obras continuam onde estavam.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'fin_person' AND column_name = 'area'
  ) THEN
    RAISE EXCEPTION 'fin_person.area sumiu — a 0180 não deveria tê-la tocado';
  END IF;
END $$;
