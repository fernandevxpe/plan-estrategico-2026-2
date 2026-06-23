"use client";

import { useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { AreasDashboard } from "@/lib/areas/types";
import { findAreaById, flattenAreasForNav } from "@/lib/areas/build-areas-dashboard";
import { AreasOverview, AreaDetailPanel } from "@/components/areas/AreasOverview";

type Props = {
  dashboard: AreasDashboard;
};

export function AreasPlanningSection({ dashboard }: Props) {
  const [activeId, setActiveId] = useState("overview");
  const navItems = useMemo(() => flattenAreasForNav(dashboard), [dashboard]);
  const activeArea = activeId === "overview" ? null : findAreaById(dashboard, activeId);

  return (
    <section className="areas-planning page-zone" id="areas">
      <div className="section-title guide-section-head">
        <div>
          <h2>Áreas — planejamento estratégico</h2>
          <p>
            Plano por área com objetivos, atividades, responsáveis e visão consolidada. Vamos construir e refinar
            cada área em conjunto.
          </p>
        </div>
        <span className="pill green">
          <LayoutGrid size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          {dashboard.overview.totalAreas} áreas
        </span>
      </div>

      <div className="areas-layout">
        <nav className="areas-nav" aria-label="Áreas">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`areas-nav-item ${activeId === item.id ? "active" : ""} ${item.parentId ? "child" : ""}`}
              onClick={() => setActiveId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </nav>

        <div className="areas-content">
          {activeId === "overview" || !activeArea ? (
            <AreasOverview dashboard={dashboard} />
          ) : (
            <AreaDetailPanel area={activeArea} />
          )}
        </div>
      </div>
    </section>
  );
}
