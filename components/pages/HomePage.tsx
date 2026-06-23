"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Analysis } from "@/lib/analysis/types";
import { getExecutiveKpis } from "@/lib/analysis/metrics";
import { ExecutiveSummary } from "@/components/planning/ExecutiveSummary";
import { usePlanningFilters } from "@/components/planning/usePlanningFilters";
import { brl, formatGrowth, monthLabel } from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

export function HomePage({ analysis, generatedAt }: Props) {
  const { filters, filterBar } = usePlanningFilters(analysis, generatedAt);
  const kpis = useMemo(() => getExecutiveKpis(analysis, filters.scenario), [analysis, filters.scenario]);
  const latestHighAlert = useMemo(
    () => [...analysis.deepAnalysis.performanceAlerts].reverse().find((alert) => alert.severity === "high"),
    [analysis.deepAnalysis.performanceAlerts]
  );
  const mainInsight = analysis.planningSummary.insights[0];

  const quickLinks = [
    { href: "/planejamento", title: "Planejamento", desc: "Cenários, gráficos e tabela mês a mês" },
    { href: "/comercial", title: "Comercial", desc: "Funil, conversão e pipeline" },
    { href: "/mix", title: "Mix de vendas", desc: "Tipos, participação e filtros" },
    { href: "/metas", title: "Metas 2x/3x", desc: "Projeções e plano operacional" },
    { href: "/areas", title: "Áreas", desc: "Planejamento por área de negócio" },
    { href: "/investigacao", title: "Investigação", desc: "Alertas, recordes e funil profundo" }
  ];

  return (
    <>
      {filterBar}

      <section className="executive-brief" aria-label="Resumo executivo de decisão">
        <article className="brief-primary">
          <span className="brief-kicker">Forecast recomendado</span>
          <strong>{brl.format(kpis.projected2026Total)}</strong>
          <p>
            {kpis.scenarioName} · H2 {brl.format(kpis.projected2026H2)} ·{" "}
            {formatGrowth(kpis.growthVs2025Pct)} vs 2025
          </p>
        </article>
        <article className="brief-card">
          <span className="brief-kicker">Risco imediato</span>
          <strong>{latestHighAlert ? monthLabel(latestHighAlert.month) : "Sem alerta alto"}</strong>
          <p>{latestHighAlert?.message ?? "Nenhuma queda múltipla crítica no recorte atual."}</p>
        </article>
        <article className="brief-card">
          <span className="brief-kicker">Alavanca</span>
          <strong>{mainInsight?.title ?? "Foco no pipeline"}</strong>
          <p>{mainInsight?.body ?? "Priorizar conversão e destravamento da base aberta."}</p>
        </article>
      </section>

      <ExecutiveSummary kpis={kpis} />

      <section className="section-title subsection-title">
        <div>
          <h2>Navegação por tema</h2>
          <p>Cada assunto em sua própria página — mais foco, menos scroll.</p>
        </div>
      </section>

      <div className="page-links-grid">
        {quickLinks.map((link) => (
          <Link className="card page-link-card" href={link.href} key={link.href}>
            <strong>{link.title}</strong>
            <span>{link.desc}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
