-- Tudo que a casa paga a cada pessoa, num lugar só.
--
-- ---------------------------------------------------------------------------
-- O HISTÓRICO JÁ EXISTIA — FALTAVA UMA PORTA
-- ---------------------------------------------------------------------------
-- O Fernando pediu "histórico de salário, comissão, extras, reembolso, tudo
-- por pessoa, para rastrear e prever". A tentação era criar tabelas para
-- guardar isso. Seria errado: o dado já está em `fin_transaction`, ligado à
-- pessoa por `fin_person.counterparty_id` — que está preenchido nas 26 pessoas
-- ativas, conferido.
--
-- Medido em 2026: 6.01 Salários R$ 281.059, 6.02 Pró-labore R$ 325.567,
-- 6.05 Reembolsos R$ 20.130, 4.01 Comissão R$ 33.294. Nada disso precisa ser
-- redigitado; precisa ser LIDO por pessoa e por mês, que é o que não havia.
--
-- Guardar de novo criaria duas verdades sobre o mesmo pagamento, e a segunda
-- envelheceria em silêncio.
--
-- ---------------------------------------------------------------------------
-- POR QUE DE 2026 EM DIANTE
-- ---------------------------------------------------------------------------
-- Decisão do Fernando, e ela é boa: 2026 é o primeiro ano com a base
-- conciliada. Antes disso os dados vieram de importação e a categorização é
-- irregular — misturar os dois períodos faria a série mensal ter degraus que
-- são de qualidade de dado, não de decisão de negócio.
--
-- ---------------------------------------------------------------------------
-- O QUE É "EXTRA"
-- ---------------------------------------------------------------------------
-- Não é uma categoria; é o que sobra. Salário e pró-labore são recorrentes e
-- previsíveis; comissão varia com venda; reembolso é devolução, não
-- remuneração. Qualquer outro pagamento à pessoa cai em `extra` — e vê-lo
-- separado é o ponto: é ali que mora o que ninguém programou.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_pessoa_remuneracao_v AS
SELECT p.entity_id,
       p.id                                   AS person_id,
       p.name                                 AS pessoa,
       t.id                                   AS transaction_id,
       t.posted_on                            AS data,
       date_trunc('month', t.posted_on)::date AS mes,
       (-t.amount_cents)::bigint              AS valor_cents,
       cat.code                               AS categoria_code,
       cat.name                               AS categoria,
       -- A natureza, que é como a tela agrupa e como a previsão separa o que
       -- se repete do que não se repete.
       CASE
         WHEN cat.code = '6.01' THEN 'salario'
         WHEN cat.code = '6.02' THEN 'prolabore'
         WHEN cat.code = '6.06' THEN 'estagio'
         WHEN cat.code = '4.01' THEN 'comissao'
         WHEN cat.code = '6.05' THEN 'reembolso'
         WHEN cat.code IN ('6.03', '6.04') THEN 'encargo_beneficio'
         ELSE 'extra'
       END                                    AS natureza,
       coalesce(a.name, 'conta não identificada') AS conta,
       a.slug                                 AS conta_slug,
       coalesce(t.description_raw, t.description_norm, '') AS descricao
  FROM fin_transaction t
  JOIN fin_counterparty cp ON cp.id = t.counterparty_id
  JOIN fin_person p        ON p.counterparty_id = cp.id
  LEFT JOIN fin_category cat ON cat.id = t.category_id
  LEFT JOIN fin_account a    ON a.id = t.account_id
 WHERE t.amount_cents < 0
   AND t.posted_on >= DATE '2026-01-01'
   -- Transferência entre contas da casa não é pagamento a ninguém.
   AND coalesce(t.transfer_status, 'nao') = 'nao';

COMMENT ON VIEW fin_pessoa_remuneracao_v IS
  'Tudo que a casa pagou a cada pessoa de 2026 em diante, com natureza (salário, pró-labore, '
  'comissão, reembolso, encargo, extra), mês e conta de origem. LEITURA de fin_transaction — não '
  'guarda nada: o pagamento já está no ledger, e uma segunda cópia envelheceria em silêncio.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  v bigint;
BEGIN
  SELECT count(*) INTO n FROM fin_pessoa_remuneracao_v;
  IF n = 0 THEN RAISE EXCEPTION 'a view não devolveu nenhum pagamento — o vínculo pessoa↔contraparte quebrou?'; END IF;

  -- Nada de 2025 para trás pode vazar: a série mensal da tela assume 2026+.
  SELECT count(*) INTO n FROM fin_pessoa_remuneracao_v WHERE data < DATE '2026-01-01';
  IF n <> 0 THEN RAISE EXCEPTION '% pagamento(s) anteriores a 2026 na view', n; END IF;

  -- Valor sempre positivo: a view inverte o sinal do ledger, e um negativo
  -- aqui viraria soma errada na tela sem ninguém perceber.
  SELECT count(*) INTO n FROM fin_pessoa_remuneracao_v WHERE valor_cents <= 0;
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) com valor não positivo', n; END IF;

  -- E o total por natureza tem de bater com o total geral: se um CASE novo
  -- ficar sem rótulo, ele cai em 'extra' — nunca some.
  SELECT count(*) INTO n FROM fin_pessoa_remuneracao_v WHERE natureza IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) sem natureza', n; END IF;

  SELECT sum(valor_cents) INTO v FROM fin_pessoa_remuneracao_v;
  RAISE NOTICE 'fin_pessoa_remuneracao_v: % pagamento(s), R$ %, para % pessoa(s)',
    (SELECT count(*) FROM fin_pessoa_remuneracao_v),
    round(v / 100.0, 2),
    (SELECT count(DISTINCT person_id) FROM fin_pessoa_remuneracao_v);
END $$;
