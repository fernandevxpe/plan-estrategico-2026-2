-- Para onde vai o dinheiro de cada pessoa.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO NÃO É "MAIS UM CAMPO DO PERFIL"
-- ---------------------------------------------------------------------------
-- O Fernando: "no cadastro do perfil individual deve aparecer a conta da
-- pessoa, os dados por onde estão recebendo salário, reembolso... geralmente é
-- PIX", e depois: "vou trazer isso para todas as contas, organizar tudo para
-- PROGRAMAR OS PAGAMENTOS de reembolso".
--
-- Esse "depois" é o requisito de verdade. Um campo de texto livre bastaria
-- para exibir; para PAGAR, o dado precisa ser suficiente e conferível — chave
-- no formato que o banco aceita, titular quando não for a própria pessoa, e
-- rastro de quem mudou. Uma chave errada não dá erro: paga outra pessoa.
--
-- Hoje os R$ 42.320 de reembolso são pagos fora do sistema, com a chave vindo
-- de conversa. É essa lacuna que a tabela fecha.
--
-- ---------------------------------------------------------------------------
-- O TITULAR PODE NÃO SER A PESSOA, E ISSO É O CASO COMUM AQUI
-- ---------------------------------------------------------------------------
-- O time da XPE é MEI: a empresa paga o DAS deles, e boa parte recebe no CNPJ,
-- não no CPF. Guardar só "a chave PIX do Gabriel" perderia essa distinção, e
-- quem conferir o comprovante depois veria um nome de empresa que não bate com
-- a pessoa e trataria como erro.
--
-- `titular_nome` e `titular_documento` só são exigidos quando o titular NÃO é
-- a pessoa — é o CHECK abaixo que garante que, se alguém marcar "não é minha
-- conta", diga de quem é.
--
-- ---------------------------------------------------------------------------
-- UMA LINHA POR PESSOA, E NÃO UM HISTÓRICO
-- ---------------------------------------------------------------------------
-- Chave PIX muda pouco e o que importa é a atual. Versionar aqui criaria a
-- pergunta "qual valia no dia do pagamento?" sem ninguém para respondê-la —
-- e o pagamento já guarda o próprio comprovante. O rastro fica em
-- `fin_audit_log`, que é onde ele pertence: quem mudou, quando, de quê para
-- quê.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS fin_person_pagamento (
  person_id          bigint PRIMARY KEY REFERENCES fin_person(id) ON DELETE CASCADE,
  entity_id          bigint NOT NULL REFERENCES fin_entity(id),

  -- PIX é o caminho padrão. `metodo` existe porque TED ainda acontece.
  metodo             text NOT NULL DEFAULT 'pix',

  pix_tipo           text,
  pix_chave          text,

  -- TED: só preenchido quando o método é ted.
  banco_nome         text,
  banco_ispb         text,
  agencia            text,
  conta              text,
  conta_tipo         text,

  -- Quem recebe, quando não é a própria pessoa (MEI recebendo no CNPJ).
  titular_e_a_pessoa boolean NOT NULL DEFAULT true,
  titular_nome       text,
  titular_documento  text,

  -- Para que serve esta conta. Separado porque salário e reembolso podem ir
  -- para lugares diferentes, e quem programa o lote precisa filtrar.
  recebe_salario     boolean NOT NULL DEFAULT true,
  recebe_reembolso   boolean NOT NULL DEFAULT true,

  observacao         text,

  -- Conferido por alguém do financeiro. Chave que a própria pessoa digitou e
  -- ninguém olhou não deveria entrar num lote automático.
  conferido_em       timestamptz,
  conferido_por      text,

  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por     text
);

ALTER TABLE fin_person_pagamento DROP CONSTRAINT IF EXISTS fin_person_pagamento_metodo_ck;
ALTER TABLE fin_person_pagamento ADD CONSTRAINT fin_person_pagamento_metodo_ck
  CHECK (metodo IN ('pix', 'ted'));

ALTER TABLE fin_person_pagamento DROP CONSTRAINT IF EXISTS fin_person_pagamento_pix_tipo_ck;
ALTER TABLE fin_person_pagamento ADD CONSTRAINT fin_person_pagamento_pix_tipo_ck
  CHECK (pix_tipo IS NULL OR pix_tipo IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria'));

ALTER TABLE fin_person_pagamento DROP CONSTRAINT IF EXISTS fin_person_pagamento_conta_tipo_ck;
ALTER TABLE fin_person_pagamento ADD CONSTRAINT fin_person_pagamento_conta_tipo_ck
  CHECK (conta_tipo IS NULL OR conta_tipo IN ('corrente', 'poupanca', 'pagamento'));

-- PIX precisa de tipo E chave. Meio preenchido não paga ninguém.
ALTER TABLE fin_person_pagamento DROP CONSTRAINT IF EXISTS fin_person_pagamento_pix_completo;
ALTER TABLE fin_person_pagamento ADD CONSTRAINT fin_person_pagamento_pix_completo
  CHECK (metodo <> 'pix' OR (pix_tipo IS NOT NULL AND nullif(btrim(pix_chave), '') IS NOT NULL));

-- TED precisa de banco, agência e conta.
ALTER TABLE fin_person_pagamento DROP CONSTRAINT IF EXISTS fin_person_pagamento_ted_completo;
ALTER TABLE fin_person_pagamento ADD CONSTRAINT fin_person_pagamento_ted_completo
  CHECK (metodo <> 'ted' OR (
    nullif(btrim(banco_nome), '') IS NOT NULL AND
    nullif(btrim(agencia), '')    IS NOT NULL AND
    nullif(btrim(conta), '')      IS NOT NULL
  ));

-- Se o titular não é a pessoa, tem de dizer quem é. Sem isso o comprovante
-- mostra um nome que ninguém consegue casar com o destinatário.
ALTER TABLE fin_person_pagamento DROP CONSTRAINT IF EXISTS fin_person_pagamento_titular;
ALTER TABLE fin_person_pagamento ADD CONSTRAINT fin_person_pagamento_titular
  CHECK (titular_e_a_pessoa OR (
    nullif(btrim(titular_nome), '')      IS NOT NULL AND
    nullif(btrim(titular_documento), '') IS NOT NULL
  ));

COMMENT ON TABLE fin_person_pagamento IS
  'Para onde vai o dinheiro de cada pessoa: PIX (padrão) ou TED. Existe para PROGRAMAR pagamento '
  'de reembolso e salário, não só para exibir — por isso os CHECKs exigem o conjunto completo de '
  'cada método. `titular_e_a_pessoa = false` cobre o caso comum aqui: o time é MEI e boa parte '
  'recebe no CNPJ.';

COMMENT ON COLUMN fin_person_pagamento.conferido_em IS
  'Quando alguém do financeiro confirmou a chave. Chave que a própria pessoa digitou e ninguém '
  'olhou não deveria entrar em lote automático: chave errada não dá erro, paga outra pessoa.';

CREATE INDEX IF NOT EXISTS fin_person_pagamento_reembolso
  ON fin_person_pagamento (recebe_reembolso) WHERE recebe_reembolso;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  pid bigint := (SELECT id FROM fin_person WHERE status = 'ativo' ORDER BY id LIMIT 1);
  eid bigint := (SELECT id FROM fin_entity WHERE slug = 'xpe');
BEGIN
  -- As travas recusam mesmo, em vez de só parecer que recusam.
  BEGIN
    INSERT INTO fin_person_pagamento (person_id, entity_id, metodo, pix_tipo)
    VALUES (pid, eid, 'pix', 'cpf');
    RAISE EXCEPTION 'PIX sem chave foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO fin_person_pagamento (person_id, entity_id, metodo, banco_nome, agencia)
    VALUES (pid, eid, 'ted', 'Inter', '0001');
    RAISE EXCEPTION 'TED sem conta foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO fin_person_pagamento (person_id, entity_id, metodo, pix_tipo, pix_chave, titular_e_a_pessoa)
    VALUES (pid, eid, 'pix', 'cnpj', '12345678000190', false);
    RAISE EXCEPTION 'titular diferente sem nome foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- E aceita o caso bom, que é o que a tela vai gravar.
  INSERT INTO fin_person_pagamento (person_id, entity_id, metodo, pix_tipo, pix_chave)
  VALUES (pid, eid, 'pix', 'email', 'sonda@teste.local');
  DELETE FROM fin_person_pagamento WHERE person_id = pid;

  IF (SELECT count(*) FROM fin_person_pagamento) <> 0 THEN
    RAISE EXCEPTION 'a sonda não foi removida';
  END IF;
  RAISE NOTICE 'fin_person_pagamento criada e com as travas conferidas';
END $$;
