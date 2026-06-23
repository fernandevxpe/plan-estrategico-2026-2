"use client";

import Link from "next/link";
import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import type { VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import type { VendasUnitEconomicsDashboard } from "@/lib/areas/build-vendas-unit-economics";
import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import type { AreaDashboardItem, AreasDashboard } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import { AreasSidebar } from "@/components/areas/AreasSidebar";
import { ConsultoriaProjetosAreaPage } from "@/components/areas/ConsultoriaProjetosAreaPage";
import { VendasAreaPage } from "@/components/areas/VendasAreaPage";
import type { ConsultoriaProjetosDashboard } from "@/lib/areas/build-consultoria-projetos-dashboard";

type Props = {
  dashboard: AreasDashboard;
  area: AreaDashboardItem;
  vendasFunnel?: VendasFunnelDashboard | null;
  vendasScenarios?: VendasScenariosDashboard | null;
  vendasUnitEconomics?: VendasUnitEconomicsDashboard | null;
  vendasDirectorDashboard?: VendasDirectorDashboard | null;
  consultoriaProjetos?: ConsultoriaProjetosDashboard | null;
};

export function AreaDetailPage({
  dashboard,
  area,
  vendasFunnel,
  vendasScenarios,
  vendasUnitEconomics,
  vendasDirectorDashboard,
  consultoriaProjetos
}: Props) {
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
          {area.id === "vendas" && vendasFunnel && vendasDirectorDashboard && vendasScenarios && vendasUnitEconomics ? (
            <VendasAreaPage
              area={area}
              funnel={vendasFunnel}
              director={vendasDirectorDashboard}
              scenarios={vendasScenarios}
              unitEconomics={vendasUnitEconomics}
            />
          ) : area.id === "consultoria-projetos" && consultoriaProjetos ? (
            <ConsultoriaProjetosAreaPage area={area} data={consultoriaProjetos} />
          ) : (
            <AreaDetailPanel area={area} />
          )}
        </div>
      </div>
    </div>
  );
}
