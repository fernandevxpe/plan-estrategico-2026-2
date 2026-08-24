-- Ajuste manual de salário/pró-labore por mês — trava só o mês editado.
--
-- ---------------------------------------------------------------------------
-- POR QUE
-- ---------------------------------------------------------------------------
-- A fórmula (0164→0169) faz um bom palpite: reembolso primeiro, depois
-- salário-base, depois comissão declarada, e chama o resto de pró-labore. Para
-- Gabriel/Jonildo/Adryan esse palpite foi testado contra o extrato PIX a PIX
-- nesta sessão — e em vários meses não fechou limpo (nenhuma transação isolada
-- explica o excedente). O dono não confia mais no número sem revisar pessoa a
-- pessoa, mês a mês, com o total real do banco do lado.
--
-- Esta migration não troca a fórmula — dá um jeito de ESCREVER POR CIMA dela,
-- um mês de cada vez, sem que a correção de agosto mude julho nem setembro.
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO É UPDATE NA VIEW OU NUM CAMPO GENÉRICO "CORRIGIR TUDO"
-- ---------------------------------------------------------------------------
-- Só salário e pró-labore ficam editáveis aqui. Comissão e reembolso já têm
-- telas e tabelas próprias (`fin_pessoa_comissao_declarada`/série, 0165/0167;
-- `fin_reimbursement`, 0012) com histórico, parcelamento e auditoria — abrir
-- edição livre aqui duplicaria a fonte da verdade e as duas divergiriam na
-- primeira correção feita só num lugar. O que falta é exatamente essas duas
-- naturezas: hoje não existe onde confirmar "isto aqui é R$X de pró-labore" —
-- só a fórmula decide, e a fórmula está sob suspeita.
--
-- ---------------------------------------------------------------------------
-- A GARANTIA: A SOMA TEM DE FECHAR ANTES DE GRAVAR
-- ---------------------------------------------------------------------------
-- `salario_cents + prolabore_cents` não pode, sozinho, bater com o total real —
-- falta comissão, reembolso, estágio, encargo e extra do mês. Por isso a tabela
-- não valida escrita sozinha: quem grava (a rota HTTP) primeiro soma as OUTRAS
-- naturezas do mês (lidas de `fin_time_remuneracao_mes_v` antes deste ajuste
-- existir) e só aceita o par se salario+prolabore+resto = total pago. Essa
-- conta é o "mostrar que tem erro" pedido — acontece ANTES da escrita, não
-- depois. A CHECK abaixo (`> 0` nos dois campos) é só a guarda de tipo; a
-- guarda de dinheiro é a rota.
--
-- A view aprende a preferir o ajuste quando ele existe, e ignora a fórmula só
-- para esse par pessoa×mês — reembolso, comissão, estágio, encargo e extra
-- continuam vindo de onde sempre vieram.

CREATE TABLE fin_pessoa_mes_ajuste (
  id              bigserial PRIMARY KEY,
  entity_id       bigint      NOT NULL REFERENCES fin_entity(id),
  person_id       bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  mes             date        NOT NULL,
  salario_cents   bigint      NOT NULL CHECK (salario_cents >= 0),
  prolabore_cents bigint      NOT NULL CHECK (prolabore_cents >= 0),
  nota            text        NOT NULL,
  confirmado_por  text        NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, mes),
  CONSTRAINT fin_pessoa_mes_ajuste_mes_cheio
    CHECK (mes = date_trunc('month', mes)::date)
);

COMMENT ON TABLE fin_pessoa_mes_ajuste IS
  'Confirmação manual de salário+pró-labore de UM mês de UMA pessoa, por cima da '
  'fórmula de fin_time_remuneracao_mes_v. A rota que grava aqui é quem prova que '
  'a soma com comissão/reembolso/estágio/encargo/extra fecha o total pago — a '
  'tabela em si não tem como checar isso sozinha, porque não sabe as outras '
  'naturezas do mês.';

COMMENT ON COLUMN fin_pessoa_mes_ajuste.nota IS
  'Obrigatória: o que foi conferido para chegar nesse número (ex.: "PIX de '
  '02/08 é o pró-labore fixo; R$4.629 do dia 03/08 não tem explicação, fica '
  'como pró-labore até identificar").';

CREATE OR REPLACE VIEW fin_time_remuneracao_mes_v AS
WITH pago AS (
  SELECT p.entity_id,
         p.id                                   AS person_id,
         date_trunc('month', t.posted_on)::date AS mes,
         sum(-t.amount_cents)::bigint           AS total_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code = '6.01')::bigint AS salario_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code = '6.06')::bigint AS estagio_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code = '4.01')::bigint AS comissao_cents,
         sum(-t.amount_cents) FILTER (WHERE cat.code IN ('6.03', '6.04'))::bigint AS encargo_cents,
         sum(-t.amount_cents) FILTER (
           WHERE cat.code IS NULL
              OR cat.code NOT IN ('6.01', '6.02', '6.03', '6.04', '6.05', '6.06', '4.01')
         )::bigint AS extra_cents
    FROM fin_transaction t
    JOIN fin_person_counterparty l
      ON l.counterparty_id = t.counterparty_id
     AND l.status = 'confirmado'
    JOIN fin_person p ON p.id = l.person_id
    LEFT JOIN fin_category cat ON cat.id = t.category_id
   WHERE t.amount_cents < 0
     AND t.posted_on >= DATE '2026-01-01'
     AND coalesce(t.transfer_status, 'nao') = 'nao'
   GROUP BY 1, 2, 3
),
reemb AS (
  SELECT r.person_id,
         (r.reference_month + INTERVAL '1 mon')::date AS mes,
         r.reference_month::date                      AS competencia,
         r.status,
         r.total_cents::bigint
    FROM fin_reimbursement r
)
SELECT g.entity_id, g.person_id, g.mes, g.natureza, g.valor_cents, g.competencia, g.reembolso_status
  FROM (
    SELECT pg.entity_id, pg.person_id, pg.mes,
           v.natureza, v.valor_cents,
           CASE WHEN v.natureza = 'reembolso' THEN rb.competencia END AS competencia,
           CASE WHEN v.natureza = 'reembolso' THEN rb.status END      AS reembolso_status
      FROM pago pg
      LEFT JOIN reemb rb ON rb.person_id = pg.person_id AND rb.mes = pg.mes
      LEFT JOIN LATERAL (
        SELECT sb.valor_cents
          FROM fin_pessoa_salario_base sb
         WHERE sb.person_id = pg.person_id
           AND sb.vigente_desde <= pg.mes
         ORDER BY sb.vigente_desde DESC
         LIMIT 1
      ) base ON TRUE
      LEFT JOIN LATERAL (
        SELECT coalesce(sum(cd.valor_cents), 0)::bigint AS valor_cents
          FROM fin_pessoa_comissao_declarada cd
         WHERE cd.person_id = pg.person_id
           AND cd.competencia = pg.mes
      ) decl ON TRUE
      -- 0171: o ajuste manual do mês, quando existir.
      LEFT JOIN LATERAL (
        SELECT aj.salario_cents, aj.prolabore_cents
          FROM fin_pessoa_mes_ajuste aj
         WHERE aj.person_id = pg.person_id
           AND aj.mes = pg.mes
      ) ajuste ON TRUE
      CROSS JOIN LATERAL (
        SELECT (pg.total_cents
                - coalesce(pg.estagio_cents, 0)
                - CASE WHEN base.valor_cents IS NULL THEN coalesce(pg.salario_cents, 0) ELSE 0 END
                - coalesce(pg.comissao_cents, 0)
                - coalesce(pg.encargo_cents, 0)
                - coalesce(pg.extra_cents, 0)) AS bruta
      ) sbr
      CROSS JOIN LATERAL (
        SELECT LEAST(coalesce(rb.total_cents, 0), GREATEST(sbr.bruta, 0)) AS reembolso
      ) r2
      CROSS JOIN LATERAL (
        SELECT sbr.bruta - r2.reembolso AS pos_reembolso
      ) s1
      CROSS JOIN LATERAL (
        SELECT CASE WHEN base.valor_cents IS NULL THEN 0
                    ELSE LEAST(base.valor_cents, GREATEST(s1.pos_reembolso, 0)) END AS salario_base
      ) sb2
      CROSS JOIN LATERAL (
        SELECT s1.pos_reembolso - sb2.salario_base AS pos_salario
      ) s2
      CROSS JOIN LATERAL (
        SELECT LEAST(coalesce(decl.valor_cents, 0), GREATEST(s2.pos_salario, 0)) AS comissao_decl
      ) cd2
      CROSS JOIN LATERAL (
        VALUES
          ('salario',
           CASE WHEN ajuste.salario_cents IS NOT NULL THEN ajuste.salario_cents
                WHEN base.valor_cents IS NULL THEN coalesce(pg.salario_cents, 0)
                ELSE sb2.salario_base END),
          ('estagio',  coalesce(pg.estagio_cents, 0)),
          ('comissao', coalesce(pg.comissao_cents, 0) + cd2.comissao_decl),
          ('encargo_beneficio', coalesce(pg.encargo_cents, 0)),
          ('extra',    coalesce(pg.extra_cents, 0)),
          ('reembolso', r2.reembolso),
          ('prolabore',
           CASE WHEN ajuste.prolabore_cents IS NOT NULL THEN ajuste.prolabore_cents
                ELSE s2.pos_salario - cd2.comissao_decl END)
      ) AS v(natureza, valor_cents)
  ) g
 WHERE g.valor_cents > 0;

COMMENT ON VIEW fin_time_remuneracao_mes_v IS
  'O que cada pessoa recebeu por mês e por natureza. Quando existe uma linha em '
  'fin_pessoa_mes_ajuste (0171) para o par pessoa×mês, salário e pró-labore vêm '
  'de lá — confirmados à mão — em vez da fórmula. Reembolso, comissão, estágio, '
  'encargo e extra continuam vindo de onde sempre vieram, mesmo em mês ajustado.';

-- ---------------------------------------------------------------------------
-- Pós-condições
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer; v numeric;
BEGIN
  SELECT count(*) INTO n FROM fin_time_remuneracao_mes_v WHERE valor_cents <= 0;
  IF n <> 0 THEN RAISE EXCEPTION '% linha(s) com valor não positivo', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT r.person_id, r.mes, sum(r.valor_cents) AS bandas,
           (SELECT sum(-t.amount_cents)
              FROM fin_transaction t
              JOIN fin_person_counterparty l
                ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
             WHERE l.person_id = r.person_id
               AND date_trunc('month', t.posted_on)::date = r.mes
               AND t.amount_cents < 0
               AND coalesce(t.transfer_status, 'nao') = 'nao'
               AND t.posted_on >= DATE '2026-01-01') AS pago
      FROM fin_time_remuneracao_mes_v r GROUP BY 1, 2
  ) x WHERE bandas IS DISTINCT FROM pago;
  IF n <> 0 THEN RAISE EXCEPTION '% pessoa×mês em que as bandas não somam o pago', n; END IF;

  -- Sem linha nova em fin_pessoa_mes_ajuste, o total não pode ter mudado.
  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v;
  IF v IS DISTINCT FROM 685354.49 THEN
    RAISE EXCEPTION 'o total geral da view mudou — esperava R$ 685.354,49, achei R$ %', v;
  END IF;

  SELECT round(sum(valor_cents) / 100.0, 2) INTO v FROM fin_time_remuneracao_mes_v
   WHERE person_id = 4 AND natureza = 'salario';
  IF v IS DISTINCT FROM 12693.09 THEN
    RAISE EXCEPTION 'salário do Fernando mudou — esperava R$ 12.693,09, achei R$ %', v;
  END IF;

  RAISE NOTICE '0171: fin_pessoa_mes_ajuste criada; view aprendeu a preferi-la; total geral e Fernando intactos';
END $$;
