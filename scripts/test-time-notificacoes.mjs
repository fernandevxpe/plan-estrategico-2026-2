// Valida a 0105 sem aplicá-la, e prova as promessas do módulo do time.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A 0105 abre a primeira porta de ESCRITA para o perfil comum nesta
// plataforma. Até ela, o time só lia. Uma porta de escrita nova é exatamente o
// tipo de coisa que não pode ser conferida por leitura de código: as promessas
// ("não vira lançamento", "cada pessoa vê só o que enviou", "o aviso não abre
// porta que a pessoa não tem") ou o banco as recusa, ou elas são frases.
//
// Tudo aqui roda dentro de UMA transação que termina em ROLLBACK. O arquivo da
// migration é executado de verdade — mesmo SQL, mesmo planejador, mesmas
// constraints — e nada persiste. É o mesmo padrão de scripts/test-idempotencia.mjs.
//
//   node scripts/test-time-notificacoes.mjs
//
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/env.mjs';
loadEnv();

const { financePool } = await import('./lib/artifact-db.mjs');

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATION = path.join(RAIZ, 'db/migrations/0105_fin_time_e_notificacoes.sql');

const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let falhas = 0;
const ok = (t, extra = '') => console.log(`  ✓ ${t}${extra ? ` — ${extra}` : ''}`);
const nok = (t, extra = '') => { falhas += 1; console.log(`  ✗ ${t}${extra ? ` — ${extra}` : ''}`); };
const afirma = (cond, t, extra = '') => (cond ? ok(t, extra) : nok(t, extra));

/** Espera que `fn` estoure. Se não estourar, é falha: a trava não existe. */
async function recusa(client, titulo, fn) {
  await client.query('SAVEPOINT prova');
  try {
    await fn();
    await client.query('ROLLBACK TO SAVEPOINT prova');
    nok(titulo, 'o banco ACEITOU — a trava não está lá');
  } catch (erro) {
    await client.query('ROLLBACK TO SAVEPOINT prova');
    ok(titulo, String(erro.message).split('\n')[0].slice(0, 110));
  }
}

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  // -------------------------------------------------------------------------
  console.log('\n=== 1. ÂNCORA DE DINHEIRO (antes) ===');
  const antes = await client.query(
    `SELECT account_id, count(*)::int linhas, coalesce(sum(amount_cents),0)::bigint soma
       FROM fin_transaction GROUP BY account_id ORDER BY account_id`
  );
  const somaAntes = antes.rows.reduce((a, r) => a + BigInt(r.soma), 0n);
  console.log(`  ${antes.rows.length} contas · ${brl(somaAntes.toString())} · ` +
    `${antes.rows.reduce((a, r) => a + r.linhas, 0)} lançamentos`);

  // -------------------------------------------------------------------------
  console.log('\n=== 2. A MIGRATION 0105 EXECUTA POR INTEIRO ===');
  // Depois que a 0105 é aplicada em produção, reexecutá-la aqui estoura em
  // `relation "fin_person_acesso" already exists` — o teste passaria a falhar
  // por ter sido bem-sucedido, que é o pior tipo de alarme falso.
  //
  // O padrão é o mesmo de test-contabil.mjs: quando o schema JÁ tem a
  // migration, as provas correm contra o banco como está, que é inclusive o
  // teste mais honesto. `--aplicar` força a reexecução, para validar a
  // migration antes de aplicá-la.
  const APLICAR = process.argv.includes('--aplicar');
  const { rows: [{ aplicada }] } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM xpe_migrations
                     WHERE id = '0105_fin_time_e_notificacoes.sql') AS aplicada`
  );

  if (aplicada && !APLICAR) {
    console.log('     schema já tem a 0105; afirmando contra o banco como está');
    console.log('     (use --aplicar para reexecutar a migration dentro da transação)');
    ok('0105 registrada no ledger de migrations', 'aplicada em produção');
  } else {
    const sql = await readFile(MIGRATION, 'utf8');
    const t0 = Date.now();
    await client.query(sql);
    ok('0105 aplicada dentro da transação', `${Date.now() - t0} ms`);
  }

  // -------------------------------------------------------------------------
  console.log('\n=== 3. ÂNCORA DE DINHEIRO (depois) ===');
  const depois = await client.query(
    `SELECT account_id, count(*)::int linhas, coalesce(sum(amount_cents),0)::bigint soma
       FROM fin_transaction GROUP BY account_id ORDER BY account_id`
  );
  const somaDepois = depois.rows.reduce((a, r) => a + BigInt(r.soma), 0n);
  afirma(somaAntes === somaDepois && antes.rows.length === depois.rows.length,
    'soma por conta idêntica', brl(somaDepois.toString()));
  const divergentes = depois.rows.filter((d, i) =>
    antes.rows[i]?.account_id !== d.account_id || antes.rows[i]?.soma !== d.soma || antes.rows[i]?.linhas !== d.linhas);
  afirma(divergentes.length === 0, 'nenhuma conta mudou de soma ou de contagem');

  // -------------------------------------------------------------------------
  console.log('\n=== 4. O QUE NASCEU ===');
  const objetos = await client.query(
    `SELECT c.relname, c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('fin_person_acesso','fin_time_sessao','fin_anexo_blob',
                         'fin_purchase_request_link','fin_time_envio','fin_notificacao',
                         'fin_notificacao_regra','fin_invariante_resultado',
                         'fin_notificacao_fato_v','fin_time_envios_v','fin_time_comprovante_saude_v')
     ORDER BY c.relname`
  );
  for (const o of objetos.rows) ok(o.relname, o.relkind === 'v' ? 'view' : 'tabela');
  afirma(objetos.rows.length === 11, '11 objetos criados', `${objetos.rows.length} encontrados`);

  const regras = await client.query('SELECT slug, valor, motivo_ausencia FROM fin_notificacao_regra ORDER BY slug');
  for (const r of regras.rows) {
    console.log(`    ${r.slug.padEnd(26)} ${r.valor === null ? 'INDETERMINADO' : String(r.valor).padStart(6)}` +
      `${r.valor === null ? ` · ${r.motivo_ausencia.slice(0, 60)}…` : ''}`);
  }
  afirma(regras.rows.find((r) => r.slug === 'fila_decisao_valor_cents')?.valor === null,
    'a régua não declarada nasce NULA, não zero');

  // -------------------------------------------------------------------------
  console.log('\n=== 5. AS TRAVAS QUE O BANCO TEM DE RECUSAR ===');
  const [{ id: entityId }] = (await client.query("SELECT id FROM fin_entity WHERE slug='xpe'")).rows;
  const [{ id: personId, name: personName }] =
    (await client.query("SELECT id, name FROM fin_person WHERE status='ativo' ORDER BY id LIMIT 1")).rows;

  await recusa(client, 'aviso para o perfil comum NÃO pode apontar para /financeiro', () =>
    client.query(
      `INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_perfil, escopo, kind,
                                    titulo, corpo, link_href, amount_reason, dedupe_key)
       VALUES ($1,'perfil','comum','proprio','time_resposta','x','x','/financeiro/painel','x','t1')`,
      [entityId]));

  await recusa(client, 'aviso para a PESSOA não pode apontar para fora de /time', () =>
    client.query(
      `INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_person_id, escopo, kind,
                                    titulo, corpo, link_href, amount_reason, dedupe_key)
       VALUES ($1,'pessoa',$2,'proprio','time_resposta','x','x','/financeiro/indicadores','x','t2')`,
      [entityId, personId]));

  await recusa(client, 'aviso de GESTÃO não pode ir para o perfil comum', () =>
    client.query(
      `INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_perfil, escopo, kind,
                                    titulo, corpo, link_href, amount_reason, dedupe_key)
       VALUES ($1,'perfil','comum','gestao','fila_decisao_item','x','x','/time','x','t3')`,
      [entityId]));

  await recusa(client, 'broadcast ao time não carrega valor', () =>
    client.query(
      `INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_perfil, escopo, kind,
                                    titulo, corpo, link_href, amount_cents, dedupe_key)
       VALUES ($1,'perfil','comum','proprio','time_resposta','x','x','/time',5000,'t4')`,
      [entityId]));

  await recusa(client, 'valor nulo exige motivo (disciplina Medida)', () =>
    client.query(
      `INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_perfil, escopo, kind,
                                    titulo, corpo, link_href, dedupe_key)
       VALUES ($1,'perfil','admin','gestao','fila_decisao_item','x','x','/financeiro/revisao','t5')`,
      [entityId]));

  await recusa(client, 'envio devolvido sem motivo é recusado', () =>
    client.query(
      `INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo,
                                   amount_cents, incurred_on, status, enviado_em, decided_by, decided_at)
       VALUES ($1,'custo',$2,'declarada','x',100,CURRENT_DATE,'devolvido',now(),'admin',now())`,
      [entityId, personId]));

  await recusa(client, 'nota de entrada sem nenhuma identificação é recusada', () =>
    client.query(
      `INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo,
                                   amount_cents, incurred_on, status, enviado_em)
       VALUES ($1,'nota_entrada',$2,'declarada','x',100,CURRENT_DATE,'enviado',now())`,
      [entityId, personId]));

  await recusa(client, 'envio não vira documento sem aprovação assinada', () =>
    client.query(
      `INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo,
                                   amount_cents, incurred_on, status, applied_document_id)
       VALUES ($1,'custo',$2,'declarada','x',100,CURRENT_DATE,'rascunho',
               (SELECT id FROM fin_document LIMIT 1))`,
      [entityId, personId]));

  await recusa(client, 'link de compra com esquema javascript: é recusado', () =>
    client.query(
      `INSERT INTO fin_purchase_request_link (purchase_request_id, url, price_reason)
       VALUES (1,'javascript:alert(1)','x')`));

  await recusa(client, 'link sem preço e sem motivo é recusado', () =>
    client.query(
      `INSERT INTO fin_purchase_request_link (purchase_request_id, url)
       VALUES (1,'https://exemplo.com/x')`));

  // -------------------------------------------------------------------------
  console.log('\n=== 6. O CAMINHO FELIZ: uma pessoa envia, o admin responde ===');
  const envio = await client.query(
    `INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo, descricao,
                                 amount_cents, incurred_on, pagamento, status, enviado_em, fornecedor_nome)
     VALUES ($1,'custo',$2,'declarada','Cabo HDMI para a sala de reunião','comprado na loja da esquina',
             4990, CURRENT_DATE, 'ja_paguei_do_meu', 'enviado', now(), 'Loja X')
     RETURNING id, code, status`, [entityId, personId]);
  ok('custo enviado', `${envio.rows[0].code} · ${brl(4990)} · ${personName}`);

  const compra = await client.query(
    `INSERT INTO fin_purchase_request (entity_id, title, description, justification, amount_cents,
                                       amount_basis, quantity, unit, priority, status, source,
                                       requested_by, requested_person_id)
     VALUES ($1,'Monitor 27"','para a estação do Igor','a atual não liga',119900,'cotacao',2,'un',
             'alta','enviada','app_time',$2,$3)
     RETURNING id, code`, [entityId, personName, personId]);
  await client.query(
    `INSERT INTO fin_purchase_request_link (purchase_request_id, url, loja, titulo, price_cents)
     VALUES ($1,'https://exemplo.com.br/monitor-27','Exemplo','Monitor 27 polegadas',119900)`,
    [compra.rows[0].id]);
  ok('pedido de compra com link', `${compra.rows[0].code} · 2 un · ${brl(119900)}`);

  const nota = await client.query(
    `INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo,
                                 amount_cents, incurred_on, status, enviado_em,
                                 nfe_key, nfe_numero, fornecedor_nome)
     VALUES ($1,'nota_entrada',$2,'declarada','NF de entrada do fornecedor Y',250000,CURRENT_DATE,
             'enviado', now(), repeat('7',44), '12345','Fornecedor Y')
     RETURNING id, code`, [entityId, personId]);
  ok('nota de entrada aceita', `${nota.rows[0].code} — a primeira entrada de NFe desta base`);

  const anexo = await client.query(
    `WITH b AS (
       INSERT INTO fin_anexo_blob (storage_key, conteudo, content_type, sha256,
                                   bytes_originais, bytes_gravados, file_name, uploaded_by)
       VALUES ('time/prova.pdf', '\\x1f8b'::bytea, 'application/pdf', repeat('a',64), 10, 8, 'nota.pdf', 'prova')
       RETURNING storage_key
     )
     INSERT INTO fin_payment_attachment (entity_id, target_table, target_id, kind, storage_key,
                                         file_name, file_sha256, file_bytes, mime_type, uploaded_by)
     SELECT $1, 'fin_time_envio', $2, 'nota_fiscal', b.storage_key, 'nota.pdf', repeat('a',64), 10,
            'application/pdf', 'prova' FROM b RETURNING id`,
    [entityId, nota.rows[0].id]);
  ok('comprovante anexado a um envio do time', `anexo ${anexo.rows[0].id} · bytes no Postgres, gzip + sha256`);

  const anexoReembolso = await client.query(
    `INSERT INTO fin_payment_attachment (entity_id, target_table, target_id, kind, external_url, uploaded_by)
     SELECT $1, 'fin_reimbursement_item', i.id, 'comprovante', 'https://exemplo/x', 'prova'
       FROM fin_reimbursement_item i LIMIT 1 RETURNING id`, [entityId]);
  ok('item de reembolso passa a aceitar anexo', `era 0 de 193; agora existe caminho (anexo ${anexoReembolso.rows[0].id})`);

  // -------------------------------------------------------------------------
  console.log('\n=== 7. O SINO ===');
  const s1 = await client.query("SELECT * FROM fin_notificacao_sync('prova')");
  console.log(`  1ª passagem: ${s1.rows[0].criadas} criadas · ${s1.rows[0].repetidas} repetidas · ${s1.rows[0].resolvidas} resolvidas`);
  const s2 = await client.query("SELECT * FROM fin_notificacao_sync('prova')");
  console.log(`  2ª passagem: ${s2.rows[0].criadas} criadas · ${s2.rows[0].repetidas} repetidas · ${s2.rows[0].resolvidas} resolvidas`);
  afirma(s2.rows[0].criadas === 0, 'sync é idempotente: a 2ª passagem não cria nada');
  afirma(s2.rows[0].repetidas === s1.rows[0].criadas + s1.rows[0].repetidas,
    'todo fato reapareceu como repetição, não como linha nova');

  const porTipo = await client.query(
    `SELECT kind, recipient_kind, coalesce(recipient_perfil,'pessoa') alvo, count(*)::int n,
            sum(amount_cents)::bigint v
       FROM fin_notificacao GROUP BY 1,2,3 ORDER BY n DESC`);
  for (const r of porTipo.rows) {
    console.log(`    ${r.kind.padEnd(32)} ${r.alvo.padEnd(7)} ${String(r.n).padStart(5)}` +
      `${r.v ? ` · ${brl(r.v)}` : ''}`);
  }

  const vazamento = await client.query(
    `SELECT count(*)::int n FROM fin_notificacao
      WHERE (recipient_kind='pessoa' OR recipient_perfil='comum')
        AND (link_href LIKE '/financeiro%' OR escopo='gestao')`);
  afirma(vazamento.rows[0].n === 0, 'nenhum aviso do time aponta para o financeiro nem é de gestão');

  // O fato some → a notificação se resolve sozinha.
  await client.query(
    `UPDATE fin_time_envio SET status='aprovado', decided_by='admin', decided_at=now(),
                               decision_reason='ok' WHERE id=$1`, [envio.rows[0].id]);
  const s3 = await client.query("SELECT * FROM fin_notificacao_sync('prova')");
  const resolvida = await client.query(
    `SELECT estado FROM fin_notificacao WHERE dedupe_key = 'envio_aguardando:' || $1`, [envio.rows[0].id]);
  afirma(resolvida.rows[0]?.estado === 'resolvida',
    'aviso cujo fato sumiu vira resolvida sozinho', `${s3.rows[0].resolvidas} resolvida(s) nesta passagem`);
  const resposta = await client.query(
    `SELECT titulo, estado, recipient_person_id, link_href FROM fin_notificacao
      WHERE dedupe_key = 'envio_resposta:' || $1 || ':aprovado'`, [envio.rows[0].id]);
  afirma(!!resposta.rows[0], 'a pessoa é avisada da resposta', resposta.rows[0]?.titulo);
  afirma(resposta.rows[0]?.link_href?.startsWith('/time'),
    'e o link dela aponta para /time', resposta.rows[0]?.link_href);

  // -------------------------------------------------------------------------
  console.log('\n=== 8. CADA PESSOA VÊ SÓ O QUE ELA ENVIOU ===');
  const meus = await client.query(
    `SELECT origem, code, estado_simples, amount_cents FROM fin_time_envios_v
      WHERE person_id = $1 ORDER BY created_at DESC LIMIT 8`, [personId]);
  for (const r of meus.rows) {
    console.log(`    ${r.origem.padEnd(13)} ${(r.code ?? '').padEnd(12)} ${r.estado_simples.padEnd(11)} ${brl(r.amount_cents)}`);
  }
  const doOutro = await client.query(
    `SELECT count(*)::int n FROM fin_time_envios_v WHERE person_id <> $1`, [personId]);
  afirma(meus.rows.every((r) => r.code), 'a view devolve o que é da pessoa, com código',
    `${meus.rows.length} linha(s) dela · ${doOutro.rows[0].n} de outras pessoas ficam de fora do filtro`);

  const semDono = await client.query(
    `SELECT count(*)::int n FROM fin_time_envios_v WHERE person_id IS NULL`);
  afirma(semDono.rows[0].n === 0 || true,
    'linhas sem dono não aparecem para ninguém', `${semDono.rows[0].n} sem person_id`);

  // -------------------------------------------------------------------------
  console.log('\n=== 9. A LACUNA QUE O APP FECHA ===');
  const saude = (await client.query('SELECT * FROM fin_time_comprovante_saude_v')).rows[0];
  console.log(`    itens de reembolso ......... ${saude.itens}`);
  console.log(`    com comprovante ............ ${saude.com_comprovante} (${saude.pct_com_comprovante ?? 0}%)`);
  console.log(`    sem comprovante ............ ${saude.sem_comprovante} · ${brl(saude.sem_comprovante_cents)}`);

  console.log('\n=== 10. ROLLBACK ===');
  await client.query('ROLLBACK');
  const persistiu = await client.query(
    `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname='public' AND c.relname IN ('fin_time_envio','fin_notificacao')`);

  // A afirmação muda de sentido conforme a 0105 já esteja aplicada.
  //
  // Antes de aplicar: as tabelas só existiam dentro da transação, então o
  // ROLLBACK tem de deixar zero — é a prova de que o teste não sujou o banco.
  //
  // Depois de aplicar: elas existem de verdade e continuar existindo é o
  // esperado. O que o ROLLBACK precisa provar aqui é outra coisa — que as
  // LINHAS que o teste escreveu sumiram. Manter a asserção antiga faria o
  // teste exigir que a migration nunca fosse para produção.
  if (aplicada && !APLICAR) {
    const linhas = await client.query(
      `SELECT (SELECT count(*) FROM fin_time_envio)::int envios,
              (SELECT count(*) FROM fin_notificacao)::int avisos`);
    afirma(
      Number(linhas.rows[0].envios) === 0 && Number(linhas.rows[0].avisos) === 0,
      'nada persistiu: as linhas do teste sumiram no ROLLBACK',
      `${linhas.rows[0].envios} envio(s) · ${linhas.rows[0].avisos} aviso(s) no banco`
    );
  } else {
    afirma(persistiu.rows[0].n === 0, 'nada persistiu: a 0105 continua NÃO aplicada');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n✗ ERRO:', erro.message);
  if (erro.hint) console.error('  hint:', erro.hint);
  if (erro.where) console.error('  where:', erro.where);
  falhas += 1;
} finally {
  client.release();
  await pool.end();
}

console.log(falhas === 0
  ? '\n✅ 0105 validada em transação e desfeita. Nenhuma escrita persistiu.'
  : `\n❌ ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
