-- O modelo de gestão do dono, como estrutura de dados.
--
-- POR QUE ESTAS TABELAS EXISTEM
--
-- A empresa é dirigida por uma planilha de 21 abas. A aba "Fluxo de Caixa" é a
-- que o dono lê para decidir: 113 linhas, doze colunas de mês, hierarquia de
-- três níveis (grupo → família → item). O ledger tem os mesmos fatos, mas
-- organizados por plano de contas (3.01, 4.02, 6.01…), que é a linguagem da
-- contabilidade, não a da decisão. "Equipe Obras" não é uma categoria contábil:
-- é a interseção de três categorias de pessoal com um núcleo.
--
-- Traduzir uma na outra dentro de uma consulta faria a tradução virar código —
-- invisível, não auditável, e impossível de corrigir sem deploy. Aqui ela é
-- dado: três tabelas, versionadas, com trilha de quem mudou o quê.
--
-- fin_model_line   a estrutura: quais linhas existem e como se aninham
-- fin_model_map    de onde vem o número: linha ↔ (categoria, núcleo)
-- fin_model_value  o número quando não vem do ledger: referência ou digitado
--
-- A DIVISÃO ENTRE AS TRÊS PROCEDÊNCIAS, que é o ponto do desenho
--
-- Cada célula (linha × mês) pode ter até três valores, e eles NÃO se somam:
--
--   realizado   somado do ledger pelo mapa. É o que os extratos provam.
--   referencia  o que a planilha do dono diz. Congelado, para comparação.
--   manual      o que o dono digitou na tela, quando sabe algo que o extrato
--               não sabe (uma nota que ainda não caiu, um rateio).
--
-- O valor exibido é `manual ?? realizado`, e `referencia` fica sempre ao lado
-- como terceira coluna. Assim a tela nunca esconde uma divergência: mostra o
-- que o banco prova, o que a planilha afirma, e a diferença entre os dois.
--
-- Guardar `referencia` no banco em vez de reimportar a planilha a cada leitura
-- é deliberado: a planilha é editada por gente e muda sob os pés. Uma foto
-- datada é comparável; um alvo móvel não é.

CREATE TABLE fin_model_line (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  slug        text   NOT NULL,
  name        text   NOT NULL,
  parent_slug text,
  -- A seção define o SINAL e o lugar no cálculo do resultado. É fechada de
  -- propósito: uma seção nova é uma mudança no modelo de negócio, e deve exigir
  -- migração em vez de acontecer por um INSERT distraído.
  section     text   NOT NULL CHECK (section IN
                ('receita','deducao','custo_operacao','custo_fixo','resultado')),
  -- 'item' soma do ledger; 'subtotal' soma os filhos; 'calculado' vem de fórmula.
  kind        text   NOT NULL DEFAULT 'item'
                CHECK (kind IN ('item','subtotal','calculado')),
  sort_order  int    NOT NULL,
  -- A linha da planilha de onde isto veio. Serve para reconciliar quando o dono
  -- perguntar "de onde saiu essa linha".
  origem_linha int,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (entity_id, slug),
  -- Alvo do par (line_id, entity_id) usado pelo mapa abaixo, para que uma linha
  -- da XPE não possa ser mapeada a uma categoria de outra entidade.
  UNIQUE (id, entity_id)
);

CREATE INDEX fin_model_line_pai_ix ON fin_model_line (entity_id, parent_slug);

-- De onde o número vem. Várias linhas por `line_id` = união dos critérios.
--
-- `nucleo` nulo significa "qualquer núcleo". É o que separa "Equipe Base" de
-- "Equipe Obras": mesma categoria 6.01, núcleos diferentes.
-- `entity_id` repetido aqui não é descuido de normalização: `fin_category` é
-- única por (entity_id, code), então só um par pode ser referenciado. Sem a
-- coluna, o banco aceitaria mapear uma linha da XPE a uma categoria de outra
-- entidade, e o erro só apareceria como número errado meses depois.
CREATE TABLE fin_model_map (
  id            bigserial PRIMARY KEY,
  entity_id     bigint NOT NULL,
  line_id       bigint NOT NULL,
  category_code text   NOT NULL,
  nucleo        text   REFERENCES fin_nucleo(slug) ON UPDATE CASCADE,
  -- Quando verdadeiro, casa tudo EXCETO o núcleo indicado. "Equipe Base" é
  -- 6.01 com núcleo diferente de obras — e sem isto seria preciso listar os
  -- outros três núcleos e lembrar de voltar aqui quando nascer o quinto.
  nucleo_excluir boolean NOT NULL DEFAULT false,
  observacao    text,
  UNIQUE (line_id, category_code, nucleo, nucleo_excluir),
  CHECK (NOT nucleo_excluir OR nucleo IS NOT NULL),
  FOREIGN KEY (line_id, entity_id)
    REFERENCES fin_model_line (id, entity_id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id, category_code)
    REFERENCES fin_category (entity_id, code) ON UPDATE CASCADE
);

CREATE INDEX fin_model_map_cat_ix ON fin_model_map (category_code);

-- O valor que não vem do ledger.
--
-- `procedencia` distingue o que foi copiado da planilha do que foi digitado na
-- tela. Sem essa distinção, a primeira edição do dono viraria indistinguível da
-- importação, e a próxima reimportação a apagaria sem aviso.
CREATE TABLE fin_model_value (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  line_slug   text   NOT NULL,
  ano         int    NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  mes         int    NOT NULL CHECK (mes BETWEEN 1 AND 12),
  procedencia text   NOT NULL CHECK (procedencia IN ('referencia','manual')),
  -- Sempre no sinal do impacto no resultado: receita positiva, custo negativo.
  -- Normalizar aqui evita que cada leitor tenha de lembrar o sinal da seção.
  valor_cents bigint NOT NULL,
  motivo      text,
  updated_by  text   NOT NULL DEFAULT 'sistema',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Uma célula por procedência: reimportar a planilha atualiza a referência sem
  -- tocar no que o dono digitou, e vice-versa.
  UNIQUE (entity_id, line_slug, ano, mes, procedencia)
);

CREATE INDEX fin_model_value_periodo_ix ON fin_model_value (entity_id, ano, mes);
