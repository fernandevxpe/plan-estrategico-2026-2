// Prova transacional da central de categorizacao (migration 0101).
//
// A migration e instalada dentro da propria transacao enquanto ainda esta
// pendente, exatamente como test-duplicidade-casos.mjs faz com a 0087. O teste
// fotografa a ancora de dinheiro, prova o alcance da busca nos tres universos,
// exercita as tres recusas do banco, roda a reclassificacao em lote na ORDEM
// que o gatilho da 0094 exige e confere que a trava humana ficou ESCRITA,
// relendo do banco. Tudo termina em ROLLBACK.
//
// Por que ele existe separado de test-integridade: os invariantes medem o
// estado; este script mede o COMPORTAMENTO de uma escrita que ainda nao
// aconteceu na base. Sao perguntas diferentes.

import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const migrationUrl = new URL('../db/migrations/0101_fin_categorizacao_central.sql', import.meta.url);
const pool = financePool();
const client = await pool.connect();
let savepointSequence = 0;

const brl = (cents) =>
  (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Os seis invariantes que esta frente promete nao piorar, numa consulta so.
 *
 * Medidos DUAS vezes na mesma transacao — antes e depois das escritas — porque
 * a regua e "nao piorar", nao "zerar". D6 chega aqui com violacoes vivas e
 * vermelhas de proposito (coorte B da §11 do CONTINUACAO.md, duvida 40).
 */
const SQL_INVARIANTES = `
  SELECT
    (SELECT count(*) FROM fin_transaction
      WHERE human_locked_fields <> '{}' AND COALESCE(classified_by, '') NOT IN ('humano','trava'))::text AS e1,
    (SELECT count(*) FROM fin_transaction
      WHERE ('category_id' = ANY(human_locked_fields) AND category_id IS NULL)
         OR ('nucleo' = ANY(human_locked_fields) AND nucleo IS NULL))::text AS e2,
    (SELECT count(*) FROM fin_transaction t LEFT JOIN fin_category c ON c.id = t.category_id
      WHERE NOT t.is_split_parent AND (t.category_id IS NULL OR c.code IN ('3.99','5.99'))
        AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                         WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id
                           AND ri.status = 'pendente'))::text AS h3,
    (SELECT count(*) FROM fin_transaction t
      WHERE t.review_status = 'pendente'
        AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                         WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id
                           AND ri.status = 'pendente'))::text AS h4,
    (SELECT count(*) FROM fin_transaction t LEFT JOIN fin_rule r ON r.id = t.classified_rule_id
      WHERE t.classified_rule_id IS NOT NULL AND (r.id IS NULL OR r.status <> 'ativa'))::text AS d1,
    (SELECT count(*) FROM fin_transaction
      WHERE (classified_by = 'regra' AND classified_rule_id IS NULL)
         OR (classified_rule_id IS NOT NULL
             AND classified_by NOT IN ('regra','fato_estrutural')))::text AS d6`;

async function um(sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

/** Roda `sql` esperando recusa, e desfaz o savepoint de qualquer jeito. */
async function recusa(sql, params, rotulo, padrao) {
  const sp = `categ_guard_${++savepointSequence}`;
  await client.query(`SAVEPOINT ${sp}`);
  let erro = null;
  try {
    await client.query(sql, params);
  } catch (e) {
    erro = e;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  await client.query(`RELEASE SAVEPOINT ${sp}`);
  assert(erro, `${rotulo}: passou quando deveria ter sido recusado`);
  assert(padrao.test(erro.message), `${rotulo}: recusado, mas por outro motivo — ${erro.message}`);
  return erro.message;
}

async function ancora() {
  const { rows } = await client.query(
    `SELECT account_id, count(*)::text AS n, COALESCE(sum(amount_cents), 0)::text AS soma
       FROM fin_transaction GROUP BY account_id ORDER BY account_id`
  );
  return JSON.stringify(rows);
}

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");

  const ancoraAntes = await ancora();
  const { instalada: jaInstalada } = await um(
    `SELECT to_regclass('fin_categorizavel_v') IS NOT NULL AS instalada`
  );
  if (!jaInstalada) {
    await client.query(await readFile(migrationUrl, 'utf8'));
  }
  const baseline = await um(SQL_INVARIANTES);

  // -------------------------------------------------------------------------
  // 1. ALCANCE — a busca cobre os tres universos, sem perder nem duplicar
  // -------------------------------------------------------------------------
  const alcance = await um(
    `SELECT count(*) FILTER (WHERE universo = 'lancamento')::text  AS lancamento,
            count(*) FILTER (WHERE universo = 'documento')::text   AS documento,
            count(*) FILTER (WHERE universo = 'item_cartao')::text AS item_cartao,
            count(*)::text                                          AS total
       FROM fin_categorizavel_v`
  );
  const fonte = await um(
    `SELECT (SELECT count(*) FROM fin_transaction WHERE NOT is_split_parent)::text AS lancamento,
            (SELECT count(*) FROM fin_document)::text                              AS documento,
            (SELECT count(*) FROM fin_card_transaction)::text                      AS item_cartao`
  );
  for (const u of ['lancamento', 'documento', 'item_cartao']) {
    assert(alcance[u] === fonte[u], `a busca perdeu ${u}: ${alcance[u]} na view, ${fonte[u]} na tabela`);
  }
  const { n: duplicadas } = await um(
    `SELECT count(*)::text AS n FROM (
       SELECT universo, id FROM fin_categorizavel_v GROUP BY 1, 2 HAVING count(*) > 1) d`
  );
  assert(duplicadas === '0', `${duplicadas} par(es) (universo, id) repetidos — um LEFT JOIN multiplicou linha`);

  // -------------------------------------------------------------------------
  // 2. O BURACO QUE A BUSCA TORNA VISIVEL
  // -------------------------------------------------------------------------
  const { rows: forDoPainel } = await client.query(
    `SELECT universo, count(*)::text AS n, sum(valor_abs_cents)::text AS valor
       FROM fin_categorizavel_v
      WHERE estado = 'indeterminado' AND universo <> 'lancamento' AND classificavel
      GROUP BY 1 ORDER BY 1`
  );
  const { n: semMotivo } = await um(
    `SELECT count(*)::text AS n FROM fin_categorizavel_v WHERE motivo_indeterminado = 'sem-motivo-declarado'`
  );
  const { n: semMotivoNulo } = await um(
    `SELECT count(*)::text AS n FROM fin_categorizavel_v
      WHERE estado = 'indeterminado' AND motivo_indeterminado IS NULL`
  );
  assert(semMotivoNulo === '0', 'ha item indeterminado com a coluna de motivo em branco — a view deve nomear o vazio');

  // -------------------------------------------------------------------------
  // 3. AS TRES RECUSAS DO BANCO
  // -------------------------------------------------------------------------
  await recusa(
    `UPDATE fin_category SET name = 'Outras receitas' WHERE code = '3.99'`,
    [], '3.99 renomear', /marcador de indecis/i
  );
  await recusa(
    `UPDATE fin_category SET cash_flow_group = 'custos-diretos' WHERE code = '5.99'`,
    [], '5.99 reagrupar', /agrupamento dela n/i
  );
  await recusa(
    `UPDATE fin_category SET is_active = false WHERE code = '5.99'`,
    [], '5.99 desativar', /n.o pode ser desativada/i
  );

  const { id: usada } = await um(
    `SELECT id FROM fin_categoria_uso_v WHERE n_vivo > 0 AND NOT marcador_de_indecisao
      ORDER BY n_vivo DESC LIMIT 1`
  );
  await recusa(
    `UPDATE fin_category SET is_active = false WHERE id = $1`,
    [usada], 'desativar categoria com uso vivo', /item\(ns\) vivo/i
  );
  await recusa(
    `DELETE FROM fin_category WHERE id = $1`,
    [usada], 'apagar categoria com trilha', /n.o se apaga/i
  );

  // A ociosa de verdade continua podendo sair: a recusa e sobre uso, nao sobre
  // existir. Sem esta prova, "recusa tudo" passaria no teste acima.
  const ociosa = await um(`SELECT id, code FROM fin_categoria_uso_v WHERE pode_desativar AND is_active LIMIT 1`);
  let ociosaOk = null;
  if (ociosa) {
    const sp = `categ_ociosa_${++savepointSequence}`;
    await client.query(`SAVEPOINT ${sp}`);
    await client.query(`UPDATE fin_category SET is_active = false WHERE id = $1`, [ociosa.id]);
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    ociosaOk = ociosa.code;
  }

  // -------------------------------------------------------------------------
  // 4. RECLASSIFICACAO EM LOTE — a ordem, a trilha e a trava
  // -------------------------------------------------------------------------
  // O mesmo encadeamento de lib/financeiro/categorizacao.ts, statement a
  // statement. Se um dos dois mudar sem o outro, este teste quebra — que e
  // exatamente o ponto.
  const destino = await um(`SELECT id, code, name, kind FROM fin_category WHERE code = '5.01'`);
  const alvo = await um(
    `SELECT v.id, v.valor_abs_cents::text AS valor
       FROM fin_categorizavel_v v
       JOIN fin_review_item ri ON ri.target_table = 'fin_transaction' AND ri.target_id = v.id
      WHERE v.universo = 'lancamento' AND v.direcao = 'saida' AND v.classificavel
        AND NOT v.travado AND ri.status = 'pendente'
      ORDER BY v.id LIMIT 1`
  );
  assert(alvo, 'nao ha lancamento de saida com item de fila pendente para exercitar o lote');

  const eventosAntes = Number((await um(`SELECT count(*)::text AS n FROM fin_classification_event`)).n);

  // 4.1 trilha com o valor anterior
  await client.query(
    `INSERT INTO fin_classification_event
       (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
     SELECT 'fin_transaction', x.id, 'humano', $2::bigint, true,
            jsonb_build_object('category_id', x.category_id, 'classified_by', x.classified_by,
                               'classified_rule_id', x.classified_rule_id,
                               'human_locked_fields', to_jsonb(x.human_locked_fields)),
            jsonb_build_object('motivo', 'prova test-categorizacao', 'origem', 'central de categorização'),
            'test-categorizacao'
       FROM fin_transaction x WHERE x.id = $1`,
    [alvo.id, destino.id]
  );

  // 4.2 FILA ANTES DA LINHA
  await client.query(
    `UPDATE fin_review_item SET status = 'resolvido', resolved_at = now(), resolved_by = 'test-categorizacao'
      WHERE target_table = 'fin_transaction' AND target_id = $1 AND status = 'pendente'`,
    [alvo.id]
  );

  // 4.3 a linha, com a trava
  await client.query(
    `UPDATE fin_transaction x
        SET category_id = $2, classified_by = 'humano', classified_rule_id = NULL,
            classified_at = now(), review_status = 'ok', updated_at = now(),
            classified_reason = jsonb_build_object('motivo', 'prova test-categorizacao'),
            human_locked_fields = (SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                                     FROM unnest(x.human_locked_fields || ARRAY['category_id']) AS f)
      WHERE x.id = $1`,
    [alvo.id, destino.id]
  );

  // 4.4 a prova, relida do banco
  const depois = await um(
    `SELECT category_id::text, classified_by, classified_rule_id, review_status,
            human_locked_fields::text AS travas,
            ('category_id' = ANY (human_locked_fields)) AS travado
       FROM fin_transaction WHERE id = $1`,
    [alvo.id]
  );
  assert(depois.travado, 'a trava humana NAO ficou escrita — e ela e a defesa contra a proxima sync');
  assert(depois.classified_by === 'humano', `classified_by ficou "${depois.classified_by}", nao "humano"`);
  assert(depois.classified_rule_id === null, 'classified_rule_id nao foi zerado — D6 quebraria');
  assert(depois.review_status === 'ok',
    `review_status voltou para "${depois.review_status}": a fila foi resolvida DEPOIS da linha`);
  const eventosDepois = Number((await um(`SELECT count(*)::text AS n FROM fin_classification_event`)).n);
  assert(eventosDepois === eventosAntes + 1, 'a trilha nao registrou o evento com o valor anterior');
  const { anterior } = await um(
    `SELECT superseded_value ? 'category_id' AS anterior FROM fin_classification_event
      WHERE target_table = 'fin_transaction' AND target_id = $1 ORDER BY id DESC LIMIT 1`,
    [alvo.id]
  );
  assert(anterior, 'o evento nao guardou superseded_value — sem ele o desfazer nao existe');

  // -------------------------------------------------------------------------
  // 5. A ARMADILHA DA ORDEM, provada nos dois sentidos
  // -------------------------------------------------------------------------
  const armadilha = await um(
    `SELECT t.id FROM fin_transaction t
       JOIN fin_review_item ri ON ri.target_table = 'fin_transaction' AND ri.target_id = t.id
      WHERE ri.status = 'pendente' AND ri.reason = 'baixa_confianca' AND t.amount_cents < 0
      ORDER BY t.id LIMIT 1`
  );
  let ordemErrada = null;
  let ordemCerta = null;
  if (armadilha) {
    const sp = `categ_ordem_${++savepointSequence}`;
    await client.query(`SAVEPOINT ${sp}`);
    await client.query(`UPDATE fin_transaction SET category_id = $2, review_status = 'ok' WHERE id = $1`,
      [armadilha.id, destino.id]);
    ordemErrada = (await um(`SELECT review_status FROM fin_transaction WHERE id = $1`, [armadilha.id])).review_status;
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);

    await client.query(`SAVEPOINT ${sp}`);
    await client.query(
      `UPDATE fin_review_item SET status = 'resolvido', resolved_at = now(), resolved_by = 'test'
        WHERE target_table = 'fin_transaction' AND target_id = $1 AND status = 'pendente'`, [armadilha.id]);
    await client.query(`UPDATE fin_transaction SET category_id = $2, review_status = 'ok' WHERE id = $1`,
      [armadilha.id, destino.id]);
    ordemCerta = (await um(`SELECT review_status FROM fin_transaction WHERE id = $1`, [armadilha.id])).review_status;
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);

    assert(ordemErrada === 'pendente',
      `a armadilha da 0094 nao reproduziu: esperava 'pendente' na ordem errada, veio '${ordemErrada}'`);
    assert(ordemCerta === 'ok',
      `nem na ordem certa o 'ok' se sustentou: veio '${ordemCerta}'`);
  }

  // -------------------------------------------------------------------------
  // 6. O INCIDENTE 0098/0099 NAO SE REPETE
  // -------------------------------------------------------------------------
  // Categoria de RECEITA num lancamento de SAIDA: o gatilho de sinal anula a
  // categoria. Antes da 0101 a trava sobrevivia apontando para NULL.
  const receita = await um(`SELECT id FROM fin_category WHERE code = '3.01'`);
  await client.query(
    `UPDATE fin_transaction x
        SET category_id = $2, classified_by = 'humano', classified_rule_id = NULL,
            human_locked_fields = (SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                                     FROM unnest(x.human_locked_fields || ARRAY['category_id']) AS f)
      WHERE x.id = $1`,
    [alvo.id, receita.id]
  );
  const recusado = await um(
    `SELECT category_id, ('category_id' = ANY (human_locked_fields)) AS travado
       FROM fin_transaction WHERE id = $1`, [alvo.id]
  );
  assert(recusado.category_id === null, 'o gatilho de sinal nao recusou a categoria incompativel');
  assert(!recusado.travado, 'a trava sobreviveu apontando para NULL — e o bug da 0098, de volta');

  // -------------------------------------------------------------------------
  // 6b. A ARMADILHA DA PARIDADE DE VERSAO DE REGRA — 9.793 linhas em risco
  // -------------------------------------------------------------------------
  // Um `UPDATE fin_transaction SET category_id = X` que NAO cite
  // `classified_rule_id` no mesmo SET estoura o CHECK
  // fin_transaction_rule_version_paridade. O mecanismo:
  // fin_transaction_sinal_da_categoria zera classified_rule_id de dentro do
  // BEFORE, mas zz_fin_transaction_rule_version e
  // `BEFORE UPDATE OF classified_rule_id, classified_rule_version_id` e nao
  // dispara — a versao fica orfa. A mensagem de erro fala de VERSAO DE REGRA,
  // nao de categoria, e por isso e dificil de diagnosticar em producao.
  //
  // Este teste prova a armadilha E a defesa, porque a rota de lote e
  // exatamente a operacao afetada.
  const riscoParidade = await um(
    `SELECT count(*)::text AS n, sum(abs(amount_cents))::text AS v
       FROM fin_transaction WHERE classified_rule_id IS NOT NULL`
  );
  const comRegra = await um(
    `SELECT id FROM fin_transaction
      WHERE classified_rule_id IS NOT NULL AND amount_cents < 0 ORDER BY id LIMIT 1`
  );
  let paridadeErro = null;
  if (comRegra) {
    paridadeErro = await recusa(
      `UPDATE fin_transaction SET category_id = $2 WHERE id = $1`,
      [comRegra.id, receita.id],
      'UPDATE de categoria sem citar classified_rule_id',
      /rule_version_paridade/i
    );
    // E a forma que a rota usa passa.
    const sp = `categ_paridade_${++savepointSequence}`;
    await client.query(`SAVEPOINT ${sp}`);
    await client.query(
      `UPDATE fin_transaction SET category_id = $2, classified_rule_id = NULL WHERE id = $1`,
      [comRegra.id, receita.id]
    );
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  }

  // -------------------------------------------------------------------------
  // 7. OS INVARIANTES QUE ESTA FRENTE PROMETEU NAO PIORAR
  // -------------------------------------------------------------------------
  // A regua e "nao piorar", nao "zerar": D6 chega aqui com 63 violacoes vivas
  // e vermelhas de proposito — sao a coorte B da §11 do CONTINUACAO.md, cuja
  // restauracao depende da duvida 40 (escolher entre a decisao humana de 11/08
  // e o 3.99 da regra 73, o que mexe na DRE). Exigir zero aqui seria pedir que
  // esta frente decidisse no lugar do Fernando.
  const inv = await um(SQL_INVARIANTES);
  for (const [nome, valor] of Object.entries(inv)) {
    const antes = Number(baseline[nome]);
    assert(
      Number(valor) <= antes,
      `${nome.toUpperCase()} PIOROU com as escritas desta frente: ${antes} → ${valor} violacao(oes)`
    );
  }

  // -------------------------------------------------------------------------
  // 8. ANCORA — nenhum centavo mudou de lugar
  // -------------------------------------------------------------------------
  assert(ancoraAntes === (await ancora()), 'a ancora de soma por conta mudou — esta frente nao pode mover dinheiro');

  await client.query('ROLLBACK');
  const { instalada: aindaInstalada } = await um(
    `SELECT to_regclass('fin_categorizavel_v') IS NOT NULL AS instalada`
  );
  assert(aindaInstalada === jaInstalada, 'o teste deixou DDL da 0101 persistido');

  console.log(`✓ busca alcanca ${alcance.total} itens: ${alcance.lancamento} lancamento · ` +
    `${alcance.documento} documento · ${alcance.item_cartao} item de cartao, sem perda nem duplicata`);
  for (const l of forDoPainel) {
    console.log(`  · fora da regua do painel: ${l.n} ${l.universo}(s) indeterminados, ${brl(l.valor)}`);
  }
  console.log(`✓ todo indeterminado declara motivo; ${semMotivo} classificados como 'sem-motivo-declarado'`);
  console.log('✓ 3.99 e 5.99 recusam renomear, reagrupar e desativar');
  console.log('✓ categoria com uso vivo nao desativa; categoria com trilha nao se apaga' +
    (ociosaOk ? `; a ociosa ${ociosaOk} continua podendo sair` : ''));
  console.log(`✓ lote no lancamento ${alvo.id} (${brl(alvo.valor)}): trilha com valor anterior, ` +
    `classified_by=humano, rule_id nulo, review_status=ok`);
  console.log(`✓ TRAVA HUMANA ESCRITA E RELIDA: human_locked_fields = ${depois.travas}`);
  if (armadilha) {
    console.log(`✓ ordem do gatilho 0094: linha antes da fila → '${ordemErrada}'; ` +
      `fila antes da linha → '${ordemCerta}'`);
  }
  console.log('✓ categoria de sinal incompativel: o gatilho anula E a trava sai junto (E2 preservado)');
  if (paridadeErro) {
    console.log(`✓ paridade de versao de regra: UPDATE de categoria sem citar classified_rule_id ` +
      `e recusado (${riscoParidade.n} linhas em risco, ${brl(riscoParidade.v)}); ` +
      `a forma que a rota usa (rule_id=NULL no mesmo SET) passa`);
  }
  console.log('✓ E1 E2 H3 H4 D1 D6 nao pioraram: ' +
    Object.entries(inv).map(([k, v]) => `${k.toUpperCase()} ${baseline[k]}→${v}`).join(' · '));
  console.log('✓ ancora de soma por conta intacta; ROLLBACK integral, nada persistido');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
