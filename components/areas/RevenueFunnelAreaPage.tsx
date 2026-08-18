"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import type { AreaDashboardItem } from "@/lib/areas/types";
import type { RevenueFunnelDashboard, RevenuePeriodKind, RevenueScope, RevenueSeller } from "@/lib/areas/build-revenue-funnel-dashboard";

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const percent = (value: number | null) => value == null ? "—" : `${decimal.format(value)}%`;
const days = (value: number | null) => value == null ? "—" : `${decimal.format(value)} dias`;
const divide = (value: number, count: number) => count ? value / count : null;

type Props = { area: AreaDashboardItem; data: RevenueFunnelDashboard };

export function RevenueFunnelAreaPage({ data }: Props) {
  const [kind, setKind] = useState<RevenuePeriodKind>("year");
  const [periodKey, setPeriodKey] = useState(String(new Date(data.generatedAt).getFullYear()));
  const [scope, setScope] = useState<RevenueScope>("all");
  const [seller, setSeller] = useState<RevenueSeller>("TEAM");
  const options = useMemo(() => data.periods.filter((period) => period.kind === kind), [data.periods, kind]);

  useEffect(() => {
    if (options.some((period) => period.key === periodKey)) return;
    const nonEmpty = [...options].reverse().find((period) => period.media.spend > 0 || period.segments.some((segment) => segment.opportunities > 0));
    setPeriodKey((nonEmpty ?? options.at(-1))?.key ?? "");
  }, [options, periodKey]);

  const period = data.periods.find((item) => item.kind === kind && item.key === periodKey) ?? options.at(-1);
  const segment = period?.segments.find((item) => item.scope === scope && item.seller === seller);
  if (!period || !segment) return null;

  const spend = period.media.spend;
  const stages = [
    { label: "Cliques externos", source: "Meta Ads", value: period.media.outboundClicks, rate: null, cost: divide(spend, period.media.outboundClicks) },
    { label: "Conversas iniciadas", source: "Chatwoot", value: period.chatwoot.contactInitiated, rate: period.observedRates.outboundToChatwootPct, cost: divide(spend, period.chatwoot.contactInitiated), observed: true },
    { label: "Oportunidades criadas", source: "Pipedrive", value: segment.opportunities, rate: period.observedRates.chatwootToOpportunityPct, cost: divide(spend, segment.opportunities), observed: true },
    { label: "Visitas agendadas", source: "Pipedrive", value: segment.visitsScheduled, rate: segment.rates.opportunityToVisitPct, cost: divide(spend, segment.visitsScheduled) },
    { label: "Propostas elaboradas", source: "Pipedrive", value: segment.proposalsBuilt, rate: segment.rates.visitToProposalPct, cost: divide(spend, segment.proposalsBuilt) },
    { label: "Propostas apresentadas", source: "Pipedrive", value: segment.proposalsPresented, rate: segment.rates.proposalToPresentationPct, cost: divide(spend, segment.proposalsPresented) },
    { label: "Negócios ganhos", source: "Pipedrive", value: segment.won, rate: segment.rates.presentationToWinPct, cost: divide(spend, segment.won) }
  ];
  const roas = spend ? segment.wonValue / spend : null;
  const monthlyTrend = data.periods.filter((item) => item.kind === "month" && item.start >= `${period.start.slice(0, 4)}-01-01` && item.end <= period.end).map((item) => {
    const row = item.segments.find((entry) => entry.scope === scope && entry.seller === seller)!;
    return { label: item.label.split(" de ")[0].slice(0, 3), spend: item.media.spend, conversations: item.chatwoot.contactInitiated, opportunities: row.opportunities, won: row.won };
  });
  const timeRows = [
    ["Oportunidade → visita", segment.stageTimes.opportunityToVisit],
    ["Visita → proposta", segment.stageTimes.visitToProposal],
    ["Proposta → apresentação", segment.stageTimes.proposalToPresentation],
    ["Apresentação → fechamento", segment.stageTimes.presentationToClose],
    ["Ciclo comercial completo", segment.stageTimes.totalToClose]
  ] as const;

  return (
    <div className="revenue-funnel-page">
      <section className="revenue-funnel-toolbar">
        <div><strong>Funil 360°</strong><span>Atualizado em {new Date(data.generatedAt).toLocaleString("pt-BR")}</span></div>
        <div className="revenue-period-kinds">
          {(["month", "quarter", "semester", "year"] as RevenuePeriodKind[]).map((item) => <button type="button" key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item === "month" ? "Mês" : item === "quarter" ? "Trimestre" : item === "semester" ? "Semestre" : "Ano"}</button>)}
        </div>
        <select aria-label="Período" value={period.key} onChange={(event) => setPeriodKey(event.target.value)}>{options.map((item) => <option key={item.key} value={item.key}>{item.label}{item.partial ? " · parcial" : ""}</option>)}</select>
      </section>

      <section className="revenue-funnel-filters">
        <div><span>Escopo</span>{(["all", "consulting", "works"] as RevenueScope[]).map((item) => <button type="button" key={item} className={scope === item ? "active" : ""} onClick={() => setScope(item)}>{item === "all" ? "Total" : item === "consulting" ? "Consultoria" : "Obras"}</button>)}</div>
        <div><span>Responsável</span>{(["TEAM", "GABRIEL", "IGOR"] as RevenueSeller[]).map((item) => <button type="button" key={item} className={seller === item ? "active" : ""} onClick={() => setSeller(item)}>{item === "TEAM" ? "Time" : item[0] + item.slice(1).toLowerCase()}</button>)}</div>
        <p>Mídia e Chatwoot permanecem no total da empresa; escopo e vendedor filtram o Pipedrive.</p>
      </section>

      <section className="revenue-funnel-hero">
        <div><span>Visão consolidada</span><h2>Da verba ao fechamento</h2><p>{period.label} · coorte comercial acompanhada até a última sincronização.</p></div>
        <aside className={period.chatwoot.complete ? "reliable" : "warning"}><strong>{period.chatwoot.complete ? "Cobertura conciliada" : "Cobertura parcial"}</strong><span>Chatwoot em {percent(period.chatwoot.coveragePct)} do período · {period.chatwoot.suspectedGapDays} lacuna(s)</span></aside>
      </section>

      <section className="revenue-kpis">
        <article><span>Investimento em tráfego</span><strong>{money.format(spend)}</strong><small>{period.media.adsDelivered} anúncios veiculados</small></article>
        <article><span>Cliques externos</span><strong>{integer.format(period.media.outboundClicks)}</strong><small>{money.format(divide(spend, period.media.outboundClicks) ?? 0)} por clique</small></article>
        <article><span>Conversas reais</span><strong>{integer.format(period.chatwoot.contactInitiated)}</strong><small>{percent(period.observedRates.outboundToChatwootPct)} dos cliques · observado</small></article>
        <article><span>Negócios ganhos</span><strong>{integer.format(segment.won)}</strong><small>{integer.format(segment.lost)} perdidos · {integer.format(segment.open)} em aberto</small></article>
        <article><span>Receita da coorte</span><strong>{money.format(segment.wonValue)}</strong><small>ticket médio {money.format(segment.averageWonTicket ?? 0)}</small></article>
        <article className="accent"><span>CAC de mídia observado</span><strong>{segment.won ? money.format(spend / segment.won) : "—"}</strong><small>{roas == null ? "ROAS indisponível" : `${decimal.format(roas)}× receita / mídia`}</small></article>
      </section>

      <section className="revenue-main-grid">
        <article className="revenue-funnel-card">
          <header><div><strong>Funil completo</strong><span>Volumes, conversão e custo acumulado por etapa</span></div><b>{period.label}</b></header>
          <div className="revenue-funnel-shape">
            {stages.map((stage, index) => <div className={`revenue-stage ${stage.observed ? "observed" : ""}`} style={{ width: `${100 - index * 8}%` }} key={stage.label}>
              <div><span>{stage.label}<em>{stage.source}</em></span><strong>{integer.format(stage.value)}</strong></div>
              <small>{index === 0 ? "Entrada mensurável" : `${percent(stage.rate)} da etapa anterior${stage.observed ? " · relação observada" : ""}`} · {stage.cost == null ? "custo —" : `${money.format(stage.cost)} por resultado`}</small>
            </div>)}
          </div>
        </article>

        <aside className="revenue-economics-card">
          <header><strong>Economia da aquisição</strong><span>Perdas e pendências incluídas</span></header>
          <dl>
            <div><dt>Custo por oportunidade</dt><dd>{segment.opportunities ? money.format(spend / segment.opportunities) : "—"}</dd></div>
            <div><dt>Custo por visita</dt><dd>{segment.visitsScheduled ? money.format(spend / segment.visitsScheduled) : "—"}</dd></div>
            <div><dt>Custo por proposta apresentada</dt><dd>{segment.proposalsPresented ? money.format(spend / segment.proposalsPresented) : "—"}</dd></div>
            <div><dt>Custo por ciclo encerrado</dt><dd>{segment.won + segment.lost ? money.format(spend / (segment.won + segment.lost)) : "—"}</dd></div>
            <div className="success"><dt>CAC de mídia</dt><dd>{segment.won ? money.format(spend / segment.won) : "—"}</dd></div>
            <div><dt>Conversão dos encerrados</dt><dd>{percent(segment.rates.closedWinPct)}</dd></div>
            <div><dt>Perda da coorte</dt><dd>{percent(segment.rates.cohortLossPct)}</dd></div>
            <div><dt>ROAS da coorte</dt><dd>{roas == null ? "—" : `${decimal.format(roas)}×`}</dd></div>
          </dl>
          <p>CAC completo ainda não é exibido: faltam custos de pessoas, ferramentas e atribuição individual da origem. O valor acima é CAC de mídia observado.</p>
        </aside>
      </section>

      <section className="revenue-time-grid">
        <article className="revenue-time-card"><header><strong>Tempo em cada fase</strong><span>Média, mediana e amostra comprovada no histórico do Pipedrive</span></header><div>{timeRows.map(([label, metric]) => <div key={label}><span>{label}<small>{metric.sample} negócio(s) com datas válidas</small></span><strong>{days(metric.averageDays)}<em>mediana {days(metric.medianDays)}</em></strong></div>)}</div></article>
        <article className="revenue-trend-card"><header><strong>Evolução mensal</strong><span>Investimento × oportunidades × ganhos</span></header><ChartFrame titulo="Funil 360 — evolução mensal"><ResponsiveContainer width="100%" height={320}><ComposedChart data={monthlyTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis yAxisId="count" /><YAxis yAxisId="money" orientation="right" tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} /><Tooltip formatter={(value, name) => name === "Investimento" ? money.format(Number(value)) : integer.format(Number(value))} /><Bar isAnimationActive={false} yAxisId="money" dataKey="spend" name="Investimento" fill="#c4b5fd" radius={[5, 5, 0, 0]} /><Line isAnimationActive={false} yAxisId="count" dataKey="opportunities" name="Oportunidades" stroke="#2563eb" strokeWidth={3} /><Line isAnimationActive={false} yAxisId="count" dataKey="won" name="Ganhos" stroke="#059669" strokeWidth={3} /></ComposedChart></ResponsiveContainer></ChartFrame></article>
      </section>

      <section className="revenue-period-table"><header><strong>Comparativo mês a mês</strong><span>Mesma metodologia de coorte em todos os períodos</span></header><div className="table-wrap"><table><thead><tr><th>Mês</th><th>Investimento</th><th>Anúncios</th><th>Cliques</th><th>Conversas</th><th>Oportunidades</th><th>Visitas</th><th>Propostas</th><th>Ganhos</th><th>Perdidos</th><th>Receita</th><th>CAC mídia</th></tr></thead><tbody>{data.periods.filter((item) => item.kind === "month").map((item) => { const row = item.segments.find((entry) => entry.scope === scope && entry.seller === seller)!; return <tr key={item.key}><td>{item.label}</td><td>{money.format(item.media.spend)}</td><td>{item.media.adsDelivered}</td><td>{integer.format(item.media.outboundClicks)}</td><td>{item.chatwoot.coverageDays ? integer.format(item.chatwoot.contactInitiated) : "sem cobertura"}</td><td>{row.opportunities}</td><td>{row.visitsScheduled}</td><td>{row.proposalsPresented}</td><td>{row.won}</td><td>{row.lost}</td><td>{money.format(row.wonValue)}</td><td>{row.won ? money.format(item.media.spend / row.won) : "—"}</td></tr>; })}</tbody></table></div></section>

      <section className="revenue-methodology"><article><strong>O que é comprovado</strong><p>Meta, Chatwoot e Pipedrive são contados por suas APIs. Do Pipedrive em diante, o funil acompanha negócios criados no período e seu avanço histórico.</p></article><article><strong>O que ainda é observado</strong><p>Cliques → conversas → oportunidades ainda não possuem chave individual comum. As taxas aparecem sinalizadas e podem superar 100% quando a cobertura do Chatwoot é parcial.</p></article><article><strong>Próxima melhoria</strong><p>UTMs, identificador Meta e telefone normalizado permitirão atribuição determinística por campanha, anúncio, criativo e venda.</p></article></section>
    </div>
  );
}
