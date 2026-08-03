"use client";

import { useMemo, useState } from "react";
import type {
  MarketingDashboard,
  MarketingGestorEdition,
  MarketingGestorSection,
  MarketingGestorSnapshot
} from "@/lib/areas/build-marketing-dashboard";
import { applyRevenueEstimates, buildCreativeIntelligence } from "@/lib/areas/marketing-ai";
import { Collapsible } from "@/components/areas/Collapsible";
import { MarketingCreativeDoctor } from "@/components/areas/MarketingCreativeDoctor";
import { MarketingForecastPanel } from "@/components/areas/MarketingForecastPanel";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const decimal = (value: number, digits = 2) => value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : `${decimal(value, digits)}%`;
const editionLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

const COMPARE_FIELDS: Array<{
  key: keyof MarketingGestorSnapshot;
  label: string;
  format: (value: number) => string;
  /** Direção que conta como melhora. */
  better: "up" | "down";
}> = [
  { key: "investidoNoMes", label: "Investido no mês", format: money, better: "up" },
  { key: "custoPorConversa", label: "Custo por conversa", format: money, better: "down" },
  { key: "conversaParaContratoPct", label: "Conversa → contrato", format: (v) => `${decimal(v, 2)}%`, better: "up" },
  { key: "midiaPorContrato", label: "Mídia por contrato", format: money, better: "down" },
  { key: "retornoSobreMidia", label: "Retorno sobre a mídia", format: (v) => `${decimal(v)}×`, better: "up" },
  { key: "criativosFatigados", label: "Criativos em desgaste", format: (v) => String(Math.round(v)), better: "down" },
  { key: "conceitosAtivos", label: "Conceitos ativos", format: (v) => String(Math.round(v)), better: "up" },
  { key: "investimentoExigidoNoMes", label: "Investimento exigido", format: money, better: "down" }
];

/** Compara a fotografia desta edição com a da anterior. */
function EditionCompare({
  current,
  previous,
  previousDate
}: {
  current: MarketingGestorSnapshot;
  previous: MarketingGestorSnapshot;
  previousDate: string;
}) {
  return (
    <section className="gia-compare">
      <header>
        <strong>O que mudou desde a análise anterior</strong>
        <span>
          Comparado com a edição de {new Date(`${previousDate}T12:00:00`).toLocaleDateString("pt-BR")} — números
          congelados no dia de cada análise, não recalculados
        </span>
      </header>
      <div className="gia-compare-grid">
        {COMPARE_FIELDS.map((field) => {
          const now = current[field.key];
          const before = previous[field.key];
          if (now == null || before == null) return null;
          const delta = now - before;
          const deltaPct = before !== 0 ? (delta / Math.abs(before)) * 100 : null;
          const improved = field.better === "up" ? delta > 0 : delta < 0;
          const tone = Math.abs(deltaPct ?? 0) < 1 ? "flat" : improved ? "up" : "down";
          return (
            <article key={field.key}>
              <span>{field.label}</span>
              <strong>{field.format(now)}</strong>
              <small className={tone}>
                {tone === "flat"
                  ? "estável"
                  : `${delta > 0 ? "+" : "−"}${field.format(Math.abs(delta))}${
                      deltaPct == null ? "" : ` (${delta > 0 ? "+" : "−"}${decimal(Math.abs(deltaPct), 0)}%)`
                    }`}
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Section({
  section,
  defaultOpen
}: {
  section: MarketingGestorSection;
  defaultOpen: boolean;
}) {
  return (
    <details
      className={`gia-section gia-tone-${section.tom ?? "neutro"}`}
      id={`gia-${section.id}`}
      open={defaultOpen}
    >
      <summary>
        <span className="collapsible-caret" aria-hidden="true" />
        <h4>{section.titulo}</h4>
      </summary>
      <div className="gia-section-body">
      {section.paragrafos.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}

      {section.tabela ? (
        <div className="table-wrap">
          <table className="marketing-table gia-section-table">
            <thead>
              <tr>
                {section.tabela.colunas.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.tabela.linhas.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {section.tabela.nota ? <small className="gia-table-note">{section.tabela.nota}</small> : null}
        </div>
      ) : null}

      {section.lista?.length ? (
        section.listaOrdenada ? (
          <ol className="gia-section-list">
            {section.lista.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        ) : (
          <ul className="gia-section-list">
            {section.lista.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )
      ) : null}

      {section.destaque ? <p className="gia-destaque">{section.destaque}</p> : null}
      </div>
    </details>
  );
}

export function MarketingGestorIA({ data }: { data: MarketingDashboard }) {
  const intelligence = useMemo(
    () => applyRevenueEstimates(buildCreativeIntelligence(data), data.revenueBaseline),
    [data]
  );
  const baseline = data.revenueBaseline;
  const editions = data.gestorEditions;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const edition: MarketingGestorEdition | null =
    editions.find((item) => item.date === selectedDate) ?? editions[0] ?? null;
  const isCurrent = edition != null && edition.date === editions[0]?.date;
  const previousEdition = edition
    ? editions[editions.findIndex((item) => item.date === edition.date) + 1] ?? null
    : null;
  const stale = edition != null && edition.factsGeneratedAt !== data.syncedAt;
  const rates = baseline?.rates;

  return (
    <section className="gia" id="gestor-ia">
      <header className="gia-hero">
        <div>
          <span className="gia-kicker">GESTOR IA</span>
          <h2>Análise completa do investimento em tráfego pago</h2>
          <p>
            Os números saem do Meta Ads Insights e do Pipedrive e são calculados aqui, de forma determinística.
            A análise abaixo é escrita sobre esses fatos já prontos — nenhuma métrica da página vem de modelo de
            linguagem.
          </p>
        </div>
        <div className="gia-hero-actions">
          {editions.length ? (
            <>
              <span className="gia-edition-label">
                {editions.length === 1 ? "1 análise registrada" : `${editions.length} análises registradas`}
              </span>
              <div className="gia-editions" role="group" aria-label="Edição da análise">
                {editions.map((item, index) => (
                  <button
                    key={item.date}
                    type="button"
                    className={edition?.date === item.date ? "active" : ""}
                    onClick={() => setSelectedDate(item.date)}
                  >
                    {new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit"
                    })}
                    {index === 0 ? <em>atual</em> : null}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <small>Nenhuma análise registrada. Os indicadores abaixo independem disso.</small>
          )}
        </div>
      </header>

      {intelligence.account.paused ? (
        <div className="gia-alert">
          <strong>A conta está parada.</strong>
          <span>
            Nenhum anúncio ativo na última sincronização. Última entrega em{" "}
            {intelligence.account.lastDeliveryDate ?? "—"}
            {intelligence.account.daysWithoutDelivery != null
              ? ` (${intelligence.account.daysWithoutDelivery} dias sem veicular)`
              : ""}
            {" "}e {money(intelligence.account.currentMonthSpend)} investidos no mês corrente. Todo o plano abaixo
            parte de uma operação desligada.
          </span>
        </div>
      ) : null}

      <section className="gia-reliability">
        <header>
          <strong>Confiabilidade dos números</strong>
          <span>O que sustenta cada taxa usada daqui para baixo</span>
        </header>
        <div className="gia-reliability-grid">
          <article>
            <span>Base de mídia</span>
            <strong>{money(intelligence.totals.spend)}</strong>
            <small>
              {intelligence.totals.creativesWithSpend} criativos · {intelligence.totals.conversations} conversas ·{" "}
              {intelligence.totals.landingPageViews} páginas
            </small>
          </article>
          <article>
            <span>Coortes maduras</span>
            <strong>{rates?.matureMonths ?? 0} meses</strong>
            <small>
              {rates?.matureConversations ?? 0} conversas e {rates?.maturePaidWonDeals ?? 0} contratos pagos já
              fechados
            </small>
          </article>
          <article>
            <span>Ciclo de venda</span>
            <strong>{rates?.leadTimeDays == null ? "—" : `${decimal(rates.leadTimeDays, 0)} dias`}</strong>
            <small>defasagem aplicada: {rates?.lagMonths ?? "—"} mês(es)</small>
          </article>
          <article>
            <span>Conversa → contrato</span>
            <strong>{percent(rates?.conversationToPaidWonPct)}</strong>
            <small>
              faixa observada {percent(baseline?.bands.conversationToWonPct.p25)} a{" "}
              {percent(baseline?.bands.conversationToWonPct.p75)}
            </small>
          </article>
          <article>
            <span>Mídia por contrato ganho</span>
            <strong>{rates?.mediaCostPerPaidWon == null ? "—" : money(rates.mediaCostPerPaidWon)}</strong>
            <small>
              retorno de {rates?.roasOnMedia == null ? "—" : `${decimal(rates.roasOnMedia)}×`} sobre a mídia
            </small>
          </article>
          <article>
            <span>Share do tráfego pago</span>
            <strong>{percent(rates?.paidShareOfWonRevenuePct, 1)}</strong>
            <small>da receita ganha no ano · {percent(rates?.paidShareOfWonDealsPct, 1)} dos contratos</small>
          </article>
        </div>
        <ul className="gia-caveats">
          {(baseline?.warnings ?? []).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
          <li>
            Receita por criativo é rateio modelado pela taxa da coorte madura, não atribuição individual — serve
            para ranquear criativos entre si.
          </li>
        </ul>
      </section>

      {edition ? (
        <article className="gia-edition">
          <header>
            <div>
              <span className="gia-edition-date">
                Análise de {editionLabel(edition.date)}
                {isCurrent ? null : <em className="gia-edition-old">edição anterior</em>}
              </span>
              <h3>{edition.titulo}</h3>
              <p className="gia-edition-base">{edition.base}</p>
            </div>
            <dl className="gia-edition-meta">
              <div>
                <dt>Janela</dt>
                <dd>{edition.janela}</dd>
              </div>
              <div>
                <dt>Dados de</dt>
                <dd>{new Date(edition.factsGeneratedAt).toLocaleDateString("pt-BR")}</dd>
              </div>
              <div>
                <dt>Escrita por</dt>
                <dd>{edition.model}</dd>
              </div>
            </dl>
          </header>

          {stale ? (
            <p className="gia-edition-stale">
              Os dados de marketing foram sincronizados depois desta análise (
              {new Date(data.syncedAt).toLocaleDateString("pt-BR")}). Os indicadores e a calculadora abaixo já
              refletem os números novos; o texto desta edição não.
            </p>
          ) : null}

          {edition.indicadores && previousEdition?.indicadores ? (
            <EditionCompare
              current={edition.indicadores}
              previous={previousEdition.indicadores}
              previousDate={previousEdition.date}
            />
          ) : null}

          <p className="gia-edition-resumo">{edition.resumo}</p>

          <div className="gia-sections">
            {edition.secoes.map((section, index) => (
              <Section key={section.id} section={section} defaultOpen={index < 3} />
            ))}
          </div>

          <p className="gia-edition-conclusao">{edition.conclusao}</p>
        </article>
      ) : null}

      <Collapsible
        title="Indicadores de criativo"
        hint="Veredito por regra: custo contra a mediana da própria família, desgaste entre metades da verba e amostra mínima"
        badge={`${intelligence.totals.creativesWithSpend} criativos`}
        defaultOpen
      >
        <MarketingCreativeDoctor intelligence={intelligence} />
      </Collapsible>

      {baseline ? (
        <Collapsible
          title="Calculadora de previsão"
          hint="Caminho reverso da meta até o investimento em mídia, com cenários"
          defaultOpen
        >
          <MarketingForecastPanel baseline={baseline} intelligence={intelligence} />
        </Collapsible>
      ) : (
        <div className="gia-alert">
          <strong>Metas indisponíveis.</strong>
          <span>
            A calculadora depende das metas mensais da Goals API do Pipedrive e das coortes de ganho. Rode o sync
            para liberar a projeção.
          </span>
        </div>
      )}
    </section>
  );
}
