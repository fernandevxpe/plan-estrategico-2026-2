-- A previsão para de contar o mesmo dinheiro duas vezes.
--
-- ---------------------------------------------------------------------------
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- A 0060 empilhou as camadas e o total ficou:
--
--   cobranca_emitida   255   R$ 470.596,49
--   parcelamento       190   R$ 407.499,94
--   assinatura         143   R$  64.229,23
--   ativo_de_fato      104   R$ 329.634,89
--
-- Somando tudo dá R$ 1,27 milhão de recebimento previsto, o que é falso: um
-- parcelamento de 12x com boletos já emitidos aparece na camada `parcelamento`
-- (projetado mês a mês) E na camada `cobranca_emitida` (cada boleto). O mesmo
-- contrato, contado duas vezes.
--
-- O mesmo vale para assinatura: o Asaas emite a cobrança de cada ciclo, então o
-- mês que já tem boleto não pode ser projetado de novo.
--
-- ---------------------------------------------------------------------------
-- A REGRA: COBRANÇA EMITIDA VENCE PROJEÇÃO
-- ---------------------------------------------------------------------------
-- Onde existe boleto, ele é o fato — data certa, valor certo, e já reflete
-- reajuste, desconto e ajuste manual que a projeção não conhece. A projeção só
-- preenche o que a cobrança ainda não cobre.
--
-- A exclusão é por (contraparte, mês): se aquele cliente já tem cobrança para
-- aquele mês, a recorrente dele não projeta ali. É deliberadamente grosseiro —
-- comparar valor exigiria decidir o que fazer quando o boleto é de R$ 2.400 e a
-- projeção diz R$ 2.600, e essa diferença é reajuste, não duplicata. Na dúvida
-- entre projetar a mais ou a menos, a menos é a escolha honesta.

CREATE OR REPLACE VIEW fin_previsao_recebimento_v AS
WITH cobranca AS (
  SELECT d.id, d.counterparty_id, d.due_date, d.amount_cents, d.description,
         date_trunc('month', d.due_date)::date AS mes
    FROM fin_document d
   WHERE d.direction = 'receber'
     AND d.status NOT IN ('liquidado', 'cancelado')
     AND d.due_date IS NOT NULL
),
-- Meses que já têm cobrança emitida por contraparte: é o que a projeção não
-- deve repetir.
coberto AS (
  SELECT DISTINCT counterparty_id, mes FROM cobranca WHERE counterparty_id IS NOT NULL
)
SELECT
  CASE WHEN c.due_date < CURRENT_DATE THEN 'vencido_a_receber' ELSE 'cobranca_emitida' END AS camada,
  CASE WHEN c.due_date < CURRENT_DATE THEN 'atrasado' ELSE 'firme' END AS certeza,
  c.mes, c.due_date AS data_prevista, c.amount_cents, c.counterparty_id,
  cp.name AS contraparte, c.id AS origem_id, 'fin_document' AS origem_tabela,
  c.description AS descricao
  FROM cobranca c
  LEFT JOIN fin_counterparty cp ON cp.id = c.counterparty_id

UNION ALL

SELECT
  CASE r.source
    WHEN 'contrato' THEN CASE WHEN r.end_month IS NULL THEN 'assinatura' ELSE 'parcelamento' END
    ELSE 'ativo_de_fato' END AS camada,
  r.confidence AS certeza,
  m.mes::date AS mes,
  (m.mes + (LEAST(r.day_of_month, 28) - 1) * INTERVAL '1 day')::date AS data_prevista,
  r.amount_cents, r.counterparty_id, cp.name AS contraparte,
  r.id AS origem_id, 'fin_recurring' AS origem_tabela, r.label AS descricao
  FROM fin_recurring r
  LEFT JOIN fin_counterparty cp ON cp.id = r.counterparty_id
  CROSS JOIN LATERAL generate_series(
        greatest(date_trunc('month', CURRENT_DATE), r.start_month),
        COALESCE(r.end_month, date_trunc('month', CURRENT_DATE) + INTERVAL '12 months'),
        INTERVAL '1 month') AS m(mes)
 WHERE r.status = 'ativo'
   AND r.direction = 'receber'
   -- A trava contra a dupla contagem.
   AND NOT EXISTS (
     SELECT 1 FROM coberto k
      WHERE k.counterparty_id = r.counterparty_id
        AND k.mes = m.mes::date);

COMMENT ON VIEW fin_previsao_recebimento_v IS
  'Previsão de recebimento por camada, SEM dupla contagem: onde existe cobrança emitida para a '
  'contraparte naquele mês, a recorrente dela não projeta — o boleto é o fato e já reflete '
  'reajuste e ajuste manual. Agora as camadas PODEM ser somadas. vencido_a_receber é dinheiro '
  'atrasado, não receita de mês futuro: somá-lo ao previsto antecipa dinheiro que já deveria '
  'ter entrado.';
