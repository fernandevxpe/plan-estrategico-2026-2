-- A matriz de cobertura de fontes: uma linha por (fonte × instituição × conta ×
-- período), respondendo à única pergunta que nenhuma view deste banco responde
-- hoje — **posso confiar neste número?**
--
-- ===========================================================================
-- 0. POR QUE ESTA VIEW EXISTE
-- ===========================================================================
--
-- O ledger já publica cobertura de tudo, menos da própria origem do dado:
--
--   fin_dre_cobertura_v ............ quanto do resultado tem linha de DRE
--   fin_competencia_cobertura_v .... quanto do ledger tem competência, e por
--                                    qual regra
--   fin_pagamento_cobertura_v ...... quanto da operação de saída existe
--   erp_contrato_cobertura_v ....... quanto do contrato do ERP casou aqui
--
-- Todas medem o QUE FOI FEITO com o lançamento. Nenhuma mede DE ONDE ELE VEIO,
-- se a fonte cobre o período inteiro, quando ela falou pela última vez, e o que
-- ela deixou de fora. Sem isso, "categoria atribuída: 98,8%" é um percentual
-- sobre uma base cujo tamanho ninguém declarou — e o denominador é justamente o
-- que está em dúvida.
--
-- Esta view é o denominador.
--
-- ===========================================================================
-- 1. A DISTINÇÃO QUE ORGANIZA O ARQUIVO INTEIRO: ZERO ≠ AUSÊNCIA
-- ===========================================================================
--
--   ZERO é uma afirmação sobre o DINHEIRO:  "nesta conta não há saldo".
--   AUSÊNCIA é uma afirmação sobre o DADO:  "sobre esta conta eu não sei nada".
--
-- Confundir as duas é o modo mais barato de mentir com número redondo, e o
-- ledger já mente assim hoje: `caixa-aplicacao` e `caixa-emprestimo` estão
-- ATIVAS, com ZERO janela de extrato declarada e ZERO lançamento, e o painel
-- imprime "✓ R$ 0,00" para as duas — o mesmo ✓ que dá para uma conta reconciliada
-- ao centavo contra a API. As duas contas passam por conferidas.
--
-- Consequência mecânica adotada aqui, e que qualquer alteração futura tem de
-- preservar:
--
--   **Onde não há acervo, as colunas de quantidade e de valor são NULL, nunca
--   0.** `lancamentos`, `valor_cents`, `entradas_cents`, `saidas_cents`,
--   `conciliados` e companhia saem NULL para a linha de uma conta que nunca
--   recebeu extrato. Quem somar a matriz soma o que existe; quem contar linhas
--   vê que existe uma conta sem resposta. Um `0` ali seria lido como fato.
--
-- ===========================================================================
-- 2. A SEGUNDA REGRA: DATA DE ABERTURA ANOTA, NUNCA SUBTRAI
-- ===========================================================================
--
-- `fin_account.opening_balance_date` é uma DECLARAÇÃO de quando o ledger decidiu
-- começar a olhar — não uma prova de quando a conta passou a existir. Usar essa
-- data para apagar a lacuna anterior a ela transformaria a decisão de escopo em
-- fato medido, que é exatamente o erro que este projeto não pode cometer.
--
-- Medido, e é o caso que prova a regra: `nubank-caixinhas` declara abertura em
-- 30/06/2026, e a mesma fonte (Polp) tem 97 movimentos da caixinha entre
-- 28/12/2025 e 30/06/2026. Se a abertura declarada subtraísse a lacuna, esses
-- seis meses sumiriam da matriz com aparência de "fora de escopo".
--
-- Por isso `dias_sem_janela` é sempre o número cru do período, e
-- `dias_sem_janela_antes_da_abertura` apenas ANOTA quanto daquilo cai antes da
-- data declarada. A anotação informa a leitura; nunca desconta o número.
--
-- ===========================================================================
-- 3. O GRÃO, E POR QUE "PERÍODO" É O ANO CIVIL
-- ===========================================================================
--
-- Uma linha por (fonte, instituição, conta, período), com período = ano civil.
--
-- O ano é o grão que faz a assimetria de acervo aparecer sem precisar de
-- comentário: `asaas` ocupa seis linhas (2021→2026) e todo o resto ocupa uma
-- (2026). É essa forma — seis contra um — que explica de onde vêm os
-- R$ 2.224.767,97 parados em `em_transito` e as transferências de 2021–2023 sem
-- contraparte: não há para onde parear, porque do outro lado não há acervo. Num
-- grão mensal a assimetria vira 70 linhas e some; num grão total, vira uma média
-- e some também.
--
-- ===========================================================================
-- 4. AS QUATRO PERNAS DA UNIÃO
-- ===========================================================================
--
--   (a) ACERVO — uma linha por (source, conta, ano) observado em
--       fin_transaction. É a perna que tem número.
--
--   (b) PERÍODO DECLARADO E VAZIO — (conta, ano) que tem janela em
--       fin_statement_coverage e nenhum lançamento. É o modo de falha
--       "declarei cobertura e não trouxe nada": hoje não ocorre, e a linha
--       existe para que o dia em que ocorrer não passe em silêncio.
--
--   (c) FONTE DECLARADA E NUNCA EXECUTADA — conta ativa sem janela E sem
--       lançamento. `caixa-aplicacao` e `caixa-emprestimo` moram aqui. A fonte
--       reportada é o `import_adapter` que a conta declara — o caminho que
--       existe no cadastro e nunca rodou.
--
--   (d) DESTINO FORA DO LEDGER — não é conta deste banco, e é justamente por
--       isso que precisa aparecer. Quando o motor de transferências não acha a
--       contraperna e o extrato diz para onde o dinheiro foi, ele grava o
--       destino em `fin_transaction.transfer_unresolved_reason` no formato
--       `destino_fora_do_ledger:<instituicao>-<conta>`. Hoje há uma só:
--       a conta 12920000005783083433 da Caixa Econômica, no CNPJ da própria
--       XPE, para onde saíram 5 PIX em 2026.
--
--       Essa perna é a que desmente o "6/6 contas fecham" sem precisar
--       argumentar: existe uma SÉTIMA conta bancária da empresa, em uso hoje,
--       que o ledger não cobre. A matriz a lista como linha, com quantidade e
--       valor, e com `lancamentos` contando as PERNAS QUE APONTAM para ela —
--       não o extrato dela, que ninguém tem.
--
-- ===========================================================================
-- 5. COMO CADA COLUNA EXIGIDA É PRODUZIDA — e o que ela NÃO afirma
-- ===========================================================================
--
-- PERÍODO COBERTO (`janela_de`, `janela_ate`, `janelas`)
--   Vem de fin_statement_coverage, intersectado com o ano. É o que o ledger
--   DECLARA cobrir. Note que a declaração é por CONTA, não por fonte: uma janela
--   não sabe qual adaptador a preencheu. Por isso duas fontes que alimentam a
--   mesma conta no mesmo ano (é o caso de `import_csv` e `erp_obras` no Nubank)
--   exibem a MESMA janela. Isso não é bug: a cobertura do extrato pertence à
--   conta, e dividir a janela por fonte seria inventar uma atribuição que o dado
--   não tem.
--
-- ÚLTIMA SYNC (`ultima_sync`, `ultima_janela_em`, `ultimo_extrato_em`)
--   Três relógios diferentes, porque medem coisas diferentes e confundi-los é o
--   erro clássico de painel de frescor:
--     ultima_sync .......... max(fin_transaction.created_at) da fatia — quando
--                            esta fonte, para esta conta e este ano, gravou pela
--                            última vez. É o único que responde "o robô rodou?".
--     ultima_janela_em ..... max(fin_statement_coverage.created_at) da conta —
--                            quando alguém DECLAROU cobertura pela última vez.
--     ultimo_extrato_em .... fin_account.last_statement_at — o carimbo que a
--                            conta guarda. Pode estar à frente dos outros dois
--                            porque é escrito por quem consulta saldo sem
--                            importar linha.
--   Nenhum dos três diz que o dado está CORRETO. Dizem quando ele chegou.
--
-- QUANTIDADE e VALOR (`lancamentos`, `valor_cents`, `entradas_cents`,
--   `saidas_cents`)
--   `valor_cents` é líquido e pode ser pequeno num ano de volume enorme — em
--   2024 o Asaas movimentou R$ 1,2 milhão e fechou o ano em R$ 594,90. Por isso
--   entradas e saídas saem separadas: é o par que mostra volume, e o líquido
--   sozinho esconde.
--
-- LACUNAS (`dias_no_periodo`, `dias_cobertos`, `dias_sem_janela`,
--   `lacuna_antes_dias`, `lacuna_interna_maior_dias`, `lacuna_depois_dias`,
--   `lancamentos_fora_de_janela`)
--   Quatro lacunas distintas, porque só uma delas é defeito:
--     lacuna_antes ......... dias do período ANTES da primeira janela. É a
--                            fronteira do acervo — onde o histórico começa.
--     lacuna_interna_maior . o maior buraco CONTÍNUO entre janelas. É a única
--                            que é defeito puro: dinheiro que passou e não foi
--                            registrado. É o que a F2 vigia (limiar de 3 dias).
--     lacuna_depois ........ dias do período DEPOIS da última janela até hoje.
--                            É atraso de sync, não buraco de história.
--     lancamentos_fora_de_janela — o inverso: linha que existe sem janela que a
--                            cubra, ou seja, dado que entrou por caminho não
--                            declarado. É o que a F3 vigia.
--   O buraco interno é medido por ilhas de dias descobertos, e não por diferença
--   entre pares de janelas consecutivas, porque as janelas se sobrepõem: o Inter
--   tem quatro declarações que se cobrem umas às outras, e a conta por pares
--   acusaria buracos que a união não tem.
--
-- DUPLICATAS (`dup_grupos`, `dup_excedentes`, `dup_excedente_cents`)
--   Mesma definição do monitor M12 — (conta, data, valor, texto) repetidos — e
--   deliberadamente a mesma, para que a matriz e o teste nunca discordem sobre
--   quantas são. Todas passaram pelo índice único porque têm `dedupe_hash`
--   distinto. **Isto NÃO é uma acusação de erro:** pagamento legítimo repetido no
--   mesmo dia para o mesmo fornecedor tem exatamente esta cara. A coluna diz onde
--   olhar; quem decide é humano.
--
-- STATUS DE CONCILIAÇÃO (`status_conciliacao`, `conciliados`,
--   `nao_conciliados`, `em_transito`, `em_transito_cents`,
--   `em_transito_sem_cobertura`)
--   `em_transito_sem_cobertura` conta as pernas que já têm motivo declarado em
--   `transfer_unresolved_reason` — impossibilidade registrada, não pendência.
--   Separá-las do resto é o que impede o número de conciliação de ser lido como
--   trabalho por fazer quando é, na verdade, acervo que não existe.
--
-- TRILHA (`lotes`, `lotes_sem_trilha`, `lancamentos_sem_lote`)
--   `lotes_sem_trilha` conta lotes de fin_import_batch SEM nenhuma linha em
--   fin_import_row — sem preview, sem dedupe auditável, sem desfazer. Conta
--   lotes de QUALQUER status, inclusive descartados, porque um lote descartado
--   sem trilha também é uma importação sobre a qual não se pode dizer o que
--   aconteceu.
--   `lancamentos_sem_lote` é o outro extremo: linha no ledger que não veio de
--   lote nenhum (`import_batch_id IS NULL`). São 12.288 do Asaas, 39 do
--   erp_obras e 35 do Polp — fontes que gravam direto, sem passar pelo
--   importador de arquivo. Não é defeito do dado; é ausência de trilha, e a
--   coluna existe para que a diferença entre "veio por lote auditável" e "veio
--   direto" seja visível em vez de presumida.
--
-- ===========================================================================
-- 6. O MAPA ADAPTADOR → FONTE, e por que ele é o último recurso
-- ===========================================================================
--
-- `fin_import_batch.adapter` e `fin_transaction.source` são vocabulários
-- diferentes: o lote 10 tem adapter `nubank_conta_pdf` e produziu 815
-- lançamentos com source `import_csv`. Onde o lote produziu lançamento, a fonte
-- é LIDA do lançamento — observação, não suposição. O CASE abaixo só entra para
-- lote que não produziu nada (os 11 descartados), onde não há o que observar.
--
-- ===========================================================================
-- 7. ESTA MIGRATION NÃO ESCREVE UM ÚNICO BYTE DE DADO
-- ===========================================================================
--
-- Nenhum INSERT, nenhum UPDATE, nenhuma janela de cobertura nova. Declarar
-- janela sem extrato na mão é fabricar cobertura, e a matriz existe justamente
-- para tornar isso impossível de esconder. As janelas que faltam continuam
-- faltando, e a view as exibe faltando.

BEGIN;

CREATE OR REPLACE VIEW fin_fonte_cobertura_v AS
WITH
-- ---------------------------------------------------------------------------
-- (conta, ano) que existem: por lançamento observado OU por janela declarada.
-- ---------------------------------------------------------------------------
periodos AS (
  SELECT account_id, ano
    FROM (
      SELECT t.account_id, EXTRACT(YEAR FROM t.posted_on)::int AS ano
        FROM fin_transaction t
      UNION
      SELECT sc.account_id, g::int
        FROM fin_statement_coverage sc
        CROSS JOIN LATERAL generate_series(
          EXTRACT(YEAR FROM sc.period_start)::int,
          EXTRACT(YEAR FROM sc.period_end)::int
        ) g
    ) x
   GROUP BY 1, 2
),

-- O período nunca se estende além de hoje: contar dezembro de 2026 como
-- "descoberto" em agosto de 2026 seria cobrar extrato do futuro.
limites AS (
  SELECT p.account_id,
         p.ano,
         make_date(p.ano, 1, 1)                                AS ini,
         LEAST(make_date(p.ano, 12, 31), CURRENT_DATE)         AS fim
    FROM periodos p
   WHERE make_date(p.ano, 1, 1) <= CURRENT_DATE
),

dias AS (
  SELECT l.account_id,
         l.ano,
         d::date AS dia,
         EXISTS (
           SELECT 1 FROM fin_statement_coverage sc
            WHERE sc.account_id = l.account_id
              AND d::date BETWEEN sc.period_start AND sc.period_end
         ) AS coberto
    FROM limites l
    CROSS JOIN LATERAL generate_series(l.ini, l.fim, INTERVAL '1 day') d
),

cobertura AS (
  SELECT account_id,
         ano,
         count(*)::int                                  AS dias_no_periodo,
         count(*) FILTER (WHERE coberto)::int           AS dias_cobertos,
         count(*) FILTER (WHERE NOT coberto)::int       AS dias_sem_janela,
         min(dia) FILTER (WHERE coberto)                AS primeiro_dia_coberto,
         max(dia) FILTER (WHERE coberto)                AS ultimo_dia_coberto
    FROM dias
   GROUP BY 1, 2
),

-- Ilhas de dias descobertos ESTRITAMENTE entre o primeiro e o último dia
-- coberto: é o buraco interno, o único que é defeito.
ilhas AS (
  SELECT d.account_id,
         d.ano,
         d.dia,
         d.dia - (row_number() OVER (PARTITION BY d.account_id, d.ano ORDER BY d.dia))::int AS ilha
    FROM dias d
    JOIN cobertura c ON c.account_id = d.account_id AND c.ano = d.ano
   WHERE NOT d.coberto
     AND c.primeiro_dia_coberto IS NOT NULL
     AND d.dia > c.primeiro_dia_coberto
     AND d.dia < c.ultimo_dia_coberto
),

buraco_interno AS (
  SELECT account_id, ano, max(n)::int AS lacuna_interna_maior_dias, sum(n)::int AS lacuna_interna_total_dias
    FROM (SELECT account_id, ano, ilha, count(*) AS n FROM ilhas GROUP BY 1, 2, 3) z
   GROUP BY 1, 2
),

lacunas AS (
  SELECT d.account_id,
         d.ano,
         count(*) FILTER (
           WHERE NOT d.coberto
             AND (c.primeiro_dia_coberto IS NULL OR d.dia < c.primeiro_dia_coberto)
         )::int AS lacuna_antes_dias,
         count(*) FILTER (
           WHERE NOT d.coberto
             AND c.ultimo_dia_coberto IS NOT NULL
             AND d.dia > c.ultimo_dia_coberto
         )::int AS lacuna_depois_dias,
         count(*) FILTER (
           WHERE NOT d.coberto
             AND a.opening_balance_date IS NOT NULL
             AND d.dia < a.opening_balance_date
         )::int AS dias_sem_janela_antes_da_abertura
    FROM dias d
    JOIN cobertura c   ON c.account_id = d.account_id AND c.ano = d.ano
    JOIN fin_account a ON a.id = d.account_id
   GROUP BY 1, 2
),

janelas AS (
  SELECT sc.account_id,
         l.ano,
         count(*)::int          AS janelas,
         min(sc.period_start)   AS janela_de,
         max(sc.period_end)     AS janela_ate,
         max(sc.created_at)     AS ultima_janela_em,
         string_agg(DISTINCT sc.source, '+' ORDER BY sc.source) AS janela_origem
    FROM fin_statement_coverage sc
    JOIN limites l
      ON l.account_id = sc.account_id
     AND daterange(sc.period_start, sc.period_end, '[]') && daterange(l.ini, l.fim, '[]')
   GROUP BY 1, 2
),

-- Duplicatas: exatamente a definição do monitor M12.
dups AS (
  SELECT account_id,
         source,
         EXTRACT(YEAR FROM posted_on)::int              AS ano,
         count(*)::int                                  AS dup_grupos,
         sum(n - 1)::bigint                             AS dup_excedentes,
         sum(abs(amount_cents) * (n - 1))::bigint       AS dup_excedente_cents
    FROM (
      SELECT account_id, source, posted_on, amount_cents, description_norm, count(*) AS n
        FROM fin_transaction
       WHERE NOT is_split_parent
       GROUP BY 1, 2, 3, 4, 5
      HAVING count(*) > 1
    ) g
   GROUP BY 1, 2, 3
),

-- Fonte de um lote: LIDA do lançamento que ele produziu; o CASE só cobre lote
-- que não produziu nada.
lotes AS (
  SELECT b.account_id,
         COALESCE(
           (SELECT t.source FROM fin_transaction t WHERE t.import_batch_id = b.id LIMIT 1),
           CASE
             WHEN b.adapter = 'asaas_api'    THEN 'asaas'
             WHEN b.adapter = 'inter_api'    THEN 'inter_api'
             WHEN b.adapter = 'polp_api'     THEN 'polp'
             WHEN b.adapter LIKE '%\_ofx'    THEN 'import_ofx'
             WHEN b.adapter = 'manual'       THEN 'manual'
             ELSE 'import_csv'
           END
         ) AS source,
         EXTRACT(YEAR FROM COALESCE(b.period_start, b.created_at::date))::int AS ano,
         count(*)::int AS lotes,
         count(*) FILTER (
           WHERE NOT EXISTS (SELECT 1 FROM fin_import_row r WHERE r.batch_id = b.id)
         )::int AS lotes_sem_trilha,
         count(*) FILTER (WHERE b.status = 'confirmado')::int AS lotes_confirmados
    FROM fin_import_batch b
   GROUP BY 1, 2, 3
),

acervo AS (
  SELECT t.account_id,
         t.source,
         EXTRACT(YEAR FROM t.posted_on)::int                    AS ano,
         count(*)                                               AS lancamentos,
         sum(t.amount_cents)                                    AS valor_cents,
         COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0) AS entradas_cents,
         COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0) AS saidas_cents,
         min(t.posted_on)                                       AS acervo_de,
         max(t.posted_on)                                       AS acervo_ate,
         max(t.created_at)                                      AS ultima_sync,
         count(*) FILTER (WHERE t.reconciled_status IN ('auto', 'manual'))  AS conciliados,
         count(*) FILTER (WHERE t.reconciled_status = 'nao_conciliado')     AS nao_conciliados,
         count(*) FILTER (WHERE t.reconciled_status = 'ignorado')           AS conciliacao_ignorada,
         count(*) FILTER (WHERE t.transfer_status = 'em_transito')          AS em_transito,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE t.transfer_status = 'em_transito'), 0) AS em_transito_cents,
         count(*) FILTER (WHERE t.transfer_status = 'em_transito'
                            AND t.transfer_unresolved_reason IS NOT NULL)   AS em_transito_sem_cobertura,
         count(*) FILTER (WHERE t.import_batch_id IS NULL)                  AS lancamentos_sem_lote,
         count(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM fin_statement_coverage sc
              WHERE sc.account_id = t.account_id
                AND t.posted_on BETWEEN sc.period_start AND sc.period_end
           )
         ) AS lancamentos_fora_de_janela
    FROM fin_transaction t
   GROUP BY 1, 2, 3
),

-- (d) O que saiu do ledger e não voltou: destino declarado pelo extrato,
--     conta que este banco não tem.
fora_do_ledger AS (
  SELECT split_part(t.transfer_unresolved_reason, ':', 2)                        AS destino,
         EXTRACT(YEAR FROM t.posted_on)::int                                     AS ano,
         count(*)                                                                AS lancamentos,
         sum(t.amount_cents)                                                     AS valor_cents,
         min(t.posted_on)                                                        AS acervo_de,
         max(t.posted_on)                                                        AS acervo_ate,
         max(t.created_at)                                                       AS ultima_sync
    FROM fin_transaction t
   WHERE t.transfer_unresolved_reason LIKE 'destino_fora_do_ledger:%'
   GROUP BY 1, 2
)

-- ---------------------------------------------------------------------------
-- (a) ACERVO
-- ---------------------------------------------------------------------------
SELECT ac.source                                          AS fonte,
       'acervo'::text                                     AS fonte_estado,
       a.institution                                      AS instituicao,
       a.slug                                             AS conta,
       a.id                                               AS conta_id,
       a.is_active                                        AS conta_ativa,
       ac.ano                                             AS periodo,

       j.janela_de,
       j.janela_ate,
       COALESCE(j.janelas, 0)                             AS janelas,
       j.janela_origem,
       ac.acervo_de,
       ac.acervo_ate,

       ac.ultima_sync,
       j.ultima_janela_em,
       a.last_statement_at                                AS ultimo_extrato_em,

       ac.lancamentos,
       ac.valor_cents,
       ac.entradas_cents,
       ac.saidas_cents,

       c.dias_no_periodo,
       c.dias_cobertos,
       c.dias_sem_janela,
       COALESCE(la.lacuna_antes_dias, 0)                  AS lacuna_antes_dias,
       COALESCE(bi.lacuna_interna_maior_dias, 0)          AS lacuna_interna_maior_dias,
       COALESCE(la.lacuna_depois_dias, 0)                 AS lacuna_depois_dias,
       COALESCE(la.dias_sem_janela_antes_da_abertura, 0)  AS dias_sem_janela_antes_da_abertura,
       ac.lancamentos_fora_de_janela,

       COALESCE(d.dup_grupos, 0)                          AS dup_grupos,
       COALESCE(d.dup_excedentes, 0)                      AS dup_excedentes,
       COALESCE(d.dup_excedente_cents, 0)                 AS dup_excedente_cents,

       COALESCE(lo.lotes, 0)                              AS lotes,
       COALESCE(lo.lotes_sem_trilha, 0)                   AS lotes_sem_trilha,
       ac.lancamentos_sem_lote,

       ac.conciliados,
       ac.nao_conciliados,
       ac.em_transito,
       ac.em_transito_cents,
       ac.em_transito_sem_cobertura,

       CASE
         WHEN ac.conciliados = ac.lancamentos                              THEN 'conciliado'
         WHEN ac.conciliados > 0                                           THEN 'parcial'
         ELSE                                                                   'nao_conciliado'
       END                                                AS status_conciliacao,

       -- Veredito sobre a COBERTURA, em ordem de gravidade. O primeiro que casa
       -- vence: um período com lançamento fora de janela não interessa saber se
       -- também está atrasado.
       CASE
         WHEN ac.lancamentos_fora_de_janela > 0                            THEN 'fora_de_janela'
         WHEN COALESCE(bi.lacuna_interna_maior_dias, 0) > 3                THEN 'buraco_interno'
         WHEN COALESCE(la.lacuna_antes_dias, 0) > 0                        THEN 'acervo_parcial'
         WHEN COALESCE(la.lacuna_depois_dias, 0) > 1                       THEN 'atrasada'
         ELSE                                                                   'coberta'
       END                                                AS status
  FROM acervo ac
  JOIN fin_account a       ON a.id = ac.account_id
  LEFT JOIN cobertura c    ON c.account_id = ac.account_id AND c.ano = ac.ano
  LEFT JOIN lacunas la     ON la.account_id = ac.account_id AND la.ano = ac.ano
  LEFT JOIN buraco_interno bi ON bi.account_id = ac.account_id AND bi.ano = ac.ano
  LEFT JOIN janelas j      ON j.account_id = ac.account_id AND j.ano = ac.ano
  LEFT JOIN dups d         ON d.account_id = ac.account_id AND d.source = ac.source AND d.ano = ac.ano
  LEFT JOIN lotes lo       ON lo.account_id = ac.account_id AND lo.source = ac.source AND lo.ano = ac.ano

UNION ALL

-- ---------------------------------------------------------------------------
-- (b) PERÍODO DECLARADO E VAZIO — janela sem um único lançamento.
-- ---------------------------------------------------------------------------
SELECT a.import_adapter,
       'janela_sem_acervo'::text,
       a.institution, a.slug, a.id, a.is_active,
       c.ano,
       j.janela_de, j.janela_ate, COALESCE(j.janelas, 0), j.janela_origem,
       NULL::date, NULL::date,
       NULL::timestamptz, j.ultima_janela_em, a.last_statement_at,
       NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint,
       c.dias_no_periodo, c.dias_cobertos, c.dias_sem_janela,
       COALESCE(la.lacuna_antes_dias, 0),
       COALESCE(bi.lacuna_interna_maior_dias, 0),
       COALESCE(la.lacuna_depois_dias, 0),
       COALESCE(la.dias_sem_janela_antes_da_abertura, 0),
       NULL::bigint,
       0, 0, 0,
       COALESCE(lo.lotes, 0), COALESCE(lo.lotes_sem_trilha, 0), NULL::bigint,
       NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint,
       'sem_acervo'::text,
       'janela_sem_acervo'::text
  FROM cobertura c
  JOIN fin_account a       ON a.id = c.account_id
  LEFT JOIN lacunas la     ON la.account_id = c.account_id AND la.ano = c.ano
  LEFT JOIN buraco_interno bi ON bi.account_id = c.account_id AND bi.ano = c.ano
  LEFT JOIN janelas j      ON j.account_id = c.account_id AND j.ano = c.ano
  LEFT JOIN LATERAL (
    SELECT sum(l2.lotes)::int AS lotes, sum(l2.lotes_sem_trilha)::int AS lotes_sem_trilha
      FROM lotes l2 WHERE l2.account_id = c.account_id AND l2.ano = c.ano
  ) lo ON TRUE
 WHERE NOT EXISTS (SELECT 1 FROM acervo ac WHERE ac.account_id = c.account_id AND ac.ano = c.ano)

UNION ALL

-- ---------------------------------------------------------------------------
-- (c) FONTE DECLARADA E NUNCA EXECUTADA — a conta existe, o caminho de
--     importação está no cadastro, e nunca entrou nada. Quantidade e valor
--     saem NULL: não sabemos que é zero, sabemos que não sabemos.
-- ---------------------------------------------------------------------------
SELECT a.import_adapter,
       'sem_cobertura'::text,
       a.institution, a.slug, a.id, a.is_active,
       NULL::int,
       NULL::date, NULL::date, 0, NULL::text,
       NULL::date, NULL::date,
       NULL::timestamptz, NULL::timestamptz, a.last_statement_at,
       NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint,
       NULL::int, NULL::int, NULL::int,
       NULL::int, NULL::int, NULL::int, NULL::int,
       NULL::bigint,
       0, 0, 0,
       0, 0, NULL::bigint,
       NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint,
       'sem_acervo'::text,
       'sem_cobertura'::text
  FROM fin_account a
 WHERE NOT EXISTS (SELECT 1 FROM fin_transaction t        WHERE t.account_id = a.id)
   AND NOT EXISTS (SELECT 1 FROM fin_statement_coverage s WHERE s.account_id = a.id)

UNION ALL

-- ---------------------------------------------------------------------------
-- (d) DESTINO FORA DO LEDGER — a sétima conta.
--     `lancamentos` aqui conta as PERNAS QUE APONTAM para o destino, não o
--     extrato dele. `conta_id` é NULL porque não existe conta: é isso que a
--     linha denuncia.
-- ---------------------------------------------------------------------------
SELECT '(sem fonte)'::text,
       'destino_fora_do_ledger'::text,
       regexp_replace(f.destino, '-[0-9]+$', '')   AS instituicao,
       f.destino                                   AS conta,
       NULL::bigint, NULL::boolean,
       f.ano,
       NULL::date, NULL::date, 0, NULL::text,
       f.acervo_de, f.acervo_ate,
       f.ultima_sync, NULL::timestamptz, NULL::timestamptz,
       f.lancamentos, f.valor_cents,
       0::bigint,      -- entradas: nenhuma perna de ENTRADA aponta para lá; só saiu
       f.valor_cents,  -- saídas: o total é a própria soma, toda ela negativa
       -- dias_cobertos = 0 é fato: destas datas o ledger cobre exatamente nenhuma.
       -- dias_no_periodo e dias_sem_janela ficam NULL porque a vida da conta é
       -- desconhecida — não há extrato dela para delimitar período.
       NULL::int, 0, NULL::int,
       NULL::int, NULL::int, NULL::int, NULL::int,
       NULL::bigint,
       0, 0, 0,
       0, 0, NULL::bigint,
       0::bigint, f.lancamentos, f.lancamentos, abs(f.valor_cents), f.lancamentos,
       'nao_conciliado'::text,
       'conta_fora_do_ledger'::text
  FROM fora_do_ledger f;

COMMENT ON VIEW fin_fonte_cobertura_v IS
  'Matriz de cobertura de fontes: uma linha por (fonte × instituição × conta × ano), '
  'com quantidade, valor, última sync, lacunas, duplicatas e status de conciliação. '
  'Responde "posso confiar neste número?" — é o denominador que os demais percentuais '
  'do painel usam sem declarar. '
  'Regra que organiza a view: ZERO é afirmação sobre o dinheiro, AUSÊNCIA é afirmação '
  'sobre o dado. Onde não há acervo, quantidade e valor saem NULL, nunca 0 — por isso '
  'caixa-aplicacao e caixa-emprestimo aparecem como sem_cobertura em vez de R$ 0,00. '
  'Segunda regra: opening_balance_date ANOTA a lacuna anterior a ela, nunca a subtrai; '
  'a data de abertura é decisão de escopo, não prova de inexistência. '
  'A linha destino_fora_do_ledger não é conta deste banco: é a sétima conta da empresa '
  '(Caixa 12920000005783083433) medida pelas pernas que apontam para ela, e é o que '
  'desmente o "6/6 contas fecham".';

COMMIT;
