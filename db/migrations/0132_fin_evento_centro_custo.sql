-- O evento de junho vira centro de custo, porque não é receita da operação.
--
-- O QUE ACONTECEU
-- ---------------
-- Em junho/2026 a XPE organizou um evento e geriu o dinheiro dos apoiadores:
-- quatorze entradas entre 02 e 17/06, onze de exatamente R$500,00 e três de
-- R$1.022,00, somando R$8.566,00. Vieram de empresas do setor — GPC Gestão,
-- Standard, MSA Elétrica, Barros e Cia, Araripe, Leader Elevadores, KA-ZA,
-- Antares, Maxxcom, Cardeal Segurança, SFS Corretora, Belém Advocacia, Mais
-- Plan — e de uma pessoa física.
--
-- Elas já estão em `3.12 Eventos e Patrocínios`, e a categoria está certa. O
-- problema é de leitura: somadas ao faturamento, fazem junho parecer ter
-- vendido R$8,5 mil a mais de serviço. E o Fernando descreveu a natureza sem
-- ambiguidade — "gerimos os recursos dos apoiadores", e o dinheiro foi quase
-- todo gasto no próprio evento.
--
-- Arrecadação com contrapartida de gasto no mesmo período não é margem. É
-- passagem.
--
-- POR QUE CENTRO DE CUSTO E NÃO CATEGORIA NOVA
-- --------------------------------------------
-- Categoria responde "que natureza"; centro de custo responde "para qual
-- esforço". O evento tem receita E despesa — precisa de uma dimensão que
-- atravesse as duas, e categoria não atravessa: uma linha de receita e uma de
-- marketing nunca compartilham código de categoria.
--
-- `fin_cost_center` já é usado assim: as 20 obras vindas do ERP (`erp-14-…`,
-- `erp-223-…`) existem exatamente para agrupar receita e custo do mesmo
-- projeto. O evento é o mesmo padrão com outro nome.
--
-- O QUE ESTA MIGRATION MARCA, E O QUE DEIXA EM BRANCO
-- ---------------------------------------------------
-- Marca as 14 ENTRADAS, que são inequívocas: mesma categoria, mesma janela de
-- 16 dias, mesmo padrão de valor, e nenhuma delas tem outra explicação.
--
-- NÃO marca as saídas. Os candidatos existem — dois pagamentos extras de
-- R$635,00 ao Kevin (que recebe R$1.000 fixos de marketing todo mês, e em
-- junho recebeu os dois extras), Recife Prommo, Condogold, Flyer On — mas
-- "extra num mês em que houve evento" é coincidência temporal, não evidência.
-- Marcar custo por proximidade de data é exatamente o erro que o cruzamento
-- com o ClickUp já cometeu três vezes com "Aplicação RDB".
--
-- Quem souber marca pela tela. O centro de custo existir é o que torna isso
-- possível sem nova migration.

INSERT INTO fin_cost_center (entity_id, slug, name, is_active)
SELECT e.id, 'evento-2026-06', 'Evento junho/2026 (apoiadores)', true
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO UPDATE SET name = EXCLUDED.name, is_active = true;

-- As 14 entradas de patrocínio de junho. O filtro é a própria definição do
-- conjunto — categoria 3.12, entrada, dentro do mês — e não uma lista de ids,
-- que quebraria se a importação renumerasse.
UPDATE fin_transaction t
   SET cost_center_id = cc.id
  FROM fin_cost_center cc, fin_category c, fin_entity e
 WHERE cc.slug = 'evento-2026-06'
   AND cc.entity_id = e.id AND e.slug = 'xpe'
   AND c.id = t.category_id AND c.code = '3.12'
   AND t.amount_cents > 0
   AND t.posted_on >= '2026-06-01' AND t.posted_on < '2026-07-01'
   AND t.cost_center_id IS DISTINCT FROM cc.id;

COMMENT ON TABLE fin_cost_center IS
  'Centro de custo: o esforço a que receita e despesa pertencem, atravessando categorias. '
  'Usado pelas obras vindas do ERP (erp-*) e, desde a 0132, pelo evento de junho/2026 — '
  'arrecadação de apoiadores que foi gasta no próprio evento, e por isso não é margem.';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_total bigint;
BEGIN
  SELECT count(*), COALESCE(sum(t.amount_cents), 0) INTO v_n, v_total
    FROM fin_transaction t JOIN fin_cost_center cc ON cc.id = t.cost_center_id
   WHERE cc.slug = 'evento-2026-06';

  IF v_n <> 14 THEN
    RAISE EXCEPTION 'esperava 14 entradas de patrocínio marcadas, encontrei %', v_n;
  END IF;
  IF v_total <> 856600 THEN
    RAISE EXCEPTION 'esperava R$8.566,00 arrecadados, encontrei %', v_total;
  END IF;

  -- Marcar centro de custo não pode mudar categoria nem valor: se a receita de
  -- junho mudou, alguma coisa além do rótulo foi tocada.
  SELECT COALESCE(sum(amount_cents), 0) INTO v_total
    FROM fin_dre_lancamento_v
   WHERE linha = 'receita_bruta' AND mes_caixa = '2026-06-01';
  IF v_total <> 19238209 THEN
    RAISE EXCEPTION 'receita de junho mudou para % — esperado 19238209', v_total;
  END IF;
END $$;
