import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from './lib/env.mjs';
import { rawDirUrl, ensureDataDirs } from './lib/paths.mjs';
ensureDataDirs();

loadEnv();

const outDir = rawDirUrl;
await mkdir(outDir, { recursive: true });

const now = new Date().toISOString();
const today = now.slice(0, 10);

async function writeJson(name, data) {
  await writeFile(new URL(name, outDir), JSON.stringify({ syncedAt: now, data }, null, 2));
}

async function readRawData(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(name, outDir), 'utf8')).data ?? fallback;
  } catch {
    return fallback;
  }
}

/** Sem isto uma conexão pendurada trava o sync para sempre — foi o que aconteceu
 *  na primeira execução no Railway: 20+ minutos parados numa requisição sem
 *  resposta, com CPU zerada e nenhum erro. */
const REQUEST_TIMEOUT_MS = Number(process.env.SYNC_REQUEST_TIMEOUT_MS ?? 60_000);
/** Teto para o retry-after da API — ver o comentário no tratamento do 429. */
const MAX_RETRY_DELAY_MS = Number(process.env.SYNC_MAX_RETRY_DELAY_MS ?? 30_000);

async function getJson(url, options = {}) {
  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (response.ok) return response.json();

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${response.status} ${response.statusText} for ${url}\n${body.slice(0, 800)}`);
      }
      // O Pipedrive responde 429 com um retry-after que pode passar de uma hora.
      // Obedecer ao pé da letra fazia o sync "travar": processo vivo, CPU zerada,
      // nenhum log, por tempo indefinido. Melhor falhar rápido e tentar de novo
      // na próxima rodada do que segurar o pipeline inteiro.
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const suggested = retryAfter > 0 ? retryAfter * 1_000 : 500 * (2 ** (attempt - 1));
      const delayMs = Math.min(suggested, MAX_RETRY_DELAY_MS);
      if (response.status === 429) {
        console.warn(
          `  429 do Pipedrive (tentativa ${attempt}/${maxAttempts}), aguardando ${Math.round(delayMs / 1000)}s`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      // Timeout e queda de rede são transitórios; erro de status já saiu acima.
      const transient = error.name === 'TimeoutError' || error.name === 'AbortError' || error.cause;
      if (!transient || attempt === maxAttempts) throw error;
      lastError = error;
      console.warn(`  tentativa ${attempt}/${maxAttempts} falhou (${error.name}), repetindo...`);
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new Error(`Falha inesperada ao consultar ${url}`);
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
  // Sem assignee.type a API devolve só metas do dono do token.
  // Buscamos company/team/person e deduplicamos por id.
  const assigneeTypes = ['company', 'team', 'person'];
  const byId = new Map();
  for (const assigneeType of assigneeTypes) {
    const url = new URL('https://api.pipedrive.com/v1/goals/find');
    url.searchParams.set('api_token', token);
    url.searchParams.set('is_active', 'true');
    url.searchParams.set('assignee.type', assigneeType);
    try {
      const json = await getJson(url);
      for (const goal of json.data?.goals ?? []) {
        if (!byId.has(goal.id)) byId.set(goal.id, goal);
      }
    } catch (error) {
      console.warn(`goals/find assignee.type=${assigneeType} falhou:`, error.message);
    }
  }
  if (byId.size === 0) {
    const url = new URL('https://api.pipedrive.com/v1/goals/find');
    url.searchParams.set('api_token', token);
    const json = await getJson(url);
    for (const goal of json.data?.goals ?? []) byId.set(goal.id, goal);
  }
  return [...byId.values()];
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
  console.log(`Enriquecendo ${goals.length} meta(s) com o realizado...`);
  for (const goal of goals) {
    const start = goal.duration?.start;
    const end = goal.duration?.end;
    const totalProgress = start && end ? await fetchGoalProgress(goal.id, start, end) : null;

    const intervals = goal.seasonality?.intervals ?? [];
    const intervalResults = [];
    let skipped = 0;
    for (const interval of intervals) {
      // Intervalo que ainda não começou sempre devolve zero. A meta semanal tem
      // 52 deles no ano — buscar os futuros gastava ~40 requisições por rodada
      // de uma cota diária que é limitada.
      if (interval.start > today) {
        intervalResults.push({
          start: interval.start,
          end: interval.end,
          target: interval.target,
          progress: 0
        });
        skipped += 1;
        continue;
      }
      const progress = await fetchGoalProgress(goal.id, interval.start, interval.end);
      intervalResults.push({ start: interval.start, end: interval.end, target: interval.target, progress });
    }

    enriched.push({ ...goal, totalProgress, intervalResults });
    console.log(
      `  meta "${goal.title}" (${intervalResults.length} intervalos, ${skipped} futuros sem consulta)`
    );
  }
  return enriched;
}

async function syncPipedrive() {
  console.log('Pipedrive: baixando coleções...');
  const [deals, dealFields, orgFields, organizations, pipelines, stages, users, activities, activityTypes, products, goalsRaw] =
    await Promise.all([
      fetchPipedriveCollection('deals', { status: 'all_not_deleted' }),
      fetchPipedriveCollection('dealFields'),
      fetchPipedriveCollection('organizationFields'),
      fetchPipedriveCollection('organizations'),
      fetchPipedriveCollection('pipelines'),
      fetchPipedriveCollection('stages'),
      fetchPipedriveCollection('users'),
      // user_id=0 é obrigatório: sem ele a API devolve só a agenda do dono do token
      // (ficavam de fora ~77% das atividades, incluindo todas as reuniões do comercial).
      fetchPipedriveCollection('activities', { user_id: '0' }),
      fetchPipedriveCollection('activityTypes'),
      fetchPipedriveCollection('products'),
      fetchPipedriveGoals()
    ]);

  console.log(`Pipedrive: ${deals.length} negócios, ${activities.length} atividades, ${organizations.length} organizações.`);

  const goals = await enrichGoalsWithResults(goalsRaw);

  await writeJson('pipedrive-deals.json', deals);
  await writeJson('pipedrive-deal-fields.json', dealFields);
  await writeJson('pipedrive-organization-fields.json', orgFields);
  await writeJson('pipedrive-organizations.json', organizations);
  await writeJson('pipedrive-pipelines.json', pipelines);
  await writeJson('pipedrive-stages.json', stages);
  await writeJson('pipedrive-users.json', users);
  await writeJson('pipedrive-activities.json', activities);
  await writeJson('pipedrive-activity-types.json', activityTypes);
  await writeJson('pipedrive-products.json', products);
  await writeJson('pipedrive-goals.json', goals);

  // Produtos reais são buscados por negócio. Mantemos apenas os negócios que o
  // Pipedrive sinaliza com itens para evitar centenas de chamadas desnecessárias.
  const dealProducts = {};
  const dealsWithProducts = deals.filter((deal) => Number(deal.products_count ?? 0) > 0);
  if (dealsWithProducts.length) {
    console.log(`Buscando produtos de ${dealsWithProducts.length} negócio(s)...`);
    for (const deal of dealsWithProducts) {
      const token = process.env.PIPEDRIVE_API_KEY;
      const url = new URL(`https://api.pipedrive.com/v1/deals/${deal.id}/products`);
      url.searchParams.set('api_token', token);
      try {
        const json = await getJson(url);
        dealProducts[String(deal.id)] = json.data ?? [];
      } catch (error) {
        console.warn(`  Aviso: produtos do negócio ${deal.id} não foram carregados: ${error.message}`);
        dealProducts[String(deal.id)] = [];
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  await writeJson('pipedrive-deal-products.json', dealProducts);

  const funnelPipelineIds = [11, 14];
  const funnelDeals = deals.filter((deal) => funnelPipelineIds.includes(deal.pipeline_id));
  const previousFlows = await readRawData('pipedrive-deal-flows.json', { flows: {}, fetchedAt: {} });
  let dealFlows = { ...(previousFlows.flows ?? {}) };
  const flowFetchedAt = { ...(previousFlows.fetchedAt ?? {}) };

  if (process.env.SKIP_DEAL_FLOWS === '1') {
    console.log('SKIP_DEAL_FLOWS=1 — histórico de etapas preservado da última coleta.');
  } else {
    // O histórico de um negócio só muda quando o negócio muda. Rebuscar os 800+
    // toda madrugada era a maior fonte de pressão sobre o limite da API — e foi
    // o que estourou a cota na primeira execução em produção.
    // Comparar como texto não serve: o Pipedrive devolve "2026-08-03 05:00:00"
    // e o carimbo local é ISO com "T". Para a mesma data o espaço ordena antes
    // do "T", então uma alteração do próprio dia passaria despercebida.
    const toEpoch = (value) => {
      if (!value) return null;
      const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
      const time = new Date(normalized).getTime();
      return Number.isNaN(time) ? null : time;
    };

    const stale = funnelDeals.filter((deal) => {
      const fetched = toEpoch(flowFetchedAt[String(deal.id)]);
      if (fetched == null) return true;
      const updated = toEpoch(deal.update_time ?? deal.add_time);
      return updated == null || updated >= fetched;
    });

    console.log(
      `Flow: ${stale.length} de ${funnelDeals.length} negócios mudaram desde a última coleta.`
    );

    let index = 0;
    for (const deal of stale) {
      index += 1;
      if (index % 25 === 0 || index === stale.length) {
        console.log(`  flow ${index}/${stale.length}`);
      }
      const token = process.env.PIPEDRIVE_API_KEY;
      const url = new URL(`https://api.pipedrive.com/v1/deals/${deal.id}/flow`);
      url.searchParams.set('api_token', token);
      try {
        const json = await getJson(url);
        dealFlows[String(deal.id)] = json.data ?? [];
        flowFetchedAt[String(deal.id)] = now;
      } catch (error) {
        console.warn(`  flow do negócio ${deal.id} falhou: ${error.message}`);
        // Sem marcar fetchedAt: a próxima rodada tenta de novo em vez de
        // registrar um histórico vazio como se fosse verdade.
        if (!(String(deal.id) in dealFlows)) dealFlows[String(deal.id)] = [];
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    // Negócios que saíram dos funis de interesse não precisam ocupar espaço.
    const ativos = new Set(funnelDeals.map((deal) => String(deal.id)));
    for (const id of Object.keys(dealFlows)) {
      if (!ativos.has(id)) {
        delete dealFlows[id];
        delete flowFetchedAt[id];
      }
    }
  }
  await writeJson('pipedrive-deal-flows.json', {
    pipelineIds: funnelPipelineIds,
    flows: dealFlows,
    fetchedAt: flowFetchedAt
  });

  return {
    deals: deals.length,
    dealFields: dealFields.length,
    orgFields: orgFields.length,
    organizations: organizations.length,
    pipelines: pipelines.length,
    stages: stages.length,
    users: users.length,
    activities: activities.length,
    activityTypes: activityTypes.length,
    products: products.length,
    goals: goals.length,
    dealProducts: Object.keys(dealProducts).length,
    dealFlows: Object.keys(dealFlows).length
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
