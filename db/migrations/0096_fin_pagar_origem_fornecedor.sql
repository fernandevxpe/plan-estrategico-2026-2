-- Correcao de rotulo em fin_pagar_origem_v: "contrato de fornecedor" nao pode
-- contar contrato de FOLHA.
--
-- A 0095 escreveu a linha `contrato_de_fornecedor` contando
-- `fin_contract WHERE direction = 'pagar'`. Naquele instante o resultado era 0 e
-- a linha lia certo. Minutos depois, o importador do ClickUp criou 4 contratos
-- a pagar — todos de FOLHA, com `person_id` preenchido — e a mesma linha passou
-- a dizer "4 compromissos" embaixo do texto "erp_contrato e 100% contrato de
-- cliente". Contagem certa, rotulo errado: exatamente o tipo de numero que
-- ninguem confere porque parece plausivel.
--
-- Contrato de fornecedor e o que tem contraparte e NAO tem pessoa do time
-- (0030: "a pessoa e COM QUEM o compromisso e, a contraparte e PARA ONDE o
-- dinheiro sai"). O filtro passa a ser esse, e a linha volta a medir o que o
-- nome dela promete.

CREATE OR REPLACE VIEW fin_pagar_origem_v AS

-- 1. ClickUp — tarefas com vencimento FUTURO na lista "Fluxo de caixa"
SELECT 'clickup_fluxo_de_caixa'::text AS origem,
       'tarefa com vencimento futuro e valor declarado'::text AS evidencia,
       true AS derivavel,
       count(*)::integer AS compromissos,
       COALESCE(sum(d.amount_cents), 0)::bigint AS valor_cents,
       min(d.due_date) AS primeiro_vencimento,
       max(d.due_date) AS ultimo_vencimento,
       'scripts/import-clickup-compromissos.mjs --apply (idempotente por task id)'::text AS caminho,
       NULL::text AS motivo
  FROM fin_document d
 WHERE d.direction = 'pagar' AND d.source = 'clickup'

UNION ALL

-- 2. Cartao — compras ja feitas no ciclo aberto e parcelas contratadas
SELECT 'cartao_ciclo_e_parcelamento',
       'compra ja realizada, fatura ainda nao paga; plano de parcelas declarado pelo emissor',
       true,
       count(*)::integer,
       COALESCE(sum(cm.amount_cents), 0)::bigint,
       min(cm.competence_month),
       max(cm.competence_month),
       'fin_card_compromisso_mensal_v ja modela a obrigacao; falta materializar fin_document',
       NULL
  FROM fin_card_compromisso_mensal_v cm

UNION ALL

-- 3. Reembolso aprovado e nao pago — a aprovacao humana ja esta registrada
SELECT 'reembolso_aprovado',
       'aprovacao humana registrada em fin_reimbursement, sem documento de pagamento',
       true,
       count(*)::integer,
       COALESCE(sum(r.total_cents), 0)::bigint,
       min(r.reference_month),
       max(r.reference_month),
       'fin_reimbursement.paid_document_id existe desde a 0012 e nunca foi preenchido',
       NULL
  FROM fin_reimbursement r
 WHERE r.status = 'aprovado' AND r.paid_document_id IS NULL

UNION ALL

-- 4. Folha contratada — o valor combinado com cada pessoa, nao o que ja saiu
SELECT 'folha_contratada',
       'fin_person_compensation component=fixo kind=contratado para pessoa ativa',
       true,
       count(*)::integer,
       COALESCE(sum(pc.amount_cents), 0)::bigint,
       max(pc.reference_month),
       NULL::date,
       'contrato direction=pagar (0030) + documento mensal; exige a trava "documento vence projecao", '
       'senao soma com a camada pagar_folha de fin_previsao_evento_v',
       NULL
  FROM fin_person_compensation pc
  JOIN fin_person p ON p.id = pc.person_id AND p.status = 'ativo'
 WHERE pc.component = 'fixo' AND pc.kind = 'contratado'
   AND pc.reference_month = (SELECT max(reference_month) FROM fin_person_compensation)

UNION ALL

-- 5. Fatura de cartao com saldo devedor
SELECT 'fatura_cartao_em_aberto',
       'fatura fechada pelo emissor com saldo nao liquidado',
       true,
       count(*)::integer,
       COALESCE(sum(cb.total_amount_cents - cb.paid_amount_cents), 0)::bigint,
       min(cb.due_date),
       max(cb.due_date),
       'fin_card_bill ja tem due_date e saldo; falta materializar fin_document',
       NULL
  FROM fin_card_bill cb
 WHERE cb.total_amount_cents > cb.paid_amount_cents

UNION ALL

-- 6. Recorrente de fornecedor — DETECTADA no historico pago
SELECT 'recorrente_detectada_no_historico',
       'media de janela sobre despesa JA PAGA — nao ha documento, contrato nem boleto',
       false,
       count(*)::integer,
       COALESCE(sum(r.amount_cents), 0)::bigint,
       NULL::date,
       NULL::date,
       'permanece como previsao; virar documento seria transformar historico em obrigacao',
       'a fonte e o extrato do que ja saiu: criar pagavel aqui conta o mesmo dinheiro duas vezes'
  FROM fin_recurring r
 WHERE r.direction = 'pagar'

UNION ALL

-- 7. NFe de entrada — o repositorio nao existe
SELECT 'nfe_de_entrada',
       'nenhuma: fin_fiscal_document tem 100% de nota EMITIDA pela XPE (nfse via Asaas)',
       false,
       count(*)::integer,
       0::bigint,
       NULL::date,
       NULL::date,
       'exige integracao nova (SEFAZ/e-mail do fornecedor) ou cadastro humano',
       'nao ha documento de entrada em nenhuma fonte do ledger'
  FROM fin_fiscal_document f
 WHERE f.kind <> 'nfse'

UNION ALL

-- 8. Contrato de FORNECEDOR — compromisso a pagar sem pessoa do time do outro
--    lado. Contrato de folha (person_id preenchido) e outra origem e ja e
--    contado na linha 1; somar aqui seria contar duas vezes.
SELECT 'contrato_de_fornecedor',
       'nenhuma: erp_contrato e 100% contrato de cliente e nao ha contrato a pagar sem pessoa',
       false,
       count(*)::integer,
       COALESCE(sum(c.amount_cents), 0)::bigint,
       NULL::date,
       NULL::date,
       'exige cadastro humano em fin_contract direction=pagar com counterparty e sem person_id',
       'erp-obras nao guarda o lado do fornecedor, e e somente leitura'
  FROM fin_contract c
 WHERE c.direction = 'pagar' AND c.person_id IS NULL

UNION ALL

-- 9. Boleto agendado no Inter — a credencial nao alcanca
SELECT 'boleto_agendado_no_inter',
       'nenhuma: o cliente do Inter usa escopo extrato.read (extrato, extrato/completo, saldo)',
       false,
       0,
       0::bigint,
       NULL::date,
       NULL::date,
       'exigiria escopo de pagamento na credencial — leitura apenas, nunca emissao',
       'o extrato so mostra o boleto DEPOIS de pago; agendado nao aparece'

UNION ALL

-- 10. Tributo — a apuracao entrega insumo e declara que nao calcula
SELECT 'tributo_apurado',
       'nenhuma: fin_apuracao_tributaria_v entrega insumo e declara que nao calcula',
       false,
       0,
       0::bigint,
       NULL::date,
       NULL::date,
       'depende do regime (duvida 21: em que conta ficam os MEIs decide o Fator R)',
       'sem anexo do Simples definido, o valor devido e estimativa, nao obrigacao';

COMMENT ON VIEW fin_pagar_origem_v IS
  'De onde a conta a pagar pode nascer com evidencia real. derivavel=false nao e ausencia de dado: '
  'e fonte que so guarda despesa JA PAGA, e por isso nao pode virar documento sem contar duas vezes. '
  'contrato_de_fornecedor exclui contrato de folha: esse ja e contado em clickup_fluxo_de_caixa.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin_pagar_origem_v WHERE caminho IS NULL) THEN
    RAISE EXCEPTION '0096: origem sem caminho declarado';
  END IF;
  IF EXISTS (SELECT 1 FROM fin_pagar_origem_v WHERE NOT derivavel AND motivo IS NULL) THEN
    RAISE EXCEPTION '0096: origem nao derivavel sem motivo';
  END IF;
  -- Contrato de folha nao pode aparecer nas duas linhas.
  IF EXISTS (
    SELECT 1 FROM fin_pagar_origem_v
     WHERE origem = 'contrato_de_fornecedor'
       AND compromissos > (SELECT count(*) FROM fin_contract
                            WHERE direction = 'pagar' AND person_id IS NULL)
  ) THEN
    RAISE EXCEPTION '0096: contrato_de_fornecedor voltou a contar contrato de folha';
  END IF;
END;
$$;
