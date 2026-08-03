import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../data/processed/presales.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const checks = [];
const check = (name, condition, detail) => checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail });

const configuredToken = process.env.CHATWOOT_API_ACCESS_TOKEN?.trim();
check('Nenhum token no artefato', (!configuredToken || !raw.includes(configuredToken)) && !/api_access_token\s*[=:]/i.test(raw), 'presales.json sem credenciais');
check('Conta Chatwoot identificada', Boolean(data.account?.id && data.account?.name), `${data.account?.name ?? 'ausente'}`);
check('Conversas carregadas', data.conversations?.length > 0, `${data.conversations?.length ?? 0} conversas`);
const allowedConversationFields = new Set(['id', 'inboxId', 'createdAt', 'updatedAt', 'firstReplyAt', 'status', 'initiatedBy', 'firstMessageAt']);
check('Sem dados pessoais ou mensagens', data.conversations?.every((row) => Object.keys(row).every((key) => allowedConversationFields.has(key))), 'somente identificadores técnicos, datas e classificação');
check('Classificação de iniciativa', data.conversations?.every((row) => ['contact', 'company', 'unknown'].includes(row.initiatedBy)), 'contato, empresa ou desconhecido');
check('Conciliação do total', data.conversations?.length === data.totals?.conversations, `${data.totals?.conversations ?? 0} no período`);
check('Série diária contínua', data.daily?.length === data.coverage?.calendarDays, `${data.daily?.length ?? 0} dias explícitos, inclusive zeros`);
check('Cruzamento com Meta', data.daily?.some((row) => row.metaOutboundClicks > 0), `${data.totals?.metaOutboundClicks ?? 0} cliques externos`);
check('Lacunas marcadas', Array.isArray(data.coverage?.suspectedGapDates), `${data.coverage?.suspectedGapDates?.length ?? 0} dias suspeitos`);
check('Relação Meta × Chatwoot calculada', Number.isFinite(data.relationship?.metaAttributedToChatwootCorrelation), `${data.relationship?.reliableDays ?? 0} dias confiáveis`);

for (const item of checks) console.log(`${item.status.padEnd(4)} | ${item.name} | ${item.detail}`);
if (checks.some((item) => item.status === 'FAIL')) process.exitCode = 1;
