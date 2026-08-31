-- Área da empresa: Gestão Operação.
--
-- A 0180 semeou as 14 que o dono listou na primeira vez. Esta é a 15ª,
-- pedida depois, no mesmo catálogo. Não atribui ninguém — só passa a
-- existir para marcar na matriz.

INSERT INTO fin_area_empresa (entity_id, slug, nome, ordem)
SELECT e.id, 'gestao_operacao', 'Gestão Operação', 55
  FROM fin_entity e
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO UPDATE
   SET nome = EXCLUDED.nome,
       ordem = EXCLUDED.ordem,
       ativo = true;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM fin_area_empresa a
    JOIN fin_entity e ON e.id = a.entity_id
   WHERE e.slug = 'xpe' AND a.slug = 'gestao_operacao' AND a.ativo AND a.nome = 'Gestão Operação';
  IF n <> 1 THEN
    RAISE EXCEPTION 'gestao_operacao deveria existir uma vez no catálogo xpe, tem %', n;
  END IF;
END $$;
