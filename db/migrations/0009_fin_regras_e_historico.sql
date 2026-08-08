-- Correções da revisão do importador, mais o estágio de histórico da contraparte.

-- ---------------------------------------------------------------------------
-- 1. Regras precisam de chave natural
-- ---------------------------------------------------------------------------
-- A 0006 semeou 22 regras sem nada que as identifique além do nome. Consequência
-- prática: `UPDATE fin_rule SET priority = 1 WHERE name = '...'` atinge todas as
-- empresas, e reexecutar o seed duplicaria tudo.
--
-- Pior: regras são para serem editadas pela tela. Semeada é código, editada é
-- dado, e as duas dividem a tabela. Com slug, seed futuro é
-- `ON CONFLICT (entity_id, slug) DO NOTHING` — edição humana ganha — e correção
-- é `WHERE slug = ...`, que atinge uma linha só.
ALTER TABLE fin_rule ADD COLUMN slug text;

UPDATE fin_rule
   SET slug = regexp_replace(
                lower(translate(name, 'áàâãéêíóôõúüç', 'aaaaeeiooouuc')),
                '[^a-z0-9]+', '-', 'g');

ALTER TABLE fin_rule ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX fin_rule_slug_idx ON fin_rule (entity_id, slug);

-- ---------------------------------------------------------------------------
-- 2. O bug do 'art ' — segunda ocorrência do mesmo padrão do 'medicao'
-- ---------------------------------------------------------------------------
-- `contains_any` é indexOf cru, então a agulha 'art ' (de ART, Anotação de
-- Responsabilidade Técnica) casa dentro de:
--
--     "smart charging"      → sim
--     "chico bart comerco"  → sim
--     "art foods ltda"      → sim
--
-- Efeito medido: 34 lançamentos (R$ 1.836,90) foram para 3.01 Consultoria só
-- porque o cliente se chama Art Foods ou CHICO BART. E como "smart charging"
-- contém "art ", a regra "Smart charging e carregadores" NUNCA era alcançada
-- pela própria expressão que dá nome a ela — duas cobranças legítimas de
-- carregador (R$ 7.778,49) caíram em consultoria.
--
-- É exatamente o bug da regra de medição capturando o nome da empresa. A
-- diferença é que aqui a agulha curta casa dentro de palavras maiores.
UPDATE fin_rule
   SET conditions = '{"all":[{"field":"description_norm","op":"contains_any","value":["consultoria","auditoria","assessoria","acompanhamento tecnico"]}]}'::jsonb
 WHERE slug = 'consultoria-e-auditoria';

-- ART com fronteira de palavra, em regra própria.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, 'art-anotacao-responsabilidade-tecnica', 'ART (Anotação de Responsabilidade Técnica)', 62, 'document',
       '{"all":[{"field":"description_norm","op":"regex","value":"(^|\\s)art(\\s|$)"}]}'::jsonb,
       '{"category_code":"3.01","nucleo":"consultoria"}'::jsonb, 95, 'seed', 'ativa'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- Específico vence genérico.
UPDATE fin_rule SET priority = 45 WHERE slug = 'smart-charging-e-carregadores';

-- ---------------------------------------------------------------------------
-- 3. Regra de texto NÃO roda contra o extrato
-- ---------------------------------------------------------------------------
-- A descrição de um lançamento do Asaas é "Cobrança recebida - fatura nr. N
-- <nome do cliente>". Não há texto comercial nenhum ali — só o nome da
-- contraparte. Rodar regra de palavra-chave contra isso é o mecanismo dos dois
-- bugs acima: a regra casa com o NOME DE ALGUÉM e classifica dinheiro por causa
-- disso.
--
-- Fatos estruturais (prioridade 1–5, que leem source_kind) continuam valendo nos
-- dois lados. Texto passa a valer só no documento, onde existe descrição de
-- serviço de verdade. Isso mata a classe inteira do bug na origem.
UPDATE fin_rule SET match_scope = 'document' WHERE priority > 5;

-- ---------------------------------------------------------------------------
-- 4. Novas regras para a receita que sobrou
-- ---------------------------------------------------------------------------
-- Da varredura das 156 cobranças com texto comercial real que nenhuma regra
-- pegava. Valores medidos ao lado.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, v.slug, v.name, v.priority, 'document', v.cond::jsonb, v.act::jsonb, v.conf, 'seed', 'ativa'
  FROM fin_entity e
 CROSS JOIN (VALUES
   -- 41 cobranças, R$ 44.054,80
   ('fator-de-potencia-e-reativo', 'Fator de potência e reativo', 56,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["fator de potencia","multa de reativo","banco de capacitor","correcao do fator"]}]}',
    '{"category_code":"3.11","nucleo":"obras"}', 100),
   -- 15 cobranças, R$ 41.000,00
   ('eletrocalha-e-infraestrutura', 'Eletrocalha e infraestrutura', 52,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["eletrocalha","botao de emergencia","infraestrutura de rede","aterramento"]}]}',
    '{"category_code":"3.05","nucleo":"obras"}', 100),
   -- 34 cobranças, R$ 39.492,09 — honorário sobre economia gerada
   ('sucesso-sobre-economia-gerada', 'Sucesso sobre economia gerada', 57,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["economia gerada","da economia","mudancas de contrato de energia"]}]}',
    '{"category_code":"3.01","nucleo":"consultoria"}', 95),
   -- 2 cobranças, R$ 47.970,30 — maior item isolado da lista
   ('licenca-hsaas-maat', 'Licença HSaaS e dispositivos MAAT', 68,
    '{"all":[{"field":"description_norm","op":"contains_any","value":["hsaas","maat","licenca de uso"]}]}',
    '{"category_code":"3.07","nucleo":"tecnologia"}', 100)
 ) AS v(slug, name, priority, cond, act, conf)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Cobertura de extrato acumulava uma linha por execução
-- ---------------------------------------------------------------------------
-- Sem restrição única e sem ON CONFLICT, cada import inseria a mesma faixa de
-- novo. Rodando toda noite, um ano vira 365 linhas idênticas — e é desta tabela
-- que sai o componente "cobertura de contas" do Índice de Confiabilidade.
DELETE FROM fin_statement_coverage a
 USING fin_statement_coverage b
 WHERE a.id > b.id AND a.account_id = b.account_id AND a.source = b.source
   AND a.period_start = b.period_start;

CREATE UNIQUE INDEX fin_statement_coverage_uniq
  ON fin_statement_coverage (account_id, source, period_start);

-- ---------------------------------------------------------------------------
-- 6. Chave de origem por conta
-- ---------------------------------------------------------------------------
-- fin_transaction tem DOIS índices únicos, e o ON CONFLICT do importador só
-- consegue inferir um. Uma linha que conflite pelo outro estoura unique_violation
-- crua e mata o lote de 500 inteiro.
--
-- Além disso a chave não incluía a conta: uma segunda conta Asaas (subconta) ou
-- um adapter futuro que reuse id colidiria com o histórico existente.
DROP INDEX IF EXISTS fin_transaction_source_idx;
CREATE UNIQUE INDEX fin_transaction_source_idx
  ON fin_transaction (account_id, source, source_id) WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS fin_document_source_idx;
CREATE UNIQUE INDEX fin_document_source_idx
  ON fin_document (entity_id, source, source_id) WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Estorno não é receita de competência
-- ---------------------------------------------------------------------------
-- A view contava 'estornado' como receita: dinheiro recebido e devolvido entrava
-- na DRE. E a view de caixa chamava de receita todo lançamento positivo,
-- incluindo estorno de PIX (R$ 23.116,32), devolução de saldo de cartão
-- (R$ 5.573,21) e crédito avulso (R$ 65.045,29).
CREATE OR REPLACE VIEW fin_revenue_accrual_v AS
SELECT d.entity_id, d.competence_date, date_trunc('month', d.competence_date)::date AS month,
       d.nucleo, d.category_id, d.counterparty_id, d.amount_cents
  FROM fin_document d
 WHERE d.direction = 'receber' AND d.status NOT IN ('cancelado', 'estornado');

CREATE OR REPLACE VIEW fin_revenue_cash_v AS
SELECT t.entity_id, t.posted_on, date_trunc('month', t.posted_on)::date AS month,
       t.nucleo, t.category_id, t.counterparty_id, t.amount_cents
  FROM fin_transaction t
  LEFT JOIN fin_category c ON c.id = t.category_id
 WHERE t.amount_cents > 0
   AND t.transfer_status <> 'pareado'
   AND NOT t.is_split_parent
   -- Entrada só é receita quando a categoria diz que é. Sem esta condição,
   -- estorno, devolução e crédito avulso entravam como faturamento.
   AND (c.toc_class = 'throughput_receita' OR (t.category_id IS NULL AND t.source_kind = 'PAYMENT_RECEIVED'));

COMMENT ON VIEW fin_revenue_cash_v IS
  'Receita em regime de CAIXA. Exclui transferência pareada, pai de rateio, e toda entrada cuja categoria não seja throughput de receita (estorno, devolução de cartão, crédito avulso).';
