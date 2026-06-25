"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  GitBranch,
  Layers3,
  LockKeyhole,
  SlidersHorizontal,
  Target,
  TimerReset,
  TrendingUp,
  Users,
  Wrench
} from "lucide-react";
import type { Analysis } from "@/lib/analysis/types";
import { brl, formatGrowth, monthLabel, number } from "@/lib/analysis/format";

type Props = {
  analysis: Analysis;
  generatedAt: string;
};

type ScenarioRow = {
  name: string;
  revenue: number;
  h2: number;
  wonDeals: number;
  gap: number;
  probability: string;
  bottleneck: string;
  action: string;
};

const TARGET_2026 = 3_000_000;
const TARGET_H2 = 2_000_000;

function avg(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function getLatest<T extends { month: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.month.localeCompare(b.month)).at(-1) ?? null;
}

function statusClass(gap: number) {
  if (gap <= 0) return "green";
  if (gap <= 500_000) return "amber";
  return "red";
}

function fixed(value: number, digits = 1) {
  return number.format(Number(value.toFixed(digits)));
}

export function PlanoProPage({ analysis, generatedAt }: Props) {
  const model = useMemo(() => {
    const summary = analysis.planningSummary;
    const recommended =
      summary.yearProjectionByScenario.find((item) => item.scenario === "Realista recomendado") ??
      summary.yearProjectionByScenario.at(-1)!;
    const rhythm =
      summary.yearProjectionByScenario.find((item) => item.scenario === "Ritmo atual") ?? recommended;
    const conservative =
      summary.yearProjectionByScenario.find((item) => item.scenario === "Conservador") ?? rhythm;
    const guide3x = analysis.growthGuides.projection3x;
    const realized2026 = summary.annual["2026Ytd"];
    const realized2025 = summary.annual["2025"];
    const h2Target = Math.max(0, TARGET_2026 - realized2026.revenue);
    const h2GapVsRecommended = Math.max(0, h2Target - recommended.h2Projected);
    const avgTicketYtd = realized2026.wonDeals ? realized2026.revenue / realized2026.wonDeals : 0;
    const contractsNeededH2 = avgTicketYtd ? Math.ceil(h2Target / avgTicketYtd) : 0;
    const recommendedH2Contracts = Math.max(0, recommended.wonDealsEstimated - realized2026.wonDeals);
    const extraContracts = Math.max(0, contractsNeededH2 - recommendedH2Contracts);
    const conversionRows = analysis.commercialFunnel.filter(
      (row) => row.isMatureCohort && row.matureConversionPct != null
    );
    const matureConversion = avg(conversionRows.map((row) => row.matureConversionPct ?? 0));
    const recentConversion = avg(conversionRows.slice(-3).map((row) => row.matureConversionPct ?? 0));
    const latestFunnel = getLatest(analysis.commercialFunnel);
    const topOpenStage = analysis.deepAnalysis.funnelByStage.summary.topOpenStage;
    const topLostStage = analysis.deepAnalysis.funnelByStage.summary.topLostStage;
    const topRevenueMonth = analysis.indicatorHighlights.summary.bestRevenueMonth;
    const postSalesLatest = getLatest(analysis.postSalesMonthly);
    const openSummary = analysis.deepAnalysis.funnelByStage.summary;
    const repeatShare = postSalesLatest?.repeatShareByAccountPct ?? null;
    const obraTop = [...(analysis.obraSubgroups?.summary ?? [])].sort((a, b) => b.revenue - a.revenue).at(0);
    const dataAlerts = analysis.dataQualityAlerts ?? [];
    const openOldAlert = dataAlerts.find((alert) => alert.id === "old_open_deals");
    const cnpjAlert = dataAlerts.find((alert) => alert.id === "cnpj_coverage");
    const h2BaseRevenue = analysis.projection2026H2.scenarios.find((item) => item.name === "Realista recomendado")?.revenue ?? recommended.h2Projected;
    const h2UpliftVsBase = h2BaseRevenue ? ((TARGET_H2 - h2BaseRevenue) / h2BaseRevenue) * 100 : 0;
    const monthlyTargets = guide3x.monthlyTargets;
    const typeMix = guide3x.typeMix.slice(0, 8);
    const capacity = guide3x.operationalCapacity;
    const monthlyAverageTarget = TARGET_H2 / 6;
    const baseH2Monthly = recommended.h2Projected / 6;
    const requiredOpenCapturePct = openSummary.openValue ? (TARGET_H2 / openSummary.openValue) * 100 : 0;
    const currentH1 = guide3x.kpis.currentH1;
    const targetKpis = guide3x.kpis;
    const conversionTrend = analysis.commercialFunnel.slice(-8).map((row) => ({
      month: row.month,
      createdDeals: row.createdDeals,
      wonDeals: row.wonDeals,
      wonValue: row.wonValue,
      matureConversionPct: row.matureConversionPct,
      closedConversionPct: row.closedConversionPct,
      openValue: row.openBaseValueEndOfMonth
    }));
    const topOpenStages = analysis.deepAnalysis.funnelByStage.open.slice(0, 6);
    const topLostStages = analysis.deepAnalysis.funnelByStage.lost.slice(0, 6);
    const sensitivity = [
      {
        variable: "Conversão",
        current: formatGrowth(targetKpis.currentH1.averageConversionPct),
        target: formatGrowth(targetKpis.h2AverageConversionPct),
        impact: "Se cair abaixo do alvo, a necessidade de leads explode e satura follow-up.",
        decision: "Atacar preparação, cadência e meio/fim do funil antes de comprar mais leads."
      },
      {
        variable: "Volume de novos negócios",
        current: `${fixed(currentH1.averageCreatedDeals)} / mês`,
        target: `${fixed(targetKpis.h2AverageCreatedDeals)} / mês`,
        impact: `${formatGrowth(targetKpis.uplift.createdDealsPct)} de aumento sobre H1.`,
        decision: "Aumentar só com agenda de apresentação e proposta protegida."
      },
      {
        variable: "Fechamentos",
        current: `${fixed(currentH1.averageWonDeals)} / mês`,
        target: `${fixed(targetKpis.h2AverageWonDeals)} / mês`,
        impact: `${formatGrowth(targetKpis.uplift.wonDealsPct)} de aumento sobre H1.`,
        decision: "Usar fechamento por pessoa como gatilho real de contratação."
      },
      {
        variable: "Ticket médio",
        current: brl.format(currentH1.averageTicket),
        target: brl.format(targetKpis.h2AverageTicket),
        impact: "O cenário 3M não pressupõe aumento de ticket; depende de volume e mix.",
        decision: "Usar obras e pacotes complementares para reduzir pressão de volume."
      },
      {
        variable: "Capacidade técnica",
        current: `${capacity.deliveryTeam.projectistasCurrent} projetistas`,
        target: `${fixed(capacity.deliveryTeam.h2ProjectsPerPerson)} projetos/pessoa/mês`,
        impact: capacity.deliveryTeam.capacityNote,
        decision: "Medir fila e retrabalho semanalmente para confirmar se segue absorvível."
      }
    ];
    const scenarios: ScenarioRow[] = [
      {
        name: "Conservador",
        revenue: conservative.totalProjected,
        h2: conservative.h2Projected,
        wonDeals: conservative.wonDealsEstimated,
        gap: TARGET_2026 - conservative.totalProjected,
        probability: "Alta se nada estrutural mudar",
        bottleneck: "Conversão e base aberta antiga",
        action: "Limpar pipeline e proteger agenda comercial nobre."
      },
      {
        name: "Base / Ritmo atual",
        revenue: rhythm.totalProjected,
        h2: rhythm.h2Projected,
        wonDeals: rhythm.wonDealsEstimated,
        gap: TARGET_2026 - rhythm.totalProjected,
        probability: "Média",
        bottleneck: "Throughput comercial insuficiente para a meta cheia",
        action: "Recuperar fim de funil, assembleias e follow-up antes de escalar leads."
      },
      {
        name: "Agressivo",
        revenue: guide3x.annualTarget,
        h2: TARGET_H2,
        wonDeals: Math.round(guide3x.kpis.h2AverageWonDeals * 6 + realized2026.wonDeals),
        gap: TARGET_2026 - guide3x.annualTarget,
        probability: "Baixa sem elevação de restrição",
        bottleneck: "Capacidade comercial, revisão técnica e execução de obras",
        action: "Só perseguir com dados semanais de capacidade e buffers definidos."
      },
      {
        name: "Melhor cenário factível",
        revenue: recommended.totalProjected,
        h2: recommended.h2Projected,
        wonDeals: recommended.wonDealsEstimated,
        gap: TARGET_2026 - recommended.totalProjected,
        probability: "Média-alta com foco operacional",
        bottleneck: "Tempo comercial nobre e estoque invisível em negociação",
        action: "Explorar a restrição atual antes de contratar ou aumentar volume."
      }
    ];

    return {
      realized2025,
      realized2026,
      recommended,
      guide3x,
      h2Target,
      h2GapVsRecommended,
      h2UpliftVsBase,
      monthlyAverageTarget,
      baseH2Monthly,
      requiredOpenCapturePct,
      avgTicketYtd,
      contractsNeededH2,
      recommendedH2Contracts,
      extraContracts,
      matureConversion,
      recentConversion,
      latestFunnel,
      topOpenStage,
      topLostStage,
      topRevenueMonth,
      repeatShare,
      obraTop,
      dataAlerts,
      openOldAlert,
      cnpjAlert,
      openSummary,
      monthlyTargets,
      typeMix,
      capacity,
      targetKpis,
      currentH1,
      conversionTrend,
      topOpenStages,
      topLostStages,
      sensitivity,
      scenarios
    };
  }, [analysis]);

  const restrictions = [
    {
      title: "Restrição atual",
      badge: "Comercial",
      symptom: `${model.openSummary.openDeals} negócios abertos somam ${brl.format(model.openSummary.openValue)}.`,
      cause: model.topOpenStage
        ? `Maior estoque visível em ${model.topOpenStage.stage}, com ${model.topOpenStage.deals} negócios.`
        : "A base aberta existe, mas precisa de leitura por etapa.",
      action: "Tratar o fim do funil como drum semanal: priorizar negociação, apresentação e assembleia antes de aumentar leads."
    },
    {
      title: "Próxima restrição provável",
      badge: "Consultoria / Obras",
      symptom: "A página já mede receita e mix, mas não mede capacidade efetiva de entrega.",
      cause: "Lead time técnico, retrabalho, equipe, chuva, feriados e material ainda não estão estruturados no dataset.",
      action: "Criar buffer de entrega e coletar capacidade real antes de vender mais obras de forma agressiva."
    },
    {
      title: "Restrição de conhecimento",
      badge: "Dados",
      symptom: model.cnpjAlert?.message ?? "Pós-venda e recorrência dependem de dados cadastrais completos.",
      cause: "Parte relevante da base não tem CNPJ ou chave confiável de recorrência.",
      action: "Corrigir cadastros, motivo de perda e origem para separar sintoma comercial de qualidade do lead."
    }
  ];

  const actionPlans = [
    {
      area: "Comercial",
      priority: "Agora",
      impact: "Alto",
      action: "Blitz de pipeline em Negociação, cadência 48h e preparação de assembleias com orçamento complementar antes da reunião."
    },
    {
      area: "Consultoria",
      priority: "Medir",
      impact: "Alto",
      action: "Registrar fila, lead time, revisões, retrabalho e dados de campo faltantes para saber se é motor ou gargalo."
    },
    {
      area: "Obras",
      priority: "Controlar",
      impact: "Alto",
      action: "Separar capacidade teórica de efetiva, medir material faltante/excedente e criar checklist de mobilização."
    },
    {
      area: "Tecnologia",
      priority: "Automatizar",
      impact: "Alto",
      action: "Automação de propostas, apresentações e dashboards semanais deve liberar tempo comercial nobre antes de novas contratações."
    },
    {
      area: "Gestão",
      priority: "Semanal",
      impact: "Médio",
      action: "Reunião TOC com restrição da semana, estoque invisível, throughput, buffers e próxima ação de elevação."
    },
    {
      area: "Contratação",
      priority: "Depois",
      impact: "Condicional",
      action: "Contratar só após remover atividades de baixo valor e provar que a demanda qualificada supera a capacidade explorada."
    }
  ];

  const tocMatrix = [
    {
      stage: "Aquisição",
      throughput: `${fixed(model.targetKpis.h2AverageCreatedDeals)} novos negócios/mês`,
      inventory: "Leads e oportunidades sem qualificação real.",
      restriction: "Qualidade do lead e capacidade de follow-up.",
      rule: "Aumentar volume só se apresentação e negociação estiverem fluindo."
    },
    {
      stage: "Comercial",
      throughput: `${fixed(model.targetKpis.h2AverageWonDeals)} fechamentos/mês`,
      inventory: `${model.openSummary.openDeals} negócios abertos · ${brl.format(model.openSummary.openValue)}`,
      restriction: "Tempo comercial nobre e negócios em Negociação.",
      rule: "Drum semanal no fim do funil; SLA de 48h para proposta/follow-up."
    },
    {
      stage: "Consultoria",
      throughput: "Laudos/projetos entregues que geram obra e pós-venda.",
      inventory: "Fila técnica, revisão, dados de campo faltantes e retrabalho.",
      restriction: "Revisão técnica e padronização ainda sem medição completa.",
      rule: "Criar buffer de revisão antes de prometer prazo agressivo."
    },
    {
      stage: "Obras",
      throughput: `${brl.format(model.typeMix.find((item) => item.type === "OBRA")?.revenueTarget ?? 0)} H2 no mix-alvo`,
      inventory: "Obras aguardando material, acesso, equipe, clima e mobilização.",
      restriction: "Capacidade efetiva não está comprovada na base atual.",
      rule: "Vender mais obras apenas com capacidade semanal, material e buffer definidos."
    }
  ];

  const operatingSystemCards = [
    {
      title: "Tese central",
      badge: "Sistema",
      text: "A XPE precisa crescer por capacidade organizacional, não apenas por aumento de pessoas. Dobrar faturamento sem dobrar desorganização exige fluxo, padrões e proteção dos recursos críticos."
    },
    {
      title: "Ciclo 1 — Aquisição",
      badge: "Entrada",
      text: "Marketing, indicação, SDR/comercial, diagnóstico, proposta, apresentação, fechamento e entrada em consultoria. A restrição tende a aparecer em agenda comercial, preparação e follow-up."
    },
    {
      title: "Ciclo 2 — Expansão",
      badge: "Base",
      text: "Consultoria entregue vira diagnóstico técnico, oportunidades de obras, assembleias, execução, pós-venda e novas receitas. A base existente deve virar uma máquina de expansão."
    },
    {
      title: "Pergunta semanal",
      badge: "TOC",
      text: "Qual é a principal restrição da empresa nesta semana e o que faremos para aumentar throughput sem aumentar o caos?"
    }
  ];

  const nobleTimeRows = [
    {
      resource: "Vendedor",
      noble: "Relacionamento, conselho, assembleia, negociação, fechamento e pós-venda consultivo.",
      waste: "Fotos, documentos, proposta manual, apresentação manual, preenchimento repetitivo e cobrança operacional.",
      rule: "Liberar vendedor para vender; automatizar ou delegar tudo que não aumenta throughput direto."
    },
    {
      resource: "Assembleia",
      noble: "Momento raro de decisão coletiva, aprovação de escopo e geração de obra futura.",
      waste: "Ir sem proposta revisada, sem cenários, sem orçamento complementar e sem objeções preparadas.",
      rule: "Toda assembleia deve sair com próximo passo, proposta principal e oportunidades adjacentes mapeadas."
    },
    {
      resource: "Engenharia",
      noble: "Revisão crítica, padronização técnica, decisões de escopo e validação de risco.",
      waste: "Retrabalho por campo incompleto, personalização não cobrada e especialista fazendo trabalho de base.",
      rule: "Proteger revisão com checklist antes da entrada e buffer antes da promessa ao cliente."
    },
    {
      resource: "Obras",
      noble: "Execução planejada, mobilização correta, produtividade em campo e fechamento sem retrabalho.",
      waste: "Material faltante, acesso bloqueado, compras emergenciais, chuva sem buffer e equipe ociosa por falha de agenda.",
      rule: "Capacidade de obra deve ser efetiva, não teórica: dias úteis, clima, material, acesso e equipe simultânea."
    }
  ];

  const elevationSteps = [
    "Identificar a restrição atual com dados da semana.",
    "Medir sua capacidade real antes de contratar ou investir.",
    "Eliminar desperdícios ao redor da restrição.",
    "Proteger a restrição com buffer, checklist e prioridade de agenda.",
    "Automatizar ou delegar atividades de baixo valor.",
    "Elevar com contratação, tecnologia ou processo só depois de explorar a capacidade atual."
  ];

  const assemblyReadiness = [
    "Proposta principal pronta e validada.",
    "Apresentação revisada para síndico, conselho e assembleia.",
    "Cenários alternativos e próximos passos claros.",
    "Orçamentos complementares preparados antes da reunião.",
    "Oportunidades de pós-venda mapeadas por cliente.",
    "Objeções previstas e respostas padronizadas."
  ];

  const missingData = [
    "Capacidade real por vendedor, SDR, revisor, equipe de obras e veículos.",
    "Tempo comercial nobre versus tempo administrativo, deslocamento, diagnóstico e proposta.",
    "Lead time e fila de consultoria/laudos/projetos por responsável técnico.",
    "Dias úteis, chuva, feriados, acesso ao condomínio, material faltante e compras emergenciais.",
    "Margem, despesas, inadimplência, fluxo de caixa e recebimentos futuros.",
    "Origem dos leads, motivo de perda padronizado e qualidade por campanha."
  ];

  const decisionBlocks = [
    {
      title: "Fazer agora",
      items: [
        "Usar o fim do funil como prioridade semanal.",
        "Recuperar propostas/apresentações/assembleias antes de aumentar volume bruto.",
        "Transformar consultoria entregue em lista ativa de obras e pós-venda."
      ]
    },
    {
      title: "Não fazer ainda",
      items: [
        "Não contratar por sensação de sobrecarga.",
        "Não aumentar leads se apresentação, assembleia ou follow-up estiverem saturados.",
        "Não vender obras sem capacidade efetiva e buffer operacional."
      ]
    },
    {
      title: "Medir antes",
      items: [
        "Tempo comercial nobre por pessoa.",
        "Fila e retrabalho técnico.",
        "Capacidade real de execução de obras por mês."
      ]
    }
  ];

  const weeklyCockpit = [
    "Receita fechada na semana e acumulado do mês.",
    "Gap contra meta mensal do Plano PRO.",
    "Novos negócios criados, qualificados e origem.",
    "Propostas emitidas, apresentadas e paradas.",
    "Assembleias marcadas, realizadas e conversão.",
    "Fechamentos por vendedor e throughput por hora nobre.",
    "Negócios parados há mais de 15 dias.",
    "Fila de consultoria, revisão e retrabalho.",
    "Obras em andamento, atrasadas e bloqueadas por material/acesso.",
    "Restrição da semana e ação única de elevação."
  ];

  return (
    <div className="plano-pro-page">
      <div className="page-header">
        <h1>Plano PRO</h1>
        <p>
          Planejamento estratégico TOC para 2026.2: transformar meta em capacidade, restrição,
          throughput e decisão semanal.
        </p>
        <span className="pill green scenario-pill">Atualizado em {generatedAt}</span>
      </div>

      <section className="pro-hero">
        <article className="pro-hero-primary">
          <span className="brief-kicker">Plano PRO 2026.2</span>
          <h2>R$ 2 milhões no segundo semestre só é plano se virar rotina operacional semanal.</h2>
          <p>
            O alvo de R$ 3 milhões no ano exige R$ 2 milhões em 2026.2. Isso significa sair de uma média H1 de{" "}
            {brl.format(model.currentH1.averageRevenue)} para {brl.format(model.targetKpis.h2AverageMonthlyRevenue)}
            {" "}por mês, sustentando {fixed(model.targetKpis.h2AverageWonDeals)} fechamentos mensais e removendo
            a restrição comercial antes que consultoria e obras virem o próximo gargalo.
          </p>
        </article>
        <article className="pro-hero-side">
          <span className="brief-kicker">Meta H2</span>
          <strong>{brl.format(TARGET_H2)}</strong>
          <p>
            Média mensal necessária: {brl.format(model.monthlyAverageTarget)} · uplift vs cenário recomendado H2:{" "}
            {formatGrowth(model.h2UpliftVsBase)}
          </p>
        </article>
      </section>

      <section className="kpi-grid pro-kpi-grid">
        <KpiCard
          label="2026 realizado / YTD"
          value={brl.format(model.realized2026.revenue)}
          note={`${model.realized2026.wonDeals} fechamentos · ticket ${brl.format(model.avgTicketYtd)}`}
        />
        <KpiCard
          label="Necessidade H2 para 3M"
          value={brl.format(model.h2Target)}
          note={`${model.contractsNeededH2} contratos no ticket médio atual`}
        />
        <KpiCard
          label="Gap H2 vs recomendado"
          value={brl.format(model.h2GapVsRecommended)}
          note={`${model.extraContracts} contratos extras além do cenário recomendado`}
          tone={statusClass(model.h2GapVsRecommended)}
        />
        <KpiCard
          label="Conversão madura média"
          value={formatGrowth(model.matureConversion)}
          note={`Últimos 3 meses maduros: ${formatGrowth(model.recentConversion)}`}
        />
      </section>

      <section className="section-title subsection-title">
        <div>
          <h2>Equação operacional dos R$ 2M</h2>
          <p>O alvo financeiro convertido em volume comercial, capacidade e mix de execução.</p>
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Meta mensal H2</h2>
              <span>Receita, fechamentos, novos negócios e gap contra a base recomendada</span>
            </div>
            <CalendarDays size={18} />
          </div>
          <div className="table-wrap compact pro-scenario-table">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="right">Meta receita</th>
                  <th className="right">Fech.</th>
                  <th className="right">Novos</th>
                  <th className="right">Conversão</th>
                  <th className="right">Gap vs base</th>
                  <th>Checkpoint</th>
                </tr>
              </thead>
              <tbody>
                {model.monthlyTargets.map((row) => {
                  const milestone = model.guide3x.milestones.find((item) => item.month === row.month);
                  return (
                    <tr key={row.month}>
                      <td><strong>{row.label}</strong></td>
                      <td className="right">{brl.format(row.revenueTarget)}</td>
                      <td className="right">{fixed(row.wonDealsTarget)}</td>
                      <td className="right">{fixed(row.createdDealsTarget)}</td>
                      <td className="right">{formatGrowth(row.conversionTargetPct)}</td>
                      <td className="right">{brl.format(row.gapVsBase)}</td>
                      <td>{milestone?.checkpoint ?? "Monitorar ritmo semanal"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Salto necessário</h2>
              <span>H1 atual versus alvo H2</span>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="pro-dbr-list">
            <DbrItem
              title="Receita mensal"
              text={`${brl.format(model.currentH1.averageRevenue)} → ${brl.format(model.targetKpis.h2AverageMonthlyRevenue)} (${formatGrowth(model.targetKpis.uplift.revenuePct)}).`}
            />
            <DbrItem
              title="Fechamentos mensais"
              text={`${fixed(model.currentH1.averageWonDeals)} → ${fixed(model.targetKpis.h2AverageWonDeals)} fechamentos/mês (${formatGrowth(model.targetKpis.uplift.wonDealsPct)}).`}
            />
            <DbrItem
              title="Novos negócios"
              text={`${fixed(model.currentH1.averageCreatedDeals)} → ${fixed(model.targetKpis.h2AverageCreatedDeals)} novos/mês (${formatGrowth(model.targetKpis.uplift.createdDealsPct)}).`}
            />
            <DbrItem
              title="Captura do pipeline aberto"
              text={`O H2 de R$ 2M equivale a ${formatGrowth(model.requiredOpenCapturePct)} do valor aberto bruto atual; pipeline aberto não é forecast sem limpeza.`}
            />
          </div>
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Diagnóstico do sistema atual</h2>
              <span>O que os dados sustentam hoje</span>
            </div>
            <Gauge size={18} />
          </div>
          <div className="pro-diagnosis-grid">
            <DiagnosticItem
              title="Faturamento"
              value={`${brl.format(model.realized2025.revenue)} em 2025`}
              detail={`2026 projetado no melhor cenário factível atual: ${brl.format(model.recommended.totalProjected)}.`}
            />
            <DiagnosticItem
              title="Picos e tendência"
              value={model.topRevenueMonth ? monthLabel(model.topRevenueMonth) : "n/a"}
              detail="Picos ajudam a explicar o potencial, mas a meta precisa ser confrontada com capacidade recorrente."
            />
            <DiagnosticItem
              title="Mix e obras"
              value={model.obraTop?.subgroup ?? "Sem subgroup dominante"}
              detail={
                model.obraTop
                  ? `Principal grupo de obras mapeado: ${brl.format(model.obraTop.revenue)}.`
                  : "Obras existem no mix, mas a capacidade de execução ainda precisa ser medida."
              }
            />
            <DiagnosticItem
              title="Pós-venda"
              value={model.repeatShare == null ? "n/a" : formatGrowth(model.repeatShare)}
              detail="Recorrência e base são alavancas, mas dependem de cadastro/CNPJ mais completo."
            />
          </div>
        </div>

        <div className="card pro-toc-card">
          <div className="card-title">
            <div>
              <h2>TOC em uma frase</h2>
              <span>Throughput, Inventory, Operating Expense</span>
            </div>
            <LockKeyhole size={18} />
          </div>
          <ul className="pro-check-list">
            <li>
              <strong>Throughput:</strong> receita que atravessa venda, entrega e faturamento real.
            </li>
            <li>
              <strong>Inventory:</strong> {model.openSummary.openDeals} negócios abertos, dados incompletos e trabalho em fila.
            </li>
            <li>
              <strong>OE:</strong> estrutura deve ser elevada apenas quando aumentar throughput, não para mascarar processo.
            </li>
          </ul>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h2>Sistema operacional XPE</h2>
          <p>A empresa precisa operar como sistema de fluxo: aquisição, consultoria, expansão da base, obras e novas oportunidades.</p>
        </div>
      </section>

      <div className="pro-operating-grid">
        {operatingSystemCards.map((card) => (
          <article className="card pro-operating-card" key={card.title}>
            <span className="pill blue">{card.badge}</span>
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </div>

      <section className="section-title subsection-title">
        <div>
          <h2>Mapa TOC completo</h2>
          <p>Throughput, Inventory e regra de controle em cada ciclo do sistema.</p>
        </div>
      </section>

      <div className="table-wrap compact pro-scenario-table">
        <table>
          <thead>
            <tr>
              <th>Etapa</th>
              <th>Throughput esperado</th>
              <th>Inventory invisível</th>
              <th>Restrição provável</th>
              <th>Regra de gestão</th>
            </tr>
          </thead>
          <tbody>
            {tocMatrix.map((row) => (
              <tr key={row.stage}>
                <td><strong>{row.stage}</strong></td>
                <td>{row.throughput}</td>
                <td>{row.inventory}</td>
                <td>{row.restriction}</td>
                <td>{row.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h2>Recursos críticos e desperdício oculto</h2>
          <p>O crescimento não pode consumir o recurso nobre com tarefas de baixo valor.</p>
        </div>
      </section>

      <div className="table-wrap compact pro-scenario-table">
        <table>
          <thead>
            <tr>
              <th>Recurso</th>
              <th>Tempo nobre / throughput</th>
              <th>Desperdício que vira Inventory</th>
              <th>Regra operacional</th>
            </tr>
          </thead>
          <tbody>
            {nobleTimeRows.map((row) => (
              <tr key={row.resource}>
                <td><strong>{row.resource}</strong></td>
                <td>{row.noble}</td>
                <td>{row.waste}</td>
                <td>{row.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Assembleia como recurso escasso</h2>
              <span>Cada assembleia mal preparada custa venda atual, obra futura e meses de ciclo</span>
            </div>
            <Users size={18} />
          </div>
          <ul className="pro-check-list">
            {assemblyReadiness.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Ordem para elevar restrição</h2>
              <span>Evita aumentar custo sem aumentar throughput</span>
            </div>
            <TimerReset size={18} />
          </div>
          <ol className="pro-number-list">
            {elevationSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h2>Restrições identificadas</h2>
          <p>Sintoma, causa provável e ação recomendada pela lógica da Teoria das Restrições.</p>
        </div>
      </section>

      <div className="pro-restriction-grid">
        {restrictions.map((item) => (
          <article className="card pro-restriction-card" key={item.title}>
            <div className="pro-card-head">
              <span className="pill amber">{item.badge}</span>
              <GitBranch size={18} />
            </div>
            <h3>{item.title}</h3>
            <p><strong>Sintoma:</strong> {item.symptom}</p>
            <p><strong>Causa provável:</strong> {item.cause}</p>
            <p><strong>Ação:</strong> {item.action}</p>
          </article>
        ))}
      </div>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Conversão e funil</h2>
              <span>Queda de conversão só é problema se reduzir throughput ou saturar agenda</span>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="pro-flow">
            <FlowStep label="Criados no último mês" value={model.latestFunnel?.createdDeals ?? 0} />
            <ArrowRight size={18} />
            <FlowStep label="Ganhos no mês" value={model.latestFunnel?.wonDeals ?? 0} />
            <ArrowRight size={18} />
            <FlowStep label="Ticket médio" value={brl.format(model.latestFunnel?.averageWonTicket ?? 0)} />
          </div>
          <p className="metric-note">
            A leitura correta não é “a conversão caiu, logo vendas piorou”. A queda pode vir de aumento de volume,
            menor tempo por cliente, qualidade de lead, follow-up fraco ou saturação de apresentação. A decisão é
            recuperar conversão no meio/fim do funil sem reduzir volume qualificado.
          </p>
          <div className="table-wrap compact pro-mini-table">
            <table>
              <thead>
                <tr>
                  <th>Estoque / perda</th>
                  <th className="right">Negócios</th>
                  <th className="right">Valor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{model.topOpenStage?.stage ?? "Topo aberto"}</td>
                  <td className="right">{model.topOpenStage?.deals ?? model.openSummary.openDeals}</td>
                  <td className="right">{brl.format(model.topOpenStage?.value ?? model.openSummary.openValue)}</td>
                </tr>
                <tr>
                  <td>{model.topLostStage?.stage ?? "Perdas"}</td>
                  <td className="right">{model.topLostStage?.deals ?? model.openSummary.lostDeals}</td>
                  <td className="right">{brl.format(model.topLostStage?.value ?? model.openSummary.lostValue)}</td>
                </tr>
                <tr>
                  <td>{model.openOldAlert?.title ?? "Base antiga"}</td>
                  <td className="right">{model.openOldAlert?.count ?? 0}</td>
                  <td className="right">pipeline bruto</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Drum-Buffer-Rope</h2>
              <span>Aplicação prática para a XPE</span>
            </div>
            <TimerReset size={18} />
          </div>
          <div className="pro-dbr-list">
            <DbrItem title="Drum" text="Ritmo semanal do fim do funil: negociação, apresentação, assembleia e fechamento." />
            <DbrItem title="Buffer" text="Reserva de agenda para assembleias, revisão técnica e mobilização de obras." />
            <DbrItem title="Rope" text="Limitar entrada de leads/obras quando apresentação, consultoria ou execução estiverem saturadas." />
          </div>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h2>Capacidade e contratação</h2>
          <p>Não contratar por sensação: contratar quando a restrição explorada continuar acima da capacidade.</p>
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Capacidade comercial</h2>
              <span>Fechamentos por pessoa e gatilho de expansão</span>
            </div>
            <Users size={18} />
          </div>
          <div className="pro-capacity-grid">
            <DiagnosticItem
              title="Equipe atual"
              value={`${model.capacity.commercialTeam.currentHeadcount} comerciais`}
              detail={`H1: ${fixed(model.capacity.commercialTeam.perPersonH1.monthlyClosings)} fechamentos/pessoa/mês.`}
            />
            <DiagnosticItem
              title="Carga H2"
              value={`${fixed(model.capacity.commercialTeam.perPersonH2.monthlyClosings)} fech./pessoa`}
              detail={`${brl.format(model.capacity.commercialTeam.perPersonH2.monthlyRevenue)} por pessoa/mês.`}
            />
            <DiagnosticItem
              title="Recomendado"
              value={`${model.capacity.commercialTeam.recommendedHeadcount} comerciais`}
              detail={model.capacity.commercialTeam.hireTrigger}
            />
            <DiagnosticItem
              title="Novos/pessoa"
              value={`${fixed(model.capacity.commercialTeam.perPersonH2.monthlyNewDeals)} / mês`}
              detail="Só viável se SDR, automação e follow-up preservarem tempo comercial nobre."
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Capacidade técnica</h2>
              <span>Projetistas, automação e próxima restrição</span>
            </div>
            <Wrench size={18} />
          </div>
          <div className="pro-dbr-list">
            <DbrItem
              title={`${model.capacity.deliveryTeam.projectistasCurrent} projetistas atuais`}
              text={model.capacity.deliveryTeam.automationNote}
            />
            <DbrItem
              title={`${fixed(model.capacity.deliveryTeam.h2ProjectsPerPerson)} projetos/pessoa/mês`}
              text={model.capacity.deliveryTeam.capacityNote}
            />
            <DbrItem
              title="Condição de segurança"
              text="A capacidade parece absorvível para projetos, mas obras ainda exigem medição própria de equipe, chuva, material, acesso e simultaneidade."
            />
          </div>
        </div>
      </section>

      <section className="section-title subsection-title">
        <div>
          <h2>Mix de receita para chegar nos R$ 2M</h2>
          <p>Distribuição proporcional do cenário 3M com base no histórico real.</p>
        </div>
      </section>

      <div className="table-wrap compact pro-scenario-table">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th className="right">Share</th>
              <th className="right">Receita H2</th>
              <th className="right">Contratos H2</th>
              <th className="right">Ticket</th>
              <th>Leitura estratégica</th>
            </tr>
          </thead>
          <tbody>
            {model.typeMix.map((row) => (
              <tr key={row.type}>
                <td><strong>{row.type}</strong></td>
                <td className="right">{formatGrowth(row.revenueSharePct)}</td>
                <td className="right">{brl.format(row.revenueTarget)}</td>
                <td className="right">{fixed(row.wonDealsTarget)}</td>
                <td className="right">{brl.format(row.averageTicket)}</td>
                <td>
                  {row.type === "OBRA"
                    ? "Alavanca de ticket, mas depende de capacidade efetiva e buffer de execução."
                    : "Mantém volume de entrada e geração futura de oportunidades para obras/pós-venda."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h2>Sensibilidade</h2>
          <p>Onde pequenas variações afetam mais o resultado ou a capacidade.</p>
        </div>
      </section>

      <div className="table-wrap compact pro-scenario-table">
        <table>
          <thead>
            <tr>
              <th>Variável</th>
              <th>Atual / base</th>
              <th>Alvo PRO</th>
              <th>Impacto</th>
              <th>Decisão</th>
            </tr>
          </thead>
          <tbody>
            {model.sensitivity.map((row) => (
              <tr key={row.variable}>
                <td><strong>{row.variable}</strong></td>
                <td>{row.current}</td>
                <td>{row.target}</td>
                <td>{row.impact}</td>
                <td>{row.decision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section-title subsection-title">
        <div>
          <h2>Cenários</h2>
          <p>Meta financeira traduzida em viabilidade operacional e restrição dominante.</p>
        </div>
      </section>

      <div className="table-wrap compact pro-scenario-table">
        <table>
          <thead>
            <tr>
              <th>Cenário</th>
              <th className="right">Total 2026</th>
              <th className="right">H2</th>
              <th className="right">Fechamentos</th>
              <th className="right">Gap vs 3M</th>
              <th>Restrição</th>
              <th>Ação necessária</th>
            </tr>
          </thead>
          <tbody>
            {model.scenarios.map((scenario) => (
              <tr key={scenario.name}>
                <td>
                  <strong>{scenario.name}</strong>
                  <span className="pro-table-note">{scenario.probability}</span>
                </td>
                <td className="right">{brl.format(scenario.revenue)}</td>
                <td className="right">{brl.format(scenario.h2)}</td>
                <td className="right">{scenario.wonDeals}</td>
                <td className="right">
                  <span className={`pill ${statusClass(scenario.gap)}`}>
                    {scenario.gap <= 0 ? "bate" : brl.format(scenario.gap)}
                  </span>
                </td>
                <td>{scenario.bottleneck}</td>
                <td>{scenario.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Funil recente</h2>
              <span>Volume, conversão e estoque aberto por mês</span>
            </div>
            <SlidersHorizontal size={18} />
          </div>
          <div className="table-wrap compact pro-mini-table">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="right">Criados</th>
                  <th className="right">Ganhos</th>
                  <th className="right">Conversão madura</th>
                  <th className="right">Valor ganho</th>
                  <th className="right">Base aberta</th>
                </tr>
              </thead>
              <tbody>
                {model.conversionTrend.map((row) => (
                  <tr key={row.month}>
                    <td>{monthLabel(row.month)}</td>
                    <td className="right">{row.createdDeals}</td>
                    <td className="right">{row.wonDeals}</td>
                    <td className="right">{formatGrowth(row.matureConversionPct ?? null)}</td>
                    <td className="right">{brl.format(row.wonValue)}</td>
                    <td className="right">{brl.format(row.openValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Estoques invisíveis críticos</h2>
              <span>Onde o sistema já mostra fila, perda ou dado fraco</span>
            </div>
            <AlertTriangle size={18} />
          </div>
          <div className="pro-dbr-list">
            {model.dataAlerts.map((alert) => (
              <DbrItem key={alert.id} title={alert.title} text={alert.message} />
            ))}
          </div>
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Top etapas abertas</h2>
              <span>Onde existe Inventory comercial para destravar</span>
            </div>
            <GitBranch size={18} />
          </div>
          <StageMiniTable rows={model.topOpenStages} />
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Top etapas de perda</h2>
              <span>Onde a conversão precisa de investigação</span>
            </div>
            <GitBranch size={18} />
          </div>
          <StageMiniTable rows={model.topLostStages} />
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Plano de ação</h2>
              <span>Prioridade por frente, impacto esperado e esforço de gestão</span>
            </div>
            <ClipboardCheck size={18} />
          </div>
          <div className="pro-action-list">
            {actionPlans.map((plan) => (
              <article className="pro-action-row" key={plan.area}>
                <div>
                  <span className="pill green">{plan.priority}</span>
                  <strong>{plan.area}</strong>
                </div>
                <p>{plan.action}</p>
                <small>Impacto esperado: {plan.impact}</small>
              </article>
            ))}
          </div>
          <div className="pro-pillar-grid">
            {model.guide3x.pillars.map((pillar) => (
              <article className="pro-pillar-card" key={pillar.id}>
                <span className="brief-kicker">{pillar.subtitle}</span>
                <h3>{pillar.title}</h3>
                <ul className="pro-check-list">
                  {pillar.actions.slice(0, 4).map((action) => (
                    <li key={`${pillar.id}-${action.title}`}>
                      <strong>{action.title}:</strong> {action.detail}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Decisões recomendadas</h2>
              <span>O que fazer, evitar e medir</span>
            </div>
            <Target size={18} />
          </div>
          {decisionBlocks.map((block) => (
            <div className="pro-decision-block" key={block.title}>
              <h3>{block.title}</h3>
              <ul className="pro-check-list">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Indicadores prioritários</h2>
              <span>Boletim semanal PRO</span>
            </div>
            <Layers3 size={18} />
          </div>
          <div className="pro-tags-grid">
            {weeklyCockpit.map((item) => (
              <span className="pro-tag" key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h2>Riscos principais</h2>
              <span>Riscos do cenário R$ 3M e mitigação</span>
            </div>
            <AlertTriangle size={18} />
          </div>
          <ul className="pro-check-list">
            {model.guide3x.risks.map((risk) => (
              <li key={risk.title}>
                <strong>{risk.title}:</strong> {risk.mitigation}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="dashboard-grid pro-dashboard-grid">
        <div className="card">
          <div className="card-title">
            <div>
              <h2>Perguntas em aberto</h2>
              <span>Dados ausentes que impedem conclusões mais fortes</span>
            </div>
            <AlertTriangle size={18} />
          </div>
          <ul className="pro-check-list">
            {missingData.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="card pro-final-answer">
          <div className="card-title">
            <div>
              <h2>Resposta final obrigatória</h2>
              <span>Melhor plano factível com os dados disponíveis</span>
            </div>
            <Target size={18} />
          </div>
          <p>
            O melhor plano factível para maximizar os próximos meses é operar 2026.2 como um sistema TOC:
            drum no fim do funil comercial, buffer técnico para consultoria/obras, rope limitando entrada
            quando apresentação, revisão ou execução saturarem, e boletim semanal com uma única restrição
            prioritária. A meta de R$ 2M no H2 é agressiva e só deve ser perseguida com limpeza de pipeline,
            recuperação de conversão, automação de proposta/apresentação, preparação de assembleias e medição
            rigorosa de capacidade antes de contratar ou vender mais obras.
          </p>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  note,
  tone = "green"
}: {
  label: string;
  value: string;
  note: string;
  tone?: "green" | "amber" | "red";
}) {
  return (
    <article className={`card kpi-card pro-kpi-card pro-kpi-${tone}`}>
      <span className="metric-label">{label}</span>
      <p className="metric">{value}</p>
      <p className="metric-note">{note}</p>
    </article>
  );
}

function DiagnosticItem({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="mini pro-diagnostic-item">
      <span className="metric-label">{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function FlowStep({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="pro-flow-step">
      <span>{label}</span>
      <strong>{typeof value === "number" ? number.format(value) : value}</strong>
    </div>
  );
}

function DbrItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="pro-dbr-item">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function StageMiniTable({
  rows
}: {
  rows: Array<{ pipeline: string; stage: string; deals: number; value: number; averageValue: number }>;
}) {
  return (
    <div className="table-wrap compact pro-mini-table">
      <table>
        <thead>
          <tr>
            <th>Etapa</th>
            <th className="right">Negócios</th>
            <th className="right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.pipeline}-${row.stage}`}>
              <td>
                <strong>{row.stage}</strong>
                <span className="pro-table-note">{row.pipeline}</span>
              </td>
              <td className="right">{row.deals}</td>
              <td className="right">{brl.format(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
