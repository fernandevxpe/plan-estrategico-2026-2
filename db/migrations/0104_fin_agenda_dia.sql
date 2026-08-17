-- A agenda diaria de obrigacoes: contas a pagar e a receber, dia a dia, do
-- passado ao futuro, numa linha do tempo so.
--
-- ===========================================================================
-- O PEDIDO
-- ===========================================================================
-- "toda tela de contas a pagar contas a receber, mostrando por dia todo
--  previsto (asaas, padrao mensal, valores que se repetem, salarios, receitas
--  de clientes, mensalidade tudo isso...) permitindo nao so ver mas tbm
--  organizar o q estiver errado, ir item a item"
--
-- ===========================================================================
-- O QUE JA EXISTIA, E POR QUE NAO BASTAVA
-- ===========================================================================
-- Esta base ja sabe prever. `fin_previsao_evento_v` (0058/0079) entrega 1.036
-- eventos de caixa com dia, valor, camada e — o que mais importa — a trava
-- anti-dupla-contagem da 0061 ja aplicada. `fin_caixa_previsto_dia_v` ja
-- acumula saldo por dia. `fin_custo_previsto_consolidado_v` (0100) ja resolve a
-- precedencia confirmado > derivado > projetado do lado da saida.
--
-- Faltavam quatro coisas, e cada uma tem consequencia medida:
--
-- 1. O PASSADO NAO EXISTE NA PREVISAO. `fin_previsao_evento_v` filtra
--    `dia >= hoje`: medido, min(dia) = hoje e min(dias_a_frente) = 0. Uma
--    agenda que so anda para frente nao responde "o que venceu semana passada e
--    nao entrou" nem "eu previ certo?". O passado desta agenda vem do
--    DOCUMENTO com data real (due_date) e do item com dia esperado ja vencido —
--    nunca da projecao, que nao alcanca ali.
--
-- 2. O VENCIDO ESTA ANCORADO EM HOJE, E ISSO E UM ARTEFATO DO HORIZONTE.
--    A camada `receber_vencido` pega 103 documentos vencidos (o mais antigo de
--    nov/2021, R$ 201.502,00) e os empilha todos no dia de hoje, porque com a
--    data original eles cairiam fora da janela e sumiriam. Numa agenda que TEM
--    passado esse truque vira mentira: o mesmo documento apareceria no dia do
--    vencimento real E hoje. Aqui ele aparece uma vez so, no dia em que venceu,
--    com `vencido = true`. A soma nao muda: a camada nasce com
--    `entra_no_saldo = false` e continua fora de todo total.
--
-- 3. A ENTRADA NAO TINHA ITEM EDITAVEL. A 0100 deu ao custo previsto uma
--    tabela sobre a qual se pode agir — confirmar, ajustar valor, ignorar com
--    motivo, criar do zero. Do lado da receita nao havia equivalente: dava para
--    ver a projecao e nao dava para corrigi-la. `fin_receita_prevista`, abaixo,
--    e o espelho exato de `fin_custo_previsto`. Autoridade simetrica: o mesmo
--    vocabulario de estado, a mesma chave de supressao, as mesmas travas.
--
-- 4. O PADRAO DE REPETICAO NAO ERA VISIVEL POR SERIE. O Fernando pediu
--    "valores que se repetem" nominalmente. `fin_agenda_serie_v` mostra, para
--    cada serie: quantas vezes ja ocorreu, valor tipico, desvio, e QUANDO
--    TERMINA. Recorrente e parcelado tem a mesma assinatura estatistica e sao
--    coisas diferentes — o Asaas declara qual e qual na origem, e essa
--    distincao ja corrigiu um erro de 37% nesta base (CONTINUACAO §4). A serie
--    le a declaracao da fonte (`fin_recurring.end_month`), nunca o detector.
--
-- ===========================================================================
-- A REGRA QUE GOVERNA O ARQUIVO INTEIRO
-- ===========================================================================
-- O MESMO DINHEIRO NAO APARECE DUAS VEZES NA AGENDA.
--
-- A disciplina e a mesma da 0061 ("cobranca emitida vence projecao"), estendida
-- ao dia e escrita numa chave unica:
--
--     chave_dedupe = to_char(competencia,'YYYY-MM') || '|' || origem_ref
--
-- Identica, byte a byte, a que a 0100 publica — de proposito. Duas linhas com a
-- mesma chave sao o MESMO dinheiro visto por procedencias diferentes, e
-- exatamente uma delas carrega `entra_no_total = true`. A outra continua
-- VISIVEL, com `motivo_nao_soma` dizendo quem a substituiu. A precedencia:
--
--     1  documento/item confirmado   data real ou decisao humana
--     2  item derivado / manual      existe linha, ninguem confirmou
--     3  projetado                   so onde nao existe item
--     9  ignorado                    decidido fora, com motivo; nunca soma
--
-- A prova de que funciona nao e um comentario: e `fin_agenda_prova_v`, que
-- confronta a soma da agenda por mes com `fin_previsao_evento_v` — a previsao
-- mensal ja validada — e com a contagem de chaves repetidas. O teste
-- `scripts/test-agenda-dia.mjs` falha se qualquer uma das duas divergir.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO FAZ
-- ===========================================================================
-- - Nao escreve em `fin_transaction`. Previsto nunca vira realizado: o estado
--   'realizado' de um item exige o lancamento, e o gatilho confere o SINAL dele.
-- - Nao cria segundo modelo de item de custo. `fin_custo_previsto` (0100) e a
--   dona do item de saida; esta migration CONSOME `fin_custo_previsto_
--   consolidado_v` e nao duplica uma linha sequer dela.
-- - Nao soma camadas que a base declarou nao somaveis. `pagar_recorrente`
--   (proposto, R$ 11.593,04/mes) e `receber_vencido` continuam fora do total,
--   com o motivo ao lado.
-- - Nao mexe em saldo de conta. Item manual e previsao, e previsao nao e caixa.
--
-- Migration reservada: 0104. Depende da 0100 (aplicada antes por ordem de
-- nome). A pre-condicao abaixo recusa aplicar sem ela em vez de criar uma view
-- quebrada que so falha na primeira leitura.

-- ===========================================================================
-- §0 · PRE-CONDICAO
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.fin_custo_previsto_consolidado_v') IS NULL THEN
    RAISE EXCEPTION
      '0104 depende da 0100 (fin_custo_previsto_consolidado_v). Aplique 0100_fin_custo_previsto.sql primeiro.';
  END IF;
  IF to_regclass('public.fin_previsao_evento_v') IS NULL THEN
    RAISE EXCEPTION '0104 depende de fin_previsao_evento_v (0058/0079).';
  END IF;
  -- A chave de deduplicacao TEM de existir no consolidado da 0100, senao a
  -- agenda estaria inventando a sua propria e as duas divergiriam em silencio.
  PERFORM 1 FROM information_schema.columns
    WHERE table_name = 'fin_custo_previsto_consolidado_v' AND column_name = 'chave_dedupe';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      '0104: fin_custo_previsto_consolidado_v sem coluna chave_dedupe — a agenda nao pode deduplicar contra a 0100.';
  END IF;
  PERFORM 1 FROM information_schema.columns
    WHERE table_name = 'fin_custo_previsto_consolidado_v' AND column_name = 'dia_esperado';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0104: fin_custo_previsto_consolidado_v sem coluna dia_esperado.';
  END IF;
END $$;

-- ===========================================================================
-- §1 · fin_receita_prevista — o espelho de fin_custo_previsto, do lado da entrada
-- ===========================================================================
-- Por que uma tabela nova em vez de reusar `fin_document`:
--
-- `fin_document` e o registro do que FOI EMITIDO — 3.406 cobrancas do Asaas,
-- todas com `source = 'asaas'` e `source_id` do provedor. Uma receita que
-- ninguem emitiu ainda nao e documento: nao tem numero, nao tem boleto, nao tem
-- como ser conciliada. Grava-la ali a misturaria com a cobranca real e faria
-- `fin_receber_aberto_v`, o aging e a curva ABC contarem promessa como
-- faturamento. Foi exatamente o erro que a 0095 evitou do outro lado, com a
-- regra "despesa ja paga NAO vira documento a pagar".
--
-- E por que nao um campo em `fin_recurring`: recorrente e um PADRAO detectado
-- ou contratado, que projeta N meses. O item aqui e UM mes especifico, com
-- decisao propria. A duvida 33 pede exatamente isso do lado da despesa —
-- confirmar mes a mes, sem decidir por todos os meses futuros.
CREATE TABLE fin_receita_prevista (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,

  -- ── de onde veio ────────────────────────────────────────────────────────
  -- 'derivado': nasceu de uma linha de fin_previsao_evento_v (sentido entrada)
  -- e por isso CALA a projecao que o originou. 'manual': o usuario criou, nao
  -- duplica projecao nenhuma. E o "cadastrar futuro de receitas" do pedido.
  origem        text NOT NULL CHECK (origem IN ('derivado','manual')),
  -- Identica em formato a `fin_previsao_evento_v.origem_ref` ('tabela:id').
  -- E o unico jeito de a supressao ser exata em vez de heuristica.
  origem_ref    text,
  origem_camada text,

  -- Ponteiros tipados para o JOIN barato e o ON DELETE. Redundantes com
  -- origem_ref de proposito: o texto e a chave, estes sao navegacao.
  -- `erp_parcela` nao tem ponteiro: a parcela mora no erp-obras, que e SOMENTE
  -- LEITURA — uma FK para la seria uma escrita implicita esperando acontecer.
  document_id   bigint REFERENCES fin_document(id)  ON DELETE SET NULL,
  recurring_id  bigint REFERENCES fin_recurring(id) ON DELETE SET NULL,

  -- ── o que e ─────────────────────────────────────────────────────────────
  competencia     date NOT NULL,
  descricao       text NOT NULL CHECK (length(btrim(descricao)) > 0),
  category_id     bigint REFERENCES fin_category(id),
  nucleo          text   REFERENCES fin_nucleo(slug) ON UPDATE CASCADE,
  cost_center_id  bigint REFERENCES fin_cost_center(id),
  counterparty_id bigint REFERENCES fin_counterparty(id),
  -- Dia esperado de CAIXA. Pode cair fora da competencia, e nao ha CHECK
  -- amarrando um ao outro: a J3 ensinou o custo de validar competencia contra
  -- uma janela arbitraria em vez de contra a fonte que a declarou.
  dia_esperado    date,
  -- POR QUE ESSE DIA, em uma frase. Um dia sem regra e um dia que ninguem
  -- consegue conferir nem corrigir: "vencimento do boleto" e verificavel,
  -- "2026-09-15" nao. Mesma disciplina da 0100.
  dia_regra       text,

  -- ── quanto ──────────────────────────────────────────────────────────────
  valor_previsto_cents   bigint CHECK (valor_previsto_cents IS NULL OR valor_previsto_cents > 0),
  -- Separado do previsto porque confirmar PODE ajustar o valor, e a diferenca
  -- entre os dois e o erro da projecao medido por quem sabe.
  valor_confirmado_cents bigint CHECK (valor_confirmado_cents IS NULL OR valor_confirmado_cents >= 0),
  indeterminado_motivo   text,

  -- ── estado ──────────────────────────────────────────────────────────────
  estado text NOT NULL DEFAULT 'previsto'
    CHECK (estado IN ('previsto','confirmado','realizado','ignorado')),
  confirmado_por   text,
  confirmado_em    timestamptz,
  confirmacao_nota text,
  -- O "nao vai acontecer" do pedido. Nao se apaga: neutraliza com trilha.
  ignorado_motivo  text,
  realizado_transaction_id bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  realizado_em     timestamptz,

  created_by  text NOT NULL DEFAULT 'sistema',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_receita_prevista_competencia_ck
    CHECK (competencia = date_trunc('month', competencia)::date),
  CONSTRAINT fin_receita_prevista_origem_ref_ck
    CHECK ((origem = 'derivado') = (origem_ref IS NOT NULL)),
  -- Restricao absoluta nº 5: sem evidencia, indeterminado COM MOTIVO.
  CONSTRAINT fin_receita_prevista_valor_ou_motivo_ck
    CHECK (valor_previsto_cents IS NOT NULL OR indeterminado_motivo IS NOT NULL),
  CONSTRAINT fin_receita_prevista_confirmacao_ck
    CHECK (estado NOT IN ('confirmado','realizado')
           OR (confirmado_por IS NOT NULL AND confirmado_em IS NOT NULL
               AND valor_confirmado_cents IS NOT NULL)),
  CONSTRAINT fin_receita_prevista_ignorado_ck
    CHECK (estado <> 'ignorado' OR ignorado_motivo IS NOT NULL),
  -- PREVISTO NUNCA VIRA REALIZADO SOZINHO.
  CONSTRAINT fin_receita_prevista_realizado_ck
    CHECK (estado <> 'realizado'
           OR (realizado_transaction_id IS NOT NULL AND realizado_em IS NOT NULL)),
  CONSTRAINT fin_receita_prevista_lancamento_so_realizado_ck
    CHECK (realizado_transaction_id IS NULL OR estado = 'realizado')
);

-- A regra anti-dupla-contagem gravada no schema.
CREATE UNIQUE INDEX fin_receita_prevista_derivado_key
  ON fin_receita_prevista (entity_id, competencia, origem_ref)
  WHERE origem = 'derivado';
CREATE UNIQUE INDEX fin_receita_prevista_lancamento_key
  ON fin_receita_prevista (realizado_transaction_id)
  WHERE realizado_transaction_id IS NOT NULL;
CREATE INDEX fin_receita_prevista_mes_ix ON fin_receita_prevista (entity_id, competencia, estado);
CREATE INDEX fin_receita_prevista_dia_ix ON fin_receita_prevista (entity_id, dia_esperado)
  WHERE dia_esperado IS NOT NULL;
CREATE INDEX fin_receita_prevista_cp_ix  ON fin_receita_prevista (counterparty_id)
  WHERE counterparty_id IS NOT NULL;

CREATE TRIGGER fin_receita_prevista_touch BEFORE UPDATE ON fin_receita_prevista
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

COMMENT ON TABLE fin_receita_prevista IS
  'Item de receita prevista sobre o qual se pode agir: confirmar, ajustar, ignorar com motivo, criar do zero. '
  'Espelho de fin_custo_previsto (0100) do lado da entrada. Derivado cala a projecao que o originou '
  '(chave: competencia + origem_ref); manual soma por cima. Nada aqui e caixa nem faturamento: '
  'nao vira fin_document e o estado realizado exige lancamento em fin_transaction.';

-- ── a guarda ──────────────────────────────────────────────────────────────
CREATE FUNCTION fin_receita_prevista_guarda() RETURNS trigger AS $$
DECLARE
  v_amount bigint;
  v_entity bigint;
BEGIN
  IF NEW.estado = 'realizado' THEN
    SELECT t.amount_cents, t.entity_id INTO v_amount, v_entity
      FROM fin_transaction t WHERE t.id = NEW.realizado_transaction_id;

    IF v_amount IS NULL THEN
      RAISE EXCEPTION 'receita prevista %: estado realizado aponta para lancamento inexistente (%)',
        COALESCE(NEW.id, 0), NEW.realizado_transaction_id;
    END IF;
    -- Um debito nao realiza uma receita. Espelha a checagem da 0100, com o
    -- sinal invertido: sem ela, o confronto previsto x realizado compararia
    -- coisas de sinais opostos e ninguem veria por que.
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'receita prevista %: lancamento % nao e entrada (amount_cents = %)',
        COALESCE(NEW.id, 0), NEW.realizado_transaction_id, v_amount;
    END IF;
    IF v_entity IS DISTINCT FROM NEW.entity_id THEN
      RAISE EXCEPTION 'receita prevista %: lancamento % e de outra entidade',
        COALESCE(NEW.id, 0), NEW.realizado_transaction_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.estado = 'realizado' AND NEW.estado <> 'realizado'
     AND NEW.realizado_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'receita prevista %: para sair de realizado, limpe realizado_transaction_id', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_receita_prevista_guarda_trg
  BEFORE INSERT OR UPDATE ON fin_receita_prevista
  FOR EACH ROW EXECUTE FUNCTION fin_receita_prevista_guarda();

CREATE FUNCTION fin_receita_prevista_apagar_guarda() RETURNS trigger AS $$
BEGIN
  -- Derivado nao se apaga: voltaria na proxima leitura da projecao, e o
  -- apagamento teria destruido a nota de quem decidiu ignora-lo.
  IF OLD.origem = 'derivado' THEN
    RAISE EXCEPTION 'receita prevista %: item derivado nao se apaga — use estado ignorado com motivo', OLD.id;
  END IF;
  IF OLD.estado = 'realizado' THEN
    RAISE EXCEPTION 'receita prevista %: item realizado nao se apaga', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_receita_prevista_apagar_trg
  BEFORE DELETE ON fin_receita_prevista
  FOR EACH ROW EXECUTE FUNCTION fin_receita_prevista_apagar_guarda();

-- ── a trilha ──────────────────────────────────────────────────────────────
-- Toda edicao grava o valor ANTERIOR. Sem o `before`, "alguem mudou" e uma
-- afirmacao sem conteudo: nao da para desfazer nem para explicar o que mudou.
CREATE FUNCTION fin_receita_prevista_auditoria() RETURNS trigger AS $$
DECLARE
  v_campos text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, actor)
    VALUES (NEW.entity_id, 'fin_receita_prevista', NEW.id, 'insert',
            NULL, to_jsonb(NEW), COALESCE(NEW.created_by, 'sistema'));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k) INTO v_campos
      FROM jsonb_each(to_jsonb(OLD)) o
      JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
      CROSS JOIN LATERAL (SELECT o.key AS k) x
     WHERE o.value IS DISTINCT FROM n.value AND o.key <> 'updated_at';
    IF v_campos IS NULL THEN RETURN NEW; END IF;
    INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
    VALUES (NEW.entity_id, 'fin_receita_prevista', NEW.id, 'update',
            to_jsonb(OLD), to_jsonb(NEW), v_campos,
            COALESCE(NEW.confirmado_por, NEW.created_by, 'sistema'));
    RETURN NEW;
  ELSE
    INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, actor)
    VALUES (OLD.entity_id, 'fin_receita_prevista', OLD.id, 'delete',
            to_jsonb(OLD), NULL, COALESCE(OLD.created_by, 'sistema'));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_receita_prevista_auditoria_trg
  AFTER INSERT OR UPDATE OR DELETE ON fin_receita_prevista
  FOR EACH ROW EXECUTE FUNCTION fin_receita_prevista_auditoria();

-- ===========================================================================
-- §2 · fin_receita_prevista_derivado_v — o que a projecao de entrada oferece
-- ===========================================================================
-- Le `fin_previsao_evento_v` e so ela, pelo mesmo motivo que a 0100: uma segunda
-- composicao de entrada seria uma segunda resposta para "quanto entra".
--
-- `receber_vencido` FICA DE FORA, e esta e a decisao estrutural desta view.
-- Essa camada ancora 103 documentos vencidos (R$ 201.502,00, o mais antigo de
-- nov/2021) no dia de HOJE, porque a previsao nao tem passado e com a data
-- original eles sumiriam. A agenda TEM passado: cada um desses documentos
-- aparece no dia em que venceu, vindo de `fin_document`. Mante-lo aqui tambem o
-- faria aparecer duas vezes — a dupla contagem que este arquivo existe para
-- impedir. A soma nao muda: a camada nasce com `entra_no_saldo = false`.
CREATE VIEW fin_receita_prevista_derivado_v AS
WITH agrupado AS (
  SELECT
    ev.entity_id,
    date_trunc('month', ev.dia)::date  AS competencia,
    ev.origem_ref,
    min(ev.camada)                     AS origem_camada,
    min(ev.confianca)                  AS confianca,
    min(ev.confianca_nivel)            AS confianca_nivel,
    min(ev.dia)                        AS dia_esperado,
    round(sum(ev.valor_cents))::bigint AS valor_projetado_cents,
    min(ev.sobre_o_que)                AS descricao,
    min(ev.counterparty_id)            AS counterparty_id,
    min(ev.category_id)                AS category_id_da_camada,
    bool_or(ev.entra_no_saldo)         AS entra_no_saldo,
    min(ev.motivo_nao_soma)            AS motivo_nao_soma,
    count(*)                           AS fontes_no_ref,
    CASE WHEN ev.origem_ref LIKE 'fin_document:%'
         THEN NULLIF(split_part(min(ev.origem_ref), ':', 2), '')::bigint END AS document_id,
    CASE WHEN ev.origem_ref LIKE 'fin_recurring:%'
         THEN NULLIF(split_part(min(ev.origem_ref), ':', 2), '')::bigint END AS recurring_id
  FROM fin_previsao_evento_v ev
  WHERE ev.sentido = 'entrada'
    AND ev.camada <> 'receber_vencido'
  GROUP BY ev.entity_id, date_trunc('month', ev.dia)::date, ev.origem_ref
)
SELECT
  a.entity_id, a.competencia, a.origem_ref, a.origem_camada,
  a.confianca, a.confianca_nivel, a.dia_esperado, a.valor_projetado_cents,
  a.descricao, a.counterparty_id, a.entra_no_saldo, a.motivo_nao_soma,
  a.fontes_no_ref, a.document_id, a.recurring_id,
  -- Categoria e nucleo vem da fonte que os DECLARA, e o caminho fica escrito.
  -- A camada de entrada nao carrega category_id (medido: nenhum dos 576 eventos
  -- de entrada traz uma), entao ela sai do documento, da recorrente ou do
  -- padrao da contraparte — nessa ordem, do mais especifico ao mais generico.
  COALESCE(doc.category_id, r.category_id, cp.default_category_id) AS category_id,
  CASE
    WHEN doc.category_id        IS NOT NULL THEN 'documento'
    WHEN r.category_id          IS NOT NULL THEN 'recorrente'
    WHEN cp.default_category_id IS NOT NULL THEN 'contraparte'
  END                                                             AS categoria_origem,
  COALESCE(doc.nucleo, r.nucleo, cp.default_nucleo)               AS nucleo,
  COALESCE(doc.cost_center_id, r.cost_center_id)                  AS cost_center_id,
  -- POR QUE ESSE DIA. Verificavel, nao um carimbo.
  CASE a.origem_camada
    WHEN 'receber_cobranca' THEN
      'cobranca emitida: vencimento do boleto no Asaas (due_date)'
    WHEN 'receber_assinatura' THEN
      'assinatura: dia ' || COALESCE(r.day_of_month::text, '?')
      || ' do mes, limitado ao dia 28 para caber em fevereiro'
    WHEN 'receber_parcelamento' THEN
      'parcelamento: dia ' || COALESCE(r.day_of_month::text, '?')
      || ' do mes, ate ' || COALESCE(to_char(r.end_month, 'MM/YYYY'), '(sem fim declarado)')
    WHEN 'receber_ativo_de_fato' THEN
      'ativo de fato: dia ' || COALESCE(r.day_of_month::text, '?')
      || ' do mes, pelo padrao observado — nao ha contrato declarando'
    WHEN 'receber_previsao_contrato' THEN
      'parcela de contrato do erp-obras: vencimento declarado la'
  END                                                             AS dia_regra,
  -- A CHAVE DE DEDUPLICACAO, no formato exato que a 0100 publica.
  to_char(a.competencia, 'YYYY-MM') || '|' || a.origem_ref        AS chave_dedupe
FROM agrupado a
LEFT JOIN fin_document    doc ON doc.id = a.document_id
LEFT JOIN fin_recurring   r   ON r.id   = a.recurring_id
LEFT JOIN fin_counterparty cp ON cp.id  = a.counterparty_id;

COMMENT ON VIEW fin_receita_prevista_derivado_v IS
  'A entrada projetada por (competencia, origem_ref) — os candidatos a virar item. '
  'Le so fin_previsao_evento_v. EXCLUI receber_vencido de proposito: essa camada ancora o vencido em HOJE '
  'porque a previsao nao tem passado, e a agenda tem — o vencido aparece no dia real, vindo de fin_document.';

-- ===========================================================================
-- §3 · fin_receita_prevista_consolidado_v — onde a dupla contagem morre
-- ===========================================================================
-- Espelho exato da 0100: uma linha por item e uma linha por projecao;
-- `entra_no_total` acende em exatamente uma das duas quando falam do mesmo
-- dinheiro, e a outra sai com `motivo_nao_soma` escrito.
--
-- MATERIALIZAR E NEUTRO; SO CONFIRMAR MOVE O NUMERO. O item derivado ainda em
-- 'previsto' HERDA o `entra_no_saldo` da projecao que o originou. Do lado da
-- entrada isso hoje nao muda nada (todas as camadas nao-vencidas somam), mas a
-- simetria e o que impede a proxima camada nao-somavel de entrar no total so
-- por ter sido materializada — foi assim que o custo previsto quase subiu
-- R$ 11.593,04 sem decisao humana nenhuma (0100 §consolidado).
CREATE VIEW fin_receita_prevista_consolidado_v AS
WITH linhas AS (
  -- ── 1. os itens ─────────────────────────────────────────────────────────
  SELECT
    i.entity_id,
    i.competencia,
    'item'::text                                     AS procedencia,
    CASE i.estado
      WHEN 'confirmado' THEN 'confirmado'
      WHEN 'realizado'  THEN 'confirmado'
      WHEN 'ignorado'   THEN 'ignorado'
      ELSE i.origem
    END                                              AS precedencia,
    CASE i.estado
      WHEN 'confirmado' THEN 1
      WHEN 'realizado'  THEN 1
      WHEN 'ignorado'   THEN 9
      ELSE 2
    END                                              AS precedencia_nivel,
    i.id                                             AS item_id,
    i.origem,
    i.estado,
    i.origem_ref,
    i.origem_camada,
    CASE WHEN i.origem_ref IS NOT NULL
         THEN to_char(i.competencia, 'YYYY-MM') || '|' || i.origem_ref
         ELSE 'item_receita|' || i.id::text END      AS chave_dedupe,
    i.dia_esperado,
    COALESCE(i.dia_regra, d.dia_regra,
             CASE WHEN i.origem = 'manual' THEN 'informado por quem criou o item' END) AS dia_regra,
    i.descricao,
    i.category_id,
    i.nucleo,
    i.cost_center_id,
    i.counterparty_id,
    i.valor_previsto_cents,
    i.valor_confirmado_cents,
    CASE WHEN i.estado IN ('confirmado','realizado')
         THEN i.valor_confirmado_cents ELSE i.valor_previsto_cents END AS valor_cents,
    (i.estado <> 'ignorado'
       AND (CASE WHEN i.estado IN ('confirmado','realizado')
                 THEN i.valor_confirmado_cents ELSE i.valor_previsto_cents END) IS NOT NULL
       AND (i.estado IN ('confirmado','realizado')
            OR i.origem = 'manual'
            OR COALESCE(d.entra_no_saldo, true)))    AS entra_no_total,
    false                                            AS suprimido_por_item,
    CASE
      WHEN i.estado = 'ignorado'
        THEN 'nao vai acontecer: ' || i.ignorado_motivo
      WHEN (CASE WHEN i.estado IN ('confirmado','realizado')
                 THEN i.valor_confirmado_cents ELSE i.valor_previsto_cents END) IS NULL
        THEN 'valor indeterminado: ' || COALESCE(i.indeterminado_motivo, '(motivo ausente)')
      WHEN i.estado = 'previsto' AND i.origem = 'derivado' AND NOT COALESCE(d.entra_no_saldo, true)
        THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel')
             || ' — materializar nao soma; confirmar sim'
      ELSE NULL
    END                                              AS motivo_nao_soma,
    i.ignorado_motivo,
    i.confirmado_por,
    i.confirmado_em,
    i.realizado_transaction_id,
    COALESCE(d.confianca, CASE WHEN i.origem = 'manual' THEN 'estimado' END)   AS confianca,
    COALESCE(d.confianca_nivel, CASE WHEN i.origem = 'manual' THEN 5 END)      AS confianca_nivel
  FROM fin_receita_prevista i
  LEFT JOIN fin_receita_prevista_derivado_v d
    ON  d.entity_id   = i.entity_id
    AND d.competencia = i.competencia
    AND d.origem_ref  = i.origem_ref

  UNION ALL

  -- ── 2. a projecao, calada onde ja existe item ───────────────────────────
  SELECT
    d.entity_id, d.competencia, 'projetado'::text, 'projetado'::text, 3,
    NULL::bigint, 'derivado'::text, NULL::text,
    d.origem_ref, d.origem_camada, d.chave_dedupe, d.dia_esperado, d.dia_regra,
    d.descricao, d.category_id, d.nucleo, d.cost_center_id, d.counterparty_id,
    d.valor_projetado_cents, NULL::bigint, d.valor_projetado_cents,
    (d.entra_no_saldo AND NOT EXISTS (
       SELECT 1 FROM fin_receita_prevista i2
        WHERE i2.entity_id   = d.entity_id
          AND i2.competencia = d.competencia
          AND i2.origem_ref  = d.origem_ref)),
    EXISTS (SELECT 1 FROM fin_receita_prevista i2
             WHERE i2.entity_id = d.entity_id
               AND i2.competencia = d.competencia
               AND i2.origem_ref = d.origem_ref),
    CASE
      -- A supressao vem primeiro: havendo item, ele e a razao, mesmo que a
      -- camada tambem nao somasse.
      WHEN EXISTS (SELECT 1 FROM fin_receita_prevista i2
                    WHERE i2.entity_id = d.entity_id
                      AND i2.competencia = d.competencia
                      AND i2.origem_ref = d.origem_ref)
        THEN 'substituido pelo item #' || (
               SELECT i3.id::text || ' (' || i3.estado || ')' FROM fin_receita_prevista i3
                WHERE i3.entity_id = d.entity_id
                  AND i3.competencia = d.competencia
                  AND i3.origem_ref = d.origem_ref)
      WHEN NOT d.entra_no_saldo THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel')
      ELSE NULL
    END,
    NULL::text, NULL::text, NULL::timestamptz, NULL::bigint,
    d.confianca, d.confianca_nivel
  FROM fin_receita_prevista_derivado_v d
)
SELECT
  l.*,
  -- Aponta, nao suprime. Mesma contraparte entrando por duas origens no mesmo
  -- mes pode ser dois recebimentos legitimos ou o mesmo dinheiro duas vezes.
  CASE
    WHEN l.entra_no_total AND l.counterparty_id IS NOT NULL
     AND count(*) FILTER (WHERE l.entra_no_total)
           OVER (PARTITION BY l.entity_id, l.competencia, l.counterparty_id) > 1
    THEN 'mesma contraparte somando por mais de uma origem nesta competencia — conferir se e o mesmo dinheiro'
  END AS alerta_sobreposicao
FROM linhas l;

COMMENT ON VIEW fin_receita_prevista_consolidado_v IS
  'A entrada prevista do mes, item a item, com a precedencia CONFIRMADO > DERIVADO > PROJETADO. '
  'Some SO as linhas com entra_no_total = true e agrupe por chave_dedupe. '
  'Materializar um derivado NAO muda o total do mes; so confirmar muda.';

-- ===========================================================================
-- §4 · fin_agenda_dia_v — UMA LINHA POR (DIA, ITEM)
-- ===========================================================================
-- A view central. Passado, hoje e futuro na mesma linha do tempo, nas duas
-- direcoes, com origem, camada de certeza e chave de deduplicacao em toda
-- linha.
--
-- AS QUATRO FONTES, E O QUE CADA UMA COBRE NO TEMPO:
--
--   A. documento com data real     passado + futuro   fin_document
--   B. item de custo previsto      passado + futuro   fin_custo_previsto_consolidado_v (0100)
--   C. item de receita prevista    passado + futuro   fin_receita_prevista_consolidado_v (§3)
--   D. projecao                    hoje + futuro      dentro de B e C
--
-- A E B/C SE ENCONTRAM, E A CHAVE RESOLVE. Um documento a pagar de setembro
-- aparece em A (fin_document, due_date 01/09) e em B (camada `pagar_documento`,
-- origem_ref 'fin_document:<id>'). As duas chaves sao iguais — '2026-09|
-- fin_document:1234' — e por isso a precedencia decide sem heuristica: onde a
-- linha B existe para a mesma chave, A cala. A escolha de quem cala e a B (a
-- consolidada) e nao a A, porque B ja carrega a decisao humana (confirmado,
-- ignorado, valor ajustado) e A nao carrega nenhuma.
--
-- E POR QUE O PASSADO NAO VEM DA PROJECAO: `fin_previsao_evento_v` comeca em
-- hoje. Antes disso a unica coisa que existiu de verdade e o documento e o
-- lancamento. Projetar o passado seria inventar o que ja se sabe.
--
-- O REALIZADO NAO E LINHA DA AGENDA, E COLUNA DELA. `realizado_cents` vem do
-- proprio documento (settled_cents / paid_on) e nunca de um pareador. Somar
-- fin_transaction como linha encheria a agenda com 13.881 movimentos e
-- destruiria a prova de nao-duplicacao. O caixa realizado do dia esta no
-- agregado (§5), lado a lado com o previsto — que e como a previsao aprende.
CREATE VIEW fin_agenda_dia_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),

-- ── A. documentos com data real ─────────────────────────────────────────────
-- Todo documento entra, dos dois lados. `expected_cash_date` vence `due_date`
-- quando existe: e a data de CAIXA declarada, e a agenda e uma agenda de caixa.
documento AS (
  SELECT
    doc.entity_id,
    COALESCE(doc.expected_cash_date, doc.due_date)                       AS dia,
    doc.direction                                                        AS direcao,
    'documento'::text                                                    AS procedencia,
    CASE WHEN doc.status IN ('liquidado','confirmado') THEN 'confirmado'
         ELSE 'documento' END                                            AS precedencia,
    CASE WHEN doc.status IN ('liquidado','confirmado') THEN 1 ELSE 1 END AS precedencia_nivel,
    NULL::bigint                                                         AS item_id,
    doc.status                                                           AS estado,
    CASE WHEN doc.direction = 'receber' THEN 'receber_cobranca' ELSE 'pagar_documento' END AS camada,
    doc.description                                                      AS descricao,
    doc.counterparty_id,
    doc.category_id,
    doc.nucleo,
    doc.cost_center_id,
    doc.amount_cents                                                     AS valor_cents,
    -- Realizado: o que o proprio documento declara ter sido liquidado.
    CASE WHEN doc.paid_on IS NOT NULL THEN doc.settled_cents END         AS realizado_cents,
    doc.paid_on                                                          AS realizado_em,
    'fin_document'::text                                                 AS origem_tabela,
    doc.id                                                               AS origem_id,
    'fin_document:' || doc.id                                            AS origem_ref,
    to_char(date_trunc('month', COALESCE(doc.expected_cash_date, doc.due_date))::date, 'YYYY-MM')
      || '|fin_document:' || doc.id                                      AS chave_dedupe,
    CASE WHEN doc.expected_cash_date IS NOT NULL
         THEN 'documento: expected_cash_date declarada (' || COALESCE(doc.cash_date_basis, 'sem base') || ')'
         ELSE 'documento: due_date do boleto' END                        AS dia_regra,
    CASE
      WHEN doc.status = 'liquidado' THEN 'firme'
      WHEN doc.status = 'cancelado' THEN 'indeterminado'
      ELSE 'faturado' END                                                AS confianca,
    doc.installment_group_id                                             AS serie_chave,
    doc.source,
    doc.external_url,
    -- Cancelado nunca soma. Liquidado do PASSADO tambem nao entra no total
    -- previsto: ja aconteceu, e somar o que ja entrou ao que vai entrar e a
    -- forma mais comum de dobrar dinheiro numa agenda.
    (doc.status NOT IN ('cancelado')
       AND NOT (doc.status = 'liquidado'
                AND COALESCE(doc.expected_cash_date, doc.due_date) < h.d)) AS soma_bruta,
    CASE
      WHEN doc.status = 'cancelado' THEN 'documento cancelado na fonte'
      WHEN doc.status = 'liquidado'
       AND COALESCE(doc.expected_cash_date, doc.due_date) < h.d
        THEN 'ja liquidado em ' || to_char(doc.paid_on, 'DD/MM/YYYY')
             || ' — realizado, nao previsto'
    END                                                                  AS motivo_bruto
  FROM fin_document doc CROSS JOIN hoje h
  WHERE COALESCE(doc.expected_cash_date, doc.due_date) IS NOT NULL
),

-- ── B. o custo previsto consolidado (0100) ─────────────────────────────────
custo AS (
  SELECT
    v.entity_id,
    v.dia_esperado                       AS dia,
    'pagar'::text                        AS direcao,
    v.procedencia,
    v.precedencia,
    v.precedencia_nivel,
    v.item_id,
    COALESCE(v.estado, 'projetado')      AS estado,
    v.origem_camada                      AS camada,
    v.descricao,
    v.counterparty_id,
    v.category_id,
    v.nucleo,
    v.cost_center_id,
    v.valor_cents,
    NULL::bigint                         AS realizado_cents,
    NULL::date                           AS realizado_em,
    -- Item manual nao nasceu de projecao nenhuma: a origem dele e a propria
    -- tabela que o guarda. Sem isto, `origem_tabela` sairia nula e a linha
    -- ficaria fora do alcance de qualquer trava — exatamente o que a
    -- assertiva 6 recusa.
    COALESCE(split_part(v.origem_ref, ':', 1), 'fin_custo_previsto') AS origem_tabela,
    COALESCE(NULLIF(split_part(v.origem_ref, ':', 2), ''), v.item_id::text) AS origem_id_txt,
    COALESCE(v.origem_ref, 'fin_custo_previsto:' || v.item_id) AS origem_ref,
    v.chave_dedupe,
    v.dia_regra,
    v.confianca,
    NULL::text                           AS serie_chave,
    v.entra_no_total                     AS soma_bruta,
    v.motivo_nao_soma                    AS motivo_bruto,
    v.alerta_sobreposicao
  FROM fin_custo_previsto_consolidado_v v
  WHERE v.dia_esperado IS NOT NULL
),

-- ── C. a receita prevista consolidada (§3) ─────────────────────────────────
receita AS (
  SELECT
    v.entity_id,
    v.dia_esperado                       AS dia,
    'receber'::text                      AS direcao,
    v.procedencia,
    v.precedencia,
    v.precedencia_nivel,
    v.item_id,
    COALESCE(v.estado, 'projetado')      AS estado,
    v.origem_camada                      AS camada,
    v.descricao,
    v.counterparty_id,
    v.category_id,
    v.nucleo,
    v.cost_center_id,
    v.valor_cents,
    NULL::bigint                         AS realizado_cents,
    NULL::date                           AS realizado_em,
    COALESCE(split_part(v.origem_ref, ':', 1), 'fin_receita_prevista') AS origem_tabela,
    COALESCE(NULLIF(split_part(v.origem_ref, ':', 2), ''), v.item_id::text) AS origem_id_txt,
    COALESCE(v.origem_ref, 'fin_receita_prevista:' || v.item_id) AS origem_ref,
    v.chave_dedupe,
    v.dia_regra,
    v.confianca,
    NULL::text                           AS serie_chave,
    v.entra_no_total                     AS soma_bruta,
    v.motivo_nao_soma                    AS motivo_bruto,
    v.alerta_sobreposicao
  FROM fin_receita_prevista_consolidado_v v
  WHERE v.dia_esperado IS NOT NULL
),

-- ── a uniao, ainda sem a trava entre A e B/C ───────────────────────────────
bruto AS (
  SELECT entity_id, dia, direcao, procedencia, precedencia, precedencia_nivel,
         item_id, estado, camada, descricao, counterparty_id, category_id,
         nucleo, cost_center_id, valor_cents, realizado_cents, realizado_em,
         origem_tabela, origem_id,
         origem_ref, chave_dedupe, dia_regra, confianca, serie_chave,
         source, external_url, soma_bruta, motivo_bruto,
         NULL::text AS alerta_sobreposicao
    FROM documento

  UNION ALL

  SELECT entity_id, dia, direcao, procedencia, precedencia, precedencia_nivel,
         item_id, estado, camada, descricao, counterparty_id, category_id,
         nucleo, cost_center_id, valor_cents, realizado_cents, realizado_em,
         origem_tabela,
         -- O id sai do proprio ref ('tabela:id'). Regex e nao cast direto:
         -- 'das:2026-09' e 'fin_card_bill:2026-09:parcela' sao refs validos
         -- cujo segundo campo nao e inteiro, e um cast os derrubaria.
         CASE WHEN origem_id_txt ~ '^[0-9]+$' THEN origem_id_txt::bigint END,
         origem_ref, chave_dedupe, dia_regra, confianca, serie_chave,
         NULL::text, NULL::text, soma_bruta, motivo_bruto, alerta_sobreposicao
    FROM custo

  UNION ALL

  SELECT entity_id, dia, direcao, procedencia, precedencia, precedencia_nivel,
         item_id, estado, camada, descricao, counterparty_id, category_id,
         nucleo, cost_center_id, valor_cents, realizado_cents, realizado_em,
         origem_tabela,
         CASE WHEN origem_id_txt ~ '^[0-9]+$' THEN origem_id_txt::bigint END,
         origem_ref, chave_dedupe, dia_regra, confianca, serie_chave,
         NULL::text, NULL::text, soma_bruta, motivo_bruto, alerta_sobreposicao
    FROM receita
),

-- ── A TRAVA: uma chave, um somador ─────────────────────────────────────────
-- Onde a mesma chave aparece em mais de uma procedencia, quem soma e a de
-- MENOR precedencia_nivel; empate desempata por procedencia ('item' antes de
-- 'documento' antes de 'projetado') e, em ultimo caso, pelo texto da
-- procedencia, para que a escolha seja deterministica e nao dependa da ordem
-- de leitura do planejador.
travado AS (
  SELECT
    b.*,
    row_number() OVER (
      PARTITION BY b.entity_id, b.chave_dedupe
      ORDER BY b.precedencia_nivel,
               CASE b.procedencia WHEN 'item' THEN 0 WHEN 'documento' THEN 1 ELSE 2 END,
               b.procedencia
    ) AS posto,
    count(*) OVER (PARTITION BY b.entity_id, b.chave_dedupe) AS linhas_na_chave,
    -- Quem venceu, para escrever o motivo da que perdeu.
    first_value(b.procedencia) OVER (
      PARTITION BY b.entity_id, b.chave_dedupe
      ORDER BY b.precedencia_nivel,
               CASE b.procedencia WHEN 'item' THEN 0 WHEN 'documento' THEN 1 ELSE 2 END,
               b.procedencia
    ) AS vencedor
  FROM bruto b
)
SELECT
  t.entity_id,
  t.dia,
  date_trunc('month', t.dia)::date                       AS competencia,
  CASE WHEN t.dia <  h.d THEN 'passado'
       WHEN t.dia =  h.d THEN 'hoje'
       ELSE 'futuro' END                                 AS tempo,
  (t.dia - h.d)                                          AS dias_a_frente,
  t.direcao,
  t.procedencia,
  t.precedencia,
  t.precedencia_nivel,
  t.item_id,
  t.estado,
  t.camada,
  t.descricao,
  t.counterparty_id,
  cp.name                                                AS contraparte,
  t.category_id,
  c.code                                                 AS categoria_code,
  c.name                                                 AS categoria,
  t.nucleo,
  t.cost_center_id,
  t.valor_cents,
  -- Assinado: entrada positiva, saida negativa. E o que o agregado soma.
  CASE WHEN t.direcao = 'receber' THEN t.valor_cents ELSE -t.valor_cents END AS assinado_cents,
  t.realizado_cents,
  t.realizado_em,
  -- Quantos dias entre o esperado e o realizado. Negativo = entrou antes.
  CASE WHEN t.realizado_em IS NOT NULL THEN (t.realizado_em - t.dia) END     AS atraso_dias,
  -- Vencido: o dia passou, e nao ha realizado. NULL no futuro — ausencia de
  -- dado, nao afirmacao de que esta em dia.
  CASE WHEN t.dia < h.d
       THEN (t.realizado_em IS NULL AND t.estado NOT IN ('liquidado','cancelado','ignorado','realizado'))
  END                                                    AS vencido,
  t.origem_tabela,
  t.origem_id,
  t.origem_ref,
  t.chave_dedupe,
  t.dia_regra,
  t.confianca,
  -- O vocabulario de certeza da tela (components/financeiro/Certeza.tsx), com
  -- exatamente cinco valores. `estimado` vira `indeterminado` porque e o degrau
  -- mais fraco da escala e a tela precisa hachura-lo: 286 dos 312 eventos de
  -- folha do horizonte sao repeticao de uma media, e chama-los de 'contratado'
  -- seria mentir sobre o horizonte.
  CASE
    WHEN t.dia < h.d
     AND t.realizado_em IS NULL
     AND t.estado NOT IN ('liquidado','cancelado','ignorado','realizado') THEN 'atrasado'
    WHEN t.confianca IN ('faturado','contratado','firme','derivado') THEN 'firme'
    WHEN t.confianca = 'provavel'  THEN 'provavel'
    WHEN t.confianca = 'observado' THEN 'observado'
    WHEN t.confianca = 'atrasado'  THEN 'atrasado'
    ELSE 'indeterminado'
  END                                                    AS certeza,
  t.serie_chave,
  t.source,
  t.external_url,
  -- A DECISAO FINAL SOBRE SOMAR. Duas condicoes, e as duas tem de valer:
  -- a fonte disse que soma, E esta linha ganhou a chave.
  (t.soma_bruta AND t.posto = 1)                         AS entra_no_total,
  CASE
    WHEN t.posto > 1
      THEN 'mesmo dinheiro ja contado pela procedencia "' || t.vencedor
           || '" (chave ' || t.chave_dedupe || ')'
    ELSE t.motivo_bruto
  END                                                    AS motivo_nao_soma,
  t.linhas_na_chave,
  t.alerta_sobreposicao
FROM travado t
CROSS JOIN hoje h
LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
LEFT JOIN fin_category     c  ON c.id  = t.category_id;

COMMENT ON VIEW fin_agenda_dia_v IS
  'A agenda diaria de obrigacoes: uma linha por (dia, item), nas duas direcoes, do passado ao futuro. '
  'SOME SO onde entra_no_total = true — duas linhas com a mesma chave_dedupe sao o MESMO dinheiro visto '
  'por procedencias diferentes, e a linha perdedora fica visivel com motivo_nao_soma. '
  'O passado vem de fin_document (data real) e dos itens; a projecao so alcanca de hoje em diante. '
  'certeza usa o vocabulario de components/financeiro/Certeza.tsx (5 valores).';

-- ===========================================================================
-- §5 · fin_agenda_resumo_dia_v — o dia fechado, com saldo acumulado
-- ===========================================================================
-- Entrada, saida, liquido e saldo projetado ao fim do dia. E, no passado, o
-- REALIZADO ao lado — que e como a previsao aprende.
--
-- A ancora do saldo e a mesma de `fin_caixa_previsto_dia_v`: o saldo declarado
-- das contas ativas, excluida a conta de emprestimo (que nao e caixa
-- operacional — regra do Fernando). Repetir a ancora aqui em vez de reusar
-- aquela view e deliberado: a agenda tem passado e aquela nao, e um LEFT JOIN
-- deixaria o saldo nulo em metade da linha do tempo.
--
-- O SALDO ACUMULADO SO EXISTE DE HOJE PARA FRENTE, e a coluna e NULL no
-- passado. O saldo de um dia passado nao e "ancora menos o que foi previsto":
-- e o extrato daquele dia, e ele mora em fin_transaction.balance_after_cents.
-- Inventar um acumulado retroativo a partir da ancora de hoje produziria uma
-- curva que nunca existiu.
CREATE VIEW fin_agenda_resumo_dia_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
ancora AS (
  SELECT e.id AS entity_id,
         SUM(a.current_balance_cents) AS saldo_cents,
         MIN(a.last_statement_at)::date AS ancora_ate
    FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
   WHERE e.slug = 'xpe' AND a.is_active AND a.kind <> 'emprestimo'
   GROUP BY 1
),
-- A janela: do primeiro dia com obrigacao ate um ano a frente.
limites AS (
  SELECT LEAST(COALESCE(min(v.dia), h.d), h.d) AS d0,
         GREATEST(COALESCE(max(v.dia), h.d), h.d + 365) AS d1
    FROM fin_agenda_dia_v v CROSS JOIN hoje h GROUP BY h.d
),
dias AS (
  SELECT gs::date AS dia FROM limites l, generate_series(l.d0, l.d1, interval '1 day') gs
),
-- O previsto do dia, so o que soma.
prev AS (
  SELECT
    v.entity_id, v.dia,
    SUM(v.valor_cents) FILTER (WHERE v.direcao = 'receber' AND v.entra_no_total)::bigint AS entrada_cents,
    SUM(v.valor_cents) FILTER (WHERE v.direcao = 'pagar'   AND v.entra_no_total)::bigint AS saida_cents,
    SUM(v.assinado_cents) FILTER (WHERE v.entra_no_total)::bigint                        AS liquido_cents,
    COUNT(*) FILTER (WHERE v.entra_no_total)                                             AS itens,
    COUNT(*) FILTER (WHERE NOT v.entra_no_total)                                         AS itens_fora_da_soma,
    SUM(v.valor_cents) FILTER (WHERE NOT v.entra_no_total)::bigint                       AS fora_da_soma_cents,
    COUNT(*) FILTER (WHERE v.vencido)                                                    AS itens_vencidos,
    SUM(v.valor_cents) FILTER (WHERE v.vencido)::bigint                                  AS vencido_cents,
    SUM(v.valor_cents) FILTER (WHERE v.entra_no_total AND v.certeza = 'indeterminado')::bigint AS estimado_cents,
    COUNT(*) FILTER (WHERE v.entra_no_total AND v.procedencia = 'item' AND v.precedencia = 'manual') AS itens_manuais,
    COUNT(*) FILTER (WHERE v.entra_no_total AND v.precedencia = 'confirmado')            AS itens_confirmados
  FROM fin_agenda_dia_v v
  GROUP BY 1,2
),
-- O realizado do dia: caixa, sempre. So passado e hoje.
real_dia AS (
  SELECT t.entity_id, t.posted_on AS dia,
         SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0)::bigint AS entrada_cents,
         SUM(-t.amount_cents) FILTER (WHERE t.amount_cents < 0)::bigint AS saida_cents,
         SUM(t.amount_cents)::bigint                                    AS liquido_cents,
         COUNT(*)                                                       AS lancamentos
    FROM fin_transaction t
   WHERE t.transfer_status = 'nao' AND NOT t.is_split_parent
   GROUP BY 1,2
)
SELECT
  a.entity_id,
  d.dia,
  date_trunc('month', d.dia)::date AS competencia,
  CASE WHEN d.dia < h.d THEN 'passado' WHEN d.dia = h.d THEN 'hoje' ELSE 'futuro' END AS tempo,
  (d.dia - h.d) AS dias_a_frente,
  a.ancora_ate,
  a.saldo_cents AS ancora_saldo_cents,

  COALESCE(p.entrada_cents, 0) AS entrada_cents,
  COALESCE(p.saida_cents, 0)   AS saida_cents,
  COALESCE(p.liquido_cents, 0) AS liquido_cents,
  COALESCE(p.itens, 0)         AS itens,
  COALESCE(p.itens_fora_da_soma, 0)  AS itens_fora_da_soma,
  COALESCE(p.fora_da_soma_cents, 0)  AS fora_da_soma_cents,
  COALESCE(p.itens_vencidos, 0)      AS itens_vencidos,
  COALESCE(p.vencido_cents, 0)       AS vencido_cents,
  COALESCE(p.estimado_cents, 0)      AS estimado_cents,
  COALESCE(p.itens_manuais, 0)       AS itens_manuais,
  COALESCE(p.itens_confirmados, 0)   AS itens_confirmados,

  -- O saldo acumulado, so do horizonte para frente. NULL no passado, com
  -- motivo: o saldo de ontem e o extrato de ontem, nao a ancora de hoje menos
  -- previsao. Ver o comentario acima da view.
  CASE WHEN d.dia >= h.d THEN
    a.saldo_cents + COALESCE(SUM(CASE WHEN d.dia >= h.d THEN COALESCE(p.liquido_cents, 0) ELSE 0 END)
                             OVER (ORDER BY d.dia ROWS UNBOUNDED PRECEDING), 0)
  END AS saldo_previsto_cents,

  -- Realizado do dia. NULL (nao zero) quando nao ha lancamento: ausencia de
  -- dado nao e afirmacao de que nada se moveu. Todo o futuro cai aqui.
  r.entrada_cents  AS realizado_entrada_cents,
  r.saida_cents    AS realizado_saida_cents,
  r.liquido_cents  AS realizado_liquido_cents,
  r.lancamentos    AS realizado_lancamentos,
  -- Previsto menos realizado, no dia. So faz sentido no passado.
  CASE WHEN d.dia < h.d AND r.liquido_cents IS NOT NULL
       THEN COALESCE(p.liquido_cents, 0) - r.liquido_cents END AS erro_do_dia_cents
FROM dias d
CROSS JOIN hoje h
CROSS JOIN ancora a
LEFT JOIN prev p     ON p.dia = d.dia AND p.entity_id = a.entity_id
LEFT JOIN real_dia r ON r.dia = d.dia AND r.entity_id = a.entity_id;

COMMENT ON VIEW fin_agenda_resumo_dia_v IS
  'O dia fechado da agenda: entrada, saida, liquido, saldo projetado ao fim do dia e — no passado — o '
  'realizado de caixa ao lado. saldo_previsto_cents e NULL no passado de proposito: o saldo de um dia '
  'que ja passou e o extrato daquele dia, nao a ancora de hoje projetada para tras. '
  'realizado_* NULL significa ausencia de lancamento, nunca zero.';

-- ===========================================================================
-- §6 · fin_agenda_serie_v — "valores que se repetem", com fim declarado
-- ===========================================================================
-- O Fernando pediu isto nominalmente. Para cada serie: quantas vezes ja
-- ocorreu, valor tipico, desvio, e QUANDO TERMINA.
--
-- A DISTINCAO QUE NAO PODE SER PERDIDA. Recorrente e parcelado tem a mesma
-- assinatura estatistica — densidade 1,00, dispersao 0,00, concentracao 1,00,
-- identicos — e sao coisas diferentes: parcelamento acaba, assinatura nao. Um
-- detector estatistico superestimou a receita recorrente em 37% justamente por
-- nao ver a diferenca (CONTINUACAO §4). A correcao nao foi ajustar limiar: foi
-- ler o que a FONTE declara. Aqui:
--
--   `fin_recurring.source = 'contrato'` + `end_month` nulo   → assinatura
--   `fin_recurring.source = 'contrato'` + `end_month` cheio  → parcelamento
--   `fin_recurring.source = 'deteccao_historico'`            → padrao observado
--
-- O terceiro caso NAO e chamado de assinatura mesmo tendo fim nulo, e essa e a
-- honestidade do arranjo: fim nulo por deteccao significa "nao sei quando
-- acaba", nao "nao acaba". A coluna `fim_declarado` separa os dois — false
-- quando o fim nulo e ignorancia, true quando e a natureza do contrato.
--
-- E o parcelamento do Asaas do lado do documento (715 cobrancas com
-- `installment_group_id`) entra como serie propria, com o numero da parcela.
CREATE VIEW fin_agenda_serie_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),

-- ── as series declaradas em fin_recurring ─────────────────────────────────
recorrente AS (
  SELECT
    r.entity_id,
    'fin_recurring:' || r.id                       AS serie_ref,
    'fin_recurring'::text                          AS serie_tabela,
    r.id                                           AS serie_id,
    r.direction                                    AS direcao,
    r.label                                        AS descricao,
    r.counterparty_id,
    r.category_id,
    CASE
      WHEN r.source = 'contrato' AND r.end_month IS NULL THEN 'assinatura'
      WHEN r.source = 'contrato'                         THEN 'parcelamento'
      ELSE 'padrao_observado'
    END                                            AS tipo,
    -- O fim e DECLARADO ou apenas desconhecido? A diferenca decide se a tela
    -- pode escrever "nao termina" ou tem de escrever "fim nao declarado".
    (r.source = 'contrato')                        AS fim_declarado,
    r.end_month,
    r.start_month,
    r.day_of_month,
    r.cadence,
    r.status,
    r.confidence,
    r.amount_cents                                 AS valor_tipico_cents,
    r.amount_basis,
    r.ocorrencias,
    r.span_meses,
    r.densidade,
    r.dispersao,
    r.day_concentration,
    r.amostra_de,
    r.amostra_ate,
    r.last_seen_on,
    -- Quantos meses ainda faltam ate o fim declarado. NULL quando nao ha fim
    -- declarado — e NULL aqui e a resposta certa, nao "infinito".
    CASE WHEN r.end_month IS NOT NULL
         THEN GREATEST(0, (EXTRACT(YEAR FROM age(r.end_month, date_trunc('month', h.d)))*12
                         + EXTRACT(MONTH FROM age(r.end_month, date_trunc('month', h.d))))::int + 1)
    END                                            AS meses_restantes
  FROM fin_recurring r CROSS JOIN hoje h
),

-- ── as series de parcelamento do Asaas, do lado do documento ──────────────
-- 715 cobrancas carregam `installment_group_id`. `installment_total` esta
-- vazio na base inteira (medido: max = NULL), entao o total da serie e
-- CONTADO, nao lido — e a coluna diz isso: `total_e_contado = true`. Chamar a
-- contagem de "total declarado" seria inventar uma declaracao que a fonte nao
-- fez.
parcelamento_doc AS (
  SELECT
    d.entity_id,
    'fin_document_grupo:' || d.installment_group_id AS serie_ref,
    'fin_document'::text                           AS serie_tabela,
    NULL::bigint                                   AS serie_id,
    d.direction                                    AS direcao,
    min(d.description)                             AS descricao,
    min(d.counterparty_id)                         AS counterparty_id,
    min(d.category_id)                             AS category_id,
    'parcelamento'::text                           AS tipo,
    true                                           AS fim_declarado,
    date_trunc('month', max(d.due_date))::date     AS end_month,
    date_trunc('month', min(d.due_date))::date     AS start_month,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(day from d.due_date)))::int AS day_of_month,
    'mensal'::text                                 AS cadence,
    'ativo'::text                                  AS status,
    'faturado'::text                               AS confidence,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.amount_cents))::bigint AS valor_tipico_cents,
    'declarado'::text                              AS amount_basis,
    count(*)::int                                  AS ocorrencias,
    (EXTRACT(YEAR FROM age(max(d.due_date), min(d.due_date)))*12
     + EXTRACT(MONTH FROM age(max(d.due_date), min(d.due_date))))::int + 1 AS span_meses,
    NULL::numeric AS densidade, NULL::numeric AS dispersao, NULL::numeric AS day_concentration,
    min(d.due_date) AS amostra_de, max(d.due_date) AS amostra_ate,
    max(d.paid_on)  AS last_seen_on,
    count(*) FILTER (WHERE d.status NOT IN ('liquidado','cancelado'))::int AS meses_restantes
  FROM fin_document d
  WHERE d.installment_group_id IS NOT NULL
  GROUP BY d.entity_id, d.installment_group_id, d.direction
)
SELECT
  s.*,
  cp.name AS contraparte,
  c.code  AS categoria_code,
  c.name  AS categoria,
  -- O que ja se observou desta serie, medido no ledger e nao no detector.
  -- `desvio_pct` e a dispersao do valor efetivamente pago em torno da mediana:
  -- e o que responde "esse valor se repete mesmo, ou so parece?".
  o.ocorrencias_medidas,
  o.valor_mediano_cents,
  o.valor_min_cents,
  o.valor_max_cents,
  o.desvio_pct,
  o.primeira_ocorrencia,
  o.ultima_ocorrencia,
  CASE
    WHEN s.tipo = 'parcelamento' AND s.meses_restantes IS NOT NULL
      THEN 'termina em ' || COALESCE(to_char(s.end_month, 'MM/YYYY'), '?')
           || ' (' || s.meses_restantes || ' restante(s))'
    WHEN s.tipo = 'assinatura'
      THEN 'assinatura declarada no contrato: sem fim'
    WHEN s.tipo = 'padrao_observado'
      THEN 'fim nao declarado — a serie foi DETECTADA no historico, nao contratada'
  END AS leitura_do_fim,
  -- O total da serie foi contado por nos ou declarado pela fonte?
  -- `fin_document.installment_total` esta vazio na base inteira.
  (s.serie_tabela = 'fin_document') AS total_e_contado
FROM (SELECT * FROM recorrente UNION ALL SELECT * FROM parcelamento_doc) s
LEFT JOIN fin_counterparty cp ON cp.id = s.counterparty_id
LEFT JOIN fin_category     c  ON c.id  = s.category_id
LEFT JOIN LATERAL (
  -- O historico medido da serie. Para a recorrente, a chave e (contraparte,
  -- categoria, sinal) — a mesma que o detector usou; para o parcelamento, o
  -- proprio grupo. Nao ha pareamento fino aqui de proposito: um pareador errado
  -- transformaria "previ certo" em "previ errado" sem ninguem ver por que.
  SELECT
    count(*)::int                                                     AS ocorrencias_medidas,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(t.amount_cents)))::bigint AS valor_mediano_cents,
    min(abs(t.amount_cents))                                          AS valor_min_cents,
    max(abs(t.amount_cents))                                          AS valor_max_cents,
    -- Os casts para numeric sao obrigatorios: percentile_cont sobre bigint
    -- devolve double precision, e round(double, int) nao existe no Postgres.
    CASE WHEN percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(t.amount_cents)) > 0
         THEN round((100.0 * stddev_pop(abs(t.amount_cents))
                     / percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(t.amount_cents)))::numeric, 1)
    END                                                               AS desvio_pct,
    min(t.posted_on)                                                  AS primeira_ocorrencia,
    max(t.posted_on)                                                  AS ultima_ocorrencia
  FROM fin_transaction t
  WHERE t.entity_id = s.entity_id
    AND t.counterparty_id IS NOT DISTINCT FROM s.counterparty_id
    AND t.counterparty_id IS NOT NULL
    AND t.transfer_status = 'nao' AND NOT t.is_split_parent
    AND ((s.direcao = 'pagar' AND t.amount_cents < 0)
      OR (s.direcao = 'receber' AND t.amount_cents > 0))
) o ON true;

COMMENT ON VIEW fin_agenda_serie_v IS
  'O padrao de repeticao por serie: ocorrencias, valor tipico, desvio medido no ledger e QUANDO TERMINA. '
  'tipo distingue assinatura (fim declarado ausente por natureza) de parcelamento (fim declarado) de '
  'padrao_observado (fim ausente por IGNORANCIA) — fim_declarado separa os dois casos de fim nulo. '
  'A distincao vem da fonte, nunca do detector: le-la errado ja custou 37% de superestimativa nesta base.';

-- ===========================================================================
-- §7 · fin_agenda_prova_v — a prova de que a agenda nao duplica
-- ===========================================================================
-- Nao e um comentario dizendo que esta certo: e a conta, mes a mes, ao lado da
-- previsao mensal ja validada.
--
-- O QUE SE COMPARA. Do lado da agenda, o que soma (`entra_no_total`), de hoje
-- para frente, excluido o que nasceu de decisao humana (item manual, e o ajuste
-- que a confirmacao fez sobre o valor previsto). Do lado da referencia,
-- `fin_previsao_evento_v` com `entra_no_saldo`, excluida a camada
-- `receber_vencido` — que a §2 tira da agenda por estar ancorada em hoje.
--
-- COM A BASE ZERADA DE ITENS, `delta_cents` TEM DE SER 0 EM TODO MES. Com itens
-- confirmados, o delta e exatamente `ajuste_humano_cents` — e a coluna
-- `delta_explicado` confere isso. Um delta que nao se explica pelo ajuste
-- humano e dupla contagem, e o teste falha.
CREATE VIEW fin_agenda_prova_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
agenda AS (
  SELECT
    v.entity_id,
    v.competencia,
    v.direcao,
    SUM(v.valor_cents) FILTER (WHERE v.entra_no_total)::bigint AS soma_cents,
    COUNT(*) FILTER (WHERE v.entra_no_total)                   AS linhas,
    -- O que veio de decisao humana e por isso legitimamente diverge da projecao.
    SUM(v.valor_cents) FILTER (
      WHERE v.entra_no_total AND v.procedencia = 'item' AND v.precedencia = 'manual'
    )::bigint                                                  AS manual_cents,
    COUNT(*) FILTER (
      WHERE v.entra_no_total AND v.procedencia = 'item' AND v.precedencia = 'manual'
    )                                                          AS manual_linhas
  FROM fin_agenda_dia_v v CROSS JOIN hoje h
  WHERE v.dia >= h.d
  GROUP BY 1,2,3
),
-- O ajuste que a confirmacao fez sobre o valor projetado, item a item.
ajuste AS (
  SELECT date_trunc('month', i.competencia)::date AS competencia, 'pagar'::text AS direcao,
         SUM(COALESCE(i.valor_confirmado_cents, 0) - COALESCE(i.valor_previsto_cents, 0))::bigint AS ajuste_cents
    FROM fin_custo_previsto i CROSS JOIN hoje h
   WHERE i.estado IN ('confirmado','realizado') AND i.dia_esperado >= h.d
   GROUP BY 1,2
  UNION ALL
  SELECT date_trunc('month', i.competencia)::date, 'receber'::text,
         SUM(COALESCE(i.valor_confirmado_cents, 0) - COALESCE(i.valor_previsto_cents, 0))::bigint
    FROM fin_receita_prevista i CROSS JOIN hoje h
   WHERE i.estado IN ('confirmado','realizado') AND i.dia_esperado >= h.d
   GROUP BY 1,2
),
referencia AS (
  SELECT
    ev.entity_id,
    date_trunc('month', ev.dia)::date AS competencia,
    CASE ev.sentido WHEN 'entrada' THEN 'receber' ELSE 'pagar' END AS direcao,
    SUM(ev.valor_cents)::bigint AS soma_cents,
    COUNT(*)                    AS linhas
  FROM fin_previsao_evento_v ev
  WHERE ev.entra_no_saldo
    AND ev.camada <> 'receber_vencido'
  GROUP BY 1,2,3
)
SELECT
  COALESCE(a.entity_id, r.entity_id)     AS entity_id,
  COALESCE(a.competencia, r.competencia) AS competencia,
  COALESCE(a.direcao, r.direcao)         AS direcao,
  COALESCE(a.soma_cents, 0)              AS agenda_cents,
  COALESCE(a.linhas, 0)                  AS agenda_linhas,
  COALESCE(r.soma_cents, 0)              AS previsao_cents,
  COALESCE(r.linhas, 0)                  AS previsao_linhas,
  COALESCE(a.manual_cents, 0)            AS manual_cents,
  COALESCE(a.manual_linhas, 0)           AS manual_linhas,
  COALESCE(j.ajuste_cents, 0)            AS ajuste_humano_cents,
  (COALESCE(a.soma_cents, 0) - COALESCE(r.soma_cents, 0)) AS delta_cents,
  -- O delta e explicavel? Item manual soma por cima da projecao (legitimo);
  -- a confirmacao ajusta o valor (legitimo). Qualquer outra coisa e dupla
  -- contagem ou linha perdida.
  ((COALESCE(a.soma_cents, 0) - COALESCE(r.soma_cents, 0))
     = (COALESCE(a.manual_cents, 0) + COALESCE(j.ajuste_cents, 0))) AS delta_explicado,
  CASE
    WHEN (COALESCE(a.soma_cents, 0) - COALESCE(r.soma_cents, 0))
         <> (COALESCE(a.manual_cents, 0) + COALESCE(j.ajuste_cents, 0))
      THEN 'delta nao explicado por item manual nem por ajuste de confirmacao — investigar dupla contagem'
  END AS leitura
FROM agenda a
FULL OUTER JOIN referencia r
  ON  r.entity_id   = a.entity_id
  AND r.competencia = a.competencia
  AND r.direcao     = a.direcao
LEFT JOIN ajuste j
  ON  j.competencia = COALESCE(a.competencia, r.competencia)
  AND j.direcao     = COALESCE(a.direcao, r.direcao);

COMMENT ON VIEW fin_agenda_prova_v IS
  'A prova de que a agenda nao duplica: soma do mes na agenda x fin_previsao_evento_v (a previsao mensal '
  'ja validada), por direcao. delta_explicado = false e dupla contagem ou linha perdida — nunca ruido. '
  'O unico delta legitimo e item manual mais o ajuste que a confirmacao fez sobre o valor projetado.';

-- ===========================================================================
-- §8 · ASSERTIVAS — estruturais, nao um numero de 16/08 congelado
-- ===========================================================================
DO $$
DECLARE
  v_itens   integer;
  v_dup     integer;
  v_dup_key integer;
  v_prova   integer;
  v_dia     integer;
  v_fontes  integer;
BEGIN
  -- 1. A tabela nasce vazia. Cadastrar receita futura e ato humano, e nenhuma
  --    migration o toma no lugar de ninguem.
  SELECT count(*) INTO v_itens FROM fin_receita_prevista;
  IF v_itens <> 0 THEN
    RAISE EXCEPTION '0104: fin_receita_prevista deveria nascer vazia, tem % linha(s)', v_itens;
  END IF;

  -- 2. A chave de supressao tem de ser unica na projecao de entrada. Se deixar
  --    de ser, materializar um derivado calaria mais de uma linha.
  SELECT count(*) INTO v_fontes FROM fin_receita_prevista_derivado_v WHERE fontes_no_ref > 1;
  IF v_fontes <> 0 THEN
    RAISE EXCEPTION '0104: % chave(s) de entrada com mais de uma fonte — a supressao calaria demais', v_fontes;
  END IF;

  -- 3. A REGRA CENTRAL: entre as linhas que SOMAM, chave_dedupe e unica.
  --    Duas linhas somaveis com a mesma chave sao o mesmo dinheiro contado
  --    duas vezes — o defeito de R$ 1,27 milhao da 0060, na versao diaria.
  SELECT count(*) INTO v_dup FROM (
    SELECT entity_id, chave_dedupe FROM fin_agenda_dia_v
     WHERE entra_no_total GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF v_dup <> 0 THEN
    RAISE EXCEPTION '0104: % chave(s) repetida(s) entre linhas que somam na agenda', v_dup;
  END IF;

  -- 4. E a mesma coisa dita pelo outro lado: nenhum documento pode aparecer
  --    somando duas vezes no mesmo dia.
  SELECT count(*) INTO v_dup_key FROM (
    SELECT entity_id, dia, origem_tabela, origem_id, direcao
      FROM fin_agenda_dia_v
     WHERE entra_no_total AND origem_id IS NOT NULL
     GROUP BY 1,2,3,4,5 HAVING count(*) > 1
  ) x;
  IF v_dup_key <> 0 THEN
    RAISE EXCEPTION '0104: % origem(ns) somando mais de uma vez no mesmo dia', v_dup_key;
  END IF;

  -- 5. A PROVA CONTRA A PREVISAO MENSAL JA VALIDADA. Com a base sem itens, o
  --    delta tem de ser zero em todo mes; com itens, tem de ser explicado.
  SELECT count(*) INTO v_prova FROM fin_agenda_prova_v WHERE NOT delta_explicado;
  IF v_prova <> 0 THEN
    RAISE EXCEPTION
      '0104: % mes(es) em que a soma da agenda nao bate com fin_previsao_evento_v nem se explica por decisao humana',
      v_prova;
  END IF;

  -- 6. Toda linha da agenda tem dia, chave e origem. Uma linha sem chave e uma
  --    linha que nenhuma trava alcanca.
  SELECT count(*) INTO v_dia FROM fin_agenda_dia_v
   WHERE dia IS NULL OR chave_dedupe IS NULL OR origem_tabela IS NULL;
  IF v_dia <> 0 THEN
    RAISE EXCEPTION '0104: % linha(s) da agenda sem dia, sem chave ou sem origem', v_dia;
  END IF;

  RAISE NOTICE '0104: agenda diaria criada; % linha(s) na view, prova de nao-duplicacao passou',
    (SELECT count(*) FROM fin_agenda_dia_v);
END $$;
