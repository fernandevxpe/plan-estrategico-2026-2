-- Saúde da fila: o trilho de pagamento parou de virar finalidade, e a fila
-- passou a dizer de que população cada item é.
--
-- Esta migration não move um centavo. A soma por conta é conferida no fim e a
-- transação é recusada se mudar.
--
-- ==========================================================================
-- O QUE FOI MEDIDO EM 16/08/2026, ANTES DE ESCREVER
-- ==========================================================================
--
-- 1. M4 (1.535 itens) não é uma fila: são cinco populações com causas
--    diferentes, e a régua de 300 ("o que uma pessoa vence em ~2h") foi
--    escrita quando a fila era só "falta categoria".
--
--      413 · R$ 334.498,66  fin_document 'baixa_confianca' — JÁ têm categoria,
--                           postas pelo histórico da contraparte com
--                           dominância entre 80% e 90%. É conferência, não
--                           classificação.
--      348 · R$ 252.608,32  fin_document 'texto_generico' — 314 delas têm
--                           descrição literalmente vazia no Asaas. Nenhuma
--                           regra de texto alcança o que não tem texto.
--       43 · R$  40.824,44  fin_document 'sem_categoria'
--      338 · R$ 274.414,82  fin_transaction de 2026 — o estoque em escopo
--      393 · R$ 485.422,68  fin_transaction de 2021–2025 — FORA do escopo
--                           declarado ("quero tudo organizado que conseguir
--                           2026", OBJETIVOS_METAS §1), e preso na fila pelo
--                           H3, que é o invariante certo.
--
--    Consequência aritmética, não opinião: enquanto o H3 valer e existirem
--    393 itens fora de escopo, M4 ≤ 300 é inalcançável sem apagar trabalho.
--    A `fin_fila_saude_v` abaixo torna isso visível em vez de deixar o número
--    único mentir por agregação.
--
-- 2. A regra 40 `meios-de-pagamento` (→ 4.05 "Tarifas bancárias e de
--    cobrança") tem 25 acertos no acervo e ZERO verdadeiros positivos.
--
--    Ela procura 'pjbank|asaas|cielo|stone|pagseguro|getnet' em
--    `description_norm`. Só que o extrato do Nubank descreve um PIX enviado
--    assim:
--
--      "Transferência enviada pelo Pix — POSTO VENDA GRANDE - •••.459.0001-••
--       - PAGSEGURO INTERNET IP S.A. (0290) Agência: 1"
--
--    O nome da instituição no fim da linha é o BANCO DE DESTINO do recebedor,
--    não a finalidade do pagamento. Resultado medido, todos em 4.05:
--
--      R$ 5.022,10  DIMENSIONAL BRASIL SOLUCOES LTDA
--      R$   720,00  ACESSO EQUIPAMENTOS DE SEGURANCA INDUSTRIAIS
--      R$   817,44 + R$ 806,96  dois PIX por QR code para PJBank
--      R$   402,25  três postos de combustível (Venda Grande, Alvorada, Madalena)
--      R$   300,00  Ancora Imobiliária — que tem 9 lançamentos em 5.01
--      R$   345,40  cinco PIX ao CPF 989.393.514-87 (Pablo Michael Viana Silveira)
--      R$   252,01  três PIX ao CPF 021.114.504-13 (Artur Pereira de Freitas)
--      … e mais restaurantes, padaria, empório, incorporadora.
--
--    É a assinatura exata do bug do "POSTO IPIRANGA" que o invariante D2
--    existe para pegar, com um detalhe que o D2 não alcança: aqui o sinal está
--    certo (é saída, é despesa) e só a LINHA da DRE está errada. Pessoa física
--    não emite tarifa bancária, e posto de combustível também não.
--
-- 3. O lado do lançamento não tinha como dizer "classifiquei, confirme".
--    `fin_transaction_revisao_sincroniza` força review_status='ok' assim que
--    existe categoria de verdade, e o resolvedor do import fecha qualquer item
--    pendente cujo alvo esteja 'ok'. Do lado do documento esse estado existe e
--    tem 413 ocupantes. Era por isso que 25 rótulos errados ficaram invisíveis.
--
-- 4. Os dois R$ 17.000,00 do CONDOMINIO LE PARC em 2026-03-12 têm lastro
--    completo e estavam sem categoria E sem motivo declarado — o único caso do
--    acervo de 2026 em que "indeterminado" não vinha com o porquê.
--
-- 5. Os 9 pagamentos de fatura do cartão do Inter (R$ 40.862,41) continuam
--    `indeterminado:fatura-sem-itemizacao`, e agora um gatilho impede que
--    alguém os chame de 9.01. O cartão do Inter não está no ledger: sem
--    `fin_card_transaction`, a despesa não reaparece itemizada em lugar
--    nenhum, e carimbá-los de transferência tiraria R$ 41 mil de despesa real
--    da DRE sem contrapartida.
--
-- ==========================================================================
-- O QUE ESTA MIGRATION NÃO FAZ
-- ==========================================================================
--
-- · Não escreve em `classified_by` nem em `classified_rule_id`. A frente do D6
--   trabalha nessas duas colunas na 0091; a proveniência do que se decide aqui
--   fica em `fin_classification_event` e `classified_reason`.
--
--   Isso tem um preço declarado: o invariante E1 exige
--   `classified_by IN ('humano','trava')` para toda linha com
--   `human_locked_fields` preenchido, então NENHUMA trava é posta em
--   `fin_transaction` por esta migration. Os dois lançamentos do Le Parc ficam
--   protegidos pelo que já tinham — `classified_by = 'contrato'`, que o motor
--   de regras não sobrescreve. Quando a 0091 fechar, vale carimbar
--   `humano` + trava nos ids 1603 e 1604.
--
--   Pela mesma razão, nenhum lançamento apontado por `classified_rule_id` tem
--   a categoria trocada aqui: trocar a categoria sem poder limpar o ponteiro
--   deixaria a linha dizendo "quem decidiu foi a regra 40" com uma categoria
--   que a regra 40 nunca produziria. É o "por quê?" mentindo, que é o defeito
--   que o D6 existe para pegar. Onde há evidência e não há permissão de
--   escrita, a evidência vai para a nota do item de fila.
-- · Não roda o motor sobre o Inter. A dúvida 0 continua travando as 205 linhas
--   de Pró-labore → Salários.
-- · Não desativa regra nenhuma sem evidência do que ela teria pego.

-- O runner já envolve cada arquivo numa transação; não abra outra aqui.

-- ---------------------------------------------------------------------------
-- 0. ÂNCORA DE DINHEIRO — fotografada antes de qualquer escrita
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ancora_0094 ON COMMIT DROP AS
  SELECT account_id, count(*) AS n, sum(amount_cents) AS soma
    FROM fin_transaction GROUP BY account_id;

-- ---------------------------------------------------------------------------
-- 1. PRÉ-CONDIÇÕES: se a fotografia mudou, reauditar em vez de forçar
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_regra40   integer;
  v_hits40    integer;
  v_leparc    integer;
  v_fatura    integer;
BEGIN
  SELECT count(*) INTO v_regra40
    FROM fin_rule r JOIN fin_entity e ON e.id = r.entity_id AND e.slug = 'xpe'
   WHERE r.id = 40 AND r.slug = 'meios-de-pagamento' AND r.status = 'ativa'
     AND r.actions->>'category_code' = '4.05'
     AND r.conditions #>> '{all,0,field}' = 'description_norm';
  IF v_regra40 <> 1 THEN
    RAISE EXCEPTION '0094 recusada: a regra 40 meios-de-pagamento não está na forma medida';
  END IF;

  SELECT count(*) INTO v_hits40
    FROM fin_transaction t WHERE t.classified_rule_id = 40;
  IF v_hits40 <> 25 THEN
    RAISE EXCEPTION '0094 recusada: a regra 40 tem % lançamentos, e a auditoria mediu 25', v_hits40;
  END IF;

  -- Os dois R$ 17.000,00 do Le Parc, com o lastro que os identifica.
  SELECT count(*) INTO v_leparc
    FROM fin_transaction t
   WHERE t.id IN (1603, 1604)
     AND t.posted_on = DATE '2026-03-12'
     AND t.amount_cents = 1700000
     AND t.category_id IS NULL
     AND t.transfer_status = 'nao'
     AND NOT t.is_split_parent;
  IF v_leparc <> 2 THEN
    RAISE EXCEPTION '0094 recusada: os dois lançamentos do Le Parc mudaram de estado';
  END IF;

  SELECT count(*) INTO v_fatura
    FROM fin_transaction t WHERE 'indeterminado:fatura-sem-itemizacao' = ANY (t.tags);
  IF v_fatura <> 9 THEN
    RAISE EXCEPTION '0094 recusada: esperava 9 pagamentos de fatura sem itemização, achei %', v_fatura;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. VOCABULÁRIO: um sétimo motivo de indeterminação
-- ---------------------------------------------------------------------------
-- Ampliar o vocabulário é decisão consciente e fica registrada aqui, com o
-- caso que a criou. O motivo novo diz uma coisa específica: a linha TEM
-- categoria, e a categoria veio do trilho por onde o dinheiro passou em vez da
-- finalidade do pagamento. Não é "não sei o que é" — é "sei que o rótulo atual
-- não se sustenta na evidência".
CREATE OR REPLACE FUNCTION fin_tags_indeterminado_validas(p_tags text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
      FROM unnest(COALESCE(p_tags, '{}'::text[])) AS u(tag)
     WHERE u.tag LIKE 'indeterminado:%'
       AND u.tag <> ALL (ARRAY[
           'indeterminado:servico-nao-declarado',
           -- Cobrança que é de uma assinatura identificada do Asaas, cujo
           -- campo de descrição diz só "Assinatura Asaas". A dúvida é sobre o
           -- contrato, não sobre a cobrança — ver fin_receita_assinatura_v.
           'indeterminado:assinatura-sem-servico-declarado',
           'indeterminado:fatura-sem-itemizacao',
           'indeterminado:contraparte-sem-historico',
           'indeterminado:duas-leituras-possiveis',
           'indeterminado:sem-lastro-nem-contraparte',
           -- 0094: o rótulo veio do meio de pagamento e não da finalidade.
           -- Ex.: PIX a POSTO VENDA GRANDE classificado como tarifa bancária
           -- porque o extrato do Nubank nomeia o banco do recebedor no fim da
           -- linha. A linha continua sendo despesa e continua no caixa; o que
           -- está indeterminado é a LINHA DA DRE.
           'indeterminado:rotulo-por-trilho-de-pagamento'
       ])
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3. "CLASSIFIQUEI, CONFIRME" PASSA A EXISTIR DO LADO DO LANÇAMENTO
-- ---------------------------------------------------------------------------
-- O gatilho derivava review_status só da categoria: com categoria de verdade,
-- 'ok', sempre. Isso é certo para o item de motivo `sem_categoria` — ele
-- perdeu a causa. É errado para `baixa_confianca`, cujo comentário no próprio
-- `fin_review_item_sincroniza` já diz: "existe justamente sobre linha
-- classificada que alguém pediu para conferir".
--
-- Sem esta correção, um item `baixa_confianca` de lançamento nasce órfão: o
-- alvo fica 'ok' e o resolvedor do import-asaas fecha o item na sync seguinte.
-- Era a razão de os 25 rótulos por trilho de pagamento nunca aparecerem.
CREATE OR REPLACE FUNCTION fin_transaction_revisao_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
  v_code text;
  v_conferir boolean;
BEGIN
  -- Decisão humana explícita nunca é sobrescrita: quem adiou ou ignorou
  -- escolheu isso, e ganhar categoria não desfaz a escolha.
  IF NEW.review_status IN ('adiado', 'ignorado') THEN
    RETURN NEW;
  END IF;

  SELECT c.code INTO v_code FROM fin_category c WHERE c.id = NEW.category_id;

  -- Pergunta de conferência aberta mantém a linha na fila mesmo classificada.
  SELECT EXISTS (
    SELECT 1 FROM fin_review_item ri
     WHERE ri.target_table = 'fin_transaction'
       AND ri.target_id = NEW.id
       AND ri.status = 'pendente'
       AND ri.reason = 'baixa_confianca'
  ) INTO v_conferir;

  IF NEW.category_id IS NULL OR v_code IN ('3.99', '5.99') OR v_conferir THEN
    NEW.review_status := 'pendente';
  ELSE
    NEW.review_status := 'ok';
  END IF;
  RETURN NEW;
END $function$;

COMMENT ON FUNCTION fin_transaction_revisao_sincroniza() IS
  'review_status = pendente quando falta categoria, quando a categoria é '
  'marcador de indecisão (3.99/5.99) ou quando existe item de fila '
  'baixa_confianca aberto. 0094: sem a terceira cláusula, o lado do '
  'lançamento não conseguia representar "classifiquei, confirme".';

-- ---------------------------------------------------------------------------
-- 4. A REGRA 40 PASSA A EXIGIR QUE A INSTITUIÇÃO SEJA A CONTRAPARTE
-- ---------------------------------------------------------------------------
-- "Tarifas bancárias e de cobrança" é o que se paga A uma instituição de
-- pagamento. O teste certo é sobre a CONTRAPARTE, não sobre o texto livre do
-- extrato — texto livre é exatamente onde o nome do banco de destino mora.
--
-- O bloco `none` é cinto e suspensório: se algum dia o nome da instituição
-- vazar para o campo da contraparte, o formato "INSTITUIÇÃO (ISPB de 4
-- dígitos)" ainda desqualifica a linha.
--
-- O gatilho da 0088 publica a versão 2 sozinho. Os 25 lançamentos históricos
-- continuam apontando para a versão 1: memória de classificação não se
-- reescreve.
UPDATE fin_rule
   SET conditions = jsonb_build_object(
         'all', jsonb_build_array(
           jsonb_build_object(
             'op', 'contains_any',
             'field', 'counterparty_name_norm',
             'value', jsonb_build_array('pjbank', 'asaas', 'cielo', 'stone', 'pagseguro', 'getnet')
           ),
           jsonb_build_object('op', 'equals', 'field', 'direction', 'value', 'pagar')
         ),
         'none', jsonb_build_array(
           jsonb_build_object(
             'op', 'regex',
             'field', 'description_norm',
             'value', '(stone ip|pagseguro internet ip|cielo ip|mercado pago ip|getnet)[^0-9]{0,12}[0-9]{4}'
           )
         )
       ),
       notes = concat_ws(
         E'\n', notes,
         'Estreitada pela 0094: os 25 acertos da versão 1 eram, todos, o banco '
         || 'de destino do recebedor no texto do PIX — nenhum era tarifa. '
         || 'A condição passa a ser sobre a contraparte.'
       ),
       updated_at = now()
 WHERE id = 40;

-- ---------------------------------------------------------------------------
-- 5. OS 25 LANÇAMENTOS VOLTAM A SER PERGUNTA
-- ---------------------------------------------------------------------------
-- Nenhum troca de categoria aqui, e não é por falta de evidência em todos os
-- casos: a Ancora Imobiliária, por exemplo, tem 9 lançamentos e R$ 43.852,60
-- em 5.01 "Aluguel e condomínio", e o PIX de R$ 300,00 dela quase certamente é
-- o décimo. Trocar a categoria exigiria limpar `classified_rule_id`, que é da
-- frente do D6 — e trocar sem limpar deixaria a linha dizendo "decidiu a regra
-- 40" com uma categoria que a regra 40 não produz.
--
-- Nos demais casos falta evidência mesmo: decidir se combustível é 4.04
-- "Deslocamento atribuível a serviço" ou 5.06 "Viagens e representação", e se
-- padaria é 5.07 "Material de escritório e copa" ou 6.04 "Benefícios", são
-- escolhas de convenção, não de dado.
--
-- Nos dois casos a resposta é a mesma: a evidência vai para a nota do item de
-- fila, e o rótulo atual deixa de se passar por decidido. Um vazio declarado
-- vale mais que um rótulo plausível.
UPDATE fin_transaction t
   SET tags = array_append(t.tags, 'indeterminado:rotulo-por-trilho-de-pagamento'),
       updated_at = now()
 WHERE t.classified_rule_id = 40
   AND NOT ('indeterminado:rotulo-por-trilho-de-pagamento' = ANY (t.tags));

INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, status, note)
SELECT t.entity_id, 'fin_transaction', t.id, 'baixa_confianca', t.amount_cents, 'pendente',
       'A regra meios-de-pagamento (v1) casou o meio de pagamento no texto do extrato, não a '
       || 'finalidade. Confirme a linha da DRE: quem recebeu foi '
       || COALESCE(cp.name, '(contraparte não identificada)') || '.'
       || COALESCE(
            (SELECT ' Histórico dessa contraparte: ' || count(*) || ' lançamento(s) em '
                    || string_agg(DISTINCT c2.code, '/' ORDER BY c2.code) || '.'
               FROM fin_transaction o
               JOIN fin_category c2 ON c2.id = o.category_id
              WHERE o.counterparty_id = t.counterparty_id
                AND o.id <> t.id
                AND c2.code <> '4.05'),
            '')
  FROM fin_transaction t
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
 WHERE t.classified_rule_id = 40
    ON CONFLICT (target_table, target_id) DO UPDATE
   SET status = CASE WHEN fin_review_item.status IN ('adiado', 'ignorado')
                     THEN fin_review_item.status ELSE 'pendente' END,
       reason = CASE WHEN fin_review_item.status IN ('adiado', 'ignorado')
                     THEN fin_review_item.reason ELSE 'baixa_confianca' END,
       note = EXCLUDED.note,
       resolved_at = NULL,
       resolved_by = NULL;

-- Com o item aberto, o gatilho corrigido no passo 3 mantém a linha na fila.
UPDATE fin_transaction t
   SET review_status = 'pendente', updated_at = now()
 WHERE t.classified_rule_id = 40
   AND t.review_status NOT IN ('adiado', 'ignorado');

-- ---------------------------------------------------------------------------
-- 6. CONDOMINIO LE PARC: R$ 34.000,00 COM LASTRO COMPLETO
-- ---------------------------------------------------------------------------
-- A cadeia, inteira e conferível:
--
--   2026-03-10  taxa de emissão da NF 190 — fatura 761592155 (R$ 0,99)
--   2026-03-10  taxa de emissão da NF 192 — fatura 761592863 (R$ 0,99)
--   fin_document 582  Parcela 1/6 "estudo de Disponibilidade de Carga e
--                     Planejamento Energético para as 12 torres", R$ 17.000,
--                     categoria 3.03, paid_on = 2026-03-12
--   fin_document 581  Parcela 2/6, idem, paid_on = 2026-03-12
--   fin_document 568  cobrança gerada pelo Asaas a partir do PIX recebido,
--                     mensagem "NF 190", R$ 17.000, liquidada em 2026-03-12
--   fin_document 569  idem, mensagem "NF 192"
--   fin_transaction 1603/1604  os dois créditos de R$ 17.000 em 2026-03-12
--
-- São os ÚNICOS créditos de R$ 17.000,00 dessa contraparte em março; as
-- parcelas 3/6 a 6/6 têm data e crédito próprios em abril, maio, junho e
-- julho. Não há terceira leitura possível.
INSERT INTO fin_classification_event
  (target_table, target_id, stage, category_id, accepted, rationale, actor)
SELECT 'fin_transaction', t.id, 'contrato', c.id, true,
       jsonb_build_object(
         'motivo', 'liquidação das parcelas 1/6 e 2/6 do contrato do Le Parc',
         'fonte', 'liquidacao',
         'evidencia', 'NF 190 e NF 192 emitidas em 2026-03-10 contra as faturas das parcelas; '
                   || 'paid_on das parcelas = 2026-03-12; únicos créditos de R$ 17.000 no mês',
         'documentos', jsonb_build_array(581, 582, 568, 569)
       ),
       'migration-0094'
  FROM fin_transaction t
  JOIN fin_category c ON c.entity_id = t.entity_id AND c.code = '3.03'
 WHERE t.id IN (1603, 1604);

UPDATE fin_transaction t
   SET category_id = c.id,
       classified_reason = jsonb_build_object(
         'origem', 'liquidação de parcela com NF conferida',
         'motivo', 'parcelas 1/6 e 2/6 do estudo de disponibilidade de carga — Le Parc',
         'documentos', jsonb_build_array(581, 582, 568, 569),
         'migration', '0094'
       ),
       updated_at = now()
  FROM fin_category c
 WHERE t.id IN (1603, 1604)
   AND c.entity_id = t.entity_id AND c.code = '3.03';

-- Os dois documentos que o Asaas gerou a partir do PIX (568 e 569) descrevem o
-- mesmo serviço e continuavam sem categoria. Recebem a mesma 3.03, pela mesma
-- evidência, e saem da fila da carteira.
UPDATE fin_document d
   SET category_id = c.id,
       classified_reason = jsonb_build_object(
         'origem', 'cobrança gerada do PIX que liquidou as parcelas 1/6 e 2/6',
         'motivo', 'mensagem declara NF 190 / NF 192, emitidas contra as faturas das parcelas',
         'migration', '0094'
       ),
       updated_at = now()
  FROM fin_category c
 WHERE d.id IN (568, 569)
   AND d.category_id IS NULL
   AND c.entity_id = d.entity_id AND c.code = '3.03';

UPDATE fin_document
   SET human_locked_fields = array_append(human_locked_fields, 'category_id'),
       review_status = 'ok'
 WHERE id IN (568, 569)
   AND NOT ('category_id' = ANY (human_locked_fields));

UPDATE fin_review_item
   SET status = 'resolvido', resolved_at = now(), resolved_by = 'migration-0094'
 WHERE target_table = 'fin_document' AND target_id IN (568, 569) AND status = 'pendente';

-- ---------------------------------------------------------------------------
-- 7. O PAGAMENTO DE FATURA DO INTER NÃO PODE VIRAR TRANSFERÊNCIA
-- ---------------------------------------------------------------------------
-- Os 9 pagamentos de fatura do cartão do Inter (R$ 40.862,41) parecem os do
-- Nubank e não são. O Nubank tem `fin_card_bill` e `fin_card_transaction`: lá,
-- chamar o pagamento de 9.01 é correto, porque a despesa reaparece itemizada
-- no subledger. O cartão do Inter não está no ledger. Carimbá-los de
-- transferência entre contas próprias tiraria R$ 41 mil de despesa REAL da
-- DRE, e ela não reapareceria em lugar nenhum.
--
-- Isto era um aviso em prosa. Passa a ser uma recusa do banco.
CREATE OR REPLACE FUNCTION fin_fatura_sem_itemizacao_nao_e_transferencia()
RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
  v_code text;
BEGIN
  IF NOT ('indeterminado:fatura-sem-itemizacao' = ANY (COALESCE(NEW.tags, '{}'::text[]))) THEN
    RETURN NEW;
  END IF;

  SELECT c.code INTO v_code FROM fin_category c WHERE c.id = NEW.category_id;

  IF v_code = '9.01' AND NOT EXISTS (
       SELECT 1 FROM fin_card_bill b WHERE b.paid_transaction_id = NEW.id
     ) THEN
    RAISE EXCEPTION
      'pagamento de fatura sem itemização não pode virar 9.01 sem fin_card_bill ligada (lançamento %): '
      'a despesa sairia da DRE sem reaparecer no subledger do cartão', NEW.id;
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION fin_fatura_sem_itemizacao_nao_e_transferencia() IS
  'Guarda da 0094. Transferência entre contas próprias é neutra na DRE; '
  'pagamento de fatura só é neutro quando o subledger do cartão traz a despesa '
  'de volta itemizada. Sem fin_card_bill, 9.01 apaga despesa real.';

CREATE TRIGGER fin_transaction_fatura_sem_itemizacao
  BEFORE INSERT OR UPDATE OF category_id, tags ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_fatura_sem_itemizacao_nao_e_transferencia();

-- ---------------------------------------------------------------------------
-- 8. SAÚDE DA FILA: cinco populações, cada uma com o que a destrava
-- ---------------------------------------------------------------------------
-- M4 é um número só sobre cinco trabalhos diferentes. Esta view não muda o
-- monitor nem apaga item nenhum: ela diz de que população cada item é, se está
-- dentro do escopo declarado de 2026, e qual evidência falta. É o que permite
-- perguntar "o que este indicador NÃO mede?" sem reabrir a investigação.
CREATE OR REPLACE VIEW fin_fila_saude_v AS
WITH alvo AS (
  SELECT ri.id,
         ri.target_table,
         ri.target_id,
         ri.reason,
         ri.status,
         ri.amount_cents,
         ri.created_at,
         COALESCE(t.posted_on, d.competence_date, d.due_date) AS data_alvo,
         COALESCE(ct.code, cd.code)                           AS categoria_atual,
         COALESCE(t.description_raw, d.description)           AS descricao,
         (SELECT string_agg(u.tag, ',')
            FROM unnest(COALESCE(t.tags, '{}'::text[])) u(tag)
           WHERE u.tag LIKE 'indeterminado:%')                AS motivo_indeterminado
    FROM fin_review_item ri
    LEFT JOIN fin_transaction t ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
    LEFT JOIN fin_document   d ON ri.target_table = 'fin_document'    AND d.id = ri.target_id
    LEFT JOIN fin_category  ct ON ct.id = t.category_id
    LEFT JOIN fin_category  cd ON cd.id = d.category_id
)
SELECT a.id,
       a.target_table,
       a.target_id,
       a.reason,
       a.status,
       a.amount_cents,
       a.data_alvo,
       a.categoria_atual,
       a.motivo_indeterminado,
       (a.data_alvo >= DATE '2026-01-01') AS em_escopo_2026,
       CASE
         -- A ordem importa: a primeira que descreve o item é a que manda.
         WHEN a.motivo_indeterminado LIKE '%rotulo-por-trilho-de-pagamento%'
           THEN 'rotulo_por_trilho'
         WHEN a.reason = 'baixa_confianca'
           THEN 'conferencia_de_confianca'
         WHEN a.target_table = 'fin_document' AND a.reason = 'texto_generico'
           THEN 'sem_texto_na_fonte'
         WHEN a.categoria_atual IN ('3.99', '5.99')
           THEN 'marcado_a_classificar'
         WHEN a.data_alvo < DATE '2026-01-01'
           THEN 'fora_do_escopo_2026'
         ELSE 'sem_categoria_em_escopo'
       END AS populacao,
       CASE
         WHEN a.motivo_indeterminado LIKE '%rotulo-por-trilho-de-pagamento%'
           THEN 'decisão de linha da DRE por contraparte (dúvida 52)'
         WHEN a.reason = 'baixa_confianca'
           THEN 'confirmação humana: a categoria já está posta, falta o aceite'
         WHEN a.target_table = 'fin_document' AND a.reason = 'texto_generico'
           THEN 'a fonte não tem texto; só histórico de contraparte ou contrato resolve (dúvida 53)'
         WHEN a.categoria_atual IN ('3.99', '5.99')
           THEN 'evidência de finalidade — ver a tag indeterminado:*'
         WHEN a.data_alvo < DATE '2026-01-01'
           THEN 'fora do escopo declarado; preso na fila pelo H3, que está certo (dúvida 54)'
         ELSE 'evidência de finalidade para 2026'
       END AS destrava
  FROM alvo a;

COMMENT ON VIEW fin_fila_saude_v IS
  'Decomposição de M4. Um item de fila pertence a exatamente uma população, e '
  'cada população se destrava por um caminho diferente: confirmação humana, '
  'dado que a fonte não tem, decisão de escopo ou evidência de finalidade. '
  'Somar as cinco num número só foi o que fez a régua de 300 parecer atingível.';

-- ---------------------------------------------------------------------------
-- 9. ASSERÇÕES DE SAÚDE DAS REGRAS — datadas, com a evidência medida
-- ---------------------------------------------------------------------------
-- 9a. Regra 40, versão 2: zero hits é o resultado esperado e desejado.
INSERT INTO fin_rule_health_assertion
  (rule_id, rule_version_id, health_state, reason_code, justification, evidence,
   valid_until, asserted_by)
SELECT 40, fin_rule_current_version_id(40), 'zero_esperado', 'regra_estreitada_por_falso_positivo',
       'Os 25 acertos da versão 1 eram, todos, o banco de destino do recebedor no texto do PIX '
       || 'do Nubank — zero tarifa bancária real. A versão 2 exige que a instituição seja a '
       || 'contraparte, e nenhum lançamento do acervo tem essa forma. As tarifas de verdade '
       || '(8.837 linhas em 4.05) vêm do importador do Asaas, não desta regra.',
       jsonb_build_object(
         'hits_versao_1', 25,
         'valor_versao_1_reais', 9395.07,
         'verdadeiros_positivos', 0,
         'maior_falso_positivo', 'DIMENSIONAL BRASIL SOLUCOES LTDA, R$ 5.022,10',
         'pessoas_fisicas_atingidas', jsonb_build_array('98939351487', '02111450413'),
         'linhas_4_05_de_outras_fontes', 8837
       ),
       now() + interval '180 days',
       'migration-0094';

-- 9b. Regra 14 — a sombra é esperada, e agora está medida item a item.
--
-- A asserção da 0088 dizia "52 documentos casam, mas regras anteriores vencem"
-- e citava um conflito entre 3.01 e 3.09. A medição completa mostra quatro
-- categorias vencedoras, não duas, e mostra POR QUE cada uma vence:
--
--   43 · R$ 34.400,00  consultoria-e-auditoria (3.01)
--        "Gestão da Usina Solar, Créditos e Assessoria junto a Neonergia"
--        "Gestão de energia XPE - Auditoria e gestão de contas de..."
--    3 · R$ 15.000,00  laudos-e-inspecoes (3.02) — "Laudo da Usina Solar"
--    3 · R$  6.700,00  estudo-de-disponibilidade-de-carga (3.03)
--        "Laudo Técnico das Instalações Elétricas e Estudo de Disponibilidade"
--    3 · R$  1.500,00  projetos-e-subestacoes (3.04)
--        "Elaboração de projeto técnico para adequação..."
--
-- Em 52 de 52, a regra vencedora casou uma palavra que nomeia o SERVIÇO
-- ("assessoria", "auditoria", "laudo", "estudo", "projeto") e a regra 14 casou
-- o OBJETO sobre o qual o serviço foi prestado ("usina solar"). O plano de
-- contas 3.01–3.14 é uma lista de serviços; "usina solar" não é um serviço.
-- Serviço declarado vence objeto: isso é leitura do dado, não preferência.
--
-- A asserção vale 90 dias de propósito. Se o Fernando não confirmar (dúvida
-- 43), ela expira e a regra volta a bloquear. Declarar não é decidir para
-- sempre.
INSERT INTO fin_rule_health_assertion
  (rule_id, rule_version_id, health_state, reason_code, justification, evidence,
   valid_until, supersedes_assertion_id, asserted_by)
SELECT 14, fin_rule_current_version_id(14), 'sombra_esperada', 'objeto_do_servico_perde_para_servico_declarado',
       'Em 52 de 52 candidatos a regra vencedora casou a palavra que nomeia o serviço prestado e a '
       || 'regra 14 casou o objeto sobre o qual ele foi prestado. O plano de contas 3.01–3.14 lista '
       || 'serviços; "usina solar" é objeto. A regra permanece ativa como último recurso, na '
       || 'prioridade 92, para o dia em que aparecer cobrança que fale só de gestão de usina.',
       jsonb_build_object(
         'candidatos', 52,
         'valor_total_reais', 57600.00,
         'vencedores', jsonb_build_object(
           'consultoria-e-auditoria',            jsonb_build_object('n', 43, 'reais', 34400.00, 'categoria', '3.01'),
           'laudos-e-inspecoes',                 jsonb_build_object('n', 3,  'reais', 15000.00, 'categoria', '3.02'),
           'estudo-de-disponibilidade-de-carga', jsonb_build_object('n', 3,  'reais', 6700.00,  'categoria', '3.03'),
           'projetos-e-subestacoes',             jsonb_build_object('n', 3,  'reais', 1500.00,  'categoria', '3.04')
         ),
         'palavra_da_regra_14', 'objeto (usina solar, geracao distribuida, creditos de energia, fotovoltaic, neoenergia)',
         'contestavel', '43 cobranças de "Gestão da Usina Solar, Créditos e Assessoria" — R$ 34.400,00 — ver dúvida 55'
       ),
       now() + interval '90 days',
       4,
       'migration-0094';

-- 9c. Regra 24 (ART) — mesma leitura, um único candidato.
--
-- O único documento do acervo que casa `(^|\s)art(\s|$)` em 3.406 é este:
--
--   fin_document 866 · R$ 1.000,00 · competência 2025-11-06 · categoria 3.14
--   "Cobrança gerada automaticamente a partir de Pix recebido. Mensagem:
--    ART projeto Carregador eletronico Edf Aluisio Moura Apto 1202"
--
-- Não é a descrição de um serviço: é a mensagem que o cliente digitou no PIX.
-- E nela a ART é acessória de um projeto de carregador — o serviço faturado.
-- `smart-charging-e-carregadores` venceu por casar "carregador", que é o
-- serviço. Mesmo padrão da 9b.
--
-- Vale registrar o que a medição diz da regra em si: um detector de três
-- letras sobre texto livre, com 1 acerto em 3.406 documentos, é da mesma
-- família do "CNPJ = 14 dígitos em qualquer campo" que casou zero de 274
-- negócios. Ela nunca foi exercitada sobre descrição de serviço de verdade.
INSERT INTO fin_rule_health_assertion
  (rule_id, rule_version_id, health_state, reason_code, justification, evidence,
   valid_until, supersedes_assertion_id, asserted_by)
SELECT 24, fin_rule_current_version_id(24), 'sombra_esperada', 'obrigacao_acessoria_perde_para_servico_principal',
       'Candidato único em 3.406 documentos, e o texto que casou é mensagem de PIX, não descrição '
       || 'de serviço. Nela a ART é acessória de um projeto de carregador, que é o serviço '
       || 'faturado e o que a regra vencedora casou. A regra segue ativa; o que falta é uma '
       || 'cobrança cujo serviço principal SEJA a ART.',
       jsonb_build_object(
         'candidatos', 1,
         'documento_id', 866,
         'valor_reais', 1000.00,
         'competencia', '2025-11-06',
         'vencedor_atual', 'smart-charging-e-carregadores',
         'categoria_atual', '3.14',
         'categoria_da_regra_24', '3.01',
         'texto', 'ART projeto Carregador eletronico Edf Aluisio Moura Apto 1202',
         'observacao', 'regex de 3 letras sobre texto livre: 1 acerto em 3.406 documentos'
       ),
       now() + interval '90 days',
       5,
       'migration-0094';

-- 9d. Correção de referência, pelo caminho que a tabela permite.
--
-- Entre escrever a 9b e commitar, outra frente tomou os números 47 a 51 de
-- DUVIDAS_FINANCEIRO.md e a pergunta das sombras virou a 55. Asserção é
-- append-only por desenho — editar a evidência de uma decisão datada é
-- exatamente o que a 0088 proibiu. Então a correção é uma asserção nova que
-- supersede a anterior, com o mesmo conteúdo e a referência certa.
--
-- Fica registrado porque é o mecanismo funcionando: sob concorrência, o jeito
-- de consertar um fato declarado é declarar outro por cima, não reescrever o
-- primeiro.
INSERT INTO fin_rule_health_assertion
  (rule_id, rule_version_id, health_state, reason_code, justification, evidence,
   valid_until, supersedes_assertion_id, asserted_by)
SELECT 14, fin_rule_current_version_id(14), 'sombra_esperada', 'objeto_do_servico_perde_para_servico_declarado',
       a.justification,
       jsonb_set(a.evidence, '{contestavel}',
                 to_jsonb('43 cobranças de "Gestão da Usina Solar, Créditos e Assessoria" — R$ 34.400,00 — ver dúvida 55'::text)),
       a.valid_until,
       a.id,
       'migration-0094'
  FROM fin_rule_health_assertion a
 WHERE a.rule_id = 14 AND a.asserted_by = 'migration-0094'
   AND a.evidence->>'contestavel' LIKE '%dúvida 43';

-- ---------------------------------------------------------------------------
-- 10. ÂNCORA: se a soma por conta mudou, nada disto vale
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_divergentes integer;
BEGIN
  SELECT count(*) INTO v_divergentes
    FROM _ancora_0094 a
    FULL JOIN (
      SELECT account_id, count(*) AS n, sum(amount_cents) AS soma
        FROM fin_transaction GROUP BY account_id
    ) d ON d.account_id = a.account_id
   WHERE a.account_id IS DISTINCT FROM d.account_id
      OR a.n IS DISTINCT FROM d.n
      OR a.soma IS DISTINCT FROM d.soma;

  IF v_divergentes <> 0 THEN
    RAISE EXCEPTION '0094 recusada: a soma por conta mudou em % conta(s)', v_divergentes;
  END IF;
END $$;
