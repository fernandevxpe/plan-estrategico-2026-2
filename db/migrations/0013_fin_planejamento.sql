-- Planejamento global: premissas editáveis e valores escritos à mão.
--
-- A meta comercial vem do pipe (Pipedrive) e é FATO — não se digita aqui. O que
-- este módulo faz é derivar dela tudo o que ela implica: imposto, custo
-- operacional, custo de vendas, marketing, folha, margem. As relações vêm da
-- Projeção Financeira v3.1, que já era o modelo mental da empresa.
--
-- DUAS COISAS QUE O SCHEMA PRECISA GARANTIR, E QUE SEPARAM ISTO DE UMA PLANILHA:
--
-- 1. TODA PREMISSA É EDITÁVEL, e a edição sobrevive ao recálculo. Se a alíquota
--    efetiva do Simples mudar de 16% para 14%, alguém troca na tela e todo o
--    resto se refaz. Premissa embutida em código é premissa que ninguém corrige.
--
-- 2. TODO VALOR DERIVADO PODE SER SOBRESCRITO À MÃO, sem que isso apague a
--    fórmula. É a diferença entre "a plataforma calcula e você aceita" e "a
--    plataforma calcula e você discorda quando sabe mais que ela". Sem o
--    override, a primeira exceção manda a pessoa de volta para a planilha —
--    e aí existem duas verdades.

-- ---------------------------------------------------------------------------
-- Premissas
-- ---------------------------------------------------------------------------
-- Percentuais em base 10.000 (basis points) e não float: 16% vira 1600. Evita
-- o mesmo problema do dinheiro — soma de float com float diverge, e uma margem
-- que fecha 28,999999% num relatório e 29% em outro destrói a confiança.
CREATE TABLE fin_planning_param (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id),
  slug        text NOT NULL,
  name        text NOT NULL,
  grupo       text NOT NULL CHECK (grupo IN ('margem', 'estrutura', 'equipe', 'imposto', 'recebimento', 'outro')),
  -- 'bps' = percentual em base 10.000 · 'cents' = dinheiro · 'unidade' = contagem
  unidade     text NOT NULL CHECK (unidade IN ('bps', 'cents', 'unidade')),
  valor       bigint NOT NULL,
  -- Escopo ao qual a premissa se aplica; NULL = vale para a empresa toda.
  nucleo      text REFERENCES fin_nucleo(slug),
  -- De onde saiu o número. "planilha v3.1" é diferente de "chutei" e de "medido
  -- no ledger" — e quem lê o plano seis meses depois precisa saber qual é qual.
  origem      text NOT NULL DEFAULT 'planilha_v31' CHECK (origem IN ('planilha_v31', 'medido', 'manual', 'padrao')),
  descricao   text,
  sort_order  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  UNIQUE (entity_id, slug, nucleo)
);

CREATE TRIGGER fin_planning_param_touch BEFORE UPDATE ON fin_planning_param
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sobrescritas manuais
-- ---------------------------------------------------------------------------
-- Uma linha aqui vence a fórmula para aquele mês, aquela linha da DRE e aquele
-- núcleo. A fórmula continua existindo — a tela mostra os dois lado a lado e
-- diz de quanto é a diferença, que costuma ser a informação mais útil da tela.
CREATE TABLE fin_planning_override (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id),
  ano         integer NOT NULL,
  mes         integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  linha       text NOT NULL,
  nucleo      text REFERENCES fin_nucleo(slug),
  valor_cents bigint NOT NULL,
  motivo      text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  UNIQUE (entity_id, ano, mes, linha, nucleo)
);

CREATE INDEX fin_planning_override_periodo_idx ON fin_planning_override (entity_id, ano, mes);

CREATE TRIGGER fin_planning_override_touch BEFORE UPDATE ON fin_planning_override
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Premissas iniciais — todas da Projeção Financeira v3.1
-- ---------------------------------------------------------------------------
-- A estrutura de margem por ticket que a planilha já usava:
--   ticket 100% → imposto 16% → custo operacional 40% → custo de vendas 10%
--   → marketing/CS 5% → margem bruta 29%
--
-- Estes números são o ponto de partida, não a verdade: a coluna `origem` diz
-- 'planilha_v31' justamente para que, quando o ledger tiver despesa real, dê
-- para trocar por 'medido' e comparar o que se supunha com o que acontece.
INSERT INTO fin_planning_param (entity_id, slug, name, grupo, unidade, valor, origem, descricao, sort_order)
SELECT e.id, v.slug, v.name, v.grupo, v.unidade, v.valor, v.origem, v.descricao, v.sort_order
  FROM fin_entity e
 CROSS JOIN (VALUES
   ('imposto-efetivo',      'Alíquota efetiva sobre faturamento', 'imposto',    'bps',     1600::bigint, 'planilha_v31', 'Simples Nacional + ISS embutido. Substituir por apuração real na Fase 4.', 1),
   ('custo-operacional',    'Custo operacional sobre receita',    'margem',     'bps',     4000::bigint, 'planilha_v31', 'Execução do serviço: equipe técnica, deslocamento, material.', 2),
   ('custo-vendas',         'Custo de vendas sobre receita',      'margem',     'bps',     1000::bigint, 'planilha_v31', 'Comissão e despesa comercial direta.', 3),
   ('marketing-cs',         'Marketing, CS e relacionamento',     'margem',     'bps',      500::bigint, 'planilha_v31', 'Orçamento de aquisição e pós-venda.', 4),
   ('custo-fixo-mensal',    'Custo fixo mensal',                  'estrutura',  'cents', 1500000::bigint, 'planilha_v31', 'Aluguel, dívida e outros fixos. R$ 15 mil/mês na v3.1.', 5),
   ('ticket-medio',         'Ticket médio',                       'equipe',     'cents',  792170::bigint, 'planilha_v31', 'R$ 7.921,70 na v3.1; a meta era subir para R$ 12 mil.', 6),
   ('faturamento-vendedor', 'Faturamento por vendedor/mês',       'equipe',     'cents', 9801785::bigint, 'planilha_v31', 'R$ 98.017,85/mês por vendedor — define quantos vendedores a meta exige.', 7),
   ('conversao-fechamento', 'Fechamento sobre apresentação',      'equipe',     'bps',     3300::bigint, 'planilha_v31', 'Taxa medida no funil: 33%.', 8),
   ('parcela-no-mes',       'Parcela que cai no mês da venda',    'recebimento','bps',     2500::bigint, 'planilha_v31', '"Prática 1/4 cai no mês" — o resto se distribui nas parcelas seguintes.', 9),
   ('custo-por-pessoa',     'Custo médio por pessoa/mês',         'equipe',     'cents',  450000::bigint, 'manual',       'Folha + encargos. Ajustar com a folha real quando ela entrar no ledger.', 10)
 ) AS v(slug, name, grupo, unidade, valor, origem, descricao, sort_order)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug, nucleo) DO NOTHING;
