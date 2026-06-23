"use client";

import type { GrowthGuides } from "@/lib/analysis/types";
import { GrowthGuidesSection } from "@/components/guides/GrowthGuidesSection";

type Props = {
  guides: GrowthGuides;
};

export function MetasPage({ guides }: Props) {
  return (
    <>
      <div className="page-header">
        <h1>Metas 2x e 3x</h1>
        <p>Projeções operacionais com gráficos mensais, tráfego, capacidade comercial e operação.</p>
      </div>
      <GrowthGuidesSection guides={guides} />
    </>
  );
}
