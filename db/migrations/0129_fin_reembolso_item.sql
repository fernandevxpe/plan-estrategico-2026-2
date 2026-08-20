-- Reembolso parcelado ganha lugar próprio, e o vocabulário de remuneração
-- passa a cobrir a planilha inteira.
--
-- POR QUE REEMBOLSO NÃO CABE EM fin_person_compensation
-- -----------------------------------------------------
-- Aquela tabela tem UNIQUE(person_id, reference_month, component, kind): UMA
-- linha por componente por mês. Serve para "fixo", "comissão de obras",
-- "deduções" — coisas de que existe uma por mês por pessoa.
--
-- Reembolso não é assim. Em maio/2026 o Fernando tem seis itens ao mesmo
-- tempo: notebook 13/24, TV 1/24, notebook estagiário 3/12, gela-água 1/18,
-- ar-condicionado 8/12, monitores 8/12. Todos são "reembolso", todos do mesmo
-- mês, todos da mesma pessoa. Forçá-los num componente só perderia
-- exatamente o que interessa — e o que interessa é a PARCELA, porque é ela
-- que diz quanto ainda falta pagar.
--
-- O QUE A PARCELA PERMITE SABER
-- -----------------------------
-- A planilha de reembolsos escreve a parcela na descrição ("Ar Cond 6/12",
-- "Notebooks part 2 - 11/24"). Guardando parcela e total, o saldo é
-- aritmética: (parcelas_total - parcela) * valor_parcela_cents. Medido sobre
-- jan–jul/2026 dá R$ 19.625,14 ainda a reembolsar, sendo R$ 12.119,51 só do
-- Fernando.
--
-- DUAS ARMADILHAS QUE A MODELAGEM PRECISA SOBREVIVER, PORQUE JÁ APARECERAM
-- -----------------------------------------------------------------------
--  1. PARCELA DOBRADA. O Decézaris pagou a parcela 2 em dobro ("Notebook parc
--     2/21 2x*", R$314,40 = 2 × R$157,20) e voltou ao ritmo normal em junho
--     (3/21, R$157,20). Ler as duas linhas como dívidas diferentes dobrava o
--     saldo dele — de R$4.069,76 para R$13.536,76. Por isso o valor guardado
--     aqui é o da PARCELA SIMPLES, e uma quitação dupla avança `parcela` em
--     dois, não cria item novo.
--
--  2. ITEM RENOMEADO NO MEIO. O "Compra do Pc Biel" do Igor virou "Compra do
--     Pc" entre março e abril, e terminou em 6/6. Tratados como dois itens,
--     ele apareceria devendo R$758,00 quando não deve nada. `slug` existe
--     para isso: é a identidade estável do débito, independente de como a
--     planilha escreveu o nome naquele mês.
--
-- ESTA MIGRATION NÃO CARREGA DADO. Cria a estrutura e o vocabulário; a carga
-- vem por script, com dry-run, como todo o resto da casa.

-- ---------------------------------------------------------------------------
-- 1. Vocabulário que faltava em fin_compensation_component
-- ---------------------------------------------------------------------------
-- A planilha de comissionamento usa rubricas que a tabela ainda não conhecia.
-- Sem elas a carga teria de empilhar tudo em "fixo" e perder a natureza — que
-- é justamente o nível de detalhe que se quer preservar.
--
-- 17 = 4.01 Comissão paga a vendedor · 18 = 4.02 Material específico de obra
-- 34 = 5.03 Softwares · 35 = 5.04 Contabilidade e jurídico
-- Espelham a escolha já feita pelos componentes que existiam antes.
INSERT INTO fin_compensation_component (slug, name, kind, category_id, sort_order, is_active) VALUES
  ('comissoes_anteriores', 'Comissões de anos anteriores', 'variavel', 17, 15, true),
  ('comissao_pos_venda',   'Comissão de Pós-Venda',        'variavel', 17, 16, true),
  ('venda_lotes',          'Venda de Lotes',               'variavel', 17, 17, true),
  ('gestao_usina',         'Gestão de Usina',              'variavel', 17, 18, true),
  ('gestao',               'Gestão',                       'fixo',     35,  6, true),
  ('gestao_financeira',    'Gestão Financeira',            'fixo',     35,  7, true),
  ('relatorios',           'Relatórios',                   'variavel', 18, 27, true),
  ('instalacoes',          'Instalações',                  'variavel', 18, 28, true),
  ('consultoria_pd',       'Consultoria / P&D',            'fixo',     34,  8, true),
  ('pd_plataforma',        'P&D Plataforma',               'fixo',     34,  9, true),
  ('reembolso',            'Reembolso',                    'variavel', 38, 80, true),
  ('repasse_terceiro',     'Repasse a terceiro',           'deducao',  35, 91, true)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON COLUMN fin_compensation_component.kind IS
  'Natureza do componente: fixo, variavel ou deducao. ''deducao'' é o que SAI do valor a '
  'receber — e ''repasse_terceiro'' (0129) é o caso em que esse valor não fica retido, vai '
  'para outra pessoa: parte do pagamento do Gabriel vai direto ao João porque o Gabriel deve '
  'a ele. Sem um componente para isso, o repasse aparece duas vezes na leitura — como '
  '"dedução que não foi aplicada" no pagador e como "pagamento acima do plano" no recebedor.';

-- ---------------------------------------------------------------------------
-- 2. fin_reembolso_item
-- ---------------------------------------------------------------------------
CREATE TABLE fin_reembolso_item (
  id                  bigserial PRIMARY KEY,
  entity_id           bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  person_id           bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,

  -- Identidade estável do débito. "Compra do Pc Biel" e "Compra do Pc" são o
  -- mesmo slug; o rótulo do mês fica em `descricao`.
  slug                text   NOT NULL CHECK (length(btrim(slug)) > 0),
  descricao           text   NOT NULL CHECK (length(btrim(descricao)) > 0),

  competencia         date   NOT NULL
    CHECK (competencia = date_trunc('month', competencia)::date),

  valor_parcela_cents bigint NOT NULL CHECK (valor_parcela_cents > 0),
  parcela             int    NOT NULL CHECK (parcela >= 1),
  parcelas_total      int    NOT NULL CHECK (parcelas_total >= 1),
  CONSTRAINT fin_reembolso_item_parcela_ck CHECK (parcela <= parcelas_total),

  categoria_livre     text,           -- "Transporte", "Alimentação", "Curso"…
  fonte               text   NOT NULL,
  nota                text,

  -- Preenchido quando o pagamento é identificado no extrato. Vários itens
  -- podem apontar para a MESMA transação: é assim que "agrupado para facilitar
  -- o pagamento" convive com o detalhe.
  transaction_id      bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,

  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          text   NOT NULL,
  atualizado_em       timestamptz,
  atualizado_por      text,

  UNIQUE (person_id, slug, competencia)
);

CREATE INDEX fin_reembolso_item_pessoa_ix   ON fin_reembolso_item (person_id, competencia DESC);
CREATE INDEX fin_reembolso_item_transacao_ix ON fin_reembolso_item (transaction_id)
  WHERE transaction_id IS NOT NULL;

COMMENT ON TABLE fin_reembolso_item IS
  'Um item de reembolso por pessoa, por mês — com a parcela, que é o que permite saber o '
  'saldo a pagar. Não cabe em fin_person_compensation porque lá existe uma linha por '
  'componente por mês, e uma pessoa tem vários reembolsos simultâneos (0129).';
COMMENT ON COLUMN fin_reembolso_item.slug IS
  'Identidade estável do débito ao longo dos meses. A planilha renomeia ("Compra do Pc Biel" '
  '→ "Compra do Pc") e isso não pode virar dívida nova.';
COMMENT ON COLUMN fin_reembolso_item.valor_parcela_cents IS
  'Valor da parcela SIMPLES. Quando duas parcelas são quitadas de uma vez (o "2x*" do '
  'Decézaris), `parcela` avança dois — o valor guardado aqui não dobra.';

-- ---------------------------------------------------------------------------
-- 3. fin_reembolso_saldo_v — o saldo, que é aritmética da última parcela vista
-- ---------------------------------------------------------------------------
CREATE VIEW fin_reembolso_saldo_v AS
WITH ultima AS (
  SELECT DISTINCT ON (person_id, slug)
         person_id, slug, descricao, competencia, valor_parcela_cents,
         parcela, parcelas_total, categoria_livre
    FROM fin_reembolso_item
   ORDER BY person_id, slug, competencia DESC, parcela DESC
)
SELECT u.person_id,
       p.name                                          AS pessoa,
       u.slug,
       u.descricao,
       u.categoria_livre,
       u.competencia                                   AS ultima_competencia,
       u.parcela,
       u.parcelas_total,
       u.valor_parcela_cents,
       (u.parcelas_total - u.parcela)                  AS parcelas_restantes,
       (u.parcelas_total - u.parcela) * u.valor_parcela_cents AS saldo_cents,
       (u.parcela >= u.parcelas_total)                 AS quitado
  FROM ultima u
  JOIN fin_person p ON p.id = u.person_id;

COMMENT ON VIEW fin_reembolso_saldo_v IS
  'Saldo a reembolsar por item, pela parcela mais avançada já registrada. É o que responde '
  '"quanto ainda falta pagar a cada pessoa" sem depender de ninguém somar à mão.';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_falta text;
BEGIN
  SELECT count(*) INTO v_n FROM fin_compensation_component WHERE is_active;
  IF v_n < 30 THEN
    RAISE EXCEPTION 'vocabulário de componentes ficou com % ativos, esperado >= 30', v_n;
  END IF;

  -- Todo componente usado pela planilha de comissionamento tem de existir.
  SELECT string_agg(s, ', ') INTO v_falta
    FROM unnest(ARRAY['fixo','comissao_consultoria','comissao_obras','comissoes_anteriores',
                      'gestao_usina','relatorios','diaria_especialista','diaria_ajudante',
                      'inspecoes_levantamentos','deducoes','repasse_terceiro','reembolso']) s
   WHERE NOT EXISTS (SELECT 1 FROM fin_compensation_component c WHERE c.slug = s AND c.is_active);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'componente(s) faltando no vocabulário: %', v_falta;
  END IF;

  -- A view tem de existir e responder sem erro mesmo com a tabela vazia.
  PERFORM count(*) FROM fin_reembolso_saldo_v;
END $$;
