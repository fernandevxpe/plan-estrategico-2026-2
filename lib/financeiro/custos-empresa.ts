import "server-only";

import { classeDe, chaveCusto, sqlContraparteEPessoa, timeDe, TIMES, type ClasseCusto, type TimeCusto } from "./custo-empresa-eixos";
import { isFinanceConfigured, query } from "./db";
import { subparteValida, type SubparteCusto } from "./custo-empresa-partes";

/**
 * CUSTO DA EMPRESA — tudo que sai e não é pessoa.
 *
 * O grão é o da matriz de Pessoas, trocando pessoa por (contraparte ×
 * categoria): KPI, linha, célula e rodapé somam `celulas`. Time e área da
 * empresa são cadastro em `fin_custo_empresa`, gravados na própria linha.
 */

const ENTITY = "xpe";

const SQL_PESSOA_TX = sqlContraparteEPessoa("t.counterparty_id");

const FILTRO_EMPRESA = `
            t.amount_cents < 0
        AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date
        AND c.code NOT LIKE '6.%'
        AND c.code <> '4.01'
        AND c.code NOT LIKE '9.%'
        AND NOT ${SQL_PESSOA_TX}
`;

export type Opcao = { slug: string; nome: string };

export type CelulaCusto = {
  counterpartyId: number | null;
  categoryId: number;
  mes: string;
  cents: number;
  lancamentos: number;
};

export type ItemCusto = {
  counterpartyId: number | null;
  categoryId: number;
  nome: string;
  categoriaCode: string;
  categoriaNome: string;
  time: TimeCusto;
  areasEmpresa: Opcao[];
  classe: ClasseCusto;
  /** Override do bloco da matriz. Null = heurística. */
  bloco: SubparteCusto | null;
};

export type CamadaExcluida = {
  camada: string;
  rotulo: string;
  itens: number;
  cents: number;
  ondeVer: string;
};

export type FaturaCartaoCelula = {
  emissor: "inter" | "nubank";
  nome: string;
  mes: string;
  cents: number;
};

export type CustosEmpresa = {
  disponivel: boolean;
  meses: string[];
  mesAtual: string | null;
  itens: ItemCusto[];
  celulas: CelulaCusto[];
  times: Opcao[];
  areasEmpresa: Opcao[];
  camadasExcluidas: CamadaExcluida[];
  /** Caixa da fatura (9.01). NÃO soma com celulas. */
  faturasCartao: FaturaCartaoCelula[];
};

function vazio(): CustosEmpresa {
  return {
    disponivel: false,
    meses: [],
    mesAtual: null,
    itens: [],
    celulas: [],
    times: [...TIMES],
    areasEmpresa: [],
    camadasExcluidas: [],
    faturasCartao: []
  };
}

const CAMADAS: Record<string, { rotulo: string; ondeVer: string }> = {
  gente: { rotulo: "Custo de pessoa", ondeVer: "/financeiro/pessoas" },
  folha_declarada: { rotulo: "Folha declarada", ondeVer: "/financeiro/pessoas" },
  tributo_das: { rotulo: "Simples Nacional (DAS)", ondeVer: "/financeiro/mei" },
  documento_a_pagar: { rotulo: "Já é conta a pagar", ondeVer: "/financeiro/contas" },
  fatura_cartao: { rotulo: "Fatura de cartão", ondeVer: "/financeiro/cartoes" }
};

export async function getCustosEmpresa(): Promise<CustosEmpresa> {
  if (!isFinanceConfigured()) return vazio();

  try {
    const temClassificacao = (
      await query<{ tem: boolean }>(`SELECT to_regclass('fin_custo_empresa') IS NOT NULL AS tem`)
    )[0]?.tem;

    const joinClass = temClassificacao
      ? `LEFT JOIN fin_custo_empresa cls
              ON cls.entity_id = e.id
             AND cls.category_id = t.category_id
             AND cls.counterparty_id IS NOT DISTINCT FROM t.counterparty_id`
      : "";

    const [celulasRows, itensRows, areasItemRows, areasCatRows, camadasRows, genteRows, hojeRows, faturasRows] =
      await Promise.all([
        query<Record<string, unknown>>(
          `SELECT t.counterparty_id,
                  t.category_id,
                  to_char(t.posted_on, 'YYYY-MM') AS mes,
                  SUM(-t.amount_cents)::bigint AS cents,
                  count(*)::int AS lancamentos
             FROM fin_transaction t
             JOIN fin_category c ON c.id = t.category_id
             JOIN fin_entity e   ON e.id = t.entity_id AND e.slug = $1
            WHERE ${FILTRO_EMPRESA}
            GROUP BY 1, 2, 3
            ORDER BY 3, 4 DESC`,
          [ENTITY]
        ),
        query<Record<string, unknown>>(
          `SELECT t.counterparty_id,
                  t.category_id,
                  COALESCE(MAX(cp.name), 'Sem favorecido') AS nome,
                  c.code AS categoria_code,
                  c.name AS categoria_nome,
                  ${temClassificacao ? "MAX(cls.area)" : "NULL::text"} AS time_gravado,
                  ${temClassificacao ? "MAX(cls.bloco)" : "NULL::text"} AS bloco_gravado
             FROM fin_transaction t
             JOIN fin_category c ON c.id = t.category_id
             JOIN fin_entity e   ON e.id = t.entity_id AND e.slug = $1
             LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
             ${joinClass}
            WHERE ${FILTRO_EMPRESA}
            GROUP BY t.counterparty_id, t.category_id, c.code, c.name
            ORDER BY SUM(-t.amount_cents) DESC`,
          [ENTITY]
        ),
        temClassificacao
          ? query<{ counterparty_id: number | null; category_id: number; slug: string; nome: string }>(
              `SELECT cls.counterparty_id, cls.category_id, a.slug, a.nome
                 FROM fin_custo_empresa cls
                 JOIN fin_entity e ON e.id = cls.entity_id AND e.slug = $1
                 JOIN fin_custo_empresa_area l ON l.custo_id = cls.id
                 JOIN fin_area_empresa a ON a.id = l.area_id
                ORDER BY a.ordem, a.nome`,
              [ENTITY]
            )
          : Promise.resolve([]),
        query<{ slug: string; nome: string }>(
          `SELECT a.slug, a.nome
             FROM fin_area_empresa a
             JOIN fin_entity e ON e.id = a.entity_id AND e.slug = $1
            WHERE a.ativo
            ORDER BY a.ordem, a.nome`
        ).catch(() => [] as { slug: string; nome: string }[]),
        query<Record<string, unknown>>(
          `SELECT conflito_camada, count(*)::int AS itens,
                  COALESCE(SUM(COALESCE(valor_vigente_cents, valor_sugerido_cents, mediana_cents)), 0)::bigint AS cents
             FROM fin_custo_fixo_catalogo_v
            WHERE conflito_camada IS NOT NULL
            GROUP BY 1 ORDER BY 3 DESC`
        ).catch(() => [] as Record<string, unknown>[]),
        query<Record<string, unknown>>(
          `SELECT count(*)::int AS itens,
                  COALESCE(SUM(COALESCE(v.valor_vigente_cents, v.valor_sugerido_cents, v.mediana_cents)), 0)::bigint AS cents
             FROM fin_custo_fixo_catalogo_v v
             LEFT JOIN fin_category c ON c.id = v.category_id
            WHERE v.conflito_camada IS NULL
              AND (
                COALESCE(c.code, '') LIKE '6.%'
                OR COALESCE(c.code, '') = '4.01'
                OR ${sqlContraparteEPessoa("v.counterparty_id")}
              )`
        ).catch(() => [] as Record<string, unknown>[]),
        query<{ mes: string }>(
          `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes`
        ),
        query<{ emissor: "inter" | "nubank"; mes: string; cents: string }>(
          `SELECT CASE
                    WHEN ca.slug LIKE 'inter%' THEN 'inter'
                    ELSE 'nubank'
                  END AS emissor,
                  to_char(b.reference_month, 'YYYY-MM') AS mes,
                  SUM(b.paid_amount_cents)::bigint AS cents
             FROM fin_card_bill b
             JOIN fin_card_account ca ON ca.id = b.card_account_id
            WHERE b.reference_month >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')
              AND ca.slug IN ('inter-cartao', 'nubank-cartao')
            GROUP BY 1, 2
            ORDER BY 2, 1`
        ).catch(() => [] as { emissor: "inter" | "nubank"; mes: string; cents: string }[])
      ]);

    const areasPorItem = new Map<string, Opcao[]>();
    for (const r of areasItemRows) {
      const k = chaveCusto(r.counterparty_id, Number(r.category_id));
      const lista = areasPorItem.get(k) ?? [];
      lista.push({ slug: r.slug, nome: r.nome });
      areasPorItem.set(k, lista);
    }

    const itens: ItemCusto[] = itensRows.map((r) => {
      const counterpartyId = r.counterparty_id == null ? null : Number(r.counterparty_id);
      const categoryId = Number(r.category_id);
      const categoriaCode = String(r.categoria_code);
      return {
        counterpartyId,
        categoryId,
        nome: String(r.nome ?? "Sem favorecido"),
        categoriaCode,
        categoriaNome: String(r.categoria_nome),
        time: timeDe((r.time_gravado as string) ?? null),
        areasEmpresa: areasPorItem.get(chaveCusto(counterpartyId, categoryId)) ?? [],
        classe: classeDe(categoriaCode),
        bloco: subparteValida(r.bloco_gravado as string | null) ? (r.bloco_gravado as SubparteCusto) : null
      };
    });

    const celulas: CelulaCusto[] = celulasRows.map((r) => ({
      counterpartyId: r.counterparty_id == null ? null : Number(r.counterparty_id),
      categoryId: Number(r.category_id),
      mes: String(r.mes),
      cents: Number(r.cents),
      lancamentos: Number(r.lancamentos)
    }));

    const meses = [...new Set(celulas.map((c) => c.mes))].sort();

    const camadasExcluidas: CamadaExcluida[] = [];
    const gente = genteRows[0];
    if (gente && Number(gente.itens) > 0) {
      camadasExcluidas.push({
        camada: "gente",
        rotulo: CAMADAS.gente.rotulo,
        ondeVer: CAMADAS.gente.ondeVer,
        itens: Number(gente.itens),
        cents: Number(gente.cents)
      });
    }
    for (const r of camadasRows) {
      const slug = String(r.conflito_camada);
      const meta = CAMADAS[slug] ?? { rotulo: slug, ondeVer: "" };
      camadasExcluidas.push({
        camada: slug,
        rotulo: meta.rotulo,
        ondeVer: meta.ondeVer,
        itens: Number(r.itens),
        cents: Number(r.cents)
      });
    }

    return {
      disponivel: true,
      meses,
      mesAtual: hojeRows[0]?.mes ?? null,
      itens,
      celulas,
      times: [...TIMES],
      areasEmpresa: areasCatRows,
      camadasExcluidas,
      faturasCartao: faturasRows.map((r) => ({
        emissor: r.emissor,
        nome: r.emissor === "inter" ? "Cartão Inter" : "Cartão Nubank",
        mes: String(r.mes),
        cents: Number(r.cents)
      }))
    };
  } catch (error) {
    console.error("[financeiro] custo da empresa indisponível:", error);
    return vazio();
  }
}
