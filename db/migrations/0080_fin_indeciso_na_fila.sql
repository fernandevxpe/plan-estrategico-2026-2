-- O indeciso volta para a fila de pendências — e não sai mais dela sozinho.
--
-- ---------------------------------------------------------------------------
-- O BURACO, MEDIDO
-- ---------------------------------------------------------------------------
-- Medido em 16/08/2026, sobre o ledger inteiro:
--
--   categoria   linhas   com item PENDENTE em fin_review_item
--   5.99           237                                    111
--   3.99            63                                      0
--
-- São **189 lançamentos** que dizem "não sei o que é isso" e não aparecem na
-- lista de pendências de ninguém. Dos 189, 184 têm um item de fila marcado
-- `resolvido` e 5 nunca tiveram item nenhum.
--
-- O invariante H3 do `test-integridade.mjs` deveria pegar isso e não pega: ele
-- afirma `category_id IS NULL ⇒ existe item pendente`. 3.99 e 5.99 não são
-- NULL — são a categoria "a classificar". O mesmo arquivo já tem a constante
-- `CODIGO_A_CLASSIFICAR = ['3.99','5.99']` e a usa em H1 e H2, do lado do
-- documento. Só H3, do lado do lançamento, ficou de fora.
--
-- ---------------------------------------------------------------------------
-- E QUEM FECHOU 184 DELES FUI EU
-- ---------------------------------------------------------------------------
-- `scripts/classificar-fila.mjs` (0056) resolvia o item de fila de TODA linha
-- que tocava — inclusive das 63 que ele mesmo mandou para 3.99. A intenção
-- estava certa ("classificou, então a pendência acabou") e o efeito era o
-- oposto: a linha ganhava uma categoria que declara ignorância e saía da lista
-- de quem poderia desfazer a ignorância.
--
-- É o mesmo erro em três lugares diferentes — a view da 0055, o indicador do
-- painel, a fila de revisão — e sempre pela mesma causa: 5.99 e 3.99 se
-- comportam como categoria de verdade para qualquer código que só pergunte
-- "tem categoria?".
--
-- Por isso a correção aqui é ESTRUTURAL e não um UPDATE de mutirão. Um UPDATE
-- conserta os 189 de hoje; o gatilho abaixo impede que o 190º exista.
--
-- ---------------------------------------------------------------------------
-- 1. O GATILHO
-- ---------------------------------------------------------------------------
-- Espelha, para `fin_review_item`, o que o gatilho da 0054 já faz para
-- `review_status`. As duas peças passam a contar a mesma história.
--
-- Três cuidados que o corpo abaixo tem de propósito:
--
--   · `adiado` e `ignorado` são decisão humana e nunca são revertidos para
--     `pendente` — quem adiou escolheu adiar;
--   · só mexe em item de motivo `sem_categoria`. `baixa_confianca` e
--     `texto_generico` são outras perguntas sobre a mesma linha e não são
--     respondidas por ela ganhar categoria;
--   · pai de rateio (`is_split_parent`) fica fora, como em H3: quem carrega
--     categoria são os filhos.
CREATE OR REPLACE FUNCTION fin_transaction_fila_indeciso() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_code     text;
  v_indeciso boolean;
BEGIN
  IF NEW.is_split_parent THEN
    RETURN NULL;
  END IF;

  SELECT c.code INTO v_code FROM fin_category c WHERE c.id = NEW.category_id;
  v_indeciso := (NEW.category_id IS NULL OR v_code IN ('3.99', '5.99'));

  IF v_indeciso THEN
    INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, status)
    VALUES (NEW.entity_id, 'fin_transaction', NEW.id, 'sem_categoria', NEW.amount_cents, 'pendente')
    -- O WHERE é o guarda de decisão humana: com `adiado`/`ignorado` a linha
    -- simplesmente não é tocada. `reason` também não muda — um item aberto por
    -- `baixa_confianca` continua sendo essa pergunta.
    ON CONFLICT (target_table, target_id) DO UPDATE
       SET status = 'pendente', resolved_at = NULL, resolved_by = NULL
     WHERE fin_review_item.status NOT IN ('adiado', 'ignorado');
  ELSE
    UPDATE fin_review_item
       SET status = 'resolvido', resolved_at = now(), resolved_by = 'gatilho-fila-indeciso'
     WHERE target_table = 'fin_transaction' AND target_id = NEW.id
       AND status = 'pendente' AND reason = 'sem_categoria';
  END IF;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION fin_transaction_fila_indeciso() IS
  'Mantém fin_review_item coerente com a INDECISÃO, não com a existência de categoria. 3.99 e '
  '5.99 contam como indeciso: são a declaração de que ninguém sabe o que é, e uma linha nesse '
  'estado tem de continuar na lista de pendências. Fechá-la porque "tem categoria" foi como 184 '
  'lançamentos sumiram da fila sem que ninguém decidisse nada.';

-- Custo: um INSERT a mais em fin_review_item por lançamento novo sem categoria.
-- Numa importação de 800 linhas do Nubank isso é 800 inserts adicionais — que é
-- exatamente o que os importadores já faziam à mão, e esqueciam de fazer em
-- metade dos caminhos. Centralizar aqui troca esforço espalhado por custo
-- previsível.
DROP TRIGGER IF EXISTS fin_transaction_fila_indeciso ON fin_transaction;
CREATE TRIGGER fin_transaction_fila_indeciso
  AFTER INSERT OR UPDATE OF category_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_transaction_fila_indeciso();

-- ---------------------------------------------------------------------------
-- 2. review_status TAMBÉM PARA DE CHAMAR "a classificar" DE REVISADO
-- ---------------------------------------------------------------------------
-- O gatilho da 0054 marca `review_status='ok'` para qualquer linha com
-- categoria. Estava certo para o que a 0054 sabia: ela reconciliou o campo com
-- a existência de categoria e resolveu 433 linhas que registravam decisão já
-- tomada. A 0055 é que mudou o entendimento — 5.99 não é decisão tomada.
--
-- CUSTO MEDIDO, e ele é real: 300 lançamentos passam de 'ok' para 'pendente', e
-- o indicador "revisão concluída" do painel cai de **96,9% para 94,8%**.
--
-- A queda é o ponto, não o efeito colateral. Os 300 continuam exatamente onde
-- estavam; o que muda é o painel parar de dizer que estão revisados. Um número
-- que parece certo é pior que um vazio declarado — e este vazio tem R$ 91.603,52
-- de despesa e R$ 79.265,35 de receita dentro dele.
CREATE OR REPLACE FUNCTION fin_transaction_revisao_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_code text;
BEGIN
  -- Decisão humana explícita nunca é sobrescrita: quem adiou ou ignorou
  -- escolheu isso, e ganhar categoria não desfaz a escolha.
  IF NEW.review_status IN ('adiado', 'ignorado') THEN
    RETURN NEW;
  END IF;
  SELECT c.code INTO v_code FROM fin_category c WHERE c.id = NEW.category_id;
  IF NEW.category_id IS NULL OR v_code IN ('3.99', '5.99') THEN
    NEW.review_status := 'pendente';
  ELSE
    NEW.review_status := 'ok';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION fin_transaction_revisao_sincroniza() IS
  'review_status segue a INDECISÃO, não a existência de categoria (0080). Antes da 0080 uma '
  'linha em 5.99 contava como revisada — a 0054 tinha razão sobre o problema dela e a 0055 '
  'mudou o que "ter categoria" significa.';

-- ---------------------------------------------------------------------------
-- 3. UM MOTIVO NOVO DE INDETERMINADO: ASSINATURA SEM SERVIÇO DECLARADO
-- ---------------------------------------------------------------------------
-- É o achado desta rodada sobre as 63 receitas em 3.99, e ele merece motivo
-- próprio porque a pergunta que resolve é diferente de todas as outras.
--
-- 45 das 63 cobranças (R$ 12.870,35) casam, por (contraparte, valor exato em
-- centavos), com uma assinatura do Asaas em `fin_contract` — e o casamento é
-- 1:1 em todos os 7 casos: nenhum cliente tem duas assinaturas do mesmo valor.
-- Ou seja: a fonte declara QUE existe um contrato recorrente e QUAL é ele.
--
-- E o campo que diria o serviço, `fin_contract.name`, vem escrito
-- "Assinatura Asaas" nas 7 — o rótulo genérico do gateway. Outras 13
-- assinaturas do mesmo cadastro trazem texto de verdade ("Geração das Faturas
-- de Energia mensal", "Gestão da Usina Solar…"); estas não.
--
-- O que isso muda na prática: não é uma dúvida sobre 45 lançamentos, é uma
-- dúvida sobre 7 contratos. Respondida uma vez por contrato, resolve as 45 de
-- 2026 e todas as cobranças futuras — porque assinatura não troca de serviço
-- entre um mês e outro. É a diferença entre um mutirão e uma decisão.
CREATE OR REPLACE FUNCTION fin_tags_indeterminado_validas(p_tags text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
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
           'indeterminado:sem-lastro-nem-contraparte'
       ])
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. A PERGUNTA, EM FORMA DE VIEW
-- ---------------------------------------------------------------------------
-- Sete linhas. Cada uma é um contrato, o CNPJ do cliente, o valor mensal, e
-- quantas cobranças de 2026 dependem da resposta. Onde já houve uma
-- classificação anterior de uma cobrança daquela mesma assinatura, ela aparece
-- como `sugestao` — com `base_sugestao` dizendo em quantas linhas ela se apoia,
-- para que ninguém confunda sugestão com fato. Nos três casos em que existe,
-- base_sugestao = 1.
CREATE OR REPLACE VIEW fin_receita_assinatura_v AS
SELECT fc.asaas_subscription_id                                   AS assinatura,
       cp.document_number                                         AS cliente_documento,
       cp.name                                                    AS cliente,
       fc.amount_cents                                            AS valor_mensal_cents,
       fc.name                                                    AS descricao_no_asaas,
       count(*) FILTER (WHERE c.code = '3.99')                    AS cobrancas_na_fila,
       sum(t.amount_cents) FILTER (WHERE c.code = '3.99')         AS valor_na_fila_cents,
       max(c.code) FILTER (WHERE c.kind = 'receita' AND c.code <> '3.99') AS sugestao,
       count(*) FILTER (WHERE c.kind = 'receita' AND c.code <> '3.99')    AS base_sugestao
  FROM fin_contract fc
  JOIN fin_counterparty cp ON cp.id = fc.counterparty_id
  JOIN fin_transaction  t  ON t.counterparty_id = fc.counterparty_id
                          AND t.amount_cents    = fc.amount_cents
  JOIN fin_account      a  ON a.id = t.account_id AND a.slug = 'asaas'
  LEFT JOIN fin_category c ON c.id = t.category_id
 WHERE fc.asaas_subscription_id IS NOT NULL
   AND t.source_kind = 'PAYMENT_RECEIVED'
   -- 1:1 obrigatório. Se um cliente tivesse duas assinaturas do mesmo valor, a
   -- cobrança não diria de qual das duas ela é, e a linha inteira seria uma
   -- suposição vestida de chave.
   AND 1 = (SELECT count(*) FROM fin_contract f2
             WHERE f2.counterparty_id = fc.counterparty_id
               AND f2.amount_cents   = fc.amount_cents
               AND f2.asaas_subscription_id IS NOT NULL)
 GROUP BY 1, 2, 3, 4, 5
HAVING count(*) FILTER (WHERE c.code = '3.99') > 0;

COMMENT ON VIEW fin_receita_assinatura_v IS
  'A pergunta que transforma 45 cobranças em 3.99 numa decisão de 7 linhas: qual serviço cada '
  'assinatura do Asaas presta. O casamento cobrança<->assinatura é por (contraparte, valor em '
  'centavos) e só entra aqui quando é 1:1 — nenhum cliente com duas assinaturas do mesmo valor. '
  'Respondida, cada linha vira uma fin_rule por documento e vale também para o futuro.';

-- ---------------------------------------------------------------------------
-- 5. AS TRÊS REGRAS PROPOSTAS — E POR QUE ELAS NASCEM DESLIGADAS
-- ---------------------------------------------------------------------------
-- Três das sete assinaturas têm uma cobrança antiga já classificada. Elas
-- viram `fin_rule` com `status='proposta'`: existem, são versionáveis, o
-- dry-run consegue mostrar o que fariam — e não classificam nada até alguém
-- ativá-las.
--
-- Nascem desligadas porque UMA decisão anterior, de proveniência desconhecida
-- (`classified_by` nulo, de 2023 e 2025), não é evidência suficiente para
-- mexer em receita por tipo de serviço. Ativá-las é o ato de uma pessoa dizer
-- "sim, é isso" — e aí a regra passa a valer para 2026 e para o que vier.
--
-- A chave é (documento do cliente, valor exato). Não é o nome: as três
-- assinaturas do mesmo grupo ARLINDO estão em CNPJs de filiais diferentes
-- (…000161, …001133, …002105) e prestam serviços diferentes — 3.07 numa,
-- 3.01 noutra. Casar por nome as uniria e escolheria uma das duas ao acaso.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, notes, created_by)
SELECT e.id, v.slug, v.nome, 5, 'transaction',
       jsonb_build_object('all', jsonb_build_array(
         jsonb_build_object('op', 'equals', 'field', 'counterparty_document', 'value', v.doc),
         jsonb_build_object('op', 'equals', 'field', 'amount_cents',          'value', v.cents),
         jsonb_build_object('op', 'equals', 'field', 'source_kind',           'value', 'PAYMENT_RECEIVED')
       )),
       jsonb_build_object('category_code', v.code),
       50, 'sugestao_llm', 'proposta', v.notes, 'migration-0080'
  FROM fin_entity e,
       (VALUES
         ('assinatura-sub-imtmo7cohag1', 'Assinatura sub_imtmO7cOHaG1 (ARLINDO …002105, R$ 399,03/mês)',
          '11601184002105', 39903, '3.07',
          'PROPOSTA. 7 cobrancas de 2026 em 3.99. Base: 1 cobranca da mesma assinatura '
            || 'classificada em 3.07 em 31/05/2023, classified_by nulo. Ativar so depois de o '
            || 'Fernando confirmar o servico desta assinatura.'),
         ('assinatura-sub-tchk1mxuazaq', 'Assinatura sub_Tchk1mXuAzaq (ARLINDO …000161, R$ 168,39/mês)',
          '11601184000161', 16839, '3.07',
          'PROPOSTA. 6 cobrancas de 2026 em 3.99. Base: 1 cobranca da mesma assinatura '
            || 'classificada em 3.07 em 31/05/2023, classified_by nulo.'),
         ('assinatura-sub-nntvdkjdllds', 'Assinatura sub_NNTvdKJdlLDS (ARLINDO …001133, R$ 76,13/mês)',
          '11601184001133', 7613, '3.01',
          'PROPOSTA. 7 cobrancas de 2026 em 3.99. Base: 1 cobranca da mesma assinatura '
            || 'classificada em 3.01 em 22/05/2025, classified_by nulo. Repare que este CNPJ do '
            || 'mesmo grupo aponta para 3.01 enquanto os outros dois apontam para 3.07 — e por '
            || 'isso a chave e o documento, nao o nome.')
       ) AS v(slug, nome, doc, cents, code, notes)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

-- As outras quatro assinaturas (POSTO QUARTO DE MILHA ×3, CONDOMINIO SHOPPING
-- CIDADE DE MACEIO ×1) não têm nenhuma cobrança anterior classificada. Não há
-- sugestão a propor: inventar uma seria escolher a linha da DRE no lugar do
-- dono. Elas estão em fin_receita_assinatura_v com sugestao NULA, que é a
-- resposta certa até alguém responder.

-- ---------------------------------------------------------------------------
-- 6. TRAVA DE SANIDADE
-- ---------------------------------------------------------------------------
-- Regra com documento vazio comparado por igualdade casaria com o ledger
-- inteiro. Mesma trava da 0042 e da 0056.
DO $$
DECLARE v_slug text; v_doc text; v_cents jsonb;
BEGIN
  FOR v_slug, v_doc, v_cents IN
    SELECT r.slug, r.conditions -> 'all' -> 0 ->> 'value', r.conditions -> 'all' -> 1 -> 'value'
      FROM fin_rule r JOIN fin_entity e ON e.id = r.entity_id
     WHERE e.slug = 'xpe' AND r.created_by = 'migration-0080'
  LOOP
    IF v_doc IS NULL OR v_doc !~ '^[0-9]{11}$|^[0-9]{14}$' THEN
      RAISE EXCEPTION 'regra % nasceu com documento inválido (%)', v_slug, COALESCE(v_doc, '<nulo>');
    END IF;
    IF v_cents IS NULL OR jsonb_typeof(v_cents) <> 'number' OR (v_cents)::text::bigint <= 0 THEN
      RAISE EXCEPTION 'regra % nasceu com valor inválido (%)', v_slug, COALESCE(v_cents::text, '<nulo>');
    END IF;
  END LOOP;
END $$;

-- Nenhuma regra desta migration pode nascer ativa: elas são propostas por
-- construção, e uma delas ligada por engano reclassificaria receita.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM fin_rule
   WHERE created_by = 'migration-0080' AND status <> 'proposta';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% regra(s) da 0080 nasceram fora de status proposta', v_n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não conserta os 189 itens de fila que já estão fechados: o gatilho só age em
-- INSERT e UPDATE de `category_id`, e essas linhas não vão ser tocadas de novo.
-- Quem reabre é `scripts/classificar-fila.mjs --aplicar`, que roda em transação
-- e mostra o antes/depois. Deixar o mutirão no script e a garantia no gatilho é
-- deliberado: assim o número aparece no dry-run antes de virar escrita.
--
-- E não estende o invariante H3 — isso é código, não schema. A mudança está em
-- `scripts/test-integridade.mjs`, trocando `category_id IS NULL` por
-- `category_id IS NULL OR code = ANY(CODIGO_A_CLASSIFICAR)`, que é a constante
-- que o próprio arquivo já usa em H1 e H2.
