-- Desfaz a contraparte que era a própria empresa.
--
-- Bug do importador do Inter, corrigido em scripts/import-inter.mjs no mesmo
-- commit. Quando o dinheiro vem da Asaas para o Inter, o extrato traz
-- `nomePagador = 'ASAAS IP S.A.'` mas `cpfCnpjPagador` é o CNPJ da XP Energy —
-- quem move o próprio saldo é a empresa, não o gateway.
--
-- Como a chave de contraparte do importador é o documento, tudo que carregava o
-- CNPJ próprio colapsou numa contraparte só, que herdou o nome da primeira
-- transação a criá-la. Resultado: uma contraparte chamada "ASAAS IP S.A." com o
-- CNPJ da XP Energy, e 61 saídas do Inter (R$ 151.977,33) penduradas nela como
-- se fossem despesa com terceiro.
--
-- Estas linhas são o oposto do bug da regra 18: lá, transferência de verdade
-- escondia pagamento a terceiro; aqui, transferência de verdade está contada
-- como despesa. Os dois inflam o mesmo lado errado da DRE.

-- 1. Registra o estado anterior antes de mexer, para o rollback ser
--    reconstruível — mesmo padrão que o import do Asaas usa.
INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, actor)
SELECT t.entity_id,
       'fin_transaction',
       t.id,
       -- 'bulk_update' e não um verbo próprio: o CHECK de fin_audit_log só
       -- aceita insert/update/delete/bulk_update/import/rollback. O que a
       -- migration fez fica em `before` e no actor.
       'bulk_update',
       jsonb_build_object(
         'counterparty_id', t.counterparty_id,
         'transfer_status', t.transfer_status,
         'counterparty_raw', t.counterparty_raw
       ),
       'migration-0022'
  FROM fin_transaction t
  JOIN fin_counterparty c ON c.id = t.counterparty_id
  JOIN fin_entity e ON e.id = t.entity_id
 WHERE t.source = 'inter_api'
   AND c.document_number = e.cnpj;

-- 2. Solta os lançamentos e marca como transferência.
--
-- 'em_transito' e não 'pareado': a perna existe, mas a conciliação com a outra
-- ponta ainda não rodou. Dizer 'pareado' aqui seria afirmar um pareamento que
-- ninguém fez — e o CHECK fin_transaction_transfer_group exige
-- transfer_group_id, que só o motor de pareamento pode preencher.
UPDATE fin_transaction t
   SET counterparty_id = NULL,
       transfer_status = 'em_transito',
       updated_at = now()
  FROM fin_counterparty c, fin_entity e
 WHERE c.id = t.counterparty_id
   AND e.id = t.entity_id
   AND t.source = 'inter_api'
   AND c.document_number = e.cnpj;

-- 3. Remove a contraparte fantasma, se nada mais depender dela.
--
-- O DELETE é condicional de propósito: se algum outro lançamento (do Asaas, por
-- exemplo) tiver sido ligado a ela por outro caminho, apagar quebraria a FK e a
-- migration inteira falharia. Nesse caso ela fica, marcada como inativa.
UPDATE fin_counterparty c
   SET is_active = false,
       notes = COALESCE(c.notes || ' | ', '') || 'CNPJ da própria empresa: criada por bug do importador do Inter, corrigido em 0022'
  FROM fin_entity e
 WHERE e.id = c.entity_id
   AND c.document_number = e.cnpj;

DELETE FROM fin_counterparty c
 USING fin_entity e
 WHERE e.id = c.entity_id
   AND c.document_number = e.cnpj
   AND NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.counterparty_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM fin_document d WHERE d.counterparty_id = c.id);
