"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { chartTheme } from "@/lib/chart-theme";
import { brlCents, brlPrecise } from "@/lib/financeiro/format";
import type { FaixaAging } from "@/lib/financeiro/painel";

type Props = { dados: FaixaAging[] };

/**
 * Aging do vencido, por faixa de atraso.
 *
 * O "a vencer" fica FORA do gráfico de propósito, e isso é a decisão mais
 * importante deste componente: são R$ 414 mil contra R$ 92 mil de vencido. Na
 * mesma escala, as quatro faixas de atraso viram traços de um pixel e a única
 * pergunta que o gráfico existe para responder — onde o dinheiro está
 * apodrecendo — deixa de ser respondível. O valor a vencer aparece no subtítulo,
 * onde não compete por escala.
 *
 * A ordem aqui é cronológica, não por magnitude: faixa de atraso é uma escala
 * ordinal e reordená-la por valor quebraria a leitura de progressão.
 *
 * Âmbar só na faixa acima de 90 dias — é ela que o título acusa.
 */
export function FinPainelAgingChart({ dados }: Props) {
  const pontos = dados
    .filter((linha) => linha.faixa !== "a vencer")
    .map((linha) => ({
      faixa: linha.faixa,
      aberto: linha.abertoCents / 100,
      n: linha.n,
      recuperacao: linha.recuperacaoEsperadaCents / 100,
      critica: linha.critica
    }));

  if (!pontos.some((ponto) => ponto.aberto > 0)) {
    return <p className="fin-card-hint">Nenhuma cobrança vencida em aberto. Carteira limpa.</p>;
  }

  return (
    <ChartFrame titulo="Aging do vencido">
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={pontos} margin={{ top: 24, right: 8, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="faixa"
            tick={{ fontSize: 11.5, fill: "#64727a" }}
            axisLine={{ stroke: "#dce5e8" }}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            formatter={(valor: number, _nome: string, item: { payload?: { n?: number; recuperacao?: number } }) => [
              `${brlPrecise(valor * 100)} · ${item.payload?.n ?? 0} cobranças · recuperação esperada ${brlCents(
                Math.round((item.payload?.recuperacao ?? 0) * 100)
              )}`,
              "Em aberto"
            ]}
            labelStyle={{ color: "#172126", fontWeight: 600 }}
            contentStyle={{ borderRadius: 10, border: "1px solid #dce5e8", fontSize: 13 }}
          />
          <Bar dataKey="aberto" name="Em aberto" radius={[4, 4, 0, 0]} maxBarSize={68}>
            {pontos.map((ponto) => (
              <Cell key={ponto.faixa} fill={ponto.critica ? chartTheme.amber : chartTheme.slate} />
            ))}
            <LabelList
              dataKey="aberto"
              position="top"
              formatter={(valor: number) => brlCents(Math.round(valor * 100))}
              style={{ fontSize: 12, fill: "#17333a", fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
