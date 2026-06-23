"use client";

import { useState } from "react";
import type { VendasScenario, VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import { brl, formatGrowth } from "@/lib/analysis/format";

type Props = {
  scenarios: VendasScenariosDashboard;
  embedded?: boolean;
};

function gapClass(value: number) {
  return value >= 0 ? "green" : "amber";
}

function ScenarioCompensationDetail({ scenario }: { scenario: VendasScenario }) {
  const sellerLabels = scenario.months[0]?.sellers.map((seller) => seller.label) ?? [];

  return (
    <div className="card scenario-payroll-card">
      <div className="card-title">
        <div>
          <h2>{scenario.name} — folha e faturamento</h2>
          <span>
            H2 folha: {brl.format(scenario.h2PayrollTotal)} · {formatGrowth(scenario.h2PayrollPctOfRevenue)} da
            receita H2 · média {brl.format(scenario.avgPayPerSellerH2)}/vendedor/mês
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="payroll-table">
          <thead>
            <tr>
              <th rowSpan={2}>Mês</th>
              <th colSpan={4}>Meta × coletivo</th>
              {sellerLabels.map((label) => (
                <th colSpan={4} key={label}>
                  {label}
                </th>
              ))}
            </tr>
            <tr>
              <th>Meta rec.</th>
              <th>Rec. proj.</th>
              <th>Folha total</th>
              <th>% folha</th>
              {sellerLabels.flatMap((label) => [
                <th key={`${label}-rec`}>Fatur.</th>,
                <th key={`${label}-fix`}>Fixo</th>,
                <th key={`${label}-com`}>Com.</th>,
                <th key={`${label}-tot`}>Total</th>
              ])}
            </tr>
          </thead>
          <tbody>
            {scenario.months.map((row) => (
              <tr key={row.month}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>{brl.format(row.revenueTarget)}</td>
                <td className={row.gapVsRevenueTarget >= 0 ? "cell-positive" : "cell-negative"}>
                  {brl.format(row.revenue)}
                </td>
                <td>{brl.format(row.collective.totalPayroll)}</td>
                <td>{formatGrowth(row.collective.payrollPctOfRevenue)}</td>
                {row.sellers.flatMap((seller) => [
                  <td key={`${row.month}-${seller.id}-rec`}>{brl.format(seller.attributedRevenue)}</td>,
                  <td key={`${row.month}-${seller.id}-fix`}>{brl.format(seller.fixedPay)}</td>,
                  <td key={`${row.month}-${seller.id}-com`}>{brl.format(seller.commission)}</td>,
                  <td key={`${row.month}-${seller.id}-tot`}>
                    <strong>{brl.format(seller.totalPay)}</strong>
                  </td>
                ])}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total H2</strong>
              </td>
              <td>{brl.format(scenario.months.reduce((s, m) => s + m.revenueTarget, 0))}</td>
              <td>
                <strong>{brl.format(scenario.h2Total)}</strong>
              </td>
              <td>
                <strong>{brl.format(scenario.h2PayrollTotal)}</strong>
              </td>
              <td>
                <strong>{formatGrowth(scenario.h2PayrollPctOfRevenue)}</strong>
              </td>
              {sellerLabels.map((label) => {
                const sellerId = scenario.months[0]?.sellers.find((s) => s.label === label)?.id;
                const totalRev = scenario.months.reduce(
                  (sum, month) => sum + (month.sellers.find((s) => s.id === sellerId)?.attributedRevenue ?? 0),
                  0
                );
                const totalPay = scenario.months.reduce(
                  (sum, month) => sum + (month.sellers.find((s) => s.id === sellerId)?.totalPay ?? 0),
                  0
                );
                return [
                  <td key={`foot-${label}-rec`}>
                    <strong>{brl.format(totalRev)}</strong>
                  </td>,
                  <td key={`foot-${label}-fix`}>—</td>,
                  <td key={`foot-${label}-com`}>—</td>,
                  <td key={`foot-${label}-tot`}>
                    <strong>{brl.format(totalPay)}</strong>
                  </td>
                ];
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function VendasScenariosSection({ scenarios, embedded = false }: Props) {
  const [activeScenario, setActiveScenario] = useState<"one-hire" | "two-hires">("one-hire");
  const [scenarioA, scenarioB] = scenarios.scenarios;
  const c = scenarios.conservativeIndividual;
  const h = scenarios.historicalIndividual;
  const comp = scenarios.compensation;
  const active = activeScenario === "one-hire" ? scenarioA : scenarioB;

  return (
    <div className={`vendas-scenarios ${embedded ? "is-embedded" : ""}`}>
      {!embedded ? (
        <section className="section-title subsection-title">
          <div>
            <h3>Projeção H2 — cenários de headcount e remuneração</h3>
            <p>
              {comp.label} · taxa conservadora · meta anual{" "}
              <strong>{brl.format(scenarios.targets.annual3M)}</strong>
            </p>
          </div>
        </section>
      ) : (
        <p className="vendas-sync-note">
          {comp.label} · meta {brl.format(scenarios.targets.annual3M)} · {scenarios.rampNote}
        </p>
      )}

      <div className="guide-kpi-row">
        <div className="guide-kpi-card">
          <span className="metric-label">Remuneração base</span>
          <strong>{brl.format(comp.fixedMonthly)} fixo</strong>
          <small>+ {comp.commissionPct}% comissão individual</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Meta H2/mês</span>
          <strong>{brl.format(scenarios.targets.h2MonthlyNeeded)}</strong>
          <small>Para bater R$ 2M no H2</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Rec./vendedor (cons.)</span>
          <strong>{brl.format(c.revenuePerSellerMonth)}</strong>
          <small>Real jan–mai: {brl.format(h.revenuePerSellerMonth)}</small>
        </div>
        <div className="guide-kpi-card">
          <span className="metric-label">Salário mín. (só fixo)</span>
          <strong>{brl.format(comp.fixedMonthly)}</strong>
          <small>Sem fechamento no mês</small>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Premissas de produtividade e pagamento</h2>
            <span>{c.sourceNote}</span>
          </div>
        </div>
        <div className="mini-grid">
          <div className="mini">
            <span className="metric-label">Conv. conservadora</span>
            <strong>{c.conversionPct}%</strong>
            <small>Real: {h.conversionPct}%</small>
          </div>
          <div className="mini">
            <span className="metric-label">Fechamentos/mês (100%)</span>
            <strong>{c.closingsPerSellerMonth.toFixed(1)}</strong>
            <small>Ticket: {brl.format(c.averageTicket)}</small>
          </div>
          <div className="mini">
            <span className="metric-label">Salário se bater 1/3 da meta H2</span>
            <strong>
              {brl.format(
                comp.fixedMonthly + (scenarios.targets.h2MonthlyNeeded / 3) * (comp.commissionPct / 100)
              )}
            </strong>
            <small>Com 3 vendedores ativos</small>
          </div>
          <div className="mini">
            <span className="metric-label">Salário na taxa conservadora</span>
            <strong>
              {brl.format(comp.fixedMonthly + c.revenuePerSellerMonth * (comp.commissionPct / 100))}
            </strong>
            <small>Por vendedor a 100% produtividade</small>
          </div>
        </div>
      </div>

      <div className="scenario-compare-grid">
        {[scenarioA, scenarioB].map((scenario) => (
          <div className="card scenario-card" key={scenario.id}>
            <div className="card-title">
              <div>
                <h2>{scenario.name}</h2>
                <span>{scenario.hireTimeline}</span>
              </div>
            </div>
            <div className="mini-grid">
              <div className="mini">
                <span className="metric-label">Ano 2026</span>
                <strong>{brl.format(scenario.annualTotal)}</strong>
                <span className={`pill ${gapClass(scenario.gapVs3M)}`}>
                  {scenario.gapVs3M >= 0 ? "+" : ""}
                  {brl.format(scenario.gapVs3M)} vs 3M
                </span>
              </div>
              <div className="mini">
                <span className="metric-label">Folha H2</span>
                <strong>{brl.format(scenario.h2PayrollTotal)}</strong>
                <small>{formatGrowth(scenario.h2PayrollPctOfRevenue)} da receita</small>
              </div>
              <div className="mini">
                <span className="metric-label">Média salário/vendedor</span>
                <strong>{brl.format(scenario.avgPayPerSellerH2)}</strong>
                <small>Fixo + comissão no H2</small>
              </div>
              <div className="mini">
                <span className="metric-label">Receita H2</span>
                <strong>{brl.format(scenario.h2Total)}</strong>
                <span className={`pill ${gapClass(scenario.h2GapVs2M)}`}>
                  {formatGrowth(scenario.h2GapVs2MPct)} vs meta
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="scenario-compare-bar">
        <button
          type="button"
          className={`scenario-compare-item ${activeScenario === "one-hire" ? "active" : "muted-item"}`}
          onClick={() => setActiveScenario("one-hire")}
        >
          Cenário A — detalhe folha
        </button>
        <button
          type="button"
          className={`scenario-compare-item ${activeScenario === "two-hires" ? "active" : "muted-item"}`}
          onClick={() => setActiveScenario("two-hires")}
        >
          Cenário B — detalhe folha
        </button>
      </div>

      <ScenarioCompensationDetail scenario={active} />

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Resumo coletivo jul–dez (ambos cenários)</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Meta</th>
                <th colSpan={3}>Cenário A</th>
                <th colSpan={3}>Cenário B</th>
              </tr>
              <tr>
                <th />
                <th>Receita</th>
                <th>Rec.</th>
                <th>Folha</th>
                <th>% folha</th>
                <th>Rec.</th>
                <th>Folha</th>
                <th>% folha</th>
              </tr>
            </thead>
            <tbody>
              {scenarioA.months.map((rowA, index) => {
                const rowB = scenarioB.months[index];
                return (
                  <tr key={rowA.month}>
                    <td>
                      <strong>{rowA.label}</strong>
                    </td>
                    <td>{brl.format(rowA.revenueTarget)}</td>
                    <td>{brl.format(rowA.revenue)}</td>
                    <td>{brl.format(rowA.collective.totalPayroll)}</td>
                    <td>{formatGrowth(rowA.collective.payrollPctOfRevenue)}</td>
                    <td>{brl.format(rowB.revenue)}</td>
                    <td>{brl.format(rowB.collective.totalPayroll)}</td>
                    <td>{formatGrowth(rowB.collective.payrollPctOfRevenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="investigation-notes">
        <div className="insight-mini">
          <span>
            <strong>Individual conservador (100%):</strong> faturamento {brl.format(c.revenuePerSellerMonth)} →
            salário {brl.format(comp.fixedMonthly + c.revenuePerSellerMonth * (comp.commissionPct / 100))} (
            {formatGrowth(((comp.fixedMonthly + c.revenuePerSellerMonth * 0.1) / c.revenuePerSellerMonth) * 100)} da
            receita individual).
          </span>
        </div>
        <div className="insight-mini">
          <span>
            <strong>Cenário A H2:</strong> receita {brl.format(scenarioA.h2Total)} · folha{" "}
            {brl.format(scenarioA.h2PayrollTotal)} · sobra bruta{" "}
            {brl.format(scenarioA.h2Total - scenarioA.h2PayrollTotal)} antes de outros custos.
            <strong> Cenário B:</strong> +{brl.format(scenarioB.h2Total - scenarioA.h2Total)} receita e +
            {brl.format(scenarioB.h2PayrollTotal - scenarioA.h2PayrollTotal)} folha no H2.
          </span>
        </div>
      </div>
    </div>
  );
}
