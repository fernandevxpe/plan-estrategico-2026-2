"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  MARGIN_STACK_KEYS,
  type VendasUnitEconomicsDashboard,
  toPayrollStackData,
  toStackedMarginChartData
} from "@/lib/areas/build-vendas-unit-economics";
import { brl, formatGrowth, number } from "@/lib/analysis/format";

type Props = {
  unitEconomics: VendasUnitEconomicsDashboard;
  embedded?: boolean;
};

export function VendasUnitEconomicsSection({ unitEconomics, embedded = false }: Props) {
  const [activeScenario, setActiveScenario] = useState<"one-hire" | "two-hires">("one-hire");
  const [scenarioA, scenarioB] = unitEconomics.scenarios;
  const active = activeScenario === "one-hire" ? scenarioA : scenarioB;
  const assumptions = unitEconomics.assumptions;

  const marginChartData = toStackedMarginChartData(active);
  const payrollChartData = toPayrollStackData(active);

  const marginTrend = active.months.map((row) => ({
    label: row.label,
    margemPct: Math.round(row.grossMarginPct * 10) / 10,
    cacPct: Math.round(row.acquisitionPctOfRevenue * 10) / 10,
    receita: row.revenue
  }));

  const cumulativeTrend = active.months.map((row) => ({
    label: row.label,
    receitaAcum: row.cumulativeRevenue,
    margemAcum: row.cumulativeGrossMargin,
    cacAcum: row.cumulativeAcquisition,
    cacPctAcum: row.cumulativeRevenue ? (row.cumulativeAcquisition / row.cumulativeRevenue) * 100 : 0
  }));

  return (
    <div className={`vendas-unit-economics ${embedded ? "is-embedded" : ""}`}>
      {!embedded ? (
        <section className="section-title subsection-title">
          <div>
            <h3>CAC, custos de aquisição e margem bruta</h3>
            <p>
              Imposto {assumptions.taxPct}% · SDR {brl.format(assumptions.sdr)} · Técnico{" "}
              {brl.format(assumptions.visitTechnician)} · Tráfego {brl.format(2500)}→
              {brl.format(4500)} · Gestor {brl.format(assumptions.trafficManager)} · Conteúdo{" "}
              {brl.format(assumptions.contentProduction)}
            </p>
          </div>
        </section>
      ) : (
        <p className="vendas-sync-note">
          Imposto {assumptions.taxPct}% · margem bruta comercial modelada (sem custo de entrega)
        </p>
      )}

      <div className="scenario-compare-bar">
        <button
          type="button"
          className={`scenario-compare-item ${activeScenario === "one-hire" ? "active" : "muted-item"}`}
          onClick={() => setActiveScenario("one-hire")}
        >
          Cenário A — unit economics
        </button>
        <button
          type="button"
          className={`scenario-compare-item ${activeScenario === "two-hires" ? "active" : "muted-item"}`}
          onClick={() => setActiveScenario("two-hires")}
        >
          Cenário B — unit economics
        </button>
      </div>

      <div className="guide-kpi-row">
        <div className="guide-kpi-card">
          <span className="metric-label">Receita ano</span>
          <strong>{brl.format(active.annual.revenue)}</strong>
          <small>H1 {brl.format(active.annual.h1.revenue)} · H2 {brl.format(active.annual.h2.revenue)}</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Margem bruta ano</span>
          <strong>{brl.format(active.annual.grossMargin)}</strong>
          <small>{formatGrowth(active.annual.grossMarginPct)} da receita</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">CAC / receita (ano)</span>
          <strong>{formatGrowth(active.annual.acquisitionPctOfRevenue)}</strong>
          <small>{brl.format(active.annual.acquisition.total)} em aquisição</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">CAC / fechamento</span>
          <strong>
            {active.annual.avgCacPerClosing != null ? brl.format(active.annual.avgCacPerClosing) : "—"}
          </strong>
          <small>Custo aquisição ÷ fechamentos</small>
        </div>
      </div>

      <div className="scenario-compare-grid">
        {[scenarioA, scenarioB].map((scenario) => (
          <div className="card scenario-card" key={scenario.scenarioId}>
            <div className="card-title">
              <div>
                <h2>{scenario.scenarioName}</h2>
                <span>Comparativo anual H1 + H2</span>
              </div>
            </div>
            <div className="mini-grid">
              <div className="mini">
                <span className="metric-label">Margem bruta</span>
                <strong>{brl.format(scenario.annual.grossMargin)}</strong>
                <small>{formatGrowth(scenario.annual.grossMarginPct)}</small>
              </div>
              <div className="mini">
                <span className="metric-label">H2 margem</span>
                <strong>{brl.format(scenario.annual.h2.grossMargin)}</strong>
                <small>{formatGrowth(scenario.annual.h2.grossMarginPct)}</small>
              </div>
              <div className="mini">
                <span className="metric-label">Impostos ano</span>
                <strong>{brl.format(scenario.annual.tax)}</strong>
                <small>{assumptions.taxPct}% do faturamento</small>
              </div>
              <div className="mini">
                <span className="metric-label">Folha + aquisição</span>
                <strong>{brl.format(scenario.annual.payroll + scenario.annual.acquisition.total)}</strong>
                <small>
                  {formatGrowth(
                    ((scenario.annual.payroll + scenario.annual.acquisition.total) / scenario.annual.revenue) * 100
                  )}{" "}
                  da receita
                </small>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Destino do faturamento (empilhado)</h2>
              <span>Custos + margem bruta mês a mês — {active.scenarioName}</span>
            </div>
          </div>
          <div className="chart-shell tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marginChartData} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#dce5e8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value, name) => [brl.format(Number(value)), name]}
                  labelFormatter={(label) => `Mês: ${label}`}
                />
                <Legend />
                {MARGIN_STACK_KEYS.map((item) => (
                  <Bar key={item.key} dataKey={item.key} stackId="margin" fill={item.color} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Folha comercial (fixo + comissão)</h2>
              <span>R$ 5k fixo + 10% comissão</span>
            </div>
          </div>
          <div className="chart-shell tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={payrollChartData} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#dce5e8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip formatter={(value, name) => [brl.format(Number(value)), name]} />
                <Legend />
                <Bar dataKey="Fixo" stackId="payroll" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Comissão" stackId="payroll" fill="#fb923c" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Margem bruta × CAC % da receita</h2>
              <span>Evolução mensal (%)</span>
            </div>
          </div>
          <div className="chart-shell tall">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={marginTrend} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#dce5e8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={42} />
                <Tooltip formatter={(value, name) => [`${number.format(Number(value))}%`, name]} />
                <Legend />
                <Bar dataKey="cacPct" name="CAC % receita" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="margemPct" name="Margem bruta %" stroke="#08704f" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Acumulado no ano</h2>
              <span>Receita vs margem bruta vs custo de aquisição</span>
            </div>
          </div>
          <div className="chart-shell tall">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={cumulativeTrend} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#dce5e8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => `${v}%`}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (String(name).includes("%")) return [`${number.format(Number(value))}%`, name];
                    return [brl.format(Number(value)), name];
                  }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="receitaAcum" name="Receita acum." fill="#cbd5e1" radius={[2, 2, 0, 0]} />
                <Bar yAxisId="left" dataKey="margemAcum" name="Margem acum." fill="#21a67a" radius={[2, 2, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cacPctAcum"
                  name="CAC acum. % receita"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Detalhe mensal — custos, CAC e margem</h2>
            <span>{active.scenarioName}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="payroll-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Receita</th>
                <th>Fech.</th>
                <th>Imposto</th>
                <th>Folha</th>
                <th>Aquisição</th>
                <th>CAC %</th>
                <th>CAC/fech.</th>
                <th>Margem R$</th>
                <th>Margem %</th>
              </tr>
            </thead>
            <tbody>
              {active.months.map((row) => (
                <tr key={row.month}>
                  <td>
                    <strong>{row.label}</strong>
                    <span className="metric-note">{row.period === "h1_actual" ? "real" : "proj."}</span>
                  </td>
                  <td>{brl.format(row.revenue)}</td>
                  <td>{number.format(row.wonDeals)}</td>
                  <td>{brl.format(row.tax)}</td>
                  <td>{brl.format(row.payroll)}</td>
                  <td>{brl.format(row.acquisition.total)}</td>
                  <td>{formatGrowth(row.acquisitionPctOfRevenue)}</td>
                  <td>{row.cacPerClosing != null ? brl.format(row.cacPerClosing) : "—"}</td>
                  <td className={row.grossMargin >= 0 ? "cell-positive" : "cell-negative"}>
                    {brl.format(row.grossMargin)}
                  </td>
                  <td>{formatGrowth(row.grossMarginPct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <strong>Ano</strong>
                </td>
                <td>
                  <strong>{brl.format(active.annual.revenue)}</strong>
                </td>
                <td>—</td>
                <td>
                  <strong>{brl.format(active.annual.tax)}</strong>
                </td>
                <td>
                  <strong>{brl.format(active.annual.payroll)}</strong>
                </td>
                <td>
                  <strong>{brl.format(active.annual.acquisition.total)}</strong>
                </td>
                <td>
                  <strong>{formatGrowth(active.annual.acquisitionPctOfRevenue)}</strong>
                </td>
                <td>
                  <strong>
                    {active.annual.avgCacPerClosing != null ? brl.format(active.annual.avgCacPerClosing) : "—"}
                  </strong>
                </td>
                <td>
                  <strong>{brl.format(active.annual.grossMargin)}</strong>
                </td>
                <td>
                  <strong>{formatGrowth(active.annual.grossMarginPct)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="investigation-notes">
        <div className="insight-mini">
          <span>
            <strong>Margem bruta</strong> = receita − impostos ({assumptions.taxPct}%) − folha comercial − custos de
            aquisição (SDR, técnico, tráfego, gestor, conteúdo). Não inclui custo de entrega/operacional.
          </span>
        </div>
        <div className="insight-mini">
          <span>
            <strong>Cenário A vs B (ano):</strong> margem {brl.format(scenarioA.annual.grossMargin)} (
            {formatGrowth(scenarioA.annual.grossMarginPct)}) vs {brl.format(scenarioB.annual.grossMargin)} (
            {formatGrowth(scenarioB.annual.grossMarginPct)}). CAC médio/fechamento:{" "}
            {scenarioA.annual.avgCacPerClosing != null ? brl.format(scenarioA.annual.avgCacPerClosing) : "—"} vs{" "}
            {scenarioB.annual.avgCacPerClosing != null ? brl.format(scenarioB.annual.avgCacPerClosing) : "—"}.
          </span>
        </div>
      </div>
    </div>
  );
}
