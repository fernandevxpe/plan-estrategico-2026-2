"use client";

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
import { Clock3, GitBranch, Layers3, PieChart, Users } from "lucide-react";
import type { Analysis } from "@/lib/analysis/types";
import {
  brl,
  formatGrowth,
  monthLabel,
  NEW_DEALS_CONVERSION_SHORT
} from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
};

export function DeepAnalysisSection({ analysis }: Props) {
  const deep = analysis.deepAnalysis;
  const timeChart = deep.timeToClose.byMonth.map((row) => ({
    label: monthLabel(row.month),
    averageDays: Math.round(row.averageDays),
    medianDays: row.medianDays == null ? null : Math.round(row.medianDays),
    revenue: row.revenue
  }));

  const originChart = deep.revenueOrigin.byMonth.map((row) => ({
    label: monthLabel(row.month),
    newRevenue: row.newRevenue,
    repeatRevenue: row.repeatRevenue
  }));

  const openStages = deep.funnelByStage.open.slice(0, 10);
  const lostStages = deep.funnelByStage.lost.slice(0, 10);

  return (
    <section className="deep-analysis" id="investigacao">
      <div className="section-title">
        <div>
          <h2>Investigação comercial</h2>
          <p>O que acelerou, o que travou e o que repetir — com dados reais do Pipedrive.</p>
        </div>
      </div>

      <div className="investigation-notes">
        {deep.investigationNotes.map((note) => (
          <div className="mini insight-mini" key={note.title}>
            <strong>{note.title}</strong>
            <span>{note.body}</span>
          </div>
        ))}
      </div>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Tempo até fechar</h2>
              <span>Dias entre criação e ganho do negócio</span>
            </div>
            <Clock3 size={18} />
          </div>
          <div className="mini-grid summary-inline">
            <div className="mini">
              <span className="metric-label">Média geral</span>
              <strong>{deep.timeToClose.overallAverageDays == null ? "—" : `${Math.round(deep.timeToClose.overallAverageDays)} dias`}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Mais rápido</span>
              <strong>
                {deep.timeToClose.fastestMonth
                  ? `${monthLabel(deep.timeToClose.fastestMonth.month)} (${Math.round(deep.timeToClose.fastestMonth.averageDays)}d)`
                  : "—"}
              </strong>
            </div>
            <div className="mini">
              <span className="metric-label">Pico de receita</span>
              <strong>
                {deep.timeToClose.peakRevenueMonth
                  ? `${monthLabel(deep.timeToClose.peakRevenueMonth)} (${Math.round(deep.timeToClose.peakRevenueCycleDays ?? 0)}d)`
                  : "—"}
              </strong>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeChart} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#dce5e8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis yAxisId="days" tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="money" orientation="right" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(value, name) => [name === "Receita" ? brl.format(Number(value)) : `${value} dias`, name]} />
                <Legend />
                <Bar yAxisId="days" dataKey="averageDays" name="Média dias" fill="#2368a0" radius={[4, 4, 0, 0]} />
                <Line yAxisId="money" type="monotone" dataKey="revenue" name="Receita" stroke="#21a67a" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Origem do faturamento</h2>
              <span>Cliente novo vs recorrente por mês</span>
            </div>
            <Users size={18} />
          </div>
          <div className="mini-grid summary-inline">
            <div className="mini">
              <span className="metric-label">Novos clientes</span>
              <strong>{brl.format(deep.revenueOrigin.totals.newRevenue)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Recorrentes</span>
              <strong>{brl.format(deep.revenueOrigin.totals.repeatRevenue)}</strong>
            </div>
            <div className="mini">
              <span className="metric-label">Share novos</span>
              <strong>{formatGrowth(deep.revenueOrigin.totals.newSharePct)}</strong>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={originChart} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#dce5e8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => brl.format(Number(value))} />
                <Legend />
                <Bar dataKey="newRevenue" name="Novos" stackId="a" fill="#21a67a" />
                <Bar dataKey="repeatRevenue" name="Recorrentes" stackId="a" fill="#2368a0" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Funil por etapa — abertos</h2>
              <span>Onde os negócios estão parados agora</span>
            </div>
            <GitBranch size={18} />
          </div>
          <StageTable rows={openStages} />
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Funil por etapa — perdidos</h2>
              <span>Etapas com maior perda no período</span>
            </div>
            <GitBranch size={18} />
          </div>
          <StageTable rows={lostStages} />
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Mix dos meses de pico</h2>
              <span>Combinações de tipos que mais faturaram</span>
            </div>
            <PieChart size={18} />
          </div>
          {deep.peakMix.patterns.map((pattern) => (
            <div className="service-row" key={pattern.month}>
              <div className="service-header">
                <strong>{monthLabel(pattern.month)}</strong>
                <span className="pill green">{pattern.headline}</span>
              </div>
              <p className="metric-note">{pattern.insight}</p>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Tipos com melhor média</h2>
              <span>Benchmark para repetir nos próximos ciclos</span>
            </div>
            <Layers3 size={18} />
          </div>
          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="right">Receita média/mês</th>
                  <th className="right">Meses ativos</th>
                </tr>
              </thead>
              <tbody>
                {deep.peakMix.benchmarkTypes.map((row) => (
                  <tr key={row.type}>
                    <td>{row.type}</td>
                    <td className="right">{brl.format(row.averageRevenue)}</td>
                    <td className="right">{row.monthsActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h3>Detalhe do mix nos top 3 meses</h3>
        </div>
      </section>

      {deep.peakMix.peaks.map((peak) => (
        <div className="table-wrap compact peak-mix-table" key={peak.month}>
          <table>
            <thead>
              <tr>
                <th colSpan={4}>{monthLabel(peak.month)} — {brl.format(peak.revenue)}</th>
              </tr>
              <tr>
                <th>Tipo</th>
                <th className="right">Receita</th>
                <th className="right">Fechados</th>
                <th className="right">Share</th>
              </tr>
            </thead>
            <tbody>
              {peak.types.map((row) => (
                <tr key={row.type}>
                  <td>{row.type}</td>
                  <td className="right">{brl.format(row.revenue)}</td>
                  <td className="right">{row.wonDeals}</td>
                  <td className="right">{formatGrowth(row.sharePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <section className="section-title subsection-title">
        <div>
          <h3>Tabela completa — origem e ciclo por mês</h3>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th className="right">Novos R$</th>
              <th className="right">Recorrente R$</th>
              <th className="right">Share novos</th>
              <th className="right">Dias p/ fechar</th>
              <th className="right">{NEW_DEALS_CONVERSION_SHORT}</th>
            </tr>
          </thead>
          <tbody>
            {deep.revenueOrigin.byMonth.map((row) => {
              const cycle = deep.timeToClose.byMonth.find((item) => item.month === row.month);
              const funnel = analysis.commercialFunnel.find((item) => item.month === row.month);
              return (
                <tr key={row.month}>
                  <td><strong>{monthLabel(row.month)}</strong></td>
                  <td className="right">{brl.format(row.newRevenue)}</td>
                  <td className="right">{brl.format(row.repeatRevenue)}</td>
                  <td className="right">{formatGrowth(row.newSharePct)}</td>
                  <td className="right">{cycle ? `${Math.round(cycle.averageDays)}d` : "—"}</td>
                  <td className="right">{formatGrowth(funnel?.cohortConversionPct ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StageTable({ rows }: { rows: Analysis["deepAnalysis"]["funnelByStage"]["open"] }) {
  if (!rows.length) {
    return <p className="metric-note">Sem dados para este recorte.</p>;
  }

  return (
    <div className="table-wrap compact">
      <table>
        <thead>
          <tr>
            <th>Funil</th>
            <th>Etapa</th>
            <th className="right">Negócios</th>
            <th className="right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.pipelineId}-${row.stageId}`}>
              <td className="muted">{row.pipeline}</td>
              <td><strong>{row.stage}</strong></td>
              <td className="right">{row.deals}</td>
              <td className="right">{brl.format(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
