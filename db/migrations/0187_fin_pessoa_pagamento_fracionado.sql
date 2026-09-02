-- Pagamento de folha em mais de um PIX no mês — dia e valor por parcela.
--
-- ---------------------------------------------------------------------------
-- O CASO QUE ABRIU ISSO
-- ---------------------------------------------------------------------------
-- Rita Pereira (limpeza, MEI) recebe R$ 1.000/mês de salário cadastrado, mas
-- a casa paga em dois Pix: ~R$ 500 na primeira semana (dia 2) e ~R$ 500 no
-- meio do mês (dia 16). Até aqui `bandasParaPagar` gerava UMA linha no dia 2.
--
-- Comissão já quebrava por pacote (`…:comissao:obras`). Esta tabela faz o
-- equivalente para salário e pró-labore: cada parcela vira linha, chave e
-- `due_date` próprios na ordem de pagamento.
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO SÓ DOIS REGISTROS NA TELA
-- ---------------------------------------------------------------------------
-- Sem cadastro, o fracionamento morreria no código ou num comentário. A regra
-- se repete todo mês e pode mudar de vigência — igual `fin_pessoa_salario_base`.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS fin_pessoa_pagamento_fracionado (
  id            bigserial PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES fin_entity(id),
  person_id     bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  natureza      text        NOT NULL CHECK (natureza IN ('salario', 'prolabore')),
  parcela       smallint    NOT NULL CHECK (parcela >= 1 AND parcela <= 12),
  dia_mes       smallint    NOT NULL CHECK (dia_mes >= 1 AND dia_mes <= 28),
  valor_cents   bigint      NOT NULL CHECK (valor_cents > 0),
  vigente_desde date        NOT NULL,
  nota          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, natureza, parcela, vigente_desde)
);

COMMENT ON TABLE fin_pessoa_pagamento_fracionado IS
  'Como dividir salário ou pró-labore em mais de um Pix no mês. Cada parcela vira '
  'uma linha em Contas a pagar, com chave `fin_person:id:natureza:parcela` e dia '
  'próprio. Quem não tem linha aqui continua com um Pix só no dia 2.';

COMMENT ON COLUMN fin_pessoa_pagamento_fracionado.dia_mes IS
  'Dia do mês em que cai esta parcela (1–28). Meses curtos usam o último dia '
  'válido na aplicação — fevereiro não quebra.';

-- Rita: R$ 500 no dia 2 + R$ 500 no dia 16, a partir de set/2026 ----------------

INSERT INTO fin_pessoa_pagamento_fracionado
  (entity_id, person_id, natureza, parcela, dia_mes, valor_cents, vigente_desde, nota)
SELECT p.entity_id, p.id, 'salario', 1, 2, 50000,
       DATE '2026-09-01',
       'Prestação de serviço: metade na 1ª semana (dia 2). Afirmado em 01/09/2026.'
  FROM fin_person p
  JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
 WHERE lower(p.name) LIKE '%rita pereira%'
ON CONFLICT (person_id, natureza, parcela, vigente_desde) DO NOTHING;

INSERT INTO fin_pessoa_pagamento_fracionado
  (entity_id, person_id, natureza, parcela, dia_mes, valor_cents, vigente_desde, nota)
SELECT p.entity_id, p.id, 'salario', 2, 16, 50000,
       DATE '2026-09-01',
       'Prestação de serviço: metade no meio do mês (dia 16). Afirmado em 01/09/2026.'
  FROM fin_person p
  JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
 WHERE lower(p.name) LIKE '%rita pereira%'
ON CONFLICT (person_id, natureza, parcela, vigente_desde) DO NOTHING;

-- Pós-condições ---------------------------------------------------------------

DO $$
DECLARE
  v_rita_id bigint;
  v_parcelas int;
  v_soma bigint;
BEGIN
  SELECT p.id INTO v_rita_id
    FROM fin_person p
    JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
   WHERE lower(p.name) LIKE '%rita pereira%'
   LIMIT 1;

  IF v_rita_id IS NULL THEN
    RAISE EXCEPTION '0187: Rita Pereira não encontrada em fin_person';
  END IF;

  SELECT count(*)::int, coalesce(sum(valor_cents), 0)
    INTO v_parcelas, v_soma
    FROM fin_pessoa_pagamento_fracionado
   WHERE person_id = v_rita_id
     AND natureza = 'salario'
     AND vigente_desde = DATE '2026-09-01';

  IF v_parcelas <> 2 THEN
    RAISE EXCEPTION '0187: Rita deveria ter 2 parcelas de salário, tem %', v_parcelas;
  END IF;

  IF v_soma <> 100000 THEN
    RAISE EXCEPTION '0187: Rita parcelas somam %, esperado 100000', v_soma;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fin_pessoa_pagamento_fracionado
     WHERE person_id = v_rita_id AND natureza = 'salario' AND parcela = 1 AND dia_mes = 2
  ) OR NOT EXISTS (
    SELECT 1 FROM fin_pessoa_pagamento_fracionado
     WHERE person_id = v_rita_id AND natureza = 'salario' AND parcela = 2 AND dia_mes = 16
  ) THEN
    RAISE EXCEPTION '0187: dias das parcelas da Rita não batem (2 e 16)';
  END IF;
END $$;
