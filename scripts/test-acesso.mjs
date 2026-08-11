// Prova a separação de acesso contra o servidor de verdade.
//
// POR QUE POR HTTP E NÃO POR UNIDADE
//
// A regra de acesso mora em três lugares que precisam concordar: o middleware
// (que bloqueia), `lib/auth/perfis.ts` (que define o prefixo) e o menu (que
// esconde o link). Testar a função isolada provaria que a definição está certa
// e não que ela está LIGADA — e "a regra existe mas o middleware não a chama"
// é exatamente a forma que essa falha costuma ter.
//
// Aqui o teste fala com o servidor pela rede, como o navegador de quem está no
// time de vendas. Se passar, o caminho inteiro está ligado.
//
// O QUE ELE AFIRMA
//
//   1. sem credencial          → 401 em tudo
//   2. credencial errada       → 401 (e não 404, que diria "usuário existe")
//   3. perfil comum + /        → 200
//   4. perfil comum + financeiro → 404 (não 403: 403 confirmaria a existência)
//   5. perfil comum + API financeira → 404, inclusive no PATCH que grava
//   6. perfil admin + tudo     → 200
//   7. o menu do comum não cita "Financeiro"
//
// O item 5 é o que mais importa. Bloquear a página e esquecer a API deixa o
// ledger inteiro a um `curl` de distância de quem tem credencial válida.
//
// Uso:
//   node scripts/test-acesso.mjs                          # http://localhost:3000
//   BASE=https://... node scripts/test-acesso.mjs
//
// Credenciais: XPE_TEST_COMUM="user:senha" e XPE_TEST_ADMIN="user:senha".

const BASE = process.env.BASE ?? 'http://localhost:3000';
const COMUM = process.env.XPE_TEST_COMUM ?? '';
const ADMIN = process.env.XPE_TEST_ADMIN ?? '';

if (!COMUM || !ADMIN) {
  console.error('defina XPE_TEST_COMUM="usuario:senha" e XPE_TEST_ADMIN="usuario:senha"');
  process.exit(2);
}

const basico = (par) => `Basic ${Buffer.from(par).toString('base64')}`;

let passou = 0;
let falhou = 0;

async function afirma(rotulo, esperado, real, extra = '') {
  const ok = esperado === real;
  if (ok) passou += 1; else falhou += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${rotulo.padEnd(58)} ${String(real).padStart(3)} (esperado ${esperado})${extra}`);
}

async function pega(caminho, credencial, metodo = 'GET') {
  const headers = credencial ? { authorization: basico(credencial) } : {};
  if (metodo === 'PATCH') headers['content-type'] = 'application/json';
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers,
    redirect: 'manual',
    body: metodo === 'PATCH' ? JSON.stringify({ ano: 2026, mes: 1, linha: 'obras', valorCents: 1 }) : undefined
  });
  return r;
}

console.log(`\nSeparação de acesso — ${BASE}\n`);

console.log('sem credencial:');
for (const rota of ['/', '/comercial', '/financeiro', '/financeiro/modelo', '/api/financeiro/modelo']) {
  await afirma(`401 em ${rota}`, 401, (await pega(rota, null)).status);
}

console.log('\ncredencial inválida:');
await afirma('401 com senha errada', 401, (await pega('/', 'xpe:senha-errada')).status);
await afirma('401 com usuário inventado', 401, (await pega('/', 'ninguem:seja-o-que-for')).status);

console.log('\nperfil COMUM (marketing e vendas):');
for (const rota of ['/', '/comercial', '/planejamento', '/metas', '/areas', '/gestao-xpe']) {
  await afirma(`200 em ${rota}`, 200, (await pega(rota, COMUM)).status);
}
for (const rota of ['/financeiro', '/financeiro/modelo', '/financeiro/pessoas', '/financeiro/lancamentos']) {
  await afirma(`404 em ${rota}`, 404, (await pega(rota, COMUM)).status);
}
await afirma('404 na API financeira (GET)', 404, (await pega('/api/financeiro/lancamentos', COMUM)).status);
await afirma('404 na API financeira (PATCH grava)', 404, (await pega('/api/financeiro/modelo', COMUM, 'PATCH')).status);

// O menu não pode citar o que a pessoa não alcança.
const html = await (await pega('/', COMUM)).text();
const citaFinanceiro = /href="\/financeiro/.test(html);
await afirma('menu do comum não tem link para /financeiro', false, citaFinanceiro);

console.log('\nperfil ADMIN:');
for (const rota of ['/', '/comercial', '/financeiro', '/financeiro/modelo', '/financeiro/pessoas']) {
  await afirma(`200 em ${rota}`, 200, (await pega(rota, ADMIN)).status);
}
const htmlAdmin = await (await pega('/', ADMIN)).text();
await afirma('menu do admin TEM link para /financeiro', true, /href="\/financeiro/.test(htmlAdmin));

console.log(`\n  ${passou} afirmação(ões) passam · ${falhou} falham\n`);
process.exit(falhou ? 1 : 0);
