import type { Analysis } from "@/lib/analysis/types";
import type {
  AreaActivity,
  AreaDashboardItem,
  AreaMetrics,
  AreasDashboard,
  AreasExecutionPlans
} from "@/lib/areas/types";
import { AREA_DEFINITIONS } from "@/lib/areas/registry";
import executionPlansJson from "@/data/areas/execution-plans.json";

const executionPlans = executionPlansJson as AreasExecutionPlans;

function sumBusinessTypeRevenue(analysis: Analysis, types: string[]) {
  const rows = analysis.businessTypeMonthly.filter(
    (row) => row.month.startsWith("2026") && types.includes(row.type)
  );
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const wonDeals = rows.reduce((sum, row) => sum + row.wonDeals, 0);
  return { revenue, wonDeals };
}

function sumServiceRevenue(analysis: Analysis, services: string[]) {
  const deals = analysis.wonDeals.filter(
    (deal) => deal.wonMonth?.startsWith("2026") && services.includes(deal.service)
  );
  return {
    revenue: deals.reduce((sum, deal) => sum + deal.value, 0),
    wonDeals: deals.length
  };
}

function activityStats(activities: AreaActivity[]) {
  return {
    total: activities.length,
    done: activities.filter((item) => item.status === "concluida").length,
    inProgress: activities.filter((item) => item.status === "em_andamento").length,
    pending: activities.filter(
      (item) => item.status === "pendente" || item.status === "bloqueada"
    ).length
  };
}

function buildMetricsForArea(analysis: Analysis, areaId: string): AreaMetrics {
  const def = AREA_DEFINITIONS.find((area) => area.id === areaId);
  if (!def) {
    return {
      revenue2026Ytd: null,
      wonDeals2026Ytd: null,
      averageTicket: null,
      revenueSharePct: null,
      pipelineOpenDeals: null,
      pipelineOpenValue: null,
      highlights: []
    };
  }

  const totalRevenue2026 = analysis.monthly
    .filter((row) => row.month.startsWith("2026"))
    .reduce((sum, row) => sum + row.wonRevenue, 0);

  if (areaId === "vendas") {
    const ytd = analysis.planningSummary.annual["2026Ytd"];
    const funnel = analysis.commercialFunnel.filter((row) => row.month.startsWith("2026"));
    const last = funnel.at(-1);
    const commercial = analysis.growthGuides.projection2x.operationalCapacity.commercialTeam;
    return {
      revenue2026Ytd: ytd.revenue,
      wonDeals2026Ytd: ytd.wonDeals,
      averageTicket: ytd.wonDeals ? ytd.revenue / ytd.wonDeals : null,
      revenueSharePct: 100,
      pipelineOpenDeals: last?.openBaseDealsEndOfMonth ?? null,
      pipelineOpenValue: last?.openBaseValueEndOfMonth ?? null,
      highlights: [
        `${commercial.currentHeadcount} comerciais · ${commercial.perPersonH2.monthlyClosings.toFixed(1)} fech./pessoa meta H2`,
        `Pipeline aberto: ${last?.openBaseDealsEndOfMonth ?? 0} negócios`,
        `Recomendado: ${commercial.recommendedHeadcount} comerciais no cenário 2x`
      ]
    };
  }

  if (areaId === "marketing") {
    const traffic = analysis.growthGuides.projection2x.trafficInvestment;
    return {
      revenue2026Ytd: null,
      wonDeals2026Ytd: null,
      averageTicket: null,
      revenueSharePct: null,
      pipelineOpenDeals: null,
      pipelineOpenValue: null,
      highlights: [
        `Tráfego H1: R$ ${traffic.h1Total.toLocaleString("pt-BR")}`,
        `Tráfego anual projetado (2x): R$ ${traffic.annualTotal.toLocaleString("pt-BR")}`,
        traffic.averageCostPerClosing
          ? `CPA médio: R$ ${Math.round(traffic.averageCostPerClosing).toLocaleString("pt-BR")}`
          : "CPA: acompanhar mensalmente"
      ]
    };
  }

  if (areaId === "consultoria") {
    const projetos = buildMetricsForArea(analysis, "consultoria-projetos");
    const laudos = buildMetricsForArea(analysis, "consultoria-laudos");
    const revenue = (projetos.revenue2026Ytd ?? 0) + (laudos.revenue2026Ytd ?? 0);
    const wonDeals = (projetos.wonDeals2026Ytd ?? 0) + (laudos.wonDeals2026Ytd ?? 0);
    return {
      revenue2026Ytd: revenue,
      wonDeals2026Ytd: wonDeals,
      averageTicket: wonDeals ? revenue / wonDeals : null,
      revenueSharePct: totalRevenue2026 ? (revenue / totalRevenue2026) * 100 : null,
      pipelineOpenDeals: null,
      pipelineOpenValue: null,
      highlights: [
        `Projetos: ${projetos.wonDeals2026Ytd ?? 0} contratos · Laudos: ${laudos.wonDeals2026Ytd ?? 0} contratos`,
        `5 projetistas (era 3) + automação`,
        `${((revenue / totalRevenue2026) * 100).toFixed(0)}% da receita 2026 YTD`
      ]
    };
  }

  if (areaId === "escala") {
    const delivery = analysis.growthGuides.projection2x.operationalCapacity.deliveryTeam;
    const commercial = analysis.growthGuides.projection2x.operationalCapacity.commercialTeam;
    return {
      revenue2026Ytd: null,
      wonDeals2026Ytd: null,
      averageTicket: null,
      revenueSharePct: null,
      pipelineOpenDeals: null,
      pipelineOpenValue: null,
      highlights: [
        `Projetistas: ${delivery.projectistasHistorical} → ${delivery.projectistasCurrent}`,
        delivery.capacityNote,
        `Comercial: ${commercial.currentHeadcount} → ${commercial.recommendedHeadcount} recomendado`
      ]
    };
  }

  if (areaId === "automacoes-ferramentas") {
    const alerts = analysis.dataQualityAlerts?.length ?? 0;
    return {
      revenue2026Ytd: null,
      wonDeals2026Ytd: null,
      averageTicket: null,
      revenueSharePct: null,
      pipelineOpenDeals: null,
      pipelineOpenValue: null,
      highlights: [
        `${analysis.totals.clickupTasksAll.toLocaleString("pt-BR")} tarefas ClickUp`,
        `${analysis.totals.pipedriveDealsAll.toLocaleString("pt-BR")} negócios no Pipedrive`,
        alerts ? `${alerts} alerta(s) de qualidade de dados` : "Qualidade de dados em revisão"
      ]
    };
  }

  let revenue = 0;
  let wonDeals = 0;

  if (def.businessTypes?.length) {
    const stats = sumBusinessTypeRevenue(analysis, def.businessTypes);
    revenue += stats.revenue;
    wonDeals += stats.wonDeals;
  }
  if (def.serviceMatch?.length) {
    const stats = sumServiceRevenue(analysis, def.serviceMatch);
    revenue += stats.revenue;
    wonDeals += stats.wonDeals;
  }

  const highlights: string[] = [];
  if (def.businessTypes?.length && revenue > 0) {
    const topType = analysis.businessTypeMonthly
      .filter((row) => row.month.startsWith("2026") && def.businessTypes?.includes(row.type))
      .reduce<Record<string, number>>((acc, row) => {
        acc[row.type] = (acc[row.type] ?? 0) + row.revenue;
        return acc;
      }, {});
    const best = Object.entries(topType).sort((a, b) => b[1] - a[1])[0];
    if (best) highlights.push(`Principal tipo: ${best[0].split(" - ")[0]} (${best[1].toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })})`);
  }
  if (!revenue) {
    highlights.push("Sem receita mapeada ainda — área em planejamento");
  }

  return {
    revenue2026Ytd: revenue || null,
    wonDeals2026Ytd: wonDeals || null,
    averageTicket: wonDeals ? revenue / wonDeals : null,
    revenueSharePct: totalRevenue2026 && revenue ? (revenue / totalRevenue2026) * 100 : null,
    pipelineOpenDeals: null,
    pipelineOpenValue: null,
    highlights
  };
}

function buildAreaItem(analysis: Analysis, areaId: string): AreaDashboardItem {
  const def = AREA_DEFINITIONS.find((area) => area.id === areaId)!;
  const plan = executionPlans.areas[areaId];
  const childrenDefs = AREA_DEFINITIONS.filter((area) => area.parentId === areaId);
  const children = childrenDefs.map((child) => buildAreaItem(analysis, child.id));

  const objectives = plan?.objectives ?? [];
  const activities = plan?.activities ?? [];

  if (areaId === "consultoria" && !plan) {
    return {
      id: def.id,
      name: def.name,
      shortName: def.shortName,
      description: def.description,
      parentId: def.parentId,
      status: def.status,
      lead: def.lead,
      metrics: buildMetricsForArea(analysis, areaId),
      objectives: [
        { id: "c-roll", title: "Consolidar entrega de projetos e laudos no H2", metric: "Receita consultoria", target: "Ver subáreas" }
      ],
      activities: [],
      strategicNotes: [
        "Hub de entrega técnica — detalhar planos em Projetos e Laudos.",
        "Capacidade atual: 5 projetistas com automação."
      ],
      risks: [
        { title: "Desbalanceamento fila projetos vs laudos", mitigation: "Revisão semanal de capacidade por subárea." }
      ],
      children
    };
  }

  return {
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    description: def.description,
    parentId: def.parentId,
    status: def.status,
    lead: def.lead,
    metrics: buildMetricsForArea(analysis, areaId),
    objectives: objectives,
    activities: activities,
    strategicNotes: plan?.strategicNotes ?? ["Plano em construção — detalhar em conversa com a gestão."],
    risks: plan?.risks ?? [],
    children: children.length ? children : undefined
  };
}

export function buildAreasDashboard(analysis: Analysis): AreasDashboard {
  const roots = AREA_DEFINITIONS.filter((area) => !area.parentId).map((area) =>
    buildAreaItem(analysis, area.id)
  );

  const flatten = (items: AreaDashboardItem[]): AreaDashboardItem[] =>
    items.flatMap((item) => [item, ...(item.children ? flatten(item.children) : [])]);

  const allLeaves = flatten(roots).filter((item) => !item.children?.length);
  const allActivities = flatten(roots).flatMap((item) => item.activities);
  const stats = activityStats(allActivities);

  const attributedRevenue = allLeaves.reduce((sum, item) => sum + (item.metrics.revenue2026Ytd ?? 0), 0);
  const totalYtd = analysis.planningSummary.annual["2026Ytd"].revenue;

  return {
    generatedAt: analysis.generatedAt,
    overview: {
      totalAreas: flatten(roots).length,
      areasExecuting: flatten(roots).filter((item) => item.status === "executando").length,
      totalActivities: stats.total,
      activitiesInProgress: stats.inProgress,
      activitiesDone: stats.done,
      activitiesPending: stats.pending,
      attributedRevenueYtd: attributedRevenue,
      unmappedRevenueYtd: Math.max(0, totalYtd - attributedRevenue)
    },
    areas: roots
  };
}

export function findAreaById(dashboard: AreasDashboard, areaId: string): AreaDashboardItem | null {
  const walk = (items: AreaDashboardItem[]): AreaDashboardItem | null => {
    for (const item of items) {
      if (item.id === areaId) return item;
      if (item.children) {
        const found = walk(item.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(dashboard.areas);
}

export function flattenAreasForNav(dashboard: AreasDashboard) {
  const items: Array<{ id: string; name: string; parentId: string | null; isOverview?: boolean }> = [
    { id: "overview", name: "Visão geral", parentId: null, isOverview: true }
  ];

  for (const area of dashboard.areas) {
    items.push({ id: area.id, name: area.name, parentId: null });
    for (const child of area.children ?? []) {
      items.push({ id: child.id, name: child.name, parentId: area.id });
    }
  }
  return items;
}
