"use client";

import type { ReactNode } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { brlCompact, brlPrecise, pct } from "@/lib/financeiro/format";
import { pctDaFatia, type FatiaCusto } from "@/lib/financeiro/repartir-custo-area";

const ALTURA_VISTA = 220;

type Ponto = {
  nome: string;
  slug: string;
  ultimo: number;
  media: number;
  pctUltimo: number;
  pctMedia: number;
};

function pontosDe(fatias: FatiaCusto[]) {
  const totalUltimo = fatias.reduce((s, f) => s + f.ultimoCents, 0);
  const totalMedia = fatias.reduce((s, f) => s + f.mediaCents, 0);
  const pontos: Ponto[] = fatias.map((f) => ({
    nome: f.nome,
    slug: f.slug,
    ultimo: f.ultimoCents / 100,
    media: f.mediaCents / 100,
    pctUltimo: pctDaFatia(f.ultimoCents, totalUltimo),
    pctMedia: pctDaFatia(f.mediaCents, totalMedia)
  }));
  return { pontos, totalUltimo, totalMedia };
}

function DicaSeparado({
  active,
  payload,
  label,
  ultimoMesLabel,
  mediaLabel
}: {
  active?: boolean;
  payload?: { dataKey?: string; value?: number; payload?: Ponto }[];
  label?: string;
  ultimoMesLabel: string;
  mediaLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const ponto = payload[0]?.payload;
  return (
    <div className="fin-pessoas-custo-dica">
      <strong>{label}</strong>
      {ponto ? (
        <ul>
          <li>
            <span>{ultimoMesLabel}</span>
            <b>
              {brlPrecise(ponto.ultimo * 100)} · {pct(ponto.pctUltimo, 1)}
            </b>
          </li>
          <li>
            <span>{mediaLabel}</span>
            <b>
              {brlPrecise(ponto.media * 100)} · {pct(ponto.pctMedia, 1)}
            </b>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function DicaPilha({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const visiveis = payload.filter((p) => p.dataKey !== "_total" && (p.value ?? 0) > 0);
  const total = visiveis.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="fin-pessoas-custo-dica">
      <strong>{label}</strong>
      <ul>
        {visiveis.map((p) => (
          <li key={p.dataKey}>
            <span>
              <i className="fin-pessoas-custo-dica-ponto" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <b>
              {brlPrecise((p.value ?? 0) * 100)} · {pct(pctDaFatia(p.value ?? 0, total), 1)}
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DicaPizza({
  active,
  payload
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: Ponto & { fill?: string; pct?: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const pctValor = item?.payload?.pct;
  return (
    <div className="fin-pessoas-custo-dica">
      <strong>{item?.name}</strong>
      <ul>
        <li>
          <span>Fatia</span>
          <b>
            {brlPrecise((item?.value ?? 0) * 100)}
            {pctValor !== undefined ? ` · ${pct(pctValor, 1)}` : ""}
          </b>
        </li>
      </ul>
    </div>
  );
}

function TickNome({
  x,
  y,
  payload
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
}) {
  const nome = payload?.value ?? "";
  const curto = nome.length > 10 ? `${nome.slice(0, 9)}…` : nome;
  return (
    <text
      x={x}
      y={y}
      dy={10}
      textAnchor="end"
      transform={`rotate(-36 ${x ?? 0} ${y ?? 0})`}
      fill="var(--ink)"
      fontSize={11}
    >
      <title>{nome}</title>
      {curto}
    </text>
  );
}

function GraficoSeparado({
  pontos,
  corDe,
  ultimoMesLabel,
  mediaLabel
}: {
  pontos: Ponto[];
  corDe: (slug: string) => string;
  ultimoMesLabel: string;
  mediaLabel: string;
}) {
  function Rotulo({
    x = 0,
    y = 0,
    width = 0,
    value,
    index = 0,
    dataKey
  }: {
    x?: number;
    y?: number;
    width?: number;
    value?: number;
    index?: number;
    dataKey?: string;
  }) {
    if (!value) return null;
    const ponto = pontos[index];
    const fatia = dataKey === "media" ? ponto?.pctMedia : ponto?.pctUltimo;
    return (
      <text
        x={x + width / 2}
        y={y - 4}
        textAnchor="middle"
        fill="var(--ink)"
        fontSize={10}
        fontWeight={650}
      >
        {pct(fatia ?? 0, (fatia ?? 0) >= 10 ? 0 : 1)}
      </text>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={ALTURA_VISTA}>
      <BarChart data={pontos} margin={{ top: 16, right: 4, bottom: 4, left: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey="nome"
          interval={0}
          tick={<TickNome />}
          height={58}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v: number) => brlCompact(v * 100)}
        />
        <Tooltip
          content={<DicaSeparado ultimoMesLabel={ultimoMesLabel} mediaLabel={mediaLabel} />}
          cursor={{ fill: "color-mix(in srgb, var(--ink) 6%, transparent)" }}
        />
        <Bar dataKey="ultimo" name={ultimoMesLabel} radius={[4, 4, 0, 0]} maxBarSize={22}>
          {pontos.map((p) => (
            <Cell key={`u-${p.slug}`} fill={corDe(p.slug)} />
          ))}
          <LabelList dataKey="ultimo" content={<Rotulo dataKey="ultimo" />} />
        </Bar>
        <Bar dataKey="media" name={mediaLabel} radius={[4, 4, 0, 0]} maxBarSize={22}>
          {pontos.map((p) => (
            <Cell key={`m-${p.slug}`} fill={corDe(p.slug)} fillOpacity={0.38} />
          ))}
          <LabelList dataKey="media" content={<Rotulo dataKey="media" />} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GraficoEmpilhado({
  pontos,
  corDe,
  ultimoMesLabel,
  mediaLabel
}: {
  pontos: Ponto[];
  corDe: (slug: string) => string;
  ultimoMesLabel: string;
  mediaLabel: string;
}) {
  const totalUltimo = pontos.reduce((s, p) => s + p.ultimo, 0);
  const totalMedia = pontos.reduce((s, p) => s + p.media, 0);
  const dados = [
    {
      serie: ultimoMesLabel,
      ...Object.fromEntries(pontos.map((p) => [p.slug, p.ultimo])),
      _total: totalUltimo
    },
    {
      serie: "Média",
      ...Object.fromEntries(pontos.map((p) => [p.slug, p.media])),
      _total: totalMedia
    }
  ];

  function RotuloPilha({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    value,
    index = 0
  }: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    value?: number;
    index?: number;
  }) {
    if (!value || width < 28) return null;
    const total = index === 0 ? totalUltimo : totalMedia;
    const fatia = total ? (value / total) * 100 : 0;
    return (
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={10}
        fontWeight={650}
      >
        {pct(fatia, fatia >= 10 ? 0 : 1)}
      </text>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={ALTURA_VISTA}>
      <BarChart data={dados} layout="vertical" margin={{ top: 8, right: 52, bottom: 4, left: 4 }} barCategoryGap="32%">
        <CartesianGrid stroke="var(--line)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => brlCompact(v * 100)}
        />
        <YAxis
          type="category"
          dataKey="serie"
          width={92}
          tick={{ fontSize: 11, fill: "var(--ink)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<DicaPilha />}
          cursor={{ fill: "color-mix(in srgb, var(--ink) 6%, transparent)" }}
        />
        {pontos.map((p) => (
          <Bar key={p.slug} dataKey={p.slug} name={p.nome} stackId="custo" fill={corDe(p.slug)} maxBarSize={36}>
            <LabelList dataKey={p.slug} content={<RotuloPilha />} />
          </Bar>
        ))}
        <Bar dataKey="_total" name="Total" fill="transparent" legendType="none" isAnimationActive={false} maxBarSize={36}>
          <LabelList
            dataKey="_total"
            position="right"
            formatter={(v: number) => (v ? brlCompact(v * 100) : "")}
            style={{ fontSize: 11, fill: "var(--ink)", fontWeight: 650 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const RADIANO = Math.PI / 180;

function pctDaFatiaPizza(payload: { pct?: number } | undefined, percent: number | undefined) {
  return payload?.pct ?? (percent ?? 0) * 100;
}

function RotuloFatia({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  percent,
  payload,
  minimo
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  payload?: { pct?: number };
  minimo: number;
}) {
  const valor = pctDaFatiaPizza(payload, percent);
  if (valor < minimo) return null;
  const r = outerRadius + 16;
  const x = cx + r * Math.cos(-midAngle * RADIANO);
  const y = cy + r * Math.sin(-midAngle * RADIANO);
  return (
    <text
      x={x}
      y={y}
      fill="var(--ink)"
      fontSize={11}
      fontWeight={650}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
    >
      {pct(valor, valor >= 10 ? 0 : 1)}
    </text>
  );
}

function LinhaFatia({
  points,
  percent,
  payload,
  minimo
}: {
  points?: { x: number; y: number }[];
  percent?: number;
  payload?: { pct?: number };
  minimo: number;
}) {
  const valor = pctDaFatiaPizza(payload, percent);
  if (valor < minimo || !points || points.length < 2) return <g />;
  return (
    <polyline
      points={points.map((p) => `${p.x},${p.y}`).join(" ")}
      fill="none"
      stroke="var(--muted)"
      strokeWidth={1}
    />
  );
}

function Donut({
  pontos,
  campo,
  pctCampo,
  titulo,
  corDe
}: {
  pontos: Ponto[];
  campo: "ultimo" | "media";
  pctCampo: "pctUltimo" | "pctMedia";
  titulo: string;
  corDe: (slug: string) => string;
}) {
  const dados = pontos
    .filter((p) => p[campo] > 0)
    .map((p) => ({ ...p, valor: p[campo], pct: p[pctCampo], fill: corDe(p.slug) }));
  if (!dados.length) return <p className="fin-pessoas-vazio">Nada neste recorte.</p>;
  // Com 13 áreas o rótulo de 1% sobrescreve o vizinho; no time (5 fatias) cabe tudo.
  const minimo = dados.length <= 6 ? 0.4 : 3;
  return (
    <div className="fin-pessoas-custo-donut">
      {titulo ? <h4>{titulo}</h4> : null}
      <ResponsiveContainer width="100%" height={titulo ? ALTURA_VISTA - 22 : ALTURA_VISTA}>
        <PieChart margin={{ top: 10, right: 28, bottom: 10, left: 28 }}>
          <Pie
            data={dados}
            dataKey="valor"
            nameKey="nome"
            innerRadius={40}
            outerRadius={64}
            paddingAngle={0}
            stroke="none"
            label={(props) => <RotuloFatia {...props} minimo={minimo} />}
            labelLine={(props) => <LinhaFatia {...props} minimo={minimo} />}
          >
            {dados.map((p) => (
              <Cell key={p.slug} fill={p.fill} />
            ))}
          </Pie>
          <Tooltip content={<DicaPizza />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ParValor({ cents, fatia }: { cents: number; fatia: number }) {
  return (
    <b>
      {brlCompact(cents)}
      <small>{pct(fatia, 1)}</small>
    </b>
  );
}

function ListaFatias({
  pontos,
  corDe,
  rotuloA,
  rotuloB,
  totalA,
  totalB
}: {
  pontos: Ponto[];
  corDe: (slug: string) => string;
  rotuloA: string;
  rotuloB: string;
  totalA: number;
  totalB: number;
}) {
  return (
    <div className="fin-pessoas-custo-lista-wrap">
      <p className="fin-pessoas-custo-lista-cab">
        <span>
          <i className="solida" /> {rotuloA}
        </span>
        <span>
          <i className="media" /> {rotuloB}
        </span>
      </p>
      <ol className="fin-pessoas-custo-lista">
        {pontos.map((p) => (
          <li key={p.slug}>
            <i style={{ background: corDe(p.slug) }} aria-hidden />
            <span>{p.nome}</span>
            <ParValor cents={p.ultimo * 100} fatia={p.pctUltimo} />
            <ParValor cents={p.media * 100} fatia={p.pctMedia} />
          </li>
        ))}
        <li className="total">
          <i aria-hidden />
          <span>Total</span>
          <ParValor cents={totalA} fatia={totalA ? 100 : 0} />
          <ParValor cents={totalB} fatia={totalB ? 100 : 0} />
        </li>
      </ol>
    </div>
  );
}

function PainelGrafico({
  titulo,
  fatias,
  ultimoMesLabel,
  mediaLabel,
  corDe
}: {
  titulo: string;
  fatias: FatiaCusto[];
  ultimoMesLabel: string;
  mediaLabel: string;
  corDe: (slug: string) => string;
}) {
  const { pontos, totalUltimo, totalMedia } = pontosDe(fatias);

  if (!pontos.length) {
    return (
      <div className="fin-pessoas-custo-painel">
        <h3>{titulo}</h3>
        <p className="fin-pessoas-vazio">Nada neste recorte.</p>
      </div>
    );
  }

  return (
    <div className="fin-pessoas-custo-painel">
      <div className="fin-pessoas-custo-painel-cab">
        <div>
          <h3>{titulo}</h3>
          <p className="fin-pessoas-custo-painel-total">
            {brlPrecise(totalUltimo)}
            <small>
              {ultimoMesLabel} · {mediaLabel} {brlPrecise(totalMedia)}
            </small>
          </p>
        </div>
      </div>

      <div className="fin-pessoas-custo-vistas">
        <div className="fin-pessoas-custo-vista">
          <h4>Separado</h4>
          <GraficoSeparado
            pontos={pontos}
            corDe={corDe}
            ultimoMesLabel={ultimoMesLabel}
            mediaLabel={mediaLabel}
          />
        </div>
        <div className="fin-pessoas-custo-vista">
          <h4>Empilhado</h4>
          <GraficoEmpilhado
            pontos={pontos}
            corDe={corDe}
            ultimoMesLabel={ultimoMesLabel}
            mediaLabel={mediaLabel}
          />
        </div>
        <div className="fin-pessoas-custo-vista">
          <h4>Pizza · {ultimoMesLabel}</h4>
          <Donut
            pontos={pontos}
            campo="ultimo"
            pctCampo="pctUltimo"
            titulo=""
            corDe={corDe}
          />
        </div>
      </div>

      <ListaFatias
        pontos={pontos}
        corDe={corDe}
        rotuloA={ultimoMesLabel}
        rotuloB={mediaLabel}
        totalA={totalUltimo}
        totalB={totalMedia}
      />
    </div>
  );
}

/**
 * Um painel por dimensão. Eram três props fixas (`porTime`, `porArea`,
 * `porCategoria`) porque só Pessoas usava o componente; a guia de Custos tem
 * dimensões diferentes — não há "time" num aluguel, e há "fixo × variável" que
 * pessoa não tem. Uma LISTA acomoda as duas telas sem que nenhuma carregue as
 * dimensões da outra como `undefined`.
 */
export type PainelDimensao = {
  titulo: string;
  fatias: FatiaCusto[];
  corDe: (slug: string) => string;
};

export function FinPessoasCustoGraficos({
  paineis,
  nota,
  ultimoMesLabel,
  mediaLabel,
  opcoesComparativo,
  serieA,
  serieB,
  onSerieA,
  onSerieB,
  atalhos
}: {
  paineis: PainelDimensao[];
  /** O texto abaixo do comparador. Cada tela explica a própria regra de rateio. */
  nota?: ReactNode;
  ultimoMesLabel: string;
  mediaLabel: string;
  opcoesComparativo: { id: string; nome: string }[];
  serieA: string;
  serieB: string;
  onSerieA: (id: string) => void;
  onSerieB: (id: string) => void;
  atalhos: { id: string; nome: string; a: string; b: string }[];
}) {
  return (
    <div className="fin-pessoas-custo-graficos">
      <div className="fin-pessoas-custo-comparativo">
        <label className="fin-pessoas-custo-legenda-serie">
          <span>
            <i className="solida" /> Comparar
          </span>
          <select
            className="fin-select fin-select-inline"
            value={serieA}
            onChange={(e) => onSerieA(e.target.value)}
            aria-label="Primeira série do comparativo"
          >
            {opcoesComparativo.map((o) => (
              <option key={`a-${o.id}`} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </label>
        <span className="fin-pessoas-custo-vs" aria-hidden>
          ×
        </span>
        <label className="fin-pessoas-custo-legenda-serie">
          <span>
            <i className="media" /> com
          </span>
          <select
            className="fin-select fin-select-inline"
            value={serieB}
            onChange={(e) => onSerieB(e.target.value)}
            aria-label="Segunda série do comparativo"
          >
            {opcoesComparativo.map((o) => (
              <option key={`b-${o.id}`} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </label>
        {atalhos.length ? (
          <div className="fin-pessoas-custo-atalhos" role="group" aria-label="Comparativos prontos">
            {atalhos.map((atalho) => {
              const ativo = serieA === atalho.a && serieB === atalho.b;
              return (
                <button
                  key={atalho.id}
                  type="button"
                  className={ativo ? "fin-pessoas-custo-atalho ativo" : "fin-pessoas-custo-atalho"}
                  aria-pressed={ativo}
                  onClick={() => {
                    onSerieA(atalho.a);
                    onSerieB(atalho.b);
                  }}
                >
                  {atalho.nome}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {nota ? <p className="fin-pessoas-custo-nota">{nota}</p> : null}
      <div className="fin-pessoas-custo-grade">
        {paineis.map((painel) => (
          <PainelGrafico
            key={painel.titulo}
            titulo={painel.titulo}
            fatias={painel.fatias}
            ultimoMesLabel={ultimoMesLabel}
            mediaLabel={mediaLabel}
            corDe={painel.corDe}
          />
        ))}
      </div>
    </div>
  );
}
