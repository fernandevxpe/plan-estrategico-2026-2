import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const processedDir = new URL('../data/processed/', import.meta.url);
const rawDir = new URL('../data/raw/', import.meta.url);
const areasDir = new URL('../data/areas/', import.meta.url);
const outputDir = new URL('../base-estrategica/', import.meta.url);
const attachmentsDir = new URL('../base-estrategica/anexos/', import.meta.url);

const AREA_DEFINITIONS = [
  { id: 'vendas', name: 'Vendas', parentId: null, status: 'executando', lead: 'Comercial XPE', description: 'Funil comercial, fechamentos, conversão e capacidade da equipe de 2 comerciais.' },
  { id: 'consultoria', name: 'Consultoria', parentId: null, status: 'executando', lead: 'Operação técnica', description: 'Hub de entrega técnica — projetos de engenharia e laudos regulatórios.' },
  { id: 'consultoria-projetos', name: 'Projetos', parentId: 'consultoria', status: 'executando', lead: 'Projetistas', businessTypes: ['PROJETOS', 'PIE - Projeto infra.  Eletrocalha e Emergência', 'CDM'] },
  { id: 'consultoria-laudos', name: 'Laudos', parentId: 'consultoria', status: 'executando', lead: 'Projetistas', businessTypes: ['LDC - Laudo de disponibilidade de carga', 'LIE - Laudo de Instalações Elétricas', 'LCC - Laudo Carregador Coletivo', 'LGR - Laudo de Gerenciamento de Risco', 'LSPDA'] },
  { id: 'obras', name: 'Obras', parentId: null, status: 'executando', lead: 'Operação obras', businessTypes: ['OBRA'], serviceMatch: ['Obras eletricas'] },
  { id: 'marketing', name: 'Marketing', parentId: null, status: 'executando', lead: 'Marketing', description: 'Tráfego pago, aquisição, conteúdo e geração de demanda qualificada.' },
  { id: 'eventos', name: 'Eventos', parentId: null, status: 'planejando', lead: 'A definir', description: 'Presença em feiras, networking e geração de pipeline presencial.' },
  { id: 'smart-charging', name: 'Smart Charging', parentId: null, status: 'planejando', lead: 'Produto EV', businessTypes: ['ICV - Inspeção de carregador veicular', 'Instalação de Carregador Eletrico', 'LCC - Laudo Carregador Coletivo'] },
  { id: 'automacoes-ferramentas', name: 'Automações e Ferramentas', parentId: null, status: 'executando', lead: 'Tech / Operações', description: 'CRM, ClickUp, automações internas e produtividade da operação.' },
  { id: 'medidores-iot', name: 'Medidores IoT', parentId: null, status: 'estruturando', lead: 'A definir', description: 'Medição, telemetria e produtos conectados para condomínios e clientes.' },
  { id: 'escala', name: 'Escala', parentId: null, status: 'planejando', lead: 'Gestão', description: 'Capacidade, contratações, processos e crescimento sustentável da operação.' }
];

const OUTPUT_MD = [
  'README.md',
  '01-visao-geral-e-metas.md',
  '02-comercial-funil-e-mix.md',
  '03-clientes-e-recorrencia.md',
  '04-investigacao-e-alertas.md',
  '05-projecoes-2x-3x.md',
  '06-areas-estrategicas.md'
];

const OUTPUT_CSV = [
  'anexos/dados-mensais.csv',
  'anexos/mix-e-servicos.csv',
  'anexos/clientes-organizacoes.csv'
];

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function pct(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function num(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

function sharePct(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function monthLabel(month) {
  if (!month) return '-';
  const [year, mm] = month.split('-');
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${names[Number(mm) - 1]}/${year.slice(2)}`;
}

function mdTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

function sum(items, selector) {
  return items.reduce((acc, item) => acc + selector(item), 0);
}

function sumBusinessTypeRevenue(analysis, types) {
  const rows = analysis.businessTypeMonthly.filter((row) => row.month.startsWith('2026') && types.includes(row.type));
  return {
    revenue: sum(rows, (row) => row.revenue),
    wonDeals: sum(rows, (row) => row.wonDeals)
  };
}

function sumServiceRevenue(analysis, services) {
  const deals = analysis.wonDeals.filter((deal) => deal.wonMonth?.startsWith('2026') && services.includes(deal.service));
  return { revenue: sum(deals, (deal) => deal.value), wonDeals: deals.length };
}

function buildAreaMetrics(analysis, def) {
  const totalRevenue2026 = sum(analysis.monthly.filter((row) => row.month.startsWith('2026')), (row) => row.wonRevenue);
  const areaId = def.id;

  if (areaId === 'vendas') {
    const ytd = analysis.planningSummary.annual['2026Ytd'];
    const funnel = analysis.commercialFunnel.filter((row) => row.month.startsWith('2026'));
    const last = funnel.at(-1);
    const commercial = analysis.growthGuides.projection2x.operationalCapacity.commercialTeam;
    return {
      revenue2026Ytd: ytd.revenue,
      wonDeals2026Ytd: ytd.wonDeals,
      averageTicket: ytd.wonDeals ? ytd.revenue / ytd.wonDeals : null,
      revenueSharePct: 100,
      highlights: [
        `${commercial.currentHeadcount} comerciais · ${commercial.perPersonH2.monthlyClosings.toFixed(1)} fech./pessoa meta H2`,
        `Pipeline aberto: ${last?.openBaseDealsEndOfMonth ?? 0} negócios (${money(last?.openBaseValueEndOfMonth ?? 0)})`,
        `Recomendado: ${commercial.recommendedHeadcount} comerciais no cenário 2x`
      ]
    };
  }

  if (areaId === 'marketing') {
    const traffic = analysis.growthGuides.projection2x.trafficInvestment;
    return {
      highlights: [
        `Tráfego H1: ${money(traffic.h1Total)}`,
        `Tráfego anual projetado (2x): ${money(traffic.annualTotal)}`,
        traffic.averageCostPerClosing ? `CPA médio: ${money(traffic.averageCostPerClosing)}` : 'CPA: acompanhar mensalmente'
      ]
    };
  }

  if (areaId === 'consultoria') {
    const projetos = buildAreaMetrics(analysis, AREA_DEFINITIONS.find((a) => a.id === 'consultoria-projetos'));
    const laudos = buildAreaMetrics(analysis, AREA_DEFINITIONS.find((a) => a.id === 'consultoria-laudos'));
    const revenue = (projetos.revenue2026Ytd ?? 0) + (laudos.revenue2026Ytd ?? 0);
    const wonDeals = (projetos.wonDeals2026Ytd ?? 0) + (laudos.wonDeals2026Ytd ?? 0);
    return {
      revenue2026Ytd: revenue,
      wonDeals2026Ytd: wonDeals,
      averageTicket: wonDeals ? revenue / wonDeals : null,
      revenueSharePct: totalRevenue2026 ? (revenue / totalRevenue2026) * 100 : null,
      highlights: [
        `Projetos: ${projetos.wonDeals2026Ytd ?? 0} contratos · Laudos: ${laudos.wonDeals2026Ytd ?? 0} contratos`,
        '5 projetistas (era 3) + automação',
        `${((revenue / totalRevenue2026) * 100).toFixed(0)}% da receita 2026 YTD`
      ]
    };
  }

  if (areaId === 'escala') {
    const delivery = analysis.growthGuides.projection2x.operationalCapacity.deliveryTeam;
    const commercial = analysis.growthGuides.projection2x.operationalCapacity.commercialTeam;
    return {
      highlights: [
        `Projetistas: ${delivery.projectistasHistorical} → ${delivery.projectistasCurrent}`,
        delivery.capacityNote,
        `Comercial: ${commercial.currentHeadcount} → ${commercial.recommendedHeadcount} recomendado`
      ]
    };
  }

  if (areaId === 'automacoes-ferramentas') {
    const alerts = analysis.dataQualityAlerts?.length ?? 0;
    return {
      highlights: [
        `${analysis.totals.clickupTasksAll.toLocaleString('pt-BR')} tarefas ClickUp`,
        `${analysis.totals.pipedriveDealsAll.toLocaleString('pt-BR')} negócios no Pipedrive`,
        alerts ? `${alerts} alerta(s) de qualidade de dados` : 'Qualidade de dados em revisão'
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

  const highlights = [];
  if (def.businessTypes?.length && revenue > 0) {
    const topType = analysis.businessTypeMonthly
      .filter((row) => row.month.startsWith('2026') && def.businessTypes.includes(row.type))
      .reduce((acc, row) => {
        acc[row.type] = (acc[row.type] ?? 0) + row.revenue;
        return acc;
      }, {});
    const best = Object.entries(topType).sort((a, b) => b[1] - a[1])[0];
    if (best) highlights.push(`Principal tipo: ${best[0].split(' - ')[0]} (${money(best[1])})`);
  }
  if (!revenue) highlights.push('Sem receita mapeada ainda — área em planejamento');

  return {
    revenue2026Ytd: revenue || null,
    wonDeals2026Ytd: wonDeals || null,
    averageTicket: wonDeals ? revenue / wonDeals : null,
    revenueSharePct: totalRevenue2026 && revenue ? (revenue / totalRevenue2026) * 100 : null,
    highlights
  };
}

function renderAreaMd(analysis, def, plans, heading = '##') {
  const plan = plans.areas[def.id];
  const metrics = buildAreaMetrics(analysis, def);
  const lines = [
    `${heading} ${def.name}`,
    '',
    `> Slug: \`${def.id}\` · Status: **${def.status}** · Responsável: ${def.lead}`,
    '',
    def.description ? `${def.description}\n` : '',
    '## Métricas 2026 (YTD)',
    '',
    metrics.revenue2026Ytd != null
      ? `- Receita: **${money(metrics.revenue2026Ytd)}** (${num(metrics.revenueSharePct, 1)}% do total)`
      : '- Receita: não mapeada diretamente nesta área',
    metrics.wonDeals2026Ytd != null ? `- Contratos fechados: **${metrics.wonDeals2026Ytd}**` : '',
    metrics.averageTicket != null ? `- Ticket médio: **${money(metrics.averageTicket)}**` : '',
    metrics.highlights?.length ? `\n### Destaques\n${metrics.highlights.map((h) => `- ${h}`).join('\n')}` : '',
    '',
    '## Notas estratégicas',
    '',
    ...(plan?.strategicNotes ?? ['Plano em construção — detalhar em conversa com a gestão.']).map((note) => `- ${note}`),
    '',
    '## Objetivos',
    '',
    plan?.objectives?.length
      ? mdTable(
          ['Objetivo', 'Métrica', 'Meta'],
          plan.objectives.map((obj) => [obj.title, obj.metric, obj.target])
        )
      : '_Nenhum objetivo cadastrado ainda._',
    '',
    '## Atividades',
    '',
    plan?.activities?.length
      ? mdTable(
          ['Atividade', 'Responsável', 'Prazo', 'Prioridade', 'Status'],
          plan.activities.map((act) => [act.title, act.responsible, act.dueMonth, act.priority, act.status])
        )
      : '_Nenhuma atividade cadastrada ainda._',
    '',
    '## Riscos',
    '',
    plan?.risks?.length
      ? plan.risks.map((risk) => `- **${risk.title}** — mitigação: ${risk.mitigation}`).join('\n')
      : '_Nenhum risco cadastrado._',
    ''
  ];

  if (def.businessTypes?.length) {
    const typeRows = analysis.businessTypeMonthly
      .filter((row) => row.month.startsWith('2026') && def.businessTypes.includes(row.type))
      .reduce((acc, row) => {
        if (!acc[row.type]) acc[row.type] = { wonDeals: 0, revenue: 0 };
        acc[row.type].wonDeals += row.wonDeals;
        acc[row.type].revenue += row.revenue;
        return acc;
      }, {});
    const rows = Object.entries(typeRows).sort((a, b) => b[1].revenue - a[1].revenue);
    if (rows.length) {
      lines.push('## Mix por tipo comercial (2026 YTD)', '');
      lines.push(
        mdTable(
          ['Tipo', 'Fechamentos', 'Receita'],
          rows.map(([type, stats]) => [type.split(' - ')[0], String(stats.wonDeals), money(stats.revenue)])
        )
      );
      lines.push('');
    }
  }

  return lines.filter((line) => line !== undefined).join('\n');
}

function buildOrganizationsSummary(analysis, organizations) {
  const wonByOrgId = new Map();
  for (const deal of analysis.wonDeals) {
    if (!deal.organizationId) continue;
    const current = wonByOrgId.get(deal.organizationId) ?? {
      organizationId: deal.organizationId,
      organization: deal.organization ?? '-',
      cnpj: deal.cnpj ?? null,
      wonDeals: 0,
      totalRevenue: 0,
      firstWonMonth: deal.wonMonth,
      lastWonMonth: deal.wonMonth,
      types: new Set()
    };
    current.wonDeals += 1;
    current.totalRevenue += deal.value;
    if (deal.wonMonth && deal.wonMonth < current.firstWonMonth) current.firstWonMonth = deal.wonMonth;
    if (deal.wonMonth && deal.wonMonth > current.lastWonMonth) current.lastWonMonth = deal.wonMonth;
    for (const type of deal.businessTypes ?? []) current.types.add(type);
    wonByOrgId.set(deal.organizationId, current);
  }

  const orgById = new Map(organizations.map((org) => [org.id, org]));
  const withWins = [...wonByOrgId.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
  const repeat = withWins.filter((row) => row.wonDeals > 1);
  const withOpenDeals = organizations
    .filter((org) => org.open_deals_count > 0)
    .sort((a, b) => b.open_deals_count - a.open_deals_count);

  return { orgById, withWins, repeat, withOpenDeals, totalOrganizations: organizations.length };
}

async function cleanOutputDir() {
  if (existsSync(outputDir)) {
    await rm(outputDir, { recursive: true, force: true });
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function writeCsvFile(relativePath, rows) {
  if (!rows.length) {
    await writeFile(new URL(relativePath, outputDir), '\n');
    return;
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [keys.join(';'), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(';'))];
  await writeFile(new URL(relativePath, outputDir), `${lines.join('\n')}\n`);
}

async function writeConsolidatedCsvs(analysis, orgSummary) {
  const funnelByMonth = Object.fromEntries(analysis.commercialFunnel.map((row) => [row.month, row]));

  const dadosMensais = analysis.monthly
    .filter((row) => row.month >= '2025-01')
    .map((row) => {
      const funnel = funnelByMonth[row.month] ?? {};
      return {
        mes: row.month,
        novos_negocios: row.createdDeals,
        fechamentos: row.wonDeals,
        receita_ganha: row.wonRevenue.toFixed(2),
        ticket_medio: row.averageTicket?.toFixed(2) ?? '',
        crescimento_receita_pct: row.revenueGrowthPct?.toFixed(1) ?? '',
        conversao_novos_neg_pct: funnel.cohortConversionPct?.toFixed(1) ?? '',
        perdidos: funnel.lostDeals ?? '',
        pipeline_aberto_fim_mes: funnel.openBaseDealsEndOfMonth ?? '',
        valor_pipeline_aberto: funnel.openBaseValueEndOfMonth?.toFixed(2) ?? ''
      };
    });

  const mixServicos = [
    ...analysis.businessTypeMonthly
      .filter((row) => row.month.startsWith('2026'))
      .map((row) => ({
        tipo_registro: 'tipo_comercial_mes',
        mes: row.month,
        tipo: row.type,
        fechamentos: row.wonDeals,
        receita: row.revenue.toFixed(2),
        ticket_medio: row.averageTicket?.toFixed(2) ?? '',
        servico: '',
        primeiro_fechamento: '',
        ultimo_fechamento: ''
      })),
    ...analysis.serviceSummary.map((row) => ({
      tipo_registro: 'servico_total',
      mes: '',
      tipo: '',
      fechamentos: row.wonDeals,
      receita: row.revenue.toFixed(2),
      ticket_medio: row.averageTicket?.toFixed(2) ?? '',
      servico: row.service,
      primeiro_fechamento: row.firstWonMonth ?? '',
      ultimo_fechamento: row.lastWonMonth ?? ''
    }))
  ];

  const clientes = [
    ...orgSummary.withWins.map((row) => ({
      tipo_registro: 'organizacao_fechamentos',
      chave: row.organizationId,
      nome: row.organization,
      cnpj: row.cnpj ?? '',
      fechamentos: row.wonDeals,
      receita_total: row.totalRevenue.toFixed(2),
      receita_repetida: '',
      primeiro_ganho: row.firstWonMonth ?? '',
      ultimo_ganho: row.lastWonMonth ?? '',
      tipos: [...row.types].join(', ')
    })),
    ...analysis.repeatSalesByAccount.map((row) => ({
      tipo_registro: 'conta_recorrente',
      chave: row.key,
      nome: row.organization ?? row.key,
      cnpj: row.cnpj ?? '',
      fechamentos: row.wonDeals,
      receita_total: row.totalRevenue.toFixed(2),
      receita_repetida: row.repeatRevenue.toFixed(2),
      primeiro_ganho: row.firstWonMonth ?? '',
      ultimo_ganho: row.lastWonMonth ?? '',
      tipos: row.types ?? ''
    }))
  ];

  await writeCsvFile('anexos/dados-mensais.csv', dadosMensais);
  await writeCsvFile('anexos/mix-e-servicos.csv', mixServicos);
  await writeCsvFile('anexos/clientes-organizacoes.csv', clientes);
}

async function main() {
  const analysis = JSON.parse(await readFile(new URL('analysis.json', processedDir), 'utf8'));
  const plans = JSON.parse(await readFile(new URL('execution-plans.json', areasDir), 'utf8'));

  let organizations = [];
  let syncSummary = null;
  try {
    const orgRaw = JSON.parse(await readFile(new URL('pipedrive-organizations.json', rawDir), 'utf8'));
    organizations = orgRaw.data ?? [];
  } catch {
    organizations = [];
  }
  try {
    syncSummary = JSON.parse(await readFile(new URL('sync-summary.json', rawDir), 'utf8'));
  } catch {
    syncSummary = null;
  }

  const generatedAt = new Date(analysis.generatedAt).toLocaleString('pt-BR');
  const orgSummary = buildOrganizationsSummary(analysis, organizations);
  const guide2x = analysis.growthGuides.projection2x;
  const guide3x = analysis.growthGuides.projection3x;
  const ps = analysis.planningSummary;
  const deep = analysis.deepAnalysis;
  const openDealsCount = sum(deep.funnelByStage.open ?? [], (row) => row.deals);
  const openPipelineValue = sum(deep.funnelByStage.open ?? [], (row) => row.value);
  const wonDealsCount = sum(deep.funnelByStage.won ?? [], (row) => row.deals);
  const wonPipelineValue = sum(deep.funnelByStage.won ?? [], (row) => row.value);
  const lostDealsCount = sum(deep.funnelByStage.lost ?? [], (row) => row.deals);
  const lostPipelineValue = sum(deep.funnelByStage.lost ?? [], (row) => row.value);

  const readme = `# Base estratégica — XPE Consultoria

Export gerado em **${generatedAt}** · **10 arquivos** (7 docs + 3 CSVs).

## Os arquivos

| Arquivo | Quando usar |
| --- | --- |
| \`README.md\` | Este índice |
| \`01-visao-geral-e-metas.md\` | Contexto inicial — KPIs, cenários, timeline |
| \`02-comercial-funil-e-mix.md\` | Funil, conversão, tipos e serviços |
| \`03-clientes-e-recorrencia.md\` | Clientes, repetição, organizações CRM |
| \`04-investigacao-e-alertas.md\` | Alertas, recordes, diagnósticos |
| \`05-projecoes-2x-3x.md\` | Metas operacionais jul–dez |
| \`06-areas-estrategicas.md\` | Todas as 11 áreas com planos |
| \`anexos/dados-mensais.csv\` | Série mensal + funil (planilha) |
| \`anexos/mix-e-servicos.csv\` | Tipos comerciais + serviços |
| \`anexos/clientes-organizacoes.csv\` | Organizações e contas recorrentes |

## Sugestão rápida

- **Conversa geral:** anexe \`01\` + \`06\`
- **Comercial:** \`01\` + \`02\` + \`05\`
- **Clientes / pós-venda:** \`01\` + \`03\` + \`anexos/clientes-organizacoes.csv\`

## Regenerar

\`\`\`bash
npm run analyze
# ou só:
npm run export:context
\`\`\`

> Junho/2026 pode estar parcial conforme data do sync.
`;

  const visaoGeralMetas = `# Visão geral e metas — XPE Consultoria

Gerado em: ${generatedAt}

## Escopo dos dados

- ${analysis.scope}
- Negócios analisados: **${analysis.totals.analysisDeals}**
- Negócios ganhos no período: **${analysis.totals.wonDeals}**
- Foco 2026: **${analysis.totals.focus2026Deals}** negócios
- Pipedrive total: **${analysis.totals.pipedriveDealsAll}** negócios
- ClickUp: **${analysis.totals.clickupTasksAll}** tarefas
- Organizações no CRM: **${orgSummary.totalOrganizations}**

## Receita e volume

| Período | Receita | Fechamentos | Novos negócios | Ticket médio |
| --- | ---: | ---: | ---: | ---: |
| 2025 (ano) | ${money(ps.annual['2025'].revenue)} | ${ps.annual['2025'].wonDeals} | ${ps.annual['2025'].createdDeals} | ${money(ps.annual['2025'].revenue / ps.annual['2025'].wonDeals)} |
| 2026 YTD${ps.annual['2026Ytd'].isPartial ? ' (parcial)' : ''} | ${money(ps.annual['2026Ytd'].revenue)} | ${ps.annual['2026Ytd'].wonDeals} | ${ps.annual['2026Ytd'].createdDeals} | ${money(ps.annual['2026Ytd'].averageTicket ?? ps.annual['2026Ytd'].revenue / ps.annual['2026Ytd'].wonDeals)} |
| H1/2025 realizado | ${money(ps.semesters['2025-H1'].revenue)} | ${ps.semesters['2025-H1'].wonDeals} | ${ps.semesters['2025-H1'].createdDeals} | ${money(ps.semesters['2025-H1'].averageTicket)} |
| H2/2025 realizado | ${money(ps.semesters['2025-H2'].revenue)} | ${ps.semesters['2025-H2'].wonDeals} | ${ps.semesters['2025-H2'].createdDeals} | ${money(ps.semesters['2025-H2'].averageTicket)} |
| H1/2026 realizado | ${money(ps.semesters['2026-H1'].revenue)} | ${ps.semesters['2026-H1'].wonDeals} | ${ps.semesters['2026-H1'].createdDeals} | ${money(ps.semesters['2026-H1'].averageTicket)} |
| H1/2026 projetado | ${money(ps.semesters['2026-H1-projected'].revenue)} | ${ps.semesters['2026-H1-projected'].wonDeals} | ${ps.semesters['2026-H1-projected'].createdDeals} | ${money(ps.semesters['2026-H1-projected'].averageTicket)} |

## Run rate (jan–mai/2026)

- Receita mensal média: **${money(ps.runRateMonthly)}**
- Fechamentos mensais médios: **${num(ps.runRateWonMonthly)}**
- Cenário padrão: **${ps.defaultScenario}**
- Projeção anual base 2026: **${money(ps.baseYearTotal2026)}**

## Insights automáticos

${ps.insights.map((item) => `- **${item.title}** (${item.kind}): ${item.body}`).join('\n')}

## Capacidade operacional (cenário 2x)

- Comercial: **${guide2x.operationalCapacity.commercialTeam.currentHeadcount}** pessoas (meta H2: ${guide2x.operationalCapacity.commercialTeam.perPersonH2.monthlyClosings.toFixed(1)} fech./pessoa/mês)
- Projetistas: **${guide2x.operationalCapacity.deliveryTeam.projectistasCurrent}** (era ${guide2x.operationalCapacity.deliveryTeam.projectistasHistorical})
- Tráfego H1: **${money(guide2x.trafficInvestment.h1Total)}**
- Meta H1 2x: **${money(guide2x.h1Target)}** · Meta ano 2x: **${money(guide2x.annualTarget)}**

## Cenários anuais 2026

${mdTable(
  ['Cenário', 'H1 projetado', 'H2 projetado', 'Total ano', 'Fechamentos est.'],
  ps.yearProjectionByScenario.map((row) => [
    row.scenario,
    money(row.h1Projected),
    money(row.h2Projected),
    money(row.totalProjected),
    String(Math.round(row.wonDealsEstimated))
  ])
)}

## Trimestres

${mdTable(
  ['Trimestre', 'Receita', 'Fechamentos', 'Novos neg.', 'Ticket médio'],
  Object.entries(ps.quarters).map(([key, row]) => [key, money(row.revenue), String(row.wonDeals), String(row.createdDeals), money(row.averageTicket)])
)}

## Timeline 2026 (mês a mês)

${mdTable(
  ['Mês', 'Tipo', 'Receita', 'Fechamentos', 'Novos neg.', 'Projeção receita'],
  ps.timeline2026.map((row) => [
    row.month,
    row.kind,
    money(row.revenue),
    String(row.wonDeals),
    String(row.createdDeals),
    row.projectedRevenue ? money(row.projectedRevenue) : '-'
  ])
)}

## Projeção H2/2026 (jul–dez)

${mdTable(
  ['Cenário', 'Premissa', 'Receita jul–dez', 'Fechamentos est.'],
  analysis.projection2026H2.scenarios.map((row) => [row.name, row.premise, money(row.revenue), String(Math.round(row.wonDeals))])
)}

## Crescimento 2025 vs 2026 (jan–jun)

${mdTable(
  ['Mês', 'Rec. 2025', 'Rec. 2026', 'YoY rec.', 'Fech. 2025', 'Fech. 2026', 'MoM 2026'],
  analysis.growthComparison.map((row) => [
    row.label,
    money(row.revenue2025),
    row.revenue2026 == null ? '-' : money(row.revenue2026),
    pct(row.revenueYoYPct),
    String(row.wonDeals2025 ?? '-'),
    String(row.wonDeals2026 ?? '-'),
    pct(row.revenueMoM2026Pct)
  ])
)}

## Qualidade de dados

${analysis.dataQualityAlerts?.map((alert) => `- **${alert.title}**: ${alert.message}`).join('\n') ?? '_Sem alertas._'}

## Cobertura CNPJ

- Organizações com CNPJ: **${analysis.cnpjCoverage.organizationsWithCnpj}/${analysis.cnpjCoverage.organizations}**
- Ganhos com CNPJ: **${analysis.cnpjCoverage.wonDealsWithCnpj}/${analysis.cnpjCoverage.wonDeals}**
`;

  const comercial = `# Comercial — funil e mix

Gerado em: ${generatedAt}

## Funil mensal 2026

${mdTable(
  ['Mês', 'Novos', 'Valor criado', 'Ganhos', 'Receita', 'Perdidos', 'Conv. novos neg.', 'Abertos fim mês', 'Valor aberto'],
  analysis.commercialFunnel
    .filter((row) => row.month.startsWith('2026'))
    .map((row) => [
      row.month,
      String(row.createdDeals),
      money(row.createdValue),
      String(row.wonDeals),
      money(row.wonValue),
      String(row.lostDeals),
      pct(row.cohortConversionPct),
      String(row.openBaseDealsEndOfMonth),
      money(row.openBaseValueEndOfMonth)
    ])
)}

## Funil por etapa (snapshot)

- Abertos: **${openDealsCount}** negócios · ${money(openPipelineValue)}
- Ganhos (análise): **${wonDealsCount}** · ${money(wonPipelineValue)}
- Perdidos: **${lostDealsCount}** · ${money(lostPipelineValue)}

## Tempo para fechar

- Média geral: **${num(deep.timeToClose.overallAverageDays, 0)} dias**
- Mês mais rápido: **${monthLabel(deep.timeToClose.fastestMonth.month)}** (${num(deep.timeToClose.fastestMonth.averageDays, 0)} dias)
- Mês mais lento: **${monthLabel(deep.timeToClose.slowestMonth.month)}** (${num(deep.timeToClose.slowestMonth.averageDays, 0)} dias)
- Pico de receita (${monthLabel(deep.timeToClose.peakRevenueMonth)}): ciclo de **${num(deep.timeToClose.peakRevenueCycleDays, 0)} dias**

## Tipos comerciais por mês (2026)

${mdTable(
  ['Mês', 'Tipo', 'Fechamentos', 'Receita', 'Ticket', 'MoM rec.', 'YoY rec.'],
  analysis.businessTypeMonthly
    .filter((row) => row.month.startsWith('2026'))
    .map((row) => [
      row.month,
      row.type.split(' - ')[0],
      String(row.wonDeals),
      money(row.revenue),
      money(row.averageTicket),
      pct(row.revenueMoMPct),
      pct(row.revenueYoYPct)
    ])
)}

## Serviços mais fechados (top 15)

${mdTable(
  ['Serviço', 'Fechamentos', 'Receita', 'Ticket', 'Primeiro', 'Último'],
  analysis.serviceSummary.slice(0, 15).map((row) => [
    row.service,
    String(row.wonDeals),
    money(row.revenue),
    money(row.averageTicket),
    row.firstWonMonth ?? '-',
    row.lastWonMonth ?? '-'
  ])
)}

## Mix nos meses de pico

${(deep.peakMix?.peaks ?? [])
  .map(
    (peak) =>
      `### ${monthLabel(peak.month)} — ${money(peak.revenue)}\n\n${peak.types.map((t) => `- ${t.type.split(' - ')[0]}: ${money(t.revenue)} (${num(t.sharePct, 1)}%)`).join('\n')}`
  )
  .join('\n\n')}
`;

  const clientes = `# Clientes e recorrência

Gerado em: ${generatedAt}

## Recorrência

- Contas com mais de um fechamento (CNPJ): **${analysis.postSalesByCnpj.length}**
- Contas repetidas (organização): **${analysis.repeatSalesByAccount.length}**
- Receita de repetição: **${money(sum(analysis.repeatSalesByAccount, (row) => row.repeatRevenue))}**
- Confiança CNPJ: **${analysis.postSalesConfidence.cnpjExact.accounts}** contas · ${money(analysis.postSalesConfidence.cnpjExact.repeatRevenue)} (${analysis.postSalesConfidence.cnpjExact.confidence})
- Por nome de organização: **${analysis.postSalesConfidence.accountName.accounts}** contas · ${money(analysis.postSalesConfidence.accountName.repeatRevenue)} (${analysis.postSalesConfidence.accountName.confidence})

## Origem da receita (novo vs repetido)

${mdTable(
  ['Mês', 'Receita', 'Nova', 'Repetida', '% nova', '% repetida'],
  deep.revenueOrigin.byMonth
    .filter((row) => row.month.startsWith('2026'))
    .map((row) => [
      row.month,
      money(row.totalRevenue),
      money(row.newRevenue),
      money(row.repeatRevenue),
      sharePct(row.newSharePct),
      sharePct(row.repeatSharePct)
    ])
)}

## Top 30 clientes por receita (organizações com fechamento)

${mdTable(
  ['Organização', 'CNPJ', 'Fechamentos', 'Receita', 'Repetida', 'Primeiro', 'Último', 'Tipos'],
  analysis.repeatSalesByAccount
    .slice(0, 30)
    .map((row) => [
      row.organization ?? row.key,
      row.cnpj ?? '-',
      String(row.wonDeals),
      money(row.totalRevenue),
      money(row.repeatRevenue),
      row.firstWonMonth ?? '-',
      row.lastWonMonth ?? '-',
      row.types ?? '-'
    ])
)}

## Organizações no CRM

- Total cadastradas: **${orgSummary.totalOrganizations}**
- Com pelo menos 1 fechamento: **${orgSummary.withWins.length}**
- Com repetição (2+ fechamentos): **${orgSummary.repeat.length}**
- Com negócios abertos agora: **${orgSummary.withOpenDeals.length}**

### Top 20 organizações com pipeline aberto

${mdTable(
  ['Organização', 'Negócios abertos', 'Ganhos históricos', 'Perdidos'],
  orgSummary.withOpenDeals.slice(0, 20).map((org) => [
    org.name,
    String(org.open_deals_count),
    String(org.won_deals_count),
    String(org.lost_deals_count)
  ])
)}

> Lista completa: \`anexos/clientes-organizacoes.csv\`
`;

  const investigacao = `# Investigação e alertas

Gerado em: ${generatedAt}

## Alertas de performance

${analysis.deepAnalysis.performanceAlerts.map((alert) => `- **[${alert.severity}] ${monthLabel(alert.month)}**: ${alert.message}`).join('\n')}

## Recomendações de indicadores

${analysis.indicatorHighlights.recommendations?.map((item) => `- **${item.title}**: ${item.body}`).join('\n') ?? '_Nenhuma._'}

## Recordes e destaques

- Melhor mês de receita: **${monthLabel(analysis.indicatorHighlights.summary.bestRevenueMonth)}** (${money(analysis.indicatorHighlights.summary.bestRevenueValue)})
- Melhor conversão dos novos negócios: **${monthLabel(analysis.indicatorHighlights.summary.bestConversionMonth)}** (${num(analysis.indicatorHighlights.summary.bestConversionValue, 1)}%)
- Melhor mês de novos negócios: **${monthLabel(analysis.indicatorHighlights.summary.bestCreatedMonth)}** (${analysis.indicatorHighlights.summary.bestCreatedValue} criados)
- Recordes em 2026: **${analysis.indicatorHighlights.summary.recordsIn2026}** eventos

## Análise: tempo para fechar (2026)

${mdTable(
  ['Mês', 'Fechamentos', 'Média dias', 'Mediana', 'Receita'],
  deep.timeToClose.byMonth
    .filter((row) => row.month.startsWith('2026'))
    .map((row) => [row.month, String(row.wonDeals), num(row.averageDays, 0), num(row.medianDays, 0), money(row.revenue)])
)}

## Padrões de mix em picos

${(deep.peakMix?.patterns ?? deep.peakMixPatterns ?? []).map((item) => `- ${item.summary ?? item}`).join('\n') || '_Ver seção mix nos meses de pico._'}

## Alertas de qualidade de dados

${analysis.dataQualityAlerts.map((alert) => `- **${alert.title}** (${alert.severity}): ${alert.message}`).join('\n')}
`;

  function renderGrowthGuide(guide) {
    const lines = [
      `# ${guide.name}`,
      '',
      `> ${guide.tagline}`,
      '',
      guide.premise,
      '',
      `- Meta H1: **${money(guide.h1Target)}**`,
      `- Meta H2: **${money(guide.h2Target)}**`,
      `- Meta ano: **${money(guide.annualTarget)}**`,
      `- ${guide.recurrenceNote ?? ''}`,
      '',
      '## Capacidade',
      '',
      `- Comercial: ${guide.operationalCapacity.commercialTeam.currentHeadcount} → ${guide.operationalCapacity.commercialTeam.recommendedHeadcount} recomendado`,
      `- Projetistas: ${guide.operationalCapacity.deliveryTeam.projectistasHistorical} → ${guide.operationalCapacity.deliveryTeam.projectistasCurrent}`,
      `- ${guide.operationalCapacity.deliveryTeam.capacityNote}`,
      '',
      '## Tráfego',
      '',
      `- H1: ${money(guide.trafficInvestment.h1Total)}`,
      `- Anual: ${money(guide.trafficInvestment.annualTotal)}`,
      guide.trafficInvestment.averageCostPerClosing ? `- CPA médio: ${money(guide.trafficInvestment.averageCostPerClosing)}` : '',
      '',
      '## Metas mês a mês (jul–dez/2026)',
      '',
      mdTable(
        ['Mês', 'Receita', 'Fechamentos', 'Ticket', 'Novos neg.', 'Conv.', 'Tráfego', 'Fech./comercial'],
        guide.monthlyTargets.map((row) => [
          row.label,
          money(row.revenueTarget),
          num(row.wonDealsTarget, 1),
          money(row.averageTicketTarget),
          num(row.createdDealsTarget, 0),
          `${num(row.conversionTargetPct, 1)}%`,
          money(row.adSpend),
          num(row.perCommercial?.closings, 1)
        ])
      ),
      ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  const projecoes = `# Projeções operacionais 2x e 3x

Gerado em: ${generatedAt}

Compare os dois cenários de crescimento usados no dashboard.

${renderGrowthGuide(guide2x)}

---

${renderGrowthGuide(guide3x)}
`;

  const areasTodas = `# Áreas estratégicas — XPE Consultoria

Gerado em: ${generatedAt}

Todas as 11 áreas em um único documento. Para conversar sobre uma área específica, referencie a seção pelo nome.

${AREA_DEFINITIONS.map((def, index) => `${index > 0 ? '\n---\n\n' : ''}${renderAreaMd(analysis, def, plans, '##')}`).join('')}
`;

  const files = [
    ['README.md', readme],
    ['01-visao-geral-e-metas.md', visaoGeralMetas],
    ['02-comercial-funil-e-mix.md', comercial],
    ['03-clientes-e-recorrencia.md', clientes],
    ['04-investigacao-e-alertas.md', investigacao],
    ['05-projecoes-2x-3x.md', projecoes],
    ['06-areas-estrategicas.md', areasTodas]
  ];

  await cleanOutputDir();
  await mkdir(outputDir, { recursive: true });
  await mkdir(attachmentsDir, { recursive: true });

  for (const [name, content] of files) {
    await writeFile(new URL(name, outputDir), content);
  }

  await writeConsolidatedCsvs(analysis, orgSummary);

  console.log(`Base estratégica exportada: ${files.length} docs + ${OUTPUT_CSV.length} anexos = ${files.length + OUTPUT_CSV.length} arquivos`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
