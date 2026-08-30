// O perfil comum alcança dado financeiro? — a prova.
//
// ===========================================================================
// POR QUE ESTE TESTE EXISTE
// ===========================================================================
// Até a 0105, a separação de perfis era fácil de manter porque o time só LIA
// telas de comercial. Agora ele tem rota de escrita, sessão, caixa de avisos e
// uma tela que o admin também usa. A superfície cresceu, e a regra que a
// protege ("negar o prefixo /financeiro") é frágil de um jeito específico:
//
//   uma rota nova FORA daquele prefixo que leia dado financeiro passa a
//   responder para todo mundo, e nada fica vermelho.
//
// Este arquivo transforma essa frase em verificação. Ele não sobe servidor: as
// três coisas que precisam ser verdade são estáticas ou de banco, e teste que
// exige `next start` não roda no meio de uma sessão.
//
//   1. TOPOLOGIA — toda rota/página que importa uma leitura financeira está sob
//      um prefixo só-admin, salvo a lista de exceções DECLARADA aqui, que é
//      curta e tem justificativa por item.
//   2. SUPERFÍCIE — os módulos que o perfil comum alcança não mencionam tabela
//      nem view de saldo, DRE, folha, margem ou tributo.
//   3. DADO — nenhuma notificação alcançável pelo perfil comum carrega escopo
//      de gestão ou link para o financeiro (roda contra o banco quando a 0105
//      estiver aplicada; sem ela, informa e não falha).
//
//   node scripts/test-perfil-guard.mjs
//
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/env.mjs';
loadEnv();

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

let falhas = 0;
const ok = (t, extra = '') => console.log(`  ✓ ${t}${extra ? ` — ${extra}` : ''}`);
const nok = (t, extra = '') => { falhas += 1; console.log(`  ✗ ${t}${extra ? ` — ${extra}` : ''}`); };
const afirma = (c, t, extra = '') => (c ? ok(t, extra) : nok(t, extra));

// ---------------------------------------------------------------------------
// A regra de acesso, lida da FONTE e não reescrita
// ---------------------------------------------------------------------------
// Copiar a lista de prefixos para cá criaria a segunda definição de "só admin"
// que lib/auth/perfis.ts existe para evitar — e ela divergiria no primeiro
// prefixo novo, com o teste passando.
const perfisTs = await readFile(path.join(RAIZ, 'lib/auth/perfis.ts'), 'utf8');
const listaSoAdmin = perfisTs.match(/const SO_ADMIN = \[([^\]]+)\]/)?.[1];
if (!listaSoAdmin) {
  console.error('não consegui ler SO_ADMIN de lib/auth/perfis.ts — o teste não pode afirmar nada');
  process.exit(1);
}
const SO_ADMIN = [...listaSoAdmin.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const exigeAdmin = (p) => SO_ADMIN.some((x) => p === x || p.startsWith(`${x}/`));

console.log(`\n=== 0. A REGRA, LIDA DA FONTE ===`);
console.log(`  SO_ADMIN = ${SO_ADMIN.join(', ')}`);
afirma(SO_ADMIN.includes('/financeiro') && SO_ADMIN.includes('/api/financeiro'),
  'a página e a API do financeiro estão as duas na lista',
  'bloquear só a página deixaria os números a um curl de distância');

// ---------------------------------------------------------------------------
// 1. Topologia
// ---------------------------------------------------------------------------
/**
 * Módulos de leitura financeira. Importar um destes é a assinatura de "esta
 * rota devolve dinheiro da empresa".
 *
 * `time.ts` e `notificacoes.ts` NÃO estão aqui: eles são a superfície do time,
 * e o que os protege é a verificação 2 (o que eles podem tocar), não o prefixo.
 */
const MODULOS_FINANCEIROS = [
  'lib/financeiro/queries', 'lib/financeiro/painel', 'lib/financeiro/dre',
  'lib/financeiro/contas', 'lib/financeiro/indicadores', 'lib/financeiro/forecast',
  'lib/financeiro/pessoas', 'lib/financeiro/reembolsos', 'lib/financeiro/receitas',
  'lib/financeiro/planejamento', 'lib/financeiro/modelo', 'lib/financeiro/revisao',
  'lib/financeiro/regras', 'lib/financeiro/qualificacao', 'lib/financeiro/qualificar',
  'lib/financeiro/importacao', 'lib/financeiro/categorizacao', 'lib/financeiro/identificacao',
  'lib/financeiro/custos', 'lib/financeiro/contratos', 'lib/financeiro/time-admin'
];

/**
 * As exceções, DECLARADAS uma a uma com o motivo. Uma exceção sem justificativa
 * escrita é uma exceção que ninguém consegue revisar depois.
 */
const EXCECOES = new Map([
  ['/api/notificacoes', 'o time também é notificado; o corte é por perfil e por pessoa dentro da rota, e o CHECK da 0105 recusa aviso de gestão fora do admin'],
  ['/api/notificacoes/[id]', 'idem — e o UPDATE repete a cláusula de alcance']
]);

async function rotas(dir, prefixo = '') {
  const achadas = [];
  let entradas;
  try {
    entradas = await readdir(dir, { withFileTypes: true });
  } catch {
    return achadas;
  }
  for (const e of entradas) {
    if (e.name === 'node_modules') continue;
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      achadas.push(...(await rotas(completo, `${prefixo}/${e.name}`)));
    } else if (e.name === 'route.ts' || e.name === 'page.tsx' || e.name === 'layout.tsx') {
      achadas.push({ arquivo: completo, url: prefixo || '/', tipo: e.name });
    }
  }
  return achadas;
}

console.log('\n=== 1. TOPOLOGIA: quem importa dinheiro está sob prefixo de admin ===');
const todas = await rotas(path.join(RAIZ, 'app'));
const abertas = [];
for (const r of todas) {
  const fonte = await readFile(r.arquivo, 'utf8');
  const importa = MODULOS_FINANCEIROS.filter((m) => fonte.includes(`@/${m}`));
  if (importa.length === 0) continue;
  if (exigeAdmin(r.url)) continue;
  if (EXCECOES.has(r.url)) continue;
  abertas.push({ ...r, importa });
}
console.log(`  ${todas.length} rotas/páginas varridas`);
for (const a of abertas) nok(`${a.url} lê ${a.importa.join(', ')} e NÃO está sob prefixo de admin`);
afirma(abertas.length === 0, 'nenhuma rota fora do prefixo lê módulo financeiro');
for (const [url, motivo] of EXCECOES) console.log(`    exceção declarada: ${url} — ${motivo}`);

// ---------------------------------------------------------------------------
// 2. Superfície
// ---------------------------------------------------------------------------
/**
 * O que o time NUNCA vê. Não é lista de palavras bonitas: é a lista de tabelas
 * e views onde essas coisas moram nesta base. Um SELECT delas dentro de um
 * módulo alcançável pelo perfil comum é o vazamento, independente de a tela
 * mostrar ou não.
 */
const PROIBIDOS = [
  'fin_account', 'fin_transaction', 'fin_dre', 'fin_balanco', 'fin_fluxo',
  'fin_payroll', 'fin_folha', 'fin_margem', 'fin_obra_margem', 'fin_projeto_margem',
  'fin_tribut', 'fin_apuracao', 'fin_regime', 'fin_cash_forecast', 'fin_recurring',
  'fin_saldo', 'fin_reserva', 'fin_comissao', 'fin_commission'
];

/*
 * A SUPERFÍCIE É DESCOBERTA NO DISCO, NÃO DIGITADA À MÃO.
 *
 * Era uma lista manual, e a auditoria mostrou o custo disso: o commit que
 * acrescentou `/api/time/inicio`, `/api/time/perfil` e `/api/time/perfil/foto`
 * esqueceu de incluí-las, e o guard imprimiu ✓ sem nunca ter olhado para elas.
 * `cartao/ler` e `compartilhado` já faltavam antes. Uma trava que depende de
 * alguém lembrar de atualizá-la não é uma trava.
 *
 * Agora todo `route.ts` sob `app/api/time/` entra sozinho, mais os módulos de
 * biblioteca que essas rotas importam — porque foi exatamente por um `import`
 * que o SQL proibido escapou: `estorno-reembolso.ts` lia `fin_transaction` e
 * `fin_account` e o grep não via, porque o arquivo não estava na lista.
 */
async function descobrirRotasDoTime(dir) {
  const achados = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, item.name);
    if (item.isDirectory()) achados.push(...(await descobrirRotasDoTime(caminho)));
    else if (item.name === 'route.ts') achados.push(path.relative(RAIZ, caminho));
  }
  return achados;
}

/** Os módulos de `lib/financeiro` que as rotas do time alcançam, direta ou indiretamente. */
async function modulosAlcancados(rotas) {
  const vistos = new Set();
  const fila = [...rotas];
  while (fila.length) {
    const rel = fila.shift();
    const fonte = await readFile(path.join(RAIZ, rel), 'utf8').catch(() => null);
    if (fonte === null) continue;
    for (const m of fonte.matchAll(/from\s+["'](@\/lib\/financeiro\/[\w-]+|\.\/[\w-]+)["']/g)) {
      const bruto = m[1];
      const nome = bruto.startsWith('@/') ? bruto.slice(2) : 'lib/financeiro/' + bruto.slice(2);
      const arquivo = nome + '.ts';
      if (vistos.has(arquivo)) continue;
      vistos.add(arquivo);
      fila.push(arquivo);
    }
  }
  return [...vistos];
}

const ROTAS_DO_TIME = await descobrirRotasDoTime(path.join(RAIZ, 'app/api/time'));
const SUPERFICIE_DO_TIME = [
  ...ROTAS_DO_TIME,
  ...(await modulosAlcancados(ROTAS_DO_TIME)),
  'app/api/notificacoes/route.ts',
  'app/api/notificacoes/[id]/route.ts'
].filter((v, i, a) => a.indexOf(v) === i).sort();

console.log(`  (superfície descoberta no disco: ${ROTAS_DO_TIME.length} rotas + ${SUPERFICIE_DO_TIME.length - ROTAS_DO_TIME.length - 2} módulos)`);

console.log('\n=== 2. SUPERFÍCIE: o que os módulos do time podem tocar ===');
for (const rel of SUPERFICIE_DO_TIME) {
  const fonte = await readFile(path.join(RAIZ, rel), 'utf8').catch(() => null);
  if (fonte === null) { nok(`${rel} não existe`); continue; }
  // Comentários explicam a regra e citam os nomes; a busca é só no CÓDIGO.
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const achados = PROIBIDOS.filter((p) => (p === 'fin_comissao' ? /\bfin_comissao\b/.test(codigo) : codigo.includes(p)));
  if (achados.length) nok(`${rel} menciona ${achados.join(', ')}`);
  else ok(rel, 'nenhuma tabela de saldo, DRE, folha, margem ou tributo');
}

// A prova negativa mais importante: nenhuma função da superfície do time aceita
// pessoa como parâmetro solto. É o que sustenta "cada um vê só o que enviou".
// Vale para TODA a superfície, não só para `time.ts`.
//
// A auditoria achou o furo: `estorno-reembolso.ts` exportava
// `sugerirMatchEstorno(personId, ...)` e `cancelarItemReembolsoAdmin(personId, ...)`,
// e era importado por `/api/time/*`. A regra continuava verdadeira no arquivo
// que o guard olhava e falsa no conjunto — que é o mesmo que ser falsa.
const assinaturasComPessoa = [];
for (const rel of SUPERFICIE_DO_TIME) {
  if (!rel.startsWith('lib/financeiro/')) continue;
  const fonte = await readFile(path.join(RAIZ, rel), 'utf8').catch(() => null);
  if (fonte === null) continue;
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [, nome, args] of codigo.matchAll(/export async function (\w+)\(([^)]*)\)/gs)) {
    /*
     * Duas exceções declaradas, e só estas:
     *
     * `abrirSessao` — é ELA que estabelece quem é a pessoa. Receber a pessoa
     *   como parâmetro é o próprio trabalho dela.
     *
     * `cancelarItemReembolsoInterno` — é o motor compartilhado entre o caminho
     *   do app (`cancelarItemReembolso(sessao, …)`, que amarra na sessão) e o
     *   do admin (`estorno-reembolso-admin.ts`, atrás de Basic Auth).
     *   TypeScript não tem visibilidade de pacote, então ela precisa ser
     *   `export` para o módulo irmão enxergar. NENHUMA rota a importa: as
     *   rotas de `/api/time` só alcançam a versão com `sessao`. Se alguém um
     *   dia importá-la de um route, a verificação 2 acima (tabelas proibidas)
     *   não pega, mas esta linha aqui é o lembrete de que a porta existe.
     */
    const EXCECOES = ['abrirSessao', 'cancelarItemReembolsoInterno'];
    if (/person(Id)?\s*:/i.test(args) && !EXCECOES.includes(nome)) {
      assinaturasComPessoa.push(`${rel}:${nome}`);
    }
  }
}
afirma(assinaturasComPessoa.length === 0,
  'nenhuma função exportada da superfície do time recebe pessoa como parâmetro',
  assinaturasComPessoa.length ? assinaturasComPessoa.join(', ') : 'o escopo vem sempre da Sessao');

// E a exceção acima precisa continuar sendo só um detalhe de implementação:
// se uma ROTA do time importar o motor sem sessão, o escopo cai.
const rotasComMotor = [];
for (const rel of ROTAS_DO_TIME) {
  const fonte = await readFile(path.join(RAIZ, rel), 'utf8').catch(() => '');
  if (/cancelarItemReembolsoInterno|cancelarItemReembolsoAdmin|estorno-reembolso-admin/.test(fonte)) {
    rotasComMotor.push(rel);
  }
}
afirma(rotasComMotor.length === 0,
  'nenhuma rota de /api/time importa o motor de estorno sem sessão',
  rotasComMotor.length ? rotasComMotor.join(', ') : 'as rotas do time só alcançam a versão amarrada na Sessao');

// E a rota de listagem não aceita filtro de pessoa vindo da URL.
const enviosRota = await readFile(path.join(RAIZ, 'app/api/time/envios/route.ts'), 'utf8');
afirma(!/searchParams/.test(enviosRota),
  '/api/time/envios não lê parâmetro nenhum da URL',
  'uma query string ?pessoa= seria a forma mais curta de quebrar o escopo');

// ---------------------------------------------------------------------------
// 3. Dado
// ---------------------------------------------------------------------------
console.log('\n=== 3. DADO: o que está na caixa do time, no banco ===');
const { financePool } = await import('./lib/artifact-db.mjs');
const pool = financePool();
try {
  const existe = await pool.query(`SELECT to_regclass('fin_notificacao') IS NOT NULL AS ok`);
  if (!existe.rows[0].ok) {
    console.log('  · fin_notificacao não existe neste banco (0105 não aplicada).');
    console.log('    A verificação de dado é feita pela própria migration e por');
    console.log('    scripts/test-time-notificacoes.mjs, em transação com ROLLBACK.');
  } else {
    const vaza = await pool.query(
      `SELECT count(*)::int n FROM fin_notificacao
        WHERE (recipient_kind = 'pessoa' OR recipient_perfil = 'comum')
          AND (escopo = 'gestao' OR link_href LIKE '/financeiro%')`
    );
    afirma(vaza.rows[0].n === 0, 'nenhum aviso do time é de gestão nem aponta para o financeiro');

    const constraints = await pool.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'fin_notificacao'::regclass AND contype = 'c'
        ORDER BY conname`
    );
    const nomes = constraints.rows.map((r) => r.conname);
    for (const c of ['fin_notificacao_link_coerente', 'fin_notificacao_gestao_e_admin',
                     'fin_notificacao_broadcast_sem_valor']) {
      afirma(nomes.includes(c), `CHECK ${c} está montado no banco`);
    }
  }
} catch (erro) {
  console.log(`  · banco indisponível (${erro.message.slice(0, 60)}); verificações 1 e 2 valem assim mesmo`);
} finally {
  await pool.end().catch(() => {});
}

console.log(falhas === 0
  ? '\n✅ o perfil comum não alcança dado financeiro.'
  : `\n❌ ${falhas} falha(s) — há caminho aberto.`);
process.exit(falhas === 0 ? 0 : 1);
