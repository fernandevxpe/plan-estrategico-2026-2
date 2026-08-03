"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AreaDashboardItem } from "@/lib/areas/types";
import type { PresalesDailyRow, PresalesDashboard } from "@/lib/areas/build-presales-dashboard";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";

type Aggregation = "day" | "week" | "month";
type TimelineRow = PresalesDailyRow & { key: string; label: string; gapDays: number };

const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = (value: number | null) => value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const shortDate = (value: string) => new Date(`${value}T12:00:00-03:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const longDate = (value: string) => new Date(`${value}T12:00:00-03:00`).toLocaleDateString("pt-BR");
const sumFields = ["conversations", "contactInitiated", "companyInitiated", "unknownInitiator", "replied", "contactReplied", "open", "resolved", "metaSpend", "metaClicks", "metaLinkClicks", "metaOutboundClicks", "metaLandingPageViews", "metaConversations"] as const;

function groupDate(date: string, aggregation: Aggregation) {
  if (aggregation === "day") return { key: date, label: shortDate(date) };
  if (aggregation === "month") return { key: date.slice(0, 7), label: new Date(`${date.slice(0, 7)}-15T12:00:00-03:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(" de ", "/") };
  const current = new Date(`${date}T12:00:00-03:00`);
  const day = current.getDay() || 7;
  current.setDate(current.getDate() - day + 1);
  const key = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Recife", year: "numeric", month: "2-digit", day: "2-digit" }).format(current);
  return { key, label: `Sem. ${shortDate(key)}` };
}

function aggregate(rows: PresalesDailyRow[], aggregation: Aggregation): TimelineRow[] {
  const grouped = new Map<string, TimelineRow>();
  for (const row of rows) {
    const group = groupDate(row.date, aggregation);
    const current = grouped.get(group.key) ?? { ...row, date: group.key, key: group.key, label: group.label, gapDays: 0, suspectedGap: false, chatwootPerLinkClickPct: null, chatwootPerOutboundClickPct: null, ...Object.fromEntries(sumFields.map((field) => [field, 0])) } as TimelineRow;
    for (const field of sumFields) current[field] += row[field];
    current.gapDays += row.suspectedGap ? 1 : 0;
    current.suspectedGap = current.suspectedGap || row.suspectedGap;
    current.chatwootPerLinkClickPct = current.metaLinkClicks ? current.contactInitiated / current.metaLinkClicks * 100 : null;
    current.chatwootPerOutboundClickPct = current.metaOutboundClicks ? current.contactInitiated / current.metaOutboundClicks * 100 : null;
    grouped.set(group.key, current);
  }
  return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function totalsFor(rows: PresalesDailyRow[]) {
  const totals = Object.fromEntries(sumFields.map((field) => [field, rows.reduce((sum, row) => sum + row[field], 0)])) as Record<(typeof sumFields)[number], number>;
  return {
    ...totals,
    chatwootPerLinkClickPct: totals.metaLinkClicks ? totals.contactInitiated / totals.metaLinkClicks * 100 : null,
    chatwootPerOutboundClickPct: totals.metaOutboundClicks ? totals.contactInitiated / totals.metaOutboundClicks * 100 : null,
    replyCoveragePct: totals.contactInitiated ? totals.contactReplied / totals.contactInitiated * 100 : null,
    suspectedGaps: rows.filter((row) => row.suspectedGap).length
  };
}

export function PresalesAreaPage({ area, data }: { area: AreaDashboardItem; data: PresalesDashboard }) {
  const [period, setPeriod] = useState("all");
  const [aggregation, setAggregation] = useState<Aggregation>("week");
  const months = useMemo(() => [...new Set(data.daily.map((row) => row.date.slice(0, 7)))].sort().reverse(), [data.daily]);
  const filtered = useMemo(() => period === "all" ? data.daily : data.daily.filter((row) => row.date.startsWith(period)), [data.daily, period]);
  const totals = useMemo(() => totalsFor(filtered), [filtered]);
  const timeline = useMemo(() => aggregate(filtered, aggregation), [filtered, aggregation]);
  const monthly = useMemo(() => aggregate(data.daily, "month"), [data.daily]);
  const gapDates = filtered.filter((row) => row.suspectedGap).map((row) => row.date);

  return (
    <div className="presales-page">
      <section className="presales-toolbar">
        <div><strong>Chatwoot + Meta Ads</strong><span>Atualizado em {new Date(data.syncedAt).toLocaleString("pt-BR")}</span></div>
        <div className="presales-periods"><button type="button" className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>Todo histórico</button>{months.map((month) => <button type="button" key={month} className={period === month ? "active" : ""} onClick={() => setPeriod(month)}>{new Date(`${month}-15T12:00:00-03:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(" de ", "/")}</button>)}</div>
      </section>

      <section className="presales-hero">
        <div><span>PRÉ-VENDAS</span><h2>Do clique à conversa real</h2><p>Conversas confirmadas pela primeira mensagem no Chatwoot, comparadas ao tráfego da Meta sem esconder períodos de instabilidade.</p></div>
        <div><strong>{integer(totals.contactInitiated)}</strong><span>conversas iniciadas por contatos</span><small>{data.coverage.since && data.coverage.until ? `${longDate(data.coverage.since)} a ${longDate(data.coverage.until)}` : "Sem cobertura"}</small></div>
      </section>

      <section className="presales-kpis">
        <article><span>Iniciadas pelo contato</span><strong>{integer(totals.contactInitiated)}</strong><small>{percent(totals.contactInitiated / Math.max(totals.conversations, 1) * 100)} de todas as conversas</small></article>
        <article><span>Iniciadas pela empresa</span><strong>{integer(totals.companyInitiated)}</strong><small>Separadas da aquisição espontânea</small></article>
        <article><span>Cliques externos Meta</span><strong>{integer(totals.metaOutboundClicks)}</strong><small>{integer(totals.metaLinkClicks)} cliques no link</small></article>
        <article><span>Chatwoot / clique externo</span><strong>{percent(totals.chatwootPerOutboundClickPct)}</strong><small>Correlação observada, todas as origens</small></article>
        <article><span>Conversas atribuídas Meta</span><strong>{integer(totals.metaConversations)}</strong><small>Janela de atribuição da plataforma</small></article>
        <article className={totals.suspectedGaps ? "warning" : "ok"}><span>Dias suspeitos de lacuna</span><strong>{integer(totals.suspectedGaps)}</strong><small>{totals.suspectedGaps ? "Não tratados como zero real" : "Nenhuma lacuna detectada"}</small></article>
      </section>

      <section className="presales-funnel">
        <article><span>Cliques no anúncio</span><strong>{integer(totals.metaClicks)}</strong><small>100% da interação</small></article>
        <article><span>Cliques no link</span><strong>{integer(totals.metaLinkClicks)}</strong><small>{percent(totals.metaClicks ? totals.metaLinkClicks / totals.metaClicks * 100 : null)} dos cliques</small></article>
        <article><span>Cliques externos</span><strong>{integer(totals.metaOutboundClicks)}</strong><small>{percent(totals.metaLinkClicks ? totals.metaOutboundClicks / totals.metaLinkClicks * 100 : null)} dos cliques no link</small></article>
        <article><span>Conversas reais</span><strong>{integer(totals.contactInitiated)}</strong><small>{percent(totals.chatwootPerOutboundClickPct)} dos cliques externos</small></article>
      </section>

      <section className="presales-controls"><label>Agrupar gráficos<select value={aggregation} onChange={(event) => setAggregation(event.target.value as Aggregation)}><option value="day">Por dia</option><option value="week">Por semana</option><option value="month">Por mês</option></select></label><p>Chatwoot inclui todas as origens. Sem identificador de campanha no contato, a comparação com Meta é gerencial e não atribuição individual.</p></section>

      <section className="presales-grid">
        <article className="presales-panel"><header><strong>Cliques externos × conversas reais</strong><span>{aggregation === "day" ? "Diário" : aggregation === "week" ? "Semanal" : "Mensal"}</span></header><ResponsiveContainer width="100%" height={300}><ComposedChart data={timeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis yAxisId="clicks" /><YAxis yAxisId="chats" orientation="right" /><Tooltip formatter={(value) => integer(Number(value))} /><Bar yAxisId="clicks" dataKey="metaOutboundClicks" name="Cliques externos" fill="#93c5fd" radius={[4, 4, 0, 0]} /><Line yAxisId="chats" type="monotone" dataKey="contactInitiated" name="Conversas reais" stroke="#059669" strokeWidth={3} /></ComposedChart></ResponsiveContainer></article>
        <article className="presales-panel"><header><strong>Meta atribuída × Chatwoot confirmado</strong><span>As contagens não são equivalentes</span></header><ResponsiveContainer width="100%" height={300}><ComposedChart data={timeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={(value) => integer(Number(value))} /><Bar dataKey="metaConversations" name="Conversas atribuídas Meta" fill="#a78bfa" radius={[4, 4, 0, 0]} /><Line type="monotone" dataKey="contactInitiated" name="Iniciadas no Chatwoot" stroke="#059669" strokeWidth={3} /></ComposedChart></ResponsiveContainer></article>
      </section>

      <section className="presales-relationship">
        <article><span>Cliques no link × Chatwoot</span><strong>{data.relationship.linkClicksToChatwootCorrelation?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}</strong><small>Correlação {Math.abs(data.relationship.linkClicksToChatwootCorrelation ?? 0) >= .7 ? "forte" : Math.abs(data.relationship.linkClicksToChatwootCorrelation ?? 0) >= .4 ? "moderada" : "fraca"}</small></article>
        <article><span>Cliques externos × Chatwoot</span><strong>{data.relationship.outboundClicksToChatwootCorrelation?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}</strong><small>Correlação {Math.abs(data.relationship.outboundClicksToChatwootCorrelation ?? 0) >= .7 ? "forte" : Math.abs(data.relationship.outboundClicksToChatwootCorrelation ?? 0) >= .4 ? "moderada" : "fraca"}</small></article>
        <article className="highlight"><span>Meta atribuída × Chatwoot</span><strong>{data.relationship.metaAttributedToChatwootCorrelation?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}</strong><small>{data.relationship.reliableDays} dias analisados · {data.relationship.excludedGapDays} excluídos</small></article>
        <p>{data.relationship.note}</p>
      </section>

      <section className="presales-panel presales-gaps">
        <header><div><strong>Monitoramento de lacunas</strong><span>{gapDates.length} dia(s) suspeito(s) no filtro</span></div><b>{data.coverage.daysWithConversations}/{data.coverage.calendarDays} dias com registros no histórico completo</b></header>
        <p>{data.coverage.note}</p>
        {gapDates.length ? <div>{gapDates.map((date) => <span key={date}>{longDate(date)}</span>)}</div> : <div className="presales-no-gap">Nenhuma lacuna suspeita neste período.</div>}
      </section>

      <section className="presales-panel">
        <header><strong>Resumo mês a mês</strong><span>Base completa disponível</span></header>
        <div className="table-wrap"><table className="presales-table"><thead><tr><th>Mês</th><th>Investimento</th><th>Cliques externos</th><th>Meta atribuída</th><th>Chatwoot real</th><th>Empresa iniciou</th><th>Conversão observada</th><th>Lacunas</th></tr></thead><tbody>{monthly.map((row) => <tr key={row.key}><td>{row.label}</td><td>{money(row.metaSpend)}</td><td>{integer(row.metaOutboundClicks)}</td><td>{integer(row.metaConversations)}</td><td>{integer(row.contactInitiated)}</td><td>{integer(row.companyInitiated)}</td><td>{percent(row.chatwootPerOutboundClickPct)}</td><td className={row.gapDays ? "warning" : "ok"}>{integer(row.gapDays)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="presales-grid">
        <article className="presales-panel presales-method"><header><strong>O que conta como conversa real</strong><span>Critério auditável</span></header><p>A conversa é classificada como iniciada pelo contato somente quando a primeira mensagem pública é recebida. Conversas cuja primeira mensagem foi enviada pela empresa ficam separadas.</p><dl><div><dt>Total no Chatwoot</dt><dd>{integer(totals.conversations)}</dd></div><div><dt>Iniciadas pelo contato</dt><dd>{integer(totals.contactInitiated)}</dd></div><div><dt>Iniciadas pela empresa</dt><dd>{integer(totals.companyInitiated)}</dd></div><div><dt>Contatos com primeira resposta</dt><dd>{percent(totals.replyCoveragePct)}</dd></div></dl></article>
        <article className="presales-panel presales-method"><header><strong>Confiabilidade</strong><span>Sem preenchimento artificial</span></header><p>O Chatwoot começou recentemente e passou por desconexões. Dias sem registro permanecem visíveis e são marcados quando a Meta mostra tráfego ou conversas atribuídas. Nenhum dado pessoal ou conteúdo de mensagem é armazenado nesta plataforma.</p><dl><div><dt>Conta</dt><dd>{data.account.name}</dd></div><div><dt>Caixa</dt><dd>{data.inboxes.map((item) => item.name).join(", ")}</dd></div><div><dt>Início observado</dt><dd>{data.coverage.since ? longDate(data.coverage.since) : "—"}</dd></div><div><dt>Fim observado</dt><dd>{data.coverage.until ? longDate(data.coverage.until) : "—"}</dd></div></dl></article>
      </section>

      <AreaDetailPanel area={area} compact />
    </div>
  );
}
