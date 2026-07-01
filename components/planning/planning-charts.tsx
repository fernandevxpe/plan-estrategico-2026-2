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
import type { BridgeItem, GoalPlan, QuarterlySeriesItem, Timeline2026Item } from "@/lib/analysis/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

const count = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function formatGoalValue(value: number, unit: GoalPlan["unit"]) {
  return unit === "currency" ? brl.format(value) : count.format(value);
}

const monthShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function intervalLabel(goal: GoalPlan, start: string) {
  const [, rawMonth] = start.split("-");
  const monthIndex = Number(rawMonth) - 1;
  if (goal.interval === "quarterly") return `T${Math.floor(monthIndex / 3) + 1}`;
  if (goal.interval === "weekly") return start.slice(5);
  return monthShort[monthIndex] ?? start;
}

/** Meta x realizado por intervalo (mês/trimestre) de uma meta específica do Pipedrive. */
export function GoalProgressChart({ goal, currentMonth }: { goal: GoalPlan; currentMonth: string }) {
  const data = goal.intervals.map((interval) => {
    const isFuture = (interval.monthKey ?? "0000-00") > currentMonth;
    return {
      label: intervalLabel(goal, interval.start),
      target: interval.target,
      realized: isFuture ? null : interval.realized ?? 0
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={(value) =>
            goal.unit === "currency" ? `${Math.round(Number(value) / 1000)}k` : count.format(Number(value))
          }
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          formatter={(value, name) => [value == null ? "—" : formatGoalValue(Number(value), goal.unit), name]}
        />
        <Legend />
        <Bar dataKey="realized" name="Realizado" fill="#2368a0" radius={[4, 4, 0, 0]} />
        <Line
          type="monotone"
          dataKey="target"
          name="Meta"
          stroke="#b67818"
          strokeWidth={3}
          strokeDasharray="6 4"
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Acumulado realizado x meta acumulada ao longo do ano. */
export function GoalCumulativeChart({ goal, currentMonth }: { goal: GoalPlan; currentMonth: string }) {
  let cumTarget = 0;
  let cumRealized = 0;
  const data = goal.intervals.map((interval) => {
    const isFuture = (interval.monthKey ?? "0000-00") > currentMonth;
    cumTarget += interval.target;
    if (!isFuture) cumRealized += interval.realized ?? 0;
    return {
      label: intervalLabel(goal, interval.start),
      metaAcum: cumTarget,
      realizadoAcum: isFuture ? null : cumRealized
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={(value) =>
            goal.unit === "currency" ? `${Math.round(Number(value) / 1000)}k` : count.format(Number(value))
          }
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          formatter={(value, name) => [value == null ? "—" : formatGoalValue(Number(value), goal.unit), name]}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="metaAcum"
          name="Meta acumulada"
          stroke="#b67818"
          strokeWidth={3}
          strokeDasharray="6 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="realizadoAcum"
          name="Realizado acumulado"
          stroke="#21a67a"
          strokeWidth={3}
          connectNulls
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

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
