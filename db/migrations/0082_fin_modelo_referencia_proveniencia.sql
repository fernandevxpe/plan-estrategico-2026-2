-- Proveniência verificável para a referência da planilha.
--
-- A 0034 modelou `fin_model_value.procedencia = 'referencia'`, mas guardou a
-- origem apenas em texto livre (`motivo`). Hoje existem 149 células que dizem
-- vir da aba "Fluxo de Caixa" de uma planilha de 21 abas que não está no
-- repositório. O único workbook disponível tem 12 abas e nenhuma delas casa
-- com o modelo: 1/87 linhas no melhor caso. O valor histórico é evidência e
-- deve ser preservado; usá-lo como projeção confiável sem a fonte é que seria
-- falso.
--
-- Esta migration:
--   1. acrescenta proveniência estruturada à célula;
--   2. marca, com auditoria, somente as referências cuja fonte foi perdida;
--   3. mantém o valor bruto disponível para investigação;
--   4. torna `referencia_cents` NULL na comparação enquanto a origem estiver
--      perdida, expondo o valor preservado em coluna separada.
--
-- Nenhum `valor_cents` é alterado ou apagado.

ALTER TABLE fin_model_value
  ADD COLUMN origem_status text NOT NULL DEFAULT 'rastreada',
  ADD COLUMN origem_artefato text,
  ADD COLUMN origem_aba text,
  ADD COLUMN origem_checksum_sha256 text;

ALTER TABLE fin_model_value
  ADD CONSTRAINT fin_model_value_origem_status_ck
    CHECK (origem_status IN ('rastreada', 'origem_perdida')),
  ADD CONSTRAINT fin_model_value_origem_checksum_ck
    CHECK (origem_checksum_sha256 IS NULL OR origem_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT fin_model_value_origem_referencia_ck
    CHECK (
      procedencia <> 'referencia'
      OR origem_status = 'origem_perdida'
      OR (origem_artefato IS NOT NULL AND origem_aba IS NOT NULL
          AND origem_checksum_sha256 IS NOT NULL)
    ) NOT VALID;

COMMENT ON COLUMN fin_model_value.origem_status IS
  'rastreada quando arquivo/aba/checksum provam a referência; origem_perdida preserva o valor, mas o exclui de comparações.';
COMMENT ON COLUMN fin_model_value.origem_artefato IS
  'Nome lógico do arquivo de origem. Não é caminho absoluto e não contém segredo.';
COMMENT ON COLUMN fin_model_value.origem_aba IS
  'Aba exata da planilha de origem.';
COMMENT ON COLUMN fin_model_value.origem_checksum_sha256 IS
  'SHA-256 do arquivo importado; permite provar qual versão produziu a célula.';

-- A migration deixa uma trilha por célula antes de corrigir a proveniência.
-- O batch UUID é estável e identifica exclusivamente esta migração.
INSERT INTO fin_audit_log
  (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
SELECT v.entity_id,
       'fin_model_value',
       v.id,
       'update',
       jsonb_build_object(
         'valor_cents', v.valor_cents,
         'motivo', v.motivo,
         'origem_status', v.origem_status
       ),
       jsonb_build_object(
         'valor_cents', v.valor_cents,
         'motivo', regexp_replace(
           v.motivo,
           '^aba "Fluxo de Caixa", linha ([0-9]+)$',
           'origem perdida — aba "Fluxo de Caixa" (linha \1) de planilha ausente do repositório; ver DUVIDAS 37'
         ),
         'origem_status', 'origem_perdida',
         'origem_artefato', 'planilha de 21 abas ausente do repositório',
         'origem_aba', 'Fluxo de Caixa'
       ),
       ARRAY['motivo', 'origem_status', 'origem_artefato', 'origem_aba'],
       '00820000-0000-4000-8000-000000000001'::uuid,
       'migration-0082'
  FROM fin_model_value v
 WHERE v.procedencia = 'referencia'
   AND v.motivo ~ '^aba "Fluxo de Caixa", linha [0-9]+$';

UPDATE fin_model_value
   SET motivo = regexp_replace(
         motivo,
         '^aba "Fluxo de Caixa", linha ([0-9]+)$',
         'origem perdida — aba "Fluxo de Caixa" (linha \1) de planilha ausente do repositório; ver DUVIDAS 37'
       ),
       origem_status = 'origem_perdida',
       origem_artefato = 'planilha de 21 abas ausente do repositório',
       origem_aba = 'Fluxo de Caixa',
       origem_checksum_sha256 = NULL
 WHERE procedencia = 'referencia'
   AND motivo ~ '^aba "Fluxo de Caixa", linha [0-9]+$';

-- Qualquer referência legada que não seja o conjunto conhecido também não
-- ganha confiança por omissão. Ela permanece preservada e explicitamente sem
-- origem até ser reimportada por um arquivo com checksum.
UPDATE fin_model_value
   SET origem_status = 'origem_perdida',
       motivo = COALESCE(
         motivo,
         'origem perdida — referência anterior à proveniência estruturada; reimporte a fonte'
       )
 WHERE procedencia = 'referencia'
   AND origem_checksum_sha256 IS NULL;

ALTER TABLE fin_model_value
  VALIDATE CONSTRAINT fin_model_value_origem_referencia_ck;

-- Mantém a ordem e os tipos das 13 colunas antigas e acrescenta proveniência
-- ao final. Consumidor antigo continua compatível, mas recebe NULL no lugar de
-- uma referência sem fonte; o valor original continua em
-- `referencia_preservada_cents` para auditoria e eventual recuperação.
CREATE OR REPLACE VIEW fin_projetado_realizado_v AS
WITH realizado AS (
  SELECT m.line_id, t.entity_id, date_trunc('month', t.posted_on)::date AS mes,
         SUM(t.amount_cents) AS cents, COUNT(*) AS n
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    JOIN fin_model_map m ON m.entity_id = t.entity_id AND m.category_code = c.code
     AND (m.nucleo IS NULL
          OR (NOT m.nucleo_excluir AND t.nucleo = m.nucleo)
          OR (m.nucleo_excluir AND t.nucleo IS DISTINCT FROM m.nucleo))
   WHERE t.transfer_status <> 'pareado' AND NOT t.is_split_parent
   GROUP BY 1, 2, 3
),
celulas AS (
  SELECT entity_id, line_slug, ano, mes FROM fin_model_value
  UNION
  SELECT r.entity_id, l.slug, EXTRACT(YEAR FROM r.mes)::int, EXTRACT(MONTH FROM r.mes)::int
    FROM realizado r JOIN fin_model_line l ON l.id = r.line_id
)
SELECT
  c.entity_id,
  c.line_slug,
  l.name AS linha,
  l.section,
  l.kind,
  c.ano,
  c.mes,
  make_date(c.ano, c.mes, 1) AS competencia,
  CASE WHEN vr.origem_status = 'rastreada' THEN vr.valor_cents END AS referencia_cents,
  vm.valor_cents AS manual_cents,
  r.cents AS realizado_cents,
  r.n AS realizado_lancamentos,
  (SELECT MIN(b.valor_cents) FROM fin_budget_target b
    WHERE b.entity_id = c.entity_id AND b.line_slug = c.line_slug
      AND b.escopo = 'empresa' AND b.mapeamento = 'exato'
      AND b.periodicidade = 'mensal' AND b.ano = c.ano AND b.periodo = c.mes) AS meta_cents,
  vr.valor_cents AS referencia_preservada_cents,
  COALESCE(vr.origem_status, 'sem_referencia') AS referencia_status,
  vr.motivo AS referencia_motivo,
  vr.origem_artefato AS referencia_artefato,
  vr.origem_aba AS referencia_aba,
  vr.origem_checksum_sha256 AS referencia_checksum_sha256,
  vr.updated_at AS referencia_atualizada_em
FROM celulas c
JOIN fin_model_line l ON l.entity_id = c.entity_id AND l.slug = c.line_slug
LEFT JOIN realizado r
       ON r.entity_id = c.entity_id AND r.line_id = l.id
      AND r.mes = make_date(c.ano, c.mes, 1)
LEFT JOIN fin_model_value vr
       ON vr.entity_id = c.entity_id AND vr.line_slug = c.line_slug
      AND vr.ano = c.ano AND vr.mes = c.mes AND vr.procedencia = 'referencia'
LEFT JOIN fin_model_value vm
       ON vm.entity_id = c.entity_id AND vm.line_slug = c.line_slug
      AND vm.ano = c.ano AND vm.mes = c.mes AND vm.procedencia = 'manual';

COMMENT ON VIEW fin_projetado_realizado_v IS
  'Projetado versus realizado com proveniência. referencia_cents só é preenchida quando arquivo, aba e checksum estão rastreados. Referência de origem perdida permanece em referencia_preservada_cents, acompanhada de status e motivo, sem participar da comparação.';

CREATE OR REPLACE VIEW fin_modelo_referencia_cobertura_v AS
SELECT v.entity_id,
       v.ano,
       count(*)::integer AS celulas_preservadas,
       count(*) FILTER (WHERE v.origem_status = 'rastreada')::integer AS celulas_rastreadas,
       count(*) FILTER (WHERE v.origem_status = 'origem_perdida')::integer AS celulas_origem_perdida,
       sum(abs(v.valor_cents))::bigint AS massa_preservada_cents,
       sum(abs(v.valor_cents)) FILTER (WHERE v.origem_status = 'rastreada')::bigint
         AS massa_rastreada_cents,
       min(v.updated_at) AS referencia_mais_antiga_em,
       max(v.updated_at) AS referencia_mais_recente_em,
       array_agg(DISTINCT v.origem_artefato ORDER BY v.origem_artefato)
         FILTER (WHERE v.origem_artefato IS NOT NULL) AS artefatos,
       bool_and(v.origem_status = 'rastreada') AS cobertura_integral
  FROM fin_model_value v
 WHERE v.procedencia = 'referencia'
 GROUP BY v.entity_id, v.ano;

COMMENT ON VIEW fin_modelo_referencia_cobertura_v IS
  'Cobertura anual da referência de planilha. Valor preservado não é sinônimo de fonte rastreada; cobertura_integral só é verdadeira quando todas as células carregam proveniência verificável.';
