"use client";

import { useMemo } from "react";
import { Bar, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartWithLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import { chartTheme } from "@/lib/chart-theme";
import { brlCompact, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";
import type { SerieMes } from "@/lib/financeiro/painel";

type Props = { dados: SerieMes[] };

/**
 * Receita mês a mês, 24 meses, com a média móvel de 3 meses por cima.
 *
 * Três decisões de leitura, todas do mesmo princípio — cinza por padrão, cor só
 * no que carrega a mensagem:
 *
 *   · as barras são CINZA. Elas são o contexto, não o recado. A mensagem é a
 *     tendência, e quem a carrega é a linha verde da média móvel. Barras
 *     coloridas competiriam com ela e o olho não saberia onde pousar.
 *   · o mês corrente é PARCIAL e vem mais claro. Sem isso, todo dia 3 o gráfico
 *     mostra um desabamento que não aconteceu e alguém marca reunião.
 *   · não há grade horizontal densa nem eixo duplo. Uma linha de referência na
 *     média dos 12 meses basta para responder "este mês está acima ou abaixo do
 *     normal?", que é a pergunta real.
 */
export function FinPainelReceitaChart({ dados }: Props) {
  const { hidden, isHidden, toggle } = useLegendToggle();

  const series: LegendSeries[] = [
    { dataKey: "receita", name: "Receita do mês", color: chartTheme.slate, type: "rect" },
    { dataKey: "media3m", name: "Média de 3 meses", color: chartTheme.green, type: "line" }
  ];

  const { pontos, mediaReais } = useMemo(() => {
    const pts = dados.map((linha) => ({
      mes: monthKeyLabel(linha.mes),
      receita: linha.receitaCents / 100,
      media3m: linha.media3mCents / 100,
      anoAnterior: linha.anoAnteriorCents === null ? null : linha.anoAnteriorCents / 100,
      parcial: linha.parcial
    }));
    // A referência é a média dos meses FECHADOS: incluir o mês corrente parcial
    // puxaria a linha para baixo e faria o mês fraco parecer normal.
    const fechados = pts.filter((p) => !p.parcial);
    const media = fechados.length ? fechados.reduce((s, p) => s + p.receita, 0) / fechados.length : 0;
    return { pontos: pts, mediaReais: media };
  }, [dados]);

  if (!pontos.length) return <p className="fin-card-hint">Sem receita no período.</p>;

  return (
    <ChartWithLegend series={series} hidden={hidden} onToggle={toggle}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={pontos} margin={{ top: 12, right: 10, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="mes"
            tick={{ fontSize: 11, fill: "#64727a" }}
            axisLine={{ stroke: "#dce5e8" }}
            tickLine={false}
            interval={1}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64727a" }}
            axisLine={false}
            tickLine={false}
            width={70}
            tickFormatter={(valor: number) => brlCompact(valor * 100)}
          />
          <Tooltip
            formatter={(valor: number, nome: string) => [brlPrecise(valor * 100), nome]}
            labelStyle={{ color: "#172126", fontWeight: 600 }}
            contentStyle={{ borderRadius: 10, border: "1px solid #dce5e8", fontSize: 13 }}
          />
          <ReferenceLine
            y={mediaReais}
            stroke={chartTheme.slate}
            strokeDasharray="4 4"
            label={{
              value: `média 24m ${brlCompact(mediaReais * 100)}`,
              position: "insideTopLeft",
              fill: "#64727a",
              fontSize: 10.5
            }}
          />
          {!isHidden("receita") ? (
            <Bar dataKey="receita" name="Receita do mês" radius={[3, 3, 0, 0]} maxBarSize={26}>
              {pontos.map((ponto) => (
                <Cell key={ponto.mes} fill={ponto.parcial ? "#dbe4e8" : chartTheme.slate} />
              ))}
            </Bar>
          ) : null}
          {!isHidden("media3m") ? (
            <Line
              type="monotone"
              dataKey="media3m"
              name="Média de 3 meses"
              stroke={chartTheme.green}
              strokeWidth={2.75}
              dot={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartWithLegend>
  );
}
