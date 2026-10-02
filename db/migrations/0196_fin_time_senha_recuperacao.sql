-- "Esqueci minha senha" do app do time, por link no e-mail.
--
-- O DEFEITO, NAS PALAVRAS DO DONO (02/10/2026)
-- --------------------------------------------
-- "todo mundo tá tendo problemas para trocar a senha do aplicativo pessoal...
--  pede para falar com Igor ou Fernando". A tela de login dizia "Sem senha?
-- Peça ao Fernando ou ao Igor", e só o admin redefinia — por script ou pelo
-- cadastro. A Audrey passou o dia sem entrar com 4 tentativas erradas.
--
-- POR QUE LINK, E NÃO MANDAR UMA SENHA NOVA
-- -----------------------------------------
-- O pedido de recuperação não tem prova nenhuma de quem pede: é um e-mail
-- digitado num formulário aberto. Se o pedido TROCASSE a senha, qualquer um que
-- soubesse o e-mail de um colega o trancaria para fora, quantas vezes quisesse.
-- Com link, o pedido não muda nada — a senha atual segue valendo até alguém
-- abrir o e-mail e escolher outra. Quem prova a identidade é a caixa de entrada.
--
-- O QUE A TABELA GUARDA
-- ---------------------
-- O sha256 do token, nunca o token: ele é uma credencial de 30 minutos, e quem
-- lesse esta tabela poderia redefinir a senha de qualquer pessoa com pedido
-- aberto. É a mesma regra de `fin_time_sessao.token_sha256`.

CREATE TABLE fin_time_senha_token (
  id            bigserial PRIMARY KEY,
  person_id     bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  token_sha256  char(64) NOT NULL UNIQUE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL,
  usado_em      timestamptz,
  pedido_de     text,
  CONSTRAINT fin_time_senha_token_expira_depois CHECK (expira_em > criado_em)
);

CREATE INDEX fin_time_senha_token_pessoa_idx ON fin_time_senha_token (person_id, criado_em DESC);

COMMENT ON TABLE fin_time_senha_token IS
  'Link de "esqueci minha senha" do app do time (0196). Guarda só o sha256 do token. O pedido '
  'não altera a senha: ela só muda quando alguém abre o link do e-mail e escolhe outra.';
COMMENT ON COLUMN fin_time_senha_token.pedido_de IS
  'User-agent de quem pediu, para investigar pedido em série. Não decide nada.';

DO $$
BEGIN
  IF to_regclass('fin_time_senha_token') IS NULL THEN
    RAISE EXCEPTION '0196: fin_time_senha_token não foi criada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'fin_time_senha_token'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '0196: o token precisa ser único';
  END IF;
  RAISE NOTICE '0196: recuperação de senha por link pronta';
END $$;
