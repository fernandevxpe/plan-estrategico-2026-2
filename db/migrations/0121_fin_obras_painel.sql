-- A guia de Obras: espelhos pequenos, agregados — nunca a obra em si.
--
-- ---------------------------------------------------------------------------
-- O QUE O FERNANDO APROVOU
-- ---------------------------------------------------------------------------
-- Depois de ver o Painel de Obras (proposta em artefato), ele confirmou o
-- conteúdo e pediu a tela de verdade, com o design do resto do app. Os cinco
-- blocos aprovados: funil de projetos por fase, a ponte contratado → recebido
-- (com a inadimplência separada de "nunca cobrado"), a reserva de obras por
-- projeto, o custo real por categoria, e meta de orçamento x comprado.
--
-- Regra que não muda: o erp-obras é só leitura, e o que entra aqui é sempre
-- AGREGADO — nunca a linha de execução (PlanoObra, checklist, composição de
-- serviço). Essa parte fica de propósito só no erp-obras, para a futura guia
-- dele não competir com esta.
--
-- ---------------------------------------------------------------------------
-- O QUE JÁ EXISTIA E NÃO PRECISOU DE ESPELHO NOVO
-- ---------------------------------------------------------------------------
-- A ponte contratado → cronograma → recebido → emitido → nunca cobrado sai
-- inteira de erp_contrato + erp_contrato_parcela (0045, já sincronizados) casados
-- com fin_document (Asaas) — por isso fin_obras_pipeline_v não lê nenhuma
-- tabela nova. erp_reserva_financeira (0120) já dá o total de cada caixinha.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION CRIA
-- ---------------------------------------------------------------------------
-- erp_projeto            — identidade do projeto (nome, segmento, fase). Sem
--                           isto não dá nome ao funil nem à reserva por obra.
-- erp_reserva_projeto    — saldo de UMA reserva (ex.: "reserva de obras") por
--                           projeto. Resume LancamentoFinanceiro no momento do
--                           sync; não guarda lançamento nenhum.
-- erp_projeto_compra     — total comprado (LinhaCompra) por projeto, agregado.
-- erp_custo_categoria    — custo PAGO por categoria, só segmento OBRAS,
--                           excluindo "Reserva de caixa" (isso é aplicação/
--                           resgate de CDB, caixa parado, não despesa).
-- erp_meta_orcamento_projeto — meta de orçamento total por projeto (soma das
--                           categorias ativas de MetaOrcamentoProjeto).

CREATE TABLE IF NOT EXISTS erp_projeto (
  id            bigserial PRIMARY KEY,
  erp_id        integer NOT NULL UNIQUE,
  nome          text NOT NULL,
  slug          text,
  segmento      text NOT NULL,
  status_erp    text NOT NULL,
  cliente_nome  text,
  contrato_erp_id integer,
  ativo         boolean NOT NULL DEFAULT false,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE erp_projeto IS
  'Espelho somente-leitura de Projeto (erp-obras) — identidade e fase, nunca execução. '
  'Alimenta o funil da guia de Obras e dá nome às linhas de erp_reserva_projeto.';

CREATE TABLE IF NOT EXISTS erp_reserva_projeto (
  id                 bigserial PRIMARY KEY,
  reserva_erp_id     integer NOT NULL REFERENCES erp_reserva_financeira(erp_id),
  projeto_erp_id     integer REFERENCES erp_projeto(erp_id),
  saldo_pago_cents   bigint NOT NULL,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reserva_erp_id, projeto_erp_id)
);
COMMENT ON TABLE erp_reserva_projeto IS
  'Quanto de cada ReservaFinanceira pertence a cada projeto — resumo calculado no sync '
  '(soma de LancamentoFinanceiro.reservaDestinoId/reservaOrigemId, status=PAGO), nunca o '
  'lançamento individual. projeto_erp_id NULL agrupa movimentos sem projeto vinculado.';

CREATE TABLE IF NOT EXISTS erp_projeto_compra (
  id                    bigserial PRIMARY KEY,
  projeto_erp_id        integer NOT NULL UNIQUE REFERENCES erp_projeto(erp_id),
  total_comprado_cents  bigint NOT NULL,
  linhas                integer NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE erp_projeto_compra IS
  'Total comprado (LinhaCompra.valorTotal) por projeto — agregado, nunca a linha de compra.';

CREATE TABLE IF NOT EXISTS erp_custo_categoria (
  id                  bigserial PRIMARY KEY,
  segmento            text NOT NULL,
  categoria           text NOT NULL,
  valor_pago_cents    bigint NOT NULL,
  lancamentos         integer NOT NULL,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segmento, categoria)
);
COMMENT ON TABLE erp_custo_categoria IS
  'Custo PAGO (LancamentoFinanceiro, movimentacao=SAIDA, status=PAGO) por categoria, por '
  'segmento — exclui a categoria "Reserva de caixa" de propósito: aplicação/resgate de CDB '
  'é caixa mudando de lugar, não despesa. Ver erp_reserva_financeira para essa parte.';

CREATE TABLE IF NOT EXISTS erp_meta_orcamento_projeto (
  id                    bigserial PRIMARY KEY,
  projeto_erp_id        integer NOT NULL UNIQUE REFERENCES erp_projeto(erp_id),
  valor_meta_total_cents bigint NOT NULL,
  metas_ativas          integer NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE erp_meta_orcamento_projeto IS
  'Soma das metas ativas de MetaOrcamentoProjeto por projeto — o orçado, para comparar com '
  'erp_projeto_compra (o comprado). Nenhum dos dois é o gasto real; ver erp_custo_categoria.';

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW fin_obras_funil_v AS
SELECT status_erp, count(*)::int AS projetos
  FROM erp_projeto
 WHERE segmento = 'OBRAS'
 GROUP BY status_erp;

COMMENT ON VIEW fin_obras_funil_v IS
  'Quantos projetos de obras em cada fase (Projeto.status do erp-obras).';

CREATE OR REPLACE VIEW fin_obras_pipeline_v AS
WITH parcelas AS (
  SELECT p.valor_cents,
         p.data_vencimento,
         d.status AS doc_status
    FROM erp_contrato_parcela p
    JOIN erp_contrato c ON c.erp_id = p.erp_contrato_id
    LEFT JOIN fin_document d ON d.id = p.fin_document_id
   WHERE c.eixo = 'OBRAS'
)
SELECT
  (SELECT COALESCE(sum(valor_contratado_cents), 0) FROM erp_contrato WHERE eixo = 'OBRAS' AND status_erp = 'ATIVO') AS contratado_cents,
  (SELECT COALESCE(sum(valor_parcelas_cents), 0) FROM erp_contrato WHERE eixo = 'OBRAS' AND status_erp = 'ATIVO') AS cronograma_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status = 'liquidado'), 0) AS recebido_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status = 'emitido'), 0) AS emitido_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status IS NULL), 0) AS nunca_cobrado_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status = 'emitido' AND data_vencimento < current_date), 0) AS inadimplencia_cents,
  COALESCE(sum(valor_cents) FILTER (WHERE doc_status IS NULL AND data_vencimento < current_date), 0) AS vencido_sem_cobranca_cents
FROM parcelas;

COMMENT ON VIEW fin_obras_pipeline_v IS
  'A ponte contratado -> recebido para OBRAS. Sai de erp_contrato/erp_contrato_parcela '
  '(0045) casado com fin_document (Asaas) — nenhuma tabela nova. Separa inadimplência real '
  '(cobrança emitida e vencida) de vencido-sem-cobrança (falha de processo, não do cliente).';

CREATE OR REPLACE VIEW fin_obras_reserva_projeto_v AS
SELECT rp.projeto_erp_id,
       p.nome AS projeto_nome,
       p.status_erp AS projeto_status,
       r.nome AS reserva_nome,
       rp.saldo_pago_cents
  FROM erp_reserva_projeto rp
  JOIN erp_reserva_financeira r ON r.erp_id = rp.reserva_erp_id
  LEFT JOIN erp_projeto p ON p.erp_id = rp.projeto_erp_id
 WHERE r.slug = 'reserva_obras'
 ORDER BY rp.saldo_pago_cents DESC;

COMMENT ON VIEW fin_obras_reserva_projeto_v IS
  'A caixinha "reserva de obras" do Nubank, por projeto. Acha os projetos que já '
  'resgataram mais do que depositaram (saldo_pago_cents negativo).';

CREATE OR REPLACE VIEW fin_obras_custo_v AS
SELECT categoria, valor_pago_cents, lancamentos
  FROM erp_custo_categoria
 WHERE segmento = 'OBRAS'
 ORDER BY valor_pago_cents DESC;

COMMENT ON VIEW fin_obras_custo_v IS
  'Custo pago por categoria em projetos de obras, sem o movimento de CDB.';

CREATE OR REPLACE VIEW fin_obras_orcamento_v AS
SELECT p.erp_id AS projeto_erp_id,
       p.nome AS projeto_nome,
       m.valor_meta_total_cents,
       m.metas_ativas,
       c.total_comprado_cents,
       c.linhas AS linhas_compra
  FROM erp_projeto p
  LEFT JOIN erp_meta_orcamento_projeto m ON m.projeto_erp_id = p.erp_id
  LEFT JOIN erp_projeto_compra c ON c.projeto_erp_id = p.erp_id
 WHERE p.segmento = 'OBRAS' AND (m.valor_meta_total_cents IS NOT NULL OR c.total_comprado_cents IS NOT NULL)
 ORDER BY m.valor_meta_total_cents DESC NULLS LAST;

COMMENT ON VIEW fin_obras_orcamento_v IS
  'Meta de orçamento x comprado, por projeto — só onde existe pelo menos um dos dois, '
  'para não fingir cobertura de 100% dos 43 projetos de obras.';
