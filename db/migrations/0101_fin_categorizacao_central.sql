-- Categorização deixa de ser três assuntos que não conversam.
--
-- ============================================================================
-- O DEFEITO — a régua alcança um universo de três
-- ============================================================================
--
-- Medido em 16/08/2026, sobre a base inteira:
--
--   fin_transaction ........ 13.881 linhas ·  492 sem categoria · R$ 613.344,96
--   fin_document ...........  3.418 linhas ·  389 sem categoria · R$ 259.432,76
--   fin_card_transaction ...    795 linhas ·  514 sem categoria · R$ 161.125,80
--                                             ├── 500 categorizáveis  R$  54.126,76
--                                             └──  14 pagamento_fatura R$ 106.999,04
--
-- O indicador "categoria atribuída" do painel mede o PRIMEIRO. Está certo — ele
-- se chama assim porque lê `fin_transaction`, e item de cartão não é
-- lançamento. O efeito é que 889 itens de dois outros universos, somando
-- R$ 313.559,52, não aparecem em indicador nenhum. Não estão errados: estão
-- fora da régua.
--
-- É o padrão que a §8 do CONTINUACAO.md nomeia: **o que este indicador não
-- mede?** A resposta, aqui, é "dois terços dos lugares onde existe categoria".
--
-- Uma busca que atravessa os três é o instrumento mínimo para que o buraco
-- deixe de ser invisível. `fin_categorizavel_v` é essa busca.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--
-- 1. `fin_categorizavel_v` — uma linha por item categorizável dos três
--    universos, com as mesmas colunas: data, descrição, contraparte, valor,
--    direção, categoria, núcleo, centro de custo, PROCEDÊNCIA (quem decidiu,
--    com que evidência, quando), ESTADO (classificado · indeterminado com
--    motivo · em dúvida) e se está travado por decisão humana.
--
-- 2. `fin_categoria_uso_v` — quantos itens vivos cada categoria carrega, nos
--    três universos, e se ela pode ser desativada. É o insumo da recusa
--    do item 4.
--
-- 3. Três recusas do banco, que antes eram aviso em prosa:
--
--    a) **3.99 e 5.99 não são linhas do plano de contas.** São marcadores de
--       indecisão: "3.99 vazia significa zero receita indecisa, que é sucesso"
--       (0094, dúvida 56). Renomeá-las, reagrupá-las ou desativá-las quebra o
--       H3, o gatilho `fin_transaction_fila_indeciso`, a `fin_a_classificar_v`
--       e a leitura de quatro monitores — todos identificam a indecisão pelo
--       CÓDIGO. O banco passa a recusar, e a mensagem explica por quê.
--
--    b) **Categoria que já classificou algo nunca é apagada**, e não é
--       desativada enquanto houver linha viva apontando para ela. Apagar
--       deixaria `classified_reason` falando de uma categoria inexistente;
--       desativar com uso vivo esconde da tela o que continua somando na DRE.
--
--    c) **Campo travado nunca aponta para vazio.** A 0098 travou 2 linhas no
--       nulo e a 0099 teve de desfazer à mão. A causa é estrutural e vai se
--       repetir: `fin_transaction_sinal_da_categoria` ANULA `category_id`
--       quando o sinal não bate, e não sabe nada sobre `human_locked_fields`.
--       Qualquer UPDATE que ponha categoria incompatível numa linha travada
--       reproduz o incidente. Passa a se corrigir sozinho — pelo mesmo motivo
--       e no mesmo estilo de `fin_limpa_motivo_ao_resolver` (0044): a garantia
--       não pode depender da disciplina de quem escrever o próximo script.
--
-- 4. `fin_card_evidencia` ganha o slug `decisao_humana`. Sem ele um item de
--    cartão decidido por gente não tem como declarar a própria evidência —
--    `fin_card_transaction.classified_evidence` é FK para essa tabela e o
--    vocabulário só previa evidência de máquina.
--
-- ============================================================================
-- O QUE ESTA MIGRATION NÃO FAZ
-- ============================================================================
--
-- · **Não reclassifica nada.** Nenhum `category_id` muda de valor aqui. A
--   reclassificação em lote é ato de rota, com gente do outro lado.
--
-- · **Não roda o motor sobre o Inter.** A dúvida 0 continua travando as 205
--   linhas de `6.02 Pró-labore` → `6.01 Salários`. A rota de lote existe para
--   que uma PESSOA decida isso; ela não é o `reclassificar.mjs --conta=inter`
--   com outra roupa.
--
-- · **Não cria coluna de "sinal esperado" em `fin_category`.** O sinal já é
--   consequência de `kind`, e é `fin_transaction_sinal_da_categoria` quem o
--   aplica. Uma segunda coluna dizendo a mesma coisa é uma segunda verdade
--   esperando para divergir. A API deriva o sinal de `kind` e diz de onde veio.
--
-- · **Não depende da 0102, e é decisão consciente.** A frente da DRE criou
--   `fin_dre_mover_avaliar`, que valida o sinal antes do UPDATE — a mesma
--   defesa que a rota de lote desta frente faz em TypeScript. Não a chamo por
--   duas razões medidas: ela cobre `fin_transaction` e `fin_card_transaction`,
--   e **não cobre `fin_document`**, que é 389 dos 889 itens que esta frente
--   existe para alcançar; e amarrar duas migrations não aplicadas, de frentes
--   diferentes, faz a ordem de aplicação virar pré-condição de ambas — o
--   erro de coordenação que a §6 do CONTINUACAO.md documenta. Quando as duas
--   estiverem aplicadas, `fin_dre_mover_avaliar` é o validador mais rico para
--   os dois universos que ela cobre e vale unificar. A regra de sinal em si
--   já tem fonte única e não foi copiada: quem a aplica é o gatilho
--   `fin_transaction_sinal_da_categoria`.
--
--   As duas migrations inserem `decisao_humana` em `fin_card_evidencia`, as
--   duas com `ON CONFLICT (slug)`. Aplicadas em qualquer ordem, nenhuma falha.
--
-- · **Não soma os três universos.** A view existe para BUSCAR, nunca para
--   somar: `fin_card_transaction.amount_cents` é sinal de DÍVIDA (positivo
--   aumenta o que se deve) e `fin_transaction.amount_cents` é sinal de CAIXA
--   (negativo é saída). São grandezas diferentes, como a 0047 já avisava. Por
--   isso a view expõe `valor_abs_cents` + `direcao`, e o valor bruto fica em
--   `valor_fonte_cents` com o nome dizendo que é da fonte.
--
-- O runner já envolve cada arquivo numa transação; não abra outra aqui.

-- ---------------------------------------------------------------------------
-- 0. ÂNCORA DE DINHEIRO — fotografada antes de qualquer escrita
-- ---------------------------------------------------------------------------
-- Esta migration não escreve em nenhuma tabela de valor. Conferir mesmo assim
-- é o padrão da casa, e é barato.
CREATE TEMP TABLE _ancora_0101 ON COMMIT DROP AS
  SELECT account_id, count(*) AS n, sum(amount_cents) AS soma
    FROM fin_transaction GROUP BY account_id;

-- ---------------------------------------------------------------------------
-- 1. PRÉ-CONDIÇÕES — se a fotografia mudou, reauditar em vez de forçar
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_marcadores integer;
  v_universos  integer;
BEGIN
  SELECT count(*) INTO v_marcadores
    FROM fin_category WHERE code IN ('3.99', '5.99') AND is_active;
  IF v_marcadores <> 2 THEN
    RAISE EXCEPTION
      '0101: esperava 3.99 e 5.99 ativas (os dois marcadores de indecisão), achei %', v_marcadores;
  END IF;

  -- As três tabelas que carregam category_id. Se aparecer uma quarta, a view
  -- passa a mentir por omissão e quem a acrescentar tem de vir aqui.
  SELECT count(*) INTO v_universos
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'category_id'
     AND table_name IN ('fin_transaction', 'fin_document', 'fin_card_transaction');
  IF v_universos <> 3 THEN
    RAISE EXCEPTION '0101: esperava category_id nas 3 tabelas de universo, achei %', v_universos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. VOCABULÁRIO: decisão humana é evidência de cartão
-- ---------------------------------------------------------------------------
-- `classified_evidence` é FK para `fin_card_evidencia`. O vocabulário da 0083
-- só previa evidência de máquina (MCC, plano, identidade do produto), então
-- um item de cartão decidido na tela não tinha como declarar a própria
-- procedência — e o CHECK `fin_card_transaction_evidencia_tem_categoria` exige
-- que evidência e categoria andem juntas.
--
-- `decide = true` é coerente com força 100: gente decide. Isso NÃO cria regra
-- nenhuma — `fin_card_classificacao_futura` só considera slugs que aparecem em
-- `fin_card_classificacao_regra`, e nenhuma regra usa este. O classificador
-- automático continua exatamente como está.
INSERT INTO fin_card_evidencia (slug, nome, forca, decide, descricao)
VALUES ('decisao_humana', 'Decisão humana', 100, true,
        'Uma pessoa olhou o item e decidiu. É a evidência mais forte que existe e '
        || 'a única que a automação não pode produzir. Vem sempre acompanhada de '
        || 'fin_classification_event com o valor anterior, para que o desfazer seja possível.')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. A BUSCA UNIFICADA
-- ---------------------------------------------------------------------------
-- Uma função em vez de um CASE repetido três vezes: a família da procedência
-- é vocabulário, e vocabulário que existe em três cópias diverge.
CREATE OR REPLACE FUNCTION fin_procedencia_familia(p_classified_by text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_classified_by
    WHEN 'humano'          THEN 'humano'
    WHEN 'trava'           THEN 'humano'
    WHEN 'contrato'        THEN 'contrato'
    WHEN 'regra'           THEN 'regra'
    WHEN 'fato_estrutural' THEN 'fonte'
    WHEN 'favorecido'      THEN 'cadastro'
    WHEN 'historico'       THEN 'historico'
    WHEN 'default'         THEN 'padrao'
    ELSE 'indefinida'
  END;
$function$;

COMMENT ON FUNCTION fin_procedencia_familia(text) IS
  'Agrupa os 8 valores de classified_by nas famílias que a tela mostra. '
  'fato_estrutural vira "fonte" porque é isso que ele promete (D5): a evidência '
  'veio da fonte, não de um palpite sobre texto livre.';


-- Uma linha por item categorizável, nos três universos, com colunas de mesmo
-- nome e mesmo significado.
--
-- DUAS DECISÕES DE MODELAGEM QUE VALE EXPLICAR
--
-- **`estado` tem três valores e a ordem entre eles importa.** Um item sem
-- categoria SEMPRE tem item de fila pendente — é o H3, e ele está certo. Se
-- "em dúvida" ganhasse de "indeterminado", os 492 lançamentos sem categoria
-- apareceriam como dúvida e a população que precisa de evidência sumiria
-- dentro da que precisa só de aceite. Então:
--
--   indeterminado  →  não há categoria utilizável (nula, 3.99 ou 5.99)
--   em_duvida      →  HÁ categoria de verdade e ainda assim a fila pergunta
--                     (os 413 de `baixa_confianca`: "classifiquei, confirme")
--   classificado   →  categoria de verdade e nada pendente
--
-- **`motivo_indeterminado` distingue "não sei, e eis por quê" de "não sei, e
-- não disse por quê".** A restrição absoluta nº 5 é *onde não houver
-- evidência, o valor é indeterminado, COM MOTIVO*. Um item indeterminado sem
-- motivo declarado é uma violação dessa regra, e a view a nomeia
-- (`sem-motivo-declarado`) em vez de deixá-la em branco — foi assim que a 0094
-- achou os dois créditos do CONDOMINIO LE PARC.
CREATE OR REPLACE VIEW fin_categorizavel_v AS

-- 3a. LANÇAMENTO — o caixa. Sinal negativo é saída.
SELECT
  'lancamento'::text                                    AS universo,
  t.id                                                  AS id,
  t.entity_id                                           AS entity_id,
  t.posted_on                                           AS data,
  t.competence_date                                     AS competencia,
  t.description_raw                                     AS descricao,
  t.description_norm                                    AS descricao_norm,
  t.counterparty_id                                     AS contraparte_id,
  COALESCE(cp.name, NULLIF(t.counterparty_raw, ''))     AS contraparte,
  COALESCE(t.counterparty_document, cp.document_number) AS contraparte_documento,
  abs(t.amount_cents)                                   AS valor_abs_cents,
  t.amount_cents                                        AS valor_fonte_cents,
  CASE WHEN t.amount_cents >= 0 THEN 'entrada' ELSE 'saida' END AS direcao,
  t.category_id                                         AS category_id,
  c.code                                                AS categoria_code,
  c.name                                                AS categoria_nome,
  c.kind                                                AS categoria_kind,
  c.cash_flow_group                                     AS categoria_grupo,
  t.nucleo                                              AS nucleo,
  t.cost_center_id                                      AS cost_center_id,
  cc.slug                                               AS centro_custo,
  cc.name                                               AS centro_custo_nome,
  t.classified_by                                       AS procedencia,
  fin_procedencia_familia(t.classified_by)              AS procedencia_familia,
  t.classified_rule_id                                  AS procedencia_regra_id,
  r.slug                                                AS procedencia_regra,
  t.classified_reason                                   AS procedencia_evidencia,
  COALESCE(t.classified_reason->>'motivo',
           t.classified_reason->>'origem',
           t.classified_reason->>'campo',
           t.classified_reason->>'regra')               AS procedencia_evidencia_txt,
  t.classified_at                                       AS procedencia_em,
  t.review_status                                       AS review_status,
  ri.id                                                 AS fila_item_id,
  ri.reason                                             AS fila_motivo,
  ri.status                                             AS fila_status,
  CASE
    WHEN t.category_id IS NOT NULL AND c.code NOT IN ('3.99', '5.99') THEN NULL
    ELSE COALESCE(
      (SELECT string_agg(replace(u.tag, 'indeterminado:', ''), ',' ORDER BY u.tag)
         FROM unnest(COALESCE(t.tags, '{}'::text[])) u(tag)
        WHERE u.tag LIKE 'indeterminado:%'),
      CASE WHEN c.code IN ('3.99', '5.99') THEN 'marcado-a-classificar' END,
      t.classified_reason->>'motivo',
      'sem-motivo-declarado')
  END                                                   AS motivo_indeterminado,
  CASE
    WHEN t.category_id IS NULL OR c.code IN ('3.99', '5.99') THEN 'indeterminado'
    WHEN ri.status = 'pendente'                              THEN 'em_duvida'
    ELSE 'classificado'
  END                                                   AS estado,
  ('category_id' = ANY (t.human_locked_fields))         AS travado,
  t.human_locked_fields                                 AS travado_campos,
  a.slug                                                AS fonte,
  a.name                                                AS fonte_rotulo,
  true                                                  AS classificavel,
  NULL::text                                            AS motivo_nao_classificavel
FROM fin_transaction t
JOIN fin_account a ON a.id = t.account_id
LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
LEFT JOIN fin_category    c  ON c.id  = t.category_id
LEFT JOIN fin_cost_center cc ON cc.id = t.cost_center_id
LEFT JOIN fin_rule        r  ON r.id  = t.classified_rule_id
LEFT JOIN fin_review_item ri ON ri.target_table = 'fin_transaction' AND ri.target_id = t.id
-- Linha-pai de split não é categorizável: ela é a soma dos filhos, e todo
-- invariante de classificação já a exclui. Hoje são 0; a cláusula existe para
-- que continuar sendo 0 não dependa de sorte.
WHERE NOT t.is_split_parent

UNION ALL

-- 3b. DOCUMENTO — a carteira. Direção é declarada, não deduzida do sinal.
SELECT
  'documento'::text,
  d.id,
  d.entity_id,
  COALESCE(d.competence_date, d.due_date, d.issue_date),
  d.competence_date,
  d.description,
  d.description_norm,
  d.counterparty_id,
  cp.name,
  cp.document_number,
  abs(d.amount_cents),
  d.amount_cents,
  CASE WHEN d.direction = 'receber' THEN 'entrada' ELSE 'saida' END,
  d.category_id,
  c.code, c.name, c.kind, c.cash_flow_group,
  d.nucleo,
  d.cost_center_id, cc.slug, cc.name,
  d.classified_by,
  fin_procedencia_familia(d.classified_by),
  d.classified_rule_id,
  r.slug,
  d.classified_reason,
  COALESCE(d.classified_reason->>'motivo',
           d.classified_reason->>'origem',
           d.classified_reason->>'campo',
           d.classified_reason->>'regra'),
  d.classified_at,
  d.review_status,
  ri.id, ri.reason, ri.status,
  CASE
    WHEN d.category_id IS NOT NULL AND c.code NOT IN ('3.99', '5.99') THEN NULL
    ELSE COALESCE(
      (SELECT string_agg(replace(u.tag, 'indeterminado:', ''), ',' ORDER BY u.tag)
         FROM unnest(COALESCE(d.tags, '{}'::text[])) u(tag)
        WHERE u.tag LIKE 'indeterminado:%'),
      CASE WHEN c.code IN ('3.99', '5.99') THEN 'marcado-a-classificar' END,
      -- O motivo mais comum da carteira, e ele é da FONTE: a cobrança do Asaas
      -- vem sem texto que descreva o serviço. É a dúvida 53, 346 itens.
      CASE WHEN ri.reason = 'texto_generico' THEN 'cobranca-sem-texto-na-fonte' END,
      d.classified_reason->>'motivo',
      'sem-motivo-declarado')
  END,
  CASE
    WHEN d.category_id IS NULL OR c.code IN ('3.99', '5.99') THEN 'indeterminado'
    WHEN ri.status = 'pendente'                              THEN 'em_duvida'
    ELSE 'classificado'
  END,
  ('category_id' = ANY (d.human_locked_fields)),
  d.human_locked_fields,
  d.source,
  CASE d.source WHEN 'asaas' THEN 'Cobranças Asaas'
                WHEN 'clickup' THEN 'Compromissos ClickUp'
                ELSE d.source END,
  true,
  NULL::text
FROM fin_document d
LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
LEFT JOIN fin_category    c  ON c.id  = d.category_id
LEFT JOIN fin_cost_center cc ON cc.id = d.cost_center_id
LEFT JOIN fin_rule        r  ON r.id  = d.classified_rule_id
LEFT JOIN fin_review_item ri ON ri.target_table = 'fin_document' AND ri.target_id = d.id

UNION ALL

-- 3c. ITEM DE CARTÃO — o subledger. Sinal INVERSO ao do caixa: positivo
--     aumenta a dívida, ou seja, é despesa. Ver o comentário da 0047.
--
--     Não há `fin_review_item` deste lado: o CHECK
--     `fin_review_item_target_table_check` só aceita transaction e document.
--     Por isso `estado` do cartão nunca é 'em_duvida' — e essa ausência é ela
--     própria um achado, registrado no comentário da view.
SELECT
  'item_cartao'::text,
  x.id,
  ca.entity_id,
  x.posted_on,
  COALESCE(x.competence_date, x.competence_month),
  x.description,
  x.description_norm,
  x.counterparty_id,
  COALESCE(cp.name, x.merchant),
  cp.document_number,
  abs(x.amount_cents),
  x.amount_cents,
  CASE WHEN x.amount_cents > 0 THEN 'saida' ELSE 'entrada' END,
  x.category_id,
  c.code, c.name, c.kind, c.cash_flow_group,
  x.nucleo,
  x.cost_center_id, cc.slug, cc.name,
  x.classified_by,
  fin_procedencia_familia(x.classified_by),
  x.classified_rule_id,
  r.slug,
  jsonb_strip_nulls(jsonb_build_object(
    'evidencia', x.classified_evidence,
    'mcc', x.mcc,
    'indicio_da_fonte', x.source_category,
    'plano_id', x.installment_plan_id)),
  x.classified_evidence,
  x.classified_at,
  x.review_status,
  NULL::bigint, NULL::text, NULL::text,
  CASE
    WHEN x.category_id IS NOT NULL AND c.code NOT IN ('3.99', '5.99') THEN NULL
    WHEN x.kind = 'pagamento_fatura' THEN 'liquidacao-de-fatura-nao-e-despesa'
    -- `fin_card_a_classificar_v` (0083) já classifica o motivo item a item,
    -- com o dado na mão. Reescrevê-lo aqui criaria uma segunda explicação para
    -- o mesmo item, e as duas divergiriam na primeira correção feita só de um
    -- lado — é o motivo de lib/financeiro/qualificar.ts importar o motor do CLI.
    ELSE COALESCE(ac.motivo, 'sem-motivo-declarado')
  END,
  CASE
    WHEN x.category_id IS NULL OR c.code IN ('3.99', '5.99') THEN 'indeterminado'
    ELSE 'classificado'
  END,
  ('category_id' = ANY (x.human_locked_fields)),
  x.human_locked_fields,
  ca.slug,
  ca.name,
  -- O pagamento da fatura NÃO é despesa: é a baixa do que o subledger já
  -- contou item a item. Categorizá-lo somaria a mesma saída duas vezes na DRE.
  -- Ele aparece na busca — esconder seria a versão elegante de omitir — mas
  -- declarado como não classificável, com o motivo junto.
  (x.kind <> 'pagamento_fatura'),
  CASE WHEN x.kind = 'pagamento_fatura'
       THEN 'a fatura já está itemizada linha a linha neste subledger; '
            || 'categorizar o pagamento contaria a mesma despesa duas vezes'
  END
FROM fin_card_transaction x
JOIN fin_card_account ca ON ca.id = x.card_account_id
LEFT JOIN fin_counterparty cp ON cp.id = x.counterparty_id
LEFT JOIN fin_category    c  ON c.id  = x.category_id
LEFT JOIN fin_cost_center cc ON cc.id = x.cost_center_id
LEFT JOIN fin_rule        r  ON r.id  = x.classified_rule_id
LEFT JOIN fin_card_a_classificar_v ac ON ac.id = x.id;

COMMENT ON VIEW fin_categorizavel_v IS
  'Busca unificada sobre tudo que tem categoria: lançamento, documento e item '
  'de cartão, com as mesmas colunas. Existe porque o indicador "categoria '
  'atribuída" mede só fin_transaction — 889 itens de R$ 313.559,52 dos outros '
  'dois universos não aparecem em indicador nenhum. É view de BUSCA: nunca '
  'some valor_fonte_cents entre universos, porque o sinal do cartão é de '
  'dívida e o do lançamento é de caixa (0047). Use valor_abs_cents + direcao. '
  'Item de cartão nunca fica em estado em_duvida: fin_review_item não aceita '
  'fin_card_transaction como alvo, então a fila não alcança o subledger.';

-- ---------------------------------------------------------------------------
-- 4. USO DE CADA CATEGORIA — o insumo da recusa de desativação
-- ---------------------------------------------------------------------------
-- "Ociosa" e "pode sair do plano de contas" são perguntas diferentes, e o M13
-- já aprendeu isso da pior forma: ele contava `5.11 Frete e logística` como
-- linha morta porque lia só duas das três tabelas. Um item de cartão de
-- R$ 1.222,56 estava lá o tempo todo (0094).
--
-- Esta view conta os TRÊS universos, sempre, e separa uso vivo de uso
-- histórico: uma categoria pode não ter nenhuma linha hoje e ainda assim
-- aparecer em `fin_classification_event` ou em `fin_rule.actions` — desativá-la
-- deixaria a trilha apontando para algo que a tela não mostra mais.
CREATE OR REPLACE VIEW fin_categoria_uso_v AS
WITH uso AS (
  SELECT c.id,
         (SELECT count(*) FROM fin_transaction      t WHERE t.category_id = c.id AND NOT t.is_split_parent) AS n_lancamento,
         (SELECT count(*) FROM fin_document         d WHERE d.category_id = c.id) AS n_documento,
         (SELECT count(*) FROM fin_card_transaction x WHERE x.category_id = c.id) AS n_item_cartao,
         (SELECT COALESCE(sum(abs(t.amount_cents)), 0) FROM fin_transaction      t WHERE t.category_id = c.id AND NOT t.is_split_parent) AS v_lancamento,
         (SELECT COALESCE(sum(abs(d.amount_cents)), 0) FROM fin_document         d WHERE d.category_id = c.id) AS v_documento,
         (SELECT COALESCE(sum(abs(x.amount_cents)), 0) FROM fin_card_transaction x WHERE x.category_id = c.id) AS v_item_cartao,
         (SELECT count(*) FROM fin_classification_event e WHERE e.category_id = c.id) AS n_eventos,
         (SELECT count(*) FROM fin_rule r
           WHERE r.status <> 'arquivada' AND r.actions->>'category_code' = c.code) AS n_regras,
         (SELECT count(*) FROM fin_card_classificacao_regra cr WHERE cr.category_id = c.id AND cr.is_active) AS n_regras_cartao,
         (SELECT count(*) FROM fin_counterparty p WHERE p.default_category_id = c.id) AS n_contrapartes
    FROM fin_category c
)
SELECT c.id,
       c.code,
       c.name,
       c.kind,
       c.cash_flow_group,
       c.dre_line,
       c.default_nucleo,
       c.is_active,
       u.n_lancamento, u.n_documento, u.n_item_cartao,
       (u.n_lancamento + u.n_documento + u.n_item_cartao)          AS n_vivo,
       (u.v_lancamento + u.v_documento + u.v_item_cartao)          AS valor_vivo_cents,
       u.n_eventos, u.n_regras, u.n_regras_cartao, u.n_contrapartes,
       (c.code IN ('3.99', '5.99'))                                AS marcador_de_indecisao,
       -- A ordem é a ordem em que a recusa acontece no gatilho: o marcador
       -- vence tudo, depois o uso vivo, depois a trilha e as dependências.
       CASE
         WHEN c.code IN ('3.99', '5.99')                    THEN false
         WHEN u.n_lancamento + u.n_documento + u.n_item_cartao > 0 THEN false
         WHEN u.n_regras + u.n_regras_cartao + u.n_contrapartes > 0 THEN false
         ELSE true
       END                                                        AS pode_desativar,
       CASE
         WHEN c.code IN ('3.99', '5.99')
           THEN 'marcador de indecisão: não é linha do plano de contas e o H3 depende do código'
         WHEN u.n_lancamento + u.n_documento + u.n_item_cartao > 0
           THEN format('%s item(ns) vivo(s) apontam para ela — %s lançamento, %s documento, %s cartão',
                       u.n_lancamento + u.n_documento + u.n_item_cartao,
                       u.n_lancamento, u.n_documento, u.n_item_cartao)
         WHEN u.n_regras + u.n_regras_cartao + u.n_contrapartes > 0
           THEN format('%s regra(s) de lançamento, %s regra(s) de cartão e %s contraparte(s) ainda a produzem',
                       u.n_regras, u.n_regras_cartao, u.n_contrapartes)
         ELSE NULL
       END                                                        AS motivo_bloqueio,
       -- Nunca apagar: mesmo sem uso vivo, a trilha pode citá-la.
       (u.n_eventos > 0)                                          AS tem_trilha
  FROM fin_category c
  JOIN uso u ON u.id = c.id;

COMMENT ON VIEW fin_categoria_uso_v IS
  'Uso de cada categoria nos TRÊS universos, mais trilha e dependências. '
  'Existe porque "ociosa" e "pode sair do plano" são perguntas diferentes: o '
  'M13 chamou 5.11 de linha morta lendo só duas tabelas, e havia um item de '
  'cartão de R$ 1.222,56 nela (0094). pode_desativar é o que o gatilho '
  'fin_category_desativacao_guard aplica — a view e a recusa leem a mesma régua.';

-- ---------------------------------------------------------------------------
-- 5. RECUSA 1 — 3.99 e 5.99 não são linhas do plano de contas
-- ---------------------------------------------------------------------------
-- Elas são marcadores de indecisão. Quem depende do CÓDIGO delas, hoje:
--
--   fin_transaction_fila_indeciso   gatilho, 0080 — põe na fila quem está ali
--   fin_transaction_revisao_sincroniza  gatilho, 0094 — nega review_status ok
--   fin_review_item_sincroniza      gatilho — não resolve item de .99
--   H3, H1, H2                      invariantes (CODIGO_A_CLASSIFICAR)
--   fin_a_classificar_v, fin_fila_saude_v, painel-financeiro.mjs
--
-- Renomear é o menor dos estragos (a tela mente). Reagrupar move dinheiro
-- indeciso de linha na DRE. Desativar faz a fila parar de enxergar 237 itens,
-- R$ 112.492,54, que dizem "não sei o que é isso" — exatamente a regressão que
-- a §5 do CONTINUACAO.md descreve, e que custou 7,4 pontos do indicador de
-- revisão para ser desfeita.
CREATE OR REPLACE FUNCTION fin_category_marcador_indecisao_guard()
RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.code NOT IN ('3.99', '5.99') THEN
    RETURN NEW;
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION
      'categoria % é marcador de indecisão, não linha do plano de contas: o código é lido por '
      'gatilho (fin_transaction_fila_indeciso), por invariante (H1, H2, H3) e por quatro views. '
      'Mudar o código faz a base parar de enxergar o dinheiro indeciso.', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION
      'categoria % é marcador de indecisão: o nome "%" descreve o ESTADO ("a classificar"), não uma '
      'natureza de despesa ou receita. Renomeá-la para algo que pareça linha de DRE convida a '
      'próxima pessoa a usá-la como destino em vez de como pergunta.', OLD.code, OLD.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.cash_flow_group IS DISTINCT FROM OLD.cash_flow_group
     OR NEW.dre_line IS DISTINCT FROM OLD.dre_line
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION
      'categoria % é marcador de indecisão e o agrupamento dela não se decide: reagrupar move '
      'R$ indeciso de linha na DRE sem que ninguém tenha decidido o que aquele dinheiro é.', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT NEW.is_active THEN
    RAISE EXCEPTION
      'categoria % não pode ser desativada: ela é onde a base guarda "não sei o que é isso". '
      'Desativá-la não classifica nada — só tira da fila o que continua indeciso, que é '
      'exatamente a regressão descrita na §5 de docs/CONTINUACAO.md. 3.99 VAZIA é o sucesso; '
      '3.99 desativada é a cegueira.', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION fin_category_marcador_indecisao_guard() IS
  'Recusa renomear, reagrupar, recodificar ou desativar 3.99 e 5.99. Elas não '
  'são linhas do plano de contas: são o vocabulário da indecisão, e o código '
  'delas é lido por três gatilhos, três invariantes e quatro views.';

DROP TRIGGER IF EXISTS fin_category_marcador_indecisao ON fin_category;
CREATE TRIGGER fin_category_marcador_indecisao
  BEFORE UPDATE ON fin_category
  FOR EACH ROW EXECUTE FUNCTION fin_category_marcador_indecisao_guard();

-- ---------------------------------------------------------------------------
-- 6. RECUSA 2 — categoria com uso vivo não desativa; categoria com trilha
--    nunca é apagada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_category_desativacao_guard()
RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
  v_uso   record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT n_vivo, n_eventos, code INTO v_uso
      FROM fin_categoria_uso_v WHERE id = OLD.id;
    IF COALESCE(v_uso.n_vivo, 0) > 0 OR COALESCE(v_uso.n_eventos, 0) > 0 THEN
      RAISE EXCEPTION
        'categoria % já classificou algo e não se apaga: % item(ns) vivo(s) e % evento(s) de '
        'trilha apontam para ela. Apagar deixaria fin_classification_event contando uma decisão '
        'sobre uma categoria que não existe — o desfazer perderia o destino. Desative.',
        OLD.code, COALESCE(v_uso.n_vivo, 0), COALESCE(v_uso.n_eventos, 0)
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: só interessa a transição ativa → inativa.
  IF NEW.is_active OR OLD.is_active IS NOT DISTINCT FROM NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT pode_desativar, motivo_bloqueio, n_vivo, valor_vivo_cents
    INTO v_uso
    FROM fin_categoria_uso_v WHERE id = NEW.id;

  IF NOT COALESCE(v_uso.pode_desativar, false) THEN
    RAISE EXCEPTION
      'categoria % não pode ser desativada: %. Valor vivo apontando para ela: R$ %. '
      'Desativar não move nada — só some da tela o que continua somando na DRE.',
      NEW.code, v_uso.motivo_bloqueio,
      to_char(COALESCE(v_uso.valor_vivo_cents, 0) / 100.0, 'FM999G999G990D00')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION fin_category_desativacao_guard() IS
  'Recusa apagar categoria que já classificou algo (a trilha perderia o '
  'destino) e recusa desativar categoria com linha viva apontando para ela. '
  'Lê a mesma régua que fin_categoria_uso_v mostra, para que a tela nunca '
  'ofereça um botão que o banco vai negar.';

DROP TRIGGER IF EXISTS fin_category_desativacao ON fin_category;
CREATE TRIGGER fin_category_desativacao
  BEFORE UPDATE OR DELETE ON fin_category
  FOR EACH ROW EXECUTE FUNCTION fin_category_desativacao_guard();

-- ---------------------------------------------------------------------------
-- 7. RECUSA 3 — campo travado nunca aponta para vazio (E2, por construção)
-- ---------------------------------------------------------------------------
-- A 0098 travou `category_id` em 2 linhas cujo `category_id` já era NULL, e a
-- 0099 desfez à mão. A causa não foi descuido pontual — é estrutural:
--
--   `fin_transaction_sinal_da_categoria` (gatilho BEFORE) ANULA category_id,
--   classified_by e classified_rule_id quando o sinal da categoria não bate
--   com o do lançamento. Ele não sabe nada sobre human_locked_fields, e não
--   deveria: o trabalho dele é outro.
--
-- Consequência: QUALQUER escrita que ponha uma categoria de sinal incompatível
-- numa linha e trave o campo no mesmo UPDATE — que é exatamente o que uma rota
-- de reclassificação em lote faz — sai com a trava apontando para NULL. E2
-- passa a falhar e a linha fica congelada no vazio: travada, portanto nunca
-- mais classificada por ninguém.
--
-- A correção certa é a mesma que a 0044 usou para `transfer_unresolved_reason`:
-- o banco se limpa sozinho, "não por disciplina de quem escrever o próximo
-- script". Trava sobre coluna nula não é trava — é congelamento — e sai.
--
-- Roda por último entre os BEFORE (prefixo `zz_`, depois de
-- `zz_fin_transaction_rule_version`), para ver o estado FINAL da linha.
CREATE OR REPLACE FUNCTION fin_trava_nao_aponta_para_vazio()
RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
  v_linha    jsonb;
  v_mantidas text[] := '{}';
  col        text;
BEGIN
  IF NEW.human_locked_fields IS NULL OR array_length(NEW.human_locked_fields, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_linha := to_jsonb(NEW);
  FOREACH col IN ARRAY NEW.human_locked_fields LOOP
    -- Coluna inexistente é erro de programação e continua estourando:
    -- fin_preserve_human_locks já levanta exceção nesse caso, e silenciar aqui
    -- esconderia o defeito dele.
    IF NOT (v_linha ? col) THEN
      RAISE EXCEPTION 'human_locked_fields aponta para coluna inexistente em %: %', TG_TABLE_NAME, col;
    END IF;
    IF jsonb_typeof(v_linha -> col) <> 'null' THEN
      v_mantidas := array_append(v_mantidas, col);
    END IF;
  END LOOP;

  IF v_mantidas = NEW.human_locked_fields THEN
    RETURN NEW;
  END IF;

  NEW.human_locked_fields := v_mantidas;

  -- E1 diz que linha travada foi classificada por gente. Se ainda sobrou
  -- trava e o carimbo humano foi apagado por outro gatilho no meio do caminho,
  -- ele é RESTAURADO do valor antigo — nunca inventado. Se o antigo também não
  -- era humano, a linha já violava E1 antes desta escrita e não é aqui que se
  -- descobre isso.
  IF TG_OP = 'UPDATE'
     AND array_length(v_mantidas, 1) IS NOT NULL
     AND COALESCE(NEW.classified_by, '') NOT IN ('humano', 'trava')
     AND COALESCE(OLD.classified_by, '') IN ('humano', 'trava') THEN
    NEW.classified_by := OLD.classified_by;
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION fin_trava_nao_aponta_para_vazio() IS
  'E2 por construção: uma trava sobre coluna nula não protege decisão nenhuma, '
  'ela congela o vazio — a linha fica travada e nunca mais é classificada. '
  'A 0098 criou 2 casos assim e a 0099 desfez à mão; a causa (o gatilho de '
  'sinal anular category_id sem saber das travas) continua de pé e reincide a '
  'cada reclassificação com categoria de sinal incompatível.';

DROP TRIGGER IF EXISTS zz_fin_transaction_trava_nao_vazia ON fin_transaction;
CREATE TRIGGER zz_fin_transaction_trava_nao_vazia
  BEFORE INSERT OR UPDATE ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_trava_nao_aponta_para_vazio();

DROP TRIGGER IF EXISTS zz_fin_document_trava_nao_vazia ON fin_document;
CREATE TRIGGER zz_fin_document_trava_nao_vazia
  BEFORE INSERT OR UPDATE ON fin_document
  FOR EACH ROW EXECUTE FUNCTION fin_trava_nao_aponta_para_vazio();

DROP TRIGGER IF EXISTS zz_fin_card_transaction_trava_nao_vazia ON fin_card_transaction;
CREATE TRIGGER zz_fin_card_transaction_trava_nao_vazia
  BEFORE INSERT OR UPDATE ON fin_card_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_trava_nao_aponta_para_vazio();

-- ---------------------------------------------------------------------------
-- 8. ÍNDICES — a busca por texto e por faixa de valor sobre 18.094 linhas
-- ---------------------------------------------------------------------------
-- Nada de GIN/trigram: a base tem 18.094 itens categorizáveis somados, e um
-- índice de texto aqui seria manutenção sem ganho medido. O que ajuda de
-- verdade é o alcance da fila, que a busca filtra em quase toda consulta.
CREATE INDEX IF NOT EXISTS fin_review_item_alvo_pendente_idx
  ON fin_review_item (target_table, target_id) WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS fin_card_transaction_categoria_idx
  ON fin_card_transaction (category_id);

-- ---------------------------------------------------------------------------
-- 9. ASSERÇÕES — o que esta migration afirma sobre a base, medido agora
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n        bigint;
  v_lanc     bigint;
  v_doc      bigint;
  v_cartao   bigint;
  v_sem_mot  bigint;
  v_cents    bigint;
BEGIN
  -- 9.1 A view alcança os três universos, e a contagem bate com as tabelas.
  SELECT count(*) FILTER (WHERE universo = 'lancamento'),
         count(*) FILTER (WHERE universo = 'documento'),
         count(*) FILTER (WHERE universo = 'item_cartao')
    INTO v_lanc, v_doc, v_cartao
    FROM fin_categorizavel_v;

  SELECT count(*) INTO v_n FROM fin_transaction WHERE NOT is_split_parent;
  IF v_lanc <> v_n THEN
    RAISE EXCEPTION '0101: a view perdeu lançamento — % na view, % na tabela', v_lanc, v_n;
  END IF;
  SELECT count(*) INTO v_n FROM fin_document;
  IF v_doc <> v_n THEN
    RAISE EXCEPTION '0101: a view perdeu documento — % na view, % na tabela', v_doc, v_n;
  END IF;
  SELECT count(*) INTO v_n FROM fin_card_transaction;
  IF v_cartao <> v_n THEN
    RAISE EXCEPTION '0101: a view perdeu item de cartão — % na view, % na tabela', v_cartao, v_n;
  END IF;

  -- 9.2 Nenhuma linha duplicada: (universo, id) é chave.
  SELECT count(*) INTO v_n FROM (
    SELECT universo, id FROM fin_categorizavel_v GROUP BY 1, 2 HAVING count(*) > 1
  ) dup;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0101: % par(es) (universo, id) repetido(s) na view — o LEFT JOIN multiplicou linha', v_n;
  END IF;

  -- 9.3 Todo item indeterminado declara motivo. A restrição absoluta nº 5 é
  --     "indeterminado, COM MOTIVO" — a view nunca deixa o motivo em branco,
  --     mas pode declarar 'sem-motivo-declarado', e essa população é o achado.
  SELECT count(*) INTO v_n
    FROM fin_categorizavel_v WHERE estado = 'indeterminado' AND motivo_indeterminado IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0101: % item(ns) indeterminados sem coluna de motivo preenchida', v_n;
  END IF;

  SELECT count(*) INTO v_sem_mot
    FROM fin_categorizavel_v WHERE motivo_indeterminado = 'sem-motivo-declarado';

  -- 9.4 Nenhuma trava aponta para vazio (E2), agora garantido por gatilho.
  SELECT count(*) INTO v_n FROM fin_categorizavel_v WHERE travado AND category_id IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      '0101: % linha(s) travadas apontando para categoria nula — o gatilho zz_*_trava_nao_vazia '
      'só age em escrita futura; estas precisam de UPDATE como o da 0099', v_n;
  END IF;

  -- 9.5 ÂNCORA DE DINHEIRO. Nada aqui escreve em caixa; conferir é o padrão.
  SELECT count(*) INTO v_n
    FROM _ancora_0101 a
    FULL JOIN (SELECT account_id, count(*) AS n, sum(amount_cents) AS soma
                 FROM fin_transaction GROUP BY account_id) d
      ON d.account_id = a.account_id
   WHERE a.n IS DISTINCT FROM d.n OR a.soma IS DISTINCT FROM d.soma;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0101: a âncora mudou em % conta(s) — esta migration não pode mover dinheiro', v_n;
  END IF;

  SELECT sum(t.amount_cents) INTO v_cents FROM fin_transaction t;
  RAISE NOTICE
    '0101 ok · busca alcança % itens (% lançamento · % documento · % cartão) · '
    '% sem motivo declarado · soma do ledger % centavos',
    v_lanc + v_doc + v_cartao, v_lanc, v_doc, v_cartao, v_sem_mot, v_cents;
END $$;
