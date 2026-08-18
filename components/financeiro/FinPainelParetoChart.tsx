"use client";

import { Bar, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { ChartWithLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import { chartTheme } from "@/lib/chart-theme";
import { brlCompact, brlPrecise, pct } from "@/lib/financeiro/format";
import type { LinhaPareto } from "@/lib/financeiro/painel";

type Props = { dados: LinhaPareto[] };

/**
 * Pareto de clientes: barra de receita mais linha de participação acumulada.
 *
 * É o único gráfico do painel com dois eixos, e a exceção é justificada: as duas
 * séries respondem a perguntas diferentes sobre a MESMA ordenação — "quanto pesa
 * cada um" e "quantos preciso somar para chegar a 80%". O eixo direito é
 * percentual travado em 0–100, então não há como esticá-lo para fabricar uma
 * correlação, que é o abuso clássico do eixo duplo.
 *
 * Roxo nos 10 primeiros, cinza na cauda: o corte do top 10 é o que o título
 * afirma, e a cor é o que prova a afirmação sem precisar de anotação.
 *
 * Nomes de cliente não vão no eixo — são razões sociais de condomínio, longas e
 * quase idênticas entre si. Ficariam ilegíveis e roubariam metade da altura. A
 * identificação vive no tooltip e na tabela ao lado.
 */
export function FinPainelParetoChart({ dados }: Props) {
  const { hidden, isHidden, toggle } = useLegendToggle();

  const series: LegendSeries[] = [
    { dataKey: "receita", name: "Receita por cliente (12 meses)", color: chartTheme.purple, type: "rect" },
    { dataKey: "acumulado", name: "Participação acumulada", color: chartTheme.ink, type: "line" }
  ];

  const pontos = dados.map((linha, indice) => ({
    posicao: `${indice + 1}º`,
    nome: linha.nome,
    receita: linha.receitaCents / 100,
    acumulado: Number(linha.pctAcumulado.toFixed(1)),
    top10: linha.top10
  }));

  if (!pontos.length) return <p className="fin-card-hint">Sem cliente identificado no período.</p>;

  return (
    <ChartFrame titulo="Concentração de clientes (Pareto)">
      <ChartWithLegend series={series} hidden={hidden} onToggle={toggle}>
        <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={pontos} margin={{ top: 10, right: 8, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="posicao"
            tick={{ fontSize: 10.5, fill: "#64727a" }}
            axisLine={{ stroke: "#dce5e8" }}
            tickLine={false}
          />
          <YAxis
            yAxisId="valor"
            tick={{ fontSize: 11, fill: "#64727a" }}
            axisLine={false}
            tickLine={false}
            width={66}
            tickFormatter={(valor: number) => brlCompact(valor * 100)}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            ticks={[0, 50, 80, 100]}
            tick={{ fontSize: 11, fill: "#64727a" }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(valor: number) => `${valor}%`}
          />
          <Tooltip
            formatter={(valor: number, nome: string) =>
              nome === "Participação acumulada" ? [pct(valor, 1), nome] : [brlPrecise(valor * 100), nome]
            }
            labelFormatter={(_rotulo: string, carga: { payload?: { nome?: string } }[]) =>
              carga?.[0]?.payload?.nome ?? ""
            }
            contentStyle={{ borderRadius: 10, border: "1px solid #dce5e8", fontSize: 12.5, maxWidth: 320 }}
          />
          {/* A régua dos 80%: a única anotação do gráfico, e a que responde a
              pergunta de Pareto sem obrigar ninguém a seguir a linha com o dedo. */}
          <ReferenceLine
            yAxisId="pct"
            y={80}
            stroke={chartTheme.slate}
            strokeDasharray="4 4"
            label={{ value: "80%", position: "right", fill: "#64727a", fontSize: 10.5 }}
          />
          {!isHidden("receita") ? (
            <Bar yAxisId="valor" dataKey="receita" name="Receita por cliente (12 meses)" radius={[3, 3, 0, 0]} maxBarSize={30}>
              {pontos.map((ponto) => (
                <Cell key={ponto.posicao} fill={ponto.top10 ? chartTheme.purple : chartTheme.slate} />
              ))}
            </Bar>
          ) : null}
          {!isHidden("acumulado") ? (
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="acumulado"
              name="Participação acumulada"
              stroke={chartTheme.ink}
              strokeWidth={2}
              dot={{ r: 2.5, fill: chartTheme.ink }}
            />
          ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWithLegend>
    </ChartFrame>
  );
}
