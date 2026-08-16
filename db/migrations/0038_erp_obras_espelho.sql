-- Espelho do extrato do erp-obras. Staging, não ledger.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA DE ESPELHO E NÃO IMPORTAR DIRETO EM fin_transaction
-- ---------------------------------------------------------------------------
-- Porque trocar a fonte do caixa é irreversível na prática: depois que 800
-- linhas entram no ledger com outra procedência, voltar atrás significa apagar
-- e reimportar com o risco de levar junto a classificação humana.
--
-- O espelho permite a ordem certa — primeiro ver, depois confiar, só então
-- promover. Enquanto ele existe, `/financeiro` continua lendo exatamente o que
-- lê hoje e nenhum número da tela muda.
--
-- ---------------------------------------------------------------------------
-- O QUE A COMPARAÇÃO JÁ MOSTROU (medido em 15/08/2026)
-- ---------------------------------------------------------------------------
-- Extrato Nubank, mês a mês, este ledger contra o do erp-obras:
--
--   2026-01 ...  74 linhas / R$ 102.140,80  ambos      IDÊNTICO
--   2026-02 ...  80 linhas / R$  76.312,76  ambos      IDÊNTICO
--   2026-03 ... 168 linhas / R$ 273.045,71  ambos      IDÊNTICO
--   2026-04 ... 148 linhas / R$ 188.490,72  ambos      IDÊNTICO
--   2026-05 ... 119 linhas / R$ 120.800,00  ambos      IDÊNTICO
--   2026-06 ...  85 aqui / 84 lá            Δ R$ 209,27
--   2026-07 ... 103 aqui / 101 lá           Δ R$  17,82
--   2026-08 ...  38 aqui / 77 lá            Δ 39 linhas, R$ 65.009,13
--
-- Cinco meses fecham ao centavo por caminhos independentes: o CSV do Nubank
-- lido aqui e o mesmo extrato lido lá. A divergência de agosto não é erro — é
-- defasagem: este ledger para em 07/08 porque depende de alguém exportar o CSV,
-- e o de lá chega a 15/08 porque o Polp entrega sozinho.
--
-- ---------------------------------------------------------------------------
-- A DIMENSÃO QUE VEM DE BRINDE
-- ---------------------------------------------------------------------------
-- O lançamento do erp-obras já carrega `projetoId`, e a cobertura cresce rápido:
-- 2,5% em maio, 13,1% em junho, 47,5% em julho, 63,6% em agosto. Deste lado,
-- fin_transaction.cost_center_id é NULL em 815 de 815 linhas do Nubank.
--
-- É por isso que o espelho guarda projeto desde já, mesmo sem uso imediato: é o
-- insumo da migração 0037 (kind='projeto' separado por núcleo) e o que torna
-- fin_obra_apontamento — a reconstrução via ClickUp — dispensável.

CREATE TABLE IF NOT EXISTS erp_extrato_linha (
  id                bigserial PRIMARY KEY,

  -- Chave estável do lado de lá: "data|valor|id|índice". É UNIQUE no erp-obras
  -- e é o que torna a reimportação idempotente. O `extratoIdentificador` (id do
  -- Nubank) NÃO serve: ele repete em estorno, e o próprio schema de lá avisa.
  erp_linha_key     text NOT NULL UNIQUE,
  erp_lancamento_id integer NOT NULL,

  conta_slug        text NOT NULL,
  posted_on         date NOT NULL,

  -- Em centavos com sinal, já convertido. Lá o valor é Decimal(14,2) sempre
  -- positivo e o sentido mora em `movimentacao` (ENTRADA/SAIDA); aqui o sinal é
  -- o próprio número, como em fin_transaction. Converter na entrada evita que
  -- cada consulta tenha de lembrar da regra — e que uma delas esqueça.
  amount_cents      bigint NOT NULL,

  descricao         text,
  categoria         text,
  beneficiado       text,

  -- A dimensão de obra, na origem e sem heurística.
  projeto_id        integer,
  projeto_nome      text,
  projeto_segmento  text CHECK (projeto_segmento IS NULL
                                OR projeto_segmento IN ('OBRAS', 'CONSULTORIA')),

  status            text,
  origem            text,
  extrato_identificador text,

  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_extrato_linha IS
  'Espelho somente-leitura do extrato do erp-obras. NÃO É LEDGER: nenhuma tela de saldo, '
  'DRE ou cobertura pode somar esta tabela — o ledger é fin_transaction. Existe para que a '
  'troca de fonte do Nubank (CSV manual → Polp via erp-obras) seja verificável antes de ser '
  'promovida.';

COMMENT ON COLUMN erp_extrato_linha.erp_linha_key IS
  'extratoLinhaKey do erp-obras ("data|valor|id|índice"). Chave de idempotência: a segunda '
  'sincronização reconhece a linha por ela e faz UPDATE, em vez de duplicar.';

COMMENT ON COLUMN erp_extrato_linha.projeto_segmento IS
  'OBRAS ou CONSULTORIA, espelhando Projeto.segmento do erp-obras. Mapeia 1:1 para '
  'fin_cost_center.nucleo (0037) — obras e consultoria como kind=''projeto''.';

CREATE INDEX IF NOT EXISTS erp_extrato_linha_data_idx ON erp_extrato_linha (posted_on);
CREATE INDEX IF NOT EXISTS erp_extrato_linha_conta_idx ON erp_extrato_linha (conta_slug, posted_on);
CREATE INDEX IF NOT EXISTS erp_extrato_linha_projeto_idx ON erp_extrato_linha (projeto_id)
  WHERE projeto_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- A view que responde "posso trocar a fonte?"
-- ---------------------------------------------------------------------------
-- Uma view e não um relatório de script porque a pergunta vai ser feita de novo
-- a cada sincronização, e porque duas contagens escritas em lugares diferentes
-- acabam discordando na hora em que mais importa.
--
-- `so_no_erp` é o número que interessa no dia a dia: quantas linhas existem lá
-- e ainda não existem aqui. Em 15/08 eram 39, valendo R$ 65.009,13 — oito dias
-- de operação invisíveis neste ledger.
CREATE OR REPLACE VIEW erp_extrato_reconciliacao_v AS
WITH meu AS (
  SELECT date_trunc('month', t.posted_on)::date AS mes,
         count(*)                               AS linhas_aqui,
         sum(abs(t.amount_cents))               AS volume_aqui
    FROM fin_transaction t
    JOIN fin_account a ON a.id = t.account_id
   WHERE a.slug = 'nubank'
   GROUP BY 1
),
dele AS (
  SELECT date_trunc('month', e.posted_on)::date AS mes,
         count(*)                               AS linhas_erp,
         sum(abs(e.amount_cents))               AS volume_erp,
         count(*) FILTER (WHERE e.projeto_id IS NOT NULL) AS com_projeto
    FROM erp_extrato_linha e
   WHERE e.conta_slug = 'nubank'
   GROUP BY 1
)
SELECT COALESCE(meu.mes, dele.mes)                              AS mes,
       COALESCE(meu.linhas_aqui, 0)                             AS linhas_aqui,
       COALESCE(dele.linhas_erp, 0)                             AS linhas_erp,
       COALESCE(dele.linhas_erp, 0) - COALESCE(meu.linhas_aqui, 0) AS delta_linhas,
       COALESCE(meu.volume_aqui, 0)                             AS volume_aqui_cents,
       COALESCE(dele.volume_erp, 0)                             AS volume_erp_cents,
       COALESCE(dele.volume_erp, 0) - COALESCE(meu.volume_aqui, 0) AS delta_cents,
       COALESCE(dele.com_projeto, 0)                            AS com_projeto,
       -- Paridade é linha e centavo iguais. Qualquer outra coisa é divergência
       -- a explicar antes de promover o mês.
       (COALESCE(meu.linhas_aqui,0) = COALESCE(dele.linhas_erp,0)
        AND COALESCE(meu.volume_aqui,0) = COALESCE(dele.volume_erp,0)) AS paridade
  FROM meu FULL JOIN dele ON dele.mes = meu.mes
 ORDER BY 1;

COMMENT ON VIEW erp_extrato_reconciliacao_v IS
  'Extrato Nubank deste ledger contra o espelho do erp-obras, por mês. paridade=true '
  'significa mesma contagem E mesmo volume. É o critério de aceite para promover a troca '
  'de fonte de um período.';
