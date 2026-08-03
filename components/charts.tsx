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
import { chartTheme, mixColors } from "@/lib/chart-theme";

export { mixColors };

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

type MixChartItem = {
  month: string;
  label: string;
  totalRevenue: number;
  [key: string]: string | number;
};

type MixTypeMeta = {
  type: string;
  color: string;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

const colors = [chartTheme.green, chartTheme.purple, chartTheme.amber, chartTheme.teal];

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
        <Bar yAxisId="count" dataKey="createdDeals" name="Novos negócios" fill={chartTheme.purple} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
        <Line yAxisId="count" type="monotone" dataKey="wonDeals" name="Fechados" stroke={chartTheme.amber} strokeWidth={3} dot={{ r: 4 }} />
        <Area
          yAxisId="money"
          type="monotone"
          dataKey="wonRevenue"
          name="Receita"
          fill={chartTheme.green}
          fillOpacity={0.14}
          stroke={chartTheme.green}
          strokeWidth={3}
          dot={{ r: 5, fill: chartTheme.green, stroke: "#fff", strokeWidth: 2 }}
          activeDot={{ r: 7 }}
        />
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
        <Bar dataKey="revenue2025" name="Receita 2025" fill={chartTheme.slate} radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="revenue2026" name="Receita 2026" stroke={chartTheme.green} strokeWidth={3} dot={{ r: 4 }} />
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
        <Bar dataKey="baselineRevenue2025" name="2025 realizado" fill={chartTheme.slate} radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="runRateRevenue" name="Ritmo atual" stroke={chartTheme.purple} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="projectedRevenue" name="Base ponderada" stroke={chartTheme.green} strokeWidth={3} dot={{ r: 4 }} />
        <Line type="monotone" dataKey="seasonalRevenue" name="Sazonal 2025" stroke={chartTheme.amber} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StackedRevenueMixChart({
  data,
  types,
  selectedMonth,
  onSelectMonth
}: {
  data: MixChartItem[];
  types: MixTypeMeta[];
  selectedMonth: string | null;
  onSelectMonth?: (month: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 12, right: 18, left: 4, bottom: 0 }}
        onClick={(event) => {
          const month = event?.activePayload?.[0]?.payload?.month;
          if (month) onSelectMonth?.(month);
        }}
      >
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          formatter={(value, name) => [brl.format(Number(value)), name]}
          labelFormatter={(label) => `Mês: ${label}`}
        />
        <Legend />
        {types.map((item) => (
          <Bar
            key={item.type}
            dataKey={item.type}
            name={item.type}
            stackId="revenue"
            fill={item.color}
            stroke={selectedMonth ? "rgba(23,33,38,0.18)" : undefined}
            strokeWidth={selectedMonth ? 1 : 0}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueShareMixChart({
  data,
  types,
  onSelectMonth
}: {
  data: MixChartItem[];
  types: MixTypeMeta[];
  onSelectMonth?: (month: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 12, right: 18, left: 4, bottom: 0 }}
        stackOffset="expand"
        onClick={(event) => {
          const month = event?.activePayload?.[0]?.payload?.month;
          if (month) onSelectMonth?.(month);
        }}
      >
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`}
          tickLine={false}
          axisLine={false}
          width={42}
        />
        <Tooltip
          formatter={(value, name, payload) => {
            const rawValue = Number(payload.payload[name as string] ?? 0);
            const total = Number(payload.payload.totalRevenue ?? 0);
            const share = total ? (rawValue / total) * 100 : 0;
            return [`${share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · ${brl.format(rawValue)}`, name];
          }}
          labelFormatter={(label) => `Mês: ${label}`}
        />
        <Legend />
        {types.map((item) => (
          <Bar key={item.type} dataKey={item.type} name={item.type} stackId="share" fill={item.color} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
