-- O inventário do indeterminado, num lugar só — com o caminho de cada caso.
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE
--
-- "O que ainda não tem identificação?" tinha, até aqui, nove respostas parciais
-- espalhadas por nove vocabulários: `fin_indeterminado_v` fala em tags,
-- `fin_card_a_classificar_v` fala em MCC, `fin_transfer_gap_v` fala em pernas,
-- `erp_contrato_indeterminado_v` fala em assunto, `fin_rule_health_v` fala em
-- health_state, e contraparte, pessoa e conta não falam em lugar nenhum. Cada
-- uma está certa no seu domínio. Nenhuma responde "o que falta identificar, e
-- por onde eu começo".
--
-- E o pior: parte do acervo não aparece em régua nenhuma. Medido em 16/08/2026:
--
--     contraparte identificada, escopo 2026 ......  95,9%   (3.362 de 3.506)
--     contraparte identificada, base inteira .....  38,6%   (5.215 de 13.505)
--
-- Os dois números estão certos. O primeiro é o que o painel mostra, porque o
-- escopo declarado é 2026. O segundo é o tamanho real do acervo sem identidade.
-- A diferença — 8.290 lançamentos — é invisível a todo indicador desta base,
-- pelo mesmo motivo que os 795 itens de cartão eram invisíveis (§8 de
-- CONTINUACAO.md): mora do lado de fora da régua que a frente vizinha estava
-- otimizando.
--
-- O QUE A VARREDURA ACHOU, E QUE NÃO ESTAVA ESCRITO EM DOC NENHUM
--
-- 1. AS 7.245 TAXAS DO ASAAS ANTERIORES A 2026 JÁ TÊM A DECISÃO TOMADA.
--    A dúvida 13 ("a contraparte da taxa do Asaas: o cliente ou o Asaas?") foi
--    respondida e aplicada: opção (a), Asaas IP S.A. O corte é exato e não
--    admite outra leitura:
--
--        2026 ..... 1.565 taxas · 1.565 COM contraparte · 0 sem
--        pré-2026 . 7.245 taxas ·     0 com contraparte · 7.245 SEM
--
--    Mesma fonte, mesmos cinco `source_kind`, mesma categoria 4.05 nas 8.810.
--    O que separou as duas populações não foi evidência — foi o escopo de
--    trabalho declarado. R$ 9.213,75, 7.245 itens, UMA decisão, que já existe.
--    Isto não é classificação nova: é a decisão de estender o alcance dela.
--    Registrado como dúvida 57, porque escopo é do Fernando.
--
-- 2. OS 619 PAYMENT_RECEIVED SEM CONTRAPARTE TÊM CAMINHO EXATO DA FONTE.
--    R$ 386.859,89, todos anteriores a 2026, e **619 de 619 têm linha em
--    `fin_settlement`** apontando para o documento que liquidaram. 595 chegam a
--    uma contraparte cadastrada por esse caminho (63 contrapartes distintas);
--    24 param num documento que também não tem contraparte. Isso é vínculo da
--    fonte, não semelhança de nome — a diferença que a A6 existiu para marcar.
--
-- 3. OS 500 ITENS DE CARTÃO SÃO 105 ESTABELECIMENTOS, NÃO 500 DECISÕES.
--    Medido, não estimado: 105 `merchant` distintos e 25 planos de parcelamento.
--    A separação entre tamanho do problema e tamanho do trabalho é o que
--    `fin_pendencia_identificacao_grupo_v` publica.
--
-- 4. OS 162 LANÇAMENTOS COM O CNPJ DA CASA NÃO SÃO PENDÊNCIA — SÃO ARMADILHA.
--    R$ 1.435.837,84 carregam `counterparty_document = 34776108000192`, que é o
--    CNPJ da própria XPE, e estão corretamente SEM contraparte. Quem varrer
--    "sem contraparte" por valor vai encontrá-los no topo e cadastrar a
--    contraparte "XPE TECNOLOGIA" — que é literalmente o erro de R$ 151.977,33
--    que os invariantes A1 e A2 existem para impedir. Eles ficam FORA do
--    inventário, e `fin_pendencia_identificacao_excluido_v` diz por quê, para
--    que a ausência seja declarada em vez de silenciosa.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- Não classifica, não cadastra, não vincula e não resolve nada. Ela cria o
-- catálogo, as views de leitura e a tabela onde uma resolução PEDIDA PELA
-- PESSOA fica registrada com motivo. Nenhum UPDATE em fin_transaction,
-- fin_document, fin_card_transaction, fin_counterparty ou fin_person. A soma
-- por conta não é tocada porque nenhuma linha de dinheiro é tocada.
--
-- Onde não há evidência, o caso fica indeterminado COM MOTIVO. Nenhum caso é
-- preenchido por semelhança de nome: os 13 pares de contraparte parecida entram
-- como `decisao_humana`, com os dois lados à vista, nunca casados.

-- ---------------------------------------------------------------------------
-- 1. O VOCABULÁRIO CONTROLADO
--
-- Catálogo, não enum solto. Cada tipo de pendência declara, de uma vez e num
-- lugar só: o que exatamente falta, por onde se corrige, se é alcançável agora
-- ou está bloqueado por dado que não existe, e qual dúvida o destrava.
--
-- `caminho_de_correcao` é a coluna que roteia trabalho, e por isso é a que tem
-- CHECK. `sem_fonte` é resposta legítima e final: significa que a base já sabe
-- que não há de onde tirar o dado, e o caso não deve voltar a ser perguntado.
--
-- `alcancavel_agora` é separado de `bloqueado_por` de propósito. Um caso pode
-- ter dúvida registrada e ainda ser alcançável (a dúvida 57 é de escopo: a
-- decisão técnica já existe). E um caso pode não ter dúvida nenhuma e ser
-- inalcançável (o dado simplesmente não está em fonte nenhuma). Ordenar por
-- valor sem essa coluna põe R$ 2,4 milhões de perna sem extrato no topo da fila
-- e faz a pessoa perder a manhã.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_pendencia_tipo (
  tipo                text PRIMARY KEY,
  universo            text    NOT NULL,
  caminho_de_correcao text    NOT NULL,
  o_que_falta         text    NOT NULL,
  evidencia_padrao    text    NOT NULL,
  bloqueado_por       integer,
  alcancavel_agora    boolean NOT NULL,
  causa_comum         text    NOT NULL,
  ordem               integer NOT NULL,
  CONSTRAINT fin_pendencia_tipo_caminho_vocab CHECK (caminho_de_correcao IN (
    'cadastrar_contraparte',
    'classificar',
    'vincular_pessoa',
    'pedir_extrato',
    'decisao_humana',
    'sem_fonte'
  )),
  CONSTRAINT fin_pendencia_tipo_universo_vocab CHECK (universo IN (
    'fin_transaction',
    'fin_document',
    'fin_card_transaction',
    'fin_counterparty',
    'fin_person',
    'fin_contract',
    'erp_contrato',
    'transferencia',
    'fin_account',
    'fin_rule'
  )),
  -- O vocabulário do tipo, enumerado. Acrescentar um tipo exige migration, que
  -- é exatamente o custo certo: tipo novo muda o que a plataforma afirma sobre
  -- o próprio buraco, e isso não deve caber num INSERT de script.
  CONSTRAINT fin_pendencia_tipo_vocab CHECK (tipo IN (
    'tx_contraparte_ausente_taxa_asaas',
    'tx_contraparte_ausente_com_liquidacao',
    'tx_contraparte_ausente_sem_evidencia',
    'tx_documento_da_fonte_sem_cadastro',
    'tx_sem_categoria',
    'tx_categoria_declara_ignorancia',
    'tx_indeterminado_declarado',
    'tx_sem_nucleo',
    'tx_sem_centro_de_custo',
    'doc_sem_categoria',
    'doc_sem_contraparte',
    'doc_receber_vencido_sem_liquidacao',
    'card_sem_categoria',
    'card_sem_titular',
    'card_sem_centro_de_custo',
    'contraparte_sem_documento',
    'contraparte_possivel_duplicata',
    'pessoa_vinculo_indefinido',
    'pessoa_sem_documento',
    'pessoa_status_contradiz_pagamento',
    'contrato_sem_contraparte',
    'erp_contrato_contraparte_nao_casada',
    'erp_contrato_multisservico',
    'erp_contrato_eixo_ambos',
    'cobranca_sem_tipo_de_servico',
    'transferencia_perna_sem_extrato',
    'conta_sem_cobertura_extrato',
    'conta_fora_do_ledger',
    'regra_aguardando_fonte',
    'regra_em_sombra'
  )),
  -- Bloqueado por dúvida que não existe é pior que não ter dúvida: manda a
  -- pessoa procurar uma pergunta que não está escrita. As lacunas do cartão já
  -- cometeram esse erro (apontam para 20 e 21, que são outra coisa — §5 do
  -- MAPA_CONCLUSAO.md). O intervalo cobre docs/DUVIDAS_FINANCEIRO.md, 0 a 57.
  CONSTRAINT fin_pendencia_tipo_duvida_existe CHECK (
    bloqueado_por IS NULL OR (bloqueado_por BETWEEN 0 AND 57)
  )
);

COMMENT ON TABLE fin_pendencia_tipo IS
  'Vocabulário controlado do inventário de identificação. Uma linha por tipo de '
  'pendência, com o caminho de correção, se é alcançável agora e qual dúvida a '
  'destrava. É o catálogo que fin_pendencia_identificacao_v resolve.';
COMMENT ON COLUMN fin_pendencia_tipo.alcancavel_agora IS
  'true = as fontes existentes bastam para resolver, mesmo que exija decisão '
  'humana. false = falta dado que não está em fonte nenhuma desta base. Separado '
  'de bloqueado_por porque as duas coisas não coincidem: a dúvida 57 é de '
  'escopo e o caso é alcançável; centro de custo não tem dúvida técnica e é '
  'inalcançável até o ERP carimbar.';
COMMENT ON COLUMN fin_pendencia_tipo.causa_comum IS
  'Como agrupar os casos deste tipo para contar DECISÕES em vez de ITENS. '
  '500 itens de cartão são 105 estabelecimentos; 7.245 taxas são 1 decisão.';

DELETE FROM fin_pendencia_tipo;
INSERT INTO fin_pendencia_tipo
  (tipo, universo, caminho_de_correcao, o_que_falta, evidencia_padrao,
   bloqueado_por, alcancavel_agora, causa_comum, ordem) VALUES

  ('tx_contraparte_ausente_taxa_asaas', 'fin_transaction', 'cadastrar_contraparte',
   'A contraparte da taxa. Todas as 1.565 taxas gêmeas de 2026 já apontam para Asaas IP S.A. (contraparte 991); estas, anteriores a 2026, ficaram de fora porque o escopo de trabalho declarado era 2026.',
   'A decisão da dúvida 13 (opção a) aplicada às gêmeas de 2026: mesma fonte, mesmo source_kind, mesma categoria 4.05.',
   57, true, 'decisao-13-estender-a-pre-2026', 10),

  ('tx_contraparte_ausente_com_liquidacao', 'fin_transaction', 'cadastrar_contraparte',
   'A contraparte do recebimento. O lançamento liquida um documento conhecido e a contraparte está NELE — falta propagar, não descobrir.',
   'Linha em fin_settlement ligando o lançamento ao documento. Vínculo da fonte, não semelhança de nome.',
   57, true, 'contraparte-alcancada-por-liquidacao', 20),

  ('tx_contraparte_ausente_sem_evidencia', 'fin_transaction', 'decisao_humana',
   'Quem está do outro lado. O extrato não trouxe documento nem nome da contraparte, e não há liquidação que alcance um documento.',
   'Só a descrição livre do extrato e o valor. Nenhum identificador da fonte.',
   NULL, false, 'sem-identificador-na-fonte', 30),

  ('tx_documento_da_fonte_sem_cadastro', 'fin_transaction', 'cadastrar_contraparte',
   'O cadastro da contraparte cujo CPF/CNPJ o extrato já trouxe. O documento existe no lançamento e não existe em fin_counterparty.',
   'CPF/CNPJ entregue pela própria fonte, com dígito verificador conferível.',
   18, true, 'documento-distinto-da-fonte', 40),

  ('tx_sem_categoria', 'fin_transaction', 'classificar',
   'A linha do plano de contas.',
   'Precedente da contraparte, texto do extrato e regras ativas.',
   NULL, true, 'lancamento-a-classificar', 50),

  ('tx_categoria_declara_ignorancia', 'fin_transaction', 'classificar',
   'A categoria de verdade. 3.99 e 5.99 não são linha de plano de contas, são marcador de indecisão — a linha tem category_id preenchido e mesmo assim não diz o que é.',
   'O motivo gravado em classified_reason e o histórico da contraparte.',
   40, true, 'rotulo-que-declara-indecisao', 60),

  ('tx_indeterminado_declarado', 'fin_transaction', 'decisao_humana',
   'A decisão que a base já sabe que não pode tomar sozinha. O motivo está escrito na tag do lançamento.',
   'A tag indeterminado:* nomeia exatamente qual evidência falta.',
   NULL, true, 'motivo-de-indeterminacao', 70),

  ('tx_sem_nucleo', 'fin_transaction', 'classificar',
   'O núcleo (a que frente do negócio o dinheiro pertence).',
   'Núcleo padrão da contraparte e da categoria, quando existirem.',
   NULL, true, 'nucleo-a-definir', 80),

  ('tx_sem_centro_de_custo', 'fin_transaction', 'sem_fonte',
   'O centro de custo. Não há segundo caminho neste ledger: quem carimba projeto é o erp-obras, e ele carimbou 112 linhas.',
   'Nenhuma. O teto é de fonte, não de trabalho — por isso o indicador está em 1,1% e não sobe classificando.',
   19, false, 'teto-de-fonte-erp-obras', 90),

  ('doc_sem_categoria', 'fin_document', 'classificar',
   'A linha do plano de contas da cobrança.',
   'Descrição da cobrança, contrato de origem e histórico da contraparte.',
   NULL, true, 'documento-a-classificar', 100),

  ('doc_sem_contraparte', 'fin_document', 'cadastrar_contraparte',
   'De quem é a cobrança.',
   'Fonte e source_id do documento no Asaas.',
   NULL, true, 'documento-sem-contraparte', 110),

  ('doc_receber_vencido_sem_liquidacao', 'fin_document', 'decisao_humana',
   'Se a cobrança vencida foi recebida por fora, está atrasada, ou o contrato não andou. O status não arbitra sozinho.',
   'Vencimento, valor e a ausência de liquidação no ledger.',
   10, false, 'vencido-sem-liquidacao', 120),

  ('card_sem_categoria', 'fin_card_transaction', 'classificar',
   'A linha do plano de contas do item de cartão. O motivo de cada um já está escrito em fin_card_a_classificar_v.',
   'MCC, nome do estabelecimento e plano de parcelamento — e o motivo diz o que cada um NÃO prova.',
   NULL, true, 'estabelecimento-ou-plano', 130),

  ('card_sem_titular', 'fin_card_transaction', 'vincular_pessoa',
   'Quem é o portador do cartão. Sem isso não há custo por pessoa nem rateio de núcleo por cartão.',
   'Final do cartão, nome do portador na fonte quando houver, e a janela em que o cartão apareceu.',
   NULL, true, 'cartao-sem-portador', 140),

  ('card_sem_centro_de_custo', 'fin_card_transaction', 'sem_fonte',
   'O centro de custo do item de cartão. Mesmo teto de fonte do ledger.',
   'Nenhuma.',
   19, false, 'teto-de-fonte-erp-obras', 150),

  ('contraparte_sem_documento', 'fin_counterparty', 'cadastrar_contraparte',
   'O CPF/CNPJ da contraparte já cadastrada. Sem documento ela não pode ser conferida contra o extrato nem contra o ERP.',
   'O nome cadastrado e, em alguns casos, um documento embutido no próprio nome pela fonte.',
   NULL, true, 'contraparte-sem-documento', 160),

  ('contraparte_possivel_duplicata', 'fin_counterparty', 'decisao_humana',
   'Se duas contrapartes são a mesma entidade. NUNCA casar por nome: foi assim que esta base ganhou contraparte duplicada. Só entram pares em que o documento não pode arbitrar — se os dois lados têm documento e eles diferem, são entidades distintas e não há pendência.',
   'Similaridade de nome (trigrama) e o documento do lado que o tem. Sugestão, nunca carimbo.',
   NULL, true, 'par-de-contrapartes-parecidas', 170),

  ('pessoa_vinculo_indefinido', 'fin_person', 'decisao_humana',
   'O vínculo da pessoa: MEI, sócio, estágio ou avulso. Enquanto for indefinido, a previsão de folha a projeta pela mediana sem saber se continua no mês que vem.',
   'Regularidade mensal do pagamento observado no ledger.',
   23, false, 'vinculo-nao-declarado', 180),

  ('pessoa_sem_documento', 'fin_person', 'vincular_pessoa',
   'CPF e/ou CNPJ da pessoa. Sem documento não há como casar a pessoa com a contraparte que recebe.',
   'Nome cadastrado e a contraparte já ligada, quando houver documento nela.',
   23, false, 'pessoa-sem-documento', 190),

  ('pessoa_status_contradiz_pagamento', 'fin_person', 'decisao_humana',
   'Se o status está errado ou o pagamento é verba rescisória. A pessoa consta inativa e recebeu na data do desligamento ou depois.',
   'Data de desligamento declarada contra a data do último pagamento no ledger.',
   24, true, 'status-x-pagamento', 200),

  ('contrato_sem_contraparte', 'fin_contract', 'cadastrar_contraparte',
   'A contraparte do contrato. Há pessoa vinculada, mas nenhuma contraparte — então o contrato não encontra o pagamento no extrato.',
   'A pessoa ligada ao contrato e a contraparte que ela já usa no ledger.',
   NULL, true, 'contrato-sem-contraparte', 210),

  ('erp_contrato_contraparte_nao_casada', 'erp_contrato', 'cadastrar_contraparte',
   'O casamento entre o cliente do ERP e a contraparte daqui. O motivo por contrato diz qual dos quatro casos é.',
   'O que o ERP tem no campo de documento — que pode ser ausente, inválido, sem par aqui, ou o CNPJ da própria casa.',
   7, false, 'cliente-erp-sem-par', 220),

  ('erp_contrato_multisservico', 'erp_contrato', 'decisao_humana',
   'Quanto do contrato vale cada serviço. O erp-obras guarda QUAIS serviços, nunca QUANTO cada um vale.',
   'A lista de serviços do contrato e o valor total. Repartir exige regra que ninguém declarou.',
   8, false, 'valor-por-servico', 230),

  ('erp_contrato_eixo_ambos', 'erp_contrato', 'decisao_humana',
   'Se o contrato é obra, consultoria, ou fica indeterminado. fin_contract.kind aceita um valor só.',
   'O eixo AMBOS declarado no ERP, que é a própria indeterminação.',
   9, false, 'eixo-ambos', 240),

  ('cobranca_sem_tipo_de_servico', 'fin_transaction', 'decisao_humana',
   'Qual serviço a cobrança remunera. Medido em 16/08: só 3 dos 63 têm contraparte com um serviço só no ERP; os outros 60 exigem rateio que ninguém declarou.',
   'Os contratos da contraparte no ERP, quando existirem — 50 dos 63 não têm contrato nenhum lá.',
   8, false, 'valor-por-servico', 250),

  ('transferencia_perna_sem_extrato', 'transferencia', 'pedir_extrato',
   'O extrato ou a conta do outro lado da transferência. A perna existe, o par não pode existir.',
   'O motivo já está gravado em transfer_unresolved_reason e nomeia qual extrato falta.',
   4, false, 'extrato-do-outro-lado', 260),

  ('conta_sem_cobertura_extrato', 'fin_account', 'pedir_extrato',
   'A cobertura de extrato da conta ativa. Ela entra no consolidado como R$ 0,00 sem que ninguém tenha afirmado que o saldo é zero.',
   'Nenhuma no ledger: a conta não tem lançamento nem janela declarada.',
   5, false, 'extrato-que-nao-existe', 270),

  ('conta_fora_do_ledger', 'fin_account', 'pedir_extrato',
   'A 7ª conta. Cinco lançamentos apontam para ela e ela não é fin_account, então M15 nunca poderá acusar divergência nela — o "6/6 fecham" é 6 de 7.',
   'Os 5 lançamentos que a nomeiam e o número da conta declarado na matriz de cobertura.',
   5, false, 'extrato-que-nao-existe', 280),

  ('regra_aguardando_fonte', 'fin_rule', 'sem_fonte',
   'A fonte que a regra espera para poder ter hit. Não é regra morta: é regra sem substrato.',
   'O reason_code da própria regra nomeia a fonte ausente.',
   NULL, false, 'fonte-externa-ausente', 290),

  ('regra_em_sombra', 'fin_rule', 'decisao_humana',
   'A confirmação de que a sombra é esperada. As duas têm validade de 90 dias: se ninguém confirmar, expiram e M14 volta a acusar.',
   'A asserção registrada com a justificativa e a data de validade.',
   55, true, 'sombra-a-confirmar', 300);

-- ---------------------------------------------------------------------------
-- 2. ONDE A RESOLUÇÃO PEDIDA PELA PESSOA FICA REGISTRADA
--
-- Um caso sai do inventário de três formas: o dado que faltava chega (e ele
-- some sozinho, porque as views são derivadas), ou alguém declara que não há
-- fonte, ou alguém declara que não se aplica. As duas últimas são decisões, e
-- decisão sem motivo escrito vira folclore em duas semanas.
--
-- `motivo` é NOT NULL e tem tamanho mínimo de propósito. "ok" não é motivo.
--
-- NÃO existe, e não deve passar a existir, um caminho que resolva em lote sem
-- motivo por caso. Se aparecer um, ele quebra a promessa desta tabela.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_pendencia_resolucao (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id   bigint      NOT NULL REFERENCES fin_entity(id),
  universo    text        NOT NULL,
  alvo_id     bigint      NOT NULL,
  tipo        text        NOT NULL REFERENCES fin_pendencia_tipo(tipo),
  decisao     text        NOT NULL,
  motivo      text        NOT NULL,
  ator        text        NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz,
  CONSTRAINT fin_pendencia_resolucao_decisao_vocab CHECK (decisao IN (
    'sem_fonte',       -- não há de onde tirar o dado; resposta legítima e final
    'nao_se_aplica',   -- o caso não é pendência: a base entendeu errado
    'resolvido'        -- o dado foi cadastrado/vinculado/classificado
  )),
  CONSTRAINT fin_pendencia_resolucao_motivo_declarado CHECK (length(btrim(motivo)) >= 12),
  CONSTRAINT fin_pendencia_resolucao_ator_declarado CHECK (length(btrim(ator)) >= 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS fin_pendencia_resolucao_caso_vivo
  ON fin_pendencia_resolucao (universo, alvo_id, tipo)
  WHERE desfeito_em IS NULL;

COMMENT ON TABLE fin_pendencia_resolucao IS
  'Resolução declarada por uma pessoa, com motivo. "sem_fonte" é resposta '
  'legítima: significa que a base parou de perguntar porque não há onde buscar. '
  'Nunca preenchida por script em lote.';

-- ---------------------------------------------------------------------------
-- 3. O INVENTÁRIO
--
-- Uma linha por caso. A chave é (universo, id, tipo_de_pendencia): o mesmo
-- lançamento pode faltar categoria E núcleo, e são dois trabalhos diferentes.
--
-- Somar `valor_cents` da view inteira é ERRADO e a coluna existe para ordenar,
-- não para totalizar — o mesmo lançamento aparece em até três tipos, e mistura
-- estoque (perna sem extrato) com fluxo. É a mesma ressalva da §5 do
-- MAPA_CONCLUSAO.md, e vale aqui pelo mesmo motivo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_pendencia_identificacao_v AS
WITH casa AS (
  SELECT id AS entity_id, regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g') AS cnpj
    FROM fin_entity WHERE slug = 'xpe'
),
taxa_asaas AS (
  SELECT t.id, t.posted_on, t.amount_cents, t.description_raw
    FROM fin_transaction t
   WHERE t.counterparty_id IS NULL
     AND t.source = 'asaas'
     AND t.source_kind IN ('PAYMENT_FEE', 'INVOICE_FEE',
                           'PAYMENT_MESSAGING_NOTIFICATION_FEE',
                           'INSTANT_TEXT_MESSAGE_FEE', 'TRANSFER_FEE')
),
liquida AS (
  SELECT t.id, t.posted_on, t.amount_cents, t.description_raw,
         s.document_id, d.counterparty_id AS cp_do_documento,
         cp.name AS nome_do_documento
    FROM fin_transaction t
    JOIN fin_settlement s ON s.transaction_id = t.id
    JOIN fin_document d ON d.id = s.document_id
    LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
   WHERE t.counterparty_id IS NULL
),
-- Pares de contraparte parecida SOMENTE onde o documento não pode arbitrar.
-- Se os dois lados têm documento e eles diferem, são entidades distintas —
-- Tallanny (57538443000158) e Tawanny (63384563000140) provam que nomes quase
-- iguais podem ser dois CNPJs reais, e casá-los seria inventar uma fusão.
duplicata AS (
  SELECT a.id AS id_sem_documento,
         a.name AS nome_sem_documento,
         count(*) AS candidatos,
         string_agg(b.name || ' [' || coalesce(b.document_number, 'sem documento') || ']',
                    ' · ' ORDER BY similarity(a.normalized_name, b.normalized_name) DESC) AS candidatos_texto,
         max(similarity(a.normalized_name, b.normalized_name)) AS melhor_sim
    FROM fin_counterparty a
    JOIN fin_counterparty b
      ON b.id <> a.id
     AND similarity(a.normalized_name, b.normalized_name) >= 0.55
   WHERE coalesce(btrim(a.document_number), '') = ''
   GROUP BY a.id, a.name
),
bruto AS (

  -- ---- fin_transaction: contraparte ---------------------------------------
  SELECT 'fin_transaction'::text AS universo, x.id, 'tx_contraparte_ausente_taxa_asaas'::text AS tipo,
         left(x.description_raw, 120) AS descricao, abs(x.amount_cents) AS valor_cents, x.posted_on AS data,
         'Asaas IP S.A. (contraparte 991) é a resposta já aplicada às 1.565 gêmeas de 2026'::text AS evidencia,
         'decisao-13-estender-a-pre-2026'::text AS grupo
    FROM taxa_asaas x

  UNION ALL
  SELECT 'fin_transaction', l.id, 'tx_contraparte_ausente_com_liquidacao',
         left(l.description_raw, 120), abs(l.amount_cents), l.posted_on,
         CASE WHEN l.cp_do_documento IS NOT NULL
              THEN 'liquida o documento ' || l.document_id || ', cuja contraparte é ' || coalesce(l.nome_do_documento, '?')
              ELSE 'liquida o documento ' || l.document_id || ', que também está sem contraparte' END,
         CASE WHEN l.cp_do_documento IS NOT NULL
              THEN 'contraparte-alcancada-por-liquidacao:' || l.cp_do_documento
              ELSE 'contraparte-alcancada-por-liquidacao:documento-sem-contraparte' END
    FROM liquida l

  UNION ALL
  SELECT 'fin_transaction', t.id, 'tx_contraparte_ausente_sem_evidencia',
         left(t.description_raw, 120), abs(t.amount_cents), t.posted_on,
         'nenhuma: sem documento, sem nome da contraparte e sem liquidação',
         'sem-identificador-na-fonte:' || coalesce(t.source_kind, 'sem_source_kind')
    FROM fin_transaction t
    JOIN casa e ON e.entity_id = t.entity_id
   WHERE t.counterparty_id IS NULL
     AND t.transfer_status = 'nao'
     AND t.counterparty_raw IS NULL
     AND (t.counterparty_document IS NULL OR t.counterparty_document <> e.cnpj)
     AND t.id NOT IN (SELECT id FROM taxa_asaas)
     AND t.id NOT IN (SELECT id FROM liquida)

  UNION ALL
  SELECT 'fin_transaction', t.id, 'tx_documento_da_fonte_sem_cadastro',
         left(coalesce(t.counterparty_raw, t.description_raw), 120), abs(t.amount_cents), t.posted_on,
         'CPF/CNPJ ' || t.counterparty_document || ' entregue pela fonte, ausente de fin_counterparty',
         'documento-distinto-da-fonte:' || t.counterparty_document
    FROM fin_transaction t
    JOIN casa e ON e.entity_id = t.entity_id
   WHERE t.counterparty_document IS NOT NULL
     AND t.counterparty_document <> e.cnpj
     AND NOT EXISTS (
           SELECT 1 FROM fin_counterparty c
            WHERE regexp_replace(coalesce(c.document_number, ''), '[^0-9]', '', 'g') = t.counterparty_document)

  -- ---- fin_transaction: classificação -------------------------------------
  UNION ALL
  SELECT 'fin_transaction', t.id, 'tx_sem_categoria',
         left(t.description_raw, 120), abs(t.amount_cents), t.posted_on,
         coalesce('precedente da contraparte ' || cp.name, 'nenhum precedente de contraparte'),
         'lancamento-a-classificar:' || coalesce(cp.id::text, 'sem-contraparte')
    FROM fin_transaction t
    LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE t.category_id IS NULL

  UNION ALL
  SELECT 'fin_transaction', t.id, 'tx_categoria_declara_ignorancia',
         left(t.description_raw, 120), abs(t.amount_cents), t.posted_on,
         'marcada ' || c.code || ', que declara indecisão em vez de linha de plano de contas',
         'rotulo-que-declara-indecisao:' || c.code || ':' || coalesce(t.counterparty_id::text, 'sem-contraparte')
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
   WHERE c.code IN ('3.99', '5.99')

  UNION ALL
  -- Os dois motivos de "serviço não declarado" saem daqui e entram em
  -- `cobranca_sem_tipo_de_servico`: são o mesmo caso, e listá-lo duas vezes
  -- faria a fila parecer 63 trabalhos maior do que é.
  SELECT 'fin_transaction', i.id, 'tx_indeterminado_declarado',
         left(i.description_raw, 120), abs(i.amount_cents), i.posted_on,
         'motivo declarado na tag: ' || i.motivo,
         'motivo-de-indeterminacao:' || i.motivo
    FROM fin_indeterminado_v i
   WHERE i.motivo NOT IN ('indeterminado:servico-nao-declarado',
                          'indeterminado:assinatura-sem-servico-declarado')

  UNION ALL
  SELECT 'fin_transaction', t.id, 'tx_sem_nucleo',
         left(t.description_raw, 120), abs(t.amount_cents), t.posted_on,
         coalesce('núcleo padrão da contraparte: ' || cp.default_nucleo, 'nenhum núcleo padrão alcança'),
         'nucleo-a-definir:' || coalesce(cp.id::text, 'sem-contraparte')
    FROM fin_transaction t
    LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE t.nucleo IS NULL

  UNION ALL
  SELECT 'fin_transaction', t.id, 'tx_sem_centro_de_custo',
         left(t.description_raw, 120), abs(t.amount_cents), t.posted_on,
         'nenhuma: quem carimba projeto é o erp-obras',
         'teto-de-fonte-erp-obras'
    FROM fin_transaction t
   WHERE t.cost_center_id IS NULL

  -- ---- fin_document -------------------------------------------------------
  UNION ALL
  SELECT 'fin_document', d.id, 'doc_sem_categoria',
         left(d.description, 120), abs(d.amount_cents), d.competence_date,
         coalesce('contraparte ' || cp.name, 'sem contraparte'),
         'documento-a-classificar:' || coalesce(cp.id::text, 'sem-contraparte')
    FROM fin_document d
    LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
   WHERE d.category_id IS NULL

  UNION ALL
  SELECT 'fin_document', d.id, 'doc_sem_contraparte',
         left(d.description, 120), abs(d.amount_cents), d.competence_date,
         'origem ' || d.source || coalesce(' id ' || d.source_id, ''),
         'documento-sem-contraparte:' || d.source

  FROM fin_document d
   WHERE d.counterparty_id IS NULL

  UNION ALL
  SELECT 'fin_document', d.id, 'doc_receber_vencido_sem_liquidacao',
         left(d.description, 120), abs(d.amount_cents), d.due_date,
         'vencida em ' || d.due_date || ', status ' || d.status || ', sem liquidação no ledger',
         'vencido-sem-liquidacao:' || to_char(d.due_date, 'YYYY')
    FROM fin_document d
   WHERE d.direction = 'receber'
     AND d.status NOT IN ('liquidado', 'cancelado')
     AND d.due_date < current_date

  -- ---- fin_card_transaction ----------------------------------------------
  UNION ALL
  SELECT 'fin_card_transaction', k.id, 'card_sem_categoria',
         left(k.nome, 120), abs(k.valor_cents), k.posted_on,
         k.motivo,
         CASE WHEN k.installment_plan_id IS NOT NULL
              THEN 'plano-de-parcelamento:' || k.installment_plan_id
              ELSE 'estabelecimento:' || coalesce(k.nome, 'sem-nome') END
    FROM fin_card_a_classificar_v k

  UNION ALL
  SELECT 'fin_card_transaction', t.id, 'card_sem_titular',
         left(t.description, 120), abs(t.amount_cents), t.posted_on,
         'cartão final ' || coalesce(c.last4, '????')
           || coalesce(', portador na fonte: ' || c.holder_name_raw, ', a fonte não devolveu portador'),
         'cartao-sem-portador:' || c.id
    FROM fin_card_transaction t
    JOIN fin_card c ON c.id = t.card_id
   WHERE c.holder_person_id IS NULL

  UNION ALL
  SELECT 'fin_card_transaction', t.id, 'card_sem_centro_de_custo',
         left(t.description, 120), abs(t.amount_cents), t.posted_on,
         'nenhuma: quem carimba projeto é o erp-obras',
         'teto-de-fonte-erp-obras'
    FROM fin_card_transaction t
   WHERE t.cost_center_id IS NULL

  -- ---- fin_counterparty ---------------------------------------------------
  UNION ALL
  SELECT 'fin_counterparty', c.id, 'contraparte_sem_documento',
         c.name, coalesce(v.volume, 0), v.ultimo,
         CASE WHEN c.name ~ '[0-9]{11}'
              THEN 'a fonte embutiu 11 dígitos no próprio nome — conferir dígito verificador antes de usar'
              ELSE 'nenhuma: nem alias, nem documento no extrato' END,
         'contraparte-sem-documento:' || c.id
    FROM fin_counterparty c
    LEFT JOIN LATERAL (
      SELECT sum(abs(t.amount_cents)) AS volume, max(t.posted_on) AS ultimo
        FROM fin_transaction t WHERE t.counterparty_id = c.id
    ) v ON true
   WHERE coalesce(btrim(c.document_number), '') = ''

  UNION ALL
  SELECT 'fin_counterparty', p.id_sem_documento, 'contraparte_possivel_duplicata',
         p.nome_sem_documento, 0, NULL,
         p.candidatos || ' candidato(s) por similaridade de nome (' || round(p.melhor_sim::numeric, 2)
           || '): ' || p.candidatos_texto || ' — SUGESTÃO, nunca carimbo',
         'par-de-contrapartes-parecidas:' || p.id_sem_documento
    FROM duplicata p

  -- ---- fin_person ---------------------------------------------------------
  UNION ALL
  SELECT 'fin_person', p.id, 'pessoa_vinculo_indefinido',
         p.name, 0, p.start_date,
         'employment_type = ' || p.employment_type || ', status ' || p.status,
         'vinculo-nao-declarado:' || p.id
    FROM fin_person p
   WHERE p.employment_type IN ('indefinido', 'irregular')

  UNION ALL
  SELECT 'fin_person', p.id, 'pessoa_sem_documento',
         p.name, 0, p.start_date,
         'vínculo ' || p.employment_type
           || coalesce(', contraparte ligada ' || cp.name, ', sem contraparte ligada'),
         'pessoa-sem-documento:' || p.employment_type
    FROM fin_person p
    LEFT JOIN fin_counterparty cp ON cp.id = p.counterparty_id
   WHERE p.cpf IS NULL AND p.cnpj IS NULL

  UNION ALL
  SELECT 'fin_person', p.id, 'pessoa_status_contradiz_pagamento',
         p.name, u.valor, u.ultimo,
         'inativa desde ' || coalesce(p.end_date::text, '(sem data)')
           || ' e o último pagamento é de ' || u.ultimo,
         'status-x-pagamento:' || p.id
    FROM fin_person p
    JOIN LATERAL (
      SELECT max(t.posted_on) AS ultimo, sum(abs(t.amount_cents)) AS valor
        FROM fin_person_counterparty pc
        JOIN fin_transaction t ON t.counterparty_id = pc.counterparty_id
       WHERE pc.person_id = p.id
    ) u ON u.ultimo IS NOT NULL
   WHERE p.status = 'inativo'
     AND (p.end_date IS NULL OR u.ultimo >= p.end_date)

  -- ---- contratos ----------------------------------------------------------
  UNION ALL
  SELECT 'fin_contract', k.id, 'contrato_sem_contraparte',
         k.name, abs(k.amount_cents), k.start_date,
         coalesce('pessoa ' || pe.name || ' já usa a contraparte ' || cp.name,
                  'nem pessoa nem contraparte ligadas'),
         'contrato-sem-contraparte:' || k.id
    FROM fin_contract k
    LEFT JOIN fin_person pe ON pe.id = k.person_id
    LEFT JOIN fin_counterparty cp ON cp.id = pe.counterparty_id
   WHERE k.counterparty_id IS NULL

  UNION ALL
  SELECT 'erp_contrato', k.id, 'erp_contrato_contraparte_nao_casada',
         left(k.titulo, 120), abs(coalesce(k.valor_contratado_cents, 0)), k.data_inicio,
         'motivo do ERP: ' || k.counterparty_match
           || coalesce(' · cliente ' || k.cliente_razao_social, ''),
         'cliente-erp-sem-par:' || k.counterparty_match
    FROM erp_contrato k
   WHERE k.counterparty_id IS NULL

  UNION ALL
  SELECT 'erp_contrato', k.id, 'erp_contrato_multisservico',
         left(k.titulo, 120), abs(coalesce(k.valor_contratado_cents, 0)), k.data_inicio,
         s.n || ' serviços declarados no ERP, e ele não guarda o valor de cada um',
         'valor-por-servico:' || s.n || '-servicos'
    FROM erp_contrato k
    JOIN (SELECT erp_contrato_id, count(*) AS n
            FROM erp_contrato_servico GROUP BY 1 HAVING count(*) > 1) s
      ON s.erp_contrato_id = k.erp_id

  UNION ALL
  SELECT 'erp_contrato', k.id, 'erp_contrato_eixo_ambos',
         left(k.titulo, 120), abs(coalesce(k.valor_contratado_cents, 0)), k.data_inicio,
         'eixo=AMBOS declarado no ERP; fin_contract.kind aceita um valor só',
         'eixo-ambos'
    FROM erp_contrato k
   WHERE k.eixo = 'AMBOS'

  UNION ALL
  SELECT 'fin_transaction', i.id, 'cobranca_sem_tipo_de_servico',
         left(i.description_raw, 120), abs(i.amount_cents), i.posted_on,
         'motivo declarado: ' || i.motivo || coalesce(' · contraparte ' || i.contraparte, ''),
         'valor-por-servico:cobranca'
    FROM fin_indeterminado_v i
   WHERE i.motivo IN ('indeterminado:servico-nao-declarado',
                      'indeterminado:assinatura-sem-servico-declarado')

  -- ---- transferências -----------------------------------------------------
  UNION ALL
  SELECT 'transferencia', t.id, 'transferencia_perna_sem_extrato',
         left(t.description_raw, 120), abs(t.amount_cents), t.posted_on,
         'motivo gravado: ' || coalesce(t.transfer_unresolved_reason, '(sem motivo)'),
         'extrato-do-outro-lado:' || coalesce(t.transfer_unresolved_reason, 'sem-motivo')
    FROM fin_transaction t
   WHERE t.transfer_status = 'em_transito'
     AND t.transfer_unresolved_reason IS NOT NULL

  -- ---- contas -------------------------------------------------------------
  UNION ALL
  SELECT 'fin_account', a.id, 'conta_sem_cobertura_extrato',
         a.name || ' (' || a.slug || ')', 0, a.opening_balance_date,
         'conta ativa, ' || (SELECT count(*) FROM fin_transaction t WHERE t.account_id = a.id)
           || ' lançamento(s) e nenhuma janela de cobertura declarada',
         'extrato-que-nao-existe:' || a.slug
    FROM fin_account a
   WHERE a.is_active
     AND NOT EXISTS (SELECT 1 FROM fin_statement_coverage s WHERE s.account_id = a.id)

  UNION ALL
  SELECT 'fin_account', -1, 'conta_fora_do_ledger',
         'Caixa Econômica 12920000005783083433 — 7ª conta, fora de fin_account',
         sum(abs(t.amount_cents)), max(t.posted_on),
         count(*) || ' lançamento(s) apontam para ela e M15 nunca poderá acusá-la',
         'extrato-que-nao-existe:caixa-economica'
    FROM fin_transaction t
   WHERE t.transfer_unresolved_reason LIKE 'destino_fora_do_ledger:%'
  HAVING count(*) > 0

  -- ---- regras -------------------------------------------------------------
  UNION ALL
  SELECT 'fin_rule', r.rule_id, 'regra_aguardando_fonte',
         r.name, 0, NULL,
         'reason_code: ' || r.reason_code || ' · ' || coalesce(r.justification, ''),
         'fonte-externa-ausente:' || r.reason_code
    FROM fin_rule_health_v r
   WHERE r.health_state = 'aguardando_fonte'

  UNION ALL
  SELECT 'fin_rule', r.rule_id, 'regra_em_sombra',
         r.name, 0, NULL,
         'sombra esperada até ' || coalesce(r.valid_until::text, '(sem validade)')
           || ' · ' || coalesce(r.justification, ''),
         'sombra-a-confirmar:' || r.rule_id
    FROM fin_rule_health_v r
   WHERE r.health_state = 'sombra_esperada'
)
SELECT b.universo,
       b.id,
       b.tipo AS tipo_de_pendencia,
       b.descricao,
       b.valor_cents,
       b.data,
       c.o_que_falta,
       c.caminho_de_correcao,
       c.bloqueado_por,
       b.evidencia AS evidencia_disponivel,
       c.alcancavel_agora,
       (b.data IS NOT NULL AND b.data >= DATE '2026-01-01') AS em_escopo_2026,
       b.grupo AS causa_comum,
       c.ordem
  FROM bruto b
  JOIN fin_pendencia_tipo c ON c.tipo = b.tipo
 WHERE NOT EXISTS (
         SELECT 1 FROM fin_pendencia_resolucao r
          WHERE r.universo = b.universo AND r.alvo_id = b.id
            AND r.tipo = b.tipo AND r.desfeito_em IS NULL);

COMMENT ON VIEW fin_pendencia_identificacao_v IS
  'Inventário do indeterminado, uma linha por (universo, id, tipo_de_pendencia). '
  'NÃO SOME valor_cents da view inteira: o mesmo lançamento aparece em até três '
  'tipos e a coluna mistura estoque com fluxo. Ela ordena, não totaliza. '
  'Casos com resolução declarada em fin_pendencia_resolucao saem daqui.';

-- ---------------------------------------------------------------------------
-- 4. TAMANHO DO PROBLEMA × TAMANHO DO TRABALHO
--
-- É a lição da fila de decisão, aplicada aqui: 500 itens de cartão são 105
-- estabelecimentos, e 7.245 taxas do Asaas são UMA decisão. Ordenar por número
-- de itens faz a pessoa atacar o maior monte, que costuma ser o mais barato de
-- resolver e o menos valioso. `itens_por_decisao` é a alavanca.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_pendencia_identificacao_grupo_v AS
SELECT p.universo,
       p.tipo_de_pendencia,
       p.caminho_de_correcao,
       p.alcancavel_agora,
       p.bloqueado_por,
       count(*)                                   AS itens,
       count(DISTINCT p.causa_comum)              AS decisoes_distintas,
       round(count(*)::numeric
             / nullif(count(DISTINCT p.causa_comum), 0), 1) AS itens_por_decisao,
       sum(p.valor_cents)                         AS valor_cents,
       count(*) FILTER (WHERE p.em_escopo_2026)   AS itens_2026,
       sum(p.valor_cents) FILTER (WHERE p.em_escopo_2026) AS valor_cents_2026,
       min(p.data)                                AS de,
       max(p.data)                                AS ate,
       max(p.o_que_falta)                         AS o_que_falta,
       min(p.ordem)                               AS ordem
  FROM fin_pendencia_identificacao_v p
 GROUP BY p.universo, p.tipo_de_pendencia, p.caminho_de_correcao,
          p.alcancavel_agora, p.bloqueado_por;

COMMENT ON VIEW fin_pendencia_identificacao_grupo_v IS
  'Tamanho do problema (itens) separado do tamanho do trabalho '
  '(decisoes_distintas). itens_por_decisao alto = muito item, pouca decisão: '
  'é onde uma hora de gente rende mais.';

-- ---------------------------------------------------------------------------
-- 5. O QUE FICOU DE FORA, E POR QUÊ
--
-- Ausência declarada vale mais que ausência silenciosa. Sem esta view, alguém
-- vai medir "sem contraparte" direto na tabela, achar 8.662 em vez de 8.500,
-- concluir que o inventário está furado, e refazer a varredura. Pior: vai
-- encontrar os 162 do CNPJ da casa no topo por valor e cadastrá-los.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_pendencia_identificacao_excluido_v AS
WITH casa AS (
  SELECT id AS entity_id, regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g') AS cnpj
    FROM fin_entity WHERE slug = 'xpe'
)
SELECT 'fin_transaction'::text AS universo,
       'contraparte_e_a_propria_casa'::text AS populacao,
       count(*) AS itens,
       sum(abs(t.amount_cents)) AS valor_cents,
       ('A outra ponta é a própria XPE (CNPJ ' || max(e.cnpj) || '). Estão CORRETAMENTE sem contraparte: '
        || 'cadastrar uma aqui viola A1 e A2, e foi exatamente assim que R$ 151.977,33 de transferência '
        || 'própria viraram despesa de fornecedor. Não é pendência — é armadilha.')::text AS por_que_fora
  FROM fin_transaction t
  JOIN casa e ON e.entity_id = t.entity_id
 WHERE t.counterparty_id IS NULL AND t.counterparty_document = e.cnpj
HAVING count(*) > 0

UNION ALL
SELECT 'fin_transaction', 'perna_de_transferencia_pareada',
       count(*), sum(abs(t.amount_cents)),
       'Transferência própria pareada ou anulada: a outra ponta é uma conta da casa, não uma contraparte. '
       'transfer_group_id prova o par.'
  FROM fin_transaction t
 WHERE t.counterparty_id IS NULL AND t.transfer_status IN ('pareado', 'anulado')
   AND t.counterparty_document IS NULL
HAVING count(*) > 0

UNION ALL
SELECT 'fin_card_transaction', 'pagamento_de_fatura_sem_categoria',
       count(*), sum(abs(t.amount_cents)),
       'Pagamento de fatura DEVE ficar sem categoria: o custo vem dos itens, na competência; '
       'o pagamento é caixa. Categorizá-lo contaria a mesma despesa duas vezes.'
  FROM fin_card_transaction t
 WHERE t.category_id IS NULL AND t.kind = 'pagamento_fatura'
HAVING count(*) > 0

UNION ALL
SELECT 'fin_counterparty', 'pares_de_nomes_com_documentos_distintos',
       count(*), 0,
       'Nomes quase idênticos e CNPJ/CPF diferentes em ambos os lados: são entidades distintas. '
       'O documento arbitra e não há pendência. Tallanny (57538443000158) e Tawanny (63384563000140) '
       'são o caso que prova a regra.'
  FROM (SELECT a.id
          FROM fin_counterparty a
          JOIN fin_counterparty b ON b.id > a.id
           AND similarity(a.normalized_name, b.normalized_name) >= 0.55
         WHERE coalesce(btrim(a.document_number), '') <> ''
           AND coalesce(btrim(b.document_number), '') <> ''
           AND regexp_replace(a.document_number, '[^0-9]', '', 'g')
             <> regexp_replace(b.document_number, '[^0-9]', '', 'g')) z
HAVING count(*) > 0;

COMMENT ON VIEW fin_pendencia_identificacao_excluido_v IS
  'Populações deliberadamente FORA do inventário, com o motivo. Existe para que '
  'quem recontar por fora encontre a diferença explicada em vez de concluir que '
  'o inventário está furado.';

-- ---------------------------------------------------------------------------
-- 6. PÓS-CONDIÇÕES
--
-- O vocabulário tem de fechar nos dois sentidos. Um tipo emitido pela view e
-- ausente do catálogo seria DESCARTADO em silêncio pelo JOIN — o caso sumiria
-- do inventário sem que ninguém soubesse, que é a falha mais cara que este
-- desenho pode ter. Um tipo no catálogo e nunca emitido é uma promessa vazia.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_faltando text;
  v_sobrando  text;
  v_casos     bigint;
  v_tipos     bigint;
BEGIN
  SELECT string_agg(DISTINCT t.tipo, ', ')
    INTO v_sobrando
    FROM fin_pendencia_tipo t
   WHERE NOT EXISTS (SELECT 1 FROM fin_pendencia_identificacao_v p
                      WHERE p.tipo_de_pendencia = t.tipo);
  IF v_sobrando IS NOT NULL THEN
    RAISE EXCEPTION '0103: tipo(s) no catálogo sem nenhum caso: %', v_sobrando;
  END IF;

  -- O caminho inverso não pode ser medido pela própria view (o JOIN já
  -- descartou). Conferimos que o catálogo cobre os 30 tipos que a view escreve
  -- literalmente, e que o CHECK do vocabulário aceita exatamente esses.
  SELECT count(*) INTO v_tipos FROM fin_pendencia_tipo;
  IF v_tipos <> 30 THEN
    RAISE EXCEPTION '0103: catálogo com % tipos, esperados 30', v_tipos;
  END IF;

  SELECT count(*) INTO v_casos FROM fin_pendencia_identificacao_v;
  IF v_casos < 1000 THEN
    RAISE EXCEPTION '0103: inventário com % casos — pequeno demais, a varredura perdeu população', v_casos;
  END IF;

  -- A armadilha do CNPJ da casa NUNCA pode virar caso de cadastro.
  SELECT count(*) INTO v_casos
    FROM fin_pendencia_identificacao_v p
    JOIN fin_transaction t ON t.id = p.id AND p.universo = 'fin_transaction'
    JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
   WHERE p.caminho_de_correcao = 'cadastrar_contraparte'
     AND t.counterparty_document = regexp_replace(e.cnpj, '[^0-9]', '', 'g');
  IF v_casos <> 0 THEN
    RAISE EXCEPTION '0103: % caso(s) mandariam cadastrar contraparte com o CNPJ da casa — A1/A2', v_casos;
  END IF;

  -- Nenhum caso pode ficar sem caminho declarado.
  SELECT count(*) INTO v_casos
    FROM fin_pendencia_identificacao_v WHERE caminho_de_correcao IS NULL;
  IF v_casos <> 0 THEN
    RAISE EXCEPTION '0103: % caso(s) sem caminho de correção', v_casos;
  END IF;
END $$;
