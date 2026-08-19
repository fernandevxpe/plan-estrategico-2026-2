import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";

/**
 * Reconciliação — o sistema contra um número que veio de fora (0125).
 *
 * SOMENTE LEITURA. A escrita mora em `lib/financeiro/reconciliacao.ts`.
 */

const DOMINIO = "reconciliacao";

export type StatusReconciliacao = "pendente" | "sistema_correto" | "referencia_errada" | "corrigido";

export type LinhaReconciliacao = {
  categoryId: number | null;
  categoriaCode: string | null;
  categoriaNome: string | null;
  mes: string;
  valorSistemaCents: number;
  lancamentos: number;
  referenciaId: number | null;
  valorEsperadoCents: number | null;
  fonte: string | null;
  status: StatusReconciliacao | null;
  nota: string | null;
  /** Nulo = ainda não há referência para comparar — não é o mesmo que diferença zero. */
  diferencaCents: number | null;
};

export type Reconciliacao = {
  linhas: LinhaReconciliacao[];
  totalReferencias: number;
  totalPendentes: number;
  somaAbsDiferencasCents: number;
};

const VAZIO: Reconciliacao = { linhas: [], totalReferencias: 0, totalPendentes: 0, somaAbsDiferencasCents: 0 };

export async function getReconciliacao(
  opcoes: { de?: string; ate?: string } = {}
): Promise<Contrato<Reconciliacao>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    const params: unknown[] = [ENTIDADE];
    let where = "v.entity_id = (SELECT id FROM fin_entity WHERE slug = $1)";
    if (opcoes.de) {
      params.push(opcoes.de);
      where += ` AND v.mes >= $${params.length}`;
    }
    if (opcoes.ate) {
      params.push(opcoes.ate);
      where += ` AND v.mes <= $${params.length}`;
    }

    const linhas = await query<Record<string, unknown>>(
      `SELECT * FROM fin_reconciliacao_v v
        WHERE ${where}
        ORDER BY abs(COALESCE(v.diferenca_cents, 0)) DESC, v.mes DESC, v.categoria_code`,
      params
    );

    const itens: LinhaReconciliacao[] = linhas.map((l) => ({
      categoryId: l.category_id === null ? null : Number(l.category_id),
      categoriaCode: (l.categoria_code as string) ?? null,
      categoriaNome: (l.categoria_nome as string) ?? null,
      mes: String(l.mes).slice(0, 10),
      valorSistemaCents: Number(l.valor_sistema_cents ?? 0),
      lancamentos: Number(l.lancamentos ?? 0),
      referenciaId: l.referencia_id === null || l.referencia_id === undefined ? null : Number(l.referencia_id),
      valorEsperadoCents: l.valor_esperado_cents === null || l.valor_esperado_cents === undefined ? null : Number(l.valor_esperado_cents),
      fonte: (l.fonte as string) ?? null,
      status: (l.status as StatusReconciliacao) ?? null,
      nota: (l.nota as string) ?? null,
      diferencaCents: l.diferenca_cents === null || l.diferenca_cents === undefined ? null : Number(l.diferenca_cents)
    }));

    const comReferencia = itens.filter((i) => i.referenciaId !== null);
    const pendentes = comReferencia.filter((i) => i.status === "pendente");
    const somaAbs = comReferencia.reduce((s, i) => s + Math.abs(i.diferencaCents ?? 0), 0);

    return contrato({
      dominio: DOMINIO,
      dado: {
        linhas: itens,
        totalReferencias: comReferencia.length,
        totalPendentes: pendentes.length,
        somaAbsDiferencasCents: somaAbs
      },
      ressalvas: [
        "`diferencaCents` nulo é AUSÊNCIA de referência, não diferença zero — categoria/mês sem " +
          "nenhum valor esperado salvo ainda não foi comparado.",
        "O lado sistema é `fin_revenue_cash_v`: receita em regime de caixa, sem transferência entre " +
          "contas próprias nem estorno anulado. Se a referência externa usar outro regime, a " +
          "diferença mistura os dois motivos — confira a fonte antes de concluir."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:reconciliacao]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}
