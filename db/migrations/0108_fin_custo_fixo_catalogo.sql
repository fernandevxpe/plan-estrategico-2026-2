-- O catálogo do que a empresa paga todo mês: o que se repete, quanto sugerir,
-- quem ligou, quem desligou e por quê — e o que vence sem ninguém ter olhado.
--
-- ===========================================================================
-- 0. O PEDIDO, E POR QUE ELE NÃO É "MAIS UMA TABELA DE CUSTO"
-- ===========================================================================
-- O pedido do dono, nas palavras dele: "crie uma área de configuração e
-- atualização de todos custos mensais... o usuário vai revisar, habilitar ou
-- desabilitar determinada cobrança prevista... assim não vamos esquecer de
-- pagar, inclusive os reembolsos, tudo."
--
-- Esta base já tem TRÊS camadas que respondem "quanto vai sair":
--
--   fin_recurring ................. o que se repete (145 linhas, 11 de saída)
--   fin_previsao_evento_v (0079) .. a composição de saída, camada a camada
--   fin_custo_previsto (0100) ..... o item do MÊS, confirmável e ajustável
--
-- Uma quarta seria a quarta resposta para a mesma pergunta, e esta base já
-- registrou (0079 §"duas respostas são piores que uma errada") o que isso
-- custa. Então esta migration NÃO cria um modelo novo de item de custo. Ela
-- transforma `fin_recurring` no CATÁLOGO — o lugar onde o item nasce, se
-- liga, se desliga, se reajusta — e constrói em volta dele as três coisas que
-- faltavam para ele poder ser configurado por gente:
--
--   a) a EVIDÊNCIA de cada linha, medida do ledger e legível na tela;
--   b) o VALOR SUGERIDO com o critério DECLARADO, e o erro medido do critério;
--   c) o HISTÓRICO do que mudou — reajuste não sobrescreve, acumula.
--
-- E acrescenta o que o dono pediu e não existia em lugar nenhum: a lista do que
-- vence nos próximos dias sem ninguém ter olhado.
--
-- ===========================================================================
-- 1. O QUE FOI MEDIDO — 17/08/2026, janela ago/2025 a jul/2026 (12 meses fechados)
-- ===========================================================================
-- Universo: saídas de `fin_transaction`, `transfer_status='nao'`, sem
-- lançamento-pai de rateio, fora de categoria de receita e de movimentação
-- financeira, com contraparte e categoria conhecidas. Agrupadas por
-- (contraparte × categoria), como a 0057 já agrupa — a mesma empresa pode ter
-- assinatura mensal E compra avulsa, e tratá-las como uma coisa só produz
-- dispersão alta o bastante para descartar as duas.
--
--   59 grupos com 3 ou mais meses de ocorrência
--   34 deles com mais de um pagamento por mês (a folha sai em 3 a 6 pedaços)
--
-- POR FAMÍLIA DE COMPORTAMENTO DO VALOR:
--
--   estável (dispersão 0,000) .................... 15 grupos
--   varia, 1 pagamento/mês, dispersão < 0,20 ......  5 grupos
--   varia, 1 pagamento/mês, dispersão >= 0,20 .....  5 grupos
--   varia, vários pagamentos/mês ................. 34 grupos
--
-- Dispersão aqui é MAD ÷ mediana dos totais mensais — o que o COMMENT da coluna
-- `fin_recurring.dispersao` promete desde a 0057. (Registro de fato: o detector
-- v1, `scripts/detectar-recorrentes.mjs`, grava desvio-padrão ÷ média nessa
-- coluna. As duas medidas não são a mesma e um único mês fora da curva — 13º,
-- rescisão, compra atípica — separa uma da outra. O catálogo v2 grava o que a
-- coluna documenta.)
--
-- ===========================================================================
-- 2. O CRITÉRIO DO VALOR SUGERIDO NÃO FOI ESCOLHIDO: FOI MEDIDO
-- ===========================================================================
-- Backtest CEGO — para cada mês-alvo, prevê só com os meses anteriores a ele.
-- 46 grupos com 5 ou mais meses de ocorrência, treino mínimo de 3 meses.
--
-- UMA CORREÇÃO QUE MUDOU O VENCEDOR, E QUE VEIO DE UM CASO REAL.
-- A primeira rodada avaliava contra o total de QUALQUER mês. Mas o mês em que a
-- Claro cobrou duas contas — jul/2026, R$ 204,72 em 2 lançamentos contra
-- R$ 99,90 típico — não é um mês em que o preço dobrou: é um mês em que uma
-- fatura atrasada foi paga junto. Medir "prever o valor" contra ele mede a
-- capacidade de prever um atraso. O backtest passou a só avaliar meses-alvo com
-- o número TÍPICO de pagamentos (a moda), e o critério ganhou a mesma condição:
-- o "último valor" é o do último mês COMPARÁVEL, não o do último mês.
--
--   família: estável (dispersão 0)                        37 previsões
--     moda ................. APE mediana  0,00%   ±10%  94,6%   ← escolhido
--     mediana_3m ........... APE mediana  0,00%   ±10%  94,6%
--     último comparável .... APE mediana  0,00%   ±10%  94,6%
--     média da janela ...... APE mediana  0,01%   ±10%  91,9%
--
--   família: varia, 1 pagamento/mês, dispersão < 0,20     10 previsões
--     mediana da janela .... APE mediana  3,82%   ±10%  60,0%   ±20%  70,0%
--     último comparável .... APE mediana  3,84%   ±10%  70,0%   ±20%  80,0%  ← escolhido
--     mediana_3m ........... APE mediana  3,84%   ±10%  60,0%   ±20%  60,0%
--     último (cru) ......... APE mediana  4,75%   ±10%  60,0%   ±20%  70,0%
--     moda ................. APE mediana  7,49%   ±10%  50,0%   ±20%  60,0%
--     média da janela ...... APE mediana 29,10%   ±10%  20,0%   ±20%  40,0%  ← 7,6x pior
--
--   família: varia, vários pagamentos/mês                 49 previsões
--     último (cru) ......... APE mediana 13,78%   ±10%  36,7%   ±20%  51,0%
--     mediana_3m ........... APE mediana 14,15%   ±10%  38,8%   ±20%  55,1%  ← escolhido
--     mediana da janela .... APE mediana 15,47%   ±10%  34,7%   ±20%  59,2%
--     média da janela ...... APE mediana 23,74%   ±10%  18,4%   ±20%  38,8%
--
--   família: varia, 1 pagamento/mês, dispersão >= 0,20      2 previsões
--     TODOS os critérios acima de 47% de erro mediano. Duas previsões aferíveis
--     não decidem nada. → valor INDETERMINADO, com motivo. (Regra nº 5.)
--
-- A leitura, que é o ponto: para o custo que varia com volume — energia, água,
-- telefonia, um pagamento por mês cujo valor muda — o ÚLTIMO valor prevê melhor
-- que a média, e por uma margem de 7,6x. A média suaviza exatamente a informação
-- nova: a Lyra M2m foi de R$ 144,28 para R$ 249,28 em dois meses, e a média da
-- janela ainda diria R$ 170,30. Para o custo estável, tanto faz, e a moda é a
-- que diz a verdade sobre o que aconteceu ("todo mês, este número"). Para o
-- total mensal que é soma de vários pagamentos, mediana_3m e último empatam em
-- erro mediano (14,15% × 13,78%, 0,37 pp em 49 previsões não é diferença) e a
-- mediana ganha nas duas taxas de acerto — fica ela.
--
-- O critério de CADA linha fica gravado em `fin_recurring.amount_basis`, a
-- prosa em `amount_basis_motivo`, e o erro medido da família em
-- `amount_basis_erro_pct`. A tela mostra os três. Trocar de critério é
-- reprocessar, não migrar.
--
-- ===========================================================================
-- 3. RECORRENTE E PARCELADO TÊM A MESMA ASSINATURA ESTATÍSTICA
-- ===========================================================================
-- Densidade 1,00, dispersão 0,00, concentração 1,00 — idênticos. E são coisas
-- diferentes, porque PARCELAMENTO ACABA. Do lado da receita esse erro custou
-- 37% de superestimativa (0057 §detecção). Do lado da despesa o risco é o
-- mesmo, e a solução tem de ser a mesma: não ajustar limiar, LER O QUE A FONTE
-- DECLARA.
--
-- Medido: no extrato das contas correntes NÃO existe marcador de parcela.
-- Dez lançamentos de 2026 casam `/\d{1,2}\s*/\s*\d{1,2}/` e todos os dez são
-- "Taxa de emissão da nota fiscal de serviço nr. 339" — número de nota, não
-- parcela. Zero falsos negativos porque zero positivos verdadeiros: o
-- parcelamento desta empresa não passa pela conta corrente.
--
-- Ele passa pelo CARTÃO, e lá é declarado: `fin_card_installment_plan` tem 25
-- planos com `installments_total` e `last_competence_month`. Seis continuam
-- abertos em 17/08/2026:
--
--   Mercadolivre*Jbvequip ... 9x R$ 388,95 ... termina 04/2027
--   Dl *Alipay .............. 12x R$ 132,32 .. termina 11/2026
--   Hubla *Megablackel ...... 12x R$  98,81 .. termina 11/2026
--   Ryndack Comp*Biscredit .. 12x R$ 137,45 .. termina 10/2026
--   Mp *Aliexpress .......... 12x R$  70,13 .. termina 10/2026
--   Mercadolivre*Emporiol ... 6x  R$ 149,29 .. termina 10/2026
--
--   set/2026 R$ 976,95  ·  out/2026 R$ 620,08  ·  nov/2026 R$ 388,95  ·  a partir
--   de dez/2026 só o Jbvequip, até abril.
--
-- `fin_custo_fixo_parcelado_v` publica isso COM a data de término. Um catálogo
-- que chamasse esses R$ 976,95 de "custo fixo mensal" estaria afirmando que a
-- empresa paga Aliexpress para sempre.
--
-- ===========================================================================
-- 4. O REEMBOLSO — O PEDIDO EXPLÍCITO, E A ARMADILHA JÁ MEDIDA
-- ===========================================================================
-- "inclusive os reembolsos, tudo." Ele entra no catálogo. E entra COMO DETALHE
-- DO PAGAMENTO, nunca como custo adicional, porque:
--
--   O reembolso JÁ ESTÁ dentro de `fin_transaction`. Ele é pago no mês seguinte
--   junto do fixo e classificado como salário (0077 §46). A folha prevista
--   (`fin_folha_previsao_total_v`) já carrega R$ 5.810,71/mês de reembolso
--   dentro dos R$ 90.186,85. Somar o catálogo ao extrato inflaria a folha em
--   ~R$ 6 mil/mês.
--
-- Então a linha existe, é visível, carrega o valor estimado e a ressalva — e
-- `entra_no_total = false` com o motivo escrito. Ela NÃO é uma linha de
-- `fin_recurring`: criar uma seria criar a duplicidade em forma de dado, e o
-- CHECK `fin_recurring_conflito_nao_ativa` só a impediria de ser ativada, não
-- de existir como tentação. Ela é sintetizada em `fin_custo_fixo_catalogo_v` a
-- partir da própria folha, e por isso nunca diverge dela.
--
-- Os 7 meses medidos (jan–jul/2026): 81 pedidos, R$ 42.320,34, mediana mensal
-- do total R$ 5.838,31. O número do catálogo é o da folha (R$ 5.810,71), que é
-- a soma das medianas POR PESSOA nos últimos 6 meses — a mesma base que a 0077
-- usa para prever, para as duas telas não contarem histórias diferentes.
--
-- ===========================================================================
-- 5. A SOBREPOSIÇÃO — E UM BURACO NOVO NA TRAVA DA 0079
-- ===========================================================================
-- A 0100 §3 já registrou uma dupla contagem viva: os 12 documentos a pagar
-- vindos do ClickUp são TODOS folha ("Folha 09/2026 — Tallany", "— Denilson",
-- "— Adryan"), R$ 5.900,00/mês, e as três pessoas estão em
-- `fin_folha_previsao_v`. Continua valendo, e o catálogo acende alerta.
--
-- MEDIDO AGORA, e é achado desta frente: a trava da 0079 que impede recorrente
-- 6.x de disputar com a folha casa `fin_person.counterparty_id = r.counterparty_id`
-- — UMA contraparte por pessoa. Mas `fin_person_counterparty` mostra que SEIS
-- pessoas da folha têm uma segunda contraparte no ledger, o CNPJ de MEI:
--
--   Igor ..... cp 371 (pessoa) e cp 395 ("64266025 Igor Dalton...")
--   Flavio ... cp 372 e cp 393        Cleber ... cp 380 e cp 396
--   Diogo .... cp 373 e cp 391        Igor A ... cp 381 e cp 394
--   Evera .... cp 374 e cp 398
--
-- E é pelo CNPJ que o dinheiro sai: o grupo (cp 395, 6.01) tem R$ 9.727,12 de
-- mediana mensal. Uma recorrente criada sobre a contraparte de MEI passa
-- INTEIRA pela trava da 0079 e, se alguém a ativasse, somaria por cima da folha.
--
-- Esta migration NÃO reescreve a trava da 0079 — mexer na composição de saída é
-- da frente da previsão, e a 0100 já registrou a mesma recusa pelo mesmo motivo.
-- O que ela faz é fechar o buraco NA PORTA DE ENTRADA: o alerta de sobreposição
-- e o carimbo de `conflito_camada` do catálogo resolvem a pessoa por
-- `fin_person_counterparty` (todas as contrapartes dela), não por
-- `fin_person.counterparty_id`. Nenhuma linha de folha nasce sem conflito
-- declarado, e o CHECK `fin_recurring_conflito_nao_ativa` da 0057 faz o resto.
--
-- ===========================================================================
-- 6. O QUE ESTA MIGRATION RECUSA A FAZER
-- ===========================================================================
--   · NÃO ativa nada. Toda linha semeada nasce `proposto`, que o CHECK da 0057
--     e a coluna `entra_no_saldo` de `fin_previsao_evento_v` mantêm FORA do
--     saldo. Ligar é ato humano, com autor e hora. Forçar 59 grupos para
--     'ativo' de uma vez seria decidir 59 vezes no lugar do dono.
--   · NÃO escreve em `fin_transaction`. Nada aqui toca valor, conta ou data de
--     lançamento nenhum, e nenhuma coluna de proveniência é lida ou alterada.
--   · NÃO reescreve `fin_previsao_evento_v` nem `fin_custo_previsto_*`.
--   · NÃO inventa valor. Família sem critério aferível sai com
--     `valor_sugerido_cents` NULL e `valor_indeterminado_motivo` preenchido.
--   · NÃO muda o passado. O ajuste de valor tem `vigente_de` obrigatoriamente
--     no mês corrente ou depois — um CHECK, não um comentário.

-- ===========================================================================
-- 6b. REAPLICÁVEL POR CONSTRUÇÃO — e por que isso não é zelo excessivo
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` recusa qualquer mudança na ORDEM ou no NOME das
-- colunas ("cannot change name of view column"). Numa view de detecção que vai
-- ganhar coluna toda vez que alguém acrescentar um critério, isso significa que
-- a segunda versão do arquivo não roda sobre a primeira — e o erro aparece no
-- meio da aplicação, com metade do arquivo já executada.
--
-- Isto não é hipótese: aconteceu com este arquivo em 17/08/2026. Uma versão
-- intermediária foi aplicada por outro processo desta mesma árvore enquanto ele
-- ainda estava sendo escrito, e a versão seguinte parou exatamente aqui.
--
-- Derrubar e recriar as views próprias, em ordem inversa de dependência, torna
-- o arquivo idempotente de verdade: rodar duas vezes deixa o mesmo estado.
-- Nenhuma tabela é derrubada — só views, que são definição, não dado.
DO $$
BEGIN
  -- `fin_notificacao_fato_v` só pode ser derrubada DEPOIS de a composição
  -- existir. Antes disso ela ainda é o corpo da 0105, e derrubá-la aqui
  -- destruiria o trabalho de outra migration.
  IF to_regclass('public.fin_notificacao_fato_base_v') IS NOT NULL THEN
    DROP VIEW IF EXISTS fin_notificacao_fato_v;
  END IF;
END;
$$;

DROP VIEW IF EXISTS fin_custo_fixo_notificacao_fato_v;
DROP VIEW IF EXISTS fin_custo_fixo_resumo_v;
DROP VIEW IF EXISTS fin_custo_fixo_categoria_v;
DROP VIEW IF EXISTS fin_custo_fixo_catalogo_v;
DROP VIEW IF EXISTS fin_custo_fixo_parcelado_v;
DROP VIEW IF EXISTS fin_custo_fixo_vencimento_v;
DROP VIEW IF EXISTS fin_custo_fixo_deteccao_v;
DROP VIEW IF EXISTS fin_custo_fixo_evidencia_v;

-- ===========================================================================
-- 7. fin_recurring vira catálogo — as colunas que faltavam
-- ===========================================================================
-- Sete colunas, e cada uma existe porque uma pergunta da tela não tinha
-- resposta. `fin_recurring` tem 145 linhas: o ACCESS EXCLUSIVE do ALTER dura
-- milissegundos e não é `fin_transaction` (§6 do CONTINUACAO.md).

ALTER TABLE fin_recurring
  -- Por que este item está ligado, desligado ou suspenso. Sem isto, desligar
  -- destrói a informação de por que se desligou, e alguém religa em três meses.
  ADD COLUMN IF NOT EXISTS status_motivo        text,
  ADD COLUMN IF NOT EXISTS status_alterado_em   timestamptz,
  ADD COLUMN IF NOT EXISTS status_alterado_por  text,

  -- A prosa do critério de valor e o erro MEDIDO da família dele. O número sem
  -- o critério é opinião; o critério sem o erro é fé.
  ADD COLUMN IF NOT EXISTS amount_basis_motivo   text,
  ADD COLUMN IF NOT EXISTS amount_basis_erro_pct numeric(6,2),

  -- Fixo, varia com volume, ou estimado. É o que decide qual critério se aplica
  -- e o que a tela precisa dizer antes de alguém confirmar um número que muda.
  ADD COLUMN IF NOT EXISTS natureza_custo text,

  -- "Revisado" é o verbo do pedido ("o usuário vai revisar"). Uma linha revisada
  -- há dois meses e uma nunca olhada não são o mesmo estado.
  ADD COLUMN IF NOT EXISTS revisado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS revisado_por text;

DO $$
BEGIN
  -- Vocabulário controlado, como o resto desta tabela. 'variavel_volume' é a
  -- família cujo valor muda com consumo; 'indeterminado' é a que o backtest
  -- recusou-se a prever, e ela NÃO pode carregar valor.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_recurring_natureza_custo_ck') THEN
    ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_natureza_custo_ck
      CHECK (natureza_custo IS NULL OR natureza_custo IN
             ('fixo','variavel_volume','parcelado','estimado','indeterminado'));
  END IF;

  -- Ligar/desligar é ato com autor e hora, como confirmar é na 0100. Sem isto,
  -- "suspenso" é só uma palavra numa coluna.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_recurring_status_ato_ck') THEN
    ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_status_ato_ck
      CHECK (status NOT IN ('suspenso','encerrado','recusado')
             OR (status_motivo IS NOT NULL AND status_alterado_em IS NOT NULL
                 AND status_alterado_por IS NOT NULL));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Vocabulário estendido: dois CHECKs ganham valores, nenhum perde
-- ---------------------------------------------------------------------------
-- Não é afrouxar CHECK para o código passar (§10 do CONTINUACAO.md). É o
-- contrário: sem estes dois valores, o critério medido teria de ser gravado sob
-- um rótulo que não o descreve — 'media_janela' num item cujo valor veio do
-- último mês —, e a coluna passaria a mentir sobre a própria decisão.
ALTER TABLE fin_recurring DROP CONSTRAINT IF EXISTS fin_recurring_amount_basis_check;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_amount_basis_check
  CHECK (amount_basis IN ('mediana_3m','media_janela','declarado','contrato',
                          'ultimo_observado','moda_observada'));

-- `conflito_camada` nomeia a camada que JÁ contém aquele dinheiro. Faltavam
-- duas que existem nesta base desde a 0079/0095 e não tinham nome aqui: o DAS
-- (camada `pagar_tributo_das`) e o documento a pagar (camada `pagar_documento`,
-- que só passou a existir quando a 0095 criou a primeira conta a pagar).
ALTER TABLE fin_recurring DROP CONSTRAINT IF EXISTS fin_recurring_conflito_camada_check;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_conflito_camada_check
  CHECK (conflito_camada IS NULL OR conflito_camada IN
         ('cobranca','previsao_contrato','contrato_assinatura','fatura_cartao',
          'folha_declarada','pagamento_recorrente_erp','tributo_das','documento_a_pagar'));

COMMENT ON COLUMN fin_recurring.status_motivo IS
  'Por que ligado/desligado. Obrigatório em suspenso, encerrado e recusado — desligar sem motivo apaga a decisão.';
COMMENT ON COLUMN fin_recurring.amount_basis_motivo IS
  'A prosa do critério, para a tela. O par (amount_basis, amount_basis_erro_pct) é a medida.';
COMMENT ON COLUMN fin_recurring.amount_basis_erro_pct IS
  'APE mediana do critério na família deste item, medida em backtest cego. Ver §2 da 0108.';
COMMENT ON COLUMN fin_recurring.natureza_custo IS
  'fixo | variavel_volume | parcelado | estimado | indeterminado. Decide qual critério de valor se aplica.';

-- ===========================================================================
-- 8. fin_custo_fixo_ajuste — o reajuste que NÃO sobrescreve
-- ===========================================================================
-- "se o aluguel subiu em julho, isso fica registrado, não sobrescrito."
--
-- `fin_recurring.amount_cents` guarda o valor VIGENTE. Sem esta tabela, subir o
-- aluguel de R$ 5.252,23 para R$ 5.500,00 apagaria o primeiro número, e a
-- pergunta "quando subiu, quanto era antes, quem decidiu" só se responderia
-- garimpando `fin_audit_log`. Aqui ela é uma linha.
--
-- E ela carrega a regra que o dono declarou sem dizer com estas palavras:
-- AJUSTAR O CATÁLOGO MUDA A PREVISÃO DOS MESES SEGUINTES, NUNCA O PASSADO.
-- `vigente_de` é competência e o CHECK a prende no mês corrente ou adiante.
-- Um reajuste retroativo reescreveria um mês já confrontado com o extrato — e
-- o confronto previsto × realizado da 0100 passaria a comparar uma previsão que
-- ninguém fez.
CREATE TABLE IF NOT EXISTS fin_custo_fixo_ajuste (
  id            bigserial PRIMARY KEY,
  entity_id     bigint NOT NULL REFERENCES fin_entity(id) ON DELETE CASCADE,
  recurring_id  bigint NOT NULL REFERENCES fin_recurring(id) ON DELETE CASCADE,

  -- O que mudou. 'valor' e 'status' são os dois atos da tela de configuração;
  -- 'dia' e 'categoria' entram porque mudam a previsão do mesmo jeito.
  campo         text NOT NULL CHECK (campo IN ('valor','status','dia','categoria','natureza')),

  -- A competência a partir da qual o novo valor vale. Sempre dia 1.
  vigente_de    date NOT NULL,

  valor_antes_cents bigint CHECK (valor_antes_cents IS NULL OR valor_antes_cents >= 0),
  valor_depois_cents bigint CHECK (valor_depois_cents IS NULL OR valor_depois_cents >= 0),
  texto_antes   text,
  texto_depois  text,

  -- Reajuste sem motivo é reajuste que ninguém consegue conferir depois.
  motivo        text NOT NULL CHECK (length(btrim(motivo)) > 0),
  -- De onde veio o número novo: o detector sugeriu, um contrato declara, ou
  -- alguém digitou. Sem isto, "R$ 5.500,00" é um número sem procedência.
  fonte         text NOT NULL DEFAULT 'humano'
                  CHECK (fonte IN ('humano','detector','contrato','erp_obras')),

  autor         text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fin_custo_fixo_ajuste_competencia_ck
    CHECK (vigente_de = date_trunc('month', vigente_de)::date),

  -- Ao menos um lado do "antes → depois" preenchido; senão a linha não registra
  -- mudança nenhuma.
  CONSTRAINT fin_custo_fixo_ajuste_conteudo_ck
    CHECK (valor_antes_cents IS NOT NULL OR valor_depois_cents IS NOT NULL
           OR texto_antes IS NOT NULL OR texto_depois IS NOT NULL),

  -- Ajuste de valor fala de valor; ajuste de status fala de texto.
  CONSTRAINT fin_custo_fixo_ajuste_campo_ck
    CHECK ((campo = 'valor') = (valor_depois_cents IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS fin_custo_fixo_ajuste_rec_ix
  ON fin_custo_fixo_ajuste (recurring_id, vigente_de DESC, criado_em DESC);

-- O CHECK que não cabe num CHECK: `now()` não é imutável, então a regra "nunca
-- o passado" mora num gatilho. Ele recusa, não corrige — corrigir em silêncio
-- moveria o reajuste de mês sem ninguém saber.
CREATE OR REPLACE FUNCTION fin_custo_fixo_ajuste_guarda() RETURNS trigger AS $$
DECLARE
  v_mes_corrente date;
BEGIN
  v_mes_corrente := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  IF NEW.vigente_de < v_mes_corrente THEN
    RAISE EXCEPTION
      'ajuste %: vigente_de % é anterior ao mês corrente (%) — ajustar o catálogo muda a previsão dos meses seguintes, nunca o passado',
      COALESCE(NEW.id, 0), NEW.vigente_de, v_mes_corrente;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fin_custo_fixo_ajuste é histórico: linha registrada não se altera nem se apaga';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fin_custo_fixo_ajuste_guarda_trg ON fin_custo_fixo_ajuste;
CREATE TRIGGER fin_custo_fixo_ajuste_guarda_trg
  BEFORE INSERT ON fin_custo_fixo_ajuste
  FOR EACH ROW EXECUTE FUNCTION fin_custo_fixo_ajuste_guarda();

DROP TRIGGER IF EXISTS fin_custo_fixo_ajuste_imutavel_trg ON fin_custo_fixo_ajuste;
CREATE TRIGGER fin_custo_fixo_ajuste_imutavel_trg
  BEFORE UPDATE OR DELETE ON fin_custo_fixo_ajuste
  FOR EACH ROW EXECUTE FUNCTION fin_custo_fixo_ajuste_guarda();

COMMENT ON TABLE fin_custo_fixo_ajuste IS
  'Histórico de reajuste e de liga/desliga do catálogo. Imutável por gatilho. '
  'vigente_de nunca é anterior ao mês corrente: o catálogo muda o futuro, não o passado.';

-- ===========================================================================
-- 9. fin_custo_fixo_evidencia_v — a ocorrência, mês a mês
-- ===========================================================================
-- É a prova de cada linha do catálogo, e ela é VIVA: `fin_recurring_observation`
-- congela a evidência na data da detecção (e continua fazendo isso, é o desenho
-- da 0057), mas a tela precisa mostrar "aconteceu em jan, fev, mar..., faltou
-- em abril" com o ledger de hoje. As duas coexistem: uma é o que se afirmou
-- então, a outra é o que se vê agora.
--
-- A JANELA SÃO OS 12 MESES FECHADOS. O mês corrente fica de fora de propósito:
-- em 17/08 agosto tem meia ocorrência, e meia ocorrência conta como falha de
-- densidade. Um catálogo que rebaixa a confiança de todo item no dia 5 de cada
-- mês é um catálogo que ninguém acredita no dia 6.
CREATE OR REPLACE VIEW fin_custo_fixo_evidencia_v AS
WITH janela AS (
  SELECT (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '12 months')::date AS de,
         (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')))::date                        AS ate
)
SELECT
  t.entity_id,
  t.counterparty_id,
  t.category_id,
  date_trunc('month', t.posted_on)::date                                    AS competencia,
  sum(-t.amount_cents)::bigint                                              AS cents,
  count(*)::int                                                             AS lancamentos,
  -- O dia-âncora é o do MAIOR lançamento do mês (amount_cents mais negativo).
  -- A 0057 mediu: 92,5% do total mensal do grupo cai nele.
  (array_agg(extract(day FROM t.posted_on)::int ORDER BY t.amount_cents ASC))[1] AS dia_ancora,
  (array_agg(t.id ORDER BY t.amount_cents ASC))[1]                          AS transaction_id
FROM fin_transaction t
CROSS JOIN janela j
LEFT JOIN fin_category c ON c.id = t.category_id
WHERE t.amount_cents < 0
  AND t.transfer_status = 'nao'
  AND NOT t.is_split_parent
  AND COALESCE(c.kind, '') NOT IN ('receita', 'movimentacao_financeira')
  AND t.counterparty_id IS NOT NULL
  AND t.category_id IS NOT NULL
  AND t.posted_on >= j.de
  AND t.posted_on <  j.ate
GROUP BY 1, 2, 3, 4
-- Mês que fechou em zero ou negativo (estorno maior que a despesa) não é
-- ocorrência: contá-lo derrubaria a mediana com um número que não é preço.
HAVING sum(-t.amount_cents) > 0;

COMMENT ON VIEW fin_custo_fixo_evidencia_v IS
  'A ocorrência mês a mês de cada grupo (contraparte × categoria), nos 12 meses FECHADOS. '
  'É a prova de cada linha do catálogo. Nenhuma coluna daqui é caixa somável: cents é total de mês passado.';

-- ===========================================================================
-- 10. fin_custo_fixo_deteccao_v — o que se repete, com a evidência e o critério
-- ===========================================================================
CREATE OR REPLACE VIEW fin_custo_fixo_deteccao_v AS
WITH e AS (SELECT * FROM fin_custo_fixo_evidencia_v),
base AS (
  SELECT
    entity_id, counterparty_id, category_id,
    count(*)::int                                          AS ocorrencias,
    min(competencia)                                       AS primeira_competencia,
    max(competencia)                                       AS ultima_competencia,
    ((EXTRACT(YEAR  FROM age(max(competencia), min(competencia))) * 12
    + EXTRACT(MONTH FROM age(max(competencia), min(competencia))))::int + 1) AS span_meses,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY cents)::bigint AS mediana_cents,
    avg(cents)::bigint                                     AS media_cents,
    mode() WITHIN GROUP (ORDER BY cents)::bigint           AS moda_cents,
    mode() WITHIN GROUP (ORDER BY dia_ancora)::int         AS dia_do_mes,
    -- Quanto o dia varia. Dia errático com valor estável é parcelamento ou
    -- compra avulsa, não assinatura — a 0057 já tinha medido isso.
    (max(dia_ancora) - min(dia_ancora))::int               AS dia_amplitude,
    avg(lancamentos)::numeric(6,2)                         AS lancamentos_por_mes,
    sum(cents)::bigint                                     AS total_na_janela_cents
  FROM e GROUP BY 1,2,3
),
-- Quantos pagamentos tem um mês TÍPICO deste grupo. É o que separa "o preço
-- subiu" de "duas faturas caíram no mesmo mês".
lanc_moda AS (
  SELECT entity_id, counterparty_id, category_id,
         mode() WITHIN GROUP (ORDER BY lancamentos)::int AS lancamentos_moda
    FROM e GROUP BY 1,2,3
),
ultimo AS (
  SELECT entity_id, counterparty_id, category_id, cents AS ultimo_cents,
         lancamentos AS ultimo_lancamentos, competencia AS ultima_competencia_bruta
    FROM (SELECT e.*, row_number() OVER (PARTITION BY entity_id, counterparty_id, category_id
                                             ORDER BY competencia DESC) AS rn FROM e) z
   WHERE rn = 1
),
-- O último mês COMPARÁVEL: o mais recente com o número típico de pagamentos.
-- Nunca é nulo — todo grupo tem pelo menos um mês igual à própria moda.
ultimo_comparavel AS (
  SELECT entity_id, counterparty_id, category_id,
         cents AS ultimo_comparavel_cents, competencia AS ultimo_comparavel_competencia
    FROM (
      SELECT e.*,
             row_number() OVER (PARTITION BY e.entity_id, e.counterparty_id, e.category_id
                                    ORDER BY e.competencia DESC) AS rn
        FROM e
        JOIN lanc_moda lm
          ON  lm.entity_id       = e.entity_id
         AND  lm.counterparty_id = e.counterparty_id
         AND  lm.category_id     = e.category_id
       WHERE e.lancamentos = lm.lancamentos_moda) z
   WHERE rn = 1
),
ultimos3 AS (
  SELECT entity_id, counterparty_id, category_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY cents)::bigint AS mediana_3m_cents
    FROM (SELECT e.*, row_number() OVER (PARTITION BY entity_id, counterparty_id, category_id
                                             ORDER BY competencia DESC) AS rn FROM e) z
   WHERE rn <= 3 GROUP BY 1,2,3
),
-- MAD ÷ mediana. Robusto a um mês fora da curva; é o que o COMMENT da coluna
-- `fin_recurring.dispersao` promete desde a 0057.
dispersao AS (
  SELECT e.entity_id, e.counterparty_id, e.category_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(e.cents - b.mediana_cents))::numeric AS mad
    FROM e JOIN base b
      ON  b.entity_id = e.entity_id
     AND  b.counterparty_id = e.counterparty_id
     AND  b.category_id = e.category_id
   GROUP BY 1,2,3
),
-- A pessoa da folha, por TODAS as contrapartes dela — não só a primária. É o
-- buraco descrito na §5: seis pessoas pagam pelo CNPJ de MEI, e a trava da 0079
-- casa só `fin_person.counterparty_id`.
folha AS (
  SELECT DISTINCT pc.counterparty_id, p.id AS person_id, p.name AS pessoa, f.total_cents
    FROM fin_person_counterparty pc
    JOIN fin_person p ON p.id = pc.person_id
    JOIN fin_folha_previsao_v f ON f.person_id = p.id
   WHERE f.situacao_na_folha = 'ativo na folha' AND f.total_cents > 0
),
-- Documento a pagar em aberto para a mesma contraparte. A 0095/0096 criou 12,
-- todos de folha.
documento AS (
  SELECT d.counterparty_id, count(*)::int AS documentos, sum(d.amount_cents)::bigint AS cents
    FROM fin_document d
   WHERE d.direction = 'pagar' AND d.status NOT IN ('liquidado','cancelado')
     AND d.counterparty_id IS NOT NULL
   GROUP BY 1
),
calc AS (
  SELECT
    b.*,
    u.ultimo_cents,
    u.ultimo_lancamentos,
    uc.ultimo_comparavel_cents,
    uc.ultimo_comparavel_competencia,
    lm.lancamentos_moda,
    u3.mediana_3m_cents,
    ROUND(b.ocorrencias::numeric / GREATEST(b.span_meses, 1), 3) AS densidade,
    CASE WHEN b.mediana_cents > 0
         THEN ROUND(d.mad / b.mediana_cents, 3) ELSE NULL END    AS dispersao,
    -- Quantos meses fechados se passaram desde a última ocorrência. É o que
    -- responde "isto ainda acontece?" sem ninguém precisar abrir o extrato.
    ((EXTRACT(YEAR  FROM age(date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date, b.ultima_competencia)) * 12
    + EXTRACT(MONTH FROM age(date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date, b.ultima_competencia)))::int - 1)
                                                                 AS meses_sem_ocorrencia,
    f.person_id, f.pessoa, f.total_cents AS folha_cents,
    doc.documentos, doc.cents AS documento_cents
  FROM base b
  JOIN ultimo   u  ON u.entity_id = b.entity_id AND u.counterparty_id = b.counterparty_id AND u.category_id = b.category_id
  JOIN ultimo_comparavel uc ON uc.entity_id = b.entity_id AND uc.counterparty_id = b.counterparty_id AND uc.category_id = b.category_id
  JOIN lanc_moda lm ON lm.entity_id = b.entity_id AND lm.counterparty_id = b.counterparty_id AND lm.category_id = b.category_id
  JOIN ultimos3 u3 ON u3.entity_id = b.entity_id AND u3.counterparty_id = b.counterparty_id AND u3.category_id = b.category_id
  JOIN dispersao d ON d.entity_id = b.entity_id AND d.counterparty_id = b.counterparty_id AND d.category_id = b.category_id
  LEFT JOIN folha f     ON f.counterparty_id  = b.counterparty_id
  LEFT JOIN documento doc ON doc.counterparty_id = b.counterparty_id
),
familia AS (
  SELECT c.*,
    -- As quatro famílias da §2, nesta ordem — a primeira que casar manda.
    CASE
      WHEN c.dispersao = 0                              THEN 'estavel'
      WHEN c.lancamentos_por_mes < 1.5
       AND c.dispersao < 0.20                           THEN 'varia_um_pagamento'
      WHEN c.lancamentos_por_mes < 1.5                   THEN 'varia_um_pagamento_instavel'
      ELSE                                                    'varia_varios_pagamentos'
    END AS familia_valor
  FROM calc c
)
SELECT
  f.entity_id,
  f.counterparty_id,
  f.category_id,
  cp.name                                       AS contraparte,
  cat.code                                      AS categoria_code,
  cat.name                                      AS categoria,
  cat.kind                                      AS categoria_kind,

  -- ── evidência ───────────────────────────────────────────────────────────
  f.ocorrencias,
  f.span_meses,
  f.densidade,
  f.dispersao,
  f.dia_do_mes,
  f.dia_amplitude,
  f.lancamentos_por_mes,
  f.primeira_competencia,
  f.ultima_competencia,
  f.meses_sem_ocorrencia,
  f.total_na_janela_cents,

  -- ── os candidatos a valor, TODOS visíveis ───────────────────────────────
  -- A tela mostra o escolhido e deixa os outros a um clique: quem discorda do
  -- critério precisa poder ver o que o critério descartou.
  f.mediana_cents,
  f.mediana_3m_cents,
  f.ultimo_cents,
  f.ultimo_comparavel_cents,
  f.moda_cents,
  f.media_cents,
  f.ultimo_lancamentos,
  f.lancamentos_moda,
  f.ultimo_comparavel_competencia,
  -- Quanto o último mês se afastou da mediana, em %. Medida, não limiar: é o
  -- que faz a tela poder dizer "julho foi 104% acima do típico" sem que nenhum
  -- corte inventado decida nada por ninguém.
  CASE WHEN f.mediana_cents > 0
       THEN ROUND(100.0 * (f.ultimo_cents - f.mediana_cents) / f.mediana_cents, 1) END AS ultimo_vs_mediana_pct,

  f.familia_valor,

  -- ── o critério, o valor e o erro medido dele ────────────────────────────
  CASE f.familia_valor
    WHEN 'estavel'                     THEN 'moda_observada'
    WHEN 'varia_um_pagamento'          THEN 'ultimo_observado'
    WHEN 'varia_varios_pagamentos'     THEN 'mediana_3m'
    ELSE NULL
  END                                           AS criterio,

  CASE f.familia_valor
    WHEN 'estavel'                     THEN f.moda_cents
    -- O último COMPARÁVEL, não o último. Ver §2: o mês com duas faturas da
    -- Claro não é o mês em que o preço dobrou.
    WHEN 'varia_um_pagamento'          THEN f.ultimo_comparavel_cents
    WHEN 'varia_varios_pagamentos'     THEN f.mediana_3m_cents
    ELSE NULL
  END                                           AS valor_sugerido_cents,

  CASE f.familia_valor
    WHEN 'estavel' THEN
      'todos os ' || f.ocorrencias || ' meses pelo mesmo valor (dispersão 0,000) — a moda É o valor contratado. '
      || 'Backtest cego: erro mediano 0,00% em 37 previsões'
    WHEN 'varia_um_pagamento' THEN
      'um pagamento por mês cujo valor varia (dispersão ' || to_char(f.dispersao, 'FM0D000')
      || ') — custo de volume. O último valor COMPARÁVEL (mês com ' || f.lancamentos_moda
      || ' pagamento(s), o típico deste grupo: ' || to_char(f.ultimo_comparavel_competencia, 'MM/YYYY')
      || ') prevê melhor que a média — backtest cego, erro mediano 3,84% e 80% dentro de ±20%, '
      || 'contra 29,10% da média da janela'
      || CASE WHEN f.ultimo_lancamentos <> f.lancamentos_moda
              THEN '. O último mês fechado teve ' || f.ultimo_lancamentos
                   || ' pagamento(s) e por isso NÃO foi usado: mês com fatura atrasada não é preço novo'
              ELSE '' END
    WHEN 'varia_varios_pagamentos' THEN
      'total mensal somado de ' || to_char(f.lancamentos_por_mes, 'FM990D0') || ' pagamentos — '
      || 'o último mês é ruído. Mediana dos 3 últimos: backtest cego, erro mediano 14,15% e '
      || 'a melhor taxa de acerto dos cinco critérios (55,1% dentro de ±20%)'
    ELSE NULL
  END                                           AS criterio_motivo,

  CASE f.familia_valor
    WHEN 'estavel'                 THEN 0.00
    WHEN 'varia_um_pagamento'      THEN 3.84
    WHEN 'varia_varios_pagamentos' THEN 14.15
    ELSE NULL
  END::numeric(6,2)                             AS criterio_erro_pct,

  -- Regra nº 5: onde não houver evidência, o valor é indeterminado COM MOTIVO.
  CASE WHEN f.familia_valor = 'varia_um_pagamento_instavel' THEN
    'um pagamento por mês com dispersão de ' || to_char(f.dispersao, 'FM0D000')
    || ' — a família inteira tem 5 grupos e apenas 2 previsões aferíveis no backtest, '
    || 'e TODOS os cinco critérios erraram acima de 47%. Não há evidência para escolher um número; '
    || 'declare o valor à mão ou deixe indeterminado'
  END                                           AS valor_indeterminado_motivo,

  CASE f.familia_valor
    WHEN 'estavel'                      THEN 'fixo'
    WHEN 'varia_um_pagamento'           THEN 'variavel_volume'
    WHEN 'varia_varios_pagamentos'      THEN 'estimado'
    ELSE                                     'indeterminado'
  END                                           AS natureza_custo,

  -- ── a confiança, no vocabulário que a 0057 mediu ────────────────────────
  CASE
    WHEN f.ocorrencias >= 4 AND f.densidade >= 0.90 AND COALESCE(f.dispersao, 1) <= 0.20
     AND f.meses_sem_ocorrencia <= 0                                      THEN 'firme'
    WHEN f.ocorrencias >= 3 AND f.densidade >= 0.75 AND COALESCE(f.dispersao, 1) <= 0.40
     AND f.meses_sem_ocorrencia <= 1                                      THEN 'provavel'
    ELSE                                                                       'observado'
  END                                           AS confianca,

  -- ── ainda acontece? ─────────────────────────────────────────────────────
  CASE
    WHEN f.meses_sem_ocorrencia <= 0 THEN 'vigente'
    WHEN f.meses_sem_ocorrencia <= 2 THEN 'falhou_meses'
    ELSE                                  'parou'
  END                                           AS situacao,

  CASE
    WHEN f.meses_sem_ocorrencia > 2 THEN
      'sem ocorrência há ' || f.meses_sem_ocorrencia || ' mês(es) fechado(s) — '
      || 'ou o contrato acabou, ou o pagamento mudou de contraparte. Confira antes de prever'
    WHEN f.meses_sem_ocorrencia > 0 THEN
      'faltou no(s) último(s) ' || f.meses_sem_ocorrencia || ' mês(es) fechado(s)'
  END                                           AS situacao_motivo,

  -- ── a sobreposição, resolvida por TODAS as contrapartes da pessoa ───────
  CASE
    WHEN f.person_id IS NOT NULL AND COALESCE(cat.code, '') LIKE '6.%' THEN 'folha_declarada'
    WHEN COALESCE(cat.code, '') = '7.01'                               THEN 'tributo_das'
    WHEN COALESCE(cat.code, '') = '9.01'                               THEN 'fatura_cartao'
    WHEN f.documentos IS NOT NULL                                      THEN 'documento_a_pagar'
  END                                           AS conflito_camada,

  CASE
    WHEN f.person_id IS NOT NULL AND COALESCE(cat.code, '') LIKE '6.%' THEN
      f.pessoa || ' está em fin_folha_previsao_v como ativo na folha ('
      || to_char(f.folha_cents / 100.0, 'FML999G999G990D00') || '/mês). '
      || 'A camada pagar_folha já projeta este dinheiro; somar aqui contaria a mesma pessoa duas vezes'
      || CASE WHEN NOT EXISTS (SELECT 1 FROM fin_person p2 WHERE p2.id = f.person_id
                                 AND p2.counterparty_id = f.counterparty_id)
              THEN '. ATENÇÃO: esta é uma contraparte SECUNDÁRIA da pessoa (CNPJ de MEI) e a trava '
                   || 'da 0079 casa só fin_person.counterparty_id — ela NÃO pegaria esta linha'
              ELSE '' END
      -- A dupla contagem que a 0100 §3 já tinha medido: além da folha, estas
      -- pessoas têm documento a pagar vindo do ClickUp. São TRÊS camadas sobre
      -- o mesmo salário, e nenhuma delas some sozinha.
      || CASE WHEN f.documentos IS NOT NULL
              THEN '. E ainda ' || f.documentos || ' documento(s) a pagar em aberto ('
                   || to_char(f.documento_cents / 100.0, 'FML999G999G990D00')
                   || ', origem ClickUp) para a mesma pessoa: a camada pagar_documento projeta o MESMO '
                   || 'salário uma terceira vez (0100 §3)'
              ELSE '' END
    WHEN COALESCE(cat.code, '') = '7.01' THEN
      'a camada pagar_tributo_das já projeta o DAS por competência (fin_previsao_evento_v)'
    WHEN COALESCE(cat.code, '') = '9.01' THEN
      'pagamento de fatura não é despesa: é liquidação do que fin_card_transaction detalha (0057 §2b)'
    WHEN f.documentos IS NOT NULL THEN
      f.documentos || ' documento(s) a pagar em aberto para esta contraparte ('
      || to_char(f.documento_cents / 100.0, 'FML999G999G990D00') || ') — a camada pagar_documento já os projeta'
  END                                           AS conflito_motivo,

  -- A chave do dinheiro, no formato que a 0100 publica. Quem cruzar catálogo
  -- com custo previsto usa esta string, e não reinventa a concatenação.
  'fin_recurring_candidato:' || f.counterparty_id || ':' || f.category_id AS chave_candidato
FROM familia f
JOIN fin_counterparty cp ON cp.id = f.counterparty_id
JOIN fin_category    cat ON cat.id = f.category_id
-- TRÊS OCORRÊNCIAS É O PISO ABSOLUTO (0057 §3). Duas não são cadência: são
-- duas coincidências. E o CHECK de `fin_recurring.ocorrencias` recusaria a
-- linha de qualquer jeito.
WHERE f.ocorrencias >= 3;

COMMENT ON VIEW fin_custo_fixo_deteccao_v IS
  'O que se repete no ledger, com a evidência medida e o valor sugerido pelo critério que VENCEU o backtest '
  'da família. valor_sugerido_cents NULL vem com valor_indeterminado_motivo — nunca um número plausível. '
  'conflito_camada nomeia a camada que JÁ contém aquele dinheiro, resolvendo a pessoa por TODAS as '
  'contrapartes dela (fin_person_counterparty), não só a primária.';

-- ===========================================================================
-- 11. fin_custo_fixo_parcelado_v — o que ACABA, com a data em que acaba
-- ===========================================================================
-- A separação que a §3 exige, lida da fonte que a DECLARA. Nenhuma destas
-- linhas é candidata a recorrente: elas já são projetadas pela camada
-- `pagar_cartao_parcela` e, sobretudo, elas terminam.
CREATE OR REPLACE VIEW fin_custo_fixo_parcelado_v AS
SELECT
  p.id                                   AS plano_id,
  p.merchant_label                       AS descricao,
  p.category_id,
  c.code                                 AS categoria_code,
  c.name                                 AS categoria,
  p.counterparty_id,
  p.installments_total                   AS parcelas_total,
  p.installments_billed                  AS parcelas_faturadas,
  p.installments_open                    AS parcelas_abertas,
  p.installment_amount_cents             AS parcela_cents,
  p.open_amount_cents                    AS aberto_cents,
  p.total_amount_cents,
  p.total_is_estimated,
  p.first_competence_month               AS comeca_em,
  -- É esta coluna que separa parcelado de assinatura. Ela existe porque a fonte
  -- a declara; não foi inferida de dispersão nenhuma.
  p.last_competence_month                AS termina_em,
  p.status,
  ((EXTRACT(YEAR  FROM age(p.last_competence_month, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date)) * 12
  + EXTRACT(MONTH FROM age(p.last_competence_month, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date)))::int + 1)
                                         AS meses_restantes,
  'parcelamento declarado na fonte (fin_card_installment_plan): '
    || p.installments_total || 'x de ' || to_char(p.installment_amount_cents / 100.0, 'FML999G999G990D00')
    || ', termina em ' || to_char(p.last_competence_month, 'MM/YYYY')
    || '. NÃO é custo fixo: chamar isto de mensalidade afirmaria que a empresa paga para sempre'
                                         AS ressalva,
  'fatura_cartao'::text                  AS conflito_camada,
  'a camada pagar_cartao_parcela (0079) já projeta esta parcela na fatura'::text AS conflito_motivo
FROM fin_card_installment_plan p
LEFT JOIN fin_category c ON c.id = p.category_id
WHERE p.status <> 'cancelado'
  -- Parcela ABERTA, não plano cujo último mês por acaso é este. Três planos
  -- terminam em ago/2026 com zero parcelas em aberto: contá-los somaria
  -- R$ 425,77/mês de compromisso que já foi liquidado.
  AND p.installments_open > 0
  AND p.last_competence_month >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;

COMMENT ON VIEW fin_custo_fixo_parcelado_v IS
  'O que se repete E ACABA: parcelamento de cartão com a data de término DECLARADA pela fonte. '
  'Fica ao lado do catálogo e fora do total de custo fixo, porque parcelamento não é mensalidade.';

-- ===========================================================================
-- 12. fin_custo_fixo_catalogo_v — o catálogo, linha a linha
-- ===========================================================================
-- Três procedências, e a tela precisa das três:
--
--   'catalogo'  a linha de `fin_recurring` — o que existe e pode ser ligado
--   'candidato' o grupo que o detector achou e que ainda NÃO virou linha
--   'folha'     o reembolso, sintetizado da folha (§4) — detalhe, não custo novo
--
-- `entra_no_total` acende SÓ no que está ligado, sem conflito e com valor. É
-- deliberadamente estreito: o total do catálogo é "o que a empresa decidiu que
-- paga todo mês", não "o que ela pagou". O segundo número existe ao lado, em
-- `total_detectado_cents` de fin_custo_fixo_resumo_v, e é medida do passado.
CREATE OR REPLACE VIEW fin_custo_fixo_catalogo_v AS
WITH det AS (SELECT * FROM fin_custo_fixo_deteccao_v),
ultimo_ajuste AS (
  SELECT DISTINCT ON (recurring_id)
         recurring_id, vigente_de, valor_antes_cents, valor_depois_cents, motivo, autor, criado_em
    FROM fin_custo_fixo_ajuste
   WHERE campo = 'valor'
   ORDER BY recurring_id, vigente_de DESC, criado_em DESC
),
ajustes AS (
  SELECT recurring_id, count(*)::int AS ajustes FROM fin_custo_fixo_ajuste GROUP BY 1
),
linhas AS (
  -- ── 1. o catálogo propriamente dito ────────────────────────────────────
  SELECT
    r.entity_id,
    'catalogo'::text                              AS procedencia,
    r.id                                          AS recurring_id,
    r.label                                       AS descricao,
    r.status,
    r.status_motivo,
    r.status_alterado_em,
    r.status_alterado_por,
    r.confidence                                  AS confianca,
    r.conflito_camada,
    r.conflito_motivo,
    r.category_id,
    r.counterparty_id,
    r.nucleo,
    r.cost_center_id,
    r.day_of_month,
    r.due_day_rule,
    r.cadence,
    r.start_month,
    r.end_month,
    r.natureza_custo,
    r.amount_cents                                AS valor_vigente_cents,
    r.amount_basis                                AS criterio,
    r.amount_basis_motivo                         AS criterio_motivo,
    r.amount_basis_erro_pct                       AS criterio_erro_pct,
    d.valor_sugerido_cents,
    d.valor_indeterminado_motivo,
    -- A diferença entre o que está gravado e o que o detector sugere HOJE. É o
    -- que faz a tela poder dizer "o aluguel subiu 4,7% desde a última revisão"
    -- sem ninguém precisar comparar duas telas.
    CASE WHEN d.valor_sugerido_cents IS NOT NULL
         THEN d.valor_sugerido_cents - r.amount_cents END AS divergencia_sugerido_cents,
    d.ocorrencias, d.span_meses, d.densidade, d.dispersao,
    d.lancamentos_por_mes, d.primeira_competencia, d.ultima_competencia,
    d.meses_sem_ocorrencia, d.situacao, d.situacao_motivo,
    d.mediana_cents, d.mediana_3m_cents, d.ultimo_cents, d.moda_cents, d.media_cents,
    r.revisado_em, r.revisado_por,
    a.ajustes,
    ua.vigente_de                                 AS ultimo_ajuste_vigente_de,
    ua.valor_antes_cents                          AS ultimo_ajuste_antes_cents,
    ua.motivo                                     AS ultimo_ajuste_motivo,
    ua.autor                                      AS ultimo_ajuste_autor,
    (r.status = 'ativo' AND r.conflito_camada IS NULL AND r.amount_cents IS NOT NULL) AS entra_no_total,
    CASE
      WHEN r.conflito_camada IS NOT NULL
        THEN COALESCE(r.conflito_motivo, 'colide com a camada ' || r.conflito_camada)
             || ' — o CHECK fin_recurring_conflito_nao_ativa impede ligar'
      WHEN r.status = 'proposto'
        THEN 'proposto: o detector achou, ninguém confirmou. Continua fora do saldo até alguém ligar'
      WHEN r.status <> 'ativo'
        THEN r.status || ': ' || COALESCE(r.status_motivo, 'sem motivo declarado')
    END                                           AS motivo_fora_do_total,
    'fin_recurring:' || r.id                      AS chave_dedupe
  FROM fin_recurring r
  LEFT JOIN det d
    ON  d.entity_id        = r.entity_id
    AND d.counterparty_id  = r.counterparty_id
    AND d.category_id      = r.category_id
  LEFT JOIN ajustes a       ON a.recurring_id  = r.id
  LEFT JOIN ultimo_ajuste ua ON ua.recurring_id = r.id
  WHERE r.direction = 'pagar'

  UNION ALL

  -- ── 2. o candidato: detectado e ainda sem linha no catálogo ────────────
  -- Fica visível de propósito. Esconder o candidato faria o catálogo parecer
  -- completo quando ele é justamente a lista do que ainda não foi revisado.
  SELECT
    d.entity_id,
    'candidato'::text,
    NULL::bigint,
    d.contraparte || ' — ' || d.categoria,
    'candidato'::text,
    NULL::text, NULL::timestamptz, NULL::text,
    d.confianca,
    d.conflito_camada,
    d.conflito_motivo,
    d.category_id, d.counterparty_id, NULL::text, NULL::bigint,
    d.dia_do_mes, 'exato'::text, 'mensal'::text,
    d.primeira_competencia, NULL::date,
    d.natureza_custo,
    NULL::bigint,
    d.criterio, d.criterio_motivo, d.criterio_erro_pct,
    d.valor_sugerido_cents, d.valor_indeterminado_motivo,
    NULL::bigint,
    d.ocorrencias, d.span_meses, d.densidade, d.dispersao,
    d.lancamentos_por_mes, d.primeira_competencia, d.ultima_competencia,
    d.meses_sem_ocorrencia, d.situacao, d.situacao_motivo,
    d.mediana_cents, d.mediana_3m_cents, d.ultimo_cents, d.moda_cents, d.media_cents,
    NULL::timestamptz, NULL::text,
    NULL::int, NULL::date, NULL::bigint, NULL::text, NULL::text,
    false,
    'candidato: existe no ledger e ainda não existe no catálogo — revise e ligue'::text,
    d.chave_candidato
  FROM det d
  WHERE NOT EXISTS (
    SELECT 1 FROM fin_recurring r
     WHERE r.entity_id = d.entity_id
       AND r.direction = 'pagar'
       AND r.counterparty_id = d.counterparty_id
       AND r.category_id     = d.category_id
  )

  UNION ALL

  -- ── 3. o reembolso (§4) — o pedido explícito, como DETALHE do pagamento ──
  SELECT
    t.entity_id,
    'folha'::text,
    NULL::bigint,
    'Reembolsos a colaboradores (dentro da folha)'::text,
    'informativo'::text,
    NULL::text, NULL::timestamptz, NULL::text,
    'observado'::text,
    'folha_declarada'::text,
    'o reembolso é pago no mês seguinte JUNTO do fixo e classificado como salário — ele já está dentro '
      || 'de fin_transaction e dentro dos ' || to_char(t.total_cents / 100.0, 'FML999G999G990D00')
      || ' da folha prevista. Somá-lo aqui inflaria a folha em ~R$ 6 mil/mês (0077 §46)',
    (SELECT id FROM fin_category WHERE entity_id = t.entity_id AND code = '6.05'),
    NULL::bigint, NULL::text, NULL::bigint,
    -- Dia 2, o mesmo da folha: 82% da folha de 2026 saiu nos dias 1 e 2 (0079).
    2, 'exato'::text, 'mensal'::text,
    date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date, NULL::date,
    'estimado'::text,
    NULL::bigint,
    'declarado'::text,
    'mediana do reembolso embutido no pagamento nos últimos 6 meses, somada por pessoa — a mesma base '
      || 'que fin_folha_previsao_total_v usa, para as duas telas não contarem histórias diferentes'::text,
    NULL::numeric(6,2),
    t.reembolso_cents,
    CASE WHEN t.reembolso_cents IS NULL OR t.reembolso_cents = 0
         THEN 'nenhum reembolso embutido medido nos últimos 6 meses' END,
    NULL::bigint,
    (SELECT count(*)::int FROM fin_reimbursement WHERE entity_id = t.entity_id),
    NULL::int, NULL::numeric, NULL::numeric, NULL::numeric(6,2),
    (SELECT min(reference_month) FROM fin_reimbursement WHERE entity_id = t.entity_id),
    (SELECT max(reference_month) FROM fin_reimbursement WHERE entity_id = t.entity_id),
    NULL::int, 'vigente'::text, NULL::text,
    NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint,
    NULL::timestamptz, NULL::text,
    NULL::int, NULL::date, NULL::bigint, NULL::text, NULL::text,
    false,
    'estimativa, e já contada dentro da folha — esta linha existe para não deixar esquecer, não para somar'::text,
    'folha_reembolso'::text
  FROM fin_folha_previsao_total_v t
)
SELECT
  l.*,
  -- O alerta NÃO suprime nada: ele aponta. (Mesmo desenho da 0100.) Duas linhas
  -- somando pela mesma contraparte podem ser dois custos legítimos — um aluguel
  -- e uma multa do mesmo locador — ou o mesmo dinheiro duas vezes.
  CASE
    WHEN l.counterparty_id IS NOT NULL
     AND count(*) OVER (PARTITION BY l.entity_id, l.counterparty_id) > 1
      THEN 'mesma contraparte em mais de uma linha do catálogo — conferir se é o mesmo dinheiro'
    WHEN l.conflito_camada IS NOT NULL
      THEN 'colide com a camada ' || l.conflito_camada || ': ' || COALESCE(l.conflito_motivo, 'sem motivo declarado')
  END AS alerta_sobreposicao
FROM linhas l;

COMMENT ON VIEW fin_custo_fixo_catalogo_v IS
  'O catálogo de custo recorrente: o que está no catálogo, o que o detector propõe e ainda não está, '
  'e o reembolso como DETALHE do pagamento. Some SÓ entra_no_total; toda linha fora da soma diz por quê '
  'em motivo_fora_do_total. alerta_sobreposicao aponta, nunca suprime.';

-- ===========================================================================
-- 13. fin_custo_fixo_categoria_v — por categoria, com subtotal
-- ===========================================================================
CREATE OR REPLACE VIEW fin_custo_fixo_categoria_v AS
SELECT
  v.entity_id,
  v.category_id,
  c.code                                             AS categoria_code,
  c.name                                             AS categoria,
  c.kind                                             AS categoria_kind,
  count(*)::int                                      AS itens,
  count(*) FILTER (WHERE v.status = 'ativo')::int    AS ligados,
  count(*) FILTER (WHERE v.status = 'proposto')::int AS propostos,
  count(*) FILTER (WHERE v.procedencia = 'candidato')::int AS candidatos,
  count(*) FILTER (WHERE v.status IN ('suspenso','encerrado','recusado'))::int AS desligados,
  count(*) FILTER (WHERE v.alerta_sobreposicao IS NOT NULL)::int AS com_alerta,
  count(*) FILTER (WHERE v.valor_vigente_cents IS NULL
                     AND v.valor_sugerido_cents IS NULL)::int    AS indeterminados,
  -- O que soma: só o ligado, sem conflito, com valor.
  COALESCE(sum(v.valor_vigente_cents) FILTER (WHERE v.entra_no_total), 0)::bigint AS subtotal_cents,
  -- O que está à espera de decisão. Separado, e não somado: é trabalho, não caixa.
  COALESCE(sum(COALESCE(v.valor_vigente_cents, v.valor_sugerido_cents))
             FILTER (WHERE NOT v.entra_no_total AND v.conflito_camada IS NULL), 0)::bigint AS a_revisar_cents,
  -- O que existe e não pode somar porque outra camada já o contém.
  COALESCE(sum(COALESCE(v.valor_vigente_cents, v.valor_sugerido_cents))
             FILTER (WHERE v.conflito_camada IS NOT NULL), 0)::bigint AS em_outra_camada_cents
FROM fin_custo_fixo_catalogo_v v
LEFT JOIN fin_category c ON c.id = v.category_id
GROUP BY v.entity_id, v.category_id, c.code, c.name, c.kind;

COMMENT ON VIEW fin_custo_fixo_categoria_v IS
  'O catálogo por categoria: subtotal do que está LIGADO, mais o que espera revisão e o que já vive '
  'em outra camada — os três separados, porque somá-los é a dupla contagem que a 0061 custou a matar.';

-- ===========================================================================
-- 14. fin_custo_fixo_resumo_v — os totais, com a distinção que importa
-- ===========================================================================
-- Duas perguntas diferentes, dois números, nunca confundidos:
--
--   total_ligado_cents ...... o que a empresa DECIDIU que paga todo mês. É
--                             previsão, entra no saldo, e hoje pode ser zero —
--                             zero aqui significa "ninguém ligou nada ainda",
--                             e o motivo vem escrito.
--   total_detectado_cents ... o que ela DE FATO pagou de recorrente, medido nos
--                             12 meses fechados. É passado, não entra em saldo
--                             nenhum, e é a resposta a "quanto gasto de fixo".
--
-- A quebra por camada existe porque a maior parte do recorrente desta empresa
-- já é projetada por outra coisa — folha, DAS, fatura — e um total único
-- esconderia isso.
CREATE OR REPLACE VIEW fin_custo_fixo_resumo_v AS
WITH cat AS (SELECT * FROM fin_custo_fixo_catalogo_v),
det AS (SELECT * FROM fin_custo_fixo_deteccao_v)
SELECT
  e.id AS entity_id,

  (SELECT COALESCE(sum(valor_vigente_cents), 0)::bigint FROM cat WHERE entra_no_total) AS total_ligado_cents,
  (SELECT count(*)::int FROM cat WHERE entra_no_total)                                 AS itens_ligados,
  (SELECT count(*)::int FROM cat WHERE status = 'proposto')                            AS itens_propostos,
  (SELECT count(*)::int FROM cat WHERE procedencia = 'candidato')                      AS itens_candidatos,
  (SELECT count(*)::int FROM cat WHERE status IN ('suspenso','encerrado','recusado'))  AS itens_desligados,
  (SELECT count(*)::int FROM cat WHERE alerta_sobreposicao IS NOT NULL)                AS itens_com_alerta,
  (SELECT count(*)::int FROM cat WHERE valor_vigente_cents IS NULL AND valor_sugerido_cents IS NULL)
                                                                                       AS itens_indeterminados,
  (SELECT count(*)::int FROM cat WHERE revisado_em IS NULL AND procedencia = 'catalogo')
                                                                                       AS itens_nunca_revisados,

  -- O medido, e a quebra por camada. `valor_sugerido_cents` NULL não entra em
  -- soma nenhuma: a família instável fica fora, contada à parte.
  (SELECT COALESCE(sum(valor_sugerido_cents), 0)::bigint FROM det)                     AS total_detectado_cents,
  (SELECT COALESCE(sum(valor_sugerido_cents), 0)::bigint FROM det WHERE conflito_camada IS NULL)
                                                                                       AS detectado_terceiros_cents,
  (SELECT COALESCE(sum(valor_sugerido_cents), 0)::bigint FROM det WHERE conflito_camada = 'folha_declarada')
                                                                                       AS detectado_folha_cents,
  (SELECT COALESCE(sum(valor_sugerido_cents), 0)::bigint FROM det WHERE conflito_camada = 'tributo_das')
                                                                                       AS detectado_das_cents,
  (SELECT COALESCE(sum(valor_sugerido_cents), 0)::bigint FROM det WHERE conflito_camada = 'documento_a_pagar')
                                                                                       AS detectado_documento_cents,
  (SELECT count(*)::int FROM det WHERE valor_sugerido_cents IS NULL)                   AS detectado_sem_valor,
  (SELECT count(*)::int FROM det)                                                      AS grupos_detectados,

  -- O parcelamento, sempre ao lado e nunca dentro.
  (SELECT COALESCE(sum(parcela_cents), 0)::bigint FROM fin_custo_fixo_parcelado_v)     AS parcelado_mes_corrente_cents,
  (SELECT COALESCE(sum(aberto_cents), 0)::bigint FROM fin_custo_fixo_parcelado_v)      AS parcelado_aberto_cents,
  (SELECT count(*)::int FROM fin_custo_fixo_parcelado_v)                               AS parcelamentos_abertos,
  (SELECT max(termina_em) FROM fin_custo_fixo_parcelado_v)                             AS parcelado_termina_em,

  (SELECT COALESCE(sum(reembolso_cents), 0)::bigint FROM fin_folha_previsao_total_v)   AS reembolso_estimado_cents,

  CASE WHEN (SELECT count(*) FROM cat WHERE entra_no_total) = 0
       THEN 'nenhum item do catálogo está ligado — o catálogo nasce em proposta e ligar é ato humano. '
            || 'Zero aqui é "ninguém decidiu ainda", não "a empresa não tem custo fixo": o medido está em total_detectado_cents'
  END AS total_ligado_motivo
FROM fin_entity e
WHERE e.slug = 'xpe';

COMMENT ON VIEW fin_custo_fixo_resumo_v IS
  'Os dois totais que não podem ser confundidos: total_ligado_cents é decisão (previsão, entra no saldo) '
  'e total_detectado_cents é medida do passado, quebrada pela camada que já contém cada parte.';

-- ===========================================================================
-- 15. fin_custo_fixo_vencimento_v — "assim não vamos esquecer de pagar"
-- ===========================================================================
-- O objetivo declarado do dono, e a única parte desta migration que não é
-- catálogo: o que vence nos próximos dias e ainda NÃO foi pago nem confirmado.
--
-- A fonte é `fin_custo_previsto_consolidado_v` (0100) e só ela — a agenda
-- diária da 0104 já lê a mesma coisa, e uma segunda composição de saída seria a
-- segunda resposta que a 0079 recusa. O que esta view acrescenta é o RECORTE:
-- só o que está em cima da hora, só o que ninguém tocou, e com a razão de por
-- que ainda está aberto.
--
-- "Pago" aqui é `estado = 'realizado'` — o único estado que exige lançamento em
-- `fin_transaction`. Confirmado NÃO é pago, e a coluna diz isso: item
-- confirmado é dinheiro que alguém prometeu, não dinheiro que saiu.
CREATE OR REPLACE VIEW fin_custo_fixo_vencimento_v AS
WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d)
SELECT
  v.entity_id,
  v.competencia,
  v.item_id,
  v.procedencia,
  v.precedencia,
  v.origem_ref,
  v.origem_camada,
  v.chave_dedupe,
  v.descricao,
  v.category_id,
  c.code                                   AS categoria_code,
  c.name                                   AS categoria,
  v.counterparty_id,
  cp.name                                  AS contraparte,
  v.dia_esperado,
  v.dia_regra,
  v.valor_cents,
  (v.dia_esperado - h.d)::int              AS dias_para_vencer,
  CASE
    WHEN v.dia_esperado <  h.d THEN 'vencido'
    WHEN v.dia_esperado =  h.d THEN 'vence_hoje'
    WHEN v.dia_esperado <= h.d + 3 THEN 'vence_em_3_dias'
    ELSE 'vence_em_7_dias'
  END                                      AS urgencia,
  (v.precedencia = 'confirmado')           AS confirmado,
  v.confirmado_por,
  v.entra_no_total,
  v.motivo_nao_soma,
  v.alerta_sobreposicao,
  CASE
    WHEN v.precedencia = 'confirmado'
      THEN 'confirmado por ' || COALESCE(v.confirmado_por, 'alguém') || ' — mas confirmar não é pagar: '
           || 'o estado realizado exige lançamento no extrato'
    WHEN v.procedencia = 'projetado'
      THEN 'ainda não existe item: esta linha é projeção pura, ninguém a olhou'
    ELSE 'item existe e ninguém confirmou'
  END                                      AS o_que_falta,
  'fin_custo_previsto_consolidado_v'::text AS fonte
FROM fin_custo_previsto_consolidado_v v
CROSS JOIN hoje h
LEFT JOIN fin_category     c  ON c.id  = v.category_id
LEFT JOIN fin_counterparty cp ON cp.id = v.counterparty_id
WHERE v.dia_esperado IS NOT NULL
  -- O que já saiu do extrato sai daqui: lembrar de pagar o que já foi pago é o
  -- jeito mais rápido de ensinar alguém a ignorar o aviso.
  AND COALESCE(v.estado, '') <> 'realizado'
  AND v.precedencia <> 'ignorado'
  -- A linha de projeção que um item já substituiu apareceria duas vezes.
  AND NOT v.suprimido_por_item
  -- Janela: de 30 dias atrás (o vencido continua sendo dívida) até 7 dias à
  -- frente. Sete porque é o horizonte em que ainda dá para agir sobre um boleto;
  -- trinta para trás porque antes disso o problema não é esquecimento, é
  -- inadimplência, e ela tem outra tela.
  AND v.dia_esperado >= h.d - 30
  AND v.dia_esperado <= h.d + 7;

COMMENT ON VIEW fin_custo_fixo_vencimento_v IS
  'O que vence nos próximos 7 dias (e o que venceu nos últimos 30) sem ter sido pago. Lê fin_custo_previsto_consolidado_v '
  'e só ela. "Pago" é estado realizado, que exige lançamento: confirmado NÃO é pago, e a coluna o_que_falta diz isso.';

-- ===========================================================================
-- 16. A notificação — o fato existia, faltava o aviso
-- ===========================================================================
-- A 0105 criou `fin_notificacao` e `fin_notificacao_fato_v`. O vencimento do
-- custo previsto não estava lá porque a 0104/0100 ainda não tinham o dado
-- juntado. Agora têm.
--
-- A chave de deduplicação é o par (competência, origem_ref) da 0100 —
-- deliberadamente SEM o número de dias dentro. O prazo encolhe um dia por dia;
-- se ele entrasse na chave, o mesmo boleto viraria um aviso novo toda manhã, e
-- um sino assim se aprende a ignorar no primeiro dia (a mesma lição que a 0105
-- registrou na fonte desatualizada).
ALTER TABLE fin_notificacao DROP CONSTRAINT IF EXISTS fin_notificacao_kind_check;
ALTER TABLE fin_notificacao ADD CONSTRAINT fin_notificacao_kind_check
  CHECK (kind IN (
    'fila_decisao_item', 'fila_decisao_sem_regua',
    'pagamento_aguardando_aprovacao', 'alcada_ausente',
    'time_reembolso_aguardando', 'time_compra_aguardando', 'time_envio_aguardando',
    'time_resposta',
    'fonte_desatualizada', 'invariante_quebrado',
    -- novos
    'custo_fixo_a_vencer', 'custo_fixo_a_revisar'));

-- ---------------------------------------------------------------------------
-- Os dois fatos novos
-- ---------------------------------------------------------------------------
-- 13 colunas, na ordem exata de `fin_notificacao_fato_v` — o UNION ALL abaixo
-- casa por posição, e uma coluna fora de ordem trocaria título por corpo sem
-- erro nenhum. A assertiva ao fim do arquivo confere isso.
CREATE OR REPLACE VIEW fin_custo_fixo_notificacao_fato_v AS
WITH ent AS (SELECT id FROM fin_entity WHERE slug = 'xpe'),

-- (a) O que vence e ninguém pagou. INDIVIDUAL, porque é acionável um a um:
--     cada linha é um boleto que alguém precisa autorizar hoje. A régua não foi
--     inventada — é a janela da própria view (vencido, hoje, ou até 3 dias),
--     e o item que vence em 7 dias fica na tela sem virar sino.
vencer AS (
  SELECT
    'custo_fixo_a_vencer'::text AS kind,
    'perfil'::text AS recipient_kind, NULL::bigint AS recipient_person_id, 'admin'::text AS recipient_perfil,
    'gestao'::text AS escopo,
    -- SEM o prazo dentro da chave: ele encolhe um dia por dia, e o mesmo boleto
    -- viraria aviso novo toda manhã. (A mesma lição que a 0105 registrou na
    -- fonte desatualizada.)
    'custo_fixo_vencer:' || v.chave_dedupe AS dedupe_key,
    CASE v.urgencia
      WHEN 'vencido'         THEN 'Venceu e não foi pago: '
      WHEN 'vence_hoje'      THEN 'Vence hoje: '
      ELSE                        'Vence em ' || v.dias_para_vencer || ' dia(s): '
    END || v.descricao AS titulo,
    to_char(v.dia_esperado, 'DD/MM/YYYY') || ' · ' || COALESCE(v.dia_regra, 'sem regra de data declarada')
      || ' · ' || v.o_que_falta
      || COALESCE(' · ⚠ ' || v.alerta_sobreposicao, '') AS corpo,
    '/financeiro/custos-fixos'::text AS link_href,
    v.valor_cents AS amount_cents,
    CASE WHEN v.valor_cents IS NULL THEN 'o item de custo previsto não declara valor' END AS amount_reason,
    jsonb_build_object('chave_dedupe', v.chave_dedupe, 'competencia', v.competencia,
                       'dia_esperado', v.dia_esperado, 'urgencia', v.urgencia,
                       'item_id', v.item_id, 'origem_ref', v.origem_ref) AS contexto
  FROM fin_custo_fixo_vencimento_v v
  WHERE v.urgencia IN ('vencido', 'vence_hoje', 'vence_em_3_dias')
),

-- (b) O catálogo por revisar — UM aviso agregado, nunca 54.
--     Cinquenta e quatro sinos sobre a mesma tarefa ("revise o catálogo") não
--     são cinquenta e quatro tarefas: são uma. O corpo carrega os números.
revisar AS (
  SELECT
    'custo_fixo_a_revisar'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'custo_fixo_a_revisar' AS dedupe_key,
    'Catálogo de custo fixo por revisar' AS titulo,
    count(*) || ' item(ns) do catálogo nunca foram revisados. O detector propôs o valor com o critério '
      || 'medido; ligar, ajustar ou desligar é decisão de quem conhece a operação.' AS corpo,
    '/financeiro/custos-fixos'::text,
    sum(COALESCE(c.valor_vigente_cents, c.valor_sugerido_cents))::bigint,
    CASE WHEN sum(COALESCE(c.valor_vigente_cents, c.valor_sugerido_cents)) IS NULL
         THEN 'nenhum item por revisar declara valor' END,
    jsonb_build_object('itens', count(*),
                       'sem_valor', count(*) FILTER (WHERE c.valor_vigente_cents IS NULL
                                                       AND c.valor_sugerido_cents IS NULL))
  FROM fin_custo_fixo_catalogo_v c
  WHERE c.revisado_em IS NULL
    AND c.procedencia = 'catalogo'
    -- O que colide com outra camada não é trabalho de revisão: é dado que já
    -- tem dono. Avisar sobre ele encheria o sino do que ninguém vai ligar.
    AND c.conflito_camada IS NULL
  HAVING count(*) > 0
)
SELECT ent.id AS entity_id, f.*
  FROM ent CROSS JOIN (
    SELECT * FROM vencer
    UNION ALL SELECT * FROM revisar
  ) f (kind, recipient_kind, recipient_person_id, recipient_perfil, escopo,
       dedupe_key, titulo, corpo, link_href, amount_cents, amount_reason, contexto);

COMMENT ON VIEW fin_custo_fixo_notificacao_fato_v IS
  'Os dois fatos que o catálogo acrescenta ao sino: o custo que vence sem ter sido pago (individual, '
  'porque é acionável um a um) e o catálogo por revisar (agregado, porque 54 avisos da mesma tarefa são um).';

-- ---------------------------------------------------------------------------
-- E a costura, SEM duplicar uma linha do SQL da 0105
-- ---------------------------------------------------------------------------
-- `fin_notificacao_sync()` lê `fin_notificacao_fato_v` e só ela. Havia três
-- caminhos para acrescentar um fato:
--
--   1. copiar o corpo inteiro da view da 0105 para cá e acrescentar o CTE —
--      duas cópias de 300 linhas de SQL que divergem na primeira correção que
--      alguém fizer em uma só;
--   2. reescrever `fin_notificacao_sync()` com o UNION dentro — duas cópias da
--      função, mesmo problema em menor escala;
--   3. renomear a view da 0105 e pôr no lugar dela uma composição de UMA linha.
--
-- Fica a 3. `fin_notificacao_fato_v` continua sendo o nome único que o sync, as
-- rotas e os testes conhecem; o corpo da 0105 continua sendo a única cópia dele,
-- agora sob `fin_notificacao_fato_base_v`. Nada além do nome mudou nele.
DO $$
BEGIN
  IF to_regclass('public.fin_notificacao_fato_base_v') IS NULL THEN
    ALTER VIEW fin_notificacao_fato_v RENAME TO fin_notificacao_fato_base_v;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW fin_notificacao_fato_v AS
SELECT * FROM fin_notificacao_fato_base_v
UNION ALL
SELECT * FROM fin_custo_fixo_notificacao_fato_v;

COMMENT ON VIEW fin_notificacao_fato_v IS
  'O que MERECE aviso agora. Composição de fin_notificacao_fato_base_v (0105) com '
  'fin_custo_fixo_notificacao_fato_v (0108). Quem acrescentar um fato novo cria a própria view e '
  'entra neste UNION — nunca copia o corpo de outra.';
COMMENT ON VIEW fin_notificacao_fato_base_v IS
  'Os fatos da 0105, renomeados pela 0108 para caberem numa composição. O corpo é o da 0105, byte a byte.';

-- ===========================================================================
-- 17. SEMEADURA — o catálogo nasce com o que o ledger prova, e nasce PROPOSTO
-- ===========================================================================
-- Regra: nenhuma linha nasce ligada. `status = 'proposto'` mantém tudo fora do
-- saldo (`fin_previsao_evento_v.entra_no_saldo = (r.status = 'ativo')`), e o
-- CHECK `fin_recurring_conflito_nao_ativa` impede que qualquer linha com
-- conflito seja ligada mesmo por engano.
--
-- Idempotente pela chave (entity_id, direction, counterparty_id, category_id):
-- rodar de novo não cria linha, só atualiza a evidência.
DO $$
DECLARE
  v_ent      bigint;
  v_criadas  int := 0;
  v_renomeadas int := 0;
  v_conflitos int := 0;
BEGIN
  SELECT id INTO v_ent FROM fin_entity WHERE slug = 'xpe';
  IF v_ent IS NULL THEN
    RAISE EXCEPTION '0108: entidade xpe não existe neste banco';
  END IF;

  -- (a) Os rótulos gerados pela v1 são ilegíveis numa tela de configuração
  --     ("Recorrente mensal — contraparte 359"). Renomeia só os placeholders, e
  --     só onde ninguém travou o campo à mão.
  UPDATE fin_recurring r
     SET label = cp.name || ' — ' || c.name
    FROM fin_counterparty cp, fin_category c
   WHERE cp.id = r.counterparty_id
     AND c.id  = r.category_id
     AND r.direction = 'pagar'
     AND r.label LIKE 'Recorrente mensal — contraparte %'
     AND NOT ('label' = ANY (r.human_locked_fields));
  GET DIAGNOSTICS v_renomeadas = ROW_COUNT;

  -- (b) A evidência e o critério das linhas que JÁ existem passam a ser os
  --     medidos. `amount_cents` NÃO é tocado: mudar o valor vigente de uma
  --     linha do catálogo é ato humano, e é o que fin_custo_fixo_ajuste
  --     registra. O que entra aqui é a SUGESTÃO, que a tela mostra ao lado.
  UPDATE fin_recurring r
     SET ocorrencias        = d.ocorrencias,
         span_meses         = GREATEST(d.span_meses, 3),
         densidade          = d.densidade,
         dispersao          = COALESCE(d.dispersao, r.dispersao),
         amostra_de         = d.primeira_competencia,
         amostra_ate        = d.ultima_competencia,
         last_seen_on       = d.ultima_competencia,
         natureza_custo     = d.natureza_custo,
         amount_basis_motivo   = d.criterio_motivo,
         amount_basis_erro_pct = d.criterio_erro_pct,
         detector_versao    = 'catalogo-v2-2026-08-17',
         detectado_em       = now()
    FROM fin_custo_fixo_deteccao_v d
   WHERE d.entity_id       = r.entity_id
     AND d.counterparty_id = r.counterparty_id
     AND d.category_id     = r.category_id
     AND r.direction = 'pagar';

  -- (c) O conflito de camada, carimbado em quem ainda não tem. Sem ele, uma
  --     linha de folha poderia ser ligada e somar por cima da camada
  --     pagar_folha — inclusive pelas contrapartes de MEI que a trava da 0079
  --     não alcança (§5).
  UPDATE fin_recurring r
     SET conflito_camada = d.conflito_camada,
         conflito_motivo = d.conflito_motivo,
         status = CASE WHEN r.status = 'ativo' THEN 'proposto' ELSE r.status END,
         status_motivo = CASE WHEN r.status = 'ativo'
                              THEN 'rebaixada a proposta pela 0108: colide com a camada ' || d.conflito_camada
                              ELSE r.status_motivo END,
         status_alterado_em  = CASE WHEN r.status = 'ativo' THEN now() ELSE r.status_alterado_em END,
         status_alterado_por = CASE WHEN r.status = 'ativo' THEN 'migration:0108' ELSE r.status_alterado_por END
    FROM fin_custo_fixo_deteccao_v d
   WHERE d.entity_id       = r.entity_id
     AND d.counterparty_id = r.counterparty_id
     AND d.category_id     = r.category_id
     AND r.direction = 'pagar'
     AND r.conflito_camada IS NULL
     AND d.conflito_camada IS NOT NULL;
  GET DIAGNOSTICS v_conflitos = ROW_COUNT;

  -- (d) O que o detector achou e o catálogo não tem. Nasce proposto, com a
  --     evidência inteira e o critério declarado.
  INSERT INTO fin_recurring (
    entity_id, label, direction, counterparty_id, category_id,
    cadence, day_of_month, due_day_rule, start_month,
    amount_cents, amount_basis, amount_basis_motivo, amount_basis_erro_pct,
    natureza_custo, confidence, status,
    conflito_camada, conflito_motivo,
    ocorrencias, span_meses, densidade, dispersao, day_concentration,
    amostra_de, amostra_ate, last_seen_on,
    source, source_id, detector_versao, detectado_em, created_by, notes)
  SELECT
    d.entity_id,
    d.contraparte || ' — ' || d.categoria,
    'pagar',
    d.counterparty_id,
    d.category_id,
    'mensal',
    d.dia_do_mes,
    'exato',
    d.primeira_competencia,
    -- Uma linha SEM valor sugerido não pode entrar: `amount_cents > 0` é CHECK
    -- da 0057. Ela fica de fora do catálogo e aparece como candidato
    -- indeterminado em fin_custo_fixo_catalogo_v, que é onde ela pertence
    -- enquanto ninguém declarar o número.
    d.valor_sugerido_cents,
    CASE d.familia_valor
      WHEN 'estavel'                 THEN 'moda_observada'
      WHEN 'varia_um_pagamento'      THEN 'ultimo_observado'
      ELSE                                'mediana_3m'
    END,
    d.criterio_motivo,
    d.criterio_erro_pct,
    d.natureza_custo,
    d.confianca,
    'proposto',
    d.conflito_camada,
    d.conflito_motivo,
    d.ocorrencias,
    GREATEST(d.span_meses, 3),
    d.densidade,
    COALESCE(d.dispersao, 0),
    -- Concentração de dia: 1 quando o dia-âncora nunca mudou; cai com a
    -- amplitude. É a medida que a 0057 usa para dizer quanto custa prever um
    -- dia só, e ela precisa ser um número entre 0 e 1.
    GREATEST(0, 1 - LEAST(d.dia_amplitude, 15)::numeric / 15)::numeric(4,3),
    d.primeira_competencia,
    d.ultima_competencia,
    d.ultima_competencia,
    'deteccao_historico',
    'catalogo-v2:' || d.counterparty_id || ':' || d.category_id,
    'catalogo-v2-2026-08-17',
    now(),
    'migration:0108',
    'Semeado pela 0108 a partir de ' || d.ocorrencias || ' ocorrência(s) entre '
      || to_char(d.primeira_competencia, 'MM/YYYY') || ' e ' || to_char(d.ultima_competencia, 'MM/YYYY')
      || '. Nasce PROPOSTO: ligar é decisão humana.'
  FROM fin_custo_fixo_deteccao_v d
  WHERE d.valor_sugerido_cents IS NOT NULL
    AND d.valor_sugerido_cents > 0
    AND NOT EXISTS (
      SELECT 1 FROM fin_recurring r
       WHERE r.entity_id = d.entity_id
         AND r.direction = 'pagar'
         AND r.counterparty_id = d.counterparty_id
         AND r.category_id     = d.category_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_criadas = ROW_COUNT;

  -- (e) A evidência mês a mês, congelada na data desta detecção. É o que a
  --     0057 desenhou `fin_recurring_observation` para guardar: a afirmação
  --     fica auditável na data em que foi feita, mesmo depois de o histórico
  --     mudar embaixo dela.
  INSERT INTO fin_recurring_observation (recurring_id, competencia, cents, n_lancamentos, dia_ancora, transaction_id)
  SELECT r.id, e.competencia, e.cents, e.lancamentos, e.dia_ancora, e.transaction_id
    FROM fin_recurring r
    JOIN fin_custo_fixo_evidencia_v e
      ON  e.entity_id       = r.entity_id
     AND  e.counterparty_id = r.counterparty_id
     AND  e.category_id     = r.category_id
   WHERE r.direction = 'pagar'
  ON CONFLICT (recurring_id, competencia) DO NOTHING;

  RAISE NOTICE '0108: % linha(s) criada(s), % rótulo(s) legível(is), % conflito(s) carimbado(s)',
    v_criadas, v_renomeadas, v_conflitos;
END;
$$;

-- ===========================================================================
-- 18. ASSERTIVAS — estruturais, e a âncora de dinheiro
-- ===========================================================================
DO $$
DECLARE
  v_ativas_com_conflito int;
  v_sem_motivo          int;
  v_valor_sem_criterio  int;
  v_chave_dup           int;
  v_folha_sem_conflito  int;
  v_soma_ligada         bigint;
  v_detectado           bigint;
  v_grupos              int;
BEGIN
  -- 1. A guarda central da 0057 continua de pé: nada com conflito fica ativo.
  SELECT count(*) INTO v_ativas_com_conflito
    FROM fin_recurring WHERE status = 'ativo' AND conflito_camada IS NOT NULL;
  IF v_ativas_com_conflito <> 0 THEN
    RAISE EXCEPTION '0108: % recorrente(s) ativa(s) com conflito de camada', v_ativas_com_conflito;
  END IF;

  -- 2. Toda linha fora do total diz por quê. Silêncio aqui é a forma elegante
  --    de esconder dinheiro — a mesma assertiva da 0100.
  SELECT count(*) INTO v_sem_motivo
    FROM fin_custo_fixo_catalogo_v WHERE NOT entra_no_total AND motivo_fora_do_total IS NULL;
  IF v_sem_motivo <> 0 THEN
    RAISE EXCEPTION '0108: % linha(s) fora do total sem motivo declarado', v_sem_motivo;
  END IF;

  -- 3. Valor sugerido sem critério é número sem procedência; critério sem valor
  --    é promessa vazia. Os dois andam juntos ou nenhum aparece.
  SELECT count(*) INTO v_valor_sem_criterio
    FROM fin_custo_fixo_deteccao_v
   WHERE (valor_sugerido_cents IS NOT NULL) <> (criterio IS NOT NULL)
      OR (valor_sugerido_cents IS NULL AND valor_indeterminado_motivo IS NULL);
  IF v_valor_sem_criterio <> 0 THEN
    RAISE EXCEPTION '0108: % grupo(s) com valor e critério desemparelhados, ou indeterminado sem motivo',
      v_valor_sem_criterio;
  END IF;

  -- 4. A promessa a quem consome: entre as linhas que SOMAM, chave_dedupe é
  --    única. Se duas somáveis compartilhassem a chave, agrupar por ela
  --    perderia dinheiro; se a mesma coisa tivesse duas chaves, somar contaria
  --    duas vezes. As duas falhas cabem nesta checagem.
  SELECT count(*) INTO v_chave_dup FROM (
    SELECT entity_id, chave_dedupe FROM fin_custo_fixo_catalogo_v
     WHERE entra_no_total GROUP BY 1,2 HAVING count(*) > 1) x;
  IF v_chave_dup <> 0 THEN
    RAISE EXCEPTION '0108: % chave(s) repetida(s) entre linhas que somam', v_chave_dup;
  END IF;

  -- 5. O buraco da §5, fechado: nenhuma linha de categoria 6.x cuja contraparte
  --    pertença a alguém ativo na folha pode ficar sem conflito declarado —
  --    inclusive pelas contrapartes secundárias (CNPJ de MEI).
  SELECT count(*) INTO v_folha_sem_conflito
    FROM fin_recurring r
    JOIN fin_category c ON c.id = r.category_id
   WHERE r.direction = 'pagar'
     AND c.code LIKE '6.%'
     AND r.conflito_camada IS NULL
     AND EXISTS (
       SELECT 1 FROM fin_person_counterparty pc
         JOIN fin_folha_previsao_v f ON f.person_id = pc.person_id
        WHERE pc.counterparty_id = r.counterparty_id
          AND f.situacao_na_folha = 'ativo na folha' AND f.total_cents > 0);
  IF v_folha_sem_conflito <> 0 THEN
    RAISE EXCEPTION
      '0108: % recorrente(s) 6.x de pessoa ativa na folha sem conflito declarado — é a dupla contagem da §5',
      v_folha_sem_conflito;
  END IF;

  -- 6. A composição do sino casa por POSIÇÃO. Uma coluna fora de ordem trocaria
  --    título por corpo, ou perfil por escopo, sem erro nenhum — e o CHECK
  --    `fin_notificacao_gestao_e_admin` só pegaria alguns dos casos.
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns a
      FULL OUTER JOIN information_schema.columns b
        ON  b.table_name = 'fin_custo_fixo_notificacao_fato_v'
       AND  b.ordinal_position = a.ordinal_position
     WHERE a.table_name = 'fin_notificacao_fato_base_v'
       AND (a.column_name IS DISTINCT FROM b.column_name
            OR a.data_type IS DISTINCT FROM b.data_type)
  ) THEN
    RAISE EXCEPTION '0108: as colunas do fato novo não casam, em nome ou tipo, com as da base do sino';
  END IF;

  -- 6b. E todo aviso aponta para uma tela. Aviso sem destino ensina a ignorar
  --     aviso — é a regra que a 0105 gravou em CHECK, conferida aqui na fonte.
  IF EXISTS (SELECT 1 FROM fin_custo_fixo_notificacao_fato_v
              WHERE link_href IS NULL OR link_href !~ '^/'
                 OR (amount_cents IS NULL AND amount_reason IS NULL)) THEN
    RAISE EXCEPTION '0108: há fato de notificação sem destino ou com valor nulo sem motivo';
  END IF;

  -- 7. O catálogo nasce sem nada ligado. Ligar é ato humano; uma migration que
  --    liga 59 itens decidiu 59 vezes no lugar do dono.
  SELECT total_ligado_cents, total_detectado_cents, grupos_detectados
    INTO v_soma_ligada, v_detectado, v_grupos
    FROM fin_custo_fixo_resumo_v;

  RAISE NOTICE '0108: % grupo(s) detectado(s) · detectado R$ % /mês · ligado R$ % /mês',
    v_grupos,
    to_char(v_detectado / 100.0, 'FM999G999G990D00'),
    to_char(v_soma_ligada / 100.0, 'FM999G999G990D00');
END;
$$;
