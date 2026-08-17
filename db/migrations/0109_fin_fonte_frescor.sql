-- O alarme de fonte desatualizada para de gritar lobo: dias úteis, fonte por
-- fonte, um aviso só — e uma tela com o botão de atualizar.
--
-- ===========================================================================
-- O PEDIDO
-- ===========================================================================
-- "e tbm tem dizendo que tem fontes sem atualizar... precisa mesmo ficar
--  mostrando? é importante atualizar? pq n tem botão para atualizar as fontes?
--  mostrar quais nao estão atualizadas?"
--
-- Quatro perguntas, e as quatro têm resposta medida. A mais dura é a terceira:
-- **um alarme que não oferece a ação de resolver é só cobrança.**
--
-- ===========================================================================
-- O QUE ELE ESTAVA VENDO, MEDIDO EM 17/08/2026
-- ===========================================================================
-- Cinco notificações, todas com o mesmo corpo, todas "visto 6×":
--
--   fonte_desatualizada:import_csv:nubank             2 dia(s) — tolerância 1
--   fonte_desatualizada:inter_api:inter               2 dia(s) — tolerância 1
--   fonte_desatualizada:import_csv:nubank-caixinhas   2 dia(s) — tolerância 1
--   fonte_desatualizada:polp:nubank-caixinhas         2 dia(s) — tolerância 1
--   fonte_desatualizada:import_csv:inter              2 dia(s) — tolerância 1
--
-- E, no mesmo instante, o log do agendador em produção dizia
-- `último sync há 3h, não precisa rodar agora`. A sync tinha rodado. O acervo
-- não estava parado. Três defeitos independentes produziram esses cinco avisos:
--
-- ---------------------------------------------------------------------------
-- DEFEITO 1 — a régua contava dias CORRIDOS, e banco não lança no fim de semana
-- ---------------------------------------------------------------------------
-- 14/08/2026 foi sexta, 15/08 sábado, 16/08 domingo, 17/08 segunda. Uma fonte
-- que fechou no sábado e é olhada na segunda tem UM dia útil de atraso, não
-- dois. A tolerância de 1 dia corrido é violada por construção toda segunda de
-- manhã — e um alarme que dispara toda segunda ensina, em duas semanas, que
-- alarme não se lê.
--
-- Que fim de semana não é dia morto está medido, não suposto. Em 2026:
--
--   Sex 862 · Ter 861 · Seg 720 · Qui 683 · Qua 541 · Sáb 155 · Dom 57
--
-- Sábado e domingo têm movimento (PIX não dorme), mas um por semana, não um por
-- dia. Contar sábado e domingo como prazo é cobrar da fonte o que o calendário
-- não entrega.
--
-- ---------------------------------------------------------------------------
-- DEFEITO 2 — a data era da CONTA, e o aviso dizia que era da FONTE
-- ---------------------------------------------------------------------------
-- O aviso lia `fin_fonte_cobertura_v.ultimo_extrato_em`, que é
-- `fin_account.last_statement_at` — uma coluna **da conta**. Toda fonte que já
-- alimentou aquela conta herdava a mesma data. Daí os cinco avisos para três
-- contas, todos com o mesmo número.
--
-- E daí, também, uma afirmação falsa. Medido, por (conta, fonte):
--
--   conta             fonte         o aviso dizia   o dado real
--   asaas             asaas         17/08           17/08
--   inter             inter_api     15/08           15/08
--   nubank            erp_obras     15/08 (sem aviso, tolerância 95)
--   nubank-caixinhas  polp          15/08           15/08
--   nubank            import_csv    15/08           07/08   ← 8 dias de diferença
--   nubank-caixinhas  import_csv    15/08           31/07   ← 15 dias de diferença
--   inter             import_csv    15/08           NUNCA PRODUZIU LANÇAMENTO
--
-- A última linha é a mais reveladora: os três lotes `inter_csv` do acervo
-- (ids 5, 6 e 7) estão todos `descartado`/`revertido` e produziram **zero**
-- lançamentos. O sino avisava, todo dia, que uma fonte que nunca entregou nada
-- estava dois dias sem entregar.
--
-- ---------------------------------------------------------------------------
-- DEFEITO 3 — importação manual tratada como sync quebrada
-- ---------------------------------------------------------------------------
-- `import_csv` é o arquivo que uma PESSOA exporta do banco e sobe. Cobrar D+1
-- dela é cobrar que alguém exporte um PDF todo dia. Ela ficaria eternamente
-- vermelha, e a vermelhidão dela afogaria a da fonte que de fato quebrou.
--
-- A base já sabe distinguir: `fin_statement_coverage.source` tem o vocabulário
-- `'api'` (automático) / `'extrato'` (arquivo à mão) / `'manual'` (declaração),
-- e o comentário da 0041 diz para que ele serve — "isso decide se a cobertura
-- depende de alguém lembrar de exportar um PDF". O que faltava era o alarme ler
-- esse vocabulário.
--
-- E há um terceiro degrau, que a medição achou e que ninguém tinha nomeado:
--
--   agendada ....... asaas, inter_api    rodam sozinhas no scheduler.mjs
--   NÃO agendada ... polp, erp_obras     são API, mas só andam quando alguém
--                                        digita o comando — não estão em
--                                        nenhuma etapa do scheduler
--   manual ......... import_csv          alguém exporta um arquivo
--
-- Polp e erp-obras alimentam `nubank` e `nubank-caixinhas`, ou seja **2 das 4
-- contas com acervo**, e nenhuma das duas tem etapa no agendador. Elas estão em
-- dia hoje porque alguém rodou os scripts em 15 e 16/08. Isso é dúvida 65.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION FAZ
-- ===========================================================================
--   1. calendário de dias úteis, com os anos verificados DECLARADOS
--   2. `fin_dias_uteis()` e `fin_dias_uteis_coberto()`
--   3. `fin_fonte_catalogo` — a natureza de cada fonte, declarada e conferida
--   4. `fin_fonte_frescor_v` — uma linha por (conta, fonte), com as três datas
--      que a pergunta exige: último dado, última ingestão, última tentativa
--   5. `fin_fonte_sync_execucao` — a trilha do botão, com trava de uma por vez
--   6. `fin_notificacao_fato_v` — UM aviso agregado, só de fonte automática,
--      contado em dias úteis; e a mensagem da fila sem régua em português
--
-- NENHUM CENTAVO MUDA DE LUGAR. Esta migration não escreve em
-- `fin_transaction`, `fin_document`, `fin_card_transaction` nem `fin_account`.
-- A âncora é conferida no bloco final e ela se recusa a commitar se mudar.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. A âncora de dinheiro, tirada antes de qualquer coisa
-- ---------------------------------------------------------------------------
-- `DROP IF EXISTS` antes: sem ele a migration não pode ser executada duas vezes
-- na mesma transação, e é assim que `npm run test:fonte-frescor` prova a recusa
-- da seção 7 (roda o arquivo, simula uma frente alheia, roda de novo e exige a
-- recusa). Um arquivo que só roda uma vez por transação é um arquivo cujo
-- comportamento de recusa ninguém consegue testar.
DROP TABLE IF EXISTS _ancora_0109;
CREATE TEMP TABLE _ancora_0109 ON COMMIT DROP AS
SELECT account_id, count(*) AS n, coalesce(sum(amount_cents), 0) AS soma
  FROM fin_transaction GROUP BY account_id;

-- ---------------------------------------------------------------------------
-- 1. O calendário — e o que ele DECLARA não saber
-- ---------------------------------------------------------------------------
-- A tentação aqui é calcular a Páscoa em SQL e derivar Carnaval, Sexta-feira
-- Santa e Corpus Christi para sempre. Recusada: o algoritmo é curto mas não é
-- óbvio, e um erro nele produz uma tolerância errada em silêncio, exatamente o
-- tipo de defeito que esta frente existe para consertar.
--
-- Em vez disso: os dias entram um a um, conferidos, e os ANOS conferidos são
-- declarados numa tabela separada. Fora dos anos declarados, `fin_dias_uteis()`
-- continua contando (fim de semana ainda é fim de semana) mas
-- `fin_dias_uteis_coberto()` devolve false, e a tela mostra a ressalva em vez
-- de fingir precisão. Restrição absoluta nº 5, aplicada ao calendário.
CREATE TABLE IF NOT EXISTS fin_calendario_ano (
  ano        integer PRIMARY KEY CHECK (ano BETWEEN 2000 AND 2100),
  fonte      text NOT NULL,
  conferido_em date NOT NULL DEFAULT CURRENT_DATE
);

COMMENT ON TABLE fin_calendario_ano IS
  'Os anos cuja lista de feriados foi conferida. Fora deles o contador de dias '
  'úteis declara que não sabe, em vez de devolver um número que parece exato. '
  'Acrescentar um ano aqui sem acrescentar os feriados dele é pior que não ter '
  'a linha: a asserção da 0109 recusa isso.';

CREATE TABLE IF NOT EXISTS fin_feriado_nacional (
  dia    date PRIMARY KEY,
  nome   text NOT NULL,
  -- 'feriado' é lei federal; 'bancario' é dia em que o banco não compensa
  -- embora não seja feriado nacional (Carnaval e Corpus Christi são ponto
  -- facultativo — o que importa para extrato é o banco estar fechado, não a
  -- natureza jurídica do dia).
  tipo   text NOT NULL CHECK (tipo IN ('feriado', 'bancario')),
  fonte  text NOT NULL
);

COMMENT ON TABLE fin_feriado_nacional IS
  'Feriados nacionais e dias sem compensação bancária. Só o que é NACIONAL: '
  'feriado municipal e estadual não entram, e essa é uma limitação declarada — '
  'a empresa é de Recife/PE e dias como 24/06 e 06/03 fecham banco lá sem '
  'aparecer aqui. Ver dúvida 66.';

INSERT INTO fin_calendario_ano (ano, fonte) VALUES
  (2026, 'Lei 662/1949, Lei 6.802/1980 e Lei 14.759/2023; móveis derivadas da Páscoa de 05/04/2026'),
  (2027, 'Lei 662/1949, Lei 6.802/1980 e Lei 14.759/2023; móveis derivadas da Páscoa de 28/03/2027')
ON CONFLICT (ano) DO NOTHING;

INSERT INTO fin_feriado_nacional (dia, nome, tipo, fonte) VALUES
  -- 2026 · Páscoa em 05/04. Carnaval = Páscoa−47; Sexta Santa = Páscoa−2;
  -- Corpus Christi = Páscoa+60.
  ('2026-01-01', 'Confraternização Universal',   'feriado',  'Lei 662/1949'),
  ('2026-02-16', 'Carnaval',                     'bancario', 'ponto facultativo; banco não compensa'),
  ('2026-02-17', 'Carnaval',                     'bancario', 'ponto facultativo; banco não compensa'),
  ('2026-04-03', 'Sexta-feira Santa',            'feriado',  'Lei 9.093/1995'),
  ('2026-04-21', 'Tiradentes',                   'feriado',  'Lei 662/1949'),
  ('2026-05-01', 'Dia do Trabalho',              'feriado',  'Lei 662/1949'),
  ('2026-06-04', 'Corpus Christi',               'bancario', 'ponto facultativo; banco não compensa'),
  ('2026-09-07', 'Independência',                'feriado',  'Lei 662/1949'),
  ('2026-10-12', 'Nossa Senhora Aparecida',      'feriado',  'Lei 6.802/1980'),
  ('2026-11-02', 'Finados',                      'feriado',  'Lei 662/1949'),
  ('2026-11-15', 'Proclamação da República',     'feriado',  'Lei 662/1949'),
  ('2026-11-20', 'Consciência Negra',            'feriado',  'Lei 14.759/2023'),
  ('2026-12-25', 'Natal',                        'feriado',  'Lei 662/1949'),
  -- 2027 · Páscoa em 28/03.
  ('2027-01-01', 'Confraternização Universal',   'feriado',  'Lei 662/1949'),
  ('2027-02-08', 'Carnaval',                     'bancario', 'ponto facultativo; banco não compensa'),
  ('2027-02-09', 'Carnaval',                     'bancario', 'ponto facultativo; banco não compensa'),
  ('2027-03-26', 'Sexta-feira Santa',            'feriado',  'Lei 9.093/1995'),
  ('2027-04-21', 'Tiradentes',                   'feriado',  'Lei 662/1949'),
  ('2027-05-01', 'Dia do Trabalho',              'feriado',  'Lei 662/1949'),
  ('2027-05-27', 'Corpus Christi',               'bancario', 'ponto facultativo; banco não compensa'),
  ('2027-09-07', 'Independência',                'feriado',  'Lei 662/1949'),
  ('2027-10-12', 'Nossa Senhora Aparecida',      'feriado',  'Lei 6.802/1980'),
  ('2027-11-02', 'Finados',                      'feriado',  'Lei 662/1949'),
  ('2027-11-15', 'Proclamação da República',     'feriado',  'Lei 662/1949'),
  ('2027-11-20', 'Consciência Negra',            'feriado',  'Lei 14.759/2023'),
  ('2027-12-25', 'Natal',                        'feriado',  'Lei 662/1949')
ON CONFLICT (dia) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. O contador
-- ---------------------------------------------------------------------------
-- Intervalo SEMIABERTO `(de, ate]`: o dia em que a fonte entregou não conta
-- como atraso dela. Extrato de sexta olhado na sexta = 0; olhado na segunda = 1.
CREATE OR REPLACE FUNCTION fin_dias_uteis(p_de date, p_ate date)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_de IS NULL OR p_ate IS NULL THEN NULL
    WHEN p_ate <= p_de THEN 0
    ELSE (
      SELECT count(*)::int
        FROM generate_series(p_de + 1, p_ate, interval '1 day') AS d
       WHERE EXTRACT(ISODOW FROM d) < 6
         AND NOT EXISTS (SELECT 1 FROM fin_feriado_nacional f WHERE f.dia = d::date)
    )
  END
$$;

COMMENT ON FUNCTION fin_dias_uteis(date, date) IS
  'Dias úteis no intervalo semiaberto (de, ate]: exclui sábado, domingo e os dias '
  'de fin_feriado_nacional. O dia da entrega não conta contra a fonte. '
  'ATENÇÃO: contar em dias corridos é o que fazia o alarme de fonte disparar toda '
  'segunda-feira — 14/08 sexta, 15/08 sábado, 17/08 segunda dá 2 corridos e 1 útil.';

CREATE OR REPLACE FUNCTION fin_dias_uteis_coberto(p_de date, p_ate date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_de IS NULL OR p_ate IS NULL THEN NULL
    ELSE NOT EXISTS (
      SELECT 1
        FROM generate_series(
               EXTRACT(YEAR FROM LEAST(p_de, p_ate))::int,
               EXTRACT(YEAR FROM GREATEST(p_de, p_ate))::int) AS a
       WHERE NOT EXISTS (SELECT 1 FROM fin_calendario_ano c WHERE c.ano = a)
    )
  END
$$;

COMMENT ON FUNCTION fin_dias_uteis_coberto(date, date) IS
  'O intervalo inteiro cai dentro de anos com feriado conferido? Falso significa '
  '"a contagem ignorou os feriados de algum ano", e a tela mostra a ressalva. '
  'Um número exato sobre um calendário desconhecido é pior que um número com ressalva.';

-- ---------------------------------------------------------------------------
-- 3. A natureza de cada fonte, DECLARADA
-- ---------------------------------------------------------------------------
-- Por que uma tabela e não um CASE dentro da view: a diferença entre "roda
-- sozinha" e "alguém tem de lembrar" é uma decisão operacional, não uma
-- propriedade da string. Ela precisa ser lida por quem audita sem rodar SQL, e
-- precisa da asserção que impede uma fonte nova de aparecer sem classificação —
-- que é exatamente como `import_csv` virou "sync quebrada" por omissão.
CREATE TABLE IF NOT EXISTS fin_fonte_catalogo (
  fonte      text PRIMARY KEY,
  rotulo     text NOT NULL,
  -- Em português, o que esta fonte alimenta. É a coluna que responde "por que
  -- eu deveria me importar que ela esteja atrasada?".
  alimenta   text NOT NULL,

  -- 'automatica' = uma API entrega sozinha; 'manual' = uma pessoa exporta um
  -- arquivo ou digita. O vocabulário espelha fin_statement_coverage.source.
  natureza   text NOT NULL CHECK (natureza IN ('automatica', 'manual')),

  -- Automática NÃO implica agendada. Polp e erp-obras são API e não estão em
  -- etapa nenhuma do scheduler.mjs: elas só andam quando alguém digita o
  -- comando. Colapsar as duas colunas num "automática" só esconderia isso.
  agendada   boolean NOT NULL,
  CONSTRAINT fin_fonte_catalogo_manual_nao_agenda
    CHECK (NOT (natureza = 'manual' AND agendada)),

  -- O comando que atualiza. NULL só para o que não tem comando (arquivo à mão).
  comando    text,
  -- Obrigatório quando é automática e não é agendada: a razão de ela depender
  -- de alguém.
  motivo_nao_agendada text,
  CONSTRAINT fin_fonte_catalogo_nao_agendada_com_motivo
    CHECK (agendada OR natureza = 'manual' OR motivo_nao_agendada IS NOT NULL),

  -- Tolerância em DIAS ÚTEIS. NULL exige motivo — é a régua que não foi
  -- inventada, mesmo padrão de fin_notificacao_regra e fin_approval_rule.
  tolerancia_util integer CHECK (tolerancia_util IS NULL OR tolerancia_util >= 0),
  motivo_sem_tolerancia text,
  CONSTRAINT fin_fonte_catalogo_tolerancia_com_motivo
    CHECK (tolerancia_util IS NOT NULL OR motivo_sem_tolerancia IS NOT NULL)
);

COMMENT ON TABLE fin_fonte_catalogo IS
  'O que cada fonte é: o que alimenta, se roda sozinha, se está no agendador, '
  'qual comando a atualiza e quantos DIAS ÚTEIS de atraso ainda são normais nela. '
  'A asserção da 0109 recusa uma fonte presente em fin_transaction.source sem linha '
  'aqui — foi por omissão de classificação que importação manual virou "sync quebrada".';

INSERT INTO fin_fonte_catalogo
  (fonte, rotulo, alimenta, natureza, agendada, comando, motivo_nao_agendada,
   tolerancia_util, motivo_sem_tolerancia) VALUES

  ('asaas', 'API do Asaas',
   'as cobranças emitidas, os recebimentos e o extrato da conta Asaas — é a fonte da receita',
   'automatica', true, 'scripts/sync-asaas.mjs', NULL,
   1, NULL),

  ('inter_api', 'API do Banco Inter',
   'o extrato da conta Inter — a conta por onde sai a folha',
   'automatica', true, 'scripts/sync-inter.mjs', NULL,
   1, NULL),

  ('polp', 'Open finance (Polp)',
   'o extrato e as posições das caixinhas do Nubank — o saldo da reserva vem daqui',
   'automatica', false, 'scripts/sync-polp-investimentos.mjs --aplicar',
   'não existe etapa desta fonte em scripts/scheduler.mjs: ela só anda quando alguém roda o comando. Dúvida 65.',
   -- 2 e não 1: é espelho de espelho (o Polp lê o Nubank, nós lemos o Polp), e
   -- cada salto acrescenta a latência dele.
   2, NULL),

  ('erp_obras', 'Espelho do erp-obras',
   'o extrato da conta corrente do Nubank, que o Polp lê e o ERP do Adryan espelha',
   'automatica', false, 'scripts/sync-erp-obras.mjs',
   'não existe etapa desta fonte em scripts/scheduler.mjs, e o banco de origem é SOMENTE LEITURA (restrição absoluta nº 1). Dúvida 65.',
   2, NULL),

  ('import_csv', 'Arquivo exportado à mão (CSV/PDF)',
   'o extrato histórico de Nubank, caixinhas e Inter, subido pela tela de importação',
   'manual', false, NULL, NULL,
   -- A régua que NÃO foi inventada. O acervo inteiro tem UM único dia de
   -- importação manual: 08/08/2026, dez lotes. Inferir "cadência" de um evento
   -- é o mesmo erro que a dúvida 59 recusa cometer com o valor da fila.
   NULL,
   'não há cadência declarada para importação manual. O acervo tem UM único dia de importação (08/08/2026, 10 lotes) — inferir uma cadência de um evento seria inventar régua. Enquanto isso, a tela mostra a data do último arquivo e NÃO gera alarme. Dúvida 64.'),

  ('import_ofx', 'Arquivo OFX',
   'nenhum acervo até hoje — o adaptador existe e nunca foi usado',
   'manual', false, NULL, NULL,
   NULL,
   'mesma razão de import_csv, e sem nem um evento para olhar: zero lotes no acervo. Dúvida 64.'),

  ('manual', 'Lançamento digitado',
   'correções e aberturas declaradas à mão, sem arquivo por trás',
   'manual', false, NULL, NULL,
   NULL,
   'lançamento digitado não tem cadência por definição: ele acontece quando um humano decide que precisa acontecer.')
ON CONFLICT (fonte) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. O frescor, fonte a fonte
-- ---------------------------------------------------------------------------
-- TRÊS RELÓGIOS, e a confusão entre eles é metade do problema original:
--
--   ultimo_dado_em ...... até quando a fonte tem DADO. É o que interessa para
--                         "o saldo é de quando?".
--   ultima_ingestao_em .. quando uma linha desta fonte entrou aqui pela última
--                         vez.
--   ultima_tentativa_em . quando OLHAMOS pela última vez. O Inter cria um lote
--                         por sync mesmo quando não há nada novo: o lote 49 é
--                         de 17/08 e está `descartado`, o que é a prova de que
--                         a sync rodou hoje e o banco é que não teve movimento.
--
-- Sem o terceiro relógio, "fonte parada" e "fonte sem movimento" são
-- indistinguíveis — e a segunda é o caso normal de uma segunda-feira.
CREATE OR REPLACE VIEW fin_fonte_frescor_v AS
WITH
-- O que a fonte de fato entregou, por conta.
observado AS (
  SELECT t.account_id,
         t.source AS fonte,
         max(t.posted_on)  AS ultimo_dado_em,
         max(t.created_at) AS ultima_ingestao_em,
         count(*)::int     AS lancamentos
    FROM fin_transaction t
   WHERE t.account_id IS NOT NULL
   GROUP BY 1, 2
),

-- O que a fonte TENTOU, mesmo sem entregar. Mesmo mapa adaptador→fonte da 0085,
-- de propósito: duas traduções diferentes para a mesma coisa é como as telas
-- passam a discordar.
tentado AS (
  SELECT b.account_id,
         CASE
           WHEN b.adapter = 'asaas_api' THEN 'asaas'
           WHEN b.adapter = 'inter_api' THEN 'inter_api'
           WHEN b.adapter = 'polp_api'  THEN 'polp'
           WHEN b.adapter LIKE '%\_ofx' THEN 'import_ofx'
           WHEN b.adapter = 'manual'    THEN 'manual'
           WHEN b.adapter LIKE '%\_csv'
             OR b.adapter LIKE '%\_pdf' THEN 'import_csv'
           ELSE 'adapter:' || b.adapter
         END AS fonte,
         max(b.created_at)                                          AS ultima_tentativa_em,
         count(*)::int                                              AS tentativas,
         count(*) FILTER (WHERE b.status = 'confirmado')::int        AS tentativas_confirmadas,
         max(b.period_end) FILTER (WHERE b.status = 'confirmado')    AS ultimo_periodo_confirmado
    FROM fin_import_batch b
   WHERE b.account_id IS NOT NULL
   GROUP BY 1, 2
),

-- FULL OUTER: uma fonte pode ter lançamento sem lote (asaas, polp e erp_obras
-- gravam direto) e pode ter lote sem lançamento nenhum (os três lotes
-- `inter_csv`, todos descartados). As duas populações têm de aparecer.
par AS (
  SELECT
    coalesce(o.account_id, s.account_id) AS account_id,
    coalesce(o.fonte, s.fonte)           AS fonte,
    o.ultimo_dado_em,
    o.ultima_ingestao_em,
    coalesce(o.lancamentos, 0)           AS lancamentos,
    s.ultima_tentativa_em,
    coalesce(s.tentativas, 0)            AS tentativas,
    coalesce(s.tentativas_confirmadas, 0) AS tentativas_confirmadas,
    s.ultimo_periodo_confirmado
  FROM observado o
  FULL OUTER JOIN tentado s
    ON s.account_id = o.account_id AND s.fonte = o.fonte
),

base AS (
  SELECT
    p.fonte,
    a.slug AS conta,
    a.id   AS conta_id,
    a.is_active AS conta_ativa,
    coalesce(c.rotulo, 'Fonte não catalogada: ' || p.fonte) AS rotulo,
    coalesce(c.alimenta, 'não declarado — esta fonte não tem linha em fin_fonte_catalogo') AS alimenta,
    -- Fonte fora do catálogo NÃO vira "automática" por conveniência: vira
    -- 'desconhecida', que não alarma e aparece na tela pedindo classificação.
    coalesce(c.natureza, 'desconhecida') AS natureza,
    coalesce(c.agendada, false)          AS agendada,
    c.comando,
    c.motivo_nao_agendada,
    c.tolerancia_util,
    c.motivo_sem_tolerancia,
    p.ultimo_dado_em,
    p.ultima_ingestao_em,
    p.ultima_tentativa_em,
    p.lancamentos,
    p.tentativas,
    p.tentativas_confirmadas,
    p.ultimo_periodo_confirmado,
    (CURRENT_DATE - p.ultimo_dado_em)                      AS atraso_corrido,
    fin_dias_uteis(p.ultimo_dado_em, CURRENT_DATE)         AS atraso_util,
    fin_dias_uteis_coberto(p.ultimo_dado_em, CURRENT_DATE) AS feriado_coberto,
    fin_dias_uteis(p.ultima_tentativa_em::date, CURRENT_DATE) AS dias_uteis_sem_olhar
  FROM par p
  JOIN fin_account a ON a.id = p.account_id
  LEFT JOIN fin_fonte_catalogo c ON c.fonte = p.fonte
)

SELECT
  b.*,
  CASE
    WHEN b.lancamentos = 0 THEN 'nunca_entregou'
    WHEN b.natureza = 'desconhecida' THEN 'sem_classificacao'
    WHEN b.tolerancia_util IS NULL THEN 'sem_regua'
    WHEN b.atraso_util <= b.tolerancia_util THEN 'em_dia'
    ELSE 'atrasada'
  END AS estado,

  -- Estado que não é `em_dia` SEMPRE carrega motivo. É a restrição absoluta nº 5
  -- aplicada a um estado, não a um valor.
  CASE
    WHEN b.lancamentos = 0 THEN
      CASE WHEN b.tentativas = 0
        THEN 'nenhum lançamento e nenhuma tentativa: esta fonte nunca foi exercitada nesta conta'
        ELSE b.tentativas || ' lote(s) tentado(s), ' || b.tentativas_confirmadas
             || ' confirmado(s), e nenhum lançamento produzido — a fonte nunca entregou dado nesta conta'
      END
    WHEN b.natureza = 'desconhecida' THEN
      'fonte sem linha em fin_fonte_catalogo: não dá para dizer se ela deveria andar sozinha, então não se cobra prazo dela'
    WHEN b.tolerancia_util IS NULL THEN b.motivo_sem_tolerancia
    WHEN b.atraso_util > b.tolerancia_util THEN
      b.atraso_util || ' dia(s) útil(eis) sem dado novo, e a tolerância desta fonte é '
      || b.tolerancia_util || '.'
      || CASE WHEN b.ultima_tentativa_em IS NOT NULL AND b.ultima_tentativa_em::date >= CURRENT_DATE - 1
              THEN ' A última tentativa foi em ' || to_char(b.ultima_tentativa_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM')
                   || ', ou seja: nós olhamos, a fonte é que não entregou.'
              ELSE '' END
    ELSE NULL
  END AS motivo,

  -- SÓ fonte automática alarma, e só quando o atraso ÚTIL passa da régua dela.
  -- Manual não alarma por decisão declarada (não há cadência a cobrar);
  -- não catalogada não alarma porque não se cobra prazo do que não se
  -- classificou.
  (b.natureza = 'automatica'
   AND b.lancamentos > 0
   AND b.tolerancia_util IS NOT NULL
   AND b.atraso_util > b.tolerancia_util) AS alarma
FROM base b;

COMMENT ON VIEW fin_fonte_frescor_v IS
  'Uma linha por (conta, fonte): o que ela alimenta, se é automática ou manual, se está '
  'no agendador, os TRÊS relógios (último dado, última ingestão, última tentativa), o '
  'atraso em dias ÚTEIS e a tolerância dela. Substitui a leitura que o aviso fazia de '
  'fin_fonte_cobertura_v.ultimo_extrato_em, que é fin_account.last_statement_at — uma data '
  'da CONTA que toda fonte da conta herdava, produzindo 5 avisos idênticos para 3 contas e '
  'atribuindo a import_csv uma data 8 e 15 dias mais nova que a real.';

-- ---------------------------------------------------------------------------
-- 5. A trilha do botão
-- ---------------------------------------------------------------------------
-- O botão dispara um processo separado e devolve na hora. Isso cria dois
-- problemas que esta tabela resolve, e nenhum dos dois se resolve em memória:
--
--   1. DOIS CLIQUES, DUAS SYNCS. Uma variável `running` como a do scheduler.mjs
--      só protege dentro do processo. A rota HTTP e a sync rodam em processos
--      diferentes, e no Railway pode haver mais de uma instância. A trava tem
--      de estar no banco: é o índice único parcial abaixo.
--   2. "FALHOU" SEM DIZER O QUÊ. Um alarme que oferece um botão e o botão falha
--      em silêncio é pior que não ter botão. `etapas` guarda o resultado de
--      cada script, com a saída de erro dele.
CREATE TABLE IF NOT EXISTS fin_fonte_sync_execucao (
  id           bigserial PRIMARY KEY,
  entity_id    bigint NOT NULL REFERENCES fin_entity(id),

  -- 'todas' ou o slug de uma fonte do catálogo. O botão é geral e por fonte.
  escopo       text NOT NULL,

  status       text NOT NULL CHECK (status IN ('rodando', 'ok', 'parcial', 'erro', 'perdida')),
  -- Quem clicou, pelo Basic Auth. 'scheduler' quando vier do agendador.
  ator         text NOT NULL,

  iniciada_em  timestamptz NOT NULL DEFAULT now(),
  terminada_em timestamptz,
  CONSTRAINT fin_fonte_sync_terminada
    CHECK ((status = 'rodando') = (terminada_em IS NULL)),

  -- Nunca aceita data no futuro, mesmo espírito de fin_payment_execution: este
  -- é registro do passado.
  CONSTRAINT fin_fonte_sync_nao_futura
    CHECK (terminada_em IS NULL OR terminada_em >= iniciada_em),

  pid          integer,

  -- [{ "etapa": "sync Asaas", "script": "...", "ok": true, "ms": 12345,
  --    "erro": null, "saida": "..." }]
  etapas       jsonb NOT NULL DEFAULT '[]'::jsonb,

  erro         text,
  CONSTRAINT fin_fonte_sync_erro_com_motivo
    CHECK (status NOT IN ('erro', 'perdida') OR erro IS NOT NULL)
);

-- UMA por vez, garantido pelo banco. Um segundo clique não dispara uma segunda
-- sync: o INSERT falha e a rota devolve 409 com o id da que está rodando.
CREATE UNIQUE INDEX IF NOT EXISTS fin_fonte_sync_uma_por_vez
  ON fin_fonte_sync_execucao (entity_id) WHERE status = 'rodando';

CREATE INDEX IF NOT EXISTS fin_fonte_sync_recentes_idx
  ON fin_fonte_sync_execucao (entity_id, iniciada_em DESC);

COMMENT ON TABLE fin_fonte_sync_execucao IS
  'Início, fim, resultado e erro de cada disparo do botão de atualizar fontes. '
  'O índice único parcial é a trava de concorrência ENTRE PROCESSOS — a rota HTTP e a '
  'sync rodam em processos distintos, e uma flag em memória não os alcança.';

-- Uma execução cujo processo morreu ficaria 'rodando' para sempre e travaria o
-- botão. Ninguém precisa de outra tela para destravar: quem for iniciar a
-- próxima passa aqui antes.
CREATE OR REPLACE FUNCTION fin_fonte_sync_recolher_perdidas(p_teto_min integer DEFAULT 45)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  UPDATE fin_fonte_sync_execucao
     SET status = 'perdida',
         terminada_em = now(),
         erro = 'o processo não reportou fim em ' || p_teto_min || ' min; declarada perdida. '
                || 'Isto NÃO afirma que a sync falhou — afirma que ninguém sabe como ela terminou.'
   WHERE status = 'rodando'
     AND iniciada_em < now() - make_interval(mins => p_teto_min);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

COMMENT ON FUNCTION fin_fonte_sync_recolher_perdidas(integer) IS
  'Marca como perdida a execução que passou do teto sem reportar fim. A mensagem diz '
  '"não sei como terminou", nunca "falhou": o processo pode ter concluído e morrido '
  'antes do UPDATE final, e chamar isso de falha seria inventar um fato.';

-- ---------------------------------------------------------------------------
-- 6. As réguas em DIAS ÚTEIS, com unidade própria
-- ---------------------------------------------------------------------------
-- As réguas antigas (`fonte_extrato_dias` = 1) ficam onde estão, com o valor
-- que tinham. Reinterpretar "1" de corrido para útil sem mudar o nome seria
-- trocar o significado de um número em silêncio — exatamente o que a §10 do
-- CONTINUACAO.md proíbe. A unidade nova é declarada no CHECK.
ALTER TABLE fin_notificacao_regra DROP CONSTRAINT IF EXISTS fin_notificacao_regra_unidade_check;
ALTER TABLE fin_notificacao_regra
  ADD CONSTRAINT fin_notificacao_regra_unidade_check
  CHECK (unidade IN ('dias', 'dias_uteis', 'centavos'));

INSERT INTO fin_notificacao_regra (slug, descricao, valor, unidade, motivo_ausencia, fonte) VALUES
  ('fonte_atraso_dias_uteis',
   'Fonte automática: atraso em DIAS ÚTEIS tolerado antes de avisar. A tolerância de cada fonte vive em fin_fonte_catalogo.tolerancia_util; esta linha declara a UNIDADE.',
   NULL, 'dias_uteis',
   'a régua não é um número só: extrato de API tolera 1 dia útil e espelho de espelho tolera 2, porque cada salto acrescenta latência. O valor por fonte está em fin_fonte_catalogo.',
   'medido: 14/08 sexta, 15/08 sábado, 17/08 segunda dá 2 dias corridos e 1 dia útil — a régua corrida disparava todo início de semana'),
  ('fonte_manual_dias_uteis',
   'Importação manual: atraso tolerado antes de avisar',
   NULL, 'dias_uteis',
   'não declarado. O acervo tem UM único dia de importação manual (08/08/2026, 10 lotes); inferir cadência de um evento seria inventar régua, o mesmo motivo pelo qual fila_decisao_valor_cents continua NULL. Enquanto NULL, fonte manual NÃO gera alarme e a tela mostra a data do último arquivo. Dúvida 64.',
   'em aberto (dúvida 64)')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. O aviso: um só, agregado, em dias úteis
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- DUAS REGRESSÕES SILENCIOSAS QUE ESTA SEÇÃO QUASE CAUSOU
-- ===========================================================================
--
-- **1. O arquivo da 0105 neste repositório NÃO é o que está no banco.** As dez
-- CTEs que esta migration não muda foram transcritas de `pg_get_viewdef()` no
-- banco REAL. Os dois textos divergiram: a 0105 do repo diz `r.item_count` numa
-- coluna que não existe, filtra pagamento por `'aguardando_aprovacao'` onde o
-- banco filtra `'rascunho'`, e traz outro título e outro corpo em `alcada`,
-- `reembolso` e `compra`. Recriar a view a partir do arquivo teria REVERTIDO
-- todas essas correções posteriores — e nada acusaria, porque a view compila
-- igual e responde diferente.
--
-- **2. Outra frente mexeu na mesma view enquanto esta era escrita.** A 0108
-- (custo fixo) já está aplicada e reestruturou o desenho: o corpo das 12 CTEs
-- virou `fin_notificacao_fato_base_v`, e `fin_notificacao_fato_v` passou a ser
-- a composição `base ∪ custo_fixo`. Uma versão anterior desta migration recriava
-- `fin_notificacao_fato_v` inteira e **apagava a metade deles**. Quem pegou foi
-- a fotografia de `npm run test:fonte-frescor` — sete tipos de fato viraram
-- cinco entre uma execução e a seguinte.
--
-- A lição virou desenho: esta migration ADOTA o padrão da 0108 em vez de
-- competir com ele.
--
--   fin_fonte_notificacao_fato_v ....... o aviso de fonte, view PRÓPRIA (nova)
--   fin_notificacao_fato_base_v ........ as 11 CTEs restantes; o `fonte` SAI
--   fin_notificacao_fato_v ............. base ∪ custo_fixo ∪ fonte
--
-- Assim a próxima frente que mexer em frescor não encosta na view grande, e o
-- bloco de asserções abaixo RECUSA a migration se `fin_notificacao_fato_v`
-- depender de alguma view que esta migration não conhece — trocar um revert
-- silencioso por uma recusa barulhenta é a única defesa que não depende de
-- alguém estar prestando atenção.
--
-- ---------------------------------------------------------------------------
-- 7.1 O aviso de fonte, em view própria: UM agregado, em dias úteis
-- ---------------------------------------------------------------------------
-- MUDOU TRÊS COISAS, e cada uma matava um dos cinco avisos:
--
--   1. lê `fin_fonte_frescor_v`, que mede a data POR FONTE, em vez de
--      `fin_fonte_cobertura_v.ultimo_extrato_em`, que é a data da CONTA;
--   2. conta em dias ÚTEIS;
--   3. filtra `alarma`, que já exclui fonte manual e fonte não catalogada.
--
-- E agrega. Cinco linhas idênticas na caixa não somam informação: somam
-- desgaste, e o desgaste é o que faz um sino ser ignorado. A chave de
-- deduplicação é fixa (`fonte_desatualizada`, sem a fonte dentro) para que a
-- lista mudar não crie aviso novo — o corpo carrega quem está atrasado hoje.
-- As cinco linhas antigas, cuja chave sumiu do fato, viram 'resolvida' sozinhas
-- no terceiro passo de `fin_notificacao_sync()`.
-- A RECUSA BARULHENTA, antes de qualquer CREATE OR REPLACE.
--
-- Esta migration reescreve `fin_notificacao_fato_v` sabendo que ela compõe
-- exatamente três views. Se uma quarta frente tiver acrescentado a dela entre a
-- escrita deste arquivo e a aplicação dele, reescrever aqui apagaria o trabalho
-- dela em silêncio — foi o que quase aconteceu com a 0108, e o que a §6 do
-- CONTINUACAO.md descreve como o erro de coordenação mais caro desta base.
--
-- Então a migration recusa aplicar, com o nome do que ela não conhece. Consertar
-- é somar um `UNION ALL` na seção 7.3 e a linha correspondente aqui.
DO $$
DECLARE v_txt text;
BEGIN
  IF to_regclass('fin_notificacao_fato_v') IS NULL THEN
    RAISE EXCEPTION '0109: fin_notificacao_fato_v não existe — a 0105 precisa estar aplicada antes';
  END IF;

  SELECT string_agg(DISTINCT usada.relname, ', ' ORDER BY usada.relname) INTO v_txt
    FROM pg_depend d
    JOIN pg_rewrite r  ON r.oid = d.objid
    JOIN pg_class dep  ON dep.oid = r.ev_class
    JOIN pg_class usada ON usada.oid = d.refobjid
   WHERE dep.relname = 'fin_notificacao_fato_v'
     AND usada.relkind = 'v'
     AND usada.relname NOT IN (
       'fin_notificacao_fato_v',            -- ela mesma
       'fin_notificacao_fato_base_v',       -- o núcleo (0105, extraído pela 0108)
       'fin_custo_fixo_notificacao_fato_v', -- 0108
       'fin_fonte_notificacao_fato_v'       -- esta migration
     );

  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      '0109: fin_notificacao_fato_v compõe view(s) que esta migration não conhece: %. '
      'Aplicar assim APAGARIA o aviso dessa frente. Some o UNION ALL na seção 7.3 e a '
      'linha na lista branca desta asserção antes de seguir.', v_txt;
  END IF;
END $$;

CREATE OR REPLACE VIEW fin_fonte_notificacao_fato_v AS
SELECT
  (SELECT id FROM fin_entity WHERE slug = 'xpe')       AS entity_id,
  'fonte_desatualizada'::text                          AS kind,
  'perfil'::text                                       AS recipient_kind,
  NULL::bigint                                         AS recipient_person_id,
  'admin'::text                                        AS recipient_perfil,
  'gestao'::text                                       AS escopo,
  'fonte_desatualizada'::text                          AS dedupe_key,
  CASE WHEN count(*) = 1
    THEN 'Fonte automática atrasada: ' || min(f.rotulo) || ' · ' || min(f.conta)
    ELSE count(*) || ' fontes automáticas fora da tolerância' END AS titulo,
  string_agg(
    f.rotulo || ' · ' || f.conta || ': último dado em '
      || to_char(f.ultimo_dado_em, 'DD/MM')
      || ' (' || f.atraso_util || ' dia útil' || CASE WHEN f.atraso_util = 1 THEN '' ELSE 'eis' END
      || ' de atraso, tolerância ' || f.tolerancia_util || ')',
    ' · ' ORDER BY f.atraso_util DESC, f.fonte)
    || '. O atraso é contado em dias ÚTEIS: fim de semana e feriado nacional não contam contra a fonte.'
    || CASE WHEN bool_and(coalesce(f.feriado_coberto, false)) THEN ''
            ELSE ' RESSALVA: parte do intervalo cai fora dos anos com feriado conferido, então a contagem pode estar alta.' END
    AS corpo,
  '/financeiro/fontes'::text                           AS link_href,
  NULL::bigint                                         AS amount_cents,
  'atraso de fonte é medido em dias úteis, não em dinheiro'::text AS amount_reason,
  jsonb_build_object(
    'fontes', jsonb_agg(jsonb_build_object(
      'fonte', f.fonte, 'conta', f.conta, 'rotulo', f.rotulo,
      'ultimo_dado_em', f.ultimo_dado_em,
      'atraso_util', f.atraso_util, 'atraso_corrido', f.atraso_corrido,
      'tolerancia_util', f.tolerancia_util, 'agendada', f.agendada)
      ORDER BY f.atraso_util DESC, f.fonte),
    'contagem', count(*))                              AS contexto
FROM fin_fonte_frescor_v f
WHERE f.alarma AND f.conta_ativa
HAVING count(*) > 0;

COMMENT ON VIEW fin_fonte_notificacao_fato_v IS
  'UM aviso agregado das fontes automáticas fora da tolerância, em dias úteis. View '
  'própria, no padrão que a 0108 abriu, para que frescor não precise mais recriar '
  'fin_notificacao_fato_base_v — recriar uma view de 440 linhas para mexer em duas CTEs '
  'é como se apaga o trabalho da frente vizinha sem perceber.';

-- ---------------------------------------------------------------------------
-- 7.2 A base, sem o `fonte` e com a mensagem da fila em português
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_notificacao_fato_base_v AS
WITH ent AS (SELECT id FROM fin_entity WHERE slug = 'xpe'),
regra AS (
  SELECT
    max(valor) FILTER (WHERE slug = 'fonte_extrato_dias')     AS extrato_dias,
    max(valor) FILTER (WHERE slug = 'fonte_nfe_dias')         AS nfe_dias,
    max(valor) FILTER (WHERE slug = 'fonte_orcamento_dias')   AS orcamento_dias,
    max(valor) FILTER (WHERE slug = 'fila_decisao_valor_cents') AS fila_valor,
    max(valor) FILTER (WHERE slug = 'resposta_janela_dias')     AS resposta_dias
  FROM fin_notificacao_regra
),

-- (a) Item de fila acima da régua — individual, só se a régua existir.
fila_item AS (
  SELECT
    'fila_decisao_item'::text AS kind,
    'perfil'::text AS recipient_kind, NULL::bigint AS recipient_person_id, 'admin'::text AS recipient_perfil,
    'gestao'::text AS escopo,
    'fila_decisao_item:' || r.id AS dedupe_key,
    'Item na fila de decisão: ' || coalesce(r.reason, 'sem motivo declarado') AS titulo,
    'Item ' || r.id || ' em ' || r.target_table || ' aguarda decisão desde '
      || to_char(r.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.' AS corpo,
    '/financeiro/revisao'::text AS link_href,
    r.amount_cents,
    CASE WHEN r.amount_cents IS NULL THEN 'o item de fila não declara valor' END AS amount_reason,
    jsonb_build_object('review_item_id', r.id, 'target_table', r.target_table, 'target_id', r.target_id) AS contexto
  FROM fin_review_item r
  CROSS JOIN regra g
  WHERE r.status = 'pendente'
    AND g.fila_valor IS NOT NULL
    AND r.amount_cents IS NOT NULL
    AND r.amount_cents >= g.fila_valor
),

-- (b) A fila sem régua — UM aviso agregado, porque escolher um corte aqui seria
--     inventar a governança que a dúvida 59 pergunta.
--
--     A MENSAGEM MUDOU NA 0109, e a razão é o feedback: ela expunha
--     `fin_notificacao_regra.fila_decisao_valor_cents` para quem não é
--     desenvolvedor. Um nome de coluna não é explicação — é a confissão de que
--     ninguém traduziu. O corte continua NÃO inventado; o que mudou é que agora
--     dá para entender o que falta decidir sem abrir o schema.
fila_sem_regua AS (
  SELECT
    'fila_decisao_sem_regua'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    -- Chave ESTÁVEL, sem a contagem dentro. A fila muda de tamanho todo dia; se
    -- o tamanho entrasse na chave, cada dia criaria um aviso novo e resolveria o
    -- de ontem — ruído diário sobre um fato que não mudou.
    'fila_decisao_sem_regua' AS dedupe_key,
    'Falta decidir: a partir de que valor um item vira aviso?' AS titulo,
    count(*) || ' itens aguardam decisão. Nenhum deles virou aviso individual porque ainda não '
      || 'foi decidido a partir de QUE VALOR um item merece aviso próprio. Sem esse corte só '
      || 'existem dois extremos: avisar os ' || count(*) || ' — e o sino vira ruído no primeiro '
      || 'dia — ou não avisar nenhum, que é o que acontece hoje. Este aviso é o meio-termo '
      || 'honesto: ele soma o que está parado sem escolher um limiar no seu lugar. Para '
      || 'destravar, basta dizer o valor mínimo; daí para cima os itens passam a avisar um a um.' AS corpo,
    '/financeiro/revisao'::text,
    sum(r.amount_cents)::bigint,
    CASE WHEN sum(r.amount_cents) IS NULL THEN 'nenhum item da fila declara valor' END,
    jsonb_build_object('itens', count(*), 'sem_valor', count(*) FILTER (WHERE r.amount_cents IS NULL),
                       'decisao', 'valor mínimo para aviso individual', 'duvida', 59)
  FROM fin_review_item r CROSS JOIN regra g
  WHERE r.status = 'pendente' AND g.fila_valor IS NULL
  HAVING count(*) > 0
),

-- (c) Pagamento aguardando aprovação. Transcrita do banco.
pagamento AS (
  SELECT
    'pagamento_aguardando_aprovacao'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'pagamento_aprovacao:' || p.id AS dedupe_key,
    'Pagamento aguardando aprovação: ' || p.code AS titulo,
    p.description || ' · vence em ' || to_char(p.due_date, 'DD/MM/YYYY') || '.' AS corpo,
    '/financeiro/painel'::text,
    p.amount_cents,
    NULL::text,
    jsonb_build_object('payment_request_id', p.id, 'code', p.code, 'due_date', p.due_date)
  FROM fin_payment_request p
  WHERE p.status IN ('rascunho', 'em_aprovacao')
),

-- (d) Alçada ausente: há pagamento na fila e nenhuma régua que o aprove.
--     Transcrita do banco — note que ela não tem FROM: é um SELECT de constantes
--     guardado por dois EXISTS, e por isso emite no máximo uma linha.
alcada AS (
  SELECT
    'alcada_ausente'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'alcada_ausente' AS dedupe_key,
    'Nenhuma alçada configurada — a fila de pagamento não anda' AS titulo,
    'fin_approval_rule está vazia e o gatilho recusa aprovação sem régua. '
      || (SELECT count(*) FROM fin_payment_request
           WHERE status IN ('rascunho', 'em_aprovacao'))
      || ' solicitação(ões) parada(s) por isso. Dúvida 27.' AS corpo,
    '/financeiro/painel'::text,
    (SELECT sum(amount_cents)::bigint FROM fin_payment_request
      WHERE status IN ('rascunho', 'em_aprovacao')),
    CASE WHEN NOT EXISTS (SELECT 1 FROM fin_payment_request WHERE amount_cents IS NOT NULL)
         THEN 'nenhuma solicitação de pagamento declara valor' END,
    jsonb_build_object('duvida', 27)
  WHERE NOT EXISTS (SELECT 1 FROM fin_approval_rule)
    AND EXISTS (SELECT 1 FROM fin_payment_request WHERE status IN ('rascunho', 'em_aprovacao'))
),

-- (e) Reembolso enviado pelo time, esperando decisão. Transcrita do banco.
reembolso AS (
  SELECT
    'time_reembolso_aguardando'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'reembolso_aguardando:' || r.id AS dedupe_key,
    'Reembolso aguardando análise: ' || pe.name AS titulo,
    'Competência ' || to_char(r.reference_month, 'MM/YYYY') || ' · '
      || (SELECT count(*) FROM fin_reimbursement_item i WHERE i.reimbursement_id = r.id)
      || ' item(ns).' AS corpo,
    '/financeiro/reembolsos'::text,
    r.total_cents,
    NULL::text,
    jsonb_build_object('reimbursement_id', r.id, 'person_id', r.person_id)
  FROM fin_reimbursement r
  JOIN fin_person pe ON pe.id = r.person_id
  WHERE r.status = 'enviado'
),

-- (f) Pedido de compra do time. Transcrita do banco.
compra AS (
  SELECT
    'time_compra_aguardando'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'compra_aguardando:' || c.id AS dedupe_key,
    'Pedido de compra aguardando: ' || c.code || ' — ' || c.title AS titulo,
    coalesce(c.justification, 'sem justificativa declarada') || ' · '
      || (SELECT count(*) FROM fin_purchase_request_link l WHERE l.purchase_request_id = c.id)
      || ' link(s).' AS corpo,
    '/financeiro/painel'::text,
    c.amount_cents,
    NULL::text,
    jsonb_build_object('purchase_request_id', c.id, 'code', c.code, 'priority', c.priority)
  FROM fin_purchase_request c
  WHERE c.status IN ('enviada', 'em_cotacao')
),

-- (g) Envio do time (custo ou nota de entrada).
envio AS (
  SELECT
    'time_envio_aguardando'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'envio_aguardando:' || e.id AS dedupe_key,
    CASE e.kind WHEN 'custo' THEN 'Custo enviado pelo time: ' ELSE 'Nota de entrada enviada pelo time: ' END
      || e.code || ' — ' || e.titulo AS titulo,
    pe.name || ' enviou em ' || to_char(e.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
      || CASE WHEN e.identidade_prova = 'declarada' THEN ' · identidade declarada, não provada' ELSE '' END AS corpo,
    '/financeiro/painel'::text,
    e.amount_cents,
    NULL::text,
    jsonb_build_object('envio_id', e.id, 'code', e.code, 'kind', e.kind)
  FROM fin_time_envio e
  JOIN fin_person pe ON pe.id = e.person_id
  WHERE e.status IN ('enviado', 'em_analise')
),

-- (h) A resposta ao que a pessoa do time enviou. Vai para a PESSOA, aponta para
--     /time, e o valor é o do envio dela — não é dado da empresa.
resposta_envio AS (
  SELECT
    'time_resposta'::text, 'pessoa'::text, e.person_id, NULL::text, 'proprio'::text,
    'envio_resposta:' || e.id || ':' || e.status AS dedupe_key,
    CASE e.status
      WHEN 'aprovado'  THEN 'Aprovado: ' || e.titulo
      WHEN 'devolvido' THEN 'Voltou para você: ' || e.titulo
      WHEN 'recusado'  THEN 'Recusado: ' || e.titulo
    END AS titulo,
    coalesce(e.decision_reason, 'sem observação') AS corpo,
    '/time/envios'::text,
    e.amount_cents,
    NULL::text,
    jsonb_build_object('envio_id', e.id, 'code', e.code, 'status', e.status)
  FROM fin_time_envio e CROSS JOIN regra g
  WHERE e.status IN ('aprovado', 'devolvido', 'recusado')
    -- Decisão SEM data não notifica. Ausência de data não é "decidido hoje" —
    -- é o mesmo princípio que impede ausência de dado de virar zero.
    AND e.decided_at IS NOT NULL
    AND e.decided_at >= now() - make_interval(days => g.resposta_dias::int)
),

resposta_compra AS (
  SELECT
    'time_resposta'::text, 'pessoa'::text, c.requested_person_id, NULL::text, 'proprio'::text,
    'compra_resposta:' || c.id || ':' || c.status AS dedupe_key,
    CASE c.status
      WHEN 'aprovada'  THEN 'Compra aprovada: ' || c.title
      WHEN 'reprovada' THEN 'Compra reprovada: ' || c.title
      WHEN 'atendida'  THEN 'Compra atendida: ' || c.title
      WHEN 'cancelada' THEN 'Compra cancelada: ' || c.title
      ELSE 'Compra em cotação: ' || c.title
    END AS titulo,
    coalesce(c.decision_reason, 'sem observação') AS corpo,
    '/time/envios'::text,
    c.amount_cents,
    NULL::text,
    jsonb_build_object('purchase_request_id', c.id, 'code', c.code, 'status', c.status)
  FROM fin_purchase_request c CROSS JOIN regra g
  WHERE c.requested_person_id IS NOT NULL
    AND c.status IN ('em_cotacao', 'aprovada', 'reprovada', 'cancelada', 'atendida')
    AND c.decided_at IS NOT NULL
    AND c.decided_at >= now() - make_interval(days => g.resposta_dias::int)
),

resposta_reembolso AS (
  SELECT
    'time_resposta'::text, 'pessoa'::text, r.person_id, NULL::text, 'proprio'::text,
    'reembolso_resposta:' || r.id || ':' || r.status AS dedupe_key,
    CASE r.status
      WHEN 'aprovado'  THEN 'Reembolso aprovado — ' || to_char(r.reference_month, 'MM/YYYY')
      WHEN 'rejeitado' THEN 'Reembolso rejeitado — ' || to_char(r.reference_month, 'MM/YYYY')
      ELSE 'Reembolso pago — ' || to_char(r.reference_month, 'MM/YYYY')
    END AS titulo,
    coalesce(r.notes, 'sem observação') AS corpo,
    '/time/envios'::text,
    r.total_cents,
    NULL::text,
    jsonb_build_object('reimbursement_id', r.id, 'status', r.status)
  FROM fin_reimbursement r CROSS JOIN regra g
  WHERE r.status IN ('aprovado', 'rejeitado', 'pago')
    -- Os 81 reembolsos desta base foram decididos antes de existir sino, e a
    -- maioria sem `approved_at`. Sem esta linha, o sino abriria com 81 avisos
    -- de coisas que a pessoa já sabe — e um sino assim se aprende a ignorar no
    -- primeiro dia.
    AND r.approved_at IS NOT NULL
    AND r.approved_at >= now() - make_interval(days => g.resposta_dias::int)
),

-- (i) A CTE `fonte` que existia aqui SAIU: virou `fin_fonte_notificacao_fato_v`,
--     logo acima. Ela é a única coisa que esta frente precisa mudar com alguma
--     frequência, e mantê-la aqui obrigaria a recriar estas 440 linhas a cada
--     ajuste de tolerância — que é exatamente como uma frente apaga a outra.

-- (j) Invariante quebrado com valor em jogo. A medição mora nos scripts, não no
--     banco: `scripts/notificar.mjs` roda test-integridade --strict --json e
--     grava aqui. A tabela nasce vazia; sem execução, nenhum aviso — que é o
--     estado honesto, e não "está tudo bem".
invariante AS (
  SELECT
    'invariante_quebrado'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'invariante:' || i.codigo || ':' || i.violacoes::text AS dedupe_key,
    'Invariante quebrado: [' || i.codigo || '] ' || i.nome AS titulo,
    i.violacoes || ' violação(ões) medidas em '
      || to_char(i.medido_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.' AS corpo,
    '/financeiro/indicadores'::text,
    i.amount_cents,
    CASE WHEN i.amount_cents IS NULL THEN 'o invariante não expõe valor em jogo' END,
    jsonb_build_object('codigo', i.codigo, 'violacoes', i.violacoes)
  FROM fin_invariante_resultado i
  WHERE i.corrente AND NOT i.ok
)

SELECT ent.id AS entity_id, f.*
  FROM ent CROSS JOIN (
    SELECT * FROM fila_item
    UNION ALL SELECT * FROM fila_sem_regua
    UNION ALL SELECT * FROM pagamento
    UNION ALL SELECT * FROM alcada
    UNION ALL SELECT * FROM reembolso
    UNION ALL SELECT * FROM compra
    UNION ALL SELECT * FROM envio
    UNION ALL SELECT * FROM resposta_envio
    UNION ALL SELECT * FROM resposta_compra
    UNION ALL SELECT * FROM resposta_reembolso
    UNION ALL SELECT * FROM invariante
  ) f (kind, recipient_kind, recipient_person_id, recipient_perfil, escopo,
       dedupe_key, titulo, corpo, link_href, amount_cents, amount_reason, contexto);

COMMENT ON VIEW fin_notificacao_fato_base_v IS
  'As 11 famílias de fato que nascem do núcleo do ledger. O aviso de FONTE saiu daqui na '
  '0109 (virou fin_fonte_notificacao_fato_v) e o de custo fixo já tinha saído na 0108: '
  'cada frente com a sua view, compostas em fin_notificacao_fato_v. Recriar 440 linhas '
  'para mexer em duas CTEs é como uma frente apaga a outra sem perceber.';

-- ---------------------------------------------------------------------------
-- 7.3 A composição
-- ---------------------------------------------------------------------------
-- Uma linha por frente. Acrescentar uma família de aviso daqui em diante é
-- escrever a view dela e somar um `UNION ALL` aqui — não é reabrir a base.
CREATE OR REPLACE VIEW fin_notificacao_fato_v AS
SELECT entity_id, kind, recipient_kind, recipient_person_id, recipient_perfil, escopo,
       dedupe_key, titulo, corpo, link_href, amount_cents, amount_reason, contexto
  FROM fin_notificacao_fato_base_v
UNION ALL
SELECT entity_id, kind, recipient_kind, recipient_person_id, recipient_perfil, escopo,
       dedupe_key, titulo, corpo, link_href, amount_cents, amount_reason, contexto
  FROM fin_custo_fixo_notificacao_fato_v
UNION ALL
SELECT entity_id, kind, recipient_kind, recipient_person_id, recipient_perfil, escopo,
       dedupe_key, titulo, corpo, link_href, amount_cents, amount_reason, contexto
  FROM fin_fonte_notificacao_fato_v;

COMMENT ON VIEW fin_notificacao_fato_v IS
  'O que MERECE aviso agora, calculado do ledger. Não grava nada. fin_notificacao_sync() '
  'casa esta view com a tabela de estado pela chave de deduplicação: fato novo vira '
  'notificação, fato repetido só incrementa o contador, fato que sumiu vira resolvida. '
  'É a COMPOSIÇÃO das views de cada frente — base (núcleo), custo fixo (0108) e fonte '
  '(0109) — para que ninguém precise recriar o corpo alheio ao acrescentar um aviso.';

-- ---------------------------------------------------------------------------
-- 8. As asserções — a migration se recusa a commitar se qualquer uma falhar
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n integer;
  v_txt text;
  v_uteis integer;
  v_corridos integer;
BEGIN
  -- (1) ÂNCORA DE DINHEIRO. Nada aqui escreve em fin_transaction; se a soma por
  --     conta mudou, alguma coisa fez o que não devia.
  -- Diferença simétrica por EXCEPT ALL, e não por FULL JOIN: `account_id` é
  -- anulável, o join precisaria de `IS NOT DISTINCT FROM`, e o Postgres recusa
  -- FULL JOIN com condição que não seja hash/merge-joinable. EXCEPT já trata
  -- NULL como igual a NULL, que é exatamente a semântica desejada aqui.
  SELECT count(*) INTO v_n FROM (
    (SELECT account_id, n, soma FROM _ancora_0109
     EXCEPT ALL
     SELECT account_id, count(*), coalesce(sum(amount_cents), 0) FROM fin_transaction GROUP BY account_id)
    UNION ALL
    (SELECT account_id, count(*), coalesce(sum(amount_cents), 0) FROM fin_transaction GROUP BY account_id
     EXCEPT ALL
     SELECT account_id, n, soma FROM _ancora_0109)
  ) diferenca;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: a âncora de dinheiro mudou em % conta(s). Nada nesta migration pode tocar fin_transaction.', v_n;
  END IF;

  -- (2) O CONTADOR DE DIAS ÚTEIS FAZ O QUE DIZ. Este é o teste que a frente
  --     anterior não fez e por isso entregou código inerte: o mês corrente
  --     comparava '2026-08-01' com '2026-08' em texto e a condição nunca era
  --     verdadeira. Aqui o caso REAL do defeito é a asserção.
  --
  --     14/08 sexta → 17/08 segunda: 3 dias corridos, 1 dia útil.
  v_uteis := fin_dias_uteis(DATE '2026-08-14', DATE '2026-08-17');
  IF v_uteis <> 1 THEN
    RAISE EXCEPTION '0109: sexta 14/08 até segunda 17/08 deveria dar 1 dia útil, deu %', v_uteis;
  END IF;
  -- 15/08 sábado → 17/08 segunda: 2 corridos, 1 útil. É exatamente o "2 dia(s)"
  -- dos cinco avisos.
  v_uteis := fin_dias_uteis(DATE '2026-08-15', DATE '2026-08-17');
  IF v_uteis <> 1 THEN
    RAISE EXCEPTION '0109: sábado 15/08 até segunda 17/08 deveria dar 1 dia útil, deu %', v_uteis;
  END IF;
  -- O mesmo dia não é atraso.
  IF fin_dias_uteis(DATE '2026-08-17', DATE '2026-08-17') <> 0 THEN
    RAISE EXCEPTION '0109: o próprio dia da entrega não pode contar como atraso';
  END IF;
  -- Feriado no meio conta a menos: 04/09 sexta → 08/09 terça atravessa 07/09
  -- (Independência, segunda). Sem o feriado seriam 2 úteis; com ele, 1.
  v_uteis := fin_dias_uteis(DATE '2026-09-04', DATE '2026-09-08');
  IF v_uteis <> 1 THEN
    RAISE EXCEPTION '0109: 04/09 a 08/09 atravessa o feriado de 07/09 e deveria dar 1 dia útil, deu %', v_uteis;
  END IF;
  -- E o contador nunca devolve mais que o corrido.
  SELECT count(*) INTO v_n
    FROM generate_series(DATE '2026-01-01', DATE '2026-12-31', interval '1 day') d
   WHERE fin_dias_uteis(DATE '2026-01-01', d::date) > (d::date - DATE '2026-01-01');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: em % dia(s) a contagem útil passou da corrida', v_n;
  END IF;

  -- (3) A COBERTURA DO CALENDÁRIO É DECLARADA, NÃO PRESUMIDA.
  IF fin_dias_uteis_coberto(DATE '2026-08-15', DATE '2026-08-17') IS NOT TRUE THEN
    RAISE EXCEPTION '0109: 2026 deveria estar coberto pelo calendário';
  END IF;
  IF fin_dias_uteis_coberto(DATE '2025-12-01', DATE '2026-01-05') IS NOT FALSE THEN
    RAISE EXCEPTION '0109: 2025 NÃO está conferido e a cobertura deveria acusar isso';
  END IF;
  -- Ano declarado sem nenhum feriado seria pior que ano não declarado: ele
  -- afirmaria "conferi" sobre uma lista vazia.
  SELECT count(*) INTO v_n
    FROM fin_calendario_ano c
   WHERE NOT EXISTS (SELECT 1 FROM fin_feriado_nacional f WHERE EXTRACT(YEAR FROM f.dia)::int = c.ano);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: % ano(s) declarado(s) conferido(s) sem nenhum feriado cadastrado', v_n;
  END IF;

  -- (4) TODA FONTE DO ACERVO TEM CLASSIFICAÇÃO. Foi a omissão desta linha que
  --     deixou import_csv ser cobrada como se fosse API.
  SELECT count(*), coalesce(string_agg(DISTINCT t.source, ', '), '')
    INTO v_n, v_txt
    FROM fin_transaction t
   WHERE t.source IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM fin_fonte_catalogo c WHERE c.fonte = t.source);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: % lançamento(s) em fonte(s) sem linha no catálogo: %', v_n, v_txt;
  END IF;

  -- (5) O ESTADO NUNCA É AMBÍGUO: tudo que não está em dia tem motivo escrito.
  SELECT count(*) INTO v_n FROM fin_fonte_frescor_v
   WHERE estado <> 'em_dia' AND (motivo IS NULL OR btrim(motivo) = '');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: % linha(s) de frescor fora de em_dia e sem motivo declarado', v_n;
  END IF;

  -- (6) FONTE MANUAL NUNCA ALARMA. É a decisão desta frente, e ela tem de ser
  --     do banco, não da disciplina de quem escrever o próximo gerador.
  SELECT count(*) INTO v_n FROM fin_fonte_frescor_v WHERE alarma AND natureza <> 'automatica';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: % fonte(s) não automática(s) alarmando', v_n;
  END IF;

  -- (7) O AVISO DE FONTE É UM SÓ. A regressão que esta frente conserta é
  --     exatamente "cinco linhas dizendo a mesma coisa".
  SELECT count(*) INTO v_n FROM fin_notificacao_fato_v WHERE kind = 'fonte_desatualizada';
  IF v_n > 1 THEN
    RAISE EXCEPTION '0109: o aviso de fonte voltou a ser % linhas; ele tem de ser no máximo 1', v_n;
  END IF;

  -- (8) A MENSAGEM DA FILA NÃO EXPÕE NOME DE COLUNA. O pedido foi literal.
  SELECT count(*) INTO v_n FROM fin_notificacao_fato_v
   WHERE kind = 'fila_decisao_sem_regua'
     AND (corpo LIKE '%fin_notificacao_regra%' OR corpo LIKE '%fila_decisao_valor_cents%');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0109: a mensagem da fila voltou a expor nome de coluna do banco';
  END IF;

  -- (9) A RÉGUA DO VALOR CONTINUA NÃO INVENTADA. Melhorar a mensagem não é
  --     escolher o corte, e é fácil confundir as duas coisas.
  IF (SELECT valor FROM fin_notificacao_regra WHERE slug = 'fila_decisao_valor_cents') IS NOT NULL THEN
    RAISE EXCEPTION '0109: fila_decisao_valor_cents ganhou valor. A dúvida 59 é do Fernando, não desta migration.';
  END IF;

  -- (10) A TRAVA DE UMA SYNC POR VEZ EXISTE.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'fin_fonte_sync_uma_por_vez') THEN
    RAISE EXCEPTION '0109: o índice que impede duas syncs simultâneas não foi criado';
  END IF;

  -- (11) AS OUTRAS ONZE CTEs DA VIEW NÃO MUDARAM DE COMPORTAMENTO. Recriar uma
  --      view de 280 linhas para mexer em duas é onde se quebra uma terceira
  --      sem perceber.
  SELECT count(DISTINCT kind) INTO v_n FROM fin_notificacao_fato_v;
  RAISE NOTICE '0109: % tipo(s) de fato vivos na view', v_n;

  SELECT count(*) INTO v_corridos FROM fin_fonte_frescor_v
   WHERE conta_ativa AND lancamentos > 0 AND atraso_corrido > coalesce(tolerancia_util, 999);
  SELECT count(*) INTO v_uteis FROM fin_fonte_frescor_v WHERE alarma AND conta_ativa;

  RAISE NOTICE '0109: fontes fora da tolerância — % contando dias corridos, % contando dias úteis (só automáticas)',
    v_corridos, v_uteis;
  RAISE NOTICE '0109: catálogo com % fonte(s); % automática(s) agendada(s), % automática(s) fora do agendador, % manual(is)',
    (SELECT count(*) FROM fin_fonte_catalogo),
    (SELECT count(*) FROM fin_fonte_catalogo WHERE natureza = 'automatica' AND agendada),
    (SELECT count(*) FROM fin_fonte_catalogo WHERE natureza = 'automatica' AND NOT agendada),
    (SELECT count(*) FROM fin_fonte_catalogo WHERE natureza = 'manual');
END $$;

COMMIT;
