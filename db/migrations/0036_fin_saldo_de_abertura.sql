-- Os saldos de abertura, sem os quais o caixa não fecha.
--
-- `opening_balance_cents` está zerado nas seis contas desde a 0001, e
-- `opening_balance_date` nulo. O invariante G1 ("current_balance_cents é
-- reconstruível a partir do ledger") falha por causa disso, e o J2 passa por
-- vácuo — não porque esteja certo, mas porque não há dado que o exercite.
--
-- O efeito prático é maior do que parece: o Inter tem R$ 31,28 na coluna e
-- -R$ 79.697,55 de soma no ledger. As duas afirmações não podem ser
-- verdadeiras ao mesmo tempo, e a plataforma não tinha como dizer qual era.
--
-- A PROVA, que veio de duas fontes independentes concordando
--
-- A planilha de gestão do dono mantém um livro-caixa por banco, cada um com
-- SALDO INICIAL declarado. Confrontando com o ledger:
--
--   Asaas    ledger acumulado antes de 02/01/2026 ... R$ 30.480,92
--            saldo inicial declarado na planilha .... R$ 30.480,92   diferença ZERO
--
-- São 10.003 lançamentos importados do Asaas desde maio de 2021, somados sem
-- saber o que a planilha dizia, batendo ao centavo com um número digitado à
-- mão por outra pessoa em outro lugar. É a validação cruzada mais forte que
-- este ledger recebeu até hoje, e é ela que dá crédito aos outros dois
-- números da mesma planilha.
--
--   Inter    ledger começa em 01/01/2026, sem histórico anterior
--            abertura declarada .................... R$ 79.728,83
--            79.728,83 + (-79.697,55) = R$ 31,28 = o saldo que a API do Inter
--            devolve hoje. Fecha.
--
--   Nubank   ledger começa em 02/01/2026
--            abertura declarada .................... R$  2.067,24
--            2.067,24 + (-2.064,26) = R$ 2,98 = a coluna atual. Fecha.
--
-- O Asaas NÃO recebe abertura: seu histórico começa em 2021 e a abertura já
-- está dentro do ledger. Declará-la aqui somaria R$ 30.480,92 duas vezes e
-- inventaria caixa que não existe — o erro oposto, e pior, porque um saldo
-- alto demais não dói até a hora de pagar alguém.
--
-- CONTAS QUE FICAM DE FORA E POR QUÊ
--
-- `caixa-aplicacao` e `caixa-emprestimo` seguem zeradas porque nunca foram
-- importadas: zero lançamentos, e a planilha traz um empréstimo Caixa de
-- R$ 147.062,10 captado em 2024 que o ledger desconhece inteiro. Declarar uma
-- abertura para elas sem o extrato atrás seria fabricar precisão.
--
-- `nubank-caixinhas` também fica: a coluna diz R$ 59.001,05 e o ledger soma
-- R$ 51.997,87, um delta de R$ 7.003,18 que não tem explicação verificada. A
-- planilha não tem aba de caixinhas para confrontar. Sem prova, não se declara.

UPDATE fin_account a
   SET opening_balance_cents = 7972883,
       opening_balance_date  = DATE '2026-01-01'
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'inter';

UPDATE fin_account a
   SET opening_balance_cents = 206724,
       opening_balance_date  = DATE '2026-01-02'
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'nubank';

-- O Asaas ganha a DATA e não o valor: a abertura dele é zero porque o ledger
-- carrega o histórico inteiro, e registrar a data do primeiro lançamento é o
-- que diz "esta conta está coberta desde aqui" em vez de deixar nulo, que se
-- lê como "ninguém sabe".
UPDATE fin_account a
   SET opening_balance_cents = 0,
       opening_balance_date  = (SELECT min(t.posted_on) FROM fin_transaction t WHERE t.account_id = a.id)
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'asaas';
