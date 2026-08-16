-- O núcleo que a categoria já sabia responder.
--
-- `fin_category.default_nucleo` existe desde a 0003 e está preenchido em 30 das
-- 55 categorias. Mesmo assim, 133 lançamentos estão com `nucleo` nulo tendo uma
-- categoria que declara o núcleo padrão — o dado estava no banco, só não tinha
-- sido aplicado.
--
-- POR QUE ISTO NÃO É UM CHUTE
--
-- Não se está inferindo núcleo a partir de texto, valor ou semelhança. A
-- categoria da transação foi atribuída (por regra, por humano ou por fato
-- estrutural) e a categoria carrega, por definição de cadastro, a que núcleo ela
-- pertence. Aplicar o default é propagar uma decisão já tomada, não tomar uma
-- nova.
--
-- O QUE NÃO É TOCADO
--
--   · quem já tem núcleo — inclusive quando difere do default da categoria, que
--     é o caso legítimo de uma despesa da mesma categoria pertencer a outro
--     núcleo naquele lançamento específico;
--   · quem não tem categoria (605 linhas) — sem categoria não há default, e
--     inventar núcleo aqui seria exatamente o chute que o projeto proíbe;
--   · movimentação — transferência, aplicação e resgate não entram em DRE e
--     portanto não têm núcleo a ter. Não é lacuna: é a natureza da linha.

UPDATE fin_transaction t
   SET nucleo = c.default_nucleo,
       updated_at = now()
  FROM fin_category c
 WHERE c.id = t.category_id
   AND t.nucleo IS NULL
   AND c.default_nucleo IS NOT NULL
   AND COALESCE(c.cash_flow_group, '') <> 'movimentacao';

-- Daqui em diante o default se aplica sozinho: uma linha que ganha categoria e
-- não tem núcleo herda o da categoria no mesmo ato.
--
-- Um trigger e não uma regra na aplicação porque as linhas chegam por caminhos
-- diferentes — import do Asaas, do Inter, do erp-obras, edição manual na tela e
-- reclassificação em lote. Cinco lugares para lembrar da mesma regra é a receita
-- para quatro deles esquecerem.
CREATE OR REPLACE FUNCTION fin_transaction_nucleo_padrao() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_nucleo text; v_grupo text;
BEGIN
  IF NEW.nucleo IS NOT NULL OR NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT default_nucleo, cash_flow_group INTO v_nucleo, v_grupo
    FROM fin_category WHERE id = NEW.category_id;
  -- Movimentação nunca ganha núcleo, mesmo que a categoria declare um.
  IF v_nucleo IS NOT NULL AND COALESCE(v_grupo, '') <> 'movimentacao' THEN
    NEW.nucleo := v_nucleo;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_nucleo ON fin_transaction;
CREATE TRIGGER fin_transaction_nucleo
  BEFORE INSERT OR UPDATE OF category_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_transaction_nucleo_padrao();

COMMENT ON FUNCTION fin_transaction_nucleo_padrao() IS
  'Propaga fin_category.default_nucleo para a transação que ganha categoria sem núcleo. '
  'Não sobrescreve núcleo já definido (o caso legítimo de exceção por lançamento) e nunca '
  'atribui núcleo a movimentação, que não entra em DRE.';
