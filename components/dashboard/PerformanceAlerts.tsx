"use client";

import { AlertTriangle } from "lucide-react";
import type { PerformanceAlert } from "@/lib/analysis/types";
import { brl, formatGrowth, monthLabel, number } from "@/lib/analysis/format";

function formatAlertValue(metricKey: string, value: number) {
  if (metricKey === "wonRevenue" || metricKey === "averageTicket") return brl.format(value);
  if (metricKey === "newDealsConversionPct") return formatGrowth(value);
  return number.format(value);
}

export function PerformanceAlerts({ alerts }: { alerts: PerformanceAlert[] }) {
  if (!alerts.length) {
    return (
      <section className="alerts-strip alerts-strip-ok" id="alertas">
        <p>Nenhum alerta de queda múltipla detectado nos meses analisados.</p>
      </section>
    );
  }

  return (
    <section className="alerts-strip" id="alertas">
      <div className="alerts-header">
        <AlertTriangle size={18} />
        <div>
          <strong>{alerts.length} alerta(s) de performance</strong>
          <span>Meses com queda em 2 ou mais indicadores seguidos</span>
        </div>
      </div>
      <div className="alerts-grid">
        {alerts.map((alert) => (
          <article className={`card alert-card alert-${alert.severity}`} key={alert.month}>
            <div className="alert-card-head">
              <strong>{monthLabel(alert.month)}</strong>
              <span className={`pill ${alert.severity === "high" ? "amber" : "blue"}`}>
                {alert.severity === "high" ? "Alta atenção" : "Atenção"}
              </span>
            </div>
            <p>{alert.message}</p>
            <ul className="alert-metrics">
              {alert.metrics.map((metric) => (
                <li key={metric.metric}>
                  <span>{metric.metricLabel}</span>
                  <span>
                    {formatAlertValue(metric.metric, metric.previousValue)} →{" "}
                    {formatAlertValue(metric.metric, metric.currentValue)} ({formatGrowth(metric.changePct)})
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
