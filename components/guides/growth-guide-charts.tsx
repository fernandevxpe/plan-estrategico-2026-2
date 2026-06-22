"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { GrowthGuideMonthTarget } from "@/lib/analysis/types";
import { NEW_DEALS_CONVERSION_SHORT } from "@/lib/analysis/format";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

export type GuideChartRow = {
  label: string;
  month: string;
  revenue: number;
  contracts: number;
  newDeals: number;
  adSpend: number;
  cumulative: number;
  closingsPerCommercial: number;
  projectsPerProjectista: number;
  conversionPct: number;
  costPerClosing: number | null;
  semester: "H1" | "H2";
};

export function buildGuideChartData(plan: GrowthGuideMonthTarget[]): GuideChartRow[] {
  return plan.map((row) => ({
    label: row.label,
    month: row.month,
    revenue: row.revenueTarget,
    contracts: row.wonDealsTarget,
    newDeals: row.createdDealsTarget,
    adSpend: row.adSpend,
    cumulative: row.cumulativeRevenue,
    closingsPerCommercial: row.perCommercial.closings,
    projectsPerProjectista: row.perProjectista.activeProjects,
    conversionPct: row.conversionTargetPct,
    costPerClosing: row.costPerClosing,
    semester: row.month <= "2026-06" ? "H1" : "H2"
  }));
}

export function GuideRevenueChart({ data }: { data: GuideChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis yAxisId="money" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} width={44} />
        <YAxis yAxisId="cum" orientation="right" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          formatter={(value, name) => {
            if (name === "Acumulado") return [brl.format(Number(value)), name];
            if (name === "Receita") return [brl.format(Number(value)), name];
            return [value, name];
          }}
        />
        <Legend />
        <Bar yAxisId="money" dataKey="revenue" name="Receita" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.month} fill={entry.semester === "H1" ? "#2368a0" : "#21a67a"} />
          ))}
        </Bar>
        <Line yAxisId="cum" type="monotone" dataKey="cumulative" name="Acumulado" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GuideContractsChart({ data }: { data: GuideChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis yAxisId="count" tickLine={false} axisLine={false} width={36} />
        <YAxis yAxisId="people" orientation="right" tickLine={false} axisLine={false} width={36} />
        <Tooltip formatter={(value, name) => [Number(value).toFixed(1), name]} />
        <Legend />
        <Bar yAxisId="count" dataKey="contracts" name="Contratos fechados" fill="#2368a0" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="count" dataKey="newDeals" name="Novos negócios" fill="#b67818" radius={[4, 4, 0, 0]} />
        <Line yAxisId="people" type="monotone" dataKey="projectsPerProjectista" name="Proj./projetista" stroke="#21a67a" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GuideCommercialChart({ data }: { data: GuideChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis yAxisId="closings" tickLine={false} axisLine={false} width={36} />
        <YAxis yAxisId="pct" orientation="right" tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          formatter={(value, name) => {
            if (name === NEW_DEALS_CONVERSION_SHORT) return [`${Number(value).toFixed(1)}%`, name];
            return [Number(value).toFixed(1), name];
          }}
        />
        <Legend />
        <Bar yAxisId="closings" dataKey="closingsPerCommercial" name="Fech./comercial" fill="#2368a0" radius={[4, 4, 0, 0]} />
        <Line yAxisId="pct" type="monotone" dataKey="conversionPct" name={NEW_DEALS_CONVERSION_SHORT} stroke="#21a67a" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GuideTrafficChart({ data }: { data: GuideChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis yAxisId="ad" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} width={40} />
        <YAxis yAxisId="cpa" orientation="right" tickFormatter={(v) => `${Math.round(Number(v))}`} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          formatter={(value, name) => {
            if (name === "Tráfego") return [brl.format(Number(value)), name];
            if (name === "CPA") return [brl.format(Number(value)), name];
            return [value, name];
          }}
        />
        <Legend />
        <Bar yAxisId="ad" dataKey="adSpend" name="Tráfego" fill="#b67818" radius={[4, 4, 0, 0]} />
        <Line yAxisId="cpa" type="monotone" dataKey="costPerClosing" name="CPA" stroke="#2368a0" strokeWidth={2} connectNulls dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GuideProjectsByTypeChart({
  data,
  topTypes
}: {
  data: GrowthGuideMonthTarget[];
  topTypes: string[];
}) {
  const chartData = data.map((row) => {
    const entry: Record<string, number | string> = { label: row.label };
    for (const type of topTypes) {
      const short = type.split(" - ")[0] ?? type;
      const match = row.workloadByType.find((item) => item.type === type);
      entry[short] = match?.projects ?? 0;
    }
    return entry;
  });

  const colors = ["#2368a0", "#21a67a", "#b67818", "#0f766e", "#64727a"];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <Tooltip formatter={(value) => Number(value).toFixed(1)} />
        <Legend />
        {topTypes.map((type, index) => (
          <Bar
            key={type}
            dataKey={type.split(" - ")[0] ?? type}
            stackId="types"
            fill={colors[index % colors.length]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
