"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CommercialFunnelScope, CommercialPlanningByScope } from "@/lib/analysis/types";
import { brl, number } from "@/lib/analysis/format";

const SCOPE_LABELS: Record<CommercialFunnelScope, string> = {
  collective: "Coletivo",
  consultoria: "Consultoria",
  obras: "Obras"
};

function CurrencyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong><ul>{payload.filter((item) => item.value != null).map((item) => <li key={item.name} style={{ color: item.color }}>{item.name}: {brl.format(Number(item.value))}</li>)}</ul></div>;
}

function CountTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong><ul>{payload.filter((item) => item.value != null).map((item) => <li key={item.name} style={{ color: item.color }}>{item.name}: {number.format(Number(item.value))}</li>)}</ul></div>;
}

export function CommercialPlanningForecastPanel({ data }: { data: CommercialPlanningByScope | undefined }) {
  const [scope, setScope] = useState<CommercialFunnelScope>("collective");
  if (!data?.[scope]?.length) return null;
  const rows = data[scope];
  const ticket = rows[0]?.averageTicketYtd ?? 0;
  const basis = rows.some((row) => row.forecastBasis === "seasonal") ? "sazonalidade de 2025 ajustada ao ritmo de 2026" : "ritmo médio de 2026";

  return <article className="card span-2 commercial-planning-forecast-panel">
    <div className="funnel-stage-head">
      <div>
        <h3>Meta, realizado e forecast mensal</h3>
        <p className="chart-caption">Forecast por {basis}. A meta é referência; o gap compara a previsão final com a meta do Pipedrive.</p>
      </div>
      <div className="funnel-pipeline-toggle" role="group" aria-label="Escopo do acompanhamento mensal">
        {(Object.keys(SCOPE_LABELS) as CommercialFunnelScope[]).map((item) => <button key={item} type="button" className={`goal-preset-btn ${scope === item ? "is-active" : ""}`} onClick={() => setScope(item)}>{SCOPE_LABELS[item]}</button>)}
      </div>
    </div>
    <div className="forecast-ticket-note">Ticket médio acumulado de 2026: <strong>{brl.format(ticket)}</strong> · a meta em quantidade é derivada desse ticket.</div>
    <div className="chart-grid commercial-forecast-chart-grid">
      <section>
        <h4>Valor mensal (R$)</h4>
        <div className="chart-box commercial-forecast-chart">
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#dce5e8" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} /><Tooltip content={<CurrencyTooltip />} /><Legend />
            <Bar dataKey="targetRevenue" name="Meta" fill="#9fb2bd" radius={[4, 4, 0, 0]} /><Bar dataKey="actualRevenue" name="Realizado" fill="#2368a0" radius={[4, 4, 0, 0]} /><Line dataKey="forecastRevenue" name="Forecast final" type="monotone" stroke="#21a67a" strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart></ResponsiveContainer>
        </div>
      </section>
      <section>
        <h4>Fechamentos mensais</h4>
        <div className="chart-box commercial-forecast-chart">
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#dce5e8" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} /><Tooltip content={<CountTooltip />} /><Legend />
            <Bar dataKey="targetWonDeals" name="Meta equivalente" fill="#9fb2bd" radius={[4, 4, 0, 0]} /><Bar dataKey="actualWonDeals" name="Realizado" fill="#2368a0" radius={[4, 4, 0, 0]} /><Line dataKey="forecastWonDeals" name="Forecast final" type="monotone" stroke="#21a67a" strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart></ResponsiveContainer>
        </div>
      </section>
    </div>
    <div className="table-wrap"><table className="planning-goal-table commercial-forecast-table"><thead><tr><th>Mês</th><th>Status</th><th className="num">Meta R$</th><th className="num">Realizado R$</th><th className="num">Forecast R$</th><th className="num">Gap R$</th><th className="num">Meta qtd</th><th className="num">Realizado qtd</th><th className="num">Forecast qtd</th><th className="num">Gap qtd</th></tr></thead><tbody>{rows.map((row) => {
      const status = row.kind === "actual" ? "Realizado" : row.kind === "current" ? "Parcial + forecast" : "Forecast sazonal";
      const tone = (row.gapRevenue ?? 0) >= 0 ? "is-positive" : "is-negative";
      return <tr key={row.month} className={row.kind === "current" ? "is-current" : ""}><td>{row.label}</td><td><span className={`forecast-status ${row.kind}`}>{status}</span></td><td className="num">{brl.format(row.targetRevenue)}</td><td className="num">{row.actualRevenue == null ? "—" : brl.format(row.actualRevenue)}</td><td className="num">{row.forecastRevenue == null ? "—" : brl.format(row.forecastRevenue)}</td><td className={`num ${tone}`}>{row.gapRevenue == null ? "—" : brl.format(row.gapRevenue)}</td><td className="num">{number.format(row.targetWonDeals)}</td><td className="num">{row.actualWonDeals == null ? "—" : number.format(row.actualWonDeals)}</td><td className="num">{row.forecastWonDeals == null ? "—" : number.format(row.forecastWonDeals)}</td><td className={`num ${tone}`}>{row.gapWonDeals == null ? "—" : number.format(row.gapWonDeals)}</td></tr>;
    })}</tbody></table></div>
  </article>;
}
