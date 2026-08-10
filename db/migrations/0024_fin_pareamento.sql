-- Torna as regras do pareamento invariantes do banco, não promessas do script.
--
-- CONTEXTO
-- scripts/parear-transferencias.mjs é o primeiro processo a escrever
-- `transfer_group_id`. Ele já verifica, dentro da própria transação, que todo
-- grupo tem exatamente duas pernas, em contas diferentes, somando zero — e
-- aborta se não tiver. Mas essa verificação vale só para ELE. A UI, um UPDATE
-- manual no psql às 23h, ou o próximo script que alguém escrever passam por
-- fora e não encontram resistência nenhuma.
--
-- POR QUE ISSO IMPORTA MAIS AQUI DO QUE EM OUTRO LUGAR
-- O modo de falha do pareamento é INVISÍVEL. Toda agregação do módulo filtra
-- `transfer_status <> 'pareado'`: uma perna marcada errado não aparece como
-- erro, aparece como ausência. Receita e despesa simplesmente encolhem, e não
-- existe tela onde o número faltando se manifeste. Comparado a isso, uma
-- constraint que estoura um INSERT é barata.
--
-- O que esta migration NÃO faz: não pareia nada, não muda nenhum valor, não
-- toca em transfer_status de linha alguma. Ela só fecha portas. Hoje
-- `transfer_group_id` é NULL nas ~13.900 linhas, então as duas cláusulas
-- validam contra o acervo atual sem alterar uma única linha.

-- ---------------------------------------------------------------------------
-- 1. Uma perna por conta em cada grupo.
-- ---------------------------------------------------------------------------
-- A regra nº 1 do motor: NUNCA parear duas pernas do mesmo account_id. Uma
-- transferência entre contas próprias que "sai e entra na mesma conta" não é
-- transferência — é uma saída e uma entrada independentes que por acaso têm o
-- mesmo valor, e neutralizar as duas apaga dois fatos reais.
--
-- Como índice único parcial e não como CHECK porque a condição é entre linhas,
-- e é exatamente o tipo de coisa que um CHECK não enxerga.
CREATE UNIQUE INDEX IF NOT EXISTS fin_transaction_transfer_group_perna_idx
  ON fin_transaction (transfer_group_id, account_id)
  WHERE transfer_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Status e grupo andam juntos, nos dois sentidos.
-- ---------------------------------------------------------------------------
-- `fin_transaction_transfer_group` (migration 0002) já garante um lado:
-- pareado ⇒ tem grupo. Falta o outro, e é o lado perigoso.
--
-- Uma linha com transfer_group_id preenchido e transfer_status ainda
-- 'em_transito' é um pareamento pela metade: o par existe no banco, mas as duas
-- pernas continuam somando na DRE. Ninguém vê — o grupo está lá, parece feito.
-- É o estado em que um script interrompido no meio deixa as coisas, e o
-- conserto é começar recusando o estado.
DO $$
BEGIN
  ALTER TABLE fin_transaction
    ADD CONSTRAINT fin_transaction_transfer_group_completo
    CHECK (transfer_group_id IS NULL OR transfer_status = 'pareado');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'fin_transaction_transfer_group_completo já existe';
END $$;

COMMENT ON CONSTRAINT fin_transaction_transfer_group_completo ON fin_transaction IS
  'Grupo e status são a mesma decisão: quem tem transfer_group_id está pareado. O par pela metade é invisível na DRE.';

-- ---------------------------------------------------------------------------
-- O que ficou de fora, de propósito
-- ---------------------------------------------------------------------------
-- "Todo grupo soma zero" e "todo grupo tem exatamente 2 pernas" são invariantes
-- entre linhas que só um gatilho ou uma constraint deferida conseguiriam impor,
-- e o gatilho rodaria em TODO update de fin_transaction para proteger contra um
-- caso que hoje tem um único autor. O custo não paga.
--
-- Em vez disso, as duas afirmações são verificadas: (a) dentro da transação do
-- motor, a cada rodada, antes do COMMIT; (b) como asserção de acervo, na
-- consulta abaixo, que devolve zero linhas num banco saudável e é o que um
-- teste de aceite deve chamar:
--
--   SELECT transfer_group_id, count(*) pernas, count(DISTINCT account_id) contas,
--          sum(amount_cents) soma
--     FROM fin_transaction
--    WHERE transfer_group_id IS NOT NULL
--    GROUP BY 1
--   HAVING count(*) <> 2 OR count(DISTINCT account_id) <> 2 OR sum(amount_cents) <> 0;
