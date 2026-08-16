-- Monitoramento fiscal: entrou, saiu, quanto de imposto, e o que entrou sem nota.
--
-- ---------------------------------------------------------------------------
-- A PERGUNTA MAIS IMPORTANTE DAS TRÊS
-- ---------------------------------------------------------------------------
-- "Quantidade de receitas recebidas sem notas" é a que tem consequência fora da
-- gestão. Dinheiro que entrou como receita de serviço e não tem nota fiscal
-- emitida é exposição fiscal — e some de qualquer relatório que olhe só o
-- ledger ou só as notas, porque o buraco existe justamente ENTRE os dois.
--
-- O casamento é por documento: fin_fiscal_document.document_id → fin_document →
-- fin_settlement → fin_transaction. Onde a cadeia se rompe, a receita entrou
-- sem nota. A migration 0045 já reparou o elo que o import do Asaas quebrava
-- (306 → 3.121 notas ligadas), então a medição agora é confiável.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO ENTRA COMO "RECEITA SEM NOTA"
-- ---------------------------------------------------------------------------
-- Nem toda entrada precisa de nota, e tratar tudo como falta produziria um
-- alarme que ninguém consegue zerar:
--
--   · transferência entre contas próprias — não é receita;
--   · aplicação e resgate — movimentação;
--   · estorno e devolução — reversão, não faturamento;
--   · reembolso recebido — recomposição de despesa.
--
-- Ficam de fora pelo cash_flow_group, não por lista de exceção escrita à mão.

CREATE OR REPLACE VIEW fin_monitor_fiscal_v AS
WITH mov AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         t.id, t.amount_cents, t.counterparty_id,
         c.cash_flow_group, c.code AS categoria_code
    FROM fin_transaction t
    LEFT JOIN fin_category c ON c.id = t.category_id
),
-- Receita de serviço: o que deveria ter nota.
receita AS (
  SELECT m.*,
         EXISTS (
           SELECT 1
             FROM fin_settlement s
             JOIN fin_document d  ON d.id = s.document_id
             JOIN fin_fiscal_document f ON f.document_id = d.id
            WHERE s.transaction_id = m.id
              AND f.status = 'AUTHORIZED'
         ) AS tem_nota
    FROM mov m
   WHERE m.amount_cents > 0
     AND m.cash_flow_group IN ('receita-servicos', 'receita-recorrente')
)
SELECT
  m.mes,
  -- Fluxo bruto do mês, sem movimentação (que não é entrada nem saída de verdade)
  sum(m.amount_cents) FILTER (WHERE m.amount_cents > 0
                                AND COALESCE(m.cash_flow_group,'') <> 'movimentacao') AS entradas_cents,
  sum(abs(m.amount_cents)) FILTER (WHERE m.amount_cents < 0
                                AND COALESCE(m.cash_flow_group,'') <> 'movimentacao') AS saidas_cents,
  -- Imposto efetivamente pago: o que saiu classificado como tributo.
  sum(abs(m.amount_cents)) FILTER (WHERE m.amount_cents < 0
                                AND m.cash_flow_group = 'impostos')                   AS imposto_pago_cents,
  -- Receita de serviço e a fatia dela sem nota autorizada.
  (SELECT count(*)    FROM receita r WHERE r.mes = m.mes)                             AS receitas_servico,
  (SELECT count(*)    FROM receita r WHERE r.mes = m.mes AND NOT r.tem_nota)          AS receitas_sem_nota,
  (SELECT COALESCE(sum(r.amount_cents),0) FROM receita r WHERE r.mes = m.mes)         AS receita_servico_cents,
  (SELECT COALESCE(sum(r.amount_cents),0) FROM receita r WHERE r.mes = m.mes
                                                           AND NOT r.tem_nota)        AS receita_sem_nota_cents
  FROM mov m
 GROUP BY m.mes;

COMMENT ON VIEW fin_monitor_fiscal_v IS
  'Entradas, saídas, imposto pago e receita sem nota fiscal por mês. "Sem nota" = receita de '
  'serviço cuja cadeia transação → liquidação → documento → NFe AUTORIZADA se rompe. Exclui '
  'movimentação, estorno e reembolso, que não geram nota por natureza. A carga efetiva sai da '
  'divisão imposto_pago / receita, e é gerencial: o regime tributário real exige apuração '
  'própria, não a razão entre dois números de caixa.';
