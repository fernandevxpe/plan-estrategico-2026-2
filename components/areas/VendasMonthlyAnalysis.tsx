"use client";

import { useMemo, useState } from "react";
import type { CommercialBreakdownRow } from "@/lib/analysis/types";
import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = Pick<VendasDirectorDashboard, "monthlyAnalysis" | "reviewAudits">;

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(value) - 1, 1))
  );
}

function pct(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function days(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

function BreakdownTable({ rows, valueBasis = false }: { rows: CommercialBreakdownRow[]; valueBasis?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="payroll-table commercial-breakdown-table">
        <thead>
          <tr>
            <th>Classificação</th>
            <th>{valueBasis ? "Potencial" : "Negócios"}</th>
            <th>Part.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{valueBasis ? brl.format(row.value) : row.deals}</td>
              <td>{pct(row.sharePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VendasMonthlyAnalysis({ monthlyAnalysis, reviewAudits }: Props) {
  const defaultMonth = reviewAudits.at(-1)?.month ?? monthlyAnalysis.at(-1)?.month ?? "";
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const month = useMemo(
    () => monthlyAnalysis.find((item) => item.month === selectedMonth) ?? monthlyAnalysis.at(-1),
    [monthlyAnalysis, selectedMonth]
  );
  const review = reviewAudits.find((item) => item.month === month?.month);

  if (!month) return null;

  const divergent = review?.audits.filter((item) => item.status === "divergent") ?? [];
  const unverifiable = review?.audits.filter((item) => item.status === "not_verifiable") ?? [];
  const confirmed = review?.audits.filter((item) => item.status === "confirmed") ?? [];

  return (
    <section className="commercial-monthly-analysis">
      <div className="commercial-monthly-header">
        <div>
          <span className="metric-label">Análise comercial automatizada</span>
          <h3>{monthLabel(month.month)}</h3>
          <p>
            {month.isPartial ? "Mês parcial" : "Fechamento reconstruído"} · corte em{" "}
            {new Date(month.cutoff).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <label>
          <span>Mês consultado</span>
          <select value={month.month} onChange={(event) => setSelectedMonth(event.target.value)}>
            {monthlyAnalysis.map((item) => (
              <option key={item.month} value={item.month}>
                {monthLabel(item.month)}{item.isPartial ? " (parcial)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="commercial-monthly-kpis">
        <div className="mini">
          <span className="metric-label">Potencial aberto</span>
          <strong>{brl.format(month.openPotential.value)}</strong>
          <small>{month.openPotential.deals} negócios</small>
        </div>
        <div className="mini">
          <span className="metric-label">Relacionamento no aberto</span>
          <strong>{pct(month.openPotential.relationshipSharePct)}</strong>
          <small>por valor</small>
        </div>
        <div className="mini">
          <span className="metric-label">Ganhos no ano</span>
          <strong>{month.wonYtd.deals}</strong>
          <small>{pct(month.wonYtd.relationshipSharePct)} relacionamento</small>
        </div>
        <div className="mini">
          <span className="metric-label">Perdidos no ano</span>
          <strong>{month.lostYtd.deals}</strong>
          <small>{month.lostYtd.untrackedDeals} sem canal</small>
        </div>
        <div className="mini">
          <span className="metric-label">Atividades / semana</span>
          <strong>{month.activity.weeklyAverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong>
          <small>{month.activity.completed} registradas</small>
        </div>
        <div className="mini">
          <span className="metric-label">Ciclo dos ganhos do mês</span>
          <strong>{days(month.cycle.wonAverageDays)}</strong>
          <small>mediana {days(month.cycle.wonMedianDays)}</small>
        </div>
        <div className="mini">
          <span className="metric-label">Produtos no potencial</span>
          <strong>{pct(month.openPotential.productSummary.coveragePct)}</strong>
          <small>{month.openPotential.productSummary.coveredDeals} negócios detalhados</small>
        </div>
      </div>

      {review ? (
        <div className={`commercial-audit-summary audit-${review.status}`}>
          <strong>Auditoria da análise de {review.author}</strong>
          <span>
            {confirmed.length} confirmações · {divergent.length} divergências · {unverifiable.length} sem evidência suficiente
          </span>
        </div>
      ) : null}

      <div className="vendas-details-grid commercial-monthly-details">
        <VendasInlineDetails title="Potencial aberto por canal" defaultOpen>
          <BreakdownTable rows={month.openPotential.channels} valueBasis />
        </VendasInlineDetails>

        <VendasInlineDetails title="Potencial por vendedor" defaultOpen>
          {month.openPotential.sellers.filter((seller) => seller.value > 0).map((seller) => (
            <div className="commercial-seller-block" key={seller.seller}>
              <div>
                <strong>{seller.seller}</strong>
                <span>{brl.format(seller.value)} · {seller.deals} negócios</span>
              </div>
              <BreakdownTable rows={seller.channels.slice(0, 6)} valueBasis />
            </div>
          ))}
        </VendasInlineDetails>

        <VendasInlineDetails title="Ganhos no ano por canal">
          <BreakdownTable rows={month.wonYtd.channels} />
        </VendasInlineDetails>

        <VendasInlineDetails title="Mix de produtos no potencial" defaultOpen>
          <BreakdownTable rows={month.openPotential.productSummary.products} valueBasis />
          <p className="commercial-method-note">
            Produtos somam {brl.format(month.openPotential.productSummary.productValue)} em {month.openPotential.productSummary.coveredDeals} negócios.
            Diferença contra o valor total desses negócios: {brl.format(month.openPotential.productSummary.reconciliationGap)}.
            {month.openPotential.productSummary.catalogMismatchLines > 0
              ? ` ${month.openPotential.productSummary.catalogMismatchLines} linha(s) usam produtos que não estão mais no catálogo atual.`
              : ""}
          </p>
        </VendasInlineDetails>

        <VendasInlineDetails title="Mix de produtos ganhos no ano">
          <BreakdownTable rows={month.wonYtd.productSummary.products} valueBasis />
          <p className="commercial-method-note">
            Cobertura atual: {pct(month.wonYtd.productSummary.coveragePct)} dos ganhos. Negócios anteriores à adoção de produtos continuam classificados por etiquetas.
          </p>
        </VendasInlineDetails>

        <VendasInlineDetails title="Perdas no ano por motivo" defaultOpen>
          <BreakdownTable rows={month.lostYtd.reasons} />
        </VendasInlineDetails>

        <VendasInlineDetails title="Perdas no ano por canal">
          <BreakdownTable rows={month.lostYtd.channels} />
        </VendasInlineDetails>

        <VendasInlineDetails title="Confiabilidade dos dados" defaultOpen>
          <ul className="vendas-compact-list">
            <li>{month.dataQuality.openWithoutValue} negócios abertos sem valor.</li>
            <li>{month.dataQuality.openWithoutChannel} negócios abertos sem canal.</li>
            <li>{month.dataQuality.lostWithoutStandardReason} perdas fora dos cinco motivos padronizados.</li>
            <li>{month.dataQuality.invalidWonCycleDates} ganhos com data anterior à criação, excluídos do ciclo.</li>
            <li>{month.activity.meetingRecords} reuniões/assembleias concluídas registradas no CRM.</li>
          </ul>
          <p className="commercial-method-note">{month.activity.note}</p>
          <p className="commercial-method-note">{month.cycle.note}</p>
        </VendasInlineDetails>

        {review ? (
          <VendasInlineDetails title="Conferência: informado × calculado" defaultOpen>
            <div className="table-wrap">
              <table className="payroll-table commercial-audit-table">
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th>Informado</th>
                    <th>Calculado</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...divergent, ...unverifiable, ...confirmed].map((item) => (
                    <tr key={`${item.section}-${item.label}`}>
                      <td>
                        <strong>{item.label}</strong>
                        <small>{item.section}{item.note ? ` · ${item.note}` : ""}</small>
                      </td>
                      <td>{item.reported.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                      <td>{item.calculated?.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) ?? "—"}</td>
                      <td>
                        <span className={`pill audit-pill-${item.status}`}>
                          {item.status === "confirmed" ? "Confere" : item.status === "divergent" ? "Diverge" : "Sem evidência"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </VendasInlineDetails>
        ) : null}
      </div>
    </section>
  );
}
