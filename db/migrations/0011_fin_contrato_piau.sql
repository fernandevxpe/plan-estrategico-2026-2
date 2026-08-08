-- O contrato que a API não conhece: a parceria PIAU.
--
-- R$ 771.688,83 no histórico — 20% de toda a receita da empresa — pagos como
-- cobranças avulsas de "Comissionamento de vendas referente ao mês de X". NÃO é
-- assinatura no Asaas, então uma previsão construída só sobre GET /subscriptions
-- enxergaria R$ 9 mil/mês de recorrência e ignoraria a maior dependência da
-- empresa. Este contrato manual é o que torna a camada L2 da previsão honesta.
--
-- O valor é a ordem de grandeza dos últimos meses (~R$ 15 mil), não uma cifra
-- contratual: o comissionamento varia com as vendas do mês. Ajustar o valor é
-- edição pela tela, não migration.
--
-- As 27 assinaturas reais do Asaas entram por outro caminho: o import as upserta
-- a cada sync (chave asaas_subscription_id), porque elas mudam — esta migration
-- só cuida do que nenhuma API informa.
INSERT INTO fin_contract (
  entity_id, counterparty_id, name, direction, kind, category_id, nucleo,
  amount_cents, recurrence, day_of_month, confidence, status, notes
)
SELECT e.id,
       cp.id,
       'Comissionamento de vendas — PIAU',
       'receber',
       'comissionamento',
       cat.id,
       'consultoria',
       1500000,
       'mensal',
       30,
       'contratado',
       'ativo',
       'Parceria antiga; paga como cobrança avulsa todo mês, valor varia com as vendas. ~20% da receita histórica da empresa — concentração a monitorar.'
  FROM fin_entity e
  JOIN fin_counterparty cp ON cp.entity_id = e.id AND cp.normalized_name LIKE 'piau%'
  JOIN fin_category cat ON cat.entity_id = e.id AND cat.code = '3.06'
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (
     SELECT 1 FROM fin_contract c
      WHERE c.entity_id = e.id AND c.kind = 'comissionamento' AND c.counterparty_id = cp.id
   );
