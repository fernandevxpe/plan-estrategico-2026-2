"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { chartTheme } from "@/lib/chart-theme";
import { Collapsible } from "@/components/areas/Collapsible";
import { MarketingThumb } from "@/components/areas/MarketingThumb";
import type { CreativeFact, CreativeIntelligence, CreativeVerdict } from "@/lib/areas/marketing-ai";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const moneyShort = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number, digits = 1) => value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value: number | null, digits = 1) => (value == null ? "—" : `${decimal(value, digits)}%`);
const shortDate = (value: string | null) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "—";

const VERDICTS: Array<{ key: CreativeVerdict; label: string; hint: string }> = [
  { key: "escalar", label: "Escalar", hint: "Custo abaixo da mediana e sem desgaste" },
  { key: "manter", label: "Manter", hint: "Dentro da faixa de eficiência da conta" },
  { key: "renovar", label: "Renovar", hint: "Conceito válido, execução cansada" },
  { key: "aposentar", label: "Aposentar", hint: "Custo alto ou nenhum resultado" },
  { key: "observar", label: "Observar", hint: "Amostra insuficiente para decidir" }
];

const FATIGUE_LABEL: Record<CreativeFact["fatigueLevel"], string> = {
  baixa: "Desgaste baixo",
  media: "Desgaste médio",
  alta: "Desgaste alto",
  critica: "Desgaste crítico"
};

function CreativeRow({ item }: { item: CreativeFact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={`gia-verdict-${item.verdict}`}>
        <td>
          <button type="button" className="marketing-link-btn" onClick={() => setOpen((value) => !value)}>
            {item.adName}
          </button>
          <small>
            {item.campaignName}
            {item.isVideo ? " · vídeo" : " · estático"}
          </small>
        </td>
        <td>
          <span className={`gia-badge gia-badge-${item.verdict}`}>
            {VERDICTS.find((entry) => entry.key === item.verdict)?.label}
          </span>
        </td>
        <td>{moneyShort(item.spend)}</td>
        <td>
          {integer(item.results)}
          <small>{item.resultLabel}</small>
        </td>
        <td>{item.costPerResult == null ? "—" : money(item.costPerResult)}</td>
        <td className={item.costIndex != null && item.costIndex > 1.2 ? "is-alert" : undefined}>
          {item.costIndex == null ? "—" : `${decimal(item.costIndex, 2)}×`}
        </td>
        <td>{percent(item.ctr, 2)}</td>
        <td>{item.costPerOutboundClick == null ? "—" : money(item.costPerOutboundClick)}</td>
        <td>{percent(item.conversationPerClickPct)}</td>
        <td>{item.isVideo ? percent(item.video.hold100Pct) : "—"}</td>
        <td>
          {item.estimate.revenue == null ? "—" : moneyShort(item.estimate.revenue)}
          {item.estimate.roas != null ? <small>{decimal(item.estimate.roas)}× est.</small> : null}
        </td>
        <td>
          <span className={`gia-fatigue gia-fatigue-${item.fatigueLevel}`}>{item.fatigueScore}</span>
        </td>
      </tr>
      {open ? (
        <tr className="gia-detail-row">
          <td colSpan={12}>
            <div className="gia-detail">
              {item.thumbnailUrl ? <MarketingThumb url={item.thumbnailUrl} /> : null}
              <div>
                <p className="gia-detail-hook">{item.copy.hook}</p>
                <ul className="gia-tags">
                  {item.copy.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                  <li>{item.copy.chars} caracteres</li>
                  <li>{item.copy.lines} linhas</li>
                </ul>
                <dl className="gia-detail-metrics">
                  <div>
                    <dt>Entrega</dt>
                    <dd>
                      {shortDate(item.firstDate)} → {shortDate(item.lastDate)} · {item.activeDays} dias
                    </dd>
                  </div>
                  <div>
                    <dt>Parado há</dt>
                    <dd>{item.daysSinceLastDelivery == null ? "—" : `${item.daysSinceLastDelivery} dias`}</dd>
                  </div>
                  <div>
                    <dt>Cliques externos</dt>
                    <dd>
                      {integer(item.outboundClicks)} ({percent(item.outboundSharePct, 0)} dos cliques)
                    </dd>
                  </div>
                  {item.isVideo ? (
                    <div>
                      <dt>Retenção</dt>
                      <dd>
                        25% {percent(item.video.hold25Pct, 0)} · 50% {percent(item.video.hold50Pct, 0)} · 75%{" "}
                        {percent(item.video.hold75Pct, 0)} · 100% {percent(item.video.hold100Pct, 0)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Variação de custo</dt>
                    <dd>
                      {item.costDeltaPct == null
                        ? "sem janela suficiente"
                        : `${decimal(item.costDeltaPct, 0)}% entre a 1ª e a 2ª metade da verba`}
                    </dd>
                  </div>
                </dl>
                <ul className="gia-reasons">
                  {item.verdictReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {item.permalink ? (
                  <a href={item.permalink} target="_blank" rel="noreferrer">
                    Abrir publicação ↗
                  </a>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function MarketingCreativeDoctor({ intelligence }: { intelligence: CreativeIntelligence }) {
  const [filter, setFilter] = useState<CreativeVerdict | "todos">("todos");

  const visible = useMemo(() => {
    const list = filter === "todos" ? intelligence.creatives : intelligence.buckets[filter];
    return list.slice(0, 40);
  }, [intelligence, filter]);

  /* Curva de retenção só dos conceitos em vídeo com volume — comparar quatro
     curvas já é o limite do que se lê num gráfico só. */
  const retention = useMemo(() => {
    const concepts = intelligence.concepts
      .filter((concept) => concept.isVideo && concept.videoViews >= 2000)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 4);
    if (!concepts.length) return { series: [], concepts: [] };
    const points = ["View", "25%", "50%", "75%", "100%"];
    const series = points.map((point) => {
      const row: Record<string, string | number | null> = { point };
      for (const concept of concepts) {
        row[concept.conceptId] = concept.retentionCurve.find((entry) => entry.point === point)?.pct ?? null;
      }
      return row;
    });
    return { series, concepts };
  }, [intelligence.concepts]);

  const efficiency = useMemo(
    () =>
      intelligence.weekly
        .filter((window) => window.spend >= 50 && window.conversations > 0)
        .map((window) => ({
          label: window.label.replace("Semana de ", ""),
          key: window.key,
          custo: window.costPerConversation == null ? null : Number(window.costPerConversation.toFixed(2)),
          conversas: window.conversations,
          investido: window.spend
        })),
    [intelligence.weekly]
  );

  /* Só a família de conversa entra no pódio: é a única ligada a receita no CRM.
     Rankear junto com [LP] colocaria no topo criativos de R$ 0,08 por página que
     não têm contrato nenhum atrás — comparação entre denominadores diferentes. */
  const winners = useMemo(() => {
    const pool = intelligence.creatives.filter(
      (item) => item.resultKind === "conversation" && item.results >= 10 && item.costIndex != null
    );
    const list = pool.length
      ? pool
      : intelligence.creatives.filter((item) => item.results >= 10 && item.costIndex != null);
    return [...list].sort((a, b) => (a.costIndex ?? 9) - (b.costIndex ?? 9)).slice(0, 3);
  }, [intelligence.creatives]);

  const colors = [chartTheme.purple, chartTheme.green, chartTheme.amber, chartTheme.purpleMuted];

  return (
    <div className="gia-doctor">
      <section className="gia-buckets" aria-label="Diagnóstico por criativo">
        {VERDICTS.map((entry) => {
          const bucket = intelligence.buckets[entry.key];
          const spend = bucket.reduce((sum, item) => sum + item.spend, 0);
          return (
            <button
              key={entry.key}
              type="button"
              title={entry.hint}
              className={filter === entry.key ? `gia-bucket gia-bucket-${entry.key} active` : `gia-bucket gia-bucket-${entry.key}`}
              onClick={() => setFilter((current) => (current === entry.key ? "todos" : entry.key))}
            >
              <strong>{bucket.length}</strong>
              <span>{entry.label}</span>
              <small>{moneyShort(spend)} investidos</small>
            </button>
          );
        })}
      </section>

      {winners.length ? (
        <>
        <p className="gia-winners-note">
          Pódio restrito às campanhas que entregam conversa iniciada — é a única família com contrato rastreado
          atrás. Criativos de [LP] compram página carregada e aparecem na tabela completa, com o custo medido
          contra a mediana da própria família.
        </p>
        <section className="gia-winners" aria-label="Criativos que mais renderam">
          {winners.map((item, index) => (
            <article key={item.adId}>
              <header>
                <span className="gia-rank">#{index + 1}</span>
                <div>
                  <strong>{item.adName}</strong>
                  <small>{item.campaignName}</small>
                </div>
              </header>
              {item.thumbnailUrl ? <MarketingThumb url={item.thumbnailUrl} /> : null}
              <p>{item.copy.hook}</p>
              <dl>
                <div>
                  <dt>Custo por {item.resultLabel}</dt>
                  <dd>{item.costPerResult == null ? "—" : money(item.costPerResult)}</dd>
                </div>
                <div>
                  <dt>Vs. mediana</dt>
                  <dd>
                    {item.costIndex == null
                      ? "—"
                      : `${decimal((1 - item.costIndex) * 100, 0)}% mais barato`}
                  </dd>
                </div>
                <div>
                  <dt>Resultados</dt>
                  <dd>{integer(item.results)}</dd>
                </div>
                <div>
                  <dt>Receita estimada</dt>
                  <dd>{item.estimate.revenue == null ? "—" : moneyShort(item.estimate.revenue)}</dd>
                </div>
                <div>
                  <dt>CTR</dt>
                  <dd>{percent(item.ctr, 2)}</dd>
                </div>
                <div>
                  <dt>{item.isVideo ? "Assistiu 100%" : "CPC externo"}</dt>
                  <dd>
                    {item.isVideo
                      ? percent(item.video.hold100Pct)
                      : item.costPerOutboundClick == null
                        ? "—"
                        : money(item.costPerOutboundClick)}
                  </dd>
                </div>
              </dl>
              <ul className="gia-tags">
                {item.copy.tags.slice(0, 4).map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
        </>
      ) : null}

      <Collapsible
        title="Retenção de vídeo e eficiência semanal"
        hint="Curva por conceito e custo por conversa semana a semana"
      >
      <div className="gia-chart-grid">
        {retention.concepts.length ? (
          <article className="gia-chart">
            <header>
              <strong>Retenção de vídeo por conceito</strong>
              <span>% de quem começou a assistir e chegou a cada marco</span>
            </header>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={retention.series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf0" vertical={false} />
                <XAxis dataKey="point" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis
                  tickFormatter={(value) => `${value}%`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={44}
                  domain={[0, 100]}
                />
                <Tooltip formatter={(value) => (value == null ? "—" : `${decimal(Number(value))}%`)} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {retention.concepts.map((concept, index) => (
                  <Line
                    key={concept.conceptId}
                    type="monotone"
                    dataKey={concept.conceptId}
                    name={concept.hook.slice(0, 34)}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </article>
        ) : null}

        <article className="gia-chart">
          <header>
            <strong>Eficiência semanal</strong>
            <span>Custo por conversa iniciada — quanto mais baixo, melhor</span>
          </header>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={efficiency} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8edf0" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd" />
              <YAxis
                tickFormatter={(value) => `R$${value}`}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={52}
              />
              <Tooltip
                formatter={(value, name, item) => {
                  if (name !== "Custo por conversa") return [String(value), String(name)];
                  const row = item?.payload as { conversas: number; investido: number } | undefined;
                  return [
                    `${money(Number(value))} · ${row ? `${integer(row.conversas)} conversas com ${moneyShort(row.investido)}` : ""}`,
                    "Custo por conversa"
                  ];
                }}
              />
              <Line
                type="monotone"
                dataKey="custo"
                name="Custo por conversa"
                stroke={chartTheme.purple}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </article>
      </div>
      </Collapsible>

      <Collapsible
        title="Picos e quedas de performance"
        hint="As semanas mais eficientes e as mais caras, com o que estava no ar"
      >
      <section className="gia-windows">
        <article>
          <header>
            <strong>Semanas mais eficientes</strong>
            <span>O que estava no ar quando o custo caiu</span>
          </header>
          <ul>
            {intelligence.bestWindows.map((window) => (
              <li key={window.key}>
                <div>
                  <strong>{window.label}</strong>
                  <span>
                    {money(window.costPerConversation ?? 0)}/conversa · {integer(window.conversations)} conversas ·{" "}
                    {moneyShort(window.spend)}
                  </span>
                </div>
                <p>
                  {window.drivers
                    .slice(0, 3)
                    .map((driver) => `${driver.adName} (${decimal(driver.sharePct, 0)}% da verba)`)
                    .join(" · ") || "sem detalhamento por anúncio"}
                </p>
              </li>
            ))}
          </ul>
        </article>
        <article>
          <header>
            <strong>Semanas mais caras</strong>
            <span>Onde a verba rendeu menos</span>
          </header>
          <ul>
            {intelligence.worstWindows.map((window) => (
              <li key={window.key}>
                <div>
                  <strong>{window.label}</strong>
                  <span>
                    {money(window.costPerConversation ?? 0)}/conversa · {integer(window.conversations)} conversas ·{" "}
                    {moneyShort(window.spend)}
                  </span>
                </div>
                <p>
                  {window.drivers
                    .slice(0, 3)
                    .map((driver) => `${driver.adName} (${decimal(driver.sharePct, 0)}% da verba)`)
                    .join(" · ") || "sem detalhamento por anúncio"}
                </p>
              </li>
            ))}
          </ul>
        </article>
      </section>
      </Collapsible>

      {intelligence.copySignals.length ? (
        <Collapsible
          title="Elementos de copy × custo"
          hint="Custo dos criativos com e sem cada elemento — correlação, não causa"
        >
        <section className="gia-panel">
          <header>
            <strong>Elementos de copy × custo</strong>
            <span>
              Custo por conversa dos criativos com e sem cada elemento. É correlação sobre{" "}
              {intelligence.copySignals[0]?.sample ?? 0} criativos com volume — não prova causa.
            </span>
          </header>
          <div className="table-wrap">
            <table className="marketing-table">
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Criativos com</th>
                  <th>Custo com</th>
                  <th>Criativos sem</th>
                  <th>Custo sem</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {intelligence.copySignals
                  .slice()
                  .sort((a, b) => (b.liftPct ?? -999) - (a.liftPct ?? -999))
                  .map((signal) => (
                    <tr key={signal.feature}>
                      <td>{signal.label}</td>
                      <td>{signal.withAds}</td>
                      <td>{signal.withCost == null ? "—" : money(signal.withCost)}</td>
                      <td>{signal.withoutAds}</td>
                      <td>{signal.withoutCost == null ? "—" : money(signal.withoutCost)}</td>
                      <td className={signal.liftPct != null && signal.liftPct > 0 ? "is-good" : undefined}>
                        {signal.liftPct == null
                          ? "—"
                          : `${signal.liftPct > 0 ? "−" : "+"}${decimal(Math.abs(signal.liftPct), 0)}% de custo`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        </Collapsible>
      ) : null}

      <Collapsible
        title="Todos os criativos com entrega no ano"
        hint="Copy, retenção, custo e o porquê de cada veredito"
        badge={`${intelligence.creatives.length} criativos`}
      >
      <section className="gia-panel">
        <header>
          <strong>Tabela completa</strong>
          <span>
            {visible.length} de {intelligence.creatives.length} · clique no nome para abrir copy, retenção e o
            porquê do veredito
          </span>
          {filter !== "todos" ? (
            <button type="button" className="gia-reset" onClick={() => setFilter("todos")}>
              Limpar filtro
            </button>
          ) : null}
        </header>
        <div className="table-wrap">
          <table className="marketing-table gia-creative-table">
            <thead>
              <tr>
                <th>Criativo</th>
                <th>Veredito</th>
                <th>Investido</th>
                <th>Resultados</th>
                <th>Custo/result.</th>
                <th>Índice</th>
                <th>CTR</th>
                <th>CPC ext.</th>
                <th>Conversa/clique</th>
                <th>Assistiu 100%</th>
                <th>Receita est.</th>
                <th>Desgaste</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <CreativeRow key={item.adId} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </Collapsible>

      <Collapsible
        title="Política de renovação de criativos"
        hint="Vida útil, concentração de verba e cadência sugerida"
      >
      <section className="gia-renewal">
        <header>
          <strong>Política de renovação sugerida</strong>
          <span>Derivada da vida útil observada dos criativos desta conta</span>
        </header>
        <div className="gia-renewal-grid">
          <article>
            <span>Vida útil da execução</span>
            <strong>
              {intelligence.renewal.usefulLifeDays == null
                ? "—"
                : `${decimal(intelligence.renewal.usefulLifeDays, 0)} dias`}
            </strong>
            <small>
              {intelligence.renewal.medianActiveDays == null
                ? "—"
                : `${decimal(intelligence.renewal.medianActiveDays, 0)} dias com entrega efetiva`}
            </small>
          </article>
          <article>
            <span>Mesmo conceito no ar há</span>
            <strong className={(intelligence.renewal.conceptSpanDays ?? 0) > 120 ? "is-alert" : ""}>
              {intelligence.renewal.conceptSpanDays == null
                ? "—"
                : `${decimal(intelligence.renewal.conceptSpanDays, 0)} dias`}
            </strong>
            <small>mediana entre a primeira e a última veiculação do conceito</small>
          </article>
          <article>
            <span>Conceitos que sustentam 80% da verba</span>
            <strong className={intelligence.renewal.conceptsFor80PctSpend <= 3 ? "is-alert" : ""}>
              {intelligence.renewal.conceptsFor80PctSpend}
            </strong>
            <small>
              de {intelligence.renewal.totalConcepts} conceitos distintos ·{" "}
              {intelligence.renewal.adsFor80PctSpend} anúncios
            </small>
          </article>
          <article>
            <span>Conceitos novos por mês</span>
            <strong>{intelligence.renewal.newCreativesPerMonth ?? "—"}</strong>
            <small>
              para girar o pool de {intelligence.renewal.activeConcepts || intelligence.renewal.conceptsFor80PctSpend}{" "}
              conceitos dentro da vida útil
            </small>
          </article>
          <article>
            <span>Já em desgaste</span>
            <strong className={intelligence.renewal.fatiguedCreatives > 0 ? "is-alert" : ""}>
              {intelligence.renewal.fatiguedCreatives}
            </strong>
            <small>score de desgaste ≥ 38</small>
          </article>
          <article>
            <span>Verba mensal por conceito</span>
            <strong>
              {intelligence.renewal.monthlySpendPerCreative == null
                ? "—"
                : moneyShort(intelligence.renewal.monthlySpendPerCreative)}
            </strong>
            <small>
              {intelligence.renewal.medianSpendPerCreative == null
                ? "—"
                : `${moneyShort(intelligence.renewal.medianSpendPerCreative)} na vida toda`}
              {intelligence.renewal.medianResultsPerCreative == null
                ? ""
                : ` · ${decimal(intelligence.renewal.medianResultsPerCreative, 0)} resultados medianos`}
            </small>
          </article>
        </div>
      </section>
      </Collapsible>
    </div>
  );
}
