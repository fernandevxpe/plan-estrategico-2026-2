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

  function renderPanel(gargalo: GestaoGargalo) {
    return (
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
    );
  }

  const listItems: React.ReactNode[] = [];
  let index = 0;

  while (index < gargalos.length) {
    const current = gargalos[index];

    if (current.grupo === "obras") {
      const obrasGargalos: GestaoGargalo[] = [];
      while (index < gargalos.length && gargalos[index].grupo === "obras") {
        obrasGargalos.push(gargalos[index]);
        index += 1;
      }

      listItems.push(
        <div className="gestao-bottleneck-group" key="grupo-obras">
          <div className="gestao-bottleneck-group-header">
            <h3>Obras</h3>
            <p>Escopo fechado (#5) e capacidade de execução (#6) — diário de obras como fonte única.</p>
          </div>
          <div className="gestao-bottleneck-group-list">{obrasGargalos.map(renderPanel)}</div>
        </div>
      );
    } else {
      listItems.push(renderPanel(current));
      index += 1;
    }
  }

  return (
    <div className="gestao-bottlenecks">
      <div className="section-title subsection-title">
        <h2>Mapa de gargalos</h2>
        <p>7 gargalos ranqueados — clique em um indicador na tabela para abrir a análise histórica.</p>
      </div>

      <div className="gestao-bottleneck-list">{listItems}</div>
    </div>
  );
}
