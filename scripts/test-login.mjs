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
import { createHash, randomBytes } from 'node:crypto';
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
let cookieCompartilhado = null;
const cookieAtual = () => cookieCompartilhado ?? '';

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
      cookieCompartilhado = cookie;
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

  // Prefere quem TEM reembolso: sem isso o bloco do "meu reembolso" só
  // conseguiria afirmar sobre lista vazia, que é o caso que menos importa.
  // Fora Fernando e Igor, cujas contas o admin vai criar de verdade.
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.email, p.is_admin,
            (SELECT count(*) FROM fin_reimbursement r WHERE r.person_id = p.id)::int AS reembolsos
       FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
      WHERE p.status = 'ativo' AND p.email IS NULL AND p.name NOT IN ('Fernando', 'Igor')
      ORDER BY (SELECT count(*) FROM fin_reimbursement r WHERE r.person_id = p.id) DESC, p.id DESC
      LIMIT 1`
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
  const primeiro = (liberado.corpo?.envios ?? [])[0];
  if (primeiro) {
    const det = await c(`/api/time/envios/${primeiro.origem}/${primeiro.origemId}`);
    afirma(det.status === 200 && det.corpo?.detalhe?.code, 'detalhe do envio abre', `status ${det.status}`);
  } else {
    ok('detalhe do envio (sem envios na cobaia — pulado)');
  }

  console.log('\n=== 5. A SESSÃO CORRENTE SOBREVIVE À PRÓPRIA TROCA ===');
  const sessaoDepois = await c('/api/time/sessao');
  afirma(
    sessaoDepois.corpo?.sessao?.personId === Number(cobaia.id),
    'quem trocou continua logado',
    'derrubar a sessão de quem acertou seria expulsar pelo acerto'
  );
  afirma(sessaoDepois.corpo?.sessao?.trocarSenha === false, 'a cobrança de troca some depois de trocar');

  console.log('\n=== 5b. O EIXO DESTINO CHEGA NO BANCO (Onda 2) ===');
  const opcoes = (await c('/api/time/envios')).corpo?.opcoes ?? {};
  const projeto = (opcoes.centros ?? []).find((x) => x.ehProjeto);
  const linhaLdc = (opcoes.linhas ?? []).find((x) => x.slug === 'ldc');
  afirma(Boolean(projeto), 'a lista de obras chega no formulário', `${(opcoes.centros ?? []).length} centros`);
  afirma(Boolean(linhaLdc), 'as linhas de serviço chegam no formulário', `${(opcoes.linhas ?? []).length} linhas`);

  if (projeto) {
    const comObra = await c('/api/time/envio', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'custo',
        titulo: 'teste automatizado — fita 3M',
        valor: '12,34',
        data: new Date().toISOString().slice(0, 10),
        centroCusto: projeto.id
      })
    });
    afirma(comObra.status === 201, 'custo com obra é aceito (201 Created)', `status ${comObra.status}`);
    const gravado = await db.query(
      `SELECT cost_center_id, product_line_id FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`,
      [cobaia.id]
    );
    afirma(
      Number(gravado.rows[0]?.cost_center_id) === projeto.id,
      'o centro de custo FICOU gravado no envio',
      `cost_center_id=${gravado.rows[0]?.cost_center_id} — é o indicador que está em 0,0%`
    );
  }

  if (linhaLdc) {
    const semObra = await c('/api/time/envio', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'custo',
        titulo: 'teste automatizado — combustível para rodar LDC',
        valor: '80,00',
        data: new Date().toISOString().slice(0, 10),
        linhaServico: linhaLdc.id
      })
    });
    afirma(semObra.status === 201, 'custo sem obra, com linha de serviço, é aceito', `status ${semObra.status}`);
    const gravado = await db.query(
      `SELECT cost_center_id, product_line_id FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`,
      [cobaia.id]
    );
    afirma(
      Number(gravado.rows[0]?.product_line_id) === linhaLdc.id && gravado.rows[0]?.cost_center_id === null,
      'a linha de serviço grava sem obra',
      'é o caso do combustível que acontece antes do contrato existir'
    );
  }

  const bancos = (await c('/api/time/envios')).corpo?.opcoes?.bancos ?? [];
  afirma(bancos.length >= 2, 'os bancos chegam no formulário', bancos.map((b) => b.nome).join(', '));
  const inter = bancos.find((b) => /inter/i.test(b.nome));
  const nubank = bancos.find((b) => /nubank/i.test(b.nome));
  // Era `inter.plasticos.length === 0`, e quebrou no dia em que o Inter ganhou
  // o primeiro plástico — que é o problema sendo RESOLVIDO, não uma regressão.
  //
  // A propriedade que interessa nunca foi "o Inter está vazio": é que um banco
  // aparece na lista tendo plástico cadastrado ou não. Sem isso não havia como
  // registrar compra no Inter, que é onde estão os R$ 40.862,41 sem itemização.
  afirma(
    Boolean(inter) && Array.isArray(inter.plasticos),
    'o Inter é escolhível independente de ter plástico cadastrado',
    `${inter?.plasticos.length} plástico(s) — o banco aparece de qualquer jeito`
  );
  afirma(
    bancos.every((b) => Array.isArray(b.plasticos)),
    'e isso vale para TODO banco ativo',
    bancos.map((b) => `${b.nome}:${b.plasticos.length}`).join(' · ')
  );
  // Nove era o número dos plásticos vindos do SYNC. Desde que o app permite
  // cadastrar, gente cadastra — e travar em 9 transformava uso real do produto
  // em falha de teste. O que importa é que os do sync continuem todos lá.
  afirma(Boolean(nubank) && nubank.plasticos.length >= 9, 'o Nubank traz pelo menos os nove plásticos do sync',
    `${nubank?.plasticos.length} finais${nubank?.plasticos.length > 9 ? ' (os extras foram cadastrados pelo app)' : ''}`);

  if (inter) {
    const soBanco = await c('/api/time/envio', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'custo', titulo: 'teste automatizado — compra no Inter', valor: '55,00',
        data: new Date().toISOString().slice(0, 10), pagamento: 'cartao_da_empresa', banco: inter.id
      })
    });
    afirma(soBanco.status === 201, 'custo só com o banco é aceito', `status ${soBanco.status}`);
    const g = await db.query(
      `SELECT card_account_id, card_id FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`,
      [cobaia.id]);
    afirma(
      Number(g.rows[0]?.card_account_id) === inter.id && g.rows[0]?.card_id === null,
      'grava o banco sem plástico',
      'a pessoa sempre sabe o banco; nem sempre o final'
    );
  }

  if (nubank?.plasticos.length) {
    const comPlastico = await c('/api/time/envio', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'custo', titulo: 'teste automatizado — compra no plástico', valor: '77,00',
        data: new Date().toISOString().slice(0, 10),
        pagamento: 'cartao_da_empresa', cartao: nubank.plasticos[0].id
      })
    });
    afirma(comPlastico.status === 201, 'custo com plástico é aceito', `status ${comPlastico.status}`);
    const g = await db.query(
      `SELECT card_account_id, card_id FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`,
      [cobaia.id]);
    afirma(
      Number(g.rows[0]?.card_id) === nubank.plasticos[0].id && Number(g.rows[0]?.card_account_id) === nubank.id,
      'o banco DERIVA do plástico',
      'guardar os dois vindos do formulário deixaria eles divergirem'
    );
  }

  const incoerente = await c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo', titulo: 'teste automatizado — cartão incoerente', valor: '10,00',
      data: new Date().toISOString().slice(0, 10), pagamento: 'pix_da_empresa', banco: inter?.id
    })
  });
  const gi = await db.query(
    `SELECT card_account_id FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`, [cobaia.id]);
  afirma(
    incoerente.status === 201 && gi.rows[0]?.card_account_id === null,
    'banco com PIX é descartado, não recusa o envio',
    'o CHECK recusaria a linha inteira e a pessoa perderia o lançamento'
  );

  console.log('\n=== 5b2. PARCELAS E FINAL DIGITADO ===');
  const parcelado = await c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo', titulo: 'teste automatizado — parcelado', valor: '193,83',
      data: new Date().toISOString().slice(0, 10),
      pagamento: 'cartao_da_empresa', banco: nubank?.id, final: '0343', parcelas: 12
    })
  });
  afirma(parcelado.status === 201, 'custo parcelado é aceito', `status ${parcelado.status}`);
  const gp = await db.query(
    `SELECT amount_cents, parcelas, card_last4, card_id FROM fin_time_envio
      WHERE person_id = $1 ORDER BY id DESC LIMIT 1`, [cobaia.id]);
  afirma(Number(gp.rows[0]?.amount_cents) === 19383, 'grava o TOTAL, não a parcela',
    `${gp.rows[0]?.amount_cents} centavos — derivar a parcela é divisão; o contrário perde centavo`);
  afirma(gp.rows[0]?.parcelas === 12, 'as parcelas ficam', `${gp.rows[0]?.parcelas}×`);
  afirma(gp.rows[0]?.card_last4 === '0343', 'o final digitado fica', gp.rows[0]?.card_last4);
  afirma(gp.rows[0]?.card_id !== null, 'e casou sozinho com o plástico cadastrado', `card_id=${gp.rows[0]?.card_id}`);

  console.log('\n=== 5b1. A CONTA QUE RECEBE (0159) ===');
  // Existe para PROGRAMAR pagamento, não para exibir: chave malformada não
  // volta como erro no dia do pagamento — ou o banco recusa, ou ela é válida e
  // pertence a outra pessoa. Por isso a validação é por tipo.
  {
    const chaves = [
      ['cpf', '123', false], ['cpf', '12345678909', true],
      ['telefone', '999', false], ['telefone', '81999998888', true],
      ['email', 'nao-eh-email', false], ['email', 'teste@xpe.com.br', true],
      ['aleatoria', 'abc', false]
    ];
    let acertos = 0;
    for (const [tipo, chave, deveria] of chaves) {
      const r = await c('/api/time/perfil/conta', {
        method: 'PUT', body: JSON.stringify({ metodo: 'pix', pixTipo: tipo, pixChave: chave })
      });
      if ((r.status === 200) === deveria) acertos += 1;
    }
    afirma(acertos === chaves.length, 'a chave PIX é validada pelo TIPO',
      `${acertos}/${chaves.length} — chave errada não dá erro no pagamento, paga outra pessoa`);

    await c('/api/time/perfil/conta', {
      method: 'PUT', body: JSON.stringify({ metodo: 'pix', pixTipo: 'telefone', pixChave: '(81) 99999-8888' })
    });
    const lida = await c('/api/time/perfil/conta');
    afirma(lida.corpo?.conta?.pixChave === '+5581999998888',
      'telefone é normalizado para E.164', String(lida.corpo?.conta?.pixChave));

    // Quem conferiu o destino antigo não conferiu o novo.
    await db.query(`UPDATE fin_person_pagamento SET conferido_em = now() WHERE person_id = $1`, [cobaia.id]);
    await c('/api/time/perfil/conta', {
      method: 'PUT', body: JSON.stringify({ metodo: 'pix', pixTipo: 'email', pixChave: 'outro@xpe.com.br' })
    });
    const conf = await db.query(`SELECT conferido_em FROM fin_person_pagamento WHERE person_id = $1`, [cobaia.id]);
    afirma(conf.rows[0]?.conferido_em === null, 'trocar a chave derruba a conferência do financeiro',
      'lote automático não pode herdar confiança de um destino que mudou');

    const semTitular = await c('/api/time/perfil/conta', {
      method: 'PUT',
      body: JSON.stringify({ metodo: 'pix', pixTipo: 'cnpj', pixChave: '12345678000190', titularEhAPessoa: false })
    });
    afirma(semTitular.status === 400, 'conta de terceiro exige nome e documento do titular',
      `status ${semTitular.status} — o time é MEI e recebe no CNPJ; sem o titular o comprovante não casa`);

    await db.query(`DELETE FROM fin_person_pagamento WHERE person_id = $1`, [cobaia.id]);
  }

  console.log('\n=== 5b2a. CANCELAR REEMBOLSO COM ESTORNO ===');
  // Esta rota NUNCA funcionou: dois bugs independentes, cada um suficiente.
  // (1) o SQL usava `t.description` e `t.occurred_at`, que não existem em
  //     `fin_transaction` — 42703 no parse, mesmo sem nenhuma linha;
  // (2) a releitura final usava `query()`, que é OUTRA conexão do pool, e não
  //     enxergava o INSERT não commitado → `throw` → ROLLBACK de tudo.
  // `fin_reembolso_estorno` ficou com zero linhas desde que a feature subiu, e
  // nenhum teste chamava a rota. É este bloco que fecha esse buraco.
  {
    const alvo = (await db.query(`
      SELECT v.person_id, v.item_id, v.slug, v.valor_parcela_cents,
             (SELECT sum(x.valor_parcela_cents)::bigint FROM fin_time_reembolso_parcela_v x
               WHERE x.person_id = v.person_id AND x.slug = v.slug) AS soma_slug
        FROM fin_time_reembolso_parcela_v v
       WHERE v.parcelas_total = 1
       ORDER BY (SELECT count(*) FROM fin_time_reembolso_parcela_v x
                  WHERE x.person_id = v.person_id AND x.slug = v.slug) DESC
       LIMIT 1`)).rows[0];

    if (!alvo) {
      console.log('  · sem item de reembolso pago na base; bloco pulado.');
    } else {
      // Sessão da pessoa dona do item — o escopo do estorno vem da sessão.
      const tokenEstorno = randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO fin_time_sessao (token_sha256, person_id, prova, user_agent, expira_em)
         VALUES ($1, $2, 'senha', 'test-login-estorno', now() + interval '10 min')`,
        [createHash('sha256').update(tokenEstorno).digest('hex'), alvo.person_id]);
      const comoDono = (caminho, init) => fetch(`${BASE}${caminho}`, {
        ...init, headers: { cookie: `xpe_time_sessao=${tokenEstorno}`, 'content-type': 'application/json' } });

      const r = await comoDono(`/api/time/reembolso-item/planilha/${alvo.item_id}/cancelar`, {
        method: 'POST',
        body: JSON.stringify({ motivoCategoria: 'devolucao', motivo: 'teste automatizado', confirmar: true })
      });
      afirma(r.status === 200 || r.status === 201, 'o cancelamento COMMITA', `status ${r.status}`);

      const g = await db.query(
        `SELECT valor_cents, brcode, status FROM fin_reembolso_estorno
          WHERE item_fonte = 'planilha' AND item_id = $1`, [alvo.item_id]);
      afirma(g.rowCount === 1, 'a linha do estorno existe no banco',
        `${g.rowCount} linha(s) — zero significa que o ROLLBACK voltou`);

      const e = g.rows[0] ?? {};
      // O bug de dinheiro: o valor vinha da soma do SLUG inteiro. Medido em
      // produção, Igor/transporte: R$ 429,97 virava R$ 5.409,26 (12,6×).
      afirma(Number(e.valor_cents) === Number(alvo.valor_parcela_cents),
        'o valor é o DO ITEM, não a soma do slug',
        `R$ ${(Number(e.valor_cents) / 100).toFixed(2)} · o slug inteiro somaria R$ ${(Number(alvo.soma_slug) / 100).toFixed(2)}`);
      afirma(typeof e.brcode === 'string' && e.brcode.startsWith('000201'),
        'o BR Code do PIX foi gerado', String(e.brcode).slice(0, 32) + '…');
      afirma(String(e.brcode).includes((Number(e.valor_cents) / 100).toFixed(2)),
        'e o valor está dentro do payload', (Number(e.valor_cents) / 100).toFixed(2));

      const dedobro = await comoDono(`/api/time/reembolso-item/planilha/${alvo.item_id}/cancelar`, {
        method: 'POST',
        body: JSON.stringify({ motivoCategoria: 'devolucao', motivo: 'segunda vez', confirmar: true })
      });
      afirma(dedobro.status === 409, 'cancelar duas vezes é recusado com 409', `status ${dedobro.status}`);

      // A lista do admin também dava 500 pelo mesmo nome de coluna errado.
      const adm = await c('/api/financeiro/estornos-reembolso');
      afirma(adm.status === 200, 'a fila de estornos do admin responde', `status ${adm.status}`);

      await db.query(`DELETE FROM fin_document WHERE source = 'reembolso_estorno'`);
      await db.query(`DELETE FROM fin_reembolso_slug_cancelado WHERE person_id = $1`, [alvo.person_id]);
      await db.query(`DELETE FROM fin_reembolso_estorno WHERE item_fonte = 'planilha' AND item_id = $1`, [alvo.item_id]);
      await db.query(`DELETE FROM fin_time_sessao WHERE user_agent = 'test-login-estorno'`);
      const sobra = await db.query(`SELECT count(*)::int n FROM fin_reembolso_estorno`);
      afirma(sobra.rows[0].n === 0, 'e o teste não deixou estorno no banco', `${sobra.rows[0].n} restante(s)`);
    }
  }

  console.log('\n=== 5b2b. CADASTRAR CARTÃO, E RECONHECER O FINAL ===');
  // Esta rota NUNCA funcionou: o INSERT de auditoria passava 5 valores e o SQL
  // usava 4, e o Postgres morria em "could not determine data type of
  // parameter $4". Ninguém viu porque nenhum teste a chamava — o `tsc` não
  // olha dentro de string de SQL. É o buraco que este bloco fecha.
  {
    const desconhecido = await c('/api/time/cartao?final=7431');
    afirma(desconhecido.corpo?.conhecido === false, 'final não cadastrado volta como desconhecido',
      `conhecido=${desconhecido.corpo?.conhecido} — é o que dispara "diga de quem é" na tela`);

    const novo = await c('/api/time/cartao', {
      method: 'POST',
      body: JSON.stringify({ natureza: 'pessoal', final: '7431', bandeira: 'mastercard', tipo: 'fisico' })
    });
    afirma(novo.status === 201, 'cadastrar cartão pessoal funciona',
      `status ${novo.status} ${JSON.stringify(novo.corpo?.error ?? '')}`);
    // Number() dos dois lados: `fin_person.id` é bigint e o driver devolve
    // string, enquanto a rota devolve número. Comparar cru dá falso negativo.
    afirma(Number(novo.corpo?.cartao?.titularId) === Number(cobaia.id),
      'e nasce no nome de quem está logado',
      `titular=${novo.corpo?.cartao?.titularId} · cobaia=${cobaia.id}`);

    const agora = await c('/api/time/cartao?final=7431');
    afirma(agora.corpo?.conhecido === true && agora.corpo?.cartao?.natureza === 'pessoal',
      'depois de cadastrado o final é reconhecido como PESSOAL',
      `natureza=${agora.corpo?.cartao?.natureza} — é isto que manda o lançamento para o reembolso`);

    const repetido = await c('/api/time/cartao', {
      method: 'POST',
      body: JSON.stringify({ natureza: 'pessoal', final: '7431', tipo: 'fisico' })
    });
    afirma(repetido.status === 409, 'o mesmo cartão duas vezes é recusado com explicação',
      `status ${repetido.status} — o índice único barraria, mas com erro de constraint`);

    // Cartão da empresa: o reconhecimento tem de dizer o BANCO, que é o campo
    // que a foto nunca informa e que a pessoa teria de adivinhar.
    const contaId = (await db.query(`SELECT id FROM fin_card_account WHERE is_active ORDER BY id LIMIT 1`)).rows[0]?.id;
    const daEmpresa = await c('/api/time/cartao', {
      method: 'POST',
      body: JSON.stringify({ natureza: 'empresa', banco: contaId, final: '7432', tipo: 'virtual' })
    });
    afirma(daEmpresa.status === 201, 'cadastrar cartão da empresa funciona', `status ${daEmpresa.status}`);
    const empresaLido = await c('/api/time/cartao?final=7432');
    afirma(empresaLido.corpo?.cartao?.natureza === 'empresa' && empresaLido.corpo?.cartao?.bancoId,
      'e o reconhecimento traz o banco junto',
      `${empresaLido.corpo?.cartao?.banco} — é o campo que a foto não informa`);

    await db.query(`DELETE FROM fin_card WHERE last4 IN ('7431','7432') AND origem = 'app_time'`);
  }

  console.log('\n=== 5b2c. FOTO E NOTA NO MESMO ENVIO ===');
  // Antes o laço de `lerCorpo` sobrescrevia o arquivo a cada campo: mandar dois
  // guardava só o último, EM SILÊNCIO. A pessoa anexava o print e a nota, via
  // os dois na tela, e um sumia entre o toque e o banco.
  {
    const form = new FormData();
    form.append('kind', 'custo');
    form.append('titulo', 'teste automatizado — foto e nota');
    form.append('valor', '193,83');
    form.append('data', new Date().toISOString().slice(0, 10));
    form.append('pagamento', 'a_definir');
    form.append('arquivo', new Blob([Buffer.from('conteudo do print')], { type: 'image/jpeg' }), 'print.jpg');
    form.append('arquivoNota', new Blob([Buffer.from('<?xml version="1.0"?><nfeProc/>')], { type: 'text/xml' }), 'nota.xml');
    const r = await fetch(`${BASE}/api/time/envio`, { method: 'POST', body: form, headers: { cookie: cookieAtual() } });
    const corpo = await r.json().catch(() => ({}));
    afirma(r.status === 201, 'envio com os dois arquivos é aceito', `status ${r.status} ${JSON.stringify(corpo)}`);

    const anexos = await db.query(
      `SELECT a.kind, a.file_name FROM fin_payment_attachment a
        WHERE a.target_table = 'fin_time_envio' AND a.target_id = $1 ORDER BY a.kind`,
      [corpo.id]);
    afirma(anexos.rows.length === 2, 'os DOIS ficam guardados',
      `${anexos.rows.length} anexo(s) — antes o segundo sumia sem erro`);
    const porTipo = Object.fromEntries(anexos.rows.map((x) => [x.kind, x.file_name]));
    afirma(porTipo.comprovante === 'print.jpg', 'o print vira comprovante', String(porTipo.comprovante));
    afirma(porTipo.nota_fiscal === 'nota.xml', 'e a nota vira nota_fiscal',
      `${porTipo.nota_fiscal} — é o kind que a contabilidade procura`);
  }

  console.log('\n=== 5b3. A RESPOSTA QUE SE PERDE NA VOLTA (0145) ===');
  // O cenário: COMMIT feito, resposta perdida no 4G, pessoa toca de novo. Sem a
  // chave nasciam dois custos idênticos — e quem conciliasse com a fatura
  // encontraria dois lançamentos para uma linha do extrato.
  const chave = crypto.randomUUID();
  const tentativa = () => c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo', titulo: 'teste automatizado — tentativa repetida', valor: '77,00',
      data: new Date().toISOString().slice(0, 10), pagamento: 'a_definir', idempotencyKey: chave
    })
  });
  const primeira = await tentativa();
  const segunda = await tentativa();
  afirma(primeira.status === 201, 'a primeira tentativa cria', `status ${primeira.status}`);
  afirma(segunda.status === 201, 'a segunda responde ok, não erro',
    `status ${segunda.status} — a pessoa precisa ver "enviado", não uma falha`);
  afirma(primeira.corpo?.code === segunda.corpo?.code, 'e devolve O MESMO envio',
    `${primeira.corpo?.code} vs ${segunda.corpo?.code}`);
  afirma(segunda.corpo?.repetido === true, 'dizendo que já tinha entrado', `repetido=${segunda.corpo?.repetido}`);
  const gr = await db.query(
    `SELECT count(*)::int AS n FROM fin_time_envio WHERE person_id = $1 AND titulo LIKE '%tentativa repetida%'`,
    [cobaia.id]);
  afirma(gr.rows[0]?.n === 1, 'um custo no banco, não dois', `${gr.rows[0]?.n} linha(s)`);

  // E duas compras iguais de verdade continuam sendo duas: a trava é sobre a
  // TENTATIVA, não sobre o conteúdo. Dois cafés de R$ 12 no mesmo dia existem.
  const outroCafe = await c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo', titulo: 'teste automatizado — tentativa repetida', valor: '77,00',
      data: new Date().toISOString().slice(0, 10), pagamento: 'a_definir', idempotencyKey: crypto.randomUUID()
    })
  });
  const gr2 = await db.query(
    `SELECT count(*)::int AS n FROM fin_time_envio WHERE person_id = $1 AND titulo LIKE '%tentativa repetida%'`,
    [cobaia.id]);
  afirma(outroCafe.status === 201 && gr2.rows[0]?.n === 2,
    'mas compra idêntica com chave nova entra',
    `${gr2.rows[0]?.n} linhas — deduplicar por conteúdo recusaria dois cafés iguais no mesmo dia`);

  const finalNovo = await c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo', titulo: 'teste automatizado — final não cadastrado', valor: '30,00',
      data: new Date().toISOString().slice(0, 10),
      pagamento: 'cartao_da_empresa', banco: inter?.id, final: '9999'
    })
  });
  const gn = await db.query(
    `SELECT card_last4, card_id, card_account_id FROM fin_time_envio
      WHERE person_id = $1 ORDER BY id DESC LIMIT 1`, [cobaia.id]);
  afirma(
    finalNovo.status === 201 && gn.rows[0]?.card_last4 === '9999' && gn.rows[0]?.card_id === null,
    'final não cadastrado é guardado mesmo assim',
    'é o dado que a pessoa tem na mão, e é ele que casa com a fatura'
  );

  const aVista = await c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo', titulo: 'teste automatizado — à vista', valor: '10,00',
      data: new Date().toISOString().slice(0, 10), parcelas: 1
    })
  });
  const ga = await db.query(
    `SELECT parcelas FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`, [cobaia.id]);
  afirma(aVista.status === 201 && ga.rows[0]?.parcelas === null,
    'parcelas=1 vira à vista (NULL), não recusa o envio',
    'o CHECK do banco recusaria a linha inteira');

  const lixo = await c('/api/time/envio', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'custo',
      titulo: 'teste automatizado — id inexistente',
      valor: '1,00',
      data: new Date().toISOString().slice(0, 10),
      centroCusto: 999999
    })
  });
  afirma(
    lixo.status === 201,
    'id de obra inexistente não recusa o envio',
    'select desatualizado no celular não pode fazer a pessoa perder o lançamento e a foto'
  );
  const comLixo = await db.query(
    `SELECT cost_center_id FROM fin_time_envio WHERE person_id = $1 ORDER BY id DESC LIMIT 1`,
    [cobaia.id]
  );
  afirma(comLixo.rows[0]?.cost_center_id === null, 'e ele vira vazio declarado, não um id inventado');

  console.log('\n=== 5c. CADA UM VÊ O PRÓPRIO REEMBOLSO (Onda 4) ===');
  const meu = await c('/api/time/meu-reembolso');
  afirma(meu.status === 200, 'a rota responde para quem está logado', `status ${meu.status}`);
  const r = meu.corpo?.reembolso;

  const doBanco = await db.query(
    `SELECT coalesce(sum(i.amount_cents), 0)::text AS total
       FROM fin_reimbursement rb JOIN fin_reimbursement_item i ON i.reimbursement_id = rb.id
      WHERE rb.person_id = $1`,
    [cobaia.id]
  );
  const somaTela = (r?.historico?.meses ?? []).reduce((s2, m) => s2 + m.totalCents, 0);
  afirma(
    somaTela === Number(doBanco.rows[0].total),
    'o histórico bate centavo a centavo com o banco',
    `tela ${somaTela} · banco ${doBanco.rows[0].total}`
  );

  const saldoBanco = await db.query(
    `SELECT coalesce(sum(saldo_cents), 0)::text AS total FROM fin_reembolso_saldo_v
      WHERE person_id = $1 AND NOT quitado`,
    [cobaia.id]
  );
  afirma(
    r?.aReceber?.totalCents === Number(saldoBanco.rows[0].total),
    'o "quanto falta" bate com a view de saldo',
    `tela ${r?.aReceber?.totalCents} · view ${saldoBanco.rows[0].total}`
  );

  afirma(
    typeof r?.historico?.fonte === 'string' && typeof r?.aReceber?.fonte === 'string',
    'cada bloco declara de qual dos dois modelos veio',
    'os dois divergem em R$ 40,21 no acervo e a tela não pode esconder isso'
  );

  const projecao = r?.aReceber?.proximosMeses ?? [];
  if (projecao.length) {
    const decrescente = projecao.every((m, i2) => i2 === 0 || m.cents <= projecao[i2 - 1].cents);
    afirma(decrescente, 'a projeção dos próximos meses só decresce', `${projecao.length} meses à frente`);
  } else {
    ok('sem parcela em aberto para projetar', 'esta pessoa não tem saldo');
  }

  console.log('\n=== 5d. A FOTO VIRA CAMPOS (leitura do comprovante) ===');
  const { readFileSync, existsSync } = await import('node:fs');
  const amostra = process.env.XPE_COMPROVANTE_TESTE;
  const estado = await c('/api/time/ler-comprovante');
  afirma(estado.corpo?.disponivel === true, 'a leitura automática está configurada', 'ANTHROPIC_API_KEY presente');

  if (amostra && existsSync(amostra)) {
    const form = new FormData();
    form.append('arquivo', new Blob([readFileSync(amostra)], { type: 'image/png' }), 'comprovante.png');
    const r2 = await fetch(BASE + '/api/time/ler-comprovante', { method: 'POST', body: form, headers: { cookie: cookieAtual() } });
    const j2 = await r2.json().catch(() => ({}));
    afirma(r2.status === 200, 'a rota lê o comprovante', `status ${r2.status} ${j2.error ?? ''}`);
    const l = j2.lido ?? {};
    afirma(typeof l.valorTotal === 'number' && l.valorTotal > 0, 'extraiu o valor', `R$ ${l.valorTotal}`);
    afirma(/^\d{4}-\d{2}-\d{2}$/.test(l.data ?? ''), 'a data volta em AAAA-MM-DD', l.data);
    afirma(
      l.documento === null || /^\d{11}$|^\d{14}$/.test(l.documento),
      'o documento volta só com dígitos, ou null',
      `documento=${l.documento} — o modelo devolve formatado, quem normaliza é o servidor`
    );
    afirma((l.resumo ?? '').length <= 90, 'o resumo cabe num título', `${(l.resumo ?? '').length} caracteres`);
    afirma(l.chaveNfe === null || l.chaveNfe.length === 44, 'chave de NF-e tem 44 dígitos ou é null', String(l.chaveNfe));
  } else {
    ok('sem imagem de amostra', 'passe XPE_COMPROVANTE_TESTE=<caminho.png> para exercitar a extração');
  }

  console.log('\n=== 5e. O CICLO DA COMPRA: pedir → aprovar → comprar ===');
  const pedido = await c('/api/time/compra', {
    method: 'POST',
    body: JSON.stringify({
      titulo: 'teste automatizado — 3 rolos de fita 3M',
      justificativa: 'teste', valor: '240,00',
      links: [{ url: 'https://exemplo.invalido/fita', loja: 'Exemplo', preco: '80,00' }]
    })
  });
  afirma(pedido.status === 201, 'a solicitação de compra é aceita', `status ${pedido.status}`);

  const idCompra = (await db.query(
    `SELECT id FROM fin_purchase_request WHERE requested_person_id = $1 ORDER BY id DESC LIMIT 1`,
    [cobaia.id])).rows[0]?.id;

  const antesDeAprovar = await c('/api/time/compra/realizar');
  afirma(
    (antesDeAprovar.corpo?.compras ?? []).length === 0,
    'compra ainda não aprovada NÃO aparece para comprar',
    'só o estado aprovada libera'
  );

  await db.query(
    `UPDATE fin_purchase_request SET status='aprovada', decided_by='teste', decided_at=now() WHERE id=$1`,
    [idCompra]);

  const paraComprar = await c('/api/time/compra/realizar');
  const lista = paraComprar.corpo?.compras ?? [];
  afirma(lista.length === 1 && Number(lista[0].id) === Number(idCompra),
    'aprovada, ela aparece na lista de comprar', `${lista.length} na fila`);

  const realizou = await c('/api/time/compra/realizar', {
    method: 'POST',
    body: JSON.stringify({
      compraId: idCompra, titulo: 'teste automatizado — fita 3M comprada',
      valor: '267,90', data: new Date().toISOString().slice(0, 10), pagamento: 'cartao_da_empresa'
    })
  });
  afirma(realizou.status === 201, 'registrar a compra é aceito', `status ${realizou.status}`);

  const depois = await db.query(
    `SELECT c.status, e.amount_cents, e.purchase_request_id, c.amount_cents AS pedido
       FROM fin_purchase_request c
       LEFT JOIN fin_time_envio e ON e.purchase_request_id = c.id
      WHERE c.id = $1`, [idCompra]);
  afirma(depois.rows[0]?.status === 'atendida', 'a solicitação vira atendida', depois.rows[0]?.status);
  afirma(
    Number(depois.rows[0]?.amount_cents) === 26790 && Number(depois.rows[0]?.pedido) === 24000,
    'pedido e gasto ficam AMBOS guardados',
    `pediu R$ ${(Number(depois.rows[0]?.pedido)/100).toFixed(2)} · gastou R$ ${(Number(depois.rows[0]?.amount_cents)/100).toFixed(2)}`
  );

  const duasVezes = await c('/api/time/compra/realizar', {
    method: 'POST',
    body: JSON.stringify({ compraId: idCompra, titulo: 'teste automatizado — dobrada', valor: '10,00',
                           data: new Date().toISOString().slice(0, 10) })
  });
  afirma(duasVezes.status === 409, 'a mesma compra não é registrada duas vezes', `status ${duasVezes.status}`);

  console.log('\n=== 5f. APROVAR PASSA A CRIAR PREVISTO ===');
  const idEnvio = (await db.query(
    `SELECT id FROM fin_time_envio WHERE person_id = $1 AND kind='custo' ORDER BY id DESC LIMIT 1`,
    [cobaia.id])).rows[0]?.id;
  const { decidirEnvioDoTime } = await import('../lib/financeiro/time-admin.ts').catch(() => ({}));
  if (!decidirEnvioDoTime) {
    // O módulo é server-only e não importa fora do Next; exercita pela rota admin.
    const r = await fetch(BASE + '/api/financeiro/time', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieAtual() },
      body: JSON.stringify({ origem: 'envio', id: idEnvio, decisao: 'aprovar' })
    });
    afirma(r.status === 200, 'o admin aprova o custo', `status ${r.status}`);
  }
  const previsto = await db.query(
    `SELECT estado, valor_previsto_cents, cost_center_id, origem_ref FROM fin_custo_previsto
      WHERE origem_ref = $1`, [`fin_time_envio:${idEnvio}`]);
  afirma(
    previsto.rows.length === 1 && previsto.rows[0].estado === 'previsto',
    'aprovar CRIOU o previsto — antes não criava nada',
    previsto.rows[0] ? `R$ ${(Number(previsto.rows[0].valor_previsto_cents)/100).toFixed(2)} · ${previsto.rows[0].origem_ref}` : 'nenhum'
  );

  console.log('\n=== 5g. CADASTRO APP (admin — pendências de pessoa) ===');
  {
    const adminChamar = async (caminho, opcoes = {}) => {
      const headers = { ...(opcoes.headers ?? {}), 'content-type': 'application/json' };
      let r;
      try {
        r = await fetch(BASE + caminho, { ...opcoes, headers });
      } catch {
        r = await fetch(BASE + caminho, { ...opcoes, headers });
      }
      let corpo = null;
      try {
        corpo = await r.json();
      } catch {
        /* sem JSON */
      }
      return { status: r.status, corpo };
    };

    const antesCad = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}/cadastro-app`);
    afirma(antesCad.status === 200, 'GET cadastro-app responde', `status ${antesCad.status}`);

    const waAntes = antesCad.corpo?.whatsapp ?? null;
    const nascAntes = antesCad.corpo?.birthDate ?? null;

    const patch = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}/cadastro-app`, {
      method: 'PATCH',
      body: JSON.stringify({
        whatsapp: '81999887766',
        birthDate: '1990-05-15',
        cpf: '70365478474',
        pagamento: { metodo: 'pix', pixTipo: 'telefone', pixChave: '81999887766' }
      })
    });
    afirma(patch.status === 200, 'PATCH cadastro-app grava WhatsApp e PIX', `status ${patch.status}`);

    const depoisCad = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}/cadastro-app`);
    afirma(
      depoisCad.corpo?.whatsapp?.includes('99988') && depoisCad.corpo?.birthDate === '1990-05-15',
      'cadastro relido bate com o gravado',
      `wa=${depoisCad.corpo?.whatsapp} · nasc=${depoisCad.corpo?.birthDate}`
    );

    const senhaCurta = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}/senha-app`, {
      method: 'POST',
      body: JSON.stringify({ senha: '123' })
    });
    afirma(senhaCurta.status === 422, 'senha curta é recusada', `status ${senhaCurta.status}`);

    await adminChamar(`/api/financeiro/pessoas/${cobaia.id}/cadastro-app`, {
      method: 'PATCH',
      body: JSON.stringify({
        whatsapp: waAntes,
        birthDate: nascAntes
      })
    });
  }

  console.log('\n=== 5h. ÁREAS DA EMPRESA (admin — N:N, sem tocar o time) ===');
  {
    const adminChamar = async (caminho, opcoes = {}) => {
      const headers = { ...(opcoes.headers ?? {}), 'content-type': 'application/json' };
      let r;
      try {
        r = await fetch(BASE + caminho, { ...opcoes, headers });
      } catch {
        r = await fetch(BASE + caminho, { ...opcoes, headers });
      }
      let corpo = null;
      try {
        corpo = await r.json();
      } catch {
        /* sem JSON */
      }
      return { status: r.status, corpo };
    };

    const antes = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}`);
    afirma(antes.status === 200, 'GET pessoa devolve áreas da empresa', `status ${antes.status}`);
    const slugsAntes = (antes.corpo?.areasEmpresa ?? []).map((a) => a.slug);

    const timeAntes = antes.corpo?.pessoa?.area ?? null;

    const patch = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ areasEmpresa: ['marketing', 'vendas'] })
    });
    afirma(patch.status === 200, 'PATCH areasEmpresa grava duas áreas', `status ${patch.status} · ${JSON.stringify(patch.corpo?.after)}`);

    const depois = await adminChamar(`/api/financeiro/pessoas/${cobaia.id}`);
    const slugs = (depois.corpo?.areasEmpresa ?? []).map((a) => a.slug).sort();
    afirma(
      slugs.includes('marketing') && slugs.includes('vendas'),
      'relido bate: Marketing e Vendas',
      slugs.join(',')
    );
    afirma(
      (depois.corpo?.pessoa?.area ?? null) === timeAntes,
      'o time (fin_person.area) não mudou',
      `area=${depois.corpo?.pessoa?.area}`
    );

    await adminChamar(`/api/financeiro/pessoas/${cobaia.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ areasEmpresa: slugsAntes })
    });
  }

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
    await db.query(
      `DELETE FROM fin_payment_attachment WHERE target_table = 'fin_time_envio'
         AND target_id IN (SELECT id FROM fin_time_envio WHERE person_id = $1 AND titulo LIKE 'teste automatizado —%')`,
      [cobaia.id]
    );
    await db.query(`DELETE FROM fin_notificacao WHERE person_id = $1 AND criado_em > now() - interval '10 minutes'`, [
      cobaia.id
    ]).catch(() => {});
    await db.query(
      `DELETE FROM fin_custo_previsto WHERE origem_ref IN (
         SELECT 'fin_time_envio:' || id FROM fin_time_envio
          WHERE person_id = $1 AND titulo LIKE 'teste automatizado —%')`, [cobaia.id]).catch(() => {});
    await db.query(
      `DELETE FROM fin_purchase_request_link WHERE purchase_request_id IN (
         SELECT id FROM fin_purchase_request WHERE requested_person_id = $1 AND title LIKE 'teste automatizado —%')`,
      [cobaia.id]).catch(() => {});
    await db.query(`DELETE FROM fin_time_envio WHERE person_id = $1 AND titulo LIKE 'teste automatizado —%'`, [
      cobaia.id
    ]);
    await db.query(
      `DELETE FROM fin_purchase_request WHERE requested_person_id = $1 AND title LIKE 'teste automatizado —%'`,
      [cobaia.id]).catch(() => {});
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
      envios: (
        await db.query(`SELECT count(*)::int AS n FROM fin_time_envio WHERE person_id = $1`, [cobaia.id])
      ).rows[0].n,
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
      depois.email === antes.email &&
        depois.acesso === antes.acesso &&
        depois.sessoes === antes.sessoes &&
        depois.envios === 0,
      'o banco voltou ao estado anterior',
      `e-mail=${depois.email ?? 'null'} · acesso=${depois.acesso} · sessões=${depois.sessoes} · envios=${depois.envios}`
    );
  }
  await db.end();
  console.log(falhas ? `\n❌ ${falhas} falha(s).` : '\n✅ login por e-mail e senha exercitado de ponta a ponta.');
  process.exit(falhas ? 1 : 0);
}
