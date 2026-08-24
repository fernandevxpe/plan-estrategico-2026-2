-- Pró-labore esperado — para PREVER o mês seguinte, sem mexer no que já
-- aconteceu.
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO É UMA COLUNA NOVA NA FÓRMULA DE fin_time_remuneracao_mes_v
-- ---------------------------------------------------------------------------
-- O pró-labore de um mês FECHADO é o resto por construção (0164/0165): sobra
-- depois de reembolso, salário-base e comissão declarada — e a soma das
-- bandas é PROVADA igual ao que caiu na conta (pós-condição das duas
-- migrations anteriores). Não existe "pró-labore errado" num mês passado para
-- corrigir; existe só o que sobrou.
--
-- O pedido aqui é outro: "quero prever o mês que vem". Mês que vem não tem
-- transação nenhuma ainda — não tem sobra para calcular. Precisa de um número
-- AFIRMADO, do mesmo jeito que salário-base é afirmado, mas sem entrar na
-- fórmula que reconstrói o passado. Por isso é tabela nova, não mais uma
-- CROSS JOIN LATERAL na view de 0165.
--
-- MESMO FORMATO DE fin_pessoa_salario_base: vigência, não competência — o
-- pró-labore esperado de um sócio muda raro (é o mesmo motivo de vigência no
-- salário: um valor por vez, vale até o próximo).

CREATE TABLE IF NOT EXISTS fin_pessoa_prolabore_esperado (
  id            bigserial PRIMARY KEY,
  entity_id     bigint      NOT NULL REFERENCES fin_entity(id),
  person_id     bigint      NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  vigente_desde date        NOT NULL,
  valor_cents   bigint      NOT NULL CHECK (valor_cents > 0),
  nota          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, vigente_desde)
);

COMMENT ON TABLE fin_pessoa_prolabore_esperado IS
  'Pró-labore ESPERADO, para prever o mês seguinte — não entra em fin_time_remuneracao_mes_v, '
  'que continua calculando o pró-labore real como resto (0164/0165). Isto é só o insumo da '
  'previsão: "quanto normalmente sobra", afirmado por quem paga, não deduzido do extrato.';

COMMENT ON COLUMN fin_pessoa_prolabore_esperado.vigente_desde IS
  'A partir de quando este valor esperado vale — mesmo desenho de fin_pessoa_salario_base.';
