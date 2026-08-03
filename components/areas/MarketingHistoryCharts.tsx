"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { MarketingHistoryPoint } from "@/lib/areas/marketing-history";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");

type SparkProps = {
  data: MarketingHistoryPoint[];
  height?: number;
};

/** Mini gráfico compacto para cards de anúncio. */
export function MarketingHistorySparkline({ data, height = 72 }: SparkProps) {
  if (data.length < 2) {
    return <div className="marketing-spark-empty">Sem série histórica</div>;
  }

  return (
    <div className="marketing-spark" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <Area
            type="monotone"
            dataKey="spend"
            fill="#ede9fe"
            stroke="none"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="outboundClicks"
            stroke="#2563eb"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="conversations"
            stroke="#16a34a"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type DetailChartProps = {
  data: MarketingHistoryPoint[];
  height?: number;
};

/** Histórico completo: investimento + cliques + conversas. */
export function MarketingHistoryChart({ data, height = 280 }: DetailChartProps) {
  if (!data.length) {
    return <div className="marketing-empty">Sem histórico diário para este item.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="label"
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#e2e8f0" }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          yAxisId="money"
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickFormatter={(v) => (Number(v) >= 1000 ? `R$${Math.round(Number(v) / 1000)}k` : `R$${Math.round(Number(v))}`)}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            fontSize: 12
          }}
          labelFormatter={(_, payload) => {
            const date = payload?.[0]?.payload?.date;
            return date
              ? new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR")
              : "";
          }}
          formatter={(value, name) => {
            const n = Number(value);
            if (name === "Investimento") return [money(n), name];
            return [integer(n), String(name)];
          }}
        />
        <Bar
          yAxisId="money"
          dataKey="spend"
          name="Investimento"
          fill="#6d28d9"
          fillOpacity={0.85}
          radius={[3, 3, 0, 0]}
          maxBarSize={16}
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="outboundClicks"
          name="Cliques externos"
          stroke="#2563eb"
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="clicks"
          name="Cliques"
          stroke="#64748b"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="conversations"
          name="Conversas"
          stroke="#16a34a"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
