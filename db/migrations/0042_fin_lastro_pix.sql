-- O lastro do PIX passa a ser guardado, e o CNPJ da casa vira regra.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA SENDO JOGADO FORA
-- ---------------------------------------------------------------------------
-- `data/raw/inter-extrato.json` traz, em `detalhes`, o documento das duas
-- pontas (`cpfCnpjPagador`, `cpfCnpjRecebedor`) e o identificador de ponta a
-- ponta do PIX (`endToEndId`). Medido no arquivo de 15/08/2026, sobre 671
-- transações: 585 têm documento da contraparte (87,2%) e as mesmas 585 têm
-- endToEndId — 585 valores DISTINTOS, nenhum repetido.
--
-- O importador lia esses campos, usava para escolher o nome da contraparte e
-- descartava o resto. O ledger ficava com `counterparty_raw` — texto — e com um
-- vínculo para `fin_counterparty` que fora resolvido por nome normalizado. O
-- documento, que é a única chave que não muda de grafia, não sobrevivia à
-- importação.
--
-- Isso custa em três lugares:
--
--   · a transferência entre contas próprias só é reconhecida por HEURÍSTICA DE
--     NOME ("xp energy", "xpe tecnologia", "xpe consultoria" na descrição —
--     regras 18 e 32). Nome é o que a outra ponta digitou; documento é o que o
--     Banco Central carimbou;
--   · o casamento fornecedor ↔ CNPJ (E2) não tem por onde começar;
--   · o pareamento das duas pernas de uma transferência depende de coincidência
--     de valor e data — que foi exatamente como os 2 pareamentos falsos da A6
--     nasceram. `endToEndId` é a chave determinística que resolve isso: as duas
--     pernas do mesmo PIX carregam o MESMO identificador.
--
-- Esta migration só abre o lugar e declara a regra. Quem preenche as colunas é
-- `scripts/backfill-inter-lastro.mjs` (histórico) e `scripts/import-inter.mjs`
-- (daqui para frente). Quem aplica a regra é `scripts/reclassificar.mjs`.

-- ---------------------------------------------------------------------------
-- 1. AS COLUNAS DE LASTRO
-- ---------------------------------------------------------------------------
-- Ficam em `fin_transaction`, e não só em `fin_counterparty`, porque são coisas
-- diferentes: `fin_counterparty.document_number` é o CADASTRO (editável, e uma
-- correção manual deve vencer), enquanto estas colunas são o que a FONTE disse
-- naquela transação específica. Guardar as duas é o que permite, um dia,
-- perguntar "o cadastro ainda bate com o extrato?" — pergunta que hoje não tem
-- como ser feita, porque um dos lados não existe.
--
-- Medido antes de escrever: nas 504 linhas do Inter que já têm contraparte
-- cadastrada COM documento, o documento do cadastro é igual ao documento do
-- arquivo bruto em 504 de 504. Zero divergência. As colunas nascem, portanto,
-- confirmando o cadastro — não brigando com ele.
ALTER TABLE fin_transaction
  ADD COLUMN IF NOT EXISTS counterparty_document      text,
  ADD COLUMN IF NOT EXISTS counterparty_document_type text,
  ADD COLUMN IF NOT EXISTS end_to_end_id              text;

-- Só dígitos, e só os dois comprimentos que existem no Brasil. Sem isto, um
-- documento com pontuação ("34.776.108/0001-92") nunca casaria com o mesmo
-- documento sem pontuação, e a regra do CNPJ próprio — que compara por
-- igualdade exata — falharia em silêncio na metade das linhas.
ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_counterparty_document_check;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_counterparty_document_check
  CHECK (counterparty_document IS NULL OR counterparty_document ~ '^[0-9]{11}$|^[0-9]{14}$');

-- Espelha o CHECK de fin_counterparty.document_type: os dois lados têm de falar
-- o mesmo vocabulário para que comparar cadastro com lastro seja possível.
ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_counterparty_document_type_check;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_counterparty_document_type_check
  CHECK (counterparty_document_type IS NULL OR counterparty_document_type IN ('cnpj', 'cpf'));

-- O tipo não pode contradizer o número: 11 dígitos é CPF, 14 é CNPJ. É esta
-- linha que separa custo com pessoa física de custo com empresa sem depender de
-- ninguém marcar à mão — e a que impede o par (cpf, 14 dígitos) de existir.
ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_documento_coerente;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_documento_coerente
  CHECK (
    counterparty_document IS NULL
    OR counterparty_document_type IS NULL
    OR (counterparty_document_type = 'cpf'  AND length(counterparty_document) = 11)
    OR (counterparty_document_type = 'cnpj' AND length(counterparty_document) = 14)
  );

COMMENT ON COLUMN fin_transaction.counterparty_document IS
  'Documento da OUTRA ponta, como veio da fonte, só dígitos. Quando é igual a '
  'fin_entity.cnpj, a "outra ponta" é a própria empresa — e o lançamento é '
  'transferência entre contas próprias (regra transferencia-cnpj-proprio). '
  'NUNCA preencher com o documento do PAGADOR em boleto: ali o pagador somos '
  'nós, e foi assim que 31 boletos (R$ 28.263,64) quase viraram transferência.';

COMMENT ON COLUMN fin_transaction.end_to_end_id IS
  'Identificador de ponta a ponta do PIX (EXXXXXXXXAAAAMMDDHHMM…). É o MESMO '
  'nas duas pernas de uma transferência entre contas próprias — por isso o '
  'índice não é único: unicidade aqui impediria justamente o caso que ele '
  'existe para resolver.';

-- ---------------------------------------------------------------------------
-- 2. ÍNDICES
-- ---------------------------------------------------------------------------
-- Parcial em ambos: hoje 585 linhas de 13.845 têm o dado (4,2%). Um índice
-- cheio seria quase todo NULL.
CREATE INDEX IF NOT EXISTS fin_transaction_counterparty_document_idx
  ON fin_transaction (entity_id, counterparty_document)
  WHERE counterparty_document IS NOT NULL;

-- NÃO é único, e isso é deliberado — ver o COMMENT acima. As duas pernas do
-- mesmo PIX (a saída no Inter e a entrada na conta de destino) compartilham o
-- endToEndId, e é essa repetição que torna o pareamento determinístico.
CREATE INDEX IF NOT EXISTS fin_transaction_end_to_end_idx
  ON fin_transaction (end_to_end_id)
  WHERE end_to_end_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. A REGRA DO CNPJ DA CASA
-- ---------------------------------------------------------------------------
-- Determinística: compara documento com documento. Substitui, ONDE HÁ
-- DOCUMENTO, a heurística de nome das regras 18 e 32.
--
-- ATENÇÃO — as regras 18 e 32 NÃO são arquivadas, e isso não é esquecimento.
-- Medido: elas classificam hoje 306 lançamentos, R$ 3.578.035,52, e TODOS estão
-- no Asaas (280) e no Nubank (26). Nenhuma dessas duas fontes entrega documento
-- da contraparte — o extrato do Asaas não tem, e o CSV do Nubank também não.
-- Arquivar as regras de nome hoje devolveria R$ 3,58 milhões de transferência
-- entre contas próprias para dentro de receita e despesa. Elas saem quando a
-- A4 trocar a fonte do Nubank para o Polp (que traz CNPJ em 89%) e quando o
-- Asaas tiver documento — não antes.
--
-- A prioridade 0 coloca esta regra ACIMA da 18 (prioridade 1): onde o documento
-- existe, ele decide; onde não existe, o nome continua valendo como estava.
-- Prova de que a troca é segura no Inter: das 671 transações do arquivo bruto,
-- as que casam por NOME e as que casam por DOCUMENTO são exatamente as mesmas
-- 81. Concordância total — a regra determinística reproduz a heurística e não
-- inaugura classificação nova.
--
-- O valor comparado vem de `fin_entity.cnpj`, não de um literal digitado aqui.
-- O DSL não sabe referenciar outra tabela em tempo de avaliação, então o CNPJ
-- precisa estar dentro do JSON — mas quem o escreve é o banco, a partir da
-- entidade. Um literal digitado à mão poderia divergir do cadastro sem que nada
-- acusasse.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, notes, created_by)
SELECT e.id,
       'transferencia-cnpj-proprio',
       'Transferência entre contas próprias (CNPJ da casa)',
       0,
       'transaction',
       jsonb_build_object(
         'all', jsonb_build_array(
           jsonb_build_object('op', 'equals', 'field', 'counterparty_document', 'value', e.cnpj)
         )
       ),
       -- `transfer: true` promove 'nao' → 'em_transito'; nunca rebaixa
       -- 'pareado' (reclassificar.mjs:315). 9.01 é 'Transferência entre contas
       -- próprias': kind 'movimentacao_financeira', toc_class 'neutro',
       -- cash_flow_group 'movimentacao' — neutra na DRE, como tem de ser.
       '{"transfer": true, "category_code": "9.01"}'::jsonb,
       100,
       'seed',
       'ativa',
       'A3 do backlog. Documento vence nome. NÃO casa em boleto: ali `cpfCnpj` é '
         || 'o do pagador (nós), e por isso o importador e o backfill deixam '
         || 'counterparty_document NULO em tipoTransacao=PAGAMENTO. Se algum dia '
         || 'alguém preencher esse campo em boleto, 31 lançamentos (R$ 28.263,64) '
         || 'viram transferência de mentira.',
       'migration-0042'
  FROM fin_entity e
 WHERE e.slug = 'xpe'
   AND e.cnpj IS NOT NULL
ON CONFLICT (entity_id, slug) DO NOTHING;

-- Trava de sanidade: uma regra de prioridade 0 comparando por igualdade com um
-- CNPJ vazio casaria com toda linha cujo documento é nulo — ou seja, com o
-- ledger inteiro. Melhor a migration falhar aqui do que a empresa descobrir
-- depois que a receita virou transferência.
DO $$
DECLARE
  v_valor text;
BEGIN
  SELECT r.conditions -> 'all' -> 0 ->> 'value'
    INTO v_valor
    FROM fin_rule r
    JOIN fin_entity e ON e.id = r.entity_id
   WHERE e.slug = 'xpe' AND r.slug = 'transferencia-cnpj-proprio';

  IF v_valor IS NULL OR v_valor !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'regra transferencia-cnpj-proprio nasceu com CNPJ inválido (%). Abortado.', COALESCE(v_valor, '<nulo>');
  END IF;
END $$;
