-- Correções encontradas pelo teste de aceite contra a base real.
--
-- Cada uma abaixo saiu de uma divergência que o scripts/test-financeiro.mjs
-- apontou contra os números conferidos direto na API do Asaas. Todas são erros
-- meus de modelagem, não da fonte.

-- ---------------------------------------------------------------------------
-- 1. Data em que o cliente pagou ≠ data em que o dinheiro ficou disponível
-- ---------------------------------------------------------------------------
-- 864 das 3.023 cobranças recebidas têm paymentDate diferente de creditDate.
-- Boleto pago numa sexta cai na conta na segunda; em virada de mês, isso move
-- receita inteira de um mês para o outro. Um único boleto de R$ 4.941,44 saiu de
-- julho e entrou em agosto no relatório de caixa.
--
-- As duas datas respondem perguntas diferentes e as duas são legítimas:
--   · paid_on  — "quando o cliente pagou". É o que o painel do Asaas mostra e o
--                que o negócio conhece de cor.
--   · o extrato (fin_transaction.posted_on) — "quando o dinheiro ficou
--                disponível". É o que a previsão de caixa precisa.
--
-- Guardar as duas é o que impede a discussão de "esta tela não bate com aquela".
ALTER TABLE fin_document ADD COLUMN paid_on date;
CREATE INDEX fin_document_paid_idx ON fin_document (entity_id, paid_on) WHERE paid_on IS NOT NULL;

COMMENT ON COLUMN fin_document.paid_on IS
  'Data em que o cliente pagou (paymentDate do Asaas). Diferente da data de crédito no extrato — 864 cobranças divergem. Receita "por data de pagamento" usa esta; fluxo de caixa usa fin_transaction.posted_on.';

-- ---------------------------------------------------------------------------
-- 2. Fato estrutural tem de vencer texto comercial
-- ---------------------------------------------------------------------------
-- BUG ENCONTRADO: 276 das 372 transferências foram classificadas como "Medição
-- e monitoramento" porque a descrição é
--
--     "Transação via Pix com chave para XP ENERGY SERVICOS DE MEDICAO DE ENERGIA"
--
-- ...e a regra de medição casa com "medicao". A empresa transferindo para a
-- própria conta casava com o próprio nome social.
--
-- A causa raiz não é a palavra: é a ORDEM. Eu havia posto os fatos estruturais
-- (o `type` que o banco carimba na transação) na faixa 200+, depois das regras
-- de texto, raciocinando "específico primeiro". Está invertido — o tipo do
-- lançamento é um FATO da fonte e a descrição é texto livre. Fato sempre vence
-- texto.
--
-- Consequência de não corrigir: R$ 3,82 milhões de transferências internas
-- entrariam como receita de medição, e a receita da empresa apareceria com o
-- dobro do tamanho.
UPDATE fin_rule SET priority = 1 WHERE name = 'Transferência entre contas próprias';
UPDATE fin_rule SET priority = 2 WHERE name = 'Tarifas do Asaas';
UPDATE fin_rule SET priority = 3 WHERE name = 'Estorno de PIX';
UPDATE fin_rule SET priority = 4 WHERE name = 'Recarga de cartão Asaas';
UPDATE fin_rule SET priority = 5 WHERE name = 'Pagamento de contas pelo Asaas';

-- ---------------------------------------------------------------------------
-- 3. Comissão recorrente que não é "comissionamento de vendas"
-- ---------------------------------------------------------------------------
-- Sobraram ~R$ 26 mil em cobranças de comissão que a regra de prioridade 10 não
-- pega, porque não dizem "comissionamento de vendas": "Comissão referente ao mês
-- de Agosto", "3 e última parcela da comissão do mundo do cabeleireiro".
--
-- É receita de comissão de verdade, mas de outro parceiro. Confiança 75 para que
-- caia na fila mesmo casando — a distinção entre "comissão que recebemos" e
-- "comissão que pagamos" depende do sentido, e vale um olho humano nas primeiras
-- vezes.
INSERT INTO fin_rule (entity_id, name, priority, match_scope, conditions, actions, confidence, source, status)
SELECT e.id, 'Comissão recorrente (outros parceiros)', 95, 'both',
       '{"all":[{"field":"description_norm","op":"contains_any","value":["comissao referente","comissao do","parcela da comissao","comissao de vendas"]},{"field":"direction","op":"equals","value":"receber"}]}'::jsonb,
       '{"category_code":"3.06","nucleo":"consultoria","review":true}'::jsonb,
       75, 'seed', 'ativa'
  FROM fin_entity e WHERE e.slug = 'xpe';

-- ---------------------------------------------------------------------------
-- 4. RECEIVED_IN_CASH não é inadimplência
-- ---------------------------------------------------------------------------
-- 46 cobranças, R$ 125 mil, apareciam como vencidas. Elas foram RECEBIDAS — em
-- dinheiro ou por transferência direta, fora do Asaas. Como não geram lançamento
-- no extrato do Asaas, ficam sem liquidação e o status 'emitido' com vencimento
-- passado as fazia parecer calote.
--
-- Elas viram 'confirmado': dinheiro reconhecido que ainda não apareceu numa conta
-- rastreada. É a descrição exata da situação, e o número volta a bater com as 45
-- cobranças que o Asaas marca como OVERDUE.
--
-- Quando os extratos de Nubank, Inter e Caixa entrarem, a liquidação aparece e
-- elas viram 'liquidado' sozinhas. Até lá, a lacuna fica visível — que é
-- justamente o que o módulo existe para mostrar.
UPDATE fin_document SET status = 'confirmado'
 WHERE source_status = 'RECEIVED_IN_CASH' AND status = 'emitido' AND settled_cents = 0;
