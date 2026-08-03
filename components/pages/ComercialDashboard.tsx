"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Target,
  TrendingUp
} from "lucide-react";
import type { Analysis, CommercialFunnel } from "@/lib/analysis/types";
import { getExecutiveKpis, getPlanning } from "@/lib/analysis/metrics";
import { brl, formatGrowth, monthLabel, NEW_DEALS_CONVERSION_SHORT, number } from "@/lib/analysis/format";
import { RevenueChart, YearComparisonChart } from "@/components/charts";

type Props = {
  analysis: Analysis;
};

type SortKey =
  | "month"
  | "createdDeals"
  | "createdValue"
  | "cohortConversionPct"
  | "matureConversionPct"
  | "closedConversionPct"
  | "wonDeals"
  | "wonValue"
  | "openBaseDealsEndOfMonth";

type YearScope = "2026" | "2025" | "all";

function weightedAverage(rows: { value: number; weight: number }[]) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight ? rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight : null;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown size={12} />;
  return dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

function Kpi({
  label,
  value,
  note
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <article className="comercial-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

export function ComercialDashboard({ analysis }: Props) {
  const planning = getPlanning(analysis);
  const globalGoal = planning?.highlights.global ?? null;
  const kpis = useMemo(() => getExecutiveKpis(analysis, "Realista recomendado"), [analysis]);
  const funnel2026 = useMemo(
    () => analysis.commercialFunnel.filter((row) => row.month.startsWith("2026")),
    [analysis.commercialFunnel]
  );
  const latest = funnel2026.at(-1) ?? null;
  const matureConversion = useMemo(
    () =>
      weightedAverage(
        funnel2026
          .filter((row) => row.isMatureCohort && row.matureConversionPct != null)
          .map((row) => ({ value: row.matureConversionPct ?? 0, weight: row.createdDeals }))
      ),
    [funnel2026]
  );
  const closedConversion = useMemo(
    () =>
      weightedAverage(
        funnel2026
          .filter((row) => row.closedConversionPct != null)
          .map((row) => ({
            value: row.closedConversionPct ?? 0,
            weight: row.closedDealsFromCohort ?? 0
          }))
      ),
    [funnel2026]
  );
  const avgTicketYtd =
    kpis.wonDeals2026Ytd > 0 ? kpis.revenue2026Ytd / kpis.wonDeals2026Ytd : null;
  const metaElapsed = globalGoal?.elapsedTarget ?? null;
  const metaAttainment =
    metaElapsed && metaElapsed > 0 ? (kpis.revenue2026Ytd / metaElapsed) * 100 : null;

  const chartData = useMemo(
    () =>
      analysis.monthly
        .filter((item) => item.month.startsWith("2026"))
        .map((item) => ({
          ...item,
          label: monthLabel(item.month),
          revenueK: Math.round(item.wonRevenue / 1000)
        })),
    [analysis.monthly]
  );
  const growthRows = analysis.growthComparison;

  const [yearScope, setYearScope] = useState<YearScope>("2026");
  const [sortKey, setSortKey] = useState<SortKey>("month");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState(false);

  const tableRows = useMemo(() => {
    let rows = analysis.commercialFunnel;
    if (yearScope !== "all") rows = rows.filter((row) => row.month.startsWith(yearScope));
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number" ? av : av == null ? -Infinity : String(av);
      const bn = typeof bv === "number" ? bv : bv == null ? -Infinity : String(bv);
      if (an < bn) return sortDir === "asc" ? -1 : 1;
      if (an > bn) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [analysis.commercialFunnel, yearScope, sortKey, sortDir]);

  const visibleRows = expanded ? tableRows : tableRows.slice(0, 8);

  const bestByColumn = useMemo(() => {
    const best: Partial<Record<SortKey, number>> = {};
    for (const key of [
      "createdDeals",
      "createdValue",
      "cohortConversionPct",
      "matureConversionPct",
      "closedConversionPct",
      "wonDeals",
      "wonValue",
      "openBaseDealsEndOfMonth"
    ] as SortKey[]) {
      let max = -Infinity;
      for (const row of tableRows) {
        const value = row[key];
        if (typeof value === "number" && Number.isFinite(value) && value > max) max = value;
      }
      if (Number.isFinite(max) && max > -Infinity) best[key] = max;
    }
    return best;
  }, [tableRows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "month" ? "desc" : "desc");
  }

  function isBest(row: CommercialFunnel, key: SortKey) {
    const value = row[key];
    return typeof value === "number" && bestByColumn[key] === value;
  }

  function SortableTh({ label, column }: { label: string; column: SortKey }) {
    return (
      <th className="right">
        <button type="button" className="comercial-sort-btn" onClick={() => toggleSort(column)}>
          {label}
          <SortIcon active={sortKey === column} dir={sortDir} />
        </button>
      </th>
    );
  }

  return (
    <section className="comercial-page">
      <header className="comercial-header">
        <div>
          <h1>Comercial</h1>
          <p>Meta, realizado e projeção do ritmo de vendas. Operação do time fica em Vendas.</p>
        </div>
        <Link className="comercial-director-link" href="/areas/vendas">
          Abrir Vendas
          <ArrowRight size={16} />
        </Link>
      </header>

      <section className="comercial-kpi-grid" aria-label="Indicadores comerciais">
        <Kpi
          label="Realizado YTD"
          value={brl.format(kpis.revenue2026Ytd)}
          note={`${number.format(kpis.wonDeals2026Ytd)} ganhos`}
        />
        <Kpi
          label="Meta acumulada"
          value={metaElapsed != null ? brl.format(metaElapsed) : "—"}
          note={metaAttainment != null ? `${number.format(metaAttainment)}% da meta` : "Meta Global Pipedrive"}
        />
        <Kpi
          label="Projetado 2026"
          value={brl.format(kpis.projected2026Total)}
          note={`H2 ${brl.format(kpis.projected2026H2)}`}
        />
        <Kpi
          label="Conv. fechados"
          value={formatGrowth(closedConversion)}
          note="Ganhos / (ganhos + perdidos)"
        />
        <Kpi
          label="Base aberta"
          value={String(latest?.openBaseDealsEndOfMonth ?? 0)}
          note={brl.format(latest?.openBaseValueEndOfMonth ?? 0)}
        />
        <Kpi
          label="Conv. madura"
          value={formatGrowth(matureConversion)}
          note="Coortes com 45+ dias"
        />
        <Kpi
          label={`Novos · ${latest ? monthLabel(latest.month) : "mês"}`}
          value={String(latest?.createdDeals ?? 0)}
          note={avgTicketYtd != null ? `Ticket YTD ${brl.format(avgTicketYtd)}` : brl.format(latest?.createdValue ?? 0)}
        />
        <Kpi
          label={`Ganhos · ${latest ? monthLabel(latest.month) : "mês"}`}
          value={String(latest?.wonDeals ?? 0)}
          note={brl.format(latest?.wonValue ?? 0)}
        />
      </section>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Receita, novos e fechamentos</h2>
              <span>2026 mês a mês</span>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="chart-box">
            <RevenueChart data={chartData} />
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>2025 × 2026</h2>
              <span>Receita realizada por mês</span>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="chart-box">
            <YearComparisonChart data={growthRows} />
          </div>
        </div>
      </section>

      <article className="card comercial-table-card">
        <div className="comercial-table-toolbar">
          <div>
            <h2>Mensal do funil</h2>
            <p>Ordene pelas colunas. Melhores valores do recorte ficam destacados.</p>
          </div>
          <div className="comercial-table-actions">
            <div className="filter-toggle" role="group" aria-label="Ano">
              {(["2026", "2025", "all"] as YearScope[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={yearScope === item ? "active" : ""}
                  onClick={() => setYearScope(item)}
                >
                  {item === "all" ? "Todos" : item}
                </button>
              ))}
            </div>
            <button type="button" className="comercial-expand-btn" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Encolher" : `Expandir (${tableRows.length})`}
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="comercial-funnel-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="comercial-sort-btn is-left" onClick={() => toggleSort("month")}>
                    Mês
                    <SortIcon active={sortKey === "month"} dir={sortDir} />
                  </button>
                </th>
                <SortableTh label="Novos" column="createdDeals" />
                <SortableTh label="Valor criado" column="createdValue" />
                <SortableTh label={NEW_DEALS_CONVERSION_SHORT} column="cohortConversionPct" />
                <SortableTh label="Conv. madura" column="matureConversionPct" />
                <SortableTh label="Conv. fechados" column="closedConversionPct" />
                <SortableTh label="Ganhos" column="wonDeals" />
                <SortableTh label="Receita" column="wonValue" />
                <SortableTh label="Base aberta" column="openBaseDealsEndOfMonth" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((item) => (
                <tr key={item.month}>
                  <td>
                    <strong>{item.month}</strong>
                  </td>
                  <td className={`right ${isBest(item, "createdDeals") ? "is-best" : ""}`}>
                    {item.createdDeals}
                  </td>
                  <td className={`right ${isBest(item, "createdValue") ? "is-best" : ""}`}>
                    {brl.format(item.createdValue)}
                  </td>
                  <td className={`right ${isBest(item, "cohortConversionPct") ? "is-best" : ""}`}>
                    {formatGrowth(item.cohortConversionPct)}
                  </td>
                  <td className={`right ${isBest(item, "matureConversionPct") ? "is-best" : ""}`}>
                    {item.isMatureCohort ? formatGrowth(item.matureConversionPct ?? null) : "Coorte nova"}
                  </td>
                  <td className={`right ${isBest(item, "closedConversionPct") ? "is-best" : ""}`}>
                    {formatGrowth(item.closedConversionPct ?? null)}
                  </td>
                  <td className={`right ${isBest(item, "wonDeals") ? "is-best" : ""}`}>{item.wonDeals}</td>
                  <td className={`right ${isBest(item, "wonValue") ? "is-best" : ""}`}>
                    {brl.format(item.wonValue)}
                  </td>
                  <td className={`right ${isBest(item, "openBaseDealsEndOfMonth") ? "is-best" : ""}`}>
                    {item.openBaseDealsEndOfMonth}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!expanded && tableRows.length > visibleRows.length ? (
          <p className="comercial-table-hint">
            Mostrando {visibleRows.length} de {tableRows.length} meses ·{" "}
            <button type="button" className="linkish" onClick={() => setExpanded(true)}>
              ver todos
            </button>
          </p>
        ) : null}
      </article>

      <p className="comercial-footnote">
        <Target size={14} /> Conv. fechados = ganhos / (ganhos + perdidos). Para canais, perdas, ciclo e
        reuniões por vendedor, use{" "}
        <Link href="/areas/vendas">Vendas</Link>.
      </p>
    </section>
  );
}
