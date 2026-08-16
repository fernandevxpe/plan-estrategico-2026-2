-- A fila de revisão volta a dizer a verdade sobre si mesma.
--
-- ---------------------------------------------------------------------------
-- O SINTOMA
-- ---------------------------------------------------------------------------
-- 657 lançamentos de 2026 estão com review_status='pendente', e 433 deles JÁ
-- TÊM categoria. A fila diz que há 657 decisões esperando quando existem 224.
--
-- Uma fila inflada em 66% é pior que uma fila grande: quem abre a tela vê um
-- número que não corresponde ao trabalho, desiste de zerar, e passa a ignorar o
-- indicador. O número perde a função de dizer o que fazer.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO É RECONCILIAÇÃO, E NÃO DECISÃO NOVA
-- ---------------------------------------------------------------------------
-- A regra do projeto já está escrita, e em mais de um importador
-- (scripts/import-inter.mjs, scripts/import-asaas.mjs):
--
--   review_status = CASE
--     WHEN review_status IN ('adiado','ignorado') THEN mantém   -- decisão humana
--     WHEN category_id IS NULL                    THEN 'pendente'
--     ELSE 'ok' END
--
-- O estado do banco confirma que é essa a semântica, sem exceção:
--
--   review_status='ok'        12.843 com categoria, ZERO sem categoria
--   review_status='pendente'     433 com categoria,   604 sem categoria
--
-- Nenhum 'ok' sem categoria em 13 mil linhas. Os 433 não são um caso de
-- julgamento diferente — são linhas que ganharam categoria depois, por um
-- caminho que não atualizou o status junto.
--
-- E a procedência delas é a mais firme que existe aqui:
--
--   300 fato_estrutural — o próprio Asaas/Polp declara o tipo da transação
--   133 regra           — padrão já aprendido e aplicado
--
-- Nenhuma veio de heurística frouxa. Marcar como revisado não está fechando
-- decisão pendente: está registrando decisão que já foi tomada.
--
-- O que NÃO é tocado: 'adiado' e 'ignorado', que são escolhas explícitas de
-- alguém, e as 604 sem categoria, que são a fila de verdade.

UPDATE fin_transaction
   SET review_status = 'ok',
       updated_at = now()
 WHERE review_status = 'pendente'
   AND category_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- E O SINCRONISMO PASSA A SER INVARIANTE, NÃO ROTINA
-- ---------------------------------------------------------------------------
-- A dessincronia aconteceu porque a categoria entra por muitos caminhos —
-- importadores, backfills, gatilho da 0049, gatilho da 0050, reclassificador,
-- edição na tela — e cada um teria de lembrar de mexer no review_status
-- também. Seis lugares para lembrar da mesma regra é a receita para cinco
-- esquecerem, e foi o que aconteceu.
--
-- O gatilho tira isso da disciplina de quem escreve o próximo script.
CREATE OR REPLACE FUNCTION fin_transaction_revisao_sincroniza() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Decisão humana explícita nunca é sobrescrita: quem adiou ou ignorou
  -- escolheu isso, e ganhar categoria não desfaz a escolha.
  IF NEW.review_status IN ('adiado', 'ignorado') THEN
    RETURN NEW;
  END IF;
  IF NEW.category_id IS NULL THEN
    NEW.review_status := 'pendente';
  ELSE
    NEW.review_status := 'ok';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_revisao ON fin_transaction;
CREATE TRIGGER fin_transaction_revisao
  BEFORE INSERT OR UPDATE OF category_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_transaction_revisao_sincroniza();

COMMENT ON FUNCTION fin_transaction_revisao_sincroniza() IS
  'Mantém review_status coerente com a existência de categoria — a regra que os importadores '
  'já aplicavam cada um por conta própria, e que por isso saía de sincronia. Preserva '
  'adiado/ignorado, que são decisão humana explícita.';
