-- Transação anulada não é receita — mas fin_revenue_cash_v não sabia disso.
--
-- ---------------------------------------------------------------------------
-- COMO ACHEI
-- ---------------------------------------------------------------------------
-- O Fernando trouxe uma planilha manual de faturamento mensal 2026 pra
-- conferir contra o sistema. Fevereiro bateu ao centavo; maio divergia por
-- R$ 10.300,00 e abril por parte de R$ 4.574,03 — os dois valores redondos,
-- cheirando a lançamento específico, não a ruído espalhado.
--
-- Achado: dois lançamentos "Estorno de transação via Pix" (Asaas), positivos,
-- categoria "Estornos e devoluções" — que o próprio catálogo já registra como
-- dedução de receita (fin_category.kind = 'deducao_receita', dre_line =
-- 'deducoes'), mas cujo toc_class está em 'throughput_receita'. E mais: os
-- dois lançamentos têm fin_transaction.transfer_status = 'anulado' — o ledger
-- já sabia que essas transações foram anuladas, e mesmo assim
-- fin_revenue_cash_v somava.
--
-- Medido no banco inteiro: 8 lançamentos têm transfer_status='anulado' no
-- total (é raro — comparado a 13.303 'nao', 368 'pareado', 245 'em_transito').
-- Positivos e com categoria/fonte que hoje entram como receita: 4. Dois em
-- 2026 (os que a planilha pegou), dois em 2025 (mesmo defeito, fora da janela
-- que o Fernando conferiu, corrigidos juntos porque é o mesmo bug).
--
-- ---------------------------------------------------------------------------
-- O CONSERTO
-- ---------------------------------------------------------------------------
-- A view já excluía transfer_status = 'pareado' (transferência entre contas
-- próprias, identificada e casada). 'anulado' merece o mesmo tratamento, pela
-- mesma razão: o ledger já concluiu que aquele dinheiro não é o que a
-- descrição diz. Não mexi em fin_category.toc_class de propósito — a
-- categoria pode legitimamente ter lançamento válido além dos anulados, e
-- trocar o toc_class dela mudaria a leitura de QUALQUER outro estorno futuro
-- que não seja anulado. O filtro por transfer_status é mais estreito e mais
-- correto: só tira o que o próprio sistema já marcou como não-acontecido.

CREATE OR REPLACE VIEW fin_revenue_cash_v AS
 SELECT t.entity_id,
    t.posted_on,
    date_trunc('month'::text, t.posted_on::timestamp with time zone)::date AS month,
    t.nucleo,
    t.category_id,
    t.counterparty_id,
    t.amount_cents
   FROM fin_transaction t
     LEFT JOIN fin_category c ON c.id = t.category_id
  WHERE t.amount_cents > 0
    AND t.transfer_status <> 'pareado'::text
    AND t.transfer_status <> 'anulado'::text
    AND NOT t.is_split_parent
    AND (c.toc_class = 'throughput_receita'::text OR t.category_id IS NULL AND t.source_kind = 'PAYMENT_RECEIVED'::text);

COMMENT ON VIEW fin_revenue_cash_v IS
  'Receita em regime de caixa. Exclui transferência entre contas próprias (pareado) e '
  'transação que o próprio ledger marcou como anulada (transfer_status=''anulado'') — as '
  'duas são dinheiro que passou pela conta sem ser venda. NÃO é o número da DRE (ver '
  'fin_dre_mensal_v, regime de competência e caixa separados).';

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n integer; v_maio bigint; v_fev bigint;
BEGIN
  -- 1. Os 4 estornos anulados (2 de 2026, 2 de 2025) que hoje contaminavam a
  --    receita não têm mais como entrar: a condição da própria view já os
  --    exclui, e a contagem abaixo prova que eles continuam existindo no
  --    ledger (não sumiram) e continuam batendo no filtro que a view usa.
  SELECT count(*) INTO v_n FROM fin_transaction
   WHERE id IN (1363, 993, 4072, 3716) AND transfer_status = 'anulado' AND amount_cents > 0;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0123] esperava achar os 4 lançamentos anulados conhecidos, achei %', v_n;
  END IF;

  -- 2. Fevereiro/2026 continua batendo ao centavo com a planilha do Fernando
  --    (R$ 150.232,98) — a correção não pode ter mexido no que já estava certo.
  SELECT sum(amount_cents) INTO v_fev FROM fin_revenue_cash_v
   WHERE month = '2026-02-01';
  IF v_fev IS DISTINCT FROM 15023298 THEN
    RAISE EXCEPTION '[0123] fevereiro/2026 mudou de R$ 150.232,98 para %, e não devia', v_fev;
  END IF;

  -- 3. Maio/2026 cai exatamente os R$ 10.300,00 do estorno anulado.
  SELECT sum(amount_cents) INTO v_maio FROM fin_revenue_cash_v
   WHERE month = '2026-05-01';
  IF v_maio IS DISTINCT FROM 15214038 THEN
    RAISE EXCEPTION '[0123] maio/2026 devia cair para R$ 152.140,38 (bate com a planilha do Fernando), deu %', v_maio;
  END IF;

  RAISE NOTICE '[0123] fin_revenue_cash_v exclui anulado — maio/2026 agora R$ 152.140,38, fevereiro intacto';
END $$;
