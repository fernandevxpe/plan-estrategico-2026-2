"use client";

import type { Analysis } from "@/lib/analysis/types";
import { IndicatorAnalysisSection } from "@/components/dashboard/IndicatorAnalysisSection";
import { PerformanceAlerts } from "@/components/dashboard/PerformanceAlerts";
import { DeepAnalysisSection } from "@/components/dashboard/DeepAnalysisSection";

type Props = {
  analysis: Analysis;
};

export function InvestigacaoPage({ analysis }: Props) {
  return (
    <>
      <div className="page-header">
        <h1>Investigação e apêndice analítico</h1>
        <p>Alertas, qualidade de dados, recordes comerciais e análise profunda do funil.</p>
      </div>

      <section className="page-zone">
        <div className="section-title subsection-title">
          <h2>Alertas operacionais</h2>
        </div>
        <PerformanceAlerts alerts={analysis.deepAnalysis.performanceAlerts} />
        {analysis.dataQualityAlerts?.length ? (
          <div className="alerts-grid data-quality-grid">
            {analysis.dataQualityAlerts.map((alert) => (
              <article className={`card alert-card alert-${alert.severity}`} key={alert.id}>
                <div className="alert-card-head">
                  <strong>{alert.title}</strong>
                  <span className={`pill ${alert.severity === "high" ? "amber" : "blue"}`}>{alert.count}</span>
                </div>
                <p>{alert.message}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="page-zone">
        <IndicatorAnalysisSection analysis={analysis} />
      </section>

      <section className="page-zone">
        <DeepAnalysisSection analysis={analysis} />
      </section>
    </>
  );
}
