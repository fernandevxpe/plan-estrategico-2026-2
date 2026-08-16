-- A abertura que faltava: a sexta conta passa a fechar.
--
-- ---------------------------------------------------------------------------
-- O QUE 0036 DEIXOU EM ABERTO
-- ---------------------------------------------------------------------------
-- A migration anterior declarou a abertura de Inter e Nubank e deixou
-- `nubank-caixinhas` de fora com uma justificativa honesta:
--
--   "a coluna diz R$ 59.001,05 e o ledger soma R$ 51.997,87, um delta de
--    R$ 7.003,18 que não tem explicação verificada. Sem prova, não se declara."
--
-- A prova apareceu, e ela estava no próprio documento que originou o lote 4.
--
-- ---------------------------------------------------------------------------
-- A PROVA, NO CABEÇALHO DO EXTRATO
-- ---------------------------------------------------------------------------
-- O PDF de caixinhas (sha256 41cd7597…, o mesmo arquivo do lote 4) declara:
--
--   "Período: 01 JUL 2026 a 31 JUL 2026"
--   "Saldo no final do período: R$ 59.001,05"
--
-- E lista 19 movimentos: 18 "Compra por aplicação" (R$ 51.895,34) e um
-- "Rendimento até essa data" em 31/07 (R$ 102,53) — R$ 51.997,87 no total,
-- exatamente o que o ledger soma.
--
--   59.001,05  saldo em 31/07, declarado pelo banco
--  −51.997,87  tudo que se moveu entre 01/07 e 31/07
--  ──────────
--    7.003,18  saldo em 30/06 — o termo que o extrato não imprime
--
-- O extrato do Nubank imprime o saldo FINAL e omite o INICIAL. O delta do G1
-- não era erro: era o único número da equação que o documento não dá.
--
-- ---------------------------------------------------------------------------
-- E O DINHEIRO FOI RASTREADO ATÉ A ORIGEM
-- ---------------------------------------------------------------------------
-- A aritmética acima já basta para declarar. O rastreio existe porque 0036
-- estabeleceu o padrão de não aceitar número sem procedência:
--
--   R$ 7.300,00   aplicação RDB de abertura em 28/12/2025 (erp-obras, id 716)
--   −R$   661,50  fluxo líquido de RDB entre 02/01 e 28/06 na conta corrente
--                 (67 movimentos: R$ 90.704,90 aplicados, R$ 91.366,40 sacados)
--   ───────────
--   R$ 6.638,50   principal em 30/06  ....................... 94,8% rastreado
--   R$   364,68   rendimento creditado DENTRO da caixinha .... 5,2% inferido
--   ───────────
--   R$ 7.003,18
--
-- Os R$ 364,68 não passam pela conta corrente — rendimento de RDB é creditado
-- na própria aplicação — e por isso não existem em ledger nenhum. A ordem de
-- grandeza confere: a taxa implícita de julho (0,02151% a.d., derivada do
-- rendimento conhecido de R$ 102,53) aplicada ao saldo·dia do período prevê
-- R$ 481,78, contra os R$ 364,68 necessários. Resíduo de 1,7% sobre o saldo.
--
-- O lançamento de 28/12/2025 é o PRIMEIRO movimento de RDB em toda a base do
-- erp-obras, que tem histórico contínuo desde 16/12/2021 sem uma única linha
-- de aplicação antes dele. A caixinha nasce ali; não há período anterior
-- escondido.
--
-- ---------------------------------------------------------------------------
-- A DATA É 30/06, NÃO 09/07
-- ---------------------------------------------------------------------------
-- fin_statement_coverage registra a conta 6 como coberta de 10/07 a 31/07,
-- porque a cobertura é derivada da primeira e da última transação do lote
-- (lib/financeiro/parsers/types.ts, `periodOf`) em vez do cabeçalho do
-- documento. O PDF prova cobertura desde 01/07 — a abertura, portanto, é o
-- saldo de 30/06. Usar 09/07 deixaria de fora as aplicações dos dias 01 a 09 e
-- reabriria o buraco pelo outro lado.

UPDATE fin_account a
   SET opening_balance_cents = 700318,
       opening_balance_date  = DATE '2026-06-30'
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'nubank-caixinhas';

-- Cobertura corrigida para o que o documento prova, e não para o que as linhas
-- sugerem. A conta corrente confirma zero movimento de RDB entre 01 e 09/07, o
-- que torna a correção inofensiva hoje — mas deixá-la errada faria o invariante
-- de cobertura depender de sorte no próximo lote.
UPDATE fin_statement_coverage c
   SET period_start = DATE '2026-07-01'
  FROM fin_account a
 WHERE a.id = c.account_id
   AND a.slug = 'nubank-caixinhas'
   AND c.period_start = DATE '2026-07-10';

-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION NÃO RESOLVE — e é mais grave que o delta
-- ---------------------------------------------------------------------------
-- Com a abertura declarada, G1 fecha nas seis contas. Mas o saldo continua
-- VENCIDO, e para cima:
--
-- A conta corrente registra 13 movimentos de RDB entre 01/08 e 07/08, líquido
-- de −R$ 13.614,22 saindo da caixinha (resgates de R$ 17.893,06 em 01/08 e
-- R$ 9.649,00 em 02/08). Em 07/08 a caixinha tinha ~R$ 45.386,83, não os
-- R$ 59.001,05 que a coluna exibe.
--
-- Um saldo alto demais numa conta de reserva é o erro que só dói na hora de
-- contar com o dinheiro. A correção NÃO é aritmética — exige o extrato de
-- caixinhas de agosto, que ainda não foi importado (só existe o PDF de julho).
-- Enquanto ele não entra, a conta fecha no dia 31/07 e mente sobre hoje.
