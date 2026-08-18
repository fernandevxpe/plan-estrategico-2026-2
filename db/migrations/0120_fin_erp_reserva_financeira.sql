-- O erp-obras já sabe pra que cada caixinha do Nubank serve — espelha só o total.
--
-- ---------------------------------------------------------------------------
-- O QUE O FERNANDO PEDIU
-- ---------------------------------------------------------------------------
-- Ele confirmou que o erp-obras já modela as caixinhas do Nubank (tabela
-- `ReservaFinanceira`: Impostos, Comissões, Reserva de obras, Caixa livre —
-- os mesmos quatro nomes do print) e já sabe, lançamento a lançamento, quanto
-- entrou e saiu de cada uma. Pediu para trazer SÓ o total de cada reserva
-- como leitura — explicitamente NÃO o detalhe por projeto de obra, porque
-- isso vai morar na futura guia de Obras, que espelha o erp-obras projeto a
-- projeto, e duplicar aqui criaria confusão entre dois lugares dizendo a
-- mesma coisa de jeitos diferentes.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION CRIA
-- ---------------------------------------------------------------------------
-- erp_reserva_financeira: espelho somente-leitura de `ReservaFinanceira`,
-- MESMO PADRÃO de erp_contrato (0045) — erp_id UNIQUE é a chave de
-- idempotência, synced_at marca a última sincronização, e a tabela NUNCA é
-- ledger: nenhuma tela pode somar isto como caixa disponível.
--
-- saldo_pago_cents é calculado pelo script de sync a partir de
-- LancamentoFinanceiro.reservaOrigemId/reservaDestinoId, status='PAGO',
-- desconsiderado=false — a mesma soma que rodei manualmente para responder
-- ao Fernando. NÃO inclui PREVISTO: o que ainda não foi pago não é saldo.
--
-- fin_caixinha_reserva_erp_v cruza isso com fin_caixinha_declarada (0117, o
-- print do app) pelo NOME da caixinha no Nubank — que o script de sync grava
-- em nubank_caixinha_nome a partir do slug do erp (mapeamento fixo, os
-- únicos 4 nomes que existem, documentado no próprio script). A diferença
-- fica exposta, não escondida — é a mesma pilha de dinheiro vista de dois
-- sistemas que nunca prometeram bater ao centavo.

CREATE TABLE IF NOT EXISTS erp_reserva_financeira (
  id                    bigserial PRIMARY KEY,

  -- Chave de idempotência: o id de ReservaFinanceira no erp-obras.
  erp_id                integer NOT NULL UNIQUE,

  nome                  text NOT NULL,
  slug                  text,
  tipo                  text NOT NULL,
  status_erp            text NOT NULL,

  -- Qual caixinha do Nubank isto representa, pelo nome exato que
  -- fin_caixinha_declarada usa. NULL para reservas sem par no app (ex.:
  -- "Buffer geral", encerrada). Mapeamento fixo no script de sync — são só
  -- 4 nomes, e inventar um casamento fuzzy aqui esconderia erro de digitação
  -- em vez de estourar.
  nubank_caixinha_nome  text,

  saldo_pago_cents      bigint NOT NULL,
  entradas_pagas_cents  bigint NOT NULL,
  saidas_pagas_cents    bigint NOT NULL,

  synced_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_reserva_financeira IS
  'Espelho somente-leitura de ReservaFinanceira do erp-obras — só o total de cada reserva, '
  'nunca o detalhe por projeto (isso mora na futura guia de Obras, para não duplicar). NÃO É '
  'LEDGER: nenhuma tela de caixa pode somar isto como dinheiro disponível.';
COMMENT ON COLUMN erp_reserva_financeira.saldo_pago_cents IS
  'entradas_pagas_cents - saidas_pagas_cents, só status=PAGO e desconsiderado=false. '
  'PREVISTO fica de fora: o que não foi pago ainda não é saldo.';

CREATE OR REPLACE VIEW fin_caixinha_reserva_erp_v AS
WITH ultimo AS (
  SELECT nome, max(declarado_em) AS declarado_em FROM fin_caixinha_declarada GROUP BY nome
),
decl AS (
  SELECT d.nome, sum(d.saldo_cents) AS saldo_declarado_cents, max(d.declarado_em) AS declarado_em
    FROM fin_caixinha_declarada d
    JOIN ultimo u ON u.nome = d.nome AND u.declarado_em = d.declarado_em
   GROUP BY d.nome
)
SELECT
  COALESCE(d.nome, e.nubank_caixinha_nome) AS nome,
  d.saldo_declarado_cents,
  d.declarado_em,
  e.nome        AS erp_nome,
  e.slug        AS erp_slug,
  e.saldo_pago_cents AS saldo_erp_cents,
  e.synced_at   AS erp_sincronizado_em,
  CASE WHEN d.saldo_declarado_cents IS NOT NULL AND e.saldo_pago_cents IS NOT NULL
       THEN d.saldo_declarado_cents - e.saldo_pago_cents END AS diferenca_cents
FROM decl d
FULL JOIN erp_reserva_financeira e ON e.nubank_caixinha_nome = d.nome
WHERE e.nubank_caixinha_nome IS NOT NULL OR d.nome IS NOT NULL;

COMMENT ON VIEW fin_caixinha_reserva_erp_v IS
  'Cruza o print declarado do Nubank (fin_caixinha_declarada) com o total calculado pelo '
  'erp-obras (erp_reserva_financeira), por nome de caixinha. diferenca_cents é NOMEADA, não '
  'escondida — as duas fontes nunca prometeram bater ao centavo.';
