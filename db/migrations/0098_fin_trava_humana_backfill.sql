-- A decisão humana não travava. 217 linhas, R$ 239.174,45.
--
-- ---------------------------------------------------------------------------
-- O DEFEITO, ACHADO PELO AUDITOR INDEPENDENTE
-- ---------------------------------------------------------------------------
-- app/api/financeiro/qualificar/route.ts gravava classified_by='humano' sem
-- nunca escrever human_locked_fields. lib/financeiro/revisao.ts faz certo
-- (dois pontos, um deles reforça 'review_status'); a rota de qualificação em
-- grupo era o único caminho que esquecia a trava.
--
-- A consequência não é hipotética: 54 lançamentos decididos na tela em
-- 11/08/2026 foram sobrescritos por um bug irmão no importador do Asaas — a
-- categoria virou NULL por cima da escolha humana porque nada impedia a
-- reescrita (ver dúvida 40 em docs/DUVIDAS_FINANCEIRO.md e a migration 0091,
-- que corrigiu o importador mas não este backfill).
--
-- A rota já foi corrigida (mesmo commit desta migration). Isto aqui é o
-- backfill do que já existia sem trava.
--
-- ---------------------------------------------------------------------------
-- O QUE ENTRA, E O QUE FICA DE FORA
-- ---------------------------------------------------------------------------
--   'qualificação em grupo'          101   R$ -29.722,62   a rota corrigida
--   'qualificação por evidência'      54   R$ 346.401,82   as vítimas do bug irmão
--   'equipamento de medição...'       19   R$ -21.419,20   mesma ausência de trava
--   sem motivo (null)                 43   R$ -56.085,55   entra igual — é humano, tranca igual
--   ------------------------------------------------------------------------
--   total                            217   R$ 239.174,45
--
-- Nenhuma tem classified_rule_id preenchido (conferido: 0 casos) — não há
-- risco de reabrir o D6 ao travar estas linhas.
--
-- Só entram na trava o category_id: é o único campo que este caminho decide.
-- nucleo, cost_center_id e os demais continuam livres para o motor de regras,
-- exatamente como o padrão de revisao.ts já estabelece.

DO $$
DECLARE
  v_antes  bigint;
  v_tocado bigint;
  v_depois bigint;
BEGIN
  SELECT count(*) INTO v_antes
    FROM fin_transaction
   WHERE classified_by = 'humano'
     AND NOT ('category_id' = ANY (human_locked_fields));

  WITH alvo AS (
    UPDATE fin_transaction t
       SET human_locked_fields = (
             SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
               FROM unnest(t.human_locked_fields || ARRAY['category_id']) AS f
           )
     WHERE t.classified_by = 'humano'
       AND NOT ('category_id' = ANY (t.human_locked_fields))
    RETURNING t.id
  )
  SELECT count(*) INTO v_tocado FROM alvo;

  SELECT count(*) INTO v_depois
    FROM fin_transaction
   WHERE classified_by = 'humano'
     AND NOT ('category_id' = ANY (human_locked_fields));

  RAISE NOTICE '[0098] trava humana: % sem trava antes, % tocadas, % sem trava depois',
    v_antes, v_tocado, v_depois;

  IF v_depois <> 0 THEN
    RAISE EXCEPTION '[0098] % linha(s) classified_by=humano continuam sem category_id travado', v_depois;
  END IF;

  IF v_tocado <> 217 THEN
    RAISE EXCEPTION '[0098] esperava tocar 217 linhas (número medido em 16/08/2026), tocou %. '
      'A base mudou desde a medição — confira antes de seguir.', v_tocado;
  END IF;
END $$;
