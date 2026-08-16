-- Comparação auditável entre Simples, Presumido e Real — o que a base prova.
--
-- A 0081 montou o registro de parâmetros legais e recusou-se, corretamente, a
-- eleger um regime: faltavam entradas contábeis e decisões. Esta migration NÃO
-- desfaz aquela recusa. Ela mede o que ficou por medir, e a medição resolve
-- boa parte das lacunas que a 0081 declarou — não por afrouxar o critério, mas
-- porque o dado existia em lugares que a 0081 não olhou.
--
-- ==========================================================================
-- O QUE ESTA MIGRATION DESCOBRIU, EM ORDEM DE DINHEIRO
-- ==========================================================================
--
-- 1. O MEI DECIDE O ANEXO, E O EFEITO É DE R$ 87 A R$ 100 MIL POR ANO.
--    R$ 216.338,43 pagos a MEIs dentro da janela do Fator R estão em
--    `6.01 Salários`. Medido em 16/08/2026, sobre a base de NFS-e: com o MEI
--    no numerador o Fator R é 38,96%; sem ele, 23,42%. Sobre a base do
--    ledger: 32,94% com MEI e 19,81% sem. O limiar legal é 28% (LC 123/2006
--    art. 18 §§5º-J e 5º-M). Nas quatro leituras o MESMO DADO aponta Anexo
--    III com o MEI e Anexo V sem ele.
--    O preço da dúvida é a diferença de alíquota efetiva entre V e III:
--    R$ 87 mil sobre a base de NFS-e (4ª faixa) e R$ 100 mil sobre a base do
--    ledger (5ª faixa), por ano de receita. `fin_regime_indeterminacao_v`
--    recalcula o número vivo para ele não envelhecer neste comentário.
--
--    E a lei não deixa isso em aberto: o § 24 manda contar "remunerações a
--    pessoas físicas decorrentes do trabalho" e o § 25 restringe às
--    remunerações informadas na forma do art. 32, IV, da Lei 8.212/1991
--    (GFIP/eSocial). MEI é pessoa jurídica e emite nota; o pagamento a MEI
--    não é remuneração de pessoa física informada em GFIP. A leitura legal
--    do numerador, portanto, EXCLUI o MEI — e é a leitura que aponta Anexo V.
--    Quem afirma o contrário precisa da prova documental, não do rótulo
--    contábil que o importador deixou por omissão.
--
-- 2. A CARGA DE 9,17% NÃO EXISTE — É UM ARTEFATO DE TRÊS BASES ERRADAS.
--    Reconstruída, a carga real fica entre 12,6% e 13,4%, que é exatamente a
--    alíquota efetiva do Anexo III na faixa da empresa. A ponte está em
--    `fin_das_reconciliacao_v` e no bloco 4 deste comentário.
--
-- 3. A EMPRESA JÁ ESTÁ NO ANEXO III, E O PAGAMENTO PROVA.
--    Dividindo o DAS efetivamente pago pela alíquota efetiva do Anexo III de
--    cada competência, a base implícita reproduz as NFS-e autorizadas dentro
--    de 5% em 4 de 7 competências (abr/26 erra 0,6%; mai/26 erra 1,4%;
--    dez/25 erra 2,4%; mar/26 erra 4,3%). Sob a
--    hipótese do Anexo V a empresa teria declarado ~32% MENOS receita do que
--    faturou, sete meses seguidos. O Anexo V está refutado pelo caixa.
--
-- 4. R$ 2.925,70 DE "IMPOSTO DA EMPRESA" É DAS-MEI DE TERCEIRO.
--    34 pagamentos de R$ 86,05 em 2026, dentro de `7.01 Simples Nacional`.
--    R$ 86,05 = 5% × R$ 1.621,00 (salário mínimo de 2026) + R$ 5,00 de ISS:
--    é o DAS-MEI de prestador de serviços, ao centavo. A empresa paga o
--    tributo dos seus próprios MEIs. Isso não é imposto dela, sai do numerador
--    de qualquer carga — e é evidência a mais sobre a natureza do vínculo,
--    que só o Fernando e o contador podem qualificar.
--
-- 5. O ISS NÃO É INDETERMINADO: ELE ESTÁ DECLARADO EM 2.826 NFS-e.
--    Alíquota de 5,00% em 2021–2025 e 4,9816% em 2026, medida sobre a base e
--    o imposto que a própria empresa destacou. A 0081 tratou o ISS como
--    lacuna porque procurou a lei municipal; a nota fiscal responde antes.
--    Isso muda o Presumido e o Real, onde o ISS é custo à parte — no Simples
--    ele já vem dentro do DAS (Anexos III e V, coluna ISS da partilha).
--
-- 6. A JANELA DO FATOR R TEM 8 MESES COM MOVIMENTO E 7 COM FOLHA DE VERDADE.
--    Os extratos de Inter e Nubank começam em 01/01/2026 (dúvida 4). Antes
--    disso só existe o gateway Asaas, por onde a folha não passa; dez/25
--    aparece com R$ 242,03, que é movimento e não é folha. O
--    denominador tem 12 meses de receita e o numerador tem 7: o
--    Fator R medido é estruturalmente menor que o real. Anualizado, TODOS os
--    cenários — inclusive o "sem MEI" — passam de 28%. Por isso o Fator R
--    medido aqui NÃO decide o anexo sozinho, e a view o rotula `parcial`.
--
-- 7. A RECEITA TEM UM BURACO QUE NINGUÉM CATEGORIZOU, E ELE MOVE A FAIXA.
--    Entradas do Asaas de 2026 com texto "Cobrança recebida — fatura nr. ..."
--    e nenhuma categoria: 65 lançamentos e R$ 113.265,35 na primeira medição
--    desta sessão, 63 e R$ 79.265,35 duas horas depois, porque outra frente
--    classificou dois deles. Elas não entram em nenhuma view de receita, mas
--    somadas à receita categorizada davam exatamente os R$ 1.350.225,21 que
--    circulam como "receita ledger 2026" — o número do briefing nasce aqui.
--    O efeito não é cosmético: com elas o RBT12 do ledger vai de
--    R$ 1.804.279,44 para R$ 1.929.811,83 e atravessa o teto da 4ª faixa
--    (R$ 1.800.000,00), mudando a faixa do Simples. A faixa depende hoje de
--    uma fila de classificação pendente.
--
-- 8. A EMPRESA TEM DUAS FAMÍLIAS DE SERVIÇO E ELAS NÃO VÃO PARA O MESMO ANEXO.
--    As NFS-e de 2026 declaram dois códigos: 17.01 (assessoria/consultoria),
--    R$ 823.075,10 (73,9%), e 14.01 (manutenção elétrica), R$ 290.820,00
--    (26,1%). Consultoria
--    cai no art. 18 § 5º-I, IX → Anexo V com Fator R. Manutenção cai no
--    § 5º-B, IX ("serviços de instalação, de reparos e de manutenção em
--    geral") → Anexo III SEMPRE, sem Fator R. O art. 18 § 4º, IV manda
--    segregar. Nenhuma NFS-e traz o item 7.02 (execução de obra), o que
--    afasta o Anexo IV apesar da categoria interna "Obras e Adequações".
--
-- ==========================================================================
-- O QUE CONTINUA INDETERMINADO, E QUANTO CUSTA
-- ==========================================================================
--
--   · CNAE preponderante — procurado em fin_entity, fin_counterparty,
--     fin_person, no repositório inteiro e nas views: NÃO EXISTE nenhuma
--     coluna de CNAE nesta base. A consulta ao CNPJ na Receita exige captcha
--     e não foi feita; agregadores de cadastro não são fonte primária e foram
--     descartados. Sem CNAE não se fecha o anexo por atividade, nem o RAT,
--     nem o FPAS/Terceiros. Registrado como indeterminado, com os candidatos
--     e o impacto de cada um em `fin_regime_indeterminacao_v`.
--   · RAT (1%, 2% ou 3%) e Terceiros — dependem de CNAE e FPAS.
--   · Créditos de PIS/COFINS não cumulativos — exigem decisão item a item.
--   · LALUR, adições, exclusões e prejuízos fiscais — não há escrituração.
--   · Vínculo das 4 pessoas fora do MEI em `6.01` (R$ 46.179,80 na janela):
--     nenhuma tem `employment_type` de empregado — são 2 `indefinido`, 1
--     `irregular` e R$ 20.985,00 sem pessoa vinculada. Muda CPP, RAT, FGTS e
--     o numerador do Fator R. É a dúvida 23 do DUVIDAS_FINANCEIRO.
--
-- Todo valor deste cabeçalho foi medido em 16/08/2026, e a base muda por
-- hora: durante esta sessão R$ 34.000,00 de mar/26 saíram de "sem categoria"
-- para receita e moveram o RBT12 do ledger de R$ 1.770.279,44 para
-- R$ 1.804.279,44. As views recalculam sozinhas; os números escritos aqui são
-- a leitura daquele instante, não um contrato.
--
-- TODA SAÍDA DESTA MIGRATION É GERENCIAL E SUJEITA A VALIDAÇÃO DE CONTADOR.
-- Nenhuma linha aqui é apuração fiscal, guia, declaração ou recomendação de
-- mudança de regime.
--
-- ==========================================================================
-- FONTES PRIMÁRIAS — consultadas em 16/08/2026
-- ==========================================================================
--
--   LC 123/2006 — art. 18 §4º IV, §5º-B IX, §5º-C I, §5º-F, §5º-I VI e IX,
--   §§5º-J/5º-K/5º-M, §§24/25/26, art. 18-A §3º; Anexos III e V, tabelas de
--   alíquota, valor a deduzir e partilha (redação da LC 155/2016, vigência
--   01/01/2018)
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
--   Lei 8.212/1991 — art. 21 §2º II b (MEI 5%), art. 22 I/II/III (CPP e RAT),
--   art. 32 IV (a declaração a que o §25 da LC 123 remete)
--     https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm
--   Lei 8.036/1990 — art. 15 (FGTS 8%)
--     https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm
--   Lei 9.249/1995 — art. 3º e §1º (IRPJ 15% e adicional 10% sobre o que
--   exceder R$ 20.000,00 × meses do período), art. 15 §1º III a (presunção de
--   32% para serviços em geral), art. 20 (base da CSLL, 32% para os mesmos
--   serviços)
--     https://www.planalto.gov.br/ccivil_03/leis/l9249.htm
--   Lei 9.430/1996 — arts. 1º e 25 (apuração trimestral do presumido)
--     https://www.planalto.gov.br/ccivil_03/leis/l9430.htm
--   Lei 7.689/1988 — art. 3º III (CSLL 9%)
--     https://www.planalto.gov.br/ccivil_03/leis/l7689.htm
--   Lei 9.715/1998 art. 8º I (PIS 0,65%) e Lei 9.718/1998 art. 8º (COFINS 3%)
--     https://www.planalto.gov.br/ccivil_03/leis/l9715.htm
--     https://www.planalto.gov.br/ccivil_03/leis/l9718compilada.htm
--   Lei 10.637/2002 art. 2º (PIS 1,65%) e Lei 10.833/2003 art. 2º
--   (COFINS 7,6%)
--     https://www.planalto.gov.br/ccivil_03/leis/2002/l10637compilado.htm
--     https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm
--   LC 116/2003 — art. 8º II (teto de 5%) e art. 8º-A (piso de 2%)
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm
--   LC 214/2025 — art. 343 (IBS 0,1% em 2026), art. 346 (CBS 0,9% em 2026),
--   art. 348 I (o recolhido é compensado com PIS/Cofins do mesmo período)
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm
--   Decreto 12.797/2025 art. 1º — salário mínimo de 2026: R$ 1.621,00
--     https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm
--   Receita Federal — Orientações 2026 da Reforma Tributária, página
--   atualizada em 06/05/2026: destaque obrigatório de CBS/IBS no documento
--   fiscal e DISPENSA DE RECOLHIMENTO a quem cumprir as normas do período
--     https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026
--
-- Nota sobre as URLs: a 0081 gravou variantes em caixa alta que respondem 301
-- para estas. As formas acima são as efetivas depois do redirecionamento.

-- ==========================================================================
-- 1. PARÂMETROS LEGAIS QUE FALTAVAM
-- ==========================================================================
--
-- 1.1 A partilha do DAS. Sem ela a comparação é desonesta: no Simples o ISS e
-- a CPP JÁ ESTÃO dentro do DAS, e no Presumido/Real são custos à parte. Somar
-- ISS e CPP por fora em todos os regimes cobraria duas vezes do Simples.
--
-- A tabela é transcrita literalmente dos Anexos III e V (LC 155/2016). A
-- asserção logo abaixo exige que cada faixa some 100% — é o teste da
-- transcrição, não decoração.

INSERT INTO fin_tax_regime_param
  (regime, tributo, anexo, faixa, faixa_de_cents, faixa_ate_cents, aliquota_nominal,
   base_calculo, base_legal, fonte_url, consultado_em, vigencia_de, observacao)
SELECT 'simples',
       'PARTILHA_' || t.tributo,
       t.anexo,
       t.faixa,
       das.faixa_de_cents,
       das.faixa_ate_cents,
       t.aliquota,
       'das_da_faixa',
       format('LC 123/2006, Anexo %s, tabela de partilha da %sa faixa (red. LC 155/2016)', t.anexo, t.faixa),
       'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
       DATE '2026-08-16',
       DATE '2018-01-01',
       CASE
         WHEN t.anexo = 'III' AND t.faixa = 5 AND t.tributo = 'ISS'
           THEN 'A nota (*) do Anexo III fixa o ISS em 5% e redistribui o excedente aos federais quando a aliquota efetiva supera 14,92537%.'
         WHEN t.anexo = 'V' AND t.faixa = 5 AND t.tributo = 'ISS'
           THEN 'A nota do Anexo V fixa o ISS em 5% quando a aliquota efetiva supera 12,5%.'
         WHEN t.faixa = 6 AND t.tributo = 'CPP'
           THEN 'A 6a faixa nao reparte ISS. O tratamento do ISS nessa faixa exige o art. 18 §§16 e 16-A, nao consultados: a empresa esta na 4a/5a faixa.'
       END
  FROM (VALUES
  ('III',1,'IRPJ',0.040000),
  ('III',1,'CSLL',0.035000),
  ('III',1,'COFINS',0.128200),
  ('III',1,'PIS',0.027800),
  ('III',1,'CPP',0.434000),
  ('III',1,'ISS',0.335000),
  ('III',2,'IRPJ',0.040000),
  ('III',2,'CSLL',0.035000),
  ('III',2,'COFINS',0.140500),
  ('III',2,'PIS',0.030500),
  ('III',2,'CPP',0.434000),
  ('III',2,'ISS',0.320000),
  ('III',3,'IRPJ',0.040000),
  ('III',3,'CSLL',0.035000),
  ('III',3,'COFINS',0.136400),
  ('III',3,'PIS',0.029600),
  ('III',3,'CPP',0.434000),
  ('III',3,'ISS',0.325000),
  ('III',4,'IRPJ',0.040000),
  ('III',4,'CSLL',0.035000),
  ('III',4,'COFINS',0.136400),
  ('III',4,'PIS',0.029600),
  ('III',4,'CPP',0.434000),
  ('III',4,'ISS',0.325000),
  ('III',5,'IRPJ',0.040000),
  ('III',5,'CSLL',0.035000),
  ('III',5,'COFINS',0.128200),
  ('III',5,'PIS',0.027800),
  ('III',5,'CPP',0.434000),
  ('III',5,'ISS',0.335000),
  ('III',6,'IRPJ',0.350000),
  ('III',6,'CSLL',0.150000),
  ('III',6,'COFINS',0.160300),
  ('III',6,'PIS',0.034700),
  ('III',6,'CPP',0.305000),
  ('V',1,'IRPJ',0.250000),
  ('V',1,'CSLL',0.150000),
  ('V',1,'COFINS',0.141000),
  ('V',1,'PIS',0.030500),
  ('V',1,'CPP',0.288500),
  ('V',1,'ISS',0.140000),
  ('V',2,'IRPJ',0.230000),
  ('V',2,'CSLL',0.150000),
  ('V',2,'COFINS',0.141000),
  ('V',2,'PIS',0.030500),
  ('V',2,'CPP',0.278500),
  ('V',2,'ISS',0.170000),
  ('V',3,'IRPJ',0.240000),
  ('V',3,'CSLL',0.150000),
  ('V',3,'COFINS',0.149200),
  ('V',3,'PIS',0.032300),
  ('V',3,'CPP',0.238500),
  ('V',3,'ISS',0.190000),
  ('V',4,'IRPJ',0.210000),
  ('V',4,'CSLL',0.150000),
  ('V',4,'COFINS',0.157400),
  ('V',4,'PIS',0.034100),
  ('V',4,'CPP',0.238500),
  ('V',4,'ISS',0.210000),
  ('V',5,'IRPJ',0.230000),
  ('V',5,'CSLL',0.125000),
  ('V',5,'COFINS',0.141000),
  ('V',5,'PIS',0.030500),
  ('V',5,'CPP',0.238500),
  ('V',5,'ISS',0.235000),
  ('V',6,'IRPJ',0.350000),
  ('V',6,'CSLL',0.155000),
  ('V',6,'COFINS',0.164400),
  ('V',6,'PIS',0.035600),
  ('V',6,'CPP',0.295000)
       ) AS t(anexo, faixa, tributo, aliquota)
  JOIN fin_tax_regime_param das
    ON das.regime = 'simples' AND das.tributo = 'DAS'
   AND das.anexo = t.anexo AND das.faixa = t.faixa
   AND das.vigencia_de = DATE '2018-01-01'
ON CONFLICT DO NOTHING;

-- Teste da transcrição: cada faixa reparte exatamente 100% do DAS.
DO $$
DECLARE v_ruim text;
BEGIN
  SELECT string_agg(format('%s/%s=%s', anexo, faixa, soma), ', ')
    INTO v_ruim
    FROM (
      SELECT anexo, faixa, sum(aliquota_nominal) AS soma
        FROM fin_tax_regime_param
       WHERE regime = 'simples' AND tributo LIKE 'PARTILHA\_%'
       GROUP BY anexo, faixa
      HAVING sum(aliquota_nominal) <> 1.000000
    ) x;
  IF v_ruim IS NOT NULL THEN
    RAISE EXCEPTION 'partilha do DAS nao soma 100%% em: %', v_ruim;
  END IF;
END $$;

-- 1.2 O DAS-MEI, decomposto pela lei. Sem isso o valor de R$ 86,05 seria
-- número mágico; com isso ele é derivado do salário mínimo vigente e some
-- sozinho quando o salário mínimo mudar.
INSERT INTO fin_tax_regime_param
  (regime, tributo, aliquota_nominal, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, observacao)
VALUES
  ('comum','DAS_MEI_INSS',0.050000,'salario_minimo',
   'LC 123/2006 art. 18-A §3o IV c/c Lei 8.212/1991 art. 21 §2o II b — 5% do salario minimo',
   'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm','2026-08-16','2011-05-01',
   'Parcela previdenciaria do valor fixo mensal do MEI.')
ON CONFLICT DO NOTHING;

INSERT INTO fin_tax_regime_param
  (regime, tributo, valor_absoluto_cents, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, observacao)
VALUES
  ('comum','DAS_MEI_ISS',500,'valor_absoluto',
   'LC 123/2006 art. 18-A §3o V c — R$ 5,00 de ISS quando o MEI e contribuinte do imposto',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01',
   'Somado a parcela previdenciaria: em 2026, 5% x R$ 1.621,00 + R$ 5,00 = R$ 86,05.')
ON CONFLICT DO NOTHING;

-- 1.3 CBS e IBS de 2026: a taxa existe, e a dispensa de recolhimento também.
-- A 0081 gravou as duas como indeterminadas. A orientação da Receita Federal
-- de 06/05/2026 resolve metade: quem emitir o documento fiscal com o destaque
-- correto FICA DISPENSADO DE RECOLHER no período de teste. E o art. 348, I,
-- da LC 214/2025 manda compensar o que for recolhido com o PIS/Cofins do
-- mesmo período. Como PIS+Cofins de qualquer regime não cumulativo ou
-- cumulativo supera 1,0%, o efeito líquido em 2026 é zero — CONDICIONADO ao
-- cumprimento da obrigação acessória, que esta base não observa.
INSERT INTO fin_tax_regime_param
  (regime, tributo, aliquota_nominal, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, vigencia_ate, indeterminado, observacao)
VALUES
  ('comum','CBS_IBS_2026_LIQUIDO',0.000000,'receita_bruta',
   'LC 214/2025 arts. 343 e 346 (0,1% + 0,9%) e art. 348 I (compensacao com PIS/Cofins do mesmo periodo); RFB, Orientacoes 2026, atualizada em 06/05/2026: dispensa de recolhimento a quem emitir documento fiscal conforme as normas do periodo',
   'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026',
   '2026-08-16','2026-01-01','2026-12-31',false,
   'Zero CONDICIONADO: vale enquanto o destaque de CBS/IBS na NFS-e estiver correto e o PIS/Cofins do periodo cobrir a compensacao. A base nao observa o destaque, entao a condicao e declarada, nao verificada.')
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- 2. EVIDÊNCIA MEDIDA — SEPARADA DO PARÂMETRO LEGAL, DE PROPÓSITO
-- ==========================================================================
--
-- Alíquota de lei e alíquota observada são coisas diferentes e misturá-las na
-- mesma tabela apagaria a diferença entre "a lei diz" e "a nota mostra". O ISS
-- de 5% NÃO é um parâmetro legal aqui: é o que a empresa destacou em 2.826
-- NFS-e autorizadas. Serve para comparar regimes; não substitui a lei
-- municipal, e o campo `o_que_nao_prova` existe para dizer isso em cada linha.

CREATE TABLE IF NOT EXISTS fin_regime_evidencia (
  id              bigserial PRIMARY KEY,
  chave           text        NOT NULL UNIQUE,
  descricao       text        NOT NULL,
  valor_cents     bigint,
  valor_numerico  numeric(18,6),
  unidade         text        NOT NULL,
  janela_de       date,
  janela_ate      date,
  origem          text        NOT NULL,
  o_que_nao_prova text        NOT NULL,
  confianca       text        NOT NULL,
  medido_em       date        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_regime_evidencia_confianca_ck
    CHECK (confianca IN ('medida', 'parcial', 'indeterminada')),
  CONSTRAINT fin_regime_evidencia_unidade_ck
    CHECK (unidade IN ('cents', 'fracao', 'contagem', 'texto')),
  -- Evidência indeterminada não carrega valor: se carregasse, alguém usaria.
  CONSTRAINT fin_regime_evidencia_valor_ck
    CHECK (
      (confianca = 'indeterminada' AND valor_cents IS NULL AND valor_numerico IS NULL)
      OR (confianca <> 'indeterminada' AND (valor_cents IS NOT NULL OR valor_numerico IS NOT NULL))
    )
);

COMMENT ON TABLE fin_regime_evidencia IS
  'O que a base mede sobre a situacao fiscal da empresa, com a janela, a origem e — sempre — o '
  'que a medicao NAO prova. Nao e parametro legal: fin_tax_regime_param guarda a lei, esta tabela '
  'guarda o observado. Uma alicota destacada em nota e prova do que foi declarado, nao da lei '
  'municipal aplicavel.';
COMMENT ON COLUMN fin_regime_evidencia.o_que_nao_prova IS
  'Obrigatorio. O limite da inferencia, escrito antes que alguem esbarre nele.';

-- Os valores são MEDIDOS na aplicação, não digitados. A base muda por hora —
-- durante a preparação desta migration outra frente classificou R$ 34.000,00
-- de receita de mar/26, e um número copiado à mão já nasceria velho. O que a
-- tabela congela é a LEITURA daquele instante, com `medido_em` dizendo qual.
INSERT INTO fin_regime_evidencia
  (chave, descricao, valor_cents, valor_numerico, unidade, janela_de, janela_ate,
   origem, o_que_nao_prova, confianca, medido_em)
VALUES
  ('iss_aliquota_declarada_nfse',
   'Aliquota de ISS destacada nas NFS-e autorizadas da empresa',
   NULL,
   (SELECT round(sum(iss_cents)::numeric / NULLIF(sum(service_amount_cents), 0), 6)
      FROM fin_fiscal_document WHERE status = 'AUTHORIZED'),
   'fracao',
   (SELECT min(issue_date) FROM fin_fiscal_document WHERE status = 'AUTHORIZED'),
   (SELECT max(issue_date) FROM fin_fiscal_document WHERE status = 'AUTHORIZED'),
   (SELECT format('fin_fiscal_document: %s notas AUTHORIZED, iss_cents/service_amount_cents. Por ano: 5,0016%% (2021), 5,0013%% (2022), 5,0002%% (2023), 5,0001%% (2024), 5,0000%% (2025), 4,9816%% (2026). A queda de 2026 vem de %s notas com iss_rate=0.',
                  count(*), count(*) FILTER (WHERE iss_rate = 0))
      FROM fin_fiscal_document WHERE status = 'AUTHORIZED'),
   'Nao prova a lei municipal aplicavel, nem o local de incidencia, nem o direito a aliquota menor. Prova o que a empresa destacou. LC 116/2003 art. 8o II limita a 5% e art. 8o-A pisa em 2%: a empresa esta no teto.',
   'medida', CURRENT_DATE),

  ('iss_retido_na_fonte',
   'NFS-e de 2026 com ISS retido pelo tomador',
   NULL,
   (SELECT count(*) FROM fin_fiscal_document
     WHERE status = 'AUTHORIZED' AND iss_withheld AND issue_date >= DATE '2026-01-01'),
   'contagem', '2026-01-01', CURRENT_DATE,
   (SELECT format('%s notas AUTHORIZED em 2026; iss_withheld verdadeiro em %s.',
                  count(*), count(*) FILTER (WHERE iss_withheld))
      FROM fin_fiscal_document WHERE status = 'AUTHORIZED' AND issue_date >= DATE '2026-01-01'),
   'Nao prova que nao houve retencao em nota emitida fora do Asaas.',
   'medida', CURRENT_DATE),

  ('nfse_servico_consultoria_2026',
   'Receita de 2026 declarada em codigo municipal do item 17.01 (assessoria ou consultoria)',
   (SELECT sum(service_amount_cents) FROM fin_fiscal_document
     WHERE status = 'AUTHORIZED' AND issue_date >= DATE '2026-01-01'
       AND municipal_service_code LIKE '17.01%'),
   NULL, 'cents', '2026-01-01', CURRENT_DATE,
   'fin_fiscal_document AUTHORIZED, municipal_service_code iniciado em 17.01.',
   'A CONTINUACAO ja registrou que este codigo aparece em 11 categorias internas de receita: ele nao decide a categoria. Aqui ele serve para outra coisa — dizer que a empresa NAO declarou execucao de obra (item 7.02) em nenhuma nota, o que afasta o Anexo IV.',
   'medida', CURRENT_DATE),

  ('nfse_servico_manutencao_2026',
   'Receita de 2026 declarada em codigo municipal do item 14.01 (manutencao)',
   (SELECT sum(service_amount_cents) FROM fin_fiscal_document
     WHERE status = 'AUTHORIZED' AND issue_date >= DATE '2026-01-01'
       AND municipal_service_code LIKE '14.01%'),
   NULL, 'cents', '2026-01-01', CURRENT_DATE,
   'fin_fiscal_document AUTHORIZED, municipal_service_code iniciado em 14.01.',
   'Nao prova o enquadramento no art. 18 §5o-B IX; prova que a empresa declara manutencao, que e a hipotese daquele inciso — e que portanto essa fatia iria para o Anexo III mesmo com Fator R abaixo de 28%.',
   'medida', CURRENT_DATE),

  ('das_mei_pago_pela_empresa_2026',
   'DAS-MEI de terceiros pago pela empresa e lancado em 7.01 Simples Nacional',
   (SELECT COALESCE(sum(abs(t.amount_cents)), 0) FROM fin_transaction t
      JOIN fin_category c ON c.id = t.category_id
     WHERE t.amount_cents < 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
       AND c.code = '7.01' AND abs(t.amount_cents) = 8605
       AND t.posted_on >= DATE '2026-01-01'),
   NULL, 'cents', '2026-01-01', CURRENT_DATE,
   'Lancamentos de R$ 86,05 exatos = 5% x R$ 1.621,00 (salario minimo de 2026) + R$ 5,00 de ISS. LC 123 art. 18-A §3o IV e V c; Lei 8.212/1991 art. 21 §2o II b; Decreto 12.797/2025 art. 1o.',
   'Nao qualifica juridicamente o vinculo entre a empresa e os MEIs. Prova que o numerador de qualquer carga tributaria da EMPRESA precisa excluir esses centavos: sao tributo de terceiro.',
   'medida', CURRENT_DATE),

  ('receita_asaas_sem_categoria_2026',
   'Entradas do Asaas de 2026 com texto de cobranca recebida e nenhuma categoria',
   (SELECT COALESCE(sum(t.amount_cents), 0) FROM fin_transaction t
     WHERE t.amount_cents > 0 AND NOT t.is_split_parent AND t.category_id IS NULL
       AND t.source = 'asaas' AND t.posted_on >= DATE '2026-01-01'),
   NULL, 'cents', '2026-01-01', CURRENT_DATE,
   (SELECT format('%s lancamentos, todos com texto de cobranca ou transferencia recebida contra numero de fatura.', count(*))
      FROM fin_transaction t
     WHERE t.amount_cents > 0 AND NOT t.is_split_parent AND t.category_id IS NULL
       AND t.source = 'asaas' AND t.posted_on >= DATE '2026-01-01'),
   'Nao prova que sao receita de servico — prova que estao FORA de toda view de receita e de todo RBT12 calculado aqui. Enquanto nao forem decididas, a faixa do Simples fica sujeita a mudar sozinha.',
   'parcial', CURRENT_DATE),

  ('folha_cobertura_janela_fator_r',
   'Meses com movimento de pessoal no ledger dentro da janela de 12 meses do Fator R da ultima competencia',
   NULL,
   (SELECT count(DISTINCT date_trunc('month', t.posted_on))
      FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
     WHERE t.amount_cents < 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
       AND c.cash_flow_group = 'pessoal'
       AND t.posted_on >= (date_trunc('month', CURRENT_DATE) - interval '12 months')::date
       AND t.posted_on <  date_trunc('month', CURRENT_DATE)::date),
   'contagem',
   (date_trunc('month', CURRENT_DATE) - interval '12 months')::date,
   (date_trunc('month', CURRENT_DATE) - interval '1 day')::date,
   'Extratos de Inter e Nubank comecam em 01/01/2026; antes disso so existe o gateway Asaas, por onde a folha nao passa. Dez/25 aparece com R$ 242,03, que e movimento mas nao e folha.',
   'Isto NAO significa que a empresa nao teve folha em 2025. Significa que este ledger nao a enxerga — e por isso todo Fator R medido aqui e PISO, nunca valor. Ver duvida 4.',
   'parcial', CURRENT_DATE),

  ('empregados_declarados',
   'Pessoas com vinculo de empregado no cadastro',
   NULL,
   (SELECT count(*) FROM fin_person WHERE employment_type IN ('clt', 'empregado')),
   'contagem', NULL, CURRENT_DATE,
   (SELECT format('fin_person.employment_type: %s.',
                  string_agg(format('%s %s', n, COALESCE(tipo, 'sem tipo')), ', ' ORDER BY n DESC))
      FROM (SELECT employment_type AS tipo, count(*) AS n FROM fin_person GROUP BY 1) z),
   'Nao prova ausencia de empregado — prova ausencia de empregado DECLARADO nesta base. Enquanto for zero, FGTS e RAT sobre folha de empregado sao zero por FALTA DE SUJEITO, e nao por apuracao. As pessoas em 6.01 fora do MEI estao como indefinido, irregular ou sem pessoa vinculada.',
   'parcial', CURRENT_DATE),

  ('cnae_preponderante',
   'CNAE preponderante da XP ENERGY (CNPJ 34776108000192)',
   NULL, NULL, 'texto', NULL, NULL,
   'Procurado em fin_entity, fin_counterparty, fin_person, no repositorio inteiro e nas views existentes: nao existe nenhuma coluna de CNAE nesta base. A consulta ao CNPJ no site da Receita Federal exige captcha e nao foi feita. Fontes de terceiros que agregam o cadastro nao sao fonte primaria e foram descartadas.',
   'Sem CNAE nao se fecha (a) o anexo por atividade, (b) o grau de risco do RAT, (c) o codigo FPAS/Terceiros. Candidatos e impacto estao em fin_regime_indeterminacao_v. NENHUM foi assumido, nem o que a razao social sugere.',
   'indeterminada', CURRENT_DATE)
ON CONFLICT (chave) DO NOTHING;

-- ==========================================================================
-- 3. FATOR R — OS DOIS CENÁRIOS, E POR QUE NENHUM DECIDE SOZINHO
-- ==========================================================================
--
-- LC 123/2006 art. 18 §5º-K: numerador e denominador são os montantes pagos e
-- auferidos nos DOZE MESES ANTERIORES ao período de apuração.
-- § 24: o numerador é "remunerações a pessoas físicas decorrentes do
-- trabalho", incluídas as retiradas de pró-labore, acrescido da CPP e do FGTS
-- efetivamente recolhidos.
-- § 25: só entram as remunerações informadas na forma do art. 32, IV, da Lei
-- 8.212/1991.
-- § 26: não entram aluguéis nem distribuição de lucros.
--
-- Cinco numeradores, porque as cinco leituras existem e o dado separa:
--
--   ledger_total   tudo que o ledger chama de pessoal, MEI incluído — é o que
--                  a base diz hoje, e está errado por omissão do importador
--   sem_mei        o mesmo, tirando o MEI
--   legal_estrito  pró-labore + salários a pessoa física + encargos
--                  recolhidos. É a leitura do §24 com o §25: sem MEI (PJ),
--                  sem estágio (não é segurado empregado), sem benefício
--   pro_labore     só a retirada dos sócios — o piso indiscutível
--   mei_como_ci    legal_estrito + MEI, para o caso de o contador entender
--                  que os MEIs são contribuintes individuais. Note que essa
--                  leitura obriga a empresa a 20% de CPP sobre eles
--                  (Lei 8.212 art. 22, III), o que não aparece no ledger

CREATE OR REPLACE VIEW fin_fator_r_v AS
WITH pessoal AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.02'), 0)::bigint AS pro_labore_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE c.code = '6.01' AND p.employment_type = 'mei'), 0)::bigint AS mei_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE c.code = '6.01'
             AND (p.employment_type IS NULL OR p.employment_type <> 'mei')), 0)::bigint AS salario_pf_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.06'), 0)::bigint AS estagio_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.03'), 0)::bigint AS encargos_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.04'), 0)::bigint AS beneficios_cents,
         sum(abs(t.amount_cents))::bigint AS total_cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    LEFT JOIN fin_person_counterparty pc
      ON pc.counterparty_id = t.counterparty_id AND pc.status = 'confirmado'
    LEFT JOIN fin_person p ON p.id = pc.person_id
   WHERE t.amount_cents < 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
     AND c.cash_flow_group = 'pessoal'
   GROUP BY 1
),
receita_ledger AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(t.amount_cents)::bigint AS cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents > 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
     AND c.cash_flow_group IN ('receita-servicos', 'receita-recorrente')
   GROUP BY 1
),
receita_nota AS (
  SELECT date_trunc('month', issue_date)::date AS mes, sum(service_amount_cents)::bigint AS cents
    FROM fin_fiscal_document
   WHERE status = 'AUTHORIZED'
   GROUP BY 1
),
-- A receita que ninguém categorizou entra como base própria em vez de sumir.
receita_sem_categoria AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(t.amount_cents)::bigint AS cents
    FROM fin_transaction t
   WHERE t.amount_cents > 0
     AND NOT t.is_split_parent
     AND t.category_id IS NULL
     AND t.source = 'asaas'
   GROUP BY 1
),
competencias AS (
  SELECT generate_series(
           date_trunc('month', (SELECT min(mes) FROM receita_nota) + interval '12 months'),
           date_trunc('month', (SELECT max(mes) FROM receita_nota)),
           interval '1 month')::date AS mes
),
janela AS (
  SELECT k.mes,
         (k.mes - interval '12 months')::date AS janela_de,
         (k.mes - interval '1 day')::date      AS janela_ate,
         COALESCE((SELECT sum(pro_labore_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS pro_labore,
         COALESCE((SELECT sum(mei_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS mei,
         COALESCE((SELECT sum(salario_pf_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS salario_pf,
         COALESCE((SELECT sum(estagio_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS estagio,
         COALESCE((SELECT sum(encargos_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS encargos,
         COALESCE((SELECT sum(beneficios_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS beneficios,
         COALESCE((SELECT sum(total_cents) FROM pessoal p
                    WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes), 0)::bigint AS total_pessoal,
         (SELECT count(*) FROM pessoal p
           WHERE p.mes >= k.mes - interval '12 months' AND p.mes < k.mes)::integer AS meses_com_folha,
         COALESCE((SELECT sum(cents) FROM receita_ledger r
                    WHERE r.mes >= k.mes - interval '12 months' AND r.mes < k.mes), 0)::bigint AS rbt12_ledger,
         COALESCE((SELECT sum(cents) FROM receita_nota r
                    WHERE r.mes >= k.mes - interval '12 months' AND r.mes < k.mes), 0)::bigint AS rbt12_nota,
         COALESCE((SELECT sum(cents) FROM receita_sem_categoria r
                    WHERE r.mes >= k.mes - interval '12 months' AND r.mes < k.mes), 0)::bigint AS rbt12_sem_categoria
    FROM competencias k
),
cenarios AS (
  SELECT j.*, n.cenario_folha, n.numerador_cents, n.regra_do_numerador,
         b.base_receita, b.denominador_cents, b.regra_do_denominador
    FROM janela j
    CROSS JOIN LATERAL (VALUES
      ('ledger_total'::text,  j.total_pessoal,
       'tudo em cash_flow_group=pessoal, MEI incluido — o que a base diz hoje'::text),
      ('sem_mei',             j.total_pessoal - j.mei,
       'ledger_total menos os pagamentos a pessoas com employment_type=mei'),
      ('legal_estrito',       j.pro_labore + j.salario_pf + j.encargos,
       'LC 123 art. 18 §24 lido com o §25: pro-labore + remuneracao a pessoa fisica + CPP/FGTS recolhidos. Exclui MEI (PJ), estagio (nao e segurado empregado) e beneficio'),
      ('pro_labore',          j.pro_labore,
       'somente a retirada dos socios — o piso indiscutivel do numerador'),
      ('mei_como_ci',         j.pro_labore + j.salario_pf + j.encargos + j.mei,
       'legal_estrito + MEI, para a leitura em que os MEIs sao contribuintes individuais. Essa leitura implica 20% de CPP sobre eles (Lei 8.212 art. 22 III), custo que o ledger nao registra')
    ) n(cenario_folha, numerador_cents, regra_do_numerador)
    CROSS JOIN LATERAL (VALUES
      ('nota_asaas'::text,          j.rbt12_nota,
       'NFS-e autorizadas no Asaas — a base mais proxima da receita bruta por competencia'::text),
      ('ledger_categorizado',       j.rbt12_ledger,
       'entradas de receita-servicos e receita-recorrente no regime de caixa'),
      ('ledger_mais_sem_categoria', j.rbt12_ledger + j.rbt12_sem_categoria,
       'ledger categorizado mais as entradas do Asaas que ninguem categorizou')
    ) b(base_receita, denominador_cents, regra_do_denominador)
)
SELECT
  c.mes                                        AS competencia,
  c.janela_de,
  c.janela_ate,
  c.cenario_folha,
  c.base_receita,
  c.numerador_cents,
  c.denominador_cents,
  c.meses_com_folha,
  CASE WHEN c.denominador_cents > 0
       THEN round(c.numerador_cents::numeric / c.denominador_cents, 6) END AS fator_r,
  -- Extrapolação declarada como tal: só serve para mostrar a direção do viés
  -- da janela incompleta. Não é medida e não decide nada.
  CASE WHEN c.denominador_cents > 0 AND c.meses_com_folha BETWEEN 1 AND 11
       THEN round((c.numerador_cents::numeric * 12 / c.meses_com_folha) / c.denominador_cents, 6) END
    AS fator_r_extrapolado_12m,
  (SELECT p.aliquota_nominal FROM fin_tax_regime_param p
    WHERE p.regime = 'simples' AND p.tributo = 'FATOR_R'
      AND p.vigencia_de <= c.mes ORDER BY p.vigencia_de DESC LIMIT 1) AS limiar_legal,
  CASE
    WHEN c.denominador_cents = 0 THEN NULL
    WHEN c.numerador_cents::numeric / c.denominador_cents >= 0.28 THEN 'III'
    ELSE 'V'
  END                                          AS anexo_indicado,
  (c.meses_com_folha = 12)                     AS janela_completa,
  CASE WHEN c.meses_com_folha = 12 THEN 'medido' ELSE 'parcial' END AS qualidade,
  c.regra_do_numerador,
  c.regra_do_denominador,
  'LC 123/2006 art. 18 §§5o-J, 5o-K, 5o-M, 24, 25 e 26'::text AS base_legal,
  'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'::text AS fonte_url,
  CASE WHEN c.meses_com_folha < 12
       THEN format(
         'Janela com %s de 12 meses de folha no ledger. Numerador subestimado por construcao: '
         'o denominador tem 12 meses de receita. Fator R medido e PISO, nao valor.',
         c.meses_com_folha) END                 AS aviso
  FROM cenarios c;

COMMENT ON VIEW fin_fator_r_v IS
  'Fator R por competencia em 5 leituras do numerador x 3 bases de receita, com a cobertura da '
  'janela declarada em cada linha. O anexo indicado NAO e o anexo aplicavel: e o que aquela '
  'combinacao de numerador e base produz. Enquanto janela_completa=false o resultado e piso, e '
  'fator_r_extrapolado_12m existe so para mostrar a direcao do vies — nunca para decidir. '
  'Saida gerencial, sujeita a validacao do contador.';

-- ==========================================================================
-- 4. A CARGA DE 9,17% NÃO EXISTE — A PONTE, EM QUATRO PASSOS MEDIDOS
-- ==========================================================================
--
--   passo 0   R$ 123.842,07 / R$ 1.350.225,21 = 9,17%
--             imposto pago em 2026 sobre receita de caixa de 2026
--
--   passo 1   tira do numerador o que nao e tributo da empresa:
--             R$ 2.925,70 de DAS-MEI de terceiro (34 guias de R$ 86,05) e
--             R$ 558,29 de ISS avulso pago ao Municipio do Recife
--             R$ 120.358,08 / R$ 1.350.225,21 = 8,91%
--
--   passo 2   alinha o periodo. O DAS pago em 2026 e das competencias
--             dez/25 a jun/26 — sete, nao oito. O de jul/26 vence em 20/08 e
--             ainda nao foi pago em 15/08
--             R$ 120.358,08 / R$ 1.206.712,98 = 9,97%
--
--   passo 3   troca a base. O DAS incide sobre receita bruta por competencia,
--             nao sobre o que entrou no caixa no mes
--             R$ 120.358,08 / R$ 877.874,63 = 13,71%
--
--   passo 4   compara com a lei. A aliquota efetiva do Anexo III nessas
--             competencias vai de 12,50% a 13,39%. Dividindo o DAS pago por
--             ela, a base implicita e R$ 933.442,32 — contra R$ 877.874,63 de
--             NFS-e do Asaas. Sobram R$ 55.567,69, que sao as notas emitidas
--             fora do Asaas que o Fernando antecipou e a 0065 mediu
--
-- Nenhum passo ajusta o calculo para caber: cada um troca um numero errado por
-- um numero medido, e o residual final tem nome e valor.

CREATE OR REPLACE VIEW fin_das_reconciliacao_v AS
WITH mei_valor AS (
  SELECT (SELECT p.valor_absoluto_cents FROM fin_tax_regime_param p
           WHERE p.regime = 'comum' AND p.tributo = 'SALARIO_MINIMO'
             AND p.vigencia_de <= CURRENT_DATE ORDER BY p.vigencia_de DESC LIMIT 1)
         * (SELECT p.aliquota_nominal FROM fin_tax_regime_param p
             WHERE p.regime = 'comum' AND p.tributo = 'DAS_MEI_INSS'
               AND p.vigencia_de <= CURRENT_DATE ORDER BY p.vigencia_de DESC LIMIT 1)
         + (SELECT p.valor_absoluto_cents FROM fin_tax_regime_param p
             WHERE p.regime = 'comum' AND p.tributo = 'DAS_MEI_ISS'
               AND p.vigencia_de <= CURRENT_DATE ORDER BY p.vigencia_de DESC LIMIT 1)
         AS cents
),
pago AS (
  SELECT (date_trunc('month', t.posted_on) - interval '1 month')::date AS competencia,
         date_trunc('month', t.posted_on)::date AS pago_em,
         sum(abs(t.amount_cents)) FILTER (
           WHERE abs(t.amount_cents) <> (SELECT round(cents) FROM mei_valor))::bigint AS das_empresa_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE abs(t.amount_cents) = (SELECT round(cents) FROM mei_valor)), 0)::bigint AS das_mei_terceiro_cents,
         count(*) FILTER (
           WHERE abs(t.amount_cents) = (SELECT round(cents) FROM mei_valor))::integer AS qtd_das_mei
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
     AND c.code = '7.01'
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
  -- A base que a empresa teria declarado, sob cada hipótese de anexo.
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round(b.das_empresa_cents
          / ((b.rbt12_nota_cents * p3.aliquota_nominal - p3.parcela_deduzir_cents)
             / b.rbt12_nota_cents))::bigint END         AS base_implicita_iii_cents,
  CASE WHEN b.rbt12_nota_cents > 0 THEN
    round(b.das_empresa_cents
          / ((b.rbt12_nota_cents * p5.aliquota_nominal - p5.parcela_deduzir_cents)
             / b.rbt12_nota_cents))::bigint END         AS base_implicita_v_cents,
  -- O residual sob a hipótese do Anexo III: positivo = nota fora do Asaas.
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
    'correspondente.',
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
  'efetivamente pagou. Separa o DAS-MEI de terceiro (R$ 86,05 derivado do salario minimo) do DAS '
  'da empresa. O residual contra as NFS-e do Asaas mede as notas emitidas fora do Asaas sem '
  'arbitrar nenhuma delas. Nao e apuracao: e conferencia reversa, gerencial, sujeita a validacao '
  'do contador.';

-- ==========================================================================
-- 5. A TABELA COMPARATIVA — TRÊS REGIMES, MESMA BASE, MESMA REGRA
-- ==========================================================================
--
-- Regras que tornam a comparação honesta, e que a 0081 ainda não podia aplicar:
--
--  a) BASE ÚNICA. Todos os regimes incidem sobre a MESMA receita bruta por
--     competência (NFS-e autorizadas). Comparar Simples sobre nota com
--     Presumido sobre caixa produziria um vencedor que é só a escolha da base.
--
--  b) ISS SÓ APARECE UMA VEZ. No Simples ele está dentro do DAS — a partilha
--     da faixa diz quanto. No Presumido e no Real é linha própria, a 5%
--     medidos nas NFS-e da empresa.
--
--  c) CPP IDEM. No Simples III e V a CPP está dentro do DAS. No Presumido e no
--     Real são 20% sobre o pró-labore (Lei 8.212 art. 22, III) — e sobre a
--     remuneração de empregado, que aqui é zero por ausência de sujeito
--     declarado, não por apuração.
--
--  d) O ADICIONAL DE IRPJ É TRIMESTRAL. Provisionado por diferença dentro do
--     trimestre, de modo que a soma dos três meses reproduza o limite legal de
--     R$ 20.000,00 por mês do período (Lei 9.249 art. 3º §1º).
--
--  e) O QUE NÃO SE SABE NÃO VIRA ZERO. Cada rubrica indeterminada é uma linha
--     com `bloqueia_comparacao = true`, e o total do regime fica NULL enquanto
--     houver uma.

CREATE OR REPLACE VIEW fin_regime_2026_v AS
WITH nota AS (
  SELECT date_trunc('month', issue_date)::date AS mes,
         sum(service_amount_cents)::bigint AS cents,
         count(*)::integer AS notas
    FROM fin_fiscal_document
   WHERE status = 'AUTHORIZED' AND issue_date >= DATE '2026-01-01' AND issue_date < DATE '2027-01-01'
   GROUP BY 1
),
pessoal AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.02'), 0)::bigint AS pro_labore_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE c.code = '6.01' AND p.employment_type = 'mei'), 0)::bigint AS mei_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE c.code = '6.01'
             AND (p.employment_type IS NULL OR p.employment_type <> 'mei')), 0)::bigint AS salario_pf_cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
    LEFT JOIN fin_person_counterparty pc
      ON pc.counterparty_id = t.counterparty_id AND pc.status = 'confirmado'
    LEFT JOIN fin_person p ON p.id = pc.person_id
   WHERE t.amount_cents < 0 AND NOT t.is_split_parent AND t.transfer_status <> 'pareado'
     AND c.cash_flow_group = 'pessoal'
     AND t.posted_on >= DATE '2026-01-01' AND t.posted_on < DATE '2027-01-01'
   GROUP BY 1
),
fr AS (
  SELECT competencia, cenario_folha, fator_r, anexo_indicado, meses_com_folha
    FROM fin_fator_r_v
   WHERE base_receita = 'nota_asaas'
),
-- O RBT12 é dos 12 meses ANTERIORES à competência (LC 123 art. 18 §1º), e
-- vem da série inteira de NFS-e — não só de 2026. Amarrá-lo à existência de
-- um pagamento de DAS deixaria jul/26 e ago/26 sem faixa só porque a guia
-- ainda não venceu.
nota_serie AS (
  SELECT date_trunc('month', issue_date)::date AS mes, sum(service_amount_cents)::bigint AS cents
    FROM fin_fiscal_document WHERE status = 'AUTHORIZED' GROUP BY 1
),
mes AS (
  SELECT n.mes,
         n.cents AS receita_cents,
         n.notas,
         COALESCE(p.pro_labore_cents, 0) AS pro_labore_cents,
         COALESCE(p.mei_cents, 0)        AS mei_cents,
         COALESCE(p.salario_pf_cents, 0) AS salario_pf_cents,
         (SELECT sum(s.cents) FROM nota_serie s
           WHERE s.mes >= (n.mes - interval '12 months')::date AND s.mes < n.mes) AS rbt12_cents,
         (SELECT fator_r FROM fr WHERE fr.competencia = n.mes AND cenario_folha = 'ledger_total')  AS fr_com_mei,
         (SELECT fator_r FROM fr WHERE fr.competencia = n.mes AND cenario_folha = 'legal_estrito') AS fr_sem_mei,
         (SELECT meses_com_folha FROM fr WHERE fr.competencia = n.mes AND cenario_folha = 'ledger_total') AS meses_com_folha,
         (n.mes = date_trunc('month', (SELECT max(issue_date) FROM fin_fiscal_document
                                        WHERE status = 'AUTHORIZED'))::date) AS mes_incompleto
    FROM nota n
    LEFT JOIN pessoal p ON p.mes = n.mes
),
-- RBT12 pode faltar faixa se estourar o teto; LEFT JOIN e a linha vira lacuna.
faixa AS (
  SELECT m.*,
         p3.faixa AS faixa3, p3.aliquota_nominal AS nom3, p3.parcela_deduzir_cents AS ded3,
         p5.faixa AS faixa5, p5.aliquota_nominal AS nom5, p5.parcela_deduzir_cents AS ded5
    FROM mes m
    LEFT JOIN fin_tax_regime_param p3
      ON p3.regime = 'simples' AND p3.tributo = 'DAS' AND p3.anexo = 'III'
     AND m.rbt12_cents BETWEEN p3.faixa_de_cents AND p3.faixa_ate_cents
    LEFT JOIN fin_tax_regime_param p5
      ON p5.regime = 'simples' AND p5.tributo = 'DAS' AND p5.anexo = 'V'
     AND m.rbt12_cents BETWEEN p5.faixa_de_cents AND p5.faixa_ate_cents
),
calc AS (
  SELECT f.*,
         CASE WHEN f.rbt12_cents > 0 AND f.nom3 IS NOT NULL
              THEN (f.rbt12_cents * f.nom3 - f.ded3) / f.rbt12_cents END AS ef3,
         CASE WHEN f.rbt12_cents > 0 AND f.nom5 IS NOT NULL
              THEN (f.rbt12_cents * f.nom5 - f.ded5) / f.rbt12_cents END AS ef5
    FROM faixa f
),
-- Presumido: o adicional de IRPJ é acumulado no trimestre e lançado por
-- diferença, para que a soma dos meses reproduza o limite trimestral.
pres AS (
  SELECT c.*,
         round(c.receita_cents * 0.32)::bigint AS base_pres_cents,
         sum(round(c.receita_cents * 0.32)) OVER (
           PARTITION BY date_trunc('quarter', c.mes) ORDER BY c.mes)::numeric AS base_acum_cents,
         row_number() OVER (PARTITION BY date_trunc('quarter', c.mes) ORDER BY c.mes) AS m_no_tri
    FROM calc c
),
pres2 AS (
  SELECT p.*,
         (GREATEST(0::numeric, p.base_acum_cents - 2000000 * p.m_no_tri)
          - GREATEST(0::numeric, p.base_acum_cents - p.base_pres_cents - 2000000 * (p.m_no_tri - 1)))::bigint
           AS base_adicional_cents
    FROM pres p
),
param AS (
  SELECT
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='PRESUNCAO_IRPJ') AS pres_irpj,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='PRESUNCAO_CSLL') AS pres_csll,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='IRPJ')           AS irpj,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='IRPJ_ADICIONAL') AS irpj_ad,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='CSLL')           AS csll,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='PIS')            AS pis_c,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='presumido' AND tributo='COFINS')         AS cof_c,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='real' AND tributo='PIS')                 AS pis_nc,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='real' AND tributo='COFINS')              AS cof_nc,
    (SELECT aliquota_nominal FROM fin_tax_regime_param WHERE regime='comum' AND tributo='CPP_PRO_LABORE')     AS cpp_pl,
    (SELECT valor_numerico FROM fin_regime_evidencia WHERE chave='iss_aliquota_declarada_nfse')               AS iss_med
),
linhas AS (
  -- ---------- SIMPLES, Anexo III ----------
  SELECT c.mes, 'simples_anexo_iii'::text AS cenario, 'simples'::text AS regime, 'III'::text AS anexo,
         1 AS ordem, 'DAS — Anexo III'::text AS rubrica, 'tributo'::text AS natureza,
         c.receita_cents AS base_cents, c.ef3 AS aliquota,
         CASE WHEN c.ef3 IS NULL THEN NULL ELSE round(c.receita_cents * c.ef3)::bigint END AS valor_cents,
         true AS no_total, (c.ef3 IS NULL) AS indeterminado, (c.ef3 IS NULL) AS bloqueia_comparacao,
         format('RBT12 R$ %s cai na %sa faixa: (%s x %s - %s) / RBT12 = %s de aliquota efetiva; DAS = receita bruta da competencia x essa aliquota. Inclui IRPJ, CSLL, PIS, Cofins, CPP e ISS.',
                to_char(c.rbt12_cents/100.0,'FM999G999G990D00'), c.faixa3,
                to_char(c.rbt12_cents/100.0,'FM999G999G990D00'), c.nom3,
                to_char(c.ded3/100.0,'FM999G999G990D00'), round(c.ef3,6))::text AS memoria,
         'LC 123/2006 art. 18 §1o-A e Anexo III (red. LC 155/2016)'::text AS base_legal,
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'::text AS fonte_url,
         CASE WHEN c.ef3 IS NULL
              THEN 'RBT12 ausente ou fora do limite de R$ 4,8 milhoes: nao ha faixa e portanto nao ha DAS calculavel. Acima do teto a empresa esta excluida do Simples (LC 123 art. 3o II), o que e outra pergunta.' END::text AS motivo
    FROM calc c
  UNION ALL
  SELECT c.mes, 'simples_anexo_iii', 'simples', 'III', 2,
         'ISS — ja dentro do DAS', 'informativo', c.receita_cents,
         (SELECT aliquota_nominal FROM fin_tax_regime_param
           WHERE regime='simples' AND tributo='PARTILHA_ISS' AND anexo='III' AND faixa=c.faixa3),
         CASE WHEN c.ef3 IS NULL THEN NULL ELSE round(c.receita_cents * c.ef3 *
           COALESCE((SELECT aliquota_nominal FROM fin_tax_regime_param
                      WHERE regime='simples' AND tributo='PARTILHA_ISS' AND anexo='III' AND faixa=c.faixa3), 0))::bigint END,
         false, false, false,
         'Parcela do DAS destinada ao ISS pela partilha da faixa. Mostrada FORA do total para nao contar duas vezes — no Simples o ISS ja esta no DAS. E a linha que torna a comparacao com Presumido/Real honesta.',
         'LC 123/2006, Anexo III, tabela de partilha',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', NULL
    FROM calc c
  UNION ALL
  SELECT c.mes, 'simples_anexo_iii', 'simples', 'III', 3,
         'CPP — ja dentro do DAS', 'informativo', c.receita_cents,
         (SELECT aliquota_nominal FROM fin_tax_regime_param
           WHERE regime='simples' AND tributo='PARTILHA_CPP' AND anexo='III' AND faixa=c.faixa3),
         CASE WHEN c.ef3 IS NULL THEN NULL ELSE round(c.receita_cents * c.ef3 *
           COALESCE((SELECT aliquota_nominal FROM fin_tax_regime_param
                      WHERE regime='simples' AND tributo='PARTILHA_CPP' AND anexo='III' AND faixa=c.faixa3), 0))::bigint END,
         false, false, false,
         'Parcela do DAS destinada a CPP. Fora do total pelo mesmo motivo do ISS. No Presumido e no Real esta mesma contribuicao vira linha propria a 20% sobre o pro-labore.',
         'LC 123/2006, Anexo III, tabela de partilha',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', NULL
    FROM calc c
  UNION ALL
  SELECT c.mes, 'simples_anexo_iii', 'simples', 'III', 9,
         'Anexo aplicavel', 'lacuna', c.receita_cents, NULL, NULL,
         false, true, true,
         format('Fator R medido com MEI = %s; sem MEI (leitura do §24 com o §25) = %s. Limiar legal 28%%. A janela tem %s de 12 meses de folha, entao os dois sao piso. O anexo tambem depende da atividade: consultoria cai no §5o-I IX (Anexo V com Fator R) e manutencao no §5o-B IX (Anexo III sempre).',
                COALESCE(round(c.fr_com_mei,4)::text,'sem dado'),
                COALESCE(round(c.fr_sem_mei,4)::text,'sem dado'),
                COALESCE(c.meses_com_folha::text,'0')),
         'LC 123/2006 art. 18 §§5o-B IX, 5o-I VI e IX, 5o-J, 5o-M, 24 e 25',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
         'Sem CNAE preponderante e sem a folha declarada em eSocial/GFIP a escolha entre III e V nao se fecha com este ledger.'
    FROM calc c

  -- ---------- SIMPLES, Anexo V ----------
  UNION ALL
  SELECT c.mes, 'simples_anexo_v', 'simples', 'V', 1, 'DAS — Anexo V', 'tributo',
         c.receita_cents, c.ef5,
         CASE WHEN c.ef5 IS NULL THEN NULL ELSE round(c.receita_cents * c.ef5)::bigint END,
         true, (c.ef5 IS NULL), (c.ef5 IS NULL),
         format('RBT12 R$ %s cai na %sa faixa: (%s x %s - %s) / RBT12 = %s de aliquota efetiva.',
                to_char(c.rbt12_cents/100.0,'FM999G999G990D00'), c.faixa5,
                to_char(c.rbt12_cents/100.0,'FM999G999G990D00'), c.nom5,
                to_char(c.ded5/100.0,'FM999G999G990D00'), round(c.ef5,6)),
         'LC 123/2006 art. 18 §1o-A e Anexo V (red. LC 155/2016)',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
         CASE WHEN c.ef5 IS NULL
              THEN 'RBT12 ausente ou fora do limite de R$ 4,8 milhoes: nao ha faixa e portanto nao ha DAS calculavel.' END
    FROM calc c
  UNION ALL
  SELECT c.mes, 'simples_anexo_v', 'simples', 'V', 2, 'ISS — ja dentro do DAS', 'informativo',
         c.receita_cents,
         (SELECT aliquota_nominal FROM fin_tax_regime_param
           WHERE regime='simples' AND tributo='PARTILHA_ISS' AND anexo='V' AND faixa=c.faixa5),
         CASE WHEN c.ef5 IS NULL THEN NULL ELSE round(c.receita_cents * c.ef5 *
           COALESCE((SELECT aliquota_nominal FROM fin_tax_regime_param
                      WHERE regime='simples' AND tributo='PARTILHA_ISS' AND anexo='V' AND faixa=c.faixa5), 0))::bigint END,
         false, false, false,
         'Parcela do DAS destinada ao ISS pela partilha da faixa. Fora do total para nao contar duas vezes.',
         'LC 123/2006, Anexo V, tabela de partilha',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', NULL
    FROM calc c
  UNION ALL
  SELECT c.mes, 'simples_anexo_v', 'simples', 'V', 3, 'CPP — ja dentro do DAS', 'informativo',
         c.receita_cents,
         (SELECT aliquota_nominal FROM fin_tax_regime_param
           WHERE regime='simples' AND tributo='PARTILHA_CPP' AND anexo='V' AND faixa=c.faixa5),
         CASE WHEN c.ef5 IS NULL THEN NULL ELSE round(c.receita_cents * c.ef5 *
           COALESCE((SELECT aliquota_nominal FROM fin_tax_regime_param
                      WHERE regime='simples' AND tributo='PARTILHA_CPP' AND anexo='V' AND faixa=c.faixa5), 0))::bigint END,
         false, false, false,
         'Parcela do DAS destinada a CPP. Fora do total pelo mesmo motivo.',
         'LC 123/2006, Anexo V, tabela de partilha',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', NULL
    FROM calc c
  UNION ALL
  SELECT c.mes, 'simples_anexo_v', 'simples', 'V', 9, 'Anexo aplicavel', 'lacuna',
         c.receita_cents, NULL, NULL, false, true, true,
         'Mesma lacuna do Anexo III: o Fator R medido e piso e a atividade nao esta segregada.',
         'LC 123/2006 art. 18 §§5o-I, 5o-J, 5o-M, 24 e 25',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm',
         'Sem CNAE preponderante e sem folha declarada a escolha entre III e V nao se fecha.'
    FROM calc c

  -- ---------- LUCRO PRESUMIDO ----------
  UNION ALL
  SELECT p.mes, 'lucro_presumido', 'presumido', NULL, x.ordem, x.rubrica, x.natureza,
         x.base_cents, x.aliquota, x.valor_cents, x.no_total, false, false,
         x.memoria, x.base_legal, x.fonte_url, NULL
    FROM pres2 p CROSS JOIN param q
    CROSS JOIN LATERAL (VALUES
      (1, 'IRPJ'::text, 'tributo'::text, p.base_pres_cents, q.irpj,
       round(p.base_pres_cents * q.irpj)::bigint, true,
       'receita bruta x 32% de presuncao x 15%'::text,
       'Lei 9.249/1995 art. 15 §1o III a e art. 3o'::text,
       'https://www.planalto.gov.br/ccivil_03/leis/l9249.htm'::text),
      (2, 'IRPJ adicional', 'tributo', p.base_adicional_cents, q.irpj_ad,
       round(p.base_adicional_cents * q.irpj_ad)::bigint, true,
       'provisao incremental no trimestre: excesso acumulado ate o mes menos excesso ate o mes anterior, sobre limite de R$ 20.000,00 por mes do periodo',
       'Lei 9.249/1995 art. 3o §1o e Lei 9.430/1996 arts. 1o e 25',
       'https://www.planalto.gov.br/ccivil_03/leis/l9430.htm'),
      (3, 'CSLL', 'tributo', p.base_pres_cents, q.csll,
       round(p.base_pres_cents * q.csll)::bigint, true,
       'receita bruta x 32% de base x 9%',
       'Lei 9.249/1995 art. 20 e Lei 7.689/1988 art. 3o III',
       'https://www.planalto.gov.br/ccivil_03/leis/l7689.htm'),
      (4, 'PIS cumulativo', 'tributo', p.receita_cents, q.pis_c,
       round(p.receita_cents * q.pis_c)::bigint, true,
       'receita bruta x 0,65%',
       'Lei 9.715/1998 art. 8o I',
       'https://www.planalto.gov.br/ccivil_03/leis/l9715.htm'),
      (5, 'COFINS cumulativa', 'tributo', p.receita_cents, q.cof_c,
       round(p.receita_cents * q.cof_c)::bigint, true,
       'receita bruta x 3%',
       'Lei 9.718/1998 art. 8o',
       'https://www.planalto.gov.br/ccivil_03/leis/l9718compilada.htm'),
      (6, 'ISS', 'tributo', p.receita_cents, q.iss_med,
       round(p.receita_cents * q.iss_med)::bigint, true,
       'receita bruta x 5,00% — aliquota MEDIDA nas 2.826 NFS-e autorizadas da propria empresa, nao lida na lei municipal. LC 116/2003 art. 8o II poe o teto em 5%: a empresa esta nele',
       'LC 116/2003 art. 8o II; evidencia iss_aliquota_declarada_nfse',
       'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm'),
      (7, 'CPP sobre pro-labore', 'encargo', p.pro_labore_cents, q.cpp_pl,
       round(p.pro_labore_cents * q.cpp_pl)::bigint, true,
       'pro-labore pago no mes x 20%. No Simples III/V esta contribuicao ja esta dentro do DAS',
       'Lei 8.212/1991 art. 22 III',
       'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm'),
      (8, 'CBS + IBS de 2026', 'tributo', p.receita_cents, 0.000000,
       0::bigint, true,
       'CBS 0,9% + IBS 0,1% em 2026, compensados com o PIS/Cofins do mesmo periodo (LC 214/2025 art. 348 I) e com recolhimento DISPENSADO a quem emitir o documento fiscal conforme as normas do periodo de teste. Zero CONDICIONADO ao cumprimento da obrigacao acessoria, que esta base nao observa',
       'LC 214/2025 arts. 343, 346 e 348 I; RFB, Orientacoes 2026 (06/05/2026)',
       'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026')
    ) x(ordem, rubrica, natureza, base_cents, aliquota, valor_cents, no_total, memoria, base_legal, fonte_url)
  UNION ALL
  SELECT p.mes, 'lucro_presumido', 'presumido', NULL, x.ordem, x.rubrica, 'lacuna',
         x.base_cents, NULL, NULL, false, true, true, x.memoria, x.base_legal, x.fonte_url, x.motivo
    FROM pres2 p
    CROSS JOIN LATERAL (VALUES
      (20, 'RAT/FAP'::text, p.salario_pf_cents,
       'nao calculado — 1%, 2% ou 3% conforme o grau de risco da atividade preponderante, e o FAP multiplica'::text,
       'Lei 8.212/1991 art. 22 II'::text,
       'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm'::text,
       'Falta o CNAE preponderante. A base exibida sao os R$ 46.179,80 pagos em 6.01 a quem nao e MEI — e nem esses tem vinculo declarado.'::text),
      (21, 'Terceiros (FPAS)', p.salario_pf_cents,
       'nao calculado — depende do codigo FPAS e do enquadramento',
       'Lei 8.212/1991 art. 22 e legislacao das contribuicoes a terceiros',
       'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm',
       'Falta CNAE e FPAS. Nenhum percentual de mercado foi usado.'),
      (22, 'CPP e FGTS sobre empregado', p.salario_pf_cents,
       'nao calculado — nao ha empregado declarado nesta base',
       'Lei 8.212/1991 art. 22 I e Lei 8.036/1990 art. 15',
       'https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm',
       'Zero por ausencia de sujeito, nao por apuracao: fin_person nao tem nenhuma pessoa com vinculo de empregado. As 4 pessoas em 6.01 fora do MEI estao como indefinido, irregular ou sem pessoa vinculada.'),
      (23, 'Segregacao da receita por atividade', p.receita_cents,
       'nao calculado — art. 15 §2o manda aplicar o percentual de cada atividade quando ha atividades diversas',
       'Lei 9.249/1995 art. 15 §2o',
       'https://www.planalto.gov.br/ccivil_03/leis/l9249.htm',
       'A presuncao de 32% foi aplicada a 100% da receita. As NFS-e declaram dois codigos municipais distintos (17.01 e 14.01); se alguma atividade tiver percentual diferente, o IRPJ e a CSLL mudam.'),
      (24, 'Receita emitida fora do Asaas', p.receita_cents,
       'nao calculado — a base fiscal desta view sao as NFS-e do Asaas',
       'Decreto-Lei 1.598/1977 art. 12',
       'https://www.planalto.gov.br/ccivil_03/decreto-lei/del1598.htm',
       'fin_das_reconciliacao_v mede R$ 55.567,69 de base implicita alem das notas do Asaas em 7 competencias. Receita externa nao e arbitrada como zero.')
    ) x(ordem, rubrica, base_cents, memoria, base_legal, fonte_url, motivo)

  -- ---------- LUCRO REAL ----------
  UNION ALL
  SELECT c.mes, 'lucro_real', 'real', NULL, x.ordem, x.rubrica, x.natureza,
         x.base_cents, x.aliquota, x.valor_cents, x.no_total, false, false,
         x.memoria, x.base_legal, x.fonte_url, NULL
    FROM calc c CROSS JOIN param q
    CROSS JOIN LATERAL (VALUES
      (4, 'PIS nao cumulativo — debito bruto'::text, 'tributo'::text, c.receita_cents, q.pis_nc,
       round(c.receita_cents * q.pis_nc)::bigint, true,
       'receita bruta x 1,65%, ANTES dos creditos do art. 3o — que aparecem como lacuna propria'::text,
       'Lei 10.637/2002 art. 2o'::text,
       'https://www.planalto.gov.br/ccivil_03/leis/2002/l10637compilado.htm'::text),
      (5, 'COFINS nao cumulativa — debito bruto', 'tributo', c.receita_cents, q.cof_nc,
       round(c.receita_cents * q.cof_nc)::bigint, true,
       'receita bruta x 7,6%, ANTES dos creditos do art. 3o',
       'Lei 10.833/2003 art. 2o',
       'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm'),
      (6, 'ISS', 'tributo', c.receita_cents, q.iss_med,
       round(c.receita_cents * q.iss_med)::bigint, true,
       'receita bruta x 5,00% medidos nas NFS-e da propria empresa',
       'LC 116/2003 art. 8o II; evidencia iss_aliquota_declarada_nfse',
       'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm'),
      (7, 'CPP sobre pro-labore', 'encargo', c.pro_labore_cents, q.cpp_pl,
       round(c.pro_labore_cents * q.cpp_pl)::bigint, true,
       'pro-labore pago no mes x 20%',
       'Lei 8.212/1991 art. 22 III',
       'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm'),
      (8, 'CBS + IBS de 2026', 'tributo', c.receita_cents, 0.000000, 0::bigint, true,
       'mesma regra do presumido: compensacao com PIS/Cofins e dispensa de recolhimento no periodo de teste, condicionadas a obrigacao acessoria',
       'LC 214/2025 arts. 343, 346 e 348 I; RFB, Orientacoes 2026 (06/05/2026)',
       'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026')
    ) x(ordem, rubrica, natureza, base_cents, aliquota, valor_cents, no_total, memoria, base_legal, fonte_url)
  UNION ALL
  SELECT c.mes, 'lucro_real', 'real', NULL, x.ordem, x.rubrica, 'lacuna',
         x.base_cents, NULL, NULL, false, true, true, x.memoria, x.base_legal, x.fonte_url, x.motivo
    FROM calc c
    CROSS JOIN LATERAL (VALUES
      (10, 'IRPJ e adicional'::text, NULL::bigint,
       'nao calculado — depende do lucro real, que e o lucro liquido contabil ajustado no LALUR'::text,
       'Lei 9.249/1995 art. 3o e §1o; Decreto-Lei 1.598/1977'::text,
       'https://www.planalto.gov.br/ccivil_03/leis/l9249.htm'::text,
       'Nao existe escrituracao contabil nesta base. O LAIR de fin_dre_mensal_v e gerencial, construido sobre caixa e competencia estimada, e nao suporta adicao, exclusao nem compensacao de prejuizo. Um numero aqui seria invencao com aparencia de exatidao.'::text),
      (11, 'CSLL', NULL,
       'nao calculado — mesma razao do IRPJ',
       'Lei 7.689/1988 art. 3o III e art. 2o',
       'https://www.planalto.gov.br/ccivil_03/leis/l7689.htm',
       'Sem resultado ajustado nao ha base. E o Real e o unico dos tres regimes em que a despesa dedutivel por competencia decide o tributo — a classificacao atual do ledger nao sustenta isso.'),
      (12, 'Creditos de PIS/COFINS', NULL,
       'nao calculado — os debitos brutos de 1,65% e 7,6% NAO sao a contribuicao devida',
       'Leis 10.637/2002 e 10.833/2003, art. 3o',
       'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm',
       'Exige decidir, item a item e por competencia, quais aquisicoes geram credito. Para uma prestadora de servico o credito costuma ser pequeno, mas "costuma" nao e medida: o total do Real fica NULL ate alguem apurar.'),
      (20, 'RAT/FAP e Terceiros', NULL,
       'nao calculado — dependem de CNAE, grau de risco e FPAS',
       'Lei 8.212/1991 art. 22 II',
       'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm',
       'Mesma lacuna do presumido.')
    ) x(ordem, rubrica, base_cents, memoria, base_legal, fonte_url, motivo)
)
SELECT l.mes                                                  AS competencia,
       l.regime,
       l.cenario,
       l.anexo,
       l.ordem,
       l.rubrica,
       l.natureza,
       l.base_cents,
       l.aliquota,
       l.valor_cents,
       l.no_total                                             AS incluido_no_total,
       l.indeterminado,
       l.bloqueia_comparacao,
       l.memoria,
       l.motivo                                               AS motivo_indeterminacao,
       l.base_legal,
       l.fonte_url,
       c.receita_cents                                        AS receita_bruta_cents,
       c.rbt12_cents,
       c.mes_incompleto,
       'Saida gerencial. Nao e apuracao fiscal nem recomendacao de regime: toda decisao depende de validacao do contador.'::text AS ressalva
  FROM linhas l
  JOIN calc c ON c.mes = l.mes;

COMMENT ON VIEW fin_regime_2026_v IS
  'Comparativo mensal de 2026 entre Simples Anexo III, Simples Anexo V, Lucro Presumido e Lucro '
  'Real, linha a linha, sobre a MESMA base (receita bruta por competencia = NFS-e autorizadas). '
  'ISS e CPP aparecem uma unica vez em cada regime: dentro do DAS no Simples (linhas informativas, '
  'fora do total) e como rubrica propria no Presumido e no Real. Lacuna nunca vira zero: rubrica '
  'indeterminada tem bloqueia_comparacao=true e anula o total do regime. Gerencial, sujeita a '
  'validacao do contador.';

-- ==========================================================================
-- 6. O RESUMO — E O ÚNICO NÚMERO QUE PODE SER COMPARADO
-- ==========================================================================

CREATE OR REPLACE VIEW fin_regime_2026_resumo_v AS
SELECT competencia,
       regime,
       cenario,
       anexo,
       max(receita_bruta_cents)::bigint                                 AS receita_bruta_cents,
       max(rbt12_cents)::bigint                                         AS rbt12_cents,
       COALESCE(sum(valor_cents) FILTER (WHERE incluido_no_total), 0)::bigint AS subtotal_calculado_cents,
       CASE WHEN max(receita_bruta_cents) > 0
            THEN round(COALESCE(sum(valor_cents) FILTER (WHERE incluido_no_total), 0)::numeric
                       / max(receita_bruta_cents), 6) END               AS carga_sobre_receita,
       count(*) FILTER (WHERE incluido_no_total AND valor_cents IS NOT NULL)::integer AS rubricas_calculadas,
       count(*) FILTER (WHERE bloqueia_comparacao)::integer             AS lacunas_bloqueantes,
       array_agg(DISTINCT rubrica ORDER BY rubrica) FILTER (WHERE bloqueia_comparacao) AS lacunas,
       NOT bool_or(bloqueia_comparacao)                                 AS comparavel,
       CASE WHEN bool_or(bloqueia_comparacao) THEN NULL
            ELSE COALESCE(sum(valor_cents) FILTER (WHERE incluido_no_total), 0)::bigint END
                                                                        AS total_comparavel_cents,
       bool_or(mes_incompleto)                                          AS mes_incompleto
  FROM fin_regime_2026_v
 GROUP BY competencia, regime, cenario, anexo;

COMMENT ON VIEW fin_regime_2026_resumo_v IS
  'Um numero por regime e competencia. subtotal_calculado_cents soma so o que foi calculado; '
  'total_comparavel_cents e NULL enquanto existir lacuna bloqueante, e HOJE ele e NULL para os '
  'quatro cenarios. Ranking de regime a partir de subtotal e erro: o subtotal do Simples esta '
  'completo e o do Real nao, entao o Simples pareceria vencer por lhe faltarem menos linhas.';

-- ==========================================================================
-- 7. O QUE FALTA, COM O VALOR EM JOGO
-- ==========================================================================
--
-- A pergunta que destrava mais dinheiro por decisão é a 21 do
-- DUVIDAS_FINANCEIRO. Esta view existe para que ela apareça com preço.

CREATE OR REPLACE VIEW fin_regime_indeterminacao_v AS
WITH ref AS (
  SELECT max(rbt12_cents) AS rbt12
    FROM fin_regime_2026_v
   WHERE rbt12_cents IS NOT NULL
),
delta AS (
  SELECT r.rbt12,
         (SELECT (r.rbt12 * p5.aliquota_nominal - p5.parcela_deduzir_cents) / r.rbt12
            FROM fin_tax_regime_param p5
           WHERE p5.regime='simples' AND p5.tributo='DAS' AND p5.anexo='V'
             AND r.rbt12 BETWEEN p5.faixa_de_cents AND p5.faixa_ate_cents)
       - (SELECT (r.rbt12 * p3.aliquota_nominal - p3.parcela_deduzir_cents) / r.rbt12
            FROM fin_tax_regime_param p3
           WHERE p3.regime='simples' AND p3.tributo='DAS' AND p3.anexo='III'
             AND r.rbt12 BETWEEN p3.faixa_de_cents AND p3.faixa_ate_cents) AS pp
    FROM ref r
)
SELECT x.chave, x.pergunta, x.decide, x.valor_em_jogo_cents, x.como_foi_medido, x.quem_responde
  FROM delta d
  CROSS JOIN LATERAL (VALUES
    ('mei_no_fator_r'::text,
     'Em que conta ficam os pagamentos a MEI? Hoje eles estao em 6.01 Salarios, a conta de empregado.'::text,
     (SELECT format('O numerador do Fator R e, por consequencia, o anexo do Simples. Na ultima competencia, base NFS-e: com MEI %s (Anexo III), sem MEI %s (Anexo V). Limiar legal 28%%.',
                    round(max(fator_r) FILTER (WHERE cenario_folha = 'ledger_total'), 4),
                    round(max(fator_r) FILTER (WHERE cenario_folha = 'legal_estrito'), 4))
        FROM fin_fator_r_v
       WHERE base_receita = 'nota_asaas'
         AND competencia = (SELECT max(competencia) FROM fin_fator_r_v))::text,
     round(d.rbt12 * d.pp)::bigint,
     format('diferenca de aliquota efetiva entre Anexo V e Anexo III (%s pontos) aplicada ao RBT12 de R$ %s',
            round(d.pp * 100, 4), to_char(d.rbt12/100.0,'FM999G999G990D00'))::text,
     'Fernando + contador. E a duvida 21 do DUVIDAS_FINANCEIRO.'::text),
    ('folha_2025_ausente',
     'Existem extratos de Inter e Nubank de 2025? A janela do Fator R tem 7 de 12 meses de folha.',
     'Se a folha de ago-dez/25 existir e for da ordem da de 2026, o Fator R sobe e o anexo pode ser III mesmo sem MEI: anualizado, ate a leitura legal estrita passa de 28%.',
     NULL::bigint,
     'nao precificado: depende do valor da folha que falta, que e exatamente o que nao se sabe. Ver duvida 4.',
     'Fernando — e o mesmo bloqueio da duvida 4.'),
    ('cnae_preponderante',
     'Qual o CNAE preponderante da XP ENERGY? Nao existe em lugar nenhum desta base.',
     'Tres coisas ao mesmo tempo: (a) o anexo por atividade — 8299-7/01 (medicao) e 7112-0/00 (engenharia) caem no art. 18 §5o-I VI, Anexo V com Fator R; 4321-5/00 (instalacao e manutencao eletrica) cai no §5o-B IX, Anexo III sempre e sem Fator R; 4322-3/xx ou obra de engenharia cairia no §5o-C I, Anexo IV, com a CPP FORA do DAS; (b) o grau de risco do RAT, 1%, 2% ou 3%; (c) o codigo FPAS e a aliquota de Terceiros.',
     round(d.rbt12 * d.pp)::bigint,
     'mesmo intervalo do MEI quando a duvida e III contra V. Se for Anexo IV o efeito e outro e maior, porque a CPP sai do DAS e vira 20% sobre folha e pro-labore por fora. Os CNAE citados sao CANDIDATOS pela atividade declarada nas NFS-e (17.01 e 14.01) e pela razao social; NENHUM foi verificado no cadastro da Receita.',
     'Fernando ou o contador: basta o cartao CNPJ.'),
    ('segregacao_por_atividade',
     (SELECT format('A empresa segrega a receita por anexo? As NFS-e de 2026 declaram consultoria (item 17.01, R$ %s) e manutencao eletrica (item 14.01, R$ %s).',
                    to_char((SELECT valor_cents FROM fin_regime_evidencia WHERE chave='nfse_servico_consultoria_2026')/100.0, 'FM999G999G990D00'),
                    to_char((SELECT valor_cents FROM fin_regime_evidencia WHERE chave='nfse_servico_manutencao_2026')/100.0, 'FM999G999G990D00')))::text,
     'O art. 18 §4o IV obriga a segregar. Consultoria cai no §5o-I IX (Anexo V com Fator R) e manutencao no §5o-B IX (Anexo III sempre). Se o Fator R ficar abaixo de 28%, os 26,1% de receita de manutencao continuam no Anexo III enquanto o resto vai para o V.',
     NULL::bigint,
     'nao precificado sem saber o anexo do restante: o efeito e a diferenca III/V aplicada apenas a fracao de consultoria.',
     'Contador, com a lista de servicos por nota.'),
    ('receita_sem_categoria',
     'As entradas do Asaas de 2026 sem categoria sao receita de servico?',
     'A faixa do Simples. Somadas ao RBT12 do ledger elas atravessam o teto de R$ 1.800.000,00 da 4a faixa e levam a apuracao para a 5a — o que muda aliquota nominal e parcela a deduzir ao mesmo tempo.',
     (SELECT valor_cents FROM fin_regime_evidencia WHERE chave = 'receita_asaas_sem_categoria_2026'),
     'soma viva dos lancamentos de 2026 com category_id nulo e source=asaas; a evidencia receita_asaas_sem_categoria_2026 guarda a contagem e a data da medicao',
     'Fernando, ou a fila de classificacao.'),
    ('creditos_pis_cofins',
     'Quais aquisicoes geram credito de PIS/COFINS no regime nao cumulativo?',
     'O total do Lucro Real. Sem os creditos so existe o debito bruto de 9,25%, que nao e a contribuicao devida.',
     NULL::bigint,
     'nao precificado: exige decisao item a item por competencia, que a classificacao atual do ledger nao sustenta.',
     'Contador.'),
    ('escrituracao_para_lucro_real',
     'Existe escrituracao contabil e LALUR?',
     'A viabilidade de comparar o Lucro Real. Sem lucro liquido contabil ajustado nao ha IRPJ nem CSLL a calcular, so a suposicao de que o LAIR gerencial serviria — e ele nao serve.',
     NULL::bigint,
     'nao precificado: a ausencia e do dado, nao do valor.',
     'Contador.')
  ) x(chave, pergunta, decide, valor_em_jogo_cents, como_foi_medido, quem_responde);

COMMENT ON VIEW fin_regime_indeterminacao_v IS
  'O que impede fechar a comparacao de regimes, com o valor em jogo quando ele e mensuravel e '
  'NULL — nunca zero — quando nao e. valor_em_jogo_cents NULL significa "nao precificado", e o '
  'campo como_foi_medido diz por que.';

-- ==========================================================================
-- 8. ASSERÇÕES — ESTRUTURAIS, PORQUE A BASE MUDA E O VALOR ENVELHECE
-- ==========================================================================

-- A view é cara (correlated subqueries sobre 13 mil lançamentos). Materializar
-- uma vez e conferir sobre a cópia troca oito varreduras por uma.
CREATE TEMP TABLE _conf_regime ON COMMIT DROP AS SELECT * FROM fin_regime_2026_v;

DO $$
DECLARE
  v_n integer;
  v_txt text;
BEGIN
  -- 8.1 Toda linha calculada carrega dispositivo legal e URL de fonte.
  SELECT count(*) INTO v_n FROM _conf_regime
   WHERE base_legal IS NULL OR fonte_url IS NULL OR btrim(base_legal) = '' OR btrim(fonte_url) = '';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_regime_2026_v: % linha(s) sem base legal ou fonte', v_n;
  END IF;

  -- 8.2 Toda fonte é primária. Blog, calculadora e portal de notícia não passam.
  SELECT string_agg(DISTINCT fonte_url, ', ') INTO v_txt FROM _conf_regime
   WHERE fonte_url !~ '^https://(www\.planalto\.gov\.br|www\.gov\.br|normas\.receita\.fazenda\.gov\.br|www\.in\.gov\.br)/';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'fonte nao primaria em fin_regime_2026_v: %', v_txt;
  END IF;

  -- 8.3 Lacuna nunca tem valor. Se tivesse, alguem somaria.
  SELECT count(*) INTO v_n FROM _conf_regime
   WHERE bloqueia_comparacao AND valor_cents IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_regime_2026_v: % lacuna(s) com valor preenchido', v_n;
  END IF;

  -- 8.4 Lacuna sempre tem motivo escrito.
  SELECT count(*) INTO v_n FROM _conf_regime
   WHERE bloqueia_comparacao AND (motivo_indeterminacao IS NULL OR btrim(motivo_indeterminacao) = '');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_regime_2026_v: % lacuna(s) sem motivo', v_n;
  END IF;

  -- 8.5 ISS e CPP do Simples ficam FORA do total. É a regra que impede cobrar
  --     duas vezes do Simples e é o coração da comparabilidade.
  SELECT count(*) INTO v_n FROM _conf_regime
   WHERE regime = 'simples' AND natureza = 'informativo' AND incluido_no_total;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ISS/CPP embutidos no DAS entraram no total do Simples em % linha(s)', v_n;
  END IF;

  -- 8.5.1 Os quatro cenários existem. Se um sumir, a comparação virou outra
  --       coisa sem ninguém avisar.
  SELECT count(DISTINCT cenario) INTO v_n FROM _conf_regime;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'esperados 4 cenarios de regime, encontrados %', v_n;
  END IF;

  -- 8.6 O Fator R sai nos dois cenários exigidos, e em nenhum deles o rótulo
  --     de qualidade mente sobre a cobertura da janela.
  SELECT count(*) INTO v_n FROM fin_fator_r_v
   WHERE cenario_folha IN ('ledger_total', 'legal_estrito')
     AND base_receita = 'nota_asaas'
     AND competencia = (SELECT max(competencia) FROM fin_fator_r_v);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Fator R nao saiu nos dois cenarios exigidos: % linha(s)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM fin_fator_r_v
   WHERE janela_completa <> (meses_com_folha = 12) OR qualidade NOT IN ('medido', 'parcial');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fin_fator_r_v: % linha(s) com rotulo de qualidade incoerente', v_n;
  END IF;

  -- 8.7 Nenhum regime pode declarar total comparável enquanto houver lacuna.
  SELECT count(*) INTO v_n FROM fin_regime_2026_resumo_v
   WHERE total_comparavel_cents IS NOT NULL AND lacunas_bloqueantes > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'total comparavel preenchido com lacuna aberta em % linha(s)', v_n;
  END IF;

  -- 8.8 A reconciliação do DAS precisa achar competências; se não achar, algo
  --     mudou na categoria 7.01 ou no valor do DAS-MEI e o resto é fantasia.
  SELECT count(*) INTO v_n FROM fin_das_reconciliacao_v WHERE das_empresa_cents > 0;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'fin_das_reconciliacao_v nao encontrou nenhuma competencia com DAS da empresa';
  END IF;

  -- 8.9 Evidência indeterminada não carrega valor (o CHECK já garante, mas o
  --     CNAE especificamente precisa continuar vazio: é a linha que alguem
  --     vai querer preencher com um palpite).
  IF EXISTS (SELECT 1 FROM fin_regime_evidencia
              WHERE chave = 'cnae_preponderante'
                AND (confianca <> 'indeterminada' OR valor_numerico IS NOT NULL)) THEN
    RAISE EXCEPTION 'CNAE preponderante foi preenchido sem evidencia de cadastro';
  END IF;
END $$;
