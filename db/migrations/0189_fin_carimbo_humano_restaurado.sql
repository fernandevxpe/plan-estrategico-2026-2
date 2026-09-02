-- Devolve o carimbo humano às 399 linhas do Asaas que a reimportação de
-- 01/09/2026 marcou como máquina.
-- ===========================================================================
-- O QUE ACONTECEU
--
-- `import-asaas.mjs` roda inteiro numa transação e vinha morrendo na CHECK
-- `fin_transaction_reversal_group_completo` — o upsert rebaixava as 8 anulações
-- da 0044 para 'nao' e deixava `reversal_group_id` preenchido. Com o ROLLBACK,
-- NADA do Asaas entrava, e um segundo defeito ficava inerte atrás do primeiro:
--
--   classified_by = COALESCE(EXCLUDED.classified_by, fin_transaction.classified_by)
--
-- O COALESCE só protege quando a rodada não achou nada. EXCLUDED é não-nulo
-- sempre que uma regra casa — então, na primeira importação que voltou a
-- fechar, 399 linhas travadas por xpeadmin em 19–20/08 amanheceram com
-- 'fato_estrutural' (390) e 'regra' (9).
--
-- O DINHEIRO NÃO MUDOU: `human_locked_fields` protege o VALOR, e a conferência
-- feita antes desta migration achou 399 de 399 com a categoria do humano
-- intacta. O que se perdeu foi a proveniência — e é dela que vive o invariante
-- E1: "trava com carimbo de máquina é trava que a próxima sync vai ignorar".
--
-- O código já foi corrigido (o upsert agora protege 'humano'/'trava' como
-- protege 'pareado' e 'anulado'). Esta migration repara o que ficou gravado.
--
-- A RESTAURAÇÃO NÃO CHUTA. Cada linha volta ao que `fin_classification_event`
-- registrou no último evento `humano` dela — carimbo, regra, motivo e data da
-- decisão original. A cláusula de categoria igual é a prova de que é a MESMA
-- decisão: se o valor tivesse mudado desde então, restaurar o carimbo antigo
-- seria inventar uma proveniência, não devolvê-la.
-- ===========================================================================

WITH ultimo_humano AS (
  SELECT DISTINCT ON (e.target_id)
         e.target_id, e.rule_id, e.category_id, e.rationale, e.created_at
    FROM fin_classification_event e
   WHERE e.target_table = 'fin_transaction'
     AND e.stage = 'humano'
   ORDER BY e.target_id, e.created_at DESC
)
UPDATE fin_transaction t
   SET classified_by      = 'humano',
       classified_rule_id = u.rule_id,
       classified_reason  = u.rationale,
       classified_at      = u.created_at,
       updated_at         = now()
  FROM ultimo_humano u
 WHERE u.target_id = t.id
   AND t.human_locked_fields <> '{}'
   AND t.classified_by NOT IN ('humano', 'trava')
   AND t.category_id IS NOT DISTINCT FROM u.category_id;

-- E1 tem de fechar para o acervo inteiro, não só para o Asaas: se sobrar linha
-- travada com carimbo de máquina, ou ela não tem evento humano (e aí a trava é
-- que está errada) ou a categoria mudou depois (e aí é caso para uma pessoa).
DO $$
DECLARE sobraram bigint;
BEGIN
  SELECT count(*) INTO sobraram
    FROM fin_transaction
   WHERE human_locked_fields <> '{}'
     AND classified_by NOT IN ('humano', 'trava');

  IF sobraram > 0 THEN
    RAISE EXCEPTION '0189: ainda restam % linha(s) travadas com carimbo de máquina', sobraram;
  END IF;
END $$;
