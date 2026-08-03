"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AreaDashboardItem } from "@/lib/areas/types";
import type { MarketingDashboard, MarketingPeriodKey } from "@/lib/areas/build-marketing-dashboard";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";

const BASE_PERIODS: Array<{ key: MarketingPeriodKey; label: string }> = [
  { key: "last7d", label: "7 dias" },
  { key: "last30d", label: "30 dias" },
  { key: "month", label: "Mês atual" },
  { key: "ytd", label: "Ano" }
];

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");

export function MarketingAreaPage({ area, data }: { area: AreaDashboardItem; data: MarketingDashboard }) {
  const [period, setPeriod] = useState<MarketingPeriodKey>("last30d");
  const monthPeriods = useMemo(() => Object.keys(data.periods)
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .sort()
    .reverse()
    .map((key) => ({ key: key as MarketingPeriodKey, label: new Date(`${key}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(" de ", "/") })), [data.periods]);
  const periodOptions = [...BASE_PERIODS, ...monthPeriods];
  const metrics = data.periods[period];
  const campaigns = data.campaignPeriods[period].slice().sort((a, b) => b.spend - a.spend);
  const ads = data.adPeriods[period].slice().sort((a, b) => b.videoViews - a.videoViews || b.conversations - a.conversations || b.spend - a.spend).slice(0, 10);
  const media = useMemo(() => {
    const reference = new Date(data.syncedAt);
    const referenceMonth = reference.toISOString().slice(0, 7);
    const referenceYear = reference.getUTCFullYear().toString();
    const cutoffDays = period === "last7d" ? 7 : period === "last30d" ? 30 : null;
    const cutoff = cutoffDays === null ? null : new Date(reference.getTime() - cutoffDays * 86400000);

    return data.instagram.media
      .filter((item) => {
        if (/^\d{4}-\d{2}$/.test(period)) return item.timestamp.startsWith(period);
        if (period === "month") return item.timestamp.startsWith(referenceMonth);
        if (period === "ytd") return item.timestamp.startsWith(referenceYear);
        return cutoff ? new Date(item.timestamp) >= cutoff : true;
      })
      .sort((a, b) => b.views - a.views || b.interactions - a.interactions)
      .slice(0, 12);
  }, [data, period]);
  const daily = /^\d{4}-\d{2}$/.test(period)
    ? data.daily.filter((row) => row.date.startsWith(period))
    : data.daily.slice(-(period === "last7d" ? 7 : period === "last30d" ? 30 : period === "month" ? 31 : 370));

  return (
    <div className="marketing-page">
      <div className="marketing-toolbar">
        <div>
          <strong>Meta Ads + Instagram</strong>
          <span>Atualizado em {new Date(data.syncedAt).toLocaleString("pt-BR")}</span>
        </div>
        <div className="marketing-periods" aria-label="Período">
          {periodOptions.map((item) => <button key={item.key} type="button" className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
        </div>
      </div>

      <section className="marketing-kpis">
        <article><span>Investimento</span><strong>{money(metrics.spend)}</strong><small>{data.totals.activeCampaigns} campanha(s) ativa(s)</small></article>
        <article><span>Alcance</span><strong>{integer(metrics.reach)}</strong><small>{integer(metrics.impressions)} impressões · freq. {decimal(metrics.frequency)}</small></article>
        <article><span>Cliques externos</span><strong>{integer(metrics.outboundClicks)}</strong><small>CTR {decimal(metrics.ctr)}% · CPC {money(metrics.cpc)}</small></article>
        <article><span>Páginas carregadas</span><strong>{integer(metrics.landingPageViews)}</strong><small>{metrics.costPerLandingPageView == null ? "Sem custo calculável" : `${money(metrics.costPerLandingPageView)} por acesso`}</small></article>
        <article><span>Conversas iniciadas</span><strong>{integer(metrics.conversations)}</strong><small>{metrics.costPerConversation == null ? "Sem custo calculável" : `${money(metrics.costPerConversation)} por conversa`}</small></article>
        <article><span>Visualizações de vídeo</span><strong>{integer(metrics.videoViews)}</strong><small>{integer(metrics.video100)} chegaram a 100%</small></article>
      </section>

      <section className="marketing-grid">
        <article className="marketing-panel marketing-chart-panel">
          <header><strong>Cliques e conversas por dia</strong><span>Conta de anúncios</span></header>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} /><YAxis /><Tooltip labelFormatter={date} /><Line type="monotone" dataKey="outboundClicks" name="Cliques externos" stroke="#2563eb" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="conversations" name="Conversas" stroke="#16a34a" strokeWidth={2} dot={false} /></LineChart>
          </ResponsiveContainer>
        </article>
        <article className="marketing-panel marketing-chart-panel">
          <header><strong>Investimento diário</strong><span>R$ por dia</span></header>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} /><YAxis /><Tooltip labelFormatter={date} formatter={(v) => money(Number(v))} /><Bar dataKey="spend" name="Investimento" fill="#7c3aed" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="marketing-panel">
        <header><strong>Campanhas no período</strong><span>{campaigns.length} com entrega · {data.totals.campaigns} cadastradas · {data.totals.activeCampaigns} ativas agora</span></header>
        <div className="table-wrap"><table className="marketing-table"><thead><tr><th>Campanha</th><th>Objetivo</th><th>Investimento</th><th>Alcance</th><th>Cliques</th><th>Conversas</th><th>Custo/conversa</th></tr></thead><tbody>{campaigns.map((row) => <tr key={row.campaignId}><td>{row.campaignName}</td><td>{row.objective ?? "—"}</td><td>{money(row.spend)}</td><td>{integer(row.reach)}</td><td>{integer(row.outboundClicks)}</td><td>{integer(row.conversations)}</td><td>{row.costPerConversation == null ? "—" : money(row.costPerConversation)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="marketing-panel">
        <header><strong>Melhores anúncios e vídeos</strong><span>Ordenado por visualizações, conversas e investimento</span></header>
        <div className="marketing-creative-grid">{ads.map((row) => <article key={row.adId} className="marketing-creative-card">{row.creative?.thumbnailUrl ? <img src={row.creative.thumbnailUrl} alt="" loading="lazy" /> : <div className="marketing-creative-placeholder">Sem miniatura</div>}<div><span>{row.campaignName}</span><strong>{row.adName}</strong><small>{integer(row.videoViews)} views · {integer(row.video100)} completas · {integer(row.conversations)} conversas</small>{row.creative?.permalink ? <a href={row.creative.permalink} target="_blank" rel="noreferrer">Abrir publicação ↗</a> : null}</div></article>)}</div>
      </section>

      <section className="marketing-grid">
        <article className="marketing-panel">
          <header><strong>Instagram @{data.instagram.profile.username}</strong><span>{integer(data.instagram.profile.followers_count)} seguidores · {integer(data.instagram.profile.media_count)} publicações</span></header>
          <div className="marketing-instagram-grid">{media.map((item) => <a key={item.id} href={item.permalink} target="_blank" rel="noreferrer" className="marketing-media-card">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : <div className="marketing-creative-placeholder">{item.mediaProductType}</div>}<strong>{integer(item.views)} views</strong><span>{integer(item.reach)} alcance · {integer(item.interactions)} interações</span><small>{item.averageWatchTimeMs ? `${decimal(item.averageWatchTimeMs / 1000)}s média` : item.mediaProductType}</small></a>)}</div>
        </article>
        <article className="marketing-panel marketing-attribution">
          <header><strong>Marketing → Pipedrive</strong><span>Atribuição gerencial YTD</span></header>
          <dl><div><dt>Investimento Meta</dt><dd>{money(data.attribution.metaSpendYtd)}</dd></div><div><dt>Ganhos de tráfego pago</dt><dd>{integer(data.attribution.paidTrafficWonDealsYtd)}</dd></div><div><dt>Receita ganha</dt><dd>{money(data.attribution.paidTrafficWonRevenueYtd)}</dd></div><div><dt>Pipeline aberto</dt><dd>{integer(data.attribution.paidTrafficOpenDeals)} · {money(data.attribution.paidTrafficOpenValue)}</dd></div><div><dt>Receita / investimento</dt><dd>{data.attribution.crmRevenueToSpend == null ? "—" : `${decimal(data.attribution.crmRevenueToSpend)}×`}</dd></div></dl>
          <p>{data.attribution.note}</p>
          <div className={`marketing-pixel ${data.pixel.statsAvailable ? "ok" : "pending"}`}><strong>Pixel: {data.pixel.name}</strong><span>{data.pixel.last_fired_time ? `Último evento: ${new Date(data.pixel.last_fired_time).toLocaleString("pt-BR")}` : "Sem evento recente"}</span><small>{data.pixel.statsAvailable ? "Eventos detalhados disponíveis" : "Eventos detalhados aguardando permissão somente leitura"}</small></div>
        </article>
      </section>

      <section className="marketing-panel marketing-quality"><header><strong>Confiabilidade e limites</strong><span>Leitura oficial da Meta</span></header><ul>{data.dataQuality.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>
      <AreaDetailPanel area={area} compact />
    </div>
  );
}
