"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MarketingDashboard, MarketingMetrics, MarketingPerformanceRow, MarketingPeriodKey } from "@/lib/areas/build-marketing-dashboard";
import { MarketingThumb } from "@/components/areas/MarketingThumb";

type Aggregation = "day" | "week" | "month";
type Ranking = "conversations" | "outboundCpc" | "ctr" | "spend" | "video";
type TimelineRow = Pick<MarketingMetrics, "spend" | "clicks" | "linkClicks" | "outboundClicks" | "landingPageViews" | "conversations"> & { key: string; label: string };

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const percent = (value: number | null) => value == null ? "—" : `${decimal(value)}%`;
const ratio = (value: number, total: number) => total ? value / total * 100 : null;
const cost = (spend: number, result: number) => result ? spend / result : null;

function belongsToPeriod(date: string, period: MarketingPeriodKey, syncedAt: string) {
  if (/^\d{4}-\d{2}$/.test(period)) return date.startsWith(period);
  const reference = new Date(syncedAt);
  if (period === "month") return date.startsWith(reference.toISOString().slice(0, 7));
  if (period === "ytd") return date.startsWith(reference.getUTCFullYear().toString());
  const days = period === "last7d" ? 7 : 30;
  return new Date(`${date}T23:59:59Z`) >= new Date(reference.getTime() - days * 86400000);
}

function groupDate(date: string, aggregation: Aggregation) {
  if (aggregation === "day") return { key: date, label: date.slice(5).split("-").reverse().join("/") };
  if (aggregation === "month") return { key: date.slice(0, 7), label: new Date(`${date.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(" de ", "/") };
  const current = new Date(`${date}T12:00:00Z`);
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - day + 1);
  return { key: current.toISOString().slice(0, 10), label: `Sem. ${current.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` };
}

function aggregateTimeline<T extends Pick<MarketingMetrics, "spend" | "clicks" | "linkClicks" | "outboundClicks" | "landingPageViews" | "conversations"> & { date: string }>(rows: T[], aggregation: Aggregation): TimelineRow[] {
  const grouped = new Map<string, TimelineRow>();
  for (const row of rows) {
    const group = groupDate(row.date, aggregation);
    const current = grouped.get(group.key) ?? { key: group.key, label: group.label, spend: 0, clicks: 0, linkClicks: 0, outboundClicks: 0, landingPageViews: 0, conversations: 0 };
    current.spend += row.spend;
    current.clicks += row.clicks;
    current.linkClicks += row.linkClicks;
    current.outboundClicks += row.outboundClicks;
    current.landingPageViews += row.landingPageViews;
    current.conversations += row.conversations;
    grouped.set(group.key, current);
  }
  return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function rankingValue(row: MarketingPerformanceRow, ranking: Ranking) {
  if (ranking === "conversations") return row.conversations;
  if (ranking === "outboundCpc") return cost(row.spend, row.outboundClicks) ?? Number.POSITIVE_INFINITY;
  if (ranking === "ctr") return row.ctr;
  if (ranking === "video") return row.videoViews;
  return row.spend;
}

function CreativeThumb({ row }: { row: MarketingPerformanceRow }) {
  return <MarketingThumb url={row.creative?.thumbnailUrl} alt={`Criativo ${row.adName ?? ""}`} />;
}

export function MarketingCreativesTab({ data, period }: { data: MarketingDashboard; period: MarketingPeriodKey }) {
  const [aggregation, setAggregation] = useState<Aggregation>("week");
  const [ranking, setRanking] = useState<Ranking>("conversations");
  const [query, setQuery] = useState("");
  const [campaign, setCampaign] = useState("all");
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const metrics = data.periods[period];
  const periodDaily = useMemo(() => data.daily.filter((row) => belongsToPeriod(row.date, period, data.syncedAt)), [data, period]);
  const timeline = useMemo(() => aggregateTimeline(periodDaily, aggregation), [periodDaily, aggregation]);
  const campaigns = useMemo(() => [...new Set(data.adPeriods[period].map((row) => row.campaignName).filter(Boolean) as string[])].sort(), [data, period]);

  const visibleAds = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return data.adPeriods[period].filter((row) => {
      if (row.spend <= 0) return false;
      if (campaign !== "all" && row.campaignName !== campaign) return false;
      if (!normalizedQuery) return true;
      return `${row.adName ?? ""} ${row.campaignName ?? ""} ${row.adsetName ?? ""} ${row.creative?.title ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
    });
  }, [data, period, campaign, query]);

  const rankedAds = useMemo(() => visibleAds
    .filter((row) => ranking !== "outboundCpc" || row.outboundClicks >= 10)
    .filter((row) => ranking !== "ctr" || row.impressions >= 1_000)
    .sort((a, b) => ranking === "outboundCpc" ? rankingValue(a, ranking) - rankingValue(b, ranking) : rankingValue(b, ranking) - rankingValue(a, ranking)), [visibleAds, ranking]);
  const selected = visibleAds.find((row) => row.adId === selectedAdId) ?? rankedAds[0] ?? null;
  const selectedDaily = useMemo(() => selected?.adId ? data.adDaily.filter((row) => row.adId === selected.adId && belongsToPeriod(row.date, period, data.syncedAt)) : [], [data, period, selected?.adId]);
  const selectedTimeline = useMemo(() => aggregateTimeline(selectedDaily, aggregation), [selectedDaily, aggregation]);

  const outboundShare = ratio(metrics.outboundClicks, metrics.clicks);
  const landingRate = ratio(metrics.landingPageViews, metrics.outboundClicks);
  const conversationRate = ratio(metrics.conversations, metrics.linkClicks);
  const outboundCpc = cost(metrics.spend, metrics.outboundClicks);

  return (
    <div className="marketing-creatives">
      <section className="marketing-creative-hero">
        <div><span>ANÁLISE DE CRIATIVOS</span><h2>Do investimento à conversa</h2><p>Compare anúncios, encontre os menores custos e acompanhe quando cada peça ganhou ou perdeu eficiência.</p></div>
        <div className="marketing-creative-health"><strong>{integer(visibleAds.length)}</strong><span>criativos com entrega no filtro</span><small>Dados oficiais do Meta Ads Insights</small></div>
      </section>

      <section className="marketing-funnel" aria-label="Funil dos anúncios">
        <article><span>Investimento</span><strong>{money(metrics.spend)}</strong><small>Base do período</small></article>
        <article><span>Cliques no anúncio</span><strong>{integer(metrics.clicks)}</strong><small>CTR {percent(metrics.ctr)}</small></article>
        <article><span>Cliques externos</span><strong>{integer(metrics.outboundClicks)}</strong><small>{percent(outboundShare)} dos cliques · {outboundCpc == null ? "—" : `${money(outboundCpc)}/clique`}</small></article>
        <article><span>Site carregado</span><strong>{integer(metrics.landingPageViews)}</strong><small>{percent(landingRate)} dos cliques externos</small></article>
        <article><span>Conversas iniciadas</span><strong>{integer(metrics.conversations)}</strong><small>{percent(conversationRate)} dos cliques no link · {metrics.costPerConversation == null ? "—" : money(metrics.costPerConversation)}</small></article>
      </section>

      <section className="marketing-panel marketing-creative-controls">
        <div className="marketing-field"><label htmlFor="creative-search">Localizar criativo</label><input id="creative-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, campanha ou conjunto" /></div>
        <div className="marketing-field"><label htmlFor="creative-campaign">Campanha</label><select id="creative-campaign" value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="all">Todas as campanhas</option>{campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        <div className="marketing-field"><label htmlFor="creative-aggregation">Agrupar histórico</label><select id="creative-aggregation" value={aggregation} onChange={(event) => setAggregation(event.target.value as Aggregation)}><option value="day">Por dia</option><option value="week">Por semana</option><option value="month">Por mês</option></select></div>
      </section>

      <section className="marketing-grid">
        <article className="marketing-panel marketing-chart-panel">
          <header><strong>Investimento × cliques externos</strong><span>{aggregation === "day" ? "Diário" : aggregation === "week" ? "Semanal" : "Mensal"}</span></header>
          {timeline.length ? <ResponsiveContainer width="100%" height={300}><ComposedChart data={timeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis yAxisId="money" tickFormatter={(value) => `R$${integer(Number(value))}`} width={64} /><YAxis yAxisId="result" orientation="right" width={42} /><Tooltip formatter={(value, name) => name === "Investimento" ? money(Number(value)) : integer(Number(value))} /><Bar yAxisId="money" dataKey="spend" name="Investimento" fill="#7c3aed" radius={[4, 4, 0, 0]} /><Line yAxisId="result" type="monotone" dataKey="outboundClicks" name="Cliques externos" stroke="#2563eb" strokeWidth={2.5} dot={false} /></ComposedChart></ResponsiveContainer> : <div className="marketing-empty">Sem entrega no período selecionado.</div>}
        </article>
        <article className="marketing-panel marketing-chart-panel">
          <header><strong>Cliques × conversas</strong><span>Eficiência do tráfego</span></header>
          {timeline.length ? <ResponsiveContainer width="100%" height={300}><ComposedChart data={timeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={(value) => integer(Number(value))} /><Bar dataKey="outboundClicks" name="Cliques externos" fill="#d8b4fe" radius={[4, 4, 0, 0]} /><Line type="monotone" dataKey="conversations" name="Conversas iniciadas" stroke="#16a34a" strokeWidth={2.5} /></ComposedChart></ResponsiveContainer> : <div className="marketing-empty">Sem ações no período selecionado.</div>}
        </article>
      </section>

      <section className="marketing-panel">
        <header className="marketing-ranking-header"><div><strong>Ranking de criativos</strong><span>Filtros mínimos evitam destacar anúncios sem volume suficiente</span></div><select aria-label="Critério do ranking" value={ranking} onChange={(event) => setRanking(event.target.value as Ranking)}><option value="conversations">Mais conversas</option><option value="outboundCpc">Menor custo por clique externo</option><option value="ctr">Maior CTR (mín. 1.000 impressões)</option><option value="video">Mais visualizações de vídeo</option><option value="spend">Maior investimento</option></select></header>
        {rankedAds.length ? <div className="marketing-top-creatives">{rankedAds.slice(0, 3).map((row, index) => <button type="button" key={row.adId} className={selected?.adId === row.adId ? "active" : ""} onClick={() => setSelectedAdId(row.adId ?? null)}><span className="marketing-rank">#{index + 1}</span><CreativeThumb row={row} /><div><small>{row.campaignName}</small><strong>{row.adName}</strong><span>{integer(row.conversations)} conversas · {integer(row.outboundClicks)} cliques externos</span><b>{cost(row.spend, row.outboundClicks) == null ? "—" : `${money(cost(row.spend, row.outboundClicks)!)}/clique`}</b></div></button>)}</div> : <div className="marketing-empty">Nenhum criativo atende aos filtros.</div>}

        <div className="table-wrap"><table className="marketing-table marketing-creative-table"><thead><tr><th>Criativo</th><th>Investimento</th><th>Cliques</th><th>Externos</th><th>% externo</th><th>CPC externo</th><th>Site</th><th>Conversas</th><th>Custo/conversa</th><th>CTR</th><th>Acesso</th></tr></thead><tbody>{rankedAds.map((row) => <tr key={row.adId} className={selected?.adId === row.adId ? "selected" : ""}><td><button type="button" onClick={() => setSelectedAdId(row.adId ?? null)}>{row.adName}<small>{row.campaignName}</small></button></td><td>{money(row.spend)}</td><td>{integer(row.clicks)}</td><td>{integer(row.outboundClicks)}</td><td>{percent(ratio(row.outboundClicks, row.clicks))}</td><td>{cost(row.spend, row.outboundClicks) == null ? "—" : money(cost(row.spend, row.outboundClicks)!)}</td><td>{integer(row.landingPageViews)}</td><td>{integer(row.conversations)}</td><td>{row.costPerConversation == null ? "—" : money(row.costPerConversation)}</td><td>{percent(row.ctr)}</td><td>{row.creative?.permalink ? <a href={row.creative.permalink} target="_blank" rel="noreferrer">Ver ↗</a> : "—"}</td></tr>)}</tbody></table></div>
      </section>

      {selected ? <section className="marketing-panel marketing-creative-detail">
        <header><div><strong>Histórico do criativo selecionado</strong><span>{selected.campaignName} · {selected.adsetName}</span></div>{selected.creative?.permalink ? <a href={selected.creative.permalink} target="_blank" rel="noreferrer">Abrir anúncio/publicação ↗</a> : null}</header>
        <div className="marketing-creative-detail-grid">
          <article className="marketing-creative-summary"><CreativeThumb row={selected} /><div><span>{selected.effectiveStatus === "ACTIVE" ? "Ativo" : "Histórico"}</span><h3>{selected.adName}</h3><p>{selected.creative?.body || selected.creative?.title || "Texto do anúncio não disponibilizado pela Meta."}</p><dl><div><dt>Investimento</dt><dd>{money(selected.spend)}</dd></div><div><dt>Cliques externos</dt><dd>{integer(selected.outboundClicks)}</dd></div><div><dt>CPC externo</dt><dd>{cost(selected.spend, selected.outboundClicks) == null ? "—" : money(cost(selected.spend, selected.outboundClicks)!)}</dd></div><div><dt>Conversas</dt><dd>{integer(selected.conversations)}</dd></div><div><dt>Vídeo completo</dt><dd>{integer(selected.video100)}</dd></div></dl></div></article>
          <article className="marketing-chart-panel">{selectedTimeline.length ? <ResponsiveContainer width="100%" height={320}><ComposedChart data={selectedTimeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis yAxisId="money" tickFormatter={(value) => `R$${integer(Number(value))}`} width={64} /><YAxis yAxisId="result" orientation="right" /><Tooltip formatter={(value, name) => name === "Investimento" ? money(Number(value)) : integer(Number(value))} /><Bar yAxisId="money" dataKey="spend" name="Investimento" fill="#8b5cf6" radius={[4, 4, 0, 0]} /><Line yAxisId="result" type="monotone" dataKey="outboundClicks" name="Cliques externos" stroke="#2563eb" strokeWidth={2} dot={false} /><Line yAxisId="result" type="monotone" dataKey="conversations" name="Conversas" stroke="#16a34a" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer> : <div className="marketing-empty">Sem histórico diário para este criativo no período.</div>}</article>
        </div>
      </section> : null}

      <section className="marketing-panel marketing-methodology"><strong>Como interpretar</strong><p>“Cliques no anúncio”, “cliques externos”, “páginas carregadas” e “conversas iniciadas” são etapas diferentes. As conversas seguem a janela de atribuição da Meta e não representam pessoas únicas. Em anúncios com múltiplas ações atribuídas, percentuais individuais podem superar 100%.</p></section>
    </div>
  );
}
