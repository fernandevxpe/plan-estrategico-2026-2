import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const outDir = new URL('../data/raw/', import.meta.url);
await mkdir(outDir, { recursive: true });

const now = new Date().toISOString();

async function writeJson(name, data) {
  await writeFile(new URL(name, outDir), JSON.stringify({ syncedAt: now, data }, null, 2));
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} for ${url}\n${body.slice(0, 800)}`);
  }
  return response.json();
}

async function fetchPipedriveCollection(path, params = {}) {
  const token = process.env.PIPEDRIVE_API_KEY;
  if (!token) throw new Error('PIPEDRIVE_API_KEY ausente em .env.local');

  const base = new URL(`https://api.pipedrive.com/v1/${path}`);
  base.searchParams.set('api_token', token);
  base.searchParams.set('limit', '500');
  for (const [key, value] of Object.entries(params)) base.searchParams.set(key, value);

  const all = [];
  let start = 0;
  for (;;) {
    base.searchParams.set('start', String(start));
    const json = await getJson(base);
    all.push(...(json.data ?? []));
    const pagination = json.additional_data?.pagination;
    if (!pagination?.more_items_in_collection) break;
    start = pagination.next_start;
  }
  return all;
}

async function fetchPipedriveGoals() {
  const token = process.env.PIPEDRIVE_API_KEY;
  const url = new URL('https://api.pipedrive.com/v1/goals/find');
  url.searchParams.set('api_token', token);
  const json = await getJson(url);
  return json.data?.goals ?? [];
}

async function fetchGoalProgress(goalId, start, end) {
  const token = process.env.PIPEDRIVE_API_KEY;
  const url = new URL(`https://api.pipedrive.com/v1/goals/${goalId}/results`);
  url.searchParams.set('api_token', token);
  url.searchParams.set('period.start', start);
  url.searchParams.set('period.end', end);
  try {
    const json = await getJson(url);
    return json.data?.progress ?? null;
  } catch {
    return null;
  }
}

// Para cada meta, busca o realizado (progress) agregado do período completo e por
// cada intervalo de sazonalidade (mês/trimestre/semana), permitindo comparar meta x realizado.
async function enrichGoalsWithResults(goals) {
  const enriched = [];
  for (const goal of goals) {
    const start = goal.duration?.start;
    const end = goal.duration?.end;
    const totalProgress = start && end ? await fetchGoalProgress(goal.id, start, end) : null;

    const intervals = goal.seasonality?.intervals ?? [];
    const intervalResults = [];
    for (const interval of intervals) {
      const progress = await fetchGoalProgress(goal.id, interval.start, interval.end);
      intervalResults.push({ start: interval.start, end: interval.end, target: interval.target, progress });
    }

    enriched.push({ ...goal, totalProgress, intervalResults });
  }
  return enriched;
}

async function syncPipedrive() {
  const [deals, dealFields, orgFields, organizations, pipelines, stages, users, activities, goalsRaw] =
    await Promise.all([
      fetchPipedriveCollection('deals', { status: 'all_not_deleted' }),
      fetchPipedriveCollection('dealFields'),
      fetchPipedriveCollection('organizationFields'),
      fetchPipedriveCollection('organizations'),
      fetchPipedriveCollection('pipelines'),
      fetchPipedriveCollection('stages'),
      fetchPipedriveCollection('users'),
      fetchPipedriveCollection('activities'),
      fetchPipedriveGoals()
    ]);

  const goals = await enrichGoalsWithResults(goalsRaw);

  await writeJson('pipedrive-deals.json', deals);
  await writeJson('pipedrive-deal-fields.json', dealFields);
  await writeJson('pipedrive-organization-fields.json', orgFields);
  await writeJson('pipedrive-organizations.json', organizations);
  await writeJson('pipedrive-pipelines.json', pipelines);
  await writeJson('pipedrive-stages.json', stages);
  await writeJson('pipedrive-users.json', users);
  await writeJson('pipedrive-activities.json', activities);
  await writeJson('pipedrive-goals.json', goals);

  return {
    deals: deals.length,
    dealFields: dealFields.length,
    orgFields: orgFields.length,
    organizations: organizations.length,
    pipelines: pipelines.length,
    stages: stages.length,
    users: users.length,
    activities: activities.length,
    goals: goals.length
  };
}

async function clickup(path, params = {}) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error('CLICKUP_API_TOKEN ausente em .env.local');

  const url = new URL(`https://api.clickup.com/api/v2/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return getJson(url, { headers: { Authorization: token } });
}

async function fetchClickUpTasksForList(listId) {
  const tasks = [];
  let page = 0;
  for (;;) {
    const json = await clickup(`list/${listId}/task`, {
      archived: 'false',
      include_closed: 'true',
      subtasks: 'true',
      order_by: 'created',
      reverse: 'true',
      page: String(page)
    });
    tasks.push(...(json.tasks ?? []));
    if ((json.tasks ?? []).length === 0 || json.last_page) break;
    page += 1;
  }
  return tasks;
}

async function syncClickUp() {
  const teamsJson = await clickup('team');
  const teams = teamsJson.teams ?? [];
  const configuredTeamId = (process.env.CLICKUP_TEAM_ID || '').trim();
  const preferredTeam = teams.find((team) => /xpe consultoria/i.test(team.name));
  const teamId = configuredTeamId || preferredTeam?.id || teams[0]?.id;
  if (!teamId) throw new Error('Nenhum workspace ClickUp encontrado para o token informado.');

  const spaces = (await clickup(`team/${teamId}/space`, { archived: 'false' })).spaces ?? [];
  console.log(`ClickUp workspace ${teamId}: ${spaces.length} espaco(s).`);
  const folders = [];
  const lists = [];
  const folderlessLists = [];

  for (const space of spaces) {
    console.log(`- Espaco: ${space.name}`);
    const spaceFolders = (await clickup(`space/${space.id}/folder`, { archived: 'false' })).folders ?? [];
    folders.push(...spaceFolders.map((folder) => ({ ...folder, space_id: space.id, space_name: space.name })));

    const spaceLists = (await clickup(`space/${space.id}/list`, { archived: 'false' })).lists ?? [];
    folderlessLists.push(...spaceLists.map((list) => ({ ...list, space_id: space.id, space_name: space.name })));

    for (const folder of spaceFolders) {
      const folderLists = (await clickup(`folder/${folder.id}/list`, { archived: 'false' })).lists ?? [];
      lists.push(...folderLists.map((list) => ({
        ...list,
        folder_id: folder.id,
        folder_name: folder.name,
        space_id: space.id,
        space_name: space.name
      })));
    }
  }

  const allLists = [...lists, ...folderlessLists];
  const tasks = [];
  console.log(`ClickUp: ${allLists.length} lista(s) encontradas.`);
  for (const [index, list] of allLists.entries()) {
    const text = `${list.space_name} ${list.folder_name ?? ''} ${list.name}`;
    const looksRelevant = /projeto|implantacao|cliente|operacao|execucao|delivery|contrato|comercial|vendas|crm|xpe/i.test(text);
    if (!looksRelevant) continue;
    console.log(`  [${index + 1}/${allLists.length}] ${list.space_name} / ${list.folder_name ?? '-'} / ${list.name}`);
    try {
      const listTasks = await fetchClickUpTasksForList(list.id);
      tasks.push(...listTasks.map((task) => ({
        ...task,
        list_id: list.id,
        list_name: list.name,
        folder_id: list.folder_id ?? null,
        folder_name: list.folder_name ?? null,
        space_id: list.space_id,
        space_name: list.space_name
      })));
    } catch (error) {
      console.warn(`  Aviso: falha ao buscar tarefas da lista ${list.id}: ${error.message}`);
    }
  }

  await writeJson('clickup-teams.json', teams);
  await writeJson('clickup-spaces.json', spaces);
  await writeJson('clickup-folders.json', folders);
  await writeJson('clickup-lists.json', allLists);
  await writeJson('clickup-tasks.json', tasks);

  return { teams: teams.length, spaces: spaces.length, folders: folders.length, lists: allLists.length, tasks: tasks.length, teamId };
}

const scope = process.env.SYNC_SCOPE || 'all';
const result = {};
if (scope === 'all' || scope === 'pipedrive') result.pipedrive = await syncPipedrive();
if (scope === 'all' || scope === 'clickup') result.clickup = await syncClickUp();

await writeJson('sync-summary.json', result);
console.log(JSON.stringify(result, null, 2));
