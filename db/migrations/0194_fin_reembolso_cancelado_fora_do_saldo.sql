-- O que foi CANCELADO deixa de ser oferecido para pagamento.
--
-- O DEFEITO, MEDIDO EM 02/10/2026 AO PROGRAMAR O REEMBOLSO DE OUTUBRO
-- -------------------------------------------------------------------
-- Dois cancelamentos que a casa já tinha decidido continuavam na conta do
-- "a pagar":
--
--   1. Cleber, itens 901 e 902 do app (R$ 508,00). Ele mesmo cancelou em 30/09
--      como "lançamento errado". A 0179 filtra `pago` e `rejeitado` e esqueceu
--      `cancelado` — status que a 0157 criou DEPOIS do filtro ser pensado. A
--      tela oferecia R$ 846,46 para quem tem R$ 338,46 em aberto.
--
--   2. Fernando, série `tv` da planilha (R$ 108,29 × 23 parcelas restantes =
--      R$ 2.490,67 de saldo). O dono, em 02/10: "a tv, a parcela foi
--      cancelada". Não havia onde dizer isso: `fin_reembolso_saldo_v` (0129)
--      calcula o saldo só da última linha da série e não conhece cancelamento.
--
-- ONDE O CANCELAMENTO DE SÉRIE MORA
-- ---------------------------------
-- `fin_reembolso_slug_cancelado` existe desde a 0157 exatamente para isto
-- ("previsão de reembolso futuro ignora estes slugs") e nunca foi lida por
-- ninguém. `estorno-reembolso.ts` parou de escrevê-la, com razão: cancelar o
-- item `transporte` de janeiro não pode suprimir o `transporte` de fevereiro —
-- slug de linha mensal é categoria, não compra.
--
-- Para compra PARCELADA o slug É a compra, e é só nesse caso que a view passa
-- a respeitá-la (`parcelas_total > 1`). Uma linha aqui para um slug mensal
-- continua sem efeito, de propósito.
--
-- POR QUE `estorno_id` DEIXA DE SER OBRIGATÓRIO
-- ---------------------------------------------
-- A 0157 só admitia série cancelada COM estorno — a devolução à empresa do que
-- já foi pago. Aqui o dono cancelou a série e adiou a outra metade ("depois eu
-- resolvo"): se a TV foi devolvida, as parcelas já recebidas viram valor a
-- devolver; se só o reembolso parou, não há nada. Inventar um estorno de
-- R$ 0,00 para satisfazer o NOT NULL registraria uma decisão que ninguém tomou.
-- `estorno_id` nulo quer dizer exatamente isso: parou de pagar, e a devolução
-- está em aberto.

ALTER TABLE fin_reembolso_slug_cancelado
  ALTER COLUMN estorno_id DROP NOT NULL,
  ADD COLUMN motivo        text,
  ADD COLUMN cancelado_por text;

COMMENT ON TABLE fin_reembolso_slug_cancelado IS
  'Compra parcelada da planilha que a casa parou de reembolsar. Lida por fin_reembolso_saldo_v '
  '(0194), e só para séries com parcelas_total > 1: em linha mensal o slug é categoria, não compra. '
  'estorno_id nulo = parou de pagar e a devolução do que já saiu ainda não foi decidida.';

INSERT INTO fin_reembolso_slug_cancelado (entity_id, person_id, slug, motivo, cancelado_por)
SELECT p.entity_id, p.id, 'tv',
       'Dono, 02/10/2026: "a tv, a parcela foi cancelada". Devolução das parcelas já pagas fica para decisão dele.',
       'dono'
  FROM fin_person p
  JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
 WHERE p.name = 'Fernando' AND p.status = 'ativo';

-- ---------------------------------------------------------------------------
-- A planilha: mesma view da 0129, mais a série cancelada de fora.
-- O filtro mora AQUI, e não só na união, porque o app do time lê esta view
-- direto para o "a receber" da pessoa — filtrar só na 0179 faria a plataforma
-- e o celular discordarem do mesmo saldo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_reembolso_saldo_v AS
WITH ultima AS (
  SELECT DISTINCT ON (person_id, slug)
         person_id, slug, descricao, competencia, valor_parcela_cents,
         parcela, parcelas_total, categoria_livre
    FROM fin_reembolso_item
   ORDER BY person_id, slug, competencia DESC, parcela DESC
)
SELECT u.person_id,
       p.name                                         AS pessoa,
       u.slug,
       u.descricao,
       u.categoria_livre,
       u.competencia                                  AS ultima_competencia,
       u.parcela,
       u.parcelas_total,
       u.valor_parcela_cents,
       u.parcelas_total - u.parcela                   AS parcelas_restantes,
       (u.parcelas_total - u.parcela) * u.valor_parcela_cents AS saldo_cents,
       u.parcela >= u.parcelas_total                  AS quitado
  FROM ultima u
  JOIN fin_person p ON p.id = u.person_id
 WHERE NOT (u.parcelas_total > 1
            AND EXISTS (SELECT 1
                          FROM fin_reembolso_slug_cancelado c
                         WHERE c.person_id = u.person_id AND c.slug = u.slug));

-- ---------------------------------------------------------------------------
-- A união: idêntica à 0179, com `cancelado` no filtro do lado do app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_reembolso_saldo_unificado_v AS
SELECT 'planilha'::text                        AS origem,
       s.person_id,
       s.pessoa,
       s.slug,
       s.descricao,
       s.categoria_livre,
       s.ultima_competencia,
       s.parcela,
       s.parcelas_total,
       s.valor_parcela_cents,
       s.parcelas_restantes,
       s.saldo_cents,
       s.quitado,
       NULL::text                              AS status_pedido,
       false                                   AS tem_comprovante
  FROM fin_reembolso_saldo_v s

UNION ALL

SELECT 'app'::text                             AS origem,
       r.person_id,
       p.name                                  AS pessoa,
       'app-' || i.id::text                    AS slug,
       i.description                           AS descricao,
       NULL::text                              AS categoria_livre,
       date_trunc('month', r.reference_month)::date AS ultima_competencia,
       COALESCE(i.installment_number, 1)       AS parcela,
       COALESCE(i.installment_total, 1)        AS parcelas_total,
       i.amount_cents                          AS valor_parcela_cents,
       1                                       AS parcelas_restantes,
       i.amount_cents                          AS saldo_cents,
       false                                   AS quitado,
       COALESCE(r.status, 'aprovado')          AS status_pedido,
       (i.receipt_artifact_key IS NOT NULL)    AS tem_comprovante
  FROM fin_reimbursement_item i
  JOIN fin_reimbursement r ON r.id = i.reimbursement_id
  JOIN fin_person p        ON p.id = r.person_id
 WHERE COALESCE(r.status, 'aprovado') NOT IN ('pago', 'rejeitado')
   AND COALESCE(i.status, 'aprovado') NOT IN ('pago', 'rejeitado', 'cancelado')
   AND NOT EXISTS (
     SELECT 1
       FROM fin_reembolso_item a
      WHERE a.person_id = r.person_id
        AND a.competencia = date_trunc('month', r.reference_month)::date
        AND (a.valor_parcela_cents = i.amount_cents
             OR lower(btrim(a.descricao)) = lower(btrim(i.description)))
   );

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_marcadas int; v_tv int; v_series int; v_visiveis int; v_cancelado int;
BEGIN
  SELECT count(*) INTO v_marcadas FROM fin_reembolso_slug_cancelado WHERE slug = 'tv';
  IF v_marcadas <> 1 THEN
    RAISE EXCEPTION '0194: esperava 1 série tv cancelada, gravei %', v_marcadas;
  END IF;

  SELECT count(*) INTO v_tv
    FROM fin_reembolso_saldo_unificado_v u
    JOIN fin_reembolso_slug_cancelado c ON c.person_id = u.person_id AND c.slug = u.slug
   WHERE u.origem = 'planilha';
  IF v_tv > 0 THEN
    RAISE EXCEPTION '0194: % série(s) cancelada(s) ainda aparecem no saldo', v_tv;
  END IF;

  -- A view da planilha perde EXATAMENTE a série cancelada — nem uma a mais.
  SELECT count(*) INTO v_series
    FROM (SELECT DISTINCT person_id, slug FROM fin_reembolso_item) x;
  SELECT count(*) INTO v_visiveis FROM fin_reembolso_saldo_v;
  IF v_series - v_visiveis <> 1 THEN
    RAISE EXCEPTION '0194: a view perdeu % série(s), esperava 1', v_series - v_visiveis;
  END IF;

  SELECT count(*) INTO v_cancelado
    FROM fin_reembolso_saldo_unificado_v u
    JOIN fin_reimbursement_item i ON u.slug = 'app-' || i.id::text
   WHERE u.origem = 'app' AND i.status = 'cancelado';
  IF v_cancelado > 0 THEN
    RAISE EXCEPTION '0194: % item(ns) cancelado(s) ainda aparecem como a receber', v_cancelado;
  END IF;

  RAISE NOTICE '0194: % séries da planilha visíveis, tv fora; nenhum item cancelado no a-receber', v_visiveis;
END $$;
