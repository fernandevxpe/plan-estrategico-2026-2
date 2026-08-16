-- O balanço em 0,24 segundo em vez de 35.
--
-- ---------------------------------------------------------------------------
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- `fin_balanco_mensal_v`, como a 0073 a escreveu, calcula cada mês com
-- subconsultas correlacionadas: para CADA um dos 64 meses ela varre
-- `fin_dre_mensal_v` inteira cinco vezes, `fin_fluxo_caixa_v` quatro vezes e
-- `fin_fluxo_caixa_conta_v` uma vez. Como essas três também são views sobre o
-- ledger, o custo é multiplicativo.
--
-- Medido no banco de produção, com 13.880 lançamentos e 64 meses:
--
--   fin_balanco_v ......... 35.239 ms
--   fin_balanco_mensal_v ...   275 ms   ← engana: `count(*)` deixa o planner
--                                         descartar as colunas não referenciadas
--                                         e o plano medido não é o plano real
--
-- 35 segundos não é lentidão: é uma tela que não abre. E o `count(*)` rápido é
-- pior que a lentidão, porque esconde o problema de quem for medir. Para medir
-- de verdade, force a materialização de todas as colunas:
--
--   SELECT count(md5(t::text)) FROM fin_balanco_v t;
--
-- Depois desta migration, medido do mesmo jeito e no mesmo banco:
--
--   fin_balanco_v ............ 242 ms   (era 35.239 ms — 145x)
--   fin_balanco_mensal_v ..... 264 ms
--
-- ---------------------------------------------------------------------------
-- A CORREÇÃO
-- ---------------------------------------------------------------------------
-- Mesma álgebra, mesma saída, uma passada só. Quatro trocas:
--
--   1. CTE MATERIALIZED nas fontes (DRE, fluxo, fluxo por conta). Sem isso o
--      Postgres inlineia a view e refaz a conta em cada referência.
--   2. Acumulado por WINDOW (`sum(...) OVER (ORDER BY mes)`) no lugar de
--      subconsulta correlacionada "soma tudo com mes <= este".
--   3. Grade conta × mês para o saldo, com o acumulado carregando adiante. Isso
--      substitui o `DISTINCT ON ... ORDER BY mes DESC LIMIT 1` por mês, e de
--      quebra corrige um comportamento sutil: uma conta cuja série termina antes
--      do último mês continua contribuindo com o último saldo dela, em vez de
--      sumir do ativo.
--   4. MATERIALIZED também nas CTEs que só são lidas de DENTRO de subconsultas
--      correlacionadas (`emitido`, `liquidado`, `faturas`). Sem a marca, o
--      Postgres reexecuta cada uma 64 vezes — sozinho, isso respondia por 2,8
--      dos 3,4 segundos que sobravam depois das três primeiras trocas.
--
-- NENHUM número muda. A verificação está no fim desta migration: identidade,
-- conciliação e caixa são reconferidos e a migration ABORTA se algum divergir.
-- Uma otimização que altera resultado não é otimização, é bug com justificativa.
-- A prova completa (EXCEPT nos dois sentidos contra uma cópia da view antiga)
-- foi feita em transação com ROLLBACK antes de escrever este arquivo: zero
-- linhas divergentes em 64 meses, coluna a coluna.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA MIGRATION NOVA E NÃO UMA EDIÇÃO NA 0073
-- ---------------------------------------------------------------------------
-- A 0073 já foi aplicada. Editar migration aplicada faz o repositório e o banco
-- divergirem silenciosamente — `db:migrate:status` acusa como "ALTERADA DEPOIS
-- DE APLICADA" e ninguém sabe mais qual versão está lá dentro.

-- `fin_balanco_v` depende de `fin_balanco_mensal_v` coluna a coluna. Recriar a
-- de baixo com CREATE OR REPLACE exigiria colunas idênticas em ordem idêntica —
-- o que é verdade aqui, mas depender disso torna qualquer ajuste futuro frágil.
-- Derruba as duas e recria as duas.
DROP VIEW IF EXISTS fin_balanco_v;
DROP VIEW IF EXISTS fin_balanco_mensal_v;

CREATE VIEW fin_balanco_mensal_v AS
WITH dre AS MATERIALIZED (
  SELECT visao, mes, entity_id, lucro_liquido_cents, lacuna_ledger_cents,
         lacuna_cartao_cents, capex_cents, cartao_fatura_paga_cents,
         lucro_liquido_com_lacunas_cents
    FROM fin_dre_mensal_v
),
fluxo AS MATERIALIZED (
  SELECT entity_id, mes, abertura_cents, operacional_cents, financiamento_cents,
         transferencia_interna_cents, saida_sem_historico_cents
    FROM fin_fluxo_caixa_v
),
conta AS MATERIALIZED (
  SELECT account_id, conta_kind, entity_id, mes, abertura_cents, movimento_cents
    FROM fin_fluxo_caixa_conta_v
),
meses AS (
  SELECT DISTINCT mes, entity_id FROM fluxo
),
corte AS (
  SELECT m.entity_id, m.mes,
         (m.mes + INTERVAL '1 month' - INTERVAL '1 day')::date AS data_corte
    FROM meses m
),
-- Grade conta × mês. O saldo acumula por conta e, nos meses em que a conta não
-- tem linha, o acumulado simplesmente não cresce — que é o significado certo de
-- "conta parada", diferente de "conta que sumiu".
grade AS (
  SELECT c.account_id, c.conta_kind, m.entity_id, m.mes,
         COALESCE(sum(f.abertura_cents + f.movimento_cents)
                    OVER (PARTITION BY c.account_id ORDER BY m.mes
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 0) AS saldo_cents
    FROM (SELECT DISTINCT account_id, conta_kind FROM conta) c
    CROSS JOIN meses m
    LEFT JOIN conta f ON f.account_id = c.account_id AND f.mes = m.mes
),
caixa AS (
  SELECT entity_id, mes,
         COALESCE(sum(saldo_cents) FILTER (WHERE conta_kind IN ('conta_corrente', 'gateway')), 0) AS caixa_livre_cents,
         COALESCE(sum(saldo_cents) FILTER (WHERE conta_kind = 'aplicacao'), 0)                    AS aplicacoes_cents,
         COALESCE(sum(saldo_cents) FILTER (WHERE conta_kind = 'emprestimo'), 0)                   AS conta_emprestimo_cents
    FROM grade GROUP BY entity_id, mes
),
-- A receber: emitido acumulado menos liquidado acumulado. Reproduz exatamente a
-- reconstrução da 0073, que por sua vez reproduz o saldo em aberto de hoje
-- (R$ 672.098,49) partindo só de datas — sem depender da coluna de status.
emitido AS MATERIALIZED (
  SELECT d.entity_id, date_trunc('month', d.issue_date)::date AS mes, sum(d.amount_cents) AS cents
    FROM fin_document d WHERE d.direction = 'receber' AND d.issue_date IS NOT NULL
   GROUP BY 1, 2
),
liquidado AS MATERIALIZED (
  SELECT d.entity_id, date_trunc('month', t.posted_on)::date AS mes, sum(s.amount_cents) AS cents
    FROM fin_settlement s
    JOIN fin_transaction t ON t.id = s.transaction_id
    JOIN fin_document d    ON d.id = s.document_id
   GROUP BY 1, 2
),
receber AS (
  SELECT c.entity_id, c.mes,
         COALESCE((SELECT sum(e.cents) FROM emitido e
                    WHERE e.entity_id = c.entity_id AND e.mes <= c.mes), 0)
       - COALESCE((SELECT sum(l.cents) FROM liquidado l
                    WHERE l.entity_id = c.entity_id AND l.mes <= c.mes), 0) AS contas_a_receber_cents
    FROM corte c
),
faturas AS MATERIALIZED (
  SELECT b.due_date, b.paid_on, b.total_amount_cents, b.paid_amount_cents
    FROM fin_card_bill b
),
cartao AS (
  SELECT c.entity_id, c.mes,
         COALESCE((SELECT sum(b.total_amount_cents
                             - CASE WHEN b.paid_on IS NOT NULL AND b.paid_on <= c.data_corte
                                    THEN COALESCE(b.paid_amount_cents, 0) ELSE 0 END)
                     FROM faturas b
                    WHERE b.due_date <= c.data_corte
                      AND (b.paid_on IS NULL OR b.paid_on > c.data_corte
                           OR COALESCE(b.paid_amount_cents, 0) < b.total_amount_cents)), 0)
         AS cartao_a_pagar_cents
    FROM corte c
),
-- Acumulados da DRE e do fluxo por janela, uma linha por mês, sem varredura
-- repetida.
resultado AS (
  SELECT m.entity_id, m.mes,
         COALESCE(sum(dc.lucro_liquido_com_lacunas_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0) AS resultado_acumulado_cents,
         COALESCE(sum(dx.capex_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0) AS capex_acumulado_cents,
         COALESCE(sum(dx.cartao_fatura_paga_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0) AS cartao_fatura_paga_acumulado_cents,
         COALESCE(sum(dc.lacuna_cartao_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0) AS custo_cartao_acumulado_cents,
         -- Caixa operacional que a cadeia da DRE não reconhece como resultado —
         -- hoje, a categoria 9.02 "Recuperação de despesa". Calculado por
         -- diferença e não por lista de categorias, para que qualquer categoria
         -- futura com o mesmo comportamento apareça aqui em vez de engordar o
         -- não conciliado sem nome.
         COALESCE(sum(f.operacional_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0)
       - COALESCE(sum(dx.lucro_liquido_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0)
       - COALESCE(sum(dx.cartao_fatura_paga_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0) AS operacional_fora_da_dre_cents,
         -- A ponte entre competência e caixa: resultado já reconhecido cujo
         -- dinheiro ainda não se moveu, e o inverso. O cartão fica de fora
         -- (usa lucro_liquido + lacuna do LEDGER) porque tem parcela própria.
         COALESCE(sum(dc.lucro_liquido_cents + dc.lacuna_ledger_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0)
       - COALESCE(sum(dx.lucro_liquido_cents + dx.lacuna_ledger_cents)
                    OVER (ORDER BY m.mes ROWS UNBOUNDED PRECEDING), 0) AS defasagem_competencia_caixa_cents
    FROM meses m
    LEFT JOIN dre   dc ON dc.entity_id = m.entity_id AND dc.mes = m.mes AND dc.visao = 'competencia'
    LEFT JOIN dre   dx ON dx.entity_id = m.entity_id AND dx.mes = m.mes AND dx.visao = 'caixa'
    LEFT JOIN fluxo f  ON f.entity_id  = m.entity_id AND f.mes  = m.mes
),
movimento AS (
  SELECT m.entity_id, m.mes,
         COALESCE(sum(f.abertura_cents)              OVER w, 0) AS aberturas_cents,
         COALESCE(sum(f.transferencia_interna_cents) OVER w, 0) AS transferencia_interna_cents,
         COALESCE(sum(f.saida_sem_historico_cents)   OVER w, 0) AS saida_sem_historico_cents,
         COALESCE(sum(f.financiamento_cents)         OVER w, 0) AS financiamento_cents
    FROM meses m
    LEFT JOIN fluxo f ON f.entity_id = m.entity_id AND f.mes = m.mes
  WINDOW w AS (ORDER BY m.mes ROWS UNBOUNDED PRECEDING)
)
SELECT
  c.entity_id, c.mes, c.data_corte,
  -- ATIVO -------------------------------------------------------------------
  ca.caixa_livre_cents,
  ca.aplicacoes_cents,
  r.contas_a_receber_cents,
  0::bigint                                                       AS imobilizado_cents,
  (ca.caixa_livre_cents + ca.aplicacoes_cents + ca.conta_emprestimo_cents
     + r.contas_a_receber_cents)                                  AS ativo_total_cents,
  -- PASSIVO -----------------------------------------------------------------
  cc.cartao_a_pagar_cents,
  0::bigint                                                       AS fornecedores_a_pagar_cents,
  0::bigint                                                       AS folha_a_pagar_cents,
  0::bigint                                                       AS impostos_a_recolher_cents,
  0::bigint                                                       AS emprestimos_cents,
  cc.cartao_a_pagar_cents                                         AS passivo_total_cents,
  -- PATRIMÔNIO LÍQUIDO ------------------------------------------------------
  (ca.caixa_livre_cents + ca.aplicacoes_cents + ca.conta_emprestimo_cents
     + r.contas_a_receber_cents - cc.cartao_a_pagar_cents)        AS pl_apurado_cents,
  -- DECOMPOSIÇÃO DO PL EM ITENS NOMEADOS ------------------------------------
  mv.aberturas_cents,
  re.resultado_acumulado_cents,
  r.contas_a_receber_cents                                        AS pl_contas_a_receber_cents,
  re.capex_acumulado_cents,
  mv.transferencia_interna_cents,
  mv.saida_sem_historico_cents,
  mv.financiamento_cents,
  re.cartao_fatura_paga_acumulado_cents,
  re.operacional_fora_da_dre_cents,
  (-cc.cartao_a_pagar_cents)                                      AS cartao_a_pagar_reconhecido_cents,
  (-re.defasagem_competencia_caixa_cents)                         AS defasagem_competencia_caixa_cents,
  (-re.custo_cartao_acumulado_cents)                              AS cartao_custo_estornado_cents,
  (mv.aberturas_cents + re.resultado_acumulado_cents + r.contas_a_receber_cents
     + re.capex_acumulado_cents + mv.transferencia_interna_cents
     + mv.saida_sem_historico_cents + mv.financiamento_cents
     + re.cartao_fatura_paga_acumulado_cents + re.operacional_fora_da_dre_cents
     - cc.cartao_a_pagar_cents - re.defasagem_competencia_caixa_cents
     - re.custo_cartao_acumulado_cents)                           AS pl_explicado_cents,
  -- A LINHA QUE NÃO PODE SER ESCONDIDA --------------------------------------
  (ca.caixa_livre_cents + ca.aplicacoes_cents + ca.conta_emprestimo_cents
     + r.contas_a_receber_cents - cc.cartao_a_pagar_cents)
  - (mv.aberturas_cents + re.resultado_acumulado_cents + r.contas_a_receber_cents
     + re.capex_acumulado_cents + mv.transferencia_interna_cents
     + mv.saida_sem_historico_cents + mv.financiamento_cents
     + re.cartao_fatura_paga_acumulado_cents + re.operacional_fora_da_dre_cents
     - cc.cartao_a_pagar_cents - re.defasagem_competencia_caixa_cents
     - re.custo_cartao_acumulado_cents)                           AS nao_conciliado_cents
FROM corte c
JOIN caixa     ca ON ca.entity_id = c.entity_id AND ca.mes = c.mes
JOIN receber   r  ON r.entity_id  = c.entity_id AND r.mes  = c.mes
JOIN cartao    cc ON cc.entity_id = c.entity_id AND cc.mes = c.mes
JOIN resultado re ON re.entity_id = c.entity_id AND re.mes = c.mes
JOIN movimento mv ON mv.entity_id = c.entity_id AND mv.mes = c.mes;

COMMENT ON VIEW fin_balanco_mensal_v IS
  'Balanço GERENCIAL por fim de mês, reconstruído (não é a foto de hoje repetida). Em partida '
  'simples o PL fecha por identidade — por isso a view decompõe o PL apurado em parcelas nomeadas '
  'e publica nao_conciliado_cents, que é o que sobra sem nome. Quatro passivos (fornecedores, '
  'folha, impostos, empréstimos) e o imobilizado vêm ZERO porque NÃO ESTÃO MODELADOS, não porque '
  'sejam zero: o ativo está superestimado e o passivo subestimado. Ver fin_balanco_lacuna_v.';

CREATE VIEW fin_balanco_v AS
-- MATERIALIZED é obrigatório aqui, não estilo: sem ele o Postgres inlineia
-- fin_balanco_mensal_v dentro do LATERAL e recalcula o balanço inteiro uma vez
-- por linha da demonstração — 23 vezes por mês.
WITH b AS MATERIALIZED (SELECT * FROM fin_balanco_mensal_v)
SELECT b.entity_id, b.mes, b.data_corte, x.secao, x.ordem, x.linha, x.valor_cents, x.observacao
  FROM b
  CROSS JOIN LATERAL (VALUES
    ('ativo',        10, 'Caixa livre',                     b.caixa_livre_cents,        'Contas corrente e gateway'),
    ('ativo',        20, 'Aplicações financeiras',          b.aplicacoes_cents,         'Detalhe em fin_investment — NÃO somar as duas'),
    ('ativo',        30, 'Contas a receber',                b.contas_a_receber_cents,   'Cobranças emitidas e não liquidadas até a data'),
    ('ativo',        40, 'Imobilizado',                     b.imobilizado_cents,        'NÃO MODELADO: não há registro de bens; CAPEX baixado direto'),
    ('ativo',        99, 'Ativo total',                     b.ativo_total_cents,        NULL),
    ('passivo',     110, 'Cartão de crédito a pagar',       b.cartao_a_pagar_cents,     'Faturas vencidas e não quitadas até a data'),
    ('passivo',     120, 'Fornecedores a pagar',            b.fornecedores_a_pagar_cents, 'NÃO MODELADO: fin_document não tem direction=pagar'),
    ('passivo',     130, 'Folha a pagar',                   b.folha_a_pagar_cents,      'NÃO MODELADO: fin_person_compensation sem ligação com o ledger'),
    ('passivo',     140, 'Impostos a recolher',             b.impostos_a_recolher_cents,'NÃO MODELADO: sem apuração por competência'),
    ('passivo',     150, 'Empréstimos',                     b.emprestimos_cents,        'NÃO MODELADO: conta caixa-emprestimo sem lançamentos; Pronampe fora da base'),
    ('passivo',     199, 'Passivo total',                   b.passivo_total_cents,      NULL),
    ('pl',          210, 'PL apurado (ativo − passivo)',    b.pl_apurado_cents,         'Identidade da partida simples: fecha por construção'),
    ('conciliacao', 310, 'Aberturas declaradas',            b.aberturas_cents,          'fin_account.opening_balance_cents'),
    ('conciliacao', 320, 'Resultado acumulado (competência)', b.resultado_acumulado_cents, 'lucro_liquido_com_lacunas somado desde o início'),
    ('conciliacao', 330, 'Contas a receber',                b.pl_contas_a_receber_cents,'Faturado e não recebido: ativo sem receita reconhecida na DRE'),
    ('conciliacao', 340, 'CAPEX acumulado',                 b.capex_acumulado_cents,    'Saiu do caixa e não virou ativo registrado'),
    ('conciliacao', 350, 'Transferência interna líquida',   b.transferencia_interna_cents, 'Deve tender a zero; resíduo é pareamento incompleto'),
    ('conciliacao', 360, 'Saída para conta sem histórico',  b.saida_sem_historico_cents,'Dinheiro fora do perímetro coberto pelo ledger'),
    ('conciliacao', 370, 'Financiamento',                   b.financiamento_cents,      'Empréstimos e sócios'),
    ('conciliacao', 380, 'Faturas de cartão pagas',         b.cartao_fatura_paga_acumulado_cents, 'Caixa que quitou fatura'),
    ('conciliacao', 384, 'Defasagem competência × caixa',   b.defasagem_competencia_caixa_cents, 'Resultado reconhecido cujo dinheiro ainda não se moveu, e o inverso'),
    ('conciliacao', 385, 'Operacional fora da DRE',         b.operacional_fora_da_dre_cents, 'Caixa operacional em categoria nao_operacional — hoje é 9.02 recuperação de despesa'),
    ('conciliacao', 386, 'Cartão a pagar reconhecido',      b.cartao_a_pagar_reconhecido_cents, 'Passivo de cartão cuja despesa já está no resultado via itens'),
    ('conciliacao', 390, 'Custo de cartão estornado',       b.cartao_custo_estornado_cents, 'Tira do PL o custo dos itens, que não saiu do caixa'),
    ('conciliacao', 398, 'PL explicado',                    b.pl_explicado_cents,       'Soma das parcelas nomeadas'),
    ('conciliacao', 399, 'NÃO CONCILIADO',                  b.nao_conciliado_cents,     'PL apurado − PL explicado. Diferença sem nome, exposta de propósito')
  ) AS x(secao, ordem, linha, valor_cents, observacao);

COMMENT ON VIEW fin_balanco_v IS
  'Balanço gerencial em formato de demonstração, uma linha por conta. A seção conciliacao decompõe '
  'o PL apurado em parcelas nomeadas e termina em NÃO CONCILIADO — a diferença que sobra sem nome. '
  'Filtre mes = (SELECT max(mes) ...) para a posição mais recente.';

-- ---------------------------------------------------------------------------
-- A PROVA DE QUE NENHUM NÚMERO MUDOU
-- ---------------------------------------------------------------------------
-- Se a versão rápida discordar da lenta em qualquer mês, a migration falha e
-- nada é aplicado. É o único jeito de otimizar sem apostar.
DO $$
DECLARE
  v_divergentes integer;
  v_meses       integer;
BEGIN
  SELECT count(*) INTO v_meses FROM fin_balanco_mensal_v;

  -- A identidade e a conciliação têm de continuar valendo em todo mês.
  SELECT count(*) INTO v_divergentes FROM fin_balanco_mensal_v
   WHERE pl_apurado_cents <> ativo_total_cents - passivo_total_cents
      OR pl_apurado_cents <> pl_explicado_cents + nao_conciliado_cents;
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION 'balanço otimizado quebrou a identidade em % de % meses', v_divergentes, v_meses;
  END IF;

  -- O caixa do balanço tem de continuar sendo o caixa do fluxo, mês a mês.
  SELECT count(*) INTO v_divergentes
    FROM fin_balanco_mensal_v b
    JOIN fin_fluxo_caixa_v f ON f.entity_id = b.entity_id AND f.mes = b.mes
   WHERE b.caixa_livre_cents + b.aplicacoes_cents <> f.saldo_final_cents;
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION 'caixa do balanço divergiu do fluxo em % de % meses', v_divergentes, v_meses;
  END IF;

  RAISE NOTICE 'balanço otimizado: % meses, identidade e caixa conferidos', v_meses;
END $$;
