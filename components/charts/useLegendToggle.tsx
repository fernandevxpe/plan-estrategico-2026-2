"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { Legend } from "recharts";

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
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }}>
        <line x1="1" y1="7" x2="13" y2="7" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="7" cy="7" r="2.5" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }}>
      <rect x="2" y="2" width="10" height="10" rx="2" fill={color} />
    </svg>
  );
}

/** Legenda clicável fora do payload interno do Recharts — sempre visível. */
export function ToggleLegend({ series, hidden, onToggle, wrapperStyle }: ToggleLegendProps) {
  return (
    <Legend
      verticalAlign="bottom"
      wrapperStyle={{ cursor: "pointer", outline: "none", ...wrapperStyle }}
      content={() => (
        <ul
          className="chart-legend-toggle"
          style={{
            padding: 0,
            margin: "4px 0 0",
            textAlign: "center",
            listStyle: "none"
          }}
        >
          {series.map((item) => {
            const off = Boolean(hidden[item.dataKey]);
            const color = off ? "#cbd5e1" : item.color;
            return (
              <li
                key={item.dataKey}
                style={{
                  display: "inline-block",
                  marginRight: 12,
                  cursor: "pointer",
                  userSelect: "none",
                  fontSize: 12,
                  lineHeight: "20px",
                  color: off ? "#94a3b8" : "#475569",
                  textDecoration: off ? "line-through" : "none"
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(item.dataKey);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggle(item.dataKey);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={!off}
                title={off ? `Mostrar ${item.name}` : `Ocultar ${item.name}`}
              >
                <LegendIcon type={item.type} color={color} />
                {item.name}
              </li>
            );
          })}
        </ul>
      )}
    />
  );
}
