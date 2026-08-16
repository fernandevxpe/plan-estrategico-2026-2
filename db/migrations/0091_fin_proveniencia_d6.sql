-- Proveniência: quem decidiu foi o contrato, então a regra não assina junto.
--
-- ============================================================================
-- O DEFEITO
-- ============================================================================
--
-- Em 16/08/2026 o invariante D6 passou a acusar 186 lançamentos, R$ 390.057,45:
--
--   classified_by   classified_rule_id   linhas
--   contrato        preenchido            186
--
-- D6 afirma que `classified_by='regra' ⇔ classified_rule_id IS NOT NULL` (e que
-- só 'fato_estrutural' pode carregar id sem dizer 'regra'). Um par incompleto
-- faz o badge "por quê?" da tela mentir sobre quem decidiu a classificação.
--
-- Nenhuma das 186 aponta para regra inexistente — D1 continua verde. O problema
-- é que os dois campos contam histórias diferentes sobre a mesma linha.
--
-- ============================================================================
-- A CAUSA RAIZ
-- ============================================================================
--
-- Nenhum commit desta retomada mudou o código que produz a violação:
-- `scripts/import-asaas.mjs`, `scripts/classificar-fila.mjs` e
-- `scripts/sync-asaas.mjs` são byte a byte idênticos entre 992d6c5 e e1499bb.
--
-- O que mudou foi o BANCO. A migration `0056_fin_classificacao_fila.sql` estava
-- pendente desde 11/08 e foi aplicada em 16/08 às 03:56:20, no meio da retomada
-- (commit 8eca05b, "Trilha de importação vira invariável do banco", 03:56). Ela
-- semeia a regra 73, `receita-asaas-cobranca-recebida`, prioridade 2:
--
--   all: source_kind = 'PAYMENT_RECEIVED' AND direction = 'receber'
--
-- É a PRIMEIRA regra do acervo que casa toda cobrança recebida no Asaas — antes
-- dela nenhuma regra ativa casava um PAYMENT_RECEIVED puro (a 44 exige ESTORNO,
-- a 31 exige RENDIMENTO). E "toda cobrança recebida no Asaas" é exatamente a
-- população que o passo 5 do `import-asaas.mjs` reclassifica logo em seguida,
-- herdando a categoria do documento liquidado.
--
-- Dentro de UMA execução do sync, na ordem do arquivo:
--
--   1. o upsert classifica pela regra e grava classified_rule_id = 73;
--   2. o UPDATE "herdado do documento liquidado" grava classified_by='contrato',
--      a categoria do documento, o motivo e o review_status — e NÃO limpa o
--      classified_rule_id.
--
-- O segundo passo é a última palavra sobre a linha e apagou todo o efeito da
-- regra, menos a assinatura dela. A regra 73 manda para 3.99 com review=true, e
-- é explícita na própria nota sobre não escolher receita específica; nenhuma das
-- 186 está em 3.99 e nenhuma está pendente por causa dela. O id ficou órfão de
-- decisão.
--
-- ============================================================================
-- A EVIDÊNCIA SEPARA DUAS POPULAÇÕES, E SÓ UMA É CONSERTÁVEL AQUI
-- ============================================================================
--
-- COORTE A — 123 lançamentos, R$ 310.792,10. Documento liquidado COM categoria.
--
--   · category_id é exatamente o do documento (123 de 123 conferidos);
--   · classified_reason = 'herdado do documento liquidado' + document_id;
--   · review_status = 'ok';
--   · ZERO linhas em fin_classification_event — a regra nunca teve decisão
--     aceita registrada sobre elas, e nenhum humano decidiu sobre elas.
--
--   Leitura sustentada pelo dado: quem decidiu foi o contrato. O
--   `classified_rule_id` é resíduo da passagem anterior da mesma execução e
--   deveria ter sido limpo. É esta migration que limpa.
--
--   A leitura contrária ("o classified_by foi sobrescrito e quem decidiu foi a
--   regra") está REFUTADA, não apenas descartada: a regra 73 só sabe produzir
--   3.99 + review=true, e as 123 linhas estão em 3.01, 3.02, 3.03, 3.04, 3.05,
--   3.06, 3.07, 3.08, 3.09, 3.11, 3.14 e 9.02, todas com review='ok'. Nenhum
--   subconjunto sustenta a leitura da regra.
--
-- COORTE B — 63 lançamentos, R$ 79.265,35. Documento liquidado SEM categoria.
--
--   ESTA MIGRATION NÃO ENCOSTA NELAS, de propósito. D6 continua acusando 63
--   violações, R$ 79.265,35, com causa conhecida e documentada.
--
--   Nelas o UPDATE do passo 5 herdou o NADA: gravou category_id = NULL por cima
--   do que existia, carimbou 'contrato' e deixou a regra 73 assinando. O rastro
--   mostra que houve decisão de verdade antes, e ela foi destruída:
--
--     · 11/08, 52 delas: um humano classificou em grupo pela tela
--       (fin_classification_event.stage='humano', accepted=true, com categoria
--       específica). A categoria foi zerada por um sync posterior, e junto foi o
--       carimbo 'humano' — que é justamente o que o classificar-fila.mjs usa
--       para não voltar em cima de decisão de gente;
--     · 16/08 03:57, as 63: o classificar-fila.mjs repôs 3.99 com a regra 73 no
--       estágio 'fato_estrutural' (que D6 isenta, corretamente);
--     · 16/08 11:24: o sync seguinte zerou tudo de novo.
--
--   Limpar só o classified_rule_id delas deixaria D6 verde cimentando uma
--   mentira: "o contrato decidiu" numa linha onde o contrato não decidiu nada e
--   a categoria é nula. Pior, `reclassificar.mjs` protege 'contrato' e nunca
--   mais volta nelas — é o "estado impossível" que o próprio
--   classificar-fila.mjs descreve. Restaurar exigiria escolher ENTRE a decisão
--   humana de 11/08 e o 3.99 da regra, e mexeria em categoria, ou seja, na DRE.
--   Isso é decisão do Fernando: está em docs/DUVIDAS_FINANCEIRO.md.
--
-- Invariante falhando com causa conhecida é melhor que invariante verde com
-- dado errado.
--
-- ============================================================================
-- A REINCIDÊNCIA
-- ============================================================================
--
-- Esta migration corrige o dado de hoje. O que impede a volta está em
-- `scripts/import-asaas.mjs`, no mesmo commit: os dois UPDATEs de herança
-- passam a gravar `classified_rule_id = NULL` (a decisão é do contrato, e só
-- dele), e o do passo 5 passa a exigir `d.category_id IS NOT NULL` — herdar de
-- documento sem categoria não é herdar, é apagar.
--
-- ============================================================================
-- ÂNCORA
-- ============================================================================
--
-- Nada aqui toca amount_cents, posted_on, account_id, category_id, nucleo,
-- review_status ou competence_date. A soma por conta é conferida antes e depois
-- e a migration aborta se mudar um centavo.

DO $$
DECLARE
  v_ancora_antes  bytea;
  v_ancora_depois bytea;
  v_alvo          bigint;
  v_valor         bigint;
  v_atualizadas   bigint;
  v_restantes     bigint;
  v_restante_rs   bigint;
  v_intocaveis    bigint;
BEGIN
  -- Âncora de dinheiro: soma por conta, hasheada, antes de qualquer escrita.
  SELECT md5(string_agg(account_id || ':' || total, '|' ORDER BY account_id))::bytea
    INTO v_ancora_antes
    FROM (SELECT account_id, sum(amount_cents) total
            FROM fin_transaction GROUP BY account_id) s;

  -- ---------------------------------------------------------------------
  -- A coorte, definida por EVIDÊNCIA e não por conveniência.
  --
  -- Não basta "tem categoria": exige-se que a categoria seja comprovadamente a
  -- do documento liquidado que o próprio classified_reason cita, e que não
  -- exista nenhuma decisão aceita em fin_classification_event. As duas
  -- condições juntas provam que o contrato foi o único a decidir. Uma linha que
  -- não satisfizer as duas fica de fora e continua acusando em D6.
  -- ---------------------------------------------------------------------
  CREATE TEMP TABLE tmp_d6_coorte_a ON COMMIT DROP AS
  SELECT t.id, t.amount_cents, t.classified_rule_id, t.classified_rule_version_id
    FROM fin_transaction t
   WHERE t.classified_by = 'contrato'
     AND t.classified_rule_id IS NOT NULL
     AND t.category_id IS NOT NULL
     AND EXISTS (
           SELECT 1
             FROM fin_settlement s
             JOIN fin_document d ON d.id = s.document_id
            WHERE s.transaction_id = t.id
              AND d.id = (t.classified_reason->>'document_id')::bigint
              AND d.category_id = t.category_id)
     AND NOT EXISTS (
           SELECT 1 FROM fin_classification_event e
            WHERE e.target_table = 'fin_transaction' AND e.target_id = t.id);

  SELECT count(*), coalesce(sum(abs(amount_cents)), 0)
    INTO v_alvo, v_valor FROM tmp_d6_coorte_a;

  RAISE NOTICE '[0091] coorte A (contrato decidiu, regra é resíduo): % lançamentos, % centavos',
    v_alvo, v_valor;

  -- A trilha ANTES da escrita: o id que sai fica registrado, com o motivo.
  INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
  SELECT t.entity_id, 'fin_transaction', c.id, 'bulk_update',
         jsonb_build_object('classified_rule_id', c.classified_rule_id,
                            'classified_rule_version_id', c.classified_rule_version_id),
         jsonb_build_object('classified_rule_id', NULL,
                            'classified_rule_version_id', NULL,
                            'motivo', 'D6: classified_by=contrato nao pode assinar junto com regra; '
                                   || 'a acao da regra 73 (3.99 + review) nao sobreviveu em campo nenhum'),
         ARRAY['classified_rule_id', 'classified_rule_version_id'],
         'migration-0091'
    FROM tmp_d6_coorte_a c JOIN fin_transaction t ON t.id = c.id;

  UPDATE fin_transaction t
     SET classified_rule_id = NULL
    FROM tmp_d6_coorte_a c
   WHERE t.id = c.id;
  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;

  IF v_atualizadas <> v_alvo THEN
    RAISE EXCEPTION '[0091] esperava atualizar % linhas, atualizou %', v_alvo, v_atualizadas;
  END IF;

  -- O gatilho zz_fin_transaction_rule_version zera a versão junto; o
  -- fin_transaction_rule_hits devolve o hits_count da regra 73 ao número de
  -- linhas que ela ainda assina. Conferir em vez de supor.
  SELECT count(*) INTO v_intocaveis
    FROM fin_transaction
   WHERE classified_rule_id IS NULL AND classified_rule_version_id IS NOT NULL;
  IF v_intocaveis > 0 THEN
    RAISE EXCEPTION '[0091] % linhas ficaram com versao de regra sem regra', v_intocaveis;
  END IF;

  -- O que sobra em D6, medido e não estimado.
  SELECT count(*), coalesce(sum(abs(amount_cents)), 0)
    INTO v_restantes, v_restante_rs
    FROM fin_transaction
   WHERE (classified_by = 'regra' AND classified_rule_id IS NULL)
      OR (classified_rule_id IS NOT NULL AND classified_by NOT IN ('regra', 'fato_estrutural'));

  RAISE NOTICE '[0091] D6 restante (coorte B, decisao destruida — ver DUVIDAS 37): % lançamentos, % centavos',
    v_restantes, v_restante_rs;

  IF v_restantes <> 63 THEN
    RAISE WARNING '[0091] coorte B mudou de tamanho: esperava 63, encontrou %. '
                  'Reveja docs/DUVIDAS_FINANCEIRO.md antes de seguir.', v_restantes;
  END IF;

  -- Âncora: a soma por conta não pode ter mudado.
  SELECT md5(string_agg(account_id || ':' || total, '|' ORDER BY account_id))::bytea
    INTO v_ancora_depois
    FROM (SELECT account_id, sum(amount_cents) total
            FROM fin_transaction GROUP BY account_id) s;

  IF v_ancora_antes IS DISTINCT FROM v_ancora_depois THEN
    RAISE EXCEPTION '[0091] a soma por conta mudou — a migration esta errada';
  END IF;
END $$;
