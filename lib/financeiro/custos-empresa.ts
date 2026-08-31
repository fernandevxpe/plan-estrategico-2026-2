import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * CUSTO DA EMPRESA — tudo que sai e não é pessoa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE CONTRATO EXISTE, SE JÁ HÁ /financeiro/custos-fixos
 * ---------------------------------------------------------------------------
 * Aquela tela é o CATÁLOGO: o que se repete, detectado no extrato, com valor
 * sugerido e critério declarado. Ela responde "o que a empresa paga todo mês".
 *
 * Não responde a pergunta que a página de Pessoas responde para gente: quanto
 * custou em cada mês, quanto variou contra o período anterior, e como se
 * divide por categoria. Isso pede SÉRIE, não catálogo — e série vem do
 * extrato, não do catálogo, porque o catálogo guarda um valor por item, não um
 * valor por mês.
 *
 * ---------------------------------------------------------------------------
 * O RECORTE: NÃO É PESSOA
 * ---------------------------------------------------------------------------
 * Pessoas já soma folha, reembolso, comissão, estágio, benefício e encargo — e
 * é a única fonte que inclui reembolso corretamente. Repetir isso aqui contaria
 * o mesmo dinheiro duas vezes, que é o defeito que este módulo mais persegue.
 *
 * O corte é pelo plano de contas: `6.%` é gente (salário, pró-labore,
 * reembolso, estágio, benefício, encargo) e `4.01` é comissão paga a vendedor,
 * que também é gente. `9.%` fica fora por ser transferência entre contas da
 * própria casa — não é custo, é dinheiro mudando de bolso.
 *
 * Medido em 31/08/2026: R$ 501.889,96 em oito meses, 2.342 lançamentos.
 *
 * ---------------------------------------------------------------------------
 * TODA SOMA SAI DO MESMO ARRAY
 * ---------------------------------------------------------------------------
 * A mesma decisão nº 1 de `pessoas.ts`: KPI, gráfico, lista e rodapé somam
 * `celulas` — o grão mês × categoria × conta. Consultas separadas por painel é
 * como duas telas do mesmo módulo começam a discordar; basta um filtro
 * esquecido em uma delas.
 */

const ENTITY = "xpe";

/** O grão. Tudo que a tela mostra é uma soma sobre isto. */
export type CelulaCusto = {
  mes: string;
  categoriaCode: string;
  categoriaNome: string;
  contaNome: string;
  cents: number;
  lancamentos: number;
};

/** Um item do catálogo de recorrentes que NÃO colide com folha, DAS ou fatura. */
export type ItemCatalogo = {
  recurringId: number | null;
  descricao: string;
  categoriaCode: string | null;
  categoriaNome: string | null;
  status: string;
  /** `fixo`, `variavel_volume`, `estimado`, `indeterminado` — vem da detecção. */
  natureza: string | null;
  valorCents: number | null;
  ocorrencias: number;
  cadence: string | null;
  primeiraCompetencia: string | null;
  ultimaCompetencia: string | null;
};

/** O que a detecção achou mas pertence a OUTRA camada — some do total, não da tela. */
export type CamadaExcluida = {
  camada: string;
  rotulo: string;
  itens: number;
  cents: number;
  ondeVer: string;
};

export type CustosEmpresa = {
  disponivel: boolean;
  meses: string[];
  celulas: CelulaCusto[];
  catalogo: ItemCatalogo[];
  camadasExcluidas: CamadaExcluida[];
  /** Mês corrente é parcial: o mês ainda não acabou e a soma vai subir. */
  mesParcial: string | null;
};

function vazio(): CustosEmpresa {
  return { disponivel: false, meses: [], celulas: [], catalogo: [], camadasExcluidas: [], mesParcial: null };
}

/**
 * O rótulo de cada camada e para onde a pessoa deve ir ver aquele dinheiro.
 * Sem isto, "39 itens fora do total" é uma acusação sem endereço.
 */
const CAMADAS: Record<string, { rotulo: string; ondeVer: string }> = {
  folha_declarada: { rotulo: "Folha declarada", ondeVer: "/financeiro/pessoas" },
  tributo_das: { rotulo: "Simples Nacional (DAS)", ondeVer: "/financeiro/mei" },
  documento_a_pagar: { rotulo: "Já é conta a pagar", ondeVer: "/financeiro/contas" },
  fatura_cartao: { rotulo: "Fatura de cartão", ondeVer: "/financeiro/cartoes" }
};

export async function getCustosEmpresa(): Promise<CustosEmpresa> {
  if (!isFinanceConfigured()) return vazio();

  try {
    const [celulasRows, catalogoRows, camadasRows, hojeRows] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT to_char(t.posted_on, 'YYYY-MM') AS mes,
                c.code AS categoria_code,
                c.name AS categoria_nome,
                COALESCE(a.name, 'sem conta') AS conta_nome,
                SUM(-t.amount_cents)::bigint AS cents,
                count(*)::int AS lancamentos
           FROM fin_transaction t
           JOIN fin_category c ON c.id = t.category_id
           JOIN fin_entity e   ON e.id = t.entity_id AND e.slug = $1
           LEFT JOIN fin_account a ON a.id = t.account_id
          WHERE t.amount_cents < 0
            AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date
            -- 6.% e 4.01 são gente; 9.% é transferência entre contas da casa.
            AND c.code NOT LIKE '6.%'
            AND c.code <> '4.01'
            AND c.code NOT LIKE '9.%'
          GROUP BY 1, 2, 3, 4
          ORDER BY 1, 5 DESC`,
        [ENTITY]
      ),
      query<Record<string, unknown>>(
        `SELECT v.recurring_id, v.descricao, c.code AS categoria_code, c.name AS categoria_nome,
                v.status, v.natureza_custo,
                COALESCE(v.valor_vigente_cents, v.valor_sugerido_cents, v.mediana_cents) AS valor_cents,
                COALESCE(v.ocorrencias, 0) AS ocorrencias, v.cadence,
                to_char(v.primeira_competencia, 'YYYY-MM') AS primeira,
                to_char(v.ultima_competencia, 'YYYY-MM')   AS ultima
           FROM fin_custo_fixo_catalogo_v v
           LEFT JOIN fin_category c ON c.id = v.category_id
          WHERE v.conflito_camada IS NULL
          ORDER BY COALESCE(v.valor_vigente_cents, v.valor_sugerido_cents, v.mediana_cents) DESC NULLS LAST`
      ),
      query<Record<string, unknown>>(
        `SELECT conflito_camada, count(*)::int AS itens,
                COALESCE(SUM(COALESCE(valor_vigente_cents, valor_sugerido_cents, mediana_cents)), 0)::bigint AS cents
           FROM fin_custo_fixo_catalogo_v
          WHERE conflito_camada IS NOT NULL
          GROUP BY 1 ORDER BY 3 DESC`
      ),
      query<{ mes: string }>(
        `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes`
      )
    ]);

    const celulas: CelulaCusto[] = celulasRows.map((r) => ({
      mes: String(r.mes),
      categoriaCode: String(r.categoria_code),
      categoriaNome: String(r.categoria_nome),
      contaNome: String(r.conta_nome),
      cents: Number(r.cents),
      lancamentos: Number(r.lancamentos)
    }));

    const meses = [...new Set(celulas.map((c) => c.mes))].sort();

    return {
      disponivel: true,
      meses,
      celulas,
      catalogo: catalogoRows.map((r) => ({
        recurringId: r.recurring_id == null ? null : Number(r.recurring_id),
        descricao: String(r.descricao ?? ""),
        categoriaCode: (r.categoria_code as string) ?? null,
        categoriaNome: (r.categoria_nome as string) ?? null,
        status: String(r.status ?? "proposto"),
        natureza: (r.natureza_custo as string) ?? null,
        valorCents: r.valor_cents == null ? null : Number(r.valor_cents),
        ocorrencias: Number(r.ocorrencias),
        cadence: (r.cadence as string) ?? null,
        primeiraCompetencia: (r.primeira as string) ?? null,
        ultimaCompetencia: (r.ultima as string) ?? null
      })),
      camadasExcluidas: camadasRows.map((r) => {
        const slug = String(r.conflito_camada);
        const meta = CAMADAS[slug] ?? { rotulo: slug, ondeVer: "" };
        return { camada: slug, rotulo: meta.rotulo, ondeVer: meta.ondeVer, itens: Number(r.itens), cents: Number(r.cents) };
      }),
      mesParcial: hojeRows[0]?.mes ?? null
    };
  } catch (error) {
    console.error("[financeiro] custo da empresa indisponível:", error);
    return vazio();
  }
}
