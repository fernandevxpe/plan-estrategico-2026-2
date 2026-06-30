"use client";

import { useState } from "react";
import type { GestaoCatalog } from "@/lib/gestao-xpe/catalog-types";
import type { GestaoGargalo } from "@/lib/gestao-xpe/types";
import { GestaoBottleneckPanel } from "@/components/gestao-xpe/GestaoBottleneckPanel";

type Props = {
  gargalos: GestaoGargalo[];
  catalog: GestaoCatalog;
  activeWeekKey?: string;
  chartSelectedIds: string[];
  onToggleChartIndicator: (id: string, nome: string) => void;
};

export function GestaoBottlenecksSection({
  gargalos,
  catalog,
  activeWeekKey,
  chartSelectedIds,
  onToggleChartIndicator
}: Props) {
  const [openId, setOpenId] = useState<string | null>(gargalos[0]?.id ?? null);

  return (
    <div className="gestao-bottlenecks">
      <div className="section-title subsection-title">
        <h2>Mapa de gargalos</h2>
        <p>8 gargalos ranqueados — clique em um indicador na tabela para abrir a análise histórica.</p>
      </div>

      <div className="gestao-bottleneck-list">
        {gargalos.map((gargalo) => (
          <GestaoBottleneckPanel
            activeWeekKey={activeWeekKey}
            catalog={catalog}
            chartSelectedIds={chartSelectedIds}
            gargalo={gargalo}
            isOpen={openId === gargalo.id}
            key={gargalo.id}
            onToggle={() => setOpenId(openId === gargalo.id ? null : gargalo.id)}
            onToggleChartIndicator={onToggleChartIndicator}
          />
        ))}
      </div>
    </div>
  );
}
