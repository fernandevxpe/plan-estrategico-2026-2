"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PresalesDashboard, PresalesGestorSection } from "@/lib/areas/build-presales-dashboard";
import { buildPresalesAnalytics } from "@/lib/areas/presales-analytics";

const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");
const decimal = (value: number | null, digits = 1) => value == null ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value: number | null, digits = 1) => value == null ? "—" : `${decimal(value, digits)}%`;
const dateLabel = (date: string) => new Date(`${date}T12:00:00-03:00`).toLocaleDateString("pt-BR");

function Section({ section, defaultOpen }: { section: PresalesGestorSection; defaultOpen: boolean }) {
  return (
    <details className={`gia-section gia-tone-${section.tom ?? "neutro"}`} open={defaultOpen}>
      <summary><span className="collapsible-caret" aria-hidden="true" /><h4>{section.titulo}</h4></summary>
      <div className="gia-section-body">
        {section.paragrafos.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {section.lista?.length ? section.listaOrdenada ? (
          <ol className="gia-section-list">{section.lista.map((item, index) => <li key={index}>{item}</li>)}</ol>
        ) : (
          <ul className="gia-section-list">{section.lista.map((item, index) => <li key={index}>{item}</li>)}</ul>
        ) : null}
        {section.destaque ? <p className="gia-destaque">{section.destaque}</p> : null}
      </div>
    </details>
  );
}

export function PresalesGestorIA({ data }: { data: PresalesDashboard }) {
  const analytics = useMemo(() => buildPresalesAnalytics(data), [data]);
  const bot = data.botAnalytics;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const edition = data.gestorEditions.find((item) => item.date === selectedDate) ?? data.gestorEditions[0] ?? null;
  const stale = edition != null && edition.factsGeneratedAt !== data.syncedAt;

  return (
    <section className="gia presales-gia" id="gestor-ia">
      <header className="gia-hero">
        <div>
          <span className="gia-kicker">GESTOR IA</span>
          <h2>Diagnóstico operacional completo de pré-vendas</h2>
          <p>Um documento versionado por análise, sustentado por indicadores calculados das conversas. Fatos medidos, hipóteses e lacunas de dados ficam separados para orientar a gestão sem criar precisão falsa.</p>
        </div>
        <div className="gia-hero-actions">
          <span className="gia-edition-label">{data.gestorEditions.length} análise(s) registrada(s)</span>
          <div className="gia-editions" role="group" aria-label="Edição da análise">
            {data.gestorEditions.map((item, index) => (
              <button key={item.date} type="button" className={edition?.date === item.date ? "active" : ""} onClick={() => setSelectedDate(item.date)}>
                {dateLabel(item.date)}{index === 0 ? <em>atual</em> : null}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="gia-reliability">
        <header><strong>Leitura executiva dos indicadores disponíveis</strong><span>Chatwoot · todas as origens · horário de Recife</span></header>
        <div className="gia-reliability-grid">
          <article><span>Contatos que iniciaram</span><strong>{integer(analytics.response.eligible)}</strong><small>{percent(data.totals.contactInitiated / Math.max(data.totals.conversations, 1) * 100)} do total</small></article>
          <article><span>Resposta registrada</span><strong>{percent(analytics.response.coveragePct)}</strong><small>{integer(analytics.response.unanswered)} sem primeira resposta</small></article>
          <article><span>Mediana até resposta</span><strong>{decimal(analytics.response.medianMinutes, 2)} min</strong><small>P90: {decimal(analytics.response.p90Minutes, 2)} min</small></article>
          <article><span>Até 5 minutos</span><strong>{percent(analytics.response.within5Pct)}</strong><small>indício forte de automação</small></article>
          <article><span>Contatos ainda abertos</span><strong>{integer(analytics.backlog.openContacts)}</strong><small>{percent(analytics.backlog.openPct)} das entradas</small></article>
          <article><span>Demanda mensal base</span><strong>{integer(analytics.demand.monthlyRunRate)}</strong><small>run rate sem dias suspeitos</small></article>
        </div>
        <ul className="gia-caveats">
          <li>“Primeira resposta” é o evento do Chatwoot e pode ser bot. A base atual não identifica a primeira intervenção humana.</li>
          <li>“Em aberto” é o status atual, não prova que o lead esteja em atendimento. O volume exige uma política explícita de encerramento.</li>
          <li>O Chatwoot não contém conteúdo no artefato. A memória separada do bot permite classificação qualitativa agregada, mas ainda não prova atendimento humano, follow-up ou oportunidade no Pipedrive.</li>
        </ul>
      </section>

      <section className="presales-demand-strip">
        <article><span>Por dia</span><strong>{decimal(analytics.demand.perCalendarDay)}</strong><small>média em dias confiáveis</small></article>
        <article><span>Por semana</span><strong>{decimal(analytics.demand.weeklyRunRate)}</strong><small>demanda operacional esperada</small></article>
        <article><span>Por mês</span><strong>{integer(analytics.demand.monthlyRunRate)}</strong><small>run rate de 30,44 dias</small></article>
        <article><span>Faixa para 30 dias</span><strong>{integer(analytics.demand.forecast30Low)}–{integer(analytics.demand.forecast30Base)}</strong><small>calendário × ritmo de dia ativo</small></article>
        <article><span>Pico diário</span><strong>{analytics.demand.peakDay ? integer(analytics.demand.peakDay.conversations) : "—"}</strong><small>{analytics.demand.peakDay ? dateLabel(analytics.demand.peakDay.date) : "sem base"}</small></article>
      </section>

      <section className="gia-chart-grid">
        <article className="gia-chart">
          <header><strong>Quando os contatos iniciam</strong><span>Volume por hora; dimensiona cobertura, não qualidade</span></header>
          <ResponsiveContainer width="100%" height={280}><ComposedChart data={analytics.hourly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" interval={2} /><YAxis /><Tooltip formatter={(value) => integer(Number(value))} /><Bar dataKey="conversations" name="Novas conversas" fill="#34d399" radius={[4, 4, 0, 0]} /><Line type="monotone" dataKey="unanswered" name="Sem resposta" stroke="#dc2626" strokeWidth={2} /></ComposedChart></ResponsiveContainer>
        </article>
        <article className="gia-chart">
          <header><strong>Demanda por dia da semana</strong><span>Novas conversas e não respondidas</span></header>
          <ResponsiveContainer width="100%" height={280}><ComposedChart data={analytics.weekdays}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={(value) => integer(Number(value))} /><Bar dataKey="conversations" name="Novas conversas" fill="#60a5fa" radius={[4, 4, 0, 0]} /><Line type="monotone" dataKey="unanswered" name="Sem resposta" stroke="#dc2626" strokeWidth={2} /></ComposedChart></ResponsiveContainer>
        </article>
      </section>

      {bot ? (
        <section className="presales-bot-intelligence">
          <header><div><span className="gia-kicker">ANÁLISE QUALITATIVA DO BOT</span><h3>O que os diálogos revelam</h3><p>{bot.scopeNote}</p></div><small>Atualizado em {new Date(bot.generatedAt).toLocaleString("pt-BR")}</small></header>
          <div className="presales-demand-strip">
            <article><span>Sessões analisadas</span><strong>{integer(bot.totals.sessions)}</strong><small>{integer(bot.totals.messages)} mensagens</small></article>
            <article><span>Interações do contato</span><strong>{decimal(bot.conversationShape.medianHumanTurns, 0)}</strong><small>mediana · P75 {decimal(bot.conversationShape.p75HumanTurns, 0)}</small></article>
            <article><span>Parou no 1º turno</span><strong>{percent(bot.conversationShape.oneTurnAwaitingAnswerPct)}</strong><small>{integer(bot.conversationShape.oneTurnAwaitingAnswer)} sessões aguardando resposta</small></article>
            <article><span>Terminou com pergunta do bot</span><strong>{percent(bot.conversationShape.endsAwaitingAnswerPct)}</strong><small>{integer(bot.conversationShape.endsAwaitingAnswer)} sessões</small></article>
            <article><span>Handoff sinalizado</span><strong>{percent(bot.outcomeSignals[0]?.sessionsPct ?? null)}</strong><small>sinal textual, não transferência provada</small></article>
          </div>
          <section className="gia-chart-grid">
            <article className="gia-chart"><header><strong>Objetivos e temas detectados</strong><span>Categorias se sobrepõem</span></header><ResponsiveContainer width="100%" height={290}><ComposedChart data={bot.objectives} layout="vertical" margin={{ left: 26 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => integer(Number(value))} /><Bar dataKey="count" name="Sessões" fill="#14b8a6" radius={[0, 4, 4, 0]} /></ComposedChart></ResponsiveContainer></article>
            <article className="gia-chart"><header><strong>Sinais de objeção</strong><span>Detecção conservadora por palavras-chave</span></header><ResponsiveContainer width="100%" height={290}><ComposedChart data={bot.objections} layout="vertical" margin={{ left: 18 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="label" width={128} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => integer(Number(value))} /><Bar dataKey="count" name="Sessões" fill="#f59e0b" radius={[0, 4, 4, 0]} /></ComposedChart></ResponsiveContainer></article>
          </section>
          <div className="presales-bot-reading">
            <article><strong>Perfil declarado</strong><ul>{bot.profiles.map((item) => <li key={item.label}><span>{item.label}</span><b>{integer(item.count)} · {percent(item.sessionsPct)}</b></li>)}</ul></article>
            <article><strong>Sinais de avanço</strong><ul>{bot.outcomeSignals.map((item) => <li key={item.label}><span>{item.label}</span><b>{integer(item.count)} · {percent(item.sessionsPct)}</b></li>)}</ul></article>
          </div>
          <p className="presales-bot-method">{bot.methodNote} “Terminou com pergunta” é proxy de conversa interrompida: a memória alterna contato/bot, mas não registra tempo, atendimento humano nem desfecho comercial.</p>
        </section>
      ) : <div className="gia-alert"><strong>Análise qualitativa indisponível.</strong><span>Execute npm run analyze:presales-bot com a conexão do Supabase n8n configurada.</span></div>}

      <section className="presales-instrumentation">
        <header><strong>Cobertura do BI</strong><span>O que já é decisão e o que precisa ser instrumentado</span></header>
        <div className="table-wrap"><table className="presales-table"><thead><tr><th>Tema</th><th>Status</th><th>O que existe</th><th>Próximo dado necessário</th></tr></thead><tbody>
          <tr><td>Novas conversas e demanda</td><td className="ok">MEDIDO</td><td>data, hora, iniciador e origem agregada</td><td>UTM/Meta Click ID por contato</td></tr>
          <tr><td>Resposta do bot</td><td className="ok">MEDIDO</td><td>memória do bot + primeira resposta Chatwoot</td><td>timestamp do bot por sessão</td></tr>
          <tr><td>Atendimento humano</td><td className="warning">PENDENTE</td><td>não separável do bot</td><td>primeira resposta humana e agente</td></tr>
          <tr><td>Follow-up e abandono</td><td className="warning">PARCIAL</td><td>turnos e pergunta final do bot, sem tempo</td><td>timestamps e eventos de follow-up</td></tr>
          <tr><td>Objetivos e objeções</td><td className="warning">PARCIAL</td><td>classificação agregada por palavras-chave</td><td>taxonomia supervisionada + auditoria</td></tr>
          <tr><td>Perfil e qualificação</td><td className="warning">PARCIAL</td><td>perfil declarado em parte das sessões</td><td>campos obrigatórios de urgência, local, orçamento e autoridade</td></tr>
          <tr><td>Oportunidade e receita</td><td className="warning">PENDENTE</td><td>sem chave Chatwoot ↔ Pipedrive</td><td>contact_id/deal_id e estágio do funil</td></tr>
        </tbody></table></div>
      </section>

      {edition ? (
        <article className="gia-edition presales-document">
          <header><div><span className="gia-edition-date">Análise de {dateLabel(edition.date)}</span><h3>{edition.titulo}</h3><p className="gia-edition-base">{edition.base}</p></div><dl className="gia-edition-meta"><div><dt>Janela</dt><dd>{edition.janela}</dd></div><div><dt>Dados de</dt><dd>{new Date(edition.factsGeneratedAt).toLocaleDateString("pt-BR")}</dd></div><div><dt>Escrita por</dt><dd>{edition.model}</dd></div></dl></header>
          {stale ? <p className="gia-edition-stale">Há dados sincronizados depois desta edição. Os gráficos acima já refletem a base atual; o documento abaixo permanece congelado para auditoria.</p> : null}
          <p className="gia-edition-resumo">{edition.resumo}</p>
          <div className="gia-sections">{edition.secoes.map((section, index) => <Section key={section.id} section={section} defaultOpen={index < 4} />)}</div>
          <p className="gia-edition-conclusao">{edition.conclusao}</p>
        </article>
      ) : <div className="gia-alert"><strong>Nenhuma análise registrada.</strong><span>Os indicadores calculados continuam disponíveis, mas ainda não há documento histórico.</span></div>}
    </section>
  );
}
