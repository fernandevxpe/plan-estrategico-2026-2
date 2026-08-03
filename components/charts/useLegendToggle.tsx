"use client";

import { useCallback, useMemo, useState } from "react";
import { Legend, type LegendProps } from "recharts";

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
} & Omit<LegendProps, "payload" | "onClick" | "content" | "onToggle" | "ref">;

/** Legenda com payload fixo — clicar liga/desliga a série sem sumir do menu. */
export function ToggleLegend({ series, hidden, onToggle, wrapperStyle, ...rest }: ToggleLegendProps) {
  const payload = useMemo(
    () =>
      series.map((item) => ({
        value: item.name,
        id: item.dataKey,
        dataKey: item.dataKey,
        type: item.type ?? "square",
        color: hidden[item.dataKey] ? "#cbd5e1" : item.color
      })),
    [series, hidden]
  );

  return (
    <Legend
      {...rest}
      payload={payload}
      wrapperStyle={{ cursor: "pointer", outline: "none", ...wrapperStyle }}
      formatter={(value, entry) => {
        const key = String((entry as { dataKey?: string }).dataKey ?? "");
        const off = Boolean(hidden[key]);
        return (
          <span
            style={{
              color: off ? "#94a3b8" : "#475569",
              textDecoration: off ? "line-through" : "none",
              cursor: "pointer",
              userSelect: "none"
            }}
          >
            {value}
          </span>
        );
      }}
      onClick={(entry) => {
        const key = String((entry as { dataKey?: string }).dataKey ?? "");
        if (key) onToggle(key);
      }}
    />
  );
}
