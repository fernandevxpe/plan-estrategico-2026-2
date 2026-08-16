-- A fila de classificação para de esconder, e o que a fonte já declara vira regra.
--
-- Medido em 16/08/2026, sobre 2026. Escopo desta migration: **só 2026** — o
-- histórico anterior está fora por decisão do Fernando.
--
-- ---------------------------------------------------------------------------
-- 1. A FILA GANHA UM SEGUNDO ESCONDERIJO SE NINGUÉM OLHAR
-- ---------------------------------------------------------------------------
-- A 0055 criou `fin_a_classificar_v` porque 5.99 "Despesa a classificar" PARECE
-- classificada: tem dre_line, soma na DRE, conta no indicador "categoria
-- atribuída". A view corrigiu isso para a despesa.
--
-- 3.99 "Receita a classificar" tem exatamente o mesmo defeito e ficou de fora.
-- Hoje ela está vazia (0 lançamentos), o que a torna inofensiva — e é
-- precisamente por isso que ela precisa entrar na view AGORA: o passo seguinte
-- desta mesma leva manda 65 cobranças do Asaas para ela.
--
-- Se a view não crescer junto, esse movimento seria uma troca de esconderijo:
-- R$ 113.265,35 sairiam de "sem categoria" e entrariam num código que o painel
-- conta como resolvido. O ganho seria só no número.
--
-- O que o movimento GANHA de verdade, e por isso ele vale a pena mesmo com a
-- linha continuando na fila: hoje essas 65 não têm categoria nenhuma, então não
-- entram na DRE de lado nenhum. Em 3.99 elas entram como receita_bruta — que é
-- o que o Asaas afirma que elas são. O que continua desconhecido é QUAL
-- serviço, não SE é receita. A fila passa a dizer as duas coisas ao mesmo
-- tempo: o sinal está estabelecido, a linha da DRE não.
--
-- A coluna `motivo_na_fila` entra no fim (CREATE OR REPLACE só admite acréscimo
-- no fim) para que quem consulta saiba qual dos três vazios está olhando sem
-- ter de reconstruir o CASE.
CREATE OR REPLACE VIEW fin_a_classificar_v AS
SELECT t.id, t.posted_on, a.slug AS conta, t.amount_cents,
       t.description_raw, t.counterparty_raw, t.counterparty_document,
       cp.name AS contraparte, t.source_kind,
       CASE
         WHEN t.category_id IS NULL THEN 'sem categoria'
         WHEN c.code = '5.99'       THEN 'despesa a classificar (5.99)'
         WHEN c.code = '3.99'       THEN 'receita a classificar (3.99)'
       END AS motivo_na_fila
  FROM fin_transaction t
  JOIN fin_account a ON a.id = t.account_id
  LEFT JOIN fin_category c ON c.id = t.category_id
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
 WHERE (c.code IN ('5.99', '3.99') OR t.category_id IS NULL)
   AND COALESCE(c.cash_flow_group, '') <> 'movimentacao';

COMMENT ON VIEW fin_a_classificar_v IS
  'A fila real de classificação: sem categoria OU em 5.99 "despesa a classificar" OU em 3.99 '
  '"receita a classificar". As duas terminadas em .99 entram porque PARECEM classificadas (têm '
  'dre_line, somam na DRE) e não estão — são a declaração de que ninguém sabe o que é. Contá-las '
  'como categorizadas infla o indicador exatamente onde a informação falta. 3.99 entrou na 0056, '
  'antes de receber sua primeira linha, para que mandar receita para lá nunca fosse um atalho.';

-- ---------------------------------------------------------------------------
-- 2. O QUE NÃO DEU: INDETERMINADO DECLARADO, COM MOTIVO
-- ---------------------------------------------------------------------------
-- Critério de conclusão nº 6 do agente: "o que não pôde ser determinado está
-- explicitamente marcado como indeterminado, com o motivo — e não escondido em
-- um número redondo".
--
-- Hoje não existe onde escrever esse motivo. `review_status='pendente'` diz que
-- falta olhar, não POR QUE olhar não resolveu; e a 0054 acabou de reconciliar
-- esse campo com a existência de categoria, então sobrecarregá-lo aqui
-- desfaria trabalho de ontem.
--
-- A declaração vai em `tags`, com prefixo fixo `indeterminado:`. Escolha
-- deliberada sobre criar coluna nova:
--   · `tags` já existe, é text[], tem índice GIN e é preservada pelos gatilhos;
--   · uma linha pode ser indeterminada por mais de um motivo ao mesmo tempo
--     (sem itemização E sem decisão anterior da contraparte);
--   · a tag some quando alguém classifica de verdade — é o script que a tira,
--     e enquanto ela estiver lá o indicador não pode dizer que acabou.
--
-- Os motivos são um vocabulário fechado, checado pelo CHECK abaixo. Motivo
-- livre viraria, em três meses, quarenta grafias da mesma coisa.
-- Vocabulário numa função IMMUTABLE, e não inline no CHECK, por obrigação do
-- Postgres: CHECK não aceita subconsulta nem função que retorna conjunto, e
-- validar `tags` exige percorrer o array. A função é o único lugar onde a lista
-- existe — acrescentar motivo é editar uma linha, não caçar duplicatas.
CREATE OR REPLACE FUNCTION fin_tags_indeterminado_validas(p_tags text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM unnest(COALESCE(p_tags, '{}'::text[])) AS u(tag)
     WHERE u.tag LIKE 'indeterminado:%'
       AND u.tag <> ALL (ARRAY[
           -- A fonte diz que é receita, não diz de qual serviço. Asaas
           -- PAYMENT_RECEIVED sem nota que separe: o código municipal
           -- 17.01.01.501 aparece em 387 linhas já decididas e se espalha por
           -- ONZE categorias de receita diferentes — ele não determina nada.
           'indeterminado:servico-nao-declarado',
           -- Fatura de cartão cujo itemizado não está no ledger. Chamar de
           -- transferência tiraria despesa real da DRE sem que ela reapareça
           -- em lugar nenhum.
           'indeterminado:fatura-sem-itemizacao',
           -- Contraparte identificada por documento, mas sem nenhuma decisão
           -- anterior dela no ledger. Só o nome sobraria como critério — e foi
           -- assim que nasceram os pareamentos falsos desfeitos na 0044.
           'indeterminado:contraparte-sem-historico',
           -- Duas classificações possíveis e nenhuma evidência que separe
           -- (imposto municipal vs taxa; deslocamento de serviço vs viagem).
           'indeterminado:duas-leituras-possiveis',
           -- Sem contraparte e sem lastro: não há o que consultar.
           'indeterminado:sem-lastro-nem-contraparte'
       ])
  );
$$;

ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_indeterminado_vocabulario;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_indeterminado_vocabulario
  CHECK (fin_tags_indeterminado_validas(tags));

CREATE OR REPLACE VIEW fin_indeterminado_v AS
SELECT t.id, t.posted_on, a.slug AS conta, t.amount_cents,
       t.description_raw, COALESCE(cp.name, t.counterparty_raw) AS contraparte,
       t.counterparty_document, c.code AS categoria_atual,
       u.tag AS motivo
  FROM fin_transaction t
  JOIN fin_account a ON a.id = t.account_id
  LEFT JOIN fin_category c ON c.id = t.category_id
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
  CROSS JOIN LATERAL unnest(t.tags) AS u(tag)
 WHERE u.tag LIKE 'indeterminado:%';

COMMENT ON VIEW fin_indeterminado_v IS
  'O que a fila NÃO conseguiu resolver, com o motivo por extenso. É a outra metade de '
  'fin_a_classificar_v: aquela diz o que falta, esta diz por que faltar é a resposta certa '
  'para estas linhas. Uma linha some daqui quando alguém a classifica com evidência — nunca '
  'por decurso de prazo.';

-- ---------------------------------------------------------------------------
-- 3. AS REGRAS — DOCUMENTO E FONTE VENCEM NOME
-- ---------------------------------------------------------------------------
-- Todas as regras abaixo casam por um fato que a FONTE carimbou (o tipo do
-- lançamento no Asaas, o CNPJ da contraparte) ou pelo texto que o próprio banco
-- escreveu sobre a natureza da operação — nunca por semelhança de nome de
-- fornecedor. Cada uma traz, no `notes`, a contagem medida que a justifica.
--
-- Elas existem como `fin_rule` e não como UPDATE solto porque UPDATE resolve
-- 2026 e esquece 2027: a regra continua valendo para o que entrar amanhã, e
-- `classified_rule_id` deixa a linha capaz de dizer por que caiu ali.

-- 3.1 A cobrança recebida no Asaas é receita. Fato estrutural.
--
-- O Asaas classifica o próprio lançamento como PAYMENT_RECEIVED — "cobrança
-- recebida". Medido nas 65 linhas de 2026 que estão sem categoria: 65 de 65 têm
-- `fin_settlement` apontando para um `fin_document` com direction='receber' e
-- status='liquidado', e 65 de 65 têm amount_cents > 0. Não é inferência sobre o
-- texto: é o documento a receber sendo liquidado.
--
-- O destino é 3.99 e NÃO uma receita específica, e isso é a parte importante da
-- regra. A tentação seria usar a nota fiscal (48 das 65 têm uma). Medido: o
-- código de serviço municipal 17.01.01.501 aparece em 387 lançamentos JÁ
-- decididos e se distribui por 3.03 (147), 3.01 (104), 3.02 (47), 3.04 (27),
-- 3.05 (19), 3.09 (13), 3.06 (8), 3.11 (7), 3.08 (6), 3.14 (5) e 3.10 (4). É o
-- código genérico que a prefeitura usa para tudo — ele prova que houve serviço,
-- não qual. Usá-lo daria uma categoria plausível na linha errada, que é
-- exatamente o erro que não aparece como erro.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, notes, created_by)
SELECT e.id,
       'receita-asaas-cobranca-recebida',
       'Cobrança recebida no Asaas é receita (serviço a determinar)',
       2,
       'transaction',
       '{"all": [{"op": "equals", "field": "source_kind", "value": "PAYMENT_RECEIVED"},
                 {"op": "equals", "field": "direction",   "value": "receber"}]}'::jsonb,
       '{"category_code": "3.99", "review": true}'::jsonb,
       100,
       'seed',
       'ativa',
       'A fonte declara o tipo. 65 linhas de 2026, R$ 113.265,35, com fin_settlement -> '
         || 'fin_document(direction=receber, status=liquidado) em 65 de 65. Vai para 3.99 e NÃO '
         || 'para uma receita específica: o código de serviço municipal 17.01.01.501 cobre 387 '
         || 'linhas já decididas espalhadas por 11 categorias de receita — prova que houve '
         || 'serviço, não qual. review=true mantém a linha na fila. ALCANCE FORA DE 2026: a '
         || 'regra não tem data porque o fato não tem — na próxima passada do reclassificador '
         || 'ela alcança 287 cobranças de 2021–2025 (R$ 151.976,71) que também estão sem '
         || 'categoria. Elas vão para 3.99, ou seja, continuam na fila; nenhuma receita já '
         || 'decidida é trocada — as 2.696 classificadas têm liquidação e classified_rule_id '
         || 'nulo, e caem na proteção heranca_de_documento do reclassificar.mjs.',
       'migration-0056'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- 3.2 Reembolso que VOLTA de fornecedor é recuperação de despesa.
--
-- O banco escreve a natureza da operação, não o nome de quem pagou:
-- "Reembolso recebido pelo Pix" e "Pagamento de boleto devolvido". São 18
-- entradas de 2026, R$ 3.169,21, hoje empilhadas em 5.99 — ou seja, dentro de
-- despesas_administrativas com sinal positivo, ABATENDO despesa administrativa
-- que elas não abatem.
--
-- 9.02 "Recuperação de despesa" existe exatamente para isto. E não é 3.90
-- "Estornos e devoluções": 3.90 é dedução de RECEITA — vale quando somos NÓS
-- que devolvemos ao cliente, que é o caso da regra 19 (`estorno-de-pix`, sobre
-- os source_kind de refund do Asaas). Aqui o dinheiro vem de volta de um
-- fornecedor. As duas regras tratam de sentidos opostos e por isso convivem.
--
-- A guarda de direção é o que impede a regra de virar a irmã errada: sem ela,
-- um pagamento cuja descrição mencione reembolso cairia em 9.02 também.
--
-- Deliberadamente NÃO pareia com a saída correspondente. Havia 7 pares de valor
-- exatamente oposto com o mesmo documento — e 2 casos com DOIS candidatos cada.
-- Parear por valor+data foi como nasceram os dois pareamentos falsos desfeitos
-- na 0044. A entrada é recuperação de despesa por si só, sem precisar dizer
-- qual saída ela cancela.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, notes, created_by)
SELECT e.id,
       'reembolso-recebido-de-fornecedor',
       'Reembolso recebido é recuperação de despesa',
       3,
       'transaction',
       '{"all": [{"op": "contains_any", "field": "description_norm",
                  "value": ["reembolso recebido", "boleto devolvido", "pagamento devolvido"]},
                 {"op": "equals", "field": "direction", "value": "receber"}]}'::jsonb,
       '{"category_code": "9.02"}'::jsonb,
       100,
       'seed',
       'ativa',
       '18 entradas de 2026, R$ 3.169,21, hoje em 5.99 com sinal positivo — abatendo despesa '
         || 'administrativa que não é delas. 9.02 e não 3.90: 3.90 é dedução de receita, para '
         || 'quando NÓS devolvemos ao cliente (regra 19). Aqui o dinheiro volta do fornecedor. '
         || 'A guarda de direção separa as duas. Não pareia com a saída: 2 dos 9 casos tinham '
         || 'dois candidatos de valor oposto, e parear por valor+data foi a origem dos '
         || 'pareamentos falsos da 0044.',
       'migration-0056'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- 3.3 Três fornecedores identificados por CNPJ, com decisão já tomada.
--
-- Este é o padrão que a missão pede: MESMA contraparte identificada por
-- DOCUMENTO, com categoria já decidida em outras linhas dela. Não é semelhança
-- de nome — "LYRA M2M LTDA", "Lyra M2m Ltda" e "LYRA TECN E GESTO EM M2M LTDA"
-- aparecem no extrato como três textos diferentes e são um CNPJ só. É o mesmo
-- argumento da 0042: o nome é o que a outra ponta digitou; o documento é o que
-- o Banco Central carimbou.
--
-- Os três guardas que definem quem entrou aqui, medidos linha a linha:
--   a) unanimidade — todas as decisões anteriores daquele CNPJ na MESMA
--      categoria;
--   b) volume — pelo menos 4 decisões anteriores;
--   c) direção — a decisão anterior e a linha da fila com o mesmo sinal.
--
-- O guarda (c) não é teórico. Sem ele entrariam:
--   · Adryan Santos — 36 saídas em 6.02 Pró-labore e uma ENTRADA de R$ 1.066,38
--     na fila. Dinheiro voltando de quem recebe pró-labore não é pró-labore;
--   · Recife Prommo — uma decisão em 3.12 (receita) e uma SAÍDA de R$ 400,00.
--
-- E um quarto candidato foi barrado por leitura, não por contagem: Pablo
-- Michael Viana Silveira (CPF 98939351487) tem 5 decisões anteriores unânimes
-- em 4.05 "Tarifas bancárias e de cobrança", todas postas pela regra
-- `meios-de-pagamento`, que casa por texto. Pessoa física não emite tarifa
-- bancária. Propagar isso multiplicaria um erro em vez de classificar — a
-- linha fica na fila e o caso está no relatório.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, notes, created_by)
SELECT e.id, v.slug, v.nome, 4, 'transaction',
       jsonb_build_object('all', jsonb_build_array(
         jsonb_build_object('op', 'equals', 'field', 'counterparty_document', 'value', v.doc),
         jsonb_build_object('op', 'equals', 'field', 'direction', 'value', 'pagar')
       )),
       jsonb_build_object('category_code', v.code),
       100, 'seed', 'ativa', v.notes, 'migration-0056'
  FROM fin_entity e,
       (VALUES
         ('fornecedor-lyra-m2m', 'Lyra M2M (CNPJ) — softwares e assinaturas',
          '27554839000128', '5.03',
          'CNPJ único sob três grafias no extrato. 4 decisões anteriores em 5.03, todas com '
            || 'classified_by=humano, todas saídas, mensalidade entre R$ 141,30 e R$ 249,28. '
            || '4 linhas na fila de 2026, R$ 673,36.'),
         ('fornecedor-startlaw', 'Startlaw (CNPJ) — contabilidade e jurídico',
          '35027867000115', '5.04',
          '6 decisões anteriores em 5.04, todas saídas, valor fixo mensal de R$ 1.156,92. '
            || '1 linha na fila de 2026, R$ 1.181,60.'),
         ('concessionaria-neoenergia-pe', 'Neoenergia Pernambuco (CNPJ) — energia',
          '10835932000108', '5.02',
          'Distribuidora de energia; toda saída para este CNPJ é conta de luz. 6 decisões '
            || 'anteriores em 5.02, todas saídas. Substitui, para este CNPJ, a heurística de '
            || 'nome da regra `energia-concessionaria`: a linha da fila chega escrita '
            || '"COMPANHIA ENE DE PE" e nenhuma comparação de texto a alcançaria. '
            || '1 linha na fila de 2026, R$ 123,72.')
       ) AS v(slug, nome, doc, code, notes)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. TRAVAS DE SANIDADE
-- ---------------------------------------------------------------------------
-- Uma regra com `counterparty_document` vazio comparado por igualdade casaria
-- com toda linha de documento nulo, ou seja, com o ledger inteiro. Mesma trava
-- que a 0042 instalou, agora estendida às regras desta migration.
DO $$
DECLARE
  v_slug text;
  v_doc  text;
BEGIN
  FOR v_slug, v_doc IN
    SELECT r.slug, r.conditions -> 'all' -> 0 ->> 'value'
      FROM fin_rule r JOIN fin_entity e ON e.id = r.entity_id
     WHERE e.slug = 'xpe' AND r.created_by = 'migration-0056'
       AND r.conditions -> 'all' -> 0 ->> 'field' = 'counterparty_document'
  LOOP
    IF v_doc IS NULL OR v_doc !~ '^[0-9]{11}$|^[0-9]{14}$' THEN
      RAISE EXCEPTION 'regra % nasceu com documento inválido (%). Abortado.', v_slug, COALESCE(v_doc, '<nulo>');
    END IF;
  END LOOP;
END $$;

-- 3.99 e 5.99 não podem ganhar núcleo padrão — pelo mesmo motivo que a 0055
-- deixou 5.99 sem: dar núcleo a "não sei o que é" escolheria um dono para o
-- desconhecido, e o número ficaria bonito exatamente onde a informação falta.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM fin_category
   WHERE code IN ('3.99', '5.99') AND default_nucleo IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'categoria .99 com default_nucleo preenchido (% linhas): a fila passaria a mentir núcleo.', v_n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não escreve uma linha em `fin_transaction`. Quem aplica é
-- `scripts/classificar-fila.mjs`, em transação, com âncora de dinheiro (a soma
-- por conta não pode mudar) e com `--dry-run` como padrão. É o mesmo arranjo da
-- 0042: a migration abre o lugar e declara a regra; o script preenche e mostra
-- o antes/depois antes de gravar.
--
-- Também não toca em:
--   · fatura do cartão do Inter (9 pagamentos, R$ 41.061,32) — o itemizado
--     desse cartão não está no ledger, e chamá-lo de transferência tiraria
--     despesa real da DRE. Fica `indeterminado:fatura-sem-itemizacao`;
--   · 125 linhas paradas em 5.99 pela regra `marketplace-e-apps` (Uber, iFood,
--     Amazon, "PIX Marketplace") e 101 pela `pix-pessoa-fisica` — a decisão
--     entre 4.04, 5.06 e 6.04 muda o resultado e não há evidência que separe;
--   · MAFEMA (CNPJ 24091522000104, 15 linhas, R$ 23.071,35) e "PIX
--     Marketplace" (CNPJ 10573521000191, 54 linhas, R$ 36.122,04) — contrapartes
--     com documento e volume, sem nenhuma decisão anterior no ledger.
