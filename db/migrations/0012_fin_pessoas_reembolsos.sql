-- Pessoas, reembolsos e parcelamentos.
--
-- O extrato bancário conta o que JÁ saiu. Reembolso é a metade que ele nunca
-- conta: a despesa nasce no bolso de uma pessoa, vive semanas numa planilha e só
-- vira lançamento no dia do pagamento — quando já não dá para planejar nada.
-- Estas cinco tabelas são o lugar onde essa despesa passa a existir ANTES do
-- caixa, que é a condição para "cobertura de planejamento" ser mensurável.
--
-- Três decisões que o schema sozinho não explica:
--
-- 1. PESSOA NÃO É CONTRAPARTE, mas aponta para uma. fin_counterparty responde
--    "para quem o dinheiro foi"; fin_person responde "quem é do time" — com
--    vínculo, área e período de casa. Fundir as duas faria a matriz pessoa × mês
--    listar 311 clientes, e separar sem o ponteiro faria o pagamento do reembolso
--    não ter favorecido. Daí counterparty_id, nullable enquanto ninguém pagou.
--
-- 2. O PARCELAMENTO É UMA ENTIDADE, não um par de inteiros no item. "Impressora
--    3D 7/12" precisa responder quanto FALTA sem varrer o histórico inteiro, e
--    precisa sobreviver a um item apagado. Com o plano em tabela própria, a
--    previsão do mês que vem é uma soma de monthly_amount_cents dos planos
--    ativos — uma consulta, não uma reconstrução.
--
-- 3. total_cents É MANTIDO POR GATILHO, pelo mesmo motivo de settled_cents em
--    0002: ON DELETE CASCADE não passa pela aplicação. Apagar um reembolso apaga
--    os itens em cascata, e um total escrito por código ficaria eternamente
--    diferente da soma dos seus próprios itens.

-- ---------------------------------------------------------------------------
-- Pessoas
-- ---------------------------------------------------------------------------
CREATE TABLE fin_person (
  id              bigserial PRIMARY KEY,
  entity_id       bigint NOT NULL REFERENCES fin_entity(id),
  name            text NOT NULL,
  -- Mesma forma canônica de fin_counterparty.normalized_name (minúscula, sem
  -- acento): é ela que impede "Decézaris" e "Decezaris" de virarem duas pessoas
  -- e a matriz de reembolso de mostrar a mesma pessoa em duas linhas.
  normalized_name text NOT NULL,
  cpf             text,
  role            text,
  area            text,
  -- Ramifica código: CLT tem encargo, sócio tem pró-labore, estagiário tem bolsa.
  -- Por isso CHECK e não tabela (ver a decisão 2 do cabeçalho de 0001).
  employment_type text NOT NULL CHECK (employment_type IN ('clt', 'pj', 'socio', 'estagiario')),
  counterparty_id bigint REFERENCES fin_counterparty(id),
  status          text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  start_date      date,
  end_date        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, normalized_name)
);

CREATE INDEX fin_person_status_idx ON fin_person (entity_id, status);
CREATE INDEX fin_person_counterparty_idx ON fin_person (counterparty_id) WHERE counterparty_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tipos de reembolso
-- ---------------------------------------------------------------------------
-- Extraídos da aba "Reembolso 2026" da planilha real, não inventados. Viram
-- tabela (e não CHECK) porque a lista cresce pela tela: o próximo tipo aparece
-- numa quinta-feira e não pode exigir deploy.
--
-- category_id é o que liga reembolso à DRE. Sem ele, R$ 40 mil/ano de despesa
-- real cairiam todos em "Reembolsos a colaboradores" e a linha de "Treinamento"
-- ficaria zerada para sempre.
CREATE TABLE fin_reimbursement_type (
  slug              text PRIMARY KEY,
  name              text NOT NULL,
  category_id       bigint REFERENCES fin_category(id),
  -- Equipamento sem nota é ativo sem lastro: a nota é o que sustenta a
  -- depreciação e o crédito. A tela usa isto para exigir a chave de 44 dígitos.
  requires_nfe      boolean NOT NULL DEFAULT false,
  allows_installment boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Planos de parcelamento
-- ---------------------------------------------------------------------------
-- Vale para reembolso parcelado (a impressora 3D que o colaborador comprou e a
-- empresa devolve em 12), para compra de ativo e para financiamento. O mesmo
-- desenho serve aos três porque a pergunta é sempre a mesma: quanto falta, em
-- quantas parcelas, a partir de quando.
CREATE TABLE fin_installment_plan (
  id                 bigserial PRIMARY KEY,
  entity_id          bigint NOT NULL REFERENCES fin_entity(id),
  person_id          bigint REFERENCES fin_person(id),
  counterparty_id    bigint REFERENCES fin_counterparty(id),
  title              text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('reembolso', 'compra_ativo', 'financiamento')),
  total_amount_cents bigint NOT NULL CHECK (total_amount_cents > 0),
  installments_total integer NOT NULL CHECK (installments_total > 0),
  -- Redundante com a contagem de itens de propósito: a previsão do mês seguinte
  -- não pode depender de os itens futuros já terem sido gerados, e o plano
  -- precisa continuar respondendo "faltam 5" mesmo se um item for apagado.
  installments_paid  integer NOT NULL DEFAULT 0 CHECK (installments_paid >= 0),
  monthly_amount_cents bigint NOT NULL CHECK (monthly_amount_cents > 0),
  first_due_date     date NOT NULL,
  category_id        bigint REFERENCES fin_category(id),
  status             text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'quitado', 'cancelado')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_installment_plan_ativo_idx ON fin_installment_plan (entity_id, status);
CREATE INDEX fin_installment_plan_person_idx ON fin_installment_plan (person_id) WHERE person_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reembolso: um por pessoa e por mês de competência
-- ---------------------------------------------------------------------------
-- UNIQUE (person_id, reference_month) é o que torna a matriz pessoa × mês uma
-- consulta trivial e o que impede dois "reembolso do Igor em março" com valores
-- diferentes — que é exatamente o que acontece quando duas abas da planilha são
-- editadas na mesma semana.
CREATE TABLE fin_reimbursement (
  id               bigserial PRIMARY KEY,
  entity_id        bigint NOT NULL REFERENCES fin_entity(id),
  person_id        bigint NOT NULL REFERENCES fin_person(id),
  reference_month  date NOT NULL,
  CONSTRAINT fin_reimbursement_mes_cheio CHECK (reference_month = date_trunc('month', reference_month)::date),
  status           text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'pago', 'rejeitado')),
  -- Mantido pelo gatilho no fim deste arquivo. Nunca escrever por código.
  total_cents      bigint NOT NULL DEFAULT 0,
  submitted_at     timestamptz,
  approved_at      timestamptz,
  approved_by      text,
  -- A conta a pagar gerada na aprovação. É o elo entre este módulo e o fluxo de
  -- caixa: sem ele, R$ X de reembolso aprovado seria caixa a sair invisível.
  paid_document_id bigint REFERENCES fin_document(id) ON DELETE SET NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, reference_month)
);

CREATE INDEX fin_reimbursement_mes_idx ON fin_reimbursement (entity_id, reference_month DESC);
CREATE INDEX fin_reimbursement_status_idx ON fin_reimbursement (entity_id, status);

DROP TRIGGER IF EXISTS fin_reimbursement_touch ON fin_reimbursement;
CREATE TRIGGER fin_reimbursement_touch BEFORE UPDATE ON fin_reimbursement
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Itens do reembolso
-- ---------------------------------------------------------------------------
CREATE TABLE fin_reimbursement_item (
  id                  bigserial PRIMARY KEY,
  reimbursement_id    bigint NOT NULL REFERENCES fin_reimbursement(id) ON DELETE CASCADE,
  category_id         bigint REFERENCES fin_category(id),
  -- FK por slug, como núcleo: mantém a consulta legível
  -- (WHERE reimbursement_type = 'combustivel') e ainda assim protegida contra
  -- digitação divergente, que como texto livre criaria "Combustível" e
  -- "combustivel" como dois tipos distintos na mesma matriz.
  reimbursement_type  text REFERENCES fin_reimbursement_type(slug),
  description         text NOT NULL,
  expense_date        date,
  -- Sempre positivo: o sentido do dinheiro é o da tabela inteira (saída).
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  installment_plan_id bigint REFERENCES fin_installment_plan(id) ON DELETE SET NULL,
  installment_number  integer,
  installment_total   integer,
  CONSTRAINT fin_reimbursement_item_parcela_coerente CHECK (
    installment_number IS NULL OR installment_total IS NULL OR installment_number <= installment_total),
  -- 44 dígitos, sem máscara. Guardar a chave é o que permite, depois, buscar o
  -- XML na SEFAZ sem pedir o arquivo de novo a quem já esqueceu onde salvou.
  nfe_key             char(44),
  -- O arquivo em si chega com a etapa de storage; a coluna nasce agora para o
  -- upload não exigir migration no dia em que o bucket existir.
  receipt_artifact_key text,
  status              text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'pago')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_reimbursement_item_reembolso_idx ON fin_reimbursement_item (reimbursement_id);
CREATE INDEX fin_reimbursement_item_plano_idx ON fin_reimbursement_item (installment_plan_id) WHERE installment_plan_id IS NOT NULL;
CREATE INDEX fin_reimbursement_item_tipo_idx ON fin_reimbursement_item (reimbursement_type);

-- ---------------------------------------------------------------------------
-- O total do reembolso é derivado — e mantido por gatilho
-- ---------------------------------------------------------------------------
-- Mesmo desenho de fin_document_refresh_settlement (0002), pelas mesmas três
-- razões. A terceira é a que decide: `DELETE FROM fin_reimbursement WHERE id=7`
-- apaga os itens em CASCATA, sem passar pela aplicação. Gatilho AFTER DELETE
-- dispara em cascata; código não. Sem isto, um reembolso apagado pela metade
-- deixaria total_cents apontando para itens que não existem mais.
--
-- Soma TODOS os itens, inclusive os rejeitados: total_cents é "o que foi
-- lançado", e a triagem do que se paga é o status do item. Filtrar aqui faria o
-- número da tela divergir da soma que o olho faz na lista.
CREATE OR REPLACE FUNCTION fin_reimbursement_refresh_total(p_reimbursement_id bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fin_reimbursement r
     SET total_cents = COALESCE(
           (SELECT SUM(i.amount_cents) FROM fin_reimbursement_item i
             WHERE i.reimbursement_id = p_reimbursement_id), 0),
         updated_at = now()
   WHERE r.id = p_reimbursement_id;
END $$;

CREATE OR REPLACE FUNCTION fin_reimbursement_item_maintain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- UPDATE que move o item de um reembolso para outro tem de corrigir os DOIS
  -- totais; por isso OLD e NEW em vez de só NEW.
  IF TG_OP <> 'INSERT' THEN PERFORM fin_reimbursement_refresh_total(OLD.reimbursement_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM fin_reimbursement_refresh_total(NEW.reimbursement_id); END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER fin_reimbursement_item_maintains_total
  AFTER INSERT OR UPDATE OR DELETE ON fin_reimbursement_item
  FOR EACH ROW EXECUTE FUNCTION fin_reimbursement_item_maintain();

-- ---------------------------------------------------------------------------
-- Seed: o time
-- ---------------------------------------------------------------------------
-- As 13 pessoas que aparecem na aba de reembolso da planilha. Nome próprio como
-- está lá — o nome completo e o CPF entram pela tela, quando alguém tiver o
-- dado na mão; inventá-los aqui criaria cadastro errado com aparência de certo.
--
-- Todos 'clt' menos Fernando, sócio: a distinção não é burocrática, ela ramifica
-- código (pró-labore 6.02 contra salário 6.01) e vai decidir a DRE de pessoal.
INSERT INTO fin_person (entity_id, name, normalized_name, employment_type, status)
SELECT e.id, v.name, v.normalized_name, v.employment_type, 'ativo'
  FROM fin_entity e
 CROSS JOIN (VALUES
   ('Igor',      'igor',      'clt'),
   ('Gabriel',   'gabriel',   'clt'),
   ('Jonildo',   'jonildo',   'clt'),
   ('Fernando',  'fernando',  'socio'),
   ('Diogo',     'diogo',     'clt'),
   ('Cleber',    'cleber',    'clt'),
   ('Tiago',     'tiago',     'clt'),
   ('Adryan',    'adryan',    'clt'),
   ('Belo',      'belo',      'clt'),
   ('Flavio',    'flavio',    'clt'),
   ('Decézaris', 'decezaris', 'clt'),
   ('Audrey',    'audrey',    'clt'),
   ('Alves',     'alves',     'clt')
 ) AS v(name, normalized_name, employment_type)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, normalized_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: tipos de reembolso
-- ---------------------------------------------------------------------------
-- A coluna category_id é resolvida por código do plano de contas (0005), não por
-- id literal: id de seed não é estável entre ambientes, código é.
--
-- Só 'equipamentos' nasce com parcelamento e exigência de nota — é o único tipo
-- da planilha que aparece dividido ("Impressora 3D 7/12") e o único que vira
-- ativo. Os demais liberam parcelamento quando a tela pedir, não por antecipação.
INSERT INTO fin_reimbursement_type (slug, name, category_id, requires_nfe, allows_installment, sort_order)
SELECT v.slug, v.name, c.id, v.requires_nfe, v.allows_installment, v.sort_order
  FROM (VALUES
   ('transporte',             'Transporte',                  '4.04', false, false,  1),
   ('alimentacao',            'Alimentação',                 '5.06', false, false,  2),
   ('transporte-manutencao',  'Transporte — manutenção',     '5.08', false, false,  3),
   ('combustivel',            'Combustível',                 '4.04', false, false,  4),
   ('plano-telefone-internet','Plano de telefone e internet','5.02', false, false,  5),
   ('itens-cozinha',          'Itens de cozinha',            '5.07', false, false,  6),
   ('cursos-capacitacao',     'Cursos e capacitação',        '6.07', false, false,  7),
   ('equipamentos',           'Equipamentos',                '8.01', true,  true,   8),
   ('softwares',              'Softwares',                   '5.03', false, false,  9),
   ('aniversariante-mes',     'Aniversariante do mês',       '6.04', false, false, 10),
   ('material-obra',          'Material de obra',            '4.02', false, false, 11)
 ) AS v(slug, name, category_code, requires_nfe, allows_installment, sort_order)
 LEFT JOIN fin_entity e ON e.slug = 'xpe'
 LEFT JOIN fin_category c ON c.entity_id = e.id AND c.code = v.category_code
ON CONFLICT (slug) DO NOTHING;
