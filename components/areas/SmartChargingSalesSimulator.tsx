"use client";

import { useMemo, useState } from "react";
import type { SmartChargingDashboard } from "@/lib/areas/build-smart-charging-dashboard";
import { brl, number } from "@/lib/analysis/format";

type Props = {
  data: SmartChargingDashboard;
};

type MonthInput = {
  sales: number;
  controllers: number;
};

type MonthRow = {
  monthId: string;
  label: string;
  sales: number;
  controllers: number;
  cumulativeSold: number;
  billingCondos: number;
  infraRevenue: number;
  controllerRevenue: number;
  contractRevenue: number;
  recurringRevenue: number;
  totalRevenue: number;
  cumulativeContract: number;
  cumulativeRecurring: number;
  cumulativeTotal: number;
};

type MarginRow = {
  tax: number;
  cmv: number;
  cac: number;
  recurringCost: number;
  profit: number;
  liquidCash: number;
  cumulativeLiquid: number;
};

function clampNonNeg(n: number) {
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
}

function clampPct(n: number) {
  return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
}

function emptyMonths(count: number): MonthInput[] {
  return Array.from({ length: count }, () => ({ sales: 0, controllers: 0 }));
}

function computeMargins(
  contractRevenue: number,
  recurringRevenue: number,
  taxPct: number,
  cmvPct: number,
  cacPct: number,
  recurringProfitPct: number
): MarginRow {
  const tax = contractRevenue * (taxPct / 100);
  const cmv = contractRevenue * (cmvPct / 100);
  const cac = contractRevenue * (cacPct / 100);
  const contractProfit = contractRevenue - tax - cmv - cac;
  const recurringProfit = recurringRevenue * (recurringProfitPct / 100);
  const recurringCost = recurringRevenue - recurringProfit;
  const profit = contractProfit + recurringProfit;
  return {
    tax,
    cmv,
    cac,
    recurringCost,
    profit,
    liquidCash: profit,
    cumulativeLiquid: 0
  };
}

export function SmartChargingSalesSimulator({ data }: Props) {
  const proj = data.focus.salesProjection;
  const hint = proj.defaults.controllersPerCondoHint;
  const marginDefaults = proj.marginDefaults;

  const [ticketMedio, setTicketMedio] = useState(proj.defaults.baseInfraTicket);
  const [controllerPrice, setControllerPrice] = useState(proj.defaults.controllerUnitPrice);
  const [monthlyFee, setMonthlyFee] = useState(proj.defaults.monthlyFeePerCondo);
  const [taxPct, setTaxPct] = useState(marginDefaults.taxPct);
  const [cmvPct, setCmvPct] = useState(marginDefaults.cmvPct);
  const [cacPct, setCacPct] = useState(marginDefaults.cacPct);
  const [recurringProfitPct, setRecurringProfitPct] = useState(marginDefaults.recurringProfitPct);
  const [monthInputs, setMonthInputs] = useState<MonthInput[]>(() => emptyMonths(proj.months.length));

  const contractProfitPct = Math.max(0, 100 - taxPct - cmvPct - cacPct);
  const recurringCostPct = 100 - recurringProfitPct;

  const updateSales = (index: number, value: number) => {
    const sales = clampNonNeg(value);
    setMonthInputs((prev) => {
      const next = [...prev];
      const prevRow = next[index];
      const implied = prevRow.sales * hint;
      const controllers =
        prevRow.controllers === 0 || prevRow.controllers === implied
          ? sales * hint
          : prevRow.controllers;
      next[index] = { sales, controllers };
      return next;
    });
  };

  const updateControllers = (index: number, value: number) => {
    setMonthInputs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], controllers: clampNonNeg(value) };
      return next;
    });
  };

  const projection = useMemo(() => {
    let cumulativeSold = 0;
    let cumulativeContract = 0;
    let cumulativeRecurring = 0;
    let cumulativeTotal = 0;
    let cumulativeLiquid = 0;

    const months: (MonthRow & { margin: MarginRow })[] = monthInputs.map((input, i) => {
      const billingCondos = cumulativeSold;
      const infraRevenue = input.sales * ticketMedio;
      const controllerRevenue = input.controllers * controllerPrice;
      const contractRevenue = infraRevenue + controllerRevenue;
      const recurringRevenue = billingCondos * monthlyFee;
      const totalRevenue = contractRevenue + recurringRevenue;

      cumulativeSold += input.sales;
      cumulativeContract += contractRevenue;
      cumulativeRecurring += recurringRevenue;
      cumulativeTotal += totalRevenue;

      const margin = computeMargins(
        contractRevenue,
        recurringRevenue,
        taxPct,
        cmvPct,
        cacPct,
        recurringProfitPct
      );
      cumulativeLiquid += margin.liquidCash;

      return {
        monthId: proj.months[i].id,
        label: proj.months[i].label,
        sales: input.sales,
        controllers: input.controllers,
        cumulativeSold,
        billingCondos,
        infraRevenue,
        controllerRevenue,
        contractRevenue,
        recurringRevenue,
        totalRevenue,
        cumulativeContract,
        cumulativeRecurring,
        cumulativeTotal,
        margin: { ...margin, cumulativeLiquid }
      };
    });

    const totalCondos = cumulativeSold;
    const totalControllers = monthInputs.reduce((s, m) => s + m.controllers, 0);
    const periodContract = months.reduce((s, m) => s + m.contractRevenue, 0);
    const periodRecurring = months.reduce((s, m) => s + m.recurringRevenue, 0);
    const periodTotal = months.reduce((s, m) => s + m.totalRevenue, 0);
    const periodLiquid = months.reduce((s, m) => s + m.margin.liquidCash, 0);
    const periodTax = months.reduce((s, m) => s + m.margin.tax, 0);
    const periodCmv = months.reduce((s, m) => s + m.margin.cmv, 0);
    const periodCac = months.reduce((s, m) => s + m.margin.cac, 0);
    const periodRecCost = months.reduce((s, m) => s + m.margin.recurringCost, 0);
    const lastMonth = months[months.length - 1];
    const lastMrr = lastMonth?.recurringRevenue ?? 0;
    const nextMonthMrr = totalCondos * monthlyFee;
    const maxMonthTotal = Math.max(...months.map((m) => m.totalRevenue), 1);
    const liquidMarginPct = periodTotal > 0 ? (periodLiquid / periodTotal) * 100 : 0;
    const exampleTicket = ticketMedio + hint * controllerPrice;

    return {
      months,
      totalCondos,
      totalControllers,
      periodContract,
      periodRecurring,
      periodTotal,
      periodLiquid,
      periodTax,
      periodCmv,
      periodCac,
      periodRecCost,
      liquidMarginPct,
      lastMrr,
      nextMonthMrr,
      lastArr: lastMrr * 12,
      maxMonthTotal,
      exampleTicket
    };
  }, [
    monthInputs,
    ticketMedio,
    controllerPrice,
    monthlyFee,
    taxPct,
    cmvPct,
    cacPct,
    recurringProfitPct,
    hint,
    proj.months
  ]);

  const clearAll = () => setMonthInputs(emptyMonths(proj.months.length));

  return (
    <div className="sc-sales-simulator">
      <div className="card sc-sim-intro">
        <div className="card-title">
          <div>
            <h2>{proj.title}</h2>
            <span>{proj.description}</span>
          </div>
          <button type="button" className="sc-clear-btn" onClick={clearAll}>
            Limpar meses
          </button>
        </div>
        <p className="sc-sim-formula">{proj.formulaNote}</p>
      </div>

      <div className="sc-econ-bar sc-econ-bar-primary">
        <label className="sc-econ-primary">
          Ticket médio / condomínio (R$)
          <input
            type="number"
            min={0}
            step={500}
            value={ticketMedio}
            onChange={(e) => setTicketMedio(Math.max(0, Number(e.target.value) || 0))}
          />
          <small>Infra Smart + instalação (sem controladores)</small>
        </label>
        <label className="sc-econ-primary">
          Preço controlador (R$/un)
          <input
            type="number"
            min={0}
            step={100}
            value={controllerPrice}
            onChange={(e) => setControllerPrice(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label className="sc-econ-primary">
          Mensalidade (R$/cond.)
          <input
            type="number"
            min={0}
            step={50}
            value={monthlyFee}
            onChange={(e) => setMonthlyFee(Math.max(0, Number(e.target.value) || 0))}
          />
          <small>Entra no mês subsequente ao fechamento</small>
        </label>
        <div className="sc-econ-hint">
          <span>Exemplo com {hint} controladores</span>
          <strong>{brl.format(projection.exampleTicket)}/cond.</strong>
          <small>Ticket médio + {hint} × {brl.format(controllerPrice)}</small>
        </div>
      </div>

      <div className="sc-margin-bar">
        <h3>Margens & caixa líquido</h3>
        <p className="sc-sim-formula">{proj.marginNote}</p>
        <div className="sc-margin-fields">
          <label>
            Imposto (% contrato)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={taxPct}
              onChange={(e) => setTaxPct(clampPct(Number(e.target.value)))}
            />
          </label>
          <label>
            CMV (% contrato)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={cmvPct}
              onChange={(e) => setCmvPct(clampPct(Number(e.target.value)))}
            />
          </label>
          <label>
            CAC (% contrato)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={cacPct}
              onChange={(e) => setCacPct(clampPct(Number(e.target.value)))}
            />
          </label>
          <label>
            Lucro mensalidade (%)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={recurringProfitPct}
              onChange={(e) => setRecurringProfitPct(clampPct(Number(e.target.value)))}
            />
          </label>
        </div>
        <div className="sc-margin-summary">
          <span>
            Lucro contrato: <strong>{number.format(contractProfitPct)}%</strong>
          </span>
          <span>
            Custo mensalidade: <strong>{number.format(recurringCostPct)}%</strong>
          </span>
          <span>
            Margem líquida período: <strong>{number.format(projection.liquidMarginPct)}%</strong>
          </span>
        </div>
      </div>

      <div className="guide-kpi-row sc-sim-kpis">
        <div className="guide-kpi-card sc-kpi-highlight">
          <span>Caixa líquido 12 meses</span>
          <strong>{brl.format(projection.periodLiquid)}</strong>
          <small>
            {number.format(projection.liquidMarginPct)}% sobre {brl.format(projection.periodTotal)} faturado
          </small>
        </div>
        <div className="guide-kpi-card">
          <span>Faturamento total</span>
          <strong>{brl.format(projection.periodTotal)}</strong>
          <small>
            {brl.format(projection.periodContract)} contrato + {brl.format(projection.periodRecurring)}{" "}
            mensalidades
          </small>
        </div>
        <div className="guide-kpi-card sc-kpi-costs">
          <span>Custos totais</span>
          <strong>{brl.format(projection.periodTotal - projection.periodLiquid)}</strong>
          <small>
            Imp. {brl.format(projection.periodTax)} · CMV {brl.format(projection.periodCmv)} · CAC{" "}
            {brl.format(projection.periodCac)}
          </small>
        </div>
        <div className="guide-kpi-card">
          <span>MRR mês 12 (na janela)</span>
          <strong>{brl.format(projection.lastMrr)}/mês</strong>
          <small>
            {projection.months[projection.months.length - 1]?.billingCondos ?? 0} cond. faturando · ARR{" "}
            {brl.format(projection.lastArr)}
          </small>
        </div>
        <div className="guide-kpi-card">
          <span>MRR mês seguinte</span>
          <strong>{brl.format(projection.nextMonthMrr)}/mês</strong>
          <small>
            {projection.totalCondos} cond. fechados · inclui vendas do último mês
          </small>
        </div>
      </div>

      <div className="table-wrap sc-input-table-wrap">
        <table className="sc-input-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Condomínios</th>
              <th>Controladores</th>
              <th>Fatur. contrato</th>
              <th>Cond. c/ mensal.</th>
              <th>Mensalidade</th>
              <th>Total mês</th>
              <th>Caixa líquido</th>
            </tr>
          </thead>
          <tbody>
            {projection.months.map((row, i) => (
              <tr key={row.monthId}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    className="sc-cell-input"
                    value={monthInputs[i].sales}
                    onChange={(e) => updateSales(i, Number(e.target.value))}
                    aria-label={`Condomínios ${row.label}`}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    className="sc-cell-input"
                    value={monthInputs[i].controllers}
                    onChange={(e) => updateControllers(i, Number(e.target.value))}
                    aria-label={`Controladores ${row.label}`}
                  />
                </td>
                <td className="cell-contract">{brl.format(row.contractRevenue)}</td>
                <td>{row.billingCondos}</td>
                <td className="cell-recurring">{brl.format(row.recurringRevenue)}</td>
                <td>
                  <strong>{brl.format(row.totalRevenue)}</strong>
                </td>
                <td className="cell-profit">
                  <strong>{brl.format(row.margin.liquidCash)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total 12 meses</strong>
              </td>
              <td>
                <strong>{projection.totalCondos}</strong>
              </td>
              <td>
                <strong>{projection.totalControllers}</strong>
              </td>
              <td className="cell-contract">
                <strong>{brl.format(projection.periodContract)}</strong>
              </td>
              <td>—</td>
              <td className="cell-recurring">
                <strong>{brl.format(projection.periodRecurring)}</strong>
              </td>
              <td>
                <strong>{brl.format(projection.periodTotal)}</strong>
              </td>
              <td className="cell-profit">
                <strong>{brl.format(projection.periodLiquid)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sc-charts-row">
        <div className="sc-chart-panel sc-chart-panel-wide">
          <h3>Faturamento mês a mês</h3>
          <div className="sc-chart-legend">
            <span className="leg-infra">Contrato (ticket médio)</span>
            <span className="leg-ctrl">Contrato (controladores)</span>
            <span className="leg-rec">Mensalidade</span>
          </div>
          <div className="sc-bar-chart sc-bar-chart-12">
            {projection.months.map((row) => {
              const scale = projection.maxMonthTotal;
              const infraH = (row.infraRevenue / scale) * 100;
              const ctrlH = (row.controllerRevenue / scale) * 100;
              const recH = (row.recurringRevenue / scale) * 100;
              return (
                <div className="sc-bar-col" key={row.monthId}>
                  <div className="sc-bar-stack" title={brl.format(row.totalRevenue)}>
                    <div className="sc-bar-seg rec" style={{ height: `${recH}%` }} />
                    <div className="sc-bar-seg ctrl" style={{ height: `${ctrlH}%` }} />
                    <div className="sc-bar-seg infra" style={{ height: `${infraH}%` }} />
                  </div>
                  <span className="sc-bar-label">{row.label}</span>
                  <span className="sc-bar-value">{brl.format(row.totalRevenue)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sc-chart-panel sc-chart-panel-wide sc-chart-margin">
          <h3>Caixa líquido — receita vs custos vs lucro</h3>
          <div className="sc-chart-legend">
            <span className="leg-tax">Imposto</span>
            <span className="leg-cmv">CMV</span>
            <span className="leg-cac">CAC</span>
            <span className="leg-reccost">Custo mensalidade</span>
            <span className="leg-profit">Lucro líquido</span>
          </div>
          <div className="sc-bar-chart sc-bar-chart-12 sc-bar-chart-margin">
            {projection.months.map((row) => {
              const scale = projection.maxMonthTotal;
              const { tax, cmv, cac, recurringCost, profit } = row.margin;
              const taxH = (tax / scale) * 100;
              const cmvH = (cmv / scale) * 100;
              const cacH = (cac / scale) * 100;
              const recCostH = (recurringCost / scale) * 100;
              const profitH = (profit / scale) * 100;
              return (
                <div className="sc-bar-col" key={`margin-${row.monthId}`}>
                  <div
                    className="sc-bar-stack sc-bar-stack-full"
                    title={`Lucro: ${brl.format(profit)} · Receita: ${brl.format(row.totalRevenue)}`}
                  >
                    <div className="sc-bar-seg profit" style={{ height: `${profitH}%` }} />
                    <div className="sc-bar-seg reccost" style={{ height: `${recCostH}%` }} />
                    <div className="sc-bar-seg cac" style={{ height: `${cacH}%` }} />
                    <div className="sc-bar-seg cmv" style={{ height: `${cmvH}%` }} />
                    <div className="sc-bar-seg tax" style={{ height: `${taxH}%` }} />
                  </div>
                  <span className="sc-bar-label">{row.label}</span>
                  <span className="sc-bar-value sc-bar-value-profit">{brl.format(profit)}</span>
                </div>
              );
            })}
          </div>
          <p className="sc-chart-footnote">
            Barras na mesma escala do faturamento — altura total = receita do mês; segmentos = custos
            empilhados + lucro líquido em caixa.
          </p>
        </div>
      </div>

      <div className="table-wrap sc-projection-table-wrap">
        <table className="sc-projection-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Receita</th>
              <th>Imposto</th>
              <th>CMV</th>
              <th>CAC</th>
              <th>Custo rec.</th>
              <th>Lucro líquido</th>
              <th>Acum. caixa</th>
            </tr>
          </thead>
          <tbody>
            {projection.months.map((row) => (
              <tr key={row.monthId}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>{brl.format(row.totalRevenue)}</td>
                <td className="cell-cost">{brl.format(row.margin.tax)}</td>
                <td className="cell-cost">{brl.format(row.margin.cmv)}</td>
                <td className="cell-cost">{brl.format(row.margin.cac)}</td>
                <td className="cell-cost">{brl.format(row.margin.recurringCost)}</td>
                <td className="cell-profit">
                  <strong>{brl.format(row.margin.liquidCash)}</strong>
                </td>
                <td>{brl.format(row.margin.cumulativeLiquid)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total 12 meses</strong>
              </td>
              <td>
                <strong>{brl.format(projection.periodTotal)}</strong>
              </td>
              <td className="cell-cost">{brl.format(projection.periodTax)}</td>
              <td className="cell-cost">{brl.format(projection.periodCmv)}</td>
              <td className="cell-cost">{brl.format(projection.periodCac)}</td>
              <td className="cell-cost">{brl.format(projection.periodRecCost)}</td>
              <td className="cell-profit">
                <strong>{brl.format(projection.periodLiquid)}</strong>
              </td>
              <td>—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
