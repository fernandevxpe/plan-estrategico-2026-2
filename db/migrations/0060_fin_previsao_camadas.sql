-- A previsão de recebimento, camada por camada, cada uma com sua certeza.
--
-- ---------------------------------------------------------------------------
-- POR QUE CAMADAS SEPARADAS
-- ---------------------------------------------------------------------------
-- "Vou receber R$ 466 mil" e "acho que vou receber R$ 466 mil" são frases
-- diferentes, e a previsão precisa dizer qual das duas está falando. Um boleto
-- emitido no Asaas é quase caixa; um negócio ganho no Pipedrive que ainda não
-- virou cobrança é intenção comercial. Somar os dois num número só produz uma
-- previsão que ninguém pode usar para decidir se paga uma conta na sexta.
--
-- As camadas, da mais firme para a mais frouxa:
--
--   1. COBRANÇA EMITIDA   boleto/PIX já existe no Asaas com vencimento futuro.
--                         239 cobranças, R$ 466.405,51. É o mais próximo de
--                         certeza que existe sem o dinheiro ter caído.
--
--   2. VENCIDO A RECEBER  cobrança emitida que passou do vencimento e não foi
--                         paga. 46 cobranças, R$ 60.581,70. Não é previsão de
--                         mês futuro: é dinheiro atrasado, e some da projeção se
--                         for tratado como receita normal.
--
--   3. ASSINATURA         subscription do Asaas, sem fim declarado.
--
--   4. PARCELAMENTO       installment com installmentCount: projeta até a última
--                         parcela e PARA. É o que fez a primeira versão desta
--                         previsão errar 37% para cima.
--
--   5. ATIVO DE FATO      cliente pagando há 12+ meses sem assinatura formal.
--
--   6. FECHADO SEM COBRANÇA  ganho no Pipedrive e ainda sem boleto no Asaas.
--                         É o gap entre vender e faturar — o número que mostra
--                         quanto trabalho comercial já feito ainda não virou
--                         dinheiro a caminho.
--
-- Cada linha da view carrega `camada` e `certeza`, então qualquer tela pode
-- somar só o que quiser e dizer ao usuário o que está somando.

CREATE OR REPLACE VIEW fin_previsao_recebimento_v AS
-- Camada 1 e 2: o que já virou cobrança no Asaas.
-- `fin_document` guarda as cobranças importadas; o vencimento é a data em que o
-- dinheiro deve entrar.
SELECT
  CASE WHEN d.due_date < CURRENT_DATE THEN 'vencido_a_receber'
       ELSE 'cobranca_emitida' END                          AS camada,
  CASE WHEN d.due_date < CURRENT_DATE THEN 'atrasado'
       ELSE 'firme' END                                     AS certeza,
  date_trunc('month', d.due_date)::date                     AS mes,
  d.due_date                                                AS data_prevista,
  d.amount_cents,
  d.counterparty_id,
  cp.name                                                   AS contraparte,
  d.id                                                      AS origem_id,
  'fin_document'                                            AS origem_tabela,
  d.description                                             AS descricao
  FROM fin_document d
  LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
 WHERE d.direction = 'receber'
   AND d.status NOT IN ('liquidado', 'cancelado')
   AND d.due_date IS NOT NULL

UNION ALL

-- Camadas 3, 4 e 5: o que se repete, cada uma sabendo se acaba.
-- A série de meses é gerada até o fim declarado (parcelamento) ou até o
-- horizonte de 12 meses (assinatura e ativo de fato, que não têm fim).
SELECT
  CASE r.source
    WHEN 'contrato' THEN CASE WHEN r.end_month IS NULL THEN 'assinatura' ELSE 'parcelamento' END
    ELSE 'ativo_de_fato' END                                AS camada,
  r.confidence                                              AS certeza,
  m.mes::date                                               AS mes,
  (m.mes + (LEAST(r.day_of_month, 28) - 1) * INTERVAL '1 day')::date AS data_prevista,
  r.amount_cents,
  r.counterparty_id,
  cp.name                                                   AS contraparte,
  r.id                                                      AS origem_id,
  'fin_recurring'                                           AS origem_tabela,
  r.label                                                   AS descricao
  FROM fin_recurring r
  LEFT JOIN fin_counterparty cp ON cp.id = r.counterparty_id
  CROSS JOIN LATERAL generate_series(
        greatest(date_trunc('month', CURRENT_DATE), r.start_month),
        COALESCE(r.end_month, date_trunc('month', CURRENT_DATE) + INTERVAL '12 months'),
        INTERVAL '1 month') AS m(mes)
 WHERE r.status = 'ativo'
   AND r.direction = 'receber';

COMMENT ON VIEW fin_previsao_recebimento_v IS
  'Previsão de recebimento por camada e certeza. cobranca_emitida = boleto já existe no Asaas. '
  'vencido_a_receber = emitido e atrasado (não é receita de mês futuro). assinatura = sem fim. '
  'parcelamento = para na última parcela. ativo_de_fato = 12+ meses sem assinatura formal. '
  'Camadas NÃO devem ser somadas cegamente: cobrança emitida de um parcelamento já está na '
  'camada 1, e somar a projeção do mesmo contrato conta duas vezes.';

-- ---------------------------------------------------------------------------
-- O GAP COMERCIAL: fechado e ainda não faturado
-- ---------------------------------------------------------------------------
-- Ganho no Pipedrive é compromisso do cliente; cobrança no Asaas é compromisso
-- com data. Entre um e outro há trabalho administrativo, e o tamanho dessa fila
-- é um número de gestão: quanto já foi vendido e ainda não está a caminho.
--
-- O casamento é por organização do Pipedrive → documento → contraparte. Onde não
-- houver documento (CNPJ) na organização, o negócio aparece com
-- counterparty_id nulo e fica visível como indeterminado, em vez de sumir.
CREATE TABLE IF NOT EXISTS fin_pipeline_ganho (
  id                bigserial PRIMARY KEY,
  entity_id         bigint NOT NULL REFERENCES fin_entity(id),
  pipedrive_deal_id bigint NOT NULL,
  titulo            text   NOT NULL,
  valor_cents       bigint NOT NULL CHECK (valor_cents > 0),
  ganho_em          date   NOT NULL,
  org_nome          text,
  org_document      text,
  counterparty_id   bigint REFERENCES fin_counterparty(id),
  -- Quanto deste negócio já virou cobrança no Asaas. Preenchido pelo sync, não
  -- inferido aqui: a conciliação exige comparar valor e período, e a view não é
  -- lugar de decidir isso.
  faturado_cents    bigint NOT NULL DEFAULT 0 CHECK (faturado_cents >= 0),
  conciliacao       text   NOT NULL DEFAULT 'pendente'
                       CHECK (conciliacao IN ('pendente','parcial','completa','sem_correspondencia','ignorado')),
  motivo            text,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, pipedrive_deal_id)
);

COMMENT ON TABLE fin_pipeline_ganho IS
  'Negócios ganhos no Pipedrive, com quanto de cada um já virou cobrança no Asaas. A diferença '
  'entre valor_cents e faturado_cents é o gap comercial: vendido e ainda não faturado. Não é '
  'previsão de caixa firme — é intenção com compromisso do cliente, e a tela deve dizer isso.';

CREATE INDEX IF NOT EXISTS fin_pipeline_ganho_mes_idx ON fin_pipeline_ganho (entity_id, ganho_em);
CREATE INDEX IF NOT EXISTS fin_pipeline_ganho_conc_idx ON fin_pipeline_ganho (conciliacao);

CREATE OR REPLACE VIEW fin_fechado_nao_faturado_v AS
SELECT g.ganho_em, date_trunc('month', g.ganho_em)::date AS mes,
       g.titulo, g.org_nome, g.counterparty_id, cp.name AS contraparte,
       g.valor_cents, g.faturado_cents,
       (g.valor_cents - g.faturado_cents) AS a_faturar_cents,
       g.conciliacao, g.motivo, g.pipedrive_deal_id
  FROM fin_pipeline_ganho g
  LEFT JOIN fin_counterparty cp ON cp.id = g.counterparty_id
 WHERE g.conciliacao <> 'ignorado'
   AND g.valor_cents > g.faturado_cents;

COMMENT ON VIEW fin_fechado_nao_faturado_v IS
  'O gap entre vender e faturar: negócio ganho no Pipedrive cujo valor ainda não virou cobrança '
  'no Asaas. Alto e crescente significa trabalho comercial parado antes de virar dinheiro.';
