-- O que EU recebo — a superfície estreita que o app do time pode ler.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA VIEW PRÓPRIA, SE A 0160 JÁ EXISTE
-- ---------------------------------------------------------------------------
-- `fin_pessoa_remuneracao_v` foi feita para o FINANCEIRO: ela carrega o
-- `transaction_id`, que é a chave do lançamento no ledger. Isso é certo lá — a
-- tela de admin precisa poder ir do pagamento até a linha do extrato.
--
-- No app do time não é. O prefixo `/api/time` é o único caminho de escrita do
-- perfil comum, e o que o sustenta é ele não alcançar o ledger. Um id de
-- `fin_transaction` devolvido para o celular é exatamente o tipo de dado que
-- transforma uma tela de consulta numa ponte.
--
-- Esta view expõe o que a pessoa tem direito de saber sobre o PRÓPRIO dinheiro:
-- quanto, quando, de que natureza, por qual banco. Sem id de lançamento, sem
-- saldo de conta, sem nada de outra pessoa — o filtro por `person_id` é
-- responsabilidade de quem consulta, e `lib/financeiro/time.ts` só sabe o da
-- sessão.
--
-- ---------------------------------------------------------------------------
-- O BANCO APARECE, E ISSO É DELIBERADO
-- ---------------------------------------------------------------------------
-- "Inter" ou "Nubank" na linha do pagamento não é dado interno: é o que a
-- pessoa vê no extrato dela e o que permite casar "recebi isto" com "a empresa
-- diz que pagou aquilo". Esconder criaria uma conferência impossível.
-- ===========================================================================

CREATE OR REPLACE VIEW fin_time_recebivel_v AS
SELECT r.entity_id,
       r.person_id,
       r.data,
       r.mes,
       r.valor_cents,
       r.natureza,
       r.categoria,
       r.conta,
       -- A descrição do extrato, encurtada: ela ajuda a reconhecer o
       -- pagamento, e o texto inteiro do banco não cabe numa linha de celular.
       left(coalesce(r.descricao, ''), 120) AS descricao
  FROM fin_pessoa_remuneracao_v r;

COMMENT ON VIEW fin_time_recebivel_v IS
  'O que cada pessoa recebeu, para o APP do time ler sobre si mesma. Deriva de '
  'fin_pessoa_remuneracao_v sem o transaction_id: id de lançamento do ledger não desce para o '
  'celular. Quem consulta filtra por person_id da sessão — a view não filtra sozinha.';

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  colunas text;
  n integer;
BEGIN
  SELECT string_agg(column_name, ',') INTO colunas
    FROM information_schema.columns WHERE table_name = 'fin_time_recebivel_v';

  -- A prova que importa: nada de ledger atravessa.
  IF colunas ~ '(transaction_id|account_id|saldo|balance|document_id)' THEN
    RAISE EXCEPTION 'a view do time expõe chave do ledger: %', colunas;
  END IF;

  SELECT count(*) INTO n FROM fin_time_recebivel_v;
  IF n = 0 THEN RAISE EXCEPTION 'a view não devolveu nenhum recebimento'; END IF;

  -- E continua sendo só 2026+, herdado da 0160.
  SELECT count(*) INTO n FROM fin_time_recebivel_v WHERE data < DATE '2026-01-01';
  IF n <> 0 THEN RAISE EXCEPTION '% recebimento(s) anteriores a 2026', n; END IF;

  RAISE NOTICE 'fin_time_recebivel_v: % recebimento(s) para % pessoa(s)',
    (SELECT count(*) FROM fin_time_recebivel_v),
    (SELECT count(DISTINCT person_id) FROM fin_time_recebivel_v);
END $$;
