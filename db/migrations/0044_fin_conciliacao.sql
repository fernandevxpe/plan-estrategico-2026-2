-- Conciliação: desfaz os dois pares falsos, nomeia o estorno e o vazio, e fecha
-- a porta por onde os dois entraram.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECEU
-- ---------------------------------------------------------------------------
-- Em 11/08/2026, dois processos rodaram com nove minutos de diferença:
--
--   19:48  qualificar-cli      marcou 2 PIX enviados do Inter como 9.01
--                              ("transferência entre contas próprias"), com a
--                              evidência "espelho exato em asaas com N dia(s)
--                              de diferença — é o dinheiro mudando de conta,
--                              não receita", confiança 0.8
--   19:57  parear-remessas-internas  encontrou o tal espelho e pareou
--
-- A evidência dos dois passos é a MESMA: existe, em outra conta, um lançamento
-- de valor igual e sinal oposto a poucos dias. Isso não é evidência de nada. Um
-- ledger com 13.845 linhas produz coincidências de valor+data o tempo todo — e
-- foi exatamente isso que aconteceu duas vezes.
--
-- O que os pares realmente uniram, medido contra o extrato PIX do Banco Central
-- (data/raw/inter-extrato.json, campo detalhes.cpfCnpjRecebedor):
--
--   grupo 107fe85c…  #1162  asaas  2026-04-23  +R$   400,00
--                           "Cobrança recebida - fatura nr. 764532782
--                            ARLINDO DA FONSECA LINS & CIA LTDA. Nota fiscal nr. 247"
--                           → cliente, CNPJ 11601184000242, receita 3.01
--                    #76675 inter  2026-04-24  −R$   400,00
--                           "Pix enviado — Recifemecatron"
--                           → cpfCnpjPagador   34776108000192  (a casa)
--                             cpfCnpjRecebedor 20169634000180  (fornecedor)
--
--   grupo fb672f75…  #696   asaas  2026-06-10  +R$ 2.600,00
--                           "Cobrança recebida - fatura nr. 739106316
--                            CONDOMINIO DO EDIFICIO ARA PACIS"
--                           → cliente, CNPJ 02923871000102, receita 3.03
--                    #76826 inter  2026-06-12  −R$ 2.600,00
--                           "Pix enviado — Maria De Fatima Gondim Carvalho"
--                           → cpfCnpjPagador   34776108000192  (a casa)
--                             cpfCnpjRecebedor 03215011441     (fornecedora, CPF)
--
-- Numa transferência entre contas próprias, pagador E recebedor têm o CNPJ da
-- casa. Aqui o recebedor é um terceiro nos dois casos. Não são transferências:
-- são um recebimento de cliente e um pagamento a fornecedor, cada um seu fato.
--
-- O efeito de tê-los pareado é o pior modo de falha deste módulo, porque é
-- silencioso: toda agregação filtra `transfer_status <> 'pareado'`, então
-- R$ 3.000 de receita real e R$ 3.000 de despesa real simplesmente sumiram do
-- resultado. Nenhuma tela mostra isso como erro — mostra como ausência.
--
-- ---------------------------------------------------------------------------
-- COMO OS DOIS FORAM ENCONTRADOS, E POR QUE SÓ ELES
-- ---------------------------------------------------------------------------
-- Sinal: grupo de transferência cujas duas pernas apontam para contrapartes
-- diferentes. Varrido sobre os 145 grupos existentes, devolve 2 — estes. A
-- varredura mais larga ("alguma perna aponta para terceiro identificado com
-- documento diferente do CNPJ da casa") devolve os mesmos 2. Os 145 grupos
-- satisfazem os invariantes estruturais (2 pernas, 2 contas, soma zero).
--
-- Fica de fora, de propósito, um terceiro grupo que merece olho humano e NÃO é
-- desfeito aqui — ver a seção INDETERMINADO no fim.

-- ---------------------------------------------------------------------------
-- 1. DESFAZER OS DOIS PARES FALSOS
-- ---------------------------------------------------------------------------
-- Reversível e comprovado. O estado anterior não é suposição:
--
--   · as pernas do Inter (#76675, #76826) eram 'nao' porque o WHERE do
--     parear-remessas-internas.mjs só aceita `t.transfer_status = 'nao'`;
--   · as pernas do Asaas (#1162, #696) eram 'nao' porque, das 3.048 linhas
--     PAYMENT_RECEIVED do Asaas, 3.046 estão em 'nao' e as 2 em 'pareado' são
--     exatamente estas duas.
--
-- Ninguém travou nada à mão: human_locked_fields = '{}' nas quatro linhas.

INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT t.entity_id, 'fin_transaction', t.id, 'rollback',
       jsonb_build_object('transfer_status', t.transfer_status,
                          'transfer_group_id', t.transfer_group_id,
                          'category_id', t.category_id,
                          'review_status', t.review_status),
       jsonb_build_object('transfer_status', 'nao',
                          'transfer_group_id', NULL,
                          'motivo', 'par falso: contrapartes sem relação, casadas por coincidência de valor+data',
                          'prova', 'detalhes.cpfCnpjRecebedor do extrato PIX difere do CNPJ da casa'),
       ARRAY['transfer_status', 'transfer_group_id'], 'migration-0044'
  FROM fin_transaction t
 WHERE t.id IN (1162, 76675, 696, 76826);

UPDATE fin_transaction
   SET transfer_status = 'nao', transfer_group_id = NULL, updated_at = now()
 WHERE id IN (1162, 76675, 696, 76826)
   AND transfer_status = 'pareado';

-- Trava: se o acervo não estiver no estado medido, a migration inteira volta
-- atrás em vez de "corrigir" alguma outra coisa por engano.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM fin_transaction
   WHERE id IN (1162, 76675, 696, 76826) AND transfer_status = 'nao' AND transfer_group_id IS NULL;
  IF n <> 4 THEN
    RAISE EXCEPTION '0044: esperava 4 pernas desfeitas, encontrei %. Acervo diferente do medido — abortando.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1b. A CATEGORIA QUE CAUSOU O PAREAMENTO TAMBÉM ESTÁ ERRADA
-- ---------------------------------------------------------------------------
-- Desfazer só o par deixaria os dois PIX do Inter com categoria 9.01
-- ("transferência entre contas próprias"). Seria meia correção: a DRE agrupa
-- por categoria também, e 9.01 é `cash_flow_group='movimentacao'` — a despesa
-- continuaria fora do resultado, agora sem nem o par para explicar por quê.
--
-- O extrato do Banco Central prova que 9.01 é falso: cpfCnpjRecebedor é
-- 20169634000180 e 03215011441, nenhum deles a casa.
--
-- Qual é a categoria CERTA, não sabemos. Recifemecatron e Maria De Fátima estão
-- cadastrados como 'fornecedor' e não têm categoria padrão. Inventar uma seria
-- repetir o erro que esta migration existe para desfazer, então as duas linhas
-- vão para a fila de revisão com categoria NULA — um vazio declarado, que é o
-- que de fato temos. Ver INDETERMINADO (a).
--
-- As pernas do Asaas (#1162 3.01, #696 3.03) mantêm a categoria: elas sempre
-- estiveram certas; o que estava errado era só o par que as anulava.

UPDATE fin_transaction
   SET category_id = NULL, review_status = 'pendente', updated_at = now()
 WHERE id IN (76675, 76826)
   AND category_id = (SELECT id FROM fin_category WHERE code = '9.01');

-- ---------------------------------------------------------------------------
-- 2. ESTORNO É ANULAÇÃO, NÃO TRANSFERÊNCIA
-- ---------------------------------------------------------------------------
-- Um PIX que falhou aparece como saída seguida de "Estorno de transação via
-- Pix" na MESMA conta, mesmo dia, mesmo valor. O dinheiro nunca saiu do banco.
-- Não existe perna do outro lado para achar — e enquanto essa saída ficar em
-- 'em_transito' ela mente duas vezes: promete um par que não existe e ocupa o
-- indicador como se fosse trabalho pendente.
--
-- Isso não cabe em transfer_group_id: as duas pernas de uma anulação estão na
-- MESMA conta, e o índice único (transfer_group_id, account_id) da 0024 recusa
-- — corretamente, porque um grupo de transferência com duas pernas na mesma
-- conta é sempre erro. Anulação precisa de vocabulário próprio.

ALTER TABLE fin_transaction
  DROP CONSTRAINT IF EXISTS fin_transaction_transfer_status_check;
ALTER TABLE fin_transaction
  ADD CONSTRAINT fin_transaction_transfer_status_check
  CHECK (transfer_status = ANY (ARRAY['nao', 'em_transito', 'pareado', 'anulado']));

ALTER TABLE fin_transaction ADD COLUMN IF NOT EXISTS reversal_group_id text;

COMMENT ON COLUMN fin_transaction.reversal_group_id IS
  'Liga a saída ao seu estorno na MESMA conta. Simétrico a transfer_group_id, e deliberadamente separado dele: transferência tem 2 contas, anulação tem 1.';

-- Espelha a 0024: grupo e status são a mesma decisão, nos dois sentidos.
DO $$
BEGIN
  ALTER TABLE fin_transaction
    ADD CONSTRAINT fin_transaction_reversal_group_completo
    CHECK ((reversal_group_id IS NULL) = (transfer_status <> 'anulado'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'fin_transaction_reversal_group_completo já existe';
END $$;

-- Uma anulação tem exatamente duas pernas, e as duas na mesma conta. O índice
-- único de transferência garante "uma perna por conta"; aqui é o oposto, então
-- a checagem entre linhas fica na asserção de acervo (fim do arquivo) e na
-- transação do motor, como a 0024 decidiu para o caso equivalente.
CREATE INDEX IF NOT EXISTS fin_transaction_reversal_idx
  ON fin_transaction (reversal_group_id) WHERE reversal_group_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- 2a. As anulações inequívocas — uma saída, um estorno
-- --------------------------------------------------------------------------
-- Medido: 6 pernas em trânsito têm estorno gêmeo (R$ 42.860,00). Delas, duas
-- são 1-para-1 e não deixam dúvida nenhuma:
--
--   #3717 asaas 2025-07-04 −R$    10,00  ↔  #3716 estorno
--   #1364 asaas 2026-04-02 −R$ 2.250,00  ↔  #1363 estorno
--
-- O #1364 é uma das 13 transferências de 2026 que se esperava parear. Ele nunca
-- teve par: a operação foi anulada no mesmo dia. (No dia anterior há um
-- recebimento de cliente de R$ 2.250,00 — #1374, Condomínio Villa Ca… — que é
-- precisamente o tipo de coincidência que produziu os dois pares falsos da
-- seção 1. Não tem relação com este estorno.)

INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT t.entity_id, 'fin_transaction', t.id, 'update',
       jsonb_build_object('transfer_status', t.transfer_status, 'reversal_group_id', t.reversal_group_id),
       jsonb_build_object('transfer_status', 'anulado',
                          'motivo', 'saída estornada na própria conta, mesmo dia e valor — o dinheiro nunca saiu'),
       ARRAY['transfer_status', 'reversal_group_id'], 'migration-0044'
  FROM fin_transaction t WHERE t.id IN (3717, 3716, 1364, 1363);

UPDATE fin_transaction SET transfer_status = 'anulado', reversal_group_id = 'rv:3716-3717', updated_at = now()
 WHERE id IN (3717, 3716);
UPDATE fin_transaction SET transfer_status = 'anulado', reversal_group_id = 'rv:1363-1364', updated_at = now()
 WHERE id IN (1363, 1364);

-- --------------------------------------------------------------------------
-- 2b. O nó de 2025-05-19 — duas saídas idênticas, um estorno só
-- --------------------------------------------------------------------------
--   #4071 asaas 2025-05-19 −R$ 10.000,00
--   #4073 asaas 2025-05-19 −R$ 10.000,00   (idêntica a #4071 em todo campo)
--   #4072 asaas 2025-05-19 +R$ 10.000,00   estorno
--
-- Uma das duas voltou; a outra saiu de fato. Qual delas é indecidível — as duas
-- linhas são indistinguíveis em conta, data, valor e descrição, e o id é ordem
-- de importação, não cronologia.
--
-- Indecidível, porém, não é o mesmo que consequente: como as duas são iguais em
-- todo campo observável, QUALQUER atribuição produz exatamente o mesmo saldo,
-- a mesma DRE e o mesmo total por categoria. O que muda é só qual id carrega
-- qual rótulo. Por isso aqui a escolha é declarada e determinística (o menor id
-- é o anulado) em vez de deixada em aberto — deixar as duas em 'em_transito'
-- afirmaria que existem R$ 20.000 esperando par, e isso é falso: R$ 10.000
-- nunca saíram.
--
-- A outra perna fica em 'em_transito' e recebe, na seção 3, o motivo
-- 'sem_cobertura_extrato': ela é de 2025, quando Inter e Nubank ainda não
-- existem no ledger.

INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
SELECT t.entity_id, 'fin_transaction', t.id, 'update',
       jsonb_build_object('transfer_status', t.transfer_status),
       jsonb_build_object('transfer_status', 'anulado',
                          'motivo', 'estorno de 2025-05-19: das duas saídas idênticas, uma voltou',
                          'escolha', 'arbitrária entre linhas indistinguíveis, observacionalmente equivalente'),
       ARRAY['transfer_status', 'reversal_group_id'], 'migration-0044'
  FROM fin_transaction t WHERE t.id IN (4071, 4072);

UPDATE fin_transaction SET transfer_status = 'anulado', reversal_group_id = 'rv:4071-4072', updated_at = now()
 WHERE id IN (4071, 4072);

-- O nó equivalente de 2026-05-11 (#992/#994 + estorno #993 + crédito de
-- R$ 10.300 no Inter #76733) NÃO é resolvido aqui. Ele é diferente: além da
-- anulação existe uma transferência de verdade a parear do outro lado, e as
-- duas decisões têm de ser tomadas juntas, na mesma transação, com âncora de
-- saldo. Isso é trabalho do motor — ver scripts/parear-transferencias.mjs.

-- ---------------------------------------------------------------------------
-- 3. O VAZIO TEM NOME: 'sem_cobertura_extrato'
-- ---------------------------------------------------------------------------
-- 169 pernas em 'em_transito' (R$ 2.234.777,97) são anteriores a 2026-01-01.
-- Todas são TRANSFER do Asaas, de 2022 a 2025.
--
-- Elas não estão em trânsito por falha de pareamento. Estão porque a contra-perna
-- não existe e não pode existir: medido, há ZERO linhas em qualquer conta que
-- não a Asaas antes de 2026-01-01. Inter começa em 2026-01-01, Nubank em
-- 2026-01-02. Procurar par para elas é procurar uma linha que o ledger não tem.
--
-- POR QUE ISSO NÃO VIRA UM STATUS NOVO
--
-- O indicador "transferência resolvida" do painel é
-- `count(*) FILTER (WHERE transfer_status <> 'em_transito') / count(*)`.
-- Qualquer valor novo de transfer_status conta como resolvido. Mover as 169
-- para um status 'sem_cobertura' levaria o indicador de 98,0% para 99,2% sem
-- que um único fato tivesse sido estabelecido. Seria inflar o número mudando o
-- rótulo, que é a versão elegante de esconder.
--
-- Então elas CONTINUAM em 'em_transito' e continuam pesando no indicador. O que
-- muda é que param de ser anônimas: ganham o motivo, e o painel pode separar
-- "em trânsito acionável" (o que dá para trabalhar) de "sem cobertura de
-- extrato" (o que só se resolve importando 2022–2025, ou nunca). O número não
-- melhora; a leitura dele melhora.

ALTER TABLE fin_transaction ADD COLUMN IF NOT EXISTS transfer_unresolved_reason text;

COMMENT ON COLUMN fin_transaction.transfer_unresolved_reason IS
  'Por que esta perna em trânsito não tem par. NÃO a tira de em_transito: nomear o vazio não é preenchê-lo.';

DO $$
BEGIN
  ALTER TABLE fin_transaction
    ADD CONSTRAINT fin_transaction_unresolved_so_em_transito
    CHECK (transfer_unresolved_reason IS NULL OR transfer_status = 'em_transito');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'fin_transaction_unresolved_so_em_transito já existe';
END $$;

-- O motivo é uma explicação para a espera, não uma sentença.
--
-- Sem isto, a CHECK acima vira armadilha: no dia em que os extratos de
-- 2022–2025 forem importados, o motor tentaria parear uma dessas 167 pernas e
-- levaria uma violação de constraint no rosto — porque o motivo continuaria
-- preenchido enquanto o status saía de 'em_transito'. O conserto certo não é
-- pedir que todo processo lembre de limpar a coluna; é a coluna se limpar
-- sozinha quando deixa de fazer sentido. Invariante mantido por construção,
-- não por disciplina de quem escreve o próximo script.
CREATE OR REPLACE FUNCTION fin_limpa_motivo_ao_resolver() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transfer_status <> 'em_transito' THEN
    NEW.transfer_unresolved_reason := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_limpa_motivo ON fin_transaction;
CREATE TRIGGER fin_transaction_limpa_motivo
  BEFORE UPDATE OF transfer_status ON fin_transaction
  FOR EACH ROW
  WHEN (NEW.transfer_status <> 'em_transito' AND OLD.transfer_unresolved_reason IS NOT NULL)
  EXECUTE FUNCTION fin_limpa_motivo_ao_resolver();

-- A condição é medida, não decorada: só recebe o motivo quem é anterior à
-- primeira linha de TODA outra conta da mesma entidade. Se um dia o histórico
-- de 2022–2025 for importado, esta mesma consulta deixa de marcar as linhas
-- recém-cobertas, e o motor volta a ter o que procurar.
UPDATE fin_transaction t
   SET transfer_unresolved_reason = 'sem_cobertura_extrato', updated_at = now()
 WHERE t.transfer_status = 'em_transito'
   AND t.transfer_unresolved_reason IS NULL
   AND t.posted_on < (
     SELECT min(o.posted_on) FROM fin_transaction o
      WHERE o.entity_id = t.entity_id AND o.account_id <> t.account_id
   );

-- --------------------------------------------------------------------------
-- 3b. A SÉTIMA CONTA — R$ 25.400,00 saindo para um extrato que não existe aqui
-- --------------------------------------------------------------------------
-- Cinco PIX do Inter em 2026 ficam em trânsito sem contra-perna possível, e o
-- extrato do Banco Central diz exatamente por quê. Nos cinco:
--
--   nomeRecebedor      Xpe Tecnologia
--   cpfCnpjRecebedor   34776108000192      ← o CNPJ da casa
--   nomeEmpresaRecebedor  CAIXA ECONOMICA FEDERAL
--   contaBancariaRecebedor 12920000005783083433   ← a MESMA conta nas cinco
--
--   #76377 2026-01-04 −R$   650,00
--   #76521 2026-03-02 −R$ 6.000,00
--   #76641 2026-04-07 −R$ 6.150,00
--   #76097 2026-07-02 −R$ 6.300,00
--   #76180 2026-08-04 −R$ 6.300,00
--
-- São transferências entre contas próprias legítimas — para uma conta da Caixa
-- Econômica que o ledger não tem. Não são erro de pareamento: são cobertura que
-- falta. `caixa-aplicacao` e `caixa-emprestimo` existem com ZERO lançamentos e
-- não são esta conta; são rótulos sem extrato por trás.
--
-- Esta migration NÃO cria a conta: criar conta sem extrato e sem saldo de
-- abertura é exatamente o tipo de número inventado que o princípio proíbe.
-- Ela só nomeia o vazio, para que R$ 25.400,00 parem de parecer pareamento
-- pendente e passem a parecer o que são: um extrato que ninguém importou.

UPDATE fin_transaction
   SET transfer_unresolved_reason = 'destino_fora_do_ledger:caixa-economica-12920000005783083433',
       updated_at = now()
 WHERE id IN (76377, 76521, 76641, 76097, 76180)
   AND transfer_status = 'em_transito';

-- ---------------------------------------------------------------------------
-- 4. A PORTA QUE OS DOIS PARES FALSOS ATRAVESSARAM, FECHADA
-- ---------------------------------------------------------------------------
-- A 0024 já impôs "uma perna por conta" e "grupo ⇔ pareado", e deixou explícito
-- que invariantes ENTRE LINHAS ficariam fora por custo: um gatilho rodaria em
-- todo UPDATE de fin_transaction para proteger contra um caso de autor único.
--
-- Esse cálculo mudou. O caso deixou de ser hipotético — aconteceu duas vezes,
-- por dois processos diferentes, e custou R$ 6.000 de resultado invisível. E o
-- custo do gatilho é menor do que a 0024 supunha, por duas razões: ele é
-- CONSTRAINT TRIGGER DEFERRABLE (roda uma vez no COMMIT, não a cada linha) e
-- tem cláusula WHEN, então só acorda quando transfer_group_id é preenchido.
-- Um UPDATE que não mexe em pareamento não paga nada.
--
-- A REGRA: duas pernas da mesma transferência não podem apontar para
-- contrapartes que se contradizem.
--
--   (i)  dois documentos diferentes, um em cada perna → impossível;
--   (ii) qualquer perna cujo contraparte seja cliente ou fornecedor com
--        documento diferente do CNPJ da casa → não é movimento entre contas
--        próprias, é fato com terceiro.
--
-- Contraparte nula NÃO bloqueia: 143 dos 145 grupos legítimos têm as duas
-- pernas sem contraparte identificada (a identificação está em 25,8%), e uma
-- regra que exigisse contraparte preencheria de falso-negativo o que hoje
-- funciona. A regra só age quando há evidência POSITIVA de contradição.
--
-- 'socio' e 'colaborador' ficam FORA do veto de propósito — ver INDETERMINADO (b).

CREATE OR REPLACE FUNCTION fin_transfer_group_contrapartes_compativeis() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- Só NEW. A cláusula WHEN do gatilho garante NEW.transfer_group_id NOT NULL,
  -- e em INSERT o registro OLD não existe — lê-lo aqui derrubaria justamente o
  -- caminho mais comum, o de um par recém-criado.
  grupo text := NEW.transfer_group_id;
  casa  text;
  docs  int;
  culpado text;
BEGIN
  SELECT e.cnpj INTO casa FROM fin_entity e WHERE e.id = NEW.entity_id;

  -- (i) documentos que se contradizem entre as pernas
  SELECT count(DISTINCT cp.document_number) INTO docs
    FROM fin_transaction t
    JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE t.transfer_group_id = grupo AND cp.document_number IS NOT NULL;

  IF docs > 1 THEN
    RAISE EXCEPTION
      'transferência %: as duas pernas apontam para contrapartes diferentes. Valor e data iguais não são prova de que é o mesmo dinheiro.', grupo
      USING ERRCODE = 'check_violation';
  END IF;

  -- (ii) perna com terceiro identificado
  SELECT t.id || ' → ' || cp.name || ' (' || cp.kind || ' ' || cp.document_number || ')'
    INTO culpado
    FROM fin_transaction t
    JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE t.transfer_group_id = grupo
     AND cp.kind IN ('cliente', 'fornecedor')
     AND cp.document_number IS NOT NULL
     AND cp.document_number IS DISTINCT FROM casa
   LIMIT 1;

  IF culpado IS NOT NULL THEN
    RAISE EXCEPTION
      'transferência %: a perna % é movimento com terceiro, não entre contas próprias.', grupo, culpado
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_transfer_contraparte ON fin_transaction;
CREATE CONSTRAINT TRIGGER fin_transaction_transfer_contraparte
  AFTER INSERT OR UPDATE OF transfer_group_id, counterparty_id ON fin_transaction
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.transfer_group_id IS NOT NULL)
  EXECUTE FUNCTION fin_transfer_group_contrapartes_compativeis();

-- ---------------------------------------------------------------------------
-- 5. A CONSULTA QUE ENCONTROU OS DOIS, VIRADA EM VISTA
-- ---------------------------------------------------------------------------
-- O gatilho impede os que vierem. Esta vista é para os que já estão: qualquer
-- grupo em que valha a pena olhar duas vezes. Num acervo saudável ela volta
-- vazia — depois desta migration ela volta 1 linha, o grupo do sócio.
CREATE OR REPLACE VIEW fin_transferencia_suspeita AS
SELECT t.transfer_group_id AS grupo,
       count(*) AS pernas,
       max(t.posted_on) - min(t.posted_on) AS dias_entre_pernas,
       max(abs(t.amount_cents)) AS valor_cents,
       string_agg(DISTINCT COALESCE(cp.name, '(sem contraparte)'), ' | ') AS contrapartes,
       string_agg(t.id::text, ',' ORDER BY t.id) AS ids,
       CASE
         WHEN count(DISTINCT cp.document_number) > 1 THEN 'contrapartes divergentes'
         WHEN bool_or(cp.kind IN ('cliente', 'fornecedor')) THEN 'perna com terceiro'
         WHEN bool_or(cp.kind IN ('socio', 'colaborador')) THEN 'perna com pessoa ligada'
         ELSE 'distância entre as pernas'
       END AS motivo
  FROM fin_transaction t
  LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
 WHERE t.transfer_group_id IS NOT NULL
 GROUP BY t.transfer_group_id
HAVING count(DISTINCT cp.document_number) > 1
    OR bool_or(cp.kind IN ('cliente', 'fornecedor', 'socio', 'colaborador'))
    OR max(t.posted_on) - min(t.posted_on) > 3;

COMMENT ON VIEW fin_transferencia_suspeita IS
  'Grupos de transferência que pedem conferência humana. Vazia é o estado saudável.';

-- ---------------------------------------------------------------------------
-- 6. ASSERÇÕES DE ACERVO
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int; v bigint;
BEGIN
  -- Nenhum grupo sobrevivente com contrapartes divergentes.
  SELECT count(*) INTO n FROM (
    SELECT t.transfer_group_id FROM fin_transaction t
      JOIN fin_counterparty cp ON cp.id = t.counterparty_id
     WHERE t.transfer_group_id IS NOT NULL AND cp.document_number IS NOT NULL
     GROUP BY 1 HAVING count(DISTINCT cp.document_number) > 1) x;
  IF n <> 0 THEN RAISE EXCEPTION '0044: ainda há % grupo(s) com contrapartes divergentes', n; END IF;

  -- Invariantes de transferência da 0024, intactos.
  SELECT count(*) INTO n FROM (
    SELECT transfer_group_id FROM fin_transaction WHERE transfer_group_id IS NOT NULL
     GROUP BY 1 HAVING count(*) <> 2 OR count(DISTINCT account_id) <> 2 OR sum(amount_cents) <> 0) x;
  IF n <> 0 THEN RAISE EXCEPTION '0044: % grupo(s) de transferência inválidos', n; END IF;

  -- Anulação: 2 pernas, 1 conta, soma zero.
  SELECT count(*) INTO n FROM (
    SELECT reversal_group_id FROM fin_transaction WHERE reversal_group_id IS NOT NULL
     GROUP BY 1 HAVING count(*) <> 2 OR count(DISTINCT account_id) <> 1 OR sum(amount_cents) <> 0) x;
  IF n <> 0 THEN RAISE EXCEPTION '0044: % grupo(s) de anulação inválidos', n; END IF;

  -- O dinheiro não se moveu: esta migration só troca rótulos.
  SELECT sum(amount_cents) INTO v FROM fin_transaction;
  RAISE NOTICE '0044: soma do ledger = % centavos (deve ser idêntica à de antes)', v;

  SELECT count(*) INTO n FROM fin_transaction WHERE transfer_unresolved_reason = 'sem_cobertura_extrato';
  IF n <> 167 THEN
    RAISE WARNING '0044: % pernas sem_cobertura_extrato — o medido em 15/08/2026 era 167 (169 pré-2026 menos as 2 anuladas acima). Confira se o acervo mudou.', n;
  END IF;
  RAISE NOTICE '0044: % pernas marcadas sem_cobertura_extrato (R$ 2.224.767,97 no acervo medido)', n;

  SELECT count(*) INTO n FROM fin_transaction
   WHERE transfer_unresolved_reason LIKE 'destino_fora_do_ledger:%';
  RAISE NOTICE '0044: % pernas apontam para conta própria fora do ledger (esperado 5, R$ 25.400,00)', n;

  -- Nenhuma perna anulada continua contando como pendente, e nenhuma perna com
  -- motivo declarado saiu de em_transito pelas costas.
  SELECT count(*) INTO n FROM fin_transaction
   WHERE transfer_unresolved_reason IS NOT NULL AND transfer_status <> 'em_transito';
  IF n <> 0 THEN RAISE EXCEPTION '0044: % perna(s) com motivo de não-resolução fora de em_transito', n; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- INDETERMINADO — o que esta migration NÃO decidiu
-- ---------------------------------------------------------------------------
-- (a) A categoria certa de #76675 (R$ 400, Recifemecatron, fornecedor CNPJ
--     20169634000180) e #76826 (R$ 2.600, Maria De Fatima Gondim Carvalho,
--     fornecedora CPF 03215011441). Provado o que NÃO são (9.01); o que são
--     depende de saber o que foi comprado. Ficam com categoria nula e
--     review_status='pendente'.
--
-- (b) O grupo cb248b2d-647a-4465-b722-1693b0af42b3:
--       #75544 nubank 2026-06-17 +R$ 600,00 "Transferência Recebida — Fernando
--              de Siqueira Campos Silva"
--       #76851 inter  2026-06-18 −R$ 600,00 "Pix enviado — Fernando De
--              Siqueira Campos Silva"
--     As duas pernas nomeiam a MESMA pessoa, então não é o erro da seção 1 —
--     é coerente. Mas Fernando de Siqueira Campos Silva está cadastrado como
--     'socio' (CPF 09694069408), e sócio não é a empresa: pela regra do CNPJ da
--     casa isto seria uma saída para o sócio e uma entrada vinda dele, dois
--     fatos, não uma transferência entre contas próprias.
--     Desfazer muda o resultado da empresa, então não é decisão de migration.
--     Fica pareado, visível em fin_transferencia_suspeita, aguardando o Fernando.
