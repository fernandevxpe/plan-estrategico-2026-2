// Exercita o login por e-mail e senha de ponta a ponta, contra o servidor real.
//
//   npm run dev            (noutro terminal)
//   npm run test:login
//
// POR QUE ESTE TESTE PRECISOU EXISTIR SEPARADO
// `test-time-notificacoes.mjs` roda tudo numa transação com ROLLBACK, e é o
// desenho certo para o que ele testa. Aqui não serve: o login acontece por
// HTTP, noutra conexão, e dado não commitado é invisível para ela. Então este
// script COMMITA uma credencial temporária, exercita, e desfaz no `finally` —
// inclusive se algo estourar no meio.
//
// A cobaia é uma pessoa REAL do cadastro (a última da lista, para não colidir
// com quem estiver em uso), e o estado anterior dela — e-mail, is_admin, linha
// de acesso, sessões — é fotografado antes e restaurado depois. O teste falha
// se a restauração não bater.
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const BASE = process.env.XPE_BASE_URL ?? 'http://localhost:3000';
const SENHA_ENTREGA = 'entrega-' + Math.random().toString(36).slice(2, 10);
const SENHA_NOVA = 'escolhida-' + Math.random().toString(36).slice(2, 10);
const EMAIL = `teste.login.${Date.now()}@exemplo.invalido`;

let falhas = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const nok = (t, d) => {
  falhas += 1;
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`);
};
const afirma = (cond, t, d) => (cond ? ok(t, d) : nok(t, d));

/** Guarda o cookie entre as chamadas, como um navegador faria. */
function criarCliente() {
  let cookie = null;
  return async function chamar(caminho, opcoes = {}) {
    const headers = { ...(opcoes.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    if (opcoes.body && !headers['content-type']) headers['content-type'] = 'application/json';
    // Uma tentativa de repescagem para falha de REDE (não de status). Entre o
    // health check e a primeira chamada o script roda `definir-acesso` num
    // processo filho, o que leva segundos; nesse intervalo o servidor fecha o
    // socket keep-alive e o undici tenta reusá-lo, devolvendo "fetch failed"
    // sem nada ter chegado ao servidor. Repetir uma vez abre conexão nova.
    let r;
    try {
      r = await fetch(BASE + caminho, { ...opcoes, headers, redirect: 'manual' });
    } catch {
      r = await fetch(BASE + caminho, { ...opcoes, headers, redirect: 'manual' });
    }
    const set = r.headers.get('set-cookie');
    if (set) {
      const par = set.split(';')[0];
      if (par.endsWith('=')) cookie = null;
      else cookie = par;
    }
    let corpo = null;
    try {
      corpo = await r.json();
    } catch {
      /* resposta sem JSON — o status já basta */
    }
    return { status: r.status, corpo };
  };
}

const url = financeDatabaseUrl();
if (!url) {
  console.error('FINANCE_DATABASE_URL ausente.');
  process.exit(1);
}
/**
 * O banco fica atrás do proxy TCP público do Railway, que derruba conexão ociosa
 * sem avisar — e este teste passa segundos falando HTTP entre uma consulta e
 * outra. Um `pg.Client` cru morre com "Connection terminated unexpectedly" e
 * leva o teste junto, o que faria parecer que o login quebrou.
 *
 * `Pool` reconecta sozinho; a repescagem cobre a conexão que já estava morta
 * quando foi emprestada.
 */
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 20000
});
pool.on('error', () => {
  /* conexão ociosa derrubada pelo proxy — o pool abre outra na próxima */
});

const db = {
  async query(texto, valores) {
    try {
      return await pool.query(texto, valores);
    } catch (erro) {
      if (!/terminated|ECONNRESET|timeout/i.test(erro.message)) throw erro;
      return pool.query(texto, valores);
    }
  },
  end: () => pool.end()
};

let cobaia = null;
let antes = null;

try {
  // Servidor de pé? Sem isto o teste vira uma lista de ECONNREFUSED.
  //
  // Três tentativas com 30s cada, e não uma com 8s: em `next dev` a PRIMEIRA
  // requisição a uma rota compila o módulo na hora. Medido aqui: 8,96s a frio
  // contra 0,44s depois. Um limite apertado reprova o servidor por estar
  // acordando, que é o tipo de falha que faz alguém desconfiar do teste em vez
  // do código.
  let dePe = false;
  for (let tentativa = 1; tentativa <= 3 && !dePe; tentativa += 1) {
    try {
      await fetch(BASE + '/api/time/sessao', { signal: AbortSignal.timeout(30000) });
      dePe = true;
    } catch {
      if (tentativa === 1) console.log('(aquecendo o servidor…)');
    }
  }
  if (!dePe) {
    console.error(`não consegui falar com ${BASE}. Suba o servidor (npm run dev) e repita.`);
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT p.id, p.name, p.email, p.is_admin
       FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
      WHERE p.status = 'ativo' AND p.email IS NULL
      ORDER BY p.id DESC LIMIT 1`
  );
  cobaia = rows[0];
  if (!cobaia) {
    console.error('nenhuma pessoa ativa sem e-mail para usar de cobaia.');
    process.exit(1);
  }
  antes = {
    email: cobaia.email,
    isAdmin: cobaia.is_admin,
    acesso: (await db.query(`SELECT count(*)::int AS n FROM fin_person_acesso WHERE person_id = $1`, [cobaia.id]))
      .rows[0].n,
    sessoes: (
      await db.query(`SELECT count(*)::int AS n FROM fin_time_sessao WHERE person_id = $1 AND encerrada_em IS NULL`, [
        cobaia.id
      ])
    ).rows[0].n
  };

  console.log(`\ncobaia: ${cobaia.name} (id ${cobaia.id}) · base ${BASE}`);
  console.log(`estado anterior: e-mail=${antes.email ?? 'null'} · acesso=${antes.acesso} · sessões=${antes.sessoes}\n`);

  // O hash vem do mesmo caminho que a aplicação usa, e não de uma cópia local:
  // uma segunda implementação aqui testaria a si mesma.
  const { spawnSync } = await import('node:child_process');
  const def = spawnSync(
    process.execPath,
    ['scripts/definir-acesso.mjs', '--pessoa', cobaia.name, '--email', EMAIL, '--aplicar'],
    { env: { ...process.env, XPE_SENHA: SENHA_ENTREGA }, encoding: 'utf8' }
  );
  if (def.status !== 0) throw new Error(`definir-acesso falhou: ${def.stderr || def.stdout}`);

  console.log('=== 1. SENHA ERRADA NÃO ENTRA ===');
  const c = criarCliente();
  const errada = await c('/api/time/sessao', { method: 'POST', body: JSON.stringify({ email: EMAIL, senha: 'x' }) });
  afirma(errada.status === 401, 'senha errada devolve 401', `status ${errada.status}`);

  const inexistente = await c('/api/time/sessao', {
    method: 'POST',
    body: JSON.stringify({ email: 'nao.existe@exemplo.invalido', senha: 'x' })
  });
  afirma(
    inexistente.status === 401 && inexistente.corpo?.error === errada.corpo?.error,
    'e-mail inexistente responde igual a senha errada',
    'mensagens diferentes viram oráculo de quem trabalha aqui'
  );

  const { rows: pos } = await db.query(`SELECT falhas FROM fin_person_acesso WHERE person_id = $1`, [cobaia.id]);
  afirma(
    (pos[0]?.falhas ?? 0) >= 1,
    'a falha FICOU gravada no banco',
    `falhas=${pos[0]?.falhas ?? 0} — era o bug do ROLLBACK que zerava o rate limit`
  );

  console.log('\n=== 2. SENHA CERTA ENTRA, E JÁ COBRA A TROCA ===');
  const entrou = await c('/api/time/sessao', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, senha: SENHA_ENTREGA })
  });
  afirma(entrou.status === 200, 'senha certa devolve 200', `status ${entrou.status}`);
  afirma(entrou.corpo?.sessao?.prova === 'senha', "a sessão nasce com prova='senha'", entrou.corpo?.sessao?.prova);
  afirma(entrou.corpo?.sessao?.trocarSenha === true, 'a senha de entrega nasce marcada para troca');
  afirma(
    entrou.corpo?.sessao?.admin === false,
    'a sessão carrega is_admin, e ele é false para quem não é admin',
    'a cobaia foi cadastrada sem --admin'
  );

  const zerou = await db.query(`SELECT falhas FROM fin_person_acesso WHERE person_id = $1`, [cobaia.id]);
  afirma(zerou.rows[0]?.falhas === 0, 'o acerto zera o contador de falhas');

  console.log('\n=== 3. O SERVIDOR BARRA QUEM NÃO TROCOU ===');
  const barrado = await c('/api/time/envios');
  afirma(
    barrado.status === 403,
    'rota protegida recusa sessão com senha de entrega pendente',
    `status ${barrado.status} — antes só a tela barrava, e um curl passava por 30 dias`
  );

  console.log('\n=== 4. TROCAR A SENHA ===');
  const trocaErrada = await c('/api/time/senha', {
    method: 'POST',
    body: JSON.stringify({ atual: 'nao-e-essa', nova: SENHA_NOVA })
  });
  afirma(trocaErrada.status === 401, 'troca com senha atual errada é recusada', `status ${trocaErrada.status}`);

  const curta = await c('/api/time/senha', {
    method: 'POST',
    body: JSON.stringify({ atual: SENHA_ENTREGA, nova: 'curta' })
  });
  afirma(curta.status === 422, 'senha nova com menos de 8 caracteres é recusada', `status ${curta.status}`);

  const trocou = await c('/api/time/senha', {
    method: 'POST',
    body: JSON.stringify({ atual: SENHA_ENTREGA, nova: SENHA_NOVA })
  });
  afirma(trocou.status === 200, 'troca com a senha certa funciona', `status ${trocou.status}`);

  const liberado = await c('/api/time/envios');
  afirma(liberado.status === 200, 'depois da troca a rota protegida abre', `status ${liberado.status}`);

  console.log('\n=== 5. A SESSÃO CORRENTE SOBREVIVE À PRÓPRIA TROCA ===');
  const sessaoDepois = await c('/api/time/sessao');
  afirma(
    sessaoDepois.corpo?.sessao?.personId === Number(cobaia.id),
    'quem trocou continua logado',
    'derrubar a sessão de quem acertou seria expulsar pelo acerto'
  );
  afirma(sessaoDepois.corpo?.sessao?.trocarSenha === false, 'a cobrança de troca some depois de trocar');

  console.log('\n=== 6. A SENHA ANTIGA MORREU ===');
  const c2 = criarCliente();
  const velha = await c2('/api/time/sessao', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, senha: SENHA_ENTREGA })
  });
  afirma(velha.status === 401, 'a senha de entrega não entra mais', `status ${velha.status}`);
  const nova = await c2('/api/time/sessao', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, senha: SENHA_NOVA })
  });
  afirma(nova.status === 200, 'a senha escolhida entra', `status ${nova.status}`);

  console.log('\n=== 7. BLOQUEAR DERRUBA A SESSÃO VIVA ===');
  await db.query(`UPDATE fin_person_acesso SET status = 'bloqueado' WHERE person_id = $1`, [cobaia.id]);
  const bloqueado = await c2('/api/time/envios');
  afirma(
    bloqueado.status === 401,
    'sessão de pessoa bloqueada para de valer na hora',
    `status ${bloqueado.status} — antes o cookie de 30 dias sobrevivia ao bloqueio`
  );
  await db.query(`UPDATE fin_person_acesso SET status = 'ativo' WHERE person_id = $1`, [cobaia.id]);

  console.log('\n=== 8. NADA DA LISTA DE PESSOAS SEM CREDENCIAL ===');
  const anon = criarCliente();
  const semSessao = await anon('/api/time/sessao');
  const porta = semSessao.corpo?.porta;
  if (porta === 'basic') {
    ok('porta=basic (dev): a lista sai, e é o comportamento declarado', `${semSessao.corpo?.pessoas?.length} pessoas`);
    console.log('    NOTA: em produção a porta é `sessao` e a lista não sai. Não dá para exercitar isso em dev.');
  } else {
    afirma(
      (semSessao.corpo?.pessoas ?? []).length === 0,
      'porta=sessao: a lista de pessoas não sai sem credencial'
    );
  }
} catch (erro) {
  nok('o teste estourou', erro.message);
} finally {
  if (cobaia && antes) {
    console.log('\n=== 9. DESFAZENDO ===');
    await db.query(`DELETE FROM fin_time_sessao WHERE person_id = $1 AND criada_em > now() - interval '10 minutes'`, [
      cobaia.id
    ]);
    if (antes.acesso === 0) await db.query(`DELETE FROM fin_person_acesso WHERE person_id = $1`, [cobaia.id]);
    await db.query(`UPDATE fin_person SET email = $2, is_admin = $3 WHERE id = $1`, [
      cobaia.id,
      antes.email,
      antes.isAdmin
    ]);

    const depois = {
      email: (await db.query(`SELECT email FROM fin_person WHERE id = $1`, [cobaia.id])).rows[0].email,
      acesso: (await db.query(`SELECT count(*)::int AS n FROM fin_person_acesso WHERE person_id = $1`, [cobaia.id]))
        .rows[0].n,
      sessoes: (
        await db.query(
          `SELECT count(*)::int AS n FROM fin_time_sessao WHERE person_id = $1 AND encerrada_em IS NULL`,
          [cobaia.id]
        )
      ).rows[0].n
    };
    afirma(
      depois.email === antes.email && depois.acesso === antes.acesso && depois.sessoes === antes.sessoes,
      'o banco voltou ao estado anterior',
      `e-mail=${depois.email ?? 'null'} · acesso=${depois.acesso} · sessões=${depois.sessoes}`
    );
  }
  await db.end();
  console.log(falhas ? `\n❌ ${falhas} falha(s).` : '\n✅ login por e-mail e senha exercitado de ponta a ponta.');
  process.exit(falhas ? 1 : 0);
}
