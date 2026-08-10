-- O time entra no ledger: vínculo real, comissão separada do fixo, e a ligação
-- pessoa↔contraparte com procedência.
--
-- Três coisas estão erradas ou faltando hoje, e cada uma faz um número mentir:
--
-- 1. VÍNCULO. `fin_person` tem 12 pessoas marcadas 'clt' (semente de 0012, feita
--    quando ninguém tinha a planilha na mão). A empresa não tem um único CLT —
--    e a prova está na própria base: zero pagamento de FGTS, zero de INSS
--    patronal em 671 lançamentos do Inter e 815 do Nubank. O vínculo real é
--    Sócio Adm, Sócio, Mei, Estágio ou Irregular. Enquanto a coluna disser
--    'clt', a DRE manda R$ 45 mil/mês para a linha 6.01 (Salários) em vez de
--    6.02 (Pró-labore) e espera encargo que nunca vai existir.
--
-- 2. COMISSÃO. A planilha separa "Fixo | Comissão Consultoria | Comissão Obras",
--    e a aba de Hardware decompõe em 13 componentes (Medidores Instalados,
--    Diária Especialista, Participação no Faturamento, Deduções...). Hoje não há
--    onde guardar isso. Sem a separação, a pergunta que decide contratação —
--    "quanto do custo de gente é compromisso fixo e quanto acompanha a receita?"
--    — não tem resposta. Medido agosto/2026: dos R$ 105.241,76 pagos a pessoas,
--    R$ 22.787,46 são excedente sobre o fixo pactuado. É 21,7% da folha que
--    ninguém consegue enxergar como variável.
--
-- 3. LIGAÇÃO COM O LEDGER. A planilha tem nome e vínculo, o extrato tem CPF/CNPJ
--    e nome de cartório. Ligar os dois é o trabalho inteiro, e uma ligação errada
--    é permanente: "PAULO GABRIEL CHAVES DE ARAUJO" já casou com "Gabriel" por
--    engano numa auditoria anterior — são duas pessoas, R$ 10 mil/ano de um indo
--    para a conta do outro. Por isso a ligação vira TABELA com score e estado, e
--    não um ponteiro solto: quem ligou, com que evidência, e se um humano
--    confirmou.
--
-- ---------------------------------------------------------------------------
-- Por que tabela nova para comissão, e não colunas em fin_person
-- ---------------------------------------------------------------------------
-- Quatro razões, em ordem de peso:
--
-- a) O VALOR É POR MÊS, não por pessoa. A Diária Especialista do Diogo existe em
--    março, maio, julho e agosto e não existe nos outros meses; a Consultoria do
--    Belo é R$ 1.000 de janeiro a junho, R$ 2.000 em julho e R$ 4.500 em agosto,
--    enquanto o Desenvolvimento dele some em agosto. Uma coluna guarda um número
--    e perde exatamente a série que explica o salto.
--
-- b) A LISTA DE COMPONENTES CRESCE SOZINHA. Já são 13 no Hardware, 3 na
--    Consultoria, e duas ("Plataforma", "Repasse p/ recarga dos chips") apareceram
--    sem uso ainda — são o próximo componente. Coluna por componente é uma
--    migration por quinta-feira.
--
-- c) FIXO E VARIÁVEL SÃO NATUREZAS DIFERENTES. O fixo sobrevive a um mês ruim, a
--    comissão não. Somar os dois num campo só é o que faz a projeção de folha
--    (R$ 45.300 → R$ 104.500 até dezembro) parecer um compromisso quando metade
--    dela é consequência de receita que talvez não venha.
--
-- d) A COMPARAÇÃO COM O EXTRATO VIRA JOIN. Pessoa × mês × componente contra
--    fin_transaction por mês é uma consulta. Em colunas, é reconstrução.
--
-- ---------------------------------------------------------------------------
-- Por que a ligação pessoa↔contraparte é tabela, e não só fin_person.counterparty_id
-- ---------------------------------------------------------------------------
-- Porque uma pessoa tem MAIS DE UMA contraparte, e isso não é exceção: 11 das 25
-- pessoas do roster são MEI e recebem tanto no CNPJ do MEI quanto no CPF. Igor
-- Dalton recebe em 64.266.025/0001-14 e em 703.654.784-74; Flavio em
-- 64.677.654/0001-37 e em 082.819.174-31. Com um ponteiro só, metade do custo de
-- cada MEI fica fora da soma — e some sem erro nenhum.
--
-- O ponteiro `fin_person.counterparty_id` continua existindo porque a UI e
-- 0012 já contam com ele. Ele passa a ser DERIVADO: gatilho no fim deste arquivo
-- o mantém igual ao link primário confirmado. Escrever nele por código voltaria
-- a criar as duas verdades que esta tabela existe para evitar.

-- ---------------------------------------------------------------------------
-- 1. Vínculo: o domínio passa a caber na empresa que existe
-- ---------------------------------------------------------------------------
-- 'clt' e 'pj' continuam no domínio de propósito. Tirar 'clt' faria o schema
-- afirmar "esta empresa nunca poderá ter um empregado", o que é falso e quebra
-- no dia da primeira contratação. O que precisa ser verdade é que nenhuma LINHA
-- diga 'clt' hoje — e o UPDATE logo abaixo garante isso.
--
-- 'indefinido' é o valor que faltava. employment_type é NOT NULL; sem ele, uma
-- pessoa de identidade não resolvida obriga a chutar, e chute nesta coluna é
-- linha de DRE errada para sempre. 'indefinido' diz a verdade e aparece na fila
-- de pendências em vez de virar número.
ALTER TABLE fin_person DROP CONSTRAINT IF EXISTS fin_person_employment_type_check;
ALTER TABLE fin_person ADD CONSTRAINT fin_person_employment_type_check
  CHECK (employment_type IN (
    'socio_adm',    -- sócio administrador: pró-labore, 6.02
    'socio',        -- sócio sem função administrativa
    'mei',          -- MEI: nota contra CNPJ próprio, 4.01/6.01 conforme o núcleo
    'estagiario',   -- bolsa de estágio, 6.06
    'irregular',    -- presta serviço, recebe, e não tem nenhum enquadramento
    'pj',           -- pessoa jurídica que não é MEI
    'clt',          -- previsto, hoje sem nenhuma linha
    'indefinido'    -- identidade ou vínculo em aberto; é pendência, não é chute
  ));

-- ---------------------------------------------------------------------------
-- 2. Correção das 12 linhas 'clt'
-- ---------------------------------------------------------------------------
-- Vínculo lido da coluna "Meio de Pagamento" da aba de comissionamento da
-- planilha ("Comissionamento - XPE 2026"), não inferido. Fernando sai de 'socio'
-- para 'socio_adm' pela mesma fonte.
--
-- 'Alves' fica 'indefinido' de propósito: a semente de 0012 tirou 13 nomes da aba
-- de reembolso e este é sobrenome solto. O único Alves do roster é Igor Alves
-- Cordeiro (o "Igor A"), mas afirmar isso aqui seria fundir duas identidades sem
-- prova. Vai para a fila do dono.
UPDATE fin_person p SET employment_type = v.tipo
  FROM (VALUES
    ('igor',      'mei'),        -- Igor Dalton Guilherme da Silva — Mei, fixo R$ 5.000
    ('gabriel',   'socio'),
    ('jonildo',   'socio'),
    ('fernando',  'socio_adm'),
    ('diogo',     'mei'),
    ('cleber',    'mei'),
    ('tiago',     'socio'),
    ('adryan',    'socio'),
    ('belo',      'socio_adm'),
    ('flavio',    'mei'),        -- "Macgyver" na aba de Hardware é a mesma pessoa
    ('decezaris', 'socio_adm'),
    ('audrey',    'mei'),
    ('alves',     'indefinido')
  ) AS v(nome, tipo)
 WHERE p.normalized_name = v.nome
   AND p.entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe');

-- ---------------------------------------------------------------------------
-- 3. Colunas que faltam em fin_person
-- ---------------------------------------------------------------------------
-- legal_name: o extrato fala "Mateus Rocha de Paiva Belo", a planilha e a
-- empresa inteira falam "Belo". `name` continua sendo o apelido — é o que a tela
-- mostra e o que o dono reconhece. Sem o nome de cartório ao lado, cada
-- conciliação futura recomeça a adivinhação do zero.
--
-- cnpj: 11 das 25 pessoas são MEI e a maior parte do dinheiro sai contra o CNPJ,
-- não contra o CPF. Guardar só `cpf` deixa a maior metade do custo sem chave.
-- Ambos vêm de `cpfCnpjRecebedor` do próprio extrato — dado do banco, não
-- digitação.
--
-- default_nucleo: é a "Via de Pagamento" da planilha (Consultoria ou Obras).
-- Reaproveita fin_nucleo em vez de criar enum novo, e fica NULL para quem a
-- planilha marca "Consultoria/Obras" — nesse caso a verdade está por componente,
-- em fin_person_compensation.nucleo.
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS legal_name     text;
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS cnpj           text;
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS default_nucleo text REFERENCES fin_nucleo(slug);
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS notes          text;
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS fin_person_touch ON fin_person;
CREATE TRIGGER fin_person_touch BEFORE UPDATE ON fin_person
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Só dígitos, nas duas colunas. O extrato entrega "05265031499" e a tela
-- entregaria "052.650.314-99"; guardar as duas formas faria a mesma pessoa não
-- casar consigo mesma.
ALTER TABLE fin_person DROP CONSTRAINT IF EXISTS fin_person_cpf_digitos;
ALTER TABLE fin_person ADD CONSTRAINT fin_person_cpf_digitos
  CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');
ALTER TABLE fin_person DROP CONSTRAINT IF EXISTS fin_person_cnpj_digitos;
ALTER TABLE fin_person ADD CONSTRAINT fin_person_cnpj_digitos
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');

-- Dois cadastros com o mesmo CPF são a mesma pessoa em duas linhas — que é
-- exatamente o risco de "Igor"/"Igor A"/"Est. Igor". Único parcial porque a
-- maioria nasce sem documento.
CREATE UNIQUE INDEX IF NOT EXISTS fin_person_cpf_idx
  ON fin_person (entity_id, cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fin_person_cnpj_idx
  ON fin_person (entity_id, cnpj) WHERE cnpj IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Ligação pessoa ↔ contraparte, com evidência
-- ---------------------------------------------------------------------------
-- `confidence` não é enfeite: é o que separa o link que o importador aplica
-- sozinho do que ele apenas propõe. O limiar vive no script (0,80), a tabela só
-- guarda o número e a evidência que o produziu, para que a decisão possa ser
-- auditada meses depois sem reexecutar nada.
--
-- `status` começa em 'proposto'. Só 'confirmado' alimenta o ponteiro em
-- fin_person (gatilho no fim). 'rejeitado' é memória: impede que a próxima
-- execução proponha de novo o casamento que um humano já recusou — sem isso, o
-- erro "Paulo Gabriel × Gabriel" voltaria a cada importação.
CREATE TABLE IF NOT EXISTS fin_person_counterparty (
  id              bigserial PRIMARY KEY,
  entity_id       bigint NOT NULL REFERENCES fin_entity(id),
  person_id       bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  counterparty_id bigint NOT NULL REFERENCES fin_counterparty(id),
  -- Verdadeiro na contraparte que representa a pessoa no dia a dia (o MEI, em
  -- geral). Uma por pessoa — o índice único parcial abaixo cuida disso.
  is_primary      boolean NOT NULL DEFAULT false,
  confidence      numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  -- Como se chegou nela. 'documento' é o casamento por CPF/CNPJ do extrato;
  -- 'nome_exato' e 'nome_token' são fallback textual; 'humano' é decisão do dono.
  method          text NOT NULL CHECK (method IN ('documento', 'nome_exato', 'nome_token', 'humano')),
  status          text NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto', 'confirmado', 'rejeitado')),
  -- O que sustentou o score: documento visto, nome do extrato, pureza da
  -- contraparte, valores que bateram. Guardar em jsonb evita inventar seis
  -- colunas para um campo que a próxima heurística vai querer diferente.
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_by    text,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, counterparty_id)
);

CREATE INDEX IF NOT EXISTS fin_person_counterparty_person_idx ON fin_person_counterparty (person_id);
CREATE INDEX IF NOT EXISTS fin_person_counterparty_cp_idx ON fin_person_counterparty (counterparty_id);
CREATE INDEX IF NOT EXISTS fin_person_counterparty_pendente_idx
  ON fin_person_counterparty (entity_id, status) WHERE status = 'proposto';

-- Uma contraparte não pode ser primária de duas pessoas ao mesmo tempo, nem uma
-- pessoa ter duas primárias.
CREATE UNIQUE INDEX IF NOT EXISTS fin_person_counterparty_primaria_idx
  ON fin_person_counterparty (person_id) WHERE is_primary;

-- ---------------------------------------------------------------------------
-- 5. Componentes de remuneração
-- ---------------------------------------------------------------------------
-- Tabela e não CHECK pelo mesmo critério de fin_reimbursement_type: a lista
-- cresce pela operação, não pelo deploy. Os 18 slugs abaixo são os cabeçalhos
-- literais das abas de Hardware, Software e Comissionamento — nenhum inventado.
--
-- `kind` é o que ramifica código de verdade: 'fixo' entra na folha comprometida
-- e na projeção de caixa mesmo em mês sem receita; 'variavel' só existe se a
-- receita existir; 'deducao' entra negativo. Sem esses três, "custo de gente" é
-- um número só, e um número só não decide contratação.
CREATE TABLE IF NOT EXISTS fin_compensation_component (
  slug        text PRIMARY KEY,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('fixo', 'variavel', 'deducao')),
  -- Para onde vai na DRE. Resolvido por código do plano de contas (0005), não
  -- por id literal — id de seed não é estável entre ambientes.
  category_id bigint REFERENCES fin_category(id),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

INSERT INTO fin_compensation_component (slug, name, kind, category_id, sort_order)
SELECT v.slug, v.name, v.kind, c.id, v.sort_order
  FROM (VALUES
    ('fixo',                     'Fixo',                            'fixo',     '6.02',  1),
    ('consultoria',              'Consultoria',                     'fixo',     '6.02',  2),
    ('desenvolvimento',          'Desenvolvimento',                 'fixo',     '6.01',  3),
    ('suporte',                  'Desenvolvimento/Suporte',         'fixo',     '6.01',  4),
    ('plataforma',               'Plataforma',                      'fixo',     '6.01',  5),
    ('comissao_consultoria',     'Comissão Consultoria',            'variavel', '4.01', 10),
    ('comissao_obras',           'Comissão Obras',                  'variavel', '4.01', 11),
    ('comissao_vendas',          'Comissão de Vendas',              'variavel', '4.01', 12),
    ('participacao_fat_mensal',  'Participação no Fat. Mensal',     'variavel', '4.01', 13),
    ('participacao_fat_vendas',  'Participação no Fat. Vendas',     'variavel', '4.01', 14),
    ('medidores_instalados',     'Medidores Instalados',            'variavel', '4.02', 20),
    ('manutencao',               'Manutenção',                      'variavel', '4.02', 21),
    ('fabricacao_medidores',     'Fabricação de medidores',         'variavel', '4.02', 22),
    ('diaria_especialista',      'Diária Especialista',             'variavel', '4.02', 23),
    ('diaria_ajudante',          'Diária Ajudante',                 'variavel', '4.02', 24),
    ('inspecoes_levantamentos',  'Inspeções/Levantamentos',         'variavel', '4.02', 25),
    ('repasse_chips',            'Repasse p/ recarga dos chips',    'variavel', '5.02', 26),
    ('deducoes',                 'Deduções',                        'deducao',  '6.02', 90)
  ) AS v(slug, name, kind, category_code, sort_order)
  LEFT JOIN fin_entity e ON e.slug = 'xpe'
  LEFT JOIN fin_category c ON c.entity_id = e.id AND c.code = v.category_code
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Remuneração: pessoa × mês × componente
-- ---------------------------------------------------------------------------
-- `kind` separa duas coisas que a planilha guarda em abas diferentes e que a
-- conta de agosto mostra serem MESMO diferentes:
--   'contratado' — a aba "Via de Pagamento": Fixo R$ 65.900 do time inteiro;
--   'apurado'    — a lista do mês ("Falta pagar"): R$ 72.557,30 em agosto.
-- São R$ 6.657,30 de diferença só entre as duas abas da mesma planilha, no mesmo
-- mês. Guardar as duas com o mesmo significado apagaria a pergunta.
--
-- amount_cents pode ser negativo, e só em componente 'deducao' — a aba de
-- Hardware tem a linha "Deduções" para desconto de adiantamento e material.
CREATE TABLE IF NOT EXISTS fin_person_compensation (
  id              bigserial PRIMARY KEY,
  entity_id       bigint NOT NULL REFERENCES fin_entity(id),
  person_id       bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  CONSTRAINT fin_person_compensation_mes_cheio
    CHECK (reference_month = date_trunc('month', reference_month)::date),
  component       text NOT NULL REFERENCES fin_compensation_component(slug),
  kind            text NOT NULL CHECK (kind IN ('contratado', 'apurado')),
  amount_cents    bigint NOT NULL,
  -- Via de pagamento do componente. É por aqui que o fixo do Adryan cai em
  -- Consultoria e a comissão dele em Obras — a planilha marca "Consultoria/Obras"
  -- na linha da pessoa e não dá para representar isso num campo de pessoa.
  nucleo          text REFERENCES fin_nucleo(slug),
  -- Procedência da linha: qual aba de qual arquivo. Sem isso, daqui a três meses
  -- ninguém sabe se o número veio da planilha, do extrato ou da tela.
  source          text NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, reference_month, component, kind)
);

CREATE INDEX IF NOT EXISTS fin_person_compensation_mes_idx
  ON fin_person_compensation (entity_id, reference_month DESC, kind);
CREATE INDEX IF NOT EXISTS fin_person_compensation_pessoa_idx
  ON fin_person_compensation (person_id, reference_month DESC);

-- Só componente 'deducao' pode ser negativo. Um fixo negativo é erro de
-- digitação que zera a folha de um mês sem ninguém perceber.
CREATE OR REPLACE FUNCTION fin_person_compensation_valida() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM fin_compensation_component WHERE slug = NEW.component;
  IF NEW.amount_cents < 0 AND v_kind <> 'deducao' THEN
    RAISE EXCEPTION 'componente % não é dedução e não aceita valor negativo (%)', NEW.component, NEW.amount_cents;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_person_compensation_valida_trg ON fin_person_compensation;
CREATE TRIGGER fin_person_compensation_valida_trg
  BEFORE INSERT OR UPDATE ON fin_person_compensation
  FOR EACH ROW EXECUTE FUNCTION fin_person_compensation_valida();

-- ---------------------------------------------------------------------------
-- 7. O ponteiro antigo passa a ser derivado
-- ---------------------------------------------------------------------------
-- Mesma razão do total de fin_reimbursement em 0012: dois lugares guardando a
-- mesma verdade divergem, e aqui divergir significa a tela mostrar o custo de
-- uma pessoa pendurado na contraparte de outra. O gatilho dispara também em
-- DELETE porque `DELETE FROM fin_person_counterparty` não passa pela aplicação.
CREATE OR REPLACE FUNCTION fin_person_refresh_counterparty(p_person_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fin_person p
     SET counterparty_id = (
           SELECT l.counterparty_id FROM fin_person_counterparty l
            WHERE l.person_id = p_person_id
              AND l.status = 'confirmado'
            ORDER BY l.is_primary DESC, l.confidence DESC, l.id
            LIMIT 1)
   WHERE p.id = p_person_id;
END $$;

CREATE OR REPLACE FUNCTION fin_person_counterparty_maintain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM fin_person_refresh_counterparty(OLD.person_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM fin_person_refresh_counterparty(NEW.person_id); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fin_person_counterparty_maintains_pointer ON fin_person_counterparty;
CREATE TRIGGER fin_person_counterparty_maintains_pointer
  AFTER INSERT OR UPDATE OR DELETE ON fin_person_counterparty
  FOR EACH ROW EXECUTE FUNCTION fin_person_counterparty_maintain();

-- ---------------------------------------------------------------------------
-- 8. Contrapartes que são pessoas e estão com nome de banco
-- ---------------------------------------------------------------------------
-- O importador do Inter prefere `nomeEmpresaRecebedor` a `nomeRecebedor`. Num
-- PIX, `nomeEmpresaRecebedor` é a INSTITUIÇÃO de destino. Resultado: quem recebeu
-- ficou registrado com o nome do banco dele, enquanto `document_number` guarda,
-- corretamente, o CPF/CNPJ da pessoa. Hoje:
--
--   id 352 "Nu Pagamentos S.A."           CPF 052.650.314-99 → Adryan Santos
--   id 353 "BANCO DIGIO"                  CPF 057.634.674-85 → Jonildo A. da Silva Filho
--   id 355 "Banco Santander (brasil) S.A." CPF 708.701.414-57 → Tiago Lord
--
-- Estas três são corrigidas aqui porque são PURAS: 100% dos lançamentos de cada
-- uma têm um único favorecido no campo de descrição (18, 27 e 11 lançamentos,
-- conferidos um a um). São dado, não heurística.
--
-- As demais (349, 351, 354, 356, 357, 358) NÃO são tocadas: a 349
-- "NU PAGAMENTOS - IP" sozinha carrega 226 lançamentos e R$ 340.568,41 de pelo
-- menos 15 pessoas diferentes misturadas. Renomeá-la para qualquer pessoa seria
-- fabricar a mentira que este arquivo existe para evitar; separá-la é trabalho do
-- importador, não de uma migration.
--
-- Renomear aqui é seguro contra reimportação: import-inter.mjs busca contraparte
-- por documento antes de inserir e nunca sobrescreve `name` de quem já existe.
UPDATE fin_counterparty c SET name = v.nome, normalized_name = v.norm, kind = 'colaborador', updated_at = now()
  FROM (VALUES
    ('05265031499', 'Adryan Santos',                  'adryan santos'),
    ('05763467485', 'Jonildo Antonio da Silva Filho',  'jonildo antonio silva filho'),
    ('70870141457', 'Tiago Lord',                      'tiago lord')
  ) AS v(doc, nome, norm)
 WHERE c.document_number = v.doc
   AND c.entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe')
   -- Só troca o que ainda está com nome de instituição; correção manual vence.
   AND c.name ~* '(banco|bco |nu pagamentos|santander|digio|itau|caixa|bradesco)';

-- Fernando já entrou com nome próprio (veio do Asaas, como cliente), mas está
-- classificado 'cliente'. Ele é sócio administrador e o dinheiro sai para ele.
UPDATE fin_counterparty SET kind = 'socio', updated_at = now()
 WHERE document_number = '09694069408'
   AND entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe')
   AND kind = 'cliente';
