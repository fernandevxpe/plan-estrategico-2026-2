"use client";

import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import { brl, formatGrowth, monthLabel } from "@/lib/analysis/format";

type Props = {
  funnel: VendasFunnelDashboard;
};

export function VendasFunnelSection({ funnel }: Props) {
  const maxDeals = Math.max(...funnel.stages.map((row) => row.deals), 1);

  return (
    <div className="vendas-funnel">
      <section className="section-title subsection-title">
        <div>
          <h3>Funil por fase — na prática</h3>
          <p>
            Pipeline principal: <strong>{funnel.mainPipeline}</strong> · {funnel.stagesTotalDeals} negócios
            abertos · {brl.format(funnel.stagesTotalValue)} em valor
          </p>
        </div>
      </section>

      <div className="investigation-notes">
        {funnel.contextDiagnosis.map((note) => (
          <div className="insight-mini" key={note}>
            <span>{note}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Etapas abertas hoje</h2>
            <span>Snapshot do Pipedrive — onde está o gargalo</span>
          </div>
        </div>
        <div className="funnel-stages">
          {funnel.stages.map((stage, index) => {
            const prev = funnel.stages[index - 1];
            const stepConversion =
              prev && prev.deals > 0 ? (stage.deals / prev.deals) * 100 : null;
            return (
              <div className="funnel-stage-row" key={`${stage.stage}-${stage.stageOrder}`}>
                <div className="funnel-stage-head">
                  <strong>{stage.stage}</strong>
                  <span>
                    {stage.deals} neg. · {brl.format(stage.value)}
                    {stage.averageValue > 0 ? ` · ticket ${brl.format(stage.averageValue)}` : ""}
                  </span>
                </div>
                <div className="funnel-stage-bar">
                  <div
                    className="funnel-stage-fill"
                    style={{ width: `${Math.max(8, (stage.deals / maxDeals) * 100)}%` }}
                  />
                </div>
                {stepConversion != null && index > 0 ? (
                  <span className="metric-note">
                    {stage.deals} de {prev.deals} avançaram da etapa anterior ({formatGrowth(stepConversion)} do
                    volume em aberto)
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="metric-note">
          Alerta: <strong>{funnel.negotiationDeals}</strong> negócios parados em Negociação (
          {brl.format(funnel.negotiationValue)}) — prioridade do playbook de proposta.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Conversão mensal 2026</h2>
            <span>Conversão dos novos negócios + fechamentos por mês</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Novos</th>
                <th>Ganhos</th>
                <th>Receita</th>
                <th>Perdidos</th>
                <th>Conv. novos neg.</th>
                <th>Pipeline fim mês</th>
              </tr>
            </thead>
            <tbody>
              {funnel.monthly.map((row) => (
                <tr key={row.month}>
                  <td>{monthLabel(row.month)}</td>
                  <td>{row.createdDeals}</td>
                  <td>{row.wonDeals}</td>
                  <td>{brl.format(row.wonValue)}</td>
                  <td>{row.lostDeals}</td>
                  <td>{row.cohortConversionPct != null ? formatGrowth(row.cohortConversionPct) : "—"}</td>
                  <td>
                    {row.openBaseDealsEndOfMonth} neg. · {brl.format(row.openBaseValueEndOfMonth)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
