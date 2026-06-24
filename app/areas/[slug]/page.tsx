import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { AreaDetailPage } from "@/components/areas/AreaDetailPage";
import { findAreaById } from "@/lib/areas/build-areas-dashboard";
import { buildVendasFunnel } from "@/lib/areas/build-vendas-funnel";
import { buildVendasScenarios } from "@/lib/areas/build-vendas-scenarios";
import { buildVendasDirectorDashboard } from "@/lib/areas/build-vendas-director-dashboard";
import { buildAutomacoesFerramentasDashboard } from "@/lib/areas/build-automacoes-ferramentas-dashboard";
import { buildObrasDashboard } from "@/lib/areas/build-obras-dashboard";
import { buildEventosDashboard } from "@/lib/areas/build-eventos-dashboard";
import { buildConsultoriaProjetosDashboard } from "@/lib/areas/build-consultoria-projetos-dashboard";
import { buildConsultoriaLaudosDashboard } from "@/lib/areas/build-consultoria-laudos-dashboard";
import { buildEscalaDashboard } from "@/lib/areas/build-escala-dashboard";
import { buildMedidoresIoTDashboard } from "@/lib/areas/build-medidores-iot-dashboard";
import { buildSmartChargingDashboard } from "@/lib/areas/build-smart-charging-dashboard";
import { buildVendasUnitEconomics } from "@/lib/areas/build-vendas-unit-economics";
import { AREA_SLUGS } from "@/lib/areas/registry";
import { loadDashboardData } from "@/lib/data/load-dashboard";

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return AREA_SLUGS.map((slug) => ({ slug }));
}

export default async function AreaSlugPage({ params }: Props) {
  const { slug } = await params;
  const { analysis, areasDashboard } = await loadDashboardData();
  const area = findAreaById(areasDashboard, slug);

  if (!area) notFound();

  const vendasFunnel = slug === "vendas" ? buildVendasFunnel(analysis) : null;
  const vendasScenarios = slug === "vendas" ? buildVendasScenarios(analysis) : null;
  const vendasUnitEconomics =
    slug === "vendas" && vendasScenarios ? buildVendasUnitEconomics(analysis, vendasScenarios.scenarios) : null;
  const vendasDirectorDashboard =
    slug === "vendas" && vendasScenarios
      ? buildVendasDirectorDashboard(analysis, vendasScenarios)
      : null;

  const consultoriaProjetos =
    slug === "consultoria-projetos" ? buildConsultoriaProjetosDashboard(analysis) : null;

  const consultoriaLaudos =
    slug === "consultoria-laudos" ? buildConsultoriaLaudosDashboard(analysis) : null;

  const medidoresIoT = slug === "medidores-iot" ? buildMedidoresIoTDashboard() : null;

  const smartCharging = slug === "smart-charging" ? buildSmartChargingDashboard() : null;

  const escala = slug === "escala" ? buildEscalaDashboard(analysis) : null;

  const automacoesFerramentas =
    slug === "automacoes-ferramentas" ? buildAutomacoesFerramentasDashboard() : null;

  const eventos = slug === "eventos" ? buildEventosDashboard() : null;

  const obras = slug === "obras" ? buildObrasDashboard(analysis) : null;

  return (
    <AppShell>
      <AreaDetailPage
        dashboard={areasDashboard}
        area={area}
        vendasFunnel={vendasFunnel}
        vendasScenarios={vendasScenarios}
        vendasUnitEconomics={vendasUnitEconomics}
        vendasDirectorDashboard={vendasDirectorDashboard}
        consultoriaProjetos={consultoriaProjetos}
        consultoriaLaudos={consultoriaLaudos}
        medidoresIoT={medidoresIoT}
        smartCharging={smartCharging}
        escala={escala}
        automacoesFerramentas={automacoesFerramentas}
        eventos={eventos}
        obras={obras}
      />
    </AppShell>
  );
}
