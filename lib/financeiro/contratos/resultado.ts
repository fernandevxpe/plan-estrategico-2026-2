import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill, type Medida } from "./base";

/**
 * Resultado: DRE mensal, orçado × realizado e margem por projeto.
 *
 * DUAS DECLARAÇÕES QUE PRECEDEM QUALQUER NÚMERO AQUI
 *
 * 1. REGIME. `competence_date` está nulo em 100% dos lançamentos. Esta DRE é,
 *    portanto, de CAIXA — e o contrato diz isso em `regime` em vez de deixar
 *    quem lê supor competência. Um DRE de caixa apresentado como competência é
 *    errado em cada linha e parece certo em todas.
 *
 * 2. ORÇAMENTO. As 114 metas de `fin_budget_target` são TODAS de escopo
 *    'obras', cujo realizado mora no ledger do erp-obras e não neste. Por isso
 *    `disponivelCents` sai null com motivo: comparar meta de obras com
 *    realizado da holding produziria uma variação que não significa nada.
 */

const DOMINIO = "resultado";

export type LinhaResultado = {
  linha: string;
  slug: string;
  secao: string;
  tipo: string;
  realizadoCents: number;
  metaCents: number | null;
  referenciaCents: number | null;
  variacaoPct: number | null;
  lancamentos: number;
  drill: Drill | null;
};

export type MesResultado = {
  mes: string;
  linhas: LinhaResultado[];
  receitaCents: number;
  custoCents: number;
  resultadoCents: number;
};

export type Resultado = {
  regime: "caixa" | "competencia";
  motivoRegime: string;
  meses: MesResultado[];
  /** Cobertura: quanto do volume do período tem categoria de verdade (fora 3.99/5.99). */
  classificadoPct: number;
  naoClassificadoCents: number;
};

const VAZIO: Resultado = {
  regime: "caixa",
  motivoRegime: "banco não consultado",
  meses: [],
  classificadoPct: 0,
  naoClassificadoCents: 0
};

export async function getResultado(opcoes: { ano?: number } = {}): Promise<Contrato<Resultado>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");
  const ano = opcoes.ano ?? new Date().getUTCFullYear();

  try {
    const [linhas, classificacao] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT pr.* FROM fin_projetado_realizado_v pr
           JOIN fin_entity e ON e.id = pr.entity_id
          WHERE e.slug = $1 AND pr.ano = $2
          ORDER BY pr.competencia, pr.section, pr.line_slug`,
        [ENTIDADE, ano]
      ),
      // "A classificar" (3.99/5.99) conta como NÃO classificado. As duas
      // parecem categoria — têm dre_line, somam na DRE — e são a declaração de
      // que ninguém sabe o que é. Contá-las como resolvidas infla o indicador
      // exatamente onde a informação falta.
      query<{ total: string; indefinido: string }>(
        `SELECT COALESCE(SUM(abs(t.amount_cents)), 0)::text AS total,
                COALESCE(SUM(abs(t.amount_cents)) FILTER (
                  WHERE t.category_id IS NULL OR c.code IN ('3.99','5.99')), 0)::text AS indefinido
           FROM fin_transaction t
           JOIN fin_entity e ON e.id = t.entity_id
           LEFT JOIN fin_category c ON c.id = t.category_id
          WHERE e.slug = $1 AND t.transfer_status = 'nao' AND NOT t.is_split_parent
            AND EXTRACT(year FROM t.posted_on) = $2`,
        [ENTIDADE, ano]
      )
    ]);

    const porMes = new Map<string, LinhaResultado[]>();
    for (const l of linhas) {
      const mes = String(l.competencia).slice(0, 10);
      const meta = l.meta_cents === null ? null : Number(l.meta_cents);
      const realizado = Number(l.realizado_cents ?? 0);
      const lista = porMes.get(mes) ?? [];
      lista.push({
        linha: String(l.linha),
        slug: String(l.line_slug),
        secao: String(l.section),
        tipo: String(l.kind),
        realizadoCents: realizado,
        metaCents: meta,
        referenciaCents: l.referencia_cents === null ? null : Number(l.referencia_cents),
        // Variação só existe com meta e com meta ≠ 0. Dividir por zero devolve
        // Infinity, que a tela renderiza como "∞%" e ninguém entende.
        variacaoPct: meta && meta !== 0 ? ((Math.abs(realizado) - Math.abs(meta)) / Math.abs(meta)) * 100 : null,
        lancamentos: Number(l.realizado_lancamentos ?? 0),
        drill: { dominio: "lancamentos", filtros: { de: mes, linha: String(l.line_slug) } }
      });
      porMes.set(mes, lista);
    }

    const meses: MesResultado[] = [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, itens]) => {
        const receita = itens.filter((i) => i.secao === "receita").reduce((s, i) => s + i.realizadoCents, 0);
        const custo = itens
          .filter((i) => i.secao === "custo_operacao" || i.secao === "custo_fixo" || i.secao === "deducao")
          .reduce((s, i) => s + i.realizadoCents, 0);
        return { mes, linhas: itens, receitaCents: receita, custoCents: custo, resultadoCents: receita + custo };
      });

    const total = Number(classificacao[0]?.total ?? 0);
    const indefinido = Number(classificacao[0]?.indefinido ?? 0);

    return contrato({
      dominio: DOMINIO,
      dado: {
        regime: "caixa",
        motivoRegime:
          "competence_date está nulo em 100% dos lançamentos; a data usada é posted_on (regime de caixa declarado)",
        meses,
        classificadoPct: total > 0 ? ((total - indefinido) / total) * 100 : 0,
        naoClassificadoCents: indefinido
      },
      ressalvas: [
        "DRE em REGIME DE CAIXA. Não é competência, e a diferença muda o resultado de cada mês.",
        "Categorias 3.99 e 5.99 ('a classificar') contam como NÃO classificadas: parecem categoria e são a declaração de que ninguém sabe o que é."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:resultado]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Orçado × realizado
// ---------------------------------------------------------------------------

export type LinhaOrcamento = {
  targetId: number;
  linha: string;
  slug: string;
  secao: string;
  escopo: string;
  periodicidade: string;
  ano: number;
  periodo: number;
  metaCents: number;
  realizado: Medida;
  comprometidoCents: number;
  pedidoCents: number;
  disponivel: Medida;
  consumoPct: number | null;
  drill: Drill | null;
};

export async function getOrcadoRealizado(ano?: number): Promise<Contrato<LinhaOrcamento[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("orcamento", [], "banco financeiro não configurado");
  try {
    // fin_orcamento_disponivel_v só existe depois da 0075; a query cai para a
    // view antiga quando ela ainda não foi aplicada, e o contrato diz qual usou.
    const linhas = await comOuSemComprometido(ano ?? new Date().getUTCFullYear());
    return contrato({
      dominio: "orcamento",
      dado: linhas.itens,
      ressalvas: [
        linhas.temComprometido
          ? "disponivel = meta − realizado − comprometido (o que já está na fila de pagamento e ainda não virou caixa)."
          : "disponivel = meta − realizado. A fila de pagamento (0075) ainda não está aplicada, então o comprometido não entra.",
        "Escopo 'obras' devolve realizado indeterminado: aquele número mora no ledger do erp-obras, não neste."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:orcamento]", mensagem);
    return contratoIndisponivel("orcamento", [], mensagem);
  }
}

async function comOuSemComprometido(ano: number): Promise<{ itens: LinhaOrcamento[]; temComprometido: boolean }> {
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT o.* FROM fin_orcamento_disponivel_v o
         JOIN fin_entity e ON e.id = o.entity_id
        WHERE e.slug = $1 AND o.ano = $2
        ORDER BY o.section, o.periodo, o.line_slug`,
      [ENTIDADE, ano]
    );
    return { itens: linhas.map((l) => mapearOrcamento(l, true)), temComprometido: true };
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    if (!/does not exist|não existe/i.test(mensagem)) throw error;
    const linhas = await query<Record<string, unknown>>(
      `SELECT o.* FROM fin_orcado_realizado_v o
         JOIN fin_entity e ON e.id = o.entity_id
        WHERE e.slug = $1 AND o.ano = $2
        ORDER BY o.section, o.periodo, o.line_slug`,
      [ENTIDADE, ano]
    );
    return { itens: linhas.map((l) => mapearOrcamento(l, false)), temComprometido: false };
  }
}

function mapearOrcamento(l: Record<string, unknown>, comComprometido: boolean): LinhaOrcamento {
  const meta = Number(l.meta_cents ?? 0);
  const motivo = (l.realizado_indeterminado_motivo as string) ?? null;
  const realizadoBruto = l.realizado_cents === null || l.realizado_cents === undefined ? null : Number(l.realizado_cents);
  const comprometido = comComprometido ? Number(l.comprometido_cents ?? 0) : 0;
  const disponivel =
    l.disponivel_cents === null || l.disponivel_cents === undefined
      ? motivo
        ? null
        : meta - Math.abs(realizadoBruto ?? 0) - comprometido
      : Number(l.disponivel_cents);

  return {
    targetId: Number(l.target_id ?? 0),
    linha: String(l.linha),
    slug: String(l.line_slug),
    secao: String(l.section),
    escopo: String(l.escopo),
    periodicidade: String(l.periodicidade),
    ano: Number(l.ano),
    periodo: Number(l.periodo),
    metaCents: meta,
    realizado: { valorCents: motivo ? null : realizadoBruto, motivo },
    comprometidoCents: comprometido,
    pedidoCents: comComprometido ? Number(l.pedido_cents ?? 0) : 0,
    disponivel: {
      valorCents: disponivel,
      motivo: disponivel === null ? motivo ?? "realizado indeterminado" : null
    },
    consumoPct: motivo || meta === 0 ? null : (Math.abs(realizadoBruto ?? 0) / meta) * 100,
    drill: { dominio: "lancamentos", filtros: { linha: String(l.line_slug) } }
  };
}

// ---------------------------------------------------------------------------
// Margem por projeto
// ---------------------------------------------------------------------------

export type MargemProjeto = {
  centroCustoId: number;
  slug: string;
  nome: string;
  tipo: string;
  nucleo: string | null;
  statusOrigem: string | null;
  contratoCents: number | null;
  receitaCents: number;
  custoCents: number;
  margemCents: number;
  margemPct: number | null;
  /** Custo que caiu no projeto sem definição de natureza. Alto = margem frágil. */
  indefinidoCents: number;
  tesourariaCents: number;
  apontamentos: number;
  /** Fração do custo que já bateu com o extrato. */
  conciliadoPct: number | null;
  drill: Drill;
};

export async function getMargemPorProjeto(): Promise<Contrato<MargemProjeto[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("margem", [], "banco financeiro não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT m.* FROM fin_projeto_margem_v m JOIN fin_entity e ON e.id = m.entity_id
        WHERE e.slug = $1 ORDER BY m.margem_cents DESC NULLS LAST`,
      [ENTIDADE]
    );
    return contrato({
      dominio: "margem",
      dado: linhas.map((l) => {
        const receita = Number(l.receita_cents ?? 0);
        const custo = Number(l.custo_cents ?? 0);
        const conciliado = Number(l.custo_conciliado_cents ?? 0);
        return {
          centroCustoId: Number(l.cost_center_id),
          slug: String(l.slug),
          nome: String(l.name),
          tipo: String(l.kind),
          nucleo: (l.nucleo as string) ?? null,
          statusOrigem: (l.source_status as string) ?? null,
          contratoCents: l.contract_cents === null ? null : Number(l.contract_cents),
          receitaCents: receita,
          custoCents: custo,
          margemCents: Number(l.margem_cents ?? 0),
          margemPct: receita > 0 ? (Number(l.margem_cents ?? 0) / receita) * 100 : null,
          indefinidoCents: Number(l.indefinido_cents ?? 0),
          tesourariaCents: Number(l.tesouraria_cents ?? 0),
          apontamentos: Number(l.apontamentos ?? 0),
          conciliadoPct: custo !== 0 ? (Math.abs(conciliado) / Math.abs(custo)) * 100 : null,
          drill: { dominio: "lancamentos", filtros: { centroCusto: String(l.slug) } }
        };
      }),
      ressalvas: [
        "O centro de custo vem do erp-obras, que carimba projeto majoritariamente em movimento de TESOURARIA — por isso `tesourariaCents` é separado: aquele valor não é custo de obra.",
        "Margem com `indefinidoCents` alto é margem frágil: parte do custo entrou sem natureza declarada."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:margem]", mensagem);
    return contratoIndisponivel("margem", [], mensagem);
  }
}
