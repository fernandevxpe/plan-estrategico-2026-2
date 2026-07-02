"use client";

import { useMemo, useState } from "react";
import { BarChart3, Layers3, Target, TrendingUp } from "lucide-react";
import type { Analysis, MixGoalScope, YearFilter } from "@/lib/analysis/types";
import {
  buildScopeCompositionChartData,
  buildScopeCompositionTable,
  buildScopesCompositionRows,
  getMixGoalBaselineLabel,
  getMixGoalScopeLabel,
  getScopesCompositionSummary,
  getScopesMixShares,
  getScopeCompositionTypes,
  type MixGoalMetric,
  type MixGoalViewMode
} from "@/lib/analysis/mix-goal-composition";
import { MixGoalCompositionChart } from "@/components/mix/MixGoalCompositionChart";
import { mixColors } from "@/components/charts";
import { brl, number } from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
  year: YearFilter;
};

const ALL_SCOPES: MixGoalScope[] = ["consultoria", "obras"];

const SCOPE_OPTIONS: { id: MixGoalScope; label: string }[] = [
  { id: "consultoria", label: "Consultoria" },
  { id: "obras", label: "Obras" }
];

function scopesEqual(a: MixGoalScope[], b: MixGoalScope[]) {
  return a.length === b.length && ALL_SCOPES.every((scope) => a.includes(scope) === b.includes(scope));
}

export function MixGoalCompositionPanel({ analysis, year }: Props) {
  const [scopes, setScopes] = useState<MixGoalScope[]>(ALL_SCOPES);
  const [metric, setMetric] = useState<MixGoalMetric>("revenue");
  const [mode, setMode] = useState<MixGoalViewMode>("monthly");

  const planning = analysis.planning2026;
  const compositionRows = useMemo(
    () => buildScopesCompositionRows(analysis, scopes),
    [analysis, scopes]
  );
  const scopedRows = useMemo(
    () => (analysis.businessTypeMonthlyByScope ?? []).filter((row) => scopes.includes(row.scope)),
    [analysis.businessTypeMonthlyByScope, scopes]
  );
  const currentMonth = planning?.currentMonth ?? null;
  const baselineLabel = getMixGoalBaselineLabel(analysis, scopes);
  const scopeLabel = getMixGoalScopeLabel(scopes);

  const shares = useMemo(
    () => (currentMonth ? getScopesMixShares(scopedRows, scopes, currentMonth) : []),
    [scopedRows, scopes, currentMonth]
  );
  const scopeAvgTicket = useMemo(() => {
    const revenue = shares.reduce((acc, item) => acc + item.revenue, 0);
    const deals = shares.reduce((acc, item) => acc + item.wonDeals, 0);
    return deals ? revenue / deals : 0;
  }, [shares]);

  const summary = useMemo(
    () => getScopesCompositionSummary(planning, scopes, compositionRows),
    [planning, scopes, compositionRows]
  );

  const productTypes = useMemo(() => getScopeCompositionTypes(compositionRows), [compositionRows]);
  const typeMeta = useMemo(
    () =>
      productTypes.map((type, index) => ({
        type,
        color: mixColors[index % mixColors.length]
      })),
    [productTypes]
  );

  const chartData = useMemo(
    () => buildScopeCompositionChartData(compositionRows, metric, mode, scopeAvgTicket),
    [compositionRows, metric, mode, scopeAvgTicket]
  );

  const tableRows = useMemo(() => buildScopeCompositionTable(compositionRows), [compositionRows]);

  function toggleScope(scope: MixGoalScope) {
    setScopes((current) => {
      if (current.includes(scope)) {
        const next = current.filter((item) => item !== scope);
        return next.length ? next : current;
      }
      return [...current, scope];
    });
  }

  if (!planning || !analysis.businessTypeMonthlyByScope?.length) return null;

  const yearNote =
    year !== "all" && year !== "2026"
      ? "Esta seção usa dados e metas de 2026, independente do filtro de ano acima."
      : null;

  const bothActive = scopesEqual(scopes, ALL_SCOPES);

  return (
    <section className="mix-goal-section" aria-label="Composição por meta">
      <div className="mix-goal-header">
        <div>
          <h2>Composição por meta · 2026</h2>
          <p>
            Realizado mensal por produto e projeção do restante do ano com base na meta Pipedrive e na
            participação observada no {baselineLabel}.
          </p>
          {yearNote ? <p className="mix-goal-year-note">{yearNote}</p> : null}
        </div>
        <Target size={20} />
      </div>

      <section className="mix-goal-toolbar-simple" aria-label="Opções de visualização da composição">
        <div className="mix-goal-toolbar-group">
          <span className="filter-label">Meta</span>
          <div className="mix-segmented">
            <button
              type="button"
              className={bothActive ? "active" : ""}
              onClick={() => setScopes(ALL_SCOPES)}
            >
              Ambos
            </button>
            {SCOPE_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={scopes.includes(item.id) ? "active" : ""}
                onClick={() => toggleScope(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mix-goal-toolbar-group">
          <span className="filter-label">Medida</span>
          <div className="mix-segmented">
            <button
              type="button"
              className={metric === "revenue" ? "active" : ""}
              onClick={() => setMetric("revenue")}
            >
              R$
            </button>
            <button
              type="button"
              className={metric === "deals" ? "active" : ""}
              onClick={() => setMetric("deals")}
            >
              Qtd
            </button>
          </div>
        </div>

        <div className="mix-goal-toolbar-group">
          <span className="filter-label">Visão</span>
          <div className="mix-segmented">
            <button
              type="button"
              className={mode === "monthly" ? "active" : ""}
              onClick={() => setMode("monthly")}
            >
              Mensal
            </button>
            <button
              type="button"
              className={mode === "accumulated" ? "active" : ""}
              onClick={() => setMode("accumulated")}
            >
              Acumulado
            </button>
          </div>
        </div>
      </section>

      <div className="mix-goal-kpis">
        <article className="card mix-goal-kpi">
          <span>Meta anual</span>
          <strong>{brl.format(summary.annualTarget)}</strong>
        </article>
        <article className="card mix-goal-kpi">
          <span>Realizado YTD</span>
          <strong>{brl.format(summary.realizedYtd)}</strong>
        </article>
        <article className="card mix-goal-kpi">
          <span>Projeção ano</span>
          <strong>{brl.format(summary.projectedYearEnd)}</strong>
        </article>
        <article className={`card mix-goal-kpi ${summary.gapToTarget > 0 ? "tone-warn" : "tone-good"}`}>
          <span>Gap vs meta</span>
          <strong>{brl.format(summary.gapToTarget)}</strong>
        </article>
      </div>

      <div className="card chart-card mix-goal-chart-card">
        <div className="card-title">
          <div>
            <h3>
              {scopeLabel} · {metric === "revenue" ? "receita" : "quantidade"} ·{" "}
              {mode === "monthly" ? "mensal" : "acumulado"}
            </h3>
            <span>
              Barras = composição por produto · linha = meta {mode === "monthly" ? "mensal" : "acumulada"}
            </span>
          </div>
          <BarChart3 size={18} />
        </div>
        <div className="mix-goal-chart-wrap">
          <MixGoalCompositionChart
            data={chartData}
            types={typeMeta}
            metric={metric}
            mode={mode}
            currentMonth={currentMonth}
          />
        </div>
      </div>

      <div className="card mix-goal-table-card">
        <div className="card-title">
          <div>
            <h3>Detalhe mês × produto</h3>
            <span>Valores {metric === "revenue" ? "em R$" : "em quantidade"} por mês e participação no mix</span>
          </div>
          <Layers3 size={18} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Status</th>
                <th className="right">Meta</th>
                <th className="right">Total</th>
                {productTypes.map((type) => (
                  <th key={type} className="right">
                    {type}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.month} className={row.isProjected ? "mix-goal-row-projected" : ""}>
                  <td>
                    <strong>{row.label}</strong>
                  </td>
                  <td>{row.isProjected ? "Projetado" : "Realizado"}</td>
                  <td className="right">{row.metaTarget != null ? brl.format(row.metaTarget) : "—"}</td>
                  <td className="right">
                    {metric === "revenue" ? brl.format(row.totalRevenue) : number.format(row.totalDeals)}
                  </td>
                  {row.products.map((product) => (
                    <td key={`${row.month}-${product.type}`} className="right">
                      {metric === "revenue" ? (
                        <>
                          {brl.format(product.revenue)}
                          <span className="muted mix-goal-mix-pct"> · {number.format(product.mixPct)}%</span>
                        </>
                      ) : (
                        <>
                          {number.format(product.deals)}
                          <span className="muted mix-goal-mix-pct"> · {number.format(product.mixPct)}%</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mix-goal-shares card compact-card">
        <div className="card-title">
          <div>
            <h3>Mix base para projeção</h3>
            <span>Participação por produto no {baselineLabel}</span>
          </div>
          <TrendingUp size={18} />
        </div>
        <div className="mix-goal-share-chips">
          {shares.map((item, index) => (
            <span key={item.type} className="mix-goal-share-chip">
              <i style={{ background: mixColors[index % mixColors.length] }} />
              {item.type}: {number.format(item.revenueShare * 100)}% receita · {number.format(item.dealsShare * 100)}% qtd
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
