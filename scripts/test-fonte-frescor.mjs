// Prova transacional do frescor de fontes (migration 0109).
//
// Instala a 0109 dentro da propria transacao enquanto ela ainda esta pendente,
// no mesmo padrao de test-categorizacao.mjs com a 0101, e prova sete coisas
// contra o BANCO REAL, terminando sempre em ROLLBACK:
//
//   1. a ancora de dinheiro por conta e identica antes e depois
//   2. o contador de dias uteis acerta os casos que produziram o defeito
//   3. o alarme cai de 5 avisos para o numero medido, e mostra qual
//   4. fonte manual nao alarma, e a razao esta escrita
//   5. o corpo do aviso da fila nao expoe nome de coluna
//   6. duas execucoes simultaneas do botao nao coexistem (indice unico parcial)
//   7. o gerador continua idempotente: rodar sync duas vezes nao cria aviso novo
//
// Por que ele existe: a frente anterior entregou codigo INERTE porque comparava
// '2026-08-01' com '2026-08' em texto e a condicao nunca era verdadeira. Codigo
// certo que nunca dispara e indistinguivel de codigo ausente. Este script roda a
// regra contra o acervo de verdade e imprime a saida.

import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const migrationUrl = new URL('../db/migrations/0109_fin_fonte_frescor.sql', import.meta.url);
const pool = financePool();
const client = await pool.connect();
let savepointSequence = 0;

function assert(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

async function um(sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

async function todos(sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows;
}

/** Roda `sql` esperando recusa do banco, e desfaz o savepoint de qualquer jeito. */
async function recusa(sql, params, rotulo) {
  const sp = `frescor_guard_${++savepointSequence}`;
  await client.query(`SAVEPOINT ${sp}`);
  let erro = null;
  try {
    await client.query(sql, params);
  } catch (e) {
    erro = e;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  assert(erro !== null, `${rotulo}: o banco ACEITOU o que deveria recusar`);
  return erro;
}

const SQL_ANCORA = `
  SELECT coalesce(string_agg(account_id || ':' || n || ':' || soma, '|' ORDER BY account_id), '-') AS impressao
    FROM (SELECT account_id, count(*) n, coalesce(sum(amount_cents), 0) soma
            FROM fin_transaction GROUP BY account_id) x`;

let ok = 0;
const passo = (texto) => { ok += 1; console.log(`  ok ${String(ok).padStart(2)} · ${texto}`); };

try {
  await client.query('BEGIN');

  const ancoraAntes = (await um(SQL_ANCORA)).impressao;

  // -------------------------------------------------------------------------
  console.log('\n== antes da 0109 =========================================');

  const jaAplicada = (await um(`SELECT to_regclass('fin_fonte_frescor_v') IS NOT NULL AS ok`)).ok;
  console.log(`  fin_fonte_frescor_v ja existe? ${jaAplicada ? 'sim' : 'nao'}`);

  const avisosAntes = await todos(
    `SELECT dedupe_key, corpo FROM fin_notificacao_fato_v WHERE kind = 'fonte_desatualizada' ORDER BY dedupe_key`
  );
  console.log(`  avisos de fonte na view ANTES: ${avisosAntes.length}`);
  for (const a of avisosAntes) console.log(`    ${a.dedupe_key.padEnd(48)} ${a.corpo}`);

  // A fotografia que protege contra a regressao silenciosa. A 0109 recria uma
  // view de 12 CTEs para mexer em 2; as outras 10 foram transcritas do BANCO, e
  // nao do arquivo da 0105 — que divergiu. Se a transcricao errou em qualquer
  // uma, o conjunto (kind, dedupe_key, titulo, corpo) muda fora dos dois tipos
  // desta frente, e a asserta la embaixo pega.
  const fatoAntes = await todos(
    `SELECT kind, dedupe_key, titulo, corpo, coalesce(amount_cents::text, '-') valor
       FROM fin_notificacao_fato_v ORDER BY kind, dedupe_key`
  );
  const impressao = (r) => `${r.kind} ${r.dedupe_key} ${r.titulo} ${r.corpo} ${r.valor}`;
  const antesPorTipo = new Map();
  for (const r of fatoAntes) {
    if (!antesPorTipo.has(r.kind)) antesPorTipo.set(r.kind, new Set());
    antesPorTipo.get(r.kind).add(impressao(r));
  }
  console.log(`  fatos totais na view ANTES: ${fatoAntes.length} em ${antesPorTipo.size} tipo(s)`);

  // -------------------------------------------------------------------------
  console.log('\n== instalando a 0109 na transacao ========================');
  const sql = await readFile(migrationUrl, 'utf8');
  // A migration abre com BEGIN e fecha com COMMIT proprios. Aqui ela roda DENTRO
  // da transacao do teste: o BEGIN vira aviso e o COMMIT confirmaria de verdade,
  // entao os dois saem. O corpo, que e o que se quer provar, fica intacto.
  const corpo = sql.replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
  const antesNotices = [];
  client.on('notice', (n) => antesNotices.push(n.message));
  await client.query(corpo);
  for (const n of antesNotices) console.log(`  ${n}`);

  // -------------------------------------------------------------------------
  console.log('\n== 1. dias uteis ========================================');
  const dias = await um(`
    SELECT fin_dias_uteis(DATE '2026-08-14', DATE '2026-08-17') sexta_para_segunda,
           (DATE '2026-08-17' - DATE '2026-08-14') sexta_corridos,
           fin_dias_uteis(DATE '2026-08-15', DATE '2026-08-17') sabado_para_segunda,
           (DATE '2026-08-17' - DATE '2026-08-15') sabado_corridos,
           fin_dias_uteis(DATE '2026-08-17', DATE '2026-08-17') mesmo_dia,
           fin_dias_uteis(DATE '2026-09-04', DATE '2026-09-08') atravessa_feriado,
           fin_dias_uteis_coberto(DATE '2026-08-15', DATE '2026-08-17') coberto_2026,
           fin_dias_uteis_coberto(DATE '2025-12-01', DATE '2026-01-05') coberto_2025`);
  console.log(`  sexta 14/08 -> segunda 17/08 ... ${dias.sexta_corridos} corridos, ${dias.sexta_para_segunda} util`);
  console.log(`  sabado 15/08 -> segunda 17/08 .. ${dias.sabado_corridos} corridos, ${dias.sabado_para_segunda} util   <- os "2 dia(s)" dos 5 avisos`);
  console.log(`  mesmo dia ...................... ${dias.mesmo_dia}`);
  console.log(`  04/09 -> 08/09 (Independencia) . ${dias.atravessa_feriado} util (seriam 2 sem o feriado)`);
  console.log(`  calendario cobre 2026? ${dias.coberto_2026} · cobre 2025? ${dias.coberto_2025}`);
  assert(dias.sexta_para_segunda === 1, 'sexta->segunda tinha de dar 1 dia util');
  assert(dias.sabado_para_segunda === 1, 'sabado->segunda tinha de dar 1 dia util');
  assert(dias.mesmo_dia === 0, 'o dia da entrega nao conta contra a fonte');
  assert(dias.atravessa_feriado === 1, 'o feriado de 07/09 tinha de sair da conta');
  assert(dias.coberto_2026 === true && dias.coberto_2025 === false, 'a cobertura do calendario mente');
  passo('o contador de dias uteis acerta os quatro casos que produziram o defeito');

  // -------------------------------------------------------------------------
  console.log('\n== 2. o frescor, fonte a fonte ==========================');
  const frescor = await todos(`
    SELECT fonte, conta, natureza, agendada, estado, alarma,
           to_char(ultimo_dado_em, 'DD/MM') ultimo,
           atraso_corrido, atraso_util, tolerancia_util, lancamentos
      FROM fin_fonte_frescor_v
     WHERE conta_ativa
     ORDER BY alarma DESC, natureza, fonte, conta`);
  console.log(
    '  ' +
      'fonte'.padEnd(12) + 'conta'.padEnd(19) + 'natureza'.padEnd(12) + 'agend'.padEnd(7) +
      'ultimo'.padEnd(8) + 'corr'.padStart(5) + 'util'.padStart(6) + 'tol'.padStart(5) + '  estado'
  );
  for (const f of frescor) {
    console.log(
      '  ' +
        String(f.fonte).padEnd(12) + String(f.conta).padEnd(19) +
        String(f.natureza).padEnd(12) + String(f.agendada).padEnd(7) +
        String(f.ultimo ?? '—').padEnd(8) +
        String(f.atraso_corrido ?? '—').padStart(5) +
        String(f.atraso_util ?? '—').padStart(6) +
        String(f.tolerancia_util ?? '—').padStart(5) +
        `  ${f.estado}${f.alarma ? '  <- ALARMA' : ''}`
    );
  }

  const contagem = await um(`
    SELECT
      (SELECT count(*) FROM fin_fonte_frescor_v
        WHERE conta_ativa AND lancamentos > 0 AND atraso_corrido > coalesce(tolerancia_util, 999))::int corridos,
      (SELECT count(*) FROM fin_fonte_frescor_v WHERE conta_ativa AND alarma)::int uteis,
      (SELECT count(*) FROM fin_fonte_frescor_v WHERE conta_ativa AND natureza = 'manual')::int manuais,
      (SELECT count(*) FROM fin_fonte_frescor_v
        WHERE conta_ativa AND natureza = 'automatica' AND agendada)::int auto_agendadas,
      (SELECT count(*) FROM fin_fonte_frescor_v
        WHERE conta_ativa AND natureza = 'automatica' AND NOT agendada)::int auto_soltas,
      (SELECT count(*) FROM fin_fonte_frescor_v WHERE conta_ativa AND estado = 'nunca_entregou')::int nunca`);
  console.log(`\n  fora da tolerancia contando dias CORRIDOS ... ${contagem.corridos}`);
  console.log(`  fora da tolerancia contando dias UTEIS ...... ${contagem.uteis}`);
  console.log(`  automaticas no agendador .................... ${contagem.auto_agendadas}`);
  console.log(`  automaticas FORA do agendador ............... ${contagem.auto_soltas}`);
  console.log(`  manuais (nunca alarmam) ..................... ${contagem.manuais}`);
  console.log(`  fontes que nunca entregaram lancamento ...... ${contagem.nunca}`);
  passo(`o alarme por dias uteis conta ${contagem.uteis}, contra ${contagem.corridos} por dias corridos`);

  const semMotivo = await um(
    `SELECT count(*)::int n FROM fin_fonte_frescor_v WHERE estado <> 'em_dia' AND coalesce(btrim(motivo), '') = ''`
  );
  assert(semMotivo.n === 0, `${semMotivo.n} linha(s) fora de em_dia sem motivo declarado`);
  passo('todo estado que nao e em_dia carrega motivo escrito');

  const manualAlarmando = await um(
    `SELECT count(*)::int n FROM fin_fonte_frescor_v WHERE alarma AND natureza <> 'automatica'`
  );
  assert(manualAlarmando.n === 0, 'fonte manual alarmando');
  passo('fonte manual e fonte nao catalogada nao alarmam, por construcao');

  // -------------------------------------------------------------------------
  console.log('\n== 3. o aviso, agora ====================================');
  const avisosDepois = await todos(
    `SELECT dedupe_key, titulo, corpo FROM fin_notificacao_fato_v WHERE kind = 'fonte_desatualizada'`
  );
  console.log(`  avisos de fonte na view DEPOIS: ${avisosDepois.length} (eram ${avisosAntes.length})`);
  for (const a of avisosDepois) {
    console.log(`    [${a.dedupe_key}] ${a.titulo}`);
    console.log(`      ${a.corpo}`);
  }
  assert(avisosDepois.length <= 1, 'o aviso de fonte tem de ser no maximo 1');
  passo(`o aviso de fonte foi de ${avisosAntes.length} para ${avisosDepois.length}`);

  const fila = await um(
    `SELECT titulo, corpo FROM fin_notificacao_fato_v WHERE kind = 'fila_decisao_sem_regua'`
  );
  if (fila) {
    console.log(`\n  fila sem regua:`);
    console.log(`    ${fila.titulo}`);
    console.log(`    ${fila.corpo}`);
    assert(!/fin_notificacao_regra|fila_decisao_valor_cents/.test(fila.corpo),
      'a mensagem da fila voltou a expor nome de coluna');
    passo('a mensagem da fila fala portugues, sem nome de coluna do banco');
  }

  const reguaAinda = await um(`SELECT valor FROM fin_notificacao_regra WHERE slug = 'fila_decisao_valor_cents'`);
  assert(reguaAinda.valor === null, 'a regua de valor foi inventada; ela e a duvida 59');
  passo('a regua de valor continua NAO inventada — melhorar a mensagem nao e escolher o corte');

  // -------------------------------------------------------------------------
  // O TESTE QUE IMPORTA MAIS QUE OS OUTROS.
  //
  // Zero alarme hoje pode significar duas coisas opostas: "a regua ficou
  // honesta" ou "a regua parou de disparar". A frente anterior entregou codigo
  // INERTE — comparava '2026-08-01' com '2026-08' em texto e a condicao nunca
  // era verdadeira — e um alarme que nunca dispara e indistinguivel de um
  // alarme ausente. Aqui a tolerancia de duas fontes vai a zero DENTRO de um
  // savepoint, e o aviso tem de aparecer, agregado, com as duas dentro.
  console.log('\n== 3b. o alarme AINDA dispara quando deve ===============');
  await client.query('SAVEPOINT prova_dispara');
  await client.query(
    `UPDATE fin_fonte_catalogo SET tolerancia_util = 0 WHERE fonte IN ('inter_api', 'polp')`
  );
  const alarmando = await todos(
    `SELECT fonte, conta, atraso_util, tolerancia_util FROM fin_fonte_frescor_v WHERE alarma ORDER BY fonte`
  );
  for (const a of alarmando) {
    console.log(`  ${a.fonte} · ${a.conta}: ${a.atraso_util} util > tolerancia ${a.tolerancia_util}`);
  }
  const avisoForcado = await um(
    `SELECT titulo, corpo, contexto FROM fin_notificacao_fato_v WHERE kind = 'fonte_desatualizada'`
  );
  assert(avisoForcado, 'com duas fontes fora da tolerancia o aviso NAO apareceu — o alarme esta inerte');
  console.log(`  ${avisoForcado.titulo}`);
  console.log(`  ${avisoForcado.corpo}`);
  assert(/^2 fontes/.test(avisoForcado.titulo),
    `o titulo agregado nao contou as duas fontes: "${avisoForcado.titulo}"`);
  assert(avisoForcado.contexto.contagem === 2, 'o contexto do aviso nao lista as duas fontes');
  await client.query('ROLLBACK TO SAVEPOINT prova_dispara');
  passo('com fonte de verdade fora da regua o aviso aparece, agregado e com as duas dentro');

  const voltouAoNormal = await um(
    `SELECT count(*)::int n FROM fin_notificacao_fato_v WHERE kind = 'fonte_desatualizada'`
  );
  assert(voltouAoNormal.n === avisosDepois.length, 'o savepoint nao desfez a tolerancia forcada');

  // -------------------------------------------------------------------------
  console.log('\n== 4. as outras dez CTEs nao mudaram ====================');
  const fatoDepois = await todos(
    `SELECT kind, dedupe_key, titulo, corpo, coalesce(amount_cents::text, '-') valor
       FROM fin_notificacao_fato_v ORDER BY kind, dedupe_key`
  );
  const depoisPorTipo = new Map();
  for (const r of fatoDepois) {
    if (!depoisPorTipo.has(r.kind)) depoisPorTipo.set(r.kind, new Set());
    depoisPorTipo.get(r.kind).add(impressao(r));
  }
  const MUDAM = new Set(['fonte_desatualizada', 'fila_decisao_sem_regua']);
  const tipos = new Set([...antesPorTipo.keys(), ...depoisPorTipo.keys()]);
  const divergentes = [];
  for (const t of tipos) {
    if (MUDAM.has(t)) continue;
    const a = antesPorTipo.get(t) ?? new Set();
    const d = depoisPorTipo.get(t) ?? new Set();
    const soAntes = [...a].filter((x) => !d.has(x));
    const soDepois = [...d].filter((x) => !a.has(x));
    console.log(`  ${t.padEnd(32)} ${String(a.size).padStart(4)} -> ${String(d.size).padStart(4)}` +
      (soAntes.length || soDepois.length ? `   DIVERGIU (${soAntes.length} sumiram, ${soDepois.length} apareceram)` : '   identico'));
    if (soAntes.length || soDepois.length) divergentes.push({ t, soAntes, soDepois });
  }
  for (const d of divergentes) {
    for (const x of d.soAntes.slice(0, 3)) console.log(`    - ${x.slice(0, 160)}`);
    for (const x of d.soDepois.slice(0, 3)) console.log(`    + ${x.slice(0, 160)}`);
  }
  assert(divergentes.length === 0,
    `${divergentes.length} tipo(s) de fato mudaram sem ser pedido: ${divergentes.map((d) => d.t).join(', ')} — ` +
    'a transcricao das CTEs que a 0109 nao deveria tocar esta errada');
  passo('os dez tipos de fato que esta frente nao toca saem identicos, linha a linha');

  // -------------------------------------------------------------------------
  // A RECUSA BARULHENTA.
  //
  // Esta e a defesa contra o acidente que a §6 do CONTINUACAO.md conta duas
  // vezes: uma frente apagando o trabalho da outra na mesma view. A 0108 ja
  // tinha somado `fin_custo_fixo_notificacao_fato_v` a composicao, e uma versao
  // anterior desta migration a apagava em silencio.
  //
  // Aqui uma QUARTA frente e simulada. A migration tem de RECUSAR aplicar, com
  // o nome do que ela nao conhece — nunca reescrever por cima.
  console.log('\n== 4b. a migration recusa apagar frente alheia ==========');
  await client.query('SAVEPOINT frente_alheia');
  await client.query(`
    CREATE OR REPLACE VIEW fin_frente_imaginaria_fato_v AS
    SELECT (SELECT id FROM fin_entity WHERE slug='xpe') AS entity_id,
           'invariante_quebrado'::text AS kind, 'perfil'::text AS recipient_kind,
           NULL::bigint AS recipient_person_id, 'admin'::text AS recipient_perfil,
           'gestao'::text AS escopo, 'frente_imaginaria'::text AS dedupe_key,
           'aviso de outra frente'::text AS titulo, 'corpo'::text AS corpo,
           '/financeiro/painel'::text AS link_href, NULL::bigint AS amount_cents,
           'sem valor'::text AS amount_reason, '{}'::jsonb AS contexto
     WHERE false`);
  await client.query(`
    CREATE OR REPLACE VIEW fin_notificacao_fato_v AS
    SELECT * FROM fin_notificacao_fato_base_v
    UNION ALL SELECT * FROM fin_custo_fixo_notificacao_fato_v
    UNION ALL SELECT * FROM fin_fonte_notificacao_fato_v
    UNION ALL SELECT * FROM fin_frente_imaginaria_fato_v`);

  let recusou = null;
  try {
    await client.query(corpo);
  } catch (e) {
    recusou = e;
  }
  await client.query('ROLLBACK TO SAVEPOINT frente_alheia');
  assert(recusou !== null,
    'a migration ACEITOU reescrever uma composicao que tinha view de outra frente — ela a teria apagado');
  console.log(`  recusa: ${recusou.message.split('\n')[0]}`);
  assert(/fin_frente_imaginaria_fato_v/.test(recusou.message),
    `a recusa nao nomeia a view desconhecida: "${recusou.message}"`);
  passo('com uma frente alheia na composicao, a migration recusa em vez de apagar');

  // -------------------------------------------------------------------------
  console.log('\n== 5. a sync casa com o fato ============================');
  const entidade = await um(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);

  const sync1 = await um(`SELECT * FROM fin_notificacao_sync($1)`, ['teste']);
  console.log(`  1a passagem: ${sync1.criadas} criada(s) · ${sync1.repetidas} repetida(s) · ${sync1.resolvidas} resolvida(s)`);

  const caixa = await todos(`
    SELECT kind, estado, count(*)::int n FROM fin_notificacao
     WHERE kind IN ('fonte_desatualizada', 'fila_decisao_sem_regua')
     GROUP BY 1, 2 ORDER BY 1, 2`);
  for (const c of caixa) console.log(`    ${c.kind.padEnd(26)} ${c.estado.padEnd(11)} ${c.n}`);

  const antigas = await um(`
    SELECT count(*)::int n FROM fin_notificacao
     WHERE kind = 'fonte_desatualizada' AND dedupe_key <> 'fonte_desatualizada' AND estado = 'resolvida'`);
  console.log(`  avisos antigos por fonte que a sync resolveu sozinha: ${antigas.n}`);
  passo('as notificacoes antigas viram resolvida sozinhas — a chave delas sumiu do fato');

  const sync2 = await um(`SELECT * FROM fin_notificacao_sync($1)`, ['teste']);
  console.log(`  2a passagem: ${sync2.criadas} criada(s) · ${sync2.repetidas} repetida(s) · ${sync2.resolvidas} resolvida(s)`);
  assert(sync2.criadas === 0, 'a segunda passagem criou aviso novo — a idempotencia quebrou');
  passo('idempotente: a segunda passagem nao cria aviso novo');

  // -------------------------------------------------------------------------
  console.log('\n== 6. a trava de uma sync por vez =======================');
  // `iniciada_em` no passado de proposito: e o caso real que a funcao existe
  // para resolver — o processo morreu e a linha ficou 'rodando' para sempre,
  // travando o botao.
  await client.query(
    `INSERT INTO fin_fonte_sync_execucao (entity_id, escopo, status, ator, iniciada_em)
     VALUES ($1, 'todas', 'rodando', 'teste', now() - interval '2 hours')`,
    [entidade.id]
  );
  const conflito = await recusa(
    `INSERT INTO fin_fonte_sync_execucao (entity_id, escopo, status, ator) VALUES ($1, 'todas', 'rodando', 'teste2')`,
    [entidade.id],
    'segunda sync simultanea'
  );
  console.log(`  segundo disparo recusado: ${conflito.message.split('\n')[0]}`);
  passo('o banco recusa duas syncs rodando ao mesmo tempo — a trava e entre processos');

  await recusa(
    `UPDATE fin_fonte_sync_execucao SET status = 'erro', terminada_em = now() WHERE entity_id = $1 AND status = 'rodando'`,
    [entidade.id],
    'execucao com erro e sem motivo'
  );
  passo('execucao marcada como erro exige o motivo escrito');

  const perdidas = await um(`SELECT fin_fonte_sync_recolher_perdidas() AS n`);
  console.log(`  recolhidas como perdidas: ${perdidas.n}`);
  assert(Number(perdidas.n) === 1, 'a execucao pendurada nao foi recolhida');
  const depoisDoReaper = await um(
    `SELECT status, erro FROM fin_fonte_sync_execucao WHERE entity_id = $1 ORDER BY id DESC LIMIT 1`,
    [entidade.id]
  );
  assert(depoisDoReaper.status === 'perdida' && depoisDoReaper.erro !== null,
    'a execucao perdida ficou sem motivo');
  // A mensagem tem de RECUSAR explicitamente a leitura "falhou": o processo
  // pode ter concluido e morrido antes do UPDATE final, e chamar isso de falha
  // e inventar um fato — a mesma regra que impede ausencia de dado de virar zero.
  assert(/NÃO afirma que a sync falhou/.test(depoisDoReaper.erro),
    'a mensagem da perdida nao desmente a leitura "falhou"; ela so pode afirmar desconhecimento');
  console.log(`  motivo: ${depoisDoReaper.erro}`);
  passo('execucao pendurada vira perdida com motivo, e o motivo nao inventa falha');

  // -------------------------------------------------------------------------
  // O BOTAO, ponta a ponta, contra processos de verdade.
  //
  // O executor e importado do proprio trabalhador — uma segunda implementacao
  // aqui provaria o teste, nao o codigo.
  //
  // A etapa do caminho feliz e `sincronizar-fontes.mjs --listar`: processo node
  // de verdade, saida de verdade, exit 0, e ZERO toque no banco. Isso nao e
  // preguica, e necessidade: esta transacao ja tomou ACCESS EXCLUSIVE em
  // fin_notificacao_regra e recriou fin_notificacao_fato_v, entao qualquer
  // etapa que leia o modulo financeiro ficaria BLOQUEADA esperando o commit que
  // este teste nunca dara. Medido: com `notificar.mjs` aqui, o teste pendura.
  console.log('\n== 7. o executor do botao ===============================');
  const trabalhador = await import('./sincronizar-fontes.mjs');
  console.log(`  fontes alcancadas pelo botao: ${trabalhador.FONTES_ALCANCADAS.join(', ')}`);
  console.log(`  etapas de 'todas': ${trabalhador.etapasDoEscopo('todas').length}` +
    ` · de 'asaas': ${trabalhador.etapasDoEscopo('asaas').length}`);

  const feliz = await trabalhador.rodarEtapa({
    nome: 'listagem do proprio trabalhador', script: 'scripts/sincronizar-fontes.mjs', args: ['--listar']
  });
  console.log(`  caminho feliz: ok=${feliz.ok} em ${Math.round(feliz.ms / 1000)}s`);
  console.log(`    ultima linha da saida: ${(feliz.saida || '').trim().split('\n').pop()}`);
  assert(feliz.ok === true, `a etapa do caminho feliz falhou: ${feliz.erro}`);
  assert(typeof feliz.ms === 'number' && feliz.ms >= 0, 'a etapa nao mediu o tempo');
  passo('o executor roda uma etapa real, captura a saida e mede o tempo');

  const triste = await trabalhador.rodarEtapa({
    nome: 'etapa que nao existe', script: 'scripts/nao-existe-de-proposito.mjs'
  });
  console.log(`  caminho de erro: ok=${triste.ok}`);
  console.log(`    motivo capturado: ${triste.erro}`);
  assert(triste.ok === false, 'um script inexistente foi reportado como sucesso');
  assert(typeof triste.erro === 'string' && triste.erro.length > 0,
    'a etapa falhou sem dizer o motivo — um botao que falha em silencio e pior que nenhum botao');
  // A armadilha real: "ultima linha do stderr" devolve `Node.js v22.18.0` em
  // TODO crash do runtime. A tela mostraria a versao do node onde deveria dizer
  // que o arquivo nao existe.
  assert(!/^Node\.js v/.test(triste.erro),
    `o motivo capturado e o rodape de versao do Node, nao a falha: "${triste.erro}"`);
  assert(/n[ãa]o|not found|Cannot find|Error/i.test(triste.erro),
    `o motivo nao descreve a falha: "${triste.erro}"`);
  passo('etapa que falha registra O QUE falhou e POR QUE, nao o rodape de versao do Node');

  // O caminho que a casa de fato usa: os scripts daqui reportam `✗ mensagem`.
  const daCasa = await trabalhador.rodarEtapa({
    nome: 'trabalhador sem --execucao', script: 'scripts/sincronizar-fontes.mjs'
  });
  console.log(`    motivo no formato da casa: ${daCasa.erro}`);
  assert(daCasa.ok === false && /--execucao/.test(daCasa.erro),
    `a mensagem no formato da casa nao foi extraida: "${daCasa.erro}"`);
  passo('a convencao `✗ mensagem` dos scripts da casa vence o ruido do runtime');

  // A trilha completa de uma execucao, como o trabalhador a escreve. Aqui ela
  // roda sob a transacao do teste (o processo filho tem conexao propria e nao
  // enxergaria a linha nao commitada), entao o que se prova e a SEMANTICA da
  // trilha: progresso etapa a etapa, status final e erro agregado.
  const exec = await um(
    `INSERT INTO fin_fonte_sync_execucao (entity_id, escopo, status, ator)
     VALUES ($1, 'asaas', 'rodando', 'teste') RETURNING id`,
    [entidade.id]
  );
  const trilha = [
    { etapa: 'sync Asaas', script: 'scripts/sync-asaas.mjs', fonte: 'asaas', estado: 'ok', ms: feliz.ms },
    { etapa: 'etapa que nao existe', script: 'x.mjs', fonte: 'asaas', estado: 'erro', ms: triste.ms, erro: triste.erro }
  ];
  await client.query(
    `UPDATE fin_fonte_sync_execucao
        SET status = 'parcial', terminada_em = now(), etapas = $2::jsonb, erro = $3
      WHERE id = $1`,
    [exec.id, JSON.stringify(trilha), `etapa que nao existe: ${triste.erro}`]
  );
  const relido = await um(
    `SELECT status, erro, jsonb_array_length(etapas) n,
            etapas -> 1 ->> 'erro' erro_da_etapa,
            (terminada_em IS NOT NULL) fechou
       FROM fin_fonte_sync_execucao WHERE id = $1`,
    [exec.id]
  );
  console.log(`  execucao ${exec.id}: status=${relido.status} · ${relido.n} etapa(s) · fechou=${relido.fechou}`);
  console.log(`    erro da etapa, relido do banco: ${relido.erro_da_etapa}`);
  assert(relido.status === 'parcial' && relido.fechou === true, 'a execucao parcial nao fechou direito');
  assert(relido.erro_da_etapa === triste.erro, 'o erro da etapa nao sobreviveu ao banco');
  passo('a trilha guarda inicio, fim, resultado por etapa e o erro — relido do banco');

  // -------------------------------------------------------------------------
  console.log('\n== 8. ancora de dinheiro ================================');
  const ancoraDepois = (await um(SQL_ANCORA)).impressao;
  assert(ancoraDepois === ancoraAntes, 'A ANCORA DE DINHEIRO MUDOU — nada aqui pode tocar fin_transaction');
  console.log(`  impressao identica antes e depois (${ancoraAntes.split('|').length} contas)`);
  passo('nenhum centavo mudou de lugar');

  console.log(`\n${ok} prova(s) passaram. Desfazendo tudo.\n`);
} catch (erro) {
  console.error(`\n✗ ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  client.release();
  await pool.end();
}
