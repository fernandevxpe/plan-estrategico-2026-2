"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketingDashboard } from "@/lib/areas/build-marketing-dashboard";
import { applyRevenueEstimates, buildCreativeIntelligence } from "@/lib/areas/marketing-ai";
import { MarketingCreativeDoctor } from "@/components/areas/MarketingCreativeDoctor";
import { MarketingForecastPanel } from "@/components/areas/MarketingForecastPanel";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const decimal = (value: number, digits = 2) => value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : `${decimal(value, digits)}%`;

/* Espelha o schema da rota; mantido frouxo porque o parecer é conteúdo, não estado. */
type Finding = { titulo: string; texto: string; evidencia: string; severidade: string };
type Decision = {
  adId: string;
  titulo: string;
  decisao: string;
  motivo: string;
  evidencia: string;
  acao: string;
};
type Report = {
  resumoExecutivo: string;
  diagnostico: Finding[];
  vencedores: Array<{
    adId: string;
    titulo: string;
    porqueFuncionou: string;
    elementosCopy: string[];
    elementosVideo: string[];
    licaoReplicavel: string;
  }>;
  decisoes: Decision[];
  picos: Array<{ periodo: string; oQueAconteceu: string; causaProvavel: string; confianca: string; comoRepetir: string }>;
  leituraCopy: string;
  leituraVideo: string;
  cadenciaDias: number;
  criativosPorMes: number;
  criativosAtivosIdeal: number;
  justificativaRenovacao: string;
  temas: Array<{ tema: string; angulo: string; formato: string; porque: string }>;
  leituraPrevisao: string;
  riscos: Finding[];
  proximosPassos: Array<{ ordem: number; acao: string; prazo: string; impactoEsperado: string }>;
  limitacoes: string[];
};

type CachedReport = {
  generatedAt: string;
  model: string;
  author: "sessao" | "api";
  report: Report;
  usage: { inputTokens: number; outputTokens: number } | null;
  factsGeneratedAt: string;
};

const SEVERITY_LABEL: Record<string, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  oportunidade: "Oportunidade",
  positivo: "Positivo"
};

function FindingList({ items }: { items: Finding[] }) {
  return (
    <ul className="gia-findings">
      {items.map((item, index) => (
        <li key={`${index}-${item.titulo}`} className={`gia-finding gia-sev-${item.severidade}`}>
          <header>
            <strong>{item.titulo}</strong>
            <span>{SEVERITY_LABEL[item.severidade] ?? item.severidade}</span>
          </header>
          <p>{item.texto}</p>
          <small>{item.evidencia}</small>
        </li>
      ))}
    </ul>
  );
}

function CallList({ items, tone }: { items: Decision[]; tone: string }) {
  if (!items.length) return <p className="marketing-empty">Nada nesta lista no recorte atual.</p>;
  return (
    <ul className={`gia-calls gia-calls-${tone}`}>
      {items.map((item, index) => (
        <li key={`${index}-${item.adId}`}>
          <strong>{item.titulo}</strong>
          <p>{item.motivo}</p>
          <small>{item.evidencia}</small>
          <b>{item.acao}</b>
        </li>
      ))}
    </ul>
  );
}

/** O modelo devolve uma lista só; a separação por decisão acontece aqui. */
function groupDecisions(items: Decision[]) {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  return {
    estender: items.filter((item) => /estend|escal/.test(normalize(item.decisao))),
    renovar: items.filter((item) => /renov/.test(normalize(item.decisao))),
    aposentar: items.filter((item) => /aposent|pausa|corta|matar/.test(normalize(item.decisao)))
  };
}

export function MarketingGestorIA({ data }: { data: MarketingDashboard }) {
  const intelligence = useMemo(
    () => applyRevenueEstimates(buildCreativeIntelligence(data), data.revenueBaseline),
    [data]
  );
  const baseline = data.revenueBaseline;

  const [state, setState] = useState<{ available: boolean; model: string; cached: CachedReport | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/marketing/gestor-ia")
      .then((response) => response.json())
      .then((payload) => {
        if (active) setState(payload);
      })
      .catch(() => {
        if (active) setState({ available: false, model: "claude-opus-5", cached: null });
      });
    return () => {
      active = false;
    };
  }, []);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/marketing/gestor-ia", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error ?? "Falha ao gerar o parecer.");
        return;
      }
      setState(payload);
    } catch {
      setError("Não foi possível falar com a API. Verifique a conexão e tente de novo.");
    } finally {
      setLoading(false);
    }
  }, []);

  const report = state?.cached?.report ?? null;
  const decisions = useMemo(() => groupDecisions(report?.decisoes ?? []), [report]);
  const stale = state?.cached != null && state.cached.factsGeneratedAt !== data.syncedAt;

  const rates = baseline?.rates;

  return (
    <section className="gia" id="gestor-ia">
      <header className="gia-hero">
        <div>
          <span className="gia-kicker">GESTOR IA</span>
          <h2>Análise completa do investimento em tráfego pago</h2>
          <p>
            Os números saem do Meta Ads Insights e do Pipedrive e são calculados aqui, de forma determinística. O
            modelo {state?.model ?? "claude-opus-5"} recebe esses fatos prontos e escreve a leitura — ele não
            calcula métrica nem inventa número.
          </p>
        </div>
        <div className="gia-hero-actions">
          <button type="button" className="gia-generate" onClick={generate} disabled={loading || state?.available === false}>
            {loading ? "Analisando…" : report ? "Refazer análise" : "Gerar análise"}
          </button>
          {state?.cached ? (
            <small>
              {state.cached.author === "sessao"
                ? "Parecer escrito em sessão e versionado no repositório"
                : "Parecer gerado pela API"}
              {" · "}
              {new Date(state.cached.generatedAt).toLocaleDateString("pt-BR")}
              {stale ? " · dados de marketing mudaram desde então" : ""}
            </small>
          ) : (
            <small>
              {state?.available === false
                ? "ANTHROPIC_API_KEY não configurada — a análise numérica abaixo continua funcionando"
                : "Nenhum parecer gerado ainda"}
            </small>
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

      {error ? <div className="gia-alert is-error">{error}</div> : null}

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

      {report ? (
        <>
          <section className="gia-summary">
            <header>
              <strong>Parecer do gestor</strong>
              <span>
                {state?.cached?.model} · sobre os dados sincronizados em{" "}
                {state?.cached ? new Date(state.cached.factsGeneratedAt).toLocaleDateString("pt-BR") : "—"}
              </span>
            </header>
            <p>{report.resumoExecutivo}</p>
          </section>

          <section className="gia-panel">
            <header>
              <strong>Diagnóstico</strong>
              <span>O que os dados mostram sobre a operação</span>
            </header>
            <FindingList items={report.diagnostico} />
          </section>

          {report.vencedores.length ? (
            <section className="gia-panel">
              <header>
                <strong>Criativos que deram certo — e por quê</strong>
                <span>Leitura de copy e vídeo por trás do resultado</span>
              </header>
              <div className="gia-winner-notes">
                {report.vencedores.map((item) => (
                  <article key={item.adId}>
                    <strong>{item.titulo}</strong>
                    <p>{item.porqueFuncionou}</p>
                    <div className="gia-winner-cols">
                      <div>
                        <small>Copy</small>
                        <ul>
                          {item.elementosCopy.map((element) => (
                            <li key={element}>{element}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <small>Vídeo</small>
                        <ul>
                          {item.elementosVideo.length ? (
                            item.elementosVideo.map((element) => <li key={element}>{element}</li>)
                          ) : (
                            <li>Criativo estático</li>
                          )}
                        </ul>
                      </div>
                    </div>
                    <b>{item.licaoReplicavel}</b>
                  </article>
                ))}
              </div>
              <div className="gia-reading">
                <article>
                  <strong>Leitura de copy</strong>
                  <p>{report.leituraCopy}</p>
                </article>
                <article>
                  <strong>Leitura de vídeo</strong>
                  <p>{report.leituraVideo}</p>
                </article>
              </div>
            </section>
          ) : null}

          <section className="gia-panel">
            <header>
              <strong>Decisão por criativo</strong>
              <span>Estender, renovar ou aposentar — com o dado que sustenta a chamada</span>
            </header>
            <div className="gia-calls-grid">
              <div>
                <h4>Estender / escalar</h4>
                <CallList items={decisions.estender} tone="good" />
              </div>
              <div>
                <h4>Renovar</h4>
                <CallList items={decisions.renovar} tone="warn" />
              </div>
              <div>
                <h4>Aposentar</h4>
                <CallList items={decisions.aposentar} tone="stop" />
              </div>
            </div>
          </section>

          <section className="gia-panel">
            <header>
              <strong>Picos e quedas de performance</strong>
              <span>Quando rendeu mais, por quê, e o que dá para repetir</span>
            </header>
            <ul className="gia-peaks">
              {report.picos.map((peak, index) => (
                <li key={`${index}-${peak.periodo}`}>
                  <header>
                    <strong>{peak.periodo}</strong>
                    <span className={`gia-confidence gia-confidence-${peak.confianca}`}>
                      confiança {peak.confianca}
                    </span>
                  </header>
                  <p>{peak.oQueAconteceu}</p>
                  <p className="gia-cause">
                    <b>Causa provável:</b> {peak.causaProvavel}
                  </p>
                  <small>{peak.comoRepetir}</small>
                </li>
              ))}
            </ul>
          </section>

          <section className="gia-panel">
            <header>
              <strong>Plano de renovação de criativos</strong>
              <span>
                Cadência de {report.cadenciaDias} dias · {report.criativosPorMes} novos por mês ·{" "}
                {report.criativosAtivosIdeal} ativos simultâneos
              </span>
            </header>
            <p className="gia-plan-note">{report.justificativaRenovacao}</p>
            <div className="gia-themes">
              {report.temas.map((theme, index) => (
                <article key={`${index}-${theme.tema}`}>
                  <strong>{theme.tema}</strong>
                  <span>{theme.angulo}</span>
                  <em>{theme.formato}</em>
                  <p>{theme.porque}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <section className="gia-panel">
        <header>
          <strong>Indicadores de criativo</strong>
          <span>
            Veredito calculado por regra: custo contra a mediana da própria família de resultado, desgaste entre a
            primeira e a segunda metade da verba, e volume mínimo de amostra
          </span>
        </header>
        <MarketingCreativeDoctor intelligence={intelligence} />
      </section>

      {baseline ? (
        <section className="gia-panel">
          <MarketingForecastPanel baseline={baseline} intelligence={intelligence} />
          {report ? (
            <div className="gia-reading gia-reading-single">
              <article>
                <strong>Leitura da previsão</strong>
                <p>{report.leituraPrevisao}</p>
              </article>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="gia-alert">
          <strong>Metas indisponíveis.</strong>
          <span>
            A calculadora depende das metas mensais da Goals API do Pipedrive e das coortes de ganho. Rode o sync
            para liberar a projeção.
          </span>
        </div>
      )}

      {report ? (
        <>
          <section className="gia-panel">
            <header>
              <strong>Riscos</strong>
              <span>O que pode derrubar o plano</span>
            </header>
            <FindingList items={report.riscos} />
          </section>

          <section className="gia-panel">
            <header>
              <strong>Próximos passos</strong>
              <span>Na ordem em que devem ser executados</span>
            </header>
            <ol className="gia-steps">
              {report.proximosPassos
                .slice()
                .sort((a, b) => a.ordem - b.ordem)
                .map((step, index) => (
                  <li key={`${index}-${step.ordem}`}>
                    <strong>{step.acao}</strong>
                    <span>{step.prazo}</span>
                    <small>{step.impactoEsperado}</small>
                  </li>
                ))}
            </ol>
          </section>

          <section className="gia-panel gia-limits">
            <header>
              <strong>O que esta análise não sabe</strong>
              <span>Declarado pelo próprio parecer</span>
            </header>
            <ul>
              {report.limitacoes.map((limit, index) => (
                <li key={`${index}-${limit.slice(0, 40)}`}>{limit}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </section>
  );
}
