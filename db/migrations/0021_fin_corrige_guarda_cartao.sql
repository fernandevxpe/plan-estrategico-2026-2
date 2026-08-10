-- Devolve a perna de volta do cartão, que a 0020 matou.
--
-- Erro de raciocínio na 0020, e vale registrar qual: a própria migration isenta
-- as regras 18, 30 e 32 com o argumento de que "transferência tem duas pernas e
-- prendê-la a um sentido destrói a perna de chegada". A regra 20 é exatamente
-- esse caso e recebeu a guarda assim mesmo.
--
-- `recarga-de-cartao-asaas` casa com dois `source_kind`:
--   ASAAS_CARD_RECHARGE        saída — dinheiro vai para o cartão
--   ASAAS_CARD_BALANCE_REFUND  entrada — saldo volta do cartão
--
-- Ambos apontam para a categoria 9.01, "Transferência entre contas próprias" —
-- ou seja, é o mesmo movimento em dois sentidos, igual às regras isentadas. Com
-- a guarda `direction = 'pagar'`, o ramo de devolução virou código morto: existe
-- 1 lançamento de R$ 5.573,21 na base que a regra não alcança mais.
--
-- A guarda de direção continua certa para regra de despesa de verdade
-- (combustível, telecom, alimentação). Ela é errada para regra de
-- transferência, e a diferença é a categoria de destino: 9.01 é neutra, os dois
-- sentidos pertencem a ela.
DELETE FROM fin_rule WHERE false; -- no-op: mantém o arquivo legível como migration de UPDATE

UPDATE fin_rule
   SET conditions = conditions - 'all',
       updated_at = now(),
       notes = COALESCE(notes || ' | ', '') || 'guarda de direção removida em 0021: regra de transferência tem duas pernas'
 WHERE slug = 'recarga-de-cartao-asaas'
   -- Só age se a guarda da 0020 ainda estiver lá, e só se `all` contiver
   -- exclusivamente a guarda — se alguém acrescentar condição real depois,
   -- apagar o bloco inteiro seria destrutivo.
   AND conditions -> 'all' = '[{"op": "equals", "field": "direction", "value": "pagar"}]'::jsonb;
