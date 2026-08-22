-- O vencimento do Inter, derivado do extrato — e um tipo de pendência que faltava.
--
-- O Fernando pediu que o trabalho não parasse esperando resposta dele. Onde o
-- dado responde, esta migration decide e mostra a conta. Onde ele não responde,
-- a pergunta ganha endereço em vez de virar comentário de commit.
-- ===========================================================================

-- 1. O vencimento da fatura do Inter -------------------------------------------
-- Sem `due_day`, `cartao_base` da 0079 filtra a linha inteira para fora da
-- previsão: o Inter pagou R$ 40.862,41 em 2026 e projeta ZERO. A previsão de
-- cartão erra por aproximadamente metade, e erra para BAIXO — que é a direção
-- perigosa, porque só dói na hora de contar com o dinheiro.
--
-- Os nove pagamentos observados em 2026 caem nos dias:
--   04/01 · 06/02 · 04/03 · 07/04 · 11/05 · 05/06 · 02/07 · 06/07 · 04/08
-- O dia 7 cobre oito dos nove. O único fora é 11/05, que também é o maior valor
-- do período (R$ 9.413,80) e tem cara de pagamento atrasado.
--
-- ISTO É OBSERVADO, NÃO DECLARADO. Ninguém leu a fatura do banco — o dia saiu do
-- extrato. É melhor que zero e é honesto sobre o que é. Quem tiver a fatura na
-- mão corrige em dez segundos.
UPDATE fin_card_account
   SET due_day = 7
 WHERE slug = 'inter-cartao' AND due_day IS NULL;

-- 2. O "2x*" da planilha de reembolso, resolvido por evidência --------------------
-- Não muda schema; fica registrado aqui porque é a resposta a uma divergência
-- que dois modelos carregavam há meses.
--
-- A planilha responde sozinha, em três lugares:
--   Maio26,  Decézaris: "Notebook parc 2/21 2x*" = 314,40, TOTAL do mês 834,24,
--            e a nota logo abaixo: "2x* devido a ser dia 28 a fatura".
--   Junho26: "Notebook parc 3/21" = 157,20
--   Julho26: "Notebook parc 4/21" = 157,20
--
-- Junho segue na parcela 3, não na 4. Então o 2x* DOBROU O VALOR SEM PULAR
-- PARCELA — não foram duas parcelas do plano, foi um mês em que se pagou o dobro
-- por causa do fechamento da fatura no dia 28.
--
-- Logo, e isto encerra a dúvida "qual modelo é a verdade":
--   · valor PAGO em maio = 314,40  → o 0012 está certo, e o total dele bate com
--     o total escrito na própria planilha (834,24);
--   · valor da PARCELA = 157,20    → o 0129 está certo, e junho/julho confirmam;
--   · SALDO sai da parcela         → o 0129 está certo também nisso.
--
-- Nenhum dos dois está errado: eles respondem perguntas diferentes. É como
-- `meuReembolso` já lê — 0012 para o histórico, 0129 para o saldo — e agora isso
-- é achado, não hedge.

-- 3. O tipo de pendência que faltava -------------------------------------------
-- `card_sem_titular` já existe no vocabulário e cobre a titularidade do Inter,
-- que é decisão humana: `pj` ou `pf_socio` muda a categoria do pagamento entre
-- 9.01 (transferência neutra) e 9.05 (retirada de sócio), e portanto muda o
-- resultado do ano. Nome batendo não prova titularidade — a 0074 já recusou
-- isso por escrito, e esta migration não a contradiz.
--
-- O que NÃO existia é o caso da planilha com a mesma pessoa duas vezes no mesmo
-- mês. Ele não é erro de importador: é duplicação na origem, e por isso nenhum
-- dos dois modelos pode estar certo sozinho.

ALTER TABLE fin_pendencia_tipo DROP CONSTRAINT IF EXISTS fin_pendencia_tipo_vocab;
ALTER TABLE fin_pendencia_tipo ADD CONSTRAINT fin_pendencia_tipo_vocab CHECK (tipo IN (
  'tx_contraparte_ausente_taxa_asaas', 'tx_contraparte_ausente_com_liquidacao',
  'tx_contraparte_ausente_sem_evidencia', 'tx_documento_da_fonte_sem_cadastro',
  'tx_sem_categoria', 'tx_categoria_declara_ignorancia', 'tx_indeterminado_declarado',
  'tx_sem_nucleo', 'tx_sem_centro_de_custo',
  'doc_sem_categoria', 'doc_sem_contraparte', 'doc_receber_vencido_sem_liquidacao',
  'card_sem_categoria', 'card_sem_titular', 'card_sem_centro_de_custo',
  'contraparte_sem_documento', 'contraparte_possivel_duplicata',
  'pessoa_vinculo_indefinido', 'pessoa_sem_documento', 'pessoa_status_contradiz_pagamento',
  'contrato_sem_contraparte', 'erp_contrato_contraparte_nao_casada',
  'erp_contrato_multisservico', 'erp_contrato_eixo_ambos', 'cobranca_sem_tipo_de_servico',
  'transferencia_perna_sem_extrato', 'conta_sem_cobertura_extrato', 'conta_fora_do_ledger',
  'regra_aguardando_fonte', 'regra_em_sombra',
  'pessoa_duplicada_na_planilha'
));

INSERT INTO fin_pendencia_tipo
  (tipo, universo, caminho_de_correcao, o_que_falta, evidencia_padrao, alcancavel_agora, causa_comum, ordem)
SELECT 'pessoa_duplicada_na_planilha', 'fin_person', 'decisao_humana',
       'Qual dos dois blocos vale. Em Fevereiro26 o Fernando tem bloco em C11 (Google Drive 4,50 + Ar Cond 3/12 324,95 + Monitores 3/12 144,50 + Custo de Sala 291,66 = 765,61, que é o total escrito na planilha) E outro bloco em C2, com "Notebooks part 2 - 8/24" de 291,66. Os dois importadores leram blocos diferentes, e é por isso que os modelos divergem em 291,66.',
       'A planilha corrigida, ou a confirmação de qual lançamento existiu de fato.',
       false, 'planilha-com-pessoa-repetida-no-mes', 310
 WHERE NOT EXISTS (SELECT 1 FROM fin_pendencia_tipo WHERE tipo = 'pessoa_duplicada_na_planilha');

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  n integer;
  dia integer;
BEGIN
  SELECT due_day INTO dia FROM fin_card_account WHERE slug = 'inter-cartao';
  IF dia IS NULL THEN
    RAISE EXCEPTION 'o Inter continua sem due_day; ele seguiria projetando zero';
  END IF;

  SELECT count(*) INTO n FROM fin_pendencia_tipo WHERE tipo = 'pessoa_duplicada_na_planilha';
  IF n <> 1 THEN RAISE EXCEPTION 'o tipo de pendência novo não entrou'; END IF;

  -- Os 30 tipos anteriores continuam válidos: o CHECK foi ampliado, não trocado.
  SELECT count(*) INTO n FROM fin_pendencia_tipo;
  IF n <> 31 THEN RAISE EXCEPTION 'esperava 31 tipos, há %', n; END IF;

  -- A titularidade NÃO pode ter sido decidida aqui: ela é o exemplo do que esta
  -- migration deliberadamente não resolve.
  SELECT count(*) INTO n FROM fin_card_account
   WHERE slug = 'inter-cartao' AND ownership <> 'indeterminado';
  IF n <> 0 THEN
    RAISE EXCEPTION 'alguém decidiu a titularidade do Inter numa migration; ela é decisão humana';
  END IF;
END $$;
