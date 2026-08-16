-- Folha: o contratado, o pago, a diferença entre os dois — e o reembolso que
-- já está dentro do pago.
--
-- ===========================================================================
-- 0. O QUE ESTA MIGRATION *NÃO* FAZ
-- ===========================================================================
-- A 0026 já criou o modelo (fin_person_compensation, fin_compensation_component,
-- fin_person_counterparty) e a 0050 já criou o eixo duplo (fin_custo_pessoas_v,
-- categoria padrão da pessoa). Nada disso é recriado aqui.
--
-- Três coisas continuam explicitamente FORA do escopo, por decisão já tomada:
--
--   a) PRÓ-LABORE CONTINUA PRÓ-LABORE. O eixo fiscal (6.02) não é tocado —
--      mudá-lo alteraria base de encargo e IR. Ele entra na folha só no eixo
--      gerencial, que é o que a 0050 já entrega.
--
--   b) A CONTA CONTÁBIL DOS MEIs NÃO É DECIDIDA AQUI. Hoje R$ 227.936,66 de
--      pagamento a MEI está em 6.01 Salários — não porque alguém decidiu, mas
--      porque é o que a regra de importação deixou. `fin_folha_mei_v` expõe o
--      fato e lista o que falta para decidir. Nenhum UPDATE de categoria.
--
--   c) O REEMBOLSO NÃO É RECLASSIFICADO. A conta 6.05 "Reembolsos a
--      colaboradores" existe e tem ZERO lançamento, enquanto os reembolsos
--      estão dentro de 6.01/6.02. Mover exigiria casar 81 reembolsos com o
--      extrato, e o casamento por valor resolve só metade (medido abaixo).
--      `fin_folha_reembolso_ledger_v` mostra o que casa e o que não casa; a
--      reclassificação fica para quando houver comprovante, não antes.
--
-- ===========================================================================
-- 1. O QUE FOI MEDIDO (16/08/2026, ledger financeiro, 2026-01 a 2026-08)
-- ===========================================================================
--
--   pago a pessoas cadastradas ......... R$ 679.744,49   (8 meses, 28 pessoas)
--   fixo contratado declarado .......... R$  61.100,00 / mês
--   comissão contratada declarada ...... R$  11.843,25 / mês
--   acréscimo sobre o fixo (mediana) ... R$  22.299,24 / mês
--   reembolso (7 meses, jan–jul) ....... R$  42.320,34   (R$ 6.045,76/mês)
--
-- O acréscimo não é ruído: é 27% do que sai. Ele existe todo mês, varia de
-- R$ 8.210,95 (abril) a R$ 36.751,30 (agosto), e hoje não tem previsão.
--
-- ---------------------------------------------------------------------------
-- 1.1 A DUPLA CONTAGEM, NOMEADA
-- ---------------------------------------------------------------------------
-- O reembolso aparece DUAS VEZES na base, e as duas são legítimas:
--
--   `fin_reimbursement`  — o pedido: quem, qual mês, quais itens.
--   `fin_transaction`    — o pagamento: o PIX que quitou o pedido.
--
-- São o mesmo dinheiro. Somar os dois infla a folha em ~R$ 6 mil/mês. A prova
-- é direta: o reembolso de julho do Igor (R$ 1.663,12 = Transporte R$ 1.294,41
-- + Alimentação R$ 368,71) está no ledger como DOIS PIX de 01/08/2026, com
-- esses valores exatos, categoria 6.01. A defasagem dominante é de um mês —
-- 73 dos 142 itens casados caem em M+1, contra 25 em M+0.
--
-- Regra que qualquer consulta de custo tem de respeitar, e que as views abaixo
-- já respeitam:
--
--     O CAIXA É O `fin_transaction`. `fin_reimbursement` é o DETALHE do que
--     havia dentro daquele pagamento — nunca uma parcela adicional de custo.
--
-- E o gasto original (o Uber, o almoço) NÃO está no ledger: quem pagou foi a
-- pessoa, do bolso dela. Por isso não existe terceira contagem — mas também
-- por isso o reembolso é o único registro que esse gasto tem, e perdê-lo
-- apagaria a natureza da despesa.
--
-- ===========================================================================
-- 2. cnpj DO MEI: DERIVAÇÃO, NÃO DIGITAÇÃO
-- ===========================================================================
-- A 0026 criou `fin_person.cnpj` porque "a maior parte do dinheiro sai contra o
-- CNPJ". A coluna ficou preenchida em 3 das 12 pessoas MEI — e nas outras o
-- CNPJ existe, está no `document_number` da contraparte confirmada, e é onde o
-- dinheiro de fato cai (28 dos 45 lançamentos do Igor, 12 dos 14 do Flavio).
--
-- Isto é cópia de um dado que já está na base pelo vínculo que um humano já
-- confirmou. Não é inferência: só entra CNPJ de link `confirmado`, e só quando
-- a pessoa tem exatamente UM CNPJ confirmado — duas fontes possíveis seriam
-- escolha, e escolha aqui vira chave fiscal errada.
UPDATE fin_person p
   SET cnpj = d.doc
  FROM (
    SELECT l.person_id, min(c.document_number) AS doc
      FROM fin_person_counterparty l
      JOIN fin_counterparty c ON c.id = l.counterparty_id
     WHERE l.status = 'confirmado'
       AND c.document_number ~ '^[0-9]{14}$'
     GROUP BY l.person_id
    HAVING count(DISTINCT c.document_number) = 1
  ) d
 WHERE p.id = d.person_id
   AND p.cnpj IS NULL;

-- ===========================================================================
-- 3. R$ 21.285,00 DE FOLHA PENDURADOS EM CONTRAPARTE ÓRFÃ
-- ===========================================================================
-- Em 01/04/2026 o extrato do Inter trouxe cinco PIX num formato de descrição
-- diferente ("Pix Enviado — Cp: 18236120-<raiz do CNPJ> <nome truncado>"). O
-- importador não reconheceu o padrão, não extraiu documento, e criou quatro
-- contrapartes novas — para quatro pessoas que já estavam no cadastro:
--
--   973 "Igor Dalton Guilherme Da Sil"           3 lanç.  R$ 10.885,00
--   972 "Flavio Manoel Candido Da Sil"           1 lanç.  R$  5.100,00
--   970 "audrey Carla Queiroz Monteiro Guimara"  1 lanç.  R$  4.000,00
--   971 "Tawanny De Melo Inacio"                 1 lanç.  R$  1.300,00
--
-- É por isso que abril parece o mês em que meio time não recebeu: o Flavio
-- consta com R$ 298,00 num mês de contrato de R$ 5.100,00, a Audrey e a Tawany
-- com zero. Some as órfãs e abril fecha com o contrato de cada um.
--
-- Três das quatro têm PROVA DOCUMENTAL dentro da própria descrição: a raiz do
-- CNPJ (64266025, 64677654, 63384563) é exatamente a do MEI já confirmado
-- daquela pessoa. A quarta (Audrey) tem só o nome — prefixo exato e único no
-- roster, mas nome. Por isso entram com `method` diferente.
--
-- TODAS entram como 'proposto', não 'confirmado'. Nenhum número muda por causa
-- desta migration: `fin_person.counterparty_id` é alimentado só por link
-- confirmado (gatilho da 0026), e as views abaixo leem só 'confirmado'. Quem
-- confirma é humano, na fila. Foi assim que a 0026 evitou repetir o erro
-- "Paulo Gabriel × Gabriel", e não é aqui que se abre exceção.
INSERT INTO fin_person_counterparty
  (entity_id, person_id, counterparty_id, is_primary, confidence, method, status, evidence)
SELECT e.id, p.id, v.cp, false, v.conf, v.metodo, 'proposto',
       jsonb_build_object(
         'origem',      'migration 0077',
         'motivo',      v.motivo,
         'lancamentos', (SELECT count(*) FROM fin_transaction t
                          WHERE t.counterparty_id = v.cp AND t.amount_cents < 0),
         'valor_cents', (SELECT COALESCE(sum(abs(t.amount_cents)),0) FROM fin_transaction t
                          WHERE t.counterparty_id = v.cp AND t.amount_cents < 0))
  FROM (VALUES
    ('igor',   973, 0.950, 'documento',  'raiz de CNPJ 64266025 na descrição do lançamento é a do MEI confirmado da pessoa (contraparte 395)'),
    ('flavio', 972, 0.950, 'documento',  'raiz de CNPJ 64677654 na descrição do lançamento é a do MEI confirmado da pessoa (contraparte 393)'),
    ('tawany', 971, 0.950, 'documento',  'raiz de CNPJ 63384563 na descrição do lançamento é a do MEI confirmado da pessoa (contraparte 377)'),
    ('audrey', 970, 0.700, 'nome_token', 'nome truncado é prefixo exato e único do nome de cartório; SEM documento na descrição — confirmar antes de usar')
  ) AS v(nome, cp, conf, metodo, motivo)
  JOIN fin_entity e  ON e.slug = 'xpe'
  JOIN fin_person p  ON p.normalized_name = v.nome AND p.entity_id = e.id
 WHERE EXISTS (SELECT 1 FROM fin_counterparty c WHERE c.id = v.cp AND c.entity_id = e.id)
ON CONFLICT (person_id, counterparty_id) DO NOTHING;

-- ===========================================================================
-- 4. O HISTÓRICO MENSAL QUE FALTAVA
-- ===========================================================================
-- `fin_person_compensation` tinha 48 linhas, TODAS de 2026-08. A 0026 defendeu
-- a tabela dizendo que "o valor é por mês, não por pessoa" e citou a série que
-- explica o salto (a Consultoria do Belo indo de R$ 1.000 a R$ 4.500). Essa
-- série existe nas abas por time e nunca foi carregada — a tabela guardava um
-- retrato, exatamente o que a 0026 argumentou que não bastava.
--
-- Entram jan–ago das abas "Time de Hardware" e "Time de Software", que são as
-- únicas com detalhe POR PESSOA E POR COMPONENTE mês a mês (as demais abas dão
-- só totais por time, ou só o mês corrente).
--
-- Conferência feita antes de escrever: para cada pessoa e cada mês, a soma dos
-- componentes bate com a linha "Total" da própria planilha, nos 40 pares
-- (5 pessoas × 8 meses) da aba de Hardware. Nenhum valor foi rateado ou
-- arredondado.
--
-- `kind = 'apurado'` porque é o que foi determinado para AQUELE mês — a mesma
-- semântica que a 0026 usou para agosto. O `contratado` continua sendo só a aba
-- "Via de Pagamento", que não tem série mensal.
--
-- ON CONFLICT DO NOTHING preserva agosto como está: onde a aba por time
-- discorda da lista "Falta pagar", vence o que já estava, e a divergência fica
-- visível em fin_folha_divergencia_v em vez de ser sobrescrita em silêncio.
-- (É o caso do João: a aba de Software diz R$ 1.000 e a lista de agosto diz
--  R$ 3.000 — e o extrato pagou R$ 3.000 em todos os oito meses.)
INSERT INTO fin_person_compensation
  (entity_id, person_id, reference_month, component, kind, amount_cents, nucleo, source, notes)
SELECT e.id, p.id, v.mes::date, v.componente, 'apurado', v.cents, p.default_nucleo, v.fonte,
       'Carregado pela 0077. Série mensal por componente; soma confere com a linha Total da própria aba.'
  FROM (VALUES
    ('belo','2026-01-01','consultoria',100000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-02-01','consultoria',100000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-03-01','consultoria',100000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-04-01','consultoria',100000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-05-01','consultoria',100000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-06-01','consultoria',100000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-07-01','consultoria',200000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-08-01','consultoria',450000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-01-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-02-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-03-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-04-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-05-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-06-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('belo','2026-07-01','desenvolvimento',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-01-01','inspecoes_levantamentos',187500,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-01-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-02-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-03-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-04-01','desenvolvimento',162100,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-05-01','desenvolvimento',162100,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-06-01','desenvolvimento',162100,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-07-01','desenvolvimento',162100,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('adryan kennie melo dos santos','2026-08-01','desenvolvimento',162100,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-01-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-02-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-03-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-04-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-05-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-06-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-07-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('tiago','2026-08-01','suporte',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    -- "Macgyver" na aba de Hardware é o Flavio; a 0026 já registrou a identidade.
    ('flavio','2026-01-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-02-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-03-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-04-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-05-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-06-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-07-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('flavio','2026-08-01','fixo',510000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-03-01','diaria_especialista',60000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-05-01','diaria_especialista',52500,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-07-01','diaria_especialista',15000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-08-01','diaria_especialista',15000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-01-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-02-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-03-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-04-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-05-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-06-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-07-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('diogo','2026-08-01','fixo',250000,'planilha:comissionamento-xpe-2026#time-hardware'),
    ('decezaris','2026-01-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-02-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-03-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-04-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-05-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-06-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-07-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('decezaris','2026-08-01','desenvolvimento',450000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-01-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-02-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-03-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-04-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-05-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-06-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-07-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('evera','2026-08-01','desenvolvimento',150000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-01-01','desenvolvimento',99840,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-02-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-03-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-04-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-05-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-06-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-07-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('joao','2026-08-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('kalebe','2026-01-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software'),
    ('kalebe','2026-02-01','desenvolvimento',100000,'planilha:comissionamento-xpe-2026#time-software')
  ) AS v(nome, mes, componente, cents, fonte)
  JOIN fin_entity e ON e.slug = 'xpe'
  JOIN fin_person p ON p.normalized_name = v.nome AND p.entity_id = e.id
ON CONFLICT (person_id, reference_month, component, kind) DO NOTHING;

-- ===========================================================================
-- 5. A BASE DE TODAS AS VIEWS: PESSOA × MÊS
-- ===========================================================================
-- Uma view só, e as outras derivam dela, porque "quanto custou fulano em maio"
-- precisa ter UMA resposta. Três decisões estão embutidas aqui e valem para
-- tudo que ler folha daqui em diante:
--
--   1. O PAGO VEM DE TODAS AS CONTRAPARTES CONFIRMADAS, não do ponteiro
--      `fin_person.counterparty_id`. O ponteiro guarda uma contraparte só, e
--      nos seis MEI com CPF+CNPJ ele está no CPF — que é justamente onde o
--      dinheiro NÃO cai. Pelo ponteiro, R$ 163.537,48 dos R$ 227.936,66 pagos
--      a MEI ficariam fora da conta (71%).
--
--   2. TRANSFERÊNCIA PAREADA E LINHA-PAI DE RATEIO NÃO CONTAM. São dinheiro
--      andando entre contas próprias e cabeçalho de split — contá-los dobraria.
--
--   3. O REEMBOLSO DE UM MÊS É PAGO NO SEGUINTE. `reembolso_no_mes_cents` é o
--      reembolso de referência M-1, porque é ele que está DENTRO do PIX de M.
--      A coluna existe para ser SUBTRAÍDA do pago quando se quer remuneração —
--      nunca para ser somada.
CREATE OR REPLACE VIEW fin_folha_pessoa_mes_v AS
WITH meses AS (
  SELECT generate_series(
           LEAST(date_trunc('month', (SELECT min(posted_on) FROM fin_transaction WHERE posted_on >= '2026-01-01')),
                 '2026-01-01'::date),
           date_trunc('month', CURRENT_DATE),
           interval '1 month')::date AS mes
),
link AS (
  SELECT person_id, counterparty_id
    FROM fin_person_counterparty
   WHERE status = 'confirmado'
),
pago AS (
  SELECT l.person_id,
         date_trunc('month', t.posted_on)::date AS mes,
         sum(abs(t.amount_cents))               AS cents,
         count(*)                               AS lancamentos,
         sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.02') AS prolabore_cents,
         sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.01') AS salarios_cents,
         sum(abs(t.amount_cents)) FILTER (WHERE c.code NOT LIKE '6.%' OR c.code IS NULL) AS fora_de_pessoal_cents
    FROM fin_transaction t
    JOIN link l ON l.counterparty_id = t.counterparty_id
    LEFT JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0
     AND t.transfer_status <> 'pareado'
     AND NOT t.is_split_parent
   GROUP BY 1, 2
),
contratado AS (
  SELECT pc.person_id,
         sum(pc.amount_cents) FILTER (WHERE cc.kind = 'fixo')     AS fixo_cents,
         sum(pc.amount_cents) FILTER (WHERE cc.kind = 'variavel') AS comissao_cents
    FROM fin_person_compensation pc
    JOIN fin_compensation_component cc ON cc.slug = pc.component
   WHERE pc.kind = 'contratado'
   GROUP BY 1
),
apurado AS (
  SELECT pc.person_id, pc.reference_month AS mes,
         sum(pc.amount_cents)                                     AS total_cents,
         sum(pc.amount_cents) FILTER (WHERE cc.kind = 'fixo')     AS fixo_cents,
         sum(pc.amount_cents) FILTER (WHERE cc.kind = 'variavel') AS variavel_cents
    FROM fin_person_compensation pc
    JOIN fin_compensation_component cc ON cc.slug = pc.component
   WHERE pc.kind = 'apurado'
   GROUP BY 1, 2
),
reemb AS (
  SELECT r.person_id,
         (r.reference_month + interval '1 month')::date AS mes_do_pagamento,
         r.reference_month,
         r.total_cents,
         r.status
    FROM fin_reimbursement r
)
SELECT p.entity_id,
       m.mes,
       p.id                                        AS person_id,
       p.name                                      AS pessoa,
       p.employment_type                           AS vinculo,
       p.status                                    AS situacao_cadastro,
       p.area,
       COALESCE(p.default_nucleo, '(sem núcleo)')  AS nucleo,
       COALESCE(ct.fixo_cents, 0)                  AS fixo_contratado_cents,
       COALESCE(ct.comissao_cents, 0)              AS comissao_contratada_cents,
       ap.total_cents                              AS apurado_cents,
       ap.fixo_cents                               AS apurado_fixo_cents,
       ap.variavel_cents                           AS apurado_variavel_cents,
       COALESCE(pg.cents, 0)                       AS pago_cents,
       COALESCE(pg.lancamentos, 0)                 AS pago_lancamentos,
       COALESCE(pg.prolabore_cents, 0)             AS pago_prolabore_cents,
       COALESCE(pg.salarios_cents, 0)              AS pago_salarios_cents,
       COALESCE(pg.fora_de_pessoal_cents, 0)       AS pago_fora_de_pessoal_cents,
       COALESCE(rb.total_cents, 0)                 AS reembolso_no_mes_cents,
       rb.reference_month                          AS reembolso_mes_de_referencia,
       rb.status                                   AS reembolso_status,
       -- Remuneração = pago menos o reembolso que estava dentro dele.
       COALESCE(pg.cents, 0) - COALESCE(rb.total_cents, 0) AS remuneracao_cents,
       -- Positivo: recebeu além do fixo (comissão, serviço extra, bônus).
       -- Negativo: recebeu menos que o contrato — pode ser lançamento faltando.
       COALESCE(pg.cents, 0) - COALESCE(rb.total_cents, 0) - COALESCE(ct.fixo_cents, 0)
                                                   AS divergencia_cents
  FROM fin_person p
  CROSS JOIN meses m
  LEFT JOIN pago       pg ON pg.person_id = p.id AND pg.mes = m.mes
  LEFT JOIN contratado ct ON ct.person_id = p.id
  LEFT JOIN apurado    ap ON ap.person_id = p.id AND ap.mes = m.mes
  LEFT JOIN reemb      rb ON rb.person_id = p.id AND rb.mes_do_pagamento = m.mes;

COMMENT ON VIEW fin_folha_pessoa_mes_v IS
  'Base da folha: pessoa × mês com contratado, apurado, pago e reembolso. O pago soma TODAS as '
  'contrapartes confirmadas da pessoa (o ponteiro fin_person.counterparty_id deixa 71% do MEI de '
  'fora). reembolso_no_mes_cents é o reembolso de referência M-1, que já está DENTRO do pago de M — '
  'subtrair para obter remuneração, nunca somar. Pró-labore continua em coluna própria: o eixo '
  'fiscal não muda aqui.';

-- ---------------------------------------------------------------------------
-- 5.1 Divergência por pessoa: quem recebe a mais e quem recebe a menos
-- ---------------------------------------------------------------------------
-- Os dois lados importam e por motivos opostos. A mais é custo variável que a
-- projeção não vê. A menos é, quase sempre, lançamento que não chegou ao ledger
-- — abril inteiro é isso (as quatro contrapartes órfãs da seção 3).
--
-- `meses_com_pagamento` no denominador, e não 8: contar mês sem pagamento como
-- zero rebaixaria a média de quem entrou em junho e faria três estagiários
-- parecerem metade do que custam.
CREATE OR REPLACE VIEW fin_folha_divergencia_v AS
SELECT entity_id,
       person_id,
       pessoa,
       vinculo,
       situacao_cadastro,
       nucleo,
       max(fixo_contratado_cents)     AS fixo_contratado_cents,
       max(comissao_contratada_cents) AS comissao_contratada_cents,
       count(*) FILTER (WHERE pago_cents > 0)                    AS meses_com_pagamento,
       min(mes) FILTER (WHERE pago_cents > 0)                    AS primeiro_mes,
       max(mes) FILTER (WHERE pago_cents > 0)                    AS ultimo_mes,
       sum(pago_cents)                                           AS pago_total_cents,
       sum(reembolso_no_mes_cents)                               AS reembolso_total_cents,
       (avg(pago_cents)      FILTER (WHERE pago_cents > 0))::bigint AS pago_medio_cents,
       (avg(remuneracao_cents) FILTER (WHERE pago_cents > 0))::bigint AS remuneracao_media_cents,
       (avg(divergencia_cents) FILTER (WHERE pago_cents > 0))::bigint AS divergencia_media_cents,
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY divergencia_cents)
          FILTER (WHERE pago_cents > 0))::bigint                 AS divergencia_mediana_cents,
       max(divergencia_cents) FILTER (WHERE pago_cents > 0)      AS divergencia_maxima_cents,
       min(divergencia_cents) FILTER (WHERE pago_cents > 0)      AS divergencia_minima_cents,
       CASE
         WHEN max(fixo_contratado_cents) = 0                       THEN 'sem contrato declarado'
         WHEN avg(divergencia_cents) FILTER (WHERE pago_cents > 0) >  5000 THEN 'recebe a mais'
         WHEN avg(divergencia_cents) FILTER (WHERE pago_cents > 0) < -5000 THEN 'recebe a menos'
         ELSE 'em linha com o contrato'
       END AS leitura
  FROM fin_folha_pessoa_mes_v
 GROUP BY entity_id, person_id, pessoa, vinculo, situacao_cadastro, nucleo;

COMMENT ON VIEW fin_folha_divergencia_v IS
  'Contratado × pago por pessoa, já líquido do reembolso embutido. "recebe a mais" é acréscimo '
  '(comissão, serviço extra, bônus) e é custo variável a prever; "recebe a menos" costuma ser '
  'lançamento faltando, não desconto. "sem contrato declarado" é pendência: a pessoa recebe todo '
  'mês e não existe linha contratada para ela. Faixa morta de R$ 50,00 para não chamar de '
  'divergência o centavo de tarifa.';

-- ===========================================================================
-- 6. REEMBOLSO × LEDGER: A TRAVA CONTRA A DUPLA CONTAGEM
-- ===========================================================================
-- Não decide nada — mostra. Para cada reembolso, procura no ledger, na janela
-- de M a M+3 e nas contrapartes confirmadas da pessoa, um pagamento com o valor
-- EXATO do total, ou com o valor exato de cada item.
--
-- Medido em 16/08/2026: 46 dos 81 reembolsos (R$ 14.211,02) casam pelo total;
-- por item o casamento cobre R$ 19.624,67 dos R$ 42.320,34. O resto não casa
-- porque foi pago junto com o fixo num PIX só — o valor somado não existe
-- isolado em lugar nenhum.
--
-- Por isso `casamento = 'sem_par'` NÃO significa "não foi pago". Significa
-- "não dá para provar por valor", e é exatamente a razão de a reclassificação
-- 6.01 → 6.05 não ser feita nesta migration.
CREATE OR REPLACE VIEW fin_folha_reembolso_ledger_v AS
WITH link AS (
  SELECT person_id, counterparty_id FROM fin_person_counterparty WHERE status = 'confirmado'
),
casa_total AS (
  SELECT r.id AS reimbursement_id,
         count(*)      AS n,
         min(t.id)     AS transaction_id,
         min(t.posted_on) AS posted_on
    FROM fin_reimbursement r
    JOIN link l ON l.person_id = r.person_id
    JOIN fin_transaction t ON t.counterparty_id = l.counterparty_id
                          AND t.amount_cents = -r.total_cents
                          AND t.posted_on >= r.reference_month
                          AND t.posted_on <  r.reference_month + interval '4 month'
   WHERE r.total_cents > 0
   GROUP BY r.id
),
casa_item AS (
  SELECT r.id AS reimbursement_id,
         count(DISTINCT i.id)         AS itens_casados,
         sum(DISTINCT i.amount_cents) AS valor_casado_cents
    FROM fin_reimbursement r
    JOIN fin_reimbursement_item i ON i.reimbursement_id = r.id
    JOIN link l ON l.person_id = r.person_id
    JOIN fin_transaction t ON t.counterparty_id = l.counterparty_id
                          AND t.amount_cents = -i.amount_cents
                          AND t.posted_on >= r.reference_month
                          AND t.posted_on <  r.reference_month + interval '4 month'
   GROUP BY r.id
)
SELECT r.entity_id,
       r.id                AS reimbursement_id,
       r.reference_month,
       p.name              AS pessoa,
       p.employment_type   AS vinculo,
       r.status,
       r.total_cents,
       (SELECT count(*) FROM fin_reimbursement_item i WHERE i.reimbursement_id = r.id) AS itens,
       (SELECT count(*) FROM fin_reimbursement_item i
         WHERE i.reimbursement_id = r.id AND i.receipt_artifact_key IS NOT NULL)       AS itens_com_comprovante,
       (SELECT count(*) FROM fin_reimbursement_item i
         WHERE i.reimbursement_id = r.id AND i.reimbursement_type IS NOT NULL)         AS itens_com_tipo,
       ct.transaction_id   AS lancamento_id,
       ct.posted_on        AS pago_em,
       COALESCE(ci.itens_casados, 0)      AS itens_casados,
       COALESCE(ci.valor_casado_cents, 0) AS valor_casado_cents,
       CASE WHEN ct.reimbursement_id IS NOT NULL THEN 'casado_total'
            WHEN ci.reimbursement_id IS NOT NULL THEN 'casado_itens'
            ELSE 'sem_par' END AS casamento,
       -- A pergunta que a tela precisa fazer, quando precisar fazê-la.
       CASE WHEN ct.reimbursement_id IS NULL AND ci.reimbursement_id IS NULL
            THEN 'valor não aparece isolado no extrato: provavelmente pago junto com o fixo. '
                 'Não reclassificar sem comprovante.'
       END AS observacao
  FROM fin_reimbursement r
  JOIN fin_person p ON p.id = r.person_id
  LEFT JOIN casa_total ct ON ct.reimbursement_id = r.id
  LEFT JOIN casa_item  ci ON ci.reimbursement_id = r.id;

COMMENT ON VIEW fin_folha_reembolso_ledger_v IS
  'Trava contra dupla contagem: liga cada reembolso ao pagamento no extrato. O caixa é o '
  'fin_transaction; fin_reimbursement é o detalhe do que havia dentro dele, nunca custo adicional. '
  'casamento=sem_par significa "não dá para provar por valor" (pago junto com o fixo), não "não foi '
  'pago" — e é por isso que a conta 6.05 segue com zero lançamento em vez de receber um rateio '
  'inventado.';

-- ---------------------------------------------------------------------------
-- 6.1 Reembolso por mês: o histórico que a planilha guardava sozinha
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_folha_reembolso_mes_v AS
SELECT r.entity_id,
       r.reference_month,
       count(*)                                                  AS pedidos,
       count(*) FILTER (WHERE r.status = 'pago')                 AS pagos,
       count(*) FILTER (WHERE r.status = 'aprovado')             AS aprovados_nao_pagos,
       sum(r.total_cents)                                        AS total_cents,
       sum(r.total_cents) FILTER (WHERE r.status = 'pago')        AS pago_cents,
       sum(r.total_cents) FILTER (WHERE r.status = 'aprovado')    AS aprovado_cents,
       sum((SELECT count(*) FROM fin_reimbursement_item i WHERE i.reimbursement_id = r.id)) AS itens,
       sum((SELECT count(*) FROM fin_reimbursement_item i
             WHERE i.reimbursement_id = r.id AND i.receipt_artifact_key IS NOT NULL))       AS itens_com_comprovante,
       sum((SELECT count(*) FROM fin_reimbursement_item i
             WHERE i.reimbursement_id = r.id AND i.reimbursement_type IS NULL))             AS itens_sem_tipo
  FROM fin_reimbursement r
 GROUP BY r.entity_id, r.reference_month;

COMMENT ON VIEW fin_folha_reembolso_mes_v IS
  'Reembolso mês a mês. itens_com_comprovante é 0 em 193 de 193 itens: a planilha nunca guardou '
  'anexo, e o app do time (F2) é onde isso passa a existir. Até lá, todo reembolso é declaração '
  'sem lastro — o valor bate com a planilha, mas nada prova a despesa.';

-- ===========================================================================
-- 7. OS 12 MEI, E O QUE FALTA PARA DECIDIR A CONTA DELES
-- ===========================================================================
-- A 0050 deixou os MEI sem `default_category_id` de propósito: "o serviço que
-- cada um presta é que decide a conta, e chutar uma aqui seria inventar".
-- A consequência não intencional é que o padrão do importador venceu: 11 dos 12
-- caíram em 6.01 Salários — a conta de EMPREGADO, para quem não é empregado.
--
-- Isto não é neutro. Enquanto ficar em 6.01:
--   · `fin_custo_pessoas_v.folha_sem_mei_cents` inclui MEI, ao contrário do nome;
--   · `mei_cents` mostra só o Kevin (o único fora de 6.xx), R$ 8.270,00 de
--     R$ 227.936,66 — 3,6% do que deveria mostrar;
--   · o eixo fiscal afirma vínculo empregatício onde há contrato de serviço.
--
-- A view não corrige. Ela expõe cada MEI com o que a base sabe e nomeia o que
-- falta, para que a decisão do Fernando seja uma escolha entre opções e não uma
-- arqueologia.
CREATE OR REPLACE VIEW fin_folha_mei_v AS
WITH link AS (
  SELECT person_id, counterparty_id FROM fin_person_counterparty WHERE status = 'confirmado'
),
mov AS (
  SELECT l.person_id,
         count(*)                                  AS lancamentos,
         sum(abs(t.amount_cents))                  AS total_cents,
         min(t.posted_on)                          AS desde,
         max(t.posted_on)                          AS ate,
         count(DISTINCT date_trunc('month', t.posted_on)) AS meses,
         sum(abs(t.amount_cents)) FILTER (WHERE c.code = '6.01') AS em_salarios_cents,
         string_agg(DISTINCT COALESCE(c.code, '(sem categoria)'), ', ' ORDER BY COALESCE(c.code, '(sem categoria)')) AS categorias
    FROM fin_transaction t
    JOIN link l ON l.counterparty_id = t.counterparty_id
    LEFT JOIN fin_category c ON c.id = t.category_id
   WHERE t.amount_cents < 0
     AND t.transfer_status <> 'pareado'
     AND NOT t.is_split_parent
   GROUP BY 1
)
SELECT p.entity_id,
       p.id AS person_id,
       p.name AS pessoa,
       p.status AS situacao_cadastro,
       p.area,
       p.default_nucleo,
       p.cpf,
       p.cnpj,
       (SELECT count(*) FROM link l JOIN fin_counterparty c ON c.id = l.counterparty_id
         WHERE l.person_id = p.id AND c.document_number ~ '^[0-9]{14}$') AS contrapartes_cnpj,
       mv.desde, mv.ate, mv.meses, mv.lancamentos,
       mv.total_cents,
       (mv.total_cents / NULLIF(mv.meses, 0))                 AS media_mensal_cents,
       ct.fixo_cents                                          AS fixo_contratado_cents,
       mv.categorias                                          AS categorias_no_ledger,
       COALESCE(mv.em_salarios_cents, 0)                      AS em_6_01_salarios_cents,
       -- Nota fiscal de serviço TOMADA. Hoje sempre 0: fin_document tem 3.406
       -- linhas e TODAS são direction='receber' (Asaas). Não existe repositório
       -- de documento de entrada — não é que o MEI não emita, é que a base não
       -- teria onde guardar se emitisse.
       (SELECT count(*) FROM fin_fiscal_document fd
         JOIN link l2 ON l2.counterparty_id = fd.counterparty_id
        WHERE l2.person_id = p.id)                            AS notas_na_base,
       'indeterminado'::text                                  AS conta_contabil,
       -- O que falta, por pessoa, em vez de um aviso genérico.
       array_remove(ARRAY[
         CASE WHEN p.cnpj IS NULL THEN 'CNPJ do MEI (não há contraparte confirmada com CNPJ)' END,
         CASE WHEN ct.fixo_cents IS NULL THEN 'valor contratado (não existe linha em fin_person_compensation)' END,
         CASE WHEN p.default_nucleo IS NULL THEN 'núcleo (consultoria ou obras)' END,
         'serviço prestado, descrito (define 4.03 terceirização, 6.01 folha, ou conta nova)',
         'nota fiscal de serviço: se emite, e onde ficam os PDF/XML'
       ], NULL) AS falta_para_decidir
  FROM fin_person p
  LEFT JOIN mov mv ON mv.person_id = p.id
  LEFT JOIN (
    SELECT pc.person_id, sum(pc.amount_cents) AS fixo_cents
      FROM fin_person_compensation pc
      JOIN fin_compensation_component cc ON cc.slug = pc.component
     WHERE pc.kind = 'contratado' AND cc.kind = 'fixo'
     GROUP BY 1
  ) ct ON ct.person_id = p.id
 WHERE p.employment_type = 'mei';

COMMENT ON VIEW fin_folha_mei_v IS
  'Os MEI, um a um, com quanto recebem, desde quando, em que conta o ledger os colocou hoje, e o '
  'que falta para decidir a conta definitiva. conta_contabil é literalmente ''indeterminado'' e '
  'permanece assim até o Fernando decidir: a 0050 recusou-se a chutar e esta view mantém a recusa, '
  'mas torna visível que o padrão do importador já escolheu 6.01 Salários por omissão — a conta de '
  'empregado, para quem não é empregado.';

-- ===========================================================================
-- 8. PREVISÃO DE FOLHA
-- ===========================================================================
-- A 0058 decidiu que a folha entra na previsão de caixa EXCLUSIVAMENTE pelas
-- recorrentes de categoria 6.x, e que `fin_person_compensation` não é consumida
-- lá — porque somar as duas dobraria R$ 72.943,25/mês. Essa decisão continua
-- valendo e esta view NÃO alimenta `fin_previsao_evento_v`.
--
-- O problema é que a outra ponta também está vazia: existem 4 recorrentes de
-- 6.x, todas em status 'proposto', somando R$ 4.818,35/mês. A previsão de caixa
-- enxerga menos de 5% de uma folha de R$ 105 mil.
--
-- Esta view é a camada `folha_declarada` — a que o vocabulário da 0057 já
-- previa em `fin_recurring.conflito_camada` e ninguém tinha produzido. Ela é
-- ORIGEM para virar recorrente ou compromisso, sob confirmação humana. Não é
-- evento de caixa por si só, e por isso não tem `dia`: o dia vem do padrão de
-- pagamento, que é decisão de tesouraria.
--
-- Três camadas, com procedência distinta e nunca somadas em silêncio:
--
--   fixo_contratado  — vem da aba "Via de Pagamento". É compromisso: sobrevive
--                      a mês sem receita. Confiança 'contratado'.
--   fixo_observado   — para quem RECEBE todo mês e não tem contrato declarado
--                      (7 pessoas, ~R$ 8,8 mil/mês: Denilson, Rita, Luiz
--                      Eduardo, Dantre, Sandro, Lorena, Kevin). Mediana dos
--                      últimos 3 meses. Confiança 'observado' — é fato do
--                      extrato, não promessa.
--   variavel         — mediana histórica do acréscimo sobre o fixo, por pessoa,
--                      já líquida de reembolso. Confiança 'estimado'.
--
-- A base de cada número vai em `base_do_valor`, em texto, porque previsão sem
-- procedência é chute com data.
CREATE OR REPLACE VIEW fin_folha_previsao_v AS
WITH janela AS (
  -- Últimos 6 meses fechados com pagamento. A mediana sobre 6 meses aguenta um
  -- abril anômalo sem que ele vire o número do mês que vem.
  SELECT max(mes) AS ultimo_mes FROM fin_folha_pessoa_mes_v WHERE pago_cents > 0
),
hist AS (
  SELECT v.*
    FROM fin_folha_pessoa_mes_v v, janela j
   WHERE v.mes > (j.ultimo_mes - interval '6 month')
     AND v.mes <= j.ultimo_mes
),
agg AS (
  SELECT h.entity_id, h.person_id, h.pessoa, h.vinculo, h.situacao_cadastro, h.nucleo,
         max(h.fixo_contratado_cents)     AS fixo_contratado_cents,
         max(h.comissao_contratada_cents) AS comissao_contratada_cents,
         count(*) FILTER (WHERE h.pago_cents > 0) AS meses_pagos,
         max(h.mes) FILTER (WHERE h.pago_cents > 0) AS ultimo_pagamento,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY h.remuneracao_cents)
            FILTER (WHERE h.pago_cents > 0))::bigint AS remuneracao_mediana_cents,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY h.reembolso_no_mes_cents))::bigint AS reembolso_mediana_cents
    FROM hist h
   GROUP BY 1,2,3,4,5,6
),
-- A base fixa PRECISA ser resolvida antes do variável, e não junto. Quem não
-- tem contrato declarado tem a mediana da remuneração como fixo — e aí o
-- acréscimo sobre ela é, por construção, quase zero. Medir o variável contra
-- `fixo_contratado_cents = 0` faria a remuneração inteira contar duas vezes:
-- uma como fixo observado, outra como variável. Eram R$ 7.002,50/mês de folha
-- fantasma em seis pessoas.
base AS (
  SELECT a.*,
         CASE WHEN a.fixo_contratado_cents > 0 THEN a.fixo_contratado_cents
              ELSE COALESCE(a.remuneracao_mediana_cents, 0) END AS base_fixa_cents
    FROM agg a
),
varia AS (
  SELECT b.person_id,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(h.remuneracao_cents - b.base_fixa_cents, 0))
            FILTER (WHERE h.pago_cents > 0))::bigint AS acrescimo_mediana_cents
    FROM base b
    JOIN hist h ON h.person_id = b.person_id
   GROUP BY b.person_id
)
SELECT a.entity_id,
       (date_trunc('month', CURRENT_DATE) + interval '1 month')::date AS mes_previsto,
       a.person_id, a.pessoa, a.vinculo, a.situacao_cadastro, a.nucleo,
       a.meses_pagos,
       a.ultimo_pagamento,
       -- 1. FIXO
       a.base_fixa_cents AS fixo_cents,
       CASE WHEN a.fixo_contratado_cents > 0 THEN 'contratado' ELSE 'observado' END AS fixo_confianca,
       CASE WHEN a.fixo_contratado_cents > 0
            THEN 'aba "Via de Pagamento" da planilha de comissionamento 2026'
            ELSE 'mediana da remuneração paga nos últimos 6 meses (não há contrato declarado)'
       END AS fixo_base,
       -- 2. VARIÁVEL
       COALESCE(vr.acrescimo_mediana_cents, 0) AS variavel_cents,
       'estimado'::text AS variavel_confianca,
       CASE WHEN COALESCE(vr.acrescimo_mediana_cents, 0) = 0
            THEN 'sem acréscimo na janela: previsto zero'
            WHEN a.comissao_contratada_cents > 0
            THEN 'mediana do acréscimo sobre o fixo nos últimos 6 meses; a pessoa tem comissão contratada de '
                 || to_char(a.comissao_contratada_cents / 100.0, 'FM999G999D00')
                 || ' que só se realiza se a receita vier'
            ELSE 'mediana do acréscimo sobre o fixo nos últimos 6 meses (serviço extra ou bônus, sem comissão contratada)'
       END AS variavel_base,
       -- 3. REEMBOLSO — caixa, mas não remuneração. Coluna separada de propósito.
       COALESCE(a.reembolso_mediana_cents, 0) AS reembolso_cents,
       'estimado'::text AS reembolso_confianca,
       'mediana do reembolso embutido no pagamento nos últimos 6 meses' AS reembolso_base,
       -- Total de caixa previsto para a pessoa.
       a.base_fixa_cents
         + COALESCE(vr.acrescimo_mediana_cents, 0)
         + COALESCE(a.reembolso_mediana_cents, 0) AS total_cents,
       -- Quem parou de receber não entra no mês que vem só porque tem contrato.
       CASE WHEN a.ultimo_pagamento IS NULL THEN 'sem pagamento na janela'
            WHEN a.ultimo_pagamento < (SELECT ultimo_mes FROM janela) THEN 'não recebeu no último mês'
            ELSE 'ativo na folha' END AS situacao_na_folha
  FROM base a
  LEFT JOIN varia vr ON vr.person_id = a.person_id;

COMMENT ON VIEW fin_folha_previsao_v IS
  'Previsão de folha do próximo mês, com fixo e variável separados e a base de cada número '
  'declarada em texto. NÃO alimenta fin_previsao_evento_v: a 0058 decidiu que a folha entra na '
  'previsão de caixa só pelas recorrentes de 6.x, e somar as duas dobraria a folha. Esta é a camada '
  '"folha_declarada" que fin_recurring.conflito_camada já nomeava e ninguém tinha produzido — '
  'origem para virar recorrente sob confirmação humana. reembolso_cents é caixa, não remuneração, '
  'e por isso vive em coluna própria.';

-- ---------------------------------------------------------------------------
-- 8.1 O total, que é o número que decide contratação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW fin_folha_previsao_total_v AS
SELECT entity_id,
       mes_previsto,
       count(*) FILTER (WHERE situacao_na_folha = 'ativo na folha')          AS pessoas_ativas,
       count(*) FILTER (WHERE situacao_na_folha <> 'ativo na folha')         AS pessoas_fora,
       sum(fixo_cents)      FILTER (WHERE situacao_na_folha = 'ativo na folha' AND fixo_confianca = 'contratado') AS fixo_contratado_cents,
       sum(fixo_cents)      FILTER (WHERE situacao_na_folha = 'ativo na folha' AND fixo_confianca = 'observado')  AS fixo_observado_cents,
       sum(fixo_cents)      FILTER (WHERE situacao_na_folha = 'ativo na folha') AS fixo_total_cents,
       sum(variavel_cents)  FILTER (WHERE situacao_na_folha = 'ativo na folha') AS variavel_cents,
       sum(reembolso_cents) FILTER (WHERE situacao_na_folha = 'ativo na folha') AS reembolso_cents,
       sum(total_cents)     FILTER (WHERE situacao_na_folha = 'ativo na folha') AS total_cents
  FROM fin_folha_previsao_v
 GROUP BY entity_id, mes_previsto;

COMMENT ON VIEW fin_folha_previsao_total_v IS
  'Folha do próximo mês em três parcelas, do mais firme ao mais frouxo: fixo contratado (promessa '
  'escrita), fixo observado (pessoa que recebe todo mês sem contrato declarado — é fato do extrato '
  'e é dívida de cadastro), variável (mediana do acréscimo, só se realiza se a receita vier). '
  'Reembolso separado porque é caixa e não remuneração.';
