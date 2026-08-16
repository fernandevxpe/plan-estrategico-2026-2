-- O erp-obras entra como procedência declarada do ledger.
--
-- `fin_transaction.source` é um CHECK fechado desde 0002 — asaas, import_csv,
-- import_ofx, inter_api, manual — e foi ele que barrou a primeira tentativa de
-- promover o espelho, antes de qualquer linha entrar. É o comportamento certo:
-- procedência é vocabulário controlado, e uma origem nova é decisão de modelo,
-- não efeito colateral de um script.
--
-- POR QUE 'erp_obras' E NÃO 'polp'
--
-- O dado nasce no Polp (open finance do Nubank), mas não é de lá que ele chega
-- aqui: chega do banco do erp-obras, que ingere o Polp, classifica e atribui
-- projeto. Declarar 'polp' diria que falamos com a API direto — e no dia em que
-- isso for verdade, a distinção importa para saber o que reprocessar.
--
-- A procedência responde "de quem eu recebi", não "quem produziu lá atrás".
-- Quando a ingestão passar a ser direta, entra 'polp' ao lado, e as linhas
-- antigas continuam dizendo a verdade sobre como entraram.

ALTER TABLE fin_transaction DROP CONSTRAINT IF EXISTS fin_transaction_source_check;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_source_check
  CHECK (source IN ('asaas', 'import_csv', 'import_ofx', 'inter_api', 'manual', 'erp_obras'));

COMMENT ON COLUMN fin_transaction.source IS
  'De quem esta linha foi recebida. asaas/inter_api = API do próprio banco. import_csv/ofx = '
  'arquivo. manual = digitada. erp_obras = espelho do erp-obras, que por sua vez lê o Polp '
  '(open finance do Nubank). Não é "quem produziu o dado na origem" — é por onde ele entrou, '
  'que é o que diz o que reprocessar quando uma fonte muda.';
