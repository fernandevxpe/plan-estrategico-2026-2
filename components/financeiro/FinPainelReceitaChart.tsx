"use client";

import { useMemo, useState } from "react";
import { Bar, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { ChartWithLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import { chartTheme } from "@/lib/chart-theme";
import { brlCompact, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";
import type { SerieMes } from "@/lib/financeiro/painel";

type Props = { dados: SerieMes[] };
type Agregacao = "mensal" | "trimestral" | "semestral";

type PontoAgregado = {
  chave: string;
  rotulo: string;
  receita: number;
  media3m: number | null;
  parcial: boolean;
  de: string;
  ate: string;
};

type LinhaComposicao = { categoria: string; totalCents: number; lancamentos: number };

/**
 * Receita mês a mês, com drill-down: ano, trimestre/semestre, e composição
 * por categoria ao clicar numa barra.
 *
 * Três decisões de leitura ORIGINAIS, mantidas — cinza por padrão, cor só no
 * que carrega a mensagem:
 *
 *   · as barras são CINZA. Elas são o contexto, não o recado. A mensagem é a
 *     tendência, e quem a carrega é a linha verde da média móvel.
 *   · o mês corrente é PARCIAL e vem mais claro.
 *   · uma linha de referência na média basta pra responder "acima ou abaixo
 *     do normal?", sem grade densa nem eixo duplo.
 *
 * NOVO nesta versão: seletor de ano (busca fora da janela de 35 meses que o
 * servidor já manda), agregação trimestre/semestre (computada no cliente, a
 * partir dos mesmos meses — nunca uma soma nova do banco), e clique numa
 * barra abre a composição por categoria daquele período exato.
 */
export function FinPainelReceitaChart({ dados }: Props) {
  const { hidden, isHidden, toggle } = useLegendToggle();
  const [ano, setAno] = useState<"tudo" | number>("tudo");
  const [agregacao, setAgregacao] = useState<Agregacao>("mensal");
  const [dadosAno, setDadosAno] = useState<SerieMes[] | null>(null);
  const [carregandoAno, setCarregandoAno] = useState(false);
  const [selecionado, setSelecionado] = useState<PontoAgregado | null>(null);
  const [composicao, setComposicao] = useState<LinhaComposicao[] | null>(null);
  const [carregandoComposicao, setCarregandoComposicao] = useState(false);

  const anosDisponiveis = useMemo(() => {
    const anos = new Set(dados.map((d) => Number(d.mes.slice(0, 4))));
    return Array.from(anos).sort((a, b) => b - a);
  }, [dados]);

  const baseMensal = ano === "tudo" ? dados : dadosAno ?? [];

  async function escolherAno(valor: string) {
    setSelecionado(null);
    setComposicao(null);
    if (valor === "tudo") {
      setAno("tudo");
      return;
    }
    const anoNum = Number(valor);
    setAno(anoNum);
    setCarregandoAno(true);
    try {
      const resp = await fetch(`/api/financeiro/gerencial/receita-serie?ano=${anoNum}`, { cache: "no-store" });
      const json = await resp.json();
      setDadosAno(
        (json.serie as { mes: string; receitaCents: number; parcial: boolean }[]).map((l) => ({
          mes: l.mes,
          receitaCents: l.receitaCents,
          media3mCents: 0,
          anoAnteriorCents: null,
          parcial: l.parcial
        }))
      );
    } finally {
      setCarregandoAno(false);
    }
  }

  const { pontos, mediaReais } = useMemo(() => {
    const mensal = baseMensal
      .slice()
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((linha) => ({
        mes: linha.mes,
        receita: linha.receitaCents / 100,
        parcial: linha.parcial
      }));

    let agregados: PontoAgregado[];
    if (agregacao === "mensal") {
      agregados = mensal.map((p) => ({
        chave: p.mes,
        rotulo: monthKeyLabel(p.mes),
        receita: p.receita,
        media3m: null,
        parcial: p.parcial,
        de: p.mes,
        ate: fimDoMes(p.mes)
      }));
    } else {
      const tamanho = agregacao === "trimestral" ? 3 : 6;
      const grupos = new Map<string, typeof mensal>();
      for (const p of mensal) {
        const [anoStr, mesStr] = p.mes.split("-");
        const indice = Math.floor((Number(mesStr) - 1) / tamanho);
        const chave = `${anoStr}-${agregacao === "trimestral" ? "T" : "S"}${indice + 1}`;
        const lista = grupos.get(chave) ?? [];
        lista.push(p);
        grupos.set(chave, lista);
      }
      agregados = Array.from(grupos.entries()).map(([chave, lista]) => ({
        chave,
        rotulo: `${chave.slice(5)}/${chave.slice(2, 4)}`,
        receita: lista.reduce((s, p) => s + p.receita, 0),
        media3m: null,
        parcial: lista.some((p) => p.parcial),
        de: lista[0].mes,
        ate: fimDoMes(lista[lista.length - 1].mes)
      }));
    }

    // Média móvel de 3 posições sobre a série já agregada — ajuda a ler
    // tendência em qualquer granularidade, não só mensal.
    for (let i = 0; i < agregados.length; i++) {
      const janela = agregados.slice(Math.max(0, i - 2), i + 1);
      agregados[i].media3m = janela.reduce((s, p) => s + p.receita, 0) / janela.length;
    }

    const fechados = agregados.filter((p) => !p.parcial);
    const media = fechados.length ? fechados.reduce((s, p) => s + p.receita, 0) / fechados.length : 0;
    return { pontos: agregados, mediaReais: media };
  }, [baseMensal, agregacao]);

  async function clicarBarra(ponto: PontoAgregado) {
    if (selecionado?.chave === ponto.chave) {
      setSelecionado(null);
      setComposicao(null);
      return;
    }
    setSelecionado(ponto);
    setComposicao(null);
    setCarregandoComposicao(true);
    try {
      const resp = await fetch(
        `/api/financeiro/gerencial/receita-composicao?de=${ponto.de}&ate=${ponto.ate}`,
        { cache: "no-store" }
      );
      const json = await resp.json();
      setComposicao(json.composicao ?? []);
    } finally {
      setCarregandoComposicao(false);
    }
  }

  const series: LegendSeries[] = [
    { dataKey: "receita", name: "Receita", color: chartTheme.slate, type: "rect" },
    { dataKey: "media3m", name: "Média móvel", color: chartTheme.green, type: "line" }
  ];

  return (
    <ChartFrame titulo="Receita">
      <div className="receita-chart-controles">
        <select
          className="fin-select fin-select-inline"
          value={ano === "tudo" ? "tudo" : String(ano)}
          onChange={(e) => escolherAno(e.target.value)}
          aria-label="Ano"
        >
          <option value="tudo">Últimos 35 meses</option>
          {anosDisponiveis.map((a) => (
            <option key={a} value={a}>
              Só {a}
            </option>
          ))}
        </select>
        <div className="receita-chart-agregacao" role="group" aria-label="Agregação">
          {(["mensal", "trimestral", "semestral"] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              className={agregacao === opcao ? "is-ativo" : ""}
              aria-pressed={agregacao === opcao}
              onClick={() => {
                setAgregacao(opcao);
                setSelecionado(null);
                setComposicao(null);
              }}
            >
              {opcao === "mensal" ? "Mês" : opcao === "trimestral" ? "Trimestre" : "Semestre"}
            </button>
          ))}
        </div>
        {carregandoAno && (
          <span className="receita-chart-carregando" aria-live="polite">
            carregando {ano}…
          </span>
        )}
      </div>

      {!pontos.length ? (
        <p className="fin-card-hint">{carregandoAno ? "carregando…" : "Sem receita no período."}</p>
      ) : (
        <>
          <ChartWithLegend series={series} hidden={hidden} onToggle={toggle}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={pontos}
                margin={{ top: 12, right: 10, bottom: 0, left: 4 }}
                onClick={(estado) => {
                  const ponto = estado?.activePayload?.[0]?.payload as PontoAgregado | undefined;
                  if (ponto) clicarBarra(ponto);
                }}
              >
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={{ stroke: "var(--line)" }} tickLine={false} interval={agregacao === "mensal" ? 1 : 0} />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                  tickFormatter={(valor: number) => brlCompact(valor * 100)}
                />
                <Tooltip
                  formatter={(valor: number, nome: string) => [brlPrecise(valor * 100), nome]}
                  labelStyle={{ color: "var(--ink)", fontWeight: 600 }}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }}
                />
                <ReferenceLine
                  y={mediaReais}
                  stroke={chartTheme.slate}
                  strokeDasharray="4 4"
                  label={{ value: `média ${brlCompact(mediaReais * 100)}`, position: "insideTopLeft", fill: "var(--muted)", fontSize: 10.5 }}
                />
                {!isHidden("receita") ? (
                  <Bar dataKey="receita" name="Receita" radius={[3, 3, 0, 0]} maxBarSize={34} cursor="pointer">
                    {pontos.map((ponto) => (
                      <Cell
                        key={ponto.chave}
                        fill={ponto.parcial ? "var(--line)" : selecionado?.chave === ponto.chave ? "var(--neon-purple)" : chartTheme.slate}
                      />
                    ))}
                  </Bar>
                ) : null}
                {!isHidden("media3m") ? (
                  <Line type="monotone" dataKey="media3m" name="Média móvel" stroke={chartTheme.green} strokeWidth={2.75} dot={false} />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartWithLegend>

          {selecionado && (
            <div className="receita-composicao">
              <header>
                <strong>Composição — {selecionado.rotulo}</strong>
                <span>{brlPrecise(selecionado.receita * 100)}</span>
              </header>
              {carregandoComposicao ? (
                <p className="fin-card-hint">carregando…</p>
              ) : composicao && composicao.length ? (
                <ul className="receita-composicao-lista">
                  {composicao.map((c) => (
                    <li key={c.categoria}>
                      <span>{c.categoria}</span>
                      <span className="receita-composicao-barra">
                        <i
                          style={{
                            width: `${
                              selecionado.receita > 0
                                ? Math.max(2, Math.round((c.totalCents / (selecionado.receita * 100)) * 100))
                                : 2
                            }%`
                          }}
                        />
                      </span>
                      <span className="receita-composicao-valor">
                        {brlPrecise(c.totalCents)} · {c.lancamentos}x
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="fin-card-hint">Sem lançamento neste período.</p>
              )}
            </div>
          )}
        </>
      )}
    </ChartFrame>
  );
}

function fimDoMes(mes: string): string {
  const [ano, mesNum] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mesNum, 0));
  return ultimo.toISOString().slice(0, 10);
}
