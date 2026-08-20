-- Fornecedores de refeição viram regra; o reembolso genérico NÃO vira.
--
-- O QUE ESTA MIGRATION DECIDIU NÃO FAZER, E POR QUÊ
-- -------------------------------------------------
-- A divergência mais teimosa da reconciliação jan–mai/2026 é reembolso
-- classificado como salário: `6.05 Reembolsos` aparece entre 5% e 45% da
-- planilha em todos os meses, sempre abaixo, enquanto a folha aparece sempre
-- acima. São o mesmo dinheiro no lugar errado.
--
-- Havia um padrão candidato, e ele é forte: 226 dos 256 pagamentos de folha
-- de 2026 caem nos dias 1 a 3 do mês (o lote da folha), e 63 dos 73 reembolsos
-- caem entre os dias 4 e 27. A regra "pagamento miúdo a alguém do time, fora
-- da janela da folha, é reembolso" parecia pronta.
--
-- Ela foi medida contra o acervo antes de existir, e reprovou. Pegaria 74
-- lançamentos:
--
--     47 já em 6.05   (acerto, reforço)
--     11 em 6.01      (acerto — é exatamente o erro que queremos pegar)
--      9 em 4.04      ERRO: deslocamento confirmado pelo ClickUp
--      7 em 4.02      ERRO: material confirmado pelo ClickUp
--
-- 16 de 74 é 22% de erro, e os 16 são classificações que uma pessoa já revisou
-- com evidência. As travas humanas protegeriam ESTAS, mas não as próximas: um
-- Uber de R$ 50 para o Marcelo no dia 15 seria carimbado como alimentação.
--
-- A razão é estrutural, e vale registrar porque ela decide o que automatizar
-- daqui pra frente: alimentação, transporte e material miúdo, para a MESMA
-- pessoa, na MESMA faixa de valor, no MESMO dia do mês, são indistinguíveis
-- no extrato. O que os separa é o campo Categoria do ClickUp, preenchido por
-- quem pagou no momento em que pagou. O cruzamento mensal com o ClickUp não é
-- redundante com o banco — ele carrega o único sinal que existe.
--
-- Há ainda um segundo motivo, que veio do Fernando: quem não recebe comissão
-- tem valor fixo "e pode ganhar mais por diárias". Diária é pagamento por dia
-- trabalhado — custo de trabalho, não reembolso — e no extrato uma diária de
-- R$ 100 é idêntica a um almoço de R$ 100.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
-- Só o que a contraparte resolve sozinha. Quatro fornecedores cujo pagamento
-- só pode ser refeição, independente de valor, dia ou pessoa. Não precisam de
-- piso, teto nem janela — o nome já é a evidência.

INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions,
                      confidence, source, status, created_by, notes)
SELECT e.id, v.slug, v.nome, 120, 'transaction',
       jsonb_build_object('all', jsonb_build_array(
         jsonb_build_object('op','equals','field','counterparty_name_norm','value',v.contraparte),
         jsonb_build_object('op','equals','field','direction','value','pagar')
       )),
       jsonb_build_object('category_code','6.05'),
       70, 'humano', 'ativa', 'migration-0128', v.nota
  FROM fin_entity e
  CROSS JOIN (VALUES
    ('categorizacao-rita-cassia-acioli-lins',
     'Categorização: Rita de Cássia — refeições da equipe',
     'rita cassia acioli lins 11092367438',
     'Oito pagamentos entre 09/04 e 07/05/2026, de R$47,00 a R$122,00, sempre no meio do mês, '
     'TODOS confirmados pelo ClickUp como Alimentação e nenhum em qualquer outra categoria. '
     'Fornecedora recorrente de refeição para a equipe.'),
    ('categorizacao-robson-jose-santana',
     'Categorização: Robson José — refeições da equipe',
     'robson jose santana',
     'Dois pagamentos de R$115,00 (26/03 e 01/04/2026), ambos confirmados pelo ClickUp como '
     'Alimentação. Repare que um deles caiu no dia 1 — dentro da janela da folha: é a prova de '
     'que a janela sozinha nunca serviria como regra.'),
    ('categorizacao-sao-braz-nova-delicatessen',
     'Categorização: São Braz Delicatessen — refeições',
     'sao braz nova delicatessen',
     'Delicatessen. Pagamento a estabelecimento de alimentação só pode ser refeição, qualquer que '
     'seja o valor ou o dia — por isso esta regra não precisa de teto nem de janela.'),
    ('categorizacao-o-rei-das-coxinhas',
     'Categorização: O Rei das Coxinhas — refeições',
     'o rei coxinhas',
     'Estabelecimento de alimentação, mesma lógica da São Braz: a contraparte resolve sozinha, '
     'sem depender de valor, dia do mês ou de quem pediu.')
  ) AS v(slug, nome, contraparte, nota)
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO UPDATE
   SET conditions = EXCLUDED.conditions, actions = EXCLUDED.actions,
       status = 'ativa', notes = EXCLUDED.notes, updated_at = now();

-- ---------------------------------------------------------------------------
-- Pós-condição
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_zero text; v_cru int;
BEGIN
  -- Mesma prova da 0127: nome normalizado, e nenhuma regra nova nasce sem alcance.
  SELECT count(*) INTO v_cru
    FROM fin_rule r, LATERAL jsonb_array_elements(COALESCE(r.conditions->'all','[]'::jsonb)) c
   WHERE r.created_by = 'migration-0128'
     AND c->>'field' = 'counterparty_name_norm'
     AND c->>'value' ~ '(^| )(ltda|cia|eireli|epp|mei|spe|slu|de|da|do|das|dos|e)( |$)';
  IF v_cru > 0 THEN
    RAISE EXCEPTION '% regra(s) da 0128 comparam contraparte com nome não normalizado', v_cru;
  END IF;

  SELECT string_agg(r.slug, ', ') INTO v_zero
    FROM fin_rule r
   WHERE r.created_by = 'migration-0128'
     AND NOT EXISTS (
       SELECT 1 FROM fin_transaction t JOIN fin_counterparty cp ON cp.id = t.counterparty_id
        WHERE cp.normalized_name = (r.conditions->'all'->0->>'value') AND t.amount_cents < 0);
  IF v_zero IS NOT NULL THEN
    RAISE EXCEPTION 'regra(s) da 0128 com alcance zero: %', v_zero;
  END IF;

  -- E a prova que dá nome a esta migration: nenhuma regra ATIVA pode classificar
  -- por faixa de valor + dia do mês para contraparte de pessoa do time. Se um dia
  -- alguém tentar, o teste acima (22% de erro medido) tem de ser refeito antes.
  IF EXISTS (
    SELECT 1 FROM fin_rule r
     WHERE r.status = 'ativa'
       AND r.actions->>'category_code' = '6.05'
       AND r.conditions::text LIKE '%day_of_month%'
  ) THEN
    RAISE EXCEPTION 'existe regra ativa de 6.05 usando day_of_month — ver o cabeçalho desta migration';
  END IF;
END $$;
