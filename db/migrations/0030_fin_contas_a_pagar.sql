-- O compromisso a pagar passa a existir — e passa a ter dono, procedência e
-- chave.
--
-- O estado que esta migration atende: `fin_contract` tem 30 linhas e as 30 são
-- `direction = 'receber'` (27 assinaturas do Asaas + PIAU + 2 encerradas).
-- `fin_document` tem 3.350 linhas e ZERO com `direction = 'pagar'`. A camada L3
-- da previsão (lib/financeiro/forecast.ts) soma exatamente esse conjunto vazio,
-- então o saldo projetado de setembro a dezembro é a soma das entradas menos
-- nada. Não é uma previsão otimista: é um teto.
--
-- ---------------------------------------------------------------------------
-- O que esta migration NÃO faz, e por quê
-- ---------------------------------------------------------------------------
-- NÃO cria tabela nova, e não cria coluna de valor, de recorrência nem de
-- vencimento. Tudo isso já existe e já foi desenhado para os dois sentidos:
--
--   fin_contract.direction     CHECK ('receber', 'pagar')     — 0001, linha 308
--   fin_contract.kind          inclui 'despesa_recorrente'    — 0001, linha 309
--   fin_document.direction     CHECK ('receber', 'pagar')     — 0002
--   fin_document.status        inclui 'previsto'              — 0002
--   fin_document.flexibility   'fixo' | 'negociavel' | 'adiavel'
--
-- Um compromisso mensal de folha cabe inteiro nessas colunas. Criar uma
-- `fin_conta_a_pagar` paralela seria a mesma armadilha que 0002 evitou ao manter
-- a nota fiscal FORA de fin_document: duas tabelas para o mesmo conceito fazem
-- toda soma de dinheiro ter duas respostas.
--
-- ---------------------------------------------------------------------------
-- 1. Por que `person_id` em fin_contract
-- ---------------------------------------------------------------------------
-- Porque a folha é um compromisso com uma PESSOA, e 0012 já decidiu que pessoa
-- não é contraparte: "fin_counterparty responde 'para quem o dinheiro foi';
-- fin_person responde 'quem é do time'".
--
-- Sem esta coluna a única ligação possível seria pelo ponteiro de contraparte, e
-- ele não responde a pergunta que custa dinheiro. O caso concreto está na base
-- hoje: o ClickUp programa R$ 2.500/mês de setembro a dezembro para "Marcelo
-- Felipe Dias Lacerda", que é a pessoa 99 ("Felipe"), `status = 'inativo'` com
-- `end_date = 2026-08-01`. São R$ 10.000 de saída que a empresa não deve. Com
-- person_id, detectar isso é uma consulta:
--
--   SELECT c.name, c.amount_cents, p.end_date
--     FROM fin_contract c JOIN fin_person p ON p.id = c.person_id
--    WHERE c.direction = 'pagar' AND c.status = 'ativo'
--      AND p.status = 'inativo';
--
-- Sem ela, é uma varredura de nomes em texto livre — que é exatamente como o
-- erro "PAULO GABRIEL × Gabriel" de 0026 nasceu.
--
-- A coluna convive com `counterparty_id` sem redundância, e o precedente é
-- fin_installment_plan (0012), que carrega as duas pelo mesmo motivo: a pessoa
-- é COM QUEM é o compromisso, a contraparte é PARA ONDE o PIX sai. Não são a
-- mesma coisa quando um MEI recebe no CNPJ e no CPF (11 das 25 pessoas do
-- roster, medido em 0026).
--
-- ---------------------------------------------------------------------------
-- 2. Por que `source` / `source_id` em fin_contract
-- ---------------------------------------------------------------------------
-- Porque a tabela tem chave de idempotência para UM fornecedor de dado e nenhuma
-- para os outros: `asaas_subscription_id` com índice único parcial. Foi a
-- escolha certa em 0001, quando o Asaas era a única fonte. O segundo importador
-- chega agora, e sem chave estável ele só tem duas saídas — casar por nome (que
-- duplica no dia em que alguém corrige um acento) ou não ser idempotente (que
-- duplica sempre).
--
-- `(entity_id, source, source_id)` é exatamente a chave que fin_document usa
-- desde 0009 — que corrigiu a de 0002 justamente por não incluir a entidade:
-- "uma segunda conta Asaas (subconta) ou um adapter futuro que reuse id
-- colidiria com o histórico existente". Repetir a forma conhecida é deliberado:
-- quem souber ler a idempotência de um lado lê a do outro sem aprender nada
-- novo, e o ON CONFLICT tem a mesma cara nos dois importadores.
--
-- `source` fica sem CHECK, ao contrário de fin_document.source. O motivo é o
-- preço que esta própria migration está pagando na seção 3: cada integração nova
-- vira uma migration para acrescentar uma string a uma lista. Em fin_document a
-- lista fechada se justifica — é o núcleo do ledger e o valor governa
-- comportamento de sync. Aqui a coluna é procedência, e o precedente já existe
-- em fin_person_compensation.source (0026), que é texto livre pela mesma razão.
--
-- ---------------------------------------------------------------------------
-- 3. Por que 'clickup' entra no CHECK de fin_document.source
-- ---------------------------------------------------------------------------
-- Porque a alternativa é mentir na coluna de procedência. Os 12 pagáveis futuros
-- que o importador cria vêm de tarefas do ClickUp e a chave de idempotência
-- deles é o id da tarefa. Gravá-los como 'folha' ou 'manual' colocaria um id do
-- ClickUp no espaço de nomes de outra fonte: no dia em que existir um importador
-- de folha de verdade, os dois disputam a mesma chave em
-- `fin_document_source_idx` e a colisão aparece como pagamento sumido.
--
-- Com o valor próprio, "o que veio do ClickUp" é `WHERE source = 'clickup'` — e
-- essa é a consulta da conciliação futura, quando o extrato do Nubank trouxer o
-- PIX que liquida cada uma dessas linhas.
--
-- ---------------------------------------------------------------------------
-- 4. O que esta migration NÃO grava
-- ---------------------------------------------------------------------------
-- Nenhuma linha de dado. Os contratos e os documentos são escritos por
-- `scripts/import-clickup-compromissos.mjs`, que lê o JSON, resolve pessoa e
-- contraparte com score e é idempotente pelas chaves criadas aqui. Semear dado
-- de origem externa em migration (como 0011 fez com a PIAU) só se justifica
-- quando nenhuma API informa o dado; aqui a fonte existe em arquivo e vai ser
-- relida.
--
-- ---------------------------------------------------------------------------
-- AVISO PARA QUEM FOR MEXER NA CAMADA L2 DA PREVISÃO
-- ---------------------------------------------------------------------------
-- As cinco consultas que hoje leem fin_contract (forecast.ts:216, painel.ts:469,
-- queries.ts:219, indicadores.ts:208 e o MRR de receitas.ts) filtram
-- `direction = 'receber'`. É por isso que acrescentar contratos 'pagar' não
-- muda nenhum número sozinho — quem muda a previsão são os fin_document que o
-- importador materializa a partir deles, lidos pela L3.
--
-- Tirar o filtro de direção de qualquer uma dessas consultas para "somar também
-- a despesa" CONTA O MESMO DINHEIRO DUAS VEZES: uma pelo contrato em L2, outra
-- pelo documento em L3. Se um dia a L2 precisar do lado da despesa, o caminho é
-- somar contratos 'pagar' que NÃO tenham documento materializado no mês.

-- ---------------------------------------------------------------------------
-- 1. fin_contract: com quem é o compromisso
-- ---------------------------------------------------------------------------
ALTER TABLE fin_contract
  ADD COLUMN IF NOT EXISTS person_id bigint REFERENCES fin_person(id);

COMMENT ON COLUMN fin_contract.person_id IS
  'A pessoa do time com quem este compromisso existe, quando existe uma. NULL em '
  'contrato de cliente ou de fornecedor — que é a maioria. Não substitui '
  'counterparty_id: a pessoa é COM QUEM o compromisso é, a contraparte é PARA ONDE '
  'o dinheiro sai, e um MEI recebe em duas (CNPJ e CPF). Existe para que '
  '"compromisso programado para quem já saiu" seja uma consulta com JOIN em '
  'fin_person.status, e não uma comparação de nomes em texto livre.';

CREATE INDEX IF NOT EXISTS fin_contract_person_idx
  ON fin_contract (person_id) WHERE person_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. fin_contract: de onde veio, e com que chave voltar
-- ---------------------------------------------------------------------------
ALTER TABLE fin_contract ADD COLUMN IF NOT EXISTS source    text;
ALTER TABLE fin_contract ADD COLUMN IF NOT EXISTS source_id text;

COMMENT ON COLUMN fin_contract.source IS
  'Procedência da linha: qual importador ou qual arquivo a criou (''clickup'', '
  '''planilha:...'', ''ui''). Sem CHECK de propósito — é texto de procedência, e '
  'uma lista fechada obrigaria a uma migration por integração nova. Mesmo critério '
  'de fin_person_compensation.source (0026).';

COMMENT ON COLUMN fin_contract.source_id IS
  'Identificador do compromisso NA FONTE (id da tarefa do ClickUp, id da linha da '
  'planilha). É a chave de idempotência do importador, e generaliza o que '
  'asaas_subscription_id faz para um fornecedor só: sem ela, reimportar duplica ou '
  'obriga a casar por nome, que duplica no dia em que alguém corrigir um acento.';

-- Índice único parcial, idêntico em forma ao fin_document_source_idx que 0009
-- deixou: só vale para quem tem chave de fonte, e contrato criado pela tela
-- continua podendo repetir nome à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS fin_contract_source_idx
  ON fin_contract (entity_id, source, source_id) WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. fin_document: 'clickup' é uma procedência legítima
-- ---------------------------------------------------------------------------
-- Só acrescenta um valor ao domínio; nenhuma linha existente muda de estado, e
-- as 3.350 atuais continuam válidas contra o CHECK novo.
ALTER TABLE fin_document DROP CONSTRAINT IF EXISTS fin_document_source_check;
ALTER TABLE fin_document ADD CONSTRAINT fin_document_source_check
  CHECK (source IN (
    'asaas',       -- API do gateway
    'import_csv',  -- extrato colado
    'import_ofx',
    'manual',      -- criado na tela (contas.ts)
    'contrato',    -- materializado a partir de fin_contract
    'folha',       -- fechamento de folha
    'reembolso',   -- aprovação de reembolso (0012)
    'implicito',   -- deduzido de um lançamento sem documento
    'clickup'      -- tarefa da lista "Fluxo de caixa" do espaço Obras
  ));
