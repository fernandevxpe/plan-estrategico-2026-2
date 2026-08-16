-- O cadastro de contrapartes aprende o documento que o extrato já dizia.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ACONTECENDO
-- ---------------------------------------------------------------------------
-- Depois que o lastro do PIX passou a ser gravado (0042) e o Nubank a vir pelo
-- Polp (0052), 227 lançamentos carregam o CPF/CNPJ da contraparte enquanto o
-- CADASTRO da mesma contraparte segue sem documento nenhum.
--
-- A informação estava dentro do banco, em duas tabelas, sem se encontrar: a
-- transação sabia o documento, a contraparte não. Enquanto durar, todo
-- casamento futuro continua caindo para o nome — o método que produziu os
-- pareamentos falsos desfeitos na 0044.
--
-- ---------------------------------------------------------------------------
-- E O QUE A PRIMEIRA TENTATIVA DESCOBRIU
-- ---------------------------------------------------------------------------
-- A versão inicial desta migration fazia só o UPDATE e QUEBROU no índice único
-- (entity_id, document_number). O erro foi a informação mais útil do dia:
-- quatro das contrapartes sem documento são DUPLICATAS de contrapartes que já
-- existem — o mesmo CPF/CNPJ cadastrado duas vezes sob nomes diferentes.
--
--   899 Adryan Kennie Melo dos Santos (17)  =  352 Adryan Santos (20)
--   887 LYRA TECN E GESTO EM M2M LTDA  (2)  =  383 Lyra M2m Ltda (6)
--   888 COMPANHIA ENE DE PE            (1)  =  399 Neoenergia Pernambuco (6)
--   870 MERCADO PAGO INST. PAGAMENTO   (1)  =  863 PIX Marketplace (53)
--
-- Nenhuma delas seria encontrada por semelhança de nome: "COMPANHIA ENE DE PE"
-- e "Neoenergia Pernambuco" são a mesma distribuidora (a antiga CELPE) e não
-- têm uma palavra em comum; "PIX Marketplace" é o rótulo do agregador e
-- "Mercado Pago" é a razão social. O documento resolve o que o nome esconde —
-- que é a tese inteira da 0042.
--
-- Medição que autoriza cada parte:
--   36 contrapartes recebem documento com segurança (1 documento cada, sem colisão)
--    4 são duplicata e vão ser mescladas
--    3 documentos não têm contraparte nenhuma e ganham cadastro
--    4 têm CONFLITO (documento cadastrado ≠ o do extrato) e NÃO são tocadas

-- ---------------------------------------------------------------------------
-- 1. Mesclar as duplicatas na contraparte canônica
-- ---------------------------------------------------------------------------
-- Canônica é a que já tem o documento. Não é a maior nem a de nome melhor: é a
-- que já está identificada, porque é para ela que qualquer casamento futuro por
-- documento vai apontar de qualquer forma.
CREATE TEMP TABLE _merge_contraparte AS
WITH alvo AS (
  SELECT t.counterparty_id AS dup_id, min(t.counterparty_document) AS doc
    FROM fin_transaction t
    JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE t.counterparty_document IS NOT NULL AND cp.document_number IS NULL
   GROUP BY 1 HAVING count(DISTINCT t.counterparty_document) = 1
)
SELECT a.dup_id, ja.id AS canonica_id, a.doc
  FROM alvo a
  JOIN fin_counterparty ja
    ON regexp_replace(COALESCE(ja.document_number,''), '[^0-9]', '', 'g') = a.doc
 WHERE ja.id <> a.dup_id;

-- O nome da duplicata vira alias: é assim que o extrato escreve, e jogar fora
-- essa grafia faria o próximo import criar o cadastro duplicado de novo.
-- `external_id` é NOT NULL e `source` é vocabulário fechado (asaas, pipedrive,
-- clickup, import, manual). A mesclagem é curadoria, não origem de sistema
-- externo, então source='manual'; o external_id carrega o id da duplicata, que
-- permite reconstituir a mesclagem sem depender do texto da nota.
INSERT INTO fin_counterparty_alias (counterparty_id, source, external_id, name_raw, normalized_name)
SELECT m.canonica_id, 'manual', 'merge-0053:counterparty:' || m.dup_id, dup.name, dup.normalized_name
  FROM _merge_contraparte m
  JOIN fin_counterparty dup ON dup.id = m.dup_id
 WHERE NOT EXISTS (
   SELECT 1 FROM fin_counterparty_alias a
    WHERE a.counterparty_id = m.canonica_id AND a.normalized_name = dup.normalized_name);

-- Todas as 12 tabelas que referenciam contraparte são reapontadas. Deixar
-- qualquer uma para trás criaria referência para um cadastro inativo — o tipo
-- de resto que só aparece meses depois, numa tela que mostra branco.
UPDATE fin_transaction        t SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE t.counterparty_id = m.dup_id;
UPDATE fin_document           d SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE d.counterparty_id = m.dup_id;
UPDATE fin_fiscal_document    f SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE f.counterparty_id = m.dup_id;
UPDATE fin_contract           c SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE c.counterparty_id = m.dup_id;
UPDATE fin_installment_plan   i SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE i.counterparty_id = m.dup_id;
UPDATE fin_payee_account      p SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE p.counterparty_id = m.dup_id;
UPDATE fin_card_transaction   x SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE x.counterparty_id = m.dup_id;
UPDATE fin_card_installment_plan y SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE y.counterparty_id = m.dup_id;
UPDATE erp_contrato           e SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE e.counterparty_id = m.dup_id;
UPDATE fin_counterparty_alias a SET counterparty_id = m.canonica_id FROM _merge_contraparte m WHERE a.counterparty_id = m.dup_id;

-- fin_person e fin_person_counterparty têm unicidade própria: reaponta só o que
-- não colide, para não fundir duas pessoas distintas por acidente.
UPDATE fin_person pe SET counterparty_id = m.canonica_id
  FROM _merge_contraparte m
 WHERE pe.counterparty_id = m.dup_id
   AND NOT EXISTS (SELECT 1 FROM fin_person o WHERE o.counterparty_id = m.canonica_id);

DELETE FROM fin_person_counterparty pc
 USING _merge_contraparte m
 WHERE pc.counterparty_id = m.dup_id
   AND EXISTS (SELECT 1 FROM fin_person_counterparty o
                WHERE o.counterparty_id = m.canonica_id AND o.person_id = pc.person_id);
UPDATE fin_person_counterparty pc SET counterparty_id = m.canonica_id
  FROM _merge_contraparte m WHERE pc.counterparty_id = m.dup_id;

-- A duplicata é desativada, não removida: o id pode estar citado em log,
-- evidência de classificação ou export antigo, e apagá-lo transformaria
-- histórico em referência quebrada.
UPDATE fin_counterparty cp
   SET is_active = false,
       notes = COALESCE(cp.notes || E'\n', '') ||
               'Mesclada em 2026-08-15 (0053) na contraparte ' || m.canonica_id ||
               ' — mesmo documento ' || m.doc || '. Duplicata criada por grafia diferente do mesmo CPF/CNPJ.',
       updated_at = now()
  FROM _merge_contraparte m
 WHERE cp.id = m.dup_id;

-- ---------------------------------------------------------------------------
-- 2. As 36 restantes ganham o documento que já aparecia no extrato
-- ---------------------------------------------------------------------------
WITH doc_por_contraparte AS (
  SELECT t.counterparty_id, min(t.counterparty_document) AS documento
    FROM fin_transaction t
    JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE t.counterparty_document IS NOT NULL AND cp.document_number IS NULL
   GROUP BY t.counterparty_id
  HAVING count(DISTINCT t.counterparty_document) = 1   -- a trava da unicidade
)
UPDATE fin_counterparty cp
   SET document_number = d.documento,
       -- 11 dígitos é CPF, 14 é CNPJ; o CHECK da 0042 garante que não há terceiro caso.
       document_type   = CASE WHEN length(d.documento) = 11 THEN 'cpf' ELSE 'cnpj' END,
       updated_at      = now()
  FROM doc_por_contraparte d
 WHERE cp.id = d.counterparty_id
   -- quem já foi mesclado acima não entra aqui
   AND NOT EXISTS (SELECT 1 FROM _merge_contraparte m WHERE m.dup_id = cp.id);

-- ---------------------------------------------------------------------------
-- 3. Os documentos sem contraparte nenhuma ganham cadastro
-- ---------------------------------------------------------------------------
-- kind='outro' de propósito. Dá para adivinhar por valor e frequência que Uber
-- é despesa e um posto é fornecedor, mas adivinhar tipo é o que este projeto não
-- faz: a natureza sai da categoria do lançamento, e refinar o cadastro se faz
-- com informação, não com inferência sobre o nome.
INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number, is_active)
SELECT DISTINCT ON (t.counterparty_document)
       t.entity_id, 'outro',
       left(regexp_replace(COALESCE(t.counterparty_raw, t.description_raw, 'Sem nome'), '^.*?[—|]\s*', ''), 120),
       lower(left(regexp_replace(COALESCE(t.counterparty_raw, t.description_raw, 'sem nome'), '^.*?[—|]\s*', ''), 120)),
       CASE WHEN length(t.counterparty_document) = 11 THEN 'cpf' ELSE 'cnpj' END,
       t.counterparty_document, true
  FROM fin_transaction t
 WHERE t.counterparty_document IS NOT NULL
   AND t.counterparty_id IS NULL
   AND t.counterparty_document <> '34776108000192'
   AND NOT EXISTS (SELECT 1 FROM fin_counterparty cp
     WHERE regexp_replace(COALESCE(cp.document_number,''), '[^0-9]', '', 'g') = t.counterparty_document)
 ORDER BY t.counterparty_document, t.posted_on DESC;

UPDATE fin_transaction t
   SET counterparty_id = cp.id, updated_at = now()
  FROM fin_counterparty cp
 WHERE t.counterparty_id IS NULL
   AND t.counterparty_document IS NOT NULL
   AND regexp_replace(COALESCE(cp.document_number,''), '[^0-9]', '', 'g') = t.counterparty_document;

-- ---------------------------------------------------------------------------
-- 4. Os conflitos ficam declarados, não resolvidos
-- ---------------------------------------------------------------------------
-- Contrapartes cujo cadastro tem um documento e cujo extrato mostra outro. Uma
-- das duas informações está errada e não há no banco nada que diga qual: pode
-- ser cadastro digitado errado, pagamento a quem não devia, ou troca de CNPJ da
-- mesma empresa. Escolher aqui seria inventar.
CREATE OR REPLACE VIEW fin_contraparte_documento_conflito_v AS
SELECT cp.id AS counterparty_id, cp.name AS nome_cadastrado,
       regexp_replace(cp.document_number,'[^0-9]','','g') AS documento_cadastrado,
       t.counterparty_document AS documento_no_extrato,
       count(*) AS lancamentos, sum(abs(t.amount_cents)) AS volume_cents,
       min(t.posted_on) AS de, max(t.posted_on) AS ate,
       max(left(COALESCE(t.counterparty_raw, t.description_raw), 80)) AS texto_no_extrato
  FROM fin_transaction t
  JOIN fin_counterparty cp ON cp.id = t.counterparty_id
 WHERE t.counterparty_document IS NOT NULL
   AND cp.document_number IS NOT NULL
   AND regexp_replace(cp.document_number,'[^0-9]','','g') <> t.counterparty_document
 GROUP BY cp.id, cp.name, cp.document_number, t.counterparty_document;

COMMENT ON VIEW fin_contraparte_documento_conflito_v IS
  'Contrapartes cujo documento cadastrado difere do que o extrato mostra. Uma das duas '
  'informações está errada e o banco não diz qual. Fila de decisão humana, nunca resolvida '
  'automaticamente.';

DROP TABLE _merge_contraparte;
