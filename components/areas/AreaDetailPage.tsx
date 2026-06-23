"use client";

import Link from "next/link";
import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import type { VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import type { VendasUnitEconomicsDashboard } from "@/lib/areas/build-vendas-unit-economics";
import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import { VendasDirectorDashboardSection } from "@/components/areas/VendasDirectorDashboardSection";
import type { AreaDashboardItem, AreasDashboard } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import { AreasSidebar } from "@/components/areas/AreasSidebar";
import { VendasOperationalFocus } from "@/components/areas/VendasOperationalFocus";
import { VendasFunnelSection } from "@/components/areas/VendasFunnelSection";
import { VendasScenariosSection } from "@/components/areas/VendasScenariosSection";
import { VendasUnitEconomicsSection } from "@/components/areas/VendasUnitEconomicsSection";

type Props = {
  dashboard: AreasDashboard;
  area: AreaDashboardItem;
  vendasFunnel?: VendasFunnelDashboard | null;
  vendasScenarios?: VendasScenariosDashboard | null;
  vendasUnitEconomics?: VendasUnitEconomicsDashboard | null;
  vendasDirectorDashboard?: VendasDirectorDashboard | null;
};

export function AreaDetailPage({ dashboard, area, vendasFunnel, vendasScenarios, vendasUnitEconomics, vendasDirectorDashboard }: Props) {
  return (
    <div className="areas-page">
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/areas">Áreas</Link>
          {area.parentId ? (
            <>
              <span>/</span>
              <Link href={`/areas/${area.parentId}`}>
                {dashboard.areas.find((item) => item.id === area.parentId)?.name ?? area.parentId}
              </Link>
            </>
          ) : null}
          <span>/</span>
          <span>{area.name}</span>
        </nav>
        <h1>{area.name}</h1>
        <p>{area.description}</p>
      </div>

      <div className="areas-layout">
        <AreasSidebar dashboard={dashboard} />
        <div className="areas-content">
          <AreaDetailPanel area={area} />
          {vendasFunnel ? <VendasOperationalFocus funnel={vendasFunnel} /> : null}
          {vendasDirectorDashboard ? <VendasDirectorDashboardSection dashboard={vendasDirectorDashboard} /> : null}
          {vendasFunnel ? <VendasFunnelSection funnel={vendasFunnel} /> : null}
          {vendasScenarios ? <VendasScenariosSection scenarios={vendasScenarios} /> : null}
          {vendasUnitEconomics ? <VendasUnitEconomicsSection unitEconomics={vendasUnitEconomics} /> : null}
        </div>
      </div>
    </div>
  );
}
