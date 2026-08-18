import "server-only";

import { isFinanceConfigured, query } from "../db";
import { comFallback, contrato, contratoIndisponivel, type Contrato } from "./base";

/**
 * A guia de Obras: o que o erp-obras já responde, lido em agregado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NÃO É UMA CÓPIA DO ERP-OBRAS
 * ---------------------------------------------------------------------------
 * O Fernando foi explícito: a execução da obra em si (cronograma, checklist,
 * composição de serviço) fica só no erp-obras, e vai ganhar sua própria tela
 * lá. Esta guia responde só a pergunta financeira — quanto foi contratado,
 * recebido, guardado, gasto — a partir de tabelas espelho AGREGADAS
 * (`erp_projeto`, `erp_reserva_projeto`, `erp_projeto_compra`,
 * `erp_custo_categoria`, `erp_meta_orcamento_projeto`, migration 0121/0122) e
 * de `erp_contrato`/`erp_contrato_parcela` (0045), que já existiam.
 *
 * O sync (`scripts/sync-erp-obras-painel.mjs`) só GRAVA aqui; a leitura do
 * erp-obras acontece numa sessão travada em somente-leitura no Postgres
 * (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`), não por
 * disciplina do código, mas por trava do servidor.
 */

const DOMINIO = "obras";

export type FunilFase = {
  status: string;
  projetos: number;
};

export type Pipeline = {
  contratadoCents: number;
  cronogramaCents: number;
  recebidoCents: number;
  emitidoCents: number;
  nuncaCobradoCents: number;
  inadimplenciaCents: number;
  vencidoSemCobrancaCents: number;
  marcadoPagoSemDocumentoCents: number;
};

export type ReservaProjeto = {
  projetoErpId: number | null;
  projetoNome: string | null;
  projetoStatus: string | null;
  saldoCents: number;
};

export type CustoCategoria = {
  categoria: string;
  valorCents: number;
  lancamentos: number;
};

export type OrcamentoProjeto = {
  projetoErpId: number;
  projetoNome: string;
  metaCents: number | null;
  metasAtivas: number;
  compradoCents: number | null;
  linhasCompra: number | null;
};

export type ObrasDado = {
  totalProjetos: number;
  funil: FunilFase[];
  pipeline: Pipeline | null;
  reservaObrasTotalCents: number | null;
  reservaPorProjeto: ReservaProjeto[];
  custoTotalCents: number;
  custoPorCategoria: CustoCategoria[];
  orcamento: OrcamentoProjeto[];
  ultimoSyncEm: string | null;
};

const VAZIO: ObrasDado = {
  totalProjetos: 0,
  funil: [],
  pipeline: null,
  reservaObrasTotalCents: null,
  reservaPorProjeto: [],
  custoTotalCents: 0,
  custoPorCategoria: [],
  orcamento: [],
  ultimoSyncEm: null
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dia = (v: unknown): string | null =>
  v ? new Date(v as string).toISOString().slice(0, 10) : null;

// A ordem em que um gestor lê o funil: da intenção ao compromisso.
const ORDEM_FASE: Record<string, number> = {
  OPORTUNIDADE: 0,
  PROPOSTA: 1,
  CONTRATADO: 2,
  PLANEJAMENTO: 3,
  EXECUCAO: 4,
  ENCERRADO: 5,
  CANCELADO: 6
};

export async function getObras(): Promise<Contrato<ObrasDado>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, VAZIO, "FINANCE_DATABASE_URL não configurada");
  }

  return comFallback(DOMINIO, VAZIO, async () => {
    const [funilRes, pipelineRes, reservaTotalRes, reservaProjetoRes, custoRes, orcamentoRes, syncRes] =
      await Promise.all([
        query<Record<string, unknown>>(
          `SELECT status_erp, projetos FROM fin_obras_funil_v`
        ),
        query<Record<string, unknown>>(`SELECT * FROM fin_obras_pipeline_v`),
        query<Record<string, unknown>>(
          `SELECT saldo_pago_cents FROM erp_reserva_financeira WHERE slug = 'reserva_obras'`
        ),
        query<Record<string, unknown>>(`SELECT * FROM fin_obras_reserva_projeto_v`),
        query<Record<string, unknown>>(`SELECT * FROM fin_obras_custo_v`),
        query<Record<string, unknown>>(`SELECT * FROM fin_obras_orcamento_v`),
        query<Record<string, unknown>>(
          `SELECT max(synced_at) AS ultimo FROM erp_projeto`
        )
      ]);

    const funil = funilRes
      .map((r) => ({ status: String(r.status_erp), projetos: num(r.projetos) }))
      .sort((a, b) => (ORDEM_FASE[a.status] ?? 99) - (ORDEM_FASE[b.status] ?? 99));

    const p = pipelineRes[0];
    const pipeline: Pipeline | null = p
      ? {
          contratadoCents: num(p.contratado_cents),
          cronogramaCents: num(p.cronograma_cents),
          recebidoCents: num(p.recebido_cents),
          emitidoCents: num(p.emitido_cents),
          nuncaCobradoCents: num(p.nunca_cobrado_cents),
          inadimplenciaCents: num(p.inadimplencia_cents),
          vencidoSemCobrancaCents: num(p.vencido_sem_cobranca_cents),
          marcadoPagoSemDocumentoCents: num(p.marcado_pago_sem_documento_cents)
        }
      : null;

    const reservaPorProjeto: ReservaProjeto[] = reservaProjetoRes.map((r) => ({
      projetoErpId: numOuNulo(r.projeto_erp_id),
      projetoNome: (r.projeto_nome as string) ?? null,
      projetoStatus: (r.projeto_status as string) ?? null,
      saldoCents: num(r.saldo_pago_cents)
    }));

    const custoPorCategoria: CustoCategoria[] = custoRes.map((r) => ({
      categoria: String(r.categoria),
      valorCents: num(r.valor_pago_cents),
      lancamentos: num(r.lancamentos)
    }));

    const orcamento: OrcamentoProjeto[] = orcamentoRes.map((r) => ({
      projetoErpId: num(r.projeto_erp_id),
      projetoNome: String(r.projeto_nome),
      metaCents: numOuNulo(r.valor_meta_total_cents),
      metasAtivas: num(r.metas_ativas),
      compradoCents: numOuNulo(r.total_comprado_cents),
      linhasCompra: numOuNulo(r.linhas_compra)
    }));

    const ressalvas: string[] = [
      "Nada aqui é execução da obra — cronograma, checklist e composição de serviço " +
        "continuam só no erp-obras. Esta tela responde só a pergunta financeira.",
      "O saldo devedor e o comprado por projeto são lidos por sincronização manual " +
        "(scripts/sync-erp-obras-painel.mjs), não em tempo real — confira \"última leitura\"."
    ];

    if (pipeline && pipeline.marcadoPagoSemDocumentoCents > 0) {
      ressalvas.push(
        `${brl(pipeline.marcadoPagoSemDocumentoCents)} está marcado como pago no erp-obras ` +
          "sem um documento do Asaas que confirme — vale conferir manualmente."
      );
    }

    return contrato({
      dominio: DOMINIO,
      dado: {
        totalProjetos: funil.reduce((s, f) => s + f.projetos, 0),
        funil,
        pipeline,
        reservaObrasTotalCents: numOuNulo(reservaTotalRes[0]?.saldo_pago_cents),
        reservaPorProjeto,
        custoTotalCents: custoPorCategoria.reduce((s, c) => s + c.valorCents, 0),
        custoPorCategoria,
        orcamento,
        ultimoSyncEm: dia(syncRes[0]?.ultimo)
      },
      ressalvas
    });
  });
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
