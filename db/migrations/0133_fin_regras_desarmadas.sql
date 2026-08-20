-- Duas regras ativas ainda produzem os erros que esta frente já corrigiu à mão.
--
-- Corrigir o lançamento e deixar a regra que o causou no ar é consertar o
-- sintoma. As duas abaixo continuam armadas, e a próxima transação parecida
-- volta para o lugar errado sozinha.
--
-- ---------------------------------------------------------------------------
-- REGRA 48 `condominio-e-aluguel` → 5.01 Aluguel e condomínio
-- ---------------------------------------------------------------------------
-- Três agulhas, e as três estão erradas:
--
--   "4 tabeli de protesto"  É ELA que criou o pior erro do período. Um boleto
--                           de R$13.221,55 ao 4º Tabelionato de Protesto do
--                           Recife entrou como ALUGUEL. O ClickUp registra, em
--                           04/05, "Cabos parte 2" pelo valor idêntico: a
--                           Dimensional protestou a fatura de cabos não paga e
--                           a XPE quitou no cartório em 22/05. Cartório é meio
--                           de pagamento, como Cielo ou PJBank — nunca o
--                           credor. Sozinho, esse lançamento levou a linha de
--                           material de maio de 37,9% para 87,3% de aderência.
--
--   "loja do condominio"    O nome engana: é loja de material de construção,
--                           não administradora. Todas as compras dela, no banco
--                           e no cartão, foram revisadas para 4.02.
--
--   "iguep incorporadora"   MCC 5541 = Service Stations. O Nubank rotula como
--                           posto de gasolina, e há 18 precedentes de MCC 5541
--                           classificados em 5.06.
--
-- Sem agulha correta sobrando, a regra não tem o que fazer: vai para arquivada
-- ('inativa' não existe — o CHECK aceita ativa, proposta e arquivada).
-- O avaliador recusa lista vazia (`needles()` lança), então esvaziar seria
-- trocar um erro silencioso por uma exceção em produção.
--
-- ---------------------------------------------------------------------------
-- REGRA 49 `alimentacao-equipe` → 6.04
-- ---------------------------------------------------------------------------
-- A regra está certa; uma agulha não. "atacado dos presentes" é o Atacado dos
-- Presentes Ltda (CNPJ 09.515.628/0001-02, MCC 5331 Variety Stores): vende
-- brinquedo, armarinho, ferramenta, papelaria e utilidade doméstica. Não vende
-- comida. É a origem do rótulo "Alimentação" que o ClickUp carregava e que me
-- fez hesitar sobre esse fornecedor a sessão inteira.
--
-- A prova é a companhia que ele mantém no extrato: em 11/08 aparece no meio de
-- uma frente de obra, entre Oasis Tintas, Loja do Condomínio e Canal da
-- Construção — todos material. Fica só a agulha fora; o resto da regra segue.

UPDATE fin_rule
   SET status = 'arquivada',
       updated_at = now(),
       notes = COALESCE(notes || ' | ', '')
            || '0133: desativada. As três agulhas estavam erradas. "4 tabeli de protesto" mandava '
            || 'para aluguel a quitação de uma fatura de CABOS protestada pela Dimensional '
            || '(R$13.221,55, 22/05/2026) — cartório é meio de pagamento, não credor. '
            || '"loja do condominio" é loja de material de construção, revisada para 4.02 no banco '
            || 'e no cartão. "iguep incorporadora" tem MCC 5541 (posto), contra 18 precedentes em 5.06.'
 WHERE slug = 'condominio-e-aluguel' AND status = 'ativa';

UPDATE fin_rule
   SET conditions = jsonb_set(
         conditions,
         '{all,0,value}',
         (SELECT jsonb_agg(v) FROM jsonb_array_elements(conditions->'all'->0->'value') v
           WHERE v::text <> '"atacado dos presentes"')
       ),
       updated_at = now(),
       notes = COALESCE(notes || ' | ', '')
            || '0133: "atacado dos presentes" saiu da lista. É loja de variedades '
            || '(CNPJ 09.515.628/0001-02, MCC 5331) — brinquedo, ferramenta, papelaria. Não vende '
            || 'comida. Aparece no extrato de 11/08 entre Oasis Tintas e Canal da Construção, numa '
            || 'frente de obra. O resto da regra continua válido.'
 WHERE slug = 'alimentacao-equipe' AND status = 'ativa';

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  -- 1. Nenhuma regra ATIVA pode mandar cartório de protesto para aluguel.
  SELECT count(*) INTO v_n FROM fin_rule
   WHERE status = 'ativa' AND conditions::text ILIKE '%tabeli%';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% regra(s) ativa(s) ainda casam "tabelionato" — foi assim que R$13.221,55 de cabo virou aluguel', v_n;
  END IF;

  -- 2. Nenhuma regra ATIVA pode tratar o Atacado dos Presentes como alimentação.
  SELECT count(*) INTO v_n FROM fin_rule
   WHERE status = 'ativa' AND actions->>'category_code' = '6.04'
     AND conditions::text ILIKE '%atacado dos presentes%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'regra ativa ainda manda Atacado dos Presentes para 6.04 Alimentação';
  END IF;

  -- 3. A regra de alimentação não pode ter ficado sem agulha: o avaliador
  --    lança exceção em lista vazia, e isso quebraria a classificação inteira.
  SELECT jsonb_array_length(conditions->'all'->0->'value') INTO v_n
    FROM fin_rule WHERE slug = 'alimentacao-equipe';
  IF v_n IS NULL OR v_n < 4 THEN
    RAISE EXCEPTION 'alimentacao-equipe ficou com % agulha(s) — esperado 8', v_n;
  END IF;
END $$;
