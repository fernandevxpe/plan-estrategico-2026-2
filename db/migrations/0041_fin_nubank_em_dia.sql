-- O Nubank em dia, e o dezembro que não podia entrar ainda.
--
-- ---------------------------------------------------------------------------
-- 1. AS 10 LINHAS ANTERIORES AO SALDO DE ABERTURA SAEM
-- ---------------------------------------------------------------------------
-- A promoção do espelho do erp-obras trouxe 49 linhas, e 10 delas são de
-- dezembro/2025 — anteriores a 02/01/2026, que é a data do saldo de abertura
-- declarado em 0036.
--
-- Aquela abertura (R$ 2.067,24) não é um chute: foi confrontada com o livro-caixa
-- da planilha do dono e fecha em R$ 2,98, a coluna da conta. E, sendo o saldo NO
-- DIA 02/01, ela já contém o efeito de tudo que aconteceu antes — inclusive
-- desses 10 lançamentos.
--
-- Mantê-los junto com a abertura cria uma ambiguidade que não se resolve por
-- consulta: somar com `posted_on >= opening_balance_date` os ignora, somar sem o
-- filtro conta o mesmo dinheiro duas vezes. Duas telas honestas discordariam, e
-- a diferença (R$ 5.079,65) não apareceria como erro em lugar nenhum.
--
-- Eles voltam quando a ingestão do Polp cobrir o histórico inteiro. Lá isso é
-- limpo: a Polp tem o extrato desde 04/09/2025 e a soma das 865 transações dá
-- exatamente R$ 11.682,57, o saldo atual — ou seja, o histórico completo dispensa
-- saldo de abertura, em vez de brigar com ele.

DELETE FROM fin_transaction t
 USING fin_account a
 WHERE a.id = t.account_id
   AND t.source = 'erp_obras'
   AND a.opening_balance_date IS NOT NULL
   AND t.posted_on < a.opening_balance_date;

-- ---------------------------------------------------------------------------
-- 2. O SALDO DECLARADO ALCANÇA O LEDGER
-- ---------------------------------------------------------------------------
-- `current_balance_cents` do Nubank era R$ 2,98 — correto para 07/08, que era
-- até onde o CSV chegava. Com os 39 lançamentos de agosto promovidos, o ledger
-- passou a reconstruir R$ 11.682,57.
--
-- Esse número não é o que o ledger achou: é o que o BANCO diz. A API do Nubank
-- via Polp devolve R$ 11.682,57 como saldo da conta, e a conferência fecha por
-- três caminhos independentes:
--
--   R$      2,98  saldo deste ledger em 07/08 (validado contra a planilha em 0036)
--   R$ 11.679,59  líquido dos 39 lançamentos de 08 a 15/08, vindos do erp-obras
--   ────────────
--   R$ 11.682,57  = saldo que a API do banco devolve hoje
--
-- Atualizar aqui é registrar a fonte externa, não ajustar o ledger para fechar —
-- a diferença entre as duas coisas é o que separa conciliação de maquiagem.
UPDATE fin_account a
   SET current_balance_cents = 1168257,
       last_statement_at     = TIMESTAMPTZ '2026-08-15 00:00:00-03'
  FROM fin_entity e
 WHERE e.id = a.entity_id AND e.slug = 'xpe' AND a.slug = 'nubank';

-- A cobertura de extrato acompanha: o Nubank passa a estar coberto até 15/08.
--
-- `source` aqui é 'api' e não 'erp_obras' porque esta coluna responde COMO a
-- cobertura foi obtida — 'extrato' é arquivo enviado à mão, 'api' é automático,
-- 'manual' é declaração. O caminho até nós passa pelo erp-obras, mas a natureza
-- do dado é de API (o Polp lê o Nubank sozinho), e é isso que decide se a
-- cobertura depende de alguém lembrar de exportar um PDF.
-- A procedência detalhada continua registrada por lançamento, em
-- fin_transaction.source = 'erp_obras'.
INSERT INTO fin_statement_coverage (account_id, period_start, period_end, source)
SELECT a.id, DATE '2026-08-08', DATE '2026-08-15', 'api'
  FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
 WHERE e.slug = 'xpe' AND a.slug = 'nubank'
   AND NOT EXISTS (
     SELECT 1 FROM fin_statement_coverage c
      WHERE c.account_id = a.id AND c.period_start = DATE '2026-08-08');
