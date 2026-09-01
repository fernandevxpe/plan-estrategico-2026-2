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

  // ---------------------------------------------- saldo Inter (só leitura)
  /*
   * A tela de aprovações consulta esta rota a cada 45s. Sem um GET que a
   * chame, o TypeScript limpo deixaria um SELECT quebrado ir para produção —
   * a mesma falha do cadastro de cartão (AGENTS.md §4). Não cria pagamento.
   */
  {
    const r = await fetch(BASE + '/api/financeiro/aprovacoes/saldo');
    let json = null;
    try {
      json = await r.json();
    } catch {
      json = null;
    }
    afirma(
      r.status === 200 || r.status === 503,
      'GET /api/financeiro/aprovacoes/saldo responde',
      `HTTP ${r.status}`
    );
    if (r.status === 200) {
      afirma(
        typeof json?.disponivelCents === 'number',
        'saldo vem em centavos',
        String(json.disponivelCents)
      );
      afirma(
        json.fonte === 'inter' || json.fonte === 'ledger',
        'fonte do saldo está dita',
        json.fonte
      );
      afirma(
        json.asaas && typeof json.asaas.disponivelCents === 'number',
        'Asaas vem em centavos (ao vivo ou ledger)',
        `${json.asaas.disponivelCents} fonte=${json.asaas.fonte}`
      );
      afirma(
        json.asaas.fonte === 'asaas' || json.asaas.fonte === 'ledger',
        'fonte do Asaas está dita',
        json.asaas.fonte
      );
      afirma(
        json.nubank && (json.nubank.disponivelCents === null || typeof json.nubank.disponivelCents === 'number'),
        'Nubank vem do ledger no mesmo GET',
        String(json.nubank?.disponivelCents)
      );
    }
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

  // ------------------------------- 3b. a folha: origem SEM coluna de FK
  /*
   * Este caso existe porque o primeiro teste real falhou nele, em 31/08/2026: a
   * comissão de R$ 10,00 do Fernando voltou "origemTabela fin_person
   * desconhecida". O `tsc` estava limpo — a lista de origens aceitas é dado, não
   * tipo. É o AGENTS.md §4 de novo.
   *
   * `fin_person` não tem coluna de ponteiro na 0075, e não deve ter: o vínculo
   * mora em `source_id`. O que se prova aqui é que a ordem NASCE mesmo assim.
   */
  const chaveFolha = `${MARCA}|fin_person`;
  const folha = await chamar('/api/financeiro/contas-a-pagar/programar', {
    scheduledFor: quando,
    metodo: 'pix',
    alvos: [
      {
        ...alvo(contraparteComChave, chaveFolha),
        origemTabela: 'fin_person',
        origemId: 4,
        descricao: `Comissão de teste ${MARCA}`
      }
    ]
  });
  afirma(
    folha.json?.criadas?.length === 1,
    'linha de folha (origemTabela=fin_person) VIRA ordem',
    JSON.stringify(folha.json?.recusadas ?? []).slice(0, 140)
  );
  const daFolha = (
    await pool.query(
      `SELECT source, source_id, document_id, recurring_id, card_bill_id,
              reimbursement_id, purchase_request_id
         FROM fin_payment_request WHERE entity_id = $1 AND source_id = $2`,
      [entityId, chaveFolha]
    )
  ).rows[0];
  afirma(Boolean(daFolha), 'a ordem da folha existe no banco');
  afirma(daFolha?.source === 'manual', "source é 'manual' (o CHECK da 0075 não tem 'folha')", daFolha?.source);
  afirma(daFolha?.source_id === chaveFolha, 'o vínculo com a pessoa vive em source_id', daFolha?.source_id);
  // fin_payment_origem_unica aceita ZERO origens — é o que sustenta este caso.
  const ponteiros = [
    daFolha?.document_id,
    daFolha?.recurring_id,
    daFolha?.card_bill_id,
    daFolha?.reimbursement_id,
    daFolha?.purchase_request_id
  ].filter((v) => v != null);
  afirma(ponteiros.length === 0, 'nenhum ponteiro de origem foi gravado', `${ponteiros.length}`);

  // ----------------------------- 3c. devolver para a fila o que foi ao banco
  /*
   * Este caso existe porque a rota devolveu 500 na primeira vez que o dono
   * clicou, em 01/09/2026: o UPDATE passava três parâmetros e usava dois, e o
   * Postgres recusou com "could not determine data type of parameter $2". O
   * `tsc` estava limpo. É o AGENTS.md §4 pela terceira vez nesta frente.
   *
   * A ordem é levada a `aguardando_autorizacao` direto no banco, de propósito:
   * o caminho real exige falar com o Inter, e o que se prova aqui é a ROTA, não
   * o envio.
   */
  const idOrdem = um.json?.criadas?.[0]?.id;
  await pool.query(
    `UPDATE fin_payment_request SET status='aguardando_autorizacao' WHERE id=$1`,
    [idOrdem]
  );

  const devMotivoCurto = await chamar('/api/financeiro/contas-a-pagar/programar', {
    acao: 'devolver',
    ids: [idOrdem],
    motivo: 'x'
  });
  afirma(devMotivoCurto.status === 422, 'motivo curto demais é recusado', `HTTP ${devMotivoCurto.status}`);

  const dev = await chamar('/api/financeiro/contas-a-pagar/programar', {
    acao: 'devolver',
    ids: [idOrdem],
    motivo: 'conferido no aplicativo do Inter: a ordem nao esta mais la'
  });
  afirma(dev.status === 200, 'devolver responde 200', `HTTP ${dev.status} ${JSON.stringify(dev.json)?.slice(0, 160)}`);
  afirma(dev.json?.devolvidas?.length === 1, 'uma ordem devolvida');
  const depoisDev = (
    await pool.query(`SELECT status, notes FROM fin_payment_request WHERE id=$1`, [idOrdem])
  ).rows[0];
  afirma(depoisDev?.status === 'rascunho', 'voltou para rascunho', depoisDev?.status);
  afirma(
    String(depoisDev?.notes ?? '').includes('devolvida para rascunho'),
    'o motivo ficou registrado em notes'
  );
  const auditada = (
    await pool.query(
      `SELECT count(*)::int AS n FROM fin_audit_log
        WHERE target_table='fin_payment_request' AND target_id=$1 AND action='update'`,
      [idOrdem]
    )
  ).rows[0].n;
  afirma(auditada > 0, 'a devolução foi para o fin_audit_log', `${auditada} registro(s)`);

  // Já em rascunho, devolver de novo tem de RECUSAR — senão o botão vira um
  // jeito de mexer no estado de qualquer ordem.
  const devDeNovo = await chamar('/api/financeiro/contas-a-pagar/programar', {
    acao: 'devolver',
    ids: [idOrdem],
    motivo: 'segunda tentativa, a ordem ja voltou para a fila'
  });
  afirma(devDeNovo.json?.devolvidas?.length === 0, 'não devolve o que já está em rascunho');
  afirma(devDeNovo.json?.recusadas?.length === 1, 'e diz por que recusou', devDeNovo.json?.recusadas?.[0]?.motivo);

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

  // -------------------------------------- 5. envio ao Inter
  /*
   * ESTE PASSO SÓ RODA COM A IGNIÇÃO DESLIGADA — e a razão é dinheiro.
   *
   * Ele foi escrito quando `INTER_PAGAMENTO_LOCAL` estava desligada: o `PUT`
   * batia numa trava e voltava 503, provando que o envio não acontece sem
   * credencial. Inofensivo.
   *
   * Com a ignição LIGADA o mesmo `PUT` deixa de ser teste e vira um PIX de
   * R$ 123,45 para a chave de teste `00000000000191`. Em 31/08/2026 ele chegou
   * a sair e só não pagou nada porque o caminho do endpoint estava errado
   * (405). Contar com isso seria contar com sorte.
   *
   * Então: ignição ligada, este passo é PULADO, alto e claro. O envio real se
   * testa pela tela, com valor pequeno e para si mesmo — nunca por script, que
   * roda sem ninguém olhando.
   */
  const ignicao = process.env.INTER_PAGAMENTO_LOCAL === '1';
  if (ignicao) {
    console.log('  ⏭  envio ao Inter PULADO — INTER_PAGAMENTO_LOCAL=1 e este passo mandaria PIX de verdade');
  } else {
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
  }

  // ---------------------------------------------- cobranca (boleto / NF-e)
  /*
   * AGENTS.md §4: rota nova precisa de um teste que a CHAME. Sem isto o INSERT
   * da 0185 passaria semanas quebrado com o TypeScript limpo — o mesmo defeito
   * do cadastro de cartão. Não chama Haiku: o XML da NF-e é extração exata.
   */
  {
    const chaveCobranca = `${MARCA}|cobranca`;
    const chaveFav = `nome:${MARCA}`;
    const patch = await chamar(
      '/api/financeiro/contas-a-pagar/cobranca',
      { chaveFavorito: chaveFav, favorito: true },
      'PATCH'
    );
    afirma(
      patch.status === 200 || patch.status === 503,
      'PATCH favorito responde',
      `HTTP ${patch.status}`
    );
    if (patch.status === 200) {
      afirma(patch.json?.favorito === true, 'favorito gravado', String(patch.json?.favorito));
    }

    const xml =
      '<?xml version="1.0"?>' +
      '<NFe><infNFe Id="NFe35240111111111111111550010000000011234567890">' +
      '<ide><dhEmi>2026-09-01T10:00:00-03:00</dhEmi><nNF>1</nNF><serie>1</serie></ide>' +
      '<emit><CNPJ>11111111111111</CNPJ><xNome>Fornecedor Teste Cap</xNome></emit>' +
      '<total><ICMSTot><vNF>10.50</vNF></ICMSTot></total>' +
      '</infNFe></NFe>';
    const fd = new FormData();
    fd.set('chaveDedupe', chaveCobranca);
    fd.set('kind', 'nota_fiscal');
    fd.set('arquivo', new Blob([xml], { type: 'text/xml' }), 'nota.xml');
    const post = await fetch(BASE + '/api/financeiro/contas-a-pagar/cobranca', { method: 'POST', body: fd });
    let postJson = null;
    try {
      postJson = await post.json();
    } catch {
      postJson = null;
    }
    afirma(post.status === 200 || post.status === 503, 'POST NF-e responde', `HTTP ${post.status}`);
    if (post.status === 200) {
      afirma(postJson?.anexo?.kind === 'nota_fiscal', 'anexo é NF-e', postJson?.anexo?.kind);
      afirma(
        postJson?.leitura?.valorLidoCents === 1050,
        'XML leu R$ 10,50 — sem chute',
        String(postJson?.leitura?.valorLidoCents)
      );
      const storage = postJson?.anexo?.storageKey;
      if (storage) {
        const get = await fetch(
          BASE + '/api/financeiro/contas-a-pagar/cobranca/anexo/' + storage.split('/').map(encodeURIComponent).join('/')
        );
        afirma(get.status === 200, 'GET anexo devolve o arquivo', `HTTP ${get.status}`);
      }
    }

    const del = await chamar(
      '/api/financeiro/contas-a-pagar/cobranca',
      { chaveDedupe: chaveCobranca, kind: 'nota_fiscal' },
      'DELETE'
    );
    afirma(del.status === 200 || del.status === 503, 'DELETE anexo responde', `HTTP ${del.status}`);

    // Limpa o que este bloco criou, mesmo se o POST tiver falhado no meio.
    await pool.query(`DELETE FROM fin_conta_cobranca WHERE chave_dedupe = $1`, [chaveCobranca]).catch(() => {});
    await pool.query(`DELETE FROM fin_conta_favorito WHERE chave = $1`, [chaveFav]).catch(() => {});
  }
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
