-- Reconciliação — o sistema contra um número que veio de fora.
--
-- O Fernando trouxe uma planilha de gestão com valores mensais por linha de
-- receita, e uma comparação manual (fora do banco) achou 3 categorias batendo
-- ao centavo, a maior parte do resto explicada pela fila "3.99 a classificar",
-- e duas frentes sem explicação (fev/mai, e "Monitor BT"). Ele quer isso
-- dentro da plataforma, vivo — não um relatório parado — com espaço para
-- marcar o veredito de cada divergência, porque a referência externa também
-- pode estar errada.
--
-- POR QUE É TABELA NOVA, NÃO REAPROVEITAR fin_das_reconciliacao_v/
-- erp_extrato_reconciliacao_v
--
-- As duas reconciliações que já existem comparam DUAS FONTES DENTRO DO BANCO
-- (DAS declarado vs nota emitida; extrato do erp-obras vs ledger). Aqui o
-- outro lado é um número que uma PESSOA digitou, vindo de um documento que o
-- banco nunca viu. fin_reconciliacao_referencia é esse número, com fonte e
-- trilha — não um cálculo.
--
-- POR QUE A GRANULARIDADE É CATEGORIA, NÃO LINHA DE PRODUTO (0124)
--
-- A comparação manual já fechou nesse nível: 3 categorias bateram ao centavo,
-- e o resto se explica (ou não) categoria a categoria. Linha de produto ainda
-- nasce vazia (0124) — esperar ela ser populada adiaria isto sem necessidade.

-- ---------------------------------------------------------------------------
-- 1. A referência
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_reconciliacao_referencia (
  id                   bigserial PRIMARY KEY,
  entity_id            bigint NOT NULL REFERENCES fin_entity(id),
  category_id          bigint REFERENCES fin_category(id),
  mes                  date NOT NULL,
  valor_esperado_cents bigint NOT NULL,
  fonte                text NOT NULL,
  status               text NOT NULL DEFAULT 'pendente'
                         CHECK (status IN ('pendente', 'sistema_correto', 'referencia_errada', 'corrigido')),
  nota                 text,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  criado_por           text NOT NULL,
  atualizado_em        timestamptz,
  atualizado_por       text,
  CONSTRAINT fin_reconciliacao_referencia_mes_1o_dia CHECK (mes = date_trunc('month', mes)::date)
);

-- category_id NULO é um valor legítimo aqui: é a linha "sem categoria" da
-- planilha, se um dia existir. A UNIQUE trata NULL como um valor distinto de
-- si mesmo em Postgres (duas linhas com category_id NULL não colidem por
-- padrão) — o índice funcional abaixo fecha esse buraco explicitamente.
CREATE UNIQUE INDEX IF NOT EXISTS fin_reconciliacao_referencia_unica
  ON fin_reconciliacao_referencia (entity_id, COALESCE(category_id, -1), mes);

CREATE INDEX IF NOT EXISTS fin_reconciliacao_referencia_mes_idx
  ON fin_reconciliacao_referencia (entity_id, mes);

COMMENT ON TABLE fin_reconciliacao_referencia IS
  'Um valor esperado por categoria e mês, vindo de fora do banco (planilha, relatório de terceiro). '
  'status é o veredito de quem revisou: pendente até alguém olhar, sistema_correto/referencia_errada/ '
  'corrigido depois. fonte é obrigatória — número sem proveniência não entra aqui.';

-- ---------------------------------------------------------------------------
-- 2. A comparação — sempre viva, nunca calculada duas vezes
-- ---------------------------------------------------------------------------
-- Reaproveita fin_revenue_cash_v (0123) para o lado do sistema, em vez de
-- duplicar o WHERE de "o que é receita em regime de caixa" — se aquele filtro
-- mudar de novo, esta view muda junto, sem precisar lembrar de replicar.
CREATE OR REPLACE VIEW fin_reconciliacao_v AS
WITH sistema AS (
  SELECT entity_id, category_id, month AS mes, sum(amount_cents) AS valor_sistema_cents, count(*) AS lancamentos
    FROM fin_revenue_cash_v
   GROUP BY entity_id, category_id, month
)
SELECT
  COALESCE(s.entity_id, r.entity_id)                    AS entity_id,
  COALESCE(s.category_id, r.category_id)                AS category_id,
  c.code                                                 AS categoria_code,
  c.name                                                 AS categoria_nome,
  COALESCE(s.mes, r.mes)                                 AS mes,
  COALESCE(s.valor_sistema_cents, 0)                     AS valor_sistema_cents,
  COALESCE(s.lancamentos, 0)                             AS lancamentos,
  r.id                                                    AS referencia_id,
  r.valor_esperado_cents,
  r.fonte,
  r.status,
  r.nota,
  (COALESCE(s.valor_sistema_cents, 0) - r.valor_esperado_cents) AS diferenca_cents
FROM sistema s
FULL OUTER JOIN fin_reconciliacao_referencia r
  ON r.entity_id = s.entity_id AND r.mes = s.mes
 AND COALESCE(r.category_id, -1) = COALESCE(s.category_id, -1)
LEFT JOIN fin_category c ON c.id = COALESCE(s.category_id, r.category_id);

COMMENT ON VIEW fin_reconciliacao_v IS
  'Sistema (fin_revenue_cash_v, agrupado por categoria e mês) contra a referência salva '
  '(fin_reconciliacao_referencia). diferenca_cents é NULO quando não há referência para aquela '
  'categoria/mês — NULO não é zero, é "ainda não comparado". FULL OUTER JOIN de propósito: '
  'categoria com lançamento novo mas sem referência ainda aparece, e categoria com referência mas '
  'sem lançamento no mês (a planilha registrou algo que o sistema hoje não tem) também.';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_direto bigint; v_view bigint;
BEGIN
  -- A soma de fin_reconciliacao_v (lado sistema) bate com a soma direta de
  -- fin_revenue_cash_v — provando que o FULL OUTER JOIN com uma tabela vazia
  -- de referências não perde nem duplica nenhum lançamento.
  SELECT COALESCE(sum(amount_cents), 0) INTO v_direto FROM fin_revenue_cash_v;
  SELECT COALESCE(sum(valor_sistema_cents), 0) INTO v_view FROM fin_reconciliacao_v;
  IF v_direto IS DISTINCT FROM v_view THEN
    RAISE EXCEPTION '[0125] fin_reconciliacao_v perdeu ou duplicou lançamento: direto R$ %, view R$ %',
      v_direto / 100.0, v_view / 100.0;
  END IF;

  IF (SELECT count(*) FROM fin_reconciliacao_referencia) <> 0 THEN
    RAISE EXCEPTION '[0125] fin_reconciliacao_referencia devia nascer vazia';
  END IF;

  RAISE NOTICE '[0125] reconciliação: tabela de referência vazia, view provada contra fin_revenue_cash_v (R$ %)', v_direto / 100.0;
END $$;
