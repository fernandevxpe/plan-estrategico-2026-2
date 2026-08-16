-- Cenários tributários com parâmetros versionados e lacunas explícitas.
--
-- Esta migration NÃO escolhe o regime da XPE e NÃO apura tributo devido. Ela
-- entrega duas coisas auditáveis:
--
--   1. fin_tax_regime_param: o parâmetro legal, sua vigência e a fonte oficial;
--   2. fin_regime_comparativo_v: memória gerencial de cada cenário, inclusive
--      as rubricas cujo valor ainda é indeterminado.
--
-- Um subtotal conhecido não é um total comparável. O resumo só preenche
-- `total_comparavel_cents` quando nenhuma lacuna bloqueante permanecer. Com o
-- estado atual da base, os três regimes continuam incompletos porque faltam:
--
--   · folha declarada em eSocial/GFIP, CPP e FGTS para o Fator R;
--   · confirmação documental dos MEIs e da natureza de seus pagamentos;
--   · NFS-e emitidas fora do Asaas e segregação fiscal por atividade;
--   · lei municipal aplicável ao ISS por serviço e Município;
--   · CNAE preponderante, RAT/FAP e código FPAS/Terceiros;
--   · escrituração contábil, adições/exclusões do LALUR e prejuízos fiscais;
--   · créditos de PIS/COFINS do regime não cumulativo;
--   · enquadramento da transição CBS/IBS de 2026 e cumprimento das condições.
--
-- Os valores calculados são cenários matemáticos sobre dados disponíveis, não
-- recomendação tributária. Toda decisão deve ser validada pelo contador.
--
-- Fontes primárias consultadas em 16/08/2026:
--
--   LC 123/2006 — Anexos III/V e art. 18, §§ 1º-A, 5º-I, 5º-J, 5º-K,
--   5º-M, 24 e 25
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
--   LC 116/2003 — ISS, art. 8º, II, e art. 8º-A
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm
--   Lei 9.249/1995 — IRPJ, presunções e CSLL
--     https://www.planalto.gov.br/ccivil_03/leis/L9249.htm
--   Lei 9.430/1996 — períodos de apuração e lucro presumido
--     https://www.planalto.gov.br/ccivil_03/leis/L9430.htm
--   Lei 7.689/1988 — CSLL
--     https://www.planalto.gov.br/ccivil_03/leis/L7689.htm
--   Leis 9.715/1998 e 9.718/1998 — PIS/COFINS cumulativos
--     https://www.planalto.gov.br/ccivil_03/leis/L9715.htm
--     https://www.planalto.gov.br/ccivil_03/leis/L9718compilada.htm
--   Leis 10.637/2002 e 10.833/2003 — PIS/COFINS não cumulativos
--     https://www.planalto.gov.br/ccivil_03/leis/2002/L10637compilado.htm
--     https://www.planalto.gov.br/ccivil_03/leis/2003/L10.833compilado.htm
--   Lei 8.212/1991 — CPP e RAT, art. 22
--     https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm
--   Lei 8.036/1990 — FGTS, art. 15
--     https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm
--   Decreto 12.797/2025 — salário mínimo de 2026
--     https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm
--   LC 214/2025 — transição CBS/IBS de 2026
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm
--   LC 227/2026 — alterações vigentes nas LC 123/2006 e 214/2025
--     https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm
--   Receita Federal — Orientações da Reforma Tributária para 2026, atualizadas
--   em 06/05/2026: destaque obrigatório e dispensa de recolhimento quando
--   cumpridas as obrigações acessórias aplicáveis
--     https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026

-- ==========================================================================
-- 1. PARÂMETROS LEGAIS COMO DADO VERSIONADO
-- ==========================================================================

CREATE TABLE IF NOT EXISTS fin_tax_regime_param (
  id                     bigserial PRIMARY KEY,
  regime                 text        NOT NULL,
  tributo                text        NOT NULL,
  anexo                  text,
  faixa                  smallint,
  -- Os dois limites são INCLUSIVOS. A faixa seguinte começa no centavo
  -- imediatamente posterior; a asserção após a carga rejeita buraco/sobreposição.
  faixa_de_cents         bigint,
  faixa_ate_cents        bigint,
  aliquota_nominal       numeric(9,6),
  valor_absoluto_cents   bigint,
  parcela_deduzir_cents  bigint      NOT NULL DEFAULT 0,
  base_calculo           text,
  base_legal             text        NOT NULL,
  fonte_url              text        NOT NULL,
  consultado_em          date        NOT NULL,
  vigencia_de            date        NOT NULL,
  vigencia_ate           date,
  -- Pode ser true mesmo com alíquota conhecida: a taxa pode estar na lei e sua
  -- incidência concreta depender de informação ausente da empresa.
  indeterminado          boolean     NOT NULL DEFAULT false,
  observacao             text,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_tax_regime_param_regime_ck
    CHECK (regime IN ('simples', 'presumido', 'real', 'comum')),
  CONSTRAINT fin_tax_regime_param_faixa_ck
    CHECK (
      (faixa IS NULL AND faixa_de_cents IS NULL AND faixa_ate_cents IS NULL)
      OR
      (faixa IS NOT NULL AND faixa_de_cents IS NOT NULL AND faixa_ate_cents IS NOT NULL
       AND faixa_de_cents >= 0 AND faixa_ate_cents >= faixa_de_cents)
    ),
  CONSTRAINT fin_tax_regime_param_vigencia_ck
    CHECK (vigencia_ate IS NULL OR vigencia_ate >= vigencia_de),
  -- Um parâmetro pode ser taxa, valor absoluto ou lacuna declarada. Salário
  -- mínimo é valor, não alíquota; guardá-lo em parcela a deduzir violava a
  -- semântica e o CHECK anterior.
  CONSTRAINT fin_tax_regime_param_valor_ck
    CHECK (aliquota_nominal IS NOT NULL OR valor_absoluto_cents IS NOT NULL OR indeterminado),
  CONSTRAINT fin_tax_regime_param_tipo_valor_ck
    CHECK (NOT (aliquota_nominal IS NOT NULL AND valor_absoluto_cents IS NOT NULL))
);

COMMENT ON TABLE fin_tax_regime_param IS
  'Parâmetro tributário versionado com dispositivo legal, URL de fonte primária, consulta e '
  'vigência. Taxa conhecida não significa incidência conhecida: indeterminado=true registra '
  'quando a aplicação depende de CNAE, Município, FPAS, escrituração ou outra evidência ausente.';
COMMENT ON COLUMN fin_tax_regime_param.faixa_de_cents IS
  'Limite inferior inclusivo, em centavos.';
COMMENT ON COLUMN fin_tax_regime_param.faixa_ate_cents IS
  'Limite superior inclusivo, em centavos.';
COMMENT ON COLUMN fin_tax_regime_param.aliquota_nominal IS
  'Fração, não percentual: 0,06 = 6%.';
COMMENT ON COLUMN fin_tax_regime_param.valor_absoluto_cents IS
  'Valor legal absoluto, em centavos. Não reutilizar parcela_deduzir_cents para este fim.';
COMMENT ON COLUMN fin_tax_regime_param.indeterminado IS
  'A incidência ou o valor concreto depende de evidência empresarial ainda ausente.';

CREATE UNIQUE INDEX IF NOT EXISTS fin_tax_regime_param_uq
  ON fin_tax_regime_param
  (regime, tributo, coalesce(anexo, ''), coalesce(faixa, 0), vigencia_de);

-- --------------------------------------------------------------------------
-- 1.1 Simples Nacional — Anexos III e V
-- --------------------------------------------------------------------------
INSERT INTO fin_tax_regime_param
  (regime, tributo, anexo, faixa, faixa_de_cents, faixa_ate_cents,
   aliquota_nominal, parcela_deduzir_cents, base_calculo, base_legal,
   fonte_url, consultado_em, vigencia_de)
VALUES
  ('simples','DAS','III',1,         0,  18000000,0.060000,       0,'rbt12','LC 123/2006, Anexo III, 1a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',2,  18000001,  36000000,0.112000,  936000,'rbt12','LC 123/2006, Anexo III, 2a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',3,  36000001,  72000000,0.135000, 1764000,'rbt12','LC 123/2006, Anexo III, 3a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',4,  72000001, 180000000,0.160000, 3564000,'rbt12','LC 123/2006, Anexo III, 4a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',5, 180000001, 360000000,0.210000,12564000,'rbt12','LC 123/2006, Anexo III, 5a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','III',6, 360000001, 480000000,0.330000,64800000,'rbt12','LC 123/2006, Anexo III, 6a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',1,           0,  18000000,0.155000,       0,'rbt12','LC 123/2006, Anexo V, 1a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',2,    18000001,  36000000,0.180000,  450000,'rbt12','LC 123/2006, Anexo V, 2a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',3,    36000001,  72000000,0.195000,  990000,'rbt12','LC 123/2006, Anexo V, 3a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',4,    72000001, 180000000,0.205000, 1710000,'rbt12','LC 123/2006, Anexo V, 4a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',5,   180000001, 360000000,0.230000, 6210000,'rbt12','LC 123/2006, Anexo V, 5a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01'),
  ('simples','DAS','V',6,   360000001, 480000000,0.305000,54000000,'rbt12','LC 123/2006, Anexo V, 6a faixa (red. LC 155/2016)','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01');

-- Falha a migration se qualquer anexo tiver centavo sem faixa, sobreposição ou
-- teto diferente de R$ 4,8 milhões. Esta asserção também protege o operador
-- BETWEEN usado pela view.
DO $$
DECLARE
  problemas integer;
BEGIN
  SELECT count(*) INTO problemas
    FROM (
      SELECT anexo, faixa, faixa_de_cents, faixa_ate_cents,
             lag(faixa_ate_cents) OVER (PARTITION BY anexo ORDER BY faixa) AS anterior_ate
        FROM fin_tax_regime_param
       WHERE regime = 'simples' AND tributo = 'DAS' AND vigencia_de = '2018-01-01'
    ) f
   WHERE faixa_de_cents <> COALESCE(anterior_ate + 1, 0);

  IF problemas <> 0 THEN
    RAISE EXCEPTION 'faixas do Simples têm % buraco(s) ou sobreposição(ões)', problemas;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM fin_tax_regime_param
     WHERE regime = 'simples' AND tributo = 'DAS' AND vigencia_de = '2018-01-01'
     GROUP BY anexo
    HAVING min(faixa_de_cents) <> 0 OR max(faixa_ate_cents) <> 480000000 OR count(*) <> 6
  ) THEN
    RAISE EXCEPTION 'faixas do Simples não cobrem integralmente de zero a R$ 4,8 milhões';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 1.2 Demais parâmetros conhecidos
-- --------------------------------------------------------------------------
INSERT INTO fin_tax_regime_param
  (regime, tributo, aliquota_nominal, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, observacao)
VALUES
  ('simples','FATOR_R',0.280000,'folha_declarada_sobre_receita_12m','LC 123/2006 art. 18 §§5o-J, 5o-K, 5o-M, 24 e 25','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm','2026-08-16','2018-01-01','Exige remunerações declaradas, pró-labore, CPP e FGTS; o ledger bancário isolado não é essa base.'),
  ('presumido','PRESUNCAO_IRPJ',0.320000,'receita_bruta_de_servicos','Lei 9.249/1995 art. 15 §1o III — cenário para prestação de serviços em geral','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1996-01-01','Aplicar somente depois de segregar todas as atividades e confirmar o percentual de cada receita.'),
  ('presumido','PRESUNCAO_CSLL',0.320000,'receita_bruta_de_servicos','Lei 9.249/1995 art. 20, I (red. LC 167/2019)','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','2019-04-25','Aplicar somente depois de segregar todas as atividades.'),
  ('presumido','IRPJ',0.150000,'lucro_presumido','Lei 9.249/1995 art. 3o','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1996-01-01',NULL),
  ('presumido','IRPJ_ADICIONAL',0.100000,'lucro_presumido_excedente','Lei 9.249/1995 art. 3o §1o e Lei 9.430/1996 arts. 1o e 4o','https://www.planalto.gov.br/ccivil_03/leis/L9430.htm','2026-08-16','1997-01-01','A view provisiona mês a mês dentro do trimestre; o fechamento legal é trimestral.'),
  ('presumido','CSLL',0.090000,'base_presumida_csll','Lei 7.689/1988 art. 3o III','https://www.planalto.gov.br/ccivil_03/leis/L7689.htm','2026-08-16','2015-09-01',NULL),
  ('presumido','PIS',0.006500,'receita_bruta','Lei 9.715/1998 art. 8o I — regime cumulativo','https://www.planalto.gov.br/ccivil_03/leis/L9715.htm','2026-08-16','1998-11-01',NULL),
  ('presumido','COFINS',0.030000,'receita_bruta','Lei 9.718/1998 art. 8o — regime cumulativo','https://www.planalto.gov.br/ccivil_03/leis/L9718compilada.htm','2026-08-16','1999-02-01',NULL),
  ('real','IRPJ',0.150000,'lucro_real','Lei 9.249/1995 art. 3o','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1996-01-01','Alíquota conhecida; base indeterminada sem escrituração e LALUR.'),
  ('real','IRPJ_ADICIONAL',0.100000,'lucro_real_excedente','Lei 9.249/1995 art. 3o §1o e Lei 9.430/1996 arts. 1o a 4o','https://www.planalto.gov.br/ccivil_03/leis/L9430.htm','2026-08-16','1997-01-01','Alíquota conhecida; base e forma de apuração anual/trimestral não cadastradas.'),
  ('real','CSLL',0.090000,'resultado_ajustado','Lei 7.689/1988 art. 3o III','https://www.planalto.gov.br/ccivil_03/leis/L7689.htm','2026-08-16','2015-09-01','Alíquota conhecida; base indeterminada sem escrituração e ajustes fiscais.'),
  ('real','PIS',0.016500,'receita_bruta','Lei 10.637/2002 art. 2o — débito antes dos créditos do art. 3o','https://www.planalto.gov.br/ccivil_03/leis/2002/L10637compilado.htm','2026-08-16','2002-12-01','A view calcula somente o débito bruto e expõe os créditos como lacuna.'),
  ('real','COFINS',0.076000,'receita_bruta','Lei 10.833/2003 art. 2o — débito antes dos créditos do art. 3o','https://www.planalto.gov.br/ccivil_03/leis/2003/L10.833compilado.htm','2026-08-16','2004-02-01','A view calcula somente o débito bruto e expõe os créditos como lacuna.'),
  ('comum','CPP_EMPREGADO',0.200000,'remuneracao_empregados','Lei 8.212/1991 art. 22 I','https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1999-11-26','Fora do DAS nos cenários não optantes; base do ledger é apenas proxy.'),
  ('comum','CPP_PRO_LABORE',0.200000,'pro_labore','Lei 8.212/1991 art. 22 III','https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1999-11-26','Fora do DAS nos cenários não optantes; base do ledger é apenas proxy.'),
  ('comum','FGTS',0.080000,'remuneracao_empregados','Lei 8.036/1990 art. 15','https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm','2026-08-16','1990-05-11','Custo comum aos regimes, mostrado mas fora do subtotal comparativo.');

INSERT INTO fin_tax_regime_param
  (regime, tributo, valor_absoluto_cents, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, observacao)
VALUES
  ('comum','SALARIO_MINIMO',162100,'valor_absoluto','Decreto 12.797/2025 art. 1o — R$ 1.621,00','https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm','2026-08-16','2026-01-01','Valor legal conhecido. Não implica, sozinho, identificar um pagamento como DAS-MEI.'),
  ('comum','LIMITE_ADICIONAL_IRPJ_MENSAL',2000000,'valor_absoluto','Lei 9.249/1995 art. 3o §1o — R$ 20.000,00 por mês do período','https://www.planalto.gov.br/ccivil_03/leis/L9249.htm','2026-08-16','1997-01-01','No lucro presumido, a view usa o limite acumulado dentro de cada trimestre.');

-- --------------------------------------------------------------------------
-- 1.3 Taxas/incidências cuja aplicação concreta ainda é indeterminada
-- --------------------------------------------------------------------------
INSERT INTO fin_tax_regime_param
  (regime, tributo, aliquota_nominal, base_calculo, base_legal, fonte_url,
   consultado_em, vigencia_de, indeterminado, observacao)
VALUES
  ('comum','RAT',NULL,'remuneracao_empregados','Lei 8.212/1991 art. 22 II — 1%, 2% ou 3% segundo o risco da atividade preponderante','https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm','2026-08-16','1998-12-11',true,'Faltam CNAE preponderante, grau de risco e FAP. Nenhuma alíquota usual é presumida.'),
  ('comum','TERCEIROS',NULL,'remuneracao_empregados','Contribuições destinadas a terceiros dependem do código FPAS e enquadramento da empresa','https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/esocial/manuais','2026-08-16','1991-07-25',true,'Faltam CNAE/FPAS e enquadramento. Nenhum percentual de mercado é usado.'),
  ('comum','ISS',NULL,'receita_por_servico_e_municipio','LC 116/2003 art. 8o II (máximo 5%) e art. 8o-A (mínimo 2%); alíquota concreta é municipal','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm','2026-08-16','2003-08-01',true,'O destaque da nota não substitui a lei municipal nem resolve retenção, local de incidência e código de serviço.'),
  ('comum','CBS_2026',0.009000,'receita_bruta','LC 214/2025 arts. 346 e 348 — transição de 2026','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm','2026-08-16','2026-01-01',true,'Taxa legal conhecida; efeito líquido depende do regime e do cumprimento das condições e obrigações acessórias.'),
  ('comum','IBS_2026',0.001000,'receita_bruta','LC 214/2025 arts. 343 e 348 — transição de 2026','https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm','2026-08-16','2026-01-01',true,'Taxa legal conhecida; efeito líquido depende do regime e do cumprimento das condições e obrigações acessórias.');

-- ==========================================================================
-- 2. MEMÓRIA DE CÁLCULO LONGA: VALORES CONHECIDOS E LACUNAS
-- ==========================================================================
--
-- A granularidade é mensal. IRPJ/CSLL do presumido são provisões gerenciais:
-- o adicional de IRPJ é acumulado dentro do trimestre e lançado por diferença,
-- de modo que a soma dos três meses reproduza o limite trimestral. Isso não
-- transforma a linha em guia fiscal nem antecipa o fechamento do trimestre.

CREATE OR REPLACE VIEW fin_regime_comparativo_v AS
WITH RECURSIVE
nota_mes AS (
  SELECT date_trunc('month', issue_date)::date AS mes,
         sum(service_amount_cents)::bigint AS cents
    FROM fin_fiscal_document
   WHERE status = 'AUTHORIZED'
   GROUP BY 1
),
caixa_mes AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         sum(t.amount_cents)::bigint AS cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents > 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
     AND c.cash_flow_group IN ('receita-servicos','receita-recorrente')
   GROUP BY 1
),
mei_cp AS (
  SELECT DISTINCT pc.counterparty_id
    FROM fin_person_counterparty pc
    JOIN fin_person p ON p.id = pc.person_id
   WHERE pc.status = 'confirmado' AND p.employment_type = 'mei'
),
folha_mes AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         sum(abs(t.amount_cents))::bigint AS total_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE t.counterparty_id IN (SELECT counterparty_id FROM mei_cp)), 0)::bigint AS mei_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.02'), 0)::bigint AS pro_labore_cents,
         COALESCE(sum(abs(t.amount_cents)) FILTER (
           WHERE c.code = '6.01'
             AND (t.counterparty_id IS NULL
                  OR t.counterparty_id NOT IN (SELECT counterparty_id FROM mei_cp))), 0)::bigint AS salario_clt_proxy_cents
    FROM fin_transaction t
    JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0
     AND NOT t.is_split_parent
     AND t.transfer_status <> 'pareado'
     AND c.cash_flow_group = 'pessoal'
   GROUP BY 1
),
dre_mes AS (
  SELECT mes, lair_cents
    FROM fin_dre_mensal_v
   WHERE visao = 'competencia'
),
limites AS (
  SELECT LEAST((SELECT min(mes) FROM nota_mes), (SELECT min(mes) FROM caixa_mes)) AS primeiro,
         GREATEST((SELECT max(mes) FROM nota_mes), (SELECT max(mes) FROM caixa_mes)) AS ultimo
),
meses AS (
  SELECT generate_series(primeiro, ultimo, interval '1 month')::date AS mes
    FROM limites
),
prm AS (
  SELECT m.mes, p.*
    FROM meses m
    JOIN fin_tax_regime_param p
      ON p.vigencia_de <= (m.mes + interval '1 month - 1 day')::date
     AND (p.vigencia_ate IS NULL OR p.vigencia_ate >= m.mes)
),
base0 AS (
  SELECT m.mes,
         COALESCE(n.cents, 0)::bigint AS receita_nota_cents,
         COALESCE(k.cents, 0)::bigint AS receita_caixa_cents,
         COALESCE(f.total_cents, 0)::bigint AS folha_total_proxy_cents,
         COALESCE(f.mei_cents, 0)::bigint AS folha_mei_proxy_cents,
         COALESCE(f.pro_labore_cents, 0)::bigint AS pro_labore_proxy_cents,
         COALESCE(f.salario_clt_proxy_cents, 0)::bigint AS salario_clt_proxy_cents,
         d.lair_cents::bigint AS lair_gerencial_cents,
         COALESCE((SELECT sum(n2.cents) FROM nota_mes n2
                    WHERE n2.mes >= m.mes - interval '12 months' AND n2.mes < m.mes), 0)::bigint
           AS rbt12_nota_proxy_cents,
         COALESCE((SELECT sum(f2.total_cents) FROM folha_mes f2
                    WHERE f2.mes >= m.mes - interval '12 months' AND f2.mes < m.mes), 0)::bigint
           AS folha12_com_mei_proxy_cents,
         COALESCE((SELECT sum(f3.total_cents - f3.mei_cents) FROM folha_mes f3
                    WHERE f3.mes >= m.mes - interval '12 months' AND f3.mes < m.mes), 0)::bigint
           AS folha12_sem_mei_proxy_cents,
         (SELECT count(*) FROM folha_mes f4
           WHERE f4.mes >= m.mes - interval '12 months' AND f4.mes < m.mes)::integer
           AS folha12_meses_com_movimento,
         (SELECT p.aliquota_nominal FROM prm p
           WHERE p.mes = m.mes AND p.regime = 'simples' AND p.tributo = 'FATOR_R') AS fator_r_limiar,
         (SELECT p.base_legal FROM prm p
           WHERE p.mes = m.mes AND p.regime = 'simples' AND p.tributo = 'FATOR_R') AS fator_r_base_legal,
         (SELECT p.fonte_url FROM prm p
           WHERE p.mes = m.mes AND p.regime = 'simples' AND p.tributo = 'FATOR_R') AS fator_r_fonte_url
    FROM meses m
    LEFT JOIN nota_mes n ON n.mes = m.mes
    LEFT JOIN caixa_mes k ON k.mes = m.mes
    LEFT JOIN folha_mes f ON f.mes = m.mes
    LEFT JOIN dre_mes d ON d.mes = m.mes
),
base AS (
  SELECT b.*,
         CASE WHEN b.rbt12_nota_proxy_cents > 0
              THEN round(b.folha12_com_mei_proxy_cents::numeric / b.rbt12_nota_proxy_cents, 6) END
           AS fator_r_proxy_com_mei,
         CASE WHEN b.rbt12_nota_proxy_cents > 0
              THEN round(b.folha12_sem_mei_proxy_cents::numeric / b.rbt12_nota_proxy_cents, 6) END
           AS fator_r_proxy_sem_mei,
         false::boolean AS fator_r_apuravel
    FROM base0 b
),
base_anexo AS (
  SELECT b.*,
         CASE WHEN b.fator_r_proxy_com_mei IS NULL THEN NULL
              WHEN b.fator_r_proxy_com_mei >= b.fator_r_limiar THEN 'III' ELSE 'V' END
           AS indicacao_anexo_proxy_com_mei,
         CASE WHEN b.fator_r_proxy_sem_mei IS NULL THEN NULL
              WHEN b.fator_r_proxy_sem_mei >= b.fator_r_limiar THEN 'III' ELSE 'V' END
           AS indicacao_anexo_proxy_sem_mei
    FROM base b
),
simples_calc AS (
  SELECT b.*, ax.anexo,
         p.faixa, p.aliquota_nominal, p.parcela_deduzir_cents,
         p.base_legal AS das_base_legal, p.fonte_url AS das_fonte_url,
         CASE WHEN b.rbt12_nota_proxy_cents > 0 AND p.id IS NOT NULL
              THEN round((b.rbt12_nota_proxy_cents::numeric * p.aliquota_nominal
                          - p.parcela_deduzir_cents)
                         / b.rbt12_nota_proxy_cents, 6) END AS aliquota_efetiva
    FROM base_anexo b
    CROSS JOIN (VALUES ('III'::text), ('V'::text)) ax(anexo)
    LEFT JOIN LATERAL (
      SELECT p.*
        FROM fin_tax_regime_param p
       WHERE p.regime = 'simples' AND p.tributo = 'DAS' AND p.anexo = ax.anexo
         AND b.rbt12_nota_proxy_cents BETWEEN p.faixa_de_cents AND p.faixa_ate_cents
         AND p.vigencia_de <= (b.mes + interval '1 month - 1 day')::date
         AND (p.vigencia_ate IS NULL OR p.vigencia_ate >= b.mes)
       ORDER BY p.vigencia_de DESC
       LIMIT 1
    ) p ON true
),
presumido_mes AS (
  SELECT b.*,
         (SELECT p.aliquota_nominal FROM prm p WHERE p.mes=b.mes AND p.regime='presumido' AND p.tributo='PRESUNCAO_IRPJ') AS pres_irpj,
         (SELECT p.aliquota_nominal FROM prm p WHERE p.mes=b.mes AND p.regime='presumido' AND p.tributo='PRESUNCAO_CSLL') AS pres_csll,
         (SELECT p.valor_absoluto_cents FROM prm p WHERE p.mes=b.mes AND p.regime='comum' AND p.tributo='LIMITE_ADICIONAL_IRPJ_MENSAL') AS limite_adicional_mes,
         round(b.receita_nota_cents * (SELECT p.aliquota_nominal FROM prm p WHERE p.mes=b.mes AND p.regime='presumido' AND p.tributo='PRESUNCAO_IRPJ'))::bigint AS base_irpj_mes_cents,
         round(b.receita_nota_cents * (SELECT p.aliquota_nominal FROM prm p WHERE p.mes=b.mes AND p.regime='presumido' AND p.tributo='PRESUNCAO_CSLL'))::bigint AS base_csll_mes_cents
    FROM base_anexo b
),
presumido_qtd AS (
  SELECT p.*,
         sum(p.base_irpj_mes_cents) OVER (
           PARTITION BY date_trunc('quarter', p.mes) ORDER BY p.mes) AS base_irpj_qtd_cents,
         row_number() OVER (
           PARTITION BY date_trunc('quarter', p.mes) ORDER BY p.mes) AS mes_no_trimestre
    FROM presumido_mes p
),
presumido AS (
  SELECT p.*,
         (GREATEST(0::numeric, p.base_irpj_qtd_cents
                    - p.limite_adicional_mes * p.mes_no_trimestre)
          - GREATEST(0::numeric, p.base_irpj_qtd_cents - p.base_irpj_mes_cents
                     - p.limite_adicional_mes * (p.mes_no_trimestre - 1)))::bigint
           AS base_adicional_incremental_cents
    FROM presumido_qtd p
),
linhas AS (
  -- Simples: cálculo hipotético para cada anexo. A falta do anexo aplicável e
  -- da cobertura da receita aparece em linhas próprias logo abaixo.
  SELECT s.mes,
         'simples'::text AS regime,
         ('simples_anexo_' || lower(s.anexo))::text AS cenario,
         s.anexo,
         ('DAS Anexo ' || s.anexo)::text AS rubrica,
         'tributo'::text AS natureza,
         s.receita_nota_cents::bigint AS base_cents,
         s.aliquota_efetiva::numeric AS aliquota,
         CASE WHEN s.aliquota_efetiva IS NULL THEN NULL
              ELSE round(s.receita_nota_cents * s.aliquota_efetiva)::bigint END AS valor_cents,
         true AS incluido_no_subtotal,
         (s.aliquota_efetiva IS NULL) AS indeterminado,
         (s.aliquota_efetiva IS NULL) AS bloqueia_comparacao,
         CASE WHEN s.aliquota_efetiva IS NULL
              THEN 'RBT12 proxy sem faixa válida ou fora do limite do Simples; não há DAS calculável.' END::text
           AS motivo_indeterminacao,
         CASE WHEN s.aliquota_efetiva IS NULL THEN 'não calculado'
              ELSE ('alíquota efetiva = (RBT12 proxy ' || s.rbt12_nota_proxy_cents
                    || ' x ' || s.aliquota_nominal || ' - parcela ' || s.parcela_deduzir_cents
                    || ') / RBT12; DAS cenário = notas Asaas autorizadas x alíquota efetiva; faixa '
                    || s.faixa) END::text AS formula,
         s.das_base_legal AS base_legal,
         s.das_fonte_url AS fonte_url,
         'baixa'::text AS confianca,
         s.receita_nota_cents, s.receita_caixa_cents, s.rbt12_nota_proxy_cents,
         s.fator_r_proxy_com_mei, s.fator_r_proxy_sem_mei, s.fator_r_apuravel,
         s.indicacao_anexo_proxy_com_mei, s.indicacao_anexo_proxy_sem_mei,
         CASE WHEN s.indicacao_anexo_proxy_com_mei IS NULL OR s.indicacao_anexo_proxy_sem_mei IS NULL
              THEN NULL
              ELSE s.indicacao_anexo_proxy_com_mei IS DISTINCT FROM s.indicacao_anexo_proxy_sem_mei END
           AS mei_muda_anexo_proxy
    FROM simples_calc s

  UNION ALL
  SELECT s.mes, 'simples', ('simples_anexo_' || lower(s.anexo)), s.anexo,
         'Fator R e anexo aplicável', 'lacuna',
         s.folha12_sem_mei_proxy_cents, s.fator_r_limiar, NULL::bigint,
         false, true, true,
         'O ledger não contém a folha legal completa (eSocial/GFIP, CPP e FGTS) e a identificação/classificação dos MEIs ainda tem pendências. Os dois fatores mostrados são proxies e não escolhem anexo.',
         'proxy = saídas de pessoal no ledger / notas autorizadas no Asaas; NÃO é a fórmula fiscal completa',
         s.fator_r_base_legal, s.fator_r_fonte_url, 'indeterminada',
         s.receita_nota_cents, s.receita_caixa_cents, s.rbt12_nota_proxy_cents,
         s.fator_r_proxy_com_mei, s.fator_r_proxy_sem_mei, s.fator_r_apuravel,
         s.indicacao_anexo_proxy_com_mei, s.indicacao_anexo_proxy_sem_mei,
         CASE WHEN s.indicacao_anexo_proxy_com_mei IS NULL OR s.indicacao_anexo_proxy_sem_mei IS NULL
              THEN NULL
              ELSE s.indicacao_anexo_proxy_com_mei IS DISTINCT FROM s.indicacao_anexo_proxy_sem_mei END
    FROM simples_calc s

  UNION ALL
  SELECT s.mes, 'simples', ('simples_anexo_' || lower(s.anexo)), s.anexo,
         'Cobertura e segregação da receita', 'lacuna',
         s.receita_nota_cents, NULL::numeric, NULL::bigint,
         false, true, true,
         'fin_fiscal_document contém somente NFS-e do Asaas; há emissão externa conhecida. Também falta validar a atividade/CNAE e a segregação por código fiscal.',
         'base exibida = soma de documentos Asaas AUTHORIZED; receita externa não é arbitrada como zero',
         'LC 123/2006 art. 18 e anexos aplicáveis',
         'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', 'indeterminada',
         s.receita_nota_cents, s.receita_caixa_cents, s.rbt12_nota_proxy_cents,
         s.fator_r_proxy_com_mei, s.fator_r_proxy_sem_mei, s.fator_r_apuravel,
         s.indicacao_anexo_proxy_com_mei, s.indicacao_anexo_proxy_sem_mei,
         CASE WHEN s.indicacao_anexo_proxy_com_mei IS NULL OR s.indicacao_anexo_proxy_sem_mei IS NULL
              THEN NULL
              ELSE s.indicacao_anexo_proxy_com_mei IS DISTINCT FROM s.indicacao_anexo_proxy_sem_mei END
    FROM simples_calc s

  UNION ALL
  -- Lucro Presumido: parcelas matematicamente calculáveis sobre a hipótese de
  -- presunção de 32%. As lacunas de atividade, ISS e folha vêm em seguida.
  SELECT p.mes, 'presumido', 'lucro_presumido', NULL::text,
         x.rubrica, x.natureza, x.base_cents, x.aliquota, x.valor_cents,
         x.incluido, false, false, NULL::text, x.formula, x.base_legal, x.fonte_url,
         'baixa', p.receita_nota_cents, p.receita_caixa_cents, NULL::bigint,
         NULL::numeric, NULL::numeric, NULL::boolean, NULL::text, NULL::text, NULL::boolean
    FROM presumido p
    CROSS JOIN LATERAL (
      VALUES
        ('IRPJ'::text, 'tributo'::text, p.base_irpj_mes_cents::bigint,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ'),
         round(p.base_irpj_mes_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ'))::bigint,
         true,
         'provisão mensal = notas Asaas autorizadas x presunção de 32% x 15%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ')),
        ('IRPJ adicional', 'tributo', p.base_adicional_incremental_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ_ADICIONAL'),
         round(p.base_adicional_incremental_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ_ADICIONAL'))::bigint,
         true,
         'provisão incremental: [excesso acumulado no trimestre até M] - [excesso acumulado até M-1]; limite R$ 20 mil por mês do período',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ_ADICIONAL'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='IRPJ_ADICIONAL')),
        ('CSLL', 'tributo', p.base_csll_mes_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='CSLL'),
         round(p.base_csll_mes_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='CSLL'))::bigint,
         true,
         'provisão mensal = notas Asaas autorizadas x presunção de 32% x 9%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='CSLL'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='CSLL')),
        ('PIS', 'tributo', p.receita_nota_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='PIS'),
         round(p.receita_nota_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='PIS'))::bigint,
         true, 'débito cumulativo = notas Asaas autorizadas x 0,65%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='PIS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='PIS')),
        ('COFINS', 'tributo', p.receita_nota_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='COFINS'),
         round(p.receita_nota_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='COFINS'))::bigint,
         true, 'débito cumulativo = notas Asaas autorizadas x 3%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='COFINS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='presumido' AND q.tributo='COFINS')),
        ('CPP sobre pró-labore', 'encargo', p.pro_labore_proxy_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE'),
         round(p.pro_labore_proxy_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE'))::bigint,
         true, 'proxy = saídas 6.02 no ledger x 20%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE')),
        ('CPP sobre remuneração CLT', 'encargo', p.salario_clt_proxy_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO'),
         round(p.salario_clt_proxy_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO'))::bigint,
         true, 'proxy = saídas 6.01 não ligadas a MEI confirmado x 20%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO')),
        ('FGTS (custo comum)', 'encargo_comum', p.salario_clt_proxy_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='FGTS'),
         round(p.salario_clt_proxy_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='FGTS'))::bigint,
         false, 'mostrado para transparência, fora do subtotal porque não diferencia os regimes',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='FGTS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='FGTS'))
    ) x(rubrica, natureza, base_cents, aliquota, valor_cents, incluido, formula, base_legal, fonte_url)

  UNION ALL
  SELECT p.mes, 'presumido', 'lucro_presumido', NULL::text,
         x.rubrica, 'lacuna', x.base_cents, x.aliquota, NULL::bigint,
         false, true, true, x.motivo, x.formula, x.base_legal, x.fonte_url,
         'indeterminada', p.receita_nota_cents, p.receita_caixa_cents, NULL::bigint,
         NULL::numeric, NULL::numeric, NULL::boolean, NULL::text, NULL::text, NULL::boolean
    FROM presumido p
    CROSS JOIN LATERAL (
      VALUES
        ('ISS'::text, p.receita_nota_cents::bigint, NULL::numeric,
         'Faltam Município de incidência, lei municipal, código de serviço e retenções.',
         'não calculado; a faixa federal de 2% a 5% não autoriza escolher a alíquota local',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='ISS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='ISS')),
        ('RAT/FAP', p.salario_clt_proxy_cents, NULL::numeric,
         'Faltam CNAE preponderante, grau de risco e FAP.', 'não calculado; nenhuma taxa usual é presumida',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='RAT'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='RAT')),
        ('Terceiros', p.salario_clt_proxy_cents, NULL::numeric,
         'Faltam CNAE, código FPAS e enquadramento.', 'não calculado; nenhum percentual de mercado é usado',
         (SELECT q.base_legal FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='TERCEIROS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=p.mes AND q.regime='comum' AND q.tributo='TERCEIROS')),
        ('Receita e percentuais de presunção', p.receita_nota_cents, p.pres_irpj,
         'A base fiscal contém somente notas Asaas; falta segregar toda receita por atividade e confirmar o percentual de presunção aplicável a cada uma.',
         '32% é hipótese de cenário para serviço geral, não classificação definitiva de toda receita',
         'Lei 9.249/1995 arts. 15 e 20', 'https://www.planalto.gov.br/ccivil_03/leis/L9249.htm'),
        ('Folha, pró-labore e MEIs', p.folha_total_proxy_cents, NULL::numeric,
         'O ledger não substitui eSocial/folha; MEIs e reembolsos ainda exigem confirmação documental e contábil.',
         'bases de CPP mostradas são proxies; diferença permanece indeterminada',
         'Lei 8.212/1991 art. 22', 'https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm'),
        ('CBS/IBS — transição 2026', p.receita_nota_cents, NULL::numeric,
         'O efeito líquido depende do regime, das compensações e do cumprimento das condições/obrigações acessórias; a base não registra essa evidência.',
         'não calculado; taxas legais conhecidas não bastam para afirmar valor devido',
         'LC 214/2025 arts. 343, 346 e 348', 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm')
    ) x(rubrica, base_cents, aliquota, motivo, formula, base_legal, fonte_url)

  UNION ALL
  -- Lucro Real: só débitos brutos e encargos de base observável são calculados.
  SELECT b.mes, 'real', 'lucro_real', NULL::text,
         x.rubrica, x.natureza, x.base_cents, x.aliquota, x.valor_cents,
         x.incluido, false, false, NULL::text, x.formula, x.base_legal, x.fonte_url,
         'baixa', b.receita_nota_cents, b.receita_caixa_cents, NULL::bigint,
         NULL::numeric, NULL::numeric, NULL::boolean, NULL::text, NULL::text, NULL::boolean
    FROM base_anexo b
    CROSS JOIN LATERAL (
      VALUES
        ('PIS — débito bruto'::text, 'tributo'::text, b.receita_nota_cents::bigint,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='PIS'),
         round(b.receita_nota_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='PIS'))::bigint,
         true, 'débito bruto = notas Asaas autorizadas x 1,65%; créditos aparecem em lacuna separada',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='PIS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='PIS')),
        ('COFINS — débito bruto', 'tributo', b.receita_nota_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='COFINS'),
         round(b.receita_nota_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='COFINS'))::bigint,
         true, 'débito bruto = notas Asaas autorizadas x 7,6%; créditos aparecem em lacuna separada',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='COFINS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='COFINS')),
        ('CPP sobre pró-labore', 'encargo', b.pro_labore_proxy_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE'),
         round(b.pro_labore_proxy_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE'))::bigint,
         true, 'proxy = saídas 6.02 no ledger x 20%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_PRO_LABORE')),
        ('CPP sobre remuneração CLT', 'encargo', b.salario_clt_proxy_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO'),
         round(b.salario_clt_proxy_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO'))::bigint,
         true, 'proxy = saídas 6.01 não ligadas a MEI confirmado x 20%',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='CPP_EMPREGADO')),
        ('FGTS (custo comum)', 'encargo_comum', b.salario_clt_proxy_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='FGTS'),
         round(b.salario_clt_proxy_cents * (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='FGTS'))::bigint,
         false, 'mostrado para transparência, fora do subtotal porque não diferencia os regimes',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='FGTS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='FGTS'))
    ) x(rubrica, natureza, base_cents, aliquota, valor_cents, incluido, formula, base_legal, fonte_url)

  UNION ALL
  SELECT b.mes, 'real', 'lucro_real', NULL::text,
         x.rubrica, 'lacuna', x.base_cents, x.aliquota, NULL::bigint,
         false, true, true, x.motivo, x.formula, x.base_legal, x.fonte_url,
         'indeterminada', b.receita_nota_cents, b.receita_caixa_cents, NULL::bigint,
         NULL::numeric, NULL::numeric, NULL::boolean, NULL::text, NULL::text, NULL::boolean
    FROM base_anexo b
    CROSS JOIN LATERAL (
      VALUES
        ('IRPJ'::text, b.lair_gerencial_cents::bigint,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='IRPJ'),
         'LAIR gerencial não é lucro real. Faltam escrituração, competência confiável, adições, exclusões e prejuízos no LALUR.',
         'base exibida, quando existe, é LAIR gerencial informativo; valor fiscal não calculado',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='IRPJ'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='IRPJ')),
        ('IRPJ adicional', b.lair_gerencial_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='IRPJ_ADICIONAL'),
         'Além da base fiscal ausente, não está cadastrada a opção de apuração anual por estimativa ou trimestral.',
         'não calculado sem forma de apuração e LALUR',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='IRPJ_ADICIONAL'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='IRPJ_ADICIONAL')),
        ('CSLL', b.lair_gerencial_cents,
         (SELECT q.aliquota_nominal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='CSLL'),
         'LAIR gerencial não é base ajustada da CSLL; faltam escrituração e ajustes fiscais.',
         'não calculado sem base fiscal',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='CSLL'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='real' AND q.tributo='CSLL')),
        ('Créditos de PIS/COFINS', NULL::bigint, NULL::numeric,
         'A base não decide, item a item e por competência, quais aquisições geram crédito nos termos dos arts. 3o.',
         'não calculado; débito bruto não é contribuição líquida',
         'Leis 10.637/2002 e 10.833/2003, art. 3o', 'https://www.planalto.gov.br/ccivil_03/leis/2003/L10.833compilado.htm'),
        ('ISS', b.receita_nota_cents, NULL::numeric,
         'Faltam Município de incidência, lei municipal, código de serviço e retenções.',
         'não calculado; a faixa federal de 2% a 5% não autoriza escolher a alíquota local',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='ISS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='ISS')),
        ('RAT/FAP', b.salario_clt_proxy_cents, NULL::numeric,
         'Faltam CNAE preponderante, grau de risco e FAP.', 'não calculado; nenhuma taxa usual é presumida',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='RAT'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='RAT')),
        ('Terceiros', b.salario_clt_proxy_cents, NULL::numeric,
         'Faltam CNAE, código FPAS e enquadramento.', 'não calculado; nenhum percentual de mercado é usado',
         (SELECT q.base_legal FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='TERCEIROS'),
         (SELECT q.fonte_url FROM prm q WHERE q.mes=b.mes AND q.regime='comum' AND q.tributo='TERCEIROS')),
        ('Receita e segregação por atividade', b.receita_nota_cents, NULL::numeric,
         'A base fiscal contém somente notas Asaas; faltam notas externas e validação da natureza de cada receita.',
         'receita externa não é arbitrada como zero',
         'Decreto-Lei 1.598/1977 art. 12 e legislação de cada tributo', 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del1598.htm'),
        ('Folha, pró-labore e MEIs', b.folha_total_proxy_cents, NULL::numeric,
         'O ledger não substitui eSocial/folha; MEIs, reembolsos e documentos de serviços tomados afetam despesas e bases fiscais.',
         'bases de encargos mostradas são proxies; efeito no lucro real permanece indeterminado',
         'Lei 8.212/1991 art. 22 e legislação do lucro real', 'https://www.planalto.gov.br/ccivil_03/leis/L8212cons.htm'),
        ('CBS/IBS — transição 2026', b.receita_nota_cents, NULL::numeric,
         'O efeito líquido depende do regime, das compensações e do cumprimento das condições/obrigações acessórias; a base não registra essa evidência.',
         'não calculado; taxas legais conhecidas não bastam para afirmar valor devido',
         'LC 214/2025 arts. 343, 346 e 348', 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm')
    ) x(rubrica, base_cents, aliquota, motivo, formula, base_legal, fonte_url)
)
SELECT * FROM linhas;

COMMENT ON VIEW fin_regime_comparativo_v IS
  'Memória gerencial mensal dos cenários Simples Anexo III, Simples Anexo V, Lucro Presumido e '
  'Lucro Real. Cada UNION conserva a mesma semântica: base_cents é a base da rubrica; aliquota é '
  'a taxa legal quando aplicável; valor_cents fica NULL quando não é apurável; indeterminado e '
  'motivo_indeterminacao tornam a lacuna explícita. ISS, RAT/Terceiros, Fator R, cobertura de '
  'receita, MEIs, LALUR, créditos de PIS/COFINS e transição CBS/IBS aparecem como linhas e nunca '
  'como zero. Fator R e indicações de anexo são proxies do ledger, não apuração. Saída gerencial '
  'sujeita a validação do contador; não usar subtotal conhecido como ranking de regimes.';

-- ==========================================================================
-- 3. RESUMO SEM FALSA COMPARABILIDADE
-- ==========================================================================

CREATE OR REPLACE VIEW fin_regime_resumo_v AS
SELECT mes,
       regime,
       cenario,
       anexo,
       max(receita_nota_cents)::bigint AS receita_nota_cents,
       max(receita_caixa_cents)::bigint AS receita_caixa_cents,
       COALESCE(sum(valor_cents) FILTER (WHERE incluido_no_subtotal), 0)::bigint
         AS subtotal_conhecido_cents,
       count(*) FILTER (WHERE incluido_no_subtotal AND valor_cents IS NOT NULL)::integer
         AS rubricas_calculadas,
       count(*) FILTER (WHERE bloqueia_comparacao)::integer AS lacunas_bloqueantes,
       array_agg(DISTINCT rubrica ORDER BY rubrica) FILTER (WHERE bloqueia_comparacao)
         AS lacunas,
       NOT bool_or(bloqueia_comparacao) AS cenario_completo,
       CASE WHEN bool_or(bloqueia_comparacao) THEN NULL
            ELSE COALESCE(sum(valor_cents) FILTER (WHERE incluido_no_subtotal), 0)::bigint END
         AS total_comparavel_cents
  FROM fin_regime_comparativo_v
 GROUP BY mes, regime, cenario, anexo;

COMMENT ON VIEW fin_regime_resumo_v IS
  'Resumo dos valores conhecidos sem fabricar ranking. subtotal_conhecido_cents soma somente '
  'rubricas calculadas, mas total_comparavel_cents é NULL enquanto existir qualquer lacuna '
  'bloqueante. Um cenário só pode ser comparado quando cenario_completo=true.';
