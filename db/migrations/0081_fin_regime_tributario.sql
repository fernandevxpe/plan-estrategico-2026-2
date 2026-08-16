-- Regime tributário: a tabela vigente com fonte, e a comparação dos três
-- regimes com a memória de cálculo linha a linha.
--
-- ===========================================================================
-- 0. O QUE ESTA MIGRATION FECHA — E O QUE ELA AINDA DEIXA ABERTO
-- ===========================================================================
-- A 0065 escreveu, por extenso, os três motivos pelos quais não calculava o
-- imposto devido:
--
--   (1) RBT12 não fechava        → RESOLVIDO. `rbt12_completo = true` nos 12
--                                  meses de set/25 a ago/26.
--   (2) Fator R sem folha        → DESTRAVADO pela 0077, mas PARCIAL. Ver §4.
--   (3) tabela vigente sem fonte → É O QUE ESTA MIGRATION ENTREGA.
--
-- O item (3) vira dado: `fin_tax_regime_param` guarda cada alíquota, faixa,
-- parcela a deduzir, presunção e limiar com **URL, dispositivo legal, data de
-- consulta e vigência**. Nada de alíquota em literal dentro de view — se a lei
-- mudar, muda a linha na tabela, e a view acompanha.
--
-- O item (2) NÃO fecha aqui, e a migration diz isso em vez de esconder: a folha
-- do ledger começa em dez/2025, então uma janela legal de 12 meses tem NOVE
-- meses de numerador contra DOZE de denominador. Todo Fator R calculado a
-- partir do ledger é, por construção, subestimado. A view devolve o número e
-- devolve a etiqueta `fator_r_parcial = true` junto — nunca um sem o outro.
--
-- ---------------------------------------------------------------------------
-- 0.1 O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
--   a) NÃO reclassifica os MEIs. Os R$ 275.921,66 pagos a MEI dentro de 6.01
--      "Salários" continuam exatamente onde estão. A decisão é do Fernando
--      (dúvida 21, e agora 32). Aqui a view apenas SEPARA os dois cenários e
--      mostra o que a separação custa.
--   b) NÃO escreve em fin_transaction, fin_document nem fin_category.
--   c) NÃO decide o anexo. Prova o que é possível provar com o dado medido,
--      e marca o resto como indeterminado com o valor em jogo.
--   d) NÃO substitui contador. Toda saída desta view é gerencial.
--
-- ===========================================================================
-- 1. A DIVERGÊNCIA DA CARGA — MEDIDA, NÃO AJUSTADA
-- ===========================================================================
-- A carga implícita que a 0065 publica é 9,17% (R$ 123.842,07 de imposto sobre
-- R$ 1.350.225,21 de receita, jan–ago/26). A alíquota efetiva do Anexo III para
-- um RBT12 de R$ 1,85 M é 14,21%. A diferença é grande demais para ser erro de
-- arredondamento, e a instrução foi investigar a base em vez de ajustar a
-- conta. Investigada, a diferença é inteira de composição — três causas, todas
-- medidas:
--
-- CAUSA 1 — 34 dos 42 "pagamentos de imposto" NÃO SÃO IMPOSTO DA EMPRESA.
--   São DAS-MEI de terceiros, pagos pela XPE, de R$ 86,05 cada.
--   R$ 86,05 = 5% × R$ 1.621,00 (INSS do MEI) + R$ 5,00 (ISS do MEI).
--   R$ 1.621,00 é o salário mínimo de 2026 — Decreto 12.797/2025. A conta
--   fecha no centavo, e o valor se repete 34 vezes: 4× em fev, 5×/mês de mar
--   a ago. Total R$ 2.925,70, hoje dentro da categoria 7.01 (Simples Nacional).
--   É custo de pessoal terceirizado, não tributo da XPE.
--
-- CAUSA 2 — O NUMERADOR TEM 7 MESES E O DENOMINADOR TEM 8.
--   Agosto/26 não tem DAS da empresa: o único lançamento de imposto do mês são
--   5× R$ 86,05 de MEI. O DAS de competência jul/26 vence em ago/26 e ainda não
--   saiu. Dividir 7 meses de imposto por 8 meses de receita puxa a carga para
--   baixo mecanicamente.
--
-- CAUSA 3 — A BASE ERRADA. O DAS incide sobre receita AUFERIDA (nota emitida),
--   e `receita_ledger` é receita RECEBIDA (caixa). Em jan–ago/26 as duas
--   diferem em R$ 236.330,11 — o ledger é 21% maior. Dividir imposto de
--   competência por receita de caixa compara períodos diferentes.
--
-- ---------------------------------------------------------------------------
-- 1.1 A RECONCILIAÇÃO, COM OS TRÊS AJUSTES APLICADOS
-- ---------------------------------------------------------------------------
--   DAS pago jan–jul/26, só a empresa ........... R$ 120.916,37
--     menos ISS avulso de fev/26 (categoria 7.02)  R$     558,29
--     = DAS do Simples, competências dez/25–jun/26 R$ 120.358,08
--   Base de NOTAS das mesmas competências ....... R$ 877.874,63
--   ------------------------------------------------------------------
--   CARGA EFETIVA MEDIDA ........................ 13,71%
--   Anexo III previsto para a mesma base ........ 13,30%  (R$ 116.778,80)
--   Anexo V previsto para a mesma base .......... 19,21%  (R$ 168.602,14)
--
-- O resíduo contra o Anexo III é de R$ 3.579,28 (+3,07%) e tem explicação
-- conhecida: o RBT12 usado aqui é o do ledger (caixa), enquanto o RBT12 real da
-- apuração é o de notas. O resíduo contra o Anexo V seria de −28,6% — ordem de
-- grandeza inteiramente fora.
--
--   >>> CONCLUSÃO MEDIDA: a XPE está sendo tributada HOJE pelo ANEXO III.
--   >>> Não é premissa desta migration; é o que a série de pagamentos mostra.
--
-- Isso importa para o item 2 da lista da 0065: o Fator R **declarado ao Fisco**
-- já vem passando de 28%, com a folha real (eSocial/GFIP), que não é a mesma
-- coisa que a folha do ledger. O ledger é que está incompleto — não a apuração.
--
-- ===========================================================================
-- 2. QUAL ANEXO A LEI MANDA USAR — E POR QUE O FATOR R DECIDE TUDO
-- ===========================================================================
-- Não é escolha da empresa. Depende da atividade, e a atividade está nas notas:
--
--   17.01 "Assessoria ou consultoria de qualquer natureza"  R$ 823.075,10  73%
--   14.01 "Manutenção Elétrica" (centros de medição)        R$ 290.820,00  26%
--
-- LC 123/2006, art. 18, § 5º-I (redação da LC 155/2016), lista as atividades
-- tributadas pelo ANEXO V. Duas de seus incisos pegam a XPE de frente:
--
--   inciso VI  — "engenharia, MEDIÇÃO, cartografia, topografia, geologia,
--                 geodésia, TESTES, SUPORTE E ANÁLISES TÉCNICAS E
--                 TECNOLÓGICAS, pesquisa, design, desenho e agronomia"
--   inciso IX  — "auditoria, economia, CONSULTORIA, gestão, organização,
--                 controle e administração"
--
-- A razão social é "XP ENERGY SERVIÇOS DE MEDIÇÃO DE ENERGIA LTDA" e 73% do
-- faturamento sai sob código municipal de consultoria. As duas âncoras caem
-- em § 5º-I.
--
-- E aí entra o § 5º-J: as atividades do § 5º-I "serão tributadas na forma do
-- Anexo III caso a razão entre a folha de salários e a receita bruta seja igual
-- ou superior a 28%". O § 5º-M diz o inverso — abaixo de 28%, Anexo V.
--
--   >>> Para esta empresa, o Fator R não é um detalhe de otimização.
--   >>> Ele é o que separa 14,21% de 19,64%. Ver §4.
--
-- ===========================================================================
-- 3. O QUE CONTA COMO FOLHA — E POR QUE MEI NÃO CONTA
-- ===========================================================================
-- LC 123/2006, art. 18, § 24 (redação da LC 155/2016), é explícito:
--
--   "considera-se folha de salários, incluídos encargos, o montante pago, nos
--    doze meses anteriores ao período de apuração, a título de remunerações a
--    PESSOAS FÍSICAS decorrentes do trabalho, acrescido do montante
--    efetivamente recolhido a título de contribuição patronal previdenciária e
--    FGTS, incluídas as retiradas de pró-labore."
--
-- E o § 25 fecha a porta: "deverão ser consideradas TÃO SOMENTE as remunerações
-- informadas na forma prevista no inciso IV do caput do art. 32 da Lei nº
-- 8.212/1991" — isto é, o que foi declarado em GFIP/eSocial.
--
-- MEI é pessoa jurídica, com CNPJ próprio. Pagamento a MEI é serviço tomado de
-- PJ, não é "remuneração a pessoa física decorrente do trabalho", e não é
-- informado como remuneração no eSocial. Os dois testes do § 24 e do § 25
-- falham. **MEI não entra no Fator R** — e isso não é interpretação, é o texto.
--
-- O ledger, porém, tem R$ 275.921,66 pagos a 11 MEIs dentro de 6.01 "Salários"
-- (197 lançamentos, jan–ago/26). Confirmação cruzada de que são MEI de verdade:
-- a XPE paga o DAS-MEI de R$ 86,05 deles todo mês (§1, causa 1). A conta 6.01
-- é 89% MEI: de R$ 308.816,46 no ano, só R$ 32.894,80 são salário de fato.
--
-- ===========================================================================
-- 4. O FATOR R NOS DOIS CENÁRIOS — E POR QUE AS DUAS JANELAS BRIGAM
-- ===========================================================================
-- JANELA LEGAL (12 meses anteriores, art. 18 § 5º-K), apuração de ago/26,
-- com a folha que EXISTE no ledger (dez/25 em diante — 9 meses de 12):
--
--   RBT12 ......................... R$ 1.849.940,08
--   folha 12m COM MEI ............. R$   594.966,37  → Fator R 31,61% → ANEXO III
--   folha 12m SEM MEI ............. R$   357.342,94  → Fator R 18,99% → ANEXO V
--
-- JANELA COMPARÁVEL (jan–ago/26 nos DOIS lados — mesmos 8 meses em cima e
-- embaixo, que é a única forma de não comparar 9 meses com 12):
--
--   receita caixa 8m .............. R$ 1.350.225,21
--   folha 8m COM MEI .............. R$   699.466,10  → Fator R 51,80% → ANEXO III
--   folha 8m SEM MEI .............. R$   422.244,44  → Fator R 31,27% → ANEXO III
--
--   >>> AS DUAS JANELAS DÃO RESPOSTAS OPOSTAS NO CENÁRIO SEM MEI.
--
-- A janela legal diz Anexo V; a comparável diz Anexo III. A diferença inteira é
-- o buraco de folha de set/25 a nov/25 — meses em que a empresa comprovadamente
-- pagou gente (havia receita de R$ 356 mil no período) e o ledger não tem um
-- centavo de folha. Não é que a folha era zero: é que ela não foi importada.
--
-- O desempate NÃO vem do ledger, vem do §1: a carga efetivamente paga (13,71%)
-- bate com Anexo III e não com Anexo V. Ou seja, a folha REAL declarada já
-- passa de 28% sem MEI. O ledger é que está incompleto.
--
--   >>> RESPOSTA À PERGUNTA "o MEI muda o anexo?":
--   >>> Com o dado do ledger, MUDA (III → V). Com a folha real declarada,
--   >>> pelo que a carga paga demonstra, NÃO MUDA — mas a margem é fina.
--
-- QUANTO CUSTA ERRAR, medido sobre o RBT12 de ago/26:
--   Anexo III efetiva 14,208%  ·  Anexo V efetiva 19,643%  ·  Δ 5,435 p.p.
--   >>> R$ 100.538,80 por ano de imposto a mais se cair no Anexo V.
--
-- MARGEM DE SEGURANÇA (janela comparável, sem MEI): a folha é 31,27% contra o
-- piso de 28%. Sobra R$ 44.181,38 de folha em 8 meses. Uma queda de folha maior
-- que isso — ou um crescimento de receita de ~12% sem folha nova — cruza o piso.
--
-- ===========================================================================
-- 5. A COMPARAÇÃO DOS TRÊS REGIMES (jan–ago/26, base de notas R$ 1.113.895,10)
-- ===========================================================================
--   SIMPLES Anexo III .... R$ 158.266,99   14,21%   ← regime atual
--   SIMPLES Anexo V ...... R$ 218.803,91   19,64%
--   LUCRO PRESUMIDO ...... R$ 285.814,22   25,66%
--   LUCRO REAL ........... R$ 286.603,29   25,73%   (sem créditos — ver §5.1)
--
-- O que faz Presumido e Real dobrarem não é IRPJ nem PIS/COFINS: é a CPP. No
-- Simples, a contribuição patronal está DENTRO do DAS (a coluna CPP da
-- repartição do Anexo III é 43,40%). Fora do Simples ela reaparece por cima,
-- a 20% sobre pró-labore (Lei 8.212/1991 art. 22 III) — e a XPE tem
-- R$ 362.471,08 de pró-labore em 8 meses. Só isso são R$ 72.494,21 novos.
--
-- ---------------------------------------------------------------------------
-- 5.1 A INCERTEZA DO LUCRO REAL, DECLARADA EM VEZ DE ARREDONDADA
-- ---------------------------------------------------------------------------
-- A instrução era clara: Lucro Real exige despesa dedutível classificada por
-- competência, e se a classificação não sustenta, o cenário sai com a incerteza
-- na frente. Ela não sustenta inteira. O que falta:
--
--   · CRÉDITO DE PIS/COFINS não-cumulativo não foi apurado. Exigiria decidir,
--     item a item, o que é insumo na acepção do art. 3º das Leis 10.637/2002 e
--     10.833/2003. Teto plausível se TUDO gerasse crédito: R$ 28.338,95 sobre
--     custos diretos + despesas administrativas. Mesmo no teto, o Real segue
--     acima do Simples por larga margem — a conclusão não vira.
--   · O LAIR de R$ 259.572,70 sai de `fin_dre_mensal_v` visão competência, que
--     tem `lacuna_ledger_cents` de −R$ 12.378,80 no período.
--   · Adições e exclusões do LALUR não existem na base.
--
-- Por isso o Real entra na view com `confianca = 'baixa'`, e os outros dois com
-- 'media' (a base de receita ainda diverge em R$ 236 mil entre caixa e nota).
--
-- ===========================================================================
-- 6. FONTES — todas primárias, consultadas em 16/08/2026
-- ===========================================================================
--   LC 123/2006 (Anexos III e V, art. 18 §§ 1º-A, 5º-I, 5º-J, 5º-K, 5º-M, 24, 25)
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
--   LC 116/2003 (ISS: art. 8º II = 5% máx; art. 8º-A = 2% mín)
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm
--   Lei 9.249/1995 (art. 3º IRPJ 15% + adicional 10%; art. 15 §1º III presunção
--     32%; art. 20 presunção CSLL 32%)
--     https://www.planalto.gov.br/ccivil_03/leis/L9249.htm
--   Lei 7.689/1988 art. 3º III (CSLL 9%, redação da Lei 13.169/2015)
--     https://www.planalto.gov.br/ccivil_03/leis/L7689.htm
--   Lei 9.715/1998 art. 8º I (PIS cumulativo 0,65%)
--     https://www.planalto.gov.br/ccivil_03/leis/L9715.htm
--   Lei 9.718/1998 art. 8º (COFINS cumulativa 3%)
--     https://www.planalto.gov.br/ccivil_03/leis/L9718compilada.htm
--   Lei 10.637/2002 art. 2º (PIS não-cumulativo 1,65%)
--     https://www.planalto.gov.br/ccivil_03/leis/2002/L10637compilado.htm
--   Lei 10.833/2003 art. 2º (COFINS não-cumulativa 7,6%)
--     https://www.planalto.gov.br/ccivil_03/leis/2003/L10.833compilado.htm
--   Lei 8.212/1991 art. 22 I (CPP 20% empregados), II (RAT 1/2/3%), III (CPP
--     20% contribuinte individual — pró-labore)
--     https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm
--   Lei 8.036/1990 art. 15 (FGTS 8%)
--     https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm
--   Decreto 12.797/2025 (salário mínimo 2026 = R$ 1.621,00)
--     https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm
--   LC 214/2025 arts. 343, 346 e 348 (CBS 0,9% e IBS 0,1% em 2026; compensação
--     com PIS/COFINS; dispensa de recolhimento a quem cumpre a obrigação
--     acessória; NÃO se aplica a optante do Simples — art. 348 III "c")
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm
--
-- VIGÊNCIA CONFERIDA: os Anexos III e V estão na redação da LC 155/2016, com
-- vigência declarada no próprio anexo a partir de 01/01/2018, e SEM alteração
-- de faixa, alíquota ou parcela a deduzir até 16/08/2026. A LC 214/2025 e a LC
-- 227/2026 alteram a LC 123/2006, mas para o Simples os efeitos são, em regra,
-- a partir de 01/01/2027 (Resolução CGSN nº 190/2026 — Receita Federal,
-- https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/
-- cgsn-atualiza-regras-do-simples-nacional-para-adequacao-a-reforma-tributaria-do-consumo).
-- Conferido linha a linha no texto compilado da LC 227/2026: ela não toca
-- Anexo III, Anexo V, § 5º-J, § 5º-M nem o limiar de 28%.

-- ===========================================================================
-- 7. O PARÂMETRO COMO DADO
-- ===========================================================================

CREATE TABLE IF NOT EXISTS fin_tax_regime_param (
  id                     bigserial PRIMARY KEY,
  regime                 text        NOT NULL,
  tributo                text        NOT NULL,
  anexo                  text,
  faixa                  smallint,
  faixa_de_cents         bigint,
  faixa_ate_cents        bigint,
  aliquota_nominal       numeric(9,6),
  parcela_deduzir_cents  bigint      NOT NULL DEFAULT 0,
  base_calculo           text,
  base_legal             text        NOT NULL,
  fonte_url              text        NOT NULL,
  consultado_em          date        NOT NULL,
  vigencia_de            date        NOT NULL,
  vigencia_ate           date,
  indeterminado          boolean     NOT NULL DEFAULT false,
  observacao             text,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_tax_regime_param_regime_ck
    CHECK (regime IN ('simples', 'presumido', 'real', 'comum')),
  CONSTRAINT fin_tax_regime_param_faixa_ck
    CHECK (faixa_de_cents IS NULL OR faixa_ate_cents IS NULL OR faixa_ate_cents > faixa_de_cents),
  CONSTRAINT fin_tax_regime_param_vigencia_ck
    CHECK (vigencia_ate IS NULL OR vigencia_ate >= vigencia_de),
  -- Um parâmetro só pode existir sem alíquota se for declaradamente
  -- indeterminado. Isso impede exatamente o buraco silencioso: linha criada
  -- "para preencher depois" que vira zero em cálculo.
  CONSTRAINT fin_tax_regime_param_aliquota_ck
    CHECK (aliquota_nominal IS NOT NULL OR indeterminado)
);

COMMENT ON TABLE fin_tax_regime_param IS
  'Parâmetro tributário vigente com procedência. Cada linha carrega dispositivo legal, URL da '
  'fonte primária, data de consulta e vigência. Nenhuma alíquota pode ser usada em cálculo sem '
  'estar aqui — view que precisa de alíquota lê desta tabela, nunca de literal.';
COMMENT ON COLUMN fin_tax_regime_param.aliquota_nominal IS
  'Fração, não percentual: 0,06 = 6%. Nulo só é permitido quando indeterminado = true.';
COMMENT ON COLUMN fin_tax_regime_param.indeterminado IS
  'true = o valor depende de informação que a empresa ainda não declarou (CNAE, FPAS, município). '
  'A view devolve a linha assim mesmo, marcada, em vez de arbitrar um número.';

CREATE UNIQUE INDEX IF NOT EXISTS fin_tax_regime_param_uq
  ON fin_tax_regime_param (regime, tributo, coalesce(anexo, ''), coalesce(faixa, 0), vigencia_de);

-- ---------------------------------------------------------------------------
-- 7.1 SIMPLES NACIONAL — ANEXO III
--     LC 123/2006, Anexo III, redação da LC 155/2016, vigência 01/01/2018.
--     Transcrito do texto compilado do Planalto, faixa a faixa.
-- ---------------------------------------------------------------------------
INSERT INTO fin_tax_regime_param
  (regime, tributo, anexo, faixa, faixa_de_cents, faixa_ate_cents, aliquota_nominal,
   parcela_deduzir_cents, base_calculo, base_legal, fonte_url, consultado_em, vigencia_de)
VALUES
  ('simples','DAS','III',1,          0,  18000000, 0.060000,        0,'rbt12','LC 123/2006, Anexo III, 1a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',2,   18000001,  36000000, 0.112000,   936000,'rbt12','LC 123/2006, Anexo III, 2a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',3,   36000001,  72000000, 0.135000,  1764000,'rbt12','LC 123/2006, Anexo III, 3a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',4,   72000001, 180000000, 0.160000,  3564000,'rbt12','LC 123/2006, Anexo III, 4a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',5,  180000001, 360000000, 0.210000, 12564000,'rbt12','LC 123/2006, Anexo III, 5a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',6,  360000001, 480000000, 0.330000, 64800000,'rbt12','LC 123/2006, Anexo III, 6a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
-- ---------------------------------------------------------------------------
-- 7.2 SIMPLES NACIONAL — ANEXO V
-- ---------------------------------------------------------------------------
  ('simples','DAS','V',1,            0,  18000000, 0.155000,        0,'rbt12','LC 123/2006, Anexo V, 1a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',2,     18000001,  36000000, 0.180000,   450000,'rbt12','LC 123/2006, Anexo V, 2a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',3,     36000001,  72000000, 0.195000,   990000,'rbt12','LC 123/2006, Anexo V, 3a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',4,     72000001, 180000000, 0.205000,  1710000,'rbt12','LC 123/2006, Anexo V, 4a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',5,    180000001, 360000000, 0.230000,  6210000,'rbt12','LC 123/2006, Anexo V, 5a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',6,    360000001, 480000000, 0.305000, 54000000,'rbt12','LC 123/2006, Anexo V, 6a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
-- ---------------------------------------------------------------------------
-- 7.3 O LIMIAR DO FATOR R
-- ---------------------------------------------------------------------------
  ('simples','FATOR_R',NULL,NULL,NULL,NULL, 0.280000, 0,'folha_sobre_receita_12m',
   'LC 123/2006 art. 18 §5o-J (Anexo III se >= 28%) e §5o-M (Anexo V se < 28%); §5o-K define a janela de 12 meses; §24 define folha (pessoas fisicas + pro-labore + CPP/FGTS recolhidos); §25 restringe ao declarado em GFIP/eSocial',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
-- ---------------------------------------------------------------------------
-- 7.4 LUCRO PRESUMIDO
-- ---------------------------------------------------------------------------
  ('presumido','PRESUNCAO_IRPJ',NULL,NULL,NULL,NULL, 0.320000, 0,'receita_bruta','Lei 9.249/1995 art. 15 §1o III "a" — prestacao de servicos em geral','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1996-01-01'),
  ('presumido','PRESUNCAO_CSLL',NULL,NULL,NULL,NULL, 0.320000, 0,'receita_bruta','Lei 9.249/1995 art. 20 (red. Lei 10.684/2003) — atividades do art. 15 §1o III','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','2003-01-01'),
  ('presumido','IRPJ',NULL,NULL,NULL,NULL,           0.150000, 0,'lucro_presumido','Lei 9.249/1995 art. 3o','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1996-01-01'),
  ('presumido','IRPJ_ADICIONAL',NULL,NULL,NULL,NULL, 0.100000, 0,'lucro_presumido_excedente','Lei 9.249/1995 art. 3o §1o (red. Lei 9.430/1996) — 10% sobre o que exceder R$ 20.000,00 x meses do periodo','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1997-01-01'),
  ('presumido','CSLL',NULL,NULL,NULL,NULL,           0.090000, 0,'lucro_presumido','Lei 7.689/1988 art. 3o III (red. Lei 13.169/2015) — demais pessoas juridicas','https://www.planalto.gov.br/ccivil_03/leis/L7689.htm','2026-08-16','2015-09-01'),
  ('presumido','PIS',NULL,NULL,NULL,NULL,            0.006500, 0,'receita_bruta','Lei 9.715/1998 art. 8o I — regime cumulativo','https://www.planalto.gov.br/ccivil_03/leis/L9715.htm','2026-08-16','1998-11-01'),
  ('presumido','COFINS',NULL,NULL,NULL,NULL,         0.030000, 0,'receita_bruta','Lei 9.718/1998 art. 8o — regime cumulativo','https://www.planalto.gov.br/ccivil_03/leis/L9718compilada.htm','2026-08-16','1999-02-01'),
-- ---------------------------------------------------------------------------
-- 7.5 LUCRO REAL
-- ---------------------------------------------------------------------------
  ('real','IRPJ',NULL,NULL,NULL,NULL,           0.150000, 0,'lucro_real','Lei 9.249/1995 art. 3o','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1996-01-01'),
  ('real','IRPJ_ADICIONAL',NULL,NULL,NULL,NULL, 0.100000, 0,'lucro_real_excedente','Lei 9.249/1995 art. 3o §1o (red. Lei 9.430/1996)','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1997-01-01'),
  ('real','CSLL',NULL,NULL,NULL,NULL,           0.090000, 0,'lucro_real','Lei 7.689/1988 art. 3o III (red. Lei 13.169/2015)','https://www.planalto.gov.br/ccivil_03/leis/L7689.htm','2026-08-16','2015-09-01'),
  ('real','PIS',NULL,NULL,NULL,NULL,            0.016500, 0,'receita_bruta','Lei 10.637/2002 art. 2o — regime nao-cumulativo (creditos do art. 3o NAO apurados nesta base)','https://www.planalto.gov.br/ccivil_03/leis/2002/L10637compilado.htm','2026-08-16','2002-12-01'),
  ('real','COFINS',NULL,NULL,NULL,NULL,         0.076000, 0,'receita_bruta','Lei 10.833/2003 art. 2o — regime nao-cumulativo (creditos do art. 3o NAO apurados nesta base)','https://www.planalto.gov.br/ccivil_03/leis/2003/L10.833compilado.htm','2026-08-16','2004-02-01'),
-- ---------------------------------------------------------------------------
-- 7.6 COMUNS A PRESUMIDO E REAL — o que sai de dentro do DAS e reaparece
-- ---------------------------------------------------------------------------
  ('comum','CPP_EMPREGADO',NULL,NULL,NULL,NULL, 0.200000, 0,'folha_empregados','Lei 8.212/1991 art. 22 I','https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1991-07-25'),
  ('comum','CPP_PRO_LABORE',NULL,NULL,NULL,NULL,0.200000, 0,'pro_labore','Lei 8.212/1991 art. 22 III (red. Lei 9.876/1999) — contribuinte individual','https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1999-11-26'),
  ('comum','FGTS',NULL,NULL,NULL,NULL,          0.080000, 0,'folha_empregados','Lei 8.036/1990 art. 15','https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm','2026-08-16','1990-05-11'),
  ('comum','SALARIO_MINIMO',NULL,NULL,NULL,NULL,NULL, 162100,'valor_absoluto','Decreto 12.797/2025 — salario minimo de 2026 = R$ 1.621,00. Guardado em parcela_deduzir_cents por ser valor absoluto, nao aliquota. Base do DAS-MEI de R$ 86,05 (5% + R$ 5,00 de ISS).','https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm','2026-08-16','2026-01-01'),
-- ---------------------------------------------------------------------------
-- 7.7 REFORMA TRIBUTARIA — 2026 e a razao pela qual ela nao entra na conta
-- ---------------------------------------------------------------------------
--   Em 2026 a CBS (0,9%) e o IBS (0,1%) existem, mas: (a) nao se aplicam a
--   optante do Simples (LC 214/2025 art. 348 III "c"); (b) para quem esta fora
--   do Simples, o recolhido e compensado com PIS/COFINS do mesmo periodo (art.
--   348 I); e (c) fica DISPENSADO o recolhimento de quem cumpre as obrigacoes
--   acessorias (art. 348 §1o). Efeito liquido em 2026 nos tres cenarios: zero.
  ('comum','CBS',NULL,NULL,NULL,NULL,           0.009000, 0,'receita_bruta','LC 214/2025 art. 346 — 2026; art. 348 I compensa com PIS/COFINS, §1o dispensa quem cumpre obrigacao acessoria, III "c" exclui optante do Simples','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm','2026-08-16','2026-01-01'),
  ('comum','IBS',NULL,NULL,NULL,NULL,           0.001000, 0,'receita_bruta','LC 214/2025 art. 343 — 2026 (aliquota estadual); mesmas regras de compensacao e dispensa do art. 348','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm','2026-08-16','2026-01-01');

-- ---------------------------------------------------------------------------
-- 7.8 O QUE NAO TEM FONTE PORQUE DEPENDE DE DADO QUE A EMPRESA NAO DECLAROU
--     Estas linhas entram com indeterminado = true e aliquota nula. A view as
--     devolve marcadas. Preencher exige decisao do Fernando, nao pesquisa.
-- ---------------------------------------------------------------------------
INSERT INTO fin_tax_regime_param
  (regime, tributo, aliquota_nominal, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, indeterminado, observacao)
VALUES
  ('comum','RAT', NULL,'folha_empregados',
   'Lei 8.212/1991 art. 22 II "a"/"b"/"c" — 1%, 2% ou 3% conforme o risco da ATIVIDADE PREPONDERANTE',
   'https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1998-12-11', true,
   'Depende do CNAE preponderante, que nao existe no cadastro (fin_entity nao tem coluna de CNAE). Faixa 1%-3%. Impacto medido sobre a folha CLT de R$ 32.894,80 (jan-ago/26): R$ 328,95 a R$ 986,84 — pequeno hoje SO porque quase toda a folha e pro-labore e MEI. Se a folha CLT crescer, cresce junto.'),
  ('comum','TERCEIROS', NULL,'folha_empregados',
   'Contribuicoes a terceiros (salario-educacao, INCRA, SENAI/SENAC, SESI/SESC, SEBRAE) — o percentual sai do codigo FPAS da atividade, nao de artigo unico de lei',
   'https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1991-07-25', true,
   'NAO preenchido de memoria de proposito. O percentual usual para servicos e 5,8%, mas depende do FPAS, que depende do CNAE. Sobre a folha CLT medida, cada 1 p.p. vale R$ 328,95 em 8 meses.'),
  ('comum','ISS', NULL,'receita_bruta',
   'LC 116/2003 art. 8o II (aliquota maxima 5%) e art. 8o-A (minima 2%, incluido pela LC 157/2016). A aliquota concreta e lei municipal.',
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm','2026-08-16','2003-08-01', true,
   'As 480 notas autorizadas de 2026 destacam ISS entre 4,76% e 5,00% (media ponderada 4,98%), o que indica municipio com aliquota de 5% para os itens 17.01 e 14.01. Fica indeterminado porque a lei municipal nao foi lida — so a nota. No Simples o ISS ja esta dentro do DAS; a linha so pesa em Presumido e Real, onde vale ~R$ 55.694,75 em 8 meses.');

-- ===========================================================================
-- 8. A COMPARAÇÃO, MÊS A MÊS, COM A MEMÓRIA DE CÁLCULO LINHA A LINHA
-- ===========================================================================
-- Uma linha por (mês, regime, rubrica). Quem lê consegue refazer a conta na
-- mão: `formula` diz o que foi feito, `base_cents` sobre o quê, `aliquota` com
-- qual número, e `fonte_url` de onde veio o número.

CREATE OR REPLACE VIEW fin_regime_comparativo_v AS
WITH
-- receita AUFERIDA (nota) — a base legal do tributo
nota AS (
  SELECT date_trunc('month', issue_date)::date AS mes, sum(service_amount_cents) AS cents
    FROM fin_fiscal_document WHERE status = 'AUTHORIZED' GROUP BY 1
),
-- receita RECEBIDA (caixa) — a que o ledger enxerga
caixa AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes, sum(t.amount_cents) AS cents
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents > 0 AND c.cash_flow_group IN ('receita-servicos','receita-recorrente')
   GROUP BY 1
),
-- quem é MEI: pessoa listada em fin_folha_mei_v, pelas contrapartes dela
mei_cp AS (
  SELECT DISTINCT pc.counterparty_id
    FROM fin_person_counterparty pc
   WHERE pc.person_id IN (SELECT person_id FROM fin_folha_mei_v)
),
folha AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         sum(abs(t.amount_cents))                                              AS total_cents,
         sum(abs(t.amount_cents)) FILTER (WHERE t.counterparty_id IN (SELECT counterparty_id FROM mei_cp)) AS mei_cents,
         sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.02')               AS pro_labore_cents,
         sum(abs(t.amount_cents)) FILTER (
           WHERE c.code = '6.01'
             AND (t.counterparty_id IS NULL OR t.counterparty_id NOT IN (SELECT counterparty_id FROM mei_cp))
         )                                                                     AS salario_clt_cents
    FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0 AND c.cash_flow_group = 'pessoal'
   GROUP BY 1
),
meses AS (SELECT mes FROM nota UNION SELECT mes FROM caixa),
base AS (
  SELECT m.mes,
         COALESCE(n.cents, 0) AS receita_nota_cents,
         COALESCE(k.cents, 0) AS receita_caixa_cents,
         COALESCE(f.total_cents, 0)      AS folha_total_cents,
         COALESCE(f.mei_cents, 0)        AS folha_mei_cents,
         COALESCE(f.pro_labore_cents, 0) AS pro_labore_cents,
         COALESCE(f.salario_clt_cents, 0) AS salario_clt_cents,
         -- RBT12: 12 meses ANTERIORES ao periodo de apuracao (art. 18 §1o)
         (SELECT sum(k2.cents) FROM caixa k2
           WHERE k2.mes < m.mes AND k2.mes >= m.mes - INTERVAL '12 months')  AS rbt12_cents,
         (SELECT count(*) FROM caixa k3
           WHERE k3.mes < m.mes AND k3.mes >= m.mes - INTERVAL '12 months')  AS rbt12_meses,
         -- folha dos mesmos 12 meses, com e sem MEI (art. 18 §5o-K)
         (SELECT COALESCE(sum(f2.total_cents), 0) FROM folha f2
           WHERE f2.mes < m.mes AND f2.mes >= m.mes - INTERVAL '12 months')  AS folha12_com_mei_cents,
         (SELECT COALESCE(sum(f3.total_cents - COALESCE(f3.mei_cents,0)), 0) FROM folha f3
           WHERE f3.mes < m.mes AND f3.mes >= m.mes - INTERVAL '12 months')  AS folha12_sem_mei_cents,
         (SELECT count(*) FROM folha f4
           WHERE f4.mes < m.mes AND f4.mes >= m.mes - INTERVAL '12 months')  AS folha12_meses
    FROM meses m
    LEFT JOIN nota  n ON n.mes = m.mes
    LEFT JOIN caixa k ON k.mes = m.mes
    LEFT JOIN folha f ON f.mes = m.mes
),
-- Fator R nos dois cenarios, e o anexo que cada um implica
fator AS (
  SELECT b.*,
         CASE WHEN b.rbt12_cents > 0
              THEN round(b.folha12_com_mei_cents::numeric / b.rbt12_cents, 6) END AS fator_r_com_mei,
         CASE WHEN b.rbt12_cents > 0
              THEN round(b.folha12_sem_mei_cents::numeric / b.rbt12_cents, 6) END AS fator_r_sem_mei,
         (b.folha12_meses < 12 OR b.rbt12_meses < 12)                              AS fator_r_parcial
    FROM base b
),
anexo AS (
  SELECT f.*,
         (SELECT p.aliquota_nominal FROM fin_tax_regime_param p WHERE p.regime='simples' AND p.tributo='FATOR_R') AS limiar,
         CASE WHEN f.fator_r_com_mei >= 0.28 THEN 'III' ELSE 'V' END AS anexo_com_mei,
         CASE WHEN f.fator_r_sem_mei >= 0.28 THEN 'III' ELSE 'V' END AS anexo_sem_mei
    FROM fator f
),
-- alíquota efetiva do Simples por anexo: (RBT12 x aliq - PD) / RBT12  [art.18 §1o-A]
simples AS (
  SELECT a.mes, p.anexo, p.faixa, p.aliquota_nominal, p.parcela_deduzir_cents, a.rbt12_cents,
         round((a.rbt12_cents * p.aliquota_nominal - p.parcela_deduzir_cents) / a.rbt12_cents, 6) AS efetiva,
         p.base_legal, p.fonte_url
    FROM anexo a
    JOIN fin_tax_regime_param p
      ON p.regime = 'simples' AND p.tributo = 'DAS'
     AND a.rbt12_cents > p.faixa_de_cents AND a.rbt12_cents <= p.faixa_ate_cents
   WHERE a.rbt12_cents > 0
),
prm AS (SELECT regime, tributo, aliquota_nominal, base_legal, fonte_url, indeterminado FROM fin_tax_regime_param)
-- ---------------------------------------------------------------------------
-- SIMPLES: uma linha por anexo, por mês
-- ---------------------------------------------------------------------------
SELECT a.mes,
       'simples'::text                                        AS regime,
       s.anexo                                                AS anexo,
       ('DAS Anexo ' || s.anexo)::text                        AS rubrica,
       a.receita_nota_cents                                   AS base_cents,
       s.efetiva                                              AS aliquota,
       round(a.receita_nota_cents * s.efetiva)::bigint        AS valor_cents,
       ('efetiva = (RBT12 ' || a.rbt12_cents || ' x ' || s.aliquota_nominal
         || ' - PD ' || s.parcela_deduzir_cents || ') / RBT12 = ' || s.efetiva
         || ' ; DAS = receita_nota x efetiva ; faixa ' || s.faixa)::text AS formula,
       s.base_legal, s.fonte_url,
       CASE WHEN a.rbt12_meses < 12 THEN 'baixa' ELSE 'media' END::text AS confianca,
       a.fator_r_com_mei, a.fator_r_sem_mei, a.fator_r_parcial,
       a.anexo_com_mei, a.anexo_sem_mei,
       (a.anexo_com_mei IS DISTINCT FROM a.anexo_sem_mei)      AS mei_muda_anexo
  FROM anexo a JOIN simples s ON s.mes = a.mes

UNION ALL
-- ---------------------------------------------------------------------------
-- LUCRO PRESUMIDO
-- ---------------------------------------------------------------------------
SELECT a.mes, 'presumido', NULL, x.rubrica, x.base_cents, x.aliquota,
       round(x.base_cents * x.aliquota)::bigint, x.formula, x.base_legal, x.fonte_url,
       'media', a.fator_r_com_mei, a.fator_r_sem_mei, a.fator_r_parcial,
       a.anexo_com_mei, a.anexo_sem_mei, (a.anexo_com_mei IS DISTINCT FROM a.anexo_sem_mei)
  FROM anexo a
  CROSS JOIN LATERAL (
    SELECT 'IRPJ'::text AS rubrica,
           round(a.receita_nota_cents * (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='PRESUNCAO_IRPJ'))::bigint AS base_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='IRPJ') AS aliquota,
           'base = receita_nota x 32% (presuncao); IRPJ = base x 15%'::text AS formula,
           (SELECT base_legal FROM prm WHERE regime='presumido' AND tributo='IRPJ') AS base_legal,
           (SELECT fonte_url  FROM prm WHERE regime='presumido' AND tributo='IRPJ') AS fonte_url
    UNION ALL SELECT 'IRPJ adicional',
           GREATEST(0, round(a.receita_nota_cents * 0.32)::bigint - 2000000),
           (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='IRPJ_ADICIONAL'),
           'adicional de 10% sobre o que exceder R$ 20.000,00 no mes (Lei 9.249 art. 3o §1o)',
           (SELECT base_legal FROM prm WHERE regime='presumido' AND tributo='IRPJ_ADICIONAL'),
           (SELECT fonte_url  FROM prm WHERE regime='presumido' AND tributo='IRPJ_ADICIONAL')
    UNION ALL SELECT 'CSLL',
           round(a.receita_nota_cents * (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='PRESUNCAO_CSLL'))::bigint,
           (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='CSLL'),
           'base = receita_nota x 32% (presuncao art. 20); CSLL = base x 9%',
           (SELECT base_legal FROM prm WHERE regime='presumido' AND tributo='CSLL'),
           (SELECT fonte_url  FROM prm WHERE regime='presumido' AND tributo='CSLL')
    UNION ALL SELECT 'PIS', a.receita_nota_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='PIS'),
           'cumulativo: receita_nota x 0,65%',
           (SELECT base_legal FROM prm WHERE regime='presumido' AND tributo='PIS'),
           (SELECT fonte_url  FROM prm WHERE regime='presumido' AND tributo='PIS')
    UNION ALL SELECT 'COFINS', a.receita_nota_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='presumido' AND tributo='COFINS'),
           'cumulativo: receita_nota x 3%',
           (SELECT base_legal FROM prm WHERE regime='presumido' AND tributo='COFINS'),
           (SELECT fonte_url  FROM prm WHERE regime='presumido' AND tributo='COFINS')
    UNION ALL SELECT 'CPP sobre pro-labore', a.pro_labore_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='comum' AND tributo='CPP_PRO_LABORE'),
           'sai de dentro do DAS e reaparece: pro_labore x 20%',
           (SELECT base_legal FROM prm WHERE regime='comum' AND tributo='CPP_PRO_LABORE'),
           (SELECT fonte_url  FROM prm WHERE regime='comum' AND tributo='CPP_PRO_LABORE')
    UNION ALL SELECT 'CPP sobre salario CLT', a.salario_clt_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='comum' AND tributo='CPP_EMPREGADO'),
           'salario CLT (6.01 sem MEI) x 20%; RAT e Terceiros ficam FORA por indeterminacao',
           (SELECT base_legal FROM prm WHERE regime='comum' AND tributo='CPP_EMPREGADO'),
           (SELECT fonte_url  FROM prm WHERE regime='comum' AND tributo='CPP_EMPREGADO')
    UNION ALL SELECT 'FGTS', a.salario_clt_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='comum' AND tributo='FGTS'),
           'salario CLT x 8%',
           (SELECT base_legal FROM prm WHERE regime='comum' AND tributo='FGTS'),
           (SELECT fonte_url  FROM prm WHERE regime='comum' AND tributo='FGTS')
  ) x

UNION ALL
-- ---------------------------------------------------------------------------
-- LUCRO REAL — PIS/COFINS sem credito apurado; IRPJ/CSLL exigem LALUR que a
-- base nao tem. Por isso a confianca sai 'baixa' em todas as linhas.
-- ---------------------------------------------------------------------------
SELECT a.mes, 'real', NULL, y.rubrica, y.base_cents, y.aliquota,
       round(y.base_cents * y.aliquota)::bigint, y.formula, y.base_legal, y.fonte_url,
       'baixa', a.fator_r_com_mei, a.fator_r_sem_mei, a.fator_r_parcial,
       a.anexo_com_mei, a.anexo_sem_mei, (a.anexo_com_mei IS DISTINCT FROM a.anexo_sem_mei)
  FROM anexo a
  CROSS JOIN LATERAL (
    SELECT 'PIS'::text AS rubrica, a.receita_nota_cents AS base_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='real' AND tributo='PIS') AS aliquota,
           'nao-cumulativo: receita_nota x 1,65% SEM credito do art. 3o (nao apurado)'::text AS formula,
           (SELECT base_legal FROM prm WHERE regime='real' AND tributo='PIS') AS base_legal,
           (SELECT fonte_url  FROM prm WHERE regime='real' AND tributo='PIS') AS fonte_url
    UNION ALL SELECT 'COFINS', a.receita_nota_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='real' AND tributo='COFINS'),
           'nao-cumulativo: receita_nota x 7,6% SEM credito do art. 3o (nao apurado)',
           (SELECT base_legal FROM prm WHERE regime='real' AND tributo='COFINS'),
           (SELECT fonte_url  FROM prm WHERE regime='real' AND tributo='COFINS')
    UNION ALL SELECT 'CPP sobre pro-labore', a.pro_labore_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='comum' AND tributo='CPP_PRO_LABORE'),
           'pro_labore x 20%',
           (SELECT base_legal FROM prm WHERE regime='comum' AND tributo='CPP_PRO_LABORE'),
           (SELECT fonte_url  FROM prm WHERE regime='comum' AND tributo='CPP_PRO_LABORE')
    UNION ALL SELECT 'CPP sobre salario CLT', a.salario_clt_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='comum' AND tributo='CPP_EMPREGADO'),
           'salario CLT x 20%',
           (SELECT base_legal FROM prm WHERE regime='comum' AND tributo='CPP_EMPREGADO'),
           (SELECT fonte_url  FROM prm WHERE regime='comum' AND tributo='CPP_EMPREGADO')
    UNION ALL SELECT 'FGTS', a.salario_clt_cents,
           (SELECT aliquota_nominal FROM prm WHERE regime='comum' AND tributo='FGTS'),
           'salario CLT x 8%',
           (SELECT base_legal FROM prm WHERE regime='comum' AND tributo='FGTS'),
           (SELECT fonte_url  FROM prm WHERE regime='comum' AND tributo='FGTS')
  ) y;

COMMENT ON VIEW fin_regime_comparativo_v IS
  'Comparativo Simples (Anexo III e V) x Lucro Presumido x Lucro Real, mes a mes, uma linha por '
  'rubrica com formula, base, aliquota e fonte legal. Base de receita = NOTA AUTORIZADA (receita '
  'auferida), nao caixa. NAO inclui ISS, RAT nem Terceiros: os tres dependem de dado que a empresa '
  'ainda nao declarou e estao em fin_tax_regime_param com indeterminado = true. IRPJ/CSLL do Lucro '
  'Real NAO aparecem porque exigem LALUR que esta base nao tem — por isso confianca = baixa. '
  'fator_r_parcial = true significa que a janela de 12 meses de folha nao fechou e o Fator R esta '
  'subestimado. Saida gerencial, sujeita a validacao de contador.';
