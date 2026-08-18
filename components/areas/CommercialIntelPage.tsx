"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { ChartWithLegend, useLegendToggle } from "@/components/charts/useLegendToggle";
import type { AreaDashboardItem } from "@/lib/areas/types";
import type {
  CommercialIntelDashboard,
  IntelDistributionRow,
  IntelMonth,
  IntelScope
} from "@/lib/areas/build-commercial-intel";
import { resolveExecutiveFindings } from "@/lib/areas/build-commercial-intel-findings";

type Basis = "value" | "deals";
type Lens = "aberto" | "ganho" | "perdido" | "ritmo";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
const num = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00-03:00`)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "")
    .replace(" de ", "/");

/** Paleta alinhada à marca XPE (roxo) + contraste operacional. */
const SERIES = ["#6d28d9", "#8b5cf6", "#14b8a6", "#f59e0b", "#a855f7", "#ef4444", "#64748b", "#84cc16", "#ec4899", "#0f766e"];
const UNTRACKED = "#94a3b8";
const PURPLE = "#6d28d9";
const PURPLE_SOFT = "#c4b5fd";

function DistributionBars({ rows, basis, limit = 8 }: { rows: IntelDistributionRow[]; basis: Basis; limit?: number }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (basis === "value" ? b.value - a.value : b.deals - a.deals)).slice(0, limit),
    [rows, basis, limit]
  );
  const max = Math.max(...sorted.map((row) => (basis === "value" ? row.valuePct : row.dealsPct)), 1);

  if (!sorted.length) return <p className="ci-empty">Sem negócios no período.</p>;

  return (
    <ul className="ci-bars">
      {sorted.map((row, index) => {
        const share = basis === "value" ? row.valuePct : row.dealsPct;
        const untracked = row.key === "Sem tracking" || row.key === "Sem motivo" || row.key === "Sem vendedor";
        return (
          <li key={row.key}>
            <div className="ci-bar-head">
              <span className={untracked ? "ci-bar-name is-gap" : "ci-bar-name"}>{row.key}</span>
              <strong>{pct(share)}</strong>
            </div>
            <div className="ci-bar-track">
              <div
                className="ci-bar-fill"
                style={{
                  width: `${(share / max) * 100}%`,
                  background: untracked ? UNTRACKED : SERIES[index % SERIES.length]
                }}
              />
            </div>
            <small>
              {row.deals} {row.deals === 1 ? "negócio" : "negócios"} · {money(row.value)}
            </small>
          </li>
        );
      })}
    </ul>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <article className={tone ? `ci-stat is-${tone}` : "ci-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function monthsWithData(scope: IntelScope) {
  return scope.months.filter(
    (month) => month.won.deals > 0 || month.lost.deals > 0 || month.created.deals > 0
  );
}

export function CommercialIntelPage({
  area,
  data
}: {
  area: AreaDashboardItem;
  data: CommercialIntelDashboard;
}) {
  const [scopeId, setScopeId] = useState("consultoria");
  const [basis, setBasis] = useState<Basis>("value");
  const [lens, setLens] = useState<Lens>("aberto");

  const scope = data.scopes.find((item) => item.id === scopeId) ?? data.scopes[0];
  const months = useMemo(() => monthsWithData(scope), [scope]);
  const [monthKey, setMonthKey] = useState<string>("ano");
  const selectedMonth: IntelMonth | null =
    monthKey === "ano" ? null : months.find((row) => row.month === monthKey) ?? null;

  const wonRows = selectedMonth ? selectedMonth.won.byChannel : scope.year.won.byChannel;
  const lostReasonRows = selectedMonth ? selectedMonth.lost.byReason : scope.year.lost.byReason;
  const lostChannelRows = selectedMonth ? selectedMonth.lost.byChannel : scope.year.lost.byChannel;
  const wonRelationship = selectedMonth ? selectedMonth.won.relationshipShare : scope.year.won.relationshipShare;
  const cycle = selectedMonth ? selectedMonth.cycle : scope.year.cycle;
  const winRate = selectedMonth ? selectedMonth.winRatePct : scope.year.winRatePct;

  const trend = useMemo(
    () =>
      months.map((row) => ({
        month: row.month,
        label: monthLabel(row.month),
        receita: row.won.value,
        meta: row.goal?.target ?? null,
        atingimento: row.goal?.attainmentPct ?? null,
        ganhos: row.won.deals,
        perdidos: row.lost.deals,
        criados: row.created.deals,
        cicloMediano: row.cycle.medianDays,
        reunioesSemana: row.activities.meetingsPerWeek,
        metaReunioes: row.meetingGoal?.weeklyTarget ?? null,
        winRate: row.winRatePct,
        parcial: row.isPartial
      })),
    [months]
  );

  const lastClosed = trend.filter((row) => !row.parcial).at(-1);
  const goalStreak = useMemo(() => {
    let streak = 0;
    for (const row of [...trend].reverse()) {
      if (row.parcial) continue;
      if (row.atingimento != null && row.atingimento < 100) streak += 1;
      else break;
    }
    return streak;
  }, [trend]);

  const revenueLegend = useLegendToggle();
  const winLossLegend = useLegendToggle();
  const meetingsLegend = useLegendToggle();
  const revenueSeries = useMemo(
    () => [
      { dataKey: "receita", name: "Receita", color: PURPLE, type: "square" as const },
      { dataKey: "meta", name: "Meta", color: "#ef4444", type: "line" as const }
    ],
    []
  );
  const winLossSeries = useMemo(
    () => [
      { dataKey: "ganhos", name: "Ganhos", color: "#14b8a6", type: "square" as const },
      { dataKey: "perdidos", name: "Perdidos", color: "#ef4444", type: "square" as const },
      { dataKey: "winRate", name: "Win rate", color: PURPLE, type: "line" as const }
    ],
    []
  );
  const meetingsSeries = useMemo(
    () => [
      { dataKey: "reunioesSemana", name: "Reuniões/semana", color: PURPLE, type: "square" as const },
      { dataKey: "metaReunioes", name: "Meta/semana", color: "#ef4444", type: "line" as const }
    ],
    []
  );

  const periodDiagnosis = useMemo(
    () =>
      resolveExecutiveFindings({
        monthKey,
        scope,
        yearExecutive: data.executive ?? []
      }),
    [monthKey, scope, data.executive]
  );
  const criticalCount = periodDiagnosis.findings.filter(
    (item) => item.priority === "critica" || item.priority === "alta"
  ).length;
  const [diagOpen, setDiagOpen] = useState(true);

  useEffect(() => {
    setDiagOpen(criticalCount > 0 || periodDiagnosis.findings.length <= 4);
  }, [monthKey, scopeId, criticalCount, periodDiagnosis.findings.length]);

  return (
    <div className="ci-page">
      <section className="ci-toolbar">
        <div>
          <strong>Leitura operacional do CRM</strong>
          <span>
            {data.source} · sync{" "}
            {data.syncedAt ? new Date(data.syncedAt).toLocaleString("pt-BR") : "—"}
          </span>
        </div>
        <div className="ci-switches">
          <div className="ci-seg" role="group" aria-label="Escopo">
            {data.scopes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === scopeId ? "active" : ""}
                onClick={() => setScopeId(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="ci-seg" role="group" aria-label="Base de cálculo">
            <button type="button" className={basis === "value" ? "active" : ""} onClick={() => setBasis("value")}>
              Por R$
            </button>
            <button type="button" className={basis === "deals" ? "active" : ""} onClick={() => setBasis("deals")}>
              Por nº
            </button>
          </div>
        </div>
      </section>

      <section className="ci-periods" aria-label="Período">
        <button type="button" className={monthKey === "ano" ? "active" : ""} onClick={() => setMonthKey("ano")}>
          {data.focusYear} inteiro
        </button>
        {months.map((row) => (
          <button
            key={row.month}
            type="button"
            className={monthKey === row.month ? "active" : ""}
            onClick={() => setMonthKey(row.month)}
          >
            {monthLabel(row.month)}
            {row.isPartial ? <em> parcial</em> : null}
          </button>
        ))}
      </section>

      {periodDiagnosis.findings.length ? (
        <details
          className="ci-fold ci-exec-fold"
          open={diagOpen}
          onToggle={(event) => setDiagOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>
            <span className="ci-fold-title">
              Diagnóstico executivo
              <small>{periodDiagnosis.label}</small>
            </span>
            <span className="ci-fold-meta">
              {criticalCount > 0
                ? `${criticalCount} crítico(s)/alto(s) · ${periodDiagnosis.findings.length} achados`
                : `${periodDiagnosis.findings.length} achados`}
              <em className="ci-fold-action">{diagOpen ? "Encolher" : "Expandir"}</em>
            </span>
          </summary>
          <ol className="ci-exec-list">
            {periodDiagnosis.findings.map((finding) => (
              <li key={finding.id} className={`is-${finding.priority}`}>
                <span className="ci-exec-flag">{finding.priority}</span>
                <div>
                  <strong>{finding.title}</strong>
                  <p>{finding.detail}</p>
                  {finding.channelEfficiency ? (
                    <div className="ci-table-wrap">
                      <table className="ci-table">
                        <thead>
                          <tr>
                            <th>Canal</th>
                            <th className="num">Ganhos</th>
                            <th className="num">Perdidos</th>
                            <th className="num">Win rate</th>
                            <th className="num">Receita</th>
                          </tr>
                        </thead>
                        <tbody>
                          {finding.channelEfficiency.map((row) => (
                            <tr key={row.channel}>
                              <td>{row.channel}</td>
                              <td className="num">{row.won}</td>
                              <td className="num">{row.lost}</td>
                              <td
                                className={
                                  row.winRatePct == null
                                    ? "num"
                                    : row.winRatePct >= 50
                                      ? "num is-ok"
                                      : row.winRatePct < 25
                                        ? "num is-bad"
                                        : "num"
                                }
                              >
                                {pct(row.winRatePct)}
                              </td>
                              <td className="num">{money(row.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {data.dataQuality.length ? (
        <details className="ci-fold">
          <summary>
            Qualidade dos dados
            <span>{data.dataQuality.length} alerta(s)</span>
          </summary>
          <ul className="ci-alerts-list">
            {data.dataQuality.map((alert) => (
              <li key={alert.title} className={`is-${alert.severity}`}>
                <strong>{alert.title}</strong>
                <span>{alert.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="ci-stats">
        <StatCard
          label="Potencial em aberto"
          value={money(scope.openPipeline.value)}
          hint={`${scope.openPipeline.deals} negócios · ${scope.openPipeline.zeroValueDeals} sem valor`}
        />
        <StatCard
          label={selectedMonth ? "Ganhos no mês" : `Ganhos em ${data.focusYear}`}
          value={num(selectedMonth ? selectedMonth.won.deals : scope.year.won.deals)}
          hint={money(selectedMonth ? selectedMonth.won.value : scope.year.won.value)}
        />
        <StatCard
          label={selectedMonth ? "Perdidos no mês" : `Perdidos em ${data.focusYear}`}
          value={num(selectedMonth ? selectedMonth.lost.deals : scope.year.lost.deals)}
          hint={`Win rate ${pct(winRate)}`}
          tone={winRate != null && winRate < 40 ? "warn" : undefined}
        />
        <StatCard
          label="Ciclo de vendas (mediana)"
          value={cycle.medianDays != null ? `${num(cycle.medianDays, 1)} dias` : "—"}
          hint={`Média ${num(cycle.averageDays, 1)} dias · n=${cycle.sample}`}
        />
        <StatCard
          label="Origem em relacionamento"
          value={pct(basis === "value" ? wonRelationship.valuePct : wonRelationship.dealsPct)}
          hint={`${wonRelationship.deals} fechamentos vindos da base`}
          tone="ok"
        />
        <StatCard
          label={lastClosed ? `Meta ${lastClosed.label}` : "Meta do mês"}
          value={pct(lastClosed?.atingimento)}
          hint={
            goalStreak > 1
              ? `${goalStreak} meses seguidos abaixo da meta`
              : lastClosed?.meta
                ? `Meta ${money(lastClosed.meta)}`
                : undefined
          }
          tone={lastClosed?.atingimento != null && lastClosed.atingimento < 100 ? "bad" : "ok"}
        />
      </section>

      <div className="ci-seg ci-lens" role="group" aria-label="Recorte">
        {(["aberto", "ganho", "perdido", "ritmo"] as Lens[]).map((item) => (
          <button key={item} type="button" className={lens === item ? "active" : ""} onClick={() => setLens(item)}>
            {item === "aberto"
              ? "Potencial em aberto"
              : item === "ganho"
                ? "Fechamentos"
                : item === "perdido"
                  ? "Perdas"
                  : "Ritmo e metas"}
          </button>
        ))}
      </div>

      {lens === "aberto" ? (
        <section className="ci-grid">
          <article className="ci-panel">
            <header>
              <h3>Potencial em aberto por canal de origem</h3>
              <span>{basis === "value" ? "Participação no valor em R$" : "Participação na quantidade"}</span>
            </header>
            <DistributionBars rows={scope.openPipeline.byChannel} basis={basis} limit={10} />
          </article>

          <article className="ci-panel">
            <header>
              <h3>Onde o funil está parado</h3>
              <span>Valor em aberto por etapa</span>
            </header>
            <ul className="ci-bars">
              {scope.openPipeline.byStage.map((row, index) => (
                <li key={row.key}>
                  <div className="ci-bar-head">
                    <span className="ci-bar-name">{row.key}</span>
                    <strong>{pct(basis === "value" ? row.valuePct : row.dealsPct)}</strong>
                  </div>
                  <div className="ci-bar-track">
                    <div
                      className="ci-bar-fill"
                      style={{
                        width: `${basis === "value" ? row.valuePct : row.dealsPct}%`,
                        background: SERIES[index % SERIES.length]
                      }}
                    />
                  </div>
                  <small>
                    {row.deals} negócios · {money(row.value)}
                  </small>
                </li>
              ))}
            </ul>
          </article>

          {scope.openPipeline.bySellerChannel.map((seller) => (
            <article className="ci-panel" key={seller.seller}>
              <header>
                <h3>{seller.seller}</h3>
                <span>
                  {seller.deals} negócios · {money(seller.value)} · {pct(seller.relationshipShare.valuePct)} de
                  relacionamento
                </span>
              </header>
              <DistributionBars rows={seller.byChannel} basis={basis} limit={6} />
            </article>
          ))}

          <article className="ci-panel ci-panel-wide">
            <header>
              <h3>Maiores negócios parados</h3>
              <span>Peso individual no potencial em aberto</span>
            </header>
            <div className="ci-table-wrap">
              <table className="ci-table">
                <thead>
                  <tr>
                    <th>Negócio</th>
                    <th>Etapa</th>
                    <th>Vendedor</th>
                    <th>Origem</th>
                    <th className="num">Idade</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {scope.openPipeline.topDeals.map((deal) => (
                    <tr key={deal.id}>
                      <td>{deal.title}</td>
                      <td>{deal.stage}</td>
                      <td>{deal.seller ?? "—"}</td>
                      <td className={deal.channel === "Sem tracking" ? "is-gap" : undefined}>{deal.channel}</td>
                      <td className="num">{deal.ageDays != null ? `${num(deal.ageDays)}d` : "—"}</td>
                      <td className="num">{money(deal.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {lens === "ganho" ? (
        <section className="ci-grid">
          <article className="ci-panel">
            <header>
              <h3>Fechamentos por canal de origem</h3>
              <span>{selectedMonth ? monthLabel(selectedMonth.month) : `${data.focusYear} inteiro`}</span>
            </header>
            <DistributionBars rows={wonRows} basis={basis} limit={10} />
          </article>

          <article className="ci-panel">
            <header>
              <h3>Relacionamento x mídia paga</h3>
              <span>De onde veio a receita fechada</span>
            </header>
            <div className="ci-split">
              <div>
                <strong>{pct(basis === "value" ? wonRelationship.valuePct : wonRelationship.dealsPct)}</strong>
                <span>Base e indicações</span>
              </div>
              <div>
                <strong>
                  {pct(
                    100 - (basis === "value" ? wonRelationship.valuePct : wonRelationship.dealsPct)
                  )}
                </strong>
                <span>Tráfego, site e sem tracking</span>
              </div>
            </div>
            <p className="ci-note">
              O relacionamento sustenta a maior parte dos fechamentos, mas ele é alimentado pela presença digital —
              tratar os dois como concorrentes leva a cortar o topo do funil.
            </p>
          </article>

          <article className="ci-panel ci-panel-wide">
            <header>
              <h3>Fechamentos e receita mês a mês</h3>
              <span>Barras: receita ganha · linha: meta do Pipedrive</span>
            </header>
            <div className="ci-chart">
              <ChartWithLegend
                series={revenueSeries}
                hidden={revenueLegend.hidden}
                onToggle={revenueLegend.toggle}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip
                      formatter={(value: number, name: string) =>
                        name === "Negócios" ? num(value) : money(value)
                      }
                    />
                    <Bar
                      dataKey="receita"
                      name="Receita"
                      radius={[4, 4, 0, 0]}
                      hide={revenueLegend.isHidden("receita")}
                    >
                      {trend.map((row) => (
                        <Cell
                          key={row.month}
                          fill={
                            row.parcial
                              ? PURPLE_SOFT
                              : row.atingimento != null && row.atingimento < 100
                                ? "#f59e0b"
                                : PURPLE
                          }
                        />
                      ))}
                    </Bar>
                    <Line
                      dataKey="meta"
                      name="Meta"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      hide={revenueLegend.isHidden("meta")}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartWithLegend>
            </div>
          </article>
        </section>
      ) : null}

      {lens === "perdido" ? (
        <section className="ci-grid">
          <article className="ci-panel">
            <header>
              <h3>Motivos de perda</h3>
              <span>{selectedMonth ? monthLabel(selectedMonth.month) : `${data.focusYear} inteiro`}</span>
            </header>
            <DistributionBars rows={lostReasonRows} basis="deals" limit={10} />
          </article>

          <article className="ci-panel">
            <header>
              <h3>Perdas por canal de origem</h3>
              <span>Onde o investimento não converte</span>
            </header>
            <DistributionBars rows={lostChannelRows} basis="deals" limit={10} />
          </article>

          <article className="ci-panel ci-panel-wide">
            <header>
              <h3>Ganhos x perdas por mês</h3>
              <span>Win rate na linha</span>
            </header>
            <div className="ci-chart">
              <ChartWithLegend
                series={winLossSeries}
                hidden={winLossLegend.hidden}
                onToggle={winLossLegend.toggle}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number, name: string) => (name === "Win rate" ? pct(value) : num(value))} />
                    <Bar
                      dataKey="ganhos"
                      name="Ganhos"
                      fill="#14b8a6"
                      radius={[4, 4, 0, 0]}
                      hide={winLossLegend.isHidden("ganhos")}
                    />
                    <Bar
                      dataKey="perdidos"
                      name="Perdidos"
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                      hide={winLossLegend.isHidden("perdidos")}
                    />
                    <Line
                      dataKey="winRate"
                      name="Win rate"
                      stroke={PURPLE}
                      strokeWidth={2}
                      dot={false}
                      hide={winLossLegend.isHidden("winRate")}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartWithLegend>
            </div>
          </article>
        </section>
      ) : null}

      {lens === "ritmo" ? (
        <section className="ci-grid">
          <article className="ci-panel ci-panel-wide">
            <header>
              <h3>Reuniões por semana x meta</h3>
              <span>Atividades do tipo Reunião concluídas no Pipedrive</span>
            </header>
            <div className="ci-chart">
              <ChartWithLegend
                series={meetingsSeries}
                hidden={meetingsLegend.hidden}
                onToggle={meetingsLegend.toggle}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => num(value, 1)} />
                    <Bar
                      dataKey="reunioesSemana"
                      name="Reuniões/semana"
                      fill={PURPLE}
                      radius={[4, 4, 0, 0]}
                      hide={meetingsLegend.isHidden("reunioesSemana")}
                    />
                    <Line
                      dataKey="metaReunioes"
                      name="Meta/semana"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      hide={meetingsLegend.isHidden("metaReunioes")}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartWithLegend>
            </div>
          </article>

          <article className="ci-panel ci-panel-wide">
            <header>
              <h3>Ciclo de vendas mês a mês</h3>
              <span>Mediana de dias entre criação e fechamento</span>
            </header>
            <div className="ci-chart">
              <ChartFrame titulo="Ciclo de vendas mês a mês">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => `${num(value, 1)} dias`} />
                    <Bar dataKey="cicloMediano" name="Ciclo mediano" radius={[4, 4, 0, 0]}>
                      {trend.map((row) => (
                        <Cell
                          key={row.month}
                          fill={(row.cicloMediano ?? 0) > 45 ? "#f59e0b" : "#14b8a6"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
          </article>

          <article className="ci-panel ci-panel-wide">
            <header>
              <h3>Placar mensal</h3>
              <span>Meta, realizado, atividade e ciclo lado a lado</span>
            </header>
            <div className="ci-table-wrap">
              <table className="ci-table">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="num">Meta</th>
                    <th className="num">Realizado</th>
                    <th className="num">Atingimento</th>
                    <th className="num">Ganhos</th>
                    <th className="num">Perdidos</th>
                    <th className="num">Win rate</th>
                    <th className="num">Reuniões/sem</th>
                    <th className="num">Ciclo mediano</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((row) => (
                    <tr key={row.month} className={row.parcial ? "is-partial" : undefined}>
                      <td>
                        {row.label}
                        {row.parcial ? <span className="ci-tag">parcial</span> : null}
                      </td>
                      <td className="num">{row.meta ? money(row.meta) : "—"}</td>
                      <td className="num">{money(row.receita)}</td>
                      <td
                        className={
                          row.atingimento == null
                            ? "num"
                            : row.atingimento >= 100
                              ? "num is-ok"
                              : "num is-bad"
                        }
                      >
                        {pct(row.atingimento)}
                      </td>
                      <td className="num">{row.ganhos}</td>
                      <td className="num">{row.perdidos}</td>
                      <td className="num">{pct(row.winRate)}</td>
                      <td className={row.metaReunioes && row.reunioesSemana < row.metaReunioes ? "num is-bad" : "num"}>
                        {num(row.reunioesSemana, 1)}
                        {row.metaReunioes ? <small> / {num(row.metaReunioes, 0)}</small> : null}
                      </td>
                      <td className="num">{row.cicloMediano != null ? `${num(row.cicloMediano, 1)}d` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      <details className="ci-fold">
        <summary>
          Como cada número é apurado
          <span>metodologia</span>
        </summary>
        <dl className="ci-method-list">
          {Object.entries(data.methodology).map(([key, text]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
