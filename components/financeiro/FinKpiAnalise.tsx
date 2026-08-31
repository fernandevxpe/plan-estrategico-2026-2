"use client";

import { useId, type ReactNode } from "react";

import { brlCents, monthKeyLabel, pct } from "@/lib/financeiro/format";

/**
 * O MOLDE DE LEITURA DO FINANCEIRO — KPI com delta, sparkline e taxa.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * Estas peças nasceram dentro de `FinPessoas.tsx` como funções locais, e por
 * isso só a página de Pessoas sabia lê-las. Custos fixos, Custos do mês e
 * Cartões respondem perguntas diferentes sobre o MESMO dinheiro, e a pessoa que
 * atravessa as quatro telas precisa que "R$ 12.930,85 · +20,1% vs. jul" queira
 * dizer a mesma coisa em todas.
 *
 * Copiar o bloco para a segunda tela funcionaria hoje e divergiria no primeiro
 * ajuste — é o defeito que este repositório já registrou em reembolso ("a MESMA
 * planilha em DUAS tabelas") e em CSS ("`.nat-recorrente` no componente e
 * `.nat-prolabore` no CSS"). Extrair antes de duplicar é mais barato que
 * reconciliar depois.
 *
 * NADA MUDA DE COMPORTAMENTO NA EXTRAÇÃO. O código abaixo é o de
 * `FinPessoas.tsx` movido, não reescrito: mesmos nomes de classe, mesma
 * matemática, mesma regra de sinal. A prova é a tela de Pessoas continuar
 * idêntica — mesmos três KPIs, mesmos valores, mesma altura de página.
 *
 * OS NOMES DE CLASSE CONTINUAM `fin-pessoas-*`. Renomear para `fin-kpi-*` seria
 * mexer em ~90 linhas de CSS no mesmo commit em que se move o TSX, e aí uma
 * regressão visual não teria como ser atribuída a uma coisa ou a outra. O
 * rename é um passo seguinte, sozinho.
 */

export function DeltaCusto({
  atual,
  anterior,
  contra
}: {
  atual: number;
  anterior: number | null;
  contra: string;
}) {
  if (anterior === null || !anterior) {
    return <p className="fin-delta neutro">sem base para comparar</p>;
  }
  const variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
  const classe =
    Math.abs(variacao) < 0.05 ? "fin-delta neutro" : variacao > 0 ? "fin-delta ruim" : "fin-delta bom";
  return (
    <p className={classe}>
      {variacao >= 0 ? "+" : "−"}
      {pct(Math.abs(variacao), 1)} <span>vs. {contra}</span>
    </p>
  );
}

function mesesEntre(de: string, ate: string) {
  const [ya, ma] = de.slice(0, 7).split("-").map(Number);
  const [yb, mb] = ate.slice(0, 7).split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * Taxa composta mês a mês. Soma simples (último/primeiro − 1) mente no ano:
 * oito meses de +4% viram "+32%", e não é o que o dono lê como crescimento anual.
 */
function taxaComposta(inicial: number, final: number, passos: number) {
  if (inicial <= 0 || passos <= 0 || !Number.isFinite(final)) return null;
  return Math.pow(final / inicial, 1 / passos) - 1;
}

export type SparkPonto = { mes: string; cents: number; previsto?: boolean };

export type Crescimento = {
  de: string;
  ate: string;
  mediaMes: number | null;
  anual: number | null;
  previstoMes: number | null;
};

export function crescimentoDe(pontos: SparkPonto[]): Crescimento | null {
  const realizados = pontos.filter((p) => !p.previsto && p.cents > 0);
  const primeiro = realizados[0];
  const recente = realizados[realizados.length - 1];
  const previsto = pontos.find((p) => p.previsto && p.cents > 0);
  if (!primeiro || !recente) return null;
  const passos = mesesEntre(primeiro.mes, recente.mes);
  const mediaMes = taxaComposta(primeiro.cents, recente.cents, passos);
  return {
    de: primeiro.mes,
    ate: recente.mes,
    mediaMes,
    anual: mediaMes === null ? null : Math.pow(1 + mediaMes, 12) - 1,
    previstoMes: previsto && recente.cents > 0 ? previsto.cents / recente.cents - 1 : null
  };
}

function classeTaxa(v: number | null) {
  if (v === null) return undefined;
  if (v > 0.0005) return "fin-pessoas-kpi-sobe";
  if (v < -0.0005) return "fin-pessoas-kpi-desce";
  return undefined;
}

function rotuloTaxa(v: number | null, sufixo: string, casas: number) {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : "−"}${pct(Math.abs(v) * 100, casas)}${sufixo}`;
}

export function TaxasCrescimento({ c }: { c: Crescimento | null }) {
  if (!c) return null;
  return (
    <p className="fin-pessoas-kpi-taxas">
      <span
        className={classeTaxa(c.mediaMes)}
        title={`${monthKeyLabel(c.de)} → ${monthKeyLabel(c.ate)}, composta`}
      >
        {rotuloTaxa(c.mediaMes, "/mês", 1)}
        <small>início → recente</small>
      </span>
      <span className={classeTaxa(c.anual)} title="A mesma taxa, anualizada: (1 + média/mês)¹² − 1">
        {rotuloTaxa(c.anual, "/ano", 0)}
        <small>anual</small>
      </span>
      <span className={classeTaxa(c.previstoMes)} title="Previsto do cadastro contra o último mês realizado">
        {rotuloTaxa(c.previstoMes, "", 1)}
        <small>previsto</small>
      </span>
    </p>
  );
}

export function SparkArea({
  pontos,
  ariaLabel
}: {
  pontos: SparkPonto[];
  ariaLabel: string;
}) {
  // useId gera ":r1:" — Safari quebra url(#:r1:) no fill do degradê.
  const id = `kpi-area-${useId().replace(/:/g, "")}`;
  const w = 240;
  const h = 52;
  const base = h - 1;
  if (pontos.length < 2) return null;
  const ys = pontos.map((p) => p.cents);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const coords = pontos.map((p, i) => {
    const x = (i / (pontos.length - 1)) * (w - 8) + 4;
    const y = h - 7 - ((p.cents - min) / span) * (h - 14);
    return { x, y, ...p };
  });
  const realizados = coords.filter((c) => !c.previsto);
  const dLinha = realizados.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const primeiro = realizados[0];
  const ultimoReal = realizados[realizados.length - 1];
  const dArea =
    primeiro && ultimoReal
      ? `${dLinha} L${ultimoReal.x.toFixed(1)},${base} L${primeiro.x.toFixed(1)},${base} Z`
      : "";
  const previsto = coords.find((c) => c.previsto);
  const dPrevistoArea =
    ultimoReal && previsto
      ? `M${ultimoReal.x.toFixed(1)},${ultimoReal.y.toFixed(1)} L${previsto.x.toFixed(1)},${previsto.y.toFixed(1)} L${previsto.x.toFixed(1)},${base} L${ultimoReal.x.toFixed(1)},${base} Z`
      : "";
  return (
    <svg
      className="fin-pessoas-kpi-spark"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--purple)" stopOpacity="0.48" />
          <stop offset="55%" stopColor="var(--purple)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--purple)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {dArea ? <path d={dArea} fill={`url(#${id})`} /> : null}
      {dPrevistoArea ? <path d={dPrevistoArea} fill={`url(#${id})`} opacity="0.45" /> : null}
      <path
        d={dLinha}
        fill="none"
        stroke="var(--purple)"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {ultimoReal && previsto ? (
        <path
          d={`M${ultimoReal.x.toFixed(1)},${ultimoReal.y.toFixed(1)} L${previsto.x.toFixed(1)},${previsto.y.toFixed(1)}`}
          fill="none"
          stroke="var(--purple)"
          strokeWidth="1.6"
          strokeDasharray="3 3"
          opacity="0.75"
        />
      ) : null}
      {coords.map((c) => (
        <circle
          key={c.mes}
          cx={c.x}
          cy={c.y}
          r={c.previsto ? 3.2 : 2.1}
          fill={c.previsto ? "var(--card)" : "var(--purple)"}
          stroke="var(--purple)"
          strokeWidth={c.previsto ? 1.6 : 0}
        >
          <title>
            {`${monthKeyLabel(c.mes)}${c.previsto ? " previsto" : ""}: ${brlCents(c.cents)}`}
          </title>
        </circle>
      ))}
    </svg>
  );
}

export function KpiAnalise({
  rotulo,
  valor,
  delta,
  extra,
  pontos,
  crescimento,
  destaque,
  ariaSpark
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  delta: ReactNode;
  extra?: ReactNode;
  pontos: SparkPonto[];
  crescimento: Crescimento | null;
  destaque?: boolean;
  ariaSpark: string;
}) {
  return (
    <article className={destaque ? "fin-pessoas-kpi-item destaque" : "fin-pessoas-kpi-item"}>
      <div className="fin-pessoas-kpi-folha-topo">
        <div>
          <p className="fin-pessoas-kpi-rotulo">{rotulo}</p>
          <p className="fin-pessoas-kpi-valor">{valor}</p>
          {delta}
          {extra}
        </div>
        <SparkArea pontos={pontos} ariaLabel={ariaSpark} />
      </div>
      <TaxasCrescimento c={crescimento} />
    </article>
  );
}
