"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ChartWithLegend, useLegendToggle } from "@/components/charts/useLegendToggle";
import type {
  CommercialBreakdownRow,
  CommercialPeriodKind,
  CommercialRevenueGoal,
  CommercialSellerMonitoring
} from "@/lib/analysis/types";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  rows: CommercialSellerMonitoring[];
};

const PERIOD_LABELS: Record<CommercialPeriodKind, string> = {
  week: "Semanal",
  month: "Mensal",
  quarter: "Trimestral",
  semester: "Semestral",
  year: "Anual"
};

function pct(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function number(value: number | null, suffix = "") {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function Breakdown({ rows, value = false }: { rows: CommercialBreakdownRow[]; value?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="payroll-table commercial-breakdown-table">
        <thead>
          <tr><th>Classificação</th><th>{value ? "Valor" : "Negócios"}</th><th>Part.</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{value ? brl.format(row.value) : row.deals}</td>
              <td>{pct(row.sharePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevenueGoalCard({ label, goal, featured = false }: { label: string; goal: CommercialRevenueGoal; featured?: boolean }) {
  const progress = Math.max(0, Math.min(100, goal.attainmentPct ?? 0));
  return (
    <div className={`seller-goal-card ${featured ? "is-featured" : ""}`}>
      <div className="seller-goal-card-header"><span>{label}</span><strong>{pct(goal.attainmentPct)}</strong></div>
      <div className="seller-goal-values"><strong>{brl.format(goal.actual)}</strong><span>de {brl.format(goal.target)}</span></div>
      <div className="seller-goal-progress"><span style={{ width: `${progress}%` }} /></div>
      <small>{goal.gap >= 0 ? `${brl.format(goal.gap)} acima da meta` : `${brl.format(Math.abs(goal.gap))} para a meta`}</small>
    </div>
  );
}

export function VendasSellerMonitoring({ rows }: Props) {
  const [seller, setSeller] = useState<CommercialSellerMonitoring["seller"]>("TIME");
  const [kind, setKind] = useState<CommercialPeriodKind>("month");
  const salesLegend = useLegendToggle();
  const activityLegend = useLegendToggle();
  const salesSeries = useMemo(
    () => [
      { dataKey: "consultoria", name: "Consultoria", color: "#6d28d9", type: "square" as const },
      { dataKey: "obras", name: "Obras", color: "#0f766e", type: "square" as const },
      { dataKey: "metaTotal", name: "Meta total", color: "#dc2626", type: "line" as const }
    ],
    []
  );
  const activitySeries = useMemo(
    () => [
      { dataKey: "atividades", name: "Atividades/sem.", color: "#d97706", type: "square" as const },
      { dataKey: "metaAtividade", name: "Meta atividade", color: "#7c3aed", type: "line" as const },
      { dataKey: "conversao", name: "Conversão", color: "#16a34a", type: "line" as const }
    ],
    []
  );
  const periodOptions = useMemo(
    () => rows.filter((row) => row.seller === "TIME" && row.periodKind === kind).reverse(),
    [rows, kind]
  );
  const [selectedByKind, setSelectedByKind] = useState<Partial<Record<CommercialPeriodKind, string>>>({});
  const selectedPeriodId = selectedByKind[kind] ?? periodOptions[0]?.periodId ?? "";
  const selected = rows.find((row) => row.seller === seller && row.periodId === selectedPeriodId);
  const comparisons = rows.filter(
    (row) => row.periodId === selectedPeriodId && ["GABRIEL", "IGOR"].includes(row.seller)
  );
  const trend = rows
    .filter((row) => row.seller === seller && row.periodKind === kind)
    .slice(kind === "week" ? -12 : 0);
  const chartTrend = trend.map((item) => ({
    period: item.periodLabel,
    consultoria: item.revenueGoals.consulting.actual,
    obras: item.revenueGoals.works.actual,
    metaTotal: item.revenueGoals.total.target,
    atividades: item.activity.weeklyAverage,
    metaAtividade: item.activity.weeklyTarget,
    conversao: item.conversion.closedConversionPct
  }));

  if (!selected) return null;

  return (
    <section className="seller-monitoring">
      <div className="seller-monitoring-header">
        <div>
          <span className="metric-label">Monitor por vendedor e período</span>
          <h3>{selected.seller === "TIME" ? "Time comercial" : selected.seller} · {selected.periodLabel}</h3>
          <p>{selected.isPartial ? "Período parcial" : "Período fechado"} · atividade baseada no que foi concluído e vinculado no Pipedrive</p>
        </div>
        <div className="seller-monitoring-filters">
          <label>
            <span>Vendedor</span>
            <select value={seller} onChange={(event) => setSeller(event.target.value as CommercialSellerMonitoring["seller"])}>
              <option value="TIME">Time</option>
              <option value="GABRIEL">Gabriel</option>
              <option value="IGOR">Igor</option>
            </select>
          </label>
          <label>
            <span>Visão</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as CommercialPeriodKind)}>
              {Object.entries(PERIOD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>Período</span>
            <select
              value={selectedPeriodId}
              onChange={(event) => setSelectedByKind((current) => ({ ...current, [kind]: event.target.value }))}
            >
              {periodOptions.map((period) => (
                <option value={period.periodId} key={period.periodId}>{period.periodLabel}{period.isPartial ? " (parcial)" : ""}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="seller-goals-title">
        <div><span className="metric-label">Monitoramento da meta financeira</span><strong>Vendas ganhas no período</strong></div>
        <small>{selected.revenueGoals.allocation === "company" ? "Meta oficial do time" : "Meta individual = 50% da meta oficial do time"}</small>
      </div>
      <div className="seller-revenue-goals">
        <RevenueGoalCard label="Consultoria" goal={selected.revenueGoals.consulting} />
        <RevenueGoalCard label="Obras" goal={selected.revenueGoals.works} />
        <RevenueGoalCard label="Total" goal={selected.revenueGoals.total} featured />
      </div>

      <div className="commercial-monthly-kpis seller-monitoring-kpis">
        <div className="mini"><span className="metric-label">Carteira no corte</span><strong>{brl.format(selected.open.value)}</strong><small>{selected.open.deals} negócios</small></div>
        <div className="mini"><span className="metric-label">Ganhos no período</span><strong>{selected.won.deals}</strong><small>{brl.format(selected.won.value)}</small></div>
        <div className="mini"><span className="metric-label">Perdidos no período</span><strong>{selected.lost.deals}</strong><small>{brl.format(selected.lost.value)}</small></div>
        <div className="mini"><span className="metric-label">Conversão dos encerrados</span><strong>{pct(selected.conversion.closedConversionPct)}</strong><small>{selected.conversion.closedDeals} decisões</small></div>
        <div className="mini"><span className="metric-label">Ticket médio</span><strong>{brl.format(selected.won.averageTicket)}</strong><small>negócios ganhos</small></div>
        <div className="mini"><span className="metric-label">Ciclo médio</span><strong>{number(selected.cycle.averageDays, " dias")}</strong><small>mediana {number(selected.cycle.medianDays, " dias")}</small></div>
        <div className="mini"><span className="metric-label">Atividades concluídas</span><strong>{selected.activity.completed}</strong><small>{number(selected.activity.weeklyAverage)} por semana</small></div>
        <div className="mini"><span className="metric-label">Atingimento registrado</span><strong>{pct(selected.activity.attainmentPct)}</strong><small>meta cadastrada: {selected.activity.weeklyTarget}/semana</small></div>
      </div>

      <div className="seller-activity-strip">
        <div><span>Propostas</span><strong>{selected.activity.proposals}</strong></div>
        <div><span>Reuniões/assembleias</span><strong>{selected.activity.meetings}</strong></div>
        <div><span>Visitas/diagnósticos</span><strong>{selected.activity.visits}</strong></div>
        <div><span>Produtos na carteira</span><strong>{pct(selected.open.products.coveragePct)}</strong></div>
      </div>
      {selected.activity.meetings === 0 && selected.activity.visits === 0 ? (
        <p className="seller-monitoring-warning">O CRM registra propostas, mas não registra reuniões/assembleias e visitas concluídas neste recorte. O atingimento de atividade é parcial.</p>
      ) : null}

      <div className="seller-comparison-grid">
        {comparisons.map((item) => (
          <div className={`seller-comparison-card ${item.seller === seller ? "is-selected" : ""}`} key={item.seller}>
            <strong>{item.seller}</strong>
            <span>{brl.format(item.open.value)} em aberto</span>
            <span>{item.won.deals} ganhos · {item.lost.deals} perdidos</span>
            <span>{pct(item.conversion.closedConversionPct)} conversão · {brl.format(item.won.averageTicket)} ticket</span>
            <span>{brl.format(item.revenueGoals.total.actual)} / {brl.format(item.revenueGoals.total.target)} · {pct(item.revenueGoals.total.attainmentPct)} da meta</span>
            <span>{item.activity.completed} atividades · {number(item.activity.weeklyAverage)}/sem.</span>
          </div>
        ))}
      </div>

      <div className="seller-charts-grid">
        <div className="seller-chart-card">
          <div className="seller-chart-heading">
            <strong>Vendas × meta</strong>
            <span>Consultoria e Obras empilhadas · meta total do período</span>
          </div>
          <div className="seller-chart-box">
            <ChartWithLegend series={salesSeries} hidden={salesLegend.hidden} onToggle={salesLegend.toggle} wrapperStyle={{ fontSize: 11 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartTrend} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={18} />
                  <YAxis tickFormatter={compactMoney} tick={{ fontSize: 10 }} width={48} />
                  <Tooltip formatter={(value, name) => [brl.format(Number(value)), name]} />
                  <Bar dataKey="consultoria" name="Consultoria" stackId="sales" fill="#6d28d9" radius={[3, 3, 0, 0]} hide={salesLegend.isHidden("consultoria")} />
                  <Bar dataKey="obras" name="Obras" stackId="sales" fill="#0f766e" radius={[3, 3, 0, 0]} hide={salesLegend.isHidden("obras")} />
                  <Line dataKey="metaTotal" name="Meta total" stroke="#dc2626" strokeWidth={2.2} dot={{ r: 2 }} hide={salesLegend.isHidden("metaTotal")} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartWithLegend>
          </div>
        </div>

        <div className="seller-chart-card">
          <div className="seller-chart-heading">
            <strong>Atividade × conversão</strong>
            <span>Média semanal registrada e conversão dos negócios encerrados</span>
          </div>
          <div className="seller-chart-box">
            <ChartWithLegend series={activitySeries} hidden={activityLegend.hidden} onToggle={activityLegend.toggle} wrapperStyle={{ fontSize: 11 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartTrend} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={18} />
                  <YAxis yAxisId="activity" tick={{ fontSize: 10 }} width={34} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} width={38} />
                  <Tooltip
                    formatter={(value, name) => [
                      name === "Conversão" ? pct(Number(value)) : number(Number(value)),
                      name
                    ]}
                  />
                  <Bar yAxisId="activity" dataKey="atividades" name="Atividades/sem." fill="#d97706" radius={[3, 3, 0, 0]} hide={activityLegend.isHidden("atividades")} />
                  <Line yAxisId="activity" dataKey="metaAtividade" name="Meta atividade" stroke="#7c3aed" strokeWidth={2} dot={false} hide={activityLegend.isHidden("metaAtividade")} />
                  <Line yAxisId="pct" dataKey="conversao" name="Conversão" stroke="#16a34a" strokeWidth={2.2} connectNulls dot={{ r: 2 }} hide={activityLegend.isHidden("conversao")} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartWithLegend>
          </div>
        </div>
      </div>

      <div className="vendas-details-grid seller-monitoring-details">
        <VendasInlineDetails title={`Evolução ${PERIOD_LABELS[kind].toLowerCase()}`} defaultOpen>
          <div className="table-wrap">
            <table className="payroll-table seller-trend-table">
              <thead><tr><th>Período</th><th>Consultoria</th><th>% meta</th><th>Obras</th><th>% meta</th><th>Total</th><th>% meta</th><th>Ativ./sem.</th></tr></thead>
              <tbody>
                {trend.map((item) => (
                  <tr key={item.periodId} className={item.periodId === selectedPeriodId ? "is-current" : ""}>
                    <td>{item.periodLabel}{item.isPartial ? " *" : ""}</td>
                    <td>{brl.format(item.revenueGoals.consulting.actual)}</td><td>{pct(item.revenueGoals.consulting.attainmentPct)}</td>
                    <td>{brl.format(item.revenueGoals.works.actual)}</td><td>{pct(item.revenueGoals.works.attainmentPct)}</td>
                    <td>{brl.format(item.revenueGoals.total.actual)}</td><td>{pct(item.revenueGoals.total.attainmentPct)}</td>
                    <td>{number(item.activity.weeklyAverage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VendasInlineDetails>
        <VendasInlineDetails title="Carteira por etapa" defaultOpen><Breakdown rows={selected.open.stages} value /></VendasInlineDetails>
        <VendasInlineDetails title="Carteira por canal"><Breakdown rows={selected.open.channels} value /></VendasInlineDetails>
        <VendasInlineDetails title="Ganhos por canal"><Breakdown rows={selected.won.channels} /></VendasInlineDetails>
        <VendasInlineDetails title="Perdas por motivo" defaultOpen><Breakdown rows={selected.lost.reasons} /></VendasInlineDetails>
        <VendasInlineDetails title="Qualidade da carteira">
          <ul className="vendas-compact-list">
            <li>{selected.open.withoutValue} negócios sem valor.</li>
            <li>{selected.open.withoutChannel} negócios sem canal.</li>
            <li>{selected.open.withoutSeller} negócios sem vendedor Gabriel/Igor.</li>
            <li>{selected.cycle.invalidDates} ganhos excluídos do ciclo por datas inválidas.</li>
            <li>{selected.open.products.catalogMismatchLines} linhas usam produtos fora do catálogo atual.</li>
          </ul>
        </VendasInlineDetails>
      </div>
    </section>
  );
}
