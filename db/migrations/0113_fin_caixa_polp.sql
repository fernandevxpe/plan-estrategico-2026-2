-- A conta corrente da Caixa entra no ledger, e a aplicação passa a ser lida
-- pelo Polp — o mesmo agregador do Nubank.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA SÉTIMA CONTA, E NÃO REUSAR caixa-emprestimo
-- ---------------------------------------------------------------------------
-- `caixa-emprestimo` é kind='emprestimo': fica FORA de caixa disponível, e a
-- 0110 pendurou nela o Pronampe. A conta corrente da Caixa é outro objeto —
-- é de onde saem as prestações, e é para onde os PIX do Inter de R$ 25.400,00
-- foram em 2026 (dúvida 5, conta 12920000005783083433).
--
-- Juntar as duas faria o saldo operacional somar com o saldo DEVEDOR, ou o
-- contrário: a prestação sumiria do caixa disponível. São duas perguntas.
--
-- `caixa-aplicacao` já existia, sem extrato, adapter caixa_ofx. O adapter
-- muda para polp_api: a declaração de que "ninguém vai buscar" era a mentira
-- operacional que deixou F1 vermelho. O saldo continua 0 até o primeiro
-- `--aplicar` do sync — G1 não se toca aqui (lição da 0112).
--
-- Esta migration NÃO cria integração no Polp e NÃO importa um lançamento.
-- Sem consentimento no banco, o sync se recusa. Ver scripts/conectar-polp-caixa.mjs.

INSERT INTO fin_account (entity_id, slug, name, institution, kind, import_adapter, sort_order)
SELECT e.id, 'caixa', 'Caixa — Conta corrente', 'caixa', 'conta_corrente', 'polp_api', 7
  FROM fin_entity e
 WHERE e.slug = 'xpe'
ON CONFLICT (entity_id, slug) DO NOTHING;

UPDATE fin_account a
   SET import_adapter = 'polp_api'
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'caixa-aplicacao'
   AND a.import_adapter <> 'polp_api';

-- O catálogo da 0109 descrevia o Polp como "Nubank". Continua sendo a mesma
-- fonte; o que alimenta cresce. A 0109 pode ainda não estar aplicada — o
-- UPDATE só roda se a tabela existir.
DO $$
BEGIN
  IF to_regclass('public.fin_fonte_catalogo') IS NOT NULL THEN
    UPDATE fin_fonte_catalogo
       SET alimenta = 'o extrato e as posições das caixinhas do Nubank, e — quando o '
                      || 'consentimento existir — a conta corrente e a aplicação da Caixa'
     WHERE fonte = 'polp';
  END IF;
END $$;

DO $$
DECLARE v_caixa int; v_apl text;
BEGIN
  SELECT count(*) INTO v_caixa FROM fin_account WHERE slug = 'caixa';
  IF v_caixa <> 1 THEN
    RAISE EXCEPTION '[0113] esperava 1 conta slug=caixa, achei %', v_caixa;
  END IF;

  SELECT import_adapter INTO v_apl FROM fin_account WHERE slug = 'caixa-aplicacao';
  IF v_apl IS DISTINCT FROM 'polp_api' THEN
    RAISE EXCEPTION '[0113] caixa-aplicacao deveria estar em polp_api, está em %', v_apl;
  END IF;
END $$;
