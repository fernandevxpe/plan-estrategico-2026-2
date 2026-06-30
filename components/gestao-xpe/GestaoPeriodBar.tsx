"use client";

import type { GestaoPeriodo, PeriodAnchor } from "@/lib/gestao-xpe/catalog-types";
import { defaultPeriodAnchor, getISOWeekKey, shiftPeriodAnchor } from "@/lib/gestao-xpe/week-utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PERIODOS: { id: GestaoPeriodo; label: string; short: string }[] = [
  { id: "semanal", label: "Semanal", short: "Sem." },
  { id: "mensal", label: "Mensal", short: "Mês" },
  { id: "trimestral", label: "Trimestral", short: "Trim." },
  { id: "semestral", label: "Semestral", short: "Sem." },
  { id: "anual", label: "Anual", short: "Ano" }
];

export type GestaoSeller = { id: string; label: string };

type Props = {
  anchor: PeriodAnchor;
  onAnchorChange: (anchor: PeriodAnchor) => void;
  variant?: "card" | "toolbar" | "header" | "sidebar";
  showPeriodTypes?: boolean;
  showVendedor?: boolean;
  showJumpToCurrent?: boolean;
  hint?: string;
  sellers?: GestaoSeller[];
  vendedor?: string;
  onVendedorChange?: (vendedor: string) => void;
};

export function GestaoPeriodBar({
  anchor,
  onAnchorChange,
  variant = "card",
  showPeriodTypes = true,
  showVendedor = true,
  showJumpToCurrent = true,
  hint,
  sellers = [],
  vendedor = "todos",
  onVendedorChange
}: Props) {
  const isHeader = variant === "header";
  const isSidebar = variant === "sidebar";
  const isToolbar = variant === "toolbar" || isHeader || isSidebar;
  const currentKey = getISOWeekKey();
  const isCurrentPeriod =
    anchor.periodo === "semanal"
      ? anchor.chave === currentKey
      : anchor.chave === defaultPeriodAnchor(anchor.periodo).chave;

  function setPeriodo(periodo: GestaoPeriodo) {
    onAnchorChange(defaultPeriodAnchor(periodo));
  }

  function jumpToCurrent() {
    onAnchorChange(defaultPeriodAnchor(anchor.periodo));
  }

  const rootClass = isHeader
    ? "gestao-period-header"
    : isSidebar
      ? "gestao-period-sidebar"
      : isToolbar
        ? "gestao-period-toolbar"
        : "gestao-period-bar card";

  return (
    <div className={rootClass} role="toolbar" aria-label="Filtros de período e vendedor">
      <div className={isToolbar ? "gestao-period-toolbar-row" : "gestao-period-filters"}>
        {showPeriodTypes ? (
          <div className="gestao-period-toolbar-group gestao-period-compact-group">
            {!isHeader && !isSidebar ? <span className="gestao-period-toolbar-label">Período</span> : null}
            <div className="mix-segmented gestao-period-types gestao-period-compact">
              {PERIODOS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={anchor.periodo === p.id ? "active" : ""}
                  onClick={() => setPeriodo(p.id)}
                  title={p.label}
                >
                  {isHeader || isSidebar ? p.short : p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showVendedor && onVendedorChange && sellers.length > 0 ? (
          <div className="gestao-period-toolbar-group gestao-period-compact-group">
            {!isHeader && !isSidebar ? <span className="gestao-period-toolbar-label">Vendedor</span> : null}
            <div className="mix-segmented gestao-vendedor-types gestao-period-compact">
              <button
                type="button"
                className={vendedor === "todos" ? "active" : ""}
                onClick={() => onVendedorChange("todos")}
              >
                Todos
              </button>
              {sellers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={vendedor === s.id ? "active" : ""}
                  onClick={() => onVendedorChange(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="gestao-period-toolbar-group gestao-period-nav-group gestao-period-compact-group">
          {!isHeader && !isSidebar ? <span className="gestao-period-toolbar-label">Janela</span> : null}
          <div className="gestao-period-nav gestao-period-compact-nav">
            <button
              type="button"
              aria-label="Período anterior"
              onClick={() => onAnchorChange(shiftPeriodAnchor(anchor, -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="gestao-period-label gestao-period-label-compact">
              <strong>{anchor.label}</strong>
              <span className="gestao-muted">{anchor.chave}</span>
            </div>
            <button
              type="button"
              aria-label="Próximo período"
              onClick={() => onAnchorChange(shiftPeriodAnchor(anchor, 1))}
            >
              <ChevronRight size={16} />
            </button>
            {showJumpToCurrent && !isCurrentPeriod ? (
              <button type="button" className="gestao-period-today" onClick={jumpToCurrent}>
                Atual
              </button>
            ) : null}
          </div>
        </div>

        {!isHeader && hint ? (
          <p className={`gestao-period-hint${isToolbar ? " gestao-period-hint-inline" : ""}`}>{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
