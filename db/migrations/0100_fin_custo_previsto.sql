-- O custo previsto do mes deixa de ser so leitura: passa a poder ser
-- confirmado, ajustado e completado por quem conhece a operacao.
--
-- ===========================================================================
-- 0. O QUE FOI MEDIDO ANTES DE ESCREVER ESTA MIGRATION — 16/08/2026
-- ===========================================================================
-- Primeiro, uma correcao de fato: `fin_previsao_saida_v` NAO EXISTE. Ela e
-- citada em OBJETIVOS_METAS.md §2 e em MAPA_CONCLUSAO.md crit. 21, e a
-- auditoria do Codex ja tinha registrado que a view nunca foi criada por
-- migration nenhuma. Quem responde "quanto sai" e `fin_previsao_evento_v`
-- (0079), filtrada por `sentido = 'saida'`. Esta migration le dela, e nao da
-- view fantasma.
--
-- O que a saida prevista e hoje, medido (460 eventos de saida no horizonte,
-- 460 chaves distintas de (mes, origem_ref) — a chave e unica, e a assertiva
-- ao fim deste arquivo continua conferindo isso):
--
--   camada                     entra no saldo   set/2026
--   pagar_folha                      sim        R$  90.186,85   26 pessoas
--   pagar_tributo_das                sim        R$  17.647,03
--   pagar_documento                  sim        R$   5.900,00    3 documentos
--   pagar_cartao_ciclo/parcela/est.  sim        R$   8.796,82
--   pagar_recorrente                 NAO        R$  11.593,04    9 fornecedores
--
-- E o buraco, de `fin_pagar_cobertura_v` (0096), tambem medido hoje:
--
--   set/2026  saida real mediana R$ 150.530,13 · prevista no saldo
--             R$ 122.530,70 · lacuna R$ 27.999,43 · cobertura 81,4%
--   fev/2027  cobertura 68,0%
--
-- (O numero de R$ 43.059,02/mes que circula nos documentos e anterior a 0095 e
-- a 0096. A lacuna encolheu porque a conta a pagar comecou a existir, nao
-- porque alguem ajustou uma media.)
--
-- Duas coisas ficam impossiveis sem esta migration:
--
--   a) CONFIRMAR. As 11 recorrentes de despesa estao em `status = 'proposto'`
--      e o CHECK da 0057 as mantem fora do saldo — corretamente, porque
--      ninguem as confirmou. Mas "confirmar" hoje so existe como mudar o
--      status da recorrente inteira, o que e uma decisao sobre TODOS os meses
--      futuros. Nao ha como dizer "em setembro este aluguel vai sair, e vai
--      sair R$ 1.622,00 em vez dos R$ 1.621,00 detectados".
--
--   b) ACRESCENTAR. Os R$ 27.999,43/mes que faltam sao gasto nao recorrente:
--      ele nao tem recorrente, nao tem documento, nao tem fatura. Nao existe
--      lugar nenhum nesta base onde o Fernando possa escrever "em setembro vou
--      gastar R$ 8.000 com X". A previsao so sabe extrapolar o passado.
--
-- ===========================================================================
-- 1. A REGRA QUE GOVERNA TUDO: CONFIRMADO VENCE DERIVADO VENCE PROJETADO
-- ===========================================================================
-- Este e o ponto perigoso, e ele ja custou R$ 1,27 milhao falso uma vez.
--
-- A 0061 resolveu o mesmo problema do lado da entrada: onde existe cobranca
-- emitida para a contraparte naquele mes, a recorrente NAO projeta. Sem essa
-- trava a previsao somava a mesma receita duas vezes — uma como cobranca real,
-- outra como recorrencia detectada.
--
-- Do lado da saida o risco e identico e a solucao e a mesma. Assim que um item
-- derivado e materializado em `fin_custo_previsto`, a linha da projecao que o
-- originou tem de CALAR. Se ela continuar somando, o mes infla exatamente pelo
-- valor de tudo que o usuario confirmou — ou seja, o sistema pune quem trabalha.
--
-- A chave que amarra os dois lados e `origem_ref`, que `fin_previsao_evento_v`
-- ja emite por evento:
--
--   fin_recurring:75          a recorrente 75
--   fin_document:26349        o documento a pagar 26349
--   fin_person:8              a folha de uma pessoa
--   das:2026-09               o DAS da competencia
--   fin_card_bill:2026-09:parcela
--
-- Ela nao carrega o mes (exceto onde o mes E a identidade, como no DAS), entao
-- a chave real e o PAR `(competencia, origem_ref)`. Medido: 460 eventos de
-- saida produzem 460 pares distintos. A assertiva ao fim exige isso; o indice
-- unico parcial da tabela grava a mesma regra.
--
-- `fin_custo_previsto_consolidado_v` emite as duas linhas — o item e a
-- projecao — e marca `entra_no_total` em UMA so, com `motivo_nao_soma` escrito
-- na outra. As duas ficam visiveis de proposito: esconder a suprimida faria o
-- numero parecer vindo do nada, e foi assim que o `naoSomadoCents` da tela de
-- previsao ganhou existencia propria em `contratos/previsao.ts`.
--
-- A PROVA de que nao infla e aritmetica e esta no script
-- `scripts/test-custo-previsto.mjs`: materializar TODOS os derivados de um mes
-- pelo valor de face deixa o total do mes identico ao centavo, e o que entrou
-- em `nao_soma` e exatamente o que foi materializado.
--
-- ===========================================================================
-- 2. O QUE ESTA MIGRATION RECUSA A FAZER
-- ===========================================================================
--   · NAO escreve em `fin_transaction`. Nada aqui toca `amount_cents`,
--     `posted_on` ou `account_id`, e nenhuma coluna de proveniencia
--     (`classified_by`, `classified_rule_id`) e lida ou alterada.
--
--   · NAO confirma nada. A tabela nasce VAZIA. Confirmar recorrente proposta e
--     decisao humana (duvida 33) e continua sendo: esta migration constroi o
--     lugar onde a decisao cabe, nao a decisao.
--
--   · NAO transforma previsto em realizado. `estado = 'realizado'` exige
--     `realizado_transaction_id` apontando para um lancamento de SAIDA que
--     existe no extrato — CHECK e gatilho, nao comentario. Item confirmado
--     continua sendo previsao ate o dinheiro sair. E dois itens nunca podem
--     reivindicar o mesmo lancamento: indice unico.
--
--   · NAO reescreve `fin_previsao_evento_v`. Ela e a fonte unica da composicao
--     de saida e mexer nela mudaria a foto de `fin_cash_forecast` e a linha de
--     base da 0097 no meio da aferição. O que esta migration faz e ler dela.
--
--   · NAO inventa valor. Item sem valor conhecido e permitido — e obrigado a
--     declarar `indeterminado_motivo`, e nao entra em soma nenhuma.
--
-- ===========================================================================
-- 3. UMA SOBREPOSICAO PRE-EXISTENTE, MEDIDA E DECLARADA (nao corrigida aqui)
-- ===========================================================================
-- Enquanto media a saida prevista encontrei uma dupla contagem que JA existe em
-- `fin_previsao_evento_v`, anterior a esta migration:
--
--   os 12 documentos `direction='pagar'` (R$ 23.600,00) criados pela 0095/0096
--   a partir do ClickUp sao TODOS folha — "Folha 09/2026 — Tallany",
--   "Folha 09/2026 — Denilson", "Folha 09/2026 — Adryan" — e as tres pessoas
--   estao em `fin_folha_previsao_v` como 'ativo na folha'. A camada
--   `pagar_documento` (R$ 5.900,00/mes) e a camada `pagar_folha` projetam o
--   mesmo dinheiro.
--
-- A 0079 tem a trava para recorrente 6.x × folha, e nao tem a equivalente para
-- documento × folha, porque quando ela foi escrita `fin_document` era 100% a
-- receber.
--
-- Nao corrijo aqui: mexer na composicao de saida e da frente da previsao, e
-- escolher qual das duas camadas cala e decisao (o documento tem valor
-- contratado; a folha tem o historico). O que faco e NAO ESCONDER: a coluna
-- `alerta_sobreposicao` do consolidado acende quando a mesma contraparte e
-- projetada por mais de uma origem na mesma competencia, e ela acende para
-- Tallany e Denilson. Adryan escapa do alerta porque o documento dele nasceu
-- com `counterparty_id` nulo — o que e, por si so, o achado seguinte.

-- ===========================================================================
-- fin_custo_previsto — o item de custo previsto sobre o qual se pode agir
-- ===========================================================================
CREATE TABLE fin_custo_previsto (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,

  -- ── de onde veio ────────────────────────────────────────────────────────
  -- 'derivado': nasceu de uma linha de fin_previsao_evento_v e por isso tem de
  -- calar a linha que o originou. 'manual': o usuario criou, nao duplica
  -- projecao nenhuma, e e por onde a lacuna de R$ 27.999,43/mes se fecha.
  origem        text NOT NULL CHECK (origem IN ('derivado','manual')),
  -- A chave canonica do que foi materializado. Texto e nao FK porque o que ela
  -- identifica muda de tabela conforme a camada (recorrente, documento,
  -- pessoa, competencia do DAS, ciclo do cartao) — e porque tem de ser
  -- literalmente comparavel com `fin_previsao_evento_v.origem_ref`, que e o
  -- unico jeito de a supressao ser exata em vez de heuristica.
  origem_ref    text,
  origem_camada text,

  -- Os ponteiros tipados existem para o JOIN barato e para o ON DELETE. Sao
  -- redundantes com `origem_ref` de proposito: o texto e a chave de supressao,
  -- estes sao navegacao. Cartao e DAS nao tem ponteiro porque a camada deles
  -- nao aponta para linha nenhuma — o ref e a competencia.
  recurring_id  bigint REFERENCES fin_recurring(id)  ON DELETE SET NULL,
  document_id   bigint REFERENCES fin_document(id)   ON DELETE SET NULL,
  person_id     bigint REFERENCES fin_person(id)     ON DELETE SET NULL,

  -- ── o que e ─────────────────────────────────────────────────────────────
  competencia     date NOT NULL,
  descricao       text NOT NULL CHECK (length(btrim(descricao)) > 0),
  category_id     bigint REFERENCES fin_category(id),
  nucleo          text   REFERENCES fin_nucleo(slug) ON UPDATE CASCADE,
  cost_center_id  bigint REFERENCES fin_cost_center(id),
  counterparty_id bigint REFERENCES fin_counterparty(id),
  -- Dia esperado de CAIXA. Pode cair fora da competencia (um custo de setembro
  -- pago em outubro), e por isso nao ha CHECK amarrando um ao outro: a J3 ja
  -- ensinou o custo de validar competencia contra uma janela arbitraria em vez
  -- de contra a fonte que a declarou.
  dia_esperado    date,
  -- POR QUE ESSE DIA, em uma frase. A agenda diaria (0104) distribui estes
  -- itens no calendario, e um dia sem regra e um dia que ninguem consegue
  -- conferir nem corrigir: "folha no dia 2" e verificavel, "2026-09-02" nao.
  -- Gravado na materializacao e nao so derivado, porque a projecao que o
  -- explica sai do horizonte e o item permanece.
  dia_regra       text,

  -- ── quanto ──────────────────────────────────────────────────────────────
  valor_previsto_cents   bigint CHECK (valor_previsto_cents IS NULL OR valor_previsto_cents > 0),
  -- Separado do previsto porque confirmar PODE ajustar o valor, e a diferenca
  -- entre os dois e informacao: e o erro da projecao, medido item a item por
  -- quem sabe. Guardar so o valor final apagaria exatamente esse sinal.
  valor_confirmado_cents bigint CHECK (valor_confirmado_cents IS NULL OR valor_confirmado_cents >= 0),
  indeterminado_motivo   text,

  -- ── estado ──────────────────────────────────────────────────────────────
  -- previsto → confirmado → realizado, e 'ignorado' para o derivado que nao se
  -- apaga (derivado nao se apaga: se ignora, com motivo).
  estado text NOT NULL DEFAULT 'previsto'
    CHECK (estado IN ('previsto','confirmado','realizado','ignorado')),
  confirmado_por  text,
  confirmado_em   timestamptz,
  confirmacao_nota text,
  ignorado_motivo text,
  realizado_transaction_id bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  realizado_em    timestamptz,

  created_by  text NOT NULL DEFAULT 'sistema',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Competencia e sempre o primeiro dia do mes: toda view mensal deste ledger
  -- usa date_trunc('month', ...) como chave, e um dia 16 gravado aqui casaria
  -- com zero linhas sem erro nenhum.
  CONSTRAINT fin_custo_previsto_competencia_ck
    CHECK (competencia = date_trunc('month', competencia)::date),

  -- Derivado TEM ref (senao nao suprime nada); manual NAO tem (senao suprimiria
  -- uma projecao que nao o originou).
  CONSTRAINT fin_custo_previsto_origem_ref_ck
    CHECK ((origem = 'derivado') = (origem_ref IS NOT NULL)),

  -- Restricao absoluta nº 5: onde nao houver evidencia, o valor e indeterminado
  -- COM MOTIVO — nunca um numero plausivel.
  CONSTRAINT fin_custo_previsto_valor_ou_motivo_ck
    CHECK (valor_previsto_cents IS NOT NULL OR indeterminado_motivo IS NOT NULL),

  -- Confirmar e um ato com autor e hora. Sem os dois, "confirmado" e so uma
  -- palavra numa coluna.
  CONSTRAINT fin_custo_previsto_confirmacao_ck
    CHECK (estado NOT IN ('confirmado','realizado')
           OR (confirmado_por IS NOT NULL AND confirmado_em IS NOT NULL
               AND valor_confirmado_cents IS NOT NULL)),

  CONSTRAINT fin_custo_previsto_ignorado_ck
    CHECK (estado <> 'ignorado' OR ignorado_motivo IS NOT NULL),

  -- PREVISTO NUNCA VIRA REALIZADO SOZINHO. O estado 'realizado' exige o
  -- lancamento; o gatilho abaixo exige que ele seja mesmo uma saida.
  CONSTRAINT fin_custo_previsto_realizado_ck
    CHECK (estado <> 'realizado'
           OR (realizado_transaction_id IS NOT NULL AND realizado_em IS NOT NULL)),

  -- E ninguem carrega ponteiro de lancamento sem estar realizado: o par
  -- incompleto e o que faz o badge da tela mentir (a licao do D6).
  CONSTRAINT fin_custo_previsto_lancamento_so_realizado_ck
    CHECK (realizado_transaction_id IS NULL OR estado = 'realizado')
);

-- A regra anti-dupla-contagem gravada no schema: um item derivado por
-- (competencia, origem_ref). Dois itens para a mesma projecao seriam a dupla
-- contagem nascendo dentro da propria tabela que existe para evita-la.
CREATE UNIQUE INDEX fin_custo_previsto_derivado_key
  ON fin_custo_previsto (entity_id, competencia, origem_ref)
  WHERE origem = 'derivado';

-- Um lancamento realiza no maximo um item previsto.
CREATE UNIQUE INDEX fin_custo_previsto_lancamento_key
  ON fin_custo_previsto (realizado_transaction_id)
  WHERE realizado_transaction_id IS NOT NULL;

CREATE INDEX fin_custo_previsto_mes_ix     ON fin_custo_previsto (entity_id, competencia, estado);
CREATE INDEX fin_custo_previsto_cat_ix     ON fin_custo_previsto (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX fin_custo_previsto_cp_ix      ON fin_custo_previsto (counterparty_id) WHERE counterparty_id IS NOT NULL;

CREATE TRIGGER fin_custo_previsto_touch BEFORE UPDATE ON fin_custo_previsto
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

COMMENT ON TABLE fin_custo_previsto IS
  'Item de custo previsto do mes sobre o qual se pode agir: confirmar, ajustar o valor, criar do zero. '
  'Derivado cala a projecao que o originou (chave: competencia + origem_ref); manual soma por cima. '
  'Nada aqui e caixa: estado realizado exige lancamento em fin_transaction.';
COMMENT ON COLUMN fin_custo_previsto.origem_ref IS
  'Chave canonica identica a fin_previsao_evento_v.origem_ref. E o que faz a supressao ser exata.';
COMMENT ON COLUMN fin_custo_previsto.valor_confirmado_cents IS
  'Separado do previsto porque a diferenca entre os dois E o erro da projecao, medido por quem sabe.';

-- ===========================================================================
-- A guarda: realizado precisa de saida de verdade, e derivado nao se apaga
-- ===========================================================================
CREATE FUNCTION fin_custo_previsto_guarda() RETURNS trigger AS $$
DECLARE
  v_amount bigint;
  v_entity bigint;
BEGIN
  IF NEW.estado = 'realizado' THEN
    SELECT t.amount_cents, t.entity_id INTO v_amount, v_entity
      FROM fin_transaction t WHERE t.id = NEW.realizado_transaction_id;

    IF v_amount IS NULL THEN
      RAISE EXCEPTION 'custo previsto %: estado realizado aponta para lancamento inexistente (%)',
        COALESCE(NEW.id, 0), NEW.realizado_transaction_id;
    END IF;
    -- Um credito nao realiza um custo. Sem esta checagem, "realizado" poderia
    -- ser carimbado sobre qualquer linha do extrato e o confronto
    -- previsto x realizado passaria a comparar coisas de sinais opostos.
    IF v_amount >= 0 THEN
      RAISE EXCEPTION 'custo previsto %: lancamento % nao e saida (amount_cents = %)',
        COALESCE(NEW.id, 0), NEW.realizado_transaction_id, v_amount;
    END IF;
    IF v_entity IS DISTINCT FROM NEW.entity_id THEN
      RAISE EXCEPTION 'custo previsto %: lancamento % e de outra entidade',
        COALESCE(NEW.id, 0), NEW.realizado_transaction_id;
    END IF;
  END IF;

  -- Confirmar nao adianta o caixa. Este e o invariante escrito no gatilho para
  -- que nenhuma rota futura possa contorna-lo por descuido: passar direto de
  -- 'previsto'/'confirmado' para 'realizado' so vale COM lancamento, e o CHECK
  -- acima ja exige o ponteiro. O que falta e o caminho inverso: desfazer um
  -- realizado exige limpar o ponteiro, senao fica orfao contando historia.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'realizado' AND NEW.estado <> 'realizado'
     AND NEW.realizado_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'custo previsto %: para sair de realizado, limpe realizado_transaction_id', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_custo_previsto_guarda_trg
  BEFORE INSERT OR UPDATE ON fin_custo_previsto
  FOR EACH ROW EXECUTE FUNCTION fin_custo_previsto_guarda();

CREATE FUNCTION fin_custo_previsto_apagar_guarda() RETURNS trigger AS $$
BEGIN
  -- Derivado nao se apaga: ele voltaria na proxima leitura da projecao, e o
  -- apagamento teria destruido a nota de quem decidiu ignora-lo. Ignorar com
  -- motivo mantem a decisao visivel; apagar a esconde.
  IF OLD.origem = 'derivado' THEN
    RAISE EXCEPTION 'custo previsto %: item derivado nao se apaga — use estado ignorado com motivo', OLD.id;
  END IF;
  IF OLD.estado = 'realizado' THEN
    RAISE EXCEPTION 'custo previsto %: item realizado nao se apaga', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_custo_previsto_apagar_trg
  BEFORE DELETE ON fin_custo_previsto
  FOR EACH ROW EXECUTE FUNCTION fin_custo_previsto_apagar_guarda();

-- ===========================================================================
-- fin_custo_previsto_derivado_v — o que a projecao oferece, por competencia
-- ===========================================================================
-- Le `fin_previsao_evento_v` e so ela: uma segunda composicao de saida seria
-- uma segunda resposta para "quanto sai", e a 0079 ja registrou por que duas
-- respostas sao piores que uma errada.
--
-- O HORIZONTE TRUNCA O MES CORRENTE, E ISSO E DECLARADO, NAO CONSERTADO.
-- `fin_previsao_evento_v` filtra `dia >= hoje` — ela e uma curva de caixa, nao
-- um fechamento de competencia. Medido em 16/08/2026: agosto oferece 6 eventos
-- (R$ 5.116,83) porque folha (dia 2), DAS (dia 17, ja pago) e cartao ja
-- passaram. O mes corrente vem incompleto POR CONSTRUCAO, e quem le tem de
-- saber: `fin_custo_previsto_categoria_v.dias_do_mes_fora_do_horizonte` conta
-- exatamente quantos dias do mes ficaram atras da linha de hoje, e o confronto
-- com o realizado e onde o mes corrente se le inteiro.
--
-- O GROUP BY e defensivo: o ref do cartao nao carrega o id da conta de cartao
-- ('fin_card_bill:2026-09:parcela'), entao um segundo cartao ativo colidiria.
-- Hoje sao 460 eventos e 460 chaves; `fontes_no_ref` denuncia o dia em que
-- deixar de ser.
--
-- CATEGORIA E NUCLEO VEM DA FONTE QUE OS DECLARA, E O CAMINHO FICA ESCRITO.
-- Medido: 80,8% do custo previsto de set/2026 sai de `fin_previsao_evento_v`
-- sem `category_id`, porque as camadas `pagar_folha` e `pagar_cartao_*`
-- projetam por pessoa e por ciclo, nao por categoria. Uma tela "custo por
-- categoria" em que 81% do dinheiro cai em "sem categoria" nao e uma tela.
--
-- A saida NAO e adivinhar: e ler `fin_person.default_category_id` e
-- `fin_person.default_nucleo`, que sao campos declarados e validados por
-- gatilho proprio (fin_person_categoria_padrao_valida). Onde a pessoa nao tem
-- categoria declarada — 14 das 26 hoje — continua NULL, e `categoria_origem`
-- diz de onde veio cada uma. Cartao continua sem categoria por construcao: a
-- fatura e um agregado, e a categoria dela mora no item do subledger.
CREATE VIEW fin_custo_previsto_derivado_v AS
WITH agrupado AS (
  SELECT
    ev.entity_id,
    date_trunc('month', ev.dia)::date       AS competencia,
    ev.origem_ref,
    min(ev.camada)                          AS origem_camada,
    min(ev.natureza)                        AS natureza,
    min(ev.confianca)                       AS confianca,
    min(ev.confianca_nivel)                 AS confianca_nivel,
    min(ev.dia)                             AS dia_esperado,
    round(sum(ev.valor_cents))::bigint      AS valor_projetado_cents,
    min(ev.sobre_o_que)                     AS descricao,
    min(ev.counterparty_id)                 AS counterparty_id,
    min(ev.category_id)                     AS category_id_da_camada,
    min(ev.account_id)                      AS account_id,
    bool_or(ev.entra_no_saldo)              AS entra_no_saldo,
    min(ev.motivo_nao_soma)                 AS motivo_nao_soma,
    count(*)                                AS fontes_no_ref,
    -- Os ponteiros tipados, extraidos do proprio ref. `split_part` e nao regex
    -- porque o formato e 'tabela:id' e um id que nao seja inteiro deve virar
    -- NULL em silencio, nao derrubar a view.
    CASE WHEN ev.origem_ref LIKE 'fin_recurring:%'
         THEN NULLIF(split_part(min(ev.origem_ref), ':', 2), '')::bigint END AS recurring_id,
    CASE WHEN ev.origem_ref LIKE 'fin_document:%'
         THEN NULLIF(split_part(min(ev.origem_ref), ':', 2), '')::bigint END AS document_id,
    CASE WHEN ev.origem_ref LIKE 'fin_person:%'
         THEN NULLIF(split_part(min(ev.origem_ref), ':', 2), '')::bigint END AS person_id
  FROM fin_previsao_evento_v ev
  WHERE ev.sentido = 'saida'
  GROUP BY ev.entity_id, date_trunc('month', ev.dia)::date, ev.origem_ref
)
SELECT
  a.entity_id, a.competencia, a.origem_ref, a.origem_camada, a.natureza,
  a.confianca, a.confianca_nivel, a.dia_esperado, a.valor_projetado_cents,
  a.descricao, a.counterparty_id, a.account_id, a.entra_no_saldo,
  a.motivo_nao_soma, a.fontes_no_ref,
  a.recurring_id, a.document_id, a.person_id,
  COALESCE(a.category_id_da_camada, p.default_category_id, r.category_id, doc.category_id) AS category_id,
  CASE
    WHEN a.category_id_da_camada IS NOT NULL THEN 'camada'
    WHEN p.default_category_id   IS NOT NULL THEN 'pessoa'
    WHEN r.category_id           IS NOT NULL THEN 'recorrente'
    WHEN doc.category_id         IS NOT NULL THEN 'documento'
  END                                                     AS categoria_origem,
  COALESCE(p.default_nucleo, r.nucleo, doc.nucleo)        AS nucleo,
  -- `fin_person` nao tem centro de custo padrao (o centro de custo desta base e
  -- de projeto, e esta em 1,1% — duvida 19). Recorrente e documento tem.
  COALESCE(r.cost_center_id, doc.cost_center_id)          AS cost_center_id,
  -- A REGRA QUE PRODUZIU `dia_esperado`, em prosa conferivel. Cada frase abaixo
  -- e a transcricao do que a 0079 decidiu, com a medida que a sustentou.
  CASE a.origem_camada
    WHEN 'pagar_folha' THEN
      'folha: dia 2 da competencia — 82% da folha de 2026 saiu nos dias 1 e 2'
    WHEN 'pagar_tributo_das' THEN
      'DAS: dia 17 da competencia — onde caiu o maior volume de 7.01 em 2026'
    WHEN 'pagar_recorrente' THEN
      'recorrente: dia ' || COALESCE(r.day_of_month::text, '?')
        || ' do mes (' || COALESCE(r.due_day_rule, 'exato') || '), limitado ao ultimo dia quando o mes e curto'
    WHEN 'pagar_emprestimo' THEN
      'emprestimo: dia ' || COALESCE(r.day_of_month::text, '?') || ' do mes'
    WHEN 'pagar_documento' THEN
      CASE WHEN doc.expected_cash_date IS NOT NULL
           THEN 'documento: expected_cash_date declarada (' || COALESCE(doc.cash_date_basis, 'sem base') || ')'
           ELSE 'documento: due_date, na ausencia de expected_cash_date' END
    WHEN 'pagar_cartao_parcela'  THEN 'cartao: vencimento da fatura (due_day da conta de cartao)'
    WHEN 'pagar_cartao_ciclo'    THEN 'cartao: vencimento da fatura (due_day da conta de cartao)'
    WHEN 'pagar_cartao_estimado' THEN 'cartao: vencimento da fatura (due_day da conta de cartao)'
  END                                                     AS dia_regra,
  -- A CHAVE DE DEDUPLICACAO, numa string so.
  -- Quem consome esta previsao noutra tela (a agenda diaria da 0104, por
  -- exemplo) tem de poder agrupar por UM campo e ter certeza de que dois
  -- registros com a mesma chave sao o mesmo dinheiro. O par
  -- (competencia, origem_ref) e essa identidade; concatena-lo aqui evita que
  -- cada consumidor reinvente a concatenacao — e reinventa-la errado e
  -- exatamente como se conta R$ 1,27 milhao duas vezes.
  to_char(a.competencia, 'YYYY-MM') || '|' || a.origem_ref AS chave_dedupe
FROM agrupado a
LEFT JOIN fin_person    p   ON p.id   = a.person_id
LEFT JOIN fin_recurring r   ON r.id   = a.recurring_id
LEFT JOIN fin_document  doc ON doc.id = a.document_id;

COMMENT ON VIEW fin_custo_previsto_derivado_v IS
  'A saida projetada por (competencia, origem_ref) — os candidatos a virar item. '
  'Le so fin_previsao_evento_v, e completa categoria/nucleo pelo que pessoa, recorrente e documento DECLARAM '
  '(categoria_origem diz qual). O mes corrente vem truncado pelo horizonte de caixa, de proposito.';

-- ===========================================================================
-- fin_custo_previsto_consolidado_v — onde a dupla contagem morre
-- ===========================================================================
-- Uma linha por item e uma linha por projecao. `entra_no_total` acende em
-- exatamente uma das duas quando elas falam do mesmo dinheiro, e a outra sai
-- com `motivo_nao_soma` escrito. As duas continuam visiveis: a tela precisa
-- poder mostrar "R$ 1.622,00 confirmado (a projecao dizia R$ 1.621,00)".
--
-- A ordem de precedencia, com o nivel numerico para quem quiser cortar:
--   1  confirmado   o item confirmado (ou realizado) manda
--   2  derivado     o item existe mas ainda nao foi confirmado
--   2  manual       item criado do zero; nao disputa com projecao nenhuma
--   3  projetado    a projecao crua, so onde nao existe item
--   9  ignorado     decidido fora, com motivo; nunca soma
--
-- MATERIALIZAR E NEUTRO; SO CONFIRMAR MOVE O NUMERO.
-- Esta e a regra mais facil de errar do arquivo inteiro, e ela apareceu na
-- primeira execucao do teste: um item derivado de `pagar_recorrente` — camada
-- que o CHECK da 0057 mantem FORA do saldo enquanto ninguem confirma — passaria
-- a somar assim que fosse materializado, so por existir como linha. O mes de
-- setembro subiria R$ 11.593,04 sem nenhuma decisao humana, e o CHECK da 0057
-- teria sido contornado por um INSERT em outra tabela.
--
-- Por isso o item DERIVADO ainda em 'previsto' HERDA o `entra_no_saldo` da
-- projecao que o originou. So a confirmacao — que tem autor, hora e valor —
-- promove a linha. O caminho do fornecedor recorrente vira, entao, exatamente
-- o que a duvida 33 pede: a recorrente continua 'proposto' em `fin_recurring`,
-- e o Fernando confirma MES A MES, sem decidir por todos os meses futuros.
CREATE VIEW fin_custo_previsto_consolidado_v AS
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
    -- A identidade do dinheiro, numa string. Item manual nao dedupla com
    -- projecao nenhuma — por isso a chave dele e o proprio id, unica por
    -- construcao e nunca colidivel com uma chave de projecao.
    CASE WHEN i.origem_ref IS NOT NULL
         THEN to_char(i.competencia, 'YYYY-MM') || '|' || i.origem_ref
         ELSE 'item|' || i.id::text END              AS chave_dedupe,
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
       -- herda a somabilidade da projecao ate alguem confirmar; ver acima
       AND (i.estado IN ('confirmado','realizado')
            OR i.origem = 'manual'
            OR COALESCE(d.entra_no_saldo, true)))    AS entra_no_total,
    false                                            AS suprimido_por_item,
    CASE
      WHEN i.estado = 'ignorado'
        THEN 'ignorado: ' || i.ignorado_motivo
      WHEN (CASE WHEN i.estado IN ('confirmado','realizado')
                 THEN i.valor_confirmado_cents ELSE i.valor_previsto_cents END) IS NULL
        THEN 'valor indeterminado: ' || COALESCE(i.indeterminado_motivo, '(motivo ausente)')
      WHEN i.estado = 'previsto' AND i.origem = 'derivado' AND NOT COALESCE(d.entra_no_saldo, true)
        THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel')
             || ' — materializar nao soma; confirmar sim'
      ELSE NULL
    END                                              AS motivo_nao_soma,
    i.confirmado_por,
    i.confirmado_em,
    i.realizado_transaction_id,
    d.confianca,
    d.confianca_nivel,
    d.natureza
  FROM fin_custo_previsto i
  LEFT JOIN fin_custo_previsto_derivado_v d
    ON  d.entity_id   = i.entity_id
    AND d.competencia = i.competencia
    AND d.origem_ref  = i.origem_ref

  UNION ALL

  -- ── 2. a projecao, calada onde ja existe item ───────────────────────────
  SELECT
    d.entity_id,
    d.competencia,
    'projetado'::text,
    'projetado'::text,
    3,
    NULL::bigint,
    'derivado'::text,
    NULL::text,
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
    NULL::bigint,
    d.valor_projetado_cents,
    (d.entra_no_saldo AND NOT EXISTS (
       SELECT 1 FROM fin_custo_previsto i2
        WHERE i2.entity_id   = d.entity_id
          AND i2.competencia = d.competencia
          AND i2.origem_ref  = d.origem_ref)),
    EXISTS (SELECT 1 FROM fin_custo_previsto i2
             WHERE i2.entity_id = d.entity_id
               AND i2.competencia = d.competencia
               AND i2.origem_ref = d.origem_ref),
    CASE
      -- A supressao vem primeiro: quando ha item, ele e a razao, mesmo que a
      -- camada tambem nao somasse. Dizer "recorrente nao confirmada" sobre uma
      -- linha que o usuario ja confirmou seria a mensagem exatamente ao
      -- contrario do que aconteceu.
      WHEN EXISTS (SELECT 1 FROM fin_custo_previsto i2
                    WHERE i2.entity_id = d.entity_id
                      AND i2.competencia = d.competencia
                      AND i2.origem_ref = d.origem_ref)
        THEN 'substituido pelo item #' || (
               SELECT i3.id::text || ' (' || i3.estado || ')' FROM fin_custo_previsto i3
                WHERE i3.entity_id = d.entity_id
                  AND i3.competencia = d.competencia
                  AND i3.origem_ref = d.origem_ref)
      WHEN NOT d.entra_no_saldo THEN COALESCE(d.motivo_nao_soma, 'camada nao somavel')
      ELSE NULL
    END,
    NULL::text,
    NULL::timestamptz,
    NULL::bigint,
    d.confianca,
    d.confianca_nivel,
    d.natureza
  FROM fin_custo_previsto_derivado_v d
)
SELECT
  l.*,
  -- O alerta NAO suprime nada: ele aponta. Mesma contraparte projetada por
  -- duas origens na mesma competencia pode ser dois custos legitimos (um
  -- aluguel e uma multa do mesmo locador) ou o mesmo dinheiro contado duas
  -- vezes. Quem sabe e o humano; o banco so se recusa a esconder a coincidencia.
  CASE
    WHEN l.entra_no_total AND l.counterparty_id IS NOT NULL
     AND count(*) FILTER (WHERE l.entra_no_total)
           OVER (PARTITION BY l.entity_id, l.competencia, l.counterparty_id) > 1
    THEN 'mesma contraparte somando por mais de uma origem nesta competencia — conferir se e o mesmo dinheiro'
  END AS alerta_sobreposicao
FROM linhas l;

COMMENT ON VIEW fin_custo_previsto_consolidado_v IS
  'A saida prevista do mes, item a item, com a precedencia CONFIRMADO > DERIVADO > PROJETADO. '
  'PARA QUEM CONSOME (agenda diaria, previsao de caixa, tela de custos): some SO as linhas com '
  'entra_no_total = true e agrupe por chave_dedupe — duas linhas com a mesma chave sao o MESMO dinheiro '
  'visto por procedencias diferentes, e somar as duas e o erro que ja custou R$ 1,27 milhao falso nesta base. '
  'A linha suprimida continua visivel, com motivo_nao_soma dizendo qual item a substituiu. '
  'dia_esperado e data de caixa e dia_regra diz por que aquele dia. '
  'Materializar um derivado NAO muda o total do mes; so confirmar muda.';

-- ===========================================================================
-- fin_custo_previsto_categoria_v — o mes por categoria, com participacao
-- ===========================================================================
CREATE VIEW fin_custo_previsto_categoria_v AS
WITH base AS (
  SELECT * FROM fin_custo_previsto_consolidado_v WHERE entra_no_total
),
total AS (
  SELECT entity_id, competencia, sum(valor_cents) AS total_cents
    FROM base GROUP BY 1,2
)
SELECT
  b.entity_id,
  b.competencia,
  b.category_id,
  c.code                                   AS categoria_code,
  c.name                                   AS categoria,
  c.kind                                   AS categoria_kind,
  -- Categoria ausente nao e categoria zero: as camadas de folha e de fatura de
  -- cartao nao carregam category_id na origem, e dizer "sem categoria" sem o
  -- motivo faria parecer erro de classificacao.
  CASE WHEN b.category_id IS NULL
       THEN 'a camada de origem nao carrega categoria (folha e fatura de cartao projetam por pessoa e por ciclo)'
  END                                      AS motivo_sem_categoria,
  count(*)                                 AS itens,
  sum(b.valor_cents)::bigint               AS subtotal_cents,
  round(100.0 * sum(b.valor_cents) / NULLIF(t.total_cents, 0), 2) AS participacao_pct,
  t.total_cents::bigint                    AS total_do_mes_cents,
  sum(b.valor_cents) FILTER (WHERE b.precedencia = 'confirmado')::bigint AS confirmado_cents,
  sum(b.valor_cents) FILTER (WHERE b.precedencia = 'derivado')::bigint   AS item_derivado_cents,
  sum(b.valor_cents) FILTER (WHERE b.precedencia = 'manual')::bigint     AS item_manual_cents,
  sum(b.valor_cents) FILTER (WHERE b.precedencia = 'projetado')::bigint  AS projetado_cents,
  count(*) FILTER (WHERE b.precedencia = 'confirmado')                   AS itens_confirmados,
  count(*) FILTER (WHERE b.alerta_sobreposicao IS NOT NULL)              AS itens_com_alerta,
  -- Quantos dias desta competencia ficaram atras do horizonte de caixa. Zero em
  -- mes futuro; em agosto/2026 sao 15, e por isso o mes corrente le baixo.
  GREATEST(0, LEAST(
    (b.competencia + interval '1 month')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date
  ) - b.competencia)                       AS dias_do_mes_fora_do_horizonte
FROM base b
JOIN total t ON t.entity_id = b.entity_id AND t.competencia = b.competencia
LEFT JOIN fin_category c ON c.id = b.category_id
GROUP BY b.entity_id, b.competencia, b.category_id, c.code, c.name, c.kind, t.total_cents;

COMMENT ON VIEW fin_custo_previsto_categoria_v IS
  'Custo previsto do mes por categoria: subtotal, participacao e a quebra por precedencia. '
  'dias_do_mes_fora_do_horizonte diz quanto do mes corrente a projecao nao ve.';

-- ===========================================================================
-- fin_custo_previsto_confronto_v — previsto x confirmado x realizado
-- ===========================================================================
-- O realizado vem de `fin_transaction` e SEMPRE de caixa. Esta view COMPARA;
-- ela nao junta item com lancamento e nao promove nada a realizado. A ligacao
-- item↔lancamento existe em `fin_custo_previsto.realizado_transaction_id` e so
-- e escrita por ato humano explicito.
--
-- A chave da comparacao e (competencia, categoria), nao o item: casar item a
-- item exigiria um pareador, e um pareador errado transformaria "previ certo"
-- em "previ errado" sem que ninguem conseguisse ver por que.
--
-- FULL OUTER JOIN de proposito: a categoria que so aparece do lado realizado E
-- a lacuna de R$ 27.999,43/mes com nome e sobrenome — o gasto que ninguem
-- previu. Um INNER JOIN a esconderia exatamente quando ela importa.
--
-- O realizado exclui apenas receita (saida em categoria de receita e estorno, e
-- o M11 mede que sao zero) e transferencia ja pareada. Nao exclui 9.x: pagamento
-- de fatura de cartao e saida de caixa de verdade e sumir com ele aqui
-- reproduziria o buraco que a 0079 documentou.
CREATE VIEW fin_custo_previsto_confronto_v AS
WITH prev AS (
  SELECT
    v.entity_id,
    v.competencia,
    v.category_id,
    sum(v.valor_cents) FILTER (WHERE v.entra_no_total)::bigint                AS previsto_cents,
    sum(v.valor_confirmado_cents) FILTER (WHERE v.precedencia = 'confirmado')::bigint AS confirmado_cents,
    sum(v.valor_previsto_cents)  FILTER (WHERE v.precedencia = 'confirmado')::bigint  AS confirmado_base_prevista_cents,
    count(*) FILTER (WHERE v.precedencia = 'confirmado')                      AS itens_confirmados,
    count(*) FILTER (WHERE v.entra_no_total AND v.precedencia <> 'confirmado') AS itens_a_confirmar,
    count(*) FILTER (WHERE NOT v.entra_no_total AND v.procedencia = 'item')   AS itens_fora_da_soma
  FROM fin_custo_previsto_consolidado_v v
  GROUP BY 1,2,3
),
realizado AS (
  SELECT
    t.entity_id,
    date_trunc('month', t.competence_date)::date AS competencia,
    t.category_id,
    sum(-t.amount_cents)::bigint                 AS realizado_cents,
    count(*)                                     AS lancamentos,
    max(t.posted_on)                             AS ultimo_lancamento
  FROM fin_transaction t
  LEFT JOIN fin_category c ON c.id = t.category_id
  WHERE t.amount_cents < 0
    AND t.transfer_status = 'nao'
    AND NOT t.is_split_parent
    AND COALESCE(c.kind, '') <> 'receita'
  GROUP BY 1,2,3
)
SELECT
  COALESCE(p.entity_id, r.entity_id)     AS entity_id,
  COALESCE(p.competencia, r.competencia) AS competencia,
  COALESCE(p.category_id, r.category_id) AS category_id,
  c.code                                 AS categoria_code,
  c.name                                 AS categoria,
  COALESCE(p.previsto_cents, 0)          AS previsto_cents,
  COALESCE(p.confirmado_cents, 0)        AS confirmado_cents,
  -- Quanto a confirmacao ajustou a projecao. Positivo = confirmaram MAIS do que
  -- a projecao dizia. E o unico numero desta base que mede o erro da previsao de
  -- saida item a item, e ele so existe porque previsto e confirmado moram em
  -- colunas diferentes.
  (COALESCE(p.confirmado_cents, 0) - COALESCE(p.confirmado_base_prevista_cents, 0)) AS ajuste_da_confirmacao_cents,
  COALESCE(p.itens_confirmados, 0)       AS itens_confirmados,
  COALESCE(p.itens_a_confirmar, 0)       AS itens_a_confirmar,
  COALESCE(p.itens_fora_da_soma, 0)      AS itens_fora_da_soma,
  -- NULL e nao zero quando nao houve lancamento: ausencia de dado nao e
  -- afirmacao de que nada saiu. O mes futuro inteiro cai aqui.
  r.realizado_cents,
  r.lancamentos,
  r.ultimo_lancamento,
  CASE WHEN r.realizado_cents IS NULL THEN NULL
       ELSE COALESCE(p.previsto_cents, 0) - r.realizado_cents END AS erro_cents,
  CASE
    WHEN r.realizado_cents IS NULL AND p.previsto_cents IS NOT NULL
      THEN 'previsto sem realizado: ou o mes nao chegou, ou o gasto nao saiu'
    WHEN p.previsto_cents IS NULL AND r.realizado_cents IS NOT NULL
      THEN 'realizado sem previsao nenhuma nesta categoria — e daqui que sai a lacuna de cobertura'
    ELSE NULL
  END                                    AS leitura
FROM prev p
FULL OUTER JOIN realizado r
  ON  r.entity_id   = p.entity_id
  AND r.competencia = p.competencia
  AND r.category_id IS NOT DISTINCT FROM p.category_id
LEFT JOIN fin_category c ON c.id = COALESCE(p.category_id, r.category_id);

COMMENT ON VIEW fin_custo_previsto_confronto_v IS
  'Previsto x confirmado x realizado por (competencia, categoria). Compara, nunca junta: '
  'previsto nao vira realizado aqui. realizado_cents NULL e ausencia de lancamento, nao zero.';

-- ===========================================================================
-- fin_custo_previsto_pendente_v — o que falta confirmar, do maior para o menor
-- ===========================================================================
-- Inclui de proposito o que NAO soma hoje. As 11 recorrentes de fornecedor
-- (R$ 11.593,04/mes no horizonte) sao justamente o trabalho que espera decisao:
-- filtra-las por `entra_no_total` esconderia da fila exatamente a fila. Quem
-- soma hoje e quem nao soma vem separado em `soma_hoje`, com o motivo ao lado.
--
-- Fica de fora so o que ja esta decidido: confirmado, ignorado, e a linha de
-- projecao que um item ja substituiu (essa aparece como o item).
CREATE VIEW fin_custo_previsto_pendente_v AS
SELECT
  v.entity_id,
  v.competencia,
  v.procedencia,
  v.precedencia,
  v.item_id,
  v.origem,
  v.origem_ref,
  v.origem_camada,
  v.chave_dedupe,
  v.descricao,
  v.category_id,
  v.counterparty_id,
  v.dia_esperado,
  v.dia_regra,
  v.valor_cents,
  v.entra_no_total AS soma_hoje,
  v.motivo_nao_soma,
  v.confianca,
  v.confianca_nivel,
  v.natureza,
  v.alerta_sobreposicao,
  CASE
    WHEN v.procedencia = 'item' THEN 'confirmar o item #' || v.item_id
    ELSE 'ainda nao existe item: derivar de ' || v.origem_ref || ' e confirmar'
  END AS o_que_falta
FROM fin_custo_previsto_consolidado_v v
WHERE v.precedencia NOT IN ('confirmado','ignorado')
  AND NOT v.suprimido_por_item
ORDER BY v.valor_cents DESC NULLS LAST;

COMMENT ON VIEW fin_custo_previsto_pendente_v IS
  'O custo previsto do mes que ninguem confirmou ainda, do maior para o menor. '
  'Inclui o que nao soma hoje (recorrente proposta) — e ai que mora a decisao; soma_hoje separa os dois.';

-- ===========================================================================
-- ASSERTIVAS — estruturais, nao um numero de 16/08 congelado
-- ===========================================================================
DO $$
DECLARE
  v_dup      integer;
  v_itens    integer;
  v_refs     integer;
  v_linhas   integer;
  v_total    bigint;
  v_suprim   bigint;
BEGIN
  -- 1. A tabela nasce vazia. Confirmar e decisao humana (duvida 33) e nenhuma
  --    migration a toma no lugar de ninguem.
  SELECT count(*) INTO v_itens FROM fin_custo_previsto;
  IF v_itens <> 0 THEN
    RAISE EXCEPTION '0100: fin_custo_previsto deveria nascer vazia, tem % linha(s)', v_itens;
  END IF;

  -- 2. A chave de supressao tem de ser unica na projecao. Se deixar de ser, a
  --    materializacao de um derivado passaria a calar mais de uma linha.
  SELECT count(*) INTO v_dup
    FROM fin_custo_previsto_derivado_v WHERE fontes_no_ref > 1;
  IF v_dup <> 0 THEN
    RAISE EXCEPTION
      '0100: % chave(s) (competencia, origem_ref) com mais de uma fonte — a supressao deixaria de ser 1 para 1', v_dup;
  END IF;

  SELECT count(*), count(DISTINCT (competencia, origem_ref))
    INTO v_linhas, v_refs FROM fin_custo_previsto_derivado_v;
  IF v_linhas <> v_refs THEN
    RAISE EXCEPTION '0100: derivado_v tem % linhas para % chaves', v_linhas, v_refs;
  END IF;

  -- 3. Com a tabela vazia, o consolidado tem de ser IGUAL a projecao somavel.
  --    E o ponto zero da prova de que materializar nao infla: se ja divergisse
  --    aqui, o antes/depois do teste nao mediria nada.
  SELECT COALESCE(sum(valor_cents), 0) INTO v_total
    FROM fin_custo_previsto_consolidado_v WHERE entra_no_total;
  SELECT COALESCE(sum(valor_projetado_cents), 0) INTO v_suprim
    FROM fin_custo_previsto_derivado_v WHERE entra_no_saldo;
  IF v_total <> v_suprim THEN
    RAISE EXCEPTION '0100: consolidado (%) diverge da projecao somavel (%) com a tabela vazia',
      v_total, v_suprim;
  END IF;

  -- 4. Toda linha suprimida declara por que. Silencio aqui e a forma elegante
  --    de esconder dinheiro.
  IF EXISTS (SELECT 1 FROM fin_custo_previsto_consolidado_v
              WHERE NOT entra_no_total AND motivo_nao_soma IS NULL) THEN
    RAISE EXCEPTION '0100: ha linha fora da soma sem motivo declarado';
  END IF;

  -- 4b. A promessa feita a quem consome: entre as linhas que SOMAM, a
  --     chave_dedupe e unica. Se dois registros somaveis compartilhassem a
  --     chave, agrupar por ela perderia dinheiro; se a mesma coisa tivesse
  --     duas chaves, somar por ela contaria duas vezes. As duas falhas cabem
  --     nesta unica checagem.
  IF EXISTS (
    SELECT 1 FROM fin_custo_previsto_consolidado_v
     WHERE entra_no_total GROUP BY entity_id, chave_dedupe HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0100: chave_dedupe repetida entre linhas que somam';
  END IF;

  -- 4c. Todo dia esperado tem regra escrita. A agenda diaria distribui estes
  --     itens no calendario e precisa poder responder "por que neste dia".
  IF EXISTS (SELECT 1 FROM fin_custo_previsto_consolidado_v
              WHERE dia_esperado IS NOT NULL AND dia_regra IS NULL) THEN
    RAISE EXCEPTION '0100: ha dia esperado sem regra de derivacao declarada';
  END IF;

  -- 5. Participacao por categoria fecha em 100% em cada competencia.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT competencia, sum(participacao_pct) AS s
        FROM fin_custo_previsto_categoria_v GROUP BY 1
    ) x WHERE abs(x.s - 100.0) > 0.5
  ) THEN
    RAISE EXCEPTION '0100: participacao por categoria nao fecha em 100%% em alguma competencia';
  END IF;

  RAISE NOTICE '0100: % chave(s) derivada(s), total somavel R$ %',
    v_linhas, to_char(v_total / 100.0, 'FM999G999G990D00');
END;
$$;
