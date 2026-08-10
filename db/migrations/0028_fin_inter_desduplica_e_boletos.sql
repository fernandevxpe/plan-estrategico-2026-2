-- Duas correções de erros meus na entrada do Inter.
--
-- 1. MARÇO ESTAVA EM DOBRO.
--
-- A conta do Inter já tinha o lote 7 (`inter_csv`, 79 linhas, 02→24/03/2026,
-- -R$ 61.452,64), importado por arquivo antes de existir a API. Ao trazer o
-- histórico pela API eu não verifiquei sobreposição: o lote 17 cobre
-- 01/01→04/08 e traz, no mesmo intervalo de março, exatamente 79 linhas
-- somando exatamente -R$ 61.452,64. São as mesmas.
--
-- A deduplicação por `dedupe_hash` não pega: o hash do CSV é derivado de
-- conta+data+valor+descrição+ordinal, e o da API de `accountSlug|id:idTransacao`
-- (fin-normalize.mjs:128). Bases diferentes, hashes diferentes, mesma
-- transação. O `dedupe_hash` protege contra reimportar a MESMA fonte, nunca
-- contra duas fontes descrevendo o mesmo fato.
--
-- Fica a versão da API: ela traz `idTransacao`, `cpfCnpjRecebedor`,
-- `nomeRecebedor` e `endToEndId` — o CSV traz texto livre. Vence a fonte mais
-- rica, não a mais antiga.

-- Trilha completa das linhas que serão removidas: sem isto não há como
-- reconstruir o que o CSV dizia.
INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, actor)
SELECT t.entity_id, 'fin_transaction', t.id, 'delete',
       to_jsonb(t) - 'created_at' - 'updated_at',
       'migration-0028'
  FROM fin_transaction t
  JOIN fin_import_batch b ON b.id = t.import_batch_id
 WHERE b.adapter = 'inter_csv'
   AND b.status = 'confirmado'
   -- Só remove o que a API de fato cobre. Se um dia o CSV tiver período que a
   -- API não alcança, aquelas linhas ficam.
   AND EXISTS (
     SELECT 1 FROM fin_transaction api
      WHERE api.account_id = t.account_id
        AND api.source = 'inter_api'
        AND api.posted_on = t.posted_on
        AND api.amount_cents = t.amount_cents
   )
   AND t.human_locked_fields = '{}';

-- Solta dependências antes de apagar.
DELETE FROM fin_review_item ri
 USING fin_transaction t, fin_import_batch b
 WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id
   AND b.id = t.import_batch_id AND b.adapter = 'inter_csv' AND b.status = 'confirmado'
   AND t.human_locked_fields = '{}'
   AND EXISTS (SELECT 1 FROM fin_transaction api WHERE api.account_id=t.account_id
                 AND api.source='inter_api' AND api.posted_on=t.posted_on AND api.amount_cents=t.amount_cents);

DELETE FROM fin_transaction t
 USING fin_import_batch b
 WHERE b.id = t.import_batch_id
   AND b.adapter = 'inter_csv'
   AND b.status = 'confirmado'
   AND t.human_locked_fields = '{}'
   AND EXISTS (SELECT 1 FROM fin_transaction api WHERE api.account_id=t.account_id
                 AND api.source='inter_api' AND api.posted_on=t.posted_on AND api.amount_cents=t.amount_cents);

UPDATE fin_import_batch b
   SET status = 'revertido',
       reverted_at = now(),
       error = 'substituído pelo lote via API, que cobre o mesmo período com dado mais rico (0028)'
 WHERE b.adapter = 'inter_csv'
   AND b.status = 'confirmado'
   AND NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.import_batch_id = b.id);

-- 2. BOLETO NÃO É TRANSFERÊNCIA PRÓPRIA.
--
-- A migration 0022 marcou como movimento entre contas próprias tudo cujo
-- documento batia com o CNPJ da empresa. Em boleto pago (`tipoTransacao =
-- 'PAGAMENTO'`), o campo `cpfCnpj` do extrato é o do PAGADOR — nós — e não o do
-- beneficiário. A checagem casou com o lado errado e tirou da despesa 31
-- pagamentos legítimos (R$ 28.263,64): COMPESA, EMBRASUL, STARTLAW, CLARO,
-- CREA.
--
-- O importador foi corrigido para não ler documento em boleto. Aqui desfaz-se o
-- que já entrou.
UPDATE fin_transaction
   SET transfer_status = 'nao',
       updated_at = now()
 WHERE source = 'inter_api'
   AND source_kind = 'PAGAMENTO'
   AND transfer_status = 'em_transito'
   AND human_locked_fields = '{}';
