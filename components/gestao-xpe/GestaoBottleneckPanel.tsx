"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Target,
  TrendingUp,
  Zap
} from "lucide-react";
import type { GestaoCatalog } from "@/lib/gestao-xpe/catalog-types";
import type { GestaoGargalo, GestaoIndicador, GestaoIndicadorGrupo } from "@/lib/gestao-xpe/types";
import { GestaoOrigemBadge } from "@/components/gestao-xpe/GestaoOrigemBadge";
import {
  evaluateIndicadorStatus,
  indicadorKey
} from "@/lib/gestao-xpe/metrics";

type Props = {
  gargalo: GestaoGargalo;
  catalog: GestaoCatalog;
  isOpen: boolean;
  activeWeekKey?: string;
  chartSelectedIds: string[];
  onToggle: () => void;
  onToggleChartIndicator: (id: string, nome: string) => void;
};

function statusPill(status: string) {
  if (status === "em_andamento") return "amber";
  if (status === "concluido") return "green";
  if (status === "bloqueado") return "red";
  return "blue";
}

function display(value: string | null | undefined) {
  return value?.trim() || "—";
}

function statusClass(status: ReturnType<typeof evaluateIndicadorStatus>) {
  if (status === "ok") return "ok";
  if (status === "bad") return "bad";
  return "";
}

function resolveComputedValue(
  ind: GestaoIndicador,
  _lookup: Map<string, GestaoIndicador>
): string | null {
  if (ind.calculado || ind.origemDado === "analise") return ind.valor;
  return ind.valor;
}

function buildLookup(grupos: GestaoIndicadorGrupo[]) {
  const map = new Map<string, GestaoIndicador>();
  for (const grupo of grupos) {
    for (const ind of grupo.indicadores) {
      if (ind.id) map.set(ind.id, ind);
    }
  }
  return map;
}

function indicadorPreenchido(ind: GestaoIndicador, lookup: Map<string, GestaoIndicador>) {
  const valor = resolveComputedValue(ind, lookup);
  return Boolean(valor?.trim());
}

function HeaderDestaqueKpis({
  gargalo,
  catalog,
  grupos
}: {
  gargalo: GestaoGargalo;
  catalog: GestaoCatalog;
  grupos: GestaoIndicadorGrupo[];
}) {
  const lookup = useMemo(() => buildLookup(grupos), [grupos]);
  const destaques = useMemo(
    () =>
      Object.values(catalog.indicators).filter(
        (d) => d.destaque && d.escopoId === gargalo.id
      ),
    [catalog.indicators, gargalo.id]
  );

  if (!destaques.length) return null;

  return (
    <div className="gestao-bn-header-kpis">
      {destaques.map((def) => {
        const ind = lookup.get(def.id);
        if (!ind) return null;
        const valor = resolveComputedValue(ind, lookup);
        const filled = indicadorPreenchido(ind, lookup);
        const st = evaluateIndicadorStatus(ind.meta, valor, ind.tipo);
        return (
          <div
            className={`gestao-bn-header-kpi ${statusClass(st)}${filled ? " filled" : " empty"}`}
            key={def.id}
            title={`${ind.nome} — meta ${display(ind.meta)}`}
          >
            <span className="gestao-bn-header-kpi-name">{ind.nome}</span>
            <strong>
              {display(valor)}
              {ind.unidade && valor ? ` ${ind.unidade}` : ""}
            </strong>
            <span className={`gestao-bn-fill-dot ${filled ? "on" : "off"}`} title={filled ? "Atualizado" : "Pendente"} />
          </div>
        );
      })}
    </div>
  );
}

function IndicadorRow({
  ind,
  lookup,
  selected,
  onToggleSelect
}: {
  ind: GestaoIndicador;
  lookup: Map<string, GestaoIndicador>;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const valor = resolveComputedValue(ind, lookup);
  const st = evaluateIndicadorStatus(ind.meta, valor, ind.tipo);
  const isAnalise = ind.origemDado === "analise";
  const rowId = ind.id ?? ind.nome;

  return (
    <tr
      className={`gestao-bn-ind-row ${statusClass(st)}${isAnalise ? " analise" : ""}${selected ? " selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect(rowId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleSelect(rowId);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      title="Clique para ver histórico no gráfico. Clique de novo para remover da comparação."
    >
      <td className="gestao-bn-ind-label">
        <span className="gestao-bn-ind-name">{ind.nome}</span>
        <span className="gestao-bn-ind-tags">
          <GestaoOrigemBadge origem={ind.origemDado} />
          {ind.calculado ? <span className="gestao-bn-tag analise">calc</span> : null}
        </span>
      </td>
      <td className="gestao-bn-meta">{display(ind.meta)}</td>
      <td className="gestao-bn-valor">
        <span>
          {display(valor)}
          {ind.unidade && valor ? <span className="gestao-unit"> {ind.unidade}</span> : null}
        </span>
        {st !== "neutral" ? (
          <span className={`gestao-bn-status-dot ${st}`} title={st === "ok" ? "Na meta" : "Fora da meta"} />
        ) : null}
      </td>
    </tr>
  );
}

function PainelSemanal({
  gargalo,
  chartSelectedIds,
  onToggleChartIndicator
}: {
  gargalo: GestaoGargalo;
  chartSelectedIds: string[];
  onToggleChartIndicator: (id: string, nome: string) => void;
}) {
  const painel = gargalo.painelSemanal!;
  const [openGrupos, setOpenGrupos] = useState<Set<string>>(new Set(["volume"]));
  const lookup = useMemo(() => buildLookup(painel.grupos), [painel.grupos]);

  function toggleGrupo(id: string) {
    setOpenGrupos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const grupoIcons: Record<string, typeof Target> = {
    volume: TrendingUp,
    velocidade: Zap,
    analise: Target
  };

  return (
    <div className="gestao-bn-painel">
      <div className="gestao-bn-painel-head">
        <div>
          <span className="gestao-bn-semana-label">Semana</span>
          <strong>{painel.semana.trim() || "— definir no JSON —"}</strong>
        </div>
        <p className="gestao-muted">{painel.resumo}</p>
      </div>

      {painel.definicaoNobre ? (
        <div className="gestao-bn-nobre-def card">
          <p>{painel.definicaoNobre}</p>
        </div>
      ) : null}

      <div className="gestao-bn-grupos">
        {painel.grupos.map((grupo) => {
          const isGrupoOpen = openGrupos.has(grupo.id);
          const Icon = grupoIcons[grupo.id] ?? Target;
          const filled = grupo.indicadores.filter((i) => indicadorPreenchido(i, lookup)).length;
          const total = grupo.indicadores.length;
          const isAnalise = grupo.id === "analise";

          return (
            <div
              className={`gestao-bn-grupo card${isGrupoOpen ? " open" : ""}${isAnalise ? " analise" : ""}`}
              key={grupo.id}
            >
              <button
                type="button"
                className="gestao-bn-grupo-header"
                onClick={() => toggleGrupo(grupo.id)}
                aria-expanded={isGrupoOpen}
              >
                <Icon size={16} />
                <div className="gestao-bn-grupo-title">
                  <strong>{grupo.titulo}</strong>
                  {grupo.descricao ? <span>{grupo.descricao}</span> : null}
                </div>
                <span className="gestao-bn-grupo-progress">
                  {isAnalise ? "auto" : `${filled}/${total}`}
                </span>
                {isGrupoOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {isGrupoOpen ? (
                <table className="gestao-table gestao-bn-ind-table">
                  <thead>
                    <tr>
                      <th>Indicador</th>
                      <th>Meta semana</th>
                      <th>{isAnalise ? "Calculado" : "Realizado"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.indicadores.map((ind) => {
                      const rowId = ind.id ?? ind.nome;
                      return (
                        <IndicadorRow
                          ind={ind}
                          lookup={lookup}
                          key={indicadorKey(ind)}
                          onToggleSelect={() => onToggleChartIndicator(rowId, ind.nome)}
                          selected={chartSelectedIds.includes(rowId)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PainelLegado({ gargalo }: { gargalo: GestaoGargalo }) {
  const indicadores = gargalo.indicadores ?? [];
  return (
    <table className="gestao-table">
      <thead>
        <tr>
          <th>Indicador</th>
          <th>Meta</th>
          <th>Atual</th>
        </tr>
      </thead>
      <tbody>
        {indicadores.map((ind) => (
          <tr key={indicadorKey(ind)}>
            <td>
              {ind.nome}
              {ind.unidade ? <span className="gestao-unit"> ({ind.unidade})</span> : null}
            </td>
            <td>{display(ind.meta)}</td>
            <td>{display(ind.valor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlanosAcao({ gargalo }: { gargalo: GestaoGargalo }) {
  const [open, setOpen] = useState(false);
  const concluidas = gargalo.acoes.filter((a) => a.status === "concluido").length;

  return (
    <div className={`gestao-bn-acoes card${open ? " open" : ""}`}>
      <button type="button" className="gestao-bn-acoes-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>Planos de ação</strong>
        <span className="gestao-muted">
          {concluidas}/{gargalo.acoes.length} concluídas
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open ? (
        <table className="gestao-table gestao-actions-table">
          <thead>
            <tr>
              <th>Ação</th>
              <th>Responsável</th>
              <th>Prazo</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {gargalo.acoes.map((acao) => (
              <tr key={acao.id}>
                <td>{acao.titulo}</td>
                <td>{acao.responsavel.trim() || "—"}</td>
                <td>{acao.prazo.trim() || "—"}</td>
                <td>
                  <span className={`pill tiny ${statusPill(acao.status)}`}>
                    {acao.status.replace("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function GestaoBottleneckPanel({
  gargalo,
  catalog,
  isOpen,
  chartSelectedIds,
  onToggle,
  onToggleChartIndicator
}: Props) {
  const hasPainel = Boolean(gargalo.painelSemanal);
  const painel = gargalo.painelSemanal;
  const grupos = painel?.grupos ?? [];
  const lookup = useMemo(() => buildLookup(grupos), [grupos]);

  const summaryFilled = painel
    ? painel.grupos
        .filter((g) => g.id !== "analise")
        .reduce(
          (acc, g) => acc + g.indicadores.filter((i) => indicadorPreenchido(i, lookup)).length,
          0
        )
    : 0;
  const summaryTotal = painel
    ? painel.grupos
        .filter((g) => g.id !== "analise")
        .reduce((acc, g) => acc + g.indicadores.length, 0)
    : (gargalo.indicadores?.length ?? 0);

  return (
    <article className={`gestao-bottleneck-card card${isOpen ? " open" : ""}${hasPainel ? " enhanced" : ""}`}>
      <button type="button" className="gestao-bottleneck-header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="gestao-bottleneck-rank">#{gargalo.rank}</span>
        <div className="gestao-bottleneck-title">
          <strong>{gargalo.nome}</strong>
          <span className="gestao-muted">{gargalo.area}</span>
        </div>
        {hasPainel && !isOpen ? (
          <HeaderDestaqueKpis gargalo={gargalo} catalog={catalog} grupos={grupos} />
        ) : null}
        {hasPainel ? (
          <span className="gestao-bn-header-badge">
            {summaryFilled}/{summaryTotal}
          </span>
        ) : null}
        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>

      {isOpen ? (
        <div className="gestao-bottleneck-body">
          <p>{gargalo.descricao}</p>

          {!hasPainel ? (
            <div className="gestao-bottleneck-grid">
              <div>
                <h3>Sintomas</h3>
                <ul className="gestao-list">
                  {gargalo.sintomas.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Indicadores principais</h3>
                <PainelLegado gargalo={gargalo} />
              </div>
            </div>
          ) : (
            <>
              <div className="gestao-bn-sintomas">
                {gargalo.sintomas.map((s) => (
                  <span className="pill amber tiny" key={s}>
                    {s}
                  </span>
                ))}
              </div>
              <PainelSemanal
                chartSelectedIds={chartSelectedIds}
                gargalo={gargalo}
                onToggleChartIndicator={onToggleChartIndicator}
              />
            </>
          )}

          {!hasPainel ? (
            <div className="gestao-universal-metrics">
              <h3>Métricas universais TOC</h3>
              <div className="gestao-metrics-row">
                {(
                  [
                    ["Capacidade", gargalo.metricasUniversais.capacidade],
                    ["Demanda", gargalo.metricasUniversais.demanda],
                    ["Fila", gargalo.metricasUniversais.fila],
                    ["Lead time", gargalo.metricasUniversais.leadTime],
                    ["Retrabalho", gargalo.metricasUniversais.retrabalho],
                    ["Impacto financeiro", gargalo.metricasUniversais.impactoFinanceiro]
                  ] as const
                ).map(([label, val]) => (
                  <div className="gestao-metric-chip" key={label}>
                    <span>{label}</span>
                    <strong>{display(val)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <PlanosAcao gargalo={gargalo} />
        </div>
      ) : null}
    </article>
  );
}
