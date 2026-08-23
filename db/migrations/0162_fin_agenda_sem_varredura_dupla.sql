-- As views da agenda param de varrer a mesma coisa duas vezes.
--
-- ---------------------------------------------------------------------------
-- ESTA MIGRATION NÃO É A CORREÇÃO PRINCIPAL — E VALE DIZER ISSO PRIMEIRO
-- ---------------------------------------------------------------------------
-- A `/financeiro/agenda` estava devolvendo 500 em produção, e derrubando junto
-- o `/api/notificacoes` que toda página chama. A causa é o JIT do Postgres
-- disparando por estimativa inflada e gastando 15 a 40 segundos de compilação
-- LLVM em consultas cujo trabalho real é de 400ms. Isso se corrige em
-- `lib/financeiro/db.ts` com `options: "-c jit=off"`, e é lá que está a cura.
--
-- Medido nas duas dimensões, mesma base, mesma consulta:
--
--                                        JIT on     JIT off
--   fin_custo_previsto_consolidado_v    12.573ms      541ms
--   fin_agenda_dia_v (janela 120d)      23.445ms      440ms
--   fin_agenda_resumo_dia_v (janela)    41.912ms      544ms
--   fin_agenda_prova_v                  28.363ms      409ms
--
-- Ou seja: as views VELHAS com JIT off já são mais rápidas que as novas com
-- JIT on. Eu cheguei nesta reescrita antes de achar o JIT, e ela sozinha
-- resolveria três das quatro — mas seria tratar o sintoma.
--
-- ---------------------------------------------------------------------------
-- ENTÃO POR QUE MANTER
-- ---------------------------------------------------------------------------
-- Porque as duplicatas são reais e continuam custando com o JIT desligado:
--
--   541ms → 511ms   custo consolidado
--   440ms → 397ms   agenda_dia
--   544ms → 364ms   agenda_resumo
--
-- E uma delas é desperdício puro: `fin_agenda_resumo_dia_v` varria
-- `fin_agenda_dia_v` INTEIRA uma segunda vez só para descobrir `min(dia)` e
-- `max(dia)` — números que a CTE `prev`, logo abaixo, já tem. Isso dobra com o
-- tamanho da base; o JIT não.
--
-- O QUE MUDA, EXATAMENTE
--   1. `fin_custo_previsto_consolidado_v` e `fin_receita_prevista_consolidado_v`
--      referenciavam a view derivada DUAS vezes (um LEFT JOIN e um UNION ALL).
--      Cada referência era uma expansão inteira. Agora é uma CTE MATERIALIZED,
--      avaliada uma vez.
--   2. `fin_agenda_resumo_dia_v`: `prev` vira MATERIALIZED e `limites` passa a
--      ler dela em vez de varrer a agenda de novo.
--
-- Nenhuma linha, nenhuma coluna, nenhum valor muda — e o bloco final PROVA
-- isso comparando cada view contra a definição anterior, nos dois sentidos,
-- antes de deixar a transação fechar.
-- ===========================================================================

-- Congela a definição de agora, para comparar contra ela lá embaixo.
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['fin_custo_previsto_consolidado_v',
                           'fin_receita_prevista_consolidado_v',
                           'fin_agenda_resumo_dia_v'] LOOP
    EXECUTE format('CREATE VIEW _antes_%s AS %s', v, pg_get_viewdef(v::regclass, true));
  END LOOP;
END $$;


CREATE OR REPLACE VIEW fin_custo_previsto_consolidado_v AS
WITH derivado AS MATERIALIZED (
         SELECT * FROM fin_custo_previsto_derivado_v
        ), linhas AS (
         SELECT i.entity_id,
            i.competencia,
            'item'::text AS procedencia,
                CASE i.estado
                    WHEN 'confirmado'::text THEN 'confirmado'::text
                    WHEN 'realizado'::text THEN 'confirmado'::text
                    WHEN 'ignorado'::text THEN 'ignorado'::text
                    ELSE i.origem
                END AS precedencia,
                CASE i.estado
                    WHEN 'confirmado'::text THEN 1
                    WHEN 'realizado'::text THEN 1
                    WHEN 'ignorado'::text THEN 9
                    ELSE 2
                END AS precedencia_nivel,
            i.id AS item_id,
            i.origem,
            i.estado,
            i.origem_ref,
            i.origem_camada,
                CASE
                    WHEN i.origem_ref IS NOT NULL THEN (to_char(i.competencia::timestamp with time zone, 'YYYY-MM'::text) || '|'::text) || i.origem_ref
                    ELSE 'item|'::text || i.id::text
                END AS chave_dedupe,
            i.dia_esperado,
            COALESCE(i.dia_regra, d.dia_regra,
                CASE
                    WHEN i.origem = 'manual'::text THEN 'informado por quem criou o item'::text
                    ELSE NULL::text
                END) AS dia_regra,
            i.descricao,
            i.category_id,
            i.nucleo,
            i.cost_center_id,
            i.counterparty_id,
            i.valor_previsto_cents,
            i.valor_confirmado_cents,
                CASE
                    WHEN i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text]) THEN i.valor_confirmado_cents
                    ELSE i.valor_previsto_cents
                END AS valor_cents,
            i.estado <> 'ignorado'::text AND
                CASE
                    WHEN i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text]) THEN i.valor_confirmado_cents
                    ELSE i.valor_previsto_cents
                END IS NOT NULL AND ((i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text])) OR i.origem = 'manual'::text OR COALESCE(d.entra_no_saldo, true)) AS entra_no_total,
            false AS suprimido_por_item,
                CASE
                    WHEN i.estado = 'ignorado'::text THEN 'ignorado: '::text || i.ignorado_motivo
                    WHEN
                    CASE
                        WHEN i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text]) THEN i.valor_confirmado_cents
                        ELSE i.valor_previsto_cents
                    END IS NULL THEN 'valor indeterminado: '::text || COALESCE(i.indeterminado_motivo, '(motivo ausente)'::text)
                    WHEN i.estado = 'previsto'::text AND i.origem = 'derivado'::text AND NOT COALESCE(d.entra_no_saldo, true) THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel'::text) || ' — materializar nao soma; confirmar sim'::text
                    ELSE NULL::text
                END AS motivo_nao_soma,
            i.confirmado_por,
            i.confirmado_em,
            i.realizado_transaction_id,
            d.confianca,
            d.confianca_nivel,
            d.natureza
           FROM fin_custo_previsto i
             LEFT JOIN derivado d ON d.entity_id = i.entity_id AND d.competencia = i.competencia AND d.origem_ref = i.origem_ref
        UNION ALL
         SELECT d.entity_id,
            d.competencia,
            'projetado'::text AS text,
            'projetado'::text AS text,
            3,
            NULL::bigint AS int8,
            'derivado'::text AS text,
            NULL::text AS text,
            d.origem_ref,
            d.origem_camada,
            d.chave_dedupe,
            d.dia_esperado,
            d.dia_regra,
            d.descricao,
            d.category_id,
            d.nucleo,
            d.cost_center_id,
            d.counterparty_id,
            d.valor_projetado_cents,
            NULL::bigint AS int8,
            d.valor_projetado_cents,
            d.entra_no_saldo AND NOT (EXISTS ( SELECT 1
                   FROM fin_custo_previsto i2
                  WHERE i2.entity_id = d.entity_id AND i2.competencia = d.competencia AND i2.origem_ref = d.origem_ref)),
            (EXISTS ( SELECT 1
                   FROM fin_custo_previsto i2
                  WHERE i2.entity_id = d.entity_id AND i2.competencia = d.competencia AND i2.origem_ref = d.origem_ref)) AS "exists",
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM fin_custo_previsto i2
                      WHERE i2.entity_id = d.entity_id AND i2.competencia = d.competencia AND i2.origem_ref = d.origem_ref)) THEN 'substituido pelo item #'::text || (( SELECT ((i3.id::text || ' ('::text) || i3.estado) || ')'::text
                       FROM fin_custo_previsto i3
                      WHERE i3.entity_id = d.entity_id AND i3.competencia = d.competencia AND i3.origem_ref = d.origem_ref))
                    WHEN NOT d.entra_no_saldo THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel'::text)
                    ELSE NULL::text
                END AS "case",
            NULL::text AS text,
            NULL::timestamp with time zone AS timestamptz,
            NULL::bigint AS int8,
            d.confianca,
            d.confianca_nivel,
            d.natureza
           FROM derivado d
        )
 SELECT entity_id,
    competencia,
    procedencia,
    precedencia,
    precedencia_nivel,
    item_id,
    origem,
    estado,
    origem_ref,
    origem_camada,
    chave_dedupe,
    dia_esperado,
    dia_regra,
    descricao,
    category_id,
    nucleo,
    cost_center_id,
    counterparty_id,
    valor_previsto_cents,
    valor_confirmado_cents,
    valor_cents,
    entra_no_total,
    suprimido_por_item,
    motivo_nao_soma,
    confirmado_por,
    confirmado_em,
    realizado_transaction_id,
    confianca,
    confianca_nivel,
    natureza,
        CASE
            WHEN entra_no_total AND counterparty_id IS NOT NULL AND count(*) FILTER (WHERE entra_no_total) OVER (PARTITION BY entity_id, competencia, counterparty_id) > 1 THEN 'mesma contraparte somando por mais de uma origem nesta competencia — conferir se e o mesmo dinheiro'::text
            ELSE NULL::text
        END AS alerta_sobreposicao
   FROM linhas l;

CREATE OR REPLACE VIEW fin_receita_prevista_consolidado_v AS
WITH derivado AS MATERIALIZED (
         SELECT * FROM fin_receita_prevista_derivado_v
        ), linhas AS (
         SELECT i.entity_id,
            i.competencia,
            'item'::text AS procedencia,
                CASE i.estado
                    WHEN 'confirmado'::text THEN 'confirmado'::text
                    WHEN 'realizado'::text THEN 'confirmado'::text
                    WHEN 'ignorado'::text THEN 'ignorado'::text
                    ELSE i.origem
                END AS precedencia,
                CASE i.estado
                    WHEN 'confirmado'::text THEN 1
                    WHEN 'realizado'::text THEN 1
                    WHEN 'ignorado'::text THEN 9
                    ELSE 2
                END AS precedencia_nivel,
            i.id AS item_id,
            i.origem,
            i.estado,
            i.origem_ref,
            i.origem_camada,
                CASE
                    WHEN i.origem_ref IS NOT NULL THEN (to_char(i.competencia::timestamp with time zone, 'YYYY-MM'::text) || '|'::text) || i.origem_ref
                    ELSE 'item_receita|'::text || i.id::text
                END AS chave_dedupe,
            i.dia_esperado,
            COALESCE(i.dia_regra, d.dia_regra,
                CASE
                    WHEN i.origem = 'manual'::text THEN 'informado por quem criou o item'::text
                    ELSE NULL::text
                END) AS dia_regra,
            i.descricao,
            i.category_id,
            i.nucleo,
            i.cost_center_id,
            i.counterparty_id,
            i.valor_previsto_cents,
            i.valor_confirmado_cents,
                CASE
                    WHEN i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text]) THEN i.valor_confirmado_cents
                    ELSE i.valor_previsto_cents
                END AS valor_cents,
            i.estado <> 'ignorado'::text AND
                CASE
                    WHEN i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text]) THEN i.valor_confirmado_cents
                    ELSE i.valor_previsto_cents
                END IS NOT NULL AND ((i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text])) OR i.origem = 'manual'::text OR COALESCE(d.entra_no_saldo, true)) AS entra_no_total,
            false AS suprimido_por_item,
                CASE
                    WHEN i.estado = 'ignorado'::text THEN 'nao vai acontecer: '::text || i.ignorado_motivo
                    WHEN
                    CASE
                        WHEN i.estado = ANY (ARRAY['confirmado'::text, 'realizado'::text]) THEN i.valor_confirmado_cents
                        ELSE i.valor_previsto_cents
                    END IS NULL THEN 'valor indeterminado: '::text || COALESCE(i.indeterminado_motivo, '(motivo ausente)'::text)
                    WHEN i.estado = 'previsto'::text AND i.origem = 'derivado'::text AND NOT COALESCE(d.entra_no_saldo, true) THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel'::text) || ' — materializar nao soma; confirmar sim'::text
                    ELSE NULL::text
                END AS motivo_nao_soma,
            i.ignorado_motivo,
            i.confirmado_por,
            i.confirmado_em,
            i.realizado_transaction_id,
            COALESCE(d.confianca,
                CASE
                    WHEN i.origem = 'manual'::text THEN 'estimado'::text
                    ELSE NULL::text
                END) AS confianca,
            COALESCE(d.confianca_nivel,
                CASE
                    WHEN i.origem = 'manual'::text THEN 5
                    ELSE NULL::integer
                END) AS confianca_nivel
           FROM fin_receita_prevista i
             LEFT JOIN derivado d ON d.entity_id = i.entity_id AND d.competencia = i.competencia AND d.origem_ref = i.origem_ref
        UNION ALL
         SELECT d.entity_id,
            d.competencia,
            'projetado'::text AS text,
            'projetado'::text AS text,
            3,
            NULL::bigint AS int8,
            'derivado'::text AS text,
            NULL::text AS text,
            d.origem_ref,
            d.origem_camada,
            d.chave_dedupe,
            d.dia_esperado,
            d.dia_regra,
            d.descricao,
            d.category_id,
            d.nucleo,
            d.cost_center_id,
            d.counterparty_id,
            d.valor_projetado_cents,
            NULL::bigint AS int8,
            d.valor_projetado_cents,
            d.entra_no_saldo AND NOT (EXISTS ( SELECT 1
                   FROM fin_receita_prevista i2
                  WHERE i2.entity_id = d.entity_id AND i2.competencia = d.competencia AND i2.origem_ref = d.origem_ref)),
            (EXISTS ( SELECT 1
                   FROM fin_receita_prevista i2
                  WHERE i2.entity_id = d.entity_id AND i2.competencia = d.competencia AND i2.origem_ref = d.origem_ref)) AS "exists",
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM fin_receita_prevista i2
                      WHERE i2.entity_id = d.entity_id AND i2.competencia = d.competencia AND i2.origem_ref = d.origem_ref)) THEN 'substituido pelo item #'::text || (( SELECT ((i3.id::text || ' ('::text) || i3.estado) || ')'::text
                       FROM fin_receita_prevista i3
                      WHERE i3.entity_id = d.entity_id AND i3.competencia = d.competencia AND i3.origem_ref = d.origem_ref))
                    WHEN NOT d.entra_no_saldo THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel'::text)
                    ELSE NULL::text
                END AS "case",
            NULL::text AS text,
            NULL::text AS text,
            NULL::timestamp with time zone AS timestamptz,
            NULL::bigint AS int8,
            d.confianca,
            d.confianca_nivel
           FROM derivado d
        )
 SELECT entity_id,
    competencia,
    procedencia,
    precedencia,
    precedencia_nivel,
    item_id,
    origem,
    estado,
    origem_ref,
    origem_camada,
    chave_dedupe,
    dia_esperado,
    dia_regra,
    descricao,
    category_id,
    nucleo,
    cost_center_id,
    counterparty_id,
    valor_previsto_cents,
    valor_confirmado_cents,
    valor_cents,
    entra_no_total,
    suprimido_por_item,
    motivo_nao_soma,
    ignorado_motivo,
    confirmado_por,
    confirmado_em,
    realizado_transaction_id,
    confianca,
    confianca_nivel,
        CASE
            WHEN entra_no_total AND counterparty_id IS NOT NULL AND count(*) FILTER (WHERE entra_no_total) OVER (PARTITION BY entity_id, competencia, counterparty_id) > 1 THEN 'mesma contraparte somando por mais de uma origem nesta competencia — conferir se e o mesmo dinheiro'::text
            ELSE NULL::text
        END AS alerta_sobreposicao
   FROM linhas l;

CREATE OR REPLACE VIEW fin_agenda_resumo_dia_v AS
WITH hoje AS (
         SELECT (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS d
        ), ancora AS (
         SELECT e.id AS entity_id,
            sum(a_1.current_balance_cents) AS saldo_cents,
            min(a_1.last_statement_at)::date AS ancora_ate
           FROM fin_account a_1
             JOIN fin_entity e ON e.id = a_1.entity_id
          WHERE e.slug = 'xpe'::text AND a_1.is_active AND a_1.kind <> 'emprestimo'::text
          GROUP BY e.id
        ), prev AS MATERIALIZED (
         SELECT v.entity_id,
            v.dia,
            sum(v.valor_cents) FILTER (WHERE v.direcao = 'receber'::text AND v.entra_no_total)::bigint AS entrada_cents,
            sum(v.valor_cents) FILTER (WHERE v.direcao = 'pagar'::text AND v.entra_no_total)::bigint AS saida_cents,
            sum(v.assinado_cents) FILTER (WHERE v.entra_no_total)::bigint AS liquido_cents,
            count(*) FILTER (WHERE v.entra_no_total) AS itens,
            count(*) FILTER (WHERE NOT v.entra_no_total) AS itens_fora_da_soma,
            sum(v.valor_cents) FILTER (WHERE NOT v.entra_no_total)::bigint AS fora_da_soma_cents,
            count(*) FILTER (WHERE v.vencido) AS itens_vencidos,
            sum(v.valor_cents) FILTER (WHERE v.vencido)::bigint AS vencido_cents,
            sum(v.valor_cents) FILTER (WHERE v.entra_no_total AND v.certeza = 'indeterminado'::text)::bigint AS estimado_cents,
            count(*) FILTER (WHERE v.entra_no_total AND v.procedencia = 'item'::text AND v.precedencia = 'manual'::text) AS itens_manuais,
            count(*) FILTER (WHERE v.entra_no_total AND v.precedencia = 'confirmado'::text) AS itens_confirmados
           FROM fin_agenda_dia_v v
          GROUP BY v.entity_id, v.dia
        ), limites AS (
         SELECT LEAST(COALESCE(min(p.dia), h_1.d), h_1.d) AS d0,
            GREATEST(COALESCE(max(p.dia), h_1.d), h_1.d + 365) AS d1
           FROM prev p
             CROSS JOIN hoje h_1
          GROUP BY h_1.d
        ), real_dia AS (
         SELECT t.entity_id,
            t.posted_on AS dia,
            sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0)::bigint AS entrada_cents,
            sum(- t.amount_cents) FILTER (WHERE t.amount_cents < 0)::bigint AS saida_cents,
            sum(t.amount_cents)::bigint AS liquido_cents,
            count(*) AS lancamentos
           FROM fin_transaction t
          WHERE t.transfer_status = 'nao'::text AND NOT t.is_split_parent
          GROUP BY t.entity_id, t.posted_on
        ), dias AS (
         SELECT gs.gs::date AS dia
           FROM limites l,
            LATERAL generate_series(l.d0::timestamp with time zone, l.d1::timestamp with time zone, '1 day'::interval) gs(gs)
        )
  SELECT a.entity_id,
    d.dia,
    date_trunc('month'::text, d.dia::timestamp with time zone)::date AS competencia,
        CASE
            WHEN d.dia < h.d THEN 'passado'::text
            WHEN d.dia = h.d THEN 'hoje'::text
            ELSE 'futuro'::text
        END AS tempo,
    d.dia - h.d AS dias_a_frente,
    a.ancora_ate,
    a.saldo_cents AS ancora_saldo_cents,
    COALESCE(p.entrada_cents, 0::bigint) AS entrada_cents,
    COALESCE(p.saida_cents, 0::bigint) AS saida_cents,
    COALESCE(p.liquido_cents, 0::bigint) AS liquido_cents,
    COALESCE(p.itens, 0::bigint) AS itens,
    COALESCE(p.itens_fora_da_soma, 0::bigint) AS itens_fora_da_soma,
    COALESCE(p.fora_da_soma_cents, 0::bigint) AS fora_da_soma_cents,
    COALESCE(p.itens_vencidos, 0::bigint) AS itens_vencidos,
    COALESCE(p.vencido_cents, 0::bigint) AS vencido_cents,
    COALESCE(p.estimado_cents, 0::bigint) AS estimado_cents,
    COALESCE(p.itens_manuais, 0::bigint) AS itens_manuais,
    COALESCE(p.itens_confirmados, 0::bigint) AS itens_confirmados,
        CASE
            WHEN d.dia >= h.d THEN a.saldo_cents + COALESCE(sum(
            CASE
                WHEN d.dia >= h.d THEN COALESCE(p.liquido_cents, 0::bigint)
                ELSE 0::bigint
            END) OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING), 0::numeric)
            ELSE NULL::numeric
        END AS saldo_previsto_cents,
    r.entrada_cents AS realizado_entrada_cents,
    r.saida_cents AS realizado_saida_cents,
    r.liquido_cents AS realizado_liquido_cents,
    r.lancamentos AS realizado_lancamentos,
        CASE
            WHEN d.dia < h.d AND r.liquido_cents IS NOT NULL THEN COALESCE(p.liquido_cents, 0::bigint) - r.liquido_cents
            ELSE NULL::bigint
        END AS erro_do_dia_cents
   FROM dias d
     CROSS JOIN hoje h
     CROSS JOIN ancora a
     LEFT JOIN prev p ON p.dia = d.dia AND p.entity_id = a.entity_id
     LEFT JOIN real_dia r ON r.dia = d.dia AND r.entity_id = a.entity_id;


-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  v text;
  nova integer;
  velha integer;
  total integer;
BEGIN
  FOREACH v IN ARRAY ARRAY['fin_custo_previsto_consolidado_v',
                           'fin_receita_prevista_consolidado_v',
                           'fin_agenda_resumo_dia_v'] LOOP
    -- EXCEPT ALL nos DOIS sentidos. Só num sentido, uma view que perdesse
    -- linhas duplicadas passaria: o conjunto novo caberia dentro do velho.
    EXECUTE format('SELECT count(*) FROM ((SELECT * FROM %s) EXCEPT ALL (SELECT * FROM _antes_%s)) x', v, v) INTO nova;
    EXECUTE format('SELECT count(*) FROM ((SELECT * FROM _antes_%s) EXCEPT ALL (SELECT * FROM %s)) x', v, v) INTO velha;
    EXECUTE format('SELECT count(*) FROM %s', v) INTO total;

    IF nova <> 0 OR velha <> 0 THEN
      RAISE EXCEPTION '% mudou de conteúdo: % linha(s) só na nova, % só na antiga', v, nova, velha;
    END IF;
    IF total = 0 THEN
      RAISE EXCEPTION '% ficou vazia — a reescrita quebrou alguma junção', v;
    END IF;

    RAISE NOTICE '% : % linha(s), idênticas nos dois sentidos', v, total;
  END LOOP;
END $$;

-- A comparação já cumpriu o papel; deixá-las viraria lixo com nome de view.
DROP VIEW _antes_fin_agenda_resumo_dia_v;
DROP VIEW _antes_fin_receita_prevista_consolidado_v;
DROP VIEW _antes_fin_custo_previsto_consolidado_v;
