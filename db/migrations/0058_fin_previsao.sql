-- Orçamento e caixa previsto por dia. As duas peças do "bater com o previsto".
--
-- Medido em 15–16/08/2026, e cada número abaixo é reproduzível por consulta:
--
--     124 metas no erp-obras (111 mensais, 12 trimestrais, 1 anual), R$ 634.500,00
--      12 delas com destino EXATO numa linha do modelo de gestão
--      63 aproximadas · 39 indeterminadas · 10 recusadas (ver seção 3)
--      91 linhas de modelo, 53 mapeamentos categoria↔linha, 149 valores de referência
--     471 parcelas contratuais · 80 cobranças abertas vencendo em ago/2026
--      12 faturas de cartão, mediana R$ 8.796,82 nas 6 últimas
--       6 contas, âncora de saldo R$ 119.674,46
--
-- ===========================================================================
-- 1. O PRINCÍPIO QUE ORGANIZA O ARQUIVO INTEIRO
-- ===========================================================================
-- Previsão é estimativa por natureza, e o princípio do projeto proíbe
-- estimativa passar por fato. Aqui isso não é uma promessa no comentário: é a
-- forma das colunas.
--
--   · Nada nesta migration escreve em `fin_transaction`. Nem uma linha.
--   · Toda linha projetada carrega `procedencia='projetado'` e uma `camada`.
--     Uma consulta não consegue somar previsto com realizado sem ter as duas
--     palavras no SELECT — e aí a escolha é de quem escreveu, não um descuido.
--   · `entra_no_saldo` diz, por linha, se aquela previsão é boa o bastante para
--     mover o saldo. Vencido não move. Recorrente 'proposta' não move.
--   · A âncora do saldo publica `ancora_ate`, a data até onde os extratos
--     realmente cobrem. "Fecha" ≠ "está em dia": um saldo aritmeticamente
--     correto sobre extrato de três dias atrás mente sobre hoje, e a coluna
--     obriga a olhar isso antes de acreditar no dia do aperto.
--
-- ===========================================================================
-- 2. NÃO SOMAR CAMADAS — onde a receita dobraria, e como não dobra
-- ===========================================================================
-- A 0045 já documentou as quatro camadas do mesmo dinheiro (previsão contratual
-- → cobrança → nota → caixa). A previsão diária é o lugar onde elas se
-- encontram, então é aqui que a regra precisa virar código.
--
--   a) cobrança × previsão contratual. Resolvido por `fin_receber_aberto_v`
--      (0045), que só deixa a parcela entrar quando NÃO tem cobrança emitida.
--      Esta migration consome aquela view em vez de reescrever a exclusão —
--      duas implementações da mesma regra divergem no primeiro ajuste.
--
--   b) assinatura × cobrança. Medido: 27 dos 28 contratos mensais ativos de
--      `fin_contract` têm cobrança futura aberta para a mesma contraparte. Se a
--      assinatura entrasse por mês do horizonte, como faz `forecast.ts` hoje
--      (l1 = documentos, l2 = contratos, somados), o mesmo boleto contaria
--      duas vezes. A regra aqui é conservadora e verificável: a assinatura só
--      projeta enquanto a contraparte não tiver NENHUMA cobrança aberta. Sobra
--      1 contrato (PIAU, R$ 15.000,00/mês) — e sobra de propósito.
--      *Isto diverge de `lib/financeiro/forecast.ts` e a divergência é
--      deliberada; a tela precisa ser corrigida para consumir esta view.*
--
--   c) fatura de cartão × extrato. "Fatura de cartão não é caixa — só o
--      pagamento que sai da conta corrente é" (0018, 0047). Esta migration
--      projeta UM evento por fatura: o pagamento, na data de vencimento, saindo
--      da `settlement_account_id` do cartão. As compras de
--      `fin_card_transaction` não geram evento nenhum.
--
--   d) recorrente × fatura. O "Pagamento de fatura" é categoria 9.01 e está
--      fora do universo de detecção da 0057. Se um dia entrar, a fatura contaria
--      duas vezes — por isso a 0057 exclui 9.01 na detecção e aqui a camada de
--      cartão é a única fonte de fatura.
--
--   e) recorrente × folha declarada. `fin_person_compensation` não é consumida
--      aqui. A folha entra exclusivamente pelas recorrentes de categoria 6.x,
--      que têm data. A tabela de composição responde outra pergunta (quanto
--      custa cada pessoa), e somar as duas dobraria R$ 72.943,25/mês.
--
-- ===========================================================================
-- 3. ORÇAMENTO: POR QUE PENDURADO NO MODELO DE GESTÃO, E NÃO AO LADO DELE
-- ===========================================================================
-- Existe a tentação de criar `fin_budget_target(category_code, mes, valor)` e
-- pronto. Ela produz um segundo conceito de meta concorrendo com o modelo de
-- gestão da 0034 — e aí "quanto era a meta de pessoal" tem duas respostas.
--
-- A 0034 já decidiu que a linguagem da decisão é `fin_model_line`, não o plano
-- de contas: "Equipe Obras" não é uma categoria contábil, é a interseção de
-- três categorias com um núcleo. Uma meta por categoria contábil não conseguiria
-- sequer expressar a meta que o dono tem na cabeça.
--
-- Então a meta é a QUARTA COLUNA da mesma célula (linha × período), ao lado das
-- três que a 0034 criou:
--
--     realizado   somado do ledger pelo mapa      — o que os extratos provam
--     referencia  a planilha do dono, congelada   — o que foi projetado
--     manual      o que o dono digitou            — o que ele sabe e o extrato não
--     meta        o teto/alvo declarado           — o que ele quer que aconteça  ← aqui
--
-- Elas não se somam. `fin_orcado_realizado_v` põe as quatro lado a lado e a
-- diferença fica visível, exatamente como a 0034 fez com as três primeiras.
--
-- Por isso `valor_cents` segue o MESMO sinal da 0034 — impacto no resultado,
-- receita positiva, custo negativo. Uma meta de custo é negativa. Guardar
-- "8.200 de teto de ferramentas" como positivo enquanto o realizado da mesma
-- célula é negativo obrigaria cada leitor a lembrar do sinal, e um deles vai
-- esquecer.
--
-- ── O QUE NÃO FOI POSSÍVEL DECIDIR, E POR QUÊ ─────────────────────────────
-- As 124 metas do ERP são por categoria DO ERP (19 categorias próprias,
-- `CategoriaOrcamentoConfig`), não por linha do modelo. O mapeamento entre as
-- duas listas não é óbvio, e o princípio manda não escolher sem evidência:
--
--   exato (12 metas)
--     Ferramentas e equipamentos → `ferramentas` (8.01). Mesma coisa, sem
--     ambiguidade.
--
--   aproximado (63 metas) — destino provável, sem prova
--     Materiais para serviço (10) → `materiais-obras` (4.02)
--     Transporte e deslocamento (12) → `deslocamento-obra` (4.04), mas parte
--       disso no modelo cai em `alimentacao-transporte`
--     Alimentação (12) → `alimentacao-obras` (6.04/6.05 núcleo obras)
--     Terceirização de serviços (10) → `material-projetos`, cuja categoria
--       mapeada é 4.03 "Terceirização e subcontratação" mas cujo NOME é "Custo
--       de Material para Projetos/Execução" — o próprio modelo está ambíguo aqui
--     Impostos e taxas (10) → `impostos` (subtotal 7.x), mas "taxas" pode ser 5.10
--     Marketing e vendas (3) → `trafego-social` (5.05), com `midia` e `eventos`
--       ainda sem mapa
--     Salários (5 mensais + 1 anual) → `equipe-obras`, por ser meta do erp-obras
--
--   indeterminado (39 metas) — duas leituras possíveis, nenhuma escolhida
--     Comissões (10) → `cac-vendas` (4.01) ou `comissoes-parceiros` (sem mapa)
--     Reembolsos (10) → colide com Alimentação sobre a mesma 6.05
--     Outros custos operacionais (10) → sem destino. É a maior linha do ERP
--       (R$ 289.139,28 realizados em 2026) e a que menos se sabe o que é
--     Despesas administrativas (3) → `admin-time` (6.07) ou `escritorio`
--     Logística e frete (3) → categoria 5.11 existe e NÃO tem linha no modelo
--     Manutenção de equipamentos (3) → `escritorio-infra` é infra de escritório,
--       não manutenção de equipamento de obra
--
--   recusado (10 metas)
--     Pagamento de Fatura, R$ 100.000,00/ano. Fatura de cartão não é custo: o
--     custo já está nas compras que a compõem. Aceitar esta meta como linha de
--     despesa contaria o gasto do cartão duas vezes dentro do próprio orçamento.
--     Fica gravada, com o motivo, e nenhuma view a soma.
--
-- ── A SEGUNDA PERGUNTA ABERTA: ESCOPO ─────────────────────────────────────
-- As metas do ERP são da operação de obras e são medidas contra o ledger DO
-- ERP (`LancamentoFinanceiro`), que é outro ledger. Compará-las com o realizado
-- da empresa inteira daria números plausíveis e errados. Por isso `escopo`:
-- 'obras' não é comparável com 'empresa', e a view só cruza escopos iguais.
-- Enquanto ninguém decidir como filtrar o realizado da empresa para o recorte
-- de obras (núcleo? centro de custo? os dois?), `escopo='obras'` sai com
-- `realizado_cents` NULO em vez de sair com um número bonito.
--
-- ── A TERCEIRA: Salários tem duas metas que podem ou não somar ────────────
-- Salários tem meta ANUAL de R$ 90.000,00 (mes=0) E metas MENSAIS de
-- R$ 66.000,00 para ago–dez. R$ 156.000,00 no ano, ou R$ 90.000,00 com detalhe
-- mensal só do segundo semestre? As duas leituras cabem no dado. Ambas entram
-- na tabela, com periodicidades diferentes, e a view NÃO as soma.

-- ===========================================================================
-- fin_budget_category_map — o dicionário, 19 linhas em vez de 124
-- ===========================================================================
-- O mapeamento é conhecimento sobre categorias, não sobre metas. Guardá-lo por
-- meta obrigaria a corrigir 10 linhas quando o Fernando decidir o destino de
-- "Comissões"; aqui é uma linha, e o espelho reaplica.
CREATE TABLE fin_budget_category_map (
  id           bigserial PRIMARY KEY,
  entity_id    bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  source       text   NOT NULL CHECK (source IN ('erp_obras')),
  source_categoria text NOT NULL,
  line_slug    text,
  mapeamento   text   NOT NULL
                 CHECK (mapeamento IN ('exato','aproximado','indeterminado','recusado')),
  motivo       text   NOT NULL,
  decidido_por text,
  decidido_em  timestamptz,
  UNIQUE (entity_id, source, source_categoria),
  -- Sem destino só é aceitável quando ninguém afirmou ter um.
  CONSTRAINT fin_budget_map_destino_coerente
    CHECK ((line_slug IS NOT NULL) = (mapeamento IN ('exato','aproximado'))),
  FOREIGN KEY (entity_id, line_slug)
    REFERENCES fin_model_line (entity_id, slug) ON UPDATE CASCADE
);

-- ===========================================================================
-- fin_budget_target — a meta
-- ===========================================================================
CREATE TABLE fin_budget_target (
  id           bigserial PRIMARY KEY,
  entity_id    bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,

  -- 'empresa' = comparável com o realizado do ledger. 'obras' = meta do
  -- erp-obras, medida contra outro ledger; ver seção 3.
  escopo       text   NOT NULL DEFAULT 'empresa' CHECK (escopo IN ('empresa','obras')),

  -- O destino no modelo de gestão. Nulo quando ninguém decidiu — e aí a meta
  -- existe, é auditável, e não entra em comparação nenhuma.
  line_slug    text,
  mapeamento   text   NOT NULL DEFAULT 'indeterminado'
                 CHECK (mapeamento IN ('exato','aproximado','indeterminado','recusado')),
  mapeamento_motivo text,

  periodicidade text  NOT NULL CHECK (periodicidade IN ('mensal','trimestral','anual')),
  ano          int    NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  -- 1..12 no mensal, 1..4 no trimestral, 0 no anual. Um campo só, com o
  -- significado amarrado à periodicidade pelos CHECKs abaixo — em vez de três
  -- colunas onde duas estão sempre nulas.
  periodo      int    NOT NULL,

  -- Sinal do impacto no resultado, igual a fin_model_value: custo negativo.
  valor_cents  bigint NOT NULL,

  origem       text   NOT NULL CHECK (origem IN ('erp_obras','modelo_referencia','manual')),
  source_categoria text,
  source_id    text,

  motivo       text,
  updated_by   text   NOT NULL DEFAULT 'sistema',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_budget_periodo_mensal
    CHECK (periodicidade <> 'mensal' OR periodo BETWEEN 1 AND 12),
  CONSTRAINT fin_budget_periodo_trimestral
    CHECK (periodicidade <> 'trimestral' OR periodo BETWEEN 1 AND 4),
  CONSTRAINT fin_budget_periodo_anual
    CHECK (periodicidade <> 'anual' OR periodo = 0),
  CONSTRAINT fin_budget_destino_coerente
    CHECK ((line_slug IS NOT NULL) = (mapeamento IN ('exato','aproximado'))),
  -- Espelhar de novo atualiza a mesma linha em vez de criar a segunda.
  UNIQUE (entity_id, origem, source_id),
  FOREIGN KEY (entity_id, line_slug)
    REFERENCES fin_model_line (entity_id, slug) ON UPDATE CASCADE
);

-- Duas metas exatas para a mesma célula é ambiguidade, não riqueza.
CREATE UNIQUE INDEX fin_budget_target_celula_ix
  ON fin_budget_target (entity_id, escopo, line_slug, periodicidade, ano, periodo)
  WHERE mapeamento = 'exato';

CREATE INDEX fin_budget_target_periodo_ix ON fin_budget_target (entity_id, ano, periodicidade);

CREATE TRIGGER fin_budget_target_touch BEFORE UPDATE ON fin_budget_target
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Os 19 destinos, com o motivo de cada um. Quem discordar edita UMA linha.
INSERT INTO fin_budget_category_map (entity_id, source, source_categoria, line_slug, mapeamento, motivo)
SELECT e.id, 'erp_obras', v.cat, v.slug, v.map, v.motivo
  FROM fin_entity e,
       (VALUES
         ('Ferramentas e equipamentos', 'ferramentas',            'exato',
          'Categoria 8.01 "Equipamentos e ferramentas" é a mesma coisa, sem sobreposição com outra linha.'),
         ('Materiais para serviço',     'materiais-obras',        'aproximado',
          'Provável 4.02 "Material específico de obra". Realizado no ERP (R$ 174.151,51 em 2026) é 2,4x o da linha no ledger (R$ 71.748,36) — os recortes não são o mesmo.'),
         ('Transporte e deslocamento',  'deslocamento-obra',      'aproximado',
          'Parte é 4.04 (deslocamento atribuível a serviço) e parte é transporte de equipe, que no modelo cai em alimentacao-transporte.'),
         ('Alimentação',                'alimentacao-obras',      'aproximado',
          'Alimentação da equipe de obras é 6.04/6.05 com núcleo obras. Colide com a categoria Reembolsos do próprio ERP sobre a mesma 6.05.'),
         ('Terceirização de serviços',  'material-projetos',      'aproximado',
          'A linha mapeia 4.03 "Terceirização e subcontratação", que é o destino certo, mas se chama "Custo de Material para Projetos/Execução" — o modelo está ambíguo neste ponto.'),
         ('Impostos e taxas',           'impostos',               'aproximado',
          'Subtotal 7.x cobre DAS/ISS/retenções. "Taxas" pode ser 5.10 (conselhos), que fica em outra linha.'),
         ('Marketing e vendas',         'trafego-social',         'aproximado',
          'Cobre 5.05, mas as linhas midia e eventos ainda não têm mapa e receberiam parte deste orçamento.'),
         ('Salários',                   'equipe-obras',           'aproximado',
          'Meta do erp-obras ⇒ núcleo obras. Realizado no ERP (R$ 45.800,00) contra a linha no ledger (R$ 105.333,62) mostra que os recortes diferem.'),
         ('Comissões',                  NULL,                     'indeterminado',
          'Duas leituras: 4.01 "Comissão paga a vendedor" (linha cac-vendas) ou comissoes-parceiros, que existe no modelo e não tem mapa. Sem evidência que separe.'),
         ('Reembolsos',                 NULL,                     'indeterminado',
          'Cairia em 6.05, a mesma categoria de Alimentação. Aceitar as duas contaria o reembolso de alimentação duas vezes.'),
         ('Outros custos operacionais', NULL,                     'indeterminado',
          'Maior linha realizada do ERP (R$ 289.139,28 em 2026) e sem definição de conteúdo. Rateá-la por suposição moveria o resultado da empresa.'),
         ('Despesas administrativas',   NULL,                     'indeterminado',
          'admin-time (6.07 treinamento) ou o subtotal escritorio. As duas cabem no nome.'),
         ('Logística e frete',          NULL,                     'indeterminado',
          'A categoria 5.11 "Frete e logística" existe no ledger e NÃO tem linha no modelo de gestão. Lacuna do modelo, não do orçamento.'),
         ('Manutenção de equipamentos', NULL,                     'indeterminado',
          'escritorio-infra é 5.08 "Manutenção e infraestrutura" do escritório. Manutenção de equipamento de obra é outra coisa e não tem linha.'),
         ('Pagamento de Fatura',        NULL,                     'recusado',
          'Fatura de cartão não é custo — o custo está nas compras que a compõem (0047). Virar linha de despesa contaria o gasto do cartão duas vezes.'),
         ('Contabilidade',              'juridico-contabil',      'exato',
          'Categoria 5.04 "Contabilidade e jurídico". Sem meta cadastrada hoje.'),
         ('Software e assinaturas',     'cloud-servico',          'exato',
          'Categoria 5.03 "Softwares e assinaturas". Sem meta cadastrada hoje.'),
         ('Serviços bancários',         'tarifas-bancarias',      'exato',
          'Categoria 4.05 "Tarifas bancárias e de cobrança". Sem meta cadastrada hoje.'),
         ('Infraestrutura / escritório','escritorio-infra',       'exato',
          'Linha agrega 5.01/5.02/5.08, que é exatamente infraestrutura de escritório. Sem meta cadastrada hoje.')
       ) AS v(cat, slug, map, motivo)
 WHERE e.slug = 'xpe';

-- ===========================================================================
-- fin_orcado_realizado_v — meta × referência × manual × realizado, lado a lado
-- ===========================================================================
-- Nenhuma das quatro colunas soma com outra. Grão = o período da própria meta,
-- para não dividir uma meta trimestral por três e inventar precisão mensal.
--
-- `realizado_cents` é NULO — e não zero — quando o escopo não é comparável.
-- Zero diria "gastou nada"; nulo diz "não sei medir isto aqui", que é a verdade.
CREATE VIEW fin_orcado_realizado_v AS
WITH periodo_meses AS (
  SELECT b.id AS target_id, b.entity_id, b.escopo, b.line_slug, b.periodicidade,
         b.ano, b.periodo, b.valor_cents, b.mapeamento, b.origem, b.source_categoria,
         gs.mes
    FROM fin_budget_target b
    CROSS JOIN LATERAL (
      SELECT generate_series(
               CASE b.periodicidade
                 WHEN 'mensal'     THEN make_date(b.ano, b.periodo, 1)
                 WHEN 'trimestral' THEN make_date(b.ano, (b.periodo - 1) * 3 + 1, 1)
                 ELSE make_date(b.ano, 1, 1)
               END,
               CASE b.periodicidade
                 WHEN 'mensal'     THEN make_date(b.ano, b.periodo, 1)
                 WHEN 'trimestral' THEN make_date(b.ano, (b.periodo - 1) * 3 + 3, 1)
                 ELSE make_date(b.ano, 12, 1)
               END,
               interval '1 month')::date AS mes
    ) gs
   WHERE b.mapeamento IN ('exato','aproximado')
),
realizado AS (
  SELECT m.line_id, t.entity_id, date_trunc('month', t.posted_on)::date AS mes,
         SUM(t.amount_cents) AS cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    JOIN fin_model_map m ON m.entity_id = t.entity_id AND m.category_code = c.code
     AND (m.nucleo IS NULL
          OR (NOT m.nucleo_excluir AND t.nucleo = m.nucleo)
          OR (m.nucleo_excluir AND t.nucleo IS DISTINCT FROM m.nucleo))
   WHERE t.transfer_status <> 'pareado' AND NOT t.is_split_parent
   GROUP BY 1, 2, 3
)
SELECT
  p.target_id,
  p.entity_id,
  p.escopo,
  p.line_slug,
  l.name    AS linha,
  l.section,
  p.periodicidade,
  p.ano,
  p.periodo,
  p.mapeamento,
  p.origem,
  p.source_categoria,
  MIN(p.mes) AS mes_de,
  MAX(p.mes) AS mes_ate,
  MIN(p.valor_cents) AS meta_cents,
  SUM(vr.valor_cents) FILTER (WHERE vr.procedencia = 'referencia') AS referencia_cents,
  SUM(vr.valor_cents) FILTER (WHERE vr.procedencia = 'manual')     AS manual_cents,
  CASE WHEN p.escopo = 'empresa' THEN SUM(r.cents) END             AS realizado_cents,
  CASE WHEN p.escopo <> 'empresa'
       THEN 'escopo obras: realizado mora no ledger do erp-obras, não neste'
  END AS realizado_indeterminado_motivo
FROM periodo_meses p
JOIN fin_model_line l ON l.entity_id = p.entity_id AND l.slug = p.line_slug
LEFT JOIN fin_model_value vr
       ON vr.entity_id = p.entity_id AND vr.line_slug = p.line_slug
      AND vr.ano = EXTRACT(YEAR FROM p.mes)::int
      AND vr.mes = EXTRACT(MONTH FROM p.mes)::int
LEFT JOIN realizado r
       ON r.entity_id = p.entity_id AND r.line_id = l.id AND r.mes = p.mes
GROUP BY p.target_id, p.entity_id, p.escopo, p.line_slug, l.name, l.section,
         p.periodicidade, p.ano, p.periodo, p.mapeamento, p.origem, p.source_categoria;

-- ===========================================================================
-- fin_projetado_realizado_v — o "projetado × realizado" que já funciona hoje
-- ===========================================================================
-- Não depende de decidir mapeamento nenhum: as duas pontas já falam a língua do
-- modelo. É esta a view que responde ao objetivo do Fernando enquanto as 124
-- metas esperam decisão.
CREATE VIEW fin_projetado_realizado_v AS
WITH realizado AS (
  SELECT m.line_id, t.entity_id, date_trunc('month', t.posted_on)::date AS mes,
         SUM(t.amount_cents) AS cents, COUNT(*) AS n
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    JOIN fin_model_map m ON m.entity_id = t.entity_id AND m.category_code = c.code
     AND (m.nucleo IS NULL
          OR (NOT m.nucleo_excluir AND t.nucleo = m.nucleo)
          OR (m.nucleo_excluir AND t.nucleo IS DISTINCT FROM m.nucleo))
   WHERE t.transfer_status <> 'pareado' AND NOT t.is_split_parent
   GROUP BY 1, 2, 3
),
celulas AS (
  SELECT entity_id, line_slug, ano, mes FROM fin_model_value
  UNION
  SELECT r.entity_id, l.slug, EXTRACT(YEAR FROM r.mes)::int, EXTRACT(MONTH FROM r.mes)::int
    FROM realizado r JOIN fin_model_line l ON l.id = r.line_id
)
SELECT
  c.entity_id,
  c.line_slug,
  l.name AS linha,
  l.section,
  l.kind,
  c.ano,
  c.mes,
  make_date(c.ano, c.mes, 1) AS competencia,
  (SELECT v.valor_cents FROM fin_model_value v
    WHERE v.entity_id = c.entity_id AND v.line_slug = c.line_slug
      AND v.ano = c.ano AND v.mes = c.mes AND v.procedencia = 'referencia') AS referencia_cents,
  (SELECT v.valor_cents FROM fin_model_value v
    WHERE v.entity_id = c.entity_id AND v.line_slug = c.line_slug
      AND v.ano = c.ano AND v.mes = c.mes AND v.procedencia = 'manual')     AS manual_cents,
  r.cents AS realizado_cents,
  r.n     AS realizado_lancamentos,
  (SELECT MIN(b.valor_cents) FROM fin_budget_target b
    WHERE b.entity_id = c.entity_id AND b.line_slug = c.line_slug
      AND b.escopo = 'empresa' AND b.mapeamento = 'exato'
      AND b.periodicidade = 'mensal' AND b.ano = c.ano AND b.periodo = c.mes) AS meta_cents
FROM celulas c
JOIN fin_model_line l ON l.entity_id = c.entity_id AND l.slug = c.line_slug
LEFT JOIN realizado r
       ON r.entity_id = c.entity_id AND r.line_id = l.id
      AND r.mes = make_date(c.ano, c.mes, 1);

-- ===========================================================================
-- fin_previsao_evento_v — um evento de caixa previsto por linha
-- ===========================================================================
-- Toda a previsão passa por aqui. Cada linha diz de que camada veio, o quanto
-- se confia nela e se ela move o saldo. A view diária lá embaixo não sabe de
-- onde nada vem — só soma o que esta autoriza.
--
-- Horizonte: 365 dias. Parcelas de cartão vão até abr/2027 e cobranças até
-- mai/2027; cortar antes esconderia compromisso já assumido. Quem quiser 90
-- dias filtra por `dias_a_frente`.
CREATE VIEW fin_previsao_evento_v AS
WITH hoje AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d
),
ent AS (SELECT id, slug FROM fin_entity WHERE slug = 'xpe'),

-- ── L1a. Cobrança emitida, ainda a vencer ────────────────────────────────
cobranca AS (
  SELECT
    'receber_cobranca'::text AS camada,
    'faturado'::text         AS confianca,
    true                     AS entra_no_saldo,
    v.vencimento             AS dia,
    'entrada'::text          AS sentido,
    v.aberto_cents           AS bruto_cents,
    1.000::numeric(4,3)      AS fator,
    v.aberto_cents           AS valor_cents,
    COALESCE(v.cliente, '(sem contraparte)') AS sobre_o_que,
    v.counterparty_id,
    NULL::bigint             AS category_id,
    NULL::bigint             AS account_id,
    'fin_document:' || v.document_id AS origem_ref
  FROM fin_receber_aberto_v v, hoje h
  WHERE v.camada = 'cobranca' AND v.vencimento >= h.d
),

-- ── L1b. Cobrança vencida. Existe, é visível, NÃO move o saldo ───────────
-- A curva de recuperação é a mesma de lib/financeiro/forecast.ts, para que a
-- tela e o banco não discordem sobre quanto vale um atraso. Ela entra como
-- informação: `entra_no_saldo = false`. Contar recebível velho como caixa é
-- erro para cima, o mais perigoso.
vencido AS (
  SELECT
    'receber_vencido'::text, 'atrasado'::text, false,
    h.d,
    'entrada'::text,
    v.aberto_cents,
    (CASE WHEN h.d - v.vencimento <= 30 THEN 0.90
          WHEN h.d - v.vencimento <= 60 THEN 0.70
          WHEN h.d - v.vencimento <= 90 THEN 0.50
          ELSE 0.20 END)::numeric(4,3),
    ROUND(v.aberto_cents * CASE WHEN h.d - v.vencimento <= 30 THEN 0.90
                                WHEN h.d - v.vencimento <= 60 THEN 0.70
                                WHEN h.d - v.vencimento <= 90 THEN 0.50
                                ELSE 0.20 END)::bigint,
    COALESCE(v.cliente, '(sem contraparte)'),
    v.counterparty_id, NULL::bigint, NULL::bigint,
    'fin_document:' || v.document_id
  FROM fin_receber_aberto_v v, hoje h
  WHERE v.camada = 'cobranca' AND v.vencimento < h.d
),

-- ── L1c. Parcela contratual sem cobrança emitida ─────────────────────────
parcela AS (
  SELECT
    'receber_previsao_contrato'::text, 'contratado'::text, true,
    v.vencimento, 'entrada'::text,
    v.aberto_cents, 1.000::numeric(4,3), v.aberto_cents,
    COALESCE(v.cliente, '(sem contraparte)'),
    v.counterparty_id, NULL::bigint, NULL::bigint,
    'erp_parcela:' || v.parcela_erp_id
  FROM fin_receber_aberto_v v, hoje h
  WHERE v.camada = 'previsao_contrato' AND v.vencimento >= h.d
),

-- ── L2. Assinatura mensal SEM nenhuma cobrança aberta ────────────────────
-- A exclusão é por contraparte e é deliberadamente conservadora: enquanto
-- houver qualquer boleto aberto, a assinatura cala. Ver seção 2(b).
assinatura AS (
  SELECT
    'receber_assinatura'::text, 'contratado'::text, true,
    (date_trunc('month', h.d) + (g.n || ' month')::interval)::date
      + (LEAST(k.day_of_month,
               EXTRACT(DAY FROM (date_trunc('month', h.d) + ((g.n + 1) || ' month')::interval - interval '1 day'))::int) - 1),
    'entrada'::text,
    k.amount_cents, 1.000::numeric(4,3), k.amount_cents,
    k.name, k.counterparty_id, k.category_id, k.account_id,
    'fin_contract:' || k.id
  FROM fin_contract k
  JOIN ent e ON e.id = k.entity_id
  CROSS JOIN hoje h
  CROSS JOIN generate_series(0, 11) AS g(n)
  WHERE k.status = 'ativo' AND k.recurrence = 'mensal' AND k.direction = 'receber'
    AND k.day_of_month IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM fin_receber_aberto_v v
       WHERE v.counterparty_id = k.counterparty_id
    )
),

-- ── L3. Recorrente de saída ──────────────────────────────────────────────
-- Só `status='ativo'`. Uma recorrente 'proposta' aparece com
-- entra_no_saldo=false para que a tela possa mostrar "o que entraria se você
-- confirmasse" sem que isso mova o caixa antes da confirmação.
--
-- O desconto do que já saiu no mês corrente usa a MESMA chave que a detecção
-- usou (contraparte × categoria × sentido). Sem ele, um aluguel pago no dia 2
-- seria projetado de novo no dia 2 e o mês contaria dois aluguéis.
recorrente AS (
  SELECT
    'pagar_recorrente'::text,
    r.confidence,
    (r.status = 'ativo'),
    (date_trunc('month', h.d) + (g.n || ' month')::interval)::date
      + (LEAST(r.day_of_month,
               EXTRACT(DAY FROM (date_trunc('month', h.d) + ((g.n + 1) || ' month')::interval - interval '1 day'))::int) - 1),
    'saida'::text,
    r.amount_cents, 1.000::numeric(4,3),
    CASE WHEN g.n = 0
         THEN GREATEST(0, r.amount_cents - COALESCE((
                SELECT SUM(-t.amount_cents) FROM fin_transaction t
                 WHERE t.entity_id = r.entity_id
                   AND t.counterparty_id IS NOT DISTINCT FROM r.counterparty_id
                   AND t.category_id IS NOT DISTINCT FROM r.category_id
                   AND t.amount_cents < 0
                   AND t.transfer_status = 'nao' AND NOT t.is_split_parent
                   AND t.posted_on >= date_trunc('month', h.d)::date
              ), 0))
         ELSE r.amount_cents END,
    r.label, r.counterparty_id, r.category_id, r.account_id,
    'fin_recurring:' || r.id
  FROM fin_recurring r
  CROSS JOIN hoje h
  CROSS JOIN generate_series(0, 11) AS g(n)
  WHERE r.direction = 'pagar'
    AND r.cadence = 'mensal'
    AND r.status IN ('ativo','proposto')
    AND r.conflito_camada IS NULL
    AND r.start_month <= (date_trunc('month', h.d) + (g.n || ' month')::interval)::date
    AND (r.end_month IS NULL
         OR r.end_month >= (date_trunc('month', h.d) + (g.n || ' month')::interval)::date)
),

-- ── L4. Cartão: o PAGAMENTO da fatura, e só ele ──────────────────────────
-- Três parcelas do mesmo evento, cada uma com a sua confiança:
--   parcela   compra já parcelada — compromisso assumido, não é estimativa
--   ciclo     compra já feita e ainda não faturada — fato, ainda sem fatura
--   estimado  o resto até a mediana histórica — estimativa declarada
--
-- A terceira existe porque omiti-la inflaria o saldo: o comprometido conhecido
-- de set/2026 é R$ 4.865,56 contra mediana de R$ 8.796,82 nas 6 últimas
-- faturas. Prever R$ 4.865,56 seria prometer R$ 3.931,26 de caixa que a fatura
-- vai levar. Erro para cima é o mais perigoso — então a estimativa entra, com
-- etiqueta.
cartao_base AS (
  SELECT ca.id AS card_account_id, ca.entity_id, ca.due_day, ca.settlement_account_id,
         (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b.total_amount_cents)
            FROM (SELECT total_amount_cents FROM fin_card_bill
                   WHERE card_account_id = ca.id AND total_amount_cents > 0
                   ORDER BY reference_month DESC LIMIT 6) b)::bigint AS mediana_cents
    FROM fin_card_account ca
   WHERE ca.is_active
),
cartao_mes AS (
  SELECT cb.card_account_id, cb.entity_id, cb.settlement_account_id, cb.mediana_cents,
         v.competence_month,
         make_date(EXTRACT(YEAR FROM v.competence_month)::int,
                   EXTRACT(MONTH FROM v.competence_month)::int,
                   LEAST(cb.due_day, EXTRACT(DAY FROM (v.competence_month + interval '1 month' - interval '1 day'))::int)) AS vencimento,
         SUM(v.amount_cents) FILTER (WHERE v.tipo = 'parcela')         AS parcela_cents,
         SUM(v.amount_cents) FILTER (WHERE v.tipo = 'compra_do_ciclo') AS ciclo_cents
    FROM fin_card_compromisso_mensal_v v
    JOIN cartao_base cb ON cb.card_account_id = v.card_account_id
   GROUP BY 1,2,3,4,5,6
),
cartao AS (
  -- `x.*` e não `*`: com `*` a coluna de `hoje` entraria na projeção e o
  -- UNION ALL lá embaixo passaria a ter 14 colunas contra 13 das outras
  -- camadas. Erra na criação da view, mas só porque as outras camadas existem
  -- para discordar — vale a explicitação.
  SELECT x.camada, x.confianca, x.entra, x.dia, x.sentido, x.bruto, x.fator,
         x.valor, x.sobre, x.cp, x.cat, x.conta, x.ref
  FROM (
    SELECT 'pagar_cartao_parcela'::text AS camada, 'contratado'::text AS confianca, true AS entra,
           cm.vencimento AS dia, 'saida'::text AS sentido,
           COALESCE(cm.parcela_cents,0)::bigint AS bruto, 1.000::numeric(4,3) AS fator,
           COALESCE(cm.parcela_cents,0)::bigint AS valor,
           'Cartão — parcelas de ' || to_char(cm.competence_month,'MM/YYYY') AS sobre,
           NULL::bigint AS cp, NULL::bigint AS cat, cm.settlement_account_id AS conta,
           'fin_card_bill:' || to_char(cm.competence_month,'YYYY-MM') || ':parcela' AS ref,
           cm.competence_month, cm.card_account_id
      FROM cartao_mes cm
    UNION ALL
    SELECT 'pagar_cartao_ciclo', 'observado', true,
           cm.vencimento, 'saida',
           COALESCE(cm.ciclo_cents,0)::bigint, 1.000, COALESCE(cm.ciclo_cents,0)::bigint,
           'Cartão — compras do ciclo ' || to_char(cm.competence_month,'MM/YYYY'),
           NULL, NULL, cm.settlement_account_id,
           'fin_card_bill:' || to_char(cm.competence_month,'YYYY-MM') || ':ciclo',
           cm.competence_month, cm.card_account_id
      FROM cartao_mes cm
    UNION ALL
    SELECT 'pagar_cartao_estimado', 'estimado', true,
           cm.vencimento, 'saida',
           GREATEST(0, cm.mediana_cents - COALESCE(cm.parcela_cents,0) - COALESCE(cm.ciclo_cents,0))::bigint, 1.000,
           GREATEST(0, cm.mediana_cents - COALESCE(cm.parcela_cents,0) - COALESCE(cm.ciclo_cents,0))::bigint,
           'Cartão — estimado até a mediana de ' || to_char(cm.competence_month,'MM/YYYY'),
           NULL, NULL, cm.settlement_account_id,
           'fin_card_bill:' || to_char(cm.competence_month,'YYYY-MM') || ':estimado',
           cm.competence_month, cm.card_account_id
      FROM cartao_mes cm
  ) x, hoje h
  WHERE x.valor > 0
    AND x.dia >= h.d
    -- Fatura já paga não se projeta de novo. O casamento é por
    -- `reference_month`, não por data: `due_date` da fatura real (10/08) e o
    -- vencimento calculado a partir de `due_day` (09) não coincidem, e casar
    -- por data deixaria a fatura de agosto — já paga em 04/08 — ser projetada
    -- de novo.
    AND NOT EXISTS (
      SELECT 1 FROM fin_card_bill b
       WHERE b.card_account_id = x.card_account_id
         AND b.reference_month = x.competence_month
         AND b.total_amount_cents > 0
         AND b.paid_amount_cents >= b.total_amount_cents
    )
),

-- ── L5. Documento a pagar. Hoje zero linhas; a camada existe ─────────────
pagar_doc AS (
  SELECT
    'pagar_documento'::text, 'faturado'::text, true,
    COALESCE(d.expected_cash_date, d.due_date), 'saida'::text,
    (d.amount_cents - d.settled_cents), 1.000::numeric(4,3),
    (d.amount_cents - d.settled_cents),
    d.description, d.counterparty_id, d.category_id, d.expected_account_id,
    'fin_document:' || d.id
  FROM fin_document d
  JOIN ent e ON e.id = d.entity_id
  CROSS JOIN hoje h
  WHERE d.direction = 'pagar'
    AND d.status IN ('previsto','emitido','parcial','confirmado')
    AND (d.amount_cents - d.settled_cents) > 0
    AND COALESCE(d.expected_cash_date, d.due_date) >= h.d
),

tudo AS (
  SELECT * FROM cobranca
  UNION ALL SELECT * FROM vencido
  UNION ALL SELECT * FROM parcela
  UNION ALL SELECT * FROM assinatura
  UNION ALL SELECT * FROM recorrente
  UNION ALL SELECT * FROM cartao
  UNION ALL SELECT * FROM pagar_doc
)
SELECT
  (SELECT id FROM ent)        AS entity_id,
  'projetado'::text           AS procedencia,   -- nunca 'realizado'. Ver seção 1.
  t.camada,
  t.confianca,
  t.entra_no_saldo,
  t.dia,
  (t.dia - h.d)               AS dias_a_frente,
  t.sentido,
  t.bruto_cents,
  t.fator,
  t.valor_cents,
  CASE WHEN t.sentido = 'entrada' THEN t.valor_cents ELSE -t.valor_cents END AS assinado_cents,
  t.sobre_o_que,
  t.counterparty_id,
  t.category_id,
  t.account_id,
  t.origem_ref
FROM tudo t, hoje h
WHERE t.valor_cents > 0
  AND t.dia BETWEEN h.d AND h.d + 365;

-- ===========================================================================
-- fin_caixa_previsto_dia_v — "em que dia o caixa aperta"
-- ===========================================================================
-- Um dia por linha, do dia de hoje aos 365 seguintes, sem buraco: um dia sem
-- evento precisa aparecer, senão o gráfico salta e o mínimo pode cair
-- justamente num dia que a view omitiu.
--
-- A âncora é o saldo das contas ativas que não são empréstimo — o mesmo recorte
-- de indicadores.ts, queries.ts e forecast.ts, e o mesmo que a 0047 protegeu ao
-- manter o cartão fora de `fin_account`. `ancora_ate` publica até onde os
-- extratos cobrem: com ela na tela, "fecha" e "está em dia" deixam de se
-- confundir.
CREATE VIEW fin_caixa_previsto_dia_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
ancora AS (
  SELECT e.id AS entity_id,
         SUM(a.current_balance_cents) AS saldo_cents,
         MIN(a.last_statement_at)::date AS ancora_ate
    FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
   WHERE e.slug = 'xpe' AND a.is_active AND a.kind <> 'emprestimo'
   GROUP BY 1
),
dias AS (
  SELECT gs::date AS dia FROM hoje h, generate_series(h.d, h.d + 365, interval '1 day') gs
),
mov AS (
  SELECT ev.dia,
         SUM(ev.valor_cents) FILTER (WHERE ev.sentido = 'entrada' AND ev.entra_no_saldo) AS entrada_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.sentido = 'saida'   AND ev.entra_no_saldo) AS saida_cents,
         SUM(ev.assinado_cents) FILTER (WHERE ev.entra_no_saldo)                          AS liquido_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.camada = 'receber_vencido')                 AS vencido_cents,
         SUM(ev.valor_cents) FILTER (WHERE NOT ev.entra_no_saldo AND ev.sentido = 'saida') AS saida_nao_somada_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.confianca = 'estimado' AND ev.entra_no_saldo) AS estimado_cents,
         COUNT(*) FILTER (WHERE ev.entra_no_saldo)                                        AS n_eventos
    FROM fin_previsao_evento_v ev
   GROUP BY 1
)
SELECT
  a.entity_id,
  'projetado'::text AS procedencia,
  d.dia,
  (d.dia - h.d) AS dias_a_frente,
  a.ancora_ate,
  a.saldo_cents AS ancora_saldo_cents,
  COALESCE(m.entrada_cents, 0) AS entrada_cents,
  COALESCE(m.saida_cents, 0)   AS saida_cents,
  COALESCE(m.liquido_cents, 0) AS liquido_cents,
  a.saldo_cents + COALESCE(SUM(COALESCE(m.liquido_cents, 0))
                            OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING), 0) AS saldo_previsto_cents,
  -- O mesmo saldo se o vencido voltasse na curva de recuperação. Coluna
  -- separada: quem quiser contar com atraso escolhe explicitamente.
  a.saldo_cents + COALESCE(SUM(COALESCE(m.liquido_cents, 0) + COALESCE(m.vencido_cents, 0))
                            OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING), 0) AS saldo_com_vencido_cents,
  COALESCE(m.estimado_cents, 0) AS estimado_no_dia_cents,
  COALESCE(m.saida_nao_somada_cents, 0) AS saida_proposta_nao_somada_cents,
  COALESCE(m.n_eventos, 0) AS n_eventos
FROM dias d
CROSS JOIN hoje h
CROSS JOIN ancora a
LEFT JOIN mov m ON m.dia = d.dia;

-- ===========================================================================
-- fin_cash_forecast — a foto datada da previsão
-- ===========================================================================
-- A view acima responde "o que eu acho hoje". Ela não consegue responder "o que
-- eu achava em 16/08, e quanto eu errei" — porque amanhã ela já mudou de ideia
-- sem deixar rastro.
--
-- É o mesmo raciocínio da 0034 sobre guardar `referencia` em vez de reimportar
-- a planilha: uma foto datada é comparável, um alvo móvel não é. Sem esta
-- tabela, a acurácia da própria previsão é inauditável — e uma previsão que
-- ninguém pode cobrar volta a ser palpite.
--
-- `saldo_realizado_cents` nasce nulo e é preenchido quando o dia chega. A
-- diferença entre as duas colunas é a única medida honesta de qualidade da
-- previsão. Nulo enquanto o dia não chegou: nulo é "ainda não sei".
CREATE TABLE fin_cash_forecast (
  id            bigserial PRIMARY KEY,
  entity_id     bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  gerado_em     date   NOT NULL,
  dia           date   NOT NULL,
  ancora_ate    date,
  ancora_saldo_cents bigint NOT NULL,
  entrada_cents bigint NOT NULL DEFAULT 0,
  saida_cents   bigint NOT NULL DEFAULT 0,
  saldo_previsto_cents bigint NOT NULL,
  -- Quanto do saldo daquele dia veio de cada camada. jsonb e não colunas: a
  -- lista de camadas vai crescer, e uma coluna nova por camada obrigaria a
  -- migrar a história inteira só para registrar a próxima.
  por_camada    jsonb  NOT NULL DEFAULT '{}'::jsonb,
  -- Preenchidos depois, quando o dia virar passado.
  saldo_realizado_cents bigint,
  aferido_em    timestamptz,
  detector_versao text,
  UNIQUE (entity_id, gerado_em, dia),
  CONSTRAINT fin_cash_forecast_dia_futuro CHECK (dia >= gerado_em)
);

CREATE INDEX fin_cash_forecast_dia_ix ON fin_cash_forecast (entity_id, dia);

COMMENT ON TABLE  fin_budget_target IS
  'Meta por linha do modelo de gestão e período. Quarta coluna da célula da 0034 — não soma com referencia/manual/realizado.';
COMMENT ON COLUMN fin_budget_target.valor_cents IS
  'Sinal do impacto no resultado, igual a fin_model_value: custo negativo, receita positiva.';
COMMENT ON COLUMN fin_budget_target.escopo IS
  'obras = meta do erp-obras, medida contra outro ledger. Não comparável com realizado da empresa.';
COMMENT ON VIEW   fin_previsao_evento_v IS
  'Todo evento de caixa PREVISTO, um por linha, com camada e confiança. procedencia = projetado, sempre.';
COMMENT ON VIEW   fin_caixa_previsto_dia_v IS
  'Saldo projetado dia a dia. Responde "em que dia o caixa aperta". Nunca soma realizado.';
COMMENT ON TABLE  fin_cash_forecast IS
  'Foto datada da previsão, para medir depois o quanto ela errou. Não é caixa.';
