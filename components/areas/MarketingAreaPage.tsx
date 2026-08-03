"use client";

import { useEffect, useMemo, useState } from "react";
import type { AreaDashboardItem } from "@/lib/areas/types";
import type {
  MarketingDailyCreativeRow,
  MarketingDashboard,
  MarketingPerformanceRow,
  MarketingPeriodKey
} from "@/lib/areas/build-marketing-dashboard";
import {
  adsForCampaign,
  buildAdCampaignIndex,
  buildAdHistory,
  buildCampaignHistory,
  summarizeHistory,
  type MarketingHistoryPoint
} from "@/lib/areas/marketing-history";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import { MarketingCreativesTab } from "@/components/areas/MarketingCreativesTab";
import { MarketingHistoryChart, MarketingHistorySparkline } from "@/components/areas/MarketingHistoryCharts";
import { MarketingTrendChart } from "@/components/areas/MarketingTrendChart";

const BASE_PERIODS: Array<{ key: MarketingPeriodKey; label: string }> = [
  { key: "last7d", label: "7 dias" },
  { key: "last30d", label: "30 dias" },
  { key: "month", label: "Mês atual" },
  { key: "ytd", label: "Ano" }
];

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

type AdDelivery = {
  activeDays: number;
  firstDate: string | null;
  lastDate: string | null;
};

type Focus =
  | { type: "campaign"; id: string; name: string }
  | { type: "ad"; id: string; name: string; campaignName?: string };

function dailyWindow(data: MarketingDashboard, period: MarketingPeriodKey) {
  const syncedDay = data.syncedAt.slice(0, 10);
  const addDays = (iso: string, n: number) => {
    const dt = new Date(`${iso}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };

  let since: string;
  let until: string = syncedDay;
  if (/^\d{4}-\d{2}$/.test(period)) {
    since = `${period}-01`;
    const [y, m] = period.split("-").map(Number) as [number, number];
    const endMonth = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    until = endMonth < syncedDay ? endMonth : syncedDay;
  } else if (period === "last7d") {
    since = addDays(syncedDay, -7);
  } else if (period === "last30d") {
    since = addDays(syncedDay, -30);
  } else if (period === "month") {
    since = `${syncedDay.slice(0, 7)}-01`;
  } else if (period === "ytd") {
    since = `${syncedDay.slice(0, 4)}-01-01`;
  } else {
    return data.daily;
  }

  return data.daily.filter((row) => row.date >= since && row.date <= until);
}

function buildAdDeliveryMap(
  adDaily: MarketingDailyCreativeRow[],
  dates: Set<string>
): Map<string, AdDelivery> {
  const map = new Map<string, { dates: Set<string> }>();
  for (const row of adDaily) {
    if (!dates.has(row.date)) continue;
    if (!(row.spend > 0 || row.impressions > 0 || row.clicks > 0)) continue;
    const bucket = map.get(row.adId) ?? { dates: new Set<string>() };
    bucket.dates.add(row.date);
    map.set(row.adId, bucket);
  }
  const out = new Map<string, AdDelivery>();
  for (const [adId, bucket] of map) {
    const sorted = [...bucket.dates].sort();
    out.set(adId, {
      activeDays: sorted.length,
      firstDate: sorted[0] ?? null,
      lastDate: sorted.at(-1) ?? null
    });
  }
  return out;
}

function deliveryLabel(delivery: AdDelivery | undefined, lifetime?: AdDelivery | null) {
  const source = lifetime?.firstDate ? lifetime : delivery;
  if (!source?.firstDate || !source.lastDate) return "Sem entrega registrada";
  if (source.firstDate === source.lastDate) {
    return `${source.activeDays} dia · ${shortDate(source.firstDate)}`;
  }
  return `${source.activeDays} dias · ${shortDate(source.firstDate)} → ${shortDate(source.lastDate)}`;
}

function AdCreativeCard({
  row,
  delivery,
  lifetime,
  history,
  selected,
  onOpen
}: {
  row: MarketingPerformanceRow;
  delivery?: AdDelivery;
  lifetime?: AdDelivery | null;
  history: MarketingHistoryPoint[];
  selected: boolean;
  onOpen: () => void;
}) {
  const cpc = row.clicks ? row.spend / row.clicks : null;
  const status =
    row.effectiveStatus === "ACTIVE"
      ? "Ativo"
      : row.effectiveStatus?.includes("PAUSED")
        ? "Pausado"
        : row.effectiveStatus ?? "—";

  return (
    <article className={selected ? "marketing-creative-card is-selected" : "marketing-creative-card"}>
      {row.creative?.thumbnailUrl ? (
        <img src={row.creative.thumbnailUrl} alt="" loading="lazy" />
      ) : (
        <div className="marketing-creative-placeholder">Sem miniatura</div>
      )}
      <div>
        <div className="marketing-creative-card-top">
          <span>{row.campaignName}</span>
          <em className={row.effectiveStatus === "ACTIVE" ? "is-on" : ""}>{status}</em>
        </div>
        <strong title={row.adName}>{row.adName}</strong>
        <p className="marketing-creative-delivery">{deliveryLabel(delivery, lifetime)}</p>
        <dl className="marketing-creative-metrics">
          <div>
            <dt>Investido</dt>
            <dd>{money(row.spend)}</dd>
          </div>
          <div>
            <dt>Cliques</dt>
            <dd>{integer(row.outboundClicks || row.clicks)}</dd>
          </div>
          <div>
            <dt>Conversas</dt>
            <dd>{integer(row.conversations)}</dd>
          </div>
          <div>
            <dt>CPC</dt>
            <dd>{cpc == null ? "—" : money(cpc)}</dd>
          </div>
          <div>
            <dt>Custo/conv.</dt>
            <dd>{row.costPerConversation == null ? "—" : money(row.costPerConversation)}</dd>
          </div>
          <div>
            <dt>CTR</dt>
            <dd>{decimal(row.ctr)}%</dd>
          </div>
          <div>
            <dt>Views</dt>
            <dd>{integer(row.videoViews)}</dd>
          </div>
          <div>
            <dt>100% vídeo</dt>
            <dd>{integer(row.video100)}</dd>
          </div>
        </dl>
        <div className="marketing-creative-spark-wrap">
          <div className="marketing-spark-legend">
            <span className="is-spend">Invest.</span>
            <span className="is-clicks">Cliques</span>
            <span className="is-conv">Conversas</span>
            <em>histórico completo</em>
          </div>
          <MarketingHistorySparkline data={history} />
        </div>
        <div className="marketing-creative-actions">
          <button type="button" onClick={onOpen}>
            Ver histórico completo
          </button>
          {row.creative?.permalink ? (
            <a href={row.creative.permalink} target="_blank" rel="noreferrer">
              Publicação ↗
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function FocusPanel({
  focus,
  history,
  campaignAds,
  onClose,
  onOpenAd
}: {
  focus: Focus;
  history: MarketingHistoryPoint[];
  campaignAds: MarketingPerformanceRow[];
  onClose: () => void;
  onOpenAd: (row: MarketingPerformanceRow) => void;
}) {
  const summary = summarizeHistory(history);

  return (
    <section className="marketing-panel marketing-focus-panel" id="marketing-focus">
      <header>
        <div>
          <strong>
            {focus.type === "campaign" ? "Campanha" : "Anúncio"} · {focus.name}
          </strong>
          <span>
            {focus.type === "ad" && focus.campaignName ? `${focus.campaignName} · ` : ""}
            Histórico do lançamento até o último dia com entrega
            {summary.firstDate && summary.lastDate
              ? ` · ${shortDate(summary.firstDate)} → ${shortDate(summary.lastDate)} (${summary.days} dias)`
              : ""}
          </span>
        </div>
        <button type="button" className="marketing-focus-close" onClick={onClose}>
          Fechar
        </button>
      </header>

      <div className="marketing-focus-kpis">
        <article>
          <span>Investido (vida)</span>
          <strong>{money(summary.spend)}</strong>
        </article>
        <article>
          <span>Cliques</span>
          <strong>{integer(summary.outboundClicks || summary.clicks)}</strong>
        </article>
        <article>
          <span>Conversas</span>
          <strong>{integer(summary.conversations)}</strong>
        </article>
        <article>
          <span>CPC</span>
          <strong>{summary.cpc == null ? "—" : money(summary.cpc)}</strong>
        </article>
        <article>
          <span>Custo/conversa</span>
          <strong>
            {summary.costPerConversation == null ? "—" : money(summary.costPerConversation)}
          </strong>
        </article>
      </div>

      <MarketingHistoryChart data={history} height={300} />

      {focus.type === "campaign" ? (
        <div className="marketing-focus-ads">
          <header>
            <strong>Anúncios desta campanha</strong>
            <span>{campaignAds.length} com investimento no período</span>
          </header>
          {campaignAds.length ? (
            <div className="table-wrap">
              <table className="marketing-table">
                <thead>
                  <tr>
                    <th>Anúncio</th>
                    <th>Investimento</th>
                    <th>Cliques</th>
                    <th>Conversas</th>
                    <th>Custo/conv.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {campaignAds.map((row) => (
                    <tr key={row.adId}>
                      <td>{row.adName}</td>
                      <td>{money(row.spend)}</td>
                      <td>{integer(row.outboundClicks || row.clicks)}</td>
                      <td>{integer(row.conversations)}</td>
                      <td>{row.costPerConversation == null ? "—" : money(row.costPerConversation)}</td>
                      <td>
                        <button type="button" className="marketing-link-btn" onClick={() => onOpenAd(row)}>
                          Histórico
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="marketing-empty">Nenhum anúncio com entrega neste recorte de período.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function MarketingAreaPage({ area, data }: { area: AreaDashboardItem; data: MarketingDashboard }) {
  const [period, setPeriod] = useState<MarketingPeriodKey>("last30d");
  const [view, setView] = useState<"overview" | "creatives">("overview");
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "creatives") setView("creatives");
  }, []);

  useEffect(() => {
    setFocus(null);
  }, [period]);

  const monthPeriods = useMemo(
    () =>
      Object.keys(data.periods)
        .filter((key) => /^\d{4}-\d{2}$/.test(key))
        .sort()
        .reverse()
        .map((key) => ({
          key: key as MarketingPeriodKey,
          label: new Date(`${key}-15T12:00:00`)
            .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
            .replace(" de ", "/")
        })),
    [data.periods]
  );
  const periodOptions = [...BASE_PERIODS, ...monthPeriods];
  const metrics = data.periods[period];
  const campaigns = data.campaignPeriods[period].slice().sort((a, b) => b.spend - a.spend);
  const ads = data.adPeriods[period]
    .slice()
    .sort((a, b) => b.spend - a.spend || b.conversations - a.conversations || b.videoViews - a.videoViews)
    .slice(0, 12);
  const daily = useMemo(() => dailyWindow(data, period), [data, period]);
  const adIndex = useMemo(() => buildAdCampaignIndex(data), [data]);
  const deliveryByAd = useMemo(() => {
    const dates = new Set(daily.map((row) => row.date));
    return buildAdDeliveryMap(data.adDaily ?? [], dates);
  }, [data.adDaily, daily]);
  const lifetimeByAd = useMemo(() => {
    const allDates = new Set((data.adDaily ?? []).map((row) => row.date));
    return buildAdDeliveryMap(data.adDaily ?? [], allDates);
  }, [data.adDaily]);

  const adHistoryCache = useMemo(() => {
    const cache = new Map<string, MarketingHistoryPoint[]>();
    for (const row of ads) {
      if (!row.adId) continue;
      cache.set(row.adId, buildAdHistory(data.adDaily ?? [], row.adId));
    }
    return cache;
  }, [ads, data.adDaily]);

  const focusHistory = useMemo(() => {
    if (!focus) return [];
    if (focus.type === "ad") return buildAdHistory(data.adDaily ?? [], focus.id);
    return buildCampaignHistory(data.adDaily ?? [], adIndex, focus.id);
  }, [focus, data.adDaily, adIndex]);

  const focusCampaignAds = useMemo(() => {
    if (!focus || focus.type !== "campaign") return [];
    return adsForCampaign(data.adPeriods[period], focus.id);
  }, [focus, data.adPeriods, period]);

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

  function openCampaign(row: MarketingPerformanceRow) {
    if (!row.campaignId) return;
    setFocus({ type: "campaign", id: row.campaignId, name: row.campaignName ?? "Campanha" });
    requestAnimationFrame(() => document.getElementById("marketing-focus")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function openAd(row: MarketingPerformanceRow) {
    if (!row.adId) return;
    setFocus({
      type: "ad",
      id: row.adId,
      name: row.adName ?? "Anúncio",
      campaignName: row.campaignName
    });
    requestAnimationFrame(() => document.getElementById("marketing-focus")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="marketing-page">
      <div className="marketing-toolbar">
        <div>
          <strong>Meta Ads + Instagram</strong>
          <span>Atualizado em {new Date(data.syncedAt).toLocaleString("pt-BR")}</span>
        </div>
        <div className="marketing-periods" aria-label="Período">
          {periodOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={period === item.key ? "active" : ""}
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <nav className="marketing-tabs" aria-label="Análises de marketing">
        <button type="button" className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
          <strong>Visão geral</strong>
          <span>Conta, campanhas e Instagram</span>
        </button>
        <button type="button" className={view === "creatives" ? "active" : ""} onClick={() => setView("creatives")}>
          <strong>Análise de criativos</strong>
          <span>Ranking, custos, funil e histórico</span>
        </button>
      </nav>

      {view === "creatives" ? (
        <MarketingCreativesTab data={data} period={period} />
      ) : (
        <>
          <section className="marketing-kpis">
            <article>
              <span>Investimento</span>
              <strong>{money(metrics.spend)}</strong>
              <small>{data.totals.activeCampaigns} campanha(s) ativa(s)</small>
            </article>
            <article>
              <span>Alcance</span>
              <strong>{integer(metrics.reach)}</strong>
              <small>
                {integer(metrics.impressions)} impressões · freq. {decimal(metrics.frequency)}
              </small>
            </article>
            <article>
              <span>Cliques externos</span>
              <strong>{integer(metrics.outboundClicks)}</strong>
              <small>
                CTR {decimal(metrics.ctr)}% · CPC {money(metrics.cpc)}
              </small>
            </article>
            <article>
              <span>Páginas carregadas</span>
              <strong>{integer(metrics.landingPageViews)}</strong>
              <small>
                {metrics.costPerLandingPageView == null
                  ? "Sem custo calculável"
                  : `${money(metrics.costPerLandingPageView)} por acesso`}
              </small>
            </article>
            <article>
              <span>Conversas iniciadas</span>
              <strong>{integer(metrics.conversations)}</strong>
              <small>
                {metrics.costPerConversation == null
                  ? "Sem custo calculável"
                  : `${money(metrics.costPerConversation)} por conversa`}
              </small>
            </article>
            <article>
              <span>Visualizações de vídeo</span>
              <strong>{integer(metrics.videoViews)}</strong>
              <small>{integer(metrics.video100)} chegaram a 100%</small>
            </article>
          </section>

          <MarketingTrendChart daily={daily} />

          <section className="marketing-panel">
            <header>
              <strong>Campanhas no período</strong>
              <span>
                {campaigns.length} com entrega · {data.totals.campaigns} cadastradas ·{" "}
                {data.totals.activeCampaigns} ativas agora · clique na campanha para o histórico
              </span>
            </header>
            <div className="table-wrap">
              <table className="marketing-table marketing-campaign-table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Objetivo</th>
                    <th>Investimento</th>
                    <th>Alcance</th>
                    <th>Cliques</th>
                    <th>Conversas</th>
                    <th>Custo/conversa</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((row) => (
                    <tr
                      key={row.campaignId}
                      className={
                        focus?.type === "campaign" && focus.id === row.campaignId ? "is-selected" : undefined
                      }
                    >
                      <td>
                        <button type="button" className="marketing-link-btn" onClick={() => openCampaign(row)}>
                          {row.campaignName}
                        </button>
                      </td>
                      <td>{row.objective ?? "—"}</td>
                      <td>{money(row.spend)}</td>
                      <td>{integer(row.reach)}</td>
                      <td>{integer(row.outboundClicks)}</td>
                      <td>{integer(row.conversations)}</td>
                      <td>{row.costPerConversation == null ? "—" : money(row.costPerConversation)}</td>
                      <td>
                        <button type="button" className="marketing-link-btn" onClick={() => openCampaign(row)}>
                          Histórico
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {focus ? (
            <FocusPanel
              focus={focus}
              history={focusHistory}
              campaignAds={focusCampaignAds}
              onClose={() => setFocus(null)}
              onOpenAd={openAd}
            />
          ) : null}

          <section className="marketing-panel">
            <header>
              <strong>Melhores anúncios</strong>
              <span>Sparkline = vida toda do anúncio · métricas do card = período selecionado</span>
            </header>
            <div className="marketing-creative-grid">
              {ads.map((row) => (
                <AdCreativeCard
                  key={row.adId}
                  row={row}
                  delivery={row.adId ? deliveryByAd.get(row.adId) : undefined}
                  lifetime={row.adId ? lifetimeByAd.get(row.adId) : null}
                  history={row.adId ? adHistoryCache.get(row.adId) ?? [] : []}
                  selected={focus?.type === "ad" && focus.id === row.adId}
                  onOpen={() => openAd(row)}
                />
              ))}
            </div>
          </section>

          <section className="marketing-grid">
            <article className="marketing-panel">
              <header>
                <strong>Instagram @{data.instagram.profile.username}</strong>
                <span>
                  {integer(data.instagram.profile.followers_count)} seguidores ·{" "}
                  {integer(data.instagram.profile.media_count)} publicações
                </span>
              </header>
              <div className="marketing-instagram-grid">
                {media.map((item) => (
                  <a key={item.id} href={item.permalink} target="_blank" rel="noreferrer" className="marketing-media-card">
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="marketing-creative-placeholder">{item.mediaProductType}</div>
                    )}
                    <strong>{integer(item.views)} views</strong>
                    <span>
                      {integer(item.reach)} alcance · {integer(item.interactions)} interações
                    </span>
                    <small>
                      {item.averageWatchTimeMs
                        ? `${decimal(item.averageWatchTimeMs / 1000)}s média`
                        : item.mediaProductType}
                    </small>
                  </a>
                ))}
              </div>
            </article>
            <article className="marketing-panel marketing-attribution">
              <header>
                <strong>Marketing → Pipedrive</strong>
                <span>Atribuição gerencial YTD</span>
              </header>
              <dl>
                <div>
                  <dt>Investimento Meta</dt>
                  <dd>{money(data.attribution.metaSpendYtd)}</dd>
                </div>
                <div>
                  <dt>Ganhos de tráfego pago</dt>
                  <dd>{integer(data.attribution.paidTrafficWonDealsYtd)}</dd>
                </div>
                <div>
                  <dt>Receita ganha</dt>
                  <dd>{money(data.attribution.paidTrafficWonRevenueYtd)}</dd>
                </div>
                <div>
                  <dt>Pipeline aberto</dt>
                  <dd>
                    {integer(data.attribution.paidTrafficOpenDeals)} ·{" "}
                    {money(data.attribution.paidTrafficOpenValue)}
                  </dd>
                </div>
                <div>
                  <dt>Receita / investimento</dt>
                  <dd>
                    {data.attribution.crmRevenueToSpend == null
                      ? "—"
                      : `${decimal(data.attribution.crmRevenueToSpend)}×`}
                  </dd>
                </div>
              </dl>
              <p>{data.attribution.note}</p>
              <div className={`marketing-pixel ${data.pixel.last_fired_time ? "ok" : "pending"}`}>
                <strong>Pixel: {data.pixel.name}</strong>
                <span>
                  {data.pixel.last_fired_time
                    ? `Último evento: ${new Date(data.pixel.last_fired_time).toLocaleString("pt-BR")}`
                    : "Sem evento recente"}
                </span>
                <small>
                  {data.pixel.last_fired_time
                    ? "Pixel ativo · análise baseada no Meta Ads Insights"
                    : "Verificar atividade do Pixel"}
                </small>
              </div>
            </article>
          </section>

          <section className="marketing-panel marketing-quality">
            <header>
              <strong>Confiabilidade e limites</strong>
              <span>Leitura oficial da Meta</span>
            </header>
            <ul>
              {data.dataQuality.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
          <AreaDetailPanel area={area} compact />
        </>
      )}
    </div>
  );
}
