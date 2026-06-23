export type AreaStatus = "estruturando" | "planejando" | "executando" | "monitorando";

export type ActivityStatus = "pendente" | "em_andamento" | "concluida" | "bloqueada";

export type AreaActivity = {
  id: string;
  title: string;
  responsible: string;
  dueMonth?: string;
  priority: "critical" | "high" | "medium";
  status: ActivityStatus;
  notes?: string;
};

export type AreaObjective = {
  id: string;
  title: string;
  metric?: string;
  target?: string;
};

export type AreaPlanTemplate = {
  id: string;
  objectives: AreaObjective[];
  activities: AreaActivity[];
  strategicNotes: string[];
  risks: Array<{ title: string; mitigation: string }>;
};

export type AreaMetrics = {
  revenue2026Ytd: number | null;
  wonDeals2026Ytd: number | null;
  averageTicket: number | null;
  revenueSharePct: number | null;
  pipelineOpenDeals: number | null;
  pipelineOpenValue: number | null;
  highlights: string[];
};

export type AreaDashboardItem = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  parentId: string | null;
  status: AreaStatus;
  lead: string;
  metrics: AreaMetrics;
  objectives: AreaObjective[];
  activities: AreaActivity[];
  strategicNotes: string[];
  risks: Array<{ title: string; mitigation: string }>;
  children?: AreaDashboardItem[];
};

export type AreasDashboard = {
  generatedAt: string;
  overview: {
    totalAreas: number;
    areasExecuting: number;
    totalActivities: number;
    activitiesInProgress: number;
    activitiesDone: number;
    activitiesPending: number;
    attributedRevenueYtd: number;
    unmappedRevenueYtd: number;
  };
  areas: AreaDashboardItem[];
};

export type AreasExecutionPlans = {
  version: number;
  areas: Record<string, AreaPlanTemplate>;
};
