-- A janela do teto de cada MEI, as multas medidas, e o veredito sobre o anexo.
--
-- O Fernando declarou o fato que faltava, e ele é regra de negócio, não
-- hipótese:
--
--   "os meis, são alguns funcionários, nao temos clt, apenas alguns socios
--    recebem salario minimo os demais valores pagos são meis, e a propria xpe
--    paga o imposto dos meis"
--   "quero que mostre a janela quanto esta proximo do teto, tem multas q pagam
--    tbm"
--
-- A 0092 mediu o Fator R e parou onde tinha de parar: sem saber o que o MEI é
-- nesta casa, não dava para escolher o numerador. Agora dá. Esta migration NÃO
-- desfaz nenhuma recusa da 0092 — ela mede o que a declaração destravou.
--
-- ==========================================================================
-- O QUE ESTA MIGRATION DESCOBRIU, EM ORDEM DE URGÊNCIA
-- ==========================================================================
--
-- 1. O IGOR CRUZA O TETO EM SETEMBRO/2026, E CRUZA NA FAIXA PIOR.
--    Em 17/08/2026 ele recebeu R$ 76.751,35 da XPE contra um teto de
--    R$ 81.000,00: 94,8%. Faltam R$ 4.248,65 — menos de meio mês do ritmo
--    dele (R$ 8.980,30/mês nos sete meses completos). No mesmo ritmo fecha o
--    ano em R$ 107.763,65, que é 133% do teto.
--
--    A faixa importa mais que o excesso. LC 123/2006 art. 18-A § 7º, III:
--      a) excesso ATÉ 20%   -> desenquadra em 1º/01 do ano SEGUINTE
--      b) excesso ACIMA 20% -> desenquadra RETROATIVO a 1º/01 do ano do excesso
--    R$ 81.000 x 1,20 = R$ 97.200,00. A projeção do Igor passa disso em
--    R$ 10.563,65. Ele não cai na alínea "a", cai na "b": 2026 inteiro é
--    reapurado como ME no regime geral do Simples.
--
--    E a medida é PISO. Esta base só enxerga o que a XPE pagou. Se o MEI tem
--    outro cliente, ele já estourou. Com 94,8% do teto vindo de um contratante
--    só, não sobra espaço para nenhum.
--
-- 2. AS MULTAS SÃO R$ 19,11 NO ACERVO INTEIRO, E ISSO É UM ACHADO SOBRE A
--    BASE, NÃO SOBRE A EMPRESA.
--    A palavra "multa", "juros", "mora" ou "atraso" não aparece em NENHUMA
--    das 13.882 descrições do ledger, e a categoria 9.11 "Juros e multas
--    pagos" — que existe exatamente para isto — tem ZERO lançamentos. Multa
--    nesta base não é uma linha: é um excedente embutido no valor de um
--    pagamento. Foi assim que se achou a única que existe.
--
--    Em 27/04/2026 saíram R$ 105,16 para a Receita Federal, classificados em
--    7.01. O DAS-MEI de serviços é R$ 86,05 ao centavo (5% x R$ 1.621,00 +
--    R$ 5,00). O excedente é R$ 19,11 = 22,21% do principal.
--
--    22,21% é MAIOR que o teto de 20% da multa de mora (Lei 9.430/1996
--    art. 61 § 2º). Isso não é estimativa: é prova de que o pagamento contém
--    juros, porque a multa sozinha não alcança o valor. Decompondo pelo teto:
--    R$ 17,21 de multa + R$ 1,90 de juros. E o teto de 20% só é atingido com
--    0,33%/dia x 61 dias — logo o atraso foi de NO MÍNIMO 61 dias, número
--    derivado da lei, não arbitrado.
--
--    A contagem confirma por um segundo caminho, independente do valor: em
--    fevereiro saíram 4 guias de R$ 86,05; em março, abril, maio, junho,
--    julho e agosto saíram 5. A guia que faltou em fevereiro é a que foi paga
--    com acréscimo em 27/04.
--
--    O que a XPE paga de multa por ano, medido: R$ 19,11. O que ela pode
--    pagar e esta base não veria: qualquer multa embutida no DAS da empresa,
--    porque o DAS da empresa não tem valor esperado derivável — depende da
--    receita declarada. Fica registrado como limite da medição, não como zero.
--
-- 3. A 0092 ESTAVA CONTANDO ESSE PAGAMENTO COMO DAS DA EMPRESA.
--    `fin_das_reconciliacao_v` separava MEI de empresa por igualdade exata a
--    R$ 86,05. R$ 105,16 não é igual a R$ 86,05, então virou DAS da empresa e
--    inflou a base implícita de mar/26 em R$ 826,63. Corrigido aqui, com a
--    mesma lista de colunas, para continuar existindo UMA medida e não duas.
--
--    O corte novo não é arbitrado: entre R$ 111,87 (principal + 30%) e
--    R$ 860,50 (10x o principal) NÃO EXISTE nenhum pagamento em 7.01 no
--    acervo inteiro. O corte cai dentro de um vão vazio provado, e a asserção
--    8.4 se recusa a commitar se o vão deixar de estar vazio.
--
-- 4. A CONTRADIÇÃO DO ANEXO ESTAVA NA JANELA, NÃO NO MEI.
--    A 0092 registrou o impasse: a leitura legal exclui o MEI do numerador e
--    aponta Anexo V (23,42%), mas o DAS efetivamente pago reproduz o Anexo
--    III. As duas coisas são verdadeiras e não se contradizem — o que estava
--    errado era comparar um numerador de 8 meses com um denominador de 12.
--
--    O Fator R é razão entre 12 meses de folha e 12 meses de receita
--    (LC 123/2006 art. 18 § 24). Os extratos de Inter e Nubank começam em
--    01/01/2026 (dúvida 4), então a folha da janela tem 8 dos 12 meses e a
--    receita tem os 12. Recompondo a folha para os mesmos 12 meses, a leitura
--    legal ESTRITA — MEI fora do numerador, como manda o § 25 — dá 35,13%,
--    acima do limiar de 28%. O anexo indicado é o III.
--
--    Ou seja: o Anexo III que a empresa pratica hoje se sustenta SEM precisar
--    contar o MEI. O "Anexo V" da 0092 era artefato de janela truncada, e por
--    isso a resposta não muda quando a dúvida 21 for decidida — o que muda é
--    a conta contábil, não o anexo. Isso derruba o preço de R$ 87 a R$ 100 mil
--    que a 0092 pendurou na dúvida 21.
--
--    `fin_fator_r_veredito_v` mostra as três leituras lado a lado
--    (medida, recomposta, e a que o DAS pago revela) e diz quando elas
--    concordam. Onde não concordam, ela não escolhe.
--
-- 5. "A GENTE NÃO TRABALHA SEM NOTA" — MEDIDO PELOS TRÊS LADOS.
--    Ele afirmou; a base confere, e a direção do erro é a prova. Somando as
--    sete competências de dez/25 a jun/26, a base implícita no DAS pago
--    (R$ 932.615,74, já sem os R$ 826,63 do item 3) é MAIOR que as NFS-e do
--    Asaas (R$ 877.874,63) em R$ 54.741,11. Se houvesse serviço sem nota, a
--    base declarada seria MENOR que o dinheiro que entrou, não maior. O que
--    existe é o contrário: nota que esta base não tem, emitida no portal da
--    prefeitura — exatamente o que ele antecipou na dúvida 50.
--
--    Pelo lado da contraparte: das 159 que pagaram receita em 2026, 119 têm
--    NFS-e nesta base. As 40 sem nota somam R$ 119.370,22 (9,4% da receita) e
--    são quase todas condomínio — o mesmo perfil das notas de portal.
--
--    Veredito gerencial: a afirmação se sustenta. A cobertura fiscal desta
--    base é de ~94% por imposto pago e ~91% por contraparte; o que falta é
--    documento ausente do acervo, não receita sem nota.
--
-- 6. OS SÓCIOS NO SALÁRIO MÍNIMO APARECEM NA GUIA, E A ARITMÉTICA FECHA.
--    R$ 713,24 saem todo mês para a Receita Federal em 6.03. 11% x 4 x
--    R$ 1.621,00 = R$ 713,24 ao centavo — quatro contribuintes individuais em
--    um salário mínimo cada, com a retenção do art. 4º da Lei 10.666/2003. E
--    o pagamento de janeiro (competência dez/25) é R$ 667,92 = 11% x 4 x
--    R$ 1.518,00, o mínimo de 2025. Duas alíquotas, dois mínimos, quatro
--    pessoas: a declaração do Fernando sobre os sócios está no extrato.
--
-- ==========================================================================
-- O QUE ESTA MIGRATION SE RECUSA A FAZER
-- ==========================================================================
--
--  a) NÃO diz de QUEM é cada guia de R$ 86,05. O boleto carrega o CNPJ no
--     código de barras, e o ledger guarda "Receita Federal". São 5 guias por
--     mês para 12 MEIs; qual MEI está em qual guia é indeterminado, com
--     motivo. Dúvida 61.
--
--  b) NÃO inventa faixa de alerta antecipado. A lei declara DOIS pontos —
--     100% e 120% do teto — e esta migration usa exatamente esses dois.
--     "Avisar aos 80%" seria governança que ninguém combinou, do mesmo
--     tamanho do erro que a dúvida 59 evitou no sino. `alerta_antecipado_pct`
--     nasce NULL com motivo. Dúvida 62.
--
--  c) NÃO afirma que o teto do MEI mudou. PLP 108/2021 (R$ 130.000) foi
--     aprovado em urgência na Câmara em 17/03/2026 e NÃO virou lei até a data
--     de consulta. O parâmetro carrega o valor vigente, a redação que o fixou
--     (LC 188/2021) e a data em que foi conferido no Planalto. Se virar lei,
--     entra linha nova com `vigencia_de`; ninguém edita a linha velha.
--
--  d) NÃO qualifica o vínculo. Uma empresa que paga a guia do MEI que lhe
--     presta serviço, e cujo MEI tira 95% do teto dela sozinha, produz um
--     conjunto de fatos que o art. 18-B § 2º da LC 123/2006 endereça. Isso é
--     leitura jurídica, e esta base registra o fato medido sem qualificá-lo.
--     Dúvida 63 — e é a mais cara desta migration.
--
-- TUDO AQUI É LEITURA GERENCIAL E DEPENDE DE VALIDAÇÃO DO CONTADOR. Nenhuma
-- linha desta migration substitui apuração, PGDAS ou parecer.
--
-- Não toca `fin_transaction`, `fin_document`, `fin_category` nem `fin_person`.
-- Cria parâmetros legais, uma tabela vazia, views, e substitui uma view da
-- 0092 preservando a lista de colunas.

-- ==========================================================================
-- 1. OS PARÂMETROS LEGAIS — NENHUM VALOR DE MEMÓRIA
-- ==========================================================================
--
-- Toda linha carrega dispositivo, URL de fonte primária, data de consulta e
-- vigência. `consultado_em` é o que impede este bloco de envelhecer em
-- silêncio: quem ler daqui a um ano vê quando foi conferido pela última vez.

-- O vocabulário de `regime` nasceu na 0081 com os três regimes DA EMPRESA:
-- simples, presumido e real, mais 'comum' para o que atravessa todos. O SIMEI
-- não estava lá porque a 0081 não olhava para o prestador — e ele é um regime
-- de verdade, com artigo próprio (LC 123/2006 art. 18-A), não um apelido de
-- outro. Isto ESTENDE o vocabulário controlado com um membro legítimo do
-- domínio; não afrouxa nada. A diferença importa: afrouxar seria trocar o
-- CHECK por nada para o INSERT passar. Aqui o conjunto continua fechado, com
-- quatro nomes onde havia três, e um INSERT de 'ME' ou 'lucro_arbitrado'
-- continua sendo recusado pelo banco.
ALTER TABLE fin_tax_regime_param DROP CONSTRAINT IF EXISTS fin_tax_regime_param_regime_ck;
ALTER TABLE fin_tax_regime_param ADD CONSTRAINT fin_tax_regime_param_regime_ck
  CHECK (regime IN ('simples', 'presumido', 'real', 'comum', 'mei'));

INSERT INTO fin_tax_regime_param
  (regime, tributo, anexo, faixa, faixa_de_cents, faixa_ate_cents,
   aliquota_nominal, valor_absoluto_cents, parcela_deduzir_cents,
   base_calculo, base_legal, fonte_url, consultado_em, vigencia_de, vigencia_ate,
   indeterminado, observacao)
VALUES
  ('mei', 'LIMITE_RECEITA_BRUTA', NULL, NULL, NULL, NULL,
   NULL, 8100000, 0,
   'receita_bruta_ano_calendario',
   'LC 123/2006 art. 18-A § 1º (redação da LC 188/2021): receita bruta no ano-calendário anterior de ate R$ 81.000,00',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
   DATE '2026-08-17', DATE '2018-01-01', NULL,
   false,
   'Valor conferido no texto consolidado do Planalto em 17/08/2026. A redacao vigente do § 1o e a da LC 188/2021 e mantem os R$ 81.000,00 introduzidos pela LC 155/2016. O PLP 108/2021, que elevaria para R$ 130.000,00, teve urgencia aprovada na Camara em 17/03/2026 e NAO era lei na data da consulta — quando for, entra linha nova com vigencia propria, esta nao se edita.'),

  ('mei', 'LIMITE_PROPORCIONAL_MES', NULL, NULL, NULL, NULL,
   NULL, 675000, 0,
   'valor_absoluto',
   'LC 123/2006 art. 18-A § 2º (redação da LC 155/2016): R$ 6.750,00 por mês entre o inicio de atividade e o fim do ano-calendario, fracao de mes conta como mes inteiro',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
   DATE '2026-08-17', DATE '2018-01-01', NULL,
   false,
   'So se aplica no ano de inicio de atividade. Esta base NAO tem a data de abertura de nenhum dos 12 CNPJ de MEI, entao o limite proporcional nunca e aplicado automaticamente — fin_mei_teto_v declara isso em vez de assumir ano cheio para quem abriu no meio do ano.'),

  ('mei', 'TOLERANCIA_EXCESSO', NULL, NULL, NULL, NULL,
   0.20, NULL, 0,
   'fracao_do_limite',
   'LC 123/2006 art. 18-A § 7º, III, "a" e "b": excesso de ate 20% desenquadra em 1º/01 do ano seguinte; acima de 20% desenquadra retroativamente a 1º/01 do ano do excesso',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
   DATE '2026-08-17', DATE '2018-01-01', NULL,
   false,
   'Sao os DOIS unicos pontos de corte que a lei declara sobre o teto do MEI. Qualquer outra faixa de alerta nesta base seria invencao.'),

  ('mei', 'DIFERENCA_EXCESSO_ATE_20', NULL, NULL, NULL, NULL,
   NULL, NULL, 0,
   'indeterminado',
   'LC 123/2006 art. 18-A § 10: na hipotese da alinea "a", o MEI recolhe a diferenca SEM ACRESCIMOS, em parcela unica, junto da apuracao de janeiro do ano seguinte',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
   DATE '2026-08-17', DATE '2018-01-01', NULL,
   true,
   'Sem aliquota propria: a diferenca e apurada pelas regras gerais do Simples sobre a receita que excedeu, e depende do anexo do MEI, que esta base nao conhece.'),

  ('comum', 'MULTA_MORA_DIARIA', NULL, NULL, NULL, NULL,
   0.0033, NULL, 0,
   'tributo_em_atraso',
   'Lei 9.430/1996 art. 61 caput: multa de mora de 0,33% por dia de atraso, contada do primeiro dia apos o vencimento ate o dia do pagamento (§ 1º)',
   'https://www.planalto.gov.br/ccivil_03/leis/L9430.htm',
   DATE '2026-08-17', DATE '1997-01-01', NULL,
   false,
   'Aplica-se ao Simples por forca do art. 35 da LC 123/2006, que manda usar as normas de juros e multa de mora do imposto de renda.'),

  ('comum', 'MULTA_MORA_TETO', NULL, NULL, NULL, NULL,
   0.20, NULL, 0,
   'tributo_em_atraso',
   'Lei 9.430/1996 art. 61 § 2º: o percentual de multa fica limitado a vinte por cento',
   'https://www.planalto.gov.br/ccivil_03/leis/L9430.htm',
   DATE '2026-08-17', DATE '1997-01-01', NULL,
   false,
   'O teto e o que torna a decomposicao demonstravel: excedente acima de 20% do principal PROVA que ha juros, sem precisar saber a data de vencimento.'),

  ('comum', 'JUROS_MORA_MES_PAGAMENTO', NULL, NULL, NULL, NULL,
   0.01, NULL, 0,
   'tributo_em_atraso',
   'Lei 9.430/1996 art. 61 § 3º: juros de mora pela SELIC acumulada do mes seguinte ao vencimento ate o mes anterior ao pagamento, mais 1% no mes do pagamento',
   'https://www.planalto.gov.br/ccivil_03/leis/L9430.htm',
   DATE '2026-08-17', DATE '1997-01-01', NULL,
   false,
   'So o 1% do mes do pagamento e valor fixo. A parcela SELIC NAO esta nesta base e nao foi assumida: fin_das_mei_pagamento_v devolve o juros como residuo medido, nao como taxa reconstruida.'),

  ('comum', 'SALARIO_MINIMO', NULL, NULL, NULL, NULL,
   NULL, 151800, 0,
   'valor_absoluto',
   'Decreto 12.342/2024 art. 1º — R$ 1.518,00 a partir de 1º de janeiro de 2025',
   'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/decreto/d12342.htm',
   DATE '2026-08-17', DATE '2025-01-01', DATE '2025-12-31',
   false,
   'Entra porque a competencia dez/2025 e paga em jan/2026 e aparece no ledger: os R$ 667,92 de 19/01/2026 sao 11% x 4 x R$ 1.518,00. Sem o minimo de 2025 esse pagamento fica sem explicacao aritmetica.'),

  ('comum', 'INSS_CONTRIBUINTE_INDIVIDUAL_RETIDO', NULL, NULL, NULL, NULL,
   0.11, NULL, 0,
   'pro_labore',
   'Lei 8.212/1991 art. 21 caput c/c Lei 10.666/2003 art. 4º: 11% descontados pela empresa contratante sobre a remuneracao do contribuinte individual, observado o limite do salario de contribuicao',
   'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.666.htm',
   DATE '2026-08-17', DATE '2003-05-09', NULL,
   false,
   'E a aliquota que explica os R$ 713,24 mensais em 6.03: 11% x 4 salarios minimos de 2026.'),

  ('comum', 'CPP_CONTRATANTE_DE_MEI', NULL, NULL, NULL, NULL,
   0.20, NULL, 0,
   'servico_de_mei_do_art_18b',
   'LC 123/2006 art. 18-B c/c Lei 8.212/1991 art. 22, III: a contratante de servicos de MEI de hidraulica, ELETRICIDADE, pintura, alvenaria, carpintaria e manutencao ou reparo de veiculos recolhe a contribuicao patronal de 20% sobre esses servicos',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
   DATE '2026-08-17', DATE '2014-08-07', NULL,
   true,
   'INDETERMINADO DE PROPOSITO: a aliquota e certa, a incidencia nao. Ela depende de QUAL servico cada MEI presta, e nenhum dos 12 tem servico descrito nesta base (e o buraco da duvida 21). A XPE emite 26,1% das notas no codigo municipal 14.01 (manutencao eletrica), que e exatamente a hipotese "eletricidade" do § 1o. Se o art. 18-B alcancar os pagamentos a MEI, sao 20% sobre R$ 264.206,66 em 2026. Duvida 63.')
ON CONFLICT (regime, tributo, COALESCE(anexo, ''), COALESCE(faixa::integer, 0), vigencia_de) DO NOTHING;

-- ==========================================================================
-- 2. O VALOR DO DAS-MEI, DERIVADO — NUNCA DIGITADO
-- ==========================================================================
--
-- R$ 86,05 não é uma constante desta base: é 5% do salário mínimo vigente mais
-- R$ 5,00 de ISS. Escrito assim, ele se corrige sozinho quando o mínimo muda,
-- e a migration inteira continua verdadeira em 2027.

CREATE OR REPLACE VIEW fin_das_mei_valor_v AS
SELECT
  p.vigencia_de                                                  AS vigente_de,
  p.vigencia_ate                                                 AS vigente_ate,
  p.valor_absoluto_cents                                         AS salario_minimo_cents,
  inss.aliquota_nominal                                          AS aliquota_inss,
  iss.valor_absoluto_cents                                       AS iss_cents,
  round(p.valor_absoluto_cents * inss.aliquota_nominal)::bigint   AS inss_cents,
  (round(p.valor_absoluto_cents * inss.aliquota_nominal)
     + iss.valor_absoluto_cents)::bigint                          AS das_mei_servicos_cents,
  format(
    '%s%% de R$ %s (INSS) + R$ %s (ISS) = R$ %s',
    to_char(inss.aliquota_nominal * 100, 'FM990D0'),
    to_char(p.valor_absoluto_cents / 100.0, 'FM999G990D00'),
    to_char(iss.valor_absoluto_cents / 100.0, 'FM990D00'),
    to_char((round(p.valor_absoluto_cents * inss.aliquota_nominal)
              + iss.valor_absoluto_cents) / 100.0, 'FM999G990D00')
  )                                                              AS memoria,
  'LC 123/2006 art. 18-A § 3º, IV e V, c/c Lei 8.212/1991 art. 21 § 2º, II, "b"'::text AS base_legal,
  'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'::text                     AS fonte_url
  FROM fin_tax_regime_param p
  CROSS JOIN LATERAL (
    SELECT aliquota_nominal FROM fin_tax_regime_param
     WHERE regime = 'comum' AND tributo = 'DAS_MEI_INSS' LIMIT 1) inss
  CROSS JOIN LATERAL (
    SELECT valor_absoluto_cents FROM fin_tax_regime_param
     WHERE regime = 'comum' AND tributo = 'DAS_MEI_ISS' LIMIT 1) iss
 WHERE p.regime = 'comum' AND p.tributo = 'SALARIO_MINIMO';

COMMENT ON VIEW fin_das_mei_valor_v IS
  'O DAS-MEI de prestador de servicos, derivado do salario minimo de cada vigencia. Existe para '
  'que R$ 86,05 nunca apareca digitado em lugar nenhum: em 2027 o minimo muda e todo o resto '
  'desta base continua certo sozinho.';

-- ==========================================================================
-- 3. AS MULTAS — ACHADAS PELA ARITMÉTICA, PORQUE NÃO HÁ RÓTULO
-- ==========================================================================
--
-- Não existe lançamento com a palavra "multa" no acervo. Existe pagamento cujo
-- valor não é o valor esperado, e a diferença é o acréscimo. Este é o único
-- tributo desta empresa em que isso funciona: o DAS-MEI tem valor derivável da
-- lei; o DAS da empresa depende da receita declarada e por isso NÃO tem valor
-- esperado — qualquer multa embutida nele é invisível aqui, e a view diz isso
-- em vez de devolver zero.
--
-- A separação MEI/empresa por ordem de grandeza é fato medido, não escolha: o
-- DAS da empresa vai de R$ 5.693,92 a R$ 27.812,36 e o do MEI é R$ 86,05. A
-- asserção 8.4 prova que o vão entre 1,3x e 10x o principal está vazio e se
-- recusa a commitar se deixar de estar.

CREATE OR REPLACE VIEW fin_das_mei_pagamento_v AS
WITH v AS (
  SELECT das_mei_servicos_cents AS principal_cents
    FROM fin_das_mei_valor_v
   WHERE vigente_de <= CURRENT_DATE AND (vigente_ate IS NULL OR vigente_ate >= CURRENT_DATE)
   ORDER BY vigente_de DESC LIMIT 1
),
par AS (
  SELECT
    (SELECT aliquota_nominal FROM fin_tax_regime_param
      WHERE regime = 'comum' AND tributo = 'MULTA_MORA_TETO')     AS multa_teto,
    (SELECT aliquota_nominal FROM fin_tax_regime_param
      WHERE regime = 'comum' AND tributo = 'MULTA_MORA_DIARIA')   AS multa_dia
),
pag AS (
  SELECT t.id, t.posted_on, abs(t.amount_cents) AS valor_cents, a.name AS conta,
         t.description_raw
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    JOIN fin_account  a ON a.id = t.account_id
   WHERE t.amount_cents < 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
     AND c.code = '7.01'
)
SELECT
  pag.id                AS transaction_id,
  pag.posted_on,
  pag.conta,
  pag.valor_cents,
  v.principal_cents,
  CASE
    WHEN pag.valor_cents = v.principal_cents            THEN 'mei_no_prazo'
    WHEN pag.valor_cents <  v.principal_cents * 10      THEN 'mei_com_acrescimo'
    ELSE 'empresa'
  END                   AS especie,
  CASE WHEN pag.valor_cents < v.principal_cents * 10
       THEN (pag.valor_cents - v.principal_cents)::bigint END      AS acrescimo_cents,
  -- A multa é o MENOR entre o excedente e o teto legal. Nunca o excedente
  -- inteiro: acima do teto, o resto é juros por força do § 2º.
  CASE WHEN pag.valor_cents < v.principal_cents * 10
       THEN LEAST(pag.valor_cents - v.principal_cents,
                  round(v.principal_cents * par.multa_teto))::bigint END AS multa_cents,
  CASE WHEN pag.valor_cents < v.principal_cents * 10
       THEN GREATEST(pag.valor_cents - v.principal_cents
                     - round(v.principal_cents * par.multa_teto), 0)::bigint END AS juros_cents,
  -- Prova, não suposição: excedente acima do teto da multa só fecha com juros.
  CASE WHEN pag.valor_cents < v.principal_cents * 10
       THEN (pag.valor_cents - v.principal_cents)
            > round(v.principal_cents * par.multa_teto) END        AS contem_juros_provado,
  -- Se a multa bateu no teto, o atraso é no mínimo teto/taxa-diária dias.
  CASE WHEN pag.valor_cents < v.principal_cents * 10
        AND (pag.valor_cents - v.principal_cents)
            >= round(v.principal_cents * par.multa_teto)
       THEN ceil(par.multa_teto / par.multa_dia)::integer END       AS dias_atraso_minimo,
  CASE
    WHEN pag.valor_cents >= v.principal_cents * 10 THEN
      'DAS da empresa. Nao tem valor esperado derivavel da lei (depende da receita declarada), '
      'entao multa embutida aqui e INDETERMINADA — nao zero. So o PGDAS ou o proprio DAS separam.'
    WHEN pag.valor_cents = v.principal_cents THEN
      'DAS-MEI no valor exato da lei. Sem acrescimo.'
    ELSE
      'DAS-MEI com acrescimo. De quem e a guia: indeterminado — o CNPJ esta no codigo de barras '
      'do boleto e o ledger guarda apenas "Receita Federal". Duvida 61.'
  END                   AS leitura,
  format(
    'Pago R$ %s; DAS-MEI da lei R$ %s; excedente R$ %s (%s%% do principal). Teto da multa de mora: '
    '20%% (Lei 9.430/1996 art. 61 § 2o). Acima disso o saldo e juros (§ 3o).',
    to_char(pag.valor_cents / 100.0, 'FM999G990D00'),
    to_char(v.principal_cents / 100.0, 'FM999G990D00'),
    to_char((pag.valor_cents - v.principal_cents) / 100.0, 'FM999G990D00'),
    to_char(100.0 * (pag.valor_cents - v.principal_cents) / v.principal_cents, 'FM990D00')
  )                     AS memoria,
  'Lei 9.430/1996 art. 61 §§ 1º a 3º, aplicado ao Simples pela LC 123/2006 art. 35'::text AS base_legal,
  'https://www.planalto.gov.br/ccivil_03/leis/L9430.htm'::text                             AS fonte_url
  FROM pag CROSS JOIN v CROSS JOIN par;

COMMENT ON VIEW fin_das_mei_pagamento_v IS
  'Classifica cada pagamento de 7.01 entre DAS-MEI no prazo, DAS-MEI com acrescimo e DAS da '
  'empresa, e decompoe o acrescimo em multa (ate o teto de 20%) e juros. A multa nesta base nao '
  'tem rotulo em lugar nenhum: e sempre excedente embutido no valor. Gerencial, sujeito a '
  'validacao do contador.';

-- ==========================================================================
-- 4. A JANELA DO TETO — POR MEI, COM O MÊS DE CRUZAMENTO
-- ==========================================================================
--
-- As faixas são as DUAS que a lei declara, e nenhuma a mais. O ritmo é medido
-- só sobre meses COMPLETOS: incluir o mês corrente, que na data de leitura tem
-- metade dos dias, puxaria o ritmo para baixo e adiaria o cruzamento — erro
-- para o lado errado, justamente em quem está perto do teto.

CREATE OR REPLACE VIEW fin_mei_teto_v AS
WITH lim AS (
  SELECT
    (SELECT valor_absoluto_cents FROM fin_tax_regime_param
      WHERE regime = 'mei' AND tributo = 'LIMITE_RECEITA_BRUTA'
        AND vigencia_de <= CURRENT_DATE ORDER BY vigencia_de DESC LIMIT 1)   AS limite_cents,
    (SELECT aliquota_nominal FROM fin_tax_regime_param
      WHERE regime = 'mei' AND tributo = 'TOLERANCIA_EXCESSO')               AS tolerancia,
    (SELECT base_legal FROM fin_tax_regime_param
      WHERE regime = 'mei' AND tributo = 'LIMITE_RECEITA_BRUTA'
        AND vigencia_de <= CURRENT_DATE ORDER BY vigencia_de DESC LIMIT 1)   AS limite_base_legal,
    (SELECT fonte_url FROM fin_tax_regime_param
      WHERE regime = 'mei' AND tributo = 'LIMITE_RECEITA_BRUTA'
        AND vigencia_de <= CURRENT_DATE ORDER BY vigencia_de DESC LIMIT 1)   AS limite_fonte_url,
    (SELECT consultado_em FROM fin_tax_regime_param
      WHERE regime = 'mei' AND tributo = 'LIMITE_RECEITA_BRUTA'
        AND vigencia_de <= CURRENT_DATE ORDER BY vigencia_de DESC LIMIT 1)   AS limite_consultado_em
),
-- Até onde o ledger enxerga. Um mês só é "completo" se o extrato cobre o
-- último dia dele; senão o ritmo mediria um mês pela metade.
corte AS (
  SELECT max(posted_on) AS ate,
         date_trunc('month', max(posted_on))::date AS mes_corrente
    FROM fin_transaction
),
link AS (
  SELECT person_id, counterparty_id FROM fin_person_counterparty WHERE status = 'confirmado'
),
mov AS (
  SELECT p.id                                       AS person_id,
         p.name                                     AS pessoa,
         p.cnpj,
         p.status                                   AS situacao_cadastro,
         date_part('year', t.posted_on)::integer    AS ano,
         date_trunc('month', t.posted_on)::date     AS mes,
         sum(abs(t.amount_cents))::bigint           AS cents
    FROM fin_transaction t
    JOIN link  l ON l.counterparty_id = t.counterparty_id
    JOIN fin_person p ON p.id = l.person_id
   WHERE p.employment_type = 'mei'
     AND t.amount_cents < 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
   GROUP BY 1, 2, 3, 4, 5, 6
),
agr AS (
  SELECT m.person_id, m.pessoa, m.cnpj, m.situacao_cadastro, m.ano,
         sum(m.cents)::bigint                                            AS recebido_cents,
         sum(m.cents) FILTER (WHERE m.mes < c.mes_corrente)::bigint      AS recebido_meses_completos_cents,
         count(*) FILTER (WHERE m.mes < c.mes_corrente)::integer         AS meses_completos_com_pagamento,
         count(*)::integer                                               AS meses_com_pagamento,
         min(m.mes)                                                      AS primeiro_mes,
         max(m.mes)                                                      AS ultimo_mes,
         -- Denominador do ritmo: meses completos DECORRIDOS no ano, não meses
         -- em que houve pagamento. Quem ficou um mês sem receber tem ritmo
         -- menor, e é verdade que tem.
         GREATEST(
           CASE WHEN m.ano = date_part('year', c.ate)::integer
                THEN date_part('month', c.mes_corrente)::integer - 1
                ELSE 12 END, 0)::integer                                 AS meses_decorridos_completos
    FROM mov m CROSS JOIN corte c
   -- `corte` devolve uma linha só; agrupar por ela é inócuo e deixa a
   -- expressão de meses decorridos legível no lugar onde ela é lida.
   GROUP BY m.person_id, m.pessoa, m.cnpj, m.situacao_cadastro, m.ano, c.ate, c.mes_corrente
),
calc AS (
  SELECT a.*,
         l.limite_cents, l.tolerancia, l.limite_base_legal, l.limite_fonte_url,
         l.limite_consultado_em,
         round(l.limite_cents * (1 + l.tolerancia))::bigint AS limite_com_tolerancia_cents,
         CASE WHEN a.meses_decorridos_completos > 0
              THEN round(COALESCE(a.recebido_meses_completos_cents, 0)::numeric
                         / a.meses_decorridos_completos)::bigint END      AS ritmo_mensal_cents,
         CASE WHEN a.meses_decorridos_completos > 0
              THEN round(COALESCE(a.recebido_meses_completos_cents, 0)::numeric
                         / a.meses_decorridos_completos * 12)::bigint END AS projecao_fechamento_cents,
         (l.limite_cents - a.recebido_cents)::bigint                      AS falta_para_o_limite_cents
    FROM agr a CROSS JOIN lim l
),
cruz AS (
  SELECT c.*,
         -- Quantos meses de ritmo faltam para o acumulado alcançar o limite.
         CASE WHEN c.ritmo_mensal_cents > 0 AND c.falta_para_o_limite_cents > 0
              THEN round(c.falta_para_o_limite_cents::numeric / c.ritmo_mensal_cents, 2)
              WHEN c.falta_para_o_limite_cents <= 0 THEN 0
              END                                                         AS meses_ate_cruzar
    FROM calc c
)
SELECT
  z.person_id,
  z.pessoa,
  z.cnpj,
  z.situacao_cadastro,
  z.ano,
  z.recebido_cents,
  z.meses_com_pagamento,
  z.meses_decorridos_completos,
  z.primeiro_mes,
  z.ultimo_mes,
  z.limite_cents,
  z.limite_com_tolerancia_cents,
  round(z.recebido_cents::numeric / z.limite_cents, 4)                    AS pct_do_limite,
  z.falta_para_o_limite_cents,
  z.ritmo_mensal_cents,
  z.projecao_fechamento_cents,
  CASE WHEN z.projecao_fechamento_cents IS NOT NULL
       THEN round(z.projecao_fechamento_cents::numeric / z.limite_cents, 4) END AS pct_projetado,
  z.meses_ate_cruzar,
  -- O mês em que cruza, se o ritmo se mantiver. NULL quando não cruza dentro
  -- do ano — e aí é NULL porque não cruza, não por falta de dado.
  CASE
    WHEN z.falta_para_o_limite_cents <= 0
      THEN date_trunc('month', z.ultimo_mes)::date
    WHEN z.meses_ate_cruzar IS NOT NULL
     AND (date_trunc('month', CURRENT_DATE) + (ceil(z.meses_ate_cruzar) || ' months')::interval)::date
         <= make_date(z.ano, 12, 1)
      THEN (date_trunc('month', CURRENT_DATE) + (ceil(z.meses_ate_cruzar) || ' months')::interval)::date
  END                                                                     AS mes_cruzamento,
  -- As duas faixas da lei, e uma terceira que é projeção declarada como tal.
  CASE
    WHEN z.recebido_cents > z.limite_com_tolerancia_cents THEN 'excedido_acima_20'
    WHEN z.recebido_cents > z.limite_cents                THEN 'excedido_ate_20'
    WHEN z.projecao_fechamento_cents > z.limite_com_tolerancia_cents THEN 'projeta_exceder_acima_20'
    WHEN z.projecao_fechamento_cents > z.limite_cents               THEN 'projeta_exceder_ate_20'
    ELSE 'dentro'
  END                                                                     AS situacao,
  CASE
    WHEN z.recebido_cents > z.limite_com_tolerancia_cents OR
         z.projecao_fechamento_cents > z.limite_com_tolerancia_cents THEN
      'Excesso acima de 20% do teto: LC 123/2006 art. 18-A § 7o, III, "b" — desenquadramento '
      'RETROATIVO a 1o de janeiro do proprio ano, e o ano inteiro e reapurado pelas regras gerais '
      'do Simples como ME (§ 9o). A comunicacao a RFB e obrigatoria ate o ultimo dia util do mes '
      'seguinte ao do excesso.'
    WHEN z.recebido_cents > z.limite_cents OR
         z.projecao_fechamento_cents > z.limite_cents THEN
      'Excesso de ate 20% do teto: LC 123/2006 art. 18-A § 7o, III, "a" — permanece MEI ate 31/12 '
      'e desenquadra em 1o de janeiro do ano SEGUINTE. A diferenca sobre o excesso e recolhida sem '
      'acrescimos, em parcela unica, junto da apuracao de janeiro (§ 10).'
    ELSE
      'Dentro do teto no ritmo medido.'
  END                                                                     AS efeito_legal,
  -- A ressalva que precede o número, não a que vem depois dele.
  format(
    'PISO, nao valor: esta janela conta apenas o que a XPE pagou (R$ %s em %s). O teto do art. 18-A '
    'incide sobre a receita bruta TOTAL do MEI, de todos os clientes dele. Se houver outro '
    'contratante, o percentual real e maior que %s%%.',
    to_char(z.recebido_cents / 100.0, 'FM999G999G990D00'),
    z.ano::text,
    to_char(100.0 * z.recebido_cents / z.limite_cents, 'FM990D0')
  )                                                                       AS por_que_e_piso,
  -- Nasce NULL de propósito. Ver bloco (b) do cabeçalho e dúvida 62.
  NULL::numeric                                                           AS alerta_antecipado_pct,
  'Ninguem declarou a partir de que percentual do teto o sistema deve avisar. A lei so declara 100% '
  'e 120%; qualquer outro corte seria governanca inventada. Duvida 62.'::text AS alerta_antecipado_motivo,
  -- O limite proporcional do § 2º não pôde ser aplicado, e o motivo é dado.
  CASE WHEN z.primeiro_mes > make_date(z.ano, 1, 1) THEN
    'Recebeu da XPE pela primeira vez em ' || to_char(z.primeiro_mes, 'MM/YYYY') || '. Se o CNPJ '
    'tambem abriu neste ano, o limite e proporcional (R$ 6.750,00 por mes, art. 18-A § 2o) e o '
    'teto aplicavel e MENOR que R$ 81.000,00. Esta base nao tem a data de abertura de nenhum CNPJ '
    'de MEI, entao o limite cheio foi usado — o que erra para o lado seguro do MEI, nao da XPE.'
  END                                                                     AS ressalva_limite_proporcional,
  z.limite_base_legal                                                     AS base_legal,
  z.limite_fonte_url                                                      AS fonte_url,
  z.limite_consultado_em                                                  AS fonte_consultada_em,
  'Leitura gerencial. Nao substitui apuracao nem parecer: depende de validacao do contador.'::text
                                                                          AS ressalva_obrigatoria
  FROM cruz z;

COMMENT ON VIEW fin_mei_teto_v IS
  'A janela do teto de cada MEI: recebido no ano, ritmo sobre meses completos, projecao de '
  'fechamento, percentual do teto e o mes em que cruza se o ritmo se mantiver. O teto vem de '
  'fin_tax_regime_param com fonte legal e data de consulta, nunca hardcoded. As faixas sao as duas '
  'que a LC 123 art. 18-A § 7o III declara (100% e 120%) e nenhuma a mais. A medida e PISO: conta '
  'so o que a XPE pagou.';

-- ==========================================================================
-- 5. O VEREDITO SOBRE O ANEXO — TRÊS LEITURAS LADO A LADO
-- ==========================================================================
--
-- A 0092 deixou um impasse aparente. Esta view mostra por que ele não existe:
-- as duas leituras discordantes estavam medindo janelas diferentes.

CREATE OR REPLACE VIEW fin_fator_r_veredito_v AS
WITH base AS (
  SELECT competencia, meses_com_folha, numerador_cents, denominador_cents,
         fator_r, fator_r_extrapolado_12m, limiar_legal
    FROM fin_fator_r_v
   WHERE cenario_folha = 'legal_estrito' AND base_receita = 'nota_asaas'
),
das AS (
  SELECT competencia, das_empresa_cents, nota_asaas_cents,
         aliquota_efetiva_iii, aliquota_efetiva_v,
         CASE WHEN nota_asaas_cents > 0
              THEN round(das_empresa_cents::numeric / nota_asaas_cents, 6) END AS carga_observada
    FROM fin_das_reconciliacao_v
)
SELECT
  b.competencia,
  b.meses_com_folha,
  12 - b.meses_com_folha                                        AS meses_de_folha_ausentes,
  b.numerador_cents                                             AS folha_legal_estrita_cents,
  b.denominador_cents                                           AS receita_12m_cents,
  b.limiar_legal,
  b.fator_r                                                     AS fator_r_medido,
  b.fator_r_extrapolado_12m                                     AS fator_r_recomposto_12m,
  CASE WHEN b.fator_r          >= b.limiar_legal THEN 'III' ELSE 'V' END AS anexo_pelo_medido,
  CASE WHEN b.fator_r_extrapolado_12m IS NULL THEN NULL
       WHEN b.fator_r_extrapolado_12m >= b.limiar_legal THEN 'III' ELSE 'V' END AS anexo_pelo_recomposto,
  d.carga_observada,
  d.aliquota_efetiva_iii,
  d.aliquota_efetiva_v,
  -- O terceiro lado: qual anexo a guia efetivamente paga reproduz.
  CASE
    WHEN d.carga_observada IS NULL THEN NULL
    WHEN abs(d.carga_observada - d.aliquota_efetiva_iii)
         <= abs(d.carga_observada - d.aliquota_efetiva_v) THEN 'III'
    ELSE 'V'
  END                                                           AS anexo_pelo_das_pago,
  (CASE WHEN b.fator_r_extrapolado_12m IS NULL THEN NULL
        WHEN b.fator_r_extrapolado_12m >= b.limiar_legal THEN 'III' ELSE 'V' END)
   IS NOT DISTINCT FROM
  (CASE WHEN d.carga_observada IS NULL THEN NULL
        WHEN abs(d.carga_observada - d.aliquota_efetiva_iii)
             <= abs(d.carga_observada - d.aliquota_efetiva_v) THEN 'III'
        ELSE 'V' END)                                           AS recomposto_concorda_com_o_pago,
  format(
    'Folha da janela: %s meses de 12 (extratos comecam em 01/01/2026, duvida 4). Fator R medido '
    '%s%% compara %s meses de folha com 12 de receita e por isso e PISO. Recomposto para 12 meses: '
    '%s%%. Limiar legal %s%%. O DAS pago na competencia reproduz carga de %s%%, contra %s%% do '
    'Anexo III e %s%% do Anexo V.',
    b.meses_com_folha::text,
    to_char(b.fator_r * 100, 'FM990D00'),
    b.meses_com_folha::text,
    COALESCE(to_char(b.fator_r_extrapolado_12m * 100, 'FM990D00'), 'n/d'),
    to_char(b.limiar_legal * 100, 'FM990D0'),
    COALESCE(to_char(d.carga_observada * 100, 'FM990D00'), 'n/d'),
    COALESCE(to_char(d.aliquota_efetiva_iii * 100, 'FM990D00'), 'n/d'),
    COALESCE(to_char(d.aliquota_efetiva_v * 100, 'FM990D00'), 'n/d')
  )                                                             AS memoria,
  'O numerador EXCLUI o MEI: LC 123/2006 art. 18 § 24 c/c § 25 conta remuneracoes a pessoa fisica '
  'informadas na forma do art. 32, IV, da Lei 8.212/1991. MEI e pessoa juridica e emite nota.'::text
                                                                AS regra_do_numerador,
  'LC 123/2006 art. 18 §§ 5º-J, 5º-M, 24 e 25'::text            AS base_legal,
  'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'::text AS fonte_url,
  'Leitura gerencial. Nao substitui apuracao nem parecer: depende de validacao do contador.'::text
                                                                AS ressalva_obrigatoria
  FROM base b
  LEFT JOIN das d ON d.competencia = b.competencia;

COMMENT ON VIEW fin_fator_r_veredito_v IS
  'As tres leituras do anexo lado a lado: o Fator R medido (piso, janela de folha truncada), o '
  'recomposto para 12 meses, e o anexo que o DAS efetivamente pago reproduz. Onde as tres '
  'concordam, ha veredito; onde nao, a view mostra a divergencia em vez de escolher.';

-- ==========================================================================
-- 6. A ALÍQUOTA MÊS A MÊS, COM MEMÓRIA DE CÁLCULO
-- ==========================================================================
--
-- A pergunta do dono foi "qual alíquota mês a mês". Isso não é a alíquota
-- nominal da faixa: é a EFETIVA, que a lei manda calcular por
-- (RBT12 x nominal - parcela a deduzir) / RBT12 (art. 18 § 1º-A). Ela muda
-- todo mês porque o RBT12 muda todo mês.

CREATE OR REPLACE VIEW fin_simples_aliquota_mes_v AS
WITH nota AS (
  SELECT date_trunc('month', issue_date)::date AS mes, sum(service_amount_cents)::bigint AS cents
    FROM fin_fiscal_document WHERE status = 'AUTHORIZED' GROUP BY 1
),
comp AS (
  SELECT n.mes AS competencia,
         n.cents AS receita_cents,
         (SELECT COALESCE(sum(cents), 0) FROM nota x
           WHERE x.mes >= (n.mes - interval '12 months')::date AND x.mes < n.mes)::bigint AS rbt12_cents
    FROM nota n
),
pago AS (
  SELECT (date_trunc('month', posted_on) - interval '1 month')::date AS competencia,
         sum(valor_cents) FILTER (WHERE especie = 'empresa')::bigint AS das_empresa_pago_cents
    FROM fin_das_mei_pagamento_v
   GROUP BY 1
)
SELECT
  c.competencia,
  c.receita_cents,
  c.rbt12_cents,
  a.anexo,
  a.faixa,
  a.aliquota_nominal,
  a.parcela_deduzir_cents,
  CASE WHEN c.rbt12_cents > 0
       THEN round((c.rbt12_cents * a.aliquota_nominal - a.parcela_deduzir_cents)
                  / c.rbt12_cents, 6) END                              AS aliquota_efetiva,
  CASE WHEN c.rbt12_cents > 0
       THEN round(c.receita_cents
                  * ((c.rbt12_cents * a.aliquota_nominal - a.parcela_deduzir_cents)
                     / c.rbt12_cents))::bigint END                     AS das_calculado_cents,
  p.das_empresa_pago_cents,
  CASE WHEN c.rbt12_cents > 0 AND p.das_empresa_pago_cents IS NOT NULL
       THEN p.das_empresa_pago_cents
            - round(c.receita_cents
                    * ((c.rbt12_cents * a.aliquota_nominal - a.parcela_deduzir_cents)
                       / c.rbt12_cents))::bigint END                   AS diferenca_cents,
  format(
    'RBT12 R$ %s x %s%% = R$ %s, menos parcela a deduzir R$ %s, dividido pelo RBT12 = aliquota '
    'efetiva %s%%. Sobre a receita da competencia (R$ %s) da R$ %s de DAS no Anexo %s.',
    to_char(c.rbt12_cents / 100.0, 'FM999G999G990D00'),
    to_char(a.aliquota_nominal * 100, 'FM990D00'),
    to_char(c.rbt12_cents * a.aliquota_nominal / 100.0, 'FM999G999G990D00'),
    to_char(a.parcela_deduzir_cents / 100.0, 'FM999G999G990D00'),
    COALESCE(to_char(100.0 * (c.rbt12_cents * a.aliquota_nominal - a.parcela_deduzir_cents)
                     / NULLIF(c.rbt12_cents, 0), 'FM990D0000'), 'n/d'),
    to_char(c.receita_cents / 100.0, 'FM999G999G990D00'),
    COALESCE(to_char(round(c.receita_cents
              * ((c.rbt12_cents * a.aliquota_nominal - a.parcela_deduzir_cents)
                 / NULLIF(c.rbt12_cents, 0))) / 100.0, 'FM999G999G990D00'), 'n/d'),
    a.anexo
  )                                                                    AS memoria,
  'A receita e a das NFS-e autorizadas por data de emissao. Nota emitida fora do Asaas nao esta '
  'aqui (duvida 50), entao o DAS calculado e PISO. O pago vem do extrato e inclui o mes inteiro.'::text
                                                                       AS ressalva_da_base,
  'LC 123/2006 art. 18 § 1º-A e Anexos III e V'::text                   AS base_legal,
  'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'::text     AS fonte_url,
  'Leitura gerencial. Nao substitui apuracao nem parecer: depende de validacao do contador.'::text
                                                                       AS ressalva_obrigatoria
  FROM comp c
  JOIN fin_tax_regime_param a
    ON a.regime = 'simples' AND a.tributo = 'DAS' AND a.anexo IN ('III', 'V')
   AND c.rbt12_cents BETWEEN a.faixa_de_cents AND a.faixa_ate_cents
  LEFT JOIN pago p ON p.competencia = c.competencia
 WHERE c.rbt12_cents > 0;

COMMENT ON VIEW fin_simples_aliquota_mes_v IS
  'A aliquota EFETIVA do Simples mes a mes, nos Anexos III e V, com a memoria de calculo do art. 18 '
  '§ 1o-A escrita por extenso, o DAS que ela produz e o que foi efetivamente pago. Nao e apuracao: '
  'a receita e a das NFS-e do Asaas e por isso e piso.';

-- ==========================================================================
-- 7. O LUGAR DOS DAS DE REFERÊNCIA — NASCE VAZIO
-- ==========================================================================
--
-- "posso depois anexar alguns dás de referência". A estrutura fica pronta, com
-- o que cada campo precisa, e SEM nenhuma linha semeada: um DAS de exemplo
-- inventado seria pior que a ausência, porque a conferência passaria a comparar
-- o apurado contra uma ficção.
--
-- A chave é (competência, documento): a mesma competência pode ter DAS
-- original e DAS complementar/retificador, e os dois precisam caber.

CREATE TABLE IF NOT EXISTS fin_das_referencia (
  id                        bigserial PRIMARY KEY,
  entity_id                 text        NOT NULL DEFAULT 'xpe',
  competencia               date        NOT NULL,
  documento                 text        NOT NULL,
  especie                   text        NOT NULL,
  -- O que o PGDAS declara. Sem isto a conferência não existe.
  receita_bruta_declarada_cents  bigint,
  rbt12_declarado_cents          bigint,
  anexo_declarado                text,
  aliquota_efetiva_declarada     numeric(9,6),
  -- O que a guia cobra, decomposto como o próprio DAS traz.
  principal_cents           bigint      NOT NULL,
  multa_cents               bigint      NOT NULL DEFAULT 0,
  juros_cents               bigint      NOT NULL DEFAULT 0,
  total_cents               bigint      NOT NULL,
  vencimento                date,
  pago_em                   date,
  -- Proveniência: de onde veio o número, e como conferir que é o mesmo papel.
  fonte                     text        NOT NULL,
  arquivo_nome              text,
  arquivo_sha256            text,
  transaction_id            bigint      REFERENCES fin_transaction(id),
  observacao                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_das_referencia_key UNIQUE (entity_id, competencia, documento),
  CONSTRAINT fin_das_referencia_competencia_ck
    CHECK (competencia = date_trunc('month', competencia)::date),
  CONSTRAINT fin_das_referencia_especie_ck
    CHECK (especie IN ('das_empresa', 'das_mei', 'das_complementar', 'das_retificador')),
  CONSTRAINT fin_das_referencia_fonte_ck
    CHECK (fonte IN ('pgdas_declaracao', 'das_pdf', 'extrato_simples_nacional', 'contador')),
  -- O total tem de fechar com as parcelas. É a única aritmética que o DAS
  -- carrega impressa, e digitar errado aqui contaminaria toda a conferência.
  CONSTRAINT fin_das_referencia_soma_ck
    CHECK (total_cents = principal_cents + multa_cents + juros_cents),
  CONSTRAINT fin_das_referencia_sinal_ck
    CHECK (principal_cents > 0 AND multa_cents >= 0 AND juros_cents >= 0),
  -- Anexo só nos valores que a lei tem.
  CONSTRAINT fin_das_referencia_anexo_ck
    CHECK (anexo_declarado IS NULL OR anexo_declarado IN ('I','II','III','IV','V')),
  -- Declaração de PGDAS sem receita declarada não é declaração.
  CONSTRAINT fin_das_referencia_pgdas_ck
    CHECK (fonte <> 'pgdas_declaracao' OR receita_bruta_declarada_cents IS NOT NULL),
  -- Arquivo anexado sem hash não é conferível: dois PDF com o mesmo nome e
  -- números diferentes já é o caso normal quando há retificação.
  CONSTRAINT fin_das_referencia_arquivo_ck
    CHECK (arquivo_nome IS NULL OR arquivo_sha256 IS NOT NULL)
);

COMMENT ON TABLE fin_das_referencia IS
  'Onde os DAS de referencia entram para conferir o declarado contra o apurado. NASCE VAZIA de '
  'proposito: um DAS de exemplo faria a conferencia comparar contra ficcao. Cada linha e um papel '
  'com hash, nao um numero digitado de memoria.';
COMMENT ON COLUMN fin_das_referencia.documento IS
  'O numero do DAS ou do recibo do PGDAS. Junto da competencia forma a chave, porque original e '
  'retificador dividem a mesma competencia.';
COMMENT ON COLUMN fin_das_referencia.receita_bruta_declarada_cents IS
  'O campo que fecha as duvidas 49 e 50 num minuto: e a receita que a empresa declarou, contra a '
  'qual as NFS-e desta base sao apenas um piso.';
COMMENT ON COLUMN fin_das_referencia.arquivo_sha256 IS
  'Obrigatorio quando ha arquivo. Padrao xpe_artifacts, o mesmo de fin_anexo_blob.';
COMMENT ON COLUMN fin_das_referencia.transaction_id IS
  'O lancamento de 7.01 que pagou esta guia, quando identificado. Opcional: a guia pode existir '
  'declarada e ainda nao paga.';

CREATE INDEX IF NOT EXISTS fin_das_referencia_competencia_ix
  ON fin_das_referencia (entity_id, competencia);

-- O confronto. Enquanto a tabela estiver vazia ele devolve zero linhas, que é
-- a leitura certa: não existe conferência sem o papel.
CREATE OR REPLACE VIEW fin_das_confronto_v AS
SELECT
  r.competencia,
  r.documento,
  r.especie,
  r.fonte,
  r.receita_bruta_declarada_cents,
  a.receita_cents                                   AS receita_nfse_desta_base_cents,
  r.receita_bruta_declarada_cents - a.receita_cents  AS receita_fora_desta_base_cents,
  r.rbt12_declarado_cents,
  a.rbt12_cents                                     AS rbt12_desta_base_cents,
  r.anexo_declarado,
  a.anexo                                           AS anexo_apurado_aqui,
  r.aliquota_efetiva_declarada,
  a.aliquota_efetiva                                AS aliquota_efetiva_apurada,
  r.principal_cents                                 AS principal_declarado_cents,
  a.das_calculado_cents                             AS principal_apurado_cents,
  r.principal_cents - a.das_calculado_cents         AS diferenca_principal_cents,
  r.multa_cents,
  r.juros_cents,
  r.total_cents,
  (r.anexo_declarado IS NOT DISTINCT FROM a.anexo)  AS anexo_bate,
  format(
    'DAS %s da competencia %s: declarado R$ %s de principal sobre receita de R$ %s no Anexo %s. '
    'Esta base apura R$ %s sobre R$ %s de NFS-e. Diferenca de receita: R$ %s.',
    r.documento, to_char(r.competencia, 'MM/YYYY'),
    to_char(r.principal_cents / 100.0, 'FM999G999G990D00'),
    COALESCE(to_char(r.receita_bruta_declarada_cents / 100.0, 'FM999G999G990D00'), 'n/d'),
    COALESCE(r.anexo_declarado, 'n/d'),
    COALESCE(to_char(a.das_calculado_cents / 100.0, 'FM999G999G990D00'), 'n/d'),
    COALESCE(to_char(a.receita_cents / 100.0, 'FM999G999G990D00'), 'n/d'),
    COALESCE(to_char((r.receita_bruta_declarada_cents - a.receita_cents) / 100.0, 'FM999G999G990D00'), 'n/d')
  )                                                 AS memoria
  FROM fin_das_referencia r
  LEFT JOIN fin_simples_aliquota_mes_v a
    ON a.competencia = r.competencia
   AND a.anexo = COALESCE(r.anexo_declarado, 'III');

COMMENT ON VIEW fin_das_confronto_v IS
  'Confere o DAS declarado contra o apurado por esta base, competencia a competencia. Zero linhas '
  'enquanto fin_das_referencia estiver vazia — ausencia de conferencia, nao conferencia sem '
  'divergencia.';

-- ==========================================================================
-- 8. A CORREÇÃO DA 0092 — MESMA LISTA DE COLUNAS, UMA MEDIDA SÓ
-- ==========================================================================
--
-- Só muda a separação MEI/empresa, que passa a usar fin_das_mei_pagamento_v.
-- Todo o resto é idêntico ao da 0092, de propósito: duas medidas do mesmo
-- dinheiro escritas em lugares diferentes discordam exatamente no dia em que a
-- diferença importa.

CREATE OR REPLACE VIEW fin_das_reconciliacao_v AS
WITH pago AS (
  SELECT (date_trunc('month', posted_on) - interval '1 month')::date AS competencia,
         date_trunc('month', posted_on)::date                        AS pago_em,
         sum(valor_cents) FILTER (WHERE especie = 'empresa')::bigint  AS das_empresa_cents,
         COALESCE(sum(valor_cents) FILTER (WHERE especie <> 'empresa'), 0)::bigint
                                                                      AS das_mei_terceiro_cents,
         count(*) FILTER (WHERE especie <> 'empresa')::integer        AS qtd_das_mei
    FROM fin_das_mei_pagamento_v
   GROUP BY 1, 2
),
nota AS (
  SELECT date_trunc('month', issue_date)::date AS mes, sum(service_amount_cents)::bigint AS cents
    FROM fin_fiscal_document WHERE status = 'AUTHORIZED' GROUP BY 1
),
ledger AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(t.amount_cents)::bigint AS cents
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents > 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
     AND c.cash_flow_group IN ('receita-servicos', 'receita-recorrente')
   GROUP BY 1
),
base AS (
  SELECT g.*,
         (SELECT sum(cents) FROM nota n
           WHERE n.mes >= (g.competencia - interval '12 months')::date AND n.mes < g.competencia) AS rbt12_nota_cents
    FROM pago g
   WHERE g.das_empresa_cents IS NOT NULL
)
SELECT
  b.competencia,
  b.pago_em,
  b.das_empresa_cents,
  b.das_mei_terceiro_cents,
  b.qtd_das_mei,
  (SELECT cents FROM nota WHERE mes = b.competencia)   AS nota_asaas_cents,
  (SELECT cents FROM ledger WHERE mes = b.competencia) AS ledger_caixa_cents,
  b.rbt12_nota_cents,
  p3.faixa                                              AS faixa_anexo_iii,
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round((b.rbt12_nota_cents * p3.aliquota_nominal - p3.parcela_deduzir_cents)
          / b.rbt12_nota_cents, 6) END                  AS aliquota_efetiva_iii,
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round((b.rbt12_nota_cents * p5.aliquota_nominal - p5.parcela_deduzir_cents)
          / b.rbt12_nota_cents, 6) END                  AS aliquota_efetiva_v,
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round(b.das_empresa_cents
          / ((b.rbt12_nota_cents * p3.aliquota_nominal - p3.parcela_deduzir_cents)
             / b.rbt12_nota_cents))::bigint END         AS base_implicita_iii_cents,
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round(b.das_empresa_cents
          / ((b.rbt12_nota_cents * p5.aliquota_nominal - p5.parcela_deduzir_cents)
             / b.rbt12_nota_cents))::bigint END         AS base_implicita_v_cents,
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round(b.das_empresa_cents
          / ((b.rbt12_nota_cents * p3.aliquota_nominal - p3.parcela_deduzir_cents)
             / b.rbt12_nota_cents))::bigint
    - (SELECT cents FROM nota WHERE mes = b.competencia) END AS residual_iii_cents,
  CASE WHEN b.rbt12_nota_cents > 0 AND (SELECT cents FROM nota WHERE mes = b.competencia) > 0 THEN
    round(abs(
      round(b.das_empresa_cents
            / ((b.rbt12_nota_cents * p3.aliquota_nominal - p3.parcela_deduzir_cents)
               / b.rbt12_nota_cents))
      - (SELECT cents FROM nota WHERE mes = b.competencia)
    )::numeric / (SELECT cents FROM nota WHERE mes = b.competencia), 4) END AS erro_relativo_iii,
  format(
    'DAS pago R$ %s / aliquota efetiva do Anexo III = base implicita R$ %s; NFS-e do Asaas na '
    'competencia R$ %s. Residual positivo = nota emitida fora do Asaas; negativo = nota sem DAS '
    'correspondente. O DAS-MEI de terceiro, inclusive o pago com acrescimo, esta fora deste '
    'numerador (fin_das_mei_pagamento_v separa).',
    to_char(b.das_empresa_cents / 100.0, 'FM999G999G990D00'),
    to_char(round(b.das_empresa_cents
            / NULLIF((b.rbt12_nota_cents * p3.aliquota_nominal - p3.parcela_deduzir_cents)
                     / NULLIF(b.rbt12_nota_cents, 0), 0)) / 100.0, 'FM999G999G990D00'),
    to_char(COALESCE((SELECT cents FROM nota WHERE mes = b.competencia), 0) / 100.0, 'FM999G999G990D00')
  )                                                     AS memoria,
  'LC 123/2006 art. 18 §1o-A e Anexos III e V'::text     AS base_legal,
  'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'::text AS fonte_url
  FROM base b
  LEFT JOIN fin_tax_regime_param p3
    ON p3.regime = 'simples' AND p3.tributo = 'DAS' AND p3.anexo = 'III'
   AND b.rbt12_nota_cents BETWEEN p3.faixa_de_cents AND p3.faixa_ate_cents
  LEFT JOIN fin_tax_regime_param p5
    ON p5.regime = 'simples' AND p5.tributo = 'DAS' AND p5.anexo = 'V'
   AND b.rbt12_nota_cents BETWEEN p5.faixa_de_cents AND p5.faixa_ate_cents;

COMMENT ON VIEW fin_das_reconciliacao_v IS
  'Reconstroi, competencia a competencia, qual base a empresa teria declarado dado o DAS que '
  'efetivamente pagou. A separacao MEI/empresa vem de fin_das_mei_pagamento_v desde a 0107, que '
  'reconhece o DAS-MEI pago com multa e juros — antes ele era contado como DAS da empresa e '
  'inflava a base implicita. Gerencial, sujeita a validacao do contador.';

-- ==========================================================================
-- 9. AS EVIDÊNCIAS MEDIDAS NA APLICAÇÃO — NÃO DIGITADAS
-- ==========================================================================

INSERT INTO fin_regime_evidencia
  (chave, descricao, valor_cents, valor_numerico, unidade, janela_de, janela_ate,
   origem, o_que_nao_prova, confianca, medido_em)
VALUES
  ('mei_recebido_da_xpe_2026',
   'Total pago pela XPE a pessoas com employment_type=mei no ano-calendario 2026',
   (SELECT COALESCE(sum(recebido_cents), 0) FROM fin_mei_teto_v WHERE ano = 2026),
   NULL, 'cents', DATE '2026-01-01',
   (SELECT max(posted_on) FROM fin_transaction),
   'fin_mei_teto_v somando os 12 MEIs do cadastro',
   'NAO prova a receita bruta de nenhum MEI: e so o que a XPE pagou. Se o MEI tem outro cliente, '
   'a receita dele e maior e o percentual do teto tambem.',
   'medida', CURRENT_DATE),

  ('mei_maior_percentual_do_teto_2026',
   'Maior percentual do teto do MEI alcancado por um unico prestador em 2026, contando so a XPE',
   NULL,
   (SELECT max(pct_do_limite) FROM fin_mei_teto_v WHERE ano = 2026),
   'fracao', DATE '2026-01-01',
   (SELECT max(posted_on) FROM fin_transaction),
   'fin_mei_teto_v, teto de fin_tax_regime_param (LC 123/2006 art. 18-A § 1o)',
   'NAO prova desenquadramento. Prova que um contratante sozinho consome essa fracao do teto anual '
   'de um prestador, e que o espaco restante dele para qualquer outro cliente e o complemento.',
   'medida', CURRENT_DATE),

  ('multa_de_mora_medida_no_acervo',
   'Total de multa e juros de mora identificaveis no acervo inteiro, por excedente sobre valor legal',
   (SELECT COALESCE(sum(acrescimo_cents), 0) FROM fin_das_mei_pagamento_v
     WHERE especie = 'mei_com_acrescimo'),
   NULL, 'cents',
   (SELECT min(posted_on) FROM fin_transaction),
   (SELECT max(posted_on) FROM fin_transaction),
   'fin_das_mei_pagamento_v — excedente sobre o DAS-MEI derivado da lei',
   'NAO e o total de multas da empresa. So o DAS-MEI tem valor esperado derivavel; multa embutida '
   'no DAS da empresa, cujo valor depende da receita declarada, e invisivel aqui. A categoria 9.11 '
   '"Juros e multas pagos" tem zero lancamentos e nenhuma descricao do acervo contem a palavra '
   'multa, juros, mora ou atraso.',
   'parcial', CURRENT_DATE),

  ('receita_de_contraparte_sem_nfse_2026',
   'Receita de 2026 vinda de contrapartes que nao tem nenhuma NFS-e nesta base',
   (SELECT COALESCE(sum(t.amount_cents), 0)
      FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
     WHERE t.amount_cents > 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
       AND c.cash_flow_group IN ('receita-servicos', 'receita-recorrente')
       AND t.posted_on >= DATE '2026-01-01'
       AND NOT EXISTS (SELECT 1 FROM fin_fiscal_document f
                        WHERE f.counterparty_id = t.counterparty_id AND f.status = 'AUTHORIZED')),
   NULL, 'cents', DATE '2026-01-01',
   (SELECT max(posted_on) FROM fin_transaction),
   'ledger x fin_fiscal_document por contraparte',
   'NAO prova receita sem nota. Prova nota ausente DESTE acervo — e a reconciliacao reversa pelo '
   'DAS pago mostra o contrario: a base declarada supera as NFS-e do Asaas, o que so acontece se a '
   'nota existir fora dele (duvida 50).',
   'medida', CURRENT_DATE)
ON CONFLICT (chave) DO UPDATE
  SET valor_cents = EXCLUDED.valor_cents,
      valor_numerico = EXCLUDED.valor_numerico,
      janela_ate = EXCLUDED.janela_ate,
      medido_em = EXCLUDED.medido_em;

-- ==========================================================================
-- 10. AS ASSERÇÕES — A MIGRATION SE RECUSA A COMMITAR SE MENTIREM
-- ==========================================================================

DO $$
DECLARE
  v_n     integer;
  v_txt   text;
  v_c1    bigint;
  v_c2    bigint;
  v_princ bigint;
BEGIN
  -- 10.1 ÂNCORA DE DINHEIRO. Esta migration não move um centavo. Se a soma
  --      por conta mudar, o trabalho está errado — não a asserção.
  SELECT count(*) INTO v_n FROM fin_transaction WHERE updated_at > now() - interval '1 minute';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'a 0107 nao pode tocar fin_transaction, e % linha(s) foram atualizadas', v_n;
  END IF;

  -- 10.2 O teto NÃO pode estar hardcoded em lugar nenhum: tem de vir do
  --      parâmetro, com fonte primária e data de consulta.
  SELECT count(*) INTO v_n FROM fin_tax_regime_param
   WHERE regime = 'mei' AND tributo = 'LIMITE_RECEITA_BRUTA'
     AND valor_absoluto_cents IS NOT NULL
     AND fonte_url LIKE 'https://www.planalto.gov.br/%'
     AND base_legal LIKE '%18-A%'
     AND consultado_em IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'o limite do MEI precisa de exatamente 1 parametro com fonte primaria; achei %', v_n;
  END IF;

  -- 10.3 Nenhum parâmetro novo pode entrar sem fonte primária.
  SELECT string_agg(DISTINCT fonte_url, ', ') INTO v_txt FROM fin_tax_regime_param
   WHERE consultado_em = DATE '2026-08-17'
     AND fonte_url !~ '^https://(www\.)?(planalto\.gov\.br|gov\.br/receitafederal|normas\.receita\.fazenda\.gov\.br|in\.gov\.br)/';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'parametro da 0107 com fonte nao primaria: %', v_txt;
  END IF;

  -- 10.4 O VÃO VAZIO. O corte que separa DAS-MEI de DAS da empresa só é
  --      legítimo porque não existe pagamento entre 1,3x e 10x o principal.
  --      Se um aparecer, a classificação virou arbitragem e alguém precisa
  --      olhar antes de confiar em qualquer número desta migration.
  SELECT das_mei_servicos_cents INTO v_princ FROM fin_das_mei_valor_v
   WHERE vigente_de <= CURRENT_DATE AND (vigente_ate IS NULL OR vigente_ate >= CURRENT_DATE)
   ORDER BY vigente_de DESC LIMIT 1;

  SELECT count(*) INTO v_n
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
     AND c.code = '7.01'
     AND abs(t.amount_cents) > v_princ * 1.30
     AND abs(t.amount_cents) < v_princ * 10;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'o vao entre 1,3x e 10x o DAS-MEI (R$ %) deixou de estar vazio: % pagamento(s) caem nele. '
      'A separacao MEI/empresa de fin_das_mei_pagamento_v virou arbitragem — revise antes de usar.',
      to_char(v_princ / 100.0, 'FM999G990D00'), v_n;
  END IF;

  -- 10.5 A decomposição tem de fechar: principal + multa + juros = pago.
  SELECT count(*) INTO v_n FROM fin_das_mei_pagamento_v
   WHERE especie <> 'empresa'
     AND principal_cents + COALESCE(multa_cents, 0) + COALESCE(juros_cents, 0) <> valor_cents;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'decomposicao de multa/juros nao fecha em % pagamento(s)', v_n;
  END IF;

  -- 10.6 A multa nunca pode passar do teto legal de 20%.
  SELECT count(*) INTO v_n FROM fin_das_mei_pagamento_v
   WHERE multa_cents > round(principal_cents * 0.20);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'multa acima do teto de 20%% da Lei 9.430/1996 art. 61 § 2o em % linha(s)', v_n;
  END IF;

  -- 10.7 Os R$ 86,05 NÃO existem digitados: têm de sair da aritmética da lei.
  --      Se o salário mínimo mudar e esta conta parar de dar 8605, é a
  --      asserção que está velha, não a view — e é para isso que ela fala.
  SELECT das_mei_servicos_cents INTO v_c1 FROM fin_das_mei_valor_v
   WHERE vigente_de = DATE '2026-01-01';
  IF v_c1 <> 8605 THEN
    RAISE EXCEPTION
      'o DAS-MEI derivado do salario minimo de 2026 deu R$ %, e os 34 pagamentos do acervo sao de '
      'R$ 86,05. Ou o parametro do minimo mudou, ou a aliquota mudou.',
      to_char(v_c1 / 100.0, 'FM999G990D00');
  END IF;

  -- 10.8 A janela existe para os 12 MEIs do cadastro que receberam em 2026.
  SELECT count(*) INTO v_n FROM fin_mei_teto_v WHERE ano = 2026;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'fin_mei_teto_v nao devolveu nenhum MEI em 2026 — o vinculo pessoa/contraparte quebrou';
  END IF;

  -- 10.9 Toda linha da janela carrega base legal, fonte e a ressalva do contador.
  SELECT count(*) INTO v_n FROM fin_mei_teto_v
   WHERE base_legal IS NULL OR fonte_url IS NULL OR fonte_consultada_em IS NULL
      OR ressalva_obrigatoria IS NULL OR por_que_e_piso IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_mei_teto_v: % linha(s) sem base legal, fonte ou ressalva', v_n;
  END IF;

  -- 10.10 A faixa de alerta antecipado continua NULA E COM MOTIVO. Se alguém
  --       semear 80% aqui, isso é governança inventada e a migration recusa.
  SELECT count(*) INTO v_n FROM fin_mei_teto_v
   WHERE alerta_antecipado_pct IS NOT NULL OR alerta_antecipado_motivo IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'faixa de alerta antecipado foi inventada em % linha(s) — ela e a duvida 62', v_n;
  END IF;

  -- 10.11 Situação e efeito legal andam juntos: nenhuma linha pode dizer que
  --       excedeu sem dizer o que a lei manda fazer.
  SELECT count(*) INTO v_n FROM fin_mei_teto_v
   WHERE situacao <> 'dentro' AND efeito_legal = 'Dentro do teto no ritmo medido.';
  IF v_n > 0 THEN
    RAISE EXCEPTION '% linha(s) fora do teto sem efeito legal declarado', v_n;
  END IF;

  -- 10.12 A tabela dos DAS de referência NASCE VAZIA.
  SELECT count(*) INTO v_n FROM fin_das_referencia;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_das_referencia foi semeada com % linha(s); ela tem de nascer vazia', v_n;
  END IF;

  -- 10.13 E o confronto devolve zero, que é a leitura certa de tabela vazia.
  SELECT count(*) INTO v_n FROM fin_das_confronto_v;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_das_confronto_v devolveu % linha(s) sem nenhum DAS de referencia', v_n;
  END IF;

  -- 10.14 A CORREÇÃO DA 0092 TEM DE SER CONSERVATIVA NO DINHEIRO: o total de
  --       7.01 continua o mesmo, só muda de qual balde ele sai.
  SELECT COALESCE(sum(das_empresa_cents) + sum(das_mei_terceiro_cents), 0)
    INTO v_c1 FROM fin_das_reconciliacao_v;
  SELECT COALESCE(sum(abs(t.amount_cents)), 0) INTO v_c2
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
     AND c.code = '7.01'
     AND (date_trunc('month', t.posted_on) - interval '1 month')::date IN
         (SELECT competencia FROM fin_das_reconciliacao_v);
  IF v_c1 <> v_c2 THEN
    RAISE EXCEPTION
      'a reconciliacao do DAS deixou de somar o total de 7.01: view R$ %, ledger R$ %',
      to_char(v_c1 / 100.0, 'FM999G999G990D00'), to_char(v_c2 / 100.0, 'FM999G999G990D00');
  END IF;

  -- 10.15 O veredito precisa das três leituras. Se uma sumir, ele virou opinião.
  SELECT count(*) INTO v_n FROM fin_fator_r_veredito_v
   WHERE competencia = (SELECT max(competencia) FROM fin_fator_r_veredito_v)
     AND fator_r_medido IS NOT NULL
     AND anexo_pelo_medido IS NOT NULL
     AND anexo_pelo_recomposto IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fin_fator_r_veredito_v nao produziu as leituras da ultima competencia (% linha)', v_n;
  END IF;

  -- 10.16 A alíquota efetiva tem de ficar entre a nominal da faixa anterior e
  --       a da faixa — se sair disso, a fórmula do § 1º-A foi escrita errado.
  SELECT count(*) INTO v_n FROM fin_simples_aliquota_mes_v
   WHERE aliquota_efetiva IS NOT NULL
     AND (aliquota_efetiva <= 0 OR aliquota_efetiva > aliquota_nominal);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'aliquota efetiva fora do intervalo legal em % competencia(s)', v_n;
  END IF;

  -- 10.17 Toda view desta migration carrega a ressalva do contador onde há
  --       recomendação. É requisito declarado da frente, não estilo.
  SELECT count(*) INTO v_n FROM fin_simples_aliquota_mes_v WHERE ressalva_obrigatoria IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_simples_aliquota_mes_v: % linha(s) sem a ressalva de validacao contabil', v_n;
  END IF;

  -- 10.18 O parâmetro do art. 18-B tem de continuar INDETERMINADO. Ele é a
  --       linha mais cara da migration (20% sobre R$ 264 mil) e a incidencia
  --       depende de qual servico cada MEI presta, que ninguem declarou.
  IF EXISTS (SELECT 1 FROM fin_tax_regime_param
              WHERE regime = 'comum' AND tributo = 'CPP_CONTRATANTE_DE_MEI'
                AND indeterminado IS NOT TRUE) THEN
    RAISE EXCEPTION
      'CPP_CONTRATANTE_DE_MEI deixou de ser indeterminado sem que o servico de cada MEI fosse '
      'declarado. Isso e a duvida 63 e vale 20%% sobre os pagamentos a MEI.';
  END IF;

  RAISE NOTICE '0107 validada: % MEI(s) na janela, maior %% do teto = %, multa medida no acervo = R$ %',
    (SELECT count(*) FROM fin_mei_teto_v WHERE ano = 2026),
    (SELECT to_char(max(pct_do_limite) * 100, 'FM990D0') || '%' FROM fin_mei_teto_v WHERE ano = 2026),
    (SELECT to_char(COALESCE(sum(acrescimo_cents), 0) / 100.0, 'FM999G990D00')
       FROM fin_das_mei_pagamento_v WHERE especie = 'mei_com_acrescimo');
END $$;
