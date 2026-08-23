"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Analysis } from "@/lib/analysis/types";
import { getExecutiveKpis } from "@/lib/analysis/metrics";
import { ExecutiveSummary } from "@/components/planning/ExecutiveSummary";
import { usePlanningFilters } from "@/components/planning/usePlanningFilters";
import { brl, formatGrowth, monthLabel } from "@/lib/analysis/format";
import type { IntelExecutiveFinding } from "@/lib/areas/build-commercial-intel";

type Props = {
  analysis: Analysis;
  generatedAt: string;
  criticalFindings: IntelExecutiveFinding[];
};

export function HomePage({ analysis, criticalFindings }: Props) {
  const { filters } = usePlanningFilters(analysis);
  const kpis = useMemo(() => getExecutiveKpis(analysis, filters.scenario), [analysis, filters.scenario]);
  const latestHighAlert = useMemo(
    () => [...analysis.deepAnalysis.performanceAlerts].reverse().find((alert) => alert.severity === "high"),
    [analysis.deepAnalysis.performanceAlerts]
  );
  const mainInsight = analysis.planningSummary.insights[0];

  const quickLinks = [
    { href: "/comercial", title: "Comercial", desc: "Meta, realizado e projeção do ritmo de vendas" },
    { href: "/areas/vendas", title: "Vendas", desc: "Canais, perdas, ciclo e reuniões mês a mês" },
    { href: "/planejamento", title: "Planejamento", desc: "Metas Pipedrive, gráficos e comparação" },
    { href: "/mix", title: "Serviços", desc: "Receita, esforço e participação por produto" },
    { href: "/areas", title: "Áreas", desc: "Planejamento por área de negócio" },
    { href: "/gestao-xpe", title: "Gestão XPE", desc: "Gargalos, motores e indicadores semanais" }
  ];

  return (
    <>
      {/*
       * A ÚNICA PÁGINA DA PLATAFORMA SEM `h1`.
       *
       * Todas as outras abrem com `.page-header > h1`; esta caía direto no
       * resumo executivo. Para quem navega por leitor de tela, a página
       * principal era a que não dizia o próprio nome — e o primeiro cabeçalho
       * que aparecia era um `h2` ("Precisa de decisão agora"), o que também
       * quebra a hierarquia: um documento não começa no nível 2.
       *
       * Achado varrendo as 32 rotas nos dois temas; era o único `sem-h1` da
       * plataforma inteira.
       */}
      <div className="page-header">
        <h1>Visão geral</h1>
        <p>O que decidir agora, o forecast do ano e a porta para cada área.</p>
      </div>

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

      {criticalFindings.length ? (
        <section className="home-critical" aria-label="Pontos críticos do ano">
          <header>
            <h2>Precisa de decisão agora</h2>
            <Link href="/areas/vendas">Ver diagnóstico completo →</Link>
          </header>
          <ol>
            {criticalFindings.map((finding) => (
              <li key={finding.id}>
                <strong>{finding.title}</strong>
                <p>{finding.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
