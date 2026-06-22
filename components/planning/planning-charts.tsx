"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { BridgeItem, QuarterlySeriesItem, Timeline2026Item } from "@/lib/analysis/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

const colors = ["#21a67a", "#2368a0", "#b67818", "#0f766e", "#64727a"];

export function AnnualBridgeChart({ data }: { data: BridgeItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value) => brl.format(Number(value))} />
        <Bar dataKey="value" name="Receita" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.label}
              fill={entry.type === "total" ? "#21a67a" : entry.type === "base" ? "#9fb2bd" : "#2368a0"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function QuarterlyChart({ data }: { data: QuarterlySeriesItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value, name) => [brl.format(Number(value)), name]} />
        <Legend />
        <Bar dataKey="revenue2025" name="2025 realizado" fill="#9fb2bd" radius={[4, 4, 0, 0]} />
        <Bar dataKey="revenue2026" name="2026 realizado" fill="#2368a0" radius={[4, 4, 0, 0]} />
        <Line
          type="monotone"
          dataKey="revenue2026Projected"
          name="2026 projetado"
          stroke="#21a67a"
          strokeWidth={3}
          strokeDasharray="6 4"
          dot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function Timeline2026Chart({ data }: { data: Timeline2026Item[] }) {
  const chartData = data.map((item) => ({
    label: item.label,
    actual: item.kind === "projected" ? null : item.revenue,
    projected: item.kind === "projected" ? item.projectedRevenue : item.projectedRevenue ?? null,
    combined:
      item.kind === "projected"
        ? item.projectedRevenue ?? 0
        : item.kind === "partial"
          ? item.revenue
          : item.revenue
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value, name) => [value == null ? "—" : brl.format(Number(value)), name]} />
        <Legend />
        <Bar dataKey="actual" name="Realizado" fill="#2368a0" radius={[4, 4, 0, 0]} />
        <Line
          type="monotone"
          dataKey="projected"
          name="Projetado"
          stroke="#21a67a"
          strokeWidth={3}
          strokeDasharray="6 4"
          connectNulls
          dot={{ r: 4 }}
        />
        <Line type="monotone" dataKey="combined" name="Linha 2026" stroke="#0f766e" strokeWidth={2} connectNulls dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthMixChart({ data }: { data: { name: string; revenue: number }[] }) {
  if (!data.length) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="revenue" nameKey="name" innerRadius="45%" outerRadius="78%" paddingAngle={2}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => brl.format(Number(value))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
