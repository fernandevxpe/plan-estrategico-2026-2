"use client";

import { useEffect, useMemo, useState } from "react";
import type { AreaDashboardItem } from "@/lib/areas/types";
import type {
  MarketingDailyCreativeRow,
  MarketingDashboard,
  MarketingPerformanceRow,
  MarketingPeriodKey
} from "@/lib/areas/build-marketing-dashboard";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import { MarketingCreativesTab } from "@/components/areas/MarketingCreativesTab";
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

function dailyWindow(data: MarketingDashboard, period: MarketingPeriodKey) {
  if (/^\d{4}-\d{2}$/.test(period)) return data.daily.filter((row) => row.date.startsWith(period));
  const take =
    period === "last7d" ? 7 : period === "last30d" ? 30 : period === "month" ? 31 : data.daily.length;
  return data.daily.slice(-take);
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

function deliveryLabel(delivery: AdDelivery | undefined) {
  if (!delivery?.firstDate || !delivery.lastDate) return "Sem entrega no período";
  if (delivery.firstDate === delivery.lastDate) {
    return `${delivery.activeDays} dia · ${shortDate(delivery.firstDate)}`;
  }
  return `${delivery.activeDays} dias · ${shortDate(delivery.firstDate)} → ${shortDate(delivery.lastDate)}`;
}

function AdCreativeCard({
  row,
  delivery
}: {
  row: MarketingPerformanceRow;
  delivery?: AdDelivery;
}) {
  const cpc = row.clicks ? row.spend / row.clicks : null;
  const status =
    row.effectiveStatus === "ACTIVE"
      ? "Ativo"
      : row.effectiveStatus?.includes("PAUSED")
        ? "Pausado"
        : row.effectiveStatus ?? "—";

  return (
    <article className="marketing-creative-card">
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
        <p className="marketing-creative-delivery">{deliveryLabel(delivery)}</p>
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
        {row.creative?.permalink ? (
          <a href={row.creative.permalink} target="_blank" rel="noreferrer">
            Abrir publicação ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function MarketingAreaPage({ area, data }: { area: AreaDashboardItem; data: MarketingDashboard }) {
  const [period, setPeriod] = useState<MarketingPeriodKey>("last30d");
  const [view, setView] = useState<"overview" | "creatives">("overview");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "creatives") setView("creatives");
  }, []);
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
  const deliveryByAd = useMemo(() => {
    const dates = new Set(daily.map((row) => row.date));
    return buildAdDeliveryMap(data.adDaily ?? [], dates);
  }, [data.adDaily, daily]);

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
                {data.totals.activeCampaigns} ativas agora
              </span>
            </header>
            <div className="table-wrap">
              <table className="marketing-table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Objetivo</th>
                    <th>Investimento</th>
                    <th>Alcance</th>
                    <th>Cliques</th>
                    <th>Conversas</th>
                    <th>Custo/conversa</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((row) => (
                    <tr key={row.campaignId}>
                      <td>{row.campaignName}</td>
                      <td>{row.objective ?? "—"}</td>
                      <td>{money(row.spend)}</td>
                      <td>{integer(row.reach)}</td>
                      <td>{integer(row.outboundClicks)}</td>
                      <td>{integer(row.conversations)}</td>
                      <td>{row.costPerConversation == null ? "—" : money(row.costPerConversation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="marketing-panel">
            <header>
              <strong>Melhores anúncios</strong>
              <span>Ordenado por investimento no período · entrega e eficiência no card</span>
            </header>
            <div className="marketing-creative-grid">
              {ads.map((row) => (
                <AdCreativeCard
                  key={row.adId}
                  row={row}
                  delivery={row.adId ? deliveryByAd.get(row.adId) : undefined}
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
