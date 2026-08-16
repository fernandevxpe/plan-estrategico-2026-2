-- A contraparte dos lançamentos do Asaas, e a cobrança que gerou cada taxa.
--
-- ---------------------------------------------------------------------------
-- O QUE FOI MEDIDO ANTES DE ESCREVER (16/08/2026)
-- ---------------------------------------------------------------------------
-- Conta `asaas` em 2026: 2.285 lançamentos, 1.762 sem `counterparty_id` (77,1%).
-- É o maior buraco isolado do ano, e o indicador "contraparte identificada" em
-- 2026 está em 44,1% por causa dele.
--
-- O PLANO_2026 supunha que "as transações sem paymentId são taxas do Asaas".
-- A medição desmente: **as taxas TÊM `paymentId`**. Do arquivo bruto de 15/08,
-- sobre as 1.762 linhas sem contraparte:
--
--   caminho 1 — ftn.paymentId → payment.customer → customer.cpfCnpj ... 1.061
--       PAYMENT_FEE .......................... 552
--       PAYMENT_MESSAGING_NOTIFICATION_FEE ... 456
--       PAYMENT_RECEIVED ......................53
--   caminho 2 — ftn.invoiceId → invoice.customer → cpfCnpj ............... 503
--       INVOICE_FEE (504 no total; 1 sem customer)
--   ------------------------------------------------------------------------
--   com identidade EXATA do cliente ................................... 1.564
--   sem nenhum caminho exato ............................................ 198
--       TRANSFER ............................. 139
--       INSTANT_TEXT_MESSAGE_FEE .............. 53
--       PIX_TRANSACTION_DEBIT_REFUND ........... 4
--       BILL_PAYMENT ........................... 1
--       INVOICE_FEE sem customer ............... 1
--
-- Nenhuma perda em nenhum salto: dos 1.061 do caminho 1, 1.061 chegam a um
-- customer com cpfCnpj válido, e os 349 clientes do cadastro têm documento
-- (316 documentos distintos — 33 cadastros repetidos, que a unificação por
-- documento de `import-asaas.mjs` já resolve).
--
-- E o mais importante: **os 1.564 caem todos em documentos que JÁ existem**
-- entre as 433 contrapartes cadastradas com documento. Zero contraparte nova a
-- criar. Esta migration não inventa cadastro nenhum.
--
-- ---------------------------------------------------------------------------
-- A DISTINÇÃO QUE ESTA MIGRATION EXISTE PARA PRESERVAR
-- ---------------------------------------------------------------------------
-- Dos 1.564 com identidade exata do cliente, **1.511 são TAXAS do Asaas** e só
-- 53 são recebimento de cliente (PAYMENT_RECEIVED).
--
-- E aí "o cliente" responde a uma pergunta diferente de `counterparty_id`:
--
--   · numa taxa de boleto de R$ 1,99 sobre a fatura do cliente X, **quem
--     recebeu o dinheiro foi o Asaas**. O cliente X não recebeu nada — ele é a
--     CAUSA do custo, não a outra ponta dele;
--   · num PAYMENT_RECEIVED, quem pagou foi o cliente X. Ali ele é a outra ponta.
--
-- Confundir as duas coisas tem preço concreto, e o preço já foi pago uma vez
-- neste banco. `fin_transaction.counterparty_document` é documentado na 0042
-- como "documento da OUTRA ponta", e existe uma regra de prioridade 0
-- (`transferencia-cnpj-proprio`) que compara essa coluna com o CNPJ da casa.
-- Escrever o CNPJ do cliente na taxa que ele não recebeu é gravar um fato
-- FALSO na coluna que uma regra determinística lê — a mesma classe de erro que
-- o comentário da 0042 registra ter quase transformado 31 boletos
-- (R$ 28.263,64) em transferência.
--
-- Por isso a atribuição ao cliente ganha lugar próprio (`origin_document_id`) e
-- não é empurrada para dentro de `counterparty_id`. As duas perguntas passam a
-- ter resposta, e nenhuma das duas mente:
--
--   "quem é a outra ponta desta taxa?" ......... counterparty_id  → Asaas
--   "de qual cobrança esta taxa nasceu?" ....... origin_document_id → o cliente
--
-- Sem `origin_document_id`, escolher uma resposta apagaria a outra. Com ela, a
-- política de qual contraparte carimbar nas taxas vira um parâmetro do backfill
-- (`--taxas`) e não uma decisão irreversível de esquema.
--
-- Verificado antes de abrir a coluna: `fin_settlement` NÃO serve para isto.
-- O CHECK `fin_settlement_sinal` exige `amount_cents > 0` em 'liquidacao' e
-- `< 0` em 'estorno' — uma taxa é negativa e não é estorno. Registrá-la ali
-- exigiria mentir sobre `kind`, e `fin_settlement` é o que alimenta
-- `fin_document.settled_cents`: 1.511 taxas entrando como estorno rebaixariam
-- o valor liquidado de 1.511 cobranças e a inadimplência passaria a mostrar
-- dívida que não existe.
--
-- Esta migration só abre o lugar e cadastra a instituição. Quem preenche é
-- `scripts/backfill-asaas-contraparte.mjs`. Nada aqui move dinheiro:
-- `amount_cents` não é tocado em nenhuma linha deste arquivo.

-- ---------------------------------------------------------------------------
-- 1. A COBRANÇA QUE GEROU O LANÇAMENTO
-- ---------------------------------------------------------------------------
-- Não é liquidação (isso é `fin_settlement`, e continua sendo). É causalidade:
-- "esta linha de caixa existe por causa daquele documento". No Asaas o vínculo
-- é EXATO e vem da própria fonte — `paymentId` na financialTransaction, ou
-- `invoiceId` → `invoice.payment` — sem heurística de valor e data.
--
-- É o que permite, sem tocar em `counterparty_id`, responder "quanto custou de
-- tarifa para atender o cliente X" e "qual a margem líquida daquela cobrança" —
-- as duas perguntas que a F5 (centro de custo) e a margem por cliente precisam.
ALTER TABLE fin_transaction
  ADD COLUMN IF NOT EXISTS origin_document_id bigint;

ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_origin_document_id_fkey;
-- ON DELETE SET NULL, e não CASCADE: apagar uma cobrança não pode apagar o
-- lançamento de caixa que já saiu do banco. O dinheiro saiu de verdade; perder
-- a linha por causa do documento quebraria o saldo, que é a validação máxima.
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_origin_document_id_fkey
  FOREIGN KEY (origin_document_id) REFERENCES fin_document(id) ON DELETE SET NULL;

COMMENT ON COLUMN fin_transaction.origin_document_id IS
  'A cobrança que CAUSOU este lançamento, quando a fonte diz qual é. Não é '
  'liquidação — quem paga o documento é fin_settlement. Serve para a taxa do '
  'Asaas (PAYMENT_FEE, INVOICE_FEE, PAYMENT_MESSAGING_NOTIFICATION_FEE), cuja '
  'contraparte é o Asaas mas cujo CUSTO pertence ao cliente da cobrança. '
  'Preenchida a partir de financialTransaction.paymentId / invoiceId, que são '
  'vínculos exatos da fonte, nunca de casamento por valor e data.';

-- Parcial: hoje 0 linhas de 13.880 têm o dado, e mesmo depois do backfill serão
-- ~1.5 mil. Um índice cheio seria quase todo NULL.
CREATE INDEX IF NOT EXISTS fin_transaction_origin_document_idx
  ON fin_transaction (origin_document_id)
  WHERE origin_document_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. O ASAAS COMO CONTRAPARTE INSTITUCIONAL
-- ---------------------------------------------------------------------------
-- 'instituicao_financeira' já é um dos sete `kind` permitidos pelo CHECK e não
-- tinha nenhum ocupante — a tarifa bancária vinha sendo lançada sem outra ponta
-- desde o começo.
--
-- SEM `document_number`, e isso é deliberado.
--
-- A evidência disponível dá o ISPB, não o CNPJ completo. Em
-- `data/raw/inter-extrato.json`, 51 PIX recebidos do Asaas trazem
-- `nomeEmpresaPagador = "ASAAS IP S.A."` e `endToEndId` começando em
-- `E19540550…` — os 8 primeiros dígitos do endToEndId são o ISPB da
-- instituição, aqui 19540550. O ISPB coincide com a RAIZ do CNPJ, mas a filial
-- e os dígitos verificadores (`/0001-XX`) NÃO estão em nenhum arquivo deste
-- repositório.
--
-- Preencher `document_number` com um CNPJ completado de memória violaria a
-- regra que rege todo este módulo: sem evidência, não escolha. E o custo não
-- seria teórico — `fin_counterparty_document_idx` é ÚNICO por
-- (entity_id, document_number), então um documento errado aqui bloqueia o
-- cadastro do documento certo depois, e o backfill de qualquer outra conta que
-- venha a encontrar o CNPJ real do Asaas falharia na inserção sem explicar por
-- quê.
--
-- Fica sem documento, com a evidência registrada em `notes`. O dia em que o
-- CNPJ for confirmado, é um UPDATE de uma linha — e o vínculo das 1.5 mil taxas
-- já estará feito, porque ele aponta para o `id`, não para o documento.
INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number, notes, created_at)
SELECT e.id,
       'instituicao_financeira',
       'Asaas IP S.A.',
       'asaas ip',
       NULL,
       NULL,
       'Adquirente/gateway da conta `asaas`. Contraparte das tarifas '
         || '(PAYMENT_FEE, INVOICE_FEE, PAYMENT_MESSAGING_NOTIFICATION_FEE, '
         || 'INSTANT_TEXT_MESSAGE_FEE): o dinheiro da tarifa vai para cá, e o '
         || 'cliente que a originou fica em fin_transaction.origin_document_id. '
         || 'SEM CNPJ de propósito — a evidência disponível (51 PIX no extrato '
         || 'do Inter, nomeEmpresaPagador "ASAAS IP S.A.", endToEndId '
         || 'E19540550…) dá o ISPB 19540550, que é a raiz do CNPJ, mas não a '
         || 'filial nem os dígitos verificadores. Confirmar com o Fernando '
         || 'antes de preencher: documento errado aqui trava o índice único e '
         || 'impede o cadastro do certo. Ver docs/DUVIDAS_FINANCEIRO.md.',
       now()
  FROM fin_entity e
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (
         SELECT 1 FROM fin_counterparty c
          WHERE c.entity_id = e.id AND c.normalized_name = 'asaas ip'
       );

-- ---------------------------------------------------------------------------
-- 3. TRAVAS DE SANIDADE
-- ---------------------------------------------------------------------------
-- Melhor a migration falhar aqui do que o backfill escrever contra um esquema
-- meio aplicado e o erro só aparecer num relatório de contraparte semanas
-- depois.
DO $$
DECLARE
  v_asaas   bigint;
  v_coluna  int;
BEGIN
  SELECT count(*) INTO v_coluna
    FROM information_schema.columns
   WHERE table_name = 'fin_transaction' AND column_name = 'origin_document_id';
  IF v_coluna <> 1 THEN
    RAISE EXCEPTION 'fin_transaction.origin_document_id não foi criada. Abortado.';
  END IF;

  SELECT c.id INTO v_asaas
    FROM fin_counterparty c JOIN fin_entity e ON e.id = c.entity_id
   WHERE e.slug = 'xpe' AND c.normalized_name = 'asaas ip';
  IF v_asaas IS NULL THEN
    RAISE EXCEPTION 'contraparte institucional do Asaas não foi criada. Abortado.';
  END IF;

  -- Duas linhas com o mesmo nome normalizado fariam o backfill escolher uma ao
  -- acaso (não há unicidade por nome nesta tabela, só por documento), e metade
  -- das taxas apontaria para uma contraparte e metade para a outra.
  IF (SELECT count(*) FROM fin_counterparty c JOIN fin_entity e ON e.id = c.entity_id
       WHERE e.slug = 'xpe' AND c.normalized_name = 'asaas ip') > 1 THEN
    RAISE EXCEPTION 'existe mais de uma contraparte "asaas ip" — unifique antes de rodar o backfill. Abortado.';
  END IF;
END $$;
