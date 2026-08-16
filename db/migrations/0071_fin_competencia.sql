-- A competência deixa de ser nula, e passa a dizer POR QUE é o que é.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- `fin_transaction.competence_date` está NULA em 13.880 de 13.880 lançamentos.
-- A coluna existe desde a 0001 e nunca foi preenchida. Consequência: tudo que
-- esta plataforma chamou de "DRE" até aqui é regime de CAIXA — a data usada é
-- `posted_on`, o dia em que o dinheiro se moveu.
--
-- Isso não é um detalhe de nomenclatura. Medido nesta base, quando a
-- competência entra:
--
--   · 465 recebimentos (R$ 579.402,49) mudam de mês, porque a nota foi emitida
--     em um mês e o cliente pagou em outro — a defasagem média é de 10 dias,
--     e o extremo é de 230 dias;
--   · 429 pagamentos de folha (R$ 653.648,55) mudam de mês, porque salário
--     pago no dia 1º ou 2º é trabalho do mês anterior;
--   ·  37 recebimentos (R$ 29.672,14) mudam de mês pela data de vencimento.
--
-- Ou seja: quase R$ 1,3 milhão de resultado está no mês errado hoje. Uma DRE
-- por caixa não é errada — é outra pergunta. O erro é chamá-la de DRE.
--
-- ---------------------------------------------------------------------------
-- A DECISÃO DE DESENHO: A REGRA É DADO, NÃO CÓDIGO
-- ---------------------------------------------------------------------------
-- Preencher `competence_date` e parar aí produziria uma data que ninguém
-- consegue auditar seis meses depois. "Por que este lançamento está em março?"
-- não teria resposta no banco — só num comentário de migration que talvez
-- ninguém leia.
--
-- Por isso são DUAS colunas, sempre juntas:
--
--   competence_date   a data
--   competence_rule   a regra que produziu a data, com FK para um catálogo
--
-- E um CHECK que impede uma sem a outra. Data de competência sem regra
-- declarada não entra nesta tabela.
--
-- O catálogo (`fin_competence_rule`) guarda, por regra: de qual coluna de qual
-- tabela a data saiu, a precedência, e o NÍVEL DE CONFIANÇA. São quatro níveis,
-- e a diferença entre eles é o que separa fato de suposição:
--
--   documento  a data veio de um papel datado (NFe, cobrança, compra no cartão)
--   evento     o caixa É a competência por natureza (tarifa cobrada no ato)
--   convencao  regra de negócio declarada, não documento (folha do mês anterior)
--   presumida  não há evidência nenhuma; competência = caixa, e está DITO
--
-- `fin_competencia_cobertura_v` publica quantas linhas e quanto dinheiro cada
-- nível cobre. Relatório que usa competência sem publicar essa tabela está
-- escondendo o tamanho da suposição.
--
-- ---------------------------------------------------------------------------
-- AS REGRAS, NA ORDEM EM QUE SE APLICAM
-- ---------------------------------------------------------------------------
-- Precedência decrescente. A primeira que casar vence; nenhuma linha recebe
-- duas regras.
--
--  10  nota_fiscal_emissao ....... 2.728 linhas · R$ 3.201.221,87
--      Recebimento liquidando uma cobrança que tem NFS-e AUTHORIZED.
--      competência = fin_fiscal_document.issue_date
--      Por que a emissão e não o vencimento: a nota é o fato gerador fiscal, e
--      é ela que o contador vai procurar. Conferido: nesta base issue_date e
--      competence_date da nota são idênticos nas 3.521 notas, então a escolha
--      não muda número nenhum hoje — mas fixa qual coluna manda quando o
--      importador passar a distinguir as duas.
--
--  20  cobranca_vencimento ....... 320 linhas · R$ 645.481,17
--      Recebimento liquidando cobrança SEM nota autorizada (nota cancelada, com
--      erro, agendada, ou serviço que não gerou nota).
--      competência = fin_document.due_date
--      Vencimento e não emissão da cobrança porque é o vencimento que marca o
--      período a que o serviço se refere nas assinaturas — e 3.403 dos 3.406
--      documentos já usam due_date como sua própria competência.
--
--  30  documento_fiscal_despesa .. 0 linhas HOJE
--      Despesa com documento fiscal do fornecedor → data do documento.
--      A regra existe e não cobre nada porque `fin_document` tem 3.406 linhas e
--      TODAS são direction='receber'. Não há contas a pagar modeladas. A regra
--      fica escrita para que, no dia em que o primeiro documento de saída
--      entrar, a competência dele já saia certa sem nova migration — e para que
--      o zero seja um zero DECLARADO, não uma omissão.
--
--  40  folha_mes_referencia ...... 592 linhas · R$ -697.708,13
--      Folha (cash_flow_group='pessoal'): pagamento até o dia 5 do mês M tem
--      competência no mês M-1; do dia 6 em diante, no próprio mês.
--      CONFIANÇA = convencao, não documento. Medido: 6.01 e 6.02 concentram
--      201+175 lançamentos nos dias 1 e 2 e praticamente nada no fim do mês —
--      é o padrão de salário pago no início do mês seguinte ao trabalhado (a
--      CLT manda pagar até o 5º dia útil do mês subsequente).
--      O que tornaria isto um fato em vez de uma convenção:
--      `fin_person_compensation.reference_month` já existe e tem 48 linhas, mas
--      NENHUMA está ligada a um lançamento do ledger. Quando essa ligação
--      existir, a regra lê o mês declarado e vira confiança 'documento'.
--      → PERGUNTA PARA O FERNANDO, com opções, no relatório desta sessão.
--
--  50  cartao_data_compra ........ 795 itens de cartão
--      Aplica-se a fin_card_transaction, não ao ledger bancário.
--      competência = COALESCE(purchase_date, posted_on).
--      Em compra parcelada, `purchase_date` é a data da compra original e cada
--      parcela carrega o mesmo valor de competência — então o custo inteiro cai
--      no mês da compra, que é o que a competência exige. Em compra à vista,
--      `posted_on` já É a data da compra.
--      NÃO confundir com `competence_month`, que apesar do nome guarda o mês da
--      FATURA (156 de 156 parcelas têm competence_month diferente do mês da
--      compra). Essa coluna responde "em qual fatura veio", não "quando o custo
--      aconteceu".
--
--  60  tarifa_evento_no_caixa .... 8.812 linhas · R$ -11.297,58
--      Tarifa de cobrança, de notificação, de transferência, consulta de
--      crédito. O fato gerador É o evento na data em que foi cobrado. Aqui
--      caixa e competência coincidem por NATUREZA, não por falta de dado — e é
--      por isso que estas 8.812 linhas não contam como presumidas.
--
--  70  movimentacao_neutra ....... 652 linhas · R$ -2.356.883,29
--      cash_flow_group='movimentacao'. Transferência entre contas próprias,
--      aplicação, resgate, aporte, amortização, pagamento de fatura de cartão.
--      Não chega à DRE por nenhuma das duas visões, então a competência delas é
--      irrelevante para resultado — recebem posted_on para não ficarem nulas e
--      são marcadas como o que são.
--
--  99  competencia_presumida_caixa 776 linhas · R$ -749.938,83  ← A LACUNA
--      Não há documento, não é folha, não é tarifa, não é movimentação.
--      competência = posted_on, e a linha fica MARCADA como presumida.
--      É 5,6% das linhas. O grosso: 418 lançamentos sem categoria nenhuma
--      (R$ -152.871,15), 237 em "5.99 despesa a classificar" (R$ -112.492,54)
--      e 42 DAS do Simples (R$ -123.283,78 — o DAS vence no mês seguinte ao
--      fato gerador, e sem apuração ligada não dá para afirmar a competência).
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não cria trigger que preenche competência no INSERT. Seria tentador, e seria
-- errado: a evidência que decide a regra (o settlement, a nota) chega DEPOIS do
-- lançamento, às vezes dias depois. Um trigger carimbaria 'presumida' em quase
-- tudo e a marca de presunção perderia o sentido.
-- O caminho é a função `fin_competencia_backfill()`, idempotente e re-executável:
-- ela preenche o que está vazio e RE-AVALIA o que está presumido, porque uma
-- linha presumida hoje pode ganhar nota amanhã. O que ela nunca toca é linha
-- com 'competence_date' em `human_locked_fields`.

-- ---------------------------------------------------------------------------
-- 1. O CATÁLOGO DE REGRAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_competence_rule (
  slug        text PRIMARY KEY,
  name        text NOT NULL,
  precedencia integer NOT NULL,
  fonte       text NOT NULL,
  confianca   text NOT NULL
                CHECK (confianca IN ('documento', 'evento', 'convencao', 'presumida')),
  aplica_em   text NOT NULL DEFAULT 'fin_transaction'
                CHECK (aplica_em IN ('fin_transaction', 'fin_card_transaction')),
  descricao   text NOT NULL,
  UNIQUE (aplica_em, precedencia)
);

COMMENT ON TABLE fin_competence_rule IS
  'Catálogo das regras de competência. Cada linha de fin_transaction e de '
  'fin_card_transaction aponta para uma destas — a data sem a regra não é auditável. '
  'confianca separa o que veio de documento datado do que é convenção declarada e do '
  'que é presunção pura (competência = caixa).';

COMMENT ON COLUMN fin_competence_rule.fonte IS
  'Tabela.coluna de onde a data sai, em texto. É a resposta a "de onde veio esta data".';
COMMENT ON COLUMN fin_competence_rule.precedencia IS
  'Menor vence. A primeira regra que casar é a aplicada; nenhuma linha recebe duas.';

INSERT INTO fin_competence_rule (slug, name, precedencia, fonte, confianca, aplica_em, descricao) VALUES
  ('nota_fiscal_emissao', 'Emissão da nota fiscal', 10,
   'fin_fiscal_document.issue_date', 'documento', 'fin_transaction',
   'Recebimento que liquida cobrança com NFS-e AUTHORIZED. A nota é o fato gerador fiscal.'),

  ('cobranca_vencimento', 'Vencimento da cobrança', 20,
   'fin_document.due_date', 'documento', 'fin_transaction',
   'Recebimento que liquida cobrança sem nota autorizada. O vencimento marca o período do serviço.'),

  ('documento_fiscal_despesa', 'Documento fiscal da despesa', 30,
   'fin_document.issue_date (direction=pagar)', 'documento', 'fin_transaction',
   'Despesa com documento do fornecedor. ZERO linhas hoje: não há contas a pagar modeladas.'),

  ('folha_mes_referencia', 'Mês de referência da folha', 40,
   'convenção: pagamento até o dia 5 → mês anterior', 'convencao', 'fin_transaction',
   'Folha paga no início do mês refere-se ao mês trabalhado anterior (CLT: até o 5º dia útil). '
   'Vira confiança documento quando fin_person_compensation.reference_month estiver ligado ao ledger.'),

  ('tarifa_evento_no_caixa', 'Tarifa cobrada no ato', 60,
   'fin_transaction.posted_on (o evento é a data)', 'evento', 'fin_transaction',
   'Tarifa de cobrança, notificação, transferência e consulta. Caixa e competência coincidem por natureza.'),

  ('movimentacao_neutra', 'Movimentação financeira neutra', 70,
   'fin_transaction.posted_on', 'evento', 'fin_transaction',
   'cash_flow_group=movimentacao. Não chega à DRE por nenhuma visão; competência irrelevante para resultado.'),

  ('competencia_presumida_caixa', 'Competência presumida = caixa', 99,
   'fin_transaction.posted_on (SEM evidência)', 'presumida', 'fin_transaction',
   'Nenhuma evidência disponível. A data é a do caixa e a linha fica marcada como presumida.'),

  ('cartao_data_compra', 'Data da compra no cartão', 10,
   'fin_card_transaction.purchase_date', 'documento', 'fin_card_transaction',
   'Compra parcelada: todas as parcelas competem no mês da compra original, não no mês da fatura.'),

  ('cartao_data_lancamento', 'Data do lançamento no cartão', 20,
   'fin_card_transaction.posted_on', 'documento', 'fin_card_transaction',
   'Compra à vista, IOF e encargo: o lançamento no cartão É a data do fato.'),

  ('cartao_pagamento_fatura', 'Pagamento de fatura', 70,
   'fin_card_transaction.posted_on', 'evento', 'fin_card_transaction',
   'Pagamento da fatura dentro do extrato do cartão. NÃO é custo — é liquidação. Fica fora da DRE.')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, precedencia = EXCLUDED.precedencia, fonte = EXCLUDED.fonte,
      confianca = EXCLUDED.confianca, aplica_em = EXCLUDED.aplica_em, descricao = EXCLUDED.descricao;

-- ---------------------------------------------------------------------------
-- 2. A COLUNA DA REGRA, NAS DUAS TABELAS QUE TÊM COMPETÊNCIA
-- ---------------------------------------------------------------------------
ALTER TABLE fin_transaction
  ADD COLUMN IF NOT EXISTS competence_rule text REFERENCES fin_competence_rule(slug);

ALTER TABLE fin_card_transaction
  ADD COLUMN IF NOT EXISTS competence_date date,
  ADD COLUMN IF NOT EXISTS competence_rule text REFERENCES fin_competence_rule(slug);

COMMENT ON COLUMN fin_transaction.competence_rule IS
  'Qual regra do catálogo produziu competence_date. Sem ela a data não é auditável.';
COMMENT ON COLUMN fin_transaction.competence_date IS
  'Data de competência (regime de competência). Preenchida pela regra em competence_rule. '
  'NUNCA use posted_on como competência sem declarar: para isso existe a regra '
  'competencia_presumida_caixa, que grava a mesma data E diz que é presunção.';
COMMENT ON COLUMN fin_card_transaction.competence_date IS
  'Data da COMPRA, não do lançamento na fatura. Em parcelamento, todas as parcelas apontam '
  'para a compra original. Não confundir com competence_month, que é o mês da FATURA.';

-- Data sem regra não entra. A recíproca é permitida (regra sem data) apenas
-- durante o backfill, dentro desta mesma transação — no fim, nenhuma das duas
-- fica sozinha.
ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_competencia_tem_regra;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_competencia_tem_regra
  CHECK (competence_date IS NULL OR competence_rule IS NOT NULL) NOT VALID;

ALTER TABLE fin_card_transaction
  DROP CONSTRAINT IF EXISTS fin_card_transaction_competencia_tem_regra;
ALTER TABLE fin_card_transaction
  ADD CONSTRAINT fin_card_transaction_competencia_tem_regra
  CHECK (competence_date IS NULL OR competence_rule IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS fin_transaction_competencia_idx
  ON fin_transaction (competence_date) WHERE NOT is_split_parent;
CREATE INDEX IF NOT EXISTS fin_transaction_competencia_regra_idx
  ON fin_transaction (competence_rule);
CREATE INDEX IF NOT EXISTS fin_card_transaction_competencia_idx
  ON fin_card_transaction (competence_date);

-- ---------------------------------------------------------------------------
-- 3. A FUNÇÃO DE BACKFILL — idempotente, re-executável, respeita trava humana
-- ---------------------------------------------------------------------------
-- Devolve uma linha por regra com quantas linhas ela carimbou nesta execução.
-- Chamar duas vezes seguidas devolve zeros na segunda: é o teste de
-- idempotência mais barato que existe.
CREATE OR REPLACE FUNCTION fin_competencia_backfill(
  p_reavaliar_presumidas boolean DEFAULT true
) RETURNS TABLE (regra text, linhas bigint)
LANGUAGE plpgsql AS $$
BEGIN
  -- ---- ledger bancário ----------------------------------------------------
  RETURN QUERY
  WITH alvo AS (
    SELECT t.id
      FROM fin_transaction t
     WHERE NOT ('competence_date' = ANY (t.human_locked_fields))
       AND (t.competence_date IS NULL
            OR t.competence_rule IS NULL
            OR (p_reavaliar_presumidas AND t.competence_rule = 'competencia_presumida_caixa'))
  ),
  evidencia AS (
    SELECT t.id,
           t.posted_on,
           c.cash_flow_group,
           t.source_kind,
           -- Uma transação tem no máximo um settlement (conferido: 3.048 de
           -- 3.048 com n=1) e um documento tem no máximo uma nota AUTHORIZED
           -- (conferido: 2.814 de 2.814 com n=1). Sem risco de multiplicar linha.
           dr.direction  AS doc_direction,
           dr.due_date   AS doc_due,
           dr.issue_date AS doc_issue,
           fd.issue_date AS nfe_issue
      FROM fin_transaction t
      JOIN alvo a                  ON a.id = t.id
      LEFT JOIN fin_category c     ON c.id = t.category_id
      LEFT JOIN fin_settlement s   ON s.transaction_id = t.id
      LEFT JOIN fin_document dr    ON dr.id = s.document_id
      LEFT JOIN fin_fiscal_document fd
             ON fd.document_id = dr.id AND fd.status = 'AUTHORIZED'
  ),
  decidido AS (
    SELECT e.id,
           r.r,
           CASE r.r
             WHEN 'nota_fiscal_emissao'      THEN e.nfe_issue
             WHEN 'cobranca_vencimento'      THEN e.doc_due
             WHEN 'documento_fiscal_despesa' THEN e.doc_issue
             -- Folha: dia 1..5 pertence ao mês anterior. O último dia do mês
             -- anterior é uma data real e date_trunc('month', ...) devolve o
             -- mês certo — usar o dia 1 do mês anterior daria o mesmo mês e
             -- uma data que não corresponde a nada.
             WHEN 'folha_mes_referencia'     THEN
               CASE WHEN extract(day FROM e.posted_on) <= 5
                    THEN (date_trunc('month', e.posted_on) - INTERVAL '1 day')::date
                    ELSE e.posted_on END
             ELSE e.posted_on
           END AS nova_data
      FROM evidencia e
      CROSS JOIN LATERAL (
        SELECT CASE
             WHEN e.doc_direction = 'receber' AND e.nfe_issue IS NOT NULL
               THEN 'nota_fiscal_emissao'
             WHEN e.doc_direction = 'receber' AND e.doc_due IS NOT NULL
               THEN 'cobranca_vencimento'
             WHEN e.doc_direction = 'pagar'   AND e.doc_issue IS NOT NULL
               THEN 'documento_fiscal_despesa'
             WHEN e.cash_flow_group = 'pessoal'
               THEN 'folha_mes_referencia'
             WHEN e.source_kind IN ('PAYMENT_FEE', 'INVOICE_FEE',
                                    'PAYMENT_MESSAGING_NOTIFICATION_FEE',
                                    'INSTANT_TEXT_MESSAGE_FEE', 'TRANSFER_FEE',
                                    'CREDIT_BUREAU_REPORT')
               THEN 'tarifa_evento_no_caixa'
             WHEN e.cash_flow_group = 'movimentacao'
               THEN 'movimentacao_neutra'
             ELSE 'competencia_presumida_caixa'
           END AS r
      ) r
  ),
  aplicado AS (
    UPDATE fin_transaction t
       SET competence_rule = d.r,
           competence_date = d.nova_data,
           updated_at = now()
      FROM decidido d
     WHERE t.id = d.id
       -- Sem esta comparação a re-avaliação das presumidas reescreveria as 776
       -- linhas toda vez, mexendo em updated_at sem mudar nada. Idempotência é
       -- não gravar quando o resultado é igual, não só chegar no mesmo valor.
       AND (t.competence_rule IS DISTINCT FROM d.r
            OR t.competence_date IS DISTINCT FROM d.nova_data)
     RETURNING d.r AS r
  )
  SELECT a.r::text, count(*)::bigint FROM aplicado a GROUP BY a.r;

  -- ---- itens de cartão ----------------------------------------------------
  -- O custo do cartão compete na COMPRA. A fatura é liquidação, não despesa.
  RETURN QUERY
  WITH aplicado AS (
    UPDATE fin_card_transaction ct
       SET competence_rule = CASE
             WHEN ct.kind = 'pagamento_fatura'   THEN 'cartao_pagamento_fatura'
             WHEN ct.purchase_date IS NOT NULL   THEN 'cartao_data_compra'
             ELSE 'cartao_data_lancamento'
           END,
           competence_date = COALESCE(ct.purchase_date, ct.posted_on),
           updated_at = now()
     WHERE NOT ('competence_date' = ANY (ct.human_locked_fields))
       AND (ct.competence_date IS DISTINCT FROM COALESCE(ct.purchase_date, ct.posted_on)
            OR ct.competence_rule IS NULL)
     RETURNING (CASE
             WHEN ct.kind = 'pagamento_fatura'   THEN 'cartao_pagamento_fatura'
             WHEN ct.purchase_date IS NOT NULL   THEN 'cartao_data_compra'
             ELSE 'cartao_data_lancamento'
           END) AS r
  )
  SELECT a.r::text, count(*)::bigint FROM aplicado a GROUP BY a.r;
END;
$$;

COMMENT ON FUNCTION fin_competencia_backfill(boolean) IS
  'Preenche competence_date/competence_rule em fin_transaction e fin_card_transaction. '
  'Idempotente: a segunda execução seguida devolve zero linhas. Re-avalia as presumidas por '
  'padrão, porque uma linha sem evidência hoje pode ganhar nota amanhã. Nunca toca linha com '
  'competence_date em human_locked_fields.';

-- ---------------------------------------------------------------------------
-- 4. EXECUTA
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_antes  bigint;
  v_depois bigint;
  v_sem    bigint;
BEGIN
  SELECT count(*) INTO v_antes FROM fin_transaction WHERE competence_date IS NOT NULL;
  PERFORM * FROM fin_competencia_backfill(true);
  SELECT count(*) INTO v_depois FROM fin_transaction WHERE competence_date IS NOT NULL;
  SELECT count(*) INTO v_sem    FROM fin_transaction WHERE competence_date IS NULL;

  RAISE NOTICE 'competência: % → % lançamentos com data (% ainda sem)', v_antes, v_depois, v_sem;

  -- Nenhuma linha pode sobrar sem competência: a regra de fallback é total por
  -- construção (o ELSE do CASE). Se sobrar, o CASE tem um buraco.
  IF v_sem > 0 THEN
    RAISE EXCEPTION 'backfill deixou % lançamentos sem competência — o CASE tem lacuna', v_sem;
  END IF;
END $$;

ALTER TABLE fin_transaction      VALIDATE CONSTRAINT fin_transaction_competencia_tem_regra;
ALTER TABLE fin_card_transaction VALIDATE CONSTRAINT fin_card_transaction_competencia_tem_regra;

-- ---------------------------------------------------------------------------
-- 5. COBERTURA — a tabela que todo relatório de competência precisa publicar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_competencia_cobertura_v AS
WITH ledger AS (
  SELECT r.slug, r.name, r.confianca, r.fonte, r.precedencia, r.aplica_em,
         count(t.id)                       AS linhas,
         COALESCE(sum(t.amount_cents), 0)  AS valor_cents,
         count(*) FILTER (WHERE date_trunc('month', t.competence_date)
                             <> date_trunc('month', t.posted_on)) AS linhas_que_mudam_de_mes,
         COALESCE(sum(t.amount_cents) FILTER (WHERE date_trunc('month', t.competence_date)
                             <> date_trunc('month', t.posted_on)), 0) AS valor_que_muda_de_mes_cents,
         min(t.competence_date) AS de, max(t.competence_date) AS ate
    FROM fin_competence_rule r
    LEFT JOIN fin_transaction t
           ON t.competence_rule = r.slug AND NOT t.is_split_parent
   WHERE r.aplica_em = 'fin_transaction'
   GROUP BY r.slug, r.name, r.confianca, r.fonte, r.precedencia, r.aplica_em
),
cartao AS (
  SELECT r.slug, r.name, r.confianca, r.fonte, r.precedencia, r.aplica_em,
         count(ct.id)                        AS linhas,
         COALESCE(sum(-ct.amount_cents), 0)  AS valor_cents,
         count(*) FILTER (WHERE date_trunc('month', ct.competence_date)
                             <> date_trunc('month', ct.posted_on)) AS linhas_que_mudam_de_mes,
         COALESCE(sum(-ct.amount_cents) FILTER (WHERE date_trunc('month', ct.competence_date)
                             <> date_trunc('month', ct.posted_on)), 0) AS valor_que_muda_de_mes_cents,
         min(ct.competence_date) AS de, max(ct.competence_date) AS ate
    FROM fin_competence_rule r
    LEFT JOIN fin_card_transaction ct ON ct.competence_rule = r.slug
   WHERE r.aplica_em = 'fin_card_transaction'
   GROUP BY r.slug, r.name, r.confianca, r.fonte, r.precedencia, r.aplica_em
),
tudo AS (SELECT * FROM ledger UNION ALL SELECT * FROM cartao)
SELECT t.aplica_em,
       t.precedencia,
       t.slug        AS regra,
       t.name        AS regra_nome,
       t.confianca,
       t.fonte,
       t.linhas,
       round(100.0 * t.linhas / NULLIF(sum(t.linhas) OVER (PARTITION BY t.aplica_em), 0), 2) AS pct_linhas,
       t.valor_cents,
       t.linhas_que_mudam_de_mes,
       t.valor_que_muda_de_mes_cents,
       t.de, t.ate
  FROM tudo t
 ORDER BY t.aplica_em, t.precedencia;

COMMENT ON VIEW fin_competencia_cobertura_v IS
  'Quantas linhas e quanto dinheiro cada regra de competência cobre, e quanto muda de mês por '
  'causa dela. confianca=''presumida'' é a LACUNA: competência igual ao caixa por falta de '
  'evidência. Todo relatório que se apresenta como competência deve publicar esta view junto — '
  'sem ela o leitor não sabe qual fração do número é suposição.';

-- ---------------------------------------------------------------------------
-- 6. DEFASAGEM — quanto de resultado sai de um mês e entra em outro
-- ---------------------------------------------------------------------------
-- Serve para responder "por que a DRE por competência não bate com a por
-- caixa neste mês" sem abrir lançamento por lançamento.
CREATE OR REPLACE VIEW fin_competencia_defasagem_v AS
SELECT date_trunc('month', t.posted_on)::date       AS mes_caixa,
       date_trunc('month', t.competence_date)::date AS mes_competencia,
       t.competence_rule                            AS regra,
       r.confianca,
       count(*)                                     AS linhas,
       sum(t.amount_cents)                          AS valor_cents,
       round(avg(t.competence_date - t.posted_on)::numeric, 1) AS dias_medio
  FROM fin_transaction t
  JOIN fin_competence_rule r ON r.slug = t.competence_rule
 WHERE NOT t.is_split_parent
   AND date_trunc('month', t.posted_on) <> date_trunc('month', t.competence_date)
 GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW fin_competencia_defasagem_v IS
  'Só as linhas em que competência e caixa caem em meses diferentes — a explicação inteira da '
  'diferença entre as duas visões da DRE. Valor positivo é receita; negativo é despesa. '
  'dias_medio negativo significa que a competência é ANTERIOR ao caixa (nota emitida antes de o '
  'cliente pagar; folha do mês anterior paga no início do mês seguinte).';
