"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Filter, RotateCcw, Save, Upload, X } from "lucide-react";
import type { ObraSubgroupDeal } from "@/lib/analysis/types";
import { brl } from "@/lib/analysis/format";
import {
  OBRA_CONFIDENCE_OPTIONS,
  OBRA_OVERRIDES_STORAGE_KEY,
  OBRA_SUBGROUP_OPTIONS,
  type ObraConfidence,
  type ObraSubgroupOverride,
  type ObraSubgroupOverridesFile,
  type EditableObraDeal
} from "@/lib/obra-subgroups/constants";
import {
  applyObraOverrides,
  clientsBreakdown,
  computeObraSubgroupSummary,
  dealsForSubgroup
} from "@/lib/obra-subgroups/merge";

type Props = {
  deals: ObraSubgroupDeal[];
};

function confidenceLabel(value: string) {
  if (value === "confirmed") return "confirmado";
  if (value === "probable") return "provável";
  if (value === "high") return "alta";
  if (value === "medium") return "média";
  return "baixa";
}

function confidenceClass(value: string) {
  if (value === "low") return "amber";
  if (value === "medium" || value === "probable") return "amber";
  return "green";
}

export function ObraSubgroupsPanel({ deals: initialDeals }: Props) {
  const [overrides, setOverrides] = useState<Record<string, ObraSubgroupOverride>>({});
  const [draftDeals, setDraftDeals] = useState<EditableObraDeal[]>(() => applyObraOverrides(initialDeals, {}));
  const [selectedSubgroup, setSelectedSubgroup] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadOverrides = useCallback(async () => {
    let merged: ObraSubgroupOverridesFile = { version: 1, updatedAt: "", overrides: {} };

    try {
      const response = await fetch("/api/obra-subgroups/overrides");
      if (response.ok) merged = await response.json();
    } catch {
      // API indisponível (build estático ou rede)
    }

    try {
      const localRaw = localStorage.getItem(OBRA_OVERRIDES_STORAGE_KEY);
      if (localRaw) {
        const local = JSON.parse(localRaw) as ObraSubgroupOverridesFile;
        if (!merged.updatedAt || (local.updatedAt && local.updatedAt > merged.updatedAt)) {
          merged = {
            version: local.version,
            updatedAt: local.updatedAt,
            overrides: { ...merged.overrides, ...local.overrides }
          };
        }
      }
    } catch {
      // ignore parse errors
    }

    setOverrides(merged.overrides);
    setDraftDeals(applyObraOverrides(initialDeals, merged.overrides));
    setLoaded(true);
  }, [initialDeals]);

  useEffect(() => {
    loadOverrides();
  }, [loadOverrides]);

  const summary = useMemo(() => computeObraSubgroupSummary(draftDeals), [draftDeals]);
  const filteredDeals = useMemo(
    () => dealsForSubgroup(draftDeals, selectedSubgroup),
    [draftDeals, selectedSubgroup]
  );
  const dirtyDeals = useMemo(() => draftDeals.filter((deal) => deal.isDirty), [draftDeals]);

  function toggleSubgroup(subgroup: string) {
    setSelectedSubgroup((current) => (current === subgroup ? null : subgroup));
  }

  function updateDeal(dealId: number, patch: Partial<Pick<EditableObraDeal, "subgroup" | "confidence" | "note">>) {
    setDraftDeals((current) =>
      current.map((deal) =>
        deal.id === dealId
          ? {
              ...deal,
              ...patch,
              isDirty: true
            }
          : deal
      )
    );
  }

  function resetDeal(dealId: number) {
    const original = initialDeals.find((deal) => deal.id === dealId);
    if (!original) return;
    const override = overrides[String(dealId)];
    setDraftDeals((current) =>
      current.map((deal) =>
        deal.id === dealId
          ? {
              ...applyObraOverrides([original], override ? { [String(dealId)]: override } : {})[0],
              isDirty: false
            }
          : deal
      )
    );
  }

  async function persistOverrides(nextOverrides: Record<string, ObraSubgroupOverride>) {
    const payload: ObraSubgroupOverridesFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      overrides: nextOverrides
    };

    localStorage.setItem(OBRA_OVERRIDES_STORAGE_KEY, JSON.stringify(payload));

    try {
      const response = await fetch("/api/obra-subgroups/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Falha ao salvar no servidor");
      setSaveState("saved");
      setSaveMessage("Classificações salvas no projeto e no navegador.");
    } catch {
      setSaveState("saved");
      setSaveMessage("Salvo no navegador. Para persistir no repositório, exporte o JSON e rode npm run analyze.");
    }
  }

  async function saveDirtyChanges() {
    if (!dirtyDeals.length) return;
    setSaveState("saving");

    const nextOverrides = { ...overrides };
    for (const deal of dirtyDeals) {
      nextOverrides[String(deal.id)] = {
        subgroup: deal.subgroup,
        confidence: deal.confidence as ObraConfidence,
        note: deal.note
      };
    }

    setOverrides(nextOverrides);
    setDraftDeals((current) => current.map((deal) => ({ ...deal, isDirty: false })));
    await persistOverrides(nextOverrides);
  }

  function exportOverrides() {
    const payload: ObraSubgroupOverridesFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      overrides
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "obra-subgroup-overrides.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importOverrides(file: File) {
    const text = await file.text();
    const payload = JSON.parse(text) as ObraSubgroupOverridesFile;
    const merged = { ...overrides, ...(payload.overrides ?? {}) };
    setOverrides(merged);
    setDraftDeals(applyObraOverrides(initialDeals, merged));
    await persistOverrides(merged);
  }

  if (!loaded) {
    return (
      <section className="obra-subgroups">
        <p className="metric-note">Carregando classificações de obras…</p>
      </section>
    );
  }

  return (
    <section className="obra-subgroups">
      <div className="section-title subsection-title">
        <div>
          <h3>Subgrupos de obras 2026</h3>
          <p>
            Passe o mouse nos cards para ver clientes e origem. Clique para filtrar a tabela. Edite subgrupo,
            confiança e nota — depois salve.
          </p>
        </div>
        <span className="pill amber">Triagem editável</span>
      </div>

      <div className="obra-toolbar">
        <div className="obra-toolbar-actions">
          <button type="button" className="obra-action-btn" onClick={saveDirtyChanges} disabled={!dirtyDeals.length || saveState === "saving"}>
            <Save size={14} />
            {saveState === "saving" ? "Salvando…" : `Salvar${dirtyDeals.length ? ` (${dirtyDeals.length})` : ""}`}
          </button>
          <button type="button" className="obra-action-btn subtle" onClick={exportOverrides}>
            <Download size={14} /> Exportar JSON
          </button>
          <label className="obra-action-btn subtle">
            <Upload size={14} /> Importar JSON
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importOverrides(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {selectedSubgroup ? (
            <button type="button" className="obra-action-btn subtle" onClick={() => setSelectedSubgroup(null)}>
              <X size={14} /> Limpar filtro
            </button>
          ) : null}
        </div>
        {saveMessage ? <p className="metric-note obra-save-note">{saveMessage}</p> : null}
        {selectedSubgroup ? (
          <p className="metric-note obra-filter-note">
            <Filter size={13} /> Filtrando: <strong>{selectedSubgroup}</strong> · {filteredDeals.length} negócio(s)
          </p>
        ) : null}
      </div>

      <div className="obra-summary-grid">
        {summary.map((item) => {
          const cardDeals = draftDeals.filter((deal) => deal.subgroup === item.subgroup);
          const clients = clientsBreakdown(cardDeals);
          const isActive = selectedSubgroup === item.subgroup;

          return (
            <article
              className={`card obra-summary-card obra-summary-card-interactive ${isActive ? "is-active" : ""}`}
              key={item.subgroup}
              onClick={() => toggleSubgroup(item.subgroup)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleSubgroup(item.subgroup);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
            >
              <span className="metric-label">{item.wonDeals} fechamento(s)</span>
              <h3>{item.subgroup}</h3>
              <p className="metric">{brl.format(item.revenue)}</p>
              <p className="metric-note">
                Ticket {brl.format(item.averageTicket)} · confiança: {item.confidenceBreakdown.confirmed} confirm.,{" "}
                {item.confidenceBreakdown.high} alta, {item.confidenceBreakdown.medium} média, {item.confidenceBreakdown.low} baixa
              </p>

              <div className="obra-card-popover" role="tooltip">
                <strong>Clientes e origem</strong>
                <ul className="obra-card-popover-list">
                  {clients.map((client) => (
                    <li key={client.id}>
                      <span className="obra-popover-client">{client.organization}</span>
                      <span className="obra-popover-meta">
                        {client.month} · {brl.format(client.value)} · {confidenceLabel(client.confidence)}
                      </span>
                      <span className="obra-popover-title">{client.title}</span>
                      {client.note ? <span className="obra-popover-note">{client.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>

      <div className="card obra-deals-panel">
        <div className="card-title">
          <div>
            <h2>Negócios classificados como obras</h2>
            <span>
              {selectedSubgroup
                ? `Mostrando subgrupo selecionado (${filteredDeals.length})`
                : `Todos os negócios (${draftDeals.length})`}
            </span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="obra-deals-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Negócio / cliente</th>
                <th>Subgrupo</th>
                <th>Confiança</th>
                <th>Nota</th>
                <th className="right">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map((deal) => (
                <tr key={deal.id} className={deal.isDirty ? "obra-row-dirty" : ""}>
                  <td><strong>{deal.month}</strong></td>
                  <td>
                    <strong>{deal.title}</strong>
                    <span className="muted table-sub">{deal.organization ?? "Sem organização"}</span>
                    <span className="muted table-sub">{deal.businessTypes.join(", ")}</span>
                    {deal.evidence.length ? (
                      <span className="muted table-sub">
                        Evidência ClickUp: {deal.evidence.map((item) => item.name).join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <select
                      className="obra-inline-select"
                      value={deal.subgroup}
                      onChange={(event) => updateDeal(deal.id, { subgroup: event.target.value })}
                    >
                      {OBRA_SUBGROUP_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {!((OBRA_SUBGROUP_OPTIONS as readonly string[]).includes(deal.subgroup)) ? (
                        <option value={deal.subgroup}>{deal.subgroup}</option>
                      ) : null}
                    </select>
                  </td>
                  <td>
                    <select
                      className="obra-inline-select"
                      value={deal.confidence}
                      onChange={(event) =>
                        updateDeal(deal.id, { confidence: event.target.value as ObraConfidence })
                      }
                    >
                      {OBRA_CONFIDENCE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {confidenceLabel(option)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <textarea
                      className="obra-inline-note"
                      rows={2}
                      value={deal.note}
                      onChange={(event) => updateDeal(deal.id, { note: event.target.value })}
                    />
                  </td>
                  <td className="right"><strong>{brl.format(deal.value)}</strong></td>
                  <td className="obra-row-actions">
                    {deal.isDirty ? (
                      <button type="button" className="obra-icon-btn" title="Desfazer alterações" onClick={() => resetDeal(deal.id)}>
                        <RotateCcw size={14} />
                      </button>
                    ) : (
                      <span className={`pill ${confidenceClass(deal.confidence)}`}>{confidenceLabel(deal.confidence)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredDeals.length ? (
            <p className="metric-note obra-empty-note">Nenhum negócio para o filtro selecionado.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
