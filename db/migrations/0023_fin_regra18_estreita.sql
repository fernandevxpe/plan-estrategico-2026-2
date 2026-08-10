-- A regra 18 confundia "saiu saldo do gateway" com "foi para conta nossa".
--
-- No Asaas, `financialTransaction.type = 'TRANSFER'` significa apenas que o
-- saldo deixou a conta — para QUEM QUER QUE SEJA. A regra lia isso como fato de
-- titularidade e, na prioridade 1 com `classified_by='fato_estrutural'`, nenhuma
-- regra menor conseguia corrigir.
--
-- Medido com o motor de produção contra a base inteira: das 372 linhas que a
-- regra classifica (R$ 3.815.575,13), 96 não são transferência — são
-- R$ 356.506,34 de pagamento a terceiro invisíveis na despesa: Ministério da
-- Fazenda (DAS), CREA, CELPE, Claro, Mercado Pago, Dimensional Brasil, Santos
-- Elétrica e 14 pessoas físicas.
--
-- O critério que de fato separaria os dois é o CNPJ do destino. Ele NÃO está
-- disponível: `GET /transfers` do Asaas responde 403 com a chave atual (ver
-- scripts/sync-asaas.mjs:177). O que sobra é o nome que o Asaas embute na
-- descrição — é palpite sobre texto, e é por isso que o item 3 rebaixa o
-- carimbo de 'fato_estrutural' para 'regra'.
--
-- Nota de simulação: com a regra 18 apagada, as mesmas 276 transferências
-- legítimas são capturadas pela regra 32, que já faz este match por nome com a
-- mesma ação. A cláusula source_kind não acerta uma linha a mais — só
-- acrescentava os 96 erros.

-- 1. A regra.
--
-- 'all' e não 'any': precisa ser TRANSFER **e** nomear a empresa.
--
-- A condição de descrição vem PRIMEIRO de propósito. `evaluateConditions` elege
-- como evidência a primeira condição do bloco que devolve snippet, e
-- `estagioDe()` em scripts/import-asaas.mjs:119 carimba 'fato_estrutural' se e
-- somente se o campo da evidência for source_kind. Com a descrição na frente, a
-- reimportação passa a gravar 'regra' — que é a verdade, e o que devolve à
-- empresa a capacidade de corrigir a linha depois.
--
-- A cláusula source_kind FICA, mesmo redundante para transações: é guarda de
-- escopo. A regra é match_scope='both' e existem 46 documentos com 'xp energy'
-- na descrição (R$ 83.219,03); como o sujeito-de-documento não tem source_kind,
-- o 'all' falha ali e eles seguem intocados — o comportamento de hoje.
UPDATE fin_rule
   SET conditions = jsonb_build_object(
         'all', jsonb_build_array(
           jsonb_build_object('op', 'contains_any', 'field', 'description_norm',
                              'value', jsonb_build_array('xp energy', 'xpe tecnologia', 'xpe consultoria')),
           jsonb_build_object('op', 'in', 'field', 'source_kind',
                              'value', jsonb_build_array('TRANSFER'))
         )),
       -- 100 dizia "não precisa de revisão". Casar nome dentro de texto livre
       -- não merece 100; 90 mantém review_status='ok' (o corte é 80) e sinaliza
       -- na tela que é heurística.
       confidence = 90,
       notes = COALESCE(notes || ' | ', '')
             || 'estreitada em 0023: source_kind=TRANSFER no Asaas significa apenas "saiu saldo", não "foi para conta própria"',
       updated_at = now()
 WHERE slug = 'transferencia-entre-contas-proprias'
   AND conditions::text NOT LIKE '%description_norm%';

-- 2. Desfazer a classificação errada já gravada.
--
-- Reimportar NÃO basta. O ON CONFLICT de scripts/import-asaas.mjs:461 usa
-- COALESCE(EXCLUDED.category_id, fin_transaction.category_id): para as linhas
-- que passam a não casar regra nenhuma, EXCLUDED vem NULL e o COALESCE PRESERVA
-- a categoria 9.01, enquanto transfer_status seria rebaixado. A linha ficaria
-- dizendo, ao mesmo tempo, que é e que não é transferência.
CREATE TEMP TABLE regra18_desfazer ON COMMIT DROP AS
SELECT t.id
  FROM fin_transaction t
 WHERE t.classified_rule_id = 18
   AND t.description_norm NOT LIKE '%xp energy%'
   AND t.description_norm NOT LIKE '%xpe tecnologia%'
   AND t.description_norm NOT LIKE '%xpe consultoria%'
   AND t.human_locked_fields = '{}'
   -- 'pareado' é conciliação fechada com a outra ponta; desfazer devolveria a
   -- dupla contagem. Hoje são 0 linhas, e a guarda fica para o dia em que não
   -- forem: uma migration que roda depois de alguém conciliar não pode apagar
   -- a conciliação só porque no dia em que foi escrita não havia nenhuma.
   AND t.transfer_status <> 'pareado';

-- Trilha ANTES de mexer: é em fin_classification_event que a tela responde
-- "por que esta linha mudou?".
INSERT INTO fin_classification_event
  (target_table, target_id, stage, rule_id, category_id, accepted, superseded_value, rationale, actor)
SELECT 'fin_transaction', t.id, 'regra', 18, t.category_id, false,
       jsonb_build_object('category_id', t.category_id, 'nucleo', t.nucleo,
                          'classified_by', t.classified_by, 'transfer_status', t.transfer_status),
       jsonb_build_object('motivo', 'regra 18 estreitada na migration 0023',
                          'porque', 'source_kind=TRANSFER no Asaas não prova titularidade do destino'),
       'migration:0023'
  FROM fin_transaction t JOIN regra18_desfazer d ON d.id = t.id;

UPDATE fin_transaction t
   SET category_id        = NULL,
       nucleo             = NULL,
       transfer_status    = 'nao',
       transfer_group_id  = NULL,
       classified_by      = NULL,
       classified_rule_id = NULL,
       classified_reason  = NULL,
       classified_at      = NULL,
       -- 'adiado' e 'ignorado' são decisão humana e vencem, mesma convenção do
       -- importador. O resto vira 'pendente' e aparece na fila — que é o ponto:
       -- transformar um número falso numa pergunta visível.
       review_status      = CASE WHEN t.review_status IN ('adiado', 'ignorado')
                                 THEN t.review_status ELSE 'pendente' END,
       updated_at         = now()
  FROM regra18_desfazer d
 WHERE t.id = d.id;

-- 3. As que continuam sendo transferência: carimbo honesto.
--
-- 'fato_estrutural' significa "veio da fonte, confiável sem revisão". Um LIKE
-- sobre texto livre não é isso. Prioridade 1 + fato_estrutural é exatamente a
-- combinação que tornou este bug incorrigível.
UPDATE fin_transaction
   SET classified_by = 'regra', updated_at = now()
 WHERE classified_rule_id = 18
   AND classified_by = 'fato_estrutural'
   AND human_locked_fields = '{}';

-- 4. Fila de revisão.
--
-- Sem item de fila, os lançamentos ficariam 'pendente' numa coluna que ninguém
-- olha. A fila ordena por R$ em jogo, então os dois DAS aparecem no topo.
INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, status, created_at)
SELECT t.entity_id, 'fin_transaction', t.id, 'sem_categoria', t.amount_cents, 'pendente', now()
  FROM fin_transaction t JOIN regra18_desfazer d ON d.id = t.id
 WHERE t.category_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                    WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id
                      AND ri.status = 'pendente');
