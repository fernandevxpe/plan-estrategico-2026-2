-- Login por pessoa: e-mail, senha e quem é admin.
--
-- Até aqui a identidade no app do time era DECLARADA: a pessoa clicava no
-- próprio nome numa lista e a sessão nascia com esse carimbo. Isso era honesto
-- enquanto o Basic Auth da plataforma inteira ficava na frente — a credencial
-- compartilhada provava "alguém do time", e a declaração só separava as caixas.
--
-- O app instalável muda o contrato. Quando `/time` sair de trás do Basic Auth
-- (para o manifest ser buscável e para ninguém digitar a senha da plataforma
-- inteira num celular pessoal), a senha desta tabela passa a ser A barreira.
-- Por isso esta migration vem ANTES da isenção no middleware, nunca depois.
--
-- ---------------------------------------------------------------------------
-- POR QUE SCRYPT E NÃO O sha256 QUE O PIN JÁ USAVA
-- ---------------------------------------------------------------------------
-- `pin_sha256` guarda sha256(pin || salt). Para um PIN de 4 dígitos atrás de
-- uma credencial compartilhada isso era proporcional: o atacante precisava
-- primeiro passar pelo Basic Auth, e 10.000 combinações não se defendem com
-- hash mesmo.
--
-- Senha exposta na internet é outro problema. sha256 é rápido de propósito, e
-- é justamente isso que o torna ruim aqui: uma GPU testa bilhões por segundo
-- contra o hash vazado. scrypt tem custo de memória e tempo declarados, então
-- o mesmo teste fica ordens de grandeza mais caro. Vem no `node:crypto`, sem
-- dependência nova.
--
-- O formato guardado é `scrypt$N$r$p$salt$hash`, tudo em hex — os parâmetros
-- viajam junto com o hash para que endurecer o custo amanhã não invalide as
-- senhas de hoje.
--
-- ---------------------------------------------------------------------------
-- POR QUE `email text` E NÃO `citext`
-- ---------------------------------------------------------------------------
-- `citext` não está instalada neste banco (só `pg_trgm` e `plpgsql`), e instalar
-- extensão para ganhar case-insensitive de uma coluna é caro demais pelo que
-- entrega. Índice único sobre `lower(email)` resolve igual.
--
-- E NÃO há CHECK de domínio: os endereços de admin são Gmail pessoal
-- (fernando.xpenergy@gmail.com, igor.xpenergy@gmail.com), não um Workspace
-- @xpenergy.com.br. Um CHECK de domínio rejeitaria exatamente os dois.
--
-- ---------------------------------------------------------------------------
-- ESTA MIGRATION NÃO SEMEIA NENHUMA CREDENCIAL
-- ---------------------------------------------------------------------------
-- Mesma razão pela qual `fin_person_acesso` nasceu vazia na 0105 e
-- `fin_approval_rule` nasceu vazia na 0075: semear senha que ninguém combinou é
-- inventar governança, e uma senha padrão escrita em arquivo versionado é uma
-- senha pública. As senhas entram por `scripts/definir-senha.mjs`, que exige o
-- valor no ambiente e nunca o imprime.
-- ===========================================================================

-- 1. Identidade da pessoa -----------------------------------------------------

ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE fin_person ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS fin_person_email_idx
  ON fin_person (lower(email)) WHERE email IS NOT NULL;

COMMENT ON COLUMN fin_person.email IS
  'Identificador de login. Sem CHECK de domínio de propósito: os admins usam Gmail pessoal. '
  'Unicidade por lower(email) — e-mail não distingue maiúscula na prática.';

COMMENT ON COLUMN fin_person.is_admin IS
  'Se o login desta pessoa carimba x-xpe-perfil=admin. NÃO substitui lib/auth/perfis.ts, que '
  'continua sendo a única fonte da regra de acesso: isto é só um segundo caminho para chegar '
  'ao mesmo perfil, ao lado do par DASHBOARD_ADMIN_USER/PASSWORD.';

-- 2. Credencial ---------------------------------------------------------------
-- O PIN da 0105 passa a ser opcional: uma pessoa pode ter senha e não ter PIN.
-- As três colunas eram NOT NULL porque, quando nasceram, PIN era a única
-- credencial possível.

ALTER TABLE fin_person_acesso ALTER COLUMN pin_sha256 DROP NOT NULL;
ALTER TABLE fin_person_acesso ALTER COLUMN pin_salt   DROP NOT NULL;
ALTER TABLE fin_person_acesso ALTER COLUMN pin_set_by DROP NOT NULL;

ALTER TABLE fin_person_acesso ADD COLUMN IF NOT EXISTS senha_hash    text;
ALTER TABLE fin_person_acesso ADD COLUMN IF NOT EXISTS senha_set_at  timestamptz;
ALTER TABLE fin_person_acesso ADD COLUMN IF NOT EXISTS senha_set_by  text;
ALTER TABLE fin_person_acesso ADD COLUMN IF NOT EXISTS senha_trocar  boolean NOT NULL DEFAULT true;
ALTER TABLE fin_person_acesso ADD COLUMN IF NOT EXISTS falhas        integer NOT NULL DEFAULT 0;
ALTER TABLE fin_person_acesso ADD COLUMN IF NOT EXISTS bloqueado_ate timestamptz;

-- Linha sem credencial nenhuma não é "acesso sem senha": é lixo que faria a
-- consulta de login devolver uma pessoa sem ter o que conferir.
ALTER TABLE fin_person_acesso DROP CONSTRAINT IF EXISTS fin_person_acesso_tem_credencial;
ALTER TABLE fin_person_acesso ADD CONSTRAINT fin_person_acesso_tem_credencial
  CHECK (pin_sha256 IS NOT NULL OR senha_hash IS NOT NULL);

-- PIN e senha continuam completos ou ausentes — hash sem salt é hash inútil.
ALTER TABLE fin_person_acesso DROP CONSTRAINT IF EXISTS fin_person_acesso_pin_completo;
ALTER TABLE fin_person_acesso ADD CONSTRAINT fin_person_acesso_pin_completo
  CHECK ((pin_sha256 IS NULL) = (pin_salt IS NULL));

-- O formato do scrypt viaja com os parâmetros, para endurecer o custo amanhã
-- não invalidar as senhas de hoje.
ALTER TABLE fin_person_acesso DROP CONSTRAINT IF EXISTS fin_person_acesso_senha_formato;
ALTER TABLE fin_person_acesso ADD CONSTRAINT fin_person_acesso_senha_formato
  CHECK (senha_hash IS NULL OR senha_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[0-9a-f]+\$[0-9a-f]+$');

COMMENT ON COLUMN fin_person_acesso.senha_hash IS
  'scrypt$N$r$p$salt$hash, tudo hex. Não é sha256 como o PIN ao lado: quando /time sair de '
  'trás do Basic Auth esta senha vira a única barreira, e sha256 é rápido demais para isso.';

COMMENT ON COLUMN fin_person_acesso.senha_trocar IS
  'Nasce true. A senha que o admin define é de entrega, não de uso — quem definiu conhece o '
  'valor, então ela precisa morrer na primeira sessão da pessoa.';

COMMENT ON COLUMN fin_person_acesso.bloqueado_ate IS
  'Atraso progressivo depois de falhas seguidas. Não bloqueia para sempre: conta travada por '
  'tentativa alheia vira negação de serviço contra a própria pessoa.';

-- 3. O vocabulário de prova cresce -------------------------------------------
-- 'declarada' e 'pin' vieram da 0105. 'senha' entra agora; 'google' fica
-- reservado e é acrescentado quando o OAuth existir — não antes, para o CHECK
-- não aceitar um valor que nenhum código sabe produzir.

ALTER TABLE fin_time_sessao DROP CONSTRAINT IF EXISTS fin_time_sessao_prova_check;
ALTER TABLE fin_time_sessao ADD CONSTRAINT fin_time_sessao_prova_check
  CHECK (prova IN ('declarada', 'pin', 'senha'));

ALTER TABLE fin_time_envio DROP CONSTRAINT IF EXISTS fin_time_envio_identidade_prova_check;
ALTER TABLE fin_time_envio ADD CONSTRAINT fin_time_envio_identidade_prova_check
  CHECK (identidade_prova IN ('declarada', 'pin', 'senha'));

-- 4. Pós-condições ------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM fin_person_acesso;
  IF n <> 0 THEN
    RAISE EXCEPTION 'fin_person_acesso tem % linha(s); esta migration não semeia credencial e não deveria encontrar nenhuma', n;
  END IF;

  SELECT count(*) INTO n FROM fin_person WHERE email IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% pessoa(s) já com e-mail; o cadastro é ato humano, não semente de migration', n;
  END IF;

  SELECT count(*) INTO n FROM fin_person WHERE is_admin;
  IF n <> 0 THEN
    RAISE EXCEPTION '% pessoa(s) já marcada(s) como admin; quem é admin se declara fora da migration', n;
  END IF;

  -- A prova antiga continua aceita: nenhuma sessão viva pode ter sido invalidada.
  SELECT count(*) INTO n FROM fin_time_sessao WHERE prova NOT IN ('declarada', 'pin', 'senha');
  IF n <> 0 THEN
    RAISE EXCEPTION '% sessão(ões) com prova fora do vocabulário', n;
  END IF;
END $$;
