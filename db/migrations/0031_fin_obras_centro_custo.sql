-- A obra como centro de custo, e o apontamento do ClickUp como dimensão.
--
-- O buraco que isto fecha: fin_transaction.cost_center_id é NULL em 13.686 de
-- 13.686 linhas. A plataforma não sabe qual obra consumiu qual custo e portanto
-- não responde "esta obra deu lucro?" — a pergunta central de uma empresa de
-- obras. fin_cost_center existe desde 0003 com 7 centros FUNCIONAIS (Comercial,
-- Marketing, Operações…), que são o eixo "que área gastou", não "que obra".
--
-- A fonte é o ClickUp: espaço Obras, lista "Obras" (32 cards de projeto, 31 com
-- "Valor do Projeto") e lista "Fluxo de caixa" (758 lançamentos, 755 com "Valor
-- pago", 728 ligados a um card por RELACIONAMENTO — não por texto). A relação é
-- bidirecional e fecha exatamente: as 728 setas de ida batem uma a uma com as
-- 727 de volta em "Registros de Pagamentos", zero órfãs dos dois lados. Dentro
-- do ClickUp, portanto, "que obra consumiu isto" é dado confiável.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA NOVA E NÃO SÓ UM CARIMBO EM fin_transaction
-- ---------------------------------------------------------------------------
-- Porque o carimbo não cobre a obra inteira. Medido linha a linha contra o
-- ledger (valor exato + nome + janela de dias + 1:1 estrito):
--
--   387 dos 755 lançamentos (R$ 400.035) acham UM lançamento bancário
--    96 acham um só por valor+data, sem o nome confirmar  (R$ 158.261)
--   163 são ambíguos ou colidem com outro apontamento     (R$ 145.450)
--    72 não têm candidato nenhum                          (R$ 166.183)
--    26 não têm valor ou não têm data                     (R$  37.623)
--
-- Metade. Um cost_center_id gravado só nessa metade faria toda tela de margem
-- por obra somar metade do custo e exibir uma obra lucrativa que não é. O erro
-- não seria de arredondamento: seria de sinal.
--
-- Então o custo e a receita por obra passam a viver aqui, em
-- fin_obra_apontamento, onde estão COMPLETOS. O carimbo em fin_transaction fica
-- sendo o que ele de fato é — navegação ("qual linha do extrato pagou isto") —
-- e não a fonte do número.
--
-- ---------------------------------------------------------------------------
-- ISTO NÃO É DINHEIRO NOVO
-- ---------------------------------------------------------------------------
-- Os ~R$ 970 mil que passam pelo "Fluxo de caixa" do ClickUp são O MESMO
-- dinheiro já importado de Nubank, Inter e Asaas, visto por outro ângulo (o de
-- quem executa a obra). Somar as duas tabelas conta cada real duas vezes.
--
-- É por isso que fin_obra_apontamento NÃO tem account_id: sem conta, ela não
-- entra em nenhum saldo, em nenhuma cobertura de extrato e em nenhum JOIN com
-- fin_account. E é por isso que ela não é fin_transaction com source='clickup':
-- ali dentro, toda soma de caixa a pegaria.
--
--   fin_transaction ......... o dinheiro. Uma linha = uma vez que o banco mexeu.
--   fin_obra_apontamento .... a atribuição. Uma linha = uma vez que alguém disse
--                             a que obra aquele gasto pertence.

-- ---------------------------------------------------------------------------
-- 1. fin_cost_center ganha o eixo "obra"
-- ---------------------------------------------------------------------------
ALTER TABLE fin_cost_center
  -- 'funcional' são os 7 de 0003 (área que gasta). 'obra' é um projeto de
  -- cliente com contrato e margem própria. 'apoio' é um card do ClickUp que
  -- ocupa o mesmo campo mas NÃO é obra: "Custos internos" (424 lançamentos,
  -- R$ 256.727), "Consultoria" e "Ferramentas e equipamentos". Sem a distinção,
  -- "Custos internos" apareceria no ranking de margem como a obra mais
  -- deficitária da empresa — e ela não é obra, é o balde do que não foi rateado.
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'funcional'
    CHECK (kind IN ('funcional', 'obra', 'apoio')),
  ADD COLUMN IF NOT EXISTS nucleo text REFERENCES fin_nucleo(slug),

  -- Reimportação idempotente. O nome do card muda ("Edf. Castelo the Blois" e
  -- "Edf. Castelo The Blois" são DOIS cards distintos, com contratos distintos,
  -- que produzem o mesmo slug) — o id da tarefa não muda. É por source_id que a
  -- segunda importação reconhece a obra, não por nome nem por slug.
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'clickup')),
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS source_list_id text,
  ADD COLUMN IF NOT EXISTS source_status text,
  ADD COLUMN IF NOT EXISTS external_url text,

  -- "Valor do Projeto" do card. É CONTRATO, não caixa: soma R$ 530.909 nos 31
  -- cards preenchidos enquanto a receita efetivamente apontada é R$ 351.163. A
  -- diferença é obra em execução e obra a receber, não erro. Guardar os dois
  -- separados é o que permite ver "faturei 66% do que contratei".
  ADD COLUMN IF NOT EXISTS contract_cents bigint CHECK (contract_cents IS NULL OR contract_cents >= 0),
  ADD COLUMN IF NOT EXISTS signed_on date,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN fin_cost_center.kind IS
  'funcional = área que gasta (os 7 de 0003, eixo antigo). obra = projeto de cliente, '
  'com contrato e margem próprios. apoio = card do ClickUp que ocupa o campo "Projetos" '
  'sem ser obra ("Custos internos", "Consultoria", "Ferramentas e equipamentos"). Todo '
  'ranking de margem por obra filtra kind = ''obra''; sem isso "Custos internos" lidera '
  'o prejuízo sendo o balde do não-rateado, não uma obra.';

COMMENT ON COLUMN fin_cost_center.contract_cents IS
  'Valor contratado da obra ("Valor do Projeto" no ClickUp). NÃO é caixa e NÃO é receita '
  'reconhecida: é o denominador de "quanto já faturei desta obra". A receita efetiva vem '
  'de fin_obra_apontamento.';

COMMENT ON COLUMN fin_cost_center.source_id IS
  'Id da tarefa do ClickUp. A chave de reimportação — nome e slug mudam, id não. Dois '
  'cards com nomes que diferem só por maiúscula existem hoje e são obras diferentes.';

-- Os 7 centros de 0003 são funcionais e sempre foram; o DEFAULT já os cobre,
-- mas deixar explícito impede que um futuro DEFAULT diferente os reclassifique.
UPDATE fin_cost_center SET kind = 'funcional' WHERE source = 'manual' AND kind <> 'funcional';

-- Reimportação idempotente: a segunda rodada acha a obra por (source, source_id)
-- e faz UPDATE, em vez de criar uma segunda cópia com slug '-2'.
CREATE UNIQUE INDEX IF NOT EXISTS fin_cost_center_source_idx
  ON fin_cost_center (source, source_id) WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fin_cost_center_kind_idx
  ON fin_cost_center (kind, is_active);

DROP TRIGGER IF EXISTS fin_cost_center_touch ON fin_cost_center;
CREATE TRIGGER fin_cost_center_touch BEFORE UPDATE ON fin_cost_center
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. fin_obra_apontamento — o "Fluxo de caixa" do ClickUp como DIMENSÃO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fin_obra_apontamento (
  id             bigserial PRIMARY KEY,
  entity_id      bigint NOT NULL REFERENCES fin_entity(id),
  cost_center_id bigint NOT NULL REFERENCES fin_cost_center(id),

  source         text NOT NULL DEFAULT 'clickup' CHECK (source IN ('clickup', 'manual')),
  source_id      text NOT NULL,
  source_list_id text,
  external_url   text,

  title          text NOT NULL,

  -- Valor CHEIO da tarefa, sempre positivo — o sentido mora em `direction`,
  -- igual a fin_document e pelo mesmo motivo.
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),

  -- Quanto DESTE apontamento pertence a ESTE centro de custo.
  --
  -- 3 tarefas apontam para duas obras ao mesmo tempo (uma compra de material na
  -- Jaguar dividida entre Reserva do Poço e Montendre, R$ 1.184). Elas viram
  -- duas linhas, e é allocated_cents — não amount_cents — que a margem soma.
  -- Somar amount_cents contaria a compra duas vezes. A soma dos
  -- allocated_cents das linhas de um mesmo source_id fecha em amount_cents.
  allocated_cents bigint NOT NULL CHECK (allocated_cents > 0),

  -- 83 das 758 tarefas não têm "Movimentação" preenchida (R$ 49.098). NULL
  -- viraria "não é entrada nem saída" e sumiria de toda conta; 'indefinido' é
  -- explícito e aparece como coluna própria na margem, que é o número honesto:
  -- a obra tem R$ X de custo e R$ Y que ninguém disse se é custo.
  direction      text NOT NULL CHECK (direction IN ('entrada', 'saida', 'indefinido')),

  -- Movimento de tesouraria vestido de lançamento de obra: "Reserva de caixa"
  -- (R$ 80.427), "Pagamento de Fatura" (R$ 78.540, que é a fatura do cartão e
  -- portanto RECONTA as compras já lançadas), "Caixa Impostos", "Aplicação RDB"
  -- e "Resgate RDB". Somados, R$ 181.531 apontados a obras — 42% do custo
  -- aparente. Sem esta marca, Edf. Verano carrega uma "Aplicação RDB" de
  -- R$ 17.000 como custo de obra e fecha no vermelho por causa dela.
  is_treasury    boolean NOT NULL DEFAULT false,

  -- Campos do ClickUp guardados como TEXTO do rótulo, já resolvidos.
  --
  -- No JSON eles são orderindex ("0", "1") e só o type_config.options daquela
  -- tarefa diz o que significam. Guardar o índice cru tornaria a tabela
  -- ilegível e refém de uma reordenação do dropdown no ClickUp — que ninguém
  -- avisaria e que reescreveria o passado.
  clickup_category    text,
  clickup_subcategory text,
  payment_method      text,
  beneficiary         text,
  source_account      text,

  -- due_date da tarefa. É VENCIMENTO, não liquidação: nos 32 casos em que dá
  -- para comparar com uma data de pagamento informada, só 8 coincidem e a
  -- diferença chega a 316 dias. Usar isto como data de caixa é errado; usar
  -- como eixo de tempo do apontamento é o que existe (735 das 758 têm).
  due_on         date,

  -- "Data do Pagamento" do ClickUp. Só 35 tarefas têm — e todas as 35 são
  -- ENTRADA de "Receita Projeto", 8 delas com data no futuro (out–dez/2026).
  -- Ou seja: é o CRONOGRAMA de recebimento do contrato, não o registro de um
  -- pagamento ocorrido. O nome do campo mente; a coluna não deve.
  scheduled_on   date,
  created_on     date,
  task_status    text,

  -- ---------------------------------------------------------------------------
  -- A ponte com o extrato. Fraca de propósito, e medida.
  -- ---------------------------------------------------------------------------
  -- 'A' nome + valor exato + até 2 dias + 1:1 estrito ..... 387 (R$ 400.035)
  -- 'C' só valor + data, o nome não confirma .............. 96  (R$ 158.261)
  -- 'X' ambíguo, ou dois apontamentos disputam a mesma linha 163 (R$ 145.450)
  -- 'N' sem candidato ..................................... 72  (R$ 166.183)
  -- '-' sem valor ou sem data ............................. 26  (R$  37.623)
  --
  -- A faixa 'B' (nome + valor, 3 a 7 dias) foi MEDIDA E DESCARTADA: repetindo o
  -- casamento com todas as datas deslocadas em 30 dias — onde, por construção,
  -- nenhum acerto é possível — ela produz tantos pares quanto na data real. É
  -- ruído. A faixa 'A' cai de 387 para ~30 no mesmo teste, o que estima ~8% de
  -- falso positivo; a 'C' cai para ~15, ~16%.
  transaction_id   bigint REFERENCES fin_transaction(id) ON DELETE SET NULL,
  match_tier       text CHECK (match_tier IN ('A', 'C', 'X', 'N', '-')),
  match_score      numeric(4,3),
  match_delta_days integer,
  match_reason     jsonb,
  -- Quem conferiu na mão não é desfeito pela próxima importação.
  match_locked     boolean NOT NULL DEFAULT false,

  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_obra_apontamento_rateio CHECK (allocated_cents <= amount_cents)
);

COMMENT ON TABLE fin_obra_apontamento IS
  'O "Fluxo de caixa" do ClickUp: a que obra cada gasto e cada recebimento pertence. '
  'NÃO É CAIXA. É o MESMO dinheiro de fin_transaction visto por quem executa a obra — '
  'somar as duas tabelas conta cada real duas vezes. Não tem account_id justamente para '
  'não entrar em saldo, cobertura de extrato ou qualquer JOIN com fin_account.';

COMMENT ON COLUMN fin_obra_apontamento.allocated_cents IS
  'Parte de amount_cents que pertence a ESTE centro de custo. É esta coluna que a margem '
  'soma: 3 tarefas apontam duas obras e viram duas linhas, e somar amount_cents nelas '
  'duplicaria a compra.';

COMMENT ON COLUMN fin_obra_apontamento.transaction_id IS
  'Lançamento bancário que este apontamento provavelmente é. PALPITE, não fato: só a '
  'faixa A (387 de 755) tem evidência de nome + valor + data + unicidade, com ~8% de falso '
  'positivo estimado por deslocamento de datas. Nenhum número de margem depende desta '
  'coluna — ela serve para ir do apontamento até a linha do extrato, e não o contrário.';

CREATE UNIQUE INDEX IF NOT EXISTS fin_obra_apontamento_source_idx
  ON fin_obra_apontamento (source, source_id, cost_center_id);
CREATE INDEX IF NOT EXISTS fin_obra_apontamento_cc_idx
  ON fin_obra_apontamento (cost_center_id, due_on);
CREATE INDEX IF NOT EXISTS fin_obra_apontamento_tx_idx
  ON fin_obra_apontamento (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_obra_apontamento_tier_idx
  ON fin_obra_apontamento (match_tier);

DROP TRIGGER IF EXISTS fin_obra_apontamento_touch ON fin_obra_apontamento;
CREATE TRIGGER fin_obra_apontamento_touch BEFORE UPDATE ON fin_obra_apontamento
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Um apontamento de obra pendurado num centro de custo FUNCIONAL é o erro que
-- quebra a margem em silêncio: a linha some do ranking (que filtra kind='obra')
-- e reaparece dentro de "Marketing". A FK sozinha não vê a diferença.
CREATE OR REPLACE FUNCTION fin_obra_apontamento_centro_valido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM fin_cost_center WHERE id = NEW.cost_center_id;
  IF v_kind NOT IN ('obra', 'apoio') THEN
    RAISE EXCEPTION 'centro de custo % é kind=% : apontamento de obra só aceita obra ou apoio',
      NEW.cost_center_id, v_kind;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_obra_apontamento_centro ON fin_obra_apontamento;
CREATE TRIGGER fin_obra_apontamento_centro BEFORE INSERT OR UPDATE ON fin_obra_apontamento
  FOR EACH ROW EXECUTE FUNCTION fin_obra_apontamento_centro_valido();

-- ---------------------------------------------------------------------------
-- 3. A pergunta, respondida: esta obra deu lucro?
-- ---------------------------------------------------------------------------
-- Uma view e não uma tela com SQL espalhado, porque a definição de "custo da
-- obra" tem três decisões dentro (tesouraria fora, indefinido separado, rateio
-- da linha de dois projetos) e duas telas que as tomem separado vão discordar.
CREATE OR REPLACE VIEW fin_obra_margem_v AS
SELECT
  cc.id                                                                    AS cost_center_id,
  cc.entity_id,
  cc.slug,
  cc.name,
  cc.kind,
  cc.source_status,
  cc.contract_cents,
  count(a.id)                                                              AS apontamentos,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'entrada'), 0)               AS receita_cents,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'saida'), 0)                 AS custo_cents,
  -- Nem custo nem receita: falta a marcação de Movimentação no ClickUp. Fica em
  -- coluna própria em vez de virar zero (que esconde) ou custo (que inventa).
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'indefinido'), 0)            AS indefinido_cents,
  COALESCE(sum(a.allocated_cents) FILTER (WHERE a.is_treasury), 0)         AS tesouraria_cents,
  -- Pior caso: todo indefinido é custo. É esta a margem que se leva para uma
  -- decisão, porque é a que não depende de otimismo.
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'entrada'), 0)
    - COALESCE(sum(a.allocated_cents) FILTER (
        WHERE NOT a.is_treasury AND a.direction IN ('saida', 'indefinido')), 0)
                                                                           AS margem_cents,
  -- Quanto do custo desta obra tem uma linha de extrato identificada. É o
  -- medidor de confiança da própria linha: 100% não existe hoje em obra nenhuma.
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'saida' AND a.match_tier = 'A'), 0)
                                                                           AS custo_conciliado_cents
FROM fin_cost_center cc
LEFT JOIN fin_obra_apontamento a ON a.cost_center_id = cc.id
WHERE cc.kind IN ('obra', 'apoio')
GROUP BY cc.id, cc.entity_id, cc.slug, cc.name, cc.kind, cc.source_status, cc.contract_cents;

COMMENT ON VIEW fin_obra_margem_v IS
  'Margem por obra pela dimensão ClickUp. Lê SÓ fin_obra_apontamento — nunca some com '
  'fin_transaction, é o mesmo dinheiro. margem_cents já trata indefinido como custo (pior '
  'caso). Linhas com kind=''apoio'' ("Custos internos" e afins) NÃO são obras: são o custo '
  'que ninguém rateou, e entram no ranking só para que o total feche.';
