"use client";

import type { Analysis } from "@/lib/analysis/types";
import { MixSections } from "@/components/mix/MixSections";

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

export function MixPage({ analysis }: Props) {
  return (
    <>
      <div className="page-header">
        <h1>Serviços</h1>
        <p>
          Leitura financeira e operacional por produto: receita rateada entre etiquetas do negócio,
          quantidade de fechamentos por escopo, participação percentual de faturamento e de esforço.
        </p>
      </div>

      <MixSections analysis={analysis} year="2026" />
    </>
  );
}
