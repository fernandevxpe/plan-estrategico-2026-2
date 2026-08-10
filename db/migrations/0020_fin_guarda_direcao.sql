-- Regra de despesa deixa de classificar receita (e vice-versa).
--
-- As regras de texto casam contra `description_norm` sem olhar o sinal do
-- valor. O caso que obriga a correção: existe um cliente chamado "POSTO QUARTO
-- DE MILHA LTDA". A regra `combustivel` procura "posto " e captura as cobranças
-- RECEBIDAS dele como despesa de combustível — medido com o motor de produção
-- contra a base inteira: 261 lançamentos de entrada, R$ 103.755,62 de receita
-- virando despesa.
--
-- Não é caso isolado. Nove regras capturam os dois sentidos hoje:
--   41 combustivel            261 entradas   R$ 103.755,62
--   38 telecom-internet         9 entradas   R$  24.400,00
--   47 marketplace-e-apps      17 entradas   R$   2.847,81
--   49 alimentacao-equipe      47 entradas   R$   2.765,60
--   20 recarga-de-cartao        1 entrada    R$   5.573,21
--   40 meios-de-pagamento       1 entrada    R$   5.573,21
--   45 material-eletrico        1 entrada    R$     697,00
--
-- O motor JÁ suporta o campo `direction` — a regra 42 (`pix-pessoa-fisica`) usa
-- desde sempre. Ou seja, isto é correção de dado, não de código: nenhuma linha
-- do avaliador muda, e é por isso que dá para aplicar sem risco de regressão no
-- que já funciona.
--
-- `direction` vale 'pagar' quando amount_cents < 0 e 'receber' caso contrário,
-- derivado igual em scripts/import-asaas.mjs e lib/financeiro/importacao.ts.

-- 1. Regras que só podem classificar SAÍDA.
--
-- Inclui regras que hoje não capturam receita nenhuma (tributos, CREA, energia,
-- aluguel). A guarda ali é preventiva e barata: o dia em que aparecer um
-- reembolso de tributo ou um crédito da concessionária, a regra não vai
-- transformá-lo em despesa.
UPDATE fin_rule
   SET conditions = jsonb_set(
         conditions,
         '{all}',
         COALESCE(conditions -> 'all', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('op', 'equals', 'field', 'direction', 'value', 'pagar'))
       ),
       updated_at = now(),
       notes = COALESCE(notes || ' | ', '') || 'guarda de direção (pagar) em 0020'
 WHERE slug IN (
   'tarifas-do-asaas',
   'recarga-de-cartao-asaas',
   'pagamento-de-contas-pelo-asaas',
   'fatura-cartao-corporativo',
   'tributos-receita-federal',
   'fgts',
   'iss-municipal',
   'crea-conselhos',
   'energia-concessionaria',
   'telecom-internet',
   'software-assinaturas',
   'meios-de-pagamento',
   'combustivel',
   'material-eletrico-obras',
   'locacao-veiculos',
   'marketplace-e-apps',
   'condominio-e-aluguel',
   'alimentacao-equipe'
 )
   -- Idempotente: não duplica a guarda se a migration rodar de novo.
   AND conditions::text NOT LIKE '%"direction"%';

-- 2. Regras que só podem classificar ENTRADA.
--
-- Estorno recebido e rendimento de aplicação são entrada por definição. Sem a
-- guarda, uma saída com o mesmo texto (um estorno que a empresa devolve) seria
-- classificada como receita.
UPDATE fin_rule
   SET conditions = jsonb_set(
         conditions,
         '{all}',
         COALESCE(conditions -> 'all', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('op', 'equals', 'field', 'direction', 'value', 'receber'))
       ),
       updated_at = now(),
       notes = COALESCE(notes || ' | ', '') || 'guarda de direção (receber) em 0020'
 WHERE slug IN ('estorno-recebido', 'rendimento-de-caixinha')
   AND conditions::text NOT LIKE '%"direction"%';

-- 3. O que NÃO recebe guarda, e por quê.
--
-- 'transferencia-entre-contas-proprias' (18), 'aplicacao-em-caixinha' (30) e
-- 'transferencia-para-si-mesma' (32) capturam os dois sentidos porque
-- transferência TEM duas pernas: sai de uma conta e entra em outra. Prendê-las
-- a um sentido só destruiria a perna de chegada e o pareamento nunca fecharia.
--
-- 'estorno-de-pix' (19) fica de fora por outro motivo: hoje só aparece em
-- entradas, mas estorno legitimamente ocorre nos dois sentidos, e não há dado
-- suficiente para decidir. Deixar sem guarda é o comportamento atual — mudar
-- exigiria uma decisão de negócio que este arquivo não pode tomar sozinho.
