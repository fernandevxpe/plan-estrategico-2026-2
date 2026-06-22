"use client";

import { Award, Lightbulb, Repeat2, TrendingUp, Trophy } from "lucide-react";
import type { Analysis } from "@/lib/analysis/types";
import {
  brl,
  formatGrowth,
  formatIndicatorValue,
  monthLabel,
  NEW_DEALS_CONVERSION_SHORT
} from "@/lib/analysis/format";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type Props = {
  analysis: Analysis;
};

export function IndicatorAnalysisSection({ analysis }: Props) {
  const highlights = analysis.indicatorHighlights;
  const recordCards = highlights.metricRecords.filter((item) => item.recordValue != null);

  const yoyChartData = highlights.yoyImprovements
    .filter((item) => item.metric === "revenueYoY")
    .slice(0, 6)
    .map((item) => ({
      label: item.label,
      changePct: item.changePct
    }));

  return (
    <section className="indicator-analysis">
      <div className="section-title">
        <div>
          <h2>Análise detalhada de indicadores</h2>
          <p>
            Recordes históricos, melhorias YoY e picos por tipo de venda — baseado nos dados reais do Pipedrive.
          </p>
        </div>
        <span className="pill green">
          {highlights.summary.recordsIn2026} recordes em 2026
        </span>
      </div>

      <div className="kpi-grid kpi-grid-records">
        {recordCards.map((record) => (
          <article className="card kpi-card record-card" key={record.metric}>
            <div className="card-title">
              <span>{record.metricLabel}</span>
              <Trophy size={18} />
            </div>
            <p className="metric">{formatIndicatorValue(record.recordValue ?? 0, record.unit)}</p>
            <p className="metric-note">
              Recorde em {record.recordMonth ? monthLabel(record.recordMonth) : "—"}
              {record.recordMonth?.startsWith("2026") ? " · 2026" : ""}
            </p>
          </article>
        ))}
      </div>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-title">
            <div>
              <h2>Melhorias YoY de receita</h2>
              <span>Meses em que 2026 superou 2025 no mesmo mês</span>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="chart-box">
            {yoyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yoyChartData} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke="#dce5e8" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={48} />
                  <Tooltip formatter={(v) => formatGrowth(Number(v))} />
                  <Bar dataKey="changePct" name="YoY receita" fill="#21a67a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="metric-note">Sem dados YoY disponíveis.</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Top 5 meses por receita</h2>
              <span>O que convergiu nos melhores meses</span>
            </div>
            <Award size={18} />
          </div>
          {highlights.topMonthsByRevenue.map((item, index) => (
            <div className="service-row" key={item.month}>
              <div className="service-header">
                <strong>#{index + 1} {monthLabel(item.month)}</strong>
                <span className="pill green">{brl.format(item.revenue)}</span>
              </div>
              <div className="mini-grid">
                <div className="mini">
                  <span className="metric-label">Fechados</span>
                  <strong>{item.wonDeals}</strong>
                </div>
                <div className="mini">
                  <span className="metric-label">Novos negócios</span>
                  <strong>{item.createdDeals}</strong>
                </div>
                <div className="mini">
                  <span className="metric-label">Ticket</span>
                  <strong>{brl.format(item.averageTicket)}</strong>
                </div>
                <div className="mini">
                  <span className="metric-label">{NEW_DEALS_CONVERSION_SHORT}</span>
                  <strong>{formatGrowth(item.cohortConversionPct)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-title">
        <div>
          <h2>Linha do tempo de recordes</h2>
          <p>Cada linha marca quando um indicador superou o melhor resultado anterior.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Indicador</th>
              <th className="right">Novo recorde</th>
              <th className="right">Anterior</th>
              <th>Mês anterior</th>
            </tr>
          </thead>
          <tbody>
            {highlights.recordTimeline.map((event) => (
              <tr key={`${event.month}-${event.metric}`} className={event.month.startsWith("2026") ? "row-highlight-2026" : ""}>
                <td><strong>{monthLabel(event.month)}</strong></td>
                <td>{event.metricLabel}</td>
                <td className="right"><strong>{formatIndicatorValue(event.value, event.unit)}</strong></td>
                <td className="right">
                  {event.previousBest == null ? "—" : formatIndicatorValue(event.previousBest, event.unit)}
                </td>
                <td className="muted">
                  {event.previousBestMonth ? monthLabel(event.previousBestMonth) : "Primeiro recorde"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title">
        <div>
          <h2>Picos por tipo de negócio</h2>
          <p>Melhor mês de receita para cada etiqueta comercial.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Melhor mês</th>
              <th className="right">Receita</th>
              <th className="right">Fechados</th>
              <th className="right">Ticket</th>
            </tr>
          </thead>
          <tbody>
            {highlights.typePeaks.slice(0, 20).map((item) => (
              <tr key={item.type}>
                <td><strong>{item.type}</strong></td>
                <td>{monthLabel(item.month)}</td>
                <td className="right">{brl.format(item.revenue)}</td>
                <td className="right">{item.wonDeals}</td>
                <td className="right">{brl.format(item.averageTicket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title">
        <div>
          <h2>Melhorias ano a ano</h2>
          <p>Onde 2026 evoluiu vs o mesmo mês de 2025.</p>
        </div>
      </section>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Indicador</th>
              <th className="right">2025</th>
              <th className="right">2026</th>
              <th className="right">Variação</th>
            </tr>
          </thead>
          <tbody>
            {highlights.yoyImprovements.slice(0, 24).map((item) => (
              <tr key={`${item.month}-${item.metric}`}>
                <td><strong>{item.label}</strong></td>
                <td>{item.metricLabel}</td>
                <td className="right">{item.value2025 ?? "—"}</td>
                <td className="right">{item.value2026 ?? "—"}</td>
                <td className="right"><strong>{formatGrowth(item.changePct)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="insights indicator-recommendations">
        {highlights.recommendations.map((item) => (
          <div className="card insight" key={item.title}>
            {item.kind === "repeat" ? <Repeat2 size={24} /> : <Lightbulb size={24} />}
            <div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          </div>
        ))}
      </section>
    </section>
  );
}
