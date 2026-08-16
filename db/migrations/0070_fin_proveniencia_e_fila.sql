-- A proveniência volta a dizer a verdade, e a fila volta a se manter sozinha.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION FECHA
-- ---------------------------------------------------------------------------
-- Nove invariantes de scripts/test-integridade.mjs, todos da mesma família: o
-- ledger sabe QUAL é a categoria, mas mente sobre QUEM decidiu e sobre o que
-- ainda falta decidir.
--
--   D1  280 lançamentos apontam para a regra 42, arquivada pela 0050
--   D2    2 categoria de despesa em ENTRADA
--   D3    8 categoria de receita em SAÍDA
--   D5  159 palpites sobre texto livre carimbados como 'fato_estrutural'
--   D6  420 proveniência incoerente (390 'regra' sem regra, 30 humano com regra)
--   D7   35 regras classificaram e têm hits_count = 0 (0 de 61 têm hit)
--   F3   13 lançamentos fora de qualquer janela de cobertura
--   H1  343 itens de fila apontando para linha JÁ classificada
--   H3/H4 3 lançamentos sem categoria e fora da fila
--
-- NENHUM CENTAVO MUDA DE CATEGORIA POR DECISÃO DESTA MIGRATION. Onde a
-- categoria estava certa e só o carimbo estava errado, o carimbo é corrigido.
-- Onde a categoria é estruturalmente impossível (D2/D3), ela é removida e a
-- linha volta para a fila com a escolha original preservada — declarar o vazio,
-- em vez de escolher no lugar de quem decide.
--
-- ===========================================================================
-- 1. hits_count PASSA A SE MANTER SOZINHO                              (D7·M14)
-- ===========================================================================
-- Diagnóstico: 61 regras, ZERO com hits_count > 0, enquanto a regra 17 sozinha
-- classificou 8.812 lançamentos. O contador só era incrementado em UM lugar —
-- app/api/financeiro/regras/aplicar/route.ts, a tela. Importador, migration,
-- reclassificador e backfill gravam classified_rule_id e nunca tocam o
-- contador. Seis caminhos de escrita, um só lembrando da regra: a mesma classe
-- de defeito que a 0054 corrigiu para review_status, e a mesma correção.
--
-- Não é dinheiro errado — é o instrumento cego. hits_count é o que ordena a
-- tela de regras e revela regra larga demais; zerado em todas, as 60 regras
-- ativas parecem igualmente inúteis.

CREATE OR REPLACE FUNCTION fin_rule_hits_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Só conta o que ACABOU de passar a apontar para a regra. UPDATE que mexe em
  -- outra coluna não pode inflar o contador.
  IF NEW.classified_rule_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.classified_rule_id IS DISTINCT FROM OLD.classified_rule_id) THEN
    UPDATE fin_rule
       SET hits_count = hits_count + 1,
           last_hit_at = now()
     WHERE id = NEW.classified_rule_id;
  END IF;
  -- Regra que perdeu um lançamento devolve o hit: sem isto o contador só sobe e
  -- deixa de medir "quanto esta regra explica HOJE".
  IF TG_OP = 'UPDATE' AND OLD.classified_rule_id IS NOT NULL
     AND OLD.classified_rule_id IS DISTINCT FROM NEW.classified_rule_id THEN
    UPDATE fin_rule
       SET hits_count = GREATEST(hits_count - 1, 0)
     WHERE id = OLD.classified_rule_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_rule_hits ON fin_transaction;
CREATE TRIGGER fin_transaction_rule_hits
  AFTER INSERT OR UPDATE OF classified_rule_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_rule_hits_sincroniza();

COMMENT ON FUNCTION fin_rule_hits_sincroniza() IS
  'Mantém fin_rule.hits_count e last_hit_at a partir de fin_transaction.classified_rule_id. '
  'Antes disto o contador só subia pela tela de regras, e os importadores e backfills — que '
  'classificam a esmagadora maioria — nunca o tocavam: 0 de 61 regras tinham hit.';

-- ===========================================================================
-- 2. A PROVENIÊNCIA DA REGRA 42, ARQUIVADA PELA 0050                (D1·D5·D6)
-- ===========================================================================
-- A 0050 arquivou `pix-pessoa-fisica` ("qualquer pix enviado ⇒ 6.01") e deixou
-- os 280 lançamentos que ela havia classificado apontando para ela. Ficou o pior
-- dos dois mundos: a regra não pode mais ser aplicada nem explicada, e as linhas
-- continuam carimbadas por ela.
--
-- Os 280 se separam em quatro grupos, e cada um tem uma resposta DIFERENTE e
-- verificável. A categoria não muda em nenhum deles.

-- 2a. 31 em 6.02 Pró-labore — o CADASTRO confirma.
-- fin_person.default_category_id dessas 31 linhas é exatamente 6.02 (conferido:
-- 31 de 31 concordam). Quem decide é a pessoa cadastrada, que é o mecanismo com
-- que a própria 0050 substituiu a regra. Proveniência honesta: 'favorecido'.
UPDATE fin_transaction t
   SET classified_by = 'favorecido',
       classified_rule_id = NULL,
       classified_reason = jsonb_build_object(
         'campo', 'fin_person.default_category_id',
         'motivo', 'categoria padrao da pessoa cadastrada confirma a categoria ja atribuida',
         'pessoa', p.name,
         'substitui', 'regra 42 pix-pessoa-fisica, arquivada pela 0050'),
       updated_at = now()
  FROM fin_person p
 WHERE t.classified_rule_id = 42
   AND p.counterparty_id = t.counterparty_id
   AND p.default_category_id = t.category_id;

-- 2b. 132 em 6.01 Salários — o VÍNCULO confirma.
-- São pagamentos a 6 pessoas com employment_type IN ('mei','irregular','indefinido').
-- A tabela de roteamento decidida pelo dono em 10/08/2026 e implementada em
-- scripts/classificar-custo-pessoas.mjs (POR_VINCULO) manda os três vínculos
-- para 6.01 — o mesmo destino em que já estão. A categoria não é palpite da
-- regra arquivada: é confirmada por uma fonte independente dela.
UPDATE fin_transaction t
   SET classified_by = 'favorecido',
       classified_rule_id = NULL,
       classified_reason = jsonb_build_object(
         'campo', 'fin_person.employment_type',
         'motivo', 'vinculo da pessoa confirma a categoria ja atribuida (roteamento POR_VINCULO, decisao de 10/08/2026)',
         'vinculo', p.employment_type,
         'pessoa', p.name,
         'substitui', 'regra 42 pix-pessoa-fisica, arquivada pela 0050'),
       updated_at = now()
  FROM fin_person p, fin_category c
 WHERE t.classified_rule_id = 42
   AND p.counterparty_id = t.counterparty_id
   AND c.id = t.category_id
   AND c.code = '6.01'
   AND p.employment_type IN ('mei', 'pj', 'clt', 'irregular', 'indefinido');

-- 2c. 6 classificadas por GENTE — a regra nunca decidiu nada ali.
-- Um humano escolheu a categoria pela tela e o ponteiro da classificação
-- anterior ficou pendurado. 'humano' com classified_rule_id preenchido faz o
-- badge "por quê?" atribuir a uma regra uma decisão que foi de uma pessoa.
UPDATE fin_transaction
   SET classified_rule_id = NULL,
       classified_reason = COALESCE(classified_reason, '{}'::jsonb)
                           || jsonb_build_object(
                                'regra_anterior_descartada', classified_rule_id,
                                'motivo_descarte', 'decisao humana vence: a regra nao decidiu esta linha'),
       updated_at = now()
 WHERE classified_by = 'humano'
   AND classified_rule_id IS NOT NULL;

-- 2d. O que sobrar da regra 42 está em 5.99 "Despesa a classificar".
-- Não há o que confirmar: a categoria É o marcador de indeciso. O ponteiro para
-- a regra arquivada some porque não explica mais nada, e a linha continua na
-- fila — que é onde ela tem de estar.
UPDATE fin_transaction
   SET classified_by = 'default',
       classified_rule_id = NULL,
       classified_reason = jsonb_build_object(
         'motivo', 'regra 42 pix-pessoa-fisica arquivada pela 0050; a categoria e o marcador de indeciso, nao uma decisao',
         'aguarda', 'decisao humana na fila de revisao'),
       updated_at = now()
 WHERE classified_rule_id = 42;

-- ===========================================================================
-- 3. 'fato_estrutural' VOLTA A SIGNIFICAR "VEIO DA FONTE"                  (D5)
-- ===========================================================================
-- 'fato_estrutural' é o único carimbo que dispensa revisão humana. 159
-- lançamentos o carregavam tendo como única evidência `description_norm` — ou
-- seja, um LIKE sobre o texto livre que o banco escreveu. São 132 da regra 42
-- (já tratados acima), 26 da regra 32 e 1 da regra 45.
--
-- Todos têm classified_rule_id de uma regra ATIVA. O carimbo honesto para eles
-- é 'regra': uma regra casou um texto. Continua sendo classificação boa — só
-- não é fato, e por isso não pode pular a fila.
UPDATE fin_transaction
   SET classified_by = 'regra',
       updated_at = now()
 WHERE classified_by = 'fato_estrutural'
   AND classified_reason->>'campo' = 'description_norm'
   AND classified_rule_id IS NOT NULL;

-- ===========================================================================
-- 3b. 'regra' SEM REGRA: 390 LANÇAMENTOS QUE NENHUMA fin_rule DECIDIU     (D6)
-- ===========================================================================
-- scripts/classificar-custo-pessoas.mjs gravava classified_by = 'regra' em dois
-- caminhos que não consultam fin_rule nenhuma:
--
--   371  roteamento pelo VÍNCULO de quem recebeu (fin_person.employment_type)
--    19  fornecedor casado por nome normalizado (fin_counterparty)
--
-- 'regra' com classified_rule_id nulo faz o badge "por quê?" prometer uma regra
-- que a tela nunca consegue abrir. O valor honesto do enum já existia desde a
-- 0002: 'favorecido' — quem decide é quem recebeu.
--
-- O script foi corrigido junto com esta migration; aqui fica o passado.
UPDATE fin_transaction
   SET classified_by = 'favorecido',
       classified_reason = classified_reason
                           || jsonb_build_object('campo', 'fin_person.employment_type'),
       updated_at = now()
 WHERE classified_by = 'regra'
   AND classified_rule_id IS NULL
   AND classified_reason->>'motivo' = 'custo de pessoa roteado por vínculo';

UPDATE fin_transaction
   SET classified_by = 'favorecido',
       classified_reason = classified_reason
                           || jsonb_build_object('campo', 'fin_counterparty.normalized_name'),
       updated_at = now()
 WHERE classified_by = 'regra'
   AND classified_rule_id IS NULL
   AND classified_reason->>'motivo' = 'fornecedor conhecido';

-- Rede de segurança para qualquer outro caminho que tenha feito o mesmo: sem um
-- id de regra, 'regra' é uma afirmação que ninguém consegue verificar.
UPDATE fin_transaction
   SET classified_by = 'favorecido',
       classified_reason = COALESCE(classified_reason, '{}'::jsonb)
                           || jsonb_build_object(
                                'motivo_reclassificacao',
                                'classified_by era ''regra'' sem classified_rule_id: nenhuma fin_rule decidiu esta linha'),
       updated_at = now()
 WHERE classified_by = 'regra'
   AND classified_rule_id IS NULL;

-- ===========================================================================
-- 4. CATEGORIA INCOMPATÍVEL COM O SINAL                                (D2·D3)
-- ===========================================================================
-- 10 lançamentos com categoria que o sinal torna impossível:
--
--   · 8 SAÍDAS em categoria de receita (3.02, 3.06, 3.12) — R$ 5.556,72
--     inflando faturamento, e com ele a base sobre a qual a 0065 apura tributo.
--     Ex.: -R$ 65.000 "Pix enviado — Leandro Duarte" em 3.06 Comissionamento de
--     vendas. É comissão PAGA, e 4.01 "Comissão paga a vendedor" existe — mas
--     escolher por ela é decisão de quem classifica, não desta migration.
--   · 1 ENTRADA de R$ 2.000 de sócio em 6.02 Pró-labore, exatamente o caso que a
--     0050 mandou não rotular sozinho: "um crédito vindo de um sócio não é
--     pró-labore, é aporte ou devolução".
--   · 1 ENTRADA de R$ 697 em 4.02 pela regra 45 casando texto — a assinatura do
--     bug do "POSTO", reaberta.
--
-- A categoria sai e a linha volta para a fila. A escolha original fica inteira
-- em classified_reason para a tela oferecer de volta em um clique.
UPDATE fin_transaction t
   SET category_id = NULL,
       classified_by = NULL,
       classified_rule_id = NULL,
       classified_reason = jsonb_build_object(
         'motivo', 'categoria incompativel com o sinal do lancamento: removida para decisao humana',
         'categoria_anterior', c.code || ' ' || c.name,
         'categoria_anterior_id', c.id,
         'decidida_antes_por', t.classified_by,
         'razao_anterior', t.classified_reason),
       updated_at = now()
  FROM fin_category c
 WHERE c.id = t.category_id
   AND NOT t.is_split_parent
   AND (
     (t.amount_cents < 0 AND c.kind = 'receita')
     OR (t.amount_cents > 0
         AND c.kind IN ('custo_variavel_direto','despesa_operacional','pessoal','imposto','investimento')
         AND lower(t.description_norm) !~ '(estorno|reembolso|devolu|refund|cancelamento)')
   );

-- E o defeito para de voltar: o banco passa a recusar a combinação.
--
-- Trigger e não CHECK porque a checagem cruza fin_transaction com fin_category,
-- e CHECK não enxerga outra tabela. Estorno e reembolso continuam de fora, pela
-- mesma razão de sempre — dinheiro que volta abate a despesa original, e decidir
-- se vira receita é convenção contábil do dono, não defeito do sistema.
--
-- RECUSA A CLASSIFICAÇÃO, E NÃO A LINHA. A tentação era RAISE EXCEPTION, e ela
-- está errada para este sistema: uma exceção aqui derruba o sync noturno
-- inteiro por causa de uma linha, e o ledger passa a mentir sobre o saldo de
-- todas as contas para proteger a categoria de uma. O lançamento entra — ele é
-- um fato do extrato — e o que cai é a categoria impossível, que manda a linha
-- para a fila com o motivo escrito.
CREATE OR REPLACE FUNCTION fin_transaction_sinal_da_categoria() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_kind text; v_code text; v_ruim boolean := false;
BEGIN
  IF NEW.category_id IS NULL OR NEW.is_split_parent THEN
    RETURN NEW;
  END IF;
  SELECT kind, code INTO v_kind, v_code FROM fin_category WHERE id = NEW.category_id;

  IF v_kind = 'receita' AND NEW.amount_cents < 0 THEN
    v_ruim := true;   -- despesa carimbada como receita infla faturamento e tributo
  ELSIF v_kind IN ('custo_variavel_direto','despesa_operacional','pessoal','imposto','investimento')
     AND NEW.amount_cents > 0
     AND lower(COALESCE(NEW.description_norm, '')) !~ '(estorno|reembolso|devolu|refund|cancelamento)' THEN
    v_ruim := true;   -- a assinatura do bug do "POSTO"
  END IF;

  IF v_ruim THEN
    NEW.classified_reason := jsonb_build_object(
      'motivo', 'categoria recusada: incompativel com o sinal do lancamento',
      'categoria_recusada', v_code,
      'kind', v_kind,
      'amount_cents', NEW.amount_cents,
      'razao_anterior', NEW.classified_reason);
    NEW.category_id := NULL;
    NEW.classified_by := NULL;
    NEW.classified_rule_id := NULL;
  END IF;
  RETURN NEW;
END $$;

-- O NOME DO GATILHO É FUNCIONAL, NÃO DECORATIVO.
--
-- Gatilhos BEFORE de mesma tabela disparam em ordem ALFABÉTICA. Os que já
-- existem são `fin_transaction_categoria_pessoa` (0050, atribui categoria) e
-- `fin_transaction_revisao` (0054, deriva review_status da categoria).
-- 'categoria_sinal' cai entre os dois: depois de a 0050 ter atribuído, e ANTES
-- de a 0054 ler a categoria. Com um nome depois de 'revisao' o gatilho anularia
-- a categoria já tendo a 0054 marcado a linha como 'ok', e ela sumiria da fila
-- justamente por ter sido recusada.
DROP TRIGGER IF EXISTS fin_transaction_sinal_categoria ON fin_transaction;
DROP TRIGGER IF EXISTS fin_transaction_categoria_sinal ON fin_transaction;
CREATE TRIGGER fin_transaction_categoria_sinal
  BEFORE INSERT OR UPDATE OF category_id, amount_cents ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_transaction_sinal_da_categoria();

COMMENT ON FUNCTION fin_transaction_sinal_da_categoria() IS
  'Recusa categoria de receita em saida e categoria de despesa em entrada (fora estorno e '
  'reembolso), anulando a categoria em vez de abortar a transacao. Os invariantes D2 e D3 '
  'viviam so no teste, e por isso o defeito reabriu duas vezes: uma pela tela de qualificacao '
  'em grupo, outra pelo motor de regras casando texto.';

-- ===========================================================================
-- 5. A FILA DE REVISÃO PASSA A SE MANTER SOZINHA               (H1·H3·H4·M4)
-- ===========================================================================
-- A 0054 já viveu esta história um nível abaixo: review_status saía de sincronia
-- porque a categoria entra por seis caminhos e cada um teria de lembrar de
-- atualizar o status. Ela resolveu com gatilho — e resolveu SÓ A COLUNA.
--
-- fin_review_item, que é a fila que uma pessoa realmente abre, continuou na
-- disciplina de quem escreve o próximo script: a única limpeza existente mora
-- dentro de scripts/import-asaas.mjs e só roda quando o Asaas sincroniza. Por
-- isso 343 itens continuam 'pendente' sobre linhas que as migrations 0043, 0050
-- e 0059 classificaram depois — R$ 1,1 milhão de fila que não é fila.
--
-- 5a. Reconciliação: item cuja causa desapareceu sai da fila.
-- 'a classificar' (3.99 e 5.99) NÃO é causa desaparecida — é o marcador de
-- indeciso, e a linha continua precisando de decisão. Sem esta ressalva a
-- reconciliação esconderia 111 lançamentos em 5.99 que são exatamente o
-- trabalho pendente.
UPDATE fin_review_item ri
   SET status = 'resolvido',
       resolved_at = now(),
       resolved_by = 'migration-0070'
 WHERE ri.status = 'pendente'
   AND ri.reason IN ('sem_categoria', 'texto_generico')
   AND (
     (ri.target_table = 'fin_transaction' AND EXISTS (
        SELECT 1 FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
         WHERE t.id = ri.target_id AND c.code NOT IN ('3.99','5.99')))
     OR
     (ri.target_table = 'fin_document' AND EXISTS (
        SELECT 1 FROM fin_document d JOIN fin_category c ON c.id = d.category_id
         WHERE d.id = ri.target_id AND c.code NOT IN ('3.99','5.99')))
   );

-- 5b. E o simétrico: lançamento sem categoria que não está na fila entra nela.
INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents)
SELECT t.entity_id, 'fin_transaction', t.id, 'sem_categoria', t.amount_cents
  FROM fin_transaction t
 WHERE NOT t.is_split_parent
   AND t.category_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                    WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id)
ON CONFLICT (target_table, target_id) DO NOTHING;

-- Item que já existe resolvido e cuja causa VOLTOU reabre. É o caso das linhas
-- que a seção 4 desclassificou: elas já passaram pela fila um dia.
UPDATE fin_review_item ri
   SET status = 'pendente', resolved_at = NULL, resolved_by = NULL
 WHERE ri.status = 'resolvido'
   AND ri.target_table = 'fin_transaction'
   AND EXISTS (SELECT 1 FROM fin_transaction t
                WHERE t.id = ri.target_id AND t.category_id IS NULL AND NOT t.is_split_parent);

-- 5c. O gatilho, para não precisar de uma 0071 daqui a duas semanas.
CREATE OR REPLACE FUNCTION fin_review_item_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_placeholder boolean;
BEGIN
  IF NEW.is_split_parent THEN
    RETURN NULL;
  END IF;

  SELECT c.code IN ('3.99','5.99') INTO v_placeholder
    FROM fin_category c WHERE c.id = NEW.category_id;

  IF NEW.category_id IS NOT NULL AND NOT COALESCE(v_placeholder, false) THEN
    -- Ganhou categoria de verdade: o item de "falta categoria" perdeu a causa.
    -- 'baixa_confianca' NÃO sai — ele existe justamente sobre linha classificada
    -- que alguém pediu para conferir. 'adiado' e 'ignorado' são decisão humana.
    UPDATE fin_review_item
       SET status = 'resolvido', resolved_at = now(), resolved_by = 'gatilho'
     WHERE target_table = 'fin_transaction' AND target_id = NEW.id
       AND status = 'pendente' AND reason IN ('sem_categoria', 'texto_generico');
  ELSIF NEW.category_id IS NULL THEN
    -- Perdeu a categoria: volta para a fila, criando ou reabrindo o item.
    INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents)
    VALUES (NEW.entity_id, 'fin_transaction', NEW.id, 'sem_categoria', NEW.amount_cents)
    ON CONFLICT (target_table, target_id) DO UPDATE
      SET status = CASE WHEN fin_review_item.status IN ('adiado','ignorado')
                        THEN fin_review_item.status ELSE 'pendente' END,
          reason = 'sem_categoria',
          resolved_at = NULL,
          resolved_by = NULL;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_review_item ON fin_transaction;
CREATE TRIGGER fin_transaction_review_item
  AFTER INSERT OR UPDATE OF category_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_review_item_sincroniza();

COMMENT ON FUNCTION fin_review_item_sincroniza() IS
  'Mantem fin_review_item coerente com fin_transaction.category_id — o que a 0054 fez para a '
  'coluna review_status e faltou para a fila que a pessoa abre. Preserva baixa_confianca '
  '(revisao sobre linha JA classificada), adiado e ignorado. Categoria 3.99/5.99 conta como '
  'sem decisao: e o marcador de indeciso, nao uma classificacao.';

-- ===========================================================================
-- 6. A JANELA DE COBERTURA DO INTER                                        (F3)
-- ===========================================================================
-- 13 lançamentos de 2026-08-14 existem fora de qualquer janela declarada.
--
-- A causa não é dado faltando, é um ON CONFLICT DO NOTHING sobre o único
-- (account_id, source, period_start): o sync do Inter sempre reabre na mesma
-- data inicial, então toda sincronização depois da primeira era engolida em
-- silêncio. A janela ficou parada em 2026-08-04 enquanto os lançamentos
-- chegavam até 2026-08-14 — e o monitor M8 do Inter acusava 12 dias de atraso
-- que só existiam na tabela de cobertura.
--
-- scripts/import-inter.mjs passou a fazer DO UPDATE ... GREATEST(period_end).
-- Aqui a janela existente é estendida até onde o lote 30 de fato importou.
UPDATE fin_statement_coverage sc
   SET period_end = GREATEST(sc.period_end, x.ate)
  FROM (
    SELECT t.account_id, max(t.posted_on) AS ate
      FROM fin_transaction t
      JOIN fin_account a ON a.id = t.account_id
     WHERE a.slug = 'inter'
     GROUP BY t.account_id
  ) x
 WHERE sc.account_id = x.account_id
   AND sc.source = 'api'
   AND sc.period_start = (
     SELECT max(period_start) FROM fin_statement_coverage
      WHERE account_id = x.account_id AND source = 'api'
   );

-- ===========================================================================
-- 7. hits_count RECEBE O PASSADO                                    (D7 · M14)
-- ===========================================================================
-- Fica por ÚLTIMO de propósito: as seções 2, 3b e 4 mexeram em
-- classified_rule_id, e o gatilho da seção 1 foi somando e subtraindo em cima
-- de um contador que nunca teve base. Recontar no fim é o único jeito de o
-- número ser o que o ledger de fato diz, e não o saldo de um contador que
-- começou errado.
--
-- Daqui para frente o gatilho mantém; esta é a única contagem cheia.
UPDATE fin_rule r
   SET hits_count = COALESCE(x.n, 0),
       last_hit_at = x.ultimo
  FROM (
    SELECT r2.id,
           count(t.id) AS n,
           max(COALESCE(t.classified_at, t.updated_at)) AS ultimo
      FROM fin_rule r2
      LEFT JOIN fin_transaction t ON t.classified_rule_id = r2.id
     GROUP BY r2.id
  ) x
 WHERE x.id = r.id
   AND (r.hits_count IS DISTINCT FROM COALESCE(x.n, 0)
        OR r.last_hit_at IS DISTINCT FROM x.ultimo);
