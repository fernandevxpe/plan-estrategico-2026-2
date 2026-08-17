import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";

/**
 * Custo previsto do mês — a tela onde a previsão de saída deixa de ser leitura.
 *
 * A REGRA QUE ESTE CONTRATO EXISTE PARA NÃO DEIXAR A TELA QUEBRAR
 *
 * Cada custo aparece no máximo uma vez no total, mesmo quando duas fontes falam
 * dele. Quando o usuário confirma um item derivado, a projeção que o originou
 * CALA — e continua visível, com o motivo. A tela deve mostrar as duas coisas:
 *
 *   `totalCents`        o que soma (uma linha por dinheiro)
 *   `foraDaSomaCents`   o que existe e não soma, com motivo por item
 *
 * Somar as duas triplica o mês. Esconder a segunda faz o número parecer vindo
 * do nada. É o mesmo desenho de `previsao.ts`, pelo mesmo motivo.
 *
 * O MÊS CORRENTE VEM TRUNCADO, E ISSO É DITO EM VOZ ALTA
 *
 * `fin_previsao_evento_v` é uma curva de CAIXA: ela só enxerga de hoje para a
 * frente. Num dia 16, metade do mês já passou e a projeção não a vê — não
 * porque o gasto não existiu, mas porque ele já é extrato. `diasForaDoHorizonte`
 * e a ressalva medida dizem isso; o realizado do mês fica em `confronto`.
 */

const DOMINIO = "custos";

export type EstadoCusto = "previsto" | "confirmado" | "realizado" | "ignorado";

export type ItemCusto = {
  /** Nulo quando a linha ainda é só projeção — não existe item para editar. */
  itemId: number | null;
  procedencia: "item" | "projetado";
  precedencia: "confirmado" | "derivado" | "manual" | "projetado" | "ignorado";
  precedenciaNivel: number;
  origem: "derivado" | "manual";
  estado: EstadoCusto | null;
  origemRef: string | null;
  origemCamada: string | null;
  /** A identidade do dinheiro. Duas linhas com a mesma chave são a MESMA coisa. */
  chaveDedupe: string;
  descricao: string;
  categoriaId: number | null;
  categoria: string | null;
  categoriaCode: string | null;
  nucleo: string | null;
  centroDeCustoId: number | null;
  contraparteId: number | null;
  contraparte: string | null;
  diaEsperado: string | null;
  /** Por que aquele dia. "folha: dia 2 da competência", "DAS: dia 17". */
  diaRegra: string | null;
  previstoCents: number | null;
  confirmadoCents: number | null;
  /** O valor vigente: confirmado quando houver, previsto quando não. */
  valorCents: number | null;
  entraNoTotal: boolean;
  motivoForaDaSoma: string | null;
  confianca: string | null;
  confirmadoPor: string | null;
  confirmadoEm: string | null;
  lancamentoId: number | null;
  alerta: string | null;
};

export type CategoriaCusto = {
  categoriaId: number | null;
  code: string | null;
  nome: string | null;
  motivoSemCategoria: string | null;
  itens: number;
  subtotalCents: number;
  participacaoPct: number | null;
  confirmadoCents: number;
  projetadoCents: number;
  itensConfirmados: number;
};

export type ConfrontoCusto = {
  categoriaId: number | null;
  code: string | null;
  nome: string | null;
  previstoCents: number;
  confirmadoCents: number;
  ajusteDaConfirmacaoCents: number;
  /** NULL é ausência de lançamento, nunca zero. */
  realizadoCents: number | null;
  lancamentos: number | null;
  erroCents: number | null;
  leitura: string | null;
};

export type CustosDoMes = {
  competencia: string;
  itens: ItemCusto[];
  porCategoria: CategoriaCusto[];
  confronto: ConfrontoCusto[];
  totalCents: number;
  confirmadoCents: number;
  aConfirmarCents: number;
  foraDaSomaCents: number;
  itensIndeterminados: number;
  /** Dias da competência que já passaram e por isso estão fora do horizonte da projeção. */
  diasForaDoHorizonte: number;
  realizadoCents: number | null;
};

export type FiltrosCusto = {
  competencia: string;
  categoria?: string;
  estado?: EstadoCusto;
  contraparte?: number;
  valorMinCents?: number;
  valorMaxCents?: number;
  /** Só o que ainda não foi confirmado. */
  pendentes?: boolean;
};

const VAZIO = (competencia: string): CustosDoMes => ({
  competencia,
  itens: [],
  porCategoria: [],
  confronto: [],
  totalCents: 0,
  confirmadoCents: 0,
  aConfirmarCents: 0,
  foraDaSomaCents: 0,
  itensIndeterminados: 0,
  diasForaDoHorizonte: 0,
  realizadoCents: null
});

export async function getCustosDoMes(filtros: FiltrosCusto): Promise<Contrato<CustosDoMes>> {
  const vazio = VAZIO(filtros.competencia);
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, vazio, "banco financeiro não configurado");

  try {
    // Os filtros entram como parâmetros e nunca interpolados. `$n IS NULL OR ...`
    // em vez de montar o WHERE por concatenação: um filtro a mais aqui não pode
    // virar um caminho de SQL que ninguém testou.
    const [itens, categorias, confronto, horizonte] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT v.*, c.code AS categoria_code, c.name AS categoria_nome, cp.name AS contraparte_nome
           FROM fin_custo_previsto_consolidado_v v
           JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
           LEFT JOIN fin_category c ON c.id = v.category_id
           LEFT JOIN fin_counterparty cp ON cp.id = v.counterparty_id
          WHERE v.competencia = $2::date
            AND ($3::text   IS NULL OR c.code = $3)
            AND ($4::text   IS NULL OR v.estado = $4)
            AND ($5::bigint IS NULL OR v.counterparty_id = $5)
            AND ($6::bigint IS NULL OR COALESCE(v.valor_cents, 0) >= $6)
            AND ($7::bigint IS NULL OR COALESCE(v.valor_cents, 0) <= $7)
            AND (NOT $8::boolean OR v.precedencia NOT IN ('confirmado','ignorado'))
            -- A projeção já substituída não vem: quem a representa é o item.
            AND NOT v.suprimido_por_item
          ORDER BY v.entra_no_total DESC, COALESCE(v.valor_cents, 0) DESC, v.descricao`,
        [
          ENTIDADE,
          filtros.competencia,
          filtros.categoria ?? null,
          filtros.estado ?? null,
          filtros.contraparte ?? null,
          filtros.valorMinCents ?? null,
          filtros.valorMaxCents ?? null,
          Boolean(filtros.pendentes)
        ]
      ),
      query<Record<string, unknown>>(
        `SELECT k.* FROM fin_custo_previsto_categoria_v k
           JOIN fin_entity e ON e.id = k.entity_id AND e.slug = $1
          WHERE k.competencia = $2::date
          ORDER BY k.subtotal_cents DESC`,
        [ENTIDADE, filtros.competencia]
      ),
      query<Record<string, unknown>>(
        `SELECT f.* FROM fin_custo_previsto_confronto_v f
           JOIN fin_entity e ON e.id = f.entity_id AND e.slug = $1
          WHERE f.competencia = $2::date
          ORDER BY COALESCE(f.realizado_cents, 0) DESC, f.previsto_cents DESC`,
        [ENTIDADE, filtros.competencia]
      ),
      query<{ dias: string }>(
        `SELECT GREATEST(0, LEAST(($1::date + interval '1 month')::date,
                                  (now() AT TIME ZONE 'America/Sao_Paulo')::date) - $1::date) AS dias`,
        [filtros.competencia]
      )
    ]);

    const lista: ItemCusto[] = itens.map((l) => ({
      itemId: l.item_id === null ? null : Number(l.item_id),
      procedencia: l.procedencia === "item" ? "item" : "projetado",
      precedencia: String(l.precedencia) as ItemCusto["precedencia"],
      precedenciaNivel: Number(l.precedencia_nivel),
      origem: l.origem === "manual" ? "manual" : "derivado",
      estado: (l.estado as EstadoCusto) ?? null,
      origemRef: (l.origem_ref as string) ?? null,
      origemCamada: (l.origem_camada as string) ?? null,
      chaveDedupe: String(l.chave_dedupe),
      descricao: String(l.descricao),
      categoriaId: l.category_id === null ? null : Number(l.category_id),
      categoria: (l.categoria_nome as string) ?? null,
      categoriaCode: (l.categoria_code as string) ?? null,
      nucleo: (l.nucleo as string) ?? null,
      centroDeCustoId: l.cost_center_id === null ? null : Number(l.cost_center_id),
      contraparteId: l.counterparty_id === null ? null : Number(l.counterparty_id),
      contraparte: (l.contraparte_nome as string) ?? null,
      diaEsperado: l.dia_esperado ? String(l.dia_esperado).slice(0, 10) : null,
      diaRegra: (l.dia_regra as string) ?? null,
      previstoCents: l.valor_previsto_cents === null ? null : Number(l.valor_previsto_cents),
      confirmadoCents: l.valor_confirmado_cents === null ? null : Number(l.valor_confirmado_cents),
      valorCents: l.valor_cents === null ? null : Number(l.valor_cents),
      entraNoTotal: Boolean(l.entra_no_total),
      motivoForaDaSoma: (l.motivo_nao_soma as string) ?? null,
      confianca: (l.confianca as string) ?? null,
      confirmadoPor: (l.confirmado_por as string) ?? null,
      confirmadoEm: l.confirmado_em ? String(l.confirmado_em) : null,
      lancamentoId: l.realizado_transaction_id === null ? null : Number(l.realizado_transaction_id),
      alerta: (l.alerta_sobreposicao as string) ?? null
    }));

    const somam = lista.filter((i) => i.entraNoTotal);
    const totalCents = somam.reduce((s, i) => s + (i.valorCents ?? 0), 0);
    const confirmadoCents = somam
      .filter((i) => i.precedencia === "confirmado")
      .reduce((s, i) => s + (i.valorCents ?? 0), 0);

    const realizado = confronto.reduce<number | null>((s, f) => {
      if (f.realizado_cents === null || f.realizado_cents === undefined) return s;
      return (s ?? 0) + Number(f.realizado_cents);
    }, null);

    const diasForaDoHorizonte = Number(horizonte[0]?.dias ?? 0);

    return contrato({
      dominio: DOMINIO,
      dado: {
        competencia: filtros.competencia,
        itens: lista,
        porCategoria: categorias.map((k) => ({
          categoriaId: k.category_id === null ? null : Number(k.category_id),
          code: (k.categoria_code as string) ?? null,
          nome: (k.categoria as string) ?? null,
          motivoSemCategoria: (k.motivo_sem_categoria as string) ?? null,
          itens: Number(k.itens),
          subtotalCents: Number(k.subtotal_cents),
          participacaoPct: k.participacao_pct === null ? null : Number(k.participacao_pct),
          confirmadoCents: Number(k.confirmado_cents ?? 0),
          projetadoCents: Number(k.projetado_cents ?? 0),
          itensConfirmados: Number(k.itens_confirmados ?? 0)
        })),
        confronto: confronto.map((f) => ({
          categoriaId: f.category_id === null ? null : Number(f.category_id),
          code: (f.categoria_code as string) ?? null,
          nome: (f.categoria as string) ?? null,
          previstoCents: Number(f.previsto_cents ?? 0),
          confirmadoCents: Number(f.confirmado_cents ?? 0),
          ajusteDaConfirmacaoCents: Number(f.ajuste_da_confirmacao_cents ?? 0),
          realizadoCents: f.realizado_cents === null ? null : Number(f.realizado_cents),
          lancamentos: f.lancamentos === null ? null : Number(f.lancamentos),
          erroCents: f.erro_cents === null ? null : Number(f.erro_cents),
          leitura: (f.leitura as string) ?? null
        })),
        totalCents,
        confirmadoCents,
        aConfirmarCents: totalCents - confirmadoCents,
        foraDaSomaCents: lista.filter((i) => !i.entraNoTotal).reduce((s, i) => s + (i.valorCents ?? 0), 0),
        itensIndeterminados: lista.filter((i) => i.valorCents === null).length,
        diasForaDoHorizonte,
        realizadoCents: realizado
      },
      ressalvas: [
        "Some apenas os itens com entraNoTotal. As linhas restantes existem e NÃO somam — cada uma diz por quê em motivoForaDaSoma.",
        "Confirmar não é realizar: item confirmado continua sendo previsão até existir lançamento no extrato.",
        "chaveDedupe é a identidade do dinheiro. Duas linhas com a mesma chave são a mesma coisa vista de procedências diferentes.",
        "realizadoCents null é ausência de lançamento, não afirmação de que nada saiu."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:custos]", mensagem);
    return contratoIndisponivel(DOMINIO, vazio, mensagem);
  }
}
