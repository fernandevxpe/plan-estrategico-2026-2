-- 0168 — Cadastro de pessoas: Dante, núcleos dos estagiários, Rita limpeza
--
-- Três correções de dado que a tela de custo com pessoas expôs em 24/08:
--
-- 1. `Dantre` é typo. O legal_name já diz "Dante Jose De Franca Lourenco"; o
--    apelido no roster é o que a tabela lista e o que o time busca.
--
-- 2. Dante e Sandro são estagiários de Consultoria (bolsa 6.06 batendo R$ 1.000
--    em ago/26). `area='consultoria'` sozinho NÃO entra no TIME_SQL antigo —
--    só `default_nucleo` — e os dois ficavam "Sem time". Preenche o núcleo.
--
-- 3. Rita faz a limpeza da empresa: vínculo `indefinido` e sem papel. O extrato
--    dela é 4.03 (cai como `extra` na view de remuneração). Passa a `irregular`
--    + papel Limpeza — irregular é "presta serviço sem enquadramento", que é o
--    caso; indefinido é "ainda não classificamos".

UPDATE fin_person
   SET name = 'Dante'
 WHERE id = 96
   AND name = 'Dantre';

UPDATE fin_person
   SET default_nucleo = 'consultoria'
 WHERE id IN (96, 97)
   AND coalesce(default_nucleo, '') <> 'consultoria';

UPDATE fin_person
   SET employment_type = 'irregular',
       role = 'Limpeza',
       area = coalesce(nullif(area, ''), 'administrativo')
 WHERE id = 107
   AND name = 'Rita Pereira Da Silva';

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM fin_person WHERE id = 96 AND name = 'Dante';
  IF n <> 1 THEN
    RAISE EXCEPTION 'pessoa 96 deveria se chamar Dante (achou %)', n;
  END IF;

  SELECT count(*) INTO n
    FROM fin_person
   WHERE id IN (96, 97) AND default_nucleo = 'consultoria';
  IF n <> 2 THEN
    RAISE EXCEPTION 'Dante e Sandro deveriam ter default_nucleo=consultoria (achou %)', n;
  END IF;

  SELECT count(*) INTO n
    FROM fin_person
   WHERE id = 107
     AND employment_type = 'irregular'
     AND role = 'Limpeza';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Rita (107) deveria ser irregular/Limpeza (achou %)', n;
  END IF;
END $$;
