"use client";

import {
  Area,
  AreaChart,
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

type MonthlyChartItem = {
  label: string;
  createdDeals: number;
  wonDeals: number;
  wonRevenue: number;
  averageTicket: number;
};

type ServiceItem = {
  service: string;
  revenue: number;
  wonDeals: number;
};

type GrowthComparisonItem = {
  label: string;
  revenue2025: number | null;
  revenue2026: number | null;
  created2025: number | null;
  created2026: number | null;
  wonDeals2025: number | null;
  wonDeals2026: number | null;
};

type ProjectionMonthItem = {
  label: string;
  baselineRevenue2025: number;
  runRateRevenue: number;
  seasonalRevenue: number;
  projectedRevenue: number;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

const colors = ["#21a67a", "#2368a0", "#b67818", "#0f766e"];

export function RevenueChart({ data }: { data: MonthlyChartItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="money"
          tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis yAxisId="count" orientation="right" tickLine={false} axisLine={false} width={34} />
        <Tooltip
          formatter={(value, name) => {
            if (name === "Receita") return [brl.format(Number(value)), name];
            return [Number(value).toLocaleString("pt-BR"), name];
          }}
          labelFormatter={(label) => `Mês: ${label}`}
        />
        <Legend />
        <Area
          yAxisId="money"
          type="monotone"
          dataKey="wonRevenue"
          name="Receita"
          fill="#21a67a"
          fillOpacity={0.16}
          stroke="#21a67a"
          strokeWidth={3}
        />
        <Bar yAxisId="count" dataKey="createdDeals" name="Novos negócios" fill="#2368a0" radius={[4, 4, 0, 0]} />
        <Line yAxisId="count" type="monotone" dataKey="wonDeals" name="Fechados" stroke="#b67818" strokeWidth={3} dot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ServiceMixChart({ data }: { data: ServiceItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="revenue"
          nameKey="service"
          innerRadius="52%"
          outerRadius="82%"
          paddingAngle={3}
        >
          {data.map((entry, index) => (
            <Cell key={entry.service} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => brl.format(Number(value))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TicketChart({ data }: { data: MonthlyChartItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value) => brl.format(Number(value))} labelFormatter={(label) => `Mês: ${label}`} />
        <Bar dataKey="averageTicket" name="Ticket médio" fill="#0f766e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function YearComparisonChart({ data }: { data: GrowthComparisonItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value, name) => [brl.format(Number(value)), name]} />
        <Legend />
        <Bar dataKey="revenue2025" name="Receita 2025" fill="#9fb2bd" radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="revenue2026" name="Receita 2026" stroke="#21a67a" strokeWidth={3} dot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ProjectionChart({ data }: { data: ProjectionMonthItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value, name) => [brl.format(Number(value)), name]} />
        <Legend />
        <Bar dataKey="baselineRevenue2025" name="2025 realizado" fill="#9fb2bd" radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="runRateRevenue" name="Ritmo atual" stroke="#2368a0" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="projectedRevenue" name="Base ponderada" stroke="#21a67a" strokeWidth={3} dot={{ r: 4 }} />
        <Line type="monotone" dataKey="seasonalRevenue" name="Sazonal 2025" stroke="#b67818" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
