-- Os tributos federais que o motor não enxergava.
--
-- R$ 125.599,96 em 33 lançamentos de 2026 estão sem categoria nenhuma, e são
-- todos pagamento de tributo federal. A regra `tributos-receita-federal` existe
-- desde a 0002 e deveria tê-los pego. Não pegou por dois motivos distintos:
--
-- 1. O NUBANK NÃO ESCREVE "RECEITA FEDERAL". Escreve "transacao via pix com qr
--    code para ministerio da fazenda". A lista de termos da regra foi montada
--    lendo extrato do Inter, e nunca viu a forma do outro banco. Fevereiro e
--    maio inteiros — R$ 39.526,28 — caíram por isto.
--
-- 2. Os demais casam com a regra e mesmo assim estão nulos, o que significa que
--    o motor não passou por eles depois que a regra nasceu. Esta migração muda
--    a definição; quem aplica é `scripts/reclassificar.mjs`.
--
-- A SEPARAÇÃO DAS DUAS: DAS × INSS
--
-- O banco não diferencia: as duas saídas dizem "pix enviado receita federal".
-- O que as diferencia é o valor, e não por acaso — são tributos de natureza
-- diferente com bases de cálculo diferentes:
--
--   DAS  varia com o faturamento do mês: R$ 11.810,42 · 17.056,47 · 12.942,89 ·
--        27.707,20 · 22.469,81. Mínimo observado: R$ 11.810,42.
--   INSS é o do pró-labore, fixo: R$ 667,92 uma vez e R$ 713,24 nos demais.
--
-- Os dois conjuntos estão separados por mais de uma ordem de grandeza, e a
-- planilha do dono confirma a leitura: as linhas "Simples Nacional" e "INSS"
-- dela trazem exatamente estes valores, mês a mês. A soma das duas bate ao
-- centavo com a linha "Impostos" nos cinco meses fechados.
--
-- Encodar valor numa regra é frágil e eu sei disso: se o INSS subir para
-- R$ 1.100, ele vira DAS em silêncio. A faixa vai até R$ 1.000 (e não colada em
-- R$ 713,24) para absorver reajuste, e o alarme de divergência com a planilha é
-- o que avisa quando a premissa quebrar. É o melhor discriminador que o extrato
-- oferece; a alternativa é jogar INSS dentro de DAS e errar de propósito.

-- 1. A regra existente passa a conhecer a forma do Nubank.
UPDATE fin_rule
   SET conditions = jsonb_set(
         conditions,
         '{all,0,value}',
         '["receita federal","darf","das simples","simples nacional",
           "previdencia social","inss","ministerio da fazenda","min da fazenda"]'::jsonb
       ),
       notes = 'Termos do Nubank ("ministerio da fazenda") acrescentados na 0035.',
       updated_at = now()
 WHERE slug = 'tributos-receita-federal';

-- 2. O INSS do pró-labore sai antes, por valor.
--
-- Prioridade 19: tem de decidir ANTES da 20, que levaria tudo para 7.01. As
-- duas leem o mesmo texto; só a faixa de valor as separa.
INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions, confidence, source, status, created_by, notes)
SELECT e.id,
       'inss-pro-labore',
       'INSS do pró-labore (valor fixo mensal)',
       19,
       'transaction',
       jsonb_build_object(
         'all', jsonb_build_array(
           jsonb_build_object('op','contains_any','field','description_norm',
             'value', jsonb_build_array('receita federal','ministerio da fazenda','previdencia social','inss')),
           jsonb_build_object('op','equals','field','direction','value','pagar'),
           -- Entre R$ 600,00 e R$ 1.000,00. O DAS mais barato observado é
           -- R$ 11.810,42, então a faixa não encosta nele.
           jsonb_build_object('op','between','field','amount_abs','value', jsonb_build_array(60000, 100000))
         )
       ),
       jsonb_build_object('category_code','6.03','nucleo','corporativo'),
       80,
       'humano',
       'ativa',
       'migration-0035',
       'Separado do DAS por valor: o extrato não distingue os dois pelo texto.'
  FROM fin_entity e
 WHERE e.slug = 'xpe'
   AND NOT EXISTS (SELECT 1 FROM fin_rule r WHERE r.entity_id = e.id AND r.slug = 'inss-pro-labore');
