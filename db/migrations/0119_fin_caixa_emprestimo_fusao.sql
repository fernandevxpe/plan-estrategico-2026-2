-- caixa-emprestimo e caixa eram a MESMA conta da Caixa, cadastradas duas vezes.
--
-- ---------------------------------------------------------------------------
-- COMO ISSO ACONTECEU
-- ---------------------------------------------------------------------------
-- A 0110 criou `caixa-emprestimo` (kind='emprestimo') como âncora para o
-- passivo do Pronampe E para o saldo declarado da conta corrente de onde
-- saem as prestações — as duas coisas na mesma linha de fin_account.
--
-- A 0113, sem saber disso, criou `caixa` (kind='conta_corrente') para o
-- Open Finance da Caixa. O Fernando confirmou em produção: a chave gravada
-- no contrato (`fin_emprestimo.conta_destino_chave` =
-- 'caixa-economica-12920000005783083433') decodifica para ag. 5069, op.
-- 1292, cc. 578308343-3 — exatamente a conta que ele passou por mensagem, e
-- a mesma conta que `caixa` foi criada para representar. Duas linhas de
-- fin_account para um único número de conta.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- 1. O saldo declarado (R$ 707,00, a sobra depois de pagar a prestação) muda
--    de dono: sai de caixa-emprestimo e vai para caixa.
-- 2. fin_emprestimo.account_id muda de caixa-emprestimo para caixa — o
--    passivo do Pronampe passa a aparecer na conta certa.
-- 3. caixa-emprestimo é desativada (nunca apagada: zero lançamentos nela,
--    conferido antes de escrever isto, e apagar destruiria a proveniência
--    do que já foi decidido nela nas migrations 0110/0111/0112).
--
-- fin_caixa_conta_v (0118) não precisa mudar: ela já é genérica — junta
-- saldo declarado e passivo do empréstimo por account_id, não por slug. O
-- efeito aparece sozinho assim que os dados apontam para `caixa`.
--
-- Quando o Open Finance da Caixa autorizar e trouxer extrato real, o saldo
-- reconstruído por ledger assume automaticamente sobre o declarado — mesma
-- regra que já vale para qualquer outra conta (fin_caixa_conta_v: ledger
-- vence quando existe).

DO $$
DECLARE
  v_caixa_id bigint;
  v_emprestimo_conta_id bigint;
  v_transacoes integer;
BEGIN
  SELECT id INTO v_caixa_id FROM fin_account WHERE slug = 'caixa';
  SELECT id INTO v_emprestimo_conta_id FROM fin_account WHERE slug = 'caixa-emprestimo';

  IF v_caixa_id IS NULL OR v_emprestimo_conta_id IS NULL THEN
    RAISE EXCEPTION '[0119] contas caixa ou caixa-emprestimo não encontradas — a 0113/0110 mudaram?';
  END IF;

  -- Pré-condição: a conta antiga nunca teve lançamento. Se algum dia tiver,
  -- esta fusão silenciosa esconderia extrato de verdade — e a migration
  -- para em vez de arriscar isso.
  SELECT count(*) INTO v_transacoes FROM fin_transaction WHERE account_id = v_emprestimo_conta_id;
  IF v_transacoes > 0 THEN
    RAISE EXCEPTION '[0119] caixa-emprestimo tem % lançamento(s) — fusão não é mais segura sem revisão', v_transacoes;
  END IF;

  UPDATE fin_saldo_declarado
     SET account_id = v_caixa_id
   WHERE account_id = v_emprestimo_conta_id;

  UPDATE fin_emprestimo
     SET account_id = v_caixa_id
   WHERE account_id = v_emprestimo_conta_id;

  UPDATE fin_account
     SET is_active = false,
         name = 'Caixa — Empréstimo (mesclada em ''caixa'', ver 0119)'
   WHERE id = v_emprestimo_conta_id;
END $$;

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n integer; v_saldo bigint; v_passivo bigint;
BEGIN
  -- 1. caixa-emprestimo desativada, sem lançamento nenhum criado por engano.
  SELECT count(*) INTO v_n FROM fin_account WHERE slug = 'caixa-emprestimo' AND is_active;
  IF v_n > 0 THEN
    RAISE EXCEPTION '[0119] caixa-emprestimo continua ativa';
  END IF;
  SELECT count(*) INTO v_n FROM fin_transaction t
    JOIN fin_account a ON a.id = t.account_id WHERE a.slug = 'caixa-emprestimo';
  IF v_n > 0 THEN
    RAISE EXCEPTION '[0119] caixa-emprestimo ganhou lançamento nesta migration';
  END IF;

  -- 2. caixa (a sobrevivente) carrega os R$ 707,00 declarados e o passivo do
  --    Pronampe ao mesmo tempo — sem os dois números se confundirem.
  SELECT saldo_cents, passivo_saldo_devedor_cents INTO v_saldo, v_passivo
    FROM fin_caixa_conta_v WHERE slug = 'caixa';
  IF v_saldo IS DISTINCT FROM 70700 THEN
    RAISE EXCEPTION '[0119] caixa devia mostrar R$ 707,00 declarado, mostrou %', v_saldo;
  END IF;
  IF v_passivo IS NULL OR v_passivo <= 0 THEN
    RAISE EXCEPTION '[0119] caixa perdeu a visibilidade do passivo do Pronampe';
  END IF;
  IF v_saldo = v_passivo THEN
    RAISE EXCEPTION '[0119] saldo declarado e passivo do empréstimo colidiram no mesmo valor — revisar';
  END IF;

  -- 3. caixa-aplicacao não foi tocada por esta fusão.
  SELECT saldo_cents INTO v_saldo FROM fin_caixa_conta_v WHERE slug = 'caixa-aplicacao';
  IF v_saldo IS DISTINCT FROM 3300000 THEN
    RAISE EXCEPTION '[0119] caixa-aplicacao mudou de valor sem motivo desta migration';
  END IF;

  -- 4. Só uma linha de fin_emprestimo, e ela aponta para caixa agora.
  SELECT count(*) INTO v_n FROM fin_emprestimo e
    JOIN fin_account a ON a.id = e.account_id WHERE a.slug = 'caixa';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0119] fin_emprestimo não migrou para caixa como esperado';
  END IF;

  -- 5. Seis contas ativas agora, não sete.
  SELECT count(*) INTO v_n FROM fin_account WHERE is_active;
  IF v_n <> 6 THEN
    RAISE EXCEPTION '[0119] esperava 6 contas ativas após a fusão, achei %', v_n;
  END IF;

  RAISE NOTICE '[0119] caixa-emprestimo mesclada em caixa: saldo declarado R$ 707,00 + passivo do Pronampe R$ %', to_char(v_passivo / 100.0, 'FM999G999G999D00');
END $$;
