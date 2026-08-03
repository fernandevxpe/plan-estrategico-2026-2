// Trava a inteligência comercial contra a análise que o diretor comercial
// apresentou em 31/07/2026. Se o pipeline voltar a divergir, o build falha.
import { readFile } from 'node:fs/promises';

const intel = JSON.parse(
  await readFile(new URL('../data/processed/commercial-intel.json', import.meta.url), 'utf8')
);
const snapshot = JSON.parse(
  await readFile(new URL('../data/processed/crm-snapshot.json', import.meta.url), 'utf8')
);

const consultoria = intel.scopes.find((scope) => scope.id === 'consultoria');
const failures = [];
const notes = [];

function check(label, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  const line = `${ok ? 'OK  ' : 'FALHA'} ${label}: apurado ${round(actual)} | diretor ${expected} (tolerância ±${tolerance})`;
  if (ok) notes.push(line);
  else failures.push(line);
  return ok;
}
const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

function sharePct(rows, key, basis = 'dealsPct') {
  return rows.find((row) => row.key === key)?.[basis] ?? 0;
}

console.log('=== Validação: análise do diretor comercial (31/07/2026) ===\n');

// --- Contagens absolutas: têm que bater na unha -----------------------------
console.log('# Volumes');
check('Consultoria — negócios ganhos em 2026', consultoria.year.won.deals, 102, 0);
check('Consultoria — negócios perdidos em 2026', consultoria.year.lost.deals, 202, 0);

// --- Ganhos por canal -------------------------------------------------------
console.log('\n# Ganhos por canal de origem');
const wonExpected = {
  'Pós-Venda base XPE': 24,
  'Tráfego Pago': 20,
  'Sind. Profissional Base': 15,
  'Indicação de Cliente XPE': 12,
  'Administradora Cond.': 9,
  'Sucesso do Cliente': 6
};
for (const [channel, expected] of Object.entries(wonExpected)) {
  check(`ganhos · ${channel}`, sharePct(consultoria.year.won.byChannel, channel), expected, 1.5);
}
check(
  'ganhos · participação do relacionamento',
  consultoria.year.won.relationshipShare.dealsPct,
  76,
  2
);

// --- Perdas por motivo ------------------------------------------------------
console.log('\n# Perdas por motivo');
const lostExpected = {
  'Caiu de Prioridade': 40,
  'Tentativas Esgotadas (Final Cadência)': 23,
  'Barrado em Assembleia': 12,
  Concorrente: 12,
  'Fora do ICP': 8
};
for (const [reason, expected] of Object.entries(lostExpected)) {
  check(`perdas · ${reason}`, sharePct(consultoria.year.lost.byReason, reason), expected, 1.5);
}

// --- Perdas por canal -------------------------------------------------------
console.log('\n# Perdas por canal de origem');
check('perdas · Tráfego Pago', sharePct(consultoria.year.lost.byChannel, 'Tráfego Pago'), 48, 1.5);
check('perdas · Administradora Cond.', sharePct(consultoria.year.lost.byChannel, 'Administradora Cond.'), 14, 1.5);
check('perdas · Sucesso do Cliente', sharePct(consultoria.year.lost.byChannel, 'Sucesso do Cliente'), 5, 1.5);

// --- Potencial em aberto por canal (base: valor em R$) ----------------------
console.log('\n# Potencial em aberto por canal (base R$)');
const openExpected = {
  'Tráfego Pago': 35,
  'Sind. Profissional Base': 17.44,
  'Administradora Cond.': 15.6,
  'Sucesso do Cliente': 14.9,
  'Pós-Venda base XPE': 4.4
};
for (const [channel, expected] of Object.entries(openExpected)) {
  check(`aberto · ${channel}`, sharePct(consultoria.openPipeline.byChannel, channel, 'valuePct'), expected, 4);
}

// --- Ciclo de vendas --------------------------------------------------------
console.log('\n# Ciclo de vendas');
check('ciclo mediano (dias)', consultoria.year.cycle.medianDays, 41, 4);

// --- Reuniões por semana ----------------------------------------------------
console.log('\n# Ritmo de reuniões');
const julho = consultoria.months.find((row) => row.month === '2026-07');
if (julho) {
  check('reuniões/semana em jul/2026', julho.activities.meetingsPerWeek, 17, 2.5);
} else {
  failures.push('FALHA reuniões: mês 2026-07 ausente na série');
}

// --- Integridade do sync de atividades --------------------------------------
console.log('\n# Integridade do sync');
const activityUsers = new Set(snapshot.activities.map((a) => a.user_id)).size;
if (activityUsers <= 1) {
  failures.push(
    `FALHA atividades: só ${activityUsers} usuário na base. O sync do Pipedrive precisa de user_id=0.`
  );
} else {
  notes.push(`OK   atividades de ${activityUsers} usuários (${snapshot.activities.length} registros)`);
}

const meetings = snapshot.activities.filter((a) => a.type === 'meeting').length;
if (meetings < 100) {
  failures.push(`FALHA reuniões: só ${meetings} atividades do tipo Reunião em toda a base.`);
} else {
  notes.push(`OK   ${meetings} atividades do tipo Reunião na base`);
}

for (const line of notes) console.log('  ' + line);
if (failures.length) {
  console.error('\n--- DIVERGÊNCIAS ---');
  for (const line of failures) console.error('  ' + line);
  console.error(`\n${failures.length} verificação(ões) fora da tolerância.`);
  process.exit(1);
}
console.log(`\nTodas as ${notes.length} verificações passaram.`);
