// data/raw/ não vai para o git (são dezenas de MB), então em produção a Vercel
// nunca vê esses arquivos. Este script recorta só o que a Gestão XPE lê em
// runtime e grava em data/processed/, que é versionado e vai junto no deploy.
import { readFile, writeFile } from 'node:fs/promises';

const rawDir = new URL('../data/raw/', import.meta.url);
const outDir = new URL('../data/processed/', import.meta.url);

async function readRaw(name) {
  try {
    return JSON.parse(await readFile(new URL(name, rawDir), 'utf8'));
  } catch (error) {
    throw new Error(`Não consegui ler data/raw/${name}: ${error.message}. Rode "npm run sync" antes.`);
  }
}

const dealsPayload = await readRaw('pipedrive-deals.json');
const fieldsPayload = await readRaw('pipedrive-deal-fields.json');
const activitiesPayload = await readRaw('pipedrive-activities.json');

const deals = dealsPayload.data ?? [];
const fields = fieldsPayload.data ?? [];
const activities = activitiesPayload.data ?? [];

const optionsOf = (key) => {
  const field = fields.find((f) => f.key === key);
  return Object.fromEntries((field?.options ?? []).map((o) => [String(o.id), o.label]));
};

// Só os campos que lib/gestao-xpe consome — o resto é peso morto no bundle.
const dealSlice = deals.map((deal) => ({
  id: deal.id,
  pipeline_id: deal.pipeline_id ?? null,
  stage_id: deal.stage_id ?? null,
  status: deal.status ?? '',
  value: Number(deal.value) || 0,
  add_time: deal.add_time ?? null,
  won_time: deal.won_time ?? null,
  lost_time: deal.lost_time ?? null,
  stage_change_time: deal.stage_change_time ?? null,
  channel: deal.channel ?? null,
  label: deal.label ?? null
}));

const activitySlice = activities.map((activity) => ({
  id: activity.id,
  type: activity.type,
  subject: activity.subject ?? '',
  done: Boolean(activity.done),
  deal_id: activity.deal_id ?? null,
  add_time: activity.add_time ?? '',
  marked_as_done_time: activity.marked_as_done_time ?? null,
  due_date: activity.due_date ?? null,
  due_time: activity.due_time ?? null,
  user_id: activity.user_id ?? null
}));

const snapshot = {
  syncedAt: dealsPayload.syncedAt ?? null,
  builtAt: new Date().toISOString(),
  options: {
    channel: optionsOf('channel'),
    label: optionsOf('label')
  },
  deals: dealSlice,
  activities: activitySlice
};

await writeFile(new URL('crm-snapshot.json', outDir), JSON.stringify(snapshot));

const activityUsers = new Set(activitySlice.map((a) => a.user_id)).size;
console.log(
  `Snapshot CRM gerado: ${dealSlice.length} negócios, ${activitySlice.length} atividades ` +
    `(${activityUsers} usuário${activityUsers === 1 ? '' : 's'}) → data/processed/crm-snapshot.json`
);
if (activityUsers <= 1) {
  console.warn('  ATENÇÃO: atividades de um único usuário. O sync precisa de user_id=0.');
}
