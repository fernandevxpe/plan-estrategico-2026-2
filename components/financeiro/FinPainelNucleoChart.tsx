"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { chartTheme } from "@/lib/chart-theme";
import { brlCompact, brlPrecise } from "@/lib/financeiro/format";
import type { LinhaNucleo } from "@/lib/financeiro/painel";

type Props = { dados: LinhaNucleo[]; destaque: string };

/**
 * Receita por núcleo, barras horizontais, ordenadas por magnitude.
 *
 * Horizontais porque os rótulos são palavras ("Consultoria", "Tecnologia") e
 * palavra em pé é palavra não lida. Ordenadas por valor porque ordem é
 * informação: em barra, a primeira coisa que o olho faz é comparar comprimentos,
 * e ordem alfabética força o leitor a fazer esse trabalho de novo.
 *
 * UMA cor de destaque só, no núcleo que puxou o crescimento — é ele que o título
 * afirma. Todo o resto é cinza. Colorir os quatro núcleos criaria um arco-íris
 * onde cada cor grita igual e nenhuma diz nada.
 *
 * Sem eixo de valor: o número vai direto na ponta da barra. Um eixo mais uma
 * legenda mais rótulos seriam três formas de dizer a mesma coisa.
 */
export function FinPainelNucleoChart({ dados, destaque }: Props) {
  const pontos = dados.map((linha) => ({
    nome: linha.nome,
    slug: linha.slug,
    receita: linha.receitaCents / 100,
    anterior: linha.receitaAnteriorCents / 100,
    delta: linha.deltaCents / 100,
    pct: linha.pctDoTotal
  }));

  if (!pontos.length) return <p className="fin-card-hint">Sem receita atribuída a núcleo no período.</p>;

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, pontos.length * 52)}>
      <BarChart data={pontos} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="nome"
          width={104}
          tick={{ fontSize: 12.5, fill: "#17333a" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(valor: number) => brlPrecise(valor * 100)}
          labelStyle={{ color: "#172126", fontWeight: 600 }}
          contentStyle={{ borderRadius: 10, border: "1px solid #dce5e8", fontSize: 13 }}
        />
        <Bar dataKey="receita" name="Receita 12 meses" radius={[0, 4, 4, 0]} maxBarSize={30}>
          {pontos.map((ponto) => (
            <Cell key={ponto.slug} fill={ponto.slug === destaque ? chartTheme.green : chartTheme.slate} />
          ))}
          <LabelList
            dataKey="receita"
            position="right"
            formatter={(valor: number) => brlCompact(valor * 100)}
            style={{ fontSize: 12, fill: "#17333a", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
