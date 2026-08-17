-- 0110_fin_emprestimo.sql
-- O Pronampe da CAIXA modelado a partir do contrato real, e a visao de caixa
-- por conta com historico.
--
-- O pedido, nas palavras do Fernando:
--
--   "gostaria de ver o total e tbm ver detalhado por conta o atual e tbm
--    historico (graficos invididuais e coletivos no tempo (empilhado)"
--   "quero que o valor contribuido e transferido para a conta da caixa seja
--    100% considerado para Emprestimo Pronampe... pegar todo historico de
--    transferencias para essa conta do asaas, inter, nubank e deixar detalhado
--    o extrato de movimentacao para ela, mostrando quando iniciou, o valor por
--    mes, valor total, qtd de parcelas"
--   "nao consigo extrato real por enquanto entao preciso que vc estime...
--    analise de acordo com as transferencias o valor que deve estar atual"
--
-- ==========================================================================
-- O QUE ESTA MIGRATION DESCOBRIU, EM ORDEM DE IMPORTANCIA
-- ==========================================================================
--
-- 1. A TAXA NAO E FIXA, E ISSO EXPLICA A DIVERGENCIA QUE PARECIA ERRO.
--    O item 2 da CCB declara "Taxa de Juros 0,486755" e "Valor da Prestacao
--    R$ 4.683,50". Os pagamentos observados sao de R$ 6.000,00 a R$ 6.300,00 —
--    34% acima. Isso NAO e amortizacao extra, encargo por atraso nem erro de
--    leitura: e a mesma divida com Selic maior.
--
--    A Clausula Segunda diz "juros remuneratorios... capitalizados
--    mensalmente... Tabela Price"; a Quarta, Paragrafo Primeiro, diz que os
--    juros sao "calculados pela incidencia da taxa contratada, ACRESCIDA DA
--    SELIC"; o Paragrafo Segundo diz "Poderao ocorrer variacoes nas prestacoes
--    mensais devido a incidencia da SELIC"; e o item 2 chama as taxas de
--    "pos-fixadas". Logo 0,486755% a.m. e o SPREAD, nao a taxa total.
--
--    A prova de que a leitura esta certa e aritmetica e cai ao centavo: com o
--    spread SOZINHO, 11 meses de capitalizacao sobre R$ 150.000,00 dao
--    R$ 158.229,81, e a Price de 37 parcelas sobre esse saldo da
--    R$ 4.683,50 — exatamente a prestacao impressa no contrato. O spread e a
--    taxa que gerou a prestacao contratual; a Selic e o que a fez subir.
--
-- 2. A CONTRADICAO 48 x 37 NAO E CONTRADICAO — SAO GRANDEZAS DIFERENTES.
--    O item 2 diz "N Parcelas/Prazos 0048" e "Prazo de Carencia 11"; o campo
--    Forma de Pagamento diz "apos o prazo de carencia, havera pagamento de 37
--    prestacoes mensais". 11 + 37 = 48. O 48 e o PRAZO TOTAL EM MESES, o 37 e
--    o NUMERO DE PRESTACOES. As datas fecham sozinhas: liberacao 02/04/2024,
--    1a parcela 02/04/2025 (12 meses depois, ou seja, 11 meses de carencia
--    mais o mes da propria parcela) e vencimento 02/04/2028 — de 02/04/2025 a
--    02/04/2028 ha exatamente 37 vencimentos mensais.
--
-- 3. A BUSCA ANTERIOR PROCUROU PELA CONTRAPARTE ERRADA.
--    As transferencias para a Caixa NAO tem o CNPJ da CAIXA (00.360.305/0001-04)
--    no campo de contraparte. Elas tem o CNPJ DA PROPRIA XPE —
--    34.776.108/0001-92 — porque sao transferencia para conta propria: o
--    dinheiro sai do Inter e entra na conta da XPE na Caixa, que e a conta de
--    debito das prestacoes (1030.003.4681-8, item 2 da CCB). O nome
--    "CAIXA ECONOMICA FEDERAL" no campo contraparte e a INSTITUICAO DE
--    DESTINO, nao o favorecido. O favorecido e "Xpe Tecnologia", que e o
--    trade_name de fin_entity id 1, CNPJ identico ao do EMITENTE da CCB.
--
--    Procurar por CNPJ 00360305 devolve zero linhas para sempre. A chave certa
--    e (counterparty_document = CNPJ da entidade) E (instituicao de destino =
--    caixa). Esta migration grava a chave em fin_emprestimo.conta_destino_chave
--    para ninguem ter de redescobrir.
--
-- 4. NAO HA TRANSFERENCIA DO ASAAS NEM DO NUBANK — E ISSO E MEDIDA, NAO
--    AUSENCIA DE BUSCA, MAS SO PARA O ASAAS.
--    O Fernando citou "asaas, inter, nubank". Varrendo o acervo inteiro pela
--    chave certa: 5 lancamentos, TODOS do Inter. As duas saidas do Nubank com
--    o CNPJ da XPE (02/03/2026 R$ 2.652,50 e 23/07/2026 R$ 1.044,00) estao
--    'pareado' com pernas do Inter, nao da Caixa.
--
--    A forca da afirmacao MUDA por conta, e essa distincao e o ponto:
--      asaas ... coberto desde 12/05/2021, sem lacuna -> "nunca transferiu
--                para a Caixa" e AFIRMACAO SOBRE O DINHEIRO.
--      inter ... coberto desde 01/01/2026 -> antes disso e AFIRMACAO SOBRE O
--                DADO: nao se sabe.
--      nubank .. coberto desde 02/01/2026 -> idem.
--    Como as prestacoes 1 a 9 (04/2025 a 12/2025) vencem antes de 01/01/2026,
--    o funding delas so seria visivel se tivesse saido do Asaas. Nao saiu. De
--    onde saiu, ninguem sabe. Duvida 4 de novo, agora com preco.
--
-- 5. METADE DAS PRESTACOES DA JANELA COBERTA NAO TEM FUNDING NENHUM.
--    Na janela em que TODAS as contas do ledger enxergam (01/01/2026 em
--    diante) venceram 8 prestacoes, somando R$ 50.402,70 pelo modelo. As
--    transferencias observadas somam R$ 25.400,00 — 50,4%. Os meses de
--    fevereiro, maio e junho de 2026 nao tem transferencia nenhuma, e janeiro
--    tem R$ 650,00, que nao paga prestacao de R$ 6.334,00.
--
--    O buraco de R$ 25.002,70 e quase exatamente 4 prestacoes. Esta migration
--    NAO escolhe entre as explicacoes possiveis, e elas sao pelo menos tres:
--      a) a conta na Caixa tinha saldo proprio e pagou sozinha;
--      b) outra origem, fora do ledger, financiou a conta;
--      c) as prestacoes nao foram pagas (e ai ha encargo por atraso, e o
--         saldo devedor real e MAIOR que o modelado).
--    O extrato da conta na Caixa decide em um minuto. Duvida 67.
--
-- 6. O QUE SE TRANSFERE NAO E O QUE SE PAGA, E O MODELO NAO FINGE QUE E.
--    A prestacao e DEBITADA na conta 1030.003.4681-8 pela propria CAIXA
--    (Clausula Quinta). A transferencia do Inter ABASTECE essa conta. Sao dois
--    eventos distintos, e os valores confirmam: R$ 6.000,00, R$ 6.150,00 e
--    R$ 6.300,00 sao numeros redondos, e nenhuma Price produz numero redondo.
--
--    Mesmo assim o modelo bate onde da para conferir. Prestacao modelada
--    contra transferencia observada:
--      02/03/2026  modelo 6.203,15  observado 6.000,00  +3,39%
--      02/04/2026  modelo 6.407,21  observado 6.150,00  +4,18%
--      02/07/2026  modelo 6.296,20  observado 6.300,00  -0,06%
--      02/08/2026  modelo 6.290,51  observado 6.300,00  -0,15%
--    Erro absoluto medio 1,94%, com sinal trocando — ou seja, sem vies. Duas
--    das quatro caem a menos de R$ 10,00 da prestacao modelada, o que e forte
--    demais para coincidencia num numero de quatro digitos.
--
-- ==========================================================================
-- O QUE ESTA MIGRATION NAO FAZ
-- ==========================================================================
--
-- - NAO escreve em fin_transaction, nem em classified_by/classified_rule_id.
-- - NAO cria conta, nao muda saldo de conta, nao mexe na ancora por conta.
--   O saldo devedor e PASSIVO. Dinheiro que a empresa deve nao e dinheiro que
--   a empresa tem, e somar as duas coisas e o erro que a tela existe para nao
--   cometer.
-- - NAO fecha o F1. Modelar o emprestimo nao cria cobertura de extrato das
--   contas caixa-aplicacao e caixa-emprestimo. F1 continua falhando, e deve.
-- - NAO inventa Selic futura. Da parcela 18 em diante a taxa e CENARIO,
--   carimbado linha a linha, usando a ultima Selic observada.
-- - NAO da saldo a caixa-aplicacao. Sem extrato, ela e indeterminada — nunca
--   R$ 0,00.

-- ==========================================================================
-- 0. DINHEIRO EM PORTUGUÊS, SEM DEPENDER DA LOCALE DO SERVIDOR
-- ==========================================================================
--
-- `to_char(x, 'FM999G999G990D00')` parece a forma certa e não é: G e D leem
-- `lc_numeric`, que neste servidor é C. A memória de cálculo saía escrita
-- "R$ 150,000.00" — número americano numa tela em português, e num campo cuja
-- razão de existir é ser lido por gente.
--
-- ',' e '.' literais no template NÃO dependem de locale. Formata-se com eles e
-- trocam-se os papéis. O resultado é o mesmo em qualquer servidor.

CREATE OR REPLACE FUNCTION fin_brl(cents bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN cents IS NULL THEN NULL ELSE
    'R$ ' || replace(replace(replace(
      to_char(cents / 100.0, 'FM999,999,999,990.00'),
      ',', '#'), '.', ','), '#', '.')
  END
$$;

COMMENT ON FUNCTION fin_brl(bigint) IS
  'Formata centavos em real com separadores pt-BR, independente de lc_numeric.';

-- ==========================================================================
-- 1. O CONTRATO
-- ==========================================================================

CREATE TABLE IF NOT EXISTS fin_emprestimo (
  id                          bigserial PRIMARY KEY,
  entity_id                   bigint NOT NULL REFERENCES fin_entity(id),

  -- identificacao no papel
  ccb                         text NOT NULL,
  linha                       text NOT NULL,
  credor                      text NOT NULL,
  credor_documento            text NOT NULL,
  emitente                    text NOT NULL,
  emitente_documento          text NOT NULL,

  -- dinheiro
  principal_cents             bigint NOT NULL,
  liquido_liberado_cents      bigint NOT NULL,
  iof_cents                   bigint NOT NULL,
  tac_cents                   bigint NOT NULL,

  -- prazo. As duas grandezas separadas de proposito: confundi-las e a
  -- "contradicao 48 x 37" que nao existe.
  prazo_total_meses           int NOT NULL,
  carencia_meses              int NOT NULL,
  prestacoes                  int NOT NULL,

  -- taxa
  prestacao_contratual_cents  bigint NOT NULL,
  spread_mensal               numeric(12,9) NOT NULL,
  indexador                   text,
  indexador_composicao        text,
  cet_mensal_declarado        numeric(8,6),
  cet_anual_declarado         numeric(8,6),

  -- datas
  liberacao_em                date NOT NULL,
  primeira_parcela_em         date NOT NULL,
  vencimento_em               date NOT NULL,

  -- onde o dinheiro encosta
  conta_debito_contrato       text,
  conta_destino_chave         text,
  account_id                  bigint REFERENCES fin_account(id),

  -- proveniencia
  fonte_arquivo               text NOT NULL,
  fonte_observacao            text,
  criado_em                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_emprestimo_ccb_uk UNIQUE (ccb),
  -- 11 + 37 = 48. O banco recusa quem tentar "resolver" a contradicao
  -- escolhendo um dos dois numeros.
  CONSTRAINT fin_emprestimo_prazo_fecha
    CHECK (carencia_meses + prestacoes = prazo_total_meses),
  CONSTRAINT fin_emprestimo_iof_fecha
    CHECK (liquido_liberado_cents + iof_cents + tac_cents = principal_cents),
  CONSTRAINT fin_emprestimo_composicao
    CHECK (indexador_composicao IS NULL
           OR indexador_composicao IN ('multiplicativa','aditiva')),
  -- Indexador declarado obriga a dizer COMO compoe. "Selic" sozinho nao e
  -- formula.
  CONSTRAINT fin_emprestimo_indexador_com_composicao
    CHECK (indexador IS NULL OR indexador_composicao IS NOT NULL)
);

COMMENT ON TABLE fin_emprestimo IS
  'Emprestimos contratados, transcritos do contrato. Passivo: nunca entra em '
  'saldo de conta.';
COMMENT ON COLUMN fin_emprestimo.spread_mensal IS
  'O campo "Taxa de Juros" do item 2 da CCB. E SPREAD, nao taxa total: a '
  'Clausula Quarta Par. 1o manda acrescer a Selic. Com o spread sozinho a '
  'Price reproduz a prestacao contratual ao centavo, o que prova a leitura.';
COMMENT ON COLUMN fin_emprestimo.prazo_total_meses IS
  'Meses de vigencia (campo "N Parcelas/Prazos" = 0048). NAO e o numero de '
  'prestacoes.';
COMMENT ON COLUMN fin_emprestimo.prestacoes IS
  'Prestacoes efetivamente pagas apos a carencia (campo Forma de Pagamento = '
  '37).';
COMMENT ON COLUMN fin_emprestimo.conta_destino_chave IS
  'Chave com que o ledger nomeia a conta de destino. Guardada aqui porque a '
  'busca obvia (CNPJ da CAIXA) devolve zero para sempre: a contraparte '
  'gravada e o CNPJ da propria XPE.';

INSERT INTO fin_emprestimo (
  entity_id, ccb, linha, credor, credor_documento, emitente, emitente_documento,
  principal_cents, liquido_liberado_cents, iof_cents, tac_cents,
  prazo_total_meses, carencia_meses, prestacoes,
  prestacao_contratual_cents, spread_mensal, indexador, indexador_composicao,
  cet_mensal_declarado, cet_anual_declarado,
  liberacao_em, primeira_parcela_em, vencimento_em,
  conta_debito_contrato, conta_destino_chave, account_id,
  fonte_arquivo, fonte_observacao
)
SELECT
  e.id,
  '0.000.000.002.266.602',
  'pronampe',
  'CAIXA ECONOMICA FEDERAL',
  '00360305000104',
  'XP ENERGY SERVICOS DE MEDICAO DE ENERGIA LTDA',
  '34776108000192',
  15000000, 14706210, 293790, 0,
  48, 11, 37,
  468350, 0.004867550, 'selic', 'multiplicativa',
  0.004900, 0.060000,
  DATE '2024-04-02', DATE '2025-04-02', DATE '2028-04-02',
  '1030.003.4681-8',
  'caixa-economica-12920000005783083433',
  (SELECT id FROM fin_account WHERE slug = 'caixa-emprestimo'),
  'emprestimo/Contrato de Financiamento PRONAMPE - XPE-1.docx',
  'Cedula de Credito Bancario - Emprestimo PJ com Garantia FGO, form. 33.453 '
  'v028. Item 2 (Dados do Credito) e item 3 (Custo Efetivo Total) transcritos '
  'campo a campo. O CET declarado (0,49% a.m. / 6,00% a.a.) coincide com o '
  'spread e NAO embute o IOF de R$ 2.937,90 que foi retido na liberacao; '
  'sobre o liquido de R$ 147.062,10 o custo efetivo e maior que o declarado. '
  'Nao corrigido aqui: o que se transcreve e o que o contrato diz.'
FROM fin_entity e
WHERE e.slug = 'xpe'
  AND NOT EXISTS (SELECT 1 FROM fin_emprestimo WHERE ccb = '0.000.000.002.266.602');

-- ==========================================================================
-- 2. O INDEXADOR — SELIC DE FONTE PRIMARIA, PERIODO A PERIODO
-- ==========================================================================
--
-- Mesma disciplina da 0107 com a legislacao: a serie vem do Banco Central, com
-- URL, data de consulta e o numero de dias uteis que entrou em cada fator. Nao
-- ha taxa "de memoria" aqui — a Selic mudou varias vezes no periodo.
--
-- O fator e acumulado no intervalo SEMIABERTO (de, ate], que e o intervalo de
-- competencia da prestacao: o dia do vencimento anterior nao rende duas vezes.

CREATE TABLE IF NOT EXISTS fin_emprestimo_indexador (
  emprestimo_id   bigint NOT NULL REFERENCES fin_emprestimo(id) ON DELETE CASCADE,
  periodo         int    NOT NULL,
  competencia_de  date   NOT NULL,
  competencia_ate date   NOT NULL,
  fator           numeric(18,10) NOT NULL,
  dias_uteis      int    NOT NULL,
  origem          text   NOT NULL,
  fonte_serie     text   NOT NULL,
  fonte_url       text   NOT NULL,
  consultado_em   date   NOT NULL,
  PRIMARY KEY (emprestimo_id, periodo),
  CONSTRAINT fin_emprestimo_indexador_origem
    CHECK (origem IN ('observada','cenario')),
  CONSTRAINT fin_emprestimo_indexador_fator CHECK (fator > 0),
  CONSTRAINT fin_emprestimo_indexador_janela CHECK (competencia_ate > competencia_de),
  -- Fonte primaria ou nao entra. A serie do BCB e a unica que decide taxa aqui.
  CONSTRAINT fin_emprestimo_indexador_fonte_primaria
    CHECK (fonte_url LIKE 'https://api.bcb.gov.br/%'
        OR fonte_url LIKE 'https://www.bcb.gov.br/%')
);

COMMENT ON TABLE fin_emprestimo_indexador IS
  'Selic acumulada em cada periodo de competencia da prestacao, medida na '
  'serie diaria SGS 11 do Banco Central. Uma linha por periodo OBSERVADO; '
  'periodo sem linha e cenario, e o cronograma o carimba como tal.';

INSERT INTO fin_emprestimo_indexador
  (emprestimo_id, periodo, competencia_de, competencia_ate, fator, dias_uteis,
   origem, fonte_serie, fonte_url, consultado_em)
SELECT emp.id, v.periodo, v.de, v.ate, v.fator, v.du, v.origem,
       'SGS 11 - Taxa de juros - Selic (% a.d.)',
       'https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados?formato=json&dataInicial=01/04/2024&dataFinal=17/08/2026',
       DATE '2026-08-17'
FROM fin_emprestimo emp
CROSS JOIN (VALUES
  (1, DATE '2024-04-02', DATE '2024-05-02', 1.0084692492, 21, 'observada'),
  (2, DATE '2024-05-02', DATE '2024-06-02', 1.0079195591, 20, 'observada'),
  (3, DATE '2024-06-02', DATE '2024-07-02', 1.0086751167, 22, 'observada'),
  (4, DATE '2024-07-02', DATE '2024-08-02', 1.0090712234, 23, 'observada'),
  (5, DATE '2024-08-02', DATE '2024-09-02', 1.0082791655, 21, 'observada'),
  (6, DATE '2024-09-02', DATE '2024-10-02', 1.0087656638, 22, 'observada'),
  (7, DATE '2024-10-02', DATE '2024-11-02', 1.0088743311, 22, 'observada'),
  (8, DATE '2024-11-02', DATE '2024-12-02', 1.0079479285, 19, 'observada'),
  (9, DATE '2024-12-02', DATE '2025-01-02', 1.0093501869, 21, 'observada'),
  (10, DATE '2025-01-02', DATE '2025-02-02', 1.0096724813, 21, 'observada'),
  (11, DATE '2025-02-02', DATE '2025-03-02', 1.0098532226, 20, 'observada'),
  (12, DATE '2025-03-02', DATE '2025-04-02', 1.0107013225, 21, 'observada'),
  (13, DATE '2025-04-02', DATE '2025-05-02', 1.0100282183, 19, 'observada'),
  (14, DATE '2025-05-02', DATE '2025-06-02', 1.0114052969, 21, 'observada'),
  (15, DATE '2025-06-02', DATE '2025-07-02', 1.0115366158, 21, 'observada'),
  (16, DATE '2025-07-02', DATE '2025-08-02', 1.0121992895, 22, 'observada'),
  (17, DATE '2025-08-02', DATE '2025-09-02', 1.0121992895, 22, 'observada'),
  (18, DATE '2025-09-02', DATE '2025-10-02', 1.0121992895, 22, 'observada'),
  (19, DATE '2025-10-02', DATE '2025-11-02', 1.0116415614, 21, 'observada'),
  (20, DATE '2025-11-02', DATE '2025-12-02', 1.0116415614, 21, 'observada'),
  (21, DATE '2025-12-02', DATE '2026-01-02', 1.0116415614, 21, 'observada'),
  (22, DATE '2026-01-02', DATE '2026-02-02', 1.0116415614, 21, 'observada'),
  (23, DATE '2026-02-02', DATE '2026-03-02', 1.0099702203, 18, 'observada'),
  (24, DATE '2026-03-02', DATE '2026-04-02', 1.0126610185, 23, 'observada'),
  (25, DATE '2026-04-02', DATE '2026-05-02', 1.0098043258, 18, 'observada'),
  (26, DATE '2026-05-02', DATE '2026-06-02', 1.0118141061, 22, 'observada'),
  (27, DATE '2026-06-02', DATE '2026-07-02', 1.0111774739, 21, 'observada'),
  (28, DATE '2026-07-02', DATE '2026-08-02', 1.0110896529, 21, 'observada')
) AS v(periodo, de, ate, fator, du, origem)
WHERE emp.ccb = '0.000.000.002.266.602'
  AND NOT EXISTS (
    SELECT 1 FROM fin_emprestimo_indexador i
     WHERE i.emprestimo_id = emp.id AND i.periodo = v.periodo);

-- ==========================================================================
-- 3. AS PREMISSAS — DECLARADAS, DATADAS E REVISIVEIS
-- ==========================================================================
--
-- O Fernando autorizou tratar 100% do transferido como pagamento do Pronampe.
-- Isso e PREMISSA, nao descoberta, e a diferenca importa: se amanha aparecer
-- transferencia para outra finalidade, a premissa cai e o numero muda. Ela
-- fica gravada com o autor, a data e o que a derruba.

CREATE TABLE IF NOT EXISTS fin_emprestimo_premissa (
  id             bigserial PRIMARY KEY,
  emprestimo_id  bigint NOT NULL REFERENCES fin_emprestimo(id) ON DELETE CASCADE,
  chave          text NOT NULL,
  enunciado      text NOT NULL,
  declarada_por  text NOT NULL,
  declarada_em   date NOT NULL,
  o_que_derruba  text NOT NULL,
  vigente        boolean NOT NULL DEFAULT true,
  revogada_em    date,
  revogada_por   text,
  CONSTRAINT fin_emprestimo_premissa_uk UNIQUE (emprestimo_id, chave),
  -- Premissa sem criterio de queda e dogma. O banco recusa.
  CONSTRAINT fin_emprestimo_premissa_derruba CHECK (length(btrim(o_que_derruba)) > 0),
  CONSTRAINT fin_emprestimo_premissa_revogacao
    CHECK ((vigente AND revogada_em IS NULL AND revogada_por IS NULL)
        OR (NOT vigente AND revogada_em IS NOT NULL AND revogada_por IS NOT NULL))
);

COMMENT ON TABLE fin_emprestimo_premissa IS
  'Premissas declaradas por gente, com data e criterio de queda. Nao sao '
  'achados: sao autorizacoes para seguir com dado faltando.';

INSERT INTO fin_emprestimo_premissa
  (emprestimo_id, chave, enunciado, declarada_por, declarada_em, o_que_derruba)
SELECT emp.id, v.chave, v.enunciado, v.quem, v.quando, v.derruba
FROM fin_emprestimo emp
CROSS JOIN (VALUES
  ('transferencia_100pct_pronampe',
   'Todo valor transferido de conta propria para a conta da XPE na Caixa e '
   'considerado destinado ao Pronampe, em 100%, sem rateio com outra '
   'finalidade.',
   'Fernando (dono)', DATE '2026-08-17',
   'Uma transferencia para a conta da Caixa com finalidade declarada diferente '
   '(aplicacao, tarifa, outro contrato), ou o extrato da conta mostrando saida '
   'que nao seja debito de prestacao. Qualquer um dos dois derruba o rateio de '
   '100% e obriga a separar por finalidade.'),
  ('adimplencia_ate_a_cobertura',
   'As prestacoes vencidas antes de 01/01/2026 sao tratadas como pagas em dia, '
   'porque nenhuma fonte deste acervo enxerga a conta da Caixa nesse periodo.',
   'modelo (0110)', DATE '2026-08-17',
   'O extrato da conta na Caixa, ou qualquer aviso de inadimplencia da CAIXA. '
   'Se houve atraso, incidem multa de 2% e juros de mora de 1% a.m. (Clausula '
   'Nona) e o saldo devedor real e MAIOR que o modelado — o numero desta base '
   'e piso, nunca teto.')
) AS v(chave, enunciado, quem, quando, derruba)
WHERE emp.ccb = '0.000.000.002.266.602'
  AND NOT EXISTS (
    SELECT 1 FROM fin_emprestimo_premissa p
     WHERE p.emprestimo_id = emp.id AND p.chave = v.chave);

-- ==========================================================================
-- 4. AS TRANSFERENCIAS OBSERVADAS — PELA CHAVE CERTA
-- ==========================================================================

CREATE OR REPLACE VIEW fin_emprestimo_transferencia_v AS
SELECT
  emp.id                            AS emprestimo_id,
  t.id                              AS transaction_id,
  a.slug                            AS conta_origem,
  a.name                            AS conta_origem_nome,
  t.posted_on                       AS movimento_em,
  (-t.amount_cents)::bigint         AS valor_cents,
  t.description_raw,
  t.counterparty_raw                AS instituicao_destino,
  t.counterparty_document,
  t.transfer_status,
  t.transfer_unresolved_reason,
  date_trunc('month', t.posted_on::timestamptz)::date AS mes
FROM fin_transaction t
JOIN fin_account a  ON a.id = t.account_id
JOIN fin_entity  e  ON e.id = t.entity_id
JOIN fin_emprestimo emp ON emp.entity_id = e.id
WHERE t.amount_cents < 0
  AND NOT t.is_split_parent
  -- A chave certa: contraparte e a PROPRIA entidade (transferencia para conta
  -- propria) E a instituicao de destino e a Caixa. Procurar pelo CNPJ da CAIXA
  -- devolve zero para sempre.
  AND t.counterparty_document = e.cnpj
  AND (t.counterparty_raw ILIKE '%caixa%'
       OR t.transfer_unresolved_reason ILIKE '%caixa%');

COMMENT ON VIEW fin_emprestimo_transferencia_v IS
  'As transferencias de conta propria para a conta da XPE na Caixa. Chave: '
  'counterparty_document = cnpj da entidade E destino Caixa.';

-- ==========================================================================
-- 5. O CRONOGRAMA — PRICE COM TAXA VARIAVEL, COM MEMORIA DE CALCULO
-- ==========================================================================
--
-- Como se calcula, e por que assim:
--
--   i(t)  = fator_selic(t) x (1 + spread) - 1        (composicao multiplicativa)
--   juros = saldo(t-1) x i(t)
--
--   carencia (t <= 11):  nao ha pagamento; saldo(t) = saldo(t-1) + juros
--                        (Clausula Terceira Par. Unico: "havera capitalizacao
--                         de juros mensais, sendo estes incorporados ao saldo
--                         devedor")
--
--   amortizacao (t > 11): n = prestacoes restantes, inclusive a de agora
--                        pmt   = saldo(t-1) x i / (1 - (1+i)^-n)   [Price]
--                        amort = pmt - juros
--                        saldo(t) = saldo(t-1) + juros - pmt
--
-- Recalcular a Price a cada mes e o que Price pos-fixada faz: a parcela e
-- recomposta com a taxa do periodo sobre o saldo e o prazo que restam. Com
-- taxa constante isso degenera na Price classica de parcela fixa — e e por
-- isso que o teste do spread sozinho reproduz R$ 4.683,50.

CREATE OR REPLACE VIEW fin_emprestimo_cronograma_v AS
WITH RECURSIVE cfg AS (
  SELECT emp.*,
         (SELECT max(periodo) FROM fin_emprestimo_indexador i
           WHERE i.emprestimo_id = emp.id AND i.origem = 'observada') AS ultimo_observado,
         (SELECT i.fator FROM fin_emprestimo_indexador i
           WHERE i.emprestimo_id = emp.id AND i.origem = 'observada'
           ORDER BY i.periodo DESC LIMIT 1) AS fator_cenario
    FROM fin_emprestimo emp
),
taxa AS (
  SELECT c.id AS emprestimo_id,
         g.periodo,
         (c.liberacao_em + ((g.periodo - 1) || ' month')::interval)::date AS competencia_de,
         (c.liberacao_em + (g.periodo || ' month')::interval)::date       AS competencia_ate,
         COALESCE(i.fator, c.fator_cenario)          AS fator_selic,
         COALESCE(i.origem, 'cenario')               AS origem_taxa,
         i.dias_uteis,
         COALESCE(i.fator, c.fator_cenario) * (1 + c.spread_mensal) - 1 AS i_mes
    FROM cfg c
    CROSS JOIN generate_series(1, c.prazo_total_meses) AS g(periodo)
    LEFT JOIN fin_emprestimo_indexador i
           ON i.emprestimo_id = c.id AND i.periodo = g.periodo
),
passo AS (
  SELECT c.id                        AS emprestimo_id,
         0                           AS periodo,
         c.liberacao_em              AS competencia_ate,
         (c.principal_cents / 100.0)::numeric(20,10) AS saldo,
         0::numeric(20,10)           AS juros,
         0::numeric(20,10)           AS prestacao,
         0::numeric(20,10)           AS amortizacao,
         NULL::numeric(20,10)        AS i_mes,
         NULL::text                  AS origem_taxa
    FROM cfg c
  UNION ALL
  SELECT p.emprestimo_id,
         t.periodo,
         t.competencia_ate,
         CASE WHEN t.periodo <= c.carencia_meses
              THEN p.saldo * (1 + t.i_mes)
              ELSE p.saldo * (1 + t.i_mes)
                   - (p.saldo * t.i_mes
                      / (1 - power(1 + t.i_mes, -(c.prazo_total_meses - t.periodo + 1))))
         END::numeric(20,10),
         (p.saldo * t.i_mes)::numeric(20,10),
         CASE WHEN t.periodo <= c.carencia_meses THEN 0
              ELSE p.saldo * t.i_mes
                   / (1 - power(1 + t.i_mes, -(c.prazo_total_meses - t.periodo + 1)))
         END::numeric(20,10),
         CASE WHEN t.periodo <= c.carencia_meses THEN 0
              ELSE p.saldo * t.i_mes
                   / (1 - power(1 + t.i_mes, -(c.prazo_total_meses - t.periodo + 1)))
                   - p.saldo * t.i_mes
         END::numeric(20,10),
         t.i_mes::numeric(20,10),
         t.origem_taxa
    FROM passo p
    JOIN cfg  c ON c.id = p.emprestimo_id
    JOIN taxa t ON t.emprestimo_id = p.emprestimo_id AND t.periodo = p.periodo + 1
)
SELECT
  p.emprestimo_id,
  p.periodo,
  CASE WHEN p.periodo <= c.carencia_meses THEN NULL
       ELSE p.periodo - c.carencia_meses END              AS parcela,
  c.prestacoes                                            AS parcelas_total,
  tx.competencia_de,
  p.competencia_ate                                       AS vencimento_em,
  CASE WHEN p.periodo <= c.carencia_meses THEN 'carencia' ELSE 'amortizacao' END AS fase,
  round(p.i_mes, 8)                                       AS taxa_mes,
  tx.fator_selic,
  round((tx.fator_selic - 1), 8)                          AS selic_mes,
  c.spread_mensal,
  tx.origem_taxa,
  tx.dias_uteis,
  round(p.juros   * 100)::bigint                          AS encargo_cents,
  round(p.prestacao * 100)::bigint                        AS prestacao_cents,
  round(p.amortizacao * 100)::bigint                      AS principal_cents,
  round(p.saldo   * 100)::bigint                          AS saldo_devedor_cents,
  -- O estado NUNCA e so "paga". Ele diz o que se sabe e como se sabe.
  --
  -- E "com funding" NAO basta: em 04/01/2026 entraram R$ 650,00 contra uma
  -- prestacao de R$ 6.334,00 — 10,3%. Chamar isso de mes pago seria pior que
  -- nao ter medido. Por isso o funding e classificado pela SUFICIENCIA, com
  -- corte em 90% da prestacao modelada: acima disso o valor cobre a parcela
  -- dentro da folga de arredondamento das transferencias (que sao redondas);
  -- abaixo, nao cobre e o mes fica exposto.
  CASE
    WHEN p.periodo <= c.carencia_meses                    THEN 'carencia'
    WHEN p.competencia_ate > current_date                 THEN 'futura'
    WHEN fund.valor_cents IS NOT NULL
     AND fund.valor_cents >= 0.90 * round(p.prestacao * 100)
                                                          THEN 'vencida_com_funding_compativel'
    WHEN fund.valor_cents IS NOT NULL                     THEN 'vencida_com_funding_insuficiente'
    WHEN p.competencia_ate < DATE '2026-01-02'            THEN 'vencida_fora_da_cobertura'
    ELSE 'vencida_sem_funding_na_janela_coberta'
  END                                                     AS estado,
  fund.valor_cents                                        AS funding_cents,
  CASE WHEN fund.valor_cents IS NULL OR p.prestacao = 0 THEN NULL
       ELSE round(fund.valor_cents / (p.prestacao * 100), 6) END AS funding_cobertura,
  -- Estimada e tudo o que nao tem extrato da conta debitada. Como nao existe
  -- extrato nenhum da conta na Caixa, TODA linha e estimada. Dizer o contrario
  -- seria fabricar realizado.
  true                                                    AS estimada,
  CASE
    WHEN tx.origem_taxa = 'cenario'
      THEN 'estimada: Selic do periodo nao existe ainda; usada a ultima '
           || 'observada como cenario, e a parcela sobe ou desce com ela'
    WHEN p.competencia_ate < DATE '2026-01-02'
      THEN 'estimada: sem extrato da conta na Caixa e sem cobertura de Inter/'
           || 'Nubank antes de 01/01/2026; so o Asaas enxergaria, e nao ha'
    ELSE 'estimada: sem extrato da conta na Caixa — o debito da prestacao '
           || 'ocorre dentro dela e este acervo nunca o viu'
  END                                                     AS metodo
FROM passo p
JOIN cfg c   ON c.id = p.emprestimo_id
LEFT JOIN taxa tx ON tx.emprestimo_id = p.emprestimo_id AND tx.periodo = p.periodo
LEFT JOIN LATERAL (
  SELECT sum(tr.valor_cents)::bigint AS valor_cents
    FROM fin_emprestimo_transferencia_v tr
   WHERE tr.emprestimo_id = p.emprestimo_id
     AND tr.mes = date_trunc('month', p.competencia_ate::timestamptz)::date
) fund ON true
WHERE p.periodo > 0;

COMMENT ON VIEW fin_emprestimo_cronograma_v IS
  'Price com taxa pos-fixada (Selic x spread), recalculada a cada mes. Toda '
  'linha e estimada e carrega o metodo: nao existe extrato da conta debitada.';

-- ==========================================================================
-- 6. O CONFRONTO — CONTRATO x TRANSFERENCIA, PARCELA A PARCELA
-- ==========================================================================

CREATE OR REPLACE VIEW fin_emprestimo_confronto_v AS
SELECT
  cr.emprestimo_id,
  cr.parcela,
  cr.vencimento_em,
  cr.estado,
  cr.prestacao_cents                       AS modelo_cents,
  emp.prestacao_contratual_cents           AS contrato_cents,
  obs.valor_cents                          AS observado_cents,
  obs.movimento_em                         AS observado_em,
  obs.conta_origem                         AS observado_origem,
  obs.n                                    AS observado_lancamentos,
  CASE WHEN obs.valor_cents IS NULL THEN NULL
       ELSE obs.valor_cents - cr.prestacao_cents END AS diferenca_cents,
  CASE WHEN obs.valor_cents IS NULL OR cr.prestacao_cents = 0 THEN NULL
       ELSE round((obs.valor_cents - cr.prestacao_cents)::numeric
                  / cr.prestacao_cents, 6) END        AS diferenca_pct,
  cr.taxa_mes,
  cr.origem_taxa,
  cr.encargo_cents,
  cr.principal_cents,
  cr.saldo_devedor_cents,
  -- A cobertura do EXTRATO DE ORIGEM, que e a unica que este acervo tem.
  CASE
    WHEN cr.vencimento_em >= DATE '2026-01-02' THEN 'plena'
    WHEN cr.vencimento_em >= DATE '2021-05-12' THEN 'somente_asaas'
    ELSE 'nenhuma'
  END                                      AS cobertura_origem,
  CASE
    WHEN obs.valor_cents IS NOT NULL
      THEN 'transferencia observada no extrato de origem; o debito da '
           || 'prestacao dentro da Caixa continua sem extrato'
    WHEN cr.vencimento_em >= DATE '2026-01-02'
      THEN 'nenhuma transferencia no mes, com as 4 contas do ledger cobertas '
           || '— e ausencia medida, nao falta de busca'
    WHEN cr.vencimento_em >= DATE '2021-05-12'
      THEN 'so o Asaas cobre esta data, e o Asaas nunca transferiu para a '
           || 'Caixa; Inter e Nubank so comecam em 01/01/2026'
    ELSE 'fora de qualquer cobertura'
  END                                      AS leitura
FROM fin_emprestimo_cronograma_v cr
JOIN fin_emprestimo emp ON emp.id = cr.emprestimo_id
LEFT JOIN LATERAL (
  SELECT sum(tr.valor_cents)::bigint AS valor_cents,
         min(tr.movimento_em)        AS movimento_em,
         string_agg(DISTINCT tr.conta_origem, '+') AS conta_origem,
         count(*)                    AS n
    FROM fin_emprestimo_transferencia_v tr
   WHERE tr.emprestimo_id = cr.emprestimo_id
     AND tr.mes = date_trunc('month', cr.vencimento_em::timestamptz)::date
) obs ON true
WHERE cr.fase = 'amortizacao';

COMMENT ON VIEW fin_emprestimo_confronto_v IS
  'Parcela a parcela: o que o modelo preve, o que o contrato declarou na '
  'origem, o que o extrato de origem mostra, e a diferenca — com a forca da '
  'cobertura em cada data.';

-- ==========================================================================
-- 7. O SALDO DEVEDOR DE HOJE, COM A MEMORIA DE CALCULO
-- ==========================================================================

CREATE OR REPLACE VIEW fin_emprestimo_saldo_v AS
WITH ultima AS (
  SELECT DISTINCT ON (cr.emprestimo_id) cr.*
    FROM fin_emprestimo_cronograma_v cr
   WHERE cr.vencimento_em <= current_date
   ORDER BY cr.emprestimo_id, cr.periodo DESC
),
proxima AS (
  SELECT DISTINCT ON (cr.emprestimo_id) cr.*
    FROM fin_emprestimo_cronograma_v cr
   WHERE cr.vencimento_em > current_date
   ORDER BY cr.emprestimo_id, cr.periodo ASC
),
obs AS (
  SELECT emprestimo_id, sum(valor_cents)::bigint AS transferido_cents,
         count(*) AS lancamentos, min(movimento_em) AS primeiro, max(movimento_em) AS ultimo
    FROM fin_emprestimo_transferencia_v GROUP BY emprestimo_id
),
devidas AS (
  SELECT emprestimo_id,
         count(*) FILTER (WHERE estado <> 'futura')                       AS vencidas,
         count(*) FILTER (WHERE estado = 'vencida_com_funding_compativel') AS com_funding,
         count(*) FILTER (WHERE estado = 'vencida_com_funding_insuficiente') AS funding_insuficiente,
         count(*) FILTER (WHERE estado = 'vencida_sem_funding_na_janela_coberta') AS sem_funding_coberta,
         count(*) FILTER (WHERE estado = 'vencida_fora_da_cobertura')     AS fora_da_cobertura,
         count(*) FILTER (WHERE estado = 'futura')                        AS futuras,
         sum(prestacao_cents) FILTER (WHERE estado <> 'futura')::bigint   AS devido_cents,
         sum(prestacao_cents) FILTER (WHERE estado <> 'futura' AND vencimento_em >= DATE '2026-01-02')::bigint
                                                                          AS devido_na_cobertura_cents
    FROM fin_emprestimo_cronograma_v
   WHERE fase = 'amortizacao'
   GROUP BY emprestimo_id
)
SELECT
  emp.id                              AS emprestimo_id,
  emp.ccb,
  emp.linha,
  emp.principal_cents,
  emp.liquido_liberado_cents,
  emp.prestacao_contratual_cents,
  emp.liberacao_em,
  emp.primeira_parcela_em,
  emp.vencimento_em,
  emp.prestacoes,
  emp.carencia_meses,
  u.parcela                           AS ultima_parcela_vencida,
  u.vencimento_em                     AS ultima_parcela_em,
  u.saldo_devedor_cents,
  u.taxa_mes                          AS taxa_ultimo_mes,
  p.prestacao_cents                   AS proxima_prestacao_cents,
  p.vencimento_em                     AS proxima_parcela_em,
  p.origem_taxa                       AS proxima_origem_taxa,
  d.vencidas, d.com_funding, d.funding_insuficiente, d.sem_funding_coberta,
  d.fora_da_cobertura, d.futuras,
  d.devido_cents,
  d.devido_na_cobertura_cents,
  o.transferido_cents,
  o.lancamentos                       AS transferencias,
  o.primeiro                          AS primeira_transferencia_em,
  o.ultimo                            AS ultima_transferencia_em,
  (d.devido_na_cobertura_cents - COALESCE(o.transferido_cents, 0))::bigint
                                      AS lacuna_na_cobertura_cents,
  -- O numero e PISO, e a direcao do erro fica escrita junto dele.
  'piso'                              AS natureza,
  'Saldo pela Price pos-fixada, supondo adimplencia integral. Se alguma '
  || 'prestacao nao foi paga, incidem multa de 2% e juros de mora de 1% a.m. '
  || '(Clausula Nona) e a divida real e MAIOR. Nunca menor.'
                                      AS ressalva,
  'saldo(0) = ' || fin_brl(emp.principal_cents)
  || ' -> ' || emp.carencia_meses || ' meses de carencia capitalizando a '
  || 'Selic x spread -> ' || (u.periodo - emp.carencia_meses)
  || ' de ' || emp.prestacoes || ' prestacoes ja vencidas -> saldo em '
  || to_char(u.vencimento_em, 'DD/MM/YYYY') || ' = '
  || fin_brl(u.saldo_devedor_cents)
                                      AS memoria
FROM fin_emprestimo emp
LEFT JOIN ultima  u ON u.emprestimo_id = emp.id
LEFT JOIN proxima p ON p.emprestimo_id = emp.id
LEFT JOIN obs     o ON o.emprestimo_id = emp.id
LEFT JOIN devidas d ON d.emprestimo_id = emp.id;

COMMENT ON VIEW fin_emprestimo_saldo_v IS
  'O saldo devedor de hoje com memoria de calculo e a direcao do erro. E '
  'PASSIVO: nao entra em saldo de conta nem em dinheiro disponivel.';

-- ==========================================================================
-- 8. O EXTRATO ESTIMADO DA CONTA NA CAIXA
-- ==========================================================================
--
-- Movimento a movimento, com a origem de cada linha declarada:
--   'transferencia_observada' — esta no extrato do Inter, e fato sobre a
--                               ORIGEM (nao sobre a conta da Caixa)
--   'debito_estimado'         — a prestacao que a CAIXA debita, modelada
--
-- O saldo corrente que sai daqui NAO e saldo de conta: e o descasamento entre
-- o que entrou e o que o modelo diz que saiu. Negativo significa que faltou
-- funding visivel, nao que a conta esteja negativa.

CREATE OR REPLACE VIEW fin_caixa_extrato_estimado_v AS
WITH mov AS (
  SELECT tr.emprestimo_id, tr.movimento_em AS data, 'entrada' AS sentido,
         tr.valor_cents AS valor_cents,
         'transferencia de ' || tr.conta_origem_nome AS descricao,
         'transferencia_observada' AS origem,
         false AS estimado,
         'lancamento real no extrato de origem (' || tr.conta_origem
         || '); a chegada na Caixa nao foi conferida' AS metodo,
         tr.transaction_id
    FROM fin_emprestimo_transferencia_v tr
  UNION ALL
  SELECT cr.emprestimo_id, cr.vencimento_em, 'saida',
         -cr.prestacao_cents,
         'debito da prestacao ' || cr.parcela || '/' || cr.parcelas_total,
         'debito_estimado', true,
         cr.metodo, NULL::bigint
    FROM fin_emprestimo_cronograma_v cr
   WHERE cr.fase = 'amortizacao'
     AND cr.vencimento_em <= current_date
)
SELECT
  m.emprestimo_id,
  m.data,
  m.sentido,
  m.valor_cents,
  m.descricao,
  m.origem,
  m.estimado,
  m.metodo,
  m.transaction_id,
  sum(m.valor_cents) OVER (PARTITION BY m.emprestimo_id
                           ORDER BY m.data, m.sentido DESC, m.descricao
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::bigint
                                                   AS descasamento_acumulado_cents,
  date_trunc('month', m.data::timestamptz)::date   AS mes
FROM mov m;

COMMENT ON VIEW fin_caixa_extrato_estimado_v IS
  'Extrato ESTIMADO da conta da XPE na Caixa. Entrada = transferencia real na '
  'origem; saida = prestacao modelada. O acumulado e descasamento, nao saldo.';

-- ==========================================================================
-- 9. A VISAO DE CAIXA — POR CONTA, HOJE E NO TEMPO
-- ==========================================================================
--
-- Regra que a tela existe para nao quebrar: conta sem extrato e
-- INDETERMINADA, nunca R$ 0,00. caixa-aplicacao continua sem uma linha de
-- extrato e por isso continua sem saldo — hachurada, com o motivo.

CREATE OR REPLACE VIEW fin_caixa_conta_v AS
SELECT
  a.id                                AS account_id,
  a.slug,
  a.name,
  a.institution,
  a.kind,
  a.is_active,
  a.opening_balance_date,
  a.last_statement_at,
  mv.lancamentos,
  mv.primeiro_movimento,
  mv.ultimo_movimento,
  CASE WHEN mv.lancamentos > 0
       THEN (a.opening_balance_cents + mv.soma_cents)::bigint END AS saldo_cents,
  CASE WHEN mv.lancamentos > 0 THEN NULL
       WHEN a.kind = 'emprestimo'
         THEN 'conta de debito do Pronampe: nunca teve extrato neste acervo. '
              || 'O que se sabe dela e o saldo DEVEDOR do contrato, que e '
              || 'passivo e nao entra aqui.'
       ELSE 'sem extrato: nenhuma fonte deste acervo alimenta esta conta. '
            || 'Ausencia de dado nao e saldo zero.'
  END                                 AS motivo_sem_saldo,
  (mv.lancamentos > 0)                AS tem_cobertura,
  -- Passivo associado, quando houver. Fica em coluna SEPARADA de proposito:
  -- somar isso a saldo_cents seria dizer que a divida e dinheiro.
  emp.saldo_devedor_cents             AS passivo_saldo_devedor_cents,
  emp.ccb                             AS passivo_ccb,
  emp.natureza                        AS passivo_natureza,
  emp.memoria                         AS passivo_memoria
FROM fin_account a
LEFT JOIN LATERAL (
  SELECT count(*) AS lancamentos, sum(t.amount_cents) AS soma_cents,
         min(t.posted_on) AS primeiro_movimento, max(t.posted_on) AS ultimo_movimento
    FROM fin_transaction t
   WHERE t.account_id = a.id AND NOT t.is_split_parent
) mv ON true
LEFT JOIN fin_emprestimo_saldo_v emp ON emp.emprestimo_id = (
  SELECT e2.id FROM fin_emprestimo e2 WHERE e2.account_id = a.id LIMIT 1)
WHERE a.is_active;

COMMENT ON VIEW fin_caixa_conta_v IS
  'Saldo de hoje por conta. Conta sem extrato tem saldo NULL e motivo — nunca '
  'zero. O passivo do emprestimo vem em coluna separada e nao soma.';

CREATE OR REPLACE VIEW fin_caixa_serie_mensal_v AS
WITH mes AS (
  SELECT a.id AS account_id, a.slug, a.name, g.mes::date AS mes
    FROM fin_account a
    CROSS JOIN LATERAL generate_series(
      date_trunc('month', COALESCE(
        (SELECT min(t.posted_on) FROM fin_transaction t WHERE t.account_id = a.id),
        a.opening_balance_date)::timestamptz),
      date_trunc('month', current_date::timestamptz),
      interval '1 month') AS g(mes)
   WHERE a.is_active
     AND EXISTS (SELECT 1 FROM fin_transaction t WHERE t.account_id = a.id)
),
agg AS (
  SELECT m.account_id, m.slug, m.name, m.mes,
         COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS entradas_cents,
         COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS saidas_cents,
         COALESCE(sum(t.amount_cents), 0)::bigint AS movimento_cents,
         count(t.id) AS lancamentos
    FROM mes m
    LEFT JOIN fin_transaction t
           ON t.account_id = m.account_id
          AND NOT t.is_split_parent
          AND date_trunc('month', t.posted_on::timestamptz)::date = m.mes
   GROUP BY m.account_id, m.slug, m.name, m.mes
)
SELECT
  agg.account_id, agg.slug, agg.name, agg.mes,
  agg.entradas_cents, agg.saidas_cents, agg.movimento_cents, agg.lancamentos,
  (a.opening_balance_cents
   + sum(agg.movimento_cents) OVER (PARTITION BY agg.account_id
                                    ORDER BY agg.mes
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  )::bigint AS saldo_fim_cents
FROM agg
JOIN fin_account a ON a.id = agg.account_id;

COMMENT ON VIEW fin_caixa_serie_mensal_v IS
  'Serie mensal por conta: entradas, saidas e saldo ao fim do mes. So contas '
  'com extrato aparecem — as sem cobertura ficam de fora em vez de desenhar '
  'uma linha em zero.';

-- ==========================================================================
-- 10. AS ASSERCOES — A MIGRATION SE RECUSA A COMMITAR SE MENTIREM
-- ==========================================================================

DO $$
DECLARE
  v_n     bigint;
  v_a     bigint;
  v_b     bigint;
  v_txt   text;
  v_num   numeric;
BEGIN
  -- 10.1 Nada de fin_transaction. E a restricao mais dura da frente.
  SELECT count(*) INTO v_n
    FROM fin_transaction
   WHERE updated_at > now() - interval '2 minutes';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'a 0110 nao pode tocar fin_transaction, e % linha(s) mudaram', v_n;
  END IF;

  -- 10.2 O contrato entrou inteiro, e as duas grandezas de prazo continuam
  --      separadas.
  SELECT count(*) INTO v_n FROM fin_emprestimo
   WHERE ccb = '0.000.000.002.266.602'
     AND prazo_total_meses = 48 AND carencia_meses = 11 AND prestacoes = 37;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0110: o contrato do Pronampe nao entrou com 48 = 11 + 37 (% linha)', v_n;
  END IF;

  -- 10.3 A PROVA DA LEITURA DA TAXA: com o spread SOZINHO, a Price de 37
  --      parcelas sobre o saldo capitalizado 11 meses tem de reproduzir a
  --      prestacao impressa no contrato. Tolerancia de 10 centavos, que e a
  --      precisao do proprio spread (6 casas).
  --      Se esta assercao cair, a interpretacao "0,486755 e spread mensal e a
  --      carencia sao 11 meses" esta errada e TUDO o mais desta migration
  --      esta errado junto.
  SELECT abs(
           (emp.principal_cents / 100.0) * power(1 + emp.spread_mensal, emp.carencia_meses)
           * emp.spread_mensal
           / (1 - power(1 + emp.spread_mensal, -emp.prestacoes))
           - emp.prestacao_contratual_cents / 100.0)
    INTO v_num
    FROM fin_emprestimo emp WHERE emp.ccb = '0.000.000.002.266.602';
  IF v_num > 0.10 THEN
    RAISE EXCEPTION
      '0110: a Price com o spread sozinho NAO reproduz a prestacao do contrato '
      '(erro de R$ %). A leitura de taxa/carencia esta errada.',
      to_char(v_num, 'FM990D0000');
  END IF;

  -- 10.4 A Selic e de fonte primaria e cobre ate a ultima parcela vencida.
  SELECT count(*) INTO v_n FROM fin_emprestimo_indexador WHERE origem = 'observada';
  IF v_n < 28 THEN
    RAISE EXCEPTION '0110: a serie observada da Selic tem so % periodo(s)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM fin_emprestimo_indexador
   WHERE fonte_url NOT LIKE 'https://api.bcb.gov.br/%'
     AND fonte_url NOT LIKE 'https://www.bcb.gov.br/%';
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: % linha(s) de Selic sem fonte primaria do BCB', v_n;
  END IF;

  -- 10.5 O cronograma tem 48 periodos, 11 de carencia e 37 de amortizacao, e
  --      amortiza ate zero. Saldo final fora de +-R$ 1,00 quer dizer que a
  --      recursao esta errada.
  SELECT count(*) FILTER (WHERE fase = 'carencia'),
         count(*) FILTER (WHERE fase = 'amortizacao')
    INTO v_a, v_b FROM fin_emprestimo_cronograma_v;
  IF v_a <> 11 OR v_b <> 37 THEN
    RAISE EXCEPTION '0110: cronograma com % carencia e % amortizacao', v_a, v_b;
  END IF;
  SELECT abs(saldo_devedor_cents) INTO v_num
    FROM fin_emprestimo_cronograma_v ORDER BY periodo DESC LIMIT 1;
  IF v_num > 100 THEN
    RAISE EXCEPTION '0110: o cronograma nao amortiza ate zero (sobra % centavos)', v_num;
  END IF;

  -- 10.6 Nenhuma linha do cronograma pode se apresentar como fato. Nao ha
  --      extrato da conta debitada; realizado aqui seria invencao.
  SELECT count(*) INTO v_n FROM fin_emprestimo_cronograma_v
   WHERE estimada IS NOT TRUE OR metodo IS NULL OR length(btrim(metodo)) = 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: % linha(s) do cronograma sem marca de estimativa ou sem metodo', v_n;
  END IF;

  -- 10.7 A carencia capitaliza e nao paga. Uma prestacao dentro da carencia
  --      contradiz a Clausula Terceira.
  SELECT count(*) INTO v_n FROM fin_emprestimo_cronograma_v
   WHERE fase = 'carencia' AND prestacao_cents <> 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: % parcela(s) cobrada(s) durante a carencia', v_n;
  END IF;

  -- 10.8 A busca pela chave certa acha exatamente as 5 transferencias, todas
  --      do Inter, somando R$ 25.400,00. Se este numero mudar, ou a chave
  --      quebrou ou chegou dado novo — e nos dois casos alguem tem de olhar.
  SELECT count(*), COALESCE(sum(valor_cents), 0)
    INTO v_n, v_a FROM fin_emprestimo_transferencia_v;
  IF v_n <> 5 OR v_a <> 2540000 THEN
    RAISE EXCEPTION
      '0110: as transferencias para a Caixa mudaram de % / R$ 25.400,00 para % / %',
      5, v_n, fin_brl(v_a);
  END IF;

  -- 10.9 E todas continuam sendo do Inter. O Fernando citou tres contas; o
  --      dado diz uma. Se um dia disser duas, o texto da tela envelheceu.
  SELECT count(DISTINCT conta_origem) INTO v_n FROM fin_emprestimo_transferencia_v;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0110: as transferencias vieram de % contas distintas, nao 1', v_n;
  END IF;

  -- 10.10 A chave obvia continua devolvendo zero — e por isso que ela esta
  --        documentada. Se um dia o CNPJ da CAIXA aparecer como contraparte,
  --        a busca da view precisa crescer.
  SELECT count(*) INTO v_n FROM fin_transaction WHERE counterparty_document LIKE '00360305%';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      '0110: apareceram % lancamento(s) com o CNPJ da CAIXA como contraparte; '
      'a view fin_emprestimo_transferencia_v precisa passar a alcanca-los', v_n;
  END IF;

  -- 10.11 A ancora do dinheiro: 4 contas com extrato, e o saldo de cada uma
  --        continua sendo abertura + movimento. Esta migration nao move um
  --        centavo, e prova.
  SELECT count(*) INTO v_n
    FROM fin_caixa_conta_v c
    JOIN fin_account a ON a.id = c.account_id
   WHERE c.saldo_cents IS NOT NULL AND c.saldo_cents <> a.current_balance_cents;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: o saldo calculado divergiu do saldo da conta em % conta(s)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v WHERE saldo_cents IS NOT NULL;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '0110: fin_caixa_conta_v devolveu % contas com saldo, esperava 4', v_n;
  END IF;

  -- 10.12 caixa-aplicacao continua SEM saldo e COM motivo. Um zero aqui e a
  --        mentira que a base inteira foi feita para nao contar.
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE saldo_cents IS NULL AND (motivo_sem_saldo IS NULL OR length(btrim(motivo_sem_saldo)) = 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: % conta(s) sem saldo e sem motivo declarado', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fin_caixa_conta_v
                  WHERE slug = 'caixa-aplicacao' AND saldo_cents IS NULL) THEN
    RAISE EXCEPTION '0110: caixa-aplicacao ganhou saldo sem ganhar extrato';
  END IF;

  -- 10.13 O passivo NAO entra como dinheiro. A conta do emprestimo tem saldo
  --        NULL e o devedor mora em coluna separada.
  IF EXISTS (SELECT 1 FROM fin_caixa_conta_v
              WHERE slug = 'caixa-emprestimo' AND saldo_cents IS NOT NULL) THEN
    RAISE EXCEPTION '0110: o saldo devedor do Pronampe virou saldo de conta';
  END IF;
  SELECT count(*) INTO v_n FROM fin_caixa_conta_v
   WHERE passivo_saldo_devedor_cents IS NOT NULL AND passivo_saldo_devedor_cents <= 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: passivo nao positivo em % linha(s)', v_n;
  END IF;

  -- 10.14 A serie mensal fecha com o saldo de hoje: o ultimo mes de cada conta
  --        tem de bater com current_balance_cents ao centavo.
  SELECT count(*) INTO v_n
    FROM (SELECT DISTINCT ON (account_id) account_id, saldo_fim_cents
            FROM fin_caixa_serie_mensal_v ORDER BY account_id, mes DESC) s
    JOIN fin_account a ON a.id = s.account_id
   WHERE s.saldo_fim_cents <> a.current_balance_cents;
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: a serie mensal nao fecha com o saldo atual em % conta(s)', v_n;
  END IF;

  -- 10.14b Os R$ 650,00 de 04/01/2026 NAO podem ser lidos como prestacao paga.
  --        Eles sao 10,3% do que venceu naquele mes. Se algum dia esta linha
  --        virar 'compativel', ou o corte de 90% foi afrouxado ou entrou
  --        transferencia nova — e nos dois casos alguem tem de olhar.
  SELECT count(*) INTO v_n FROM fin_emprestimo_cronograma_v
   WHERE vencimento_em = DATE '2026-01-02' AND estado = 'vencida_com_funding_insuficiente';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      '0110: janeiro/2026 deixou de estar marcado como funding insuficiente. '
      'Entraram R$ 650,00 contra uma prestacao de cerca de R$ 6.334,00.';
  END IF;

  -- 10.14c Funding classificado exige o valor e a cobertura ao lado. Estado
  --        sem numero e rotulo.
  SELECT count(*) INTO v_n FROM fin_emprestimo_cronograma_v
   WHERE estado LIKE 'vencida_com_funding%'
     AND (funding_cents IS NULL OR funding_cobertura IS NULL);
  IF v_n > 0 THEN
    RAISE EXCEPTION '0110: % linha(s) com funding classificado e sem valor medido', v_n;
  END IF;

  -- 10.15 As premissas existem, estao vigentes e cada uma diz o que a derruba.
  SELECT count(*) INTO v_n FROM fin_emprestimo_premissa WHERE vigente;
  IF v_n < 2 THEN
    RAISE EXCEPTION '0110: as premissas declaradas sumiram (% vigente(s))', v_n;
  END IF;

  -- 10.16 O saldo devedor de hoje e PISO, e diz que e.
  SELECT natureza INTO v_txt FROM fin_emprestimo_saldo_v LIMIT 1;
  IF v_txt <> 'piso' THEN
    RAISE EXCEPTION '0110: o saldo devedor deixou de se declarar piso (%)', v_txt;
  END IF;

  -- 10.17 A lacuna de funding na janela coberta e o achado numero 5. Ela tem
  --        de ser positiva e material; se zerar sozinha, alguem "consertou"
  --        o buraco em vez de conseguir o extrato.
  SELECT lacuna_na_cobertura_cents INTO v_a FROM fin_emprestimo_saldo_v LIMIT 1;
  IF v_a IS NULL OR v_a <= 0 THEN
    RAISE EXCEPTION
      '0110: a lacuna de funding na janela coberta virou % — ela era de cerca '
      'de R$ 25.000,00 e so o extrato da Caixa pode fecha-la', v_a;
  END IF;

  RAISE NOTICE
    '0110 validada: saldo devedor em % = % (piso) · % de % prestacoes vencidas · '
    'transferido % em % lancamento(s) · lacuna na janela coberta %',
    (SELECT to_char(ultima_parcela_em, 'DD/MM/YYYY') FROM fin_emprestimo_saldo_v LIMIT 1),
    (SELECT fin_brl(saldo_devedor_cents) FROM fin_emprestimo_saldo_v LIMIT 1),
    (SELECT ultima_parcela_vencida FROM fin_emprestimo_saldo_v LIMIT 1),
    (SELECT prestacoes FROM fin_emprestimo_saldo_v LIMIT 1),
    (SELECT fin_brl(transferido_cents) FROM fin_emprestimo_saldo_v LIMIT 1),
    (SELECT transferencias FROM fin_emprestimo_saldo_v LIMIT 1),
    (SELECT fin_brl(lacuna_na_cobertura_cents) FROM fin_emprestimo_saldo_v LIMIT 1);
END $$;
