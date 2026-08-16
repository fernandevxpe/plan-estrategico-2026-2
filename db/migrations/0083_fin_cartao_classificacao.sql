-- O cartão ganha categoria — e declara, item a item, o que ainda não sabe.
--
-- Medido em 16/08/2026 contra a API do Polp (somente GET, conta CREDIT 2589) e
-- contra o próprio ledger:
--
--    795 itens em fin_card_transaction    R$ 194.205,99 em valor absoluto
--      0 com category_id                  0 com cost_center_id, 0 com nucleo
--    781 itens que a DRE enxerga          (795 menos 14 pagamentos de fatura)
--    R$ -84.058,09 em lacuna_cartao_cents na visão competência
--
-- Por que ninguém tinha visto: o indicador "categoria atribuída" do painel mede
-- `fin_transaction`, e item de cartão NÃO é `fin_transaction` (0047 §1). O
-- painel diz 98,8% e está certo sobre a base que ele mede. Este arquivo é o
-- buraco ao lado dela.
--
-- ===========================================================================
-- 1. A EVIDÊNCIA QUE EXISTE — E A QUE FOI PROCURADA E NÃO EXISTE
-- ===========================================================================
-- Antes de classificar qualquer coisa foi preciso medir do que se dispõe. O
-- resultado desmente a suposição com que esta frente começou, e registrar isso
-- vale mais que o código abaixo:
--
--   CNPJ do estabelecimento .... 32 de 795 itens têm `merchant` preenchido, e
--       apenas 23 trazem CNPJ de 14 dígitos. Os 9 restantes são "Apple" com
--       `cnpj: "623904"` — seis dígitos, não é CNPJ. São 5 CNPJs distintos ao
--       todo (Uber, Microsoft, Google, Amazon, Sendas). Contra os 89% de
--       cobertura que o Polp entrega no EXTRATO da conta corrente, o cartão
--       entrega 2,9%. A ponte por documento, que é a mais forte que existe no
--       resto da base, aqui não tem por onde passar.
--
--   fin_counterparty.default_category_id .... 0 de 495 contrapartes têm
--       categoria padrão. Mesmo os 2 CNPJs do cartão que JÁ estão cadastrados
--       (Uber id 864, Amazon id 877) não decidem nada. A segunda ponte também
--       está vazia — não por falta de ligação, por falta de conteúdo do outro
--       lado.
--
--   fin_card.holder_person_id / default_cost_center_id .... 0 de 12 plásticos.
--       É a lacuna `cartao_sem_titular` que a 0074 já declara.
--
--   MCC (`credit_card_metadata.payeeMCC`) .... 554 de 795 (69,7%), e 554 de 648
--       compras (85,5%), cobrindo R$ 73.578,98 de R$ 86.653,55. É o dado forte
--       que sobrou, e é bom: MCC é ISO 18245, atribuído pelo ADQUIRENTE ao
--       estabelecimento no credenciamento. Não é opinião de app nem parsing de
--       texto.
--
--   `category` do Polp .... 795 de 795, e é a mais fraca das quatro. Ela é
--       derivada do NOME, para uso pessoal, e erra de forma verificável:
--         "railway"             → "Transporte público"   (é PaaS, MCC 5734)
--         "sport burg"          → "Saúde e bem-estar"    (é lanchonete, MCC 5814)
--         "canal da construcao" → "Utensílios para casa" (é material, MCC 5211)
--         "cursor, ai powered ide" → "Educação"          (é software, MCC 5734)
--       Serve como indício na fila. Nunca decide sozinha.
--
-- ===========================================================================
-- 2. POR QUE O MOTOR DE REGRAS NÃO ESCREVE AQUI — COM O A/B QUE A DÚVIDA 0 EXIGE
-- ===========================================================================
-- A dúvida 0 de docs/DUVIDAS_FINANCEIRO.md está ABERTA e proíbe rodar
-- `reclassificar.mjs --conta=inter` no automático: 205 linhas migrariam de
-- 6.02 Pró-labore para 6.01 Salários por uma regra genérica, com consequência
-- tributária. A pergunta que ela obriga a responder antes de reaproveitar o
-- motor é: alguma regra de pessoa física toca item de cartão?
--
-- O A/B foi rodado em leitura, com o MESMO avaliador de scripts/lib/fin-rules.mjs,
-- sobre os 795 itens. Resultado medido:
--
--   60 regras ativas · 148 itens casariam · 647 não casariam com nenhuma
--
--     combustivel              5.06   16 itens   R$ 2.059,20
--     software-assinaturas     5.03  106 itens   R$ 1.998,65
--     alimentacao-equipe       6.04   15 itens   R$ 1.927,61   ← 6.xx PESSOAL
--     condominio-e-aluguel     5.01   10 itens   R$   734,44
--     material-eletrico-obras  4.02    1 item    R$    25,00
--
--   A regra `pix-pessoa-fisica` (id 42), que É a da dúvida 0, está ARQUIVADA e
--   além disso casa em 0 itens: suas agulhas são "pix enviado" e "transferencia
--   enviada pelo pix", e nenhum item de cartão contém esse texto. Nesse ponto
--   específico a trava não seria violada.
--
--   MAS a resposta honesta é que o motor mesmo assim não pode escrever aqui, e
--   por três defeitos medidos, não por precaução:
--
--   (a) `alimentacao-equipe` (prioridade 70, confiança 70) joga 15 itens em
--       6.04 Benefícios — categoria de PESSOAL, exatamente a classe que a
--       dúvida 0 protege. E 6 desses 15 (R$ 895,75) são falso positivo de
--       substring: a agulha "emporio" casa dentro de "mercadolivre*emporiol",
--       que é um vendedor do Mercado Livre com MCC 5734, não um empório de
--       comida. A regra foi escrita para um ledger onde existe contraparte com
--       nome próprio; no cartão o texto é o campo do adquirente, e ela derrapa.
--
--   (b) `software-assinaturas` casa nas 4 linhas de IOF — "iof de \"anthropic\"",
--       "iof de \"openai\"" — e carimbaria o TRIBUTO com a categoria da
--       assinatura que ele taxa. O motor não conhece `fin_card_transaction.kind`,
--       porque no ledger essa distinção não existe.
--
--   (c) `condominio-e-aluguel` casa em "iguep incorporadora g" e diz
--       5.01 Aluguel e condomínio. O MCC desse mesmo estabelecimento é 5541 —
--       Service Stations. Duas evidências, dois destinos. São 3 itens,
--       R$ 333,14, e a saída correta não é escolher: é a fila.
--
-- Então o motor não roda sobre o cartão. Nenhuma linha de `fin_rule` é lida,
-- executada ou alterada por esta migration, e `classified_rule_id` fica NULO
-- nos 795. O que este arquivo faz é declarar um mapa PRÓPRIO do cartão, com
-- degraus de evidência explícitos — e o item que não alcança nenhum degrau fica
-- com categoria NULA e motivo escrito.
--
-- ===========================================================================
-- 3. OS DEGRAUS DE EVIDÊNCIA, E POR QUE PARAM ONDE PARAM
-- ===========================================================================
-- DECIDE (escreve categoria):
--
--   mcc_iso — o MCC é inequívoco sobre a NATUREZA JURÍDICA do estabelecimento,
--       e a categoria segue dela sem passo intermediário. Sete códigos entram:
--
--         7311 Advertising Services      → 5.05 Marketing e publicidade
--         5541 Service Stations          → 5.06 Viagens e representação
--         5542 Automated Fuel Dispensers → 5.06
--         4121 Taxicabs and Limousines   → 5.06
--         4784 Tolls and Bridge Fees     → 5.06
--         7523 Parking Lots and Garages  → 5.06
--         4215 Courier Services          → 5.11 Frete e logística
--
--       Sobre 5.06 e não 4.04: "Deslocamento atribuível a serviço" exige, pelo
--       próprio nome, a atribuição a um serviço. Nenhum item de cartão tem
--       projeto (seção 5). Sem atribuição, 4.04 não se aplica — e é também o
--       que o ledger já faz com combustível pela regra `combustivel`.
--
--   identidade_do_produto — a descrição não é o nome de um lojista, é o nome de
--       um PRODUTO de software, e o MCC não contradiz. Doze nomes:
--       anthropic, openai, cursor, clickup, microsoft, google one, supabase,
--       railway, openrouter, trae, godaddy, polp tecnologia → 5.03.
--       É mais fraco que MCC e por isso vem depois: MCC é atribuição de
--       terceiro, nome de produto é reconhecimento. Confiança 90 contra 100.
--
-- NÃO DECIDE (só aparece como candidato na fila) — e cada um tem um motivo:
--
--   5411/5300/5499/5331/5441/5462  mercado e conveniência. Compra de mercado no
--       cartão da empresa é 6.04 Benefícios (café da equipe), 5.07 Material de
--       escritório e copa, ou consumo pessoal a reembolsar. O MCC não separa
--       essas três, e a diferença muda despesa de pessoal, despesa
--       administrativa e nada. 71 itens, R$ 4.342,21.
--
--   5812/5814  restaurantes. 6.04 Benefícios ou 5.06 Viagens e representação —
--       depende de quem estava à mesa, que é dado que não existe em lugar
--       nenhum. 25 itens, R$ 2.941,75.
--
--   5045/5065/5722/5732/5734  eletrônicos e informática. 8.01 Equipamentos
--       (imobiliza) ou 5.07/5.03 (despesa do mês). É a diferença entre
--       investimento e despesa, que muda o lucro do mês e a base do imposto.
--       O MCC diz o que a loja vende, não o que foi comprado.
--
--   5211/5231/5251  material de construção. 4.02 Material específico de obra
--       (custo direto, que pede projeto) ou 5.08 Manutenção e infraestrutura
--       (despesa da sede). Sem projeto não dá para dizer.
--
--   8299/8220/5942  educação e livraria. 6.07 Treinamento e capacitação se for
--       do time; nada disso se for pessoal.
--
--   7372  Computer Programming / Data Processing. **Este MCC está queimado como
--       evidência nesta base**, e a medição é direta: R$ 14.051,36 de compras
--       AliExpress/Alipay vêm com 7372. É o mau credenciamento clássico do
--       processador de pagamento chinês — o adquirente codificou o gateway, não
--       a loja. Aceitar 7372 como "software" jogaria quatorze mil reais de
--       mercadoria física em 5.03. Fica fora dos que decidem, inclusive para os
--       casos em que estaria certo.
--
-- ===========================================================================
-- 4. AS TRÊS COISAS QUE ESTA MIGRATION SE RECUSA A CLASSIFICAR
-- ===========================================================================
-- (a) IOF — 133 itens, R$ 553,40 POSTED + R$ 27,27 PENDING.
--     O que é: certo. `kind = 'iof'` veio da fonte, não de heurística. Onde vai:
--     não existe resposta no plano de contas atual. 7.01 é DAS, 7.02 é ISS,
--     7.03 é retenção na fonte — IOF não é nenhum dos três. 4.05 é "Tarifas
--     bancárias e de cobrança", e IOF não é tarifa, é tributo. 9.11 é "Juros e
--     multas pagos", e IOF não é juro nem multa. A resposta certa provavelmente
--     é uma categoria nova, e criar linha de plano de contas é decisão do dono.
--     Vai para a fila e para docs/DUVIDAS_FINANCEIRO.md.
--
-- (b) Estornos — 7 itens, R$ 1.574,43.
--     Estorno de compra é despesa negativa, e pertence à categoria da compra
--     que ele desfaz. Para 3 dá para saber qual ("Estorno de CURSOR, AI POWERED
--     IDE", 2× "Estorno de IOF"). Para 4 a descrição é só "Estorno de compra".
--     Carimbar 3.90 "Estornos e devoluções" seria o erro tentador: 3.90 é
--     `deducao_receita` e entra na linha `deducoes` da DRE — um estorno de
--     COMPRA classificado ali reduziria a receita bruta em vez de reduzir a
--     despesa. Fila.
--
-- (c) Centro de custo — 0 dos 795, e é deliberado.
--     Não há projeto em lado nenhum: o Polp não entrega, os 12 plásticos não
--     têm titular nem centro padrão, nenhuma das 56 categorias tem
--     `default_cost_center_id`, e não existe contraparte para herdar.
--     Existiria o caminho de carimbar o centro de custo FUNCIONAL derivado da
--     categoria (5.05 → Marketing, e assim por diante). Ele foi recusado: o
--     indicador "centro de custo" desta base significa PROJETO — é o que dá
--     margem por obra (B1, dúvida 19) — e enchê-lo com a dimensão funcional o
--     faria subir 35% dizendo uma coisa que não é a que ele mede. Erro para
--     cima, que o §2 do AGENTE_FINANCEIRO chama de o mais perigoso.
--     A pergunta vai para as dúvidas; a coluna fica nula.
--
-- ===========================================================================
-- 5. O QUE ESTA MIGRATION NÃO TOCA
-- ===========================================================================
--   · `fin_transaction`, `fin_review_item` e o gatilho
--     `fin_transaction_fila_indeciso` — escopo da frente vizinha (0080). Zero
--     linhas alteradas aqui.
--   · `fin_rule` — nenhuma regra criada, editada ou arquivada.
--   · `fin_account.kind` e seu CHECK — a trava da 0047 §12 fica como está.
--   · `fin_card_bill` e os acumuladores das 21 faturas.
--   · `kind = 'pagamento_fatura'` (14 itens, R$ 107 mil): já está fora da DRE
--     por `WHERE ct.kind <> 'pagamento_fatura'` (0072) e fora da lacuna
--     `compra_sem_categoria` (0074). Dar categoria a ele não melhora nada e
--     abre a chance de alguém somá-lo com os itens depois. Continua nulo.

-- ---------------------------------------------------------------------------
-- 6. A TRILHA DE AUDITORIA PASSA A ACEITAR O CARTÃO
-- ---------------------------------------------------------------------------
-- `fin_classification_event` é a trilha que a base já tem, e o CHECK dela só
-- aceitava 'fin_transaction' e 'fin_document'. Estender é aditivo e barato;
-- criar uma trilha paralela para o cartão seria a segunda cópia da mesma coisa,
-- e a segunda cópia é a que fica desatualizada.
ALTER TABLE fin_classification_event
  DROP CONSTRAINT fin_classification_event_target_table_check;
ALTER TABLE fin_classification_event
  ADD CONSTRAINT fin_classification_event_target_table_check
  CHECK (target_table = ANY (ARRAY['fin_transaction', 'fin_document', 'fin_card_transaction']));

-- ---------------------------------------------------------------------------
-- 7. OS DEGRAUS DE EVIDÊNCIA, COMO DADO
-- ---------------------------------------------------------------------------
-- Tabela e não CHECK: o degrau precisa carregar força e explicação, e precisa
-- ser consultável pela fila ("por que este item foi classificado e aquele não").
CREATE TABLE fin_card_evidencia (
  slug        text PRIMARY KEY,
  nome        text    NOT NULL,
  forca       integer NOT NULL CHECK (forca BETWEEN 0 AND 100),
  decide      boolean NOT NULL,
  descricao   text    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fin_card_evidencia IS
  'Degraus de evidência do cartão, do mais forte ao mais fraco. `decide` separa o que pode escrever '
  'categoria do que só aparece como candidato na fila. Mudar um `decide` para true é uma decisão '
  'de negócio, não um ajuste técnico.';

INSERT INTO fin_card_evidencia (slug, nome, forca, decide, descricao) VALUES
  ('mcc_iso', 'MCC ISO 18245', 100, true,
   'Código de categoria de estabelecimento atribuído pelo ADQUIRENTE no credenciamento, padrão ISO 18245. '
   'Não é parsing de texto nem opinião de app. Só entram os MCCs cuja natureza determina a categoria sem passo intermediário.'),
  ('identidade_do_produto', 'Nome do produto', 90, true,
   'A descrição do adquirente é o nome de um produto de software, não de um lojista, e o MCC não contradiz. '
   'Mais fraco que MCC porque depende de reconhecer o nome.'),
  ('plano_uniforme', 'Uniformidade do plano', 100, true,
   'Todas as parcelas de um plano são A MESMA compra (0047 §2). A categoria do plano vale para todas, '
   'inclusive as que atravessam reemissão de cartão. Nunca decide sozinha: propaga o que outro degrau decidiu.'),
  ('mcc_indicio', 'MCC como indício', 50, false,
   'O MCC diz o que a loja VENDE, não o que foi comprado, e os destinos possíveis caem em linhas diferentes '
   'da DRE. Aparece como candidato na fila e não escreve.'),
  ('fonte_indicio', 'Categoria do Polp', 20, false,
   'Classificação de uso pessoal derivada do nome, com erro verificável (railway → "Transporte público"). '
   'Aparece como candidato e nunca escreve.');

-- ---------------------------------------------------------------------------
-- 8. O MAPA, COMO DADO
-- ---------------------------------------------------------------------------
-- Declarativo de propósito: quem quiser auditar por que 65 itens foram para
-- 5.05 lê uma linha de tabela, não um CASE de duzentas linhas. E promover um
-- candidato a decisor é um UPDATE de uma coluna.
CREATE TABLE fin_card_classificacao_regra (
  id          bigserial PRIMARY KEY,
  escopo      text   NOT NULL CHECK (escopo IN ('mcc', 'produto')),
  chave       text   NOT NULL,
  category_id bigint NOT NULL REFERENCES fin_category(id),
  evidencia   text   NOT NULL REFERENCES fin_card_evidencia(slug),
  porque      text   NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (escopo, chave, category_id)
);

CREATE INDEX fin_card_classificacao_regra_chave_idx
  ON fin_card_classificacao_regra (escopo, chave) WHERE is_active;

COMMENT ON TABLE fin_card_classificacao_regra IS
  'Mapa de classificação do cartão. NÃO é fin_rule: não roda o motor, não tem prioridade e não olha '
  'texto livre. `escopo` = mcc (código ISO 18245 exato) ou produto (nome do produto contido na descrição). '
  'A força de escrever ou só sugerir vem de fin_card_evidencia.decide.';

-- (a) MCC que decide -------------------------------------------------------
INSERT INTO fin_card_classificacao_regra (escopo, chave, category_id, evidencia, porque)
SELECT 'mcc', v.mcc, c.id, 'mcc_iso', v.porque
  FROM (VALUES
    ('7311', '5.05', 'ISO 18245 7311 = Advertising Services. Estabelecimento de publicidade cobrando cartão de empresa é marketing. São as 65 cobranças da Meta.'),
    ('5541', '5.06', 'ISO 18245 5541 = Service Stations. Combustível sem projeto declarado não cabe em 4.04, que exige atribuição a serviço.'),
    ('5542', '5.06', 'ISO 18245 5542 = Automated Fuel Dispensers. Mesma natureza do 5541.'),
    ('4121', '5.06', 'ISO 18245 4121 = Taxicabs and Limousines. Deslocamento urbano sem projeto declarado.'),
    ('4784', '5.06', 'ISO 18245 4784 = Tolls and Bridge Fees. Pedágio acompanha o deslocamento.'),
    ('7523', '5.06', 'ISO 18245 7523 = Parking Lots and Garages. Estacionamento acompanha o deslocamento.'),
    ('4215', '5.11', 'ISO 18245 4215 = Courier Services. Transporte de carga é frete, e a categoria existe para isso.')
  ) AS v(mcc, code, porque)
  JOIN fin_category c ON c.code = v.code AND c.entity_id = 1;

-- (b) nome de produto que decide -------------------------------------------
INSERT INTO fin_card_classificacao_regra (escopo, chave, category_id, evidencia, porque)
SELECT 'produto', v.nome, c.id, 'identidade_do_produto',
       'A descrição do adquirente é o nome do produto, não de um lojista, e o MCC do item não é de família física.'
  FROM (VALUES
    ('anthropic'), ('openai'), ('cursor, ai powered ide'), ('clickup'),
    ('microsoft'), ('google one'), ('supabase'), ('railway'),
    ('openrouter'), ('trae'), ('godaddycom'), ('polp tecnologia')
  ) AS v(nome)
  CROSS JOIN LATERAL (SELECT id FROM fin_category WHERE code = '5.03' AND entity_id = 1) c;

-- (c) MCC que só sugere ----------------------------------------------------
-- Mais de uma linha por MCC de propósito: a fila mostra TODOS os destinos
-- possíveis. Oferecer um só já seria escolher.
INSERT INTO fin_card_classificacao_regra (escopo, chave, category_id, evidencia, porque)
SELECT 'mcc', v.mcc, c.id, 'mcc_indicio', v.porque
  FROM (VALUES
    ('5411', '6.04', 'Supermercado: pode ser café e copa da equipe.'),
    ('5411', '5.07', 'Supermercado: pode ser material de escritório e copa.'),
    ('5300', '6.04', 'Atacado: pode ser copa da equipe.'),
    ('5300', '5.07', 'Atacado: pode ser material de escritório e copa.'),
    ('5499', '6.04', 'Alimentação especializada: pode ser copa da equipe.'),
    ('5499', '5.07', 'Alimentação especializada: pode ser material de copa.'),
    ('5331', '5.07', 'Loja de variedades: material de escritório e copa.'),
    ('5331', '6.04', 'Loja de variedades: pode ser benefício da equipe.'),
    ('5441', '6.04', 'Confeitaria: pode ser copa da equipe.'),
    ('5462', '6.04', 'Padaria: pode ser copa da equipe.'),
    ('5812', '6.04', 'Restaurante: pode ser refeição da equipe.'),
    ('5812', '5.06', 'Restaurante: pode ser representação com cliente.'),
    ('5814', '6.04', 'Lanchonete: pode ser refeição da equipe.'),
    ('5814', '5.06', 'Lanchonete: pode ser representação com cliente.'),
    ('5045', '8.01', 'Informática: pode ser equipamento que imobiliza.'),
    ('5045', '5.03', 'Informática: pode ser licença ou assinatura.'),
    ('5065', '8.01', 'Componentes eletrônicos: pode ser equipamento.'),
    ('5065', '4.02', 'Componentes eletrônicos: pode ser material de obra.'),
    ('5722', '8.01', 'Eletrodomésticos: pode ser equipamento.'),
    ('5722', '5.07', 'Eletrodomésticos: pode ser copa e escritório.'),
    ('5732', '8.01', 'Eletrônicos: pode ser equipamento.'),
    ('5732', '5.07', 'Eletrônicos: pode ser material de escritório.'),
    ('5734', '5.03', 'Software: pode ser assinatura.'),
    ('5734', '8.04', 'Software: pode ser licença perpétua, que imobiliza.'),
    ('5211', '4.02', 'Material de construção: pode ser material específico de obra.'),
    ('5211', '5.08', 'Material de construção: pode ser manutenção da sede.'),
    ('5231', '4.02', 'Tintas e vidros: pode ser material de obra.'),
    ('5231', '5.08', 'Tintas e vidros: pode ser manutenção da sede.'),
    ('5251', '4.02', 'Ferragens: pode ser material de obra.'),
    ('5251', '5.08', 'Ferragens: pode ser manutenção da sede.'),
    ('8299', '6.07', 'Serviços educacionais: pode ser treinamento do time.'),
    ('8220', '6.07', 'Ensino: pode ser treinamento do time.'),
    ('5942', '6.07', 'Livraria: pode ser capacitação do time.'),
    ('5942', '5.07', 'Livraria: pode ser material de escritório.'),
    ('7372', '5.03', 'ISO 18245 diz processamento de dados, MAS este MCC está queimado nesta base: R$ 14.051,36 de AliExpress/Alipay vêm com ele. Só indício.'),
    ('5533', '5.08', 'Autopeças: pode ser manutenção de veículo.'),
    ('5599', '8.01', 'Automotivo: pode ser equipamento.'),
    ('5599', '5.08', 'Automotivo: pode ser manutenção.'),
    ('7399', '5.03', 'Serviços empresariais: pode ser assinatura.'),
    ('7399', '4.03', 'Serviços empresariais: pode ser terceirização.'),
    ('2842', '5.07', 'Produtos de limpeza: pode ser material de copa e escritório.'),
    ('2842', '5.08', 'Produtos de limpeza: pode ser manutenção predial.')
  ) AS v(mcc, code, porque)
  JOIN fin_category c ON c.code = v.code AND c.entity_id = 1;

-- ---------------------------------------------------------------------------
-- 9. A COLUNA DE PROVENIÊNCIA
-- ---------------------------------------------------------------------------
-- `classified_by` já existe e tem CHECK fechado ('regra', 'humano', ...). Ele
-- diz a CLASSE do carimbo. Falta dizer QUAL evidência dentro da classe, que é o
-- que permite responder "por que este foi e aquele não" sem reabrir o SQL.
ALTER TABLE fin_card_transaction
  ADD COLUMN classified_evidence text REFERENCES fin_card_evidencia(slug);

COMMENT ON COLUMN fin_card_transaction.classified_evidence IS
  'Qual degrau de fin_card_evidencia escreveu a categoria. NULO com category_id NULO significa '
  '"nenhum degrau alcançou" — o vazio declarado. NULO com category_id preenchido significa carimbo humano.';

ALTER TABLE fin_card_installment_plan
  ADD COLUMN classified_evidence text REFERENCES fin_card_evidencia(slug);

-- Coerência: evidência sem categoria é contradição — quem carimbou disse de
-- onde tirou, mas não tirou nada.
ALTER TABLE fin_card_transaction
  ADD CONSTRAINT fin_card_transaction_evidencia_tem_categoria
  CHECK (classified_evidence IS NULL OR category_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 10. A APLICAÇÃO — IDEMPOTENTE, E SÓ ONDE ESTÁ VAZIO
-- ---------------------------------------------------------------------------
-- Três travas no WHERE, e cada uma existe por um motivo diferente:
--
--   category_id IS NULL ....... roda de novo sem efeito; e nunca reescreve o
--                               que outra frente (ou uma pessoa) já decidiu.
--   NOT ('category_id' = ANY(human_locked_fields)) .... respeita a trava humana
--                               mesmo fora do sync_mode, onde o gatilho da 0047
--                               não age.
--   kind = 'compra' ........... IOF, estorno, encargo, ajuste e pagamento de
--                               fatura ficam de fora por decisão declarada na
--                               seção 4. Sem isto, `software-assinaturas`
--                               carimbaria o IOF (defeito (b) da seção 2).

-- (a) MCC decide -----------------------------------------------------------
-- O `NOT EXISTS` é a trava do conflito medido na seção 2 (c): se qualquer
-- outra chave desta mesma tabela aponta o item para categoria diferente, ele
-- NÃO é classificado. Hoje isso protege os 3 itens da "iguep incorporadora g",
-- que tem MCC 5541 (posto) e nome de incorporadora.
WITH alvo AS (
  SELECT t.id, r.category_id, r.evidencia
    FROM fin_card_transaction t
    JOIN fin_card_classificacao_regra r
      ON r.escopo = 'mcc' AND r.chave = t.mcc AND r.is_active
    JOIN fin_card_evidencia e ON e.slug = r.evidencia AND e.decide
   WHERE t.category_id IS NULL
     AND t.kind = 'compra'
     AND NOT ('category_id' = ANY (t.human_locked_fields))
     -- nenhum outro decisor discorda deste
     AND NOT EXISTS (
       SELECT 1
         FROM fin_card_classificacao_regra r2
         JOIN fin_card_evidencia e2 ON e2.slug = r2.evidencia AND e2.decide
        WHERE r2.is_active
          AND r2.category_id <> r.category_id
          AND (   (r2.escopo = 'mcc'     AND r2.chave = t.mcc)
               OR (r2.escopo = 'produto' AND t.description_norm LIKE '%' || r2.chave || '%'))
     )
)
UPDATE fin_card_transaction t
   SET category_id         = a.category_id,
       classified_evidence = a.evidencia,
       classified_by       = 'regra',
       classified_at       = now(),
       nucleo              = COALESCE(t.nucleo, c.default_nucleo)
  FROM alvo a
  JOIN fin_category c ON c.id = a.category_id
 WHERE t.id = a.id;

-- (b) nome do produto decide ----------------------------------------------
-- Roda depois do MCC de propósito: onde os dois alcançam, o mais forte já
-- escreveu e o `category_id IS NULL` faz este passar direto.
--
-- O filtro de MCC físico é o que impede o defeito clássico: um item cujo texto
-- contenha "microsoft" mas cujo MCC seja 5732 (loja de eletrônicos) é compra de
-- hardware, não assinatura. Vale para "apple.com/us" e para os 15 itens de
-- Apple com MCC 5735/5815 (mídia), que por isso NÃO entram aqui.
WITH alvo AS (
  SELECT DISTINCT ON (t.id) t.id, r.category_id, r.evidencia
    FROM fin_card_transaction t
    JOIN fin_card_classificacao_regra r
      ON r.escopo = 'produto' AND t.description_norm LIKE '%' || r.chave || '%' AND r.is_active
    JOIN fin_card_evidencia e ON e.slug = r.evidencia AND e.decide
   WHERE t.category_id IS NULL
     AND t.kind = 'compra'
     AND NOT ('category_id' = ANY (t.human_locked_fields))
     AND COALESCE(t.mcc, '') NOT IN ('5732', '5735', '5815', '5311', '5300', '5411')
     AND NOT EXISTS (
       SELECT 1
         FROM fin_card_classificacao_regra r2
         JOIN fin_card_evidencia e2 ON e2.slug = r2.evidencia AND e2.decide
        WHERE r2.is_active
          AND r2.category_id <> r.category_id
          AND (   (r2.escopo = 'mcc'     AND r2.chave = t.mcc)
               OR (r2.escopo = 'produto' AND t.description_norm LIKE '%' || r2.chave || '%'))
     )
   ORDER BY t.id, r.id
)
UPDATE fin_card_transaction t
   SET category_id         = a.category_id,
       classified_evidence = a.evidencia,
       classified_by       = 'regra',
       classified_at       = now(),
       nucleo              = COALESCE(t.nucleo, c.default_nucleo)
  FROM alvo a
  JOIN fin_category c ON c.id = a.category_id
 WHERE t.id = a.id;

-- (c) o plano herda das parcelas, e as parcelas do plano ---------------------
-- Medição de hoje: NENHUM dos 25 planos é alcançado pelos degraus que decidem —
-- os parcelamentos são AliExpress (MCC 7372 queimado), eletrônicos e cursos,
-- todos na fila. Os dois passos abaixo aplicam a zero linhas AGORA, e existem
-- porque a regra do 0047 §2 tem de valer no dia em que alguém classificar um
-- plano pela tela: 16 dos 25 atravessam mais de um final de cartão, e uma
-- parcela com categoria diferente das irmãs parte UMA compra em duas.
UPDATE fin_card_installment_plan p
   SET category_id         = u.category_id,
       classified_evidence = 'plano_uniforme',
       nucleo              = COALESCE(p.nucleo, u.default_nucleo)
  FROM (
    SELECT t.installment_plan_id AS plan_id,
           min(t.category_id)    AS category_id,
           min(c.default_nucleo) AS default_nucleo
      FROM fin_card_transaction t
      JOIN fin_category c ON c.id = t.category_id
     WHERE t.installment_plan_id IS NOT NULL AND t.category_id IS NOT NULL
     GROUP BY t.installment_plan_id
    HAVING count(DISTINCT t.category_id) = 1
  ) u
 WHERE p.id = u.plan_id AND p.category_id IS NULL;

UPDATE fin_card_transaction t
   SET category_id         = p.category_id,
       classified_evidence = 'plano_uniforme',
       classified_by       = 'regra',
       classified_at       = now(),
       nucleo              = COALESCE(t.nucleo, c.default_nucleo)
  FROM fin_card_installment_plan p
  JOIN fin_category c ON c.id = p.category_id
 WHERE t.installment_plan_id = p.id
   AND p.category_id IS NOT NULL
   AND t.category_id IS NULL
   AND NOT ('category_id' = ANY (t.human_locked_fields));

-- ---------------------------------------------------------------------------
-- 11. A TRILHA — UM EVENTO POR ITEM CARIMBADO
-- ---------------------------------------------------------------------------
-- `superseded_value` guarda o estado ANTERIOR, que é o que torna a reversão
-- verificável: dá para provar que o que havia antes era nulo, e não outra
-- categoria que esta migration apagou.
INSERT INTO fin_classification_event
  (target_table, target_id, stage, rule_id, category_id, nucleo, confidence, rationale, accepted, superseded_value, actor)
SELECT 'fin_card_transaction', t.id, 'regra', NULL, t.category_id, t.nucleo, e.forca,
       jsonb_build_object(
         'migration',   '0083_fin_cartao_classificacao',
         'evidencia',   t.classified_evidence,
         'degrau',      e.nome,
         'mcc',         t.mcc,
         'descricao',   t.description_norm,
         'fonte_polp',  t.source_category,
         'porque',      (SELECT string_agg(r.porque, ' | ')
                           FROM fin_card_classificacao_regra r
                          WHERE r.category_id = t.category_id
                            AND r.evidencia = t.classified_evidence
                            AND (   (r.escopo = 'mcc'     AND r.chave = t.mcc)
                                 OR (r.escopo = 'produto' AND t.description_norm LIKE '%' || r.chave || '%')))
       ),
       true,
       jsonb_build_object('category_id', NULL, 'nucleo', NULL, 'cost_center_id', NULL),
       'migration:0083'
  FROM fin_card_transaction t
  JOIN fin_card_evidencia e ON e.slug = t.classified_evidence
 WHERE t.classified_evidence IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM fin_classification_event ev
      WHERE ev.target_table = 'fin_card_transaction'
        AND ev.target_id = t.id
        AND ev.rationale ->> 'migration' = '0083_fin_cartao_classificacao'
   );

-- ---------------------------------------------------------------------------
-- 12. O INVARIANTE DO PLANO, COMO GATILHO
-- ---------------------------------------------------------------------------
-- A 0047 §2 provou que o final do cartão não é estável: em 16 dos 25
-- parcelamentos o `cardNumber` muda no meio do plano. A consequência é que
-- classificar parcela a parcela é um convite a partir UMA compra em duas
-- categorias — e o dia em que isso acontecer, o custo aparece dividido em duas
-- linhas da DRE sem que ninguém veja.
--
-- Um CHECK não alcança (é entre linhas). O gatilho alcança, e falha alto.
CREATE OR REPLACE FUNCTION fin_card_plano_categoria_uniforme() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  distintas integer;
BEGIN
  IF NEW.installment_plan_id IS NULL OR NEW.category_id IS NULL THEN RETURN NEW; END IF;

  SELECT count(DISTINCT category_id) INTO distintas
    FROM (
      SELECT category_id FROM fin_card_transaction
       WHERE installment_plan_id = NEW.installment_plan_id
         AND id <> NEW.id
         AND category_id IS NOT NULL
      UNION ALL
      SELECT NEW.category_id
    ) x;

  IF distintas > 1 THEN
    RAISE EXCEPTION
      'plano % receberia categorias diferentes em parcelas da MESMA compra (0047 §2 · 0083 §12): item %',
      NEW.installment_plan_id, NEW.id;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION fin_card_plano_categoria_uniforme() IS
  'Todas as parcelas de um plano são a mesma compra. Reemissão de cartão troca o final e não parte o '
  'plano — e não pode partir a categoria. Ver 0047 §2.';

CREATE TRIGGER fin_card_transaction_plano_uniforme
  AFTER INSERT OR UPDATE OF category_id, installment_plan_id ON fin_card_transaction
  FOR EACH ROW EXECUTE FUNCTION fin_card_plano_categoria_uniforme();

-- ---------------------------------------------------------------------------
-- 13. A FILA DE DECISÃO HUMANA
-- ---------------------------------------------------------------------------
-- No padrão de fin_a_classificar_v (0063) e fin_card_lacuna_v (0074): nome,
-- valor, motivo — e aqui também os CANDIDATOS, porque a pergunta do cartão
-- quase nunca é "o que é isso" e quase sempre "qual dos dois destinos".
--
-- A fila não é relatório. Cada linha é uma decisão que só o dono toma, com o
-- dinheiro que está pendurado nela à vista.
CREATE VIEW fin_card_a_classificar_v AS
SELECT
  t.id,
  ca.slug                          AS linha_credito,
  t.posted_on,
  t.competence_date,
  t.description                    AS nome,
  abs(t.amount_cents)              AS valor_cents,
  t.kind,
  t.mcc,
  t.source_category                AS indicio_da_fonte,
  t.card_last4,
  t.installment_plan_id,
  pl.merchant_label                AS plano,
  pl.installments_total            AS plano_parcelas,
  -- candidatos: o que cada fonte SUGERE, sem escolher
  (SELECT string_agg(DISTINCT c.code || ' ' || c.name, ' · ' ORDER BY c.code || ' ' || c.name)
     FROM fin_card_classificacao_regra r
     JOIN fin_category c ON c.id = r.category_id
    WHERE r.is_active AND r.escopo = 'mcc' AND r.chave = t.mcc)   AS candidatos,
  (SELECT count(*)
     FROM fin_card_classificacao_regra r
    WHERE r.is_active AND r.escopo = 'mcc' AND r.chave = t.mcc)   AS n_candidatos,
  CASE
    WHEN t.kind = 'iof' THEN
      'IOF: o QUE é veio da fonte e está certo; ONDE vai não existe no plano de contas. '
      || '7.01 é DAS, 7.02 é ISS, 7.03 é retenção, 4.05 é tarifa e 9.11 é juro — IOF não é nenhum. Ver dúvida 20.'
    WHEN t.kind = 'estorno' AND t.description_norm !~ 'de "' THEN
      'Estorno sem a compra nomeada: pertence à categoria da compra que desfaz, e a fonte não diz qual. '
      || 'Carimbar 3.90 reduziria RECEITA em vez de reduzir despesa. Ver dúvida 21.'
    WHEN t.kind = 'estorno' THEN
      'Estorno com a compra nomeada na descrição: herda a categoria dela assim que a compra tiver uma. Ver dúvida 21.'
    WHEN t.kind IN ('encargo', 'ajuste') THEN
      'Encargo/ajuste do cartão sem destino declarado no plano de contas.'
    WHEN t.mcc IS NULL THEN
      'A fonte não devolveu MCC para este item, e o nome sozinho não separa os destinos possíveis.'
    WHEN EXISTS (SELECT 1 FROM fin_card_classificacao_regra r
                  JOIN fin_card_evidencia e ON e.slug = r.evidencia AND e.decide
                 WHERE r.is_active AND r.escopo = 'mcc' AND r.chave = t.mcc) THEN
      'Duas evidências apontam para categorias diferentes neste item — o MCC diz uma coisa e o nome do '
      || 'estabelecimento diz outra. A saída não é escolher.'
    WHEN t.installment_plan_id IS NOT NULL THEN
      'Parcela de um plano ainda sem categoria. Decidir UMA vez no plano resolve todas as parcelas — '
      || 'inclusive as que atravessam reemissão de cartão.'
    ELSE
      'MCC conhecido mas ambíguo: ele diz o que a loja VENDE, não o que foi comprado, e os destinos '
      || 'possíveis caem em linhas diferentes da DRE.'
  END AS motivo
FROM fin_card_transaction t
JOIN fin_card_account ca ON ca.id = t.card_account_id
LEFT JOIN fin_card_installment_plan pl ON pl.id = t.installment_plan_id
WHERE t.category_id IS NULL
  AND t.kind <> 'pagamento_fatura';

COMMENT ON VIEW fin_card_a_classificar_v IS
  'Fila de decisão humana do cartão: o que ficou sem categoria, com valor, motivo e os candidatos que '
  'cada evidência sugere. Esvaziar por estimativa é pior que deixar cheia — ver §2 do docs/AGENTE_FINANCEIRO.md.';

-- Resumo por motivo, que é a forma como isso vira pauta de reunião.
CREATE VIEW fin_card_a_classificar_resumo_v AS
SELECT motivo,
       count(*)                 AS itens,
       sum(valor_cents)         AS valor_cents,
       count(*) FILTER (WHERE n_candidatos > 0) AS com_candidato,
       count(DISTINCT installment_plan_id)      AS planos,
       min(posted_on)           AS de,
       max(posted_on)           AS ate
  FROM fin_card_a_classificar_v
 GROUP BY motivo;

COMMENT ON VIEW fin_card_a_classificar_resumo_v IS
  'A fila do cartão agrupada por motivo, com valor. Uma linha aqui é uma decisão, não um item.';

-- ---------------------------------------------------------------------------
-- 14. COBERTURA — O ANTES E DEPOIS FICA CONSULTÁVEL, NÃO SÓ NO RELATÓRIO
-- ---------------------------------------------------------------------------
CREATE VIEW fin_card_classificacao_cobertura_v AS
SELECT
  ca.slug                                                              AS linha_credito,
  count(*) FILTER (WHERE t.kind <> 'pagamento_fatura')                 AS itens,
  count(*) FILTER (WHERE t.kind <> 'pagamento_fatura' AND t.category_id IS NOT NULL) AS com_categoria,
  count(*) FILTER (WHERE t.kind <> 'pagamento_fatura' AND t.cost_center_id IS NOT NULL) AS com_centro_custo,
  count(*) FILTER (WHERE t.kind <> 'pagamento_fatura' AND t.nucleo IS NOT NULL)         AS com_nucleo,
  sum(abs(t.amount_cents)) FILTER (WHERE t.kind <> 'pagamento_fatura')  AS valor_cents,
  sum(abs(t.amount_cents)) FILTER (WHERE t.kind <> 'pagamento_fatura' AND t.category_id IS NOT NULL) AS valor_com_categoria_cents,
  round(100.0 * count(*) FILTER (WHERE t.kind <> 'pagamento_fatura' AND t.category_id IS NOT NULL)
        / NULLIF(count(*) FILTER (WHERE t.kind <> 'pagamento_fatura'), 0), 1) AS pct_itens,
  round(100.0 * sum(abs(t.amount_cents)) FILTER (WHERE t.kind <> 'pagamento_fatura' AND t.category_id IS NOT NULL)
        / NULLIF(sum(abs(t.amount_cents)) FILTER (WHERE t.kind <> 'pagamento_fatura'), 0), 1) AS pct_valor
FROM fin_card_transaction t
JOIN fin_card_account ca ON ca.id = t.card_account_id
GROUP BY ca.slug;

COMMENT ON VIEW fin_card_classificacao_cobertura_v IS
  'Cobertura de classificação do cartão por linha de crédito, em item e em valor. As duas juntas porque '
  'divergem: MCC 7311 são 65 itens de 781 (8,3%) e R$ 24.958,40 de R$ 86.653,55 (28,8%).';

-- Quem decidiu o quê — a resposta para "de onde saiu essa categoria".
CREATE VIEW fin_card_classificacao_evidencia_v AS
SELECT COALESCE(e.nome, 'sem evidência (nulo)')  AS degrau,
       COALESCE(e.forca, 0)                       AS forca,
       c.code                                     AS categoria_code,
       c.name                                     AS categoria,
       count(*)                                   AS itens,
       sum(abs(t.amount_cents))                   AS valor_cents
  FROM fin_card_transaction t
  LEFT JOIN fin_card_evidencia e ON e.slug = t.classified_evidence
  LEFT JOIN fin_category c       ON c.id   = t.category_id
 WHERE t.kind <> 'pagamento_fatura'
 GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW fin_card_classificacao_evidencia_v IS
  'Quantos itens e quanto dinheiro cada degrau de evidência decidiu. A linha "sem evidência (nulo)" '
  'com categoria nula é o vazio declarado, e ela deve ser sempre igual ao tamanho da fila.';

-- ---------------------------------------------------------------------------
-- 15. CAMINHO DE REVERSÃO
-- ---------------------------------------------------------------------------
-- Esta migration só ESCREVE onde estava nulo, e a trilha guarda o estado
-- anterior em `superseded_value`. Desfazer é, em ordem:
--
--   BEGIN;
--   -- 15.1 devolve os itens ao estado anterior, um a um, pela trilha
--   UPDATE fin_card_transaction t
--      SET category_id         = (ev.superseded_value ->> 'category_id')::bigint,
--          nucleo              = ev.superseded_value ->> 'nucleo',
--          classified_evidence = NULL,
--          classified_by       = NULL,
--          classified_at       = NULL
--     FROM fin_classification_event ev
--    WHERE ev.target_table = 'fin_card_transaction'
--      AND ev.target_id = t.id
--      AND ev.rationale ->> 'migration' = '0083_fin_cartao_classificacao';
--
--   UPDATE fin_card_installment_plan
--      SET category_id = NULL, nucleo = NULL, classified_evidence = NULL
--    WHERE classified_evidence = 'plano_uniforme';
--
--   DELETE FROM fin_classification_event
--    WHERE target_table = 'fin_card_transaction'
--      AND rationale ->> 'migration' = '0083_fin_cartao_classificacao';
--
--   -- 15.2 remove o que a migration criou
--   DROP TRIGGER fin_card_transaction_plano_uniforme ON fin_card_transaction;
--   DROP FUNCTION fin_card_plano_categoria_uniforme();
--   DROP VIEW fin_card_classificacao_evidencia_v;
--   DROP VIEW fin_card_classificacao_cobertura_v;
--   DROP VIEW fin_card_a_classificar_resumo_v;
--   DROP VIEW fin_card_a_classificar_v;
--   ALTER TABLE fin_card_transaction DROP CONSTRAINT fin_card_transaction_evidencia_tem_categoria;
--   ALTER TABLE fin_card_transaction DROP COLUMN classified_evidence;
--   ALTER TABLE fin_card_installment_plan DROP COLUMN classified_evidence;
--   DROP TABLE fin_card_classificacao_regra;
--   DROP TABLE fin_card_evidencia;
--   ALTER TABLE fin_classification_event DROP CONSTRAINT fin_classification_event_target_table_check;
--   ALTER TABLE fin_classification_event ADD CONSTRAINT fin_classification_event_target_table_check
--     CHECK (target_table = ANY (ARRAY['fin_transaction', 'fin_document']));
--   COMMIT;
--
-- Nada em fin_transaction, fin_account, fin_card_bill ou fin_rule é tocado, então
-- a reversão não alcança o caixa nem a conciliação das 21 faturas.

-- ---------------------------------------------------------------------------
-- 16. PROVA — a migration falha se ela própria não cumprir o que promete
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_pagamento_com_cat  integer;
  n_iof_com_cat        integer;
  n_estorno_com_cat    integer;
  n_evid_sem_cat       integer;
  n_plano_misto        integer;
  n_cc                 integer;
  n_sinal              integer;
  n_conta_cartao       integer;
  n_sem_evento         integer;
BEGIN
  -- (1) as três recusas da seção 4 continuam recusas
  SELECT count(*) INTO n_pagamento_com_cat
    FROM fin_card_transaction WHERE kind = 'pagamento_fatura' AND category_id IS NOT NULL;
  SELECT count(*) INTO n_iof_com_cat
    FROM fin_card_transaction WHERE kind = 'iof' AND classified_evidence IS NOT NULL;
  SELECT count(*) INTO n_estorno_com_cat
    FROM fin_card_transaction WHERE kind = 'estorno' AND classified_evidence IS NOT NULL;
  SELECT count(*) INTO n_cc
    FROM fin_card_transaction WHERE cost_center_id IS NOT NULL;

  IF n_pagamento_com_cat > 0 THEN RAISE EXCEPTION '0083: % pagamento(s) de fatura ganharam categoria', n_pagamento_com_cat; END IF;
  IF n_iof_com_cat     > 0 THEN RAISE EXCEPTION '0083: % IOF classificado(s) por evidência — ver §4(a)', n_iof_com_cat; END IF;
  IF n_estorno_com_cat > 0 THEN RAISE EXCEPTION '0083: % estorno(s) classificado(s) por evidência — ver §4(b)', n_estorno_com_cat; END IF;
  IF n_cc              > 0 THEN RAISE EXCEPTION '0083: % item(ns) com centro de custo — não há evidência de projeto, ver §4(c)', n_cc; END IF;

  -- (2) evidência sem categoria é contradição
  SELECT count(*) INTO n_evid_sem_cat
    FROM fin_card_transaction WHERE classified_evidence IS NOT NULL AND category_id IS NULL;
  IF n_evid_sem_cat > 0 THEN RAISE EXCEPTION '0083: % item(ns) com evidência e sem categoria', n_evid_sem_cat; END IF;

  -- (3) nenhum plano com categoria misturada (0047 §2)
  SELECT count(*) INTO n_plano_misto FROM (
    SELECT installment_plan_id FROM fin_card_transaction
     WHERE installment_plan_id IS NOT NULL AND category_id IS NOT NULL
     GROUP BY installment_plan_id HAVING count(DISTINCT category_id) > 1
  ) x;
  IF n_plano_misto > 0 THEN RAISE EXCEPTION '0083: % plano(s) com parcelas em categorias diferentes', n_plano_misto; END IF;

  -- (4) o espelho de D2/D3 do lado do cartão. O sinal aqui é INVERTIDO
  --     (compra positiva é dívida, 0072), então categoria de RECEITA numa
  --     compra positiva é o mesmo erro que o D2 pega no ledger.
  SELECT count(*) INTO n_sinal
    FROM fin_card_transaction t JOIN fin_category c ON c.id = t.category_id
   WHERE t.kind = 'compra' AND t.amount_cents > 0 AND c.kind = 'receita';
  IF n_sinal > 0 THEN RAISE EXCEPTION '0083: % compra(s) de cartão com categoria de RECEITA', n_sinal; END IF;

  -- (5) a trava da 0047 §1 e §12 continua de pé
  SELECT count(*) INTO n_conta_cartao FROM fin_account WHERE kind = 'cartao';
  IF n_conta_cartao > 0 THEN RAISE EXCEPTION '0083: apareceu fin_account com kind=cartao', n_conta_cartao; END IF;

  -- (6) todo item carimbado tem evento na trilha
  SELECT count(*) INTO n_sem_evento
    FROM fin_card_transaction t
   WHERE t.classified_evidence IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM fin_classification_event ev
                      WHERE ev.target_table = 'fin_card_transaction' AND ev.target_id = t.id
                        AND ev.rationale ->> 'migration' = '0083_fin_cartao_classificacao');
  IF n_sem_evento > 0 THEN RAISE EXCEPTION '0083: % item(ns) carimbado(s) sem trilha', n_sem_evento; END IF;

  RAISE NOTICE '0083: prova passou — recusas mantidas, planos uniformes, sinal coerente, trilha completa.';
END $$;
