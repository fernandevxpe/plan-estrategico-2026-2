-- Três regras de contraparte nasceram natimortas, e o preview jurava que não.
--
-- O DEFEITO
-- ---------
-- `virarRegra` (lib/financeiro/categorizacao.ts) gravava a condição como
-- `counterparty_name_norm = <nome cru em minúscula>`. Mas o motor preenche
-- esse campo com `fin_counterparty.normalized_name`, que passou por
-- `normalizeName` — sem forma societária (LTDA, CIA) e sem conectores
-- (de, da, do). As duas pontas nunca se encontram:
--
--   gravado na regra                    o que o motor compara
--   "denilson ferreira da silva"   ≠    "denilson ferreira silva"
--   "dimensional brasil solucoes ltda"  ≠    "dimensional brasil solucoes"
--   "ferreira costa & cia ltda"    ≠    "ferreira costa"
--
-- Nada acusava: a condição era válida, o slug era bonito, o status era
-- 'proposta'. As três tinham alcance ZERO e teriam continuado a ter depois de
-- ativadas — o pior tipo de defeito, o que se parece com trabalho pronto.
--
-- O preview era cúmplice: media com `lower(v.contraparte)`, o nome de
-- EXIBIÇÃO, e por isso relatava alcance de 10/12/48 itens para regras que
-- casariam nenhum. Preview e motor mediam coisas diferentes. Corrigido no
-- mesmo commit desta migration, para o defeito não voltar pela próxima regra.
--
-- O QUE ESTA MIGRATION FAZ, ALÉM DE NORMALIZAR
-- --------------------------------------------
-- Ao medir o alcance REAL das três, apareceram dois problemas que a versão
-- quebrada escondia — e que ativar sem corrigir teria transformado em dinheiro
-- no lugar errado:
--
--  1. FERREIRA COSTA tem um "Reembolso recebido pelo Pix" de R$ 321,40
--     (22/04/2026): dinheiro VOLTANDO da loja. Uma regra por contraparte pura
--     carimbaria isso como 4.02 Material de obra — devolução virando custo.
--     Guarda `direction = 'pagar'` em todas as três, porque toda as três são
--     regras de despesa e nenhuma delas tem o que fazer com uma entrada.
--
--  2. DENILSON não é uma população, são duas. A mensalidade fixa (R$ 1.800 a
--     R$ 2.100, sempre no dia 1) convive com dezenas de PIX miúdos de R$ 10 a
--     R$ 100 que o ClickUp registra como Alimentação/reembolso — nove deles já
--     classificados à mão em 6.05 com evidência do ClickUp. Uma regra por
--     contraparte pura varreria os miúdos para 4.03 Terceirização e desfaria
--     essa revisão. O piso `amount_abs >= 100000` (R$ 1.000) separa as duas
--     populações pelo único critério que o extrato oferece.
--
-- CONSEQUÊNCIA QUE PRECISA DE OLHO HUMANO
-- ---------------------------------------
-- A regra do Denilson, quando rodar, move 9 lançamentos e R$ 18.600,00 de
-- `6.01 Salários` para `4.03 Terceirização`. Isso é a "dúvida 0" do repositório
-- (pró-labore/salário/terceirização têm encargo e IR diferentes) aplicada a um
-- caso específico. O que sustenta a decisão: o ClickUp registra "eletricista
-- terceirizado", e a XPE não tem CLT — o time é MEI. Ativar aqui é decisão
-- registrada, não automática: está escrita nesta migration para poder ser
-- revertida por outra.
--
-- ATIVAR REGRA NÃO REESCREVE O PASSADO. `fin_rule` é consultada pelo motor de
-- classificação; os lançamentos já gravados mantêm sua categoria até que uma
-- importação ou uma re-classificação explícita passe por eles. Esta migration
-- muda o que vale DAQUI PARA A FRENTE.

-- ---------------------------------------------------------------------------
-- 1. As três regras: valor normalizado + guarda de direção + piso no Denilson
-- ---------------------------------------------------------------------------

UPDATE fin_rule SET
  conditions = jsonb_build_object('all', jsonb_build_array(
    jsonb_build_object('op','equals','field','counterparty_name_norm','value','dimensional brasil solucoes'),
    jsonb_build_object('op','equals','field','direction','value','pagar')
  )),
  status = 'ativa',
  updated_at = now(),
  notes = notes || ' | 0127: valor da condição estava CRU (nome de exibição) e o motor compara o '
                || 'normalizado — a regra tinha alcance zero. Normalizado e ativada, com guarda de direção.'
WHERE slug = 'categorizacao-dimensional-brasil-solucoes-ltda';

UPDATE fin_rule SET
  conditions = jsonb_build_object('all', jsonb_build_array(
    jsonb_build_object('op','equals','field','counterparty_name_norm','value','ferreira costa'),
    jsonb_build_object('op','equals','field','direction','value','pagar')
  )),
  status = 'ativa',
  updated_at = now(),
  notes = notes || ' | 0127: valor da condição estava CRU — alcance era zero. Normalizado e ativada. '
                || 'A guarda direction=pagar não é enfeite: existe um "Reembolso recebido pelo Pix" de '
                || 'R$ 321,40 (22/04/2026) desta mesma loja, e sem a guarda a regra transformaria '
                || 'devolução de dinheiro em custo de material.'
WHERE slug = 'categorizacao-ferreira-costa-cia-ltda';

UPDATE fin_rule SET
  conditions = jsonb_build_object('all', jsonb_build_array(
    jsonb_build_object('op','equals','field','counterparty_name_norm','value','denilson ferreira silva'),
    jsonb_build_object('op','equals','field','direction','value','pagar'),
    jsonb_build_object('op','gte','field','amount_abs','value',100000)
  )),
  status = 'ativa',
  updated_at = now(),
  notes = notes || ' | 0127: valor da condição estava CRU — alcance era zero. Deixou de ser regra de '
                || 'contraparte pura: os pagamentos ao Denilson são DUAS populações — a mensalidade fixa '
                || '(R$1.800 a R$2.100, dia 1) e dezenas de PIX miúdos de R$10 a R$100 que o ClickUp '
                || 'registra como Alimentação. Sem o piso de R$1.000 a regra varreria os miúdos para 4.03.'
WHERE slug = 'categorizacao-denilson-ferreira-da-silva';

-- ---------------------------------------------------------------------------
-- 2. Uber: a lição de jan/fev/mar virando regra em vez de trabalho manual
-- ---------------------------------------------------------------------------
-- Corrida de Uber apareceu nos três meses caindo em 5.99, 5.06 e até 6.01, e
-- nos três meses foi corrigida à mão pelo cruzamento com o ClickUp. É a
-- contraparte mais estável do acervo — nome único, sem homônimo, sempre saída.
-- Se alguma coisa deste trabalho merecia virar regra, é esta.

INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions,
                      confidence, source, status, created_by, notes)
SELECT e.id,
       'categorizacao-uber-brasil-tecnologia',
       'Categorização: Uber — deslocamento de serviço',
       120,
       'transaction',
       jsonb_build_object('all', jsonb_build_array(
         jsonb_build_object('op','equals','field','counterparty_name_norm','value','uber brasil tecnologia'),
         jsonb_build_object('op','equals','field','direction','value','pagar')
       )),
       jsonb_build_object('category_code', '4.04'),
       70,
       'humano',
       'ativa',
       'migration-0127',
       'Confirmado por cruzamento com ClickUp em jan/fev/mar 2026: corrida de Uber é deslocamento '
       'atribuível a serviço (4.04), não despesa administrativa. Caía em 5.99/5.06/6.01 por falta de '
       'regra, e foi corrigida à mão nos três meses. 35 lançamentos já estão em 4.04 por revisão '
       'humana; 11 ainda em 5.99 no momento desta migration.'
  FROM fin_entity e WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO UPDATE
   SET conditions = EXCLUDED.conditions,
       actions    = EXCLUDED.actions,
       status     = 'ativa',
       notes      = EXCLUDED.notes,
       updated_at = now();

-- ---------------------------------------------------------------------------
-- Pós-condição — o defeito não pode sobreviver a esta migration
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cru      int;
  v_zero     text;
  v_denilson jsonb;
BEGIN
  -- 1. Nenhuma regra ATIVA pode comparar counterparty_name_norm contra um valor
  --    que `normalizeName` mudaria: forma societária ou conector no meio é a
  --    assinatura exata do defeito que esta migration corrige.
  SELECT count(*) INTO v_cru
    FROM fin_rule r,
         LATERAL jsonb_array_elements(COALESCE(r.conditions->'all','[]'::jsonb)) c
   WHERE r.status = 'ativa'
     AND c->>'field' = 'counterparty_name_norm'
     AND c->>'value' ~ '(^| )(ltda|cia|eireli|epp|mei|spe|slu|de|da|do|das|dos|e)( |$)';
  IF v_cru > 0 THEN
    RAISE EXCEPTION 'ainda há % regra(s) ativa(s) comparando contraparte com nome não normalizado', v_cru;
  END IF;

  -- 2. Cada uma das quatro tem de casar pelo menos um lançamento do acervo de
  --    hoje. Alcance zero foi exatamente o sintoma que ninguém viu.
  SELECT string_agg(r.slug, ', ') INTO v_zero
    FROM fin_rule r
   WHERE r.slug IN ('categorizacao-dimensional-brasil-solucoes-ltda',
                    'categorizacao-ferreira-costa-cia-ltda',
                    'categorizacao-denilson-ferreira-da-silva',
                    'categorizacao-uber-brasil-tecnologia')
     AND NOT EXISTS (
       SELECT 1 FROM fin_transaction t
         JOIN fin_counterparty cp ON cp.id = t.counterparty_id
        WHERE cp.normalized_name = (r.conditions->'all'->0->>'value')
          AND t.amount_cents < 0
     );
  IF v_zero IS NOT NULL THEN
    RAISE EXCEPTION 'regra(s) com alcance zero após a correção: %', v_zero;
  END IF;

  -- 3. O piso do Denilson tem de continuar lá. Sem ele a regra desfaz as nove
  --    classificações de 6.05 feitas com evidência do ClickUp.
  SELECT r.conditions INTO v_denilson
    FROM fin_rule r WHERE r.slug = 'categorizacao-denilson-ferreira-da-silva';
  IF NOT (v_denilson->'all' @> '[{"op":"gte","field":"amount_abs","value":100000}]'::jsonb) THEN
    RAISE EXCEPTION 'a regra do Denilson perdeu o piso de R$1.000 — ela varreria os PIX de alimentação para 4.03';
  END IF;
END $$;
