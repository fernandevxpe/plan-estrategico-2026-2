-- Custo com pessoas: o que o fisco vê e o que a gestão precisa ver.
--
-- ---------------------------------------------------------------------------
-- A PERGUNTA QUE ORIGINOU ISTO
-- ---------------------------------------------------------------------------
-- Do Fernando, sobre 205 lançamentos hoje em 6.02 Pró-labore:
--
--   "na prática é salário, mas contabilmente é pró-labore para reduzir
--    impostos. Então mesmo que conte pró-labore na análise de custos deve
--    contar como salário. Quando eu for analisar custo com folha, quero contar
--    tudo isso."
--
-- Isso não é ambiguidade a resolver escolhendo um lado: são dois eixos legítimos
-- sobre o mesmo fato. A natureza FISCAL do pagamento é pró-labore, e mudá-la
-- para salário alteraria a base de encargo e IR que a empresa declara. A
-- natureza GERENCIAL é custo de gente, e deixá-la de fora subestima a folha.
--
-- O modelo já separa os dois, e é por isso que esta migration quase não cria
-- estrutura: `fin_category.code` carrega o eixo fiscal (6.01 · 6.02 · 6.06…) e
-- `cash_flow_group = 'pessoal'` carrega o gerencial. As 6.xx todas já estão em
-- 'pessoal'. A análise de folha soma o grupo e o pró-labore entra sozinho.
--
-- Medido em 15/08/2026:
--
--   6.01 Salários .......... 268 lançamentos   R$ 308.816,46
--   6.02 Pró-labore ........ 238              R$ 364.471,08
--   6.03 Encargos ..........   5              R$   3.520,88
--   6.04 Benefícios ........  63              R$   6.354,52
--   6.06 Estágio ...........  17              R$  17.831,95
--   ─────────────────────────────────────────────────────────
--   custo com pessoas .....................   R$ 700.994,89
--
-- ---------------------------------------------------------------------------
-- 1. A REGRA 42 SAI DE CIRCULAÇÃO
-- ---------------------------------------------------------------------------
-- `pix-pessoa-fisica` (prioridade 200, confiança 60) diz, na íntegra:
--
--   SE a descrição contém "pix enviado" E a direção é pagar
--   ENTÃO categoria 6.01 Salários
--
-- Ou seja: QUALQUER pix enviado vira salário. É por isso que rodar o motor
-- sobre o Inter trocaria 205 linhas de pró-labore — não porque descobriu algo
-- sobre elas, mas porque a condição não olha para quem recebeu.
--
-- Ela decide por texto de extrato quando existe cadastro: `fin_person` tem as
-- 28 pessoas com `employment_type` e `default_category_id`, e 9 sócios já
-- apontam para 6.02. Preferir a descrição a esse cadastro é trocar fato por
-- pista.
UPDATE fin_rule
   SET status = 'arquivada',
       notes = COALESCE(notes || E'\n', '') ||
               'Arquivada em 2026-08-15: condição genérica demais ("qualquer pix enviado ⇒ 6.01"). '
               'Trocaria 205 lançamentos de pró-labore para salários sem olhar quem recebeu, '
               'com efeito em encargo e IR. Substituída pela categoria padrão da pessoa '
               '(fin_person.default_category_id), que é cadastro e não heurística.'
 WHERE slug = 'pix-pessoa-fisica';

-- ---------------------------------------------------------------------------
-- 2. A VISÃO GERENCIAL DA FOLHA
-- ---------------------------------------------------------------------------
-- Uma view e não um relatório em código porque a definição de "custo com
-- pessoas" tem uma decisão dentro — se MEI entra — e duas telas que a tomem
-- separado vão discordar no fim do mês.
--
-- MEI entra em coluna PRÓPRIA, somada no total gerencial mas visível à parte.
-- São 12 das 28 pessoas cadastradas: juridicamente é contratação de serviço,
-- na prática é gente trabalhando na empresa. Quem olha folha quer o número com
-- MEI; quem olha obrigação trabalhista quer sem. A view entrega os dois.
CREATE OR REPLACE VIEW fin_custo_pessoas_v AS
WITH base AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         c.code,
         c.name AS categoria,
         t.nucleo,
         p.employment_type,
         abs(t.amount_cents) AS cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    LEFT JOIN fin_person p ON p.counterparty_id = t.counterparty_id
   WHERE t.amount_cents < 0
     AND (c.cash_flow_group = 'pessoal' OR p.employment_type = 'mei')
)
SELECT mes,
       COALESCE(nucleo, '(sem núcleo)')                                   AS nucleo,
       -- Eixo fiscal preservado: cada linha continua sabendo o que é.
       sum(cents) FILTER (WHERE code = '6.01')                            AS salarios_cents,
       sum(cents) FILTER (WHERE code = '6.02')                            AS prolabore_cents,
       sum(cents) FILTER (WHERE code = '6.03')                            AS encargos_cents,
       sum(cents) FILTER (WHERE code = '6.04')                            AS beneficios_cents,
       sum(cents) FILTER (WHERE code = '6.06')                            AS estagio_cents,
       sum(cents) FILTER (WHERE code IN ('6.05','6.07','6.08'))           AS outros_pessoal_cents,
       sum(cents) FILTER (WHERE employment_type = 'mei'
                            AND code NOT LIKE '6.%')                      AS mei_cents,
       -- Eixo gerencial: é este número que responde "quanto custa a folha".
       -- Pró-labore entra aqui sem deixar de ser pró-labore lá em cima.
       sum(cents) FILTER (WHERE code LIKE '6.%')                          AS folha_sem_mei_cents,
       sum(cents)                                                         AS folha_total_cents
  FROM base
 GROUP BY mes, COALESCE(nucleo, '(sem núcleo)');

COMMENT ON VIEW fin_custo_pessoas_v IS
  'Custo com pessoas por mês e núcleo, nos dois eixos. As colunas por código são a natureza '
  'FISCAL (pró-labore continua pró-labore, porque muda encargo e IR). folha_sem_mei_cents e '
  'folha_total_cents são a natureza GERENCIAL — o que a empresa gasta com gente, somando '
  'pró-labore, salário, encargo, benefício e estágio. MEI fica em coluna própria: entra no '
  'total porque na prática é gente trabalhando, e fica visível à parte porque juridicamente '
  'é contratação de serviço.';

-- ---------------------------------------------------------------------------
-- 3. A CATEGORIA PADRÃO DA PESSOA PASSA A VALER
-- ---------------------------------------------------------------------------
-- Substitui a regra arquivada pela informação de cadastro: quem recebeu define
-- o que é, e não o texto que o banco escreveu. Só age onde não há categoria —
-- nunca sobrescreve classificação existente, humana ou não.
--
-- Sócio e sócio-administrador já apontam para 6.02, estagiário para 6.06. Os 12
-- MEI seguem sem categoria padrão de propósito: o serviço que cada um presta é
-- que decide a conta, e chutar uma aqui seria inventar.
CREATE OR REPLACE FUNCTION fin_transaction_categoria_da_pessoa() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_categoria bigint;
BEGIN
  IF NEW.category_id IS NOT NULL OR NEW.counterparty_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Só despesa: um crédito vindo de um sócio não é pró-labore, é aporte ou
  -- devolução, e merece decisão em vez de rótulo automático.
  IF NEW.amount_cents >= 0 THEN
    RETURN NEW;
  END IF;
  SELECT p.default_category_id INTO v_categoria
    FROM fin_person p
   WHERE p.counterparty_id = NEW.counterparty_id
     AND p.default_category_id IS NOT NULL
     AND COALESCE(p.status, 'ativo') <> 'inativo'
   LIMIT 1;
  IF v_categoria IS NOT NULL THEN
    NEW.category_id := v_categoria;
    NEW.classified_by := 'fato_estrutural';
    NEW.classified_reason := jsonb_build_object(
      'origem', 'categoria_padrao_da_pessoa',
      'motivo', 'a pessoa cadastrada define a natureza do pagamento; a descrição do extrato não'
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_transaction_categoria_pessoa ON fin_transaction;
CREATE TRIGGER fin_transaction_categoria_pessoa
  BEFORE INSERT OR UPDATE OF counterparty_id ON fin_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_transaction_categoria_da_pessoa();

COMMENT ON FUNCTION fin_transaction_categoria_da_pessoa() IS
  'Aplica fin_person.default_category_id a despesa sem categoria cuja contraparte é pessoa '
  'cadastrada. Substitui a regra pix-pessoa-fisica, arquivada por decidir via texto do extrato '
  'o que o cadastro já responde. Não toca em linha que já tem categoria, nem em crédito.';
