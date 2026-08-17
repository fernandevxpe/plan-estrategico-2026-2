-- Desfaz a escrita de saldo declarado em `current_balance_cents`.
--
-- ---------------------------------------------------------------------------
-- O QUE EU QUEBREI, E POR QUE O INVARIANTE ESTAVA CERTO
-- ---------------------------------------------------------------------------
-- A 0111 gravou os saldos que o Fernando conferiu no app do banco
-- (R$ 33.000,00 e R$ 707,00) direto em `fin_account.current_balance_cents`.
-- O invariante G1 passou a falhar, e ele tem razão:
--
--   G1: "current_balance_cents é reconstruível a partir do ledger"
--
-- Esse é o CONTRATO da coluna. Ela não é "o saldo", é "o saldo que o ledger
-- sustenta" — e é isso que permite conferir a plataforma contra si mesma. Um
-- número que ninguém pode recalcular, gravado ali, transforma a coluna em algo
-- que às vezes se confere e às vezes não. Uma garantia que vale às vezes não é
-- garantia.
--
-- O saldo declarado não é pior que o reconstruído; é OUTRA COISA. Fica em
-- `fin_saldo_declarado`, que a 0111 criou justamente para isso, com data,
-- autor e fonte. As telas leem os dois e mostram cada um pelo que é.
--
-- Foi o mesmo erro que esta base já cometeu na direção oposta: as duas contas
-- "fechavam" trivialmente em R$ 0,00 e inflavam o 6/6. A saída não é escolher
-- entre esconder e mentir — é ter as duas informações separadas.

DO $$
DECLARE v_n int;
BEGIN
  UPDATE fin_account a
     SET current_balance_cents = 0
    FROM fin_entity e
   WHERE a.entity_id = e.id AND e.slug = 'xpe'
     AND a.slug IN ('caixa-aplicacao', 'caixa-emprestimo')
     AND a.current_balance_cents <> 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '[0112] % conta(s) devolvidas a saldo reconstruído; o declarado segue em fin_saldo_declarado', v_n;
END $$;

-- Pós-condição: G1 volta a valer para as duas, e o declarado continua vivo.
DO $$
DECLARE v_div int; v_decl int;
BEGIN
  SELECT count(*) INTO v_div
    FROM fin_account a
   WHERE a.slug IN ('caixa-aplicacao','caixa-emprestimo')
     AND a.current_balance_cents <> 0;
  IF v_div > 0 THEN
    RAISE EXCEPTION '[0112] % conta(s) ainda com saldo não reconstruível na coluna', v_div;
  END IF;

  SELECT count(*) INTO v_decl FROM fin_saldo_declarado;
  IF v_decl < 2 THEN
    RAISE EXCEPTION '[0112] o saldo declarado sumiu — eram 2 registros, restaram %', v_decl;
  END IF;
  RAISE NOTICE '[0112] % saldo(s) declarado(s) preservado(s)', v_decl;
END $$;

-- ---------------------------------------------------------------------------
-- A view que junta os dois sem confundi-los
-- ---------------------------------------------------------------------------
-- `saldo_cents` é o melhor número conhecido para cada conta; `saldo_origem`
-- diz de onde ele veio. Quem soma o consolidado usa o primeiro; quem precisa
-- saber se pode confiar usa o segundo. Sem a segunda coluna, a primeira volta
-- a ser o número anônimo que esta migration existe para não criar.
CREATE OR REPLACE VIEW fin_conta_saldo_v AS
SELECT a.id,
       a.entity_id,
       a.slug,
       a.name,
       a.kind,
       a.is_active,
       a.current_balance_cents                     AS saldo_reconstruido_cents,
       d.saldo_cents                               AS saldo_declarado_cents,
       d.declarado_em,
       d.declarado_por,
       d.fonte                                     AS declarado_fonte,
       COALESCE(d.saldo_cents, a.current_balance_cents) AS saldo_cents,
       CASE
         WHEN d.saldo_cents IS NOT NULL THEN 'declarado'
         ELSE 'reconstruido'
       END                                         AS saldo_origem,
       CASE
         WHEN d.saldo_cents IS NOT NULL
           THEN 'saldo informado por ' || d.declarado_por || ' em ' || d.declarado_em
                || ' (' || d.fonte || ') — não há extrato para reconstruir'
         ELSE NULL
       END                                         AS saldo_motivo
  FROM fin_account a
  LEFT JOIN LATERAL (
    SELECT s.saldo_cents, s.declarado_em, s.declarado_por, s.fonte
      FROM fin_saldo_declarado s
     WHERE s.account_id = a.id
     ORDER BY s.declarado_em DESC
     LIMIT 1
  ) d ON true;

COMMENT ON VIEW fin_conta_saldo_v IS
  'Saldo por conta com a procedência ao lado. `saldo_cents` é o melhor número conhecido; '
  '`saldo_origem` diz se ele foi reconstruído do ledger (conferível) ou declarado por uma '
  'pessoa (não conferível por recálculo). Somar sem olhar a origem é o erro que esta view '
  'existe para tornar difícil.';
