import type {
  Analysis,
  CommercialMonthlyAnalysis,
  CommercialReviewAudit,
  CommercialSellerMonitoring
} from "@/lib/analysis/types";
import type { VendasScenariosDashboard } from "@/lib/areas/build-vendas-scenarios";
import dashboardConfigJson from "@/data/areas/vendas-director-dashboard.json";

const config = dashboardConfigJson as typeof dashboardConfigJson;

export type DirectorKpi = {
  id: string;
  label: string;
  current: number;
  weeklyTarget: number | null;
  gateTarget: number | null;
  status: "ok" | "warn" | "critical";
  source: string;
  note?: string;
};

export type DirectorRampRow = {
  month: string;
  label: string;
  sellerLabel: string;
  rampPct: number;
  revenueTarget: number;
  isHireMonth: boolean;
};

export type VendasDirectorDashboard = {
  title: string;
  generatedAt: string;
  meeting: typeof config.meeting;
  salesRhythm: typeof config.salesRhythm;
  rampSchedule: typeof config.rampSchedule;
  gateOk: boolean;
  kpis: DirectorKpi[];
  snapshot: {
    reuniaoMarcada: number;
    diagnostico: number;
    negociacao: number;
    fechamento: number;
    relacionamento: number;
    aguardandoProposta: number;
  };
  rolling: {
    won7d: number;
    won30d: number;
    created7d: number;
    created30d: number;
  };
  rampProjection: DirectorRampRow[];
  teamWeeklyTargets: {
    headcountFte: number;
    visitas: number;
    propostasGeradas: number;
    apresentacoes: number;
    followups: number;
    fechamentos: number;
  };
  monthlyAnalysis: CommercialMonthlyAnalysis[];
  sellerMonitoring: CommercialSellerMonitoring[];
  reviewAudits: CommercialReviewAudit[];
};

function stageCount(analysis: Analysis, pipeline: string, stages: string[]) {
  return (analysis.deepAnalysis.funnelByStage.open ?? [])
    .filter((row) => row.pipeline === pipeline && stages.includes(row.stage))
    .reduce((total, row) => total + row.deals, 0);
}

function kpiStatus(current: number, target: number | null, gate: number | null, lowerIsBetter = false) {
  if (gate != null) {
    if (lowerIsBetter ? current > gate : current < gate) return "critical";
    if (lowerIsBetter ? current > 0 : false) return "warn";
    return "ok";
  }
  if (target == null) return "ok";
  if (lowerIsBetter) {
    if (current > target) return "critical";
    return current > target * 0.5 ? "warn" : "ok";
  }
  if (current >= target) return "ok";
  if (current >= target * 0.6) return "warn";
  return "critical";
}

function buildRampProjection(scenarios: VendasScenariosDashboard): DirectorRampRow[] {
  const scenario = scenarios.scenarios[0];
  const rows: DirectorRampRow[] = [];

  for (const month of scenario.months) {
    const newSeller = month.sellers.find((s) => s.id === "hire-1");
    if (!newSeller || newSeller.fixedPay === 0) continue;
    rows.push({
      month: month.month,
      label: month.label,
      sellerLabel: newSeller.label,
      rampPct: Math.round(newSeller.rampFactor * 100),
      revenueTarget: newSeller.attributedRevenue,
      isHireMonth: newSeller.rampFactor === 0
    });
  }
  return rows;
}

export function buildVendasDirectorDashboard(
  analysis: Analysis,
  scenarios: VendasScenariosDashboard
): VendasDirectorDashboard {
  const t = config.weeklyTargetsPerSeller100;
  const activeScenario = scenarios.scenarios[0];
  const latestMonth = activeScenario.months[activeScenario.months.length - 1];
  const headcountFte = latestMonth?.effectiveFte ?? 2;
  const mainPipeline = analysis.commercialDirector?.mainPipeline ?? "Consultoria - Condo";
  const commercialDirector = analysis.commercialDirector;

  const snapshot = {
    reuniaoMarcada: commercialDirector?.snapshot.reuniaoMarcada ?? stageCount(analysis, mainPipeline, ["Reunião Marcada", "Aguardando Agendamento"]),
    diagnostico: commercialDirector?.snapshot.diagnostico ?? stageCount(analysis, mainPipeline, ["Diagnóstico", "Visita de Diagnóstico"]),
    negociacao: commercialDirector?.snapshot.negociacao ?? stageCount(analysis, mainPipeline, ["Negociação"]),
    fechamento: commercialDirector?.snapshot.fechamento ?? stageCount(analysis, mainPipeline, ["Fechamento"]),
    relacionamento: commercialDirector?.snapshot.relacionamento ?? stageCount(analysis, mainPipeline, ["Relacionamento"]),
    aguardandoProposta: commercialDirector?.snapshot.elaboracaoProposta ?? stageCount(analysis, mainPipeline, ["Elaboração de Proposta"])
  };

  const slaBreaches = commercialDirector?.sla48h?.breaches ?? snapshot.aguardandoProposta;

  const rolling = commercialDirector?.rolling ?? {
    won7d: 0,
    won30d: 0,
    created7d: 0,
    created30d: 0
  };

  const teamWeeklyTargets = {
    headcountFte,
    visitas: Math.round(t.visitasDiagnosticos * headcountFte),
    propostasGeradas: Math.round(t.propostasGeradas * headcountFte),
    apresentacoes: Math.round(t.apresentacoesProposta * headcountFte),
    followups: Math.round(t.followupsNegociacao * headcountFte),
    fechamentos: Math.round(t.fechamentos * headcountFte)
  };

  const gateOk = slaBreaches <= t.slaBreachesMax;

  const kpis: DirectorKpi[] = [
    {
      id: "sla48h",
      label: "Propostas atrasadas (>48h)",
      current: slaBreaches,
      weeklyTarget: t.slaBreachesMax,
      gateTarget: 0,
      status: kpiStatus(slaBreaches, t.slaBreachesMax, 0, true),
      source: "Gate — auditado na reunião de segunda",
      note: commercialDirector?.sla48h?.note
    },
    {
      id: "visitas",
      label: "Em diagnóstico (visitas)",
      current: snapshot.diagnostico,
      weeklyTarget: teamWeeklyTargets.visitas,
      gateTarget: null,
      status: kpiStatus(snapshot.diagnostico, teamWeeklyTargets.visitas, null),
      source: "Pipeline Consultoria — Visita de Diagnóstico"
    },
    {
      id: "apresentacoes",
      label: "Apresentações agendadas",
      current: snapshot.reuniaoMarcada,
      weeklyTarget: teamWeeklyTargets.apresentacoes,
      gateTarget: null,
      status: kpiStatus(snapshot.reuniaoMarcada, teamWeeklyTargets.apresentacoes, null),
      source: "Aguardando Agendamento + assembleias (noite)"
    },
    {
      id: "propostas",
      label: "Em negociação",
      current: snapshot.negociacao,
      weeklyTarget: null,
      gateTarget: null,
      status: snapshot.negociacao > 100 ? "warn" : "ok",
      source: "Propostas ativas — avançar na reunião",
      note: `${snapshot.negociacao} neg. · prioridade destravar`
    },
    {
      id: "backlog",
      label: "Aguardando proposta",
      current: snapshot.aguardandoProposta,
      weeklyTarget: teamWeeklyTargets.propostasGeradas,
      gateTarget: null,
      status: snapshot.aguardandoProposta > 20 ? "critical" : snapshot.aguardandoProposta > 10 ? "warn" : "ok",
      source: "Estágio Elaboração de Proposta"
    },
    {
      id: "won7d",
      label: "Fechamentos (7 dias)",
      current: rolling.won7d,
      weeklyTarget: teamWeeklyTargets.fechamentos,
      gateTarget: null,
      status: kpiStatus(rolling.won7d, teamWeeklyTargets.fechamentos, null),
      source: "Pipedrive wonTime"
    },
    {
      id: "created7d",
      label: "Novos negócios (mês recente)",
      current: rolling.created7d,
      weeklyTarget: Math.round(scenarios.conservativeIndividual.createdPerSellerMonth / 4) * headcountFte,
      gateTarget: null,
      status: "ok",
      source: "Último mês fechado no funil"
    }
  ];

  return {
    title: config.title,
    generatedAt: analysis.generatedAt,
    meeting: config.meeting,
    salesRhythm: config.salesRhythm,
    rampSchedule: config.rampSchedule,
    gateOk,
    kpis,
    snapshot,
    rolling,
    rampProjection: buildRampProjection(scenarios),
    teamWeeklyTargets,
    monthlyAnalysis: analysis.commercialMonthly ?? [],
    sellerMonitoring: analysis.commercialSellerMonitoring ?? [],
    reviewAudits: analysis.commercialReviewAudits ?? []
  };
}
