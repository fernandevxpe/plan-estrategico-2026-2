"use client";

import type { ConsultoriaLaudosDashboard } from "@/lib/areas/build-consultoria-laudos-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: ConsultoriaLaudosDashboard;
};

export function ConsultoriaLaudosSummaryBar({ data }: Props) {
  const icv = data.byType.find((t) => t.key === "icv");

  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className="vendas-summary-gate ok laudos-ldc-gate">
        <span className="vendas-summary-gate-label">Carro-chefe — LDC + planejamento energético</span>
        <span className="vendas-summary-gate-detail">
          Processo maduro · diferencial competitivo · mercado EV · {data.ytd2026.ldcSharePct}% receita laudos YTD
        </span>
      </div>
      <div className="vendas-summary-gate ok laudos-icv-gate">
        <span className="vendas-summary-gate-label">Aposta H2 — ICV / NP 17</span>
        <span className="vendas-summary-gate-detail">
          NP 17 exige laudo de todos os carregadores
          {icv ? ` · YTD ${icv.deals} ICV` : " · volume ICV em rampa no 2S"}
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>LDC (volume)</span>
          <strong>{data.ytd2026.ldcSharePct}% share · meta {data.targets.ldcPerMonth}/mês</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>LIE</span>
          <strong>meta {data.targets.liePerMonth}/mês</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>ICV</span>
          <strong>{data.targets.icvOutlook}</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Laudos YTD</span>
          <strong>
            {data.ytd2026.totalDeals} · {brl.format(data.ytd2026.totalRevenue)}
          </strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Time</span>
          <strong>{data.team.currentFte} FTE</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.capacityNote.headline}</p>
    </div>
  );
}

export function ConsultoriaLaudosOperationalFocus({ data }: Props) {
  const model = data.focus.operatingModel;
  const pillars = data.focus.strategicPillars;
  const loop = data.focus.learningLoop;
  const rollout = data.focus.automationRollout;
  const coreTypes = data.focus.coreLaudoTypes;
  const icvOpp = data.focus.icvStrategicOpportunity;
  const icvPipeline = data.focus.icvAutomationPipeline;
  const evPlatform = data.focus.evChargerPlatform;
  const lieFlow = data.focus.liePlatformAndFieldApp;
  const lieH2 = data.focus.lieH2DevelopmentProgram;
  const concentration = data.focus.concentrationRisk;
  const visits = data.focus.visitCentralizationOption;
  const postVenda = data.focus.postVendaGuiaContratacao;
  const webPres = data.focus.webPresentationModel;
  const ldc = data.focus.ldcMatureOperation;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{model.headline}</p>

      <div className="card area-sub-card laudos-core-types">
        <h4>{coreTypes.title}</h4>
        <div className="pillars-grid laudos-three-types">
          {coreTypes.types.map((type) => (
            <div className={`pillar-card laudo-type-card ${type.status === "estrategico" ? "is-strategic" : type.status === "maduro" ? "is-mature" : ""}`} key={type.id}>
              <span className={`pill ${type.status === "estrategico" ? "blue" : type.status === "maduro" ? "green" : type.status === "em_andamento" ? "green" : "amber"}`}>
                {type.code}
              </span>
              <strong>{type.name}</strong>
              <p>{type.role}</p>
              <small>{type.ytdNote}</small>
            </div>
          ))}
        </div>
      </div>

      <VendasInlineDetails title={ldc.title} defaultOpen>
        <p className="vendas-gate-statement laudos-np17-headline">{ldc.headline}</p>
        <p className="metric-note">
          <strong>Pacote comercial:</strong> {ldc.commercialPackage.core}
          {ldc.commercialPackage.addOn ? ` · ${ldc.commercialPackage.addOn}` : ""}
        </p>
        <div className="vendas-gate-stats">
          <div className="mini">
            <span className="metric-label">Laudo/planejamento</span>
            <strong>1 pessoa</strong>
            <small>{ldc.teamStructure.laudoProduction}</small>
          </div>
          <div className="mini">
            <span className="metric-label">Campo IoT</span>
            <strong>Instalador dedicado</strong>
            <small>{ldc.teamStructure.fieldInstaller}</small>
          </div>
          <div className="mini">
            <span className="metric-label">Automações</span>
            <strong>Operacionais</strong>
            <small>{ldc.iotAndAutomation.current}</small>
          </div>
        </div>
        <p className="metric-note">{ldc.iotAndAutomation.nextStep}</p>
        <p className="metric-note">{ldc.iotAndAutomation.expansionHeart}</p>

        <VendasInlineDetails title={ldc.qualityEnergyBottleneck.title}>
          <p className="metric-note">{ldc.qualityEnergyBottleneck.description}</p>
          <p className="metric-note capacity-gap-note">{ldc.qualityEnergyBottleneck.constraint}</p>
          <p className="metric-note">{ldc.qualityEnergyBottleneck.improvementTrack}</p>
        </VendasInlineDetails>

        <VendasInlineDetails title={ldc.h2ImprovementProgram.title} defaultOpen>
          <p className="metric-note capacity-gap-note">{ldc.h2ImprovementProgram.urgency}</p>
          <ul className="vendas-compact-list">
            {ldc.h2ImprovementProgram.activities.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </VendasInlineDetails>

        <VendasInlineDetails title={ldc.longTermPd.title}>
          <p className="metric-note">{ldc.longTermPd.description}</p>
          <p className="metric-note">{ldc.longTermPd.timeline}</p>
          <p className="metric-note">Área vinculada: {ldc.longTermPd.linkedArea}</p>
        </VendasInlineDetails>
      </VendasInlineDetails>

      <VendasInlineDetails title={icvOpp.title} defaultOpen>
        <p className="vendas-gate-statement laudos-np17-headline">{icvOpp.headline}</p>
        <ul className="vendas-compact-list">
          {icvOpp.drivers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="metric-note">{icvOpp.commercialLink}</p>
      </VendasInlineDetails>

      <VendasInlineDetails title={lieFlow.title} defaultOpen>
        <p className="vendas-gate-statement laudos-np17-headline">{lieFlow.headline}</p>
        <p className="metric-note">{lieFlow.currentBottleneck}</p>
        <div className="evolution-phases icv-pipeline lie-flow">
          {lieFlow.flow.map((step) => (
            <div className="evolution-phase" key={step.step}>
              <span className="vendas-template-priority">Passo {step.step}</span>
              <strong>{step.name}</strong>
              <p>{step.description}</p>
              <small className="metric-note">Lacuna: {step.gap}</small>
              <small className={`pill ${step.status === "em_andamento" ? "green" : "amber"}`}>{step.status.replace("_", " ")}</small>
            </div>
          ))}
        </div>
        <p className="metric-note">Princípios do checklist em campo:</p>
        <ul className="vendas-compact-list">
          {lieFlow.fieldChecklistPrinciples.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="metric-note capacity-gap-note">{lieFlow.h2Priority}</p>
      </VendasInlineDetails>

      <div className="vendas-summary-gate blocked laudos-concentration-warning">
        <span className="vendas-summary-gate-label">{concentration.title}</span>
        <span className="vendas-summary-gate-detail">{concentration.statement}</span>
        <ul className="vendas-compact-list concentration-mitigations">
          {concentration.mitigations.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      <VendasInlineDetails title={lieH2.title} defaultOpen>
        <p className="metric-note">{lieH2.headline}</p>
        <div className="evolution-phases icv-pipeline">
          {lieH2.tracks.map((track) => (
            <div className="evolution-phase" key={track.id}>
              <span className={`pill ${track.status === "em_andamento" ? "green" : "blue"}`}>{track.status.replace("_", " ")}</span>
              <strong>{track.name}</strong>
              <p>{track.description}</p>
              <small className="metric-note">{track.owner}</small>
            </div>
          ))}
        </div>
        <p className="metric-note capacity-gap-note">{lieH2.expectedOutcome}</p>
      </VendasInlineDetails>

      <VendasInlineDetails title={webPres.title} defaultOpen>
        <p className="metric-note">{webPres.description}</p>
        <ul className="vendas-compact-list">
          {webPres.principles.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="metric-note">{webPres.technicalNote}</p>
      </VendasInlineDetails>

      <VendasInlineDetails title={postVenda.title} defaultOpen>
        <p className="vendas-gate-statement laudos-np17-headline">{postVenda.headline}</p>
        <ol className="director-agenda">
          {postVenda.flow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="metric-note">
          Integração: {postVenda.integrationAreas.join(" · ")}
        </p>
        <p className="metric-note capacity-gap-note">{postVenda.h2Milestone}</p>
      </VendasInlineDetails>

      <VendasInlineDetails title={visits.title}>
        <p className="metric-note">{visits.headline}</p>
        <ul className="vendas-compact-list">
          {visits.visitTypes.map((v) => (
            <li key={v.type}>
              <strong>{v.label}</strong> — {v.note}
            </li>
          ))}
        </ul>
        <p className="metric-note">{visits.optionUnderEvaluation}</p>
        <p className="metric-note capacity-gap-note">{visits.decisionGate}</p>
      </VendasInlineDetails>

      <div className="vendas-gate-stats">
        <div className="mini">
          <span className="metric-label">LDC</span>
          <strong>Volume maduro</strong>
          <small>{model.teamComposition.ldcLane}</small>
        </div>
        <div className="mini">
          <span className="metric-label">LIE</span>
          <strong>Plataforma ~80%</strong>
          <small>{model.teamComposition.lieLane}</small>
        </div>
        <div className="mini">
          <span className="metric-label">ICV</span>
          <strong>Aposta NP 17</strong>
          <small>{model.teamComposition.icvLane}</small>
        </div>
        <div className="mini">
          <span className="metric-label">Automação</span>
          <strong>App → doc → revisão</strong>
          <small>{model.teamComposition.automationLever}</small>
        </div>
      </div>

      <div className="vendas-details-grid">
        <VendasInlineDetails title="Evolução: executor → especialista → coordenação" defaultOpen>
          <div className="evolution-phases">
            {model.evolutionPath.map((step) => (
              <div className="evolution-phase" key={step.phase}>
                <span className="vendas-template-priority">{step.phase}</span>
                <strong>{step.label}</strong>
                <p>{step.description}</p>
              </div>
            ))}
          </div>
        </VendasInlineDetails>

        <VendasInlineDetails title={loop.title} defaultOpen>
          <ol className="director-agenda">
            {loop.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </VendasInlineDetails>
      </div>

      <VendasInlineDetails title={icvPipeline.title} defaultOpen>
        <p className="metric-note">{icvPipeline.subtitle}</p>
        <div className="evolution-phases icv-pipeline">
          {icvPipeline.stages.map((stage) => (
            <div className="evolution-phase" key={stage.stage}>
              <span className="vendas-template-priority">Etapa {stage.stage}</span>
              <strong>{stage.name}</strong>
              <p>{stage.description}</p>
              <small className={`pill ${stage.status === "em_andamento" ? "green" : "amber"}`}>{stage.status.replace("_", " ")}</small>
            </div>
          ))}
        </div>
      </VendasInlineDetails>

      <VendasInlineDetails title={evPlatform.title} defaultOpen>
        <p className="metric-note">{evPlatform.vision}</p>
        <ul className="vendas-compact-list">
          {evPlatform.capabilities.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="metric-note">
          <strong>{evPlatform.financialModel.title}:</strong> {evPlatform.financialModel.description}
        </p>
        <ul className="vendas-compact-list">
          {evPlatform.financialModel.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="metric-note capacity-gap-note">{evPlatform.h2Ownership}</p>
      </VendasInlineDetails>

      <div className="pillars-grid">
        {pillars.map((pillar) => (
          <div className="pillar-card" key={pillar.id}>
            <span
              className={`pill ${pillar.status === "em_andamento" ? "green" : pillar.status === "planejando" ? "blue" : "amber"}`}
            >
              {pillar.status.replace("_", " ")}
            </span>
            <strong>{pillar.title}</strong>
            <p>{pillar.description}</p>
          </div>
        ))}
      </div>

      <VendasInlineDetails title={rollout.title} defaultOpen>
        <p className="metric-note">Concluído:</p>
        <ul className="vendas-compact-list">
          {rollout.completed.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong> — {item.impact}
            </li>
          ))}
        </ul>
        <p className="metric-note">Prioridade H2 (LIE app campo → plataforma · ICV NP 17 · LDC refinamento):</p>
        <div className="automation-queue">
          {rollout.next.map((item) => (
            <div className="vendas-template-chip" key={item.id}>
              <span className="vendas-template-priority">#{item.priority}</span>
              <strong>{item.name}</strong>
              <small>{item.note}</small>
            </div>
          ))}
        </div>
        <p className="metric-note">App interno — funcionalidades:</p>
        <ul className="vendas-compact-list">
          {rollout.appFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </VendasInlineDetails>

      <VendasInlineDetails title={data.focus.performanceCulture.title} defaultOpen>
        <p className="metric-note">Métricas:</p>
        <ul className="vendas-compact-list">
          {data.focus.performanceCulture.metrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="metric-note">Ações:</p>
        <ul className="vendas-compact-list">
          {data.focus.performanceCulture.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </VendasInlineDetails>
    </div>
  );
}

export function ConsultoriaLaudosCapacitySection({ data }: Props) {
  const maxDeals = Math.max(...data.monthly.map((m) => m.deals), 1);

  return (
    <div className="consultoria-capacity is-embedded">
      <p className="vendas-sync-note">{data.capacityNote.detail}</p>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Laudos por mês (2026)</h2>
            <span>
              Fechados no Pipedrive — ticket médio YTD {brl.format(data.ytd2026.avgTicket)}
            </span>
          </div>
        </div>
        <div className="funnel-stages">
          {data.monthly.map((row) => (
            <div className="funnel-stage-row" key={row.month}>
              <div className="funnel-stage-head">
                <strong>{row.label}</strong>
                <span>
                  {row.deals} laudos (LDC {row.ldcDeals} · LIE {row.lieDeals}) · {brl.format(row.revenue)}
                </span>
              </div>
              <div className="funnel-stage-bar">
                <div
                  className="funnel-stage-fill laudo-fill"
                  style={{ width: `${Math.max(8, (row.deals / maxDeals) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Mix por tipo (YTD)</h2>
            <span>Share de receita dentro da área Laudos</span>
          </div>
        </div>
        <div className="mini-grid">
          {data.byType.map((type) => (
            <div className="mini" key={type.key}>
              <span className="metric-label">{type.label}</span>
              <strong>
                {type.deals} · {brl.format(type.revenue)}
              </strong>
              <small>
                ~{type.avgMonthly}/mês · ticket {brl.format(type.avgTicket)} · {type.sharePct}% share
              </small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConsultoriaLaudosRoadmapSection({ data }: Props) {
  return (
    <div className="consultoria-roadmap is-embedded">
      {data.focus.roadmapPhases.map((phase) => (
        <div className="card area-sub-card" key={phase.phase}>
          <span className="vendas-template-priority">{phase.phase}</span>
          <h4>{phase.title}</h4>
          <ul className="vendas-compact-list">
            {phase.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
