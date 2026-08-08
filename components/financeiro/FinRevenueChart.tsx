"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartWithLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import { chartTheme } from "@/lib/chart-theme";
import { brlCompact, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";

type Props = {
  dados: { month: string; recebidoCents: number }[];
};

/**
 * Receita recebida mês a mês, com a média móvel de 3 meses por cima.
 *
 * A média existe porque a receita desta empresa é irregular por natureza — um
 * mês com R$ 284 mil ao lado de outro com R$ 156 mil não indica tendência
 * nenhuma. Sem a linha, todo mês fraco vira reunião de emergência e todo mês
 * forte vira otimismo.
 *
 * A legenda fica FORA do Recharts (ChartWithLegend), que é a escolha deliberada
 * do repositório depois de as legendas nativas sumirem em certos tamanhos.
 */
export function FinRevenueChart({ dados }: Props) {
  const { hidden, isHidden, toggle } = useLegendToggle();

  const series: LegendSeries[] = [
    { dataKey: "recebido", name: "Recebido", color: chartTheme.green, type: "rect" },
    { dataKey: "media3m", name: "Média 3 meses", color: chartTheme.purple, type: "line" }
  ];

  const pontos = useMemo(
    () =>
      dados.map((linha, indice) => {
        const janela = dados.slice(Math.max(0, indice - 2), indice + 1);
        const media = janela.reduce((sum, item) => sum + item.recebidoCents, 0) / janela.length;
        return {
          mes: monthKeyLabel(linha.month),
          recebido: linha.recebidoCents / 100,
          media3m: Math.round(media) / 100
        };
      }),
    [dados]
  );

  if (!pontos.length) {
    return <p className="fin-card-hint">Sem receita no período — importe o extrato para começar.</p>;
  }

  return (
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
          {!isHidden("recebido") ? (
            <Bar dataKey="recebido" name="Recebido" fill={chartTheme.green} radius={[4, 4, 0, 0]} maxBarSize={38} />
          ) : null}
          {!isHidden("media3m") ? (
            <Line
              type="monotone"
              dataKey="media3m"
              name="Média 3 meses"
              stroke={chartTheme.purple}
              strokeWidth={2.5}
              dot={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartWithLegend>
  );
}
