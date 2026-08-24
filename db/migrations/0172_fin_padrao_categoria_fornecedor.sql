-- Aprendizado de categoria por fornecedor — busca por proximidade, não só
-- igualdade exata.
--
-- ---------------------------------------------------------------------------
-- POR QUE
-- ---------------------------------------------------------------------------
-- A leitura de comprovante (`ler-comprovante.ts`) sugere categoria olhando só
-- a foto — nenhuma memória do que a equipe já escolheu antes para o mesmo
-- fornecedor. Pedido do dono: "o sistema deve aprender com as categorias que
-- vão sendo sugeridas" — e a fonte confiável não é o palpite do modelo, é a
-- categoria que a PESSOA confirmou ao enviar (`fin_time_envio.categoria_sugerida_id`
-- guarda o que ficou no campo na hora do envio, não a sugestão bruta —
-- confirmado lendo `criarEnvioDoTime`/`criarReembolsoDoTime`).
--
-- Busca por PROXIMIDADE, não igualdade: "Auto Posto Petrobras" e "AUTOPOSTO
-- PETROBRAS LTDA FILIAL 2" são o mesmo fornecedor escrito diferente — comum
-- em cupom fiscal, que varia nome a cada impressão. `pg_trgm` (já instalada
-- neste banco) mede semelhança de trigramas: não precisa bater exato, precisa
-- ser parecido o bastante.
--
-- ---------------------------------------------------------------------------
-- A TABELA É UM RESUMO, NÃO UM LOG
-- ---------------------------------------------------------------------------
-- Uma linha por (fornecedor normalizado, categoria), com contador — não uma
-- linha por envio. `fin_time_envio` já é o log; replicá-lo aqui criaria duas
-- verdades. O contador é o que permite responder "qual categoria domina para
-- este fornecedor", não só "quais categorias já apareceram".

CREATE TABLE fin_padrao_categoria_fornecedor (
  id             bigserial PRIMARY KEY,
  entity_id      bigint      NOT NULL REFERENCES fin_entity(id),
  fornecedor_norm text       NOT NULL,
  category_id    bigint      NOT NULL REFERENCES fin_category(id),
  vezes          int         NOT NULL DEFAULT 1 CHECK (vezes > 0),
  primeira_vez_em timestamptz NOT NULL DEFAULT now(),
  ultima_vez_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, fornecedor_norm, category_id)
);

-- Índice de trigrama: é o que faz "parecido com" ser uma consulta rápida em
-- vez de varrer a tabela inteira calculando semelhança linha a linha.
CREATE INDEX fin_padrao_categoria_fornecedor_trgm_idx
  ON fin_padrao_categoria_fornecedor USING gin (fornecedor_norm gin_trgm_ops);

COMMENT ON TABLE fin_padrao_categoria_fornecedor IS
  'Quantas vezes cada (fornecedor, categoria) foi CONFIRMADA num envio de verdade — não o '
  'palpite da IA, o que a pessoa deixou no campo ao enviar. Alimentada a cada novo envio '
  '(criarEnvioDoTime/criarReembolsoDoTime/criarCompraDoTime); consultada por semelhança de '
  'trigrama (pg_trgm) antes de sugerir categoria numa leitura de comprovante nova.';

COMMENT ON COLUMN fin_padrao_categoria_fornecedor.fornecedor_norm IS
  'Nome do fornecedor normalizado (minúsculo, sem acento, espaços colapsados) — mesma '
  'função normalizeName() já usada para contraparte, para não reinventar a normalização.';
