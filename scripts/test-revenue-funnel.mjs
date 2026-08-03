import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../data/processed/revenue-funnel.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const checks = [];
const check = (name, condition, detail) => checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail });
const year = data.periods?.find((period) => period.kind === 'year');
const team = year?.segments?.find((segment) => segment.scope === 'all' && segment.seller === 'TEAM');

check('Fontes consolidadas', /Meta.+Chatwoot.+Pipedrive/.test(data.source), data.source);
check('Quatro periodicidades', ['month', 'quarter', 'semester', 'year'].every((kind) => data.periodKinds?.includes(kind)), data.periodKinds?.join(', '));
check('Sem dados pessoais', !/(phone|email|personName|conversationContent|messageContent)/i.test(raw), 'somente agregados operacionais');
check('Mídia reconciliada', year?.media?.spend > 0 && year?.media?.outboundClicks > 0, `${year?.media?.outboundClicks ?? 0} cliques`);
check('Chatwoot conciliado', year?.chatwoot?.contactInitiated > 0, `${year?.chatwoot?.contactInitiated ?? 0} conversas`);
check('Coorte do Pipedrive', team?.opportunities > 0 && team?.opportunities === team.won + team.lost + team.open, `${team?.opportunities ?? 0} = ganhos + perdidos + abertos`);
check('Funil comercial monotônico', team && team.opportunities >= team.visitsScheduled && team.visitsScheduled >= team.proposalsBuilt && team.proposalsBuilt >= team.proposalsPresented && team.proposalsPresented >= team.won, 'oportunidade ≥ visita ≥ proposta ≥ apresentação ≥ ganho');
check('Tempos com amostra declarada', Object.values(team?.stageTimes ?? {}).every((metric) => Number.isInteger(metric.sample) && metric.sample >= 0), 'média e mediana auditáveis');
check('Lacunas preservadas', year?.chatwoot?.complete === false && year?.chatwoot?.suspectedGapDays > 0, `${year?.chatwoot?.suspectedGapDays ?? 0} lacunas`);
check('CAC rotulado como mídia', data.methodology?.fullCacAvailable === false && /mídia/i.test(data.methodology?.mediaCac ?? ''), 'não apresentado como CAC completo');

for (const item of checks) console.log(`${item.status.padEnd(4)} | ${item.name} | ${item.detail}`);
if (checks.some((item) => item.status === 'FAIL')) process.exitCode = 1;
