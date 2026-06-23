import type { Analysis } from "@/lib/analysis/types";

export type FunnelStageRow = {
  pipeline: string;
  stage: string;
  stageOrder: number;
  deals: number;
  value: number;
  averageValue: number;
};

export type VendasFunnelMonthly = {
  month: string;
  createdDeals: number;
  wonDeals: number;
  wonValue: number;
  lostDeals: number;
  cohortConversionPct: number | null;
  openBaseDealsEndOfMonth: number;
  openBaseValueEndOfMonth: number;
};

export type VendasFunnelDashboard = {
  mainPipeline: string;
  stages: FunnelStageRow[];
  stagesTotalDeals: number;
  stagesTotalValue: number;
  negotiationDeals: number;
  negotiationValue: number;
  monthly: VendasFunnelMonthly[];
  contextDiagnosis: string[];
};

const MAIN_PIPELINE = "[Exec] Laudos - Condo";

export function buildVendasFunnel(analysis: Analysis): VendasFunnelDashboard {
  const open = analysis.deepAnalysis.funnelByStage.open ?? [];
  const stages = open
    .filter((row) => row.pipeline === MAIN_PIPELINE)
    .sort((a, b) => a.stageOrder - b.stageOrder)
    .map((row) => ({
      pipeline: row.pipeline,
      stage: row.stage,
      stageOrder: row.stageOrder,
      deals: row.deals,
      value: row.value,
      averageValue: row.averageValue
    }));

  const negotiation = stages.find((row) => row.stage === "Negociação");

  const monthly = analysis.commercialFunnel
    .filter((row) => row.month.startsWith("2026"))
    .map((row) => ({
      month: row.month,
      createdDeals: row.createdDeals,
      wonDeals: row.wonDeals,
      wonValue: row.wonValue,
      lostDeals: row.lostDeals,
      cohortConversionPct: row.cohortConversionPct,
      openBaseDealsEndOfMonth: row.openBaseDealsEndOfMonth,
      openBaseValueEndOfMonth: row.openBaseValueEndOfMonth
    }));

  return {
    mainPipeline: MAIN_PIPELINE,
    stages,
    stagesTotalDeals: stages.reduce((sum, row) => sum + row.deals, 0),
    stagesTotalValue: stages.reduce((sum, row) => sum + row.value, 0),
    negotiationDeals: negotiation?.deals ?? 0,
    negotiationValue: negotiation?.value ?? 0,
    monthly,
    contextDiagnosis: [
      "GATE: clientes sem orçamento/proposta — nenhum plano extra antes de destravar isso.",
      "125 negócios em Negociação (R$ 1,4M) — maior alavanca: novo vendedor entra focado nessa base.",
      "Mar–mai: visitas + viagem → proposta lenta/desigual → conversão caiu de 27% para 6,5%.",
      "Julho: mapear processo → app (checklist, LIE/LDC/LCC automáticos, PDF/slide) + ritos semanais."
    ]
  };
}
