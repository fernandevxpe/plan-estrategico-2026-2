"use client";

import {
  Bar,
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
import type { CompositionChartRow } from "@/lib/analysis/mix-goal-composition";
import type { MixGoalMetric, MixGoalViewMode } from "@/lib/analysis/mix-goal-composition";
import { brl } from "@/lib/analysis/format";

type TypeMeta = {
  type: string;
  color: string;
};

type Props = {
  data: CompositionChartRow[];
  types: TypeMeta[];
  metric: MixGoalMetric;
  mode: MixGoalViewMode;
  currentMonth?: string | null;
};

function formatMetric(value: number, metric: MixGoalMetric) {
  if (metric === "revenue") return brl.format(value);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

export function MixGoalCompositionChart({ data, types, metric, mode, currentMonth }: Props) {
  const yFormatter =
    metric === "revenue"
      ? (value: number) => `${Math.round(value / 1000)}k`
      : (value: number) => String(Math.round(value));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#dce5e8" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={(props) => {
            const { x, y, payload } = props;
            const row = data.find((item) => item.label === payload.value);
            const isCurrent = row?.month === currentMonth;
            return (
              <text
                x={x}
                y={y + 12}
                textAnchor="middle"
                fill={isCurrent ? "#0f766e" : "#5b6b72"}
                fontWeight={isCurrent ? 700 : 400}
                fontSize={12}
              >
                {payload.value}
              </text>
            );
          }}
        />
        <YAxis
          yAxisId="value"
          tickFormatter={yFormatter}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="meta"
          orientation="right"
          tickFormatter={yFormatter}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          formatter={(value, name) => {
            if (name === "Meta") return [formatMetric(Number(value), metric), name];
            return [formatMetric(Number(value), metric), name];
          }}
          labelFormatter={(label, payload) => {
            const row = payload?.[0]?.payload as CompositionChartRow | undefined;
            const suffix = row?.isProjected ? " · projetado" : " · realizado";
            return `${label}${suffix}`;
          }}
        />
        <Legend />
        {types.map((item) => (
          <Bar
            key={item.type}
            yAxisId="value"
            dataKey={item.type}
            name={item.type}
            stackId="mix"
            fill={item.color}
            radius={[2, 2, 0, 0]}
          >
            {data.map((entry) => (
              <Cell
                key={`${entry.month}-${item.type}`}
                fill={item.color}
                fillOpacity={entry.isProjected ? 0.45 : 0.95}
              />
            ))}
          </Bar>
        ))}
        <Line
          yAxisId="meta"
          type="monotone"
          dataKey="meta"
          name="Meta"
          stroke="#17333a"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
