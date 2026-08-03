import { readFile } from 'node:fs/promises';

const path = new URL('../data/processed/marketing.json', import.meta.url);
const raw = await readFile(path, 'utf8');
const data = JSON.parse(raw);
const checks = [];
const currentMonth = new Date().toISOString().slice(0, 7);
const expectedMonths = [];
for (let cursor = new Date(`${new Date().getUTCFullYear()}-01-15T12:00:00Z`); cursor <= new Date(`${currentMonth}-15T12:00:00Z`); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
  expectedMonths.push(cursor.toISOString().slice(0, 7));
}
const loadedMonths = Object.keys(data.periods ?? {}).filter((key) => /^\d{4}-\d{2}$/.test(key)).sort();
const additiveCreativeFields = ['spend', 'impressions', 'clicks', 'linkClicks', 'outboundClicks', 'landingPageViews', 'conversations'];

function check(name, condition, detail) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail });
}

check('Nenhum token no artefato', !/EAAG[A-Za-z0-9_-]{40,}/.test(raw), 'marketing.json não pode conter credenciais');
check('Conta de anúncios ativa', data.account?.account_status === 1, `${data.account?.name} · status ${data.account?.account_status}`);
check('Histórico diário carregado', data.daily?.length > 0, `${data.daily?.length ?? 0} dias`);
check('Histórico mensal desde janeiro', expectedMonths.every((month) => loadedMonths.includes(month)), loadedMonths.join(', '));
check('Campanhas disponíveis por mês', expectedMonths.every((month) => Array.isArray(data.campaignPeriods?.[month])), `${expectedMonths.length} meses esperados`);
check('Anúncios disponíveis por mês', expectedMonths.every((month) => Array.isArray(data.adPeriods?.[month])), `${expectedMonths.length} meses esperados`);
check('Histórico diário dos criativos', data.adDaily?.length > 0 && data.adDaily.every((row) => row.date && row.adId), `${data.adDaily?.length ?? 0} registros`);
check('Criativos conciliados com a conta', additiveCreativeFields.every((field) => Math.abs(data.adDaily.reduce((total, row) => total + Number(row[field] ?? 0), 0) - Number(data.periods?.ytd?.[field] ?? 0)) < 0.02), additiveCreativeFields.join(', '));
check('Campanhas carregadas', data.totals?.campaigns > 0, `${data.totals?.campaigns ?? 0} campanhas`);
check('Anúncios carregados', data.totals?.ads > 0, `${data.totals?.ads ?? 0} anúncios`);
check('Métricas financeiras válidas', Object.values(data.periods ?? {}).every((row) => row.spend >= 0 && row.impressions >= 0 && row.clicks >= 0), 'períodos sem valores negativos');
check('Instagram vinculado', Boolean(data.instagram?.profile?.username), `@${data.instagram?.profile?.username ?? 'ausente'}`);
check('Publicações com links', data.instagram?.media?.some((item) => /^https:\/\/www\.instagram\.com\//.test(item.permalink)), `${data.instagram?.media?.length ?? 0} publicações`);
check('Insights de conteúdo', data.instagram?.media?.some((item) => item.views > 0 || item.reach > 0), 'views/alcance disponíveis');
check('Pixel identificado', Boolean(data.pixel?.id && data.pixel?.last_fired_time), `${data.pixel?.name ?? 'ausente'} · ${data.pixel?.last_fired_time ?? 'sem disparo'}`);

for (const item of checks) console.log(`${item.status.padEnd(4)} | ${item.name} | ${item.detail}`);
if (!data.pixel?.statsAvailable) console.log(`WARN | Eventos detalhados do Pixel | ${data.pixel?.statsError ?? 'permissão pendente'}`);

const failures = checks.filter((item) => item.status === 'FAIL');
if (failures.length) process.exitCode = 1;
