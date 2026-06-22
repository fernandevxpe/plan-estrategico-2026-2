"use client";

import { X } from "lucide-react";
import type { MonthDetail } from "@/lib/analysis/types";
import { brl, formatGrowth, serviceClass } from "@/lib/analysis/format";
import { MonthMixChart } from "@/components/planning/planning-charts";

type Props = {
  detail: MonthDetail;
  onClose: () => void;
};

export function MonthDrillDown({ detail, onClose }: Props) {
  return (
    <aside className="drilldown-panel">
      <div className="drilldown-header">
        <div>
          <p className="eyebrow">Drill-down</p>
          <h3>{detail.label}</h3>
          <span className={`pill ${detail.kind === "projected" ? "blue" : detail.kind === "partial" ? "amber" : "green"}`}>
            {detail.kind === "projected" ? "Projetado" : detail.kind === "partial" ? "Parcial" : "Realizado"}
          </span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar drill-down">
          <X size={18} />
        </button>
      </div>

      <div className="mini-grid drilldown-summary">
        <div className="mini">
          <span className="metric-label">Receita</span>
          <strong>{brl.format(detail.revenue)}</strong>
        </div>
        <div className="mini">
          <span className="metric-label">Fechamentos</span>
          <strong>{detail.wonDeals}</strong>
        </div>
        <div className="mini">
          <span className="metric-label">Ticket médio</span>
          <strong>{brl.format(detail.averageTicket)}</strong>
        </div>
        <div className="mini">
          <span className="metric-label">YoY receita</span>
          <strong>{formatGrowth(detail.revenueYoYPct)}</strong>
        </div>
      </div>

      {detail.businessTypes.length > 0 ? (
        <>
          <div className="drilldown-chart">
            <MonthMixChart data={detail.businessTypes.map((item) => ({ name: item.type, revenue: item.revenue }))} />
          </div>
          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="right">Fechados</th>
                  <th className="right">Receita</th>
                  <th className="right">Ticket</th>
                </tr>
              </thead>
              <tbody>
                {detail.businessTypes.map((item) => (
                  <tr key={item.type}>
                    <td>{item.type}</td>
                    <td className="right">{item.wonDeals}</td>
                    <td className="right">{brl.format(item.revenue)}</td>
                    <td className="right">{brl.format(item.averageTicket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="metric-note">Sem tipos de negócio registrados para este mês (projeção ou mês sem fechamentos).</p>
      )}

      {detail.deals.length > 0 ? (
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Negócio</th>
                <th>Cliente</th>
                <th>Serviço</th>
                <th className="right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {detail.deals.map((deal) => (
                <tr key={deal.id}>
                  <td><strong>{deal.title}</strong></td>
                  <td className="muted">{deal.organization ?? "Não informado"}</td>
                  <td><span className={`pill ${serviceClass(deal.service)}`}>{deal.service}</span></td>
                  <td className="right">{brl.format(deal.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </aside>
  );
}
