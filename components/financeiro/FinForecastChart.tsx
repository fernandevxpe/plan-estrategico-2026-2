"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { ChartWithLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import { chartTheme } from "@/lib/chart-theme";
import { brlCompact, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";

type Props = {
  meses: { mes: string; entradaCents: number; fechamentoCents: number }[];
  metaReservasCents: number;
};

/**
 * Entradas contratadas (ajustadas pela curva) e saldo projetado, mês a mês.
 *
 * A linha de referência na meta de reservas existe para responder à pergunta
 * que a projeção provoca: "quando dá para completar as reservas?" — hoje as
 * quatro têm alvo somado de R$ 230 mil e R$ 0 separado.
 *
 * Enquanto não houver saída registrada (L3 = 0), a linha de saldo é um TETO:
 * sobe sempre, porque só o lado da entrada existe no banco. O padrão do
 * gráfico segue FinRevenueChart: legenda fora do Recharts, cores só de
 * lib/chart-theme.
 */
export function FinForecastChart({ meses, metaReservasCents }: Props) {
  const { hidden, isHidden, toggle } = useLegendToggle();

  const series: LegendSeries[] = [
    { dataKey: "entrada", name: "Entradas ajustadas", color: chartTheme.green, type: "rect" },
    { dataKey: "saldo", name: "Saldo projetado (teto)", color: chartTheme.purple, type: "line" }
  ];

  const pontos = useMemo(
    () =>
      meses.map((linha) => ({
        mes: monthKeyLabel(linha.mes),
        entrada: linha.entradaCents / 100,
        saldo: linha.fechamentoCents / 100
      })),
    [meses]
  );

  if (!pontos.length) {
    return <p className="fin-card-hint">Sem meses no horizonte — banco indisponível.</p>;
  }

  return (
    <ChartFrame titulo="Fluxo de caixa projetado">
      <ChartWithLegend series={series} hidden={hidden} onToggle={toggle}>
        <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dce5e8" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#64727a" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 12, fill: "#64727a" }}
            axisLine={false}
            tickLine={false}
            width={72}
            tickFormatter={(value: number) => brlCompact(value * 100)}
          />
          <Tooltip
            formatter={(value: number) => brlPrecise(value * 100)}
            labelStyle={{ color: "#172126", fontWeight: 600 }}
            contentStyle={{ borderRadius: 10, border: "1px solid #dce5e8", fontSize: 13 }}
          />
          <ReferenceLine
            y={metaReservasCents / 100}
            stroke={chartTheme.amber}
            strokeDasharray="6 4"
            label={{ value: "meta de reservas", position: "insideTopRight", fill: chartTheme.amber, fontSize: 12 }}
          />
          {!isHidden("entrada") ? (
            <Bar dataKey="entrada" name="Entradas ajustadas" fill={chartTheme.green} radius={[4, 4, 0, 0]} maxBarSize={38} />
          ) : null}
          {!isHidden("saldo") ? (
            <Line
              type="monotone"
              dataKey="saldo"
              name="Saldo projetado (teto)"
              stroke={chartTheme.purple}
              strokeWidth={2.5}
              dot={false}
            />
          ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWithLegend>
    </ChartFrame>
  );
}
