-- Duas frentes irmas sobre o mesmo buraco: a empresa nao sabe o que deve.
--
-- PARTE A — a repeticao visual passa a ter prova NOMEADA, e ganha os detectores
--           que a assinatura do M12 nao consegue enxergar.
-- PARTE B — a conta a pagar passa a ter PROCEDENCIA MEDIDA: de onde ela pode
--           nascer com evidencia real, quanto vale, e o que so um humano resolve.
--
-- Esta migration NAO move um centavo. Nao apaga lancamento, nao neutraliza
-- duplicata, nao cria documento a pagar e nao toca transfer_status,
-- transfer_group_id, classified_by nem classified_rule_id.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDOU DESDE QUE O M12 FOI ESCRITO
-- ---------------------------------------------------------------------------
-- O monitor dizia: "todas passaram pelo indice unico porque tem dedupe_hash
-- distinto — pagamento legitimo repetido no mesmo dia tem exatamente esta cara,
-- entao isto e conferencia humana". Estava certo no dia em que foi escrito.
--
-- Hoje existe lastro que nao existia: end_to_end_id no Inter, id de transacao
-- financeira do Asaas, espelho do Nubank pelo Polp, fin_settlement ligando
-- transacao a cobranca pelo paymentId, e reversal_group_id marcando o estorno.
-- A 0087 usou parte disso e fechou os 54 casos. Esta migration faz a conferencia
-- independente com os eixos que a 0087 NAO usou, e responde tres perguntas que a
-- assinatura do M12 e estruturalmente incapaz de fazer:
--
--   1. o mesmo PIX foi contado duas vezes?        (end_to_end_id repetido)
--   2. a mesma cobranca foi liquidada duas vezes? (documento com duas liquidacoes)
--   3. o mesmo movimento entrou por duas fontes?  (conta+data+valor, fontes distintas)
--
-- Nenhuma delas cabe na chave (conta, data, valor, texto_normalizado): a
-- descricao do Inter ("Pix enviado") e a do PDF do Nubank ("Transferencia
-- enviada pelo Pix") sao textos diferentes para o mesmo dinheiro, entao um
-- movimento ingerido por duas fontes NUNCA aparece como grupo repetido. O M12
-- mede repeticao dentro de uma fonte; a duplicidade cara mora entre fontes.
--
-- Medido em 16/08/2026, antes desta migration: os tres detectores devolvem ZERO.
-- Isso nao e ausencia de dado — sao 13.881 lancamentos varridos por tres provas
-- independentes. E a razao de o balde "provado duplicado" valer R$ 0,00.
--
-- ---------------------------------------------------------------------------
-- A ANCORA QUE VALE MAIS QUE QUALQUER ID
-- ---------------------------------------------------------------------------
-- Se uma das 114 linhas repetidas fosse fantasma, a conta nao fecharia: o saldo
-- calculado (abertura + soma dos movimentos) passaria do saldo declarado
-- exatamente pelo excedente. As 6 contas fecham com divergencia de R$ 0,00, e
-- em Asaas, Inter e Nubank—Caixinhas o saldo declarado vem de snapshot da API do
-- proprio banco (fin_balance_snapshot.source = 'api', variancia zero) — fonte
-- que nao sabe da existencia do nosso ledger.
--
-- Esse eixo entra na triagem com nome proprio: `ancora_saldo_independente`. Onde
-- ele nao existe — a conta corrente do Nubank nao tem snapshot de API — a
-- triagem diz isso em vez de fingir que a conferencia foi a mesma.
--
-- ---------------------------------------------------------------------------
-- PARTE B: A REGRA QUE NAO PODE SER QUEBRADA
-- ---------------------------------------------------------------------------
-- fin_document tem 3.406 linhas e 100% 'receber'. A despesa so existe depois de
-- paga, como lancamento no extrato: a empresa nao tem "contas a pagar", tem
-- "contas pagas". Por isso a previsao de saida cobre 76,6% do que sai de fato e
-- a regra de competencia `documento_fiscal_despesa` cobre ZERO linhas.
--
-- A tentacao obvia e varrer a despesa historica e criar um pagavel para cada
-- uma. Isso seria transformar historico em obrigacao e contar o mesmo dinheiro
-- duas vezes — uma no lancamento que ja saiu, outra no documento que "vai sair".
-- A migration 0030 ja tinha avisado disso, e o gatilho da secao B4 passa a
-- recusar a forma mais direta do erro: documento a pagar que NASCE liquidado.
--
-- O que esta migration entrega e a MEDIDA: `fin_pagar_origem_v` diz, fonte a
-- fonte, quanto de despesa futura e derivavel com evidencia declarada e por qual
-- caminho, e `fin_pagar_lacuna_v` diz o que so um humano cadastrando resolve.
-- Nenhum documento e criado aqui.

-- ===========================================================================
-- PARTE A — TRIAGEM DAS LINHAS REPETIDAS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. EIXOS DE EVIDENCIA, MEDIDOS DO LEDGER CRU
-- ---------------------------------------------------------------------------
-- A view recalcula tudo a cada leitura. Nenhum numero de 16/08/2026 fica
-- congelado: se um membro novo entrar no caso, os eixos mudam junto e a triagem
-- da secao A2 muda com eles.
CREATE VIEW fin_duplicate_evidence_axis_v AS
WITH ancora AS (
  -- Conta cujo saldo declarado vem de fonte externa (API do banco) e bate com o
  -- calculado. A coluna current_balance_cents sozinha NAO conta: ela e escrita
  -- pelo proprio importador, e fonte conferindo a si mesma nao e conferencia.
  SELECT bs.account_id,
         max(bs.date) AS ancora_em,
         bool_or(bs.source = 'api' AND bs.variance_cents = 0) AS ancora_independente
    FROM fin_balance_snapshot bs
   GROUP BY bs.account_id
), membro AS (
  SELECT c.id AS case_id,
         t.id AS transaction_id,
         t.source,
         t.source_id,
         t.end_to_end_id,
         t.source_kind,
         t.lastro_match,
         t.reversal_group_id,
         t.transfer_status,
         t.transfer_group_id,
         t.import_batch_id,
         (SELECT count(*) FROM fin_import_row ir WHERE ir.transaction_id = t.id) AS linhas_cruas,
         (SELECT count(DISTINCT s.document_id) FROM fin_settlement s
           WHERE s.transaction_id = t.id AND s.kind = 'liquidacao') AS docs_liquidados
    FROM fin_duplicate_case c
    JOIN fin_duplicate_case_member m ON m.case_id = c.id AND m.is_current
    JOIN fin_transaction t ON t.id = m.transaction_id
), doc_repetido AS (
  -- Dois membros do MESMO caso liquidando o MESMO documento e a assinatura
  -- exata de "a mesma cobranca contada duas vezes".
  SELECT m.case_id, count(*)::integer AS documentos_liquidados_duas_vezes
    FROM (
      SELECT mm.case_id, s.document_id
        FROM membro mm
        JOIN fin_settlement s ON s.transaction_id = mm.transaction_id AND s.kind = 'liquidacao'
       GROUP BY mm.case_id, s.document_id
      HAVING count(DISTINCT s.transaction_id) > 1
    ) m
   GROUP BY m.case_id
)
SELECT c.id AS case_id,
       c.entity_id,
       c.account_id,
       a.name AS conta,
       c.posted_on,
       c.amount_cents,
       c.member_count,
       abs(c.amount_cents) * GREATEST(c.member_count - 1, 0)::bigint AS exposure_cents,
       c.workflow_status,
       c.verdict,
       c.evidence ->> 'proof_kind' AS proof_kind_registrado,
       array_agg(DISTINCT m.source) AS fontes,

       -- eixo: id proprio do provedor, um por movimento, buscado por GET
       count(m.source_id)::integer                         AS provedor_com_id,
       count(DISTINCT m.source_id)::integer                AS provedor_ids_distintos,

       -- eixo: end_to_end_id, o identificador do PIX no arranjo do Banco Central
       count(m.end_to_end_id)::integer                     AS e2e_com_id,
       count(DISTINCT m.end_to_end_id)::integer            AS e2e_distintos,

       -- eixo: o proprio banco anulou a perna (estorno no extrato)
       count(*) FILTER (WHERE m.reversal_group_id IS NOT NULL
                           OR m.transfer_status = 'anulado')::integer AS membros_estornados,

       -- eixo: espelho em OUTRA conta, com par proprio para cada membro
       count(*) FILTER (WHERE m.transfer_status = 'pareado')::integer AS membros_pareados,
       count(DISTINCT m.transfer_group_id)::integer        AS grupos_de_transferencia,

       -- eixo: contagem confirmada pelo open finance (Polp), independente do PDF
       count(*) FILTER (WHERE m.lastro_match = 'grupo_homogeneo')::integer AS lastro_homogeneo,

       -- eixo: linha crua preservada — necessario, nunca suficiente
       count(*) FILTER (WHERE m.linhas_cruas > 0)::integer AS membros_com_linha_crua,
       count(DISTINCT m.import_batch_id)::integer          AS lotes_distintos,
       bool_or(b.raw_artifact_key IS NOT NULL)             AS artefato_bruto_duravel,

       -- eixo: a conta fecha contra saldo declarado por quem nao conhece o ledger
       COALESCE(an.ancora_independente, false)             AS ancora_saldo_independente,
       an.ancora_em                                        AS ancora_saldo_em,

       -- eixo NEGATIVO: a mesma cobranca liquidada duas vezes dentro do caso
       COALESCE(dr.documentos_liquidados_duas_vezes, 0)    AS documentos_liquidados_duas_vezes
  FROM fin_duplicate_case c
  JOIN fin_account a ON a.id = c.account_id
  JOIN membro m ON m.case_id = c.id
  LEFT JOIN fin_import_batch b ON b.id = m.import_batch_id
  LEFT JOIN ancora an ON an.account_id = c.account_id
  LEFT JOIN doc_repetido dr ON dr.case_id = c.id
 GROUP BY c.id, c.entity_id, c.account_id, a.name, c.posted_on, c.amount_cents,
          c.member_count, c.workflow_status, c.verdict, c.evidence,
          an.ancora_independente, an.ancora_em, dr.documentos_liquidados_duas_vezes;

COMMENT ON VIEW fin_duplicate_evidence_axis_v IS
  'Os eixos de evidencia de cada caso M12, recalculados do ledger a cada leitura. '
  'Nenhum eixo prova sozinho: quem decide e a hierarquia de fin_duplicate_triagem_v.';

-- ---------------------------------------------------------------------------
-- A2. A TRIAGEM EM TRES BALDES
-- ---------------------------------------------------------------------------
-- A hierarquia nao e estetica. Ela ordena as provas por quanto DEPENDEM do
-- nosso proprio parser:
--
--   1 estorno_no_extrato ......... o banco declarou que anulou uma das pernas
--   2 espelho_de_transferencia ... outra conta, outra fonte, um par por membro
--   3 end_to_end_id_distinto ..... identificador do PIX, emitido fora da XPE
--   4 id_do_provedor_distinto .... id de movimento do Asaas/Inter/Polp/ERP
--   5 contagem_no_open_finance ... o Polp conta as mesmas N ocorrencias
--   6 totais_direcionais_do_extrato o total do dia no artefato bate com o ledger
--   7 linha_crua_distinta ........ so o nosso parser: NAO decide nada sozinho
--
-- O nivel 7 e circular de proposito: "o parser emitiu 4 linhas" nao responde
-- "o extrato tinha 4 movimentos". Caso que so alcanca o nivel 7 e indeterminado.
CREATE VIEW fin_duplicate_triagem_v AS
SELECT x.*,
       CASE
         WHEN x.documentos_liquidados_duas_vezes > 0 THEN 'provado_duplicado'
         WHEN x.membros_estornados > 0
              AND x.membros_estornados + x.membros_pareados >= x.member_count
           THEN 'provado_distinto'
         WHEN x.membros_pareados = x.member_count
              AND x.grupos_de_transferencia = x.member_count
           THEN 'provado_distinto'
         WHEN x.e2e_com_id = x.member_count AND x.e2e_distintos = x.member_count
           THEN 'provado_distinto'
         WHEN x.provedor_com_id = x.member_count AND x.provedor_ids_distintos = x.member_count
           THEN 'provado_distinto'
         WHEN x.lastro_homogeneo = x.member_count
           THEN 'provado_distinto'
         WHEN x.proof_kind_registrado = 'nubank_pdf_totais_direcionais_e_linhas_distintas'
              AND x.artefato_bruto_duravel
           THEN 'provado_distinto'
         ELSE 'indeterminado'
       END AS balde,
       CASE
         WHEN x.documentos_liquidados_duas_vezes > 0 THEN 'documento_liquidado_duas_vezes'
         WHEN x.membros_estornados > 0
              AND x.membros_estornados + x.membros_pareados >= x.member_count
           THEN 'estorno_no_extrato'
         WHEN x.membros_pareados = x.member_count
              AND x.grupos_de_transferencia = x.member_count
           THEN 'espelho_de_transferencia'
         WHEN x.e2e_com_id = x.member_count AND x.e2e_distintos = x.member_count
           THEN 'end_to_end_id_distinto'
         WHEN x.provedor_com_id = x.member_count AND x.provedor_ids_distintos = x.member_count
           THEN 'id_do_provedor_distinto'
         WHEN x.lastro_homogeneo = x.member_count
           THEN 'contagem_no_open_finance'
         WHEN x.proof_kind_registrado = 'nubank_pdf_totais_direcionais_e_linhas_distintas'
              AND x.artefato_bruto_duravel
           THEN 'totais_direcionais_do_extrato'
         ELSE NULL
       END AS prova,
       CASE
         WHEN x.documentos_liquidados_duas_vezes > 0 THEN 0
         WHEN x.membros_estornados > 0
              AND x.membros_estornados + x.membros_pareados >= x.member_count THEN 1
         WHEN x.membros_pareados = x.member_count
              AND x.grupos_de_transferencia = x.member_count THEN 2
         WHEN x.e2e_com_id = x.member_count AND x.e2e_distintos = x.member_count THEN 3
         WHEN x.provedor_com_id = x.member_count
              AND x.provedor_ids_distintos = x.member_count THEN 4
         WHEN x.lastro_homogeneo = x.member_count THEN 5
         WHEN x.proof_kind_registrado = 'nubank_pdf_totais_direcionais_e_linhas_distintas'
              AND x.artefato_bruto_duravel THEN 6
         ELSE 7
       END AS nivel_da_prova,
       CASE
         WHEN x.documentos_liquidados_duas_vezes > 0
           THEN 'duas transacoes liquidam o mesmo documento'
         WHEN x.membros_estornados > 0
              OR x.membros_pareados = x.member_count
              OR (x.e2e_com_id = x.member_count AND x.e2e_distintos = x.member_count)
              OR (x.provedor_com_id = x.member_count AND x.provedor_ids_distintos = x.member_count)
              OR x.lastro_homogeneo = x.member_count
              OR (x.proof_kind_registrado = 'nubank_pdf_totais_direcionais_e_linhas_distintas'
                  AND x.artefato_bruto_duravel)
           THEN NULL
         WHEN x.membros_com_linha_crua = x.member_count
           THEN 'so ha linha crua do proprio parser: nao separa 4 movimentos de 1 movimento lido 4 vezes'
         ELSE 'nenhum eixo de evidencia alcanca todos os membros'
       END AS motivo_indeterminado
  FROM fin_duplicate_evidence_axis_v x;

COMMENT ON VIEW fin_duplicate_triagem_v IS
  'Os tres baldes do M12: provado_distinto, provado_duplicado, indeterminado. '
  'nivel_da_prova ordena por quanto a prova depende do nosso parser — 7 e circular e nunca decide.';

-- ---------------------------------------------------------------------------
-- A3. OS DETECTORES QUE A ASSINATURA DO M12 NAO ALCANCA
-- ---------------------------------------------------------------------------
-- Cada linha desta view e uma duplicidade que existiria SEM aparecer no M12. As
-- tres regras sao independentes entre si e independentes da descricao — que e
-- justamente a coluna que muda quando o mesmo dinheiro chega por duas fontes.
CREATE VIEW fin_duplicidade_cruzada_v AS
-- 1. o mesmo PIX, identificado pelo arranjo do Banco Central, em dois lancamentos
SELECT 'end_to_end_id_repetido'::text            AS detector,
       t.end_to_end_id                           AS chave,
       count(*)::integer                         AS lancamentos,
       array_agg(t.id ORDER BY t.id)             AS transaction_ids,
       array_agg(DISTINCT t.source)              AS fontes,
       array_agg(DISTINCT t.account_id)          AS contas,
       min(t.posted_on)                          AS primeira_data,
       max(t.posted_on)                          AS ultima_data,
       (abs(min(t.amount_cents)) * (count(*) - 1))::bigint AS exposure_cents,
       'endToEndId e emitido fora da XPE e identifica UM pagamento instantaneo'::text AS porque
  FROM fin_transaction t
 WHERE t.end_to_end_id IS NOT NULL
   AND NOT t.is_split_parent AND t.parent_id IS NULL
 GROUP BY t.end_to_end_id
HAVING count(*) > 1

UNION ALL

-- 2. a mesma cobranca liquidada por dois lancamentos (o paymentId do Asaas)
SELECT 'documento_liquidado_duas_vezes',
       COALESCE(d.source_id, d.id::text),
       count(DISTINCT s.transaction_id)::integer,
       array_agg(DISTINCT s.transaction_id),
       array_agg(DISTINCT t.source),
       array_agg(DISTINCT t.account_id),
       min(t.posted_on),
       max(t.posted_on),
       (d.amount_cents * (count(DISTINCT s.transaction_id) - 1))::bigint,
       'fin_settlement liga transacao a cobranca pelo paymentId: dois lados para uma cobranca so'
  FROM fin_settlement s
  JOIN fin_document d ON d.id = s.document_id
  JOIN fin_transaction t ON t.id = s.transaction_id
 WHERE s.kind = 'liquidacao'
 GROUP BY d.id, d.source_id, d.amount_cents
HAVING count(DISTINCT s.transaction_id) > 1

UNION ALL

-- 3. o mesmo movimento ingerido por duas fontes — invisivel para o M12 porque a
--    descricao normalizada de cada fonte e um texto diferente
SELECT 'mesmo_movimento_em_duas_fontes',
       t.account_id || '|' || t.posted_on || '|' || t.amount_cents,
       count(*)::integer,
       array_agg(t.id ORDER BY t.id),
       array_agg(DISTINCT t.source),
       ARRAY[t.account_id],
       t.posted_on,
       t.posted_on,
       (abs(t.amount_cents) * (count(*) - 1))::bigint,
       'conta+data+valor iguais vindos de fontes distintas: candidato a dupla ingestao'
  FROM fin_transaction t
 WHERE NOT t.is_split_parent AND t.parent_id IS NULL
 GROUP BY t.account_id, t.posted_on, t.amount_cents
HAVING count(DISTINCT t.source) > 1;

COMMENT ON VIEW fin_duplicidade_cruzada_v IS
  'Duplicidade que o M12 nao consegue ver: ele agrupa por descricao normalizada, e o mesmo '
  'dinheiro vindo de duas fontes traz dois textos. Linha aqui e candidato a duplicata tecnica, '
  'nunca veredito automatico — a neutralizacao continua indisponivel (fin_duplicate_ledger_guard_v).';

CREATE VIEW fin_duplicidade_monitor_cruzado_v AS
SELECT d.detector,
       count(*)::integer AS ocorrencias,
       COALESCE(sum(d.lancamentos - 1), 0)::bigint AS lancamentos_excedentes,
       COALESCE(sum(d.exposure_cents), 0)::bigint AS exposure_cents
  FROM fin_duplicidade_cruzada_v d
 GROUP BY d.detector;

COMMENT ON VIEW fin_duplicidade_monitor_cruzado_v IS
  'Resumo por detector. Vazio significa que os tres detectores varreram o ledger e nao acharam nada '
  '— e um resultado medido, nao um monitor que ninguem ligou.';

-- ---------------------------------------------------------------------------
-- A4. A FILA DO RESIDUO HUMANO
-- ---------------------------------------------------------------------------
-- Um caso entra aqui quando NENHUM eixo de evidencia alcanca todos os membros.
-- A fila nomeia o que falta, e nunca escolhe por conta propria.
CREATE VIEW fin_duplicate_residuo_v AS
SELECT tr.case_id,
       tr.conta,
       tr.posted_on,
       tr.amount_cents,
       tr.member_count,
       tr.exposure_cents,
       tr.fontes,
       tr.motivo_indeterminado,
       CASE
         WHEN NOT tr.ancora_saldo_independente
           THEN 'obter saldo declarado por API/extrato para a conta e reconciliar'
         WHEN tr.provedor_com_id < tr.member_count
           THEN 'obter o id de movimento do provedor para os membros sem id'
         ELSE 'conferir o artefato original do extrato do dia'
       END AS o_que_destrava,
       (SELECT array_agg(m.transaction_id ORDER BY m.transaction_id)
          FROM fin_duplicate_case_member m
         WHERE m.case_id = tr.case_id AND m.is_current) AS candidatos
  FROM fin_duplicate_triagem_v tr
 WHERE tr.balde = 'indeterminado';

COMMENT ON VIEW fin_duplicate_residuo_v IS
  'Fila humana do M12: os casos que nenhuma evidencia existente separa. '
  'o_que_destrava diz qual dado falta — a fila nunca escolhe um lado.';

-- ---------------------------------------------------------------------------
-- A5. A EVIDENCIA MEDIDA VOLTA PARA O CASO, COM TRILHA
-- ---------------------------------------------------------------------------
-- Os 54 casos ja estao revisados desde a 0087. O que muda aqui e o NOME da
-- prova: onde a 0087 registrou "ids do provedor distintos" e existe evidencia
-- mais forte (o estorno declarado pelo banco, o espelho com par proprio em outra
-- conta), o caso passa a citar a prova mais forte e a guardar todos os eixos
-- medidos. Nenhum veredito muda de valor; o gatilho da 0087 grava o evento com o
-- estado anterior, entao desfazer e reler o evento.
UPDATE fin_duplicate_case c
   SET evidence = c.evidence
         || jsonb_build_object(
              'auditoria_0095', jsonb_build_object(
                'prova', tr.prova,
                'nivel_da_prova', tr.nivel_da_prova,
                'balde', tr.balde,
                'eixos', jsonb_build_object(
                  'provedor_ids_distintos', tr.provedor_ids_distintos,
                  'end_to_end_ids_distintos', tr.e2e_distintos,
                  'membros_estornados', tr.membros_estornados,
                  'membros_pareados', tr.membros_pareados,
                  'grupos_de_transferencia', tr.grupos_de_transferencia,
                  'lastro_homogeneo', tr.lastro_homogeneo,
                  'membros_com_linha_crua', tr.membros_com_linha_crua,
                  'artefato_bruto_duravel', tr.artefato_bruto_duravel,
                  'ancora_saldo_independente', tr.ancora_saldo_independente,
                  'documentos_liquidados_duas_vezes', tr.documentos_liquidados_duas_vezes
                ),
                'detectores_cruzados_zerados', NOT EXISTS (SELECT 1 FROM fin_duplicidade_cruzada_v),
                'auditado_em', '2026-08-16'
              )
            ),
       last_actor = 'migration-0095',
       updated_at = now()
  FROM fin_duplicate_triagem_v tr
 WHERE tr.case_id = c.id
   AND c.evidence -> 'auditoria_0095' IS NULL;

-- ===========================================================================
-- PARTE B — DE ONDE NASCE A CONTA A PAGAR
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- B1. A MATRIZ DE PROCEDENCIA: o que e derivavel, quanto vale, por qual caminho
-- ---------------------------------------------------------------------------
-- Cada linha e uma FONTE que ja existe no banco. `derivavel` responde a unica
-- pergunta que importa: essa fonte declara uma obrigacao FUTURA, ou ela so
-- guarda despesa que ja foi paga?
--
-- Fonte que so guarda historico e explicitamente `derivavel = false`, com o
-- motivo escrito. Ela continua valendo como PREVISAO (e ja vale, em
-- fin_previsao_evento_v), mas nao pode virar documento: um documento a pagar
-- criado a partir de despesa paga conta o mesmo dinheiro duas vezes.
CREATE VIEW fin_pagar_origem_v AS

-- 1. ClickUp — tarefas com vencimento FUTURO na lista "Fluxo de caixa"
SELECT 'clickup_fluxo_de_caixa'::text AS origem,
       'tarefa com vencimento futuro e valor declarado'::text AS evidencia,
       true AS derivavel,
       count(*)::integer AS compromissos,
       COALESCE(sum(d.amount_cents), 0)::bigint AS valor_cents,
       min(d.due_date) AS primeiro_vencimento,
       max(d.due_date) AS ultimo_vencimento,
       'scripts/import-clickup-compromissos.mjs --aplicar (idempotente por task id)'::text AS caminho,
       NULL::text AS motivo
  FROM fin_document d
 WHERE d.direction = 'pagar' AND d.source = 'clickup'

UNION ALL

-- 2. Cartao — compras ja feitas no ciclo aberto e parcelas contratadas
SELECT 'cartao_ciclo_e_parcelamento',
       'compra ja realizada, fatura ainda nao paga; plano de parcelas declarado pelo emissor',
       true,
       count(*)::integer,
       COALESCE(sum(cm.amount_cents), 0)::bigint,
       min(cm.competence_month),
       max(cm.competence_month),
       'fin_card_compromisso_mensal_v ja modela a obrigacao; falta materializar fin_document',
       NULL
  FROM fin_card_compromisso_mensal_v cm

UNION ALL

-- 3. Reembolso aprovado e nao pago — a aprovacao humana ja esta registrada
SELECT 'reembolso_aprovado',
       'aprovacao humana registrada em fin_reimbursement, sem documento de pagamento',
       true,
       count(*)::integer,
       COALESCE(sum(r.total_cents), 0)::bigint,
       min(r.reference_month),
       max(r.reference_month),
       'fin_reimbursement.paid_document_id existe desde a 0012 e nunca foi preenchido',
       NULL
  FROM fin_reimbursement r
 WHERE r.status = 'aprovado' AND r.paid_document_id IS NULL

UNION ALL

-- 4. Folha contratada — o valor combinado com cada pessoa, nao o que ja saiu
SELECT 'folha_contratada',
       'fin_person_compensation component=fixo kind=contratado para pessoa ativa',
       true,
       count(*)::integer,
       COALESCE(sum(pc.amount_cents), 0)::bigint,
       max(pc.reference_month),
       NULL::date,
       'contrato direction=pagar (0030) + documento mensal; exige a trava "documento vence projecao", '
       'senao soma com a camada pagar_folha de fin_previsao_evento_v',
       NULL
  FROM fin_person_compensation pc
  JOIN fin_person p ON p.id = pc.person_id AND p.status = 'ativo'
 WHERE pc.component = 'fixo' AND pc.kind = 'contratado'
   AND pc.reference_month = (SELECT max(reference_month) FROM fin_person_compensation)

UNION ALL

-- 5. Fatura de cartao com saldo devedor
SELECT 'fatura_cartao_em_aberto',
       'fatura fechada pelo emissor com saldo nao liquidado',
       true,
       count(*)::integer,
       COALESCE(sum(cb.total_amount_cents - cb.paid_amount_cents), 0)::bigint,
       min(cb.due_date),
       max(cb.due_date),
       'fin_card_bill ja tem due_date e saldo; falta materializar fin_document',
       NULL
  FROM fin_card_bill cb
 WHERE cb.total_amount_cents > cb.paid_amount_cents

UNION ALL

-- 6. Recorrente de fornecedor — DETECTADA no historico pago
SELECT 'recorrente_detectada_no_historico',
       'media de janela sobre despesa JA PAGA — nao ha documento, contrato nem boleto',
       false,
       count(*)::integer,
       COALESCE(sum(r.amount_cents), 0)::bigint,
       NULL::date,
       NULL::date,
       'permanece como previsao; virar documento seria transformar historico em obrigacao',
       'a fonte e o extrato do que ja saiu: criar pagavel aqui conta o mesmo dinheiro duas vezes'
  FROM fin_recurring r
 WHERE r.direction = 'pagar'

UNION ALL

-- 7. NFe de entrada — o repositorio nao existe
SELECT 'nfe_de_entrada',
       'nenhuma: fin_fiscal_document tem 100% de nota EMITIDA pela XPE (nfse via Asaas)',
       false,
       count(*)::integer,
       0::bigint,
       NULL::date,
       NULL::date,
       'exige integracao nova (SEFAZ/e-mail do fornecedor) ou cadastro humano',
       'nao ha documento de entrada em nenhuma fonte do ledger'
  FROM fin_fiscal_document f
 WHERE f.kind <> 'nfse'

UNION ALL

-- 8. Contrato de fornecedor — o ERP so tem contrato de cliente
SELECT 'contrato_de_fornecedor',
       'nenhuma: erp_contrato e 100% contrato de cliente (projeto/obra)',
       false,
       count(*)::integer,
       0::bigint,
       NULL::date,
       NULL::date,
       'exige cadastro humano em fin_contract direction=pagar',
       'erp-obras nao guarda o lado do fornecedor, e e somente leitura'
  FROM fin_contract c
 WHERE c.direction = 'pagar'

UNION ALL

-- 9. Boleto agendado no Inter — a credencial nao alcanca
SELECT 'boleto_agendado_no_inter',
       'nenhuma: o cliente do Inter usa escopo extrato.read (extrato, extrato/completo, saldo)',
       false,
       0,
       0::bigint,
       NULL::date,
       NULL::date,
       'exigiria escopo de pagamento na credencial — leitura apenas, nunca emissao',
       'o extrato so mostra o boleto DEPOIS de pago; agendado nao aparece'

UNION ALL

-- 10. Tributo — a apuracao entrega insumo e declara que nao calcula
SELECT 'tributo_apurado',
       'nenhuma: fin_apuracao_tributaria_v entrega insumo e declara que nao calcula',
       false,
       0,
       0::bigint,
       NULL::date,
       NULL::date,
       'depende do regime (duvida 21: em que conta ficam os MEIs decide o Fator R)',
       'sem anexo do Simples definido, o valor devido e estimativa, nao obrigacao';

COMMENT ON VIEW fin_pagar_origem_v IS
  'De onde a conta a pagar pode nascer com evidencia real. derivavel=false nao e ausencia de dado: '
  'e fonte que so guarda despesa JA PAGA, e por isso nao pode virar documento sem contar duas vezes.';

-- ---------------------------------------------------------------------------
-- B2. OS CANDIDATOS, LINHA A LINHA
-- ---------------------------------------------------------------------------
-- O que a matriz conta em bloco, esta view lista um a um — com a evidencia que
-- sustenta cada obrigacao. NAO cria documento: e a lista que um materializador
-- (ou um humano) le antes de criar.
CREATE VIEW fin_pagar_candidato_v AS
SELECT 'cartao_parcelamento'::text AS origem,
       ip.id::text AS origem_ref,
       ip.merchant_label AS sobre_o_que,
       ip.last_competence_month AS vence_ate,
       ip.open_amount_cents AS valor_cents,
       ip.installments_open AS parcelas,
       'plano de ' || ip.installments_total || ' parcelas declarado pelo emissor; '
         || ip.installments_billed || ' ja faturadas' AS evidencia,
       ip.counterparty_id,
       ip.category_id
  FROM fin_card_installment_plan ip
 WHERE ip.status = 'ativo' AND ip.installments_open > 0

UNION ALL

SELECT 'reembolso_aprovado',
       r.id::text,
       'Reembolso ' || p.name || ' — ' || to_char(r.reference_month, 'MM/YYYY'),
       r.reference_month,
       r.total_cents,
       1,
       'status=aprovado em fin_reimbursement e paid_document_id vazio',
       NULL::bigint,
       NULL::bigint
  FROM fin_reimbursement r
  JOIN fin_person p ON p.id = r.person_id
 WHERE r.status = 'aprovado' AND r.paid_document_id IS NULL

UNION ALL

SELECT 'fatura_cartao_em_aberto',
       cb.id::text,
       'Fatura ' || to_char(cb.reference_month, 'MM/YYYY'),
       cb.due_date,
       cb.total_amount_cents - cb.paid_amount_cents,
       1,
       'fatura ' || cb.status || ' com saldo devedor declarado pelo emissor',
       NULL::bigint,
       NULL::bigint
  FROM fin_card_bill cb
 WHERE cb.total_amount_cents > cb.paid_amount_cents;

COMMENT ON VIEW fin_pagar_candidato_v IS
  'Candidatos a documento a pagar, um por obrigacao, com a evidencia que a sustenta. '
  'Listar nao e criar: nenhuma linha daqui vira fin_document sem um passo explicito.';

-- ---------------------------------------------------------------------------
-- B3. A LACUNA: o que so um humano cadastrando resolve
-- ---------------------------------------------------------------------------
CREATE VIEW fin_pagar_lacuna_v AS
SELECT 'fornecedor_recorrente_sem_documento'::text AS lacuna,
       cp.name AS quem,
       r.amount_cents AS valor_mensal_cents,
       r.ocorrencias AS meses_observados,
       r.confidence AS confianca_da_deteccao,
       cat.code AS categoria,
       'o extrato prova que a XPE paga todo mes; nenhuma fonte declara o proximo vencimento'::text AS porque,
       'pedir contrato, boleto ou carne ao fornecedor e cadastrar como fin_contract direction=pagar'::text AS o_que_destrava
  FROM fin_recurring r
  LEFT JOIN fin_counterparty cp ON cp.id = r.counterparty_id
  LEFT JOIN fin_category cat ON cat.id = r.category_id
 WHERE r.direction = 'pagar'

UNION ALL

SELECT 'documento_de_entrada_inexistente',
       'todos os fornecedores e MEIs',
       0,
       0,
       'nao_ha_fonte',
       NULL,
       'fin_fiscal_document guarda 3.521 notas e todas foram EMITIDAS pela XPE',
       'definir por onde a nota de entrada chega (e-mail, SEFAZ, upload) antes de qualquer importador';

COMMENT ON VIEW fin_pagar_lacuna_v IS
  'O que nenhuma fonte existente resolve. Cada linha diz o valor em jogo e o que destrava — '
  'e o insumo da duvida 28 em docs/DUVIDAS_FINANCEIRO.md.';

-- ---------------------------------------------------------------------------
-- B4. A GUARDA: pagavel nao nasce liquidado
-- ---------------------------------------------------------------------------
-- A forma mais direta de "transformar historico em obrigacao" e varrer a despesa
-- ja paga e inserir um fin_document a pagar ja liquidado, amarrado ao lancamento
-- que ja saiu. O resultado nao quebra teste nenhum: a DRE simplesmente dobra a
-- despesa e ninguem tem como saber por que.
--
-- Um pagavel de verdade nasce 'previsto' ou 'emitido' e SO depois e liquidado
-- pelo extrato. Esta guarda recusa o atalho e nao atrapalha nenhum fluxo legitimo
-- — inclusive a liquidacao posterior, que e um UPDATE, nao um INSERT.
CREATE OR REPLACE FUNCTION fin_document_pagar_nao_nasce_liquidado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.direction = 'pagar' AND NEW.status IN ('liquidado', 'parcial') THEN
    RAISE EXCEPTION
      'documento a pagar nao pode nascer % (id de origem %/%): despesa ja paga vira lancamento, nao obrigacao',
      NEW.status, NEW.source, COALESCE(NEW.source_id, '?')
      USING HINT = 'crie o documento como previsto/emitido e deixe a liquidacao vir do extrato';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fin_document_pagar_nao_nasce_liquidado() IS
  'Guarda contra transformar historico em obrigacao: recusa INSERT de documento a pagar '
  'que ja nasce liquidado ou parcial. Nao restringe UPDATE — liquidar depois e o fluxo correto.';

DROP TRIGGER IF EXISTS fin_document_pagar_guard ON fin_document;
CREATE TRIGGER fin_document_pagar_guard
BEFORE INSERT ON fin_document
FOR EACH ROW EXECUTE FUNCTION fin_document_pagar_nao_nasce_liquidado();

-- ---------------------------------------------------------------------------
-- B5. COBERTURA DA SAIDA: quanto do que sai a previsao consegue ver
-- ---------------------------------------------------------------------------
CREATE VIEW fin_pagar_cobertura_v AS
WITH real_mensal AS (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY m.saida_cents)::bigint AS mediana_cents
    FROM (
      SELECT date_trunc('month', t.posted_on)::date AS mes,
             sum(abs(t.amount_cents))::bigint AS saida_cents
        FROM fin_transaction t
        LEFT JOIN fin_category c ON c.id = t.category_id
       WHERE t.amount_cents < 0
         AND t.posted_on >= date_trunc('year', CURRENT_DATE)
         AND COALESCE(c.cash_flow_group, '') <> 'movimentacao'
         AND t.transfer_status <> 'pareado'
         AND NOT t.is_split_parent
       GROUP BY 1
    ) m
), previsto AS (
  SELECT date_trunc('month', e.dia)::date AS mes,
         sum(e.valor_cents) FILTER (WHERE e.entra_no_saldo)::bigint AS entra_cents,
         sum(e.valor_cents) FILTER (WHERE NOT e.entra_no_saldo)::bigint AS medido_e_excluido_cents
    FROM fin_previsao_evento_v e
   WHERE e.sentido = 'saida'
     AND e.dia >= date_trunc('month', CURRENT_DATE) + interval '1 month'
   GROUP BY 1
)
SELECT p.mes,
       r.mediana_cents AS saida_real_mediana_cents,
       COALESCE(p.entra_cents, 0) AS previsto_no_saldo_cents,
       COALESCE(p.medido_e_excluido_cents, 0) AS medido_mas_fora_do_saldo_cents,
       GREATEST(r.mediana_cents - COALESCE(p.entra_cents, 0), 0) AS lacuna_cents,
       round(100.0 * COALESCE(p.entra_cents, 0) / NULLIF(r.mediana_cents, 0), 1) AS cobertura_pct,
       (SELECT COALESCE(sum(d.amount_cents), 0)
          FROM fin_document d
         WHERE d.direction = 'pagar'
           AND d.status IN ('previsto', 'emitido', 'confirmado')
           AND date_trunc('month', d.due_date)::date = p.mes) AS documento_a_pagar_cents
  FROM previsto p CROSS JOIN real_mensal r
 ORDER BY p.mes;

COMMENT ON VIEW fin_pagar_cobertura_v IS
  'Quanto da saida real a previsao ve, mes a mes. medido_mas_fora_do_saldo_cents e a recorrencia '
  'de fornecedor detectada no historico: ela e medida e NAO soma, justamente por nao ter documento.';

-- ===========================================================================
-- ASSERTIVAS — estruturais, nunca um numero de 16/08 congelado
-- ===========================================================================
DO $$
DECLARE
  v_duplicados integer;
  v_indeterminados integer;
  v_cruzados integer;
  v_guard record;
  v_pagar_liquidado integer;
BEGIN
  -- A triagem tem de cobrir todos os casos, sem balde nulo.
  IF EXISTS (SELECT 1 FROM fin_duplicate_triagem_v WHERE balde IS NULL) THEN
    RAISE EXCEPTION '0095: a triagem deixou caso sem balde';
  END IF;

  SELECT count(*) INTO v_duplicados FROM fin_duplicate_triagem_v WHERE balde = 'provado_duplicado';
  SELECT count(*) INTO v_indeterminados FROM fin_duplicate_triagem_v WHERE balde = 'indeterminado';
  SELECT count(*) INTO v_cruzados FROM fin_duplicidade_cruzada_v;
  RAISE NOTICE '0095 triagem: % provado_duplicado, % indeterminado, % ocorrencia(s) de duplicidade cruzada',
    v_duplicados, v_indeterminados, v_cruzados;

  -- Caso indeterminado PRECISA de motivo: vazio sem explicacao e proibido.
  IF EXISTS (SELECT 1 FROM fin_duplicate_triagem_v
              WHERE balde = 'indeterminado' AND motivo_indeterminado IS NULL) THEN
    RAISE EXCEPTION '0095: caso indeterminado sem motivo declarado';
  END IF;

  -- Prova nomeada e obrigatoria para quem foi para o balde "provado".
  IF EXISTS (SELECT 1 FROM fin_duplicate_triagem_v
              WHERE balde <> 'indeterminado' AND prova IS NULL) THEN
    RAISE EXCEPTION '0095: caso provado sem prova nomeada';
  END IF;

  -- A neutralizacao continua indisponivel. Esta migration nao a habilita.
  SELECT * INTO v_guard FROM fin_duplicate_ledger_guard_v;
  IF v_guard.neutralization_enabled OR v_guard.active_resolutions <> 0 THEN
    RAISE EXCEPTION '0095: guarda monetaria foi habilitada — nao e esta migration que faz isso';
  END IF;

  -- Nenhum documento a pagar nasceu liquidado antes da guarda existir.
  SELECT count(*) INTO v_pagar_liquidado
    FROM fin_document WHERE direction = 'pagar' AND status IN ('liquidado', 'parcial');
  IF v_pagar_liquidado <> 0 THEN
    RAISE EXCEPTION '0095: % documento(s) a pagar ja nascem liquidados', v_pagar_liquidado;
  END IF;

  -- A matriz de origem tem de declarar caminho para tudo e motivo para o que nao deriva.
  IF EXISTS (SELECT 1 FROM fin_pagar_origem_v WHERE caminho IS NULL) THEN
    RAISE EXCEPTION '0095: origem sem caminho declarado';
  END IF;
  IF EXISTS (SELECT 1 FROM fin_pagar_origem_v WHERE NOT derivavel AND motivo IS NULL) THEN
    RAISE EXCEPTION '0095: origem nao derivavel sem motivo';
  END IF;
END;
$$;
