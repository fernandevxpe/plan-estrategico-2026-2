-- O extrato do Nubank passa a ser etapa do botão e do agendador.
-- ===========================================================================
-- O catálogo da 0109 declara, fonte a fonte, se ela é atualizada por
-- agendamento. `erp_obras` e `polp` diziam "não", e o motivo estava escrito:
-- não existia etapa delas em scripts/scheduler.mjs (Dúvida 65).
--
-- O QUE MOTIVOU, medido em 01/09/2026 com o botão recém-consertado:
--
--   asaas ....... último dado 01/09   em dia
--   inter_api ... último dado 01/09   em dia
--   erp_obras ... último dado 15/08   18 dias corridos, 13 úteis · ALARME
--   polp ........ último dado 15/08   18 dias corridos, 13 úteis · ALARME
--
-- Eram 117 lançamentos e R$ 11.682,57 de fora — numa conta que é por onde a
-- folha sai. As duas fontes estavam certas em se declarar atrasadas; o que
-- faltava era um caminho para deixarem de estar.
--
-- ---------------------------------------------------------------------------
-- SÓ UMA DAS DUAS ENTRA, E A OUTRA GANHA UM MOTIVO MEDIDO
-- ---------------------------------------------------------------------------
-- `erp_obras` virou duas etapas: espelho (staging) e promoção (ledger, restrita
-- à conta `nubank`, que é a que esta fonte declara alimentar).
--
-- A promoção passou a fechar o par que antes uma pessoa fechava à mão pela
-- 0041: na MESMA transação ela grava `current_balance_cents` com o saldo que a
-- Polp devolve para a conta corrente, estende `fin_statement_coverage` e
-- confere G1 e F3 antes do COMMIT. Se qualquer um não fechar, ela desfaz a
-- promoção inteira — "promove e fecha, ou não promove". Sem isso, automatizar a
-- promoção trocaria uma fonte atrasada por dois invariantes quebrados.
--
-- Conferido em 01/09/2026, por três caminhos independentes:
--
--   R$ 11.682,57  saldo deste ledger em 15/08 (o que a 0041 gravou)
--  -R$ 11.682,57  líquido dos 117 lançamentos de 16/08 a 01/09, vindos do ERP
--   ────────────
--   R$      0,00  = saldo que a Polp devolve para a conta corrente hoje
--
-- `polp` NÃO entrou porque não roda. Duas execuções seguidas do dry-run no dia:
-- a fonte declara `meta.total = 108` posições, a paginação devolve 108 linhas
-- com 91 distintas, e a varredura por id recuperou 3 numa e 0 na outra. Sondados
-- 40 ids acima do máximo, nenhum pertence a esta integração — as que faltam não
-- são posições novas fora da faixa varrida. O ingestor aborta, e ABORTAR ESTÁ
-- CERTO: gravar 91 de 108 produz um saldo de caixinha menor que o real.
--
-- Uma etapa que aborta toda noite faria toda execução terminar em 'parcial', o
-- mesmo defeito que o fin-review-lifecycle já causou nessa lista — quando o
-- desfecho é sempre 'parcial', ele para de significar alguma coisa. Então em
-- vez de uma etapa que falha, a tela ganha a frase que explica.
--
-- A restrição nº 1 continua valendo e não foi afrouxada: o espelho abre a
-- sessão no banco do Adryan como READ ONLY e confere a trava antes da primeira
-- consulta. O que esta frente automatiza é a LEITURA de lá e a escrita AQUI.
--
-- `comando` fica como está: continua sendo o comando correto para rodar a fonte
-- à mão, e uma fonte agendada não deixa de ter um.
-- ===========================================================================

UPDATE fin_fonte_catalogo
   SET agendada = true,
       motivo_nao_agendada = NULL
 WHERE fonte = 'erp_obras'
   AND NOT agendada;

UPDATE fin_fonte_catalogo
   SET motivo_nao_agendada =
         'a fonte declara 108 posições e entrega 91: a paginação é instável e a varredura por id ' ||
         'recuperou 3 numa execução e 0 na seguinte (medido em 01/09/2026, duas rodadas). O ingestor ' ||
         'aborta em vez de gravar saldo de caixinha menor que o real, e por isso ela não virou etapa ' ||
         'do botão — uma etapa que aborta toda noite faria toda execução terminar em ''parcial''. ' ||
         'Enquanto isso ela se atualiza pelo comando, quando a paginação colaborar.'
 WHERE fonte = 'polp';

DO $$
DECLARE estado record;
BEGIN
  SELECT bool_and(agendada) FILTER (WHERE fonte = 'erp_obras') AS erp_dentro,
         bool_or(agendada)  FILTER (WHERE fonte = 'polp')      AS polp_dentro,
         bool_and(motivo_nao_agendada IS NOT NULL) FILTER (WHERE fonte = 'polp') AS polp_explicada
    INTO estado
    FROM fin_fonte_catalogo
   WHERE fonte IN ('erp_obras', 'polp');

  IF NOT estado.erp_dentro THEN
    RAISE EXCEPTION '0190: erp_obras continua fora do agendador';
  END IF;
  IF estado.polp_dentro THEN
    RAISE EXCEPTION '0190: polp não deveria estar agendada — ela não roda hoje';
  END IF;
  IF NOT estado.polp_explicada THEN
    RAISE EXCEPTION '0190: polp fora do agendador sem motivo escrito';
  END IF;
END $$;
