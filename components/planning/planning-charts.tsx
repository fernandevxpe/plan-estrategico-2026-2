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
import {
  buildGoalCompareRows,
  goalShortTitle,
  GOAL_COMPARE_COLORS,
  type GoalCompareRow
} from "@/lib/analysis/metrics";

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

export type GoalCompareMode = "attainment" | "values" | "accumulated";

/** Várias metas no mesmo gráfico — meta (tracejado) + realizado (sólido) por item. */
export function GoalsCompareChart({
  goals,
  mode,
  currentMonth
}: {
  goals: GoalPlan[];
  mode: GoalCompareMode;
  currentMonth: string;
}) {
  const data = buildGoalCompareRows(goals, currentMonth);
  const showConversion =
    mode === "values" && data.some((row) => row.conversionPct != null);

  const unit = goals[0]?.unit ?? "currency";

  const yFormatter =
    mode === "attainment"
      ? (value: number) => `${Math.round(value)}%`
      : (value: number) =>
          unit === "currency" ? `${Math.round(value / 1000)}k` : count.format(value);

  return (
    <div className="goals-compare-chart-wrap">
      <div className="goals-compare-legend-key" aria-hidden>
        <span>
          <svg width="28" height="10" viewBox="0 0 28 10">
            <line x1="0" y1="5" x2="28" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" />
          </svg>
          meta (planejado)
        </span>
        <span>
          <svg width="28" height="10" viewBox="0 0 28 10">
            <line x1="0" y1="5" x2="28" y2="5" stroke="currentColor" strokeWidth="2.5" />
          </svg>
          realizado (executado)
        </span>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: showConversion ? 52 : 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#dce5e8" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="left"
            tickFormatter={(value) => yFormatter(Number(value))}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          {showConversion ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(value) => `${Math.round(Number(value))}%`}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={[0, "auto"]}
            />
          ) : null}
          <Tooltip content={<GoalsCompareTooltip goals={goals} mode={mode} />} />
          <Legend content={<GoalsCompareLegend goals={goals} mode={mode} />} />

          {mode === "attainment" ? (
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="metaRef"
              name="Referência 100%"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={false}
              legendType="none"
            />
          ) : null}

          {goals.flatMap((goal, index) => {
            const prefix = `g${index}`;
            const color = GOAL_COMPARE_COLORS[index % GOAL_COMPARE_COLORS.length];
            const short = goalShortTitle(goal);

            if (mode === "attainment") {
              return [
                <Line
                  key={`${goal.id}-attainment`}
                  yAxisId="left"
                  type="monotone"
                  dataKey={`attainment_${prefix}`}
                  name={`${short} · realizado`}
                  stroke={color}
                  strokeWidth={2.5}
                  connectNulls
                  dot={{ r: 3, fill: color }}
                />
              ];
            }

            const targetKey = mode === "accumulated" ? `cumTarget_${prefix}` : `target_${prefix}`;
            const realizedKey = mode === "accumulated" ? `cumRealized_${prefix}` : `realized_${prefix}`;

            return [
              <Line
                key={`${goal.id}-target`}
                yAxisId="left"
                type="monotone"
                dataKey={targetKey}
                name={`${short} · meta`}
                stroke={color}
                strokeWidth={2}
                strokeDasharray="6 4"
                strokeOpacity={0.8}
                dot={false}
                legendType="line"
              />,
              <Line
                key={`${goal.id}-realized`}
                yAxisId="left"
                type="monotone"
                dataKey={realizedKey}
                name={`${short} · realizado`}
                stroke={color}
                strokeWidth={2.5}
                connectNulls
                dot={{ r: 3, fill: color }}
              />
            ];
          })}

          {showConversion ? (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="conversionPct"
              name="Conversão Global/Potencial"
              stroke="#7c3aed"
              strokeWidth={2}
              strokeDasharray="4 3"
              connectNulls
              dot={{ r: 2 }}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GoalsCompareLegend({
  goals,
  mode
}: {
  goals: GoalPlan[];
  mode: GoalCompareMode;
}) {
  return (
    <div className="goals-compare-legend">
      {goals.map((goal, index) => {
        const color = GOAL_COMPARE_COLORS[index % GOAL_COMPARE_COLORS.length];
        const short = goalShortTitle(goal);
        return (
          <div key={goal.id} className="goals-compare-legend-item">
            <span className="goals-compare-legend-color" style={{ background: color }} />
            <span className="goals-compare-legend-label">{short}</span>
            {mode === "attainment" ? (
              <span className="goals-compare-legend-types">% realizado</span>
            ) : (
              <span className="goals-compare-legend-types">
                <span className="is-meta">meta</span>
                <span className="is-real">real.</span>
              </span>
            )}
          </div>
        );
      })}
      {mode === "attainment" ? (
        <div className="goals-compare-legend-item is-reference">
          <span className="goals-compare-legend-line meta-line" />
          <span className="goals-compare-legend-label">Referência</span>
          <span className="goals-compare-legend-types">100% meta</span>
        </div>
      ) : null}
    </div>
  );
}

function GoalsCompareTooltip({
  active,
  payload,
  label,
  goals,
  mode
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string; name?: string; payload?: GoalCompareRow }>;
  label?: string;
  goals: GoalPlan[];
  mode: GoalCompareMode;
}) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as GoalCompareRow | undefined;
  if (!row) return null;

  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <ul>
        {goals.map((goal, index) => {
          const prefix = `g${index}`;
          const color = GOAL_COMPARE_COLORS[index % GOAL_COMPARE_COLORS.length];
          const realized = row[`realized_${prefix}`] as number | null;
          const target = row[`target_${prefix}`] as number;
          const attainment = row[`attainment_${prefix}`] as number | null;
          const cumTarget = row[`cumTarget_${prefix}`] as number;
          const cumRealized = row[`cumRealized_${prefix}`] as number | null;

          if (mode === "attainment") {
            return (
              <li key={goal.id} style={{ color }}>
                <span>{goalShortTitle(goal)}</span>:{" "}
                {attainment != null ? `${attainment.toFixed(1)}% da meta` : "—"}
              </li>
            );
          }

          if (mode === "accumulated") {
            return (
              <li key={goal.id} style={{ color }}>
                <span>{goalShortTitle(goal)}</span>
                <span className="chart-tooltip-sub">
                  {" "}
                  meta {formatGoalValue(cumTarget, goal.unit)} · real.{" "}
                  {cumRealized != null ? formatGoalValue(cumRealized, goal.unit) : "—"}
                </span>
              </li>
            );
          }

          return (
            <li key={goal.id} style={{ color }}>
              <span>{goalShortTitle(goal)}</span>
              <span className="chart-tooltip-sub">
                {" "}
                meta {formatGoalValue(target, goal.unit)} · real.{" "}
                {realized != null ? formatGoalValue(realized, goal.unit) : "—"}
              </span>
            </li>
          );
        })}
        {row.conversionPct != null && mode === "values" ? (
          <li style={{ color: "#7c3aed" }}>
            Conversão Global/Potencial: {Number(row.conversionPct).toFixed(1)}%
          </li>
        ) : null}
      </ul>
    </div>
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
