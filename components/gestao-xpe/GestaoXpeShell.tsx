"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AggregatedIndicator, GestaoCatalog, PeriodAnchor, WeeklyRecord } from "@/lib/gestao-xpe/catalog-types";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";
import { applyCrmOverlayToGargalo } from "@/lib/gestao-xpe/apply-crm-overlay";
import type { CrmWeekMetrics } from "@/lib/gestao-xpe/crm-week-sync";
import { GestaoExecutiveBlock } from "@/components/gestao-xpe/GestaoExecutiveBlock";
import { GestaoValueFlow } from "@/components/gestao-xpe/GestaoValueFlow";
import { GestaoBottlenecksSection } from "@/components/gestao-xpe/GestaoBottlenecksSection";
import { GestaoMotorsSection } from "@/components/gestao-xpe/GestaoMotorsSection";
import { GestaoInvisibleInventory } from "@/components/gestao-xpe/GestaoInvisibleInventory";
import { GestaoWeeklyBulletin } from "@/components/gestao-xpe/GestaoWeeklyBulletin";
import { GestaoTocReference } from "@/components/gestao-xpe/GestaoTocReference";
import { GestaoPeriodBar, type GestaoSeller } from "@/components/gestao-xpe/GestaoPeriodBar";
import { GestaoLancamentosTab } from "@/components/gestao-xpe/GestaoLancamentosTab";
import { GestaoReferenciaTab } from "@/components/gestao-xpe/GestaoReferenciaTab";
import { GestaoHistoricoTab } from "@/components/gestao-xpe/GestaoHistoricoTab";
import { GestaoIndicadorChartPanel } from "@/components/gestao-xpe/GestaoIndicadorChartPanel";
import { mergeGargaloWithAggregated, mergeGargaloWithWeek } from "@/lib/gestao-xpe/merge-week-data";
import { defaultPeriodAnchor, getISOWeekKey } from "@/lib/gestao-xpe/week-utils";

type TabId = "monitor" | "lancar" | "referencia" | "historico";

type WeekSummary = {
  weekKey: string;
  label: string;
  status: string;
  filled: number;
  total: number;
};

type Props = {
  dashboard: GestaoDashboard;
  catalog: GestaoCatalog;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "monitor", label: "Monitor" },
  { id: "lancar", label: "Lançar" },
  { id: "referencia", label: "Metas" },
  { id: "historico", label: "Histórico" }
];

export function GestaoXpeShell({ dashboard, catalog: initialCatalog }: Props) {
  const [tab, setTab] = useState<TabId>("monitor");
  const [catalog, setCatalog] = useState(initialCatalog);
  const [periodAnchor, setPeriodAnchor] = useState<PeriodAnchor>(() => defaultPeriodAnchor("semanal"));
  const [weekRecord, setWeekRecord] = useState<WeeklyRecord | null>(null);
  const [aggregated, setAggregated] = useState<Record<string, AggregatedIndicator>>({});
  const [semanasNoPeriodo, setSemanasNoPeriodo] = useState(1);
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [sellers, setSellers] = useState<GestaoSeller[]>([]);
  const [vendedor, setVendedor] = useState("todos");
  const [crmOverlay, setCrmOverlay] = useState<CrmWeekMetrics | null>(null);
  const [chartIds, setChartIds] = useState<string[]>([]);
  const [chartNames, setChartNames] = useState<Record<string, string>>({});

  const refreshWeeks = useCallback(async () => {
    const res = await fetch("/api/gestao-xpe/weeks?ensure=current");
    const data = (await res.json()) as { semanas: WeekSummary[] };
    setWeeks(data.semanas);
  }, []);

  useEffect(() => {
    void fetch("/api/gestao-xpe/sellers")
      .then((r) => r.json())
      .then((data: { sellers: GestaoSeller[] }) => setSellers(data.sellers ?? []));
  }, []);

  const loadPeriodData = useCallback(async (anchor: PeriodAnchor) => {
    const aggRes = await fetch(
      `/api/gestao-xpe/aggregate?periodo=${anchor.periodo}&chave=${encodeURIComponent(anchor.chave)}`
    );
    const aggData = (await aggRes.json()) as {
      aggregated: Record<string, AggregatedIndicator>;
      semanasNoPeriodo: number;
    };
    setAggregated(aggData.aggregated);
    setSemanasNoPeriodo(aggData.semanasNoPeriodo);

    if (anchor.periodo === "semanal") {
      const res = await fetch(`/api/gestao-xpe/weeks/${encodeURIComponent(anchor.chave)}`);
      setWeekRecord((await res.json()) as WeeklyRecord);
    } else {
      setWeekRecord(null);
    }
  }, []);

  const loadCrmOverlay = useCallback(async (anchor: PeriodAnchor, vend: string) => {
    const q = vend && vend !== "todos" ? `vendedor=${encodeURIComponent(vend)}` : "";
    const url =
      anchor.periodo === "semanal"
        ? `/api/gestao-xpe/crm/${encodeURIComponent(anchor.chave)}${q ? `?${q}` : ""}`
        : `/api/gestao-xpe/crm-period?periodo=${anchor.periodo}&chave=${encodeURIComponent(anchor.chave)}${q ? `&${q}` : ""}`;
    const res = await fetch(url);
    if (res.ok) setCrmOverlay((await res.json()) as CrmWeekMetrics);
    else setCrmOverlay(null);
  }, []);

  useEffect(() => {
    refreshWeeks();
  }, [refreshWeeks]);

  useEffect(() => {
    if (tab === "monitor" || tab === "historico" || tab === "lancar") {
      void loadPeriodData(periodAnchor);
    }
  }, [tab, periodAnchor, loadPeriodData]);

  useEffect(() => {
    if (tab === "monitor") {
      void loadCrmOverlay(periodAnchor, vendedor);
    }
  }, [tab, periodAnchor, vendedor, loadCrmOverlay]);

  const handleTabChange = useCallback(
    (next: TabId) => {
      setTab(next);
      if (next === "lancar" && periodAnchor.periodo !== "semanal") {
        setPeriodAnchor(defaultPeriodAnchor("semanal"));
      }
    },
    [periodAnchor.periodo]
  );

  const toggleChartIndicator = useCallback((id: string, nome: string) => {
    setChartIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
    setChartNames((prev) => ({ ...prev, [id]: nome }));
  }, []);

  const clearChartSelection = useCallback(() => {
    setChartIds([]);
  }, []);

  const removeChartIndicator = useCallback((id: string) => {
    setChartIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const mergedGargalos = useMemo(() => {
    return dashboard.gargalos.map((g) => {
      if (periodAnchor.periodo === "semanal" && weekRecord) {
        return mergeGargaloWithWeek(g, catalog, weekRecord, weekRecord.label);
      }
      if (periodAnchor.periodo !== "semanal") {
        return mergeGargaloWithAggregated(
          g,
          catalog,
          aggregated,
          periodAnchor.label || periodAnchor.chave,
          semanasNoPeriodo
        );
      }
      return mergeGargaloWithWeek(g, catalog, null);
    });
  }, [dashboard.gargalos, catalog, periodAnchor, weekRecord, aggregated, semanasNoPeriodo]);

  const displayGargalos = useMemo(() => {
    if (!crmOverlay) return mergedGargalos;
    return mergedGargalos.map((g) => applyCrmOverlayToGargalo(g, crmOverlay));
  }, [mergedGargalos, crmOverlay]);

  const periodHint = useMemo(() => {
    if (tab === "lancar") {
      return "Lançamento semanal — use as setas para trocar a semana. Monitor e Histórico seguem a mesma janela.";
    }
    if (tab === "historico") {
      return `Totais e médias de ${semanasNoPeriodo} semana(s) com lançamento no período.`;
    }
    if (vendedor !== "todos") {
      return "Indicadores do CRM filtrados por vendedor. Campos manuais permanecem da equipe.";
    }
    if (periodAnchor.periodo === "semanal") {
      return "Indicadores da semana selecionada. Ajuste período, vendedor ou janela acima.";
    }
    return `Visão agregada de ${semanasNoPeriodo} semana(s) no período.`;
  }, [tab, vendedor, periodAnchor.periodo, semanasNoPeriodo]);

  const lancarWeekKey = periodAnchor.periodo === "semanal" ? periodAnchor.chave : getISOWeekKey();
  const showToolbar = tab !== "referencia";

  return (
    <div className={`gestao-page${chartIds.length ? " gestao-page-chart-open" : ""}`}>
      <div className="gestao-sticky-header">
        <div className="gestao-top-bar">
          <h1 className="gestao-top-title">Gestão XPE</h1>

          <div className="mix-segmented gestao-main-tabs gestao-main-tabs-inline">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "active" : ""}
                onClick={() => handleTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {showToolbar ? (
            <GestaoPeriodBar
              variant="header"
              anchor={periodAnchor}
              sellers={sellers}
              vendedor={vendedor}
              showPeriodTypes={tab !== "lancar"}
              showVendedor={tab === "monitor"}
              showJumpToCurrent={periodAnchor.chave !== defaultPeriodAnchor(periodAnchor.periodo).chave}
              onAnchorChange={setPeriodAnchor}
              onVendedorChange={setVendedor}
            />
          ) : null}
        </div>

        {showToolbar && periodHint ? <p className="gestao-top-hint">{periodHint}</p> : null}
      </div>

      {tab === "monitor" ? (
        <div className="gestao-tab-panel">
          <GestaoExecutiveBlock dashboard={dashboard} />
          <section className="page-zone">
            <GestaoValueFlow dashboard={dashboard} />
          </section>
          <section className="page-zone">
            <GestaoBottlenecksSection
              activeWeekKey={periodAnchor.periodo === "semanal" ? periodAnchor.chave : undefined}
              catalog={catalog}
              chartSelectedIds={chartIds}
              gargalos={displayGargalos}
              onToggleChartIndicator={toggleChartIndicator}
            />
          </section>
          <section className="page-zone">
            <GestaoMotorsSection motores={dashboard.motores} conversao={dashboard.conversao} />
          </section>
          <section className="page-zone">
            <GestaoInvisibleInventory estoques={dashboard.estoquesInvisiveis} />
          </section>
          <section className="page-zone gestao-bottom-grid">
            <GestaoWeeklyBulletin boletim={dashboard.boletim} />
            <GestaoTocReference toc={dashboard.toc} />
          </section>
        </div>
      ) : null}

      {tab === "lancar" ? (
        <GestaoLancamentosTab catalog={catalog} weekKey={lancarWeekKey} onSaved={refreshWeeks} />
      ) : null}

      {tab === "referencia" ? (
        <GestaoReferenciaTab catalog={catalog} onSaved={setCatalog} />
      ) : null}

      {tab === "historico" ? (
        <GestaoHistoricoTab
          aggregated={aggregated}
          catalog={catalog}
          semanasNoPeriodo={semanasNoPeriodo}
          weeks={weeks}
        />
      ) : null}

      <GestaoIndicadorChartPanel
        catalog={catalog}
        highlightWeekKey={periodAnchor.periodo === "semanal" ? periodAnchor.chave : undefined}
        selectedIds={chartIds}
        selectedNames={chartNames}
        vendedor={vendedor}
        onClear={clearChartSelection}
        onRemove={removeChartIndicator}
      />
    </div>
  );
}
