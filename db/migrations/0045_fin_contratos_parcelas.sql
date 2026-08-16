-- Contratos e parcelas do erp-obras. Espelho, não ledger.
--
-- Fecha a cadeia da receita: contrato → parcela → cobrança → nota fiscal →
-- recebimento → conta. Depois desta migration, "a receber atrasado", "receita
-- por cliente" e "ticket por tipo de serviço" são consulta.
--
-- ===========================================================================
-- A REGRA QUE VALE MAIS QUE TODAS AS OUTRAS AQUI: QUATRO CAMADAS, UMA POR VEZ
-- ===========================================================================
-- O mesmo dinheiro aparece em quatro lugares deste banco, e cada um responde
-- uma pergunta diferente. Somar dois deles não dá "mais receita" — dá receita
-- errada.
--
--   1. PREVISÃO CONTRATUAL .. erp_contrato_parcela (esta migration)
--      471 parcelas, R$ 1.409.159,57. O que foi COMBINADO com o cliente.
--      Existe antes de qualquer cobrança. Pode nunca virar nada.
--
--   2. COBRANÇA (competência) fin_document / fin_revenue_accrual_v
--      3.406 documentos. O que foi FATURADO. É o accrual do ledger.
--
--   3. FATO FISCAL ......... fin_fiscal_document
--      3.521 notas, R$ 3.476.244,11 em 2.826 AUTHORIZED. O que foi DECLARADO
--      ao fisco. A nota é emitida sobre a cobrança, não ao lado dela — e por
--      isso mora em tabela separada desde o import do Asaas, cujo comentário
--      já avisava: "se entrassem em fin_document ao lado das cobranças, a
--      receita contaria quase o dobro".
--
--   4. CAIXA ............... fin_transaction / fin_revenue_cash_v
--      O que ENTROU na conta. É a validação máxima. Extrato batendo.
--
-- Uma parcela paga existe nas quatro. Somar as quatro quadruplica a receita.
-- Somar previsão com cobrança — o erro mais fácil de cometer aqui, porque as
-- duas se chamam "a receber" — dobra R$ 798.912,14: os 233 pares parcela ↔
-- cobrança que esta migration liga de forma exata.
--
-- Por isso toda view abaixo carrega uma coluna `camada` e nenhuma soma duas.
-- `fin_receber_aberto_v` é a única que mistura camadas, e mistura por exclusão
-- mútua: a parcela só entra quando NÃO tem cobrança emitida.
--
-- ===========================================================================
-- POR QUE ESPELHO E NÃO IMPORTAÇÃO DIRETA NO LEDGER
-- ===========================================================================
-- Mesmo motivo de 0038, e um a mais.
--
-- O de 0038: promover é irreversível na prática. Primeiro ver, depois confiar,
-- só então promover.
--
-- O a mais, específico daqui: 233 das 471 parcelas JÁ EXISTEM neste banco como
-- fin_document, vindas do Asaas com o mesmo dinheiro. Importar parcela como
-- documento a receber criaria 233 recebíveis fantasmas em cima de recebíveis
-- reais — e a soma pareceria plausível, que é o pior tipo de erro.
--
-- A parcela entra como PREVISÃO, com a cobrança correspondente resolvida e
-- gravada ao lado (`fin_document_id`). Quem quiser "a receber" pergunta à view,
-- que já sabe qual das duas contar.
--
-- ===========================================================================
-- fin_contract: O QUE COUBE, O QUE NÃO COUBE
-- ===========================================================================
-- Medido, não suposto. `fin_contract` tem 30 linhas, todas assinatura ou
-- comissionamento do Asaas, e ZERO delas colide com os 148 contratos do ERP:
-- nenhuma das 233 cobranças ligadas a parcela pertence a uma assinatura do
-- Asaas (medido em asaas-payments.json, campo `subscription`: 0 de 233).
--
--   Contrato (ERP)          fin_contract (aqui)        observação
--   ----------------------  -------------------------  -----------------------
--   id                      source_id (+ source)       'erp_obras', como 0040
--   titulo                  name                       direto
--   codigo                  —                          NÃO CABE (fica no espelho)
--   clienteId               counterparty_id            via documento, ver abaixo
--   valorContratado         amount_cents               ×100
--   dataInicio              start_date                 direto
--   dataFimPrevista         end_date                   direto
--   dataAssinatura          —                          NÃO CABE
--   status                  status                     mapeamento lossy, abaixo
--   eixo                    kind + nucleo              OBRAS→'obra'/obras
--                                                      CONSULTORIA→'projeto'/consultoria
--                                                      AMBOS→INDETERMINADO (3 contratos)
--   —                       direction = 'receber'      fixo
--   —                       recurrence = 'unico'       ver "a trava", abaixo
--   —                       confidence                 'contratado' se ATIVO
--   vendedor                —                          NÃO CABE
--   formaPagamento          —                          NÃO CABE ("1+3x", "40%+4x")
--   prazoDias               —                          NÃO CABE
--   propostaId              —                          NÃO CABE
--   clickupTaskId           —                          NÃO CABE
--   escopoServicoTexto      notes                      concatenado, se promovido
--   entregaveisTexto        notes                      concatenado, se promovido
--
-- Sete campos não cabem. NENHUM deles é dinheiro nem data de dinheiro — são
-- comercial (vendedor, proposta), operacional (clickup) e texto de contrato.
-- Por isso a decisão é guardá-los no espelho e NÃO alterar fin_contract: um
-- ALTER TABLE por campo de outro sistema transforma a tabela de contrato do
-- ledger em cópia do CRM alheio. `erp_contrato` responde por eles, com a chave
-- para voltar à origem.
--
-- A TRAVA QUE TORNA A PROMOÇÃO SEGURA: recurrence = 'unico'.
-- As cinco consultas que hoje leem fin_contract — forecast.ts:216,
-- painel.ts:469, queries.ts:254, indicadores.ts:208 e o próprio import do
-- ClickUp — filtram TODAS por `recurrence = 'mensal'`. Verificado uma a uma.
-- Contrato de obra não é recorrência: é valor fechado com cronograma explícito
-- de parcelas irregulares. 'unico' é ao mesmo tempo o valor semanticamente
-- correto e o que garante que promover 148 contratos não move um centavo do
-- MRR nem inventa uma linha na previsão de caixa.
--
-- status: RASCUNHO e CANCELADO não têm equivalente em fin_contract
-- (ativo/suspenso/encerrado). O espelho guarda o status do ERP cru em
-- `status_erp` e a tradução em `status_ledger`, NULL para os dois casos sem
-- destino — indeterminado declarado, não escolhido no chute. Hoje não há
-- nenhum contrato nesses dois estados (medido: 145 ATIVO, 1 ENCERRADO,
-- 2 INATIVO); a coluna existe para o dia em que houver.
--
-- ===========================================================================
-- fin_installment_plan NÃO SERVE PARA PARCELA DE CONTRATO
-- ===========================================================================
-- Foi verificado antes de criar tabela nova, e reprova em três pontos:
--
--   1. `kind` é CHECK ('reembolso','compra_ativo','financiamento') — é plano de
--      PAGAMENTO nosso, não de recebimento do cliente.
--   2. Modela plano REGULAR: installments_total + monthly_amount_cents +
--      first_due_date. As parcelas daqui têm valor e vencimento próprios por
--      linha ("40%+4x", "1+3x") — 471 parcelas, 462 com vencimento distinto.
--   3. Não tem linha por parcela. Nenhuma. O plano é o cabeçalho e as parcelas
--      viram documentos; é justamente o que não se pode fazer aqui, sob pena
--      de duplicar os 233 documentos que já existem.
--
-- ===========================================================================
-- IDENTIDADE DO CLIENTE: DOCUMENTO, NUNCA NOME
-- ===========================================================================
-- Medido em 15/08/2026, 117 clientes do ERP contra 492 contrapartes daqui:
--
--   casam por CNPJ/CPF normalizado ............  97  (82,9% do total)
--   dos que têm documento de tamanho válido ...  97 de 100  (97,0%)
--   parcelas cobertas ......................... 442 de 471  (93,8%)
--   valor coberto ............................. R$ 1.358.659,57 de
--                                               R$ 1.409.159,57  (96,4%)
--
-- Os 20 que não casam, e por quê:
--   · 17 estão SEM CNPJ no ERP. Para 16 deles existe aqui uma contraparte de
--     nome quase idêntico E COM CNPJ — "Condomínio do Edifício Del Mar" daqui
--     tem 40817439000126, o do ERP tem nada. Ligar por nome resolveria os 16 e
--     seria exatamente o erro que a A6 do backlog está lá para desfazer: dois
--     pareamentos falsos por coincidência, escondendo R$ 3.000 de cada lado.
--     Ficam indeterminados, com o candidato registrado para confirmação humana.
--   · 1 tem o CNPJ DA CASA (34776108000192, cliente 57 "CONDOMÍNIO DO EDIFÍCIO
--     ADERBAL JUREMA"). Contraparte com o CNPJ da XPE é transferência entre
--     contas próprias, jamais receita. É erro de cadastro no ERP e o espelho
--     RECUSA o casamento explicitamente, mesmo que um dia exista contraparte
--     com esse documento.
--   · 1 tem CNPJ de placeholder (00000000000191, "XPE Lab").
--   · 1 é CPF (18982689400) sem contraparte correspondente aqui.
--
-- O casamento por `asaasCustomerId` foi medido como alternativa e NÃO acrescenta
-- nada: resolve 96, todos já resolvidos pelo documento, com zero conflito entre
-- os dois critérios. Fica como verificação cruzada no script, não como fonte.
--
-- Um único caso onde documento e nome discordam de verdade: cliente 97
-- "Edf. Morada Rosarinho", CNPJ 11419309000137, casa com a contraparte 163
-- "CONDOMÍNIO DO EDIFÍCIO JOÃO HERACLIO". O documento manda — mas fica marcado
-- em `counterparty_nome_diverge` para alguém olhar, porque um dos dois cadastros
-- está errado.
--
-- ===========================================================================
-- PARCELA → NOTA FISCAL: O QUE LIGA E O QUE FOI RECUSADO
-- ===========================================================================
-- LIGA, e é exato: ParcelaContrato.asaasPaymentId → fin_document.source_id.
-- Os dois lados têm índice UNIQUE sobre esse id, então a relação é 1:1 por
-- construção, sem heurística. Medido: 233 de 233 acharam documento (100,0%),
-- 49,5% de todas as parcelas. Um único desencontro de valor, de R$ 0,02
-- (parcela 344: R$ 2.086,68 contra R$ 2.086,66) — arredondamento, não erro.
--
-- Daí a nota sai de graça, pela cadeia documento → fin_fiscal_document.
-- Medido HOJE: 73 parcelas chegam à nota (31,3% das 233 ligadas).
-- Medido no ASAAS: 200 das 233 têm nota emitida (85,8%), 151 AUTHORIZED.
-- A diferença não é dado que falta — é ligação perdida DENTRO deste banco:
-- apenas 306 das 3.521 notas têm `document_id`, contra 3.084 que o arquivo
-- bruto do Asaas consegue ligar. Causa e correção estão no relato da frente.
--
-- RECUSADO: casar por valor + cliente + competência. Foi medido antes de ser
-- descartado, sobre as 238 parcelas sem asaasPaymentId, com janela de ±45 dias:
--
--   parcelas com algum candidato ....... 113
--   com candidato ÚNICO ................  38   (33,6%)
--   AMBÍGUAS ...........................  75   (66,4%)
--   notas disputadas por 2+ parcelas ...  78
--
-- Dois terços ambíguos. Um contrato "1+3x" gera três parcelas de valor idêntico
-- para o mesmo cliente em meses vizinhos: valor e cliente não distinguem nada.
-- Aplicar isso seria fabricar 75 ligações erradas para ganhar 38 certas. As 38
-- ficam disponíveis como SUGESTÃO em `erp_parcela_nota_sugestao_v`, para
-- confirmação humana — nunca aplicadas pelo script.
--
-- ===========================================================================
-- A ARMADILHA DO source: 'erp' E 'erp_obras' CONVIVEM E NÃO SÃO A MESMA COISA
-- ===========================================================================
-- Herdada, e é o mesmo tipo de coisa que o mapa de slug de conta em
-- sync-erp-obras.mjs existe para evitar:
--
--   fin_cost_center.source .. CHECK ('manual','clickup','erp')  → é 'erp'
--   fin_transaction.source .. CHECK (..., 'erp_obras')  (0040)  → é 'erp_obras'
--   fin_contract.source ..... sem CHECK, texto livre            → usar 'erp_obras'
--
-- Procurar centro de custo com source='erp_obras' devolve ZERO linhas sem
-- errar. Os 20 centros de custo kind='projeto' estão gravados com source='erp'
-- e source_id = id do Projeto. O espelho e o script usam 'erp' para centro de
-- custo e 'erp_obras' para contrato, de propósito, e este comentário é o motivo.

-- ---------------------------------------------------------------------------
-- 1. Contratos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_contrato (
  id                      bigserial PRIMARY KEY,

  -- Chave de idempotência: o id do Contrato no erp-obras. É PK lá, é UNIQUE
  -- aqui, e é o que faz a segunda sincronização atualizar em vez de duplicar.
  erp_id                  integer NOT NULL UNIQUE,

  codigo                  text,
  titulo                  text NOT NULL,

  -- ── cliente ──────────────────────────────────────────────────────────────
  cliente_erp_id          integer NOT NULL,
  cliente_razao_social    text NOT NULL,
  -- Só dígitos, como fin_counterparty.document_number. NULL quando o ERP não
  -- tem documento ou quando o que tem não é documento (placeholder, CNPJ da
  -- casa) — a normalização acontece na entrada para que nenhuma consulta tenha
  -- de lembrar de fazê-la.
  cliente_documento       text,
  counterparty_id         bigint REFERENCES fin_counterparty(id),
  counterparty_match      text NOT NULL DEFAULT 'indeterminado'
    CHECK (counterparty_match IN (
      'documento',            -- casou por CNPJ/CPF normalizado. Único critério aceito.
      'sem_documento',        -- ERP não tem documento do cliente
      'documento_sem_par',    -- tem documento válido, nenhuma contraparte aqui
      'documento_invalido',   -- placeholder / tamanho fora de 11 e 14
      'cnpj_da_casa',         -- é o CNPJ da XPE: casamento RECUSADO por regra
      'indeterminado'         -- linha ainda não resolvida pelo sync. É o DEFAULT,
                              -- e precisa estar nesta lista: o Postgres não valida
                              -- DEFAULT contra CHECK na criação da tabela, então a
                              -- incoerência só apareceria no primeiro INSERT que
                              -- omitisse a coluna — em produção, meses depois.
    )),
  -- Verdadeiro quando o documento casou mas os nomes não se parecem. Não muda
  -- o casamento — documento manda — mas marca o cadastro a conferir.
  counterparty_nome_diverge boolean NOT NULL DEFAULT false,

  -- ── dimensão ─────────────────────────────────────────────────────────────
  eixo                    text NOT NULL CHECK (eixo IN ('OBRAS', 'CONSULTORIA', 'AMBOS')),
  -- NULL quando eixo = 'AMBOS'. Indeterminado declarado: 3 contratos, e não há
  -- dado no ERP que diga como repartir.
  nucleo                  text REFERENCES fin_nucleo(slug),
  kind_ledger             text CHECK (kind_ledger IN ('obra', 'projeto')),

  -- ── dinheiro ─────────────────────────────────────────────────────────────
  valor_contratado_cents  bigint NOT NULL,
  -- Soma das parcelas, materializada pelo script. Existe para tornar a
  -- divergência visível sem join: hoje 119 contratos batem ao centavo e
  -- nenhum diverge; 29 não têm parcela nenhuma (R$ 403.880,00 contratados sem
  -- cronograma). Zero aqui com valor_contratado_cents > 0 é "sem cronograma",
  -- não "sem valor".
  valor_parcelas_cents    bigint NOT NULL DEFAULT 0,

  -- ── datas e comercial (o que não cabe em fin_contract) ────────────────────
  data_assinatura         date,
  data_inicio             date,
  data_fim_prevista       date,
  vendedor                text,
  forma_pagamento         text,
  prazo_dias              integer,
  proposta_erp_id         integer,
  clickup_task_id         text,
  observacoes             text,
  escopo_servico_texto    text,
  entregaveis_texto       text,

  -- ── status ───────────────────────────────────────────────────────────────
  status_erp              text NOT NULL
    CHECK (status_erp IN ('RASCUNHO', 'ATIVO', 'ENCERRADO', 'CANCELADO', 'INATIVO')),
  -- NULL para RASCUNHO e CANCELADO: fin_contract não tem esses estados e
  -- inventar um seria decidir sem evidência.
  status_ledger           text CHECK (status_ledger IN ('ativo', 'suspenso', 'encerrado')),

  -- ── promoção ─────────────────────────────────────────────────────────────
  -- Preenchido SÓ quando o contrato for promovido para fin_contract, o que é
  -- decisão separada e explícita (sync-erp-contratos.mjs --promover-contratos).
  -- Enquanto for NULL, este contrato não existe para nenhuma tela do ledger.
  fin_contract_id         bigint REFERENCES fin_contract(id),

  created_at_erp          timestamptz,
  updated_at_erp          timestamptz,
  synced_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_contrato IS
  'Espelho somente-leitura dos contratos do erp-obras. NÃO É LEDGER: nenhuma tela de '
  'receita, MRR ou DRE pode somar esta tabela. O ledger de contrato é fin_contract, e a '
  'ponte é a coluna fin_contract_id, preenchida apenas na promoção explícita.';

COMMENT ON COLUMN erp_contrato.counterparty_match IS
  'Como o cliente do ERP virou contraparte daqui. ''documento'' é o ÚNICO critério que '
  'produz ligação — nome nunca, nem por similaridade alta. Os demais valores são motivos '
  'declarados de não-casamento, para que o vazio seja explicável e não silencioso.';

COMMENT ON COLUMN erp_contrato.kind_ledger IS
  'eixo OBRAS→''obra'', CONSULTORIA→''projeto''. AMBOS fica NULL: fin_contract.kind é um '
  'valor só, e não há dado no ERP que reparta o contrato entre os dois eixos.';

-- ---------------------------------------------------------------------------
-- 2. Parcelas — a camada de PREVISÃO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_contrato_parcela (
  id                bigserial PRIMARY KEY,

  erp_id            integer NOT NULL UNIQUE,
  erp_contrato_id   integer NOT NULL REFERENCES erp_contrato(erp_id) ON DELETE CASCADE,
  numero            integer NOT NULL,
  descricao         text,

  valor_cents       bigint NOT NULL,
  -- 9 das 471 parcelas não têm vencimento. Sem data não há vencido, e elas
  -- ficam fora do aging por construção, contadas à parte.
  data_vencimento   date,

  -- Status do ERP, cru. NÃO é fonte de verdade sobre recebimento: 470 das 471
  -- estão 'PREVISTA' e apenas 1 'PAGA', enquanto o ledger mostra 186 cobranças
  -- correspondentes já liquidadas. Quem responde "recebeu?" é a camada de
  -- caixa, nunca esta coluna.
  status_erp        text NOT NULL CHECK (status_erp IN ('PREVISTA', 'PAGA', 'CANCELADA')),

  -- ── a ponte exata para a cobrança ────────────────────────────────────────
  asaas_payment_id  text,
  fin_document_id   bigint REFERENCES fin_document(id),
  documento_match   text NOT NULL DEFAULT 'sem_cobranca'
    CHECK (documento_match IN (
      'asaas_payment_id',  -- exato, 1:1, sem heurística
      'sem_cobranca',      -- parcela ainda não virou cobrança no Asaas
      'payment_id_orfao'   -- ERP tem o id, este banco não tem o documento
    )),

  synced_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (erp_contrato_id, numero)
);

COMMENT ON TABLE erp_contrato_parcela IS
  'PREVISÃO de recebimento, camada 1 de 4. Não é cobrança (fin_document), não é nota '
  '(fin_fiscal_document) e não é caixa (fin_transaction). Somar esta tabela com qualquer '
  'uma das outras conta o mesmo dinheiro duas vezes — 233 destas 471 linhas já existem '
  'como fin_document, valendo R$ 798.912,14.';

COMMENT ON COLUMN erp_contrato_parcela.fin_document_id IS
  'A cobrança do Asaas correspondente, resolvida por asaasPaymentId → fin_document.source_id. '
  'UNIQUE dos dois lados, portanto 1:1 por construção. Quando preenchido, a previsão desta '
  'parcela JÁ VIROU cobrança e não deve ser somada ao "a receber" ao lado dela.';

CREATE INDEX IF NOT EXISTS erp_contrato_parcela_venc_idx
  ON erp_contrato_parcela (data_vencimento) WHERE data_vencimento IS NOT NULL;
CREATE INDEX IF NOT EXISTS erp_contrato_parcela_doc_idx
  ON erp_contrato_parcela (fin_document_id) WHERE fin_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS erp_contrato_parcela_payment_idx
  ON erp_contrato_parcela (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Alocação da parcela por projeto — a dimensão de centro de custo
-- ---------------------------------------------------------------------------
-- 593 linhas para 469 parcelas: a mesma parcela pode ser repartida entre
-- projetos. A soma da alocação bate com o valor da parcela em 462 casos,
-- diverge em 7 e não existe em 2 — os 7 ficam marcados pela view de cobertura.
CREATE TABLE IF NOT EXISTS erp_contrato_parcela_alocacao (
  id               bigserial PRIMARY KEY,
  erp_id           integer NOT NULL UNIQUE,
  erp_parcela_id   integer NOT NULL REFERENCES erp_contrato_parcela(erp_id) ON DELETE CASCADE,

  projeto_erp_id   integer NOT NULL,
  projeto_nome     text,
  projeto_segmento text CHECK (projeto_segmento IS NULL
                               OR projeto_segmento IN ('OBRAS', 'CONSULTORIA')),
  valor_cents      bigint NOT NULL,

  -- Resolvido por fin_cost_center WHERE source='erp' AND source_id=projeto_erp_id.
  -- ATENÇÃO ao 'erp' — não 'erp_obras'. Ver a seção da armadilha no cabeçalho.
  -- Hoje só 18 dos 142 projetos alocados têm centro de custo (12,7%), todos do
  -- núcleo obras: os 109 projetos de consultoria ainda não foram criados como
  -- centro de custo. É a frente B1. Quando ela rodar, esta coluna se completa
  -- sozinha na próxima sincronização, sem mudar nada aqui.
  cost_center_id   bigint REFERENCES fin_cost_center(id),

  synced_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (erp_parcela_id, projeto_erp_id)
);

COMMENT ON COLUMN erp_contrato_parcela_alocacao.cost_center_id IS
  'fin_cost_center do projeto, buscado com source=''erp'' (NÃO ''erp_obras'' — os dois '
  'vocabulários convivem neste banco). NULL enquanto a frente B1 não criar o centro de '
  'custo do projeto; 124 dos 142 projetos alocados estão nesse estado hoje.';

-- ---------------------------------------------------------------------------
-- 4. Serviços do contrato — a dimensão de ticket
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_contrato_servico (
  id                     bigserial PRIMARY KEY,
  erp_id                 integer NOT NULL UNIQUE,
  erp_contrato_id        integer NOT NULL REFERENCES erp_contrato(erp_id) ON DELETE CASCADE,

  codigo                 text NOT NULL,
  tipo_servico_erp_id    integer,
  tipo_servico_codigo    text,
  tipo_servico_nome      text,
  tipo_servico_segmento  text CHECK (tipo_servico_segmento IS NULL
                                     OR tipo_servico_segmento IN ('OBRAS', 'CONSULTORIA', 'AMBOS')),
  tipo_servico_familia   text,
  ordem                  integer NOT NULL DEFAULT 0,
  synced_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (erp_contrato_id, codigo)
);

COMMENT ON TABLE erp_contrato_servico IS
  'Serviços contratados, 191 linhas em 119 contratos. 52 contratos têm 2 ou mais serviços '
  'e o ERP não guarda quanto vale cada um — por isso o ticket por tipo de serviço só é '
  'exato para contrato de serviço único. Ver erp_ticket_tipo_servico_v.';

-- ===========================================================================
-- VIEWS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5.1 Saúde do espelho — a pergunta "posso confiar nisto?"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW erp_contrato_cobertura_v AS
SELECT
  (SELECT count(*) FROM erp_contrato)                                            AS contratos,
  (SELECT count(*) FROM erp_contrato WHERE counterparty_id IS NOT NULL)          AS contratos_com_contraparte,
  (SELECT count(*) FROM erp_contrato WHERE counterparty_match = 'cnpj_da_casa')  AS contratos_cnpj_da_casa,
  (SELECT count(*) FROM erp_contrato WHERE nucleo IS NULL)                       AS contratos_sem_nucleo,
  (SELECT count(*) FROM erp_contrato
    WHERE valor_parcelas_cents <> 0
      AND valor_parcelas_cents <> valor_contratado_cents)                        AS contratos_parcelas_nao_batem,
  (SELECT count(*) FROM erp_contrato WHERE valor_parcelas_cents = 0)             AS contratos_sem_cronograma,

  (SELECT count(*) FROM erp_contrato_parcela)                                    AS parcelas,
  (SELECT count(*) FROM erp_contrato_parcela WHERE data_vencimento IS NULL)      AS parcelas_sem_vencimento,
  (SELECT count(*) FROM erp_contrato_parcela WHERE fin_document_id IS NOT NULL)  AS parcelas_com_cobranca,
  (SELECT count(*) FROM erp_contrato_parcela WHERE documento_match = 'payment_id_orfao')
                                                                                 AS parcelas_payment_orfao,
  (SELECT count(DISTINCT p.id)
     FROM erp_contrato_parcela p
     JOIN fin_fiscal_document nf ON nf.document_id = p.fin_document_id)          AS parcelas_com_nota,

  (SELECT count(*) FROM erp_contrato_parcela_alocacao)                           AS alocacoes,
  (SELECT count(*) FROM erp_contrato_parcela_alocacao WHERE cost_center_id IS NOT NULL)
                                                                                 AS alocacoes_com_centro_custo,
  (SELECT count(*) FROM erp_contrato_parcela p
    WHERE EXISTS (SELECT 1 FROM erp_contrato_parcela_alocacao a WHERE a.erp_parcela_id = p.erp_id)
      AND p.valor_cents <> (SELECT sum(a.valor_cents) FROM erp_contrato_parcela_alocacao a
                             WHERE a.erp_parcela_id = p.erp_id))                 AS parcelas_alocacao_nao_bate;

COMMENT ON VIEW erp_contrato_cobertura_v IS
  'Uma linha com a saúde do espelho. É o critério de aceite da sincronização: '
  'parcelas_payment_orfao > 0 significa que o ERP conhece uma cobrança que este banco não '
  'tem, e a importação do Asaas está atrasada.';

-- ---------------------------------------------------------------------------
-- 5.2 A RECEBER EM ABERTO — a view que mistura camadas por exclusão mútua
-- ---------------------------------------------------------------------------
-- Esta é a única view do arquivo que junta previsão com cobrança, e a regra que
-- impede a dupla contagem é uma só, aplicada em dois lugares:
--
--   · a cobrança entra sempre que estiver em aberto;
--   · a parcela entra SOMENTE quando não tem cobrança (fin_document_id IS NULL).
--
-- A coluna `camada` diz de onde cada linha veio, para que quem quiser só o
-- ledger filtre camada='cobranca' e continue com o número de hoje, intocado.
CREATE OR REPLACE VIEW fin_receber_aberto_v AS
-- Camada 2: COBRANÇA. O que foi faturado e ainda não entrou.
SELECT
  'cobranca'::text                          AS camada,
  d.entity_id,
  d.id                                      AS document_id,
  NULL::integer                             AS parcela_erp_id,
  NULL::integer                             AS contrato_erp_id,
  d.counterparty_id,
  cp.name                                   AS cliente,
  cp.document_number                        AS cliente_documento,
  d.nucleo,
  d.cost_center_id,
  d.due_date                                AS vencimento,
  (d.amount_cents - d.settled_cents)        AS aberto_cents,
  d.status                                  AS status,
  -- Confiança de que este valor vira caixa. A cobrança emitida no Asaas é fato;
  -- a previsão contratual é intenção.
  'faturado'::text                          AS confianca
FROM fin_document d
LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
WHERE d.direction = 'receber'
  AND d.status IN ('emitido', 'parcial', 'confirmado')
  AND (d.amount_cents - d.settled_cents) > 0

UNION ALL

-- Camada 1: PREVISÃO. O que foi combinado e ainda não virou cobrança.
SELECT
  'previsao_contrato'::text,
  (SELECT e.id FROM fin_entity e WHERE e.slug = 'xpe')  AS entity_id,
  NULL::bigint                              AS document_id,
  p.erp_id                                  AS parcela_erp_id,
  k.erp_id                                  AS contrato_erp_id,
  k.counterparty_id,
  COALESCE(cp.name, k.cliente_razao_social)  AS cliente,
  k.cliente_documento,
  k.nucleo,
  -- Centro de custo só quando a parcela é alocada a um único projeto E esse
  -- projeto já tem centro de custo. Rateio de parcela entre projetos não cabe
  -- em uma linha; quem precisar do rateio lê erp_contrato_parcela_alocacao.
  -- HAVING count(*) = 1 sem GROUP BY: a subconsulta devolve UMA linha quando a
  -- parcela tem exatamente uma alocação, e NENHUMA (portanto NULL) quando tem
  -- várias. Rateio silencioso é pior que centro de custo vazio.
  (SELECT min(a.cost_center_id) FROM erp_contrato_parcela_alocacao a
    WHERE a.erp_parcela_id = p.erp_id
   HAVING count(*) = 1)                     AS cost_center_id,
  p.data_vencimento                         AS vencimento,
  p.valor_cents                             AS aberto_cents,
  'previsto'::text                          AS status,
  'contratado'::text                        AS confianca
FROM erp_contrato_parcela p
JOIN erp_contrato k ON k.erp_id = p.erp_contrato_id
LEFT JOIN fin_counterparty cp ON cp.id = k.counterparty_id
WHERE p.fin_document_id IS NULL          -- ← a trava da dupla contagem
  AND p.status_erp <> 'CANCELADA'
  AND COALESCE(k.status_ledger, 'ativo') <> 'encerrado'
  AND k.status_erp NOT IN ('CANCELADO', 'RASCUNHO');

COMMENT ON VIEW fin_receber_aberto_v IS
  'A receber em aberto, sem dupla contagem: toda cobrança aberta MAIS as parcelas de '
  'contrato que ainda não viraram cobrança. A coluna camada separa fato (cobranca) de '
  'intenção (previsao_contrato) — filtre camada=''cobranca'' para o número do ledger puro. '
  'Nunca some esta view com fin_revenue_accrual_v: a segunda já contém a primeira.';

-- ---------------------------------------------------------------------------
-- 5.3 ATRASADO COM AGING
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_receber_aging_v AS
SELECT
  r.*,
  (current_date - r.vencimento)             AS dias_atraso,
  CASE
    WHEN r.vencimento IS NULL          THEN 'sem_vencimento'
    WHEN r.vencimento >= current_date  THEN 'a_vencer'
    WHEN current_date - r.vencimento <=  30 THEN '01_30'
    WHEN current_date - r.vencimento <=  60 THEN '31_60'
    WHEN current_date - r.vencimento <=  90 THEN '61_90'
    WHEN current_date - r.vencimento <= 180 THEN '91_180'
    ELSE '180_mais'
  END                                       AS faixa
FROM fin_receber_aberto_v r;

COMMENT ON VIEW fin_receber_aging_v IS
  'fin_receber_aberto_v com faixa de atraso. Faixas em dias corridos sobre a data de '
  'vencimento. ''sem_vencimento'' não é zero dias de atraso: é ausência de data, e some '
  'do aging se for tratado como a_vencer.';

-- ---------------------------------------------------------------------------
-- 5.4 RECEITA POR CLIENTE — as quatro camadas lado a lado, jamais somadas
-- ---------------------------------------------------------------------------
-- Uma linha por cliente e por mês, com quatro colunas de dinheiro que NUNCA
-- devem ser somadas entre si. Existem lado a lado justamente para que a
-- diferença entre elas seja visível: previsto que não virou cobrança, cobrado
-- que não virou nota, nota que não virou caixa.
CREATE OR REPLACE VIEW fin_receita_camadas_v AS
WITH previsao AS (
  SELECT k.counterparty_id,
         date_trunc('month', p.data_vencimento)::date AS mes,
         sum(p.valor_cents) AS cents
    FROM erp_contrato_parcela p
    JOIN erp_contrato k ON k.erp_id = p.erp_contrato_id
   WHERE p.data_vencimento IS NOT NULL AND p.status_erp <> 'CANCELADA'
   GROUP BY 1, 2
),
cobranca AS (
  SELECT counterparty_id, date_trunc('month', competence_date)::date AS mes,
         sum(amount_cents) AS cents
    FROM fin_revenue_accrual_v
   GROUP BY 1, 2
),
fiscal AS (
  SELECT counterparty_id, date_trunc('month', competence_date)::date AS mes,
         sum(service_amount_cents) AS cents
    FROM fin_fiscal_document
   WHERE status = 'AUTHORIZED' AND competence_date IS NOT NULL
   GROUP BY 1, 2
),
caixa AS (
  SELECT counterparty_id, month AS mes, sum(amount_cents) AS cents
    FROM fin_revenue_cash_v
   GROUP BY 1, 2
),
chaves AS (
  SELECT counterparty_id, mes FROM previsao
  UNION SELECT counterparty_id, mes FROM cobranca
  UNION SELECT counterparty_id, mes FROM fiscal
  UNION SELECT counterparty_id, mes FROM caixa
)
SELECT c.counterparty_id,
       cp.name             AS cliente,
       cp.document_number  AS cliente_documento,
       c.mes,
       COALESCE(pv.cents, 0) AS previsao_contrato_cents,
       COALESCE(cb.cents, 0) AS cobranca_cents,
       COALESCE(fs.cents, 0) AS nota_fiscal_cents,
       COALESCE(cx.cents, 0) AS caixa_cents
  FROM chaves c
  LEFT JOIN fin_counterparty cp ON cp.id = c.counterparty_id
  LEFT JOIN previsao pv ON pv.counterparty_id IS NOT DISTINCT FROM c.counterparty_id AND pv.mes = c.mes
  LEFT JOIN cobranca cb ON cb.counterparty_id IS NOT DISTINCT FROM c.counterparty_id AND cb.mes = c.mes
  LEFT JOIN fiscal   fs ON fs.counterparty_id IS NOT DISTINCT FROM c.counterparty_id AND fs.mes = c.mes
  LEFT JOIN caixa    cx ON cx.counterparty_id IS NOT DISTINCT FROM c.counterparty_id AND cx.mes = c.mes;

COMMENT ON VIEW fin_receita_camadas_v IS
  'Receita por cliente e mês nas QUATRO camadas: previsão contratual, cobrança, nota fiscal '
  'e caixa. As quatro colunas descrevem o MESMO dinheiro em estágios diferentes — somá-las '
  'multiplica a receita por até quatro. Escolha uma coluna por pergunta: caixa para '
  'tesouraria, cobranca para DRE por competência, nota_fiscal para obrigação fiscal, '
  'previsao_contrato para funil de receita.';

-- ---------------------------------------------------------------------------
-- 5.5 TICKET POR TIPO DE SERVIÇO
-- ---------------------------------------------------------------------------
-- O ERP guarda quais serviços um contrato tem, mas não quanto vale cada um.
-- 67 contratos têm serviço único e para eles o ticket é exato. Nos 52 com dois
-- ou mais, atribuir o valor cheio a cada serviço somaria mais que o contratado.
-- A view devolve as duas leituras separadas e NÃO escolhe por ninguém:
--   · exato ....... contratos de serviço único
--   · rateado ..... valor dividido igualmente entre os serviços do contrato
-- Rateio igual é uma suposição declarada, não um dado. Se o Fernando disser
-- como reparte de verdade, a regra entra aqui e a coluna some.
CREATE OR REPLACE VIEW erp_ticket_tipo_servico_v AS
WITH servicos_por_contrato AS (
  SELECT erp_contrato_id, count(*) AS n FROM erp_contrato_servico GROUP BY 1
)
SELECT
  COALESCE(s.tipo_servico_codigo, '(sem tipo)')  AS tipo_codigo,
  COALESCE(s.tipo_servico_nome, '(sem tipo)')    AS tipo_nome,
  s.tipo_servico_segmento                        AS segmento_tipo,
  k.eixo,
  count(*)                                       AS contratos,
  count(*) FILTER (WHERE spc.n = 1)              AS contratos_servico_unico,

  -- Leitura EXATA: só contratos de serviço único.
  sum(k.valor_contratado_cents) FILTER (WHERE spc.n = 1)                       AS valor_exato_cents,
  round(avg(k.valor_contratado_cents) FILTER (WHERE spc.n = 1))::bigint        AS ticket_exato_cents,

  -- Leitura RATEADA: divide igualmente. Suposição, não medida.
  -- ::numeric antes da divisão de propósito: bigint/bigint trunca, e truncar
  -- 191 vezes some com dinheiro de verdade.
  round(sum(k.valor_contratado_cents::numeric / spc.n))::bigint                AS valor_rateado_cents,
  round(avg(k.valor_contratado_cents::numeric / spc.n))::bigint                AS ticket_rateado_cents
FROM erp_contrato_servico s
JOIN erp_contrato k              ON k.erp_id = s.erp_contrato_id
JOIN servicos_por_contrato spc   ON spc.erp_contrato_id = s.erp_contrato_id
WHERE k.status_erp NOT IN ('CANCELADO', 'RASCUNHO')
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW erp_ticket_tipo_servico_v IS
  'Ticket por tipo de serviço em duas leituras que não se somam. ticket_exato_cents usa só '
  'contratos de serviço único e é fato. ticket_rateado_cents divide o contrato igualmente '
  'entre seus serviços e é SUPOSIÇÃO — o erp-obras não guarda o valor por serviço. '
  'Compare as duas antes de citar qualquer uma.';

-- ---------------------------------------------------------------------------
-- 5.6 TICKET MÉDIO POR SEGMENTO (obras × consultoria)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW erp_ticket_segmento_v AS
SELECT
  k.eixo,
  k.nucleo,
  count(*)                                             AS contratos,
  sum(k.valor_contratado_cents)                        AS contratado_cents,
  round(avg(k.valor_contratado_cents))::bigint         AS ticket_medio_cents,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY k.valor_contratado_cents)::bigint
                                                       AS ticket_mediano_cents,
  min(k.valor_contratado_cents)                        AS menor_cents,
  max(k.valor_contratado_cents)                        AS maior_cents,
  sum(k.valor_parcelas_cents)                          AS cronograma_cents,
  count(*) FILTER (WHERE k.valor_parcelas_cents = 0)   AS sem_cronograma
FROM erp_contrato k
WHERE k.status_erp NOT IN ('CANCELADO', 'RASCUNHO')
GROUP BY 1, 2;

COMMENT ON VIEW erp_ticket_segmento_v IS
  'Ticket médio e mediano por eixo. Média e mediana juntas de propósito: em obras a média '
  'é puxada por poucos contratos grandes e sozinha mente sobre o contrato típico.';

-- ---------------------------------------------------------------------------
-- 5.7 SUGESTÃO parcela → nota, para confirmação humana. NUNCA aplicada.
-- ---------------------------------------------------------------------------
-- Só as parcelas SEM asaasPaymentId, com candidato ÚNICO por valor + cliente +
-- competência ±45 dias. Medido: 38 únicas contra 75 ambíguas. As ambíguas não
-- aparecem aqui — aparecer já seria meio caminho para serem aplicadas.
CREATE OR REPLACE VIEW erp_parcela_nota_sugestao_v AS
WITH cand AS (
  SELECT p.erp_id AS parcela_erp_id, nf.id AS nota_id,
         p.valor_cents, p.data_vencimento, nf.competence_date, nf.number AS nota_numero,
         abs(nf.competence_date - p.data_vencimento) AS dias,
         count(*) OVER (PARTITION BY p.erp_id) AS candidatos_da_parcela,
         count(*) OVER (PARTITION BY nf.id)    AS parcelas_da_nota
    FROM erp_contrato_parcela p
    JOIN erp_contrato k          ON k.erp_id = p.erp_contrato_id
    JOIN fin_fiscal_document nf  ON nf.entity_id = (SELECT e.id FROM fin_entity e WHERE e.slug = 'xpe')
                                AND nf.counterparty_id = k.counterparty_id
                                AND nf.service_amount_cents = p.valor_cents
                                AND nf.status <> 'CANCELED'
                                AND nf.competence_date BETWEEN p.data_vencimento - 45
                                                           AND p.data_vencimento + 45
   WHERE p.fin_document_id IS NULL
     AND p.data_vencimento IS NOT NULL
     AND k.counterparty_id IS NOT NULL
)
SELECT parcela_erp_id, nota_id, nota_numero, valor_cents, data_vencimento,
       competence_date, dias
  FROM cand
 WHERE candidatos_da_parcela = 1 AND parcelas_da_nota = 1;

COMMENT ON VIEW erp_parcela_nota_sugestao_v IS
  'SUGESTÕES de ligação parcela → nota por valor+cliente+competência, apenas quando o par é '
  'único dos dois lados. NÃO é ligação: o critério é ambíguo em 66% dos casos e aplicar '
  'automaticamente repetiria o erro dos pareamentos falsos da frente A6. Confirmação humana '
  'obrigatória.';

-- ===========================================================================
-- 6. O QUE FICOU INDETERMINADO
-- ===========================================================================
-- Uma view e não prosa em comentário, porque a lista muda: cada CNPJ corrigido
-- no ERP tira uma linha daqui sozinho, e prosa não encolhe. Enquanto voltar
-- linha, há decisão do Fernando pendente — e o motivo vem junto, para que
-- ninguém precise reconstruir o raciocínio para perguntar de novo.
CREATE OR REPLACE VIEW erp_contrato_indeterminado_v AS
SELECT 'contraparte'::text AS assunto, k.erp_id AS contrato_erp_id,
       k.titulo            AS referencia,
       k.counterparty_match AS motivo,
       k.valor_contratado_cents AS valor_cents,
       CASE k.counterparty_match
         WHEN 'sem_documento'      THEN 'ERP não tem CNPJ do cliente. Existe contraparte de nome próximo aqui? Confirmar uma a uma; ligar por nome é proibido.'
         WHEN 'documento_sem_par'  THEN 'CNPJ/CPF válido no ERP, nenhuma contraparte com ele aqui. Cadastrar contraparte ou confirmar que nunca houve movimento.'
         WHEN 'documento_invalido' THEN 'O que está no campo CNPJ não é CNPJ (placeholder ou tamanho errado). Erro de cadastro no ERP.'
         WHEN 'cnpj_da_casa'       THEN 'Cliente cadastrado com o CNPJ da XPE. Casamento RECUSADO: seria transferência entre contas próprias, nunca receita. Corrigir no ERP.'
         WHEN 'indeterminado'      THEN 'Linha gravada sem passar pela resolução de contraparte. Rodar node scripts/sync-erp-contratos.mjs.'
       END AS pergunta
  FROM erp_contrato k
 WHERE k.counterparty_id IS NULL

UNION ALL

SELECT 'eixo_ambos', k.erp_id, k.titulo, 'eixo=AMBOS', k.valor_contratado_cents,
       'fin_contract.kind aceita um valor só e não há dado que reparta o contrato entre obras e consultoria. Definir (a) projeto, (b) obra, ou (c) manter indeterminado.'
  FROM erp_contrato k WHERE k.eixo = 'AMBOS'

UNION ALL

SELECT 'ticket_multisservico', k.erp_id, k.titulo,
       'contrato com ' || s.n || ' serviços', k.valor_contratado_cents,
       'O erp-obras não guarda o valor por serviço. Definir a regra de repartição, ou aceitar que o ticket por tipo só é exato em contrato de serviço único.'
  FROM erp_contrato k
  JOIN (SELECT erp_contrato_id, count(*) AS n FROM erp_contrato_servico GROUP BY 1) s
    ON s.erp_contrato_id = k.erp_id AND s.n > 1

UNION ALL

SELECT 'nome_diverge_do_documento', k.erp_id, k.titulo,
       'documento casou, nomes discordam', k.valor_contratado_cents,
       'Cliente do ERP e contraparte daqui têm o mesmo CNPJ e nomes diferentes. O documento manda e a ligação está feita — mas um dos dois cadastros está errado.'
  FROM erp_contrato k WHERE k.counterparty_nome_diverge;

COMMENT ON VIEW erp_contrato_indeterminado_v IS
  'O que o espelho NÃO conseguiu determinar, linha a linha, com o motivo e as opções. '
  'Vazia significa cadeia da receita completamente resolvida. Não vazia é fila de decisão '
  'humana — nunca insumo para escolher sozinho.';
