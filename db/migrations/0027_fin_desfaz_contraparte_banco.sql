-- Desfaz as contrapartes que eram bancos, não favorecidos.
--
-- Bug meu, no importador do Inter, corrigido em scripts/import-inter.mjs no
-- mesmo commit. `nomeEmpresaRecebedor` e `nomeEmpresaPagador`, apesar do nome,
-- não trazem a empresa favorecida: trazem a INSTITUIÇÃO onde a pessoa tem
-- conta. O importador os usava como primeira opção de nome.
--
-- Medido sobre o extrato real: em 521 de 521 saídas os dois campos diferem, e o
-- campo "empresa" nunca é a única fonte de nome. O resultado foi 57 favorecidos
-- reais colapsados em 19 bancos:
--   "NU PAGAMENTOS - IP"        escondia 27 pessoas
--   "ITAÚ UNIBANCO S.A."        escondia  9
--   "BANCO INTER"               escondia  7
--   "CAIXA ECONOMICA FEDERAL"   escondia  4
--   "BCO SANTANDER (BRASIL)"    escondia  3
--   "BCO DO BRASIL S.A."        escondia  3
--
-- Para uma plataforma cujo objetivo declarado é saber quanto custa cada pessoa,
-- este era o erro mais destrutivo possível: apagava exatamente a identidade que
-- se quer medir.
--
-- Esta migration solta os lançamentos. Quem recria a ligação correta é a
-- reimportação, porque o ON CONFLICT do importador usa
-- COALESCE(fin_transaction.counterparty_id, EXCLUDED.counterparty_id) — ou seja,
-- só preenche o que está NULO. Sem zerar aqui, a reimportação preservaria a
-- ligação errada para sempre.

-- 1. Quais contrapartes são instituição financeira e não favorecido.
--
-- Identificadas por serem alvo de lançamentos do Inter cujo `counterparty_raw`
-- (o nome que o importador gravou na linha) é o mesmo nome da instituição.
-- Restrito a `source='inter_api'`: contrapartes vindas do Asaas com nome de
-- banco podem ser legítimas (o banco como fornecedor de tarifa, por exemplo).
CREATE TEMP TABLE contrapartes_banco ON COMMIT DROP AS
SELECT DISTINCT c.id
  FROM fin_counterparty c
  JOIN fin_transaction t ON t.counterparty_id = c.id
 WHERE t.source = 'inter_api'
   AND c.normalized_name = ANY (ARRAY[
     'nu pagamentos ip',
     'itau unibanco sa',
     'banco inter',
     'caixa economica federal',
     'bco santander brasil sa',
     'bco do brasil sa',
     'cora scfi',
     'picpay',
     'stone instituicao de pagamento sa',
     'mercado pago ip ltda',
     'pagseguro internet ip sa',
     'banco bradesco sa',
     'nu financeira sa',
     'banco c6 sa',
     'will financeira sa',
     'banco original',
     'sicoob',
     'sicredi',
     'banco safra sa'
   ]);

-- 2. Trilha antes de mexer.
INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, actor)
SELECT t.entity_id, 'fin_transaction', t.id, 'bulk_update',
       jsonb_build_object('counterparty_id', t.counterparty_id, 'counterparty_raw', t.counterparty_raw),
       'migration-0027'
  FROM fin_transaction t
 WHERE t.source = 'inter_api'
   AND t.counterparty_id IN (SELECT id FROM contrapartes_banco);

-- 3. Solta os lançamentos. A reimportação religa no favorecido certo.
UPDATE fin_transaction t
   SET counterparty_id = NULL,
       counterparty_raw = NULL,
       updated_at = now()
 WHERE t.source = 'inter_api'
   AND t.counterparty_id IN (SELECT id FROM contrapartes_banco);

-- 4. Desativa a contraparte-banco se nada mais depender dela.
--
-- Desativar em vez de apagar: se um lançamento do Asaas apontar para ela por
-- outro caminho legítimo, apagar quebraria a FK e derrubaria a migration.
UPDATE fin_counterparty c
   SET is_active = false,
       notes = COALESCE(c.notes || ' | ', '')
             || 'instituição financeira gravada como favorecido por bug do importador do Inter, desfeito em 0027',
       updated_at = now()
 WHERE c.id IN (SELECT id FROM contrapartes_banco)
   AND NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.counterparty_id = c.id);

DELETE FROM fin_counterparty c
 WHERE c.id IN (SELECT id FROM contrapartes_banco)
   AND NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.counterparty_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM fin_document d WHERE d.counterparty_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM fin_person p WHERE p.counterparty_id = c.id);
