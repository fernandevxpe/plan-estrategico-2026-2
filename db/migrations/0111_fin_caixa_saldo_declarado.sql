-- As duas contas Caixa deixam de ser "sem cobertura" e passam a ter saldo.
--
-- ---------------------------------------------------------------------------
-- DE ONDE VEM O NÚMERO
-- ---------------------------------------------------------------------------
-- O Fernando conferiu no aplicativo do banco em 17/08/2026 e informou:
--
--   Caixa — Aplicação ......... R$ 33.000,00
--   Caixa — Conta corrente .... R$    707,00
--   Parcela mensal atual ...... R$  6.270,00  (já com a taxa do banco)
--
-- Isto é **saldo declarado por pessoa**, não extrato importado. A diferença
-- importa e fica registrada na procedência: um extrato reconstrói o saldo a
-- partir dos lançamentos e permite conferir; um saldo declarado é uma foto que
-- ninguém pode recalcular. Os dois valem, e valem coisas diferentes.
--
-- Por isso o invariante F1 **continua falhando de propósito**. Ele afirma que
-- toda conta ativa tem cobertura de extrato declarada, e isso segue sendo
-- falso: não há extrato, há um número que alguém leu na tela do banco. Marcar
-- F1 como resolvido aqui seria fabricar cobertura — o mesmo erro que a
-- migration 0085 existiu para não cometer.
--
-- ---------------------------------------------------------------------------
-- O QUE ISTO MUDA, E O QUE NÃO MUDA
-- ---------------------------------------------------------------------------
-- MUDA: as duas contas param de aparecer como R$ 0,00, que era uma afirmação
-- sobre o dinheiro quando a verdade era ausência de dado. O consolidado passa
-- a incluir R$ 33.707,00 que existem e não estavam sendo contados.
--
-- NÃO MUDA: a âncora de soma por conta das outras quatro, nem o "6/6 fecham" —
-- essas duas nunca fecharam por reconstrução e continuam não fechando. O que
-- elas ganham é um saldo conhecido, não uma conciliação.

DO $$
DECLARE
  v_ent  bigint;
  v_apl  bigint;
  v_emp  bigint;
BEGIN
  SELECT id INTO v_ent FROM fin_entity WHERE slug = 'xpe';
  IF v_ent IS NULL THEN RAISE EXCEPTION '[0111] entidade xpe não encontrada'; END IF;

  SELECT id INTO v_apl FROM fin_account WHERE entity_id = v_ent AND slug = 'caixa-aplicacao';
  SELECT id INTO v_emp FROM fin_account WHERE entity_id = v_ent AND slug = 'caixa-emprestimo';
  IF v_apl IS NULL OR v_emp IS NULL THEN
    RAISE EXCEPTION '[0111] contas caixa-aplicacao/caixa-emprestimo não encontradas';
  END IF;

  -- Aplicação: R$ 33.000,00 · conta corrente do empréstimo: R$ 707,00
  UPDATE fin_account SET current_balance_cents = 3300000 WHERE id = v_apl;
  UPDATE fin_account SET current_balance_cents =   70700 WHERE id = v_emp;

  RAISE NOTICE '[0111] saldos declarados gravados: aplicação R$ 33.000,00 · corrente R$ 707,00';
END $$;

-- ---------------------------------------------------------------------------
-- A PROCEDÊNCIA, para o número nunca virar órfão
-- ---------------------------------------------------------------------------
-- Sem isto, daqui a três meses ninguém sabe se os R$ 33.000 vieram de extrato,
-- de cálculo ou de alguém digitando. Saldo sem origem é o começo de um número
-- que ninguém confere e todo mundo repete.
CREATE TABLE IF NOT EXISTS fin_saldo_declarado (
  id                bigserial PRIMARY KEY,
  entity_id         bigint NOT NULL REFERENCES fin_entity(id),
  account_id        bigint NOT NULL REFERENCES fin_account(id),
  saldo_cents       bigint NOT NULL,
  declarado_em      date   NOT NULL,
  declarado_por     text   NOT NULL,
  fonte             text   NOT NULL CHECK (fonte IN ('app_do_banco','extrato_pdf','telefone','agencia','outro')),
  observacao        text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, declarado_em)
);

COMMENT ON TABLE fin_saldo_declarado IS
  'Saldo que uma pessoa leu e informou, com data e origem. NÃO é extrato: não reconstrói '
  'a partir de lançamentos e não pode ser conferido por recálculo. Existe para que um saldo '
  'sem importação tenha procedência em vez de aparecer como fato anônimo.';

INSERT INTO fin_saldo_declarado (entity_id, account_id, saldo_cents, declarado_em, declarado_por, fonte, observacao)
SELECT e.id, a.id, v.saldo, DATE '2026-08-17', 'Fernando', 'app_do_banco', v.obs
  FROM fin_entity e
  JOIN (VALUES
    ('caixa-aplicacao',  3300000::bigint, 'aplicação conferida no app do banco'),
    ('caixa-emprestimo',   70700::bigint, 'conta corrente do débito das parcelas do Pronampe')
  ) AS v(slug, saldo, obs) ON true
  JOIN fin_account a ON a.entity_id = e.id AND a.slug = v.slug
 WHERE e.slug = 'xpe'
ON CONFLICT (account_id, declarado_em) DO UPDATE
  SET saldo_cents = EXCLUDED.saldo_cents, observacao = EXCLUDED.observacao;

-- Pós-condição: o saldo da conta e o último declarado têm de concordar. Se
-- alguém mexer num sem mexer no outro, o número volta a ser órfão em silêncio.
DO $$
DECLARE v_div int;
BEGIN
  SELECT count(*) INTO v_div
    FROM fin_account a
    JOIN LATERAL (
      SELECT s.saldo_cents FROM fin_saldo_declarado s
       WHERE s.account_id = a.id ORDER BY s.declarado_em DESC LIMIT 1
    ) d ON true
   WHERE a.slug IN ('caixa-aplicacao','caixa-emprestimo')
     AND a.current_balance_cents IS DISTINCT FROM d.saldo_cents;

  IF v_div > 0 THEN
    RAISE EXCEPTION '[0111] % conta(s) com saldo divergente do declarado', v_div;
  END IF;
END $$;
