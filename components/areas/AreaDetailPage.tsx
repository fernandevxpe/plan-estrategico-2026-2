"use client";

import Link from "next/link";
import type { VendasFunnelDashboard } from "@/lib/areas/build-vendas-funnel";
import type { VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import type { VendasUnitEconomicsDashboard } from "@/lib/areas/build-vendas-unit-economics";
import type { VendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import type { AreaDashboardItem, AreasDashboard } from "@/lib/areas/types";
import { AreaDetailPanel } from "@/components/areas/AreasOverview";
import { AreasSidebar } from "@/components/areas/AreasSidebar";
import { AutomacoesFerramentasAreaPage } from "@/components/areas/AutomacoesFerramentasAreaPage";
import { EventosAreaPage } from "@/components/areas/EventosAreaPage";
import { ObrasAreaPage } from "@/components/areas/ObrasAreaPage";
import { ConsultoriaProjetosAreaPage } from "@/components/areas/ConsultoriaProjetosAreaPage";
import { ConsultoriaLaudosAreaPage } from "@/components/areas/ConsultoriaLaudosAreaPage";
import { EscalaAreaPage } from "@/components/areas/EscalaAreaPage";
import { MedidoresIoTAreaPage } from "@/components/areas/MedidoresIoTAreaPage";
import { SmartChargingAreaPage } from "@/components/areas/SmartChargingAreaPage";
import { VendasAreaPage } from "@/components/areas/VendasAreaPage";
import type { AutomacoesFerramentasDashboard } from "@/lib/areas/build-automacoes-ferramentas-dashboard";
import type { EventosDashboard } from "@/lib/areas/build-eventos-dashboard";
import type { ObrasDashboard } from "@/lib/areas/build-obras-dashboard";
import type { ConsultoriaProjetosDashboard } from "@/lib/areas/build-consultoria-projetos-dashboard";
import type { ConsultoriaLaudosDashboard } from "@/lib/areas/build-consultoria-laudos-dashboard";
import type { EscalaDashboard } from "@/lib/areas/build-escala-dashboard";
import type { MedidoresIoTDashboard } from "@/lib/areas/build-medidores-iot-dashboard";
import type { SmartChargingDashboard } from "@/lib/areas/build-smart-charging-dashboard";

type Props = {
  dashboard: AreasDashboard;
  area: AreaDashboardItem;
  vendasFunnel?: VendasFunnelDashboard | null;
  vendasScenarios?: VendasScenariosDashboard | null;
  vendasUnitEconomics?: VendasUnitEconomicsDashboard | null;
  vendasDirectorDashboard?: VendasDirectorDashboard | null;
  consultoriaProjetos?: ConsultoriaProjetosDashboard | null;
  consultoriaLaudos?: ConsultoriaLaudosDashboard | null;
  medidoresIoT?: MedidoresIoTDashboard | null;
  smartCharging?: SmartChargingDashboard | null;
  escala?: EscalaDashboard | null;
  automacoesFerramentas?: AutomacoesFerramentasDashboard | null;
  eventos?: EventosDashboard | null;
  obras?: ObrasDashboard | null;
};

export function AreaDetailPage({
  dashboard,
  area,
  vendasFunnel,
  vendasScenarios,
  vendasUnitEconomics,
  vendasDirectorDashboard,
  consultoriaProjetos,
  consultoriaLaudos,
  medidoresIoT,
  smartCharging,
  escala,
  automacoesFerramentas,
  eventos,
  obras
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
          ) : area.id === "consultoria-laudos" && consultoriaLaudos ? (
            <ConsultoriaLaudosAreaPage area={area} data={consultoriaLaudos} />
          ) : area.id === "medidores-iot" && medidoresIoT ? (
            <MedidoresIoTAreaPage area={area} data={medidoresIoT} />
          ) : area.id === "smart-charging" && smartCharging ? (
            <SmartChargingAreaPage area={area} data={smartCharging} />
          ) : area.id === "escala" && escala ? (
            <EscalaAreaPage area={area} data={escala} />
          ) : area.id === "automacoes-ferramentas" && automacoesFerramentas ? (
            <AutomacoesFerramentasAreaPage area={area} data={automacoesFerramentas} />
          ) : area.id === "eventos" && eventos ? (
            <EventosAreaPage area={area} data={eventos} />
          ) : area.id === "obras" && obras ? (
            <ObrasAreaPage area={area} data={obras} />
          ) : (
            <AreaDetailPanel area={area} />
          )}
        </div>
      </div>
    </div>
  );
}
