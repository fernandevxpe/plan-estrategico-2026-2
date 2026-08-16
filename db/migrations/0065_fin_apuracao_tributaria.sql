-- Apuração tributária: o que dá para afirmar, e o que não dá.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA VIEW NÃO CALCULA O IMPOSTO DEVIDO
-- ---------------------------------------------------------------------------
-- A tentação é multiplicar receita por uma alíquota e chamar de apuração. Isso
-- produziria um número com aparência de exatidão que ninguém pode levar ao
-- contador — e, pior, que some quando confrontado.
--
-- No Simples Nacional a alíquota efetiva depende de três coisas que este banco
-- ainda não tem com confiança:
--
--   1. RBT12 — receita bruta dos 12 meses anteriores. A janela aqui NÃO FECHA:
--      a receita categorizada como serviço só cobre de set/2025 em diante, então
--      o acumulado de 12 meses está incompleto e cresce artificialmente
--      (R$ 162 mil em mai/26 contra R$ 656 mil em ago/26 — é a janela enchendo,
--      não a empresa crescendo 4x).
--
--   2. ANEXO — III ou V, dependendo do Fator R (folha ÷ receita, 12 meses). A
--      diferença entre eles é grande, e o Fator R exige a folha COMPLETA,
--      incluindo pró-labore e encargos que hoje estão parcialmente fora.
--
--   3. TABELA VIGENTE — alíquota nominal e parcela a deduzir por faixa. Isso é
--      legislação, muda, e não pode sair de memória. Precisa de fonte oficial
--      citada com data de consulta.
--
-- O que a view entrega é o que os dados sustentam: a base declarável, o imposto
-- efetivamente pago, a carga implícita e as divergências que impedem fechar o
-- cálculo. É o insumo para o contador, não o substituto dele.
--
-- ---------------------------------------------------------------------------
-- A DIVERGÊNCIA QUE O FERNANDO ANTECIPOU
-- ---------------------------------------------------------------------------
-- "pode ter algumas divergências por algumas notas emitidas diretamente pelo
--  site da prefeitura".
--
-- Confirmado nos dados, e nos dois sentidos:
--
--   fev/26   ledger R$ 150.232,98   notas Asaas R$  77.360,99   −R$ 72.871,99
--   ago/26   ledger R$  74.493,32   notas Asaas R$ 120.047,15   +R$ 45.553,83
--
-- Ledger MAIOR que notas = receita recebida cuja nota saiu fora do Asaas (ou não
-- saiu). Notas MAIOR que ledger = nota emitida e ainda não recebida, ou recebida
-- em outro mês. As duas são normais isoladamente; o que não é normal é a
-- amplitude, e ela impede usar qualquer um dos dois números sozinho como base.
--
-- Por isso a view mostra os DOIS e a diferença, em vez de escolher um.

CREATE OR REPLACE VIEW fin_apuracao_tributaria_v AS
WITH receita_ledger AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(t.amount_cents) AS cents
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents > 0 AND c.cash_flow_group IN ('receita-servicos', 'receita-recorrente')
   GROUP BY 1
),
receita_nota AS (
  SELECT date_trunc('month', issue_date)::date AS mes, sum(service_amount_cents) AS cents,
         count(*) AS notas
    FROM fin_fiscal_document WHERE status = 'AUTHORIZED' GROUP BY 1
),
imposto AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(abs(t.amount_cents)) AS cents,
         count(*) AS pagamentos
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0 AND c.cash_flow_group = 'impostos' GROUP BY 1
),
folha AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(abs(t.amount_cents)) AS cents
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0 AND c.cash_flow_group = 'pessoal' GROUP BY 1
),
meses AS (SELECT mes FROM receita_ledger UNION SELECT mes FROM receita_nota UNION SELECT mes FROM imposto)
SELECT
  m.mes,
  COALESCE(rl.cents, 0)                                   AS receita_ledger_cents,
  COALESCE(rn.cents, 0)                                   AS receita_nota_cents,
  COALESCE(rn.notas, 0)                                   AS notas_emitidas,
  COALESCE(rn.cents, 0) - COALESCE(rl.cents, 0)           AS divergencia_cents,
  COALESCE(i.cents, 0)                                    AS imposto_pago_cents,
  COALESCE(i.pagamentos, 0)                               AS pagamentos_imposto,
  COALESCE(f.cents, 0)                                    AS folha_cents,
  -- Carga sobre a competência anterior: o DAS vence no mês seguinte ao fato
  -- gerador, então dividir imposto pago por receita do MESMO mês compara coisas
  -- de períodos diferentes. Medido: com defasagem a variação cai de
  -- 5,31–17,96% para 8,27–14,56%.
  (SELECT round(100.0 * COALESCE(i.cents,0) / NULLIF(rl2.cents, 0), 2)
     FROM receita_ledger rl2 WHERE rl2.mes = m.mes - INTERVAL '1 month') AS carga_sobre_mes_anterior_pct,
  -- RBT12 vem com o aviso embutido: enquanto a janela não tiver 12 meses de
  -- receita categorizada, o número cresce sozinho e NÃO serve para achar faixa.
  (SELECT count(*) FROM receita_ledger r3
    WHERE r3.mes > m.mes - INTERVAL '12 months' AND r3.mes <= m.mes)      AS meses_na_janela,
  (SELECT sum(r4.cents) FROM receita_ledger r4
    WHERE r4.mes > m.mes - INTERVAL '12 months' AND r4.mes <= m.mes)      AS rbt12_parcial_cents,
  ((SELECT count(*) FROM receita_ledger r5
     WHERE r5.mes > m.mes - INTERVAL '12 months' AND r5.mes <= m.mes) = 12) AS rbt12_completo
  FROM meses m
  LEFT JOIN receita_ledger rl ON rl.mes = m.mes
  LEFT JOIN receita_nota   rn ON rn.mes = m.mes
  LEFT JOIN imposto        i  ON i.mes  = m.mes
  LEFT JOIN folha          f  ON f.mes  = m.mes;

COMMENT ON VIEW fin_apuracao_tributaria_v IS
  'Insumo para apuração tributária — NÃO calcula imposto devido. Entrega base declarável pelos '
  'dois caminhos (ledger e notas autorizadas), a divergência entre eles, imposto efetivamente '
  'pago, folha e carga implícita sobre a competência anterior. rbt12_completo=false significa '
  'que a janela de 12 meses não fechou e o acumulado NÃO serve para determinar faixa do Simples. '
  'Calcular alíquota exige tabela vigente com fonte oficial, anexo (III ou V) e Fator R com folha '
  'completa — nenhum dos três pode sair de memória.';
