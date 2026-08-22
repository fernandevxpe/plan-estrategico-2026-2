-- O cartão final 5585 vai para o Inter, que é onde ele sempre esteve.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECEU
-- ---------------------------------------------------------------------------
-- Em 22/08/2026 às 20:19 o Fernando cadastrou o final 5585 pelo app, em
-- produção, e escreveu no apelido "Inter xpe igor". O plástico foi gravado na
-- conta 1 — Nubank.
--
-- Não foi erro dele. `CadastrarCartao` inicializava o banco com
-- `inicial?.banco || bancos[0]`, e como a foto NUNCA informa o banco, o
-- primeiro da lista vinha marcado sozinho. Quem não tocasse nos chips salvava
-- no Nubank sem ter escolhido nada. O apelido dizia Inter; o registro dizia
-- Nubank.
--
-- A causa foi corrigida no mesmo commit em que este arquivo entra: o campo
-- nasce vazio e o botão diz "escolha o banco" até ter resposta. Esta migration
-- conserta a linha que a versão anterior produziu.
--
-- POR QUE MIGRATION E NÃO UM UPDATE SOLTO
-- Porque é dado que uma pessoa digitou e um sistema desviou, e daqui a seis
-- meses alguém vai perguntar por que o 5585 mudou de banco. Um UPDATE no
-- console não responde; este arquivo responde.
--
-- POR QUE SÓ O BANCO
-- O apelido sugere que quem carrega o plástico é o Igor, e `holder_person_id`
-- existe para isso. Mas isso é LEITURA de um texto livre, não fato confirmado —
-- e o Fernando confirmou o banco, não o portador. Inferir o resto seria trocar
-- um dado errado por um palpite, que é pior: o errado a gente vê.
-- ===========================================================================

DO $$
DECLARE
  inter_id bigint;
  nubank_id bigint;
  alvo record;
BEGIN
  SELECT a.id INTO inter_id
    FROM fin_card_account a
    LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
   WHERE coalesce(i.name, a.name) ILIKE '%inter%' AND a.is_active
   LIMIT 1;
  IF inter_id IS NULL THEN RAISE EXCEPTION 'não achei a conta do Inter'; END IF;

  SELECT a.id INTO nubank_id
    FROM fin_card_account a
    LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
   WHERE coalesce(i.name, a.name) ILIKE '%nubank%'
   LIMIT 1;

  -- Condicionado ao estado exato que se quer consertar: se o cartão já tiver
  -- sido movido à mão, ou se outro 5585 legítimo existir no Nubank amanhã,
  -- esta migration não faz nada em vez de mexer no plástico errado.
  SELECT c.id, c.label INTO alvo
    FROM fin_card c
   WHERE c.last4 = '5585'
     AND c.card_account_id = nubank_id
     AND c.origem = 'app_time'
     AND c.label ILIKE '%inter%';

  IF alvo.id IS NULL THEN
    RAISE NOTICE 'nada a corrigir: nenhum 5585 do app no Nubank com apelido de Inter';
    RETURN;
  END IF;

  -- O índice único é (card_account_id, last4): mover para uma conta que já
  -- tenha 5585 quebraria. Confere antes para a mensagem ser legível.
  IF EXISTS (SELECT 1 FROM fin_card WHERE card_account_id = inter_id AND last4 = '5585') THEN
    RAISE EXCEPTION 'o Inter já tem um plástico final 5585 — os dois precisam ser conferidos à mão';
  END IF;

  UPDATE fin_card SET card_account_id = inter_id WHERE id = alvo.id;

  INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
  VALUES (
    (SELECT id FROM fin_entity WHERE slug = 'xpe'),
    'fin_card', alvo.id, 'update',
    jsonb_build_object('card_account_id', nubank_id, 'banco', 'Nubank'),
    jsonb_build_object('card_account_id', inter_id, 'banco', 'Banco Inter'),
    ARRAY['card_account_id'],
    'migration:0148 — banco pré-selecionado gravou o plástico na conta errada'
  );

  RAISE NOTICE 'cartão % (%): Nubank -> Inter', alvo.id, alvo.label;
END $$;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
BEGIN
  -- O 5585 do app está no Inter.
  SELECT count(*) INTO n
    FROM fin_card c
    JOIN fin_card_account a ON a.id = c.card_account_id
    LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
   WHERE c.last4 = '5585' AND c.origem = 'app_time' AND coalesce(i.name, a.name) ILIKE '%inter%';
  IF n <> 1 THEN RAISE EXCEPTION 'esperava 1 plástico 5585 do app no Inter, há %', n; END IF;

  -- E não sobrou nenhum no Nubank.
  SELECT count(*) INTO n
    FROM fin_card c
    JOIN fin_card_account a ON a.id = c.card_account_id
    LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
   WHERE c.last4 = '5585' AND c.origem = 'app_time' AND coalesce(i.name, a.name) ILIKE '%nubank%';
  IF n <> 0 THEN RAISE EXCEPTION '% plástico(s) 5585 do app ainda no Nubank', n; END IF;

  -- O Inter deixou de ter zero plásticos, que era o buraco que impedia casar
  -- os R$ 40.862,41 de gasto sem itemização de 2026.
  SELECT count(*) INTO n
    FROM fin_card c
    JOIN fin_card_account a ON a.id = c.card_account_id
    LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
   WHERE coalesce(i.name, a.name) ILIKE '%inter%' AND c.status <> 'cancelado';
  RAISE NOTICE 'o Inter passa a ter % plástico(s) cadastrado(s)', n;
END $$;
