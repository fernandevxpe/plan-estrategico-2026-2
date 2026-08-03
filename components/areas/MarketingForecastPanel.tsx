"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { chartTheme } from "@/lib/chart-theme";
import type { MarketingRevenueBaseline } from "@/lib/areas/build-marketing-dashboard";
import {
  buildForecast,
  defaultAssumptions,
  type CreativeIntelligence,
  type ForecastAssumptions
} from "@/lib/areas/marketing-ai";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moneyExact = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number, digits = 2) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: digits });

type Scenario = "conservador" | "base" | "otimista";

const SCENARIOS: Array<{ key: Scenario; label: string; hint: string }> = [
  { key: "conservador", label: "Conservador", hint: "Pior quartil observado de cada taxa" },
  { key: "base", label: "Base", hint: "Taxa agregada das coortes maduras" },
  { key: "otimista", label: "Otimista", hint: "Melhor quartil observado de cada taxa" }
];

const FIELDS: Array<{
  key: keyof ForecastAssumptions;
  label: string;
  help: string;
  step: number;
  suffix: string;
  min: number;
}> = [
  { key: "paidSharePct", label: "Fatia da meta via tráfego pago", help: "Quanto da meta o canal precisa entregar", step: 1, suffix: "%", min: 0 },
  { key: "paidTicket", label: "Ticket médio (tráfego pago)", help: "Receita por contrato ganho no canal", step: 250, suffix: "R$", min: 0 },
  { key: "conversationToWonPct", label: "Conversa → contrato", help: "Conversas iniciadas que viram venda", step: 0.1, suffix: "%", min: 0 },
  { key: "clickToConversationPct", label: "Clique → conversa", help: "Cliques externos que viram conversa", step: 0.5, suffix: "%", min: 0 },
  { key: "cpc", label: "Custo por clique externo", help: "CPC pago no Meta", step: 0.05, suffix: "R$", min: 0 },
  { key: "leadTimeDays", label: "Ciclo até o fechamento", help: "Defasagem entre investir e faturar", step: 1, suffix: "dias", min: 0 },
  { key: "spendPerCreative", label: "Verba mensal por criativo", help: "Quanto um criativo absorve por mês antes de saturar", step: 50, suffix: "R$", min: 1 },
  { key: "creativeLifeDays", label: "Vida útil da execução", help: "Dias até a troca, observados nesta conta", step: 1, suffix: "dias", min: 1 }
];

function applyScenario(
  base: ForecastAssumptions,
  baseline: MarketingRevenueBaseline,
  scenario: Scenario
): ForecastAssumptions {
  if (scenario === "base") return base;
  const pessimistic = scenario === "conservador";
  const bands = baseline.bands;
  return {
    ...base,
    /* No cenário ruim o clique custa o quartil caro e converte no quartil fraco. */
    cpc: (pessimistic ? bands.cpc.p75 : bands.cpc.p25) ?? base.cpc,
    clickToConversationPct:
      (pessimistic ? bands.clickToConversationPct.p25 : bands.clickToConversationPct.p75) ??
      base.clickToConversationPct,
    conversationToWonPct:
      (pessimistic ? bands.conversationToWonPct.p25 : bands.conversationToWonPct.p75) ??
      base.conversationToWonPct,
    paidTicket: (pessimistic ? bands.paidTicket.p25 : bands.paidTicket.p75) ?? base.paidTicket
  };
}

export function MarketingForecastPanel({
  baseline,
  intelligence
}: {
  baseline: MarketingRevenueBaseline;
  intelligence: CreativeIntelligence;
}) {
  const base = useMemo(() => defaultAssumptions(baseline, intelligence), [baseline, intelligence]);
  const [scenario, setScenario] = useState<Scenario>("base");
  const [overrides, setOverrides] = useState<Partial<ForecastAssumptions>>({});

  const assumptions = useMemo(
    () => ({ ...applyScenario(base, baseline, scenario), ...overrides }),
    [base, baseline, scenario, overrides]
  );
  const forecast = useMemo(
    () => buildForecast(baseline, assumptions, intelligence),
    [baseline, assumptions, intelligence]
  );

  const revenueSeries = forecast.months.map((row) => ({
    label: row.label.replace("/", "/​"),
    month: row.month,
    exigido: Math.round(row.paidRevenueTarget),
    realizado: row.paidRevenueRealized ?? null,
    status: row.status
  }));

  const investmentSeries = forecast.investmentByMonth.map((row) => ({
    label: row.label.replace("/", "/​"),
    month: row.month,
    necessario: Math.round(row.required),
    realizado: row.realized == null ? null : Math.round(row.realized),
    status: row.status
  }));

  const currentGap = forecast.investmentByMonth.find((row) => row.status === "atual");
  const dirty = Object.keys(overrides).length > 0;

  return (
    <div className="gia-forecast">
      <header className="gia-forecast-head">
        <div>
          <strong>Calculadora de previsão</strong>
          <span>
            Meta &ldquo;{baseline.goalTitle}&rdquo; · caminho reverso da receita até o investimento em mídia
          </span>
        </div>
        <div className="gia-scenarios" role="group" aria-label="Cenário">
          {SCENARIOS.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.hint}
              className={scenario === item.key && !dirty ? "active" : ""}
              onClick={() => {
                setScenario(item.key);
                setOverrides({});
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section className="gia-chain" aria-label="Cadeia reversa da meta">
        {forecast.chain.map((step, index) => (
          <article key={step.step}>
            <span className="gia-chain-step">{index + 1}</span>
            <div>
              <small>{step.step}</small>
              <strong>
                {step.unit === "R$" ? money(step.value) : `${integer(step.value)} ${step.unit}`}
              </strong>
              <em>{step.detail}</em>
            </div>
          </article>
        ))}
      </section>

      <section className="gia-forecast-kpis">
        <article>
          <span>Investimento necessário até dez/26</span>
          <strong>{money(forecast.totals.spendRemaining)}</strong>
          <small>
            {forecast.months.filter((row) => row.status !== "realizado").length} meses em aberto
          </small>
        </article>
        <article>
          <span>Investimento no mês corrente</span>
          <strong className={currentGap && currentGap.required > (currentGap.realized ?? 0) ? "is-alert" : ""}>
            {currentGap ? money(currentGap.required) : "—"}
          </strong>
          <small>
            realizado {currentGap?.realized != null ? money(currentGap.realized) : "R$ 0"} ·{" "}
            {currentGap && currentGap.required > 0
              ? `${decimal(((currentGap.realized ?? 0) / currentGap.required) * 100, 0)}% do plano`
              : "sem exigência"}
          </small>
        </article>
        <article>
          <span>Conversas a gerar</span>
          <strong>{integer(forecast.totals.conversationsRemaining)}</strong>
          <small>
            {integer(forecast.totals.wonRemaining)} contratos a {money(assumptions.paidTicket)}
          </small>
        </article>
        <article>
          <span>Criativos novos no período</span>
          <strong>{integer(forecast.totals.newCreativesRemaining)}</strong>
          <small>
            {Math.max(
              ...forecast.months.filter((row) => row.status !== "realizado").map((row) => row.creativesNeeded),
              0
            )}
            /mês para absorver a verba · pool atual gira {intelligence.renewal.newCreativesPerMonth ?? "—"}/mês na
            vida útil de {decimal(assumptions.creativeLifeDays, 0)} dias
          </small>
        </article>
        <article>
          <span>Retorno implícito</span>
          <strong>
            {forecast.totals.impliedRoas == null ? "—" : `${decimal(forecast.totals.impliedRoas)}×`}
          </strong>
          <small>
            observado nas coortes maduras:{" "}
            {baseline.rates.roasOnMedia == null ? "—" : `${decimal(baseline.rates.roasOnMedia)}×`}
          </small>
        </article>
      </section>

      <div className="gia-forecast-grid">
        <article className="gia-chart">
          <header>
            <strong>Receita de tráfego pago: exigida × realizada</strong>
            <span>Barras em cinza são meses ainda não fechados</span>
          </header>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={revenueSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8edf0" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                tickFormatter={(value) => `R$${integer(Number(value) / 1000)}k`}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={58}
              />
              <Tooltip
                formatter={(value, name) => [value == null ? "—" : money(Number(value)), String(name)]}
                cursor={{ fill: "rgba(109, 40, 217, .06)" }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="exigido" name="Exigido pela meta" fill={chartTheme.amber} radius={[4, 4, 0, 0]}>
                {revenueSeries.map((row) => (
                  <Cell key={row.month} fill={row.status === "realizado" ? "#d9c39a" : chartTheme.amber} />
                ))}
              </Bar>
              <Bar dataKey="realizado" name="Realizado" fill={chartTheme.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="gia-chart">
          <header>
            <strong>Investimento em tráfego: necessário × realizado</strong>
            <span>
              A verba já está deslocada {forecast.assumptions.leadTimeDays.toFixed(0)} dias para trás — é quando
              precisa entrar para virar receita no mês da meta
            </span>
          </header>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={investmentSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8edf0" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                tickFormatter={(value) => `R$${integer(Number(value) / 1000)}k`}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={58}
              />
              <Tooltip
                formatter={(value, name) => [value == null ? "—" : money(Number(value)), String(name)]}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine
                x={investmentSeries.find((row) => row.status === "atual")?.label}
                stroke={chartTheme.slate}
                strokeDasharray="4 4"
                label={{ value: "hoje", fontSize: 10, fill: chartTheme.slate, position: "top" }}
              />
              <Line
                type="monotone"
                dataKey="necessario"
                name="Necessário"
                stroke={chartTheme.amber}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="realizado"
                name="Realizado"
                stroke={chartTheme.purple}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </article>
      </div>

      <section className="gia-assumptions">
        <header>
          <strong>Premissas do cálculo</strong>
          <span>
            Valores partem das coortes maduras. Ajuste para simular — o gráfico e a tabela recalculam na hora.
          </span>
          {dirty ? (
            <button type="button" className="gia-reset" onClick={() => setOverrides({})}>
              Voltar ao cenário {SCENARIOS.find((item) => item.key === scenario)?.label.toLowerCase()}
            </button>
          ) : null}
        </header>
        <div className="gia-assumption-grid">
          {FIELDS.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <input
                type="number"
                inputMode="decimal"
                step={field.step}
                min={field.min}
                value={Number(assumptions[field.key].toFixed(field.step < 1 ? 2 : 0))}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setOverrides((current) => ({
                    ...current,
                    [field.key]: Number.isFinite(next) ? Math.max(field.min, next) : base[field.key]
                  }));
                }}
              />
              <small>
                {field.suffix} · {field.help}
              </small>
            </label>
          ))}
        </div>
      </section>

      <section className="gia-plan-table">
        <header>
          <strong>Plano mês a mês</strong>
          <span>Cada linha lê: para faturar no mês X, invista no mês Y</span>
        </header>
        <div className="table-wrap">
          <table className="marketing-table">
            <thead>
              <tr>
                <th>Mês da receita</th>
                <th>Meta</th>
                <th>Receita paga exigida</th>
                <th>Realizado</th>
                <th>Contratos</th>
                <th>Conversas</th>
                <th>Cliques</th>
                <th>Investir</th>
                <th>Quando investir</th>
                <th>Criativos</th>
              </tr>
            </thead>
            <tbody>
              {forecast.months.map((row) => (
                <tr key={row.month} className={row.status === "realizado" ? "is-past" : undefined}>
                  <td>
                    {row.label}
                    <small>{row.status}</small>
                  </td>
                  <td>{money(row.target)}</td>
                  <td>{money(row.paidRevenueTarget)}</td>
                  <td className={row.gapPct != null && row.gapPct < -20 ? "is-alert" : undefined}>
                    {row.paidRevenueRealized == null ? "—" : money(row.paidRevenueRealized)}
                    {row.gapPct != null ? <small>{decimal(row.gapPct, 0)}%</small> : null}
                  </td>
                  <td>{decimal(row.wonNeeded, 1)}</td>
                  <td>{integer(row.conversationsNeeded)}</td>
                  <td>{integer(row.clicksNeeded)}</td>
                  <td>{row.status === "realizado" ? "—" : money(row.spendNeeded)}</td>
                  <td>{row.status === "realizado" ? "—" : row.investMonthLabel}</td>
                  <td>{row.status === "realizado" ? "—" : row.creativesNeeded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gia-lagpairs">
        <header>
          <strong>De onde saem as taxas</strong>
          <span>
            Conversa e contrato não caem no mesmo mês. Cada par usa a defasagem de{" "}
            {baseline.rates.lagMonths} mês(es), derivada do ciclo mediano de{" "}
            {baseline.rates.leadTimeDays == null ? "—" : `${decimal(baseline.rates.leadTimeDays, 0)} dias`}.
          </span>
        </header>
        <div className="table-wrap">
          <table className="marketing-table">
            <thead>
              <tr>
                <th>Conversas em</th>
                <th>Fechamentos em</th>
                <th>Conversas</th>
                <th>Investido</th>
                <th>Contratos pagos</th>
                <th>Receita paga</th>
                <th>Conversa → contrato</th>
                <th>Mídia por contrato</th>
                <th>Retorno</th>
              </tr>
            </thead>
            <tbody>
              {baseline.lagPairs.map((pair) => (
                <tr key={pair.closeMonth}>
                  <td>{pair.conversationMonth}</td>
                  <td>{pair.closeMonth}</td>
                  <td>{integer(pair.conversations)}</td>
                  <td>{moneyExact(pair.spend)}</td>
                  <td>{pair.paidWonDeals}</td>
                  <td>{money(pair.paidWonRevenue)}</td>
                  <td>{pair.conversationToWonPct == null ? "—" : `${decimal(pair.conversationToWonPct)}%`}</td>
                  <td>{pair.mediaCostPerWon == null ? "—" : money(pair.mediaCostPerWon)}</td>
                  <td>{pair.revenuePerSpend == null ? "—" : `${decimal(pair.revenuePerSpend)}×`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
