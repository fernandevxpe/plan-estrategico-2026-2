"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";

export type LegendSeries = {
  dataKey: string;
  name: string;
  color: string;
  type?: "line" | "square" | "circle" | "plainline" | "rect";
};

export function useLegendToggle(initialHidden: string[] = []) {
  const [hidden, setHidden] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialHidden.map((key) => [key, true]))
  );

  const isHidden = useCallback((dataKey: string) => Boolean(hidden[dataKey]), [hidden]);

  const toggle = useCallback((dataKey: string) => {
    if (!dataKey) return;
    setHidden((prev) => ({ ...prev, [dataKey]: !prev[dataKey] }));
  }, []);

  return { hidden, isHidden, toggle };
}

type ToggleLegendProps = {
  series: LegendSeries[];
  hidden: Record<string, boolean>;
  onToggle: (dataKey: string) => void;
  wrapperStyle?: CSSProperties;
};

function LegendIcon({ type, color }: { type: LegendSeries["type"]; color: string }) {
  if (type === "line" || type === "plainline") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden
        style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }}
      >
        <line x1="1" y1="7" x2="13" y2="7" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="7" cy="7" r="2.5" fill={color} />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden
      style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }}
    >
      <rect x="2" y="2" width="10" height="10" rx="2" fill={color} />
    </svg>
  );
}

/** Legenda HTML pura — fora do SVG/Recharts, sempre visível e clicável. */
export function ToggleLegend({ series, hidden, onToggle, wrapperStyle }: ToggleLegendProps) {
  if (!series.length) return null;

  return (
    <ul className="chart-legend-toggle" style={wrapperStyle} role="list">
      {series.map((item) => {
        const off = Boolean(hidden[item.dataKey]);
        const color = off ? "#cbd5e1" : item.color;
        return (
          <li key={item.dataKey} role="presentation">
            <button
              type="button"
              className={off ? "is-off" : undefined}
              onClick={() => onToggle(item.dataKey)}
              aria-pressed={!off}
              title={off ? `Mostrar ${item.name}` : `Ocultar ${item.name}`}
            >
              <LegendIcon type={item.type} color={color} />
              <span>{item.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type ChartWithLegendProps = {
  series: LegendSeries[];
  hidden: Record<string, boolean>;
  onToggle: (dataKey: string) => void;
  wrapperStyle?: CSSProperties;
  children: ReactNode;
};

/** Envolve o ResponsiveContainer e coloca a legenda abaixo do plot. */
export function ChartWithLegend({
  series,
  hidden,
  onToggle,
  wrapperStyle,
  children
}: ChartWithLegendProps) {
  return (
    <div className="chart-with-legend">
      <div className="chart-with-legend-plot">{children}</div>
      <ToggleLegend series={series} hidden={hidden} onToggle={onToggle} wrapperStyle={wrapperStyle} />
    </div>
  );
}
