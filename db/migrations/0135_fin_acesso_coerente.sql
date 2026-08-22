-- Conserta três frouxidões que a 0134 deixou em fin_person_acesso.
--
-- A 0134 já está aplicada e o runner a congela por checksum, então correção só
-- por migration nova. Nenhuma delas é explorável hoje (a tabela está vazia);
-- todas passam a ser representáveis assim que `definir-acesso.mjs` criar a
-- primeira linha, e é por isso que entram antes e não depois.
--
-- ---------------------------------------------------------------------------
-- 1. `pin_set_at` ficou NOT NULL DEFAULT now() — e vira ficção
-- ---------------------------------------------------------------------------
-- A 0134 soltou `pin_sha256`, `pin_salt` e `pin_set_by`, e esqueceu deste. Toda
-- linha criada só com SENHA ganharia um "PIN definido em <hoje>" para um PIN
-- que nunca existiu. Uma auditoria futura sobre essa coluna leria uma data
-- inventada — exatamente o tipo de número que parece certo e é pior que vazio,
-- que é a regra desta base.
--
-- ---------------------------------------------------------------------------
-- 2. O par de completude do PIN esqueceu o autor
-- ---------------------------------------------------------------------------
-- `fin_person_acesso_pin_completo` amarra só `pin_sha256` ↔ `pin_salt`. Como a
-- 0134 tornou `pin_set_by` nulo e o deixou fora do par, passou a ser
-- representável um PIN válido SEM autor registrado — perda de auditoria que a
-- 0105 garantia por NOT NULL.
--
-- ---------------------------------------------------------------------------
-- 3. A senha não tinha par de completude nenhum
-- ---------------------------------------------------------------------------
-- `senha_hash` sem `senha_set_at`/`senha_set_by` é uma credencial válida sem
-- rastro de quem a criou e quando. Para uma senha que abre o app pela internet,
-- isso é pior do que para o PIN.
--
-- ---------------------------------------------------------------------------
-- E uma correção de ponteiro
-- ---------------------------------------------------------------------------
-- O comentário da 0134 manda usar `scripts/definir-senha.mjs`. Esse arquivo não
-- existe: o script é `scripts/definir-acesso.mjs`. O texto lá está congelado,
-- então o COMMENT da tabela abaixo é o que passa a valer.
-- ===========================================================================

ALTER TABLE fin_person_acesso ALTER COLUMN pin_set_at DROP NOT NULL;
ALTER TABLE fin_person_acesso ALTER COLUMN pin_set_at DROP DEFAULT;

ALTER TABLE fin_person_acesso DROP CONSTRAINT IF EXISTS fin_person_acesso_pin_completo;
ALTER TABLE fin_person_acesso ADD CONSTRAINT fin_person_acesso_pin_completo
  CHECK (
    (pin_sha256 IS NULL) = (pin_salt IS NULL)
    AND (pin_sha256 IS NULL) = (pin_set_by IS NULL)
    AND (pin_sha256 IS NULL) = (pin_set_at IS NULL)
  );

ALTER TABLE fin_person_acesso DROP CONSTRAINT IF EXISTS fin_person_acesso_senha_completa;
ALTER TABLE fin_person_acesso ADD CONSTRAINT fin_person_acesso_senha_completa
  CHECK (
    (senha_hash IS NULL) = (senha_set_at IS NULL)
    AND (senha_hash IS NULL) = (senha_set_by IS NULL)
  );

COMMENT ON TABLE fin_person_acesso IS
  'Credencial por pessoa do time: PIN (0105) e/ou senha (0134). Nasce VAZIA — semear credencial '
  'que ninguém combinou é inventar governança. As linhas entram por scripts/definir-acesso.mjs '
  '(o comentário da 0134 diz "definir-senha.mjs"; esse arquivo não existe). Cada credencial é '
  'completa ou ausente: hash, autor e data andam juntos, senão a auditoria lê ficção.';

-- Pós-condições ---------------------------------------------------------------
-- Diferente da 0134, estas verificam o que a migration ACABOU DE FAZER, em vez
-- de afirmar sobre colunas recém-criadas (que são vazias por construção e
-- transformam a asserção em decoração).

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_name = 'fin_person_acesso' AND column_name = 'pin_set_at'
     AND (is_nullable <> 'YES' OR column_default IS NOT NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION 'pin_set_at continua obrigatório ou com default; linha só-senha gravaria data de PIN inexistente';
  END IF;

  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'fin_person_acesso'::regclass
     AND conname IN ('fin_person_acesso_pin_completo', 'fin_person_acesso_senha_completa', 'fin_person_acesso_tem_credencial');
  IF n <> 3 THEN
    RAISE EXCEPTION 'esperava 3 CHECKs de coerência em fin_person_acesso, encontrei %', n;
  END IF;

  -- Prova que os CHECKs realmente recusam o estado incompleto, em vez de
  -- confiar que o texto do CHECK diz o que parece dizer.
  BEGIN
    INSERT INTO fin_person_acesso (person_id, senha_hash)
    SELECT id, 'scrypt$16384$8$1$aa$' || repeat('b', 64) FROM fin_person LIMIT 1;
    RAISE EXCEPTION 'senha sem autor e sem data foi aceita — o CHECK de completude não está pegando';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;
