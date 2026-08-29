-- Comissão ganha TIPO, CLIENTE e entrada+parcelas.
--
-- O QUE FALTAVA
-- -------------
-- `fin_pessoa_comissao_declarada` (0165/0167) sabia quanto e para quem, e
-- nada mais. Não sabia de que NATUREZA era a comissão nem SOBRE O QUE ela
-- incidia — e sem isso o total é um número só, impossível de ler como gestão:
-- não dá para responder "quanto de comissão de obras eu devo" nem "quanto o
-- cliente X ainda vai gerar".
--
-- POR QUE UM CATÁLOGO NOVO, E NÃO UM ENUM
-- ---------------------------------------
-- `fin_compensation_component` já é O vocabulário de remuneração da casa: a
-- DRE e a planilha de comissionamento leem dele, e ele já tem
-- `comissao_consultoria`, `comissao_obras`, `venda_lotes` e `gestao_usina`.
-- Um enum novo com os mesmos nomes forkaria esse vocabulário — o defeito que
-- o AGENTS.md registra para reembolso ("a MESMA planilha em DUAS tabelas").
--
-- Mas os 19 componentes variáveis também não servem de lista de seleção: a
-- pessoa que lança comissão não escolhe entre "Repasse p/ recarga dos chips" e
-- "Fabricação de medidores". `fin_comissao_tipo` é a CURADORIA — seis opções,
-- cada uma apontando por FK para o componente que já existe. O vocabulário
-- continua único; só a lista da tela é curta.
--
-- DUAS DECISÕES QUE FICAM REGISTRADAS AQUI
-- ----------------------------------------
--  1. DIÁRIAS. O vocabulário separa `diaria_especialista` de `diaria_ajudante`,
--     com valores diferentes, e a planilha de comissionamento usa os dois. O
--     dono pediu UM tipo no cadastro ("Diárias Serviço"), então nasce o
--     componente `diaria_servico` como o agregado. Os dois antigos continuam
--     vivos e intocados: quem lança pelo cadastro usa o agregado, quem lê a
--     planilha continua vendo a separação. Se um dia a distinção fizer falta no
--     cadastro, são dois INSERTs em fin_comissao_tipo, sem migração de dado.
--
--  2. GESTÃO. O único "gestão" variável no vocabulário é `gestao_usina` — o
--     `gestao` puro é FIXO, e comissão não é fixo. O tipo "Gestão" aponta para
--     `gestao_usina`. Se aparecer comissão de gestão que não seja de usina, é
--     aqui que ela entra, e o comentário existe para que a próxima pessoa saiba
--     que a escolha foi deliberada.
--
-- ENTRADA + PARCELAS
-- ------------------
-- A série de 0167 só sabia dividir em N iguais. "Entrada de R$ 2.000 e mais 3×"
-- não cabia. `entrada_cents` na série resolve, e o ITEM não precisa de coluna
-- nova: cada linha já carrega o próprio `valor_cents`, então a entrada é a
-- parcela 1 com valor diferente. Quem quiser saber se uma parcela é entrada lê
-- `serie.entrada_cents > 0 AND parcela = 1` — nenhum dado duplicado.
--
-- Nada é retroativo: as 13 linhas existentes ficam com tipo NULL, que a tela
-- mostra como "sem tipo". Carimbar "Outros" nelas seria inventar natureza.

-- ---------------------------------------------------------------------------
-- 1. Os dois componentes que faltavam no vocabulário
-- ---------------------------------------------------------------------------
-- 17 = 4.01 Comissão paga a vendedor · 18 = 4.02 Material específico de obra
-- (a mesma categoria das diárias que já existem).
INSERT INTO fin_compensation_component (slug, name, kind, category_id, sort_order, is_active) VALUES
  ('diaria_servico',   'Diária de Serviço',   'variavel', 18, 29, true),
  ('comissao_outros',  'Comissão — Outros',   'variavel', 17, 19, true)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. O catálogo curado
-- ---------------------------------------------------------------------------
CREATE TABLE fin_comissao_tipo (
  slug            text PRIMARY KEY CHECK (length(btrim(slug)) > 0),
  nome            text NOT NULL CHECK (length(btrim(nome)) > 0),
  -- A ponte para o vocabulário único. Sem ela o tipo seria um rótulo solto e a
  -- DRE não saberia em que categoria a comissão cai.
  component_slug  text NOT NULL REFERENCES fin_compensation_component(slug),
  ordem           int  NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fin_comissao_tipo IS
  'Curadoria dos tipos de comissão oferecidos no cadastro. NÃO é um vocabulário paralelo: cada '
  'linha aponta por FK para fin_compensation_component, que continua sendo a única fonte de '
  'natureza de remuneração da casa (0178).';
COMMENT ON COLUMN fin_comissao_tipo.component_slug IS
  'Componente de remuneração correspondente — é por ele que a comissão encontra a categoria da DRE.';

INSERT INTO fin_comissao_tipo (slug, nome, component_slug, ordem) VALUES
  ('vendas_consultoria', 'Vendas de Consultoria', 'comissao_consultoria', 1),
  ('vendas_obras',       'Vendas de Obras',       'comissao_obras',       2),
  ('diarias_servico',    'Diárias Serviço',       'diaria_servico',       3),
  ('vendas_lotes',       'Vendas Lotes',          'venda_lotes',          4),
  ('gestao',             'Gestão',                'gestao_usina',         5),
  ('outros',             'Outros',                'comissao_outros',      6);

-- ---------------------------------------------------------------------------
-- 3. Tipo e cliente no item e na série
-- ---------------------------------------------------------------------------
ALTER TABLE fin_pessoa_comissao_declarada
  ADD COLUMN tipo_slug text REFERENCES fin_comissao_tipo(slug),
  ADD COLUMN cliente   text;

ALTER TABLE fin_pessoa_comissao_serie
  ADD COLUMN tipo_slug     text REFERENCES fin_comissao_tipo(slug),
  ADD COLUMN cliente       text,
  ADD COLUMN entrada_cents bigint NOT NULL DEFAULT 0 CHECK (entrada_cents >= 0);

COMMENT ON COLUMN fin_pessoa_comissao_declarada.tipo_slug IS
  'Natureza da comissão (fin_comissao_tipo). NULL nas linhas anteriores à 0178 — carimbar uma '
  'natureza nelas seria inventar o que ninguém declarou.';
COMMENT ON COLUMN fin_pessoa_comissao_declarada.cliente IS
  'Cliente/obra a que a comissão se refere. Texto livre: o cadastro de clientes vive no ERP, que '
  'é somente leitura daqui.';
COMMENT ON COLUMN fin_pessoa_comissao_serie.entrada_cents IS
  'Valor da ENTRADA, quando a forma de pagamento é entrada + parcelas. Zero significa parcelas '
  'iguais. A entrada é a parcela 1 da série — o item não ganha coluna porque já tem valor_cents '
  'próprio (0178).';

CREATE INDEX fin_pessoa_comissao_declarada_tipo_ix ON fin_pessoa_comissao_declarada (tipo_slug)
  WHERE tipo_slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_tipos int; v_orfaos int;
BEGIN
  SELECT count(*) INTO v_tipos FROM fin_comissao_tipo WHERE ativo;
  IF v_tipos <> 6 THEN
    RAISE EXCEPTION 'esperados 6 tipos de comissão ativos, encontrados %', v_tipos;
  END IF;

  -- Todo tipo tem de alcançar um componente ATIVO: um tipo apontando para
  -- componente desativado é uma opção de tela que a DRE não sabe classificar.
  SELECT count(*) INTO v_orfaos
    FROM fin_comissao_tipo t
    JOIN fin_compensation_component c ON c.slug = t.component_slug
   WHERE NOT c.is_active;
  IF v_orfaos > 0 THEN
    RAISE EXCEPTION '% tipo(s) de comissão apontam para componente inativo', v_orfaos;
  END IF;

  PERFORM count(*) FROM fin_pessoa_comissao_declarada WHERE tipo_slug IS NOT NULL;
  PERFORM count(*) FROM fin_pessoa_comissao_serie WHERE entrada_cents > 0;
END $$;
