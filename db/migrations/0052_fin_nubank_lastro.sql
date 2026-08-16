-- O extrato do Nubank ganha lastro de origem, e o pareamento com o Polp fica
-- registrado — inclusive quando ele NÃO foi possível.
--
-- ---------------------------------------------------------------------------
-- O QUE O CSV NUNCA TEVE
-- ---------------------------------------------------------------------------
-- A conta `nubank` entrou neste ledger por CSV. O CSV do Nubank traz data,
-- valor e uma descrição em texto corrido — e mais nada. Medido em 16/08/2026,
-- sobre as 854 linhas de 2026:
--
--     703 sem `source_kind`        (a maior lacuna de lastro do ledger)
--     854 sem `counterparty_document`
--     823 sem `cost_center_id`
--     461 na fila de revisão       (a maior fila do ledger)
--
-- O Polp (open finance do Nubank) tem essa informação e a entrega por GET:
-- `operation_type` em 100% das 865 transações, e o documento das duas pontas
-- em `payment_data`. Esta migration abre o lugar para guardar isso. Quem
-- preenche é `scripts/backfill-nubank-polp.mjs`.
--
-- ---------------------------------------------------------------------------
-- O BUG DE PAGINAÇÃO DA POLP: TESTADO AQUI, E NÃO EXISTE NESTE ENDPOINT
-- ---------------------------------------------------------------------------
-- Em `/integrations/2906/investments` a Polp declara `meta.total = 66`, devolve
-- 66 linhas em 5 páginas e apenas 62 são distintas — ordenação instável, com 4
-- posições repetidas e 4 nunca exibidas. Uma das invisíveis estava ACTIVE com
-- R$ 1.291,20. Por isso `sync-polp-investimentos.mjs` varre por id.
--
-- `/accounts/2588/transactions` foi submetido ao MESMO teste antes de qualquer
-- linha ser escrita: três varreduras completas (duas com `per_page=100`, uma
-- com `per_page=500`), deduplicando por `id` e comparando com `meta.total`.
--
--     meta.total ......... 865
--     linhas entregues ... 865   nas três varreduras
--     ids distintos ...... 865   nas três varreduras
--     repetidos .......... 0
--     ordem entre A e B .. idêntica
--
-- O defeito NÃO está aqui. As contagens deste endpoint podem ser usadas como
-- estão, e nenhum número já reportado sobre o Nubank precisa ser revisto. O
-- registro fica porque "testamos e não tem" é uma afirmação com prazo de
-- validade: se a Polp mudar a ordenação, o teste é este e está descrito.
--
-- ---------------------------------------------------------------------------
-- POR QUE O PAREAMENTO É POR DATA + VALOR, E NÃO POR IDENTIFICADOR
-- ---------------------------------------------------------------------------
-- Não há chave comum. O CSV gerou UUID v4 (aleatório) e a Polp usa UUID v3
-- (derivado): a interseção entre os dois conjuntos é de 24 linhas em 865.
--
-- E não existe `endToEndId` na Polp — `referenceNumber` é null em 865/865.
-- Só o Inter o tem, e é por isso que a 0042 pôde casar por chave e esta não
-- pode. Sobra data + valor, que é heurística, e heurística exige que o
-- indeterminado seja declarado. É o que as colunas abaixo fazem.
--
-- ---------------------------------------------------------------------------
-- A ARMADILHA DO FUSO — 62 PARES QUE SÓ APARECEM DEPOIS DE CONVERTER
-- ---------------------------------------------------------------------------
-- A Polp entrega `date` como timestamp UTC ("2026-01-05T04:07:02Z"); o ledger
-- guarda `posted_on` como DATA local. Comparar a data crua da Polp com a data
-- do ledger joga fora toda transação feita entre 21h e 24h locais:
--
--     chave = data UTC crua ....... 704 pares firmes
--     chave = data local (UTC-3) .. 766 pares firmes
--
-- 62 pares de diferença, todos reais. A conversão é obrigatória.
--
-- Sobra ainda um resíduo de sentido contrário: transações feitas depois da
-- meia-noite local (04h-06h UTC) que o extrato do Nubank lança no dia
-- ANTERIOR. São 27 linhas. Elas não podem entrar na janela geral — abrir ±1
-- dia para todo mundo derruba os pares firmes de 766 para 754 e triplica a
-- ambiguidade. Entram numa segunda passada, só sobre o que sobrou, e só quando
-- o par é único dos dois lados.
--
-- ---------------------------------------------------------------------------
-- LER A PONTA ERRADA CARIMBA O CNPJ DA CASA — e some com despesa da DRE
-- ---------------------------------------------------------------------------
-- Este é o mesmo erro que a 0022 teve de desfazer à mão, e que a 0042
-- documentou para o Inter. Na Polp ele tem forma própria. Medido nas 865:
--
--   operação                      n    receiver          payer
--   PIX DEBIT                   597    externo 595       a casa 597
--   PIX CREDIT                  106    a casa 106        externo 22 / casa 84
--   RESGATE_APLIC_FINANCEIRA    120    null 66 / casa 54 casa 66 / null 54
--   BOLETO DEBIT                 15    externo 15        a casa 15
--   CONVENIO_ARRECADACAO         14    NULL 14           a casa 14
--   OUTROS                       13    null 12 / casa 1  casa 12 / null 1
--
-- Em toda SAÍDA o pagador somos nós; em toda ENTRADA, o recebedor. Ler sempre
-- o mesmo campo faria 597 saídas apontarem para o CNPJ da XPE.
--
-- E há um caso pior, porque é silencioso: em CONVENIO_ARRECADACAO,
-- RESGATE_APLIC_FINANCEIRA e OUTROS a ponta da contraparte vem NULA. O único
-- documento presente é o nosso. Um fallback "pega o que tiver" gravaria o CNPJ
-- da casa em 14 pagamentos de DAS-SIMPLES NACIONAL e de tributo municipal —
-- que a regra `transferencia-cnpj-proprio` (0042) então converteria em
-- transferência entre contas próprias. Imposto pago vira dinheiro trocando de
-- bolso, e a despesa desaparece da DRE.
--
-- Portanto: se a ponta da contraparte é nula, NÃO HÁ DOCUMENTO. Ponto.
-- Sem documento a linha continua na fila; com o documento errado ela sai da
-- fila mentindo.
--
-- O BOLETO é a boa surpresa: ao contrário do Inter — onde `cpfCnpj` é o pagador
-- e o beneficiário só aparece por nome (0042) — a Polp traz o beneficiário do
-- boleto em `receiver` E em `merchant.cnpj`, nas 15 linhas. Aqui o documento
-- do boleto é confiável.
--
-- ---------------------------------------------------------------------------
-- `source_kind` SÓ É PREENCHIDO ONDE ESTÁ VAZIO
-- ---------------------------------------------------------------------------
-- 143 linhas já têm `source_kind` e o valor da Polp é DIFERENTE. Não é
-- divergência: é vocabulário mais pobre. A Polp chama de
-- `RESGATE_APLIC_FINANCEIRA` tanto a aplicação quanto o resgate, enquanto o
-- ledger já distingue `APLICACAO_RDB` de `RESGATE_RDB` — que é a direção do
-- dinheiro. Sobrescrever perderia informação para "padronizar".
--
-- Preencher só o vazio é o que faz este backfill ser reexecutável: rodar duas
-- vezes não muda nada na segunda.

-- ---------------------------------------------------------------------------
-- 1. AS COLUNAS
-- ---------------------------------------------------------------------------
-- Ficam em `fin_transaction` pelo mesmo motivo da 0042: são o que a FONTE
-- afirmou sobre aquela linha específica, não cadastro. A diferença é que aqui
-- a própria CORRESPONDÊNCIA é incerta, e a incerteza tem de ser um dado — não
-- um silêncio que o próximo leitor confunde com "ainda não processado".
ALTER TABLE fin_transaction
  ADD COLUMN IF NOT EXISTS polp_transaction_id bigint,
  ADD COLUMN IF NOT EXISTS lastro_match        text;

COMMENT ON COLUMN fin_transaction.polp_transaction_id IS
  'Id da transação na API do Polp que lastreia esta linha. Só é preenchido quando o '
  'pareamento é de UMA linha do Polp para UMA do ledger. Em grupo ambíguo fica NULL mesmo '
  'quando o conteúdo pôde ser aproveitado — porque qual é qual não se sabe.';

COMMENT ON COLUMN fin_transaction.lastro_match IS
  'Como a correspondência com o Polp foi estabelecida — ou por que não foi. É o registro '
  'do indeterminado: "ambiguo" e "sem_par" são resultados declarados, não ausência de '
  'processamento.';

-- Vocabulário fechado. Sem CHECK, um script futuro escreveria "ok" ou "1" e a
-- coluna perderia o sentido sem nenhum erro aparecer.
ALTER TABLE fin_transaction DROP CONSTRAINT IF EXISTS fin_transaction_lastro_match_check;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_lastro_match_check
  CHECK (lastro_match IS NULL OR lastro_match IN (
    'exato',            -- mesmo dia local, mesmo valor, único dos dois lados
    'residuo_1d',       -- lançado no dia anterior pelo banco; único no que sobrou
    'grupo_homogeneo',  -- pareamento ambíguo, MAS toda linha do grupo diz a mesma coisa
    'ambiguo',          -- mesmo dia e valor com conteúdos diferentes: indeterminado
    'sem_par'           -- não existe linha correspondente no Polp
  ));

-- Sobre o que NÃO está nesta lista: desempate por descrição.
--
-- Os 25 'ambiguo' medidos em 2026 caem em 10 grupos, e em vários deles a
-- descrição do extrato aparentemente separa as linhas — 11/05 tem três pares em
-- que uma perna é PIX "NEOENERGIA PERNAMBUCO" e a outra é boleto "CELPE
-- PERNAMBUCO", e 01/05 tem dois PIX para pessoas de nomes distintos. Seria
-- possível casar por texto e recuperar 17 das 25.
--
-- Não é o que se faz aqui, e a razão é a A6: os dois pareamentos falsos que
-- precisaram ser desfeitos nasceram de uma correspondência que "claramente"
-- batia. Casar por semelhança de texto é heurística sobre heurística — o erro
-- não aparece como erro, aparece como um CNPJ plausível na linha errada, e
-- ninguém mais volta para conferir. 25 linhas em 854 é 2,9%: o preço de deixá-las
-- declaradas é menor que o de acertar 23 e errar 2 sem saber quais.
--
-- Se um dia isso for feito, que seja num script separado, com o grau próprio, e
-- com as 25 linhas revisadas a olho antes — não como efeito colateral do
-- backfill que preenche as outras 817.

-- Uma transação do Polp lastreia no máximo UMA linha do ledger. Sem isto, um
-- erro de agrupamento poderia usar a mesma transação de origem como prova de
-- duas linhas diferentes — que é precisamente como nasceram os dois pareamentos
-- falsos que a A6 teve de desfazer.
CREATE UNIQUE INDEX IF NOT EXISTS fin_transaction_polp_tx_idx
  ON fin_transaction (polp_transaction_id)
  WHERE polp_transaction_id IS NOT NULL;

-- A fila do que ficou indeterminado, que é o que alguém precisa abrir.
CREATE INDEX IF NOT EXISTS fin_transaction_lastro_indeterminado_idx
  ON fin_transaction (account_id, posted_on)
  WHERE lastro_match IN ('ambiguo', 'sem_par');

-- ---------------------------------------------------------------------------
-- 2. `source_kind` DO NUBANK: O VOCABULÁRIO É O DA FONTE
-- ---------------------------------------------------------------------------
-- Não há CHECK em `source_kind` e não deve haver: cada fonte fala a própria
-- língua (`asaas` usa PAYMENT_RECEIVED, `inter_api` usa PIX/PAGAMENTO), e um
-- vocabulário único obrigaria a traduzir na entrada — que é onde a informação
-- se perde. O que fica é o registro de qual língua é qual.
COMMENT ON COLUMN fin_transaction.source_kind IS
  'O tipo que a FONTE deu à transação, no vocabulário da fonte. asaas: PAYMENT_RECEIVED, '
  'INVOICE_FEE… · inter_api: PIX, PAGAMENTO… · polp/nubank: PIX, RESGATE_APLIC_FINANCEIRA, '
  'BOLETO, CONVENIO_ARRECADACAO, OUTROS (operation_type) · import_csv: APLICACAO_RDB, '
  'RESGATE_RDB… Não é categoria e não é plano de contas.';

-- ---------------------------------------------------------------------------
-- 3. O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não muda `source`. As linhas continuam sendo `import_csv` e `erp_obras`,
-- porque é por ali que elas entraram — a 0040 já explicou que procedência
-- responde "de quem eu recebi", não "quem produziu o dado lá atrás". O Polp
-- aqui é ENRIQUECIMENTO de linha existente, não uma nova ingestão. No dia em
-- que a conta passar a ser importada direto da API, as linhas novas nascem com
-- `source='polp'` e as antigas continuam dizendo a verdade sobre como entraram.
--
-- Não classifica, não mexe em categoria, não mexe em `transfer_status` e não
-- pareia transferência. Grava EVIDÊNCIA. Quem decide o que a evidência
-- significa é `scripts/reclassificar.mjs`, onde a decisão nasce com lote,
-- trilha e desfazer.
--
-- ATENÇÃO ao rodar o motor de regras depois deste backfill: 80 linhas passam a
-- ter o CNPJ da casa como documento (PIX recebido de conta própria), e a regra
-- `transferencia-cnpj-proprio` da 0042 vai reconhecê-las como transferência
-- entre contas próprias. Isso está certo e é o objetivo — mas move receita, e
-- por isso deve ser um lote consciente, não efeito colateral.
