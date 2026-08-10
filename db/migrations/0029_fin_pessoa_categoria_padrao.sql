-- Categoria de custo padrão por PESSOA.
--
-- Por que coluna em fin_person e não tabela por vínculo: em 3 dos 8 vínculos a lei
-- decide (sócio → pró-labore, estagiário → bolsa, CLT → salário) e nos outros não.
-- 12 das 33 pessoas são MEI, e 0026 já registrava que MEI é "4.01/6.01 conforme o
-- núcleo": um MEI que desenvolve software é pessoal, um que executa obra é custo
-- variável direto daquela obra. A diferença muda a margem bruta. O vínculo não
-- carrega essa informação; a pessoa carrega.

ALTER TABLE fin_person
  ADD COLUMN IF NOT EXISTS default_category_id bigint REFERENCES fin_category(id);

COMMENT ON COLUMN fin_person.default_category_id IS
  'Categoria de custo padrão desta pessoa: onde o pagamento a ela deve cair na DRE. '
  'É CADASTRO, não classificação aplicada — nenhuma linha de fin_transaction muda por '
  'causa dela. Existe porque o vínculo não decide sozinho: 12 das 33 pessoas são MEI, e '
  'um MEI que desenvolve software é pessoal enquanto um MEI que executa obra é custo '
  'variável direto da obra. Nasce NULL de propósito; NULL é "ninguém decidiu ainda", que '
  'é diferente de 6.01.';

CREATE INDEX IF NOT EXISTS fin_person_default_category_idx
  ON fin_person (default_category_id) WHERE default_category_id IS NOT NULL;

-- A guarda de DIREÇÃO que fin_counterparty.default_category_id não tem.
--
-- Aquela coluna é uma só para as duas direções, e é por isso que
-- scripts/semear-categoria-padrao.mjs precisa da recusaPorDirecao() em código:
-- herdada num lançamento de saída, uma categoria 3.xx lança despesa como receita.
-- Aqui a direção é conhecida — todo pagamento a pessoa é saída —, então a regra
-- cabe no schema e não depende de nenhum chamador se lembrar dela.
--
-- 5.99 fica de fora pelo mesmo motivo do script: cadastrar o balde "a classificar"
-- como padrão registra a dívida de classificação em vez de pagá-la.
CREATE OR REPLACE FUNCTION fin_person_categoria_padrao_valida() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind text; v_code text;
BEGIN
  IF NEW.default_category_id IS NULL THEN RETURN NEW; END IF;
  SELECT kind, code INTO v_kind, v_code FROM fin_category WHERE id = NEW.default_category_id;
  IF v_kind NOT IN ('pessoal', 'custo_variavel_direto', 'despesa_operacional') THEN
    RAISE EXCEPTION 'categoria % é do grupo % e não pode ser custo padrão de pessoa: pagamento a pessoa é sempre saída', v_code, v_kind;
  END IF;
  IF v_code = '5.99' THEN
    RAISE EXCEPTION 'categoria 5.99 é o balde de despesa a classificar e não serve como padrão de pessoa';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_person_categoria_padrao_trg ON fin_person;
CREATE TRIGGER fin_person_categoria_padrao_trg
  BEFORE INSERT OR UPDATE OF default_category_id ON fin_person
  FOR EACH ROW EXECUTE FUNCTION fin_person_categoria_padrao_valida();

-- Semeia apenas os vínculos em que a lei decide sozinha: sócio e sócio adm vão
-- para pró-labore, estagiário para bolsa, CLT para salário. Os 21 restantes
-- (12 MEI, 5 indefinido, 4 irregular) ficam NULL de propósito e são decididos
-- na tela — NULL é "ninguém decidiu ainda", que é diferente de 6.01.
WITH escolha AS (
  SELECT p.id AS person_id, c.id AS category_id, c.code
    FROM fin_person p
    JOIN fin_entity e ON e.id = p.entity_id
    JOIN fin_category c ON c.entity_id = p.entity_id AND c.code = CASE p.employment_type
           WHEN 'socio_adm'  THEN '6.02'   -- pró-labore
           WHEN 'socio'      THEN '6.02'
           WHEN 'estagiario' THEN '6.06'   -- bolsa de estágio
           WHEN 'clt'        THEN '6.01'
         END
   WHERE e.slug = 'xpe' AND p.default_category_id IS NULL
), gravado AS (
  UPDATE fin_person p SET default_category_id = escolha.category_id
    FROM escolha WHERE p.id = escolha.person_id
  RETURNING p.id, p.entity_id, escolha.code
)
INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT entity_id, 'fin_person', id, 'bulk_update',
       jsonb_build_object('default_category_id', NULL),
       jsonb_build_object('default_category_id', code),
       ARRAY['default_category_id'], 'migration-0029'
  FROM gravado;
