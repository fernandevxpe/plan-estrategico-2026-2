-- Projeto de cliente ganha segmento: obras e consultoria na mesma forma.
--
-- ---------------------------------------------------------------------------
-- POR QUE AGORA, ANTES DA CONSULTORIA EXISTIR
-- ---------------------------------------------------------------------------
-- A consultoria vai nascer aqui e migrar para o erp-obras depois. Se ela nascer
-- com forma diferente da que o ERP usa, a unificação deixa de ser um UPDATE de
-- procedência e vira tradução de modelo — o tipo de dívida que só aparece no dia
-- da migração, quando já existe histórico financeiro pendurado nela.
--
-- O ERP não tem "obra" e "consultoria" como entidades distintas. Tem UMA:
--
--   model Projeto { segmento ProjetoSegmento }   enum { OBRAS, CONSULTORIA }
--
-- Duas coisas com a mesma forma, separadas por um eixo. Aqui hoje é o oposto:
-- 'obra' é um kind de fin_cost_center, e consultoria não existe. Criar
-- kind='consultoria' ao lado de kind='obra' produziria dois tipos para a mesma
-- coisa — um projeto de cliente com contrato e margem — e nenhum dos dois
-- casaria com `segmento` na hora de unificar.
--
-- ---------------------------------------------------------------------------
-- O EQUIVALENTE, USANDO O QUE JÁ EXISTE
-- ---------------------------------------------------------------------------
-- kind='obra' passa a ser kind='projeto', e o eixo de negócio passa a ser
-- fin_cost_center.nucleo — que já existe desde 0031 e já referencia fin_nucleo,
-- semeado em 0003 com exatamente os valores que interessam:
--
--   obras · consultoria · tecnologia · corporativo
--
-- Ou seja, o mapa para o ERP fica 1:1 e sem tabela de-para:
--
--   Projeto.segmento = OBRAS        →  kind='projeto', nucleo='obras'
--   Projeto.segmento = CONSULTORIA  →  kind='projeto', nucleo='consultoria'
--
-- 'funcional' (os 7 centros de 0003: Comercial, Marketing, Operações…) e
-- 'apoio' (o balde do não-rateado: "Custos internos", "Consultoria" como card
-- do ClickUp, "Ferramentas e equipamentos") continuam como estão. Note que o
-- card "Consultoria" do ClickUp é kind='apoio' e NÃO é o núcleo consultoria —
-- um é balde de rateio, o outro é segmento de negócio.
--
-- ---------------------------------------------------------------------------
-- O CUSTO DE FAZER AGORA É PRATICAMENTE ZERO
-- ---------------------------------------------------------------------------
-- Medido antes de escrever esta migration:
--
--   fin_obra_margem_v ........ nenhum consumidor em lib/, app/ ou scripts/
--   fin_obra_apontamento ..... lido só por import-clickup-projetos.mjs e db-backup.mjs
--   kind='obra' no código .... 2 linhas, ambas em import-clickup-projetos.mjs
--
-- Depois que a consultoria entrar e as telas de margem existirem, o mesmo
-- movimento custa uma migração de dados com histórico em cima.
--
-- ---------------------------------------------------------------------------
-- A CHAVE QUE SOBREVIVE À UNIFICAÇÃO
-- ---------------------------------------------------------------------------
-- fin_cost_center.id é local e NUNCA muda. source/source_id é a procedência, e
-- é só ela que a migração futura reescreve:
--
--   hoje  ... consultoria criada aqui   → source='manual', source_id=NULL
--   depois ... a mesma linha, no ERP    → source='erp',    source_id='<Projeto.id>'
--
-- Como fin_transaction.cost_center_id e fin_obra_apontamento.cost_center_id
-- apontam para o id local, todo o histórico financeiro atravessa a migração sem
-- ser tocado. É o mesmo princípio que 0031 já usa para o ClickUp ("é por
-- source_id que a segunda importação reconhece a obra, não por nome nem por
-- slug") — agora com 'erp' como terceira procedência possível.

-- ---------------------------------------------------------------------------
-- 1. kind: 'obra' → 'projeto'
-- ---------------------------------------------------------------------------
-- O CHECK precisa aceitar os dois durante a troca; o antigo sai no fim.
ALTER TABLE fin_cost_center DROP CONSTRAINT IF EXISTS fin_cost_center_kind_check;
ALTER TABLE fin_cost_center
  ADD CONSTRAINT fin_cost_center_kind_check
  CHECK (kind IN ('funcional', 'obra', 'projeto', 'apoio'));

-- Toda obra existente é um projeto do núcleo obras. O nucleo pode já estar
-- preenchido por 0031; COALESCE não sobrescreve quem já foi classificado.
UPDATE fin_cost_center
   SET kind   = 'projeto',
       nucleo = COALESCE(nucleo, 'obras')
 WHERE kind = 'obra';

-- Agora que ninguém mais é 'obra', o valor sai do domínio.
ALTER TABLE fin_cost_center DROP CONSTRAINT fin_cost_center_kind_check;
ALTER TABLE fin_cost_center
  ADD CONSTRAINT fin_cost_center_kind_check
  CHECK (kind IN ('funcional', 'projeto', 'apoio'));

COMMENT ON COLUMN fin_cost_center.kind IS
  'funcional = área que gasta (os 7 de 0003). projeto = trabalho de cliente com contrato e '
  'margem próprios — obra OU consultoria, separados por `nucleo`, espelhando '
  'Projeto.segmento do erp-obras. apoio = card que ocupa o campo "Projetos" sem ser '
  'trabalho de cliente ("Custos internos", "Ferramentas e equipamentos"); entra no ranking '
  'só para o total fechar.';

-- ---------------------------------------------------------------------------
-- 2. Um projeto sem núcleo é um projeto que não aparece em nenhuma margem
-- ---------------------------------------------------------------------------
-- Sem núcleo, a linha some dos dois rankings (obras e consultoria) e o total
-- para de fechar em silêncio — o mesmo tipo de erro que 0031 evitou com o
-- trigger de centro válido. Aqui a exigência é declarativa e só vale para
-- kind='projeto': funcional e apoio seguem podendo ter nucleo NULL.
ALTER TABLE fin_cost_center DROP CONSTRAINT IF EXISTS fin_cost_center_projeto_tem_nucleo;
ALTER TABLE fin_cost_center
  ADD CONSTRAINT fin_cost_center_projeto_tem_nucleo
  CHECK (kind <> 'projeto' OR nucleo IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. 'erp' entra como procedência
-- ---------------------------------------------------------------------------
-- Declarada antes de existir um único registro dela, porque é o valor que a
-- consultoria vai assumir quando migrar — e porque as obras também vão trocar
-- 'clickup' por 'erp' quando a fonte virar o erp-obras.
ALTER TABLE fin_cost_center DROP CONSTRAINT IF EXISTS fin_cost_center_source_check;
ALTER TABLE fin_cost_center
  ADD CONSTRAINT fin_cost_center_source_check
  CHECK (source IN ('manual', 'clickup', 'erp'));

COMMENT ON COLUMN fin_cost_center.source IS
  'De onde esta linha veio. manual = criada na plataforma (é o caso da consultoria '
  'enquanto ela não migra). clickup = import legado das obras. erp = espelho do '
  'Projeto do erp-obras. A migração futura reescreve source/source_id; o id local '
  'não muda, e por isso todo lançamento já carimbado continua válido.';

-- O índice único (source, source_id) de 0031 já cobre 'erp' — reimportação
-- idempotente do ERP reconhece o projeto por id de lá, não por nome.

-- ---------------------------------------------------------------------------
-- 4. Trigger e view acompanham o novo domínio
-- ---------------------------------------------------------------------------
-- Apontamento pendurado em centro funcional continua sendo o erro que quebra a
-- margem em silêncio (0031 §fin_obra_apontamento_centro_valido); só muda o nome
-- do kind aceito.
CREATE OR REPLACE FUNCTION fin_obra_apontamento_centro_valido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM fin_cost_center WHERE id = NEW.cost_center_id;
  IF v_kind NOT IN ('projeto', 'apoio') THEN
    RAISE EXCEPTION 'centro de custo % é kind=% : apontamento só aceita projeto ou apoio',
      NEW.cost_center_id, v_kind;
  END IF;
  RETURN NEW;
END $$;

-- A margem passa a ser por PROJETO, com o núcleo como coluna — é a mesma conta
-- de 0031, agora servindo obras e consultoria pela mesma porta. As três decisões
-- que 0031 tomou continuam valendo e continuam morando aqui, não nas telas:
-- tesouraria fora, indefinido separado e somado no pior caso, rateio pela
-- allocated_cents (nunca amount_cents, que duplicaria a linha de dois projetos).
DROP VIEW IF EXISTS fin_obra_margem_v;

CREATE OR REPLACE VIEW fin_projeto_margem_v AS
SELECT
  cc.id                                                                    AS cost_center_id,
  cc.entity_id,
  cc.slug,
  cc.name,
  cc.kind,
  cc.nucleo,
  cc.source,
  cc.source_status,
  cc.contract_cents,
  count(a.id)                                                              AS apontamentos,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'entrada'), 0)               AS receita_cents,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'saida'), 0)                 AS custo_cents,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'indefinido'), 0)            AS indefinido_cents,
  COALESCE(sum(a.allocated_cents) FILTER (WHERE a.is_treasury), 0)         AS tesouraria_cents,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'entrada'), 0)
    - COALESCE(sum(a.allocated_cents) FILTER (
        WHERE NOT a.is_treasury AND a.direction IN ('saida', 'indefinido')), 0)
                                                                           AS margem_cents,
  COALESCE(sum(a.allocated_cents) FILTER (
    WHERE NOT a.is_treasury AND a.direction = 'saida' AND a.match_tier = 'A'), 0)
                                                                           AS custo_conciliado_cents
FROM fin_cost_center cc
LEFT JOIN fin_obra_apontamento a ON a.cost_center_id = cc.id
WHERE cc.kind IN ('projeto', 'apoio')
GROUP BY cc.id, cc.entity_id, cc.slug, cc.name, cc.kind, cc.nucleo, cc.source,
         cc.source_status, cc.contract_cents;

COMMENT ON VIEW fin_projeto_margem_v IS
  'Margem por projeto de cliente — obras e consultoria pela mesma porta, separadas por '
  '`nucleo`. Lê SÓ fin_obra_apontamento: nunca some com fin_transaction, é o mesmo '
  'dinheiro visto por outro ângulo. margem_cents já trata indefinido como custo (pior '
  'caso). kind=''apoio'' não é trabalho de cliente: é o custo que ninguém rateou.';

-- Nome antigo mantido como atalho para o recorte obras. Não havia consumidor no
-- código quando esta migration foi escrita; existe para não quebrar consulta
-- manual ou query salva que alguém tenha guardado.
CREATE OR REPLACE VIEW fin_obra_margem_v AS
SELECT * FROM fin_projeto_margem_v
 WHERE nucleo = 'obras' OR kind = 'apoio';

COMMENT ON VIEW fin_obra_margem_v IS
  'Recorte obras de fin_projeto_margem_v. Preferir a view nova em código novo.';
