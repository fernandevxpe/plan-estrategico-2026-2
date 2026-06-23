"use client";

import type { AreasDashboard } from "@/lib/areas/types";
import { AreasOverview } from "@/components/areas/AreasOverview";
import { AreasSidebar } from "@/components/areas/AreasSidebar";

type Props = {
  dashboard: AreasDashboard;
};

export function AreasIndexPage({ dashboard }: Props) {
  return (
    <div className="areas-page">
      <div className="page-header">
        <h1>Áreas — visão geral</h1>
        <p>
          Planejamento estratégico por área. Clique em uma área para abrir a página dedicada e detalhar o plano
          de execução.
        </p>
      </div>

      <div className="areas-layout">
        <AreasSidebar dashboard={dashboard} />
        <div className="areas-content">
          <AreasOverview dashboard={dashboard} linkToPages />
        </div>
      </div>
    </div>
  );
}
