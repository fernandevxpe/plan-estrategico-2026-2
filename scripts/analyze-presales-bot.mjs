import { writeFile } from 'node:fs/promises';
import { loadEnv } from './lib/env.mjs';
import { ensureDataDirs, processedDirUrl } from './lib/paths.mjs';

loadEnv();
ensureDataDirs();

const baseUrl = process.env.N8N_SUPABASE_URL?.replace(/\/$/, '');
const token = process.env.N8N_SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!baseUrl || !token) throw new Error('Variáveis ausentes: N8N_SUPABASE_URL e/ou N8N_SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: token, Authorization: `Bearer ${token}` };
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const url = `${baseUrl}/rest/v1/n8n_chat_histories?select=id,session_id,message&order=id.asc&offset=${offset}&limit=1000`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Supabase n8n_chat_histories: HTTP ${response.status}`);
  const page = await response.json();
  rows.push(...page);
  if (page.length < 1000) break;
}

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const share = (part, total) => total ? part / total * 100 : null;
const percentile = (values, position) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * position)];
};

const objectiveRules = {
  'Carregamento/veículo elétrico': ['carro eletr', 'veiculo eletr', 'carregador', 'recarga', 'eletroposto', 'vaga verde', 'wallbox', 'laudo de carga'],
  'Laudo/inspeção elétrica': ['laudo', 'instalacao eletr', 'inspecao eletr', 'nr10', 'spda', 'vistoria', 'adequacao eletr'],
  'Orçamento/preço': ['orcamento', 'preco', 'valor', 'quanto custa', 'cotacao'],
  'Empresa/comercial': ['empresa', 'comercial', 'industria', 'loja', 'galpao', 'predio comercial'],
  'Obras/projetos': ['obra', 'projeto eletr', 'reforma', 'construcao'],
  'Energia/medição': ['energia solar', 'fotovolta', 'medidor', 'medicao', 'consumo de energia', 'conta de luz']
};
const objectionRules = {
  'Preço/orçamento': ['caro', 'preco', 'valor', 'custo', 'sem orcamento', 'orcamento apertado'],
  'Autoridade/assembleia': ['nao sou sindico', 'falar com o sindico', 'assembleia', 'administradora', 'aprova'],
  'Prazo/urgência': ['urgente', 'prazo', 'demora', 'quando', 'tempo'],
  'Só informação': ['so pesquisando', 'apenas informacao', 'queria saber', 'tirar uma duvida'],
  'Localidade/atendimento': ['atendem em', 'minha cidade', 'fora de recife', 'localizacao']
};
const profileRules = {
  'Síndico': ['sou sindico', 'sou sindica', 'sindico do', 'sindica do', 'sindico profissional'],
  'Morador/condômino': ['sou morador', 'sou moradora', 'morador do', 'condomino', 'meu condominio'],
  'Administradora': ['administradora', 'administro condominio', 'gestora de condominio'],
  'Técnico/engenheiro': ['engenheiro', 'eletricista', 'responsavel tecnico', 'tecnico em'],
  'Empresa/facilities': ['facilities', 'gerente predial', 'minha empresa', 'nossa empresa', 'empresa onde']
};

const sessions = new Map();
for (const row of rows) {
  const messages = sessions.get(String(row.session_id)) ?? [];
  messages.push({ type: row.message?.type ?? 'unknown', content: String(row.message?.content ?? '') });
  sessions.set(String(row.session_id), messages);
}

const countMatches = (rules) => Object.fromEntries(Object.keys(rules).map((key) => [key, 0]));
const objectives = countMatches(objectiveRules);
const objections = countMatches(objectionRules);
const profiles = { ...countMatches(profileRules), 'Não identificado': 0 };
const humanTurns = [];
let singleHumanTurn = 0;
let endsAwaitingAnswer = 0;
let oneTurnAwaitingAnswer = 0;
let scheduleSignal = 0;
let handoffSignal = 0;
let budgetSignal = 0;

for (const messages of sessions.values()) {
  const human = messages.filter((message) => message.type === 'human');
  const humanText = normalize(human.map((message) => message.content).join(' '));
  humanTurns.push(human.length);
  if (human.length === 1) singleHumanTurn += 1;

  for (const [label, terms] of Object.entries(objectiveRules)) if (terms.some((term) => humanText.includes(term))) objectives[label] += 1;
  for (const [label, terms] of Object.entries(objectionRules)) if (terms.some((term) => humanText.includes(term))) objections[label] += 1;
  let profileMatched = false;
  for (const [label, terms] of Object.entries(profileRules)) {
    if (terms.some((term) => humanText.includes(term))) {
      profiles[label] += 1;
      profileMatched = true;
    }
  }
  if (!profileMatched) profiles['Não identificado'] += 1;

  const lastBotText = normalize(messages.at(-1)?.content);
  const endedWithQuestion = messages.at(-1)?.content.includes('?') ?? false;
  if (endedWithQuestion) endsAwaitingAnswer += 1;
  if (human.length === 1 && endedWithQuestion) oneTurnAwaitingAnswer += 1;
  if (['agend', 'horario', 'disponibilidade', 'reuniao', 'visita tecnica'].some((term) => lastBotText.includes(term))) scheduleSignal += 1;
  if (['especialista', 'consultor', 'equipe comercial', 'encaminh', 'transfer'].some((term) => lastBotText.includes(term))) handoffSignal += 1;
  if (['orcamento', 'proposta', 'cotacao'].some((term) => lastBotText.includes(term))) budgetSignal += 1;
}

const totalSessions = sessions.size;
const list = (counts) => Object.entries(counts)
  .map(([label, count]) => ({ label, count, sessionsPct: share(count, totalSessions) }))
  .sort((a, b) => b.count - a.count);

const output = {
  generatedAt: new Date().toISOString(),
  source: 'Supabase n8n_chat_histories (somente agregados; conteúdo e session_id descartados)',
  scopeNote: 'Memória histórica do bot sem timestamp por mensagem e sem chave validada com o Chatwoot. Percentuais descrevem esta base separada e não devem ser somados às conversas operacionais.',
  methodNote: 'Classificação determinística por palavras-chave v1. Categorias podem se sobrepor e sinais de objeção não substituem auditoria amostral.',
  totals: {
    sessions: totalSessions,
    messages: rows.length,
    humanMessages: rows.filter((row) => row.message?.type === 'human').length,
    botMessages: rows.filter((row) => row.message?.type === 'ai').length
  },
  conversationShape: {
    medianHumanTurns: percentile(humanTurns, .5),
    p75HumanTurns: percentile(humanTurns, .75),
    singleHumanTurn,
    singleHumanTurnPct: share(singleHumanTurn, totalSessions),
    endsAwaitingAnswer,
    endsAwaitingAnswerPct: share(endsAwaitingAnswer, totalSessions),
    oneTurnAwaitingAnswer,
    oneTurnAwaitingAnswerPct: share(oneTurnAwaitingAnswer, totalSessions)
  },
  objectives: list(objectives),
  objections: list(objections),
  profiles: list(profiles),
  outcomeSignals: [
    { label: 'Sinal de handoff', count: handoffSignal, sessionsPct: share(handoffSignal, totalSessions) },
    { label: 'Sinal de agenda/visita', count: scheduleSignal, sessionsPct: share(scheduleSignal, totalSessions) },
    { label: 'Sinal de orçamento/proposta', count: budgetSignal, sessionsPct: share(budgetSignal, totalSessions) }
  ]
};

await writeFile(new URL('presales-bot.json', processedDirUrl), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: 'data/processed/presales-bot.json', totals: output.totals, conversationShape: output.conversationShape }, null, 2));
