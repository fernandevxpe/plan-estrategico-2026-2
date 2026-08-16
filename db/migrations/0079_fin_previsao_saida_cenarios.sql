-- A previsão passa a ter a metade que faltava: a saída. E passa a poder errar
-- por escrito.
--
-- ===========================================================================
-- 0. O ERRO MEDIDO QUE OBRIGA ESTA MIGRATION
-- ===========================================================================
-- Medido em 16/08/2026, sobre as views que a 0058 e a 0061 deixaram em pé:
--
--   saída REALIZADA por mês em 2026 (fin_transaction, sem transferência):
--     jan 119.936,28 · fev 132.988,90 · mar 175.269,20 · abr 186.318,34
--     mai 177.323,54 · jun 144.202,89 · jul 152.271,84
--     mediana dos 7 meses fechados: R$ 152.271,84/mês
--
--   saída PREVISTA que entrava no saldo, próximos 90 dias:
--     pagar_cartao_parcela      R$   2.573,98   contratado
--     pagar_cartao_ciclo        R$   3.888,61   observado
--     pagar_cartao_estimado     R$  19.927,87   estimado
--     ------------------------------------------------
--     TOTAL                     R$  26.390,46   ≈ R$ 8.796,82/mês
--
-- A previsão de saída cobria **5,8% da saída real**. As 11 recorrentes de
-- despesa que existem somam R$ 14.207,21/mês e TODAS estão em `status
-- 'proposto'` — o CHECK da 0057 as mantém fora do saldo, corretamente, porque
-- ninguém as confirmou. Folha (mediana R$ 86.847,09/mês em 6.x), DAS (mediana
-- R$ 16.195,78/mês em 7.01) e empréstimo não tinham camada nenhuma.
--
-- O efeito prático: `fin_caixa_previsto_dia_v` subia de R$ 119.674,46 até o fim
-- do horizonte sem nunca cair, e o "menor saldo dos próximos 90 dias" era HOJE.
-- A tela que responde "em que dia o caixa aperta" respondia "nunca". Isso é
-- exatamente o erro para cima que o princípio do projeto chama de mais
-- perigoso: **R$ 430.000 de saída ausente no horizonte de 90 dias**.
--
-- Depois desta migration, medido no mesmo dia e no mesmo horizonte:
--     saída prevista que entra no saldo   R$ 327.636,21 em 90 dias
--                                       ≈ R$ 109.212,07/mês  →  71,7% da real
-- Ainda não é 100%, e não deve parecer: o script `prever-caixa.mjs` imprime a
-- cobertura em toda execução, porque uma previsão de saída incompleta é um
-- saldo otimista disfarçado.
--
-- E havia um segundo erro, de outra natureza: DUAS previsões de recebimento
-- discordavam sobre o mesmo dinheiro, nos mesmos 90 dias.
--
--   fin_previsao_evento_v      (0058)   R$ 525.792,95   265 eventos
--   fin_previsao_recebimento_v (0061)   R$ 441.328,76   225 eventos
--   diferença                           R$  84.464,19
--
-- A diferença não é ruído: a 0058 tinha a camada `previsao_contrato` (parcelas
-- do ERP, R$ 144.489,28 no período) que a 0061 não tem, e a 0061 tem
-- `assinatura`/`parcelamento`/`ativo_de_fato` (R$ 60.025,09) que a 0058 não
-- tinha. Duas respostas para "quanto entra" é pior que uma resposta errada,
-- porque a discordância não aparece em nenhuma das duas telas.
--
-- ===========================================================================
-- 1. O QUE ESTA MIGRATION FAZ, E O QUE ELA RECUSA A FAZER
-- ===========================================================================
-- FAZ:
--   a) uma camada de saída por natureza de compromisso, com a mesma disciplina
--      de camada da 0045/0057/0061 — nenhuma soma cega;
--   b) unifica a previsão de recebimento numa fonte só;
--   c) premissas versionadas e três cenários que as consomem;
--   d) o resumo mensal que decide: saldo inicial, entradas, saídas por
--      natureza, saldo final, caixa livre, menor saldo e dia do aperto;
--   e) a aferição: comparar a foto datada com o que aconteceu.
--
-- RECUSA:
--   · Ativar recorrente nenhuma. Ativação é decisão humana e continua sendo —
--     esta migration só dá à camada 'proposto' um lugar declarado no cenário
--     conservador, onde ela conta COMO risco e não como fato.
--   · Escrever em fin_transaction. Nada aqui toca o ledger.
--   · Inventar folha. A folha vem de `fin_folha_previsao_v` (0077).
--
-- ===========================================================================
-- 2. POR QUE CENÁRIO É DADO, E NÃO PARÂMETRO DE FUNÇÃO
-- ===========================================================================
-- A alternativa óbvia seria uma função `prever(cenario text)`. Ela esconde a
-- premissa dentro do corpo: ninguém consegue perguntar ao banco "com que
-- alíquota de DAS a previsão de setembro foi feita" seis meses depois.
--
-- Aqui a premissa é linha de tabela, com janela de medição e motivo. A foto em
-- `fin_cash_forecast` grava o jsonb das premissas usadas. Quando a previsão
-- errar — e vai — dá para separar "a premissa estava errada" de "o mundo
-- mudou", que são consertos diferentes.
--
-- As premissas, todas medidas, nenhuma arbitrada:
--
--   DAS sobre a receita de caixa do mês anterior — 7 razões observadas:
--     dez→jan 8,29% · jan→fev 12,93% · fev→mar 8,90% · mar→abr 11,22%
--     abr→mai 14,78% · mai→jun 8,50% · jun→jul 8,42%
--     base = mediana 8,90% · otimista = mínimo 8,29% · conservador = máximo 14,78%
--
--   Fatura de cartão — mediana das 6 últimas: R$ 8.796,82.
--     base ×1,00 · otimista ×0,85 · conservador ×1,20
--
--   Folha variável — o acréscimo sobre o fixo que a 0077 estima.
--     base ×1,00 · otimista ×0,90 · conservador ×1,15
--
--   Recebimento vencido.
--     base 0% (não entra) · otimista 50% · conservador 0%
--     Manter o base em zero é deliberado: a 0058 já tinha decidido que
--     recebível velho não move saldo, e o cenário otimista existe justamente
--     para que ninguém precise mexer no base para "ver como ficaria".
--
--   Recorrente proposta — R$ 14.207,21/mês em 11 linhas não confirmadas.
--     base não entra · conservador entra · otimista não entra.
--     Note o sentido: incluir despesa não confirmada é CONSERVADOR, porque
--     erra para baixo no saldo. É o inverso do que a intuição sugere.
--
-- ===========================================================================
-- 3. AS CAMADAS DE SAÍDA, E ONDE CADA UMA DOBRARIA
-- ===========================================================================
--   a) `pagar_recorrente` — fin_recurring, direction='pagar'. Já existia na
--      0058. Continua descontando o que já saiu no mês corrente pela mesma
--      chave (contraparte × categoria) que a detecção usou.
--
--   b) `pagar_folha` — fin_folha_previsao_v (0077). A 0077 se absteve de
--      alimentar a previsão de caixa porque "somar as duas dobraria a folha".
--      A abstenção custou caro: as recorrentes 6.x cobrem R$ 4.818,17/mês
--      contra R$ 86.847,09/mês de folha real — 5,5%. A saída não é abster-se,
--      é decidir um dono: quem a folha projeta, a recorrente 6.x não projeta.
--
--      Resolver por STATUS ('folha cobre quem não tem recorrente ATIVA')
--      parece certo e quebra no cenário conservador, onde as propostas passam
--      a entrar: as pessoas com recorrente 6.x proposta seriam contadas duas
--      vezes. A regra escolhida não depende de cenário.
--
--   c) `pagar_tributo_das` — não é recorrente e a 0057 mediu por quê: a
--      dispersão do 7.01 é alta (R$ 11.810,42 a R$ 28.242,61) porque o DAS é
--      proporcional à receita, não fixo. Modelá-lo como recorrente de valor
--      mediano erraria nos dois extremos. Aqui ele é derivado: alíquota da
--      premissa × receita de caixa do mês anterior, em três degraus de base
--      (realizada → prevista → mediana), porque exigir base realizada deixava
--      o DAS sumir do horizonte: medido, 1 evento de R$ 6.572,69 em 90 dias
--      contra os R$ 30.685,20 que os três degraus produzem.
--
--   d) `pagar_cartao_*` — inalterado da 0058. Fatura não é caixa; só o
--      pagamento é, e ele sai da `settlement_account_id`.
--
--   e) `pagar_documento` — fin_document direction='pagar'. Zero linhas hoje.
--
--   f) `pagar_emprestimo` — categoria 9.04. Zero linhas hoje; a camada existe
--      para que o dia em que houver empréstimo não exija migration.
--
--   g) COMISSÃO — a camada que NÃO existe, de propósito. `fin_comissao_prevista`
--      (0076) tem 309 previsões e R$ 84.946,77 a pagar, e a tentação de somá-las
--      é grande porque a cobertura de saída ainda não é 100%. Duas razões para
--      não somar, e a segunda é decisiva:
--
--        · o backtest da própria 0076 mediu 87,7% de erro mês a mês: a regra
--          acerta o total do ano e o quanto se deve por obra, e não acerta o
--          mês. Numa previsão diária, R$ 85 mil no mês errado responde a
--          pergunta "quando aperta" com a data errada — que é pior que não
--          responder;
--        · e sobretudo: `fin_folha_previsao_v.variavel_cents` é a mediana do
--          ACRÉSCIMO sobre o fixo efetivamente pago nos últimos 6 meses, e é
--          por ali que a comissão paga já entra nesta previsão. Somar a
--          comissão prevista por cima seria somar competência com caixa sobre
--          o mesmo dinheiro — exatamente o erro que a 0045 documentou.
--
--      A comissão é camada de competência e vive em `fin_comissao_prevista`.
--      Quando a 0076 souber o mês, ela vira camada aqui e o `variavel_cents`
--      da folha precisa ser reduzido no mesmo movimento.
--
--   h) REEMBOLSO — dentro da folha, e certo assim. `fin_folha_previsao_v`
--      separa `reembolso_cents` porque em DRE ele não é remuneração. Em CAIXA
--      ele é: sai da conta junto com o pagamento da pessoa. Esta camada usa
--      `total_cents` (fixo + variável + reembolso) porque prevê caixa, não
--      custo. O alerta de inflar a folha em ~R$ 6 mil/mês vale para quem
--      somar planilha COM extrato; aqui a fonte é uma só.
--
-- ===========================================================================
-- 4. RECEBIMENTO: UMA FONTE SÓ
-- ===========================================================================
-- `fin_previsao_recebimento_v` (0061) passa a ser a fonte das camadas de
-- cobrança e recorrente de receita, porque é a que tem a trava contra dupla
-- contagem e a distinção recorrente × parcelado que custou 37% de
-- superestimativa para descobrir.
--
-- A camada `previsao_contrato` (parcelas do ERP sem cobrança emitida) entra por
-- fora, com a MESMA trava: se a contraparte já tem cobrança emitida naquele
-- mês, a parcela cala. Sem isso seriam R$ 144.489,28 somados por cima de
-- cobranças que já os representam — medido: com a trava sobram R$ 39.610,71.

-- ===========================================================================
-- fin_forecast_scenario / fin_forecast_premise
-- ===========================================================================
CREATE TABLE fin_forecast_scenario (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  slug        text   NOT NULL CHECK (slug IN ('base','conservador','otimista')),
  name        text   NOT NULL,
  -- Versão do conjunto de premissas. Muda toda vez que uma premissa muda, e a
  -- foto em fin_cash_forecast grava qual versão usou.
  versao      int    NOT NULL DEFAULT 1 CHECK (versao > 0),
  vigente_de  date   NOT NULL DEFAULT CURRENT_DATE,
  is_default  boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, slug)
);

-- Um cenário padrão por entidade, nunca dois.
CREATE UNIQUE INDEX fin_forecast_scenario_default_ix
  ON fin_forecast_scenario (entity_id) WHERE is_default;

CREATE TRIGGER fin_forecast_scenario_touch BEFORE UPDATE ON fin_forecast_scenario
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

CREATE TABLE fin_forecast_premise (
  id           bigserial PRIMARY KEY,
  scenario_id  bigint NOT NULL REFERENCES fin_forecast_scenario(id) ON DELETE CASCADE,
  chave        text   NOT NULL,
  valor        numeric(12,6) NOT NULL,
  unidade      text   NOT NULL CHECK (unidade IN ('fracao','fator','cents','dias','booleano')),
  -- De onde saiu o número. Texto e não enum: a base de uma premissa é uma
  -- frase, e comprimi-la num código faria perder exatamente o que importa.
  base_medida  text   NOT NULL,
  janela_de    date,
  janela_ate   date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, chave)
);

INSERT INTO fin_forecast_scenario (entity_id, slug, name, is_default, notes)
SELECT e.id, v.slug, v.nome, v.padrao, v.nota
  FROM fin_entity e,
       (VALUES
         ('base','Base', true,
          'O que os dados dizem sem otimismo nem medo. Vencido não entra, proposta não entra.'),
         ('conservador','Conservador', false,
          'Erra para baixo no saldo: DAS na maior alíquota observada, cartão 20% acima da mediana, folha variável 15% acima, e as recorrentes propostas contam como despesa.'),
         ('otimista','Otimista', false,
          'Erra para cima no saldo. Existe para não haver desculpa para mexer no base: quem quiser ver o vencido voltando olha aqui.')
       ) AS v(slug, nome, padrao, nota)
 WHERE e.slug = 'xpe';

INSERT INTO fin_forecast_premise (scenario_id, chave, valor, unidade, base_medida, janela_de, janela_ate)
SELECT s.id, p.chave, p.valor, p.unidade, p.base, p.de, p.ate
  FROM fin_forecast_scenario s
  JOIN fin_entity e ON e.id = s.entity_id AND e.slug = 'xpe'
  JOIN (VALUES
    ('base',        'das_aliquota',            0.089000, 'fracao',
     'mediana de 7 razoes DAS(M) / receita de caixa(M-1): 8,29 · 12,93 · 8,90 · 11,22 · 14,78 · 8,50 · 8,42 %',
     '2025-12-01'::date, '2026-07-01'::date),
    ('otimista',    'das_aliquota',            0.082900, 'fracao',
     'menor razao observada na mesma janela (dez/2025 -> jan/2026)', '2025-12-01', '2026-07-01'),
    ('conservador', 'das_aliquota',            0.147800, 'fracao',
     'maior razao observada na mesma janela (abr -> mai/2026)', '2025-12-01', '2026-07-01'),
    ('base',        'cartao_fator',            1.000000, 'fator',
     'mediana das 6 ultimas faturas fechadas: R$ 8.796,82', '2026-03-01', '2026-08-01'),
    ('otimista',    'cartao_fator',            0.850000, 'fator',
     'mediana menos 15%: a menor fatura da janela (R$ 6.649,25) e 24% abaixo da mediana', '2026-03-01', '2026-08-01'),
    ('conservador', 'cartao_fator',            1.200000, 'fator',
     'mediana mais 20%: a maior fatura da janela (R$ 11.247,21) e 28% acima da mediana', '2026-03-01', '2026-08-01'),
    ('base',        'folha_variavel_fator',    1.000000, 'fator',
     'a mediana do acrescimo sobre o fixo que fin_folha_previsao_v ja calcula', NULL, NULL),
    ('otimista',    'folha_variavel_fator',    0.900000, 'fator',
     'acrescimo 10% abaixo da mediana', NULL, NULL),
    ('conservador', 'folha_variavel_fator',    1.150000, 'fator',
     'acrescimo 15% acima da mediana; a folha real variou de R$ 75.224,47 a R$ 104.741,76 em 2026', '2026-01-01', '2026-08-01'),
    ('base',        'vencido_recupera',        0.000000, 'fracao',
     'decisao da 0058: recebivel vencido nao move saldo', NULL, NULL),
    ('otimista',    'vencido_recupera',        0.500000, 'fracao',
     'metade do vencido volta — aproxima a curva de aging de forecast.ts na faixa 61-90 dias', NULL, NULL),
    ('conservador', 'vencido_recupera',        0.000000, 'fracao',
     'nada do vencido volta', NULL, NULL),
    ('base',        'recorrente_proposta',     0.000000, 'booleano',
     'proposta nao confirmada nao entra no saldo (CHECK da 0057)', NULL, NULL),
    ('otimista',    'recorrente_proposta',     0.000000, 'booleano',
     'idem base', NULL, NULL),
    ('conservador', 'recorrente_proposta',     1.000000, 'booleano',
     'as 11 propostas (R$ 14.207,21/mes) contam como despesa: incluir saida nao confirmada erra para baixo no saldo, que e o lado seguro', NULL, NULL),
    ('base',        'receber_fator',           1.000000, 'fator',
     'cobranca emitida a vencer entra pelo valor de face', NULL, NULL),
    ('otimista',    'receber_fator',           1.000000, 'fator', 'idem base', NULL, NULL),
    ('conservador', 'receber_fator',           0.850000, 'fator',
     'inadimplencia de 15% sobre o que ainda nao venceu', NULL, NULL)
  ) AS p(cen, chave, valor, unidade, base, de, ate) ON p.cen = s.slug;

-- ===========================================================================
-- fin_previsao_evento_v — mesmas 17 colunas, mais as camadas que faltavam
-- ===========================================================================
-- CREATE OR REPLACE e não DROP: `lib/financeiro/contratos/previsao.ts` lê
-- `SELECT c.*` desta view e da diária. DROP+CREATE quebraria a tela entre a
-- migration e o deploy. As colunas novas vão no fim, que é o que o CREATE OR
-- REPLACE permite e o `SELECT *` do consumidor tolera.
--
-- Os TIPOS das 17 primeiras colunas também não podem mudar — CREATE OR REPLACE
-- recusa. `valor_cents` é numeric e não bigint porque o desconto do mês
-- corrente usa SUM(), que devolve numeric; o cast está deliberadamente ausente.
CREATE OR REPLACE VIEW fin_previsao_evento_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
ent AS (SELECT id FROM fin_entity WHERE slug = 'xpe'),

meses AS (
  SELECT g.n, (date_trunc('month', h.d) + (g.n || ' month')::interval)::date AS mes
    FROM hoje h CROSS JOIN generate_series(0, 12) AS g(n)
),

-- ── ENTRADAS: fonte única (0061), mais a parcela do ERP com a mesma trava ──
receber AS (
  SELECT
    CASE WHEN v.camada = 'cobranca_emitida'  THEN 'receber_cobranca'
         WHEN v.camada = 'vencido_a_receber' THEN 'receber_vencido'
         ELSE 'receber_' || v.camada END AS camada,
    CASE WHEN v.certeza = 'firme' AND v.camada = 'cobranca_emitida' THEN 'faturado'
         WHEN v.certeza = 'firme' THEN 'contratado'
         ELSE v.certeza END AS confianca,
    (v.camada <> 'vencido_a_receber')                     AS entra_no_saldo,
    -- O vencido tem data no PASSADO (a mais antiga é de nov/2021). Deixá-lo com
    -- a data original o joga para fora da janela do horizonte e ele some da
    -- previsão inteira. Ele é ancorado em hoje: é dinheiro que, se voltar,
    -- volta a partir de agora.
    CASE WHEN v.camada = 'vencido_a_receber' THEN h.d ELSE v.data_prevista END AS dia,
    'entrada'::text                                        AS sentido,
    v.amount_cents                                         AS bruto_cents,
    1.000::numeric(4,3)                                    AS fator,
    v.amount_cents                                         AS valor_cents,
    COALESCE(v.contraparte, v.descricao, '(sem contraparte)') AS sobre_o_que,
    v.counterparty_id,
    NULL::bigint                                           AS category_id,
    NULL::bigint                                           AS account_id,
    v.origem_tabela || ':' || v.origem_id                  AS origem_ref
  FROM fin_previsao_recebimento_v v, hoje h
),
parcela_erp AS (
  SELECT
    'receber_previsao_contrato'::text, 'contratado'::text, true,
    p.vencimento, 'entrada'::text,
    p.aberto_cents, 1.000::numeric(4,3), p.aberto_cents,
    COALESCE(p.cliente, '(sem contraparte)'),
    p.counterparty_id, NULL::bigint, NULL::bigint,
    'erp_parcela:' || p.parcela_erp_id
  FROM fin_receber_aberto_v p, hoje h
  WHERE p.camada = 'previsao_contrato'
    AND p.vencimento >= h.d
    AND NOT EXISTS (
      SELECT 1 FROM fin_document d
       WHERE d.direction = 'receber'
         AND d.counterparty_id = p.counterparty_id
         AND d.status NOT IN ('liquidado','cancelado')
         AND date_trunc('month', d.due_date) = date_trunc('month', p.vencimento)
    )
),

-- ── SAÍDAS ────────────────────────────────────────────────────────────────
recorrente AS (
  SELECT
    CASE WHEN c.code = '9.04' THEN 'pagar_emprestimo' ELSE 'pagar_recorrente' END,
    r.confidence,
    (r.status = 'ativo'),
    (m.mes + (LEAST(r.day_of_month,
       EXTRACT(DAY FROM (m.mes + interval '1 month' - interval '1 day'))::int) - 1))::date,
    'saida'::text,
    r.amount_cents, 1.000::numeric(4,3),
    -- No mês corrente, desconta o que já saiu pela mesma chave da detecção.
    CASE WHEN m.n = 0
         THEN GREATEST(0, r.amount_cents - COALESCE((
                SELECT SUM(-t.amount_cents) FROM fin_transaction t
                 WHERE t.entity_id = r.entity_id
                   AND t.counterparty_id IS NOT DISTINCT FROM r.counterparty_id
                   AND t.category_id IS NOT DISTINCT FROM r.category_id
                   AND t.amount_cents < 0
                   AND t.transfer_status = 'nao' AND NOT t.is_split_parent
                   AND t.posted_on >= m.mes
              ), 0))
         ELSE r.amount_cents END,
    r.label, r.counterparty_id, r.category_id, r.account_id,
    'fin_recurring:' || r.id
  FROM fin_recurring r
  LEFT JOIN fin_category c ON c.id = r.category_id
  CROSS JOIN meses m
  WHERE r.direction = 'pagar' AND r.cadence = 'mensal'
    AND r.status IN ('ativo','proposto')
    AND r.conflito_camada IS NULL
    AND r.start_month <= m.mes
    AND (r.end_month IS NULL OR r.end_month >= m.mes)
    -- Um dono só para cada pessoa da folha. Ver seção 3(b).
    AND NOT (COALESCE(c.code, '') LIKE '6.%' AND EXISTS (
      SELECT 1 FROM fin_folha_previsao_v f2
      JOIN fin_person p2 ON p2.id = f2.person_id
       WHERE p2.counterparty_id = r.counterparty_id
         AND f2.situacao_na_folha = 'ativo na folha' AND f2.total_cents > 0
    ))
),

folha AS (
  SELECT
    'pagar_folha'::text,
    -- O primeiro mês projetado carrega a confiança que a 0077 apurou por
    -- pessoa (contratado × observado). Dali para frente é repetição de uma
    -- média, e chamar isso de 'contratado' seria mentir sobre o horizonte.
    CASE WHEN m.n <= 1 THEN f.fixo_confianca ELSE 'estimado' END,
    true,
    (m.mes + 1)::date,   -- dia 2: 82% da folha de 2026 saiu nos dias 1 e 2
    'saida'::text,
    f.total_cents::bigint, 1.000::numeric(4,3), f.total_cents::bigint,
    'Folha — ' || f.pessoa, p.counterparty_id, NULL::bigint, NULL::bigint,
    'fin_person:' || f.person_id
  FROM fin_folha_previsao_v f
  JOIN fin_person p ON p.id = f.person_id
  CROSS JOIN meses m
  WHERE f.situacao_na_folha = 'ativo na folha'
    AND f.total_cents > 0
),

receita_mes AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, SUM(t.amount_cents) AS cents
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE c.kind = 'receita' AND t.amount_cents > 0
     AND t.transfer_status = 'nao' AND NOT t.is_split_parent
   GROUP BY 1
),
receita_prevista_mes AS (
  SELECT date_trunc('month', v.data_prevista)::date AS mes, SUM(v.amount_cents) AS cents
    FROM fin_previsao_recebimento_v v
   WHERE v.camada <> 'vencido_a_receber'
   GROUP BY 1
),
receita_mediana AS (
  SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x.cents))::bigint AS cents
    FROM (SELECT rm.cents FROM receita_mes rm, hoje h
           WHERE rm.mes < date_trunc('month', h.d)::date
           ORDER BY rm.mes DESC LIMIT 3) x
),
-- A base do DAS em três degraus de qualidade. Exigir base realizada deixava só
-- o mês seguinte ao último fechado com DAS, e o imposto sumia do resto do
-- horizonte — o erro para cima na sua forma mais cara.
das_base AS (
  SELECT m.n, m.mes,
         (m.mes - interval '1 month')::date AS competencia,
         CASE
           WHEN (m.mes - interval '1 month')::date < date_trunc('month', h.d)::date
             THEN rm.cents                       -- 1. mês fechado: fato
           WHEN rp.cents IS NOT NULL THEN rp.cents -- 2. a própria previsão
           ELSE rmed.cents                        -- 3. mediana dos 3 fechados
         END AS base_cents,
         CASE
           WHEN (m.mes - interval '1 month')::date < date_trunc('month', h.d)::date
             THEN 'derivado' ELSE 'estimado'
         END AS confianca
    FROM meses m
    CROSS JOIN hoje h
    CROSS JOIN receita_mediana rmed
    LEFT JOIN receita_mes rm ON rm.mes = (m.mes - interval '1 month')::date
    LEFT JOIN receita_prevista_mes rp ON rp.mes = (m.mes - interval '1 month')::date
),
das AS (
  SELECT
    'pagar_tributo_das'::text,
    b.confianca,
    true,
    (b.mes + 16)::date,   -- dia 17: onde caiu o maior volume de 7.01 em 2026
    'saida'::text,
    ROUND(b.base_cents * pr.valor)::bigint, pr.valor::numeric(4,3),
    ROUND(b.base_cents * pr.valor)::bigint,
    'DAS sobre a receita de ' || to_char(b.competencia, 'MM/YYYY')
      || CASE WHEN b.confianca = 'estimado' THEN ' (base prevista)' ELSE '' END,
    NULL::bigint,
    (SELECT id FROM fin_category WHERE code = '7.01' AND entity_id = (SELECT id FROM ent)),
    NULL::bigint,
    'das:' || to_char(b.mes, 'YYYY-MM')
  FROM das_base b
  CROSS JOIN hoje h
  CROSS JOIN LATERAL (
    SELECT p.valor FROM fin_forecast_premise p
      JOIN fin_forecast_scenario s ON s.id = p.scenario_id AND s.is_default
     WHERE p.chave = 'das_aliquota'
  ) pr
  WHERE b.base_cents IS NOT NULL AND b.base_cents > 0
    AND (b.mes + 16)::date >= h.d
    AND NOT EXISTS (
      SELECT 1 FROM fin_transaction t JOIN fin_category c2 ON c2.id = t.category_id
       WHERE c2.code = '7.01' AND t.amount_cents < 0
         AND date_trunc('month', t.posted_on)::date = b.mes
         AND t.posted_on >= b.mes + 10
    )
),

cartao_base AS (
  SELECT ca.id AS card_account_id, ca.due_day, ca.settlement_account_id,
         (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b.total_amount_cents)
            FROM (SELECT total_amount_cents FROM fin_card_bill
                   WHERE card_account_id = ca.id AND total_amount_cents > 0
                   ORDER BY reference_month DESC LIMIT 6) b)::bigint AS mediana_cents
    FROM fin_card_account ca WHERE ca.is_active
),
cartao_mes AS (
  SELECT cb.card_account_id, cb.settlement_account_id, cb.mediana_cents, v.competence_month,
         make_date(EXTRACT(YEAR FROM v.competence_month)::int,
                   EXTRACT(MONTH FROM v.competence_month)::int,
                   LEAST(cb.due_day, EXTRACT(DAY FROM (v.competence_month + interval '1 month' - interval '1 day'))::int)) AS vencimento,
         SUM(v.amount_cents) FILTER (WHERE v.tipo = 'parcela')         AS parcela_cents,
         SUM(v.amount_cents) FILTER (WHERE v.tipo = 'compra_do_ciclo') AS ciclo_cents
    FROM fin_card_compromisso_mensal_v v
    JOIN cartao_base cb ON cb.card_account_id = v.card_account_id
   WHERE cb.due_day IS NOT NULL
   GROUP BY 1,2,3,4,5
),
cartao AS (
  -- `x.*` e não `*`: com `*` a coluna de `hoje` entraria na projeção e o UNION
  -- ALL passaria a ter 14 colunas contra 13 das outras camadas.
  SELECT x.camada, x.confianca, x.entra, x.dia, x.sentido, x.bruto, x.fator,
         x.valor, x.sobre, x.cp, x.cat, x.conta, x.ref
  FROM (
    SELECT 'pagar_cartao_parcela'::text AS camada, 'contratado'::text AS confianca, true AS entra,
           cm.vencimento AS dia, 'saida'::text AS sentido,
           COALESCE(cm.parcela_cents,0)::bigint AS bruto, 1.000::numeric(4,3) AS fator,
           COALESCE(cm.parcela_cents,0)::bigint AS valor,
           'Cartão — parcelas de ' || to_char(cm.competence_month,'MM/YYYY') AS sobre,
           NULL::bigint AS cp, NULL::bigint AS cat, cm.settlement_account_id AS conta,
           'fin_card_bill:' || to_char(cm.competence_month,'YYYY-MM') || ':parcela' AS ref,
           cm.competence_month, cm.card_account_id
      FROM cartao_mes cm
    UNION ALL
    SELECT 'pagar_cartao_ciclo', 'observado', true, cm.vencimento, 'saida',
           COALESCE(cm.ciclo_cents,0)::bigint, 1.000, COALESCE(cm.ciclo_cents,0)::bigint,
           'Cartão — compras do ciclo ' || to_char(cm.competence_month,'MM/YYYY'),
           NULL, NULL, cm.settlement_account_id,
           'fin_card_bill:' || to_char(cm.competence_month,'YYYY-MM') || ':ciclo',
           cm.competence_month, cm.card_account_id
      FROM cartao_mes cm
    UNION ALL
    SELECT 'pagar_cartao_estimado', 'estimado', true, cm.vencimento, 'saida',
           GREATEST(0, cm.mediana_cents - COALESCE(cm.parcela_cents,0) - COALESCE(cm.ciclo_cents,0))::bigint, 1.000,
           GREATEST(0, cm.mediana_cents - COALESCE(cm.parcela_cents,0) - COALESCE(cm.ciclo_cents,0))::bigint,
           'Cartão — estimado até a mediana de ' || to_char(cm.competence_month,'MM/YYYY'),
           NULL, NULL, cm.settlement_account_id,
           'fin_card_bill:' || to_char(cm.competence_month,'YYYY-MM') || ':estimado',
           cm.competence_month, cm.card_account_id
      FROM cartao_mes cm
  ) x, hoje h
  WHERE x.valor > 0 AND x.dia >= h.d
    -- Casamento por `reference_month` e não por data: o `due_date` real (10/08)
    -- e o vencimento calculado a partir de `due_day` (09) não coincidem, e
    -- casar por data deixaria a fatura já paga ser projetada de novo.
    AND NOT EXISTS (
      SELECT 1 FROM fin_card_bill b
       WHERE b.card_account_id = x.card_account_id
         AND b.reference_month = x.competence_month
         AND b.total_amount_cents > 0
         AND b.paid_amount_cents >= b.total_amount_cents
    )
),
pagar_doc AS (
  SELECT
    'pagar_documento'::text, 'faturado'::text, true,
    COALESCE(d.expected_cash_date, d.due_date), 'saida'::text,
    (d.amount_cents - d.settled_cents), 1.000::numeric(4,3),
    (d.amount_cents - d.settled_cents),
    d.description, d.counterparty_id, d.category_id, d.expected_account_id,
    'fin_document:' || d.id
  FROM fin_document d, hoje h
  WHERE d.direction = 'pagar'
    AND d.status IN ('previsto','emitido','parcial','confirmado')
    AND (d.amount_cents - d.settled_cents) > 0
    AND COALESCE(d.expected_cash_date, d.due_date) >= h.d
),
tudo AS (
  SELECT * FROM receber
  UNION ALL SELECT * FROM parcela_erp
  UNION ALL SELECT * FROM recorrente
  UNION ALL SELECT * FROM folha
  UNION ALL SELECT * FROM das
  UNION ALL SELECT * FROM cartao
  UNION ALL SELECT * FROM pagar_doc
)
SELECT
  (SELECT id FROM ent)  AS entity_id,
  'projetado'::text     AS procedencia,
  t.camada,
  t.confianca,
  t.entra_no_saldo,
  t.dia,
  (t.dia - h.d)         AS dias_a_frente,
  t.sentido,
  t.bruto_cents,
  t.fator,
  t.valor_cents,
  CASE WHEN t.sentido = 'entrada' THEN t.valor_cents ELSE -t.valor_cents END AS assinado_cents,
  t.sobre_o_que,
  t.counterparty_id,
  t.category_id,
  t.account_id,
  t.origem_ref,
  -- ── colunas novas, ao fim, para não quebrar o SELECT * do consumidor ────
  -- Escala ordenada de confiança. Sem ela, cortar "só o que é firme" exige que
  -- cada consulta conheça as sete palavras e a ordem entre elas.
  CASE t.confianca
    WHEN 'faturado'   THEN 1
    WHEN 'contratado' THEN 1
    WHEN 'firme'      THEN 2
    WHEN 'derivado'   THEN 3
    WHEN 'provavel'   THEN 3
    WHEN 'observado'  THEN 4
    WHEN 'estimado'   THEN 5
    WHEN 'atrasado'   THEN 5
    ELSE 5 END        AS confianca_nivel,
  CASE
    WHEN t.sentido = 'entrada'           THEN 'recebimento'
    WHEN t.camada LIKE 'pagar_cartao%'   THEN 'fatura_cartao'
    WHEN t.camada = 'pagar_folha'        THEN 'folha'
    WHEN t.camada = 'pagar_tributo_das'  THEN 'imposto'
    WHEN t.camada = 'pagar_emprestimo'   THEN 'emprestimo'
    ELSE 'despesa' END AS natureza,
  CASE
    WHEN t.entra_no_saldo THEN NULL
    WHEN t.camada = 'receber_vencido' THEN 'recebível vencido: só entra no cenário otimista'
    WHEN t.camada IN ('pagar_recorrente','pagar_emprestimo')
      THEN 'recorrente ainda não confirmada: só entra no cenário conservador'
    ELSE 'camada não somável' END AS motivo_nao_soma
FROM tudo t, hoje h
WHERE t.valor_cents > 0
  AND t.dia BETWEEN h.d AND h.d + 365;

-- ===========================================================================
-- fin_previsao_cenario_v — o mesmo evento sob as três premissas
-- ===========================================================================
CREATE VIEW fin_previsao_cenario_v AS
WITH prem AS (
  SELECT s.slug AS cenario, s.versao, p.chave, p.valor
    FROM fin_forecast_premise p
    JOIN fin_forecast_scenario s ON s.id = p.scenario_id
)
SELECT
  ev.entity_id,
  s.slug AS cenario,
  s.versao AS premissas_versao,
  ev.procedencia, ev.camada, ev.confianca, ev.confianca_nivel, ev.natureza,
  ev.dia, ev.dias_a_frente, ev.sentido,
  ev.valor_cents AS valor_base_cents,
  CASE
    WHEN ev.camada = 'receber_vencido'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'vencido_recupera')
    WHEN ev.sentido = 'entrada' AND ev.confianca <> 'atrasado'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'receber_fator')
    WHEN ev.camada = 'pagar_cartao_estimado'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'cartao_fator')
    WHEN ev.camada = 'pagar_folha'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'folha_variavel_fator')
    WHEN ev.camada = 'pagar_tributo_das'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'das_aliquota')
           / NULLIF((SELECT valor FROM prem WHERE cenario = 'base' AND chave = 'das_aliquota'), 0)
    ELSE 1.0
  END AS fator_cenario,
  ROUND(ev.valor_cents * CASE
    WHEN ev.camada = 'receber_vencido'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'vencido_recupera')
    WHEN ev.sentido = 'entrada' AND ev.confianca <> 'atrasado'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'receber_fator')
    WHEN ev.camada = 'pagar_cartao_estimado'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'cartao_fator')
    WHEN ev.camada = 'pagar_folha'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'folha_variavel_fator')
    WHEN ev.camada = 'pagar_tributo_das'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'das_aliquota')
           / NULLIF((SELECT valor FROM prem WHERE cenario = 'base' AND chave = 'das_aliquota'), 0)
    ELSE 1.0 END)::bigint AS valor_cenario_cents,
  CASE
    WHEN ev.camada = 'receber_vencido'
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'vencido_recupera') > 0
    WHEN ev.camada IN ('pagar_recorrente','pagar_emprestimo') AND NOT ev.entra_no_saldo
      THEN (SELECT valor FROM prem WHERE cenario = s.slug AND chave = 'recorrente_proposta') > 0
    ELSE ev.entra_no_saldo
  END AS entra_no_saldo,
  ev.sobre_o_que, ev.counterparty_id, ev.category_id, ev.account_id, ev.origem_ref
FROM fin_previsao_evento_v ev
CROSS JOIN fin_forecast_scenario s
WHERE s.entity_id = ev.entity_id;

-- ===========================================================================
-- fin_caixa_previsto_dia_v — mesmas 14 colunas, mais o que decide
-- ===========================================================================
CREATE OR REPLACE VIEW fin_caixa_previsto_dia_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
ancora AS (
  SELECT e.id AS entity_id,
         SUM(a.current_balance_cents) AS saldo_cents,
         MIN(a.last_statement_at)::date AS ancora_ate
    FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
   WHERE e.slug = 'xpe' AND a.is_active AND a.kind <> 'emprestimo'
   GROUP BY 1
),
reserva AS (
  SELECT e.id AS entity_id, COALESCE(SUM(r.target_cents), 0) AS minima_cents
    FROM fin_entity e LEFT JOIN fin_reserve r
      ON r.entity_id = e.id AND r.is_active AND r.is_committed
   WHERE e.slug = 'xpe' GROUP BY 1
),
dias AS (
  SELECT gs::date AS dia FROM hoje h, generate_series(h.d, h.d + 365, interval '1 day') gs
),
mov AS (
  SELECT ev.dia,
         SUM(ev.valor_cents) FILTER (WHERE ev.sentido = 'entrada' AND ev.entra_no_saldo) AS entrada_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.sentido = 'saida'   AND ev.entra_no_saldo) AS saida_cents,
         SUM(ev.assinado_cents) FILTER (WHERE ev.entra_no_saldo)                          AS liquido_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.camada = 'receber_vencido')                 AS vencido_cents,
         SUM(ev.valor_cents) FILTER (WHERE NOT ev.entra_no_saldo AND ev.sentido = 'saida') AS saida_nao_somada_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.confianca = 'estimado' AND ev.entra_no_saldo) AS estimado_cents,
         COUNT(*) FILTER (WHERE ev.entra_no_saldo)                                        AS n_eventos
    FROM fin_previsao_evento_v ev
   GROUP BY 1
),
serie AS (
  SELECT
    a.entity_id, d.dia, h.d AS hoje, a.ancora_ate, a.saldo_cents, rs.minima_cents,
    COALESCE(m.entrada_cents, 0) AS entrada_cents,
    COALESCE(m.saida_cents, 0)   AS saida_cents,
    COALESCE(m.liquido_cents, 0) AS liquido_cents,
    COALESCE(m.estimado_cents, 0) AS estimado_cents,
    COALESCE(m.saida_nao_somada_cents, 0) AS saida_nao_somada_cents,
    COALESCE(m.n_eventos, 0) AS n_eventos,
    a.saldo_cents + SUM(COALESCE(m.liquido_cents, 0)) OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING) AS saldo_previsto_cents,
    a.saldo_cents + SUM(COALESCE(m.liquido_cents, 0) + COALESCE(m.vencido_cents, 0)) OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING) AS saldo_com_vencido_cents
  FROM dias d
  CROSS JOIN hoje h
  CROSS JOIN ancora a
  CROSS JOIN reserva rs
  LEFT JOIN mov m ON m.dia = d.dia
)
SELECT
  s.entity_id,
  'projetado'::text AS procedencia,
  s.dia,
  (s.dia - s.hoje) AS dias_a_frente,
  s.ancora_ate,
  s.saldo_cents AS ancora_saldo_cents,
  s.entrada_cents,
  s.saida_cents,
  s.liquido_cents,
  s.saldo_previsto_cents,
  s.saldo_com_vencido_cents,
  s.estimado_cents AS estimado_no_dia_cents,
  s.saida_nao_somada_cents AS saida_proposta_nao_somada_cents,
  s.n_eventos,
  -- ── colunas novas ───────────────────────────────────────────────────────
  s.minima_cents AS reserva_minima_cents,
  -- Caixa livre é o que sobra DEPOIS da reserva comprometida. As 4 reservas
  -- têm alvo declarado e `current_cents = 0` — o alvo é dívida consigo mesmo, e
  -- por isso desconta. Se a decisão for outra, muda-se aqui, num lugar só.
  (s.saldo_previsto_cents - s.minima_cents) AS caixa_livre_cents,
  MIN(s.saldo_previsto_cents) OVER (ORDER BY s.dia ROWS UNBOUNDED PRECEDING) AS menor_saldo_ate_aqui_cents,
  (s.saldo_previsto_cents < 0) AS ruptura,
  (s.saldo_previsto_cents < s.minima_cents) AS abaixo_da_reserva
FROM serie s;

-- ===========================================================================
-- fin_caixa_previsto_mes_v — o resumo que decide
-- ===========================================================================
CREATE VIEW fin_caixa_previsto_mes_v AS
WITH dia AS (SELECT * FROM fin_caixa_previsto_dia_v),
por_mes AS (
  SELECT entity_id, date_trunc('month', dia)::date AS mes,
         MIN(dia) AS primeiro_dia, MAX(dia) AS ultimo_dia,
         SUM(entrada_cents) AS entrada_cents,
         SUM(saida_cents)   AS saida_cents,
         SUM(liquido_cents) AS liquido_cents,
         SUM(saida_proposta_nao_somada_cents) AS saida_nao_somada_cents,
         MIN(saldo_previsto_cents) AS menor_saldo_cents,
         MIN(reserva_minima_cents) AS reserva_minima_cents
    FROM dia GROUP BY 1,2
),
natureza AS (
  SELECT date_trunc('month', ev.dia)::date AS mes,
         SUM(ev.valor_cents) FILTER (WHERE ev.natureza = 'folha'         AND ev.entra_no_saldo) AS folha_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.natureza = 'imposto'       AND ev.entra_no_saldo) AS imposto_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.natureza = 'fatura_cartao' AND ev.entra_no_saldo) AS cartao_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.natureza = 'despesa'       AND ev.entra_no_saldo) AS despesa_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.natureza = 'emprestimo'    AND ev.entra_no_saldo) AS emprestimo_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.sentido = 'entrada' AND ev.entra_no_saldo AND ev.confianca_nivel <= 2) AS entrada_firme_cents,
         SUM(ev.valor_cents) FILTER (WHERE ev.sentido = 'entrada' AND ev.entra_no_saldo AND ev.confianca_nivel > 2)  AS entrada_frouxa_cents
    FROM fin_previsao_evento_v ev GROUP BY 1
),
aperto AS (
  SELECT date_trunc('month', d.dia)::date AS mes,
         MIN(d.dia) FILTER (WHERE d.abaixo_da_reserva) AS dia_abaixo_reserva,
         MIN(d.dia) FILTER (WHERE d.ruptura)           AS dia_ruptura,
         (ARRAY_AGG(d.dia ORDER BY d.saldo_previsto_cents, d.dia))[1] AS dia_menor_saldo
    FROM dia d GROUP BY 1
)
SELECT
  p.entity_id,
  'projetado'::text AS procedencia,
  p.mes,
  -- Abertura do mês = saldo do primeiro dia menos o movimento desse dia. No mês
  -- corrente é a âncora, porque o primeiro dia é hoje.
  (SELECT d2.saldo_previsto_cents - d2.liquido_cents FROM dia d2 WHERE d2.dia = p.primeiro_dia) AS saldo_inicial_cents,
  p.entrada_cents,
  COALESCE(n.entrada_firme_cents, 0)  AS entrada_firme_cents,
  COALESCE(n.entrada_frouxa_cents, 0) AS entrada_frouxa_cents,
  p.saida_cents,
  COALESCE(n.folha_cents, 0)      AS saida_folha_cents,
  COALESCE(n.imposto_cents, 0)    AS saida_imposto_cents,
  COALESCE(n.cartao_cents, 0)     AS saida_cartao_cents,
  COALESCE(n.despesa_cents, 0)    AS saida_despesa_cents,
  COALESCE(n.emprestimo_cents, 0) AS saida_emprestimo_cents,
  p.liquido_cents,
  (SELECT d3.saldo_previsto_cents FROM dia d3 WHERE d3.dia = p.ultimo_dia) AS saldo_final_cents,
  p.menor_saldo_cents,
  a.dia_menor_saldo,
  p.reserva_minima_cents,
  (p.menor_saldo_cents - p.reserva_minima_cents) AS caixa_livre_no_pior_dia_cents,
  a.dia_abaixo_reserva,
  a.dia_ruptura,
  -- O dia do aperto: o primeiro que fura a reserva, ou o primeiro negativo se
  -- não houver reserva declarada. Nulo quando o mês inteiro passa folgado.
  COALESCE(a.dia_abaixo_reserva, a.dia_ruptura) AS dia_do_aperto,
  p.saida_nao_somada_cents
FROM por_mes p
LEFT JOIN natureza n ON n.mes = p.mes
LEFT JOIN aperto   a ON a.mes = p.mes;

-- ===========================================================================
-- fin_cash_forecast — a foto ganha cenário, premissas e horizonte
-- ===========================================================================
ALTER TABLE fin_cash_forecast
  ADD COLUMN cenario          text NOT NULL DEFAULT 'base',
  ADD COLUMN premissas_versao int,
  ADD COLUMN premissas        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN horizonte_dias   int,
  ADD COLUMN algoritmo_versao text,
  ADD COLUMN reserva_minima_cents bigint,
  ADD COLUMN entrada_realizada_cents bigint,
  ADD COLUMN saida_realizada_cents   bigint;

ALTER TABLE fin_cash_forecast
  ADD CONSTRAINT fin_cash_forecast_cenario_ck
    CHECK (cenario IN ('base','conservador','otimista'));

-- A unicidade passa a incluir o cenário: as três fotos do mesmo dia convivem.
ALTER TABLE fin_cash_forecast DROP CONSTRAINT IF EXISTS fin_cash_forecast_entity_id_gerado_em_dia_key;
ALTER TABLE fin_cash_forecast
  ADD CONSTRAINT fin_cash_forecast_foto_key UNIQUE (entity_id, gerado_em, cenario, dia);

COMMENT ON COLUMN fin_cash_forecast.premissas IS
  'jsonb das premissas usadas naquela foto. Sem isto, um erro de previsão não separa "premissa errada" de "mundo mudou".';

-- ===========================================================================
-- fin_previsao_afericao_v — o quanto a previsão errou
-- ===========================================================================
-- Duas medidas, porque medem coisas diferentes:
--
--   erro_dia    o movimento líquido do dia. Sensível a deslocamento de data:
--               um aluguel previsto para 2 e pago em 3 erra dois dias.
--   erro_acum   o líquido acumulado desde a data da foto. Imune a deslocamento
--               dentro do horizonte, que é o que interessa para "o caixa
--               aguenta?".
--
-- O realizado sai de fin_transaction — e é a ÚNICA coluna desta migration que
-- toca dinheiro realizado. Ela vive numa view de aferição, longe da previsão,
-- exatamente para que ninguém a some por engano.
CREATE VIEW fin_previsao_afericao_v AS
WITH realizado_dia AS (
  SELECT t.entity_id, t.posted_on AS dia,
         SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0) AS entrada_cents,
         SUM(-t.amount_cents) FILTER (WHERE t.amount_cents < 0) AS saida_cents,
         SUM(t.amount_cents) AS liquido_cents
    FROM fin_transaction t
   WHERE t.transfer_status <> 'pareado' AND NOT t.is_split_parent
   GROUP BY 1,2
)
SELECT
  f.entity_id,
  f.gerado_em,
  f.cenario,
  f.premissas_versao,
  f.dia,
  (f.dia - f.gerado_em) AS dias_a_frente,
  f.saldo_previsto_cents,
  f.entrada_cents  AS entrada_prevista_cents,
  f.saida_cents    AS saida_prevista_cents,
  (f.entrada_cents - f.saida_cents) AS liquido_previsto_cents,
  r.entrada_cents  AS entrada_realizada_cents,
  r.saida_cents    AS saida_realizada_cents,
  r.liquido_cents  AS liquido_realizado_cents,
  CASE WHEN r.dia IS NULL THEN NULL
       ELSE (f.entrada_cents - f.saida_cents) - COALESCE(r.liquido_cents, 0) END AS erro_dia_cents,
  SUM(f.entrada_cents - f.saida_cents) OVER (
      PARTITION BY f.entity_id, f.gerado_em, f.cenario ORDER BY f.dia ROWS UNBOUNDED PRECEDING) AS previsto_acum_cents,
  SUM(COALESCE(r.liquido_cents, 0)) OVER (
      PARTITION BY f.entity_id, f.gerado_em, f.cenario ORDER BY f.dia ROWS UNBOUNDED PRECEDING) AS realizado_acum_cents,
  CASE WHEN r.dia IS NULL THEN NULL ELSE
    SUM(f.entrada_cents - f.saida_cents) OVER (
        PARTITION BY f.entity_id, f.gerado_em, f.cenario ORDER BY f.dia ROWS UNBOUNDED PRECEDING)
    - SUM(COALESCE(r.liquido_cents, 0)) OVER (
        PARTITION BY f.entity_id, f.gerado_em, f.cenario ORDER BY f.dia ROWS UNBOUNDED PRECEDING)
  END AS erro_acum_cents,
  -- Nulo enquanto o dia não chegou. Nulo é "ainda não sei", nunca zero.
  (r.dia IS NOT NULL) AS aferivel
FROM fin_cash_forecast f
LEFT JOIN realizado_dia r ON r.entity_id = f.entity_id AND r.dia = f.dia;

COMMENT ON VIEW fin_previsao_cenario_v IS
  'O mesmo evento previsto sob base/conservador/otimista. Uma linha por cenário; cenários não somam entre si.';
COMMENT ON VIEW fin_caixa_previsto_mes_v IS
  'Resumo mensal: saldo inicial, entradas por firmeza, saídas por natureza, saldo final, caixa livre e dia do aperto.';
COMMENT ON VIEW fin_previsao_afericao_v IS
  'Foto datada da previsão contra o realizado. Erro por dia e acumulado. Única view desta migration que toca realizado.';
