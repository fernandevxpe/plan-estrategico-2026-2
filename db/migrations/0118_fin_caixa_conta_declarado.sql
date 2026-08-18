-- fin_caixa_conta_v esqueceu do saldo declarado.
--
-- ---------------------------------------------------------------------------
-- O BUG
-- ---------------------------------------------------------------------------
-- A 0111 e a 0112 criaram fin_saldo_declarado e fin_conta_saldo_v para que
-- caixa-aplicacao (R$ 33.000,00) e caixa-emprestimo (R$ 707,00) parassem de
-- aparecer como indeterminadas — elas nao tem extrato, mas TEM saldo que uma
-- pessoa conferiu no banco e declarou, com data, autor e fonte.
--
-- A 0110, porem, ja tinha criado fin_caixa_conta_v ANTES da 0111/0112
-- existirem, e ninguem voltou para ensinar essa view sobre o saldo
-- declarado. A tela /financeiro/caixa le fin_caixa_conta_v (via
-- lib/financeiro/contratos/caixa.ts), nao fin_conta_saldo_v — entao as duas
-- contas continuaram "indeterminado" na tela, apesar do dado declarado
-- existir no banco desde a mesma sessao. Achado pelo Fernando em producao.
--
-- ---------------------------------------------------------------------------
-- O CONSERTO
-- ---------------------------------------------------------------------------
-- fin_caixa_conta_v ganha o mesmo LEFT JOIN LATERAL que a fin_conta_saldo_v
-- ja usa (0112): quando NAO ha cobertura de extrato (mv.lancamentos = 0), cai
-- para o saldo declarado mais recente daquela conta, se houver. Quando ha
-- extrato, nada muda — reconstrucao por ledger continua vencendo, como
-- sempre venceu.
--
-- saldo_origem e novo: 'reconstruido' | 'declarado' | NULL, para a tela
-- poder rotular a diferenca em vez de fingir que as duas fontes sao a
-- mesma coisa.
--
-- caixa-emprestimo merece uma nota: o saldo declarado dela (R$ 707,00) e o
-- saldo da CONTA CORRENTE de onde saem as prestacoes do Pronampe — nao e o
-- saldo DEVEDOR do contrato. Esses dois numeros nunca se misturam: o
-- devedor continua em passivo_saldo_devedor_cents, coluna separada, como a
-- 0110 ja garantia.
--
-- caixa (a 7a conta, criada pela 0113 para o Open Finance da Caixa) NAO tem
-- saldo declarado e continua indeterminada — corretamente: essa conta e
-- nova, sem extrato e sem declaracao, nao ha nada a mostrar nela ainda.

CREATE OR REPLACE VIEW fin_caixa_conta_v AS
SELECT
  a.id                                AS account_id,
  a.slug,
  a.name,
  a.institution,
  a.kind,
  a.is_active,
  a.opening_balance_date,
  a.last_statement_at,
  mv.lancamentos,
  mv.primeiro_movimento,
  mv.ultimo_movimento,
  CASE
    WHEN mv.lancamentos > 0 THEN (a.opening_balance_cents + mv.soma_cents)::bigint
    WHEN decl.saldo_cents IS NOT NULL THEN decl.saldo_cents
    ELSE NULL
  END                                 AS saldo_cents,
  CASE
    WHEN mv.lancamentos > 0 THEN NULL
    WHEN decl.saldo_cents IS NOT NULL THEN NULL
    WHEN a.kind = 'emprestimo'
      THEN 'conta de debito do Pronampe: nunca teve extrato neste acervo. '
           || 'O que se sabe dela e o saldo DEVEDOR do contrato, que e '
           || 'passivo e nao entra aqui.'
    ELSE 'sem extrato: nenhuma fonte deste acervo alimenta esta conta. '
         || 'Ausencia de dado nao e saldo zero.'
  END                                 AS motivo_sem_saldo,
  (mv.lancamentos > 0)                AS tem_cobertura,
  -- Passivo associado, quando houver. Fica em coluna SEPARADA de proposito:
  -- somar isso a saldo_cents seria dizer que a divida e dinheiro.
  emp.saldo_devedor_cents             AS passivo_saldo_devedor_cents,
  emp.ccb                             AS passivo_ccb,
  emp.natureza                        AS passivo_natureza,
  emp.memoria                         AS passivo_memoria,
  -- Colunas novas desta migration vao ao FIM de proposito: CREATE OR REPLACE
  -- VIEW recusa mudar a posicao de uma coluna existente, so aceita apendice.
  CASE
    WHEN mv.lancamentos > 0 THEN 'reconstruido'
    WHEN decl.saldo_cents IS NOT NULL THEN 'declarado'
    ELSE NULL
  END                                 AS saldo_origem,
  decl.declarado_em                   AS saldo_declarado_em,
  decl.declarado_por                  AS saldo_declarado_por,
  decl.fonte                          AS saldo_declarado_fonte
FROM fin_account a
LEFT JOIN LATERAL (
  SELECT count(*) AS lancamentos, sum(t.amount_cents) AS soma_cents,
         min(t.posted_on) AS primeiro_movimento, max(t.posted_on) AS ultimo_movimento
    FROM fin_transaction t
   WHERE t.account_id = a.id AND NOT t.is_split_parent
) mv ON true
LEFT JOIN LATERAL (
  SELECT s.saldo_cents, s.declarado_em, s.declarado_por, s.fonte
    FROM fin_saldo_declarado s
   WHERE s.account_id = a.id
   ORDER BY s.declarado_em DESC
   LIMIT 1
) decl ON true
LEFT JOIN fin_emprestimo_saldo_v emp ON emp.emprestimo_id = (
  SELECT e2.id FROM fin_emprestimo e2 WHERE e2.account_id = a.id LIMIT 1)
WHERE a.is_active;

COMMENT ON VIEW fin_caixa_conta_v IS
  'Saldo de hoje por conta. Reconstruido do extrato quando ha cobertura; '
  'senao, cai para o saldo declarado (fin_saldo_declarado) quando existir; '
  'senao, NULL com motivo — nunca zero. saldo_origem diz qual dos dois foi '
  'usado. O passivo do emprestimo vem em coluna separada e nao soma.';

-- ---------------------------------------------------------------------------
-- Pos-condicoes
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n integer;
BEGIN
  -- 1. As 4 contas com extrato continuam batendo com current_balance_cents —
  --    este conserto nao pode mexer em uma reconstrucao que ja funcionava.
  SELECT count(*) INTO v_n
    FROM fin_caixa_conta_v c
    JOIN fin_account a ON a.id = c.account_id
   WHERE c.saldo_origem = 'reconstruido' AND c.saldo_cents <> a.current_balance_cents;
  IF v_n > 0 THEN
    RAISE EXCEPTION '[0118] % conta(s) reconstruida(s) divergiram de current_balance_cents', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM fin_caixa_conta_v WHERE saldo_origem = 'reconstruido';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0118] % conta(s) reconstruida(s), esperava 4', v_n;
  END IF;

  -- 2. caixa-aplicacao e caixa-emprestimo saem de indeterminado para declarado,
  --    com os valores exatos que o Fernando conferiu no banco.
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE slug = 'caixa-aplicacao' AND saldo_origem = 'declarado' AND saldo_cents = 3300000;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0118] caixa-aplicacao nao ficou declarada em R$ 33.000,00';
  END IF;

  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE slug = 'caixa-emprestimo' AND saldo_origem = 'declarado' AND saldo_cents = 70700;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0118] caixa-emprestimo nao ficou declarada em R$ 707,00';
  END IF;

  -- 3. O passivo do Pronampe continua vivo e separado do saldo declarado da
  --    conta corrente — os dois numeros nao podem ter se fundido.
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE slug = 'caixa-emprestimo' AND passivo_saldo_devedor_cents IS NOT NULL
     AND passivo_saldo_devedor_cents <> saldo_cents;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0118] passivo do Pronampe sumiu ou se fundiu com o saldo declarado';
  END IF;

  -- 4. caixa (a conta nova do Open Finance) continua genuinamente
  --    indeterminada — nao ganhou saldo por acidente deste conserto.
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE slug = 'caixa' AND saldo_cents IS NULL AND saldo_origem IS NULL
     AND motivo_sem_saldo IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0118] a conta caixa deveria continuar indeterminada';
  END IF;

  -- 5. Nenhuma conta ativa fica sem saldo E sem motivo ao mesmo tempo.
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE saldo_cents IS NULL AND (motivo_sem_saldo IS NULL OR length(btrim(motivo_sem_saldo)) = 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION '[0118] % conta(s) sem saldo e sem motivo declarado', v_n;
  END IF;

  RAISE NOTICE '[0118] fin_caixa_conta_v: 4 reconstruidas, 2 declaradas, 1 indeterminada — 7/7 contas';
END $$;
