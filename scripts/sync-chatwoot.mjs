import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from './lib/env.mjs';
import { rawDirUrl, processedDirUrl, ensureDataDirs } from './lib/paths.mjs';
ensureDataDirs();

loadEnv();

const baseUrl = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
const token = process.env.CHATWOOT_API_ACCESS_TOKEN?.trim();
const accountId = process.env.CHATWOOT_ACCOUNT_ID?.trim() || '1';
if (!baseUrl || !token) throw new Error('Variáveis Chatwoot ausentes: CHATWOOT_BASE_URL e/ou CHATWOOT_API_ACCESS_TOKEN');

const rawDir = rawDirUrl;
const processedCache = new URL('presales.json', processedDirUrl);
await mkdir(rawDir, { recursive: true });

async function api(path, params = {}) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value));
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { headers: { api_access_token: token, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 600 * (2 ** (attempt - 1))));
      continue;
    }
    throw new Error(`Chatwoot ${path}: HTTP ${response.status} ${payload.error || payload.message || ''}`.trim());
  }
}

async function loadCachedClassifications() {
  try {
    const cached = JSON.parse(await readFile(processedCache, 'utf8'));
    return new Map((cached.conversations ?? []).map((row) => [String(row.id), { initiatedBy: row.initiatedBy, firstMessageAt: row.firstMessageAt }]));
  } catch {
    return new Map();
  }
}

const profile = await api('/api/v1/profile');
const account = (profile.accounts ?? []).find((item) => String(item.id) === accountId);
if (!account) throw new Error(`Conta Chatwoot ${accountId} não acessível pelo token`);
const inboxResponse = await api(`/api/v1/accounts/${accountId}/inboxes`);
const inboxes = (inboxResponse.payload ?? inboxResponse).map((item) => ({ id: item.id, name: item.name, channelType: item.channel_type }));

console.log('Chatwoot: coletando conversas...');
const conversations = [];
for (let page = 1; page <= 500; page += 1) {
  const response = await api(`/api/v1/accounts/${accountId}/conversations`, { status: 'all', assignee_type: 'all', page });
  const rows = response.data?.payload ?? response.payload ?? [];
  conversations.push(...rows);
  if (rows.length < 25) break;
  if (page === 500) throw new Error('Limite seguro de paginação do Chatwoot atingido');
}

const unique = [...new Map(conversations.map((item) => [String(item.id), item])).values()];
const cached = await loadCachedClassifications();
const missing = unique.filter((item) => !cached.has(String(item.id)));
console.log(`Chatwoot: ${unique.length} conversas · ${missing.length} novas classificações`);

let cursor = 0;
const workers = Array.from({ length: 4 }, async () => {
  for (;;) {
    const index = cursor;
    cursor += 1;
    if (index >= missing.length) return;
    const conversation = missing[index];
    const response = await api(`/api/v1/accounts/${accountId}/conversations/${conversation.id}/messages`, { after: 0 });
    const firstPublic = (response.payload ?? [])
      .filter((message) => !message.private && [0, 1, 3].includes(Number(message.message_type)))
      .sort((a, b) => Number(a.created_at) - Number(b.created_at))[0];
    cached.set(String(conversation.id), {
      initiatedBy: firstPublic ? (Number(firstPublic.message_type) === 0 ? 'contact' : 'company') : 'unknown',
      firstMessageAt: firstPublic?.created_at ? new Date(Number(firstPublic.created_at) * 1000).toISOString() : null
    });
    if ((index + 1) % 50 === 0) console.log(`  Chatwoot ${index + 1}/${missing.length}`);
    await new Promise((resolve) => setTimeout(resolve, 45));
  }
});
await Promise.all(workers);

const sanitized = unique.map((item) => {
  const classification = cached.get(String(item.id)) ?? { initiatedBy: 'unknown', firstMessageAt: null };
  return {
    id: item.id,
    inboxId: item.inbox_id,
    createdAt: new Date(Number(item.created_at) * 1000).toISOString(),
    updatedAt: new Date(Number(item.updated_at) * 1000).toISOString(),
    firstReplyAt: item.first_reply_created_at ? new Date(Number(item.first_reply_created_at) * 1000).toISOString() : null,
    status: item.status,
    initiatedBy: classification.initiatedBy,
    firstMessageAt: classification.firstMessageAt
  };
}).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const output = {
  syncedAt: new Date().toISOString(),
  source: 'Chatwoot Application API',
  account: { id: account.id, name: account.name },
  inboxes,
  conversations: sanitized
};
await writeFile(new URL('chatwoot-conversations.json', rawDir), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ account: output.account.name, inboxes: inboxes.length, conversations: sanitized.length, contactInitiated: sanitized.filter((row) => row.initiatedBy === 'contact').length, companyInitiated: sanitized.filter((row) => row.initiatedBy === 'company').length, unknown: sanitized.filter((row) => row.initiatedBy === 'unknown').length }, null, 2));
