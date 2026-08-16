-- Balanço gerencial e fluxo de caixa — com a diferença na cara, não no ajuste.
--
-- ---------------------------------------------------------------------------
-- O QUE UM LEDGER DE PARTIDA SIMPLES PODE E NÃO PODE AFIRMAR
-- ---------------------------------------------------------------------------
-- Este ledger tem uma perna por lançamento: sai dinheiro da conta, e ponto. Não
-- há débito e crédito, não há plano de contas contábil, não há razão. Isso tem
-- uma consequência que precisa estar escrita antes de qualquer número:
--
--   O BALANÇO FECHA POR CONSTRUÇÃO. Sempre. Inclusive errado.
--
-- Se o PL for definido como "ativo menos passivo", ele fecha por definição, e um
-- balanço que fecha por definição não prova nada. A pergunta que vale é outra:
--
--   O PL apurado é EXPLICADO por itens que sabemos nomear?
--
-- É essa a estrutura aqui. `fin_balanco_v` mostra ativo, passivo, o PL apurado
-- pela identidade, e então DECOMPÕE esse PL em parcelas nomeadas — aberturas
-- declaradas, resultado acumulado, contas a receber, CAPEX, movimentação que
-- saiu do perímetro, cartão. O que sobrar depois de todas elas é a linha
-- `nao_conciliado`, e ela existe justamente para NÃO ser zero quando não for.
--
-- Nenhum "ajuste", nenhum "outros". Se aparecer dinheiro sem nome, ele aparece
-- com esse nome: não conciliado.
--
-- ---------------------------------------------------------------------------
-- O PERÍMETRO DE CAIXA, E POR QUE APLICAÇÃO ESTÁ DENTRO DELE
-- ---------------------------------------------------------------------------
-- Perímetro = as 6 contas de `fin_account`, inclusive `nubank-caixinhas`
-- (aplicação) e `caixa-emprestimo`. Consequências:
--
--   · aplicar e resgatar (9.03) é TRANSFERÊNCIA INTERNA, não investimento. As
--     171 linhas somam +R$ 661,50, que é rendimento, não movimento de capital.
--   · o balanço separa `caixa_livre` de `aplicacoes` porque disponibilidade não
--     é a mesma coisa, mas as duas estão na mesma conciliação de caixa.
--   · `fin_investment` (66 posições, R$ 27.700,17 ativas) é o DETALHE da conta
--     `nubank-caixinhas`, não uma linha a mais. Somar os dois dobra o dinheiro.
--     Conferido em `fin_investment_posicao`: delta zero entre saldo da conta e
--     soma das posições.
--
-- ---------------------------------------------------------------------------
-- A SAÍDA DE R$ 2,34 MILHÕES QUE PRECISA DE LINHA PRÓPRIA
-- ---------------------------------------------------------------------------
-- 252 lançamentos estão como `transfer_status='em_transito'`: transferência
-- para conta própria cuja perna de entrada NÃO existe no ledger. Somam
-- -R$ 2.340.524,71, e a distribuição por ano diz exatamente o que são:
--
--   2022 ..  9 linhas ..   -R$    75.800,00
--   2023 .. 45 linhas ..   -R$   455.830,00
--   2024 .. 45 linhas ..   -R$   589.300,00
--   2025 .. 68 linhas ..   -R$ 1.103.837,97
--   2026 .. 85 linhas ..   -R$   115.756,74
--
-- É o Asaas mandando dinheiro para Nubank e Inter em anos em que o ledger não
-- cobre Nubank nem Inter (ambos começam em 01/2026). O dinheiro saiu do
-- perímetro visível e foi gasto lá fora, sem lançamento.
--
-- Tratá-lo como transferência neutra afirmaria que o dinheiro ainda existe.
-- Tratá-lo como despesa inventaria uma classificação. Ele fica em linha própria,
-- `saida_para_conta_sem_historico`, no fluxo e no balanço. É a maior lacuna
-- desta base e é uma lacuna de COBERTURA, não de classificação: resolvê-la exige
-- importar extrato de 2022–2025 do Nubank e do Inter, que ninguém tem.
--
-- ---------------------------------------------------------------------------
-- FLUXO DE CAIXA: A RECONCILIAÇÃO É O TESTE, NÃO O RELATÓRIO
-- ---------------------------------------------------------------------------
-- Todo lançamento cai em EXATAMENTE um balde. Por construção:
--
--   saldo_inicial + abertura + operacional + investimento + financiamento
--   + transferencia_interna + saida_sem_historico + nao_classificado
--   = saldo_final
--
-- Isso seria tautológico se parasse aí. O que torna o teste real é a checagem
-- externa: `saldo_final` do último mês tem de bater com
-- `fin_account.opening_balance_cents + soma do ledger` E com o snapshot da API
-- em `fin_balance_snapshot`. Sem esse confronto, um fluxo bonito continua sendo
-- um fluxo sobre saldo errado — e o AGENTE_FINANCEIRO é claro: ledger
-- categorizado sobre saldo que não bate vale zero.
--
-- Sobre o cartão, o invariante: pagar fatura é OPERACIONAL, não transferência
-- interna. O cartão não é uma `fin_account` — o dinheiro sai do perímetro de
-- verdade quando a fatura é paga. No ledger essas 8 linhas estão em 9.01
-- (correto para a DRE: fatura não é despesa), e é só aqui, no fluxo, que elas
-- voltam a ser saída operacional.

-- ---------------------------------------------------------------------------
-- 1. FLUXO DE CAIXA POR CONTA E MÊS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_fluxo_caixa_conta_v AS
WITH classificado AS (
  SELECT t.account_id,
         t.entity_id,
         date_trunc('month', t.posted_on)::date AS mes,
         t.amount_cents,
         CASE
           -- Pagamento de fatura: saída real de caixa que liquida custo
           -- operacional já incorrido. Vem ANTES da regra de movimentação, senão
           -- o 9.01 o engoliria e o fluxo diria que a empresa não pagou cartão.
           WHEN cb.id IS NOT NULL                       THEN 'operacional'
           WHEN c.id IS NULL                            THEN 'nao_classificado'
           WHEN c.dre_line = 'investimentos'            THEN 'investimento'
           WHEN c.code IN ('9.04', '9.05')              THEN 'financiamento'
           WHEN c.code = '9.03'                         THEN 'transferencia_interna'
           WHEN c.code = '9.01' AND t.transfer_status = 'em_transito'
                                                        THEN 'saida_sem_historico'
           WHEN c.code = '9.01'                         THEN 'transferencia_interna'
           ELSE 'operacional'
         END AS balde
    FROM fin_transaction t
    LEFT JOIN fin_category c   ON c.id = t.category_id
    LEFT JOIN fin_card_bill cb ON cb.paid_transaction_id = t.id
   WHERE NOT t.is_split_parent
),
meses AS (
  SELECT a.id AS account_id, a.entity_id, m.mes
    FROM fin_account a
    CROSS JOIN LATERAL (
      SELECT generate_series(
               date_trunc('month', LEAST(a.opening_balance_date,
                 COALESCE((SELECT min(posted_on) FROM fin_transaction t WHERE t.account_id = a.id),
                          a.opening_balance_date))),
               date_trunc('month', COALESCE(
                 (SELECT max(posted_on) FROM fin_transaction t WHERE t.account_id = a.id),
                 a.opening_balance_date)),
               INTERVAL '1 month')::date AS mes
    ) m
   WHERE a.opening_balance_date IS NOT NULL
),
agg AS (
  SELECT ms.account_id, ms.entity_id, ms.mes,
    -- A abertura entra como fluxo no mês em que foi declarada. Assim o saldo
    -- inicial do primeiro mês é zero e a série acumula sem exceção especial.
    COALESCE((SELECT a.opening_balance_cents FROM fin_account a
               WHERE a.id = ms.account_id
                 AND date_trunc('month', a.opening_balance_date)::date = ms.mes), 0) AS abertura_cents,
    COALESCE(sum(cl.amount_cents) FILTER (WHERE cl.balde = 'operacional'), 0)           AS operacional_cents,
    COALESCE(sum(cl.amount_cents) FILTER (WHERE cl.balde = 'investimento'), 0)          AS investimento_cents,
    COALESCE(sum(cl.amount_cents) FILTER (WHERE cl.balde = 'financiamento'), 0)         AS financiamento_cents,
    COALESCE(sum(cl.amount_cents) FILTER (WHERE cl.balde = 'transferencia_interna'), 0) AS transferencia_interna_cents,
    COALESCE(sum(cl.amount_cents) FILTER (WHERE cl.balde = 'saida_sem_historico'), 0)   AS saida_sem_historico_cents,
    COALESCE(sum(cl.amount_cents) FILTER (WHERE cl.balde = 'nao_classificado'), 0)      AS nao_classificado_cents,
    COALESCE(sum(cl.amount_cents), 0)                                                   AS movimento_cents,
    count(cl.*)                                                                         AS lancamentos
  FROM meses ms
  LEFT JOIN classificado cl ON cl.account_id = ms.account_id AND cl.mes = ms.mes
  GROUP BY ms.account_id, ms.entity_id, ms.mes
)
SELECT a.account_id, ac.slug AS conta, ac.kind AS conta_kind, a.entity_id, a.mes,
  sum(a.abertura_cents + a.movimento_cents) OVER w
    - (a.abertura_cents + a.movimento_cents)                       AS saldo_inicial_cents,
  a.abertura_cents,
  a.operacional_cents,
  a.investimento_cents,
  a.financiamento_cents,
  a.transferencia_interna_cents,
  a.saida_sem_historico_cents,
  a.nao_classificado_cents,
  a.movimento_cents,
  sum(a.abertura_cents + a.movimento_cents) OVER w                 AS saldo_final_cents,
  a.lancamentos
FROM agg a
JOIN fin_account ac ON ac.id = a.account_id
WINDOW w AS (PARTITION BY a.account_id ORDER BY a.mes ROWS UNBOUNDED PRECEDING);

COMMENT ON VIEW fin_fluxo_caixa_conta_v IS
  'Fluxo de caixa por conta e mês. Todo lançamento cai em exatamente um balde, então '
  'saldo_inicial + abertura + operacional + investimento + financiamento + transferencia_interna '
  '+ saida_sem_historico + nao_classificado = saldo_final, sempre. A verificação que vale é '
  'externa: saldo_final do último mês contra fin_balance_snapshot (API do banco).';

-- ---------------------------------------------------------------------------
-- 2. FLUXO CONSOLIDADO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_fluxo_caixa_v AS
SELECT entity_id, mes,
  sum(saldo_inicial_cents)           AS saldo_inicial_cents,
  sum(abertura_cents)                AS abertura_cents,
  sum(operacional_cents)             AS operacional_cents,
  sum(investimento_cents)            AS investimento_cents,
  sum(financiamento_cents)           AS financiamento_cents,
  -- Consolidado, a transferência interna PAREADA tende a zero: as duas pernas
  -- se cancelam. Resíduo diferente de zero aqui é pareamento incompleto, e é
  -- informação — por isso a coluna não é escondida mesmo quando dá zero.
  sum(transferencia_interna_cents)   AS transferencia_interna_cents,
  sum(saida_sem_historico_cents)     AS saida_sem_historico_cents,
  sum(nao_classificado_cents)        AS nao_classificado_cents,
  sum(movimento_cents)               AS movimento_cents,
  sum(saldo_final_cents)             AS saldo_final_cents,
  sum(lancamentos)                   AS lancamentos,
  -- Prova aritmética embutida: tem de ser zero em toda linha. Uma coluna que
  -- deveria ser sempre zero é mais barata de checar que um teste externo, e
  -- aparece na própria tela em vez de num relatório que ninguém roda.
  sum(saldo_final_cents)
    - sum(saldo_inicial_cents) - sum(abertura_cents) - sum(movimento_cents) AS residuo_cents
FROM fin_fluxo_caixa_conta_v
GROUP BY entity_id, mes;

COMMENT ON VIEW fin_fluxo_caixa_v IS
  'Fluxo de caixa consolidado das 6 contas, por mês. residuo_cents é a prova aritmética e tem de '
  'ser ZERO em toda linha — se não for, um lançamento escapou dos baldes. saida_sem_historico é '
  'dinheiro que saiu do perímetro para contas cujo extrato o ledger não cobre (R$ 2,34 milhões, '
  '99% antes de 2026); não é despesa nem transferência neutra, e por isso tem linha própria.';

-- ---------------------------------------------------------------------------
-- 3. BALANÇO GERENCIAL MENSAL
-- ---------------------------------------------------------------------------
-- Posição no ÚLTIMO DIA de cada mês, reconstruída — não é foto do presente
-- repetida. Os três componentes são reconstruíveis:
--
--   caixa ......... abertura + lançamentos até a data
--   a receber ..... documentos emitidos até a data − liquidações até a data
--                   (conferido: reproduz R$ 672.098,49, o mesmo que a soma dos
--                    status 'emitido' + 'confirmado' de hoje)
--   cartão ........ faturas com vencimento até a data e não pagas até a data
--
-- O que NÃO é reconstruível e por isso não vira linha inventada:
--   fornecedores a pagar ... `fin_document` tem 3.406 linhas e ZERO com
--                            direction='pagar'. Contas a pagar não existem como
--                            modelo. A linha vem 0 e DECLARADA como não modelada.
--   folha a pagar ......... `fin_person_compensation` tem 48 linhas, só de
--                            08/2026, sem ligação com o ledger.
--   impostos a recolher ... não há apuração ligada a competência (ver
--                            fin_apuracao_tributaria_v, que explica por quê).
--   empréstimos ........... a conta `caixa-emprestimo` tem ZERO lançamentos. A
--                            planilha do dono registra um empréstimo Caixa de
--                            R$ 147.062,10 captado em 2024 que este ledger
--                            desconhece inteiro. Passivo real, fora da base.
--   imobilizado ........... não há registro de bens. O CAPEX (8.01 a 8.04) foi
--                            baixado direto no caixa e nunca virou ativo.
--
-- Quatro passivos e um ativo faltando não é detalhe: significa que o ativo está
-- SUPERESTIMADO e o passivo SUBESTIMADO, os dois na direção que faz a empresa
-- parecer mais rica. Está escrito aqui e sai em `fin_balanco_lacuna_v`.
CREATE OR REPLACE VIEW fin_balanco_mensal_v AS
WITH meses AS (
  SELECT DISTINCT mes, entity_id FROM fin_fluxo_caixa_v
),
corte AS (
  SELECT m.entity_id, m.mes,
         (m.mes + INTERVAL '1 month' - INTERVAL '1 day')::date AS data_corte
    FROM meses m
),
caixa AS (
  SELECT c.entity_id, c.mes, c.data_corte,
         COALESCE(sum(f.saldo_final_cents) FILTER (WHERE f.conta_kind IN ('conta_corrente', 'gateway')), 0) AS caixa_livre_cents,
         COALESCE(sum(f.saldo_final_cents) FILTER (WHERE f.conta_kind = 'aplicacao'), 0)                    AS aplicacoes_cents,
         COALESCE(sum(f.saldo_final_cents) FILTER (WHERE f.conta_kind = 'emprestimo'), 0)                   AS conta_emprestimo_cents
    FROM corte c
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (fc.account_id) fc.account_id, fc.conta_kind, fc.saldo_final_cents
        FROM fin_fluxo_caixa_conta_v fc
       WHERE fc.entity_id = c.entity_id AND fc.mes <= c.mes
       ORDER BY fc.account_id, fc.mes DESC
    ) f ON true
   GROUP BY c.entity_id, c.mes, c.data_corte
),
receber AS (
  SELECT c.entity_id, c.mes,
         COALESCE((SELECT sum(d.amount_cents) FROM fin_document d
                    WHERE d.entity_id = c.entity_id AND d.direction = 'receber'
                      AND d.issue_date <= c.data_corte), 0)
       - COALESCE((SELECT sum(s.amount_cents) FROM fin_settlement s
                    JOIN fin_transaction t ON t.id = s.transaction_id
                    JOIN fin_document d2 ON d2.id = s.document_id
                   WHERE d2.entity_id = c.entity_id AND t.posted_on <= c.data_corte), 0)
         AS contas_a_receber_cents
    FROM corte c
),
cartao AS (
  SELECT c.entity_id, c.mes,
         COALESCE((SELECT sum(b.total_amount_cents
                             - CASE WHEN b.paid_on IS NOT NULL AND b.paid_on <= c.data_corte
                                    THEN COALESCE(b.paid_amount_cents, 0) ELSE 0 END)
                     FROM fin_card_bill b
                    WHERE b.due_date <= c.data_corte
                      AND (b.paid_on IS NULL OR b.paid_on > c.data_corte
                           OR COALESCE(b.paid_amount_cents, 0) < b.total_amount_cents)), 0)
         AS cartao_a_pagar_cents
    FROM corte c
),
resultado AS (
  SELECT c.entity_id, c.mes,
         COALESCE((SELECT sum(d.lucro_liquido_com_lacunas_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'competencia' AND d.mes <= c.mes), 0)
           AS resultado_acumulado_cents,
         COALESCE((SELECT sum(d.capex_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'caixa' AND d.mes <= c.mes), 0)
           AS capex_acumulado_cents,
         COALESCE((SELECT sum(d.cartao_fatura_paga_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'caixa' AND d.mes <= c.mes), 0)
           AS cartao_fatura_paga_acumulado_cents,
         COALESCE((SELECT sum(d.lacuna_cartao_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'competencia' AND d.mes <= c.mes), 0)
           AS custo_cartao_acumulado_cents,
         -- A PONTE ENTRE COMPETÊNCIA E CAIXA.
         -- O ativo do balanço é caixa (regime de caixa, por definição — o
         -- dinheiro está lá ou não está). O resultado acumulado acima é de
         -- COMPETÊNCIA. A diferença entre os dois não é erro: é resultado já
         -- reconhecido cujo dinheiro ainda não se moveu, e dinheiro já movido
         -- cujo resultado pertence a outro período.
         -- Sem esta parcela, os meses anteriores acusariam de R$ 60 mil a
         -- R$ 100 mil de "não conciliado" que tem nome e causa conhecidos.
         -- Os itens de cartão ficam FORA daqui (usa lucro_liquido + lacuna do
         -- ledger, não a lacuna do cartão) porque já têm parcela própria logo
         -- abaixo; incluí-los contaria o cartão duas vezes.
         COALESCE((SELECT sum(d.lucro_liquido_cents + d.lacuna_ledger_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'competencia' AND d.mes <= c.mes), 0)
       - COALESCE((SELECT sum(d.lucro_liquido_cents + d.lacuna_ledger_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'caixa' AND d.mes <= c.mes), 0)
           AS defasagem_competencia_caixa_cents,
         -- Caixa operacional que a cadeia da DRE não reconhece como resultado.
         -- O caso concreto: a categoria 9.02 "Recuperação de despesa"
         -- (R$ +7.292,90 em 30 lançamentos) é `movimentacao_financeira` com
         -- dre_line='nao_operacional' — entra no caixa e em nenhuma linha de
         -- resultado. Calculado por diferença, e não por lista de categorias, de
         -- propósito: assim qualquer categoria futura com o mesmo comportamento
         -- aparece aqui em vez de ir engordar o não conciliado sem nome.
         COALESCE((SELECT sum(f.operacional_cents) FROM fin_fluxo_caixa_v f
                    WHERE f.entity_id = c.entity_id AND f.mes <= c.mes), 0)
       - COALESCE((SELECT sum(d.lucro_liquido_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'caixa' AND d.mes <= c.mes), 0)
       - COALESCE((SELECT sum(d.cartao_fatura_paga_cents) FROM fin_dre_mensal_v d
                    WHERE d.entity_id = c.entity_id AND d.visao = 'caixa' AND d.mes <= c.mes), 0)
           AS operacional_fora_da_dre_cents
    FROM corte c
),
movimento AS (
  SELECT c.entity_id, c.mes,
         COALESCE((SELECT sum(f.abertura_cents) FROM fin_fluxo_caixa_v f
                    WHERE f.entity_id = c.entity_id AND f.mes <= c.mes), 0) AS aberturas_cents,
         COALESCE((SELECT sum(f.transferencia_interna_cents) FROM fin_fluxo_caixa_v f
                    WHERE f.entity_id = c.entity_id AND f.mes <= c.mes), 0) AS transferencia_interna_cents,
         COALESCE((SELECT sum(f.saida_sem_historico_cents) FROM fin_fluxo_caixa_v f
                    WHERE f.entity_id = c.entity_id AND f.mes <= c.mes), 0) AS saida_sem_historico_cents,
         COALESCE((SELECT sum(f.financiamento_cents) FROM fin_fluxo_caixa_v f
                    WHERE f.entity_id = c.entity_id AND f.mes <= c.mes), 0) AS financiamento_cents
    FROM corte c
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
  -- Apurado pela identidade. Fecha por construção; o que prova alguma coisa é a
  -- decomposição abaixo.
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
  -- O passivo de cartão reduz o PL apurado (é passivo), e a despesa dele já está
  -- reconhecida no resultado via itens. Sem esta parcela, a fatura em aberto
  -- reapareceria como diferença sem nome — que é exatamente o que a linha
  -- nao_conciliado não deve carregar quando o nome é conhecido.
  (-cc.cartao_a_pagar_cents)                                      AS cartao_a_pagar_reconhecido_cents,
  (-re.defasagem_competencia_caixa_cents)                         AS defasagem_competencia_caixa_cents,
  -- O custo dos itens de cartão já está dentro de resultado_acumulado_cents
  -- (via lucro_liquido_com_lacunas). Mas ele NÃO saiu do caixa — quem saiu foi o
  -- pagamento da fatura. Devolvê-lo com sinal trocado é o que impede contar o
  -- cartão duas vezes; sem esta linha, o não conciliado seria exatamente o
  -- custo do cartão e ninguém saberia por quê.
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

-- ---------------------------------------------------------------------------
-- 4. BALANÇO EM FORMATO DE DEMONSTRAÇÃO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_balanco_v AS
SELECT b.entity_id, b.mes, b.data_corte, x.secao, x.ordem, x.linha, x.valor_cents, x.observacao
  FROM fin_balanco_mensal_v b
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
    ('conciliacao', 385, 'Operacional fora da DRE',         b.operacional_fora_da_dre_cents, 'Caixa operacional em categoria nao_operacional — hoje é 9.02 recuperação de despesa'),
    ('conciliacao', 384, 'Defasagem competência × caixa',   b.defasagem_competencia_caixa_cents, 'Resultado reconhecido cujo dinheiro ainda não se moveu, e o inverso'),
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
-- 5. AS LACUNAS DO BALANÇO, COM TAMANHO E DIREÇÃO DO ERRO
-- ---------------------------------------------------------------------------
-- "Não modelado" sozinho é fácil de ignorar. Com a direção do viés ao lado, não
-- é: cada linha diz se a ausência faz a empresa parecer mais rica ou mais pobre.
CREATE OR REPLACE VIEW fin_balanco_lacuna_v AS
SELECT * FROM (VALUES
  ('imobilizado', 'ativo', 'subestima',
   'CAPEX baixado direto no caixa desde o início do ledger, sem registro de bem nem depreciação.',
   (SELECT COALESCE(sum(capex_cents), 0) FROM fin_dre_mensal_v WHERE visao = 'caixa'),
   'Criar fin_asset com data, valor, vida útil e método. Exige inventário físico — decisão do Fernando.'),
  ('fornecedores_a_pagar', 'passivo', 'superestima',
   'fin_document tem 3.406 linhas e ZERO com direction=pagar. Nenhuma conta a pagar existe como dado.',
   0::bigint,
   'Ingestão de nota de entrada / boleto de fornecedor. Fonte candidata: e-mail e portal da contabilidade.'),
  ('folha_a_pagar', 'passivo', 'superestima',
   'fin_person_compensation tem 48 linhas, todas de 08/2026, sem ligação com lançamento do ledger.',
   0::bigint,
   'Ligar fin_person_compensation ao ledger. Resolve também a competência da folha (hoje convenção).'),
  ('impostos_a_recolher', 'passivo', 'superestima',
   'DAS vence no mês seguinte ao fato gerador; sem apuração por competência não há como provisionar.',
   0::bigint,
   'Depende de fin_apuracao_tributaria_v fechar RBT12 e anexo — hoje bloqueado por janela incompleta.'),
  ('emprestimos', 'passivo', 'superestima',
   'A conta caixa-emprestimo tem ZERO lançamentos. A planilha do dono registra Pronampe de '
   'R$ 147.062,10 captado em 2024, com saldo devedor desconhecido.',
   14706210::bigint,
   'Extrato da conta Caixa e contrato do Pronampe. Bloqueio humano conhecido.'),
  ('saida_sem_historico', 'ativo', 'nenhum',
   'R$ 2,34 milhões saíram do Asaas para Nubank e Inter em 2022–2025, anos que o ledger não cobre. '
   'Já está com linha própria no fluxo e no balanço, não é omissão — é limite de cobertura.',
   (SELECT COALESCE(sum(saida_sem_historico_cents), 0) FROM fin_fluxo_caixa_v),
   'Importar extrato 2022–2025 de Nubank e Inter. Fonte pode não existir mais.')
) AS t(lacuna, lado, vies, motivo, valor_conhecido_cents, caminho);

COMMENT ON VIEW fin_balanco_lacuna_v IS
  'O que falta no balanço gerencial, com o tamanho conhecido e a DIREÇÃO do erro: vies=superestima '
  'significa que a ausência faz a empresa parecer mais rica (passivo faltando). Publicar o balanço '
  'sem esta lista é apresentar um patrimônio que o dado não sustenta.';
