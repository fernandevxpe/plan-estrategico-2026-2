// Exercita POST /api/financeiro/contas-a-pagar/programar contra o servidor
// real, com o SQL de verdade.
//
//   npm run dev                    (noutro terminal)
//   npm run test:contas-a-pagar:rota
//
// POR QUE ESTE TESTE PRECISOU EXISTIR
// AGENTS.md §4: "o `tsc` não olha dentro de SQL". Foi assim que o cadastro de
// cartão passou semanas quebrado — o INSERT de auditoria passava 5 parâmetros e
// o SQL usava 4, o TypeScript estava limpo, a tela abria, e todo salvamento
// dava 500. `programarPagamentos` faz seis consultas encadeadas em uma
// transação, com SAVEPOINT por alvo. Nada disso é visível ao compilador.
//
// O TESTE ESCREVE NO BANCO REAL — não existe banco de desenvolvimento aqui.
// Ele cria uma contraparte descartável (nome com timestamp, para nunca colidir
// com fornecedor de verdade), usa só ela, e apaga tudo no `finally`, inclusive
// se estourar no meio. Nenhuma linha pré-existente é tocada: toda remoção é por
// id que este script criou.
//
// Ele NÃO chama o Banco Inter. O caminho de envio (`PUT`) fala com a rede e
// depende de credencial que ainda não existe; aqui se prova o que é nosso.
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const BASE = process.env.XPE_BASE_URL ?? 'http://localhost:3000';
const MARCA = `teste-cap-${Date.now()}`;

let falhas = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const nok = (t, d) => {
  falhas += 1;
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`);
};
const afirma = (cond, t, d) => (cond ? ok(t, d) : nok(t, d));

const pool = new pg.Pool({
  connectionString: financeDatabaseUrl(),
  max: 2,
  // Mesma razão de lib/financeiro/db.ts: as views daqui são profundamente
  // aninhadas e o JIT gasta dezenas de segundos compilando o que roda em 400ms.
  options: '-c jit=off'
});

async function chamar(caminho, corpo, metodo = 'POST') {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

let entityId = null;
let contraparteComChave = null;
let contraparteSemChave = null;
let payeeId = null;

try {
  console.log(`\nContas a pagar — rota de programação (${BASE})\n`);

  // ---------------------------------------------------------------- servidor
  try {
    const r = await fetch(BASE + '/financeiro/custos-empresa?aba=contas-a-pagar', { redirect: 'manual' });
    afirma(r.status < 500, 'servidor de pé', `HTTP ${r.status} na aba`);
  } catch (e) {
    nok('servidor de pé', `${e.message} — rode "npm run dev" noutro terminal`);
    throw e;
  }

  // ------------------------------------------------------------------ cobaias
  entityId = (await pool.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`)).rows[0]?.id;
  afirma(Boolean(entityId), 'entidade xpe existe');

  const criarContraparte = async (sufixo) => {
    const nome = `ZZ Fornecedor ${MARCA} ${sufixo}`;
    const r = await pool.query(
      `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, is_active)
       VALUES ($1, 'fornecedor', $2, $3, true) RETURNING id`,
      [entityId, nome, nome.toLowerCase()]
    );
    return r.rows[0].id;
  };

  contraparteComChave = await criarContraparte('com-chave');
  contraparteSemChave = await criarContraparte('sem-chave');

  payeeId = (
    await pool.query(
      `INSERT INTO fin_payee_account
         (counterparty_id, label, operation_type, pix_address_key, pix_address_key_type,
          owner_name, owner_document, is_default, is_active)
       VALUES ($1, 'chave de teste', 'PIX', $2, 'CNPJ', $3, $2, true, true) RETURNING id`,
      [contraparteComChave, '00000000000191', `ZZ Fornecedor ${MARCA}`]
    )
  ).rows[0].id;
  ok('contrapartes e coordenada PIX de teste criadas');

  const alvo = (counterpartyId, chave) => ({
    chaveDedupe: chave,
    origemTabela: null,
    origemId: null,
    counterpartyId,
    descricao: `Pagamento de teste ${MARCA}`,
    valorCents: 12_345,
    dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    categoryId: null,
    nucleo: null
  });

  const quando = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const chaveA = `${MARCA}|a`;
  const chaveB = `${MARCA}|b`;

  // ------------------------------------------------------------- 1. grava
  const um = await chamar('/api/financeiro/contas-a-pagar/programar', {
    scheduledFor: quando,
    metodo: 'pix',
    alvos: [alvo(contraparteComChave, chaveA)]
  });
  afirma(um.status === 201, 'POST devolve 201', `HTTP ${um.status} ${JSON.stringify(um.json)?.slice(0, 180)}`);
  afirma(um.json?.criadas?.length === 1, 'uma ordem criada');
  afirma(um.json?.criadas?.[0]?.code?.startsWith('PG-'), 'código gerado pelo gatilho', um.json?.criadas?.[0]?.code);
  afirma(um.json?.criadas?.[0]?.status === 'rascunho', 'nasce em rascunho — nunca "pago"');

  const gravada = (
    await pool.query(
      `SELECT status, method, scheduled_for::text AS quando, amount_cents, payee_account_id,
              payee_fingerprint, payee_snapshot IS NOT NULL AS tem_snapshot, source, source_id
         FROM fin_payment_request WHERE entity_id = $1 AND source_id = $2`,
      [entityId, chaveA]
    )
  ).rows[0];
  afirma(Boolean(gravada), 'linha existe no banco');
  afirma(gravada?.status === 'rascunho', 'status gravado é rascunho');
  afirma(gravada?.method === 'pix', 'método pix');
  afirma(gravada?.quando === quando, 'scheduled_for é a data pedida', gravada?.quando);
  afirma(Number(gravada?.amount_cents) === 12_345, 'valor em centavos');
  afirma(Number(gravada?.payee_account_id) === Number(payeeId), 'ligou na coordenada PIX padrão');
  afirma(gravada?.tem_snapshot === true, 'gravou o snapshot do favorecido');
  afirma(Boolean(gravada?.payee_fingerprint), 'gravou a impressão digital do favorecido');

  // ------------------------------------------------- 2. idempotência (a prova)
  const dois = await chamar('/api/financeiro/contas-a-pagar/programar', {
    scheduledFor: quando,
    metodo: 'pix',
    alvos: [alvo(contraparteComChave, chaveA)]
  });
  afirma(dois.json?.criadas?.length === 0, 'segunda chamada não cria nada');
  afirma(dois.json?.jaExistiam?.length === 1, 'segunda chamada reconhece a ordem existente');
  const quantas = (
    await pool.query(`SELECT count(*)::int AS n FROM fin_payment_request WHERE entity_id = $1 AND source_id = $2`, [
      entityId,
      chaveA
    ])
  ).rows[0].n;
  afirma(quantas === 1, 'UMA linha no banco depois de duas chamadas', `${quantas} linha(s)`);

  // ------------------------------------------- 3. sem coordenada não programa
  const tres = await chamar('/api/financeiro/contas-a-pagar/programar', {
    scheduledFor: quando,
    metodo: 'pix',
    alvos: [alvo(contraparteSemChave, chaveB)]
  });
  afirma(tres.json?.recusadas?.length === 1, 'favorecido sem chave PIX é recusado, não gravado');
  afirma(Boolean(tres.json?.recusadas?.[0]?.motivo), 'a recusa vem com motivo legível', tres.json?.recusadas?.[0]?.motivo);
  const nenhuma = (
    await pool.query(`SELECT count(*)::int AS n FROM fin_payment_request WHERE entity_id = $1 AND source_id = $2`, [
      entityId,
      chaveB
    ])
  ).rows[0].n;
  afirma(nenhuma === 0, 'nada foi gravado para o recusado');

  // ------------------------------------------------------- 4. corpo inválido
  const quatro = await chamar('/api/financeiro/contas-a-pagar/programar', {
    scheduledFor: quando,
    metodo: 'cartao',
    alvos: [alvo(contraparteComChave, `${MARCA}|c`)]
  });
  afirma(quatro.status === 422, 'método fora da lista devolve 422', `HTTP ${quatro.status}`);
  afirma(typeof quatro.json?.error === 'string', 'erro vem como { error: string }');

  const cinco = await chamar('/api/financeiro/contas-a-pagar/programar', {
    scheduledFor: '',
    metodo: 'pix',
    alvos: [alvo(contraparteComChave, `${MARCA}|d`)]
  });
  afirma(cinco.status >= 400 && cinco.status < 500, 'data vazia é recusada pelo cliente', `HTTP ${cinco.status}`);

  // -------------------------------------- 5. envio ao Inter está mesmo travado
  const seis = await chamar(
    '/api/financeiro/contas-a-pagar/programar',
    { id: um.json?.criadas?.[0]?.id },
    'PUT'
  );
  afirma(
    seis.status !== 200,
    'PUT não conclui sem a credencial de pagamento — nada foi ao banco',
    `HTTP ${seis.status} ${String(seis.json?.error ?? '').slice(0, 120)}`
  );
  const depoisDoPut = (
    await pool.query(`SELECT status FROM fin_payment_request WHERE entity_id = $1 AND source_id = $2`, [
      entityId,
      chaveA
    ])
  ).rows[0]?.status;
  afirma(depoisDoPut === 'rascunho', 'envio que falha NÃO muda o status', depoisDoPut);
} catch (e) {
  nok('execução', e.message);
} finally {
  // Desfaz tudo, por id criado aqui. Nada de DELETE por padrão de texto solto.
  try {
    await pool.query(`DELETE FROM fin_payment_request WHERE source_id LIKE $1`, [`${MARCA}%`]);
    if (payeeId) await pool.query(`DELETE FROM fin_payee_account WHERE id = $1`, [payeeId]);
    for (const id of [contraparteComChave, contraparteSemChave]) {
      if (id) await pool.query(`DELETE FROM fin_counterparty WHERE id = $1`, [id]);
    }
    await pool.query(`DELETE FROM fin_audit_log WHERE record_id IN (SELECT id FROM fin_payment_request WHERE source_id LIKE $1)`, [
      `${MARCA}%`
    ]).catch(() => {});
    const sobrou = (
      await pool.query(`SELECT count(*)::int AS n FROM fin_payment_request WHERE source_id LIKE $1`, [`${MARCA}%`])
    ).rows[0].n;
    afirma(sobrou === 0, 'limpeza: nada do teste sobrou em fin_payment_request', `${sobrou} sobrando`);
  } catch (e) {
    nok('limpeza', `${e.message} — confira fin_payment_request/fin_counterparty por "${MARCA}"`);
  }
  await pool.end();
}

console.log(falhas ? `\n${falhas} falha(s).\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
