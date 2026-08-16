// Qualificação ativa: mostra os grupos pendentes com a evidência de cada
// sugestão, e aplica em lote.
//
// O QUE ELE FAZ DE DIFERENTE DA FILA DE REVISÃO
//
// A fila mostra 100 lançamentos soltos, ordenados por valor. Este mostra
// GRUPOS: tudo que compartilha contraparte ou padrão de texto E a mesma
// sugestão vira uma decisão só. Os 306 pendentes de 2026 viram poucas dezenas
// de perguntas.
//
// E cada sugestão vem com a evidência que a sustenta ("casou com a cobrança do
// Condomínio Morada, mesma quantia, 1 dia") em vez do palpite nu. Sugestão que
// não se pode contestar é chute com autoridade.
//
// REPLICÁVEL. Com `--regra`, aplicar um grupo também cria uma regra no motor,
// para que a próxima importação já chegue classificada. É o pedido do dono:
// "quando qualifico algo, se for identificado algo igual, já sabe".
//
// Uso:
//   node scripts/qualificar.mjs                        lista 2026, mais recente primeiro
//   node scripts/qualificar.mjs --ano=2026 --min=1000  só grupos acima de R$ 1.000
//   node scripts/qualificar.mjs --confianca=0.8        só o que o motor tem certeza
//   node scripts/qualificar.mjs --aplicar --confianca=0.9   aplica o que é quase certo
//   node scripts/qualificar.mjs --grupo=3 --code=3.05 --aplicar   decide um grupo
//   node scripts/qualificar.mjs --grupo=3 --code=3.05 --regra --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { SQL_PENDENTES, agrupar } from './lib/fin-qualificacao.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';
import { classify } from './lib/fin-rules.mjs';

loadEnv();

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, padrao = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : padrao;
};

const ANO = Number(val('ano', new Date().getFullYear()));
const MIN = Number(val('min', 0)) * 100;
const CONFIANCA = Number(val('confianca', 0));
const GRUPO = val('grupo') === null ? null : Number(val('grupo'));
// Selecionar por FONTE em vez de por posição. O índice do grupo muda a cada
// mudança de filtro, e foi assim que uma aplicação foi parar no grupo errado:
// a lista tinha sido feita com --min e o comando rodou sem ele.
const FONTE = val('fonte');
const CODE = val('code');
const APLICAR = flag('aplicar');
const CRIAR_REGRA = flag('regra');
const TOP = Number(val('top', 30));
const ENTIDADE = 'xpe';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (d) => String(d).slice(4, 15);

/**
 * Uma decisão humana não precisa gerar uma segunda regra quando o motor atual
 * já explica TODOS os itens representativos com a mesma categoria.
 *
 * Foi assim que nasceram as regras impossíveis de CREA e Lyra: o CLI copiou o
 * rótulo cru para counterparty_name_norm e, sem antes perguntar ao motor, criou
 * uma duplicata pior que as regras determinísticas já existentes.
 */
async function regraAtivaEquivalente(client, ids, categoryCode, entitySlug) {
  const { rows: regras } = await client.query(
    `SELECT r.id, r.slug, r.name, r.priority, r.match_scope,
            r.conditions, r.actions, r.confidence
       FROM fin_rule r
       JOIN fin_entity e ON e.id = r.entity_id
      WHERE r.status = 'ativa'
        AND e.slug = $1
      ORDER BY r.priority, r.id`,
    [entitySlug]
  );
  const { rows: linhas } = await client.query(
    `SELECT t.id, t.description_norm, t.counterparty_raw, t.amount_cents,
            t.source_kind, EXTRACT(DAY FROM t.posted_on)::int AS day_of_month,
            a.slug AS account_slug,
            COALESCE(cp.normalized_name, '') AS counterparty_name_norm,
            COALESCE(t.counterparty_document, cp.document_number) AS counterparty_document
       FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id
       JOIN fin_entity e ON e.id = t.entity_id
       LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
      WHERE t.id = ANY($1::bigint[])
        AND e.slug = $2
      ORDER BY t.id`,
    [ids, entitySlug]
  );
  if (linhas.length !== ids.length) return null;

  const vencedoras = new Set();
  for (const linha of linhas) {
    const amount = Number(linha.amount_cents);
    const hit = classify(regras, {
      scope: 'transaction',
      description_norm: linha.description_norm,
      counterparty_name_norm: linha.counterparty_name_norm || normalizeName(linha.counterparty_raw),
      counterparty_document: linha.counterparty_document,
      account_slug: linha.account_slug,
      amount_cents: amount,
      amount_abs: Math.abs(amount),
      source_kind: linha.source_kind,
      billing_type: null,
      direction: amount >= 0 ? 'receber' : 'pagar',
      day_of_month: linha.day_of_month
    });
    if (!hit || hit.actions?.category_code !== categoryCode) return null;
    vencedoras.add(hit.rule.slug);
  }
  return [...vencedoras];
}

const pool = financePool();
const client = await pool.connect();

try {
  const { rows } = await client.query(SQL_PENDENTES, [ENTIDADE, `${ANO}-01-01`, `${ANO}-12-31`]);
  const todos = agrupar(rows);

  const grupos = todos.filter(
    (g) => g.valorCents >= MIN && (g.sugestao?.confianca ?? 0) >= CONFIANCA
  );

  const totalPend = rows.reduce((s, r) => s + Math.abs(Number(r.amount_cents)), 0);
  console.log(`\n${ANO} — ${rows.length} lançamentos sem categoria, ${brl(totalPend)}`);
  console.log(`${todos.length} grupos · ${grupos.length} atendem ao filtro\n`);

  // --fonte aplica a TODOS os grupos cuja melhor evidência é aquela, de uma vez.
  // Imune ao deslocamento de índice, porque não usa índice.
  if (FONTE && APLICAR) {
    const alvo = grupos.filter((g) => g.sugestao?.fonte === FONTE && g.sugestao.code);
    if (!alvo.length) { console.log(`nenhum grupo com fonte "${FONTE}" no filtro atual.`); process.exit(0); }
    await client.query('BEGIN');
    let n = 0, valor = 0;
    for (const g of alvo) {
      const { rows: [cat] } = await client.query(
        `SELECT c.id, c.code FROM fin_category c JOIN fin_entity e ON e.id=c.entity_id AND e.slug=$1 WHERE c.code=$2`,
        [ENTIDADE, g.sugestao.code]);
      if (!cat) continue;
      const ids = g.itens.map((i) => i.id);
      for (const it of g.itens) {
        await client.query(
          `INSERT INTO fin_classification_event (target_table,target_id,stage,category_id,accepted,rationale,actor)
           VALUES ('fin_transaction',$1,'humano',$2,true,$3::jsonb,'qualificar-cli')`,
          [it.id, cat.id, JSON.stringify({ fonte: FONTE, evidencia: it.sugestao?.evidencia, confianca: it.sugestao?.confianca })]);
      }
      const { rowCount } = await client.query(
        `UPDATE fin_transaction SET category_id=$2, classified_by='humano', classified_at=now(),
           review_status='ok', updated_at=now(),
           classified_reason=jsonb_build_object('motivo','qualificação por evidência','fonte',$3::text)
         WHERE id = ANY($1::bigint[])`, [ids, cat.id, FONTE]);
      await client.query(`UPDATE fin_review_item SET status='resolvido', resolved_at=now()
         WHERE target_table='fin_transaction' AND target_id = ANY($1::bigint[]) AND status='pendente'`, [ids]);
      n += rowCount; valor += g.valorCents;
    }
    const { rows: [tot] } = await client.query(`SELECT sum(amount_cents) v FROM fin_transaction`);
    console.log(`\n  ${alvo.length} grupos · ${n} lançamentos · ${brl(valor)} por evidência de "${FONTE}"`);
    console.log(`  âncora — soma do ledger: ${brl(tot.v)} (não pode mudar)`);
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
    process.exit(0);
  }

  if (GRUPO === null) {
    console.log('  #  qdo          n   valor            confiança  sugestão / evidência');
    console.log('  ─  ───────────  ──  ───────────────  ─────────  ─────────────────────────────');
    grupos.slice(0, TOP).forEach((g, i) => {
      const s = g.sugestao;
      const conf = s ? `${(100 * s.confianca).toFixed(0)}%`.padStart(4) : '  — ';
      const marca = g.valorFixo ? ' [valor fixo]' : g.valoresDistintos > 1 ? ` [${g.valoresDistintos} valores]` : '';
      console.log(
        `  ${String(i).padStart(2)}  ${dia(g.maisRecente).padEnd(11)}  ${String(g.n).padStart(2)}  ${brl(g.valorCents).padStart(15)}  ${conf}       ${s ? `${s.code} ${s.categoria}` : 'SEM SUGESTÃO'}`
      );
      console.log(`                                                   ${String(g.rotulo).slice(0, 58)}${marca}`);
      if (s) console.log(`                                                   └ ${s.fonte}: ${s.evidencia.slice(0, 76)}`);
    });

    const comSug = grupos.filter((g) => g.sugestao);
    const altaConf = grupos.filter((g) => (g.sugestao?.confianca ?? 0) >= 0.9);
    console.log(`\n  com sugestão: ${comSug.length} grupos, ${brl(comSug.reduce((s, g) => s + g.valorCents, 0))}`);
    console.log(`  confiança ≥ 90%: ${altaConf.length} grupos, ${brl(altaConf.reduce((s, g) => s + g.valorCents, 0))}`);
    console.log(`  sem sugestão (precisa de gente): ${grupos.length - comSug.length} grupos, ${brl(grupos.filter((g) => !g.sugestao).reduce((s, g) => s + g.valorCents, 0))}\n`);
    console.log('  para ver um grupo:  node scripts/qualificar.mjs --grupo=<#>');
    console.log('  para aplicar:       node scripts/qualificar.mjs --grupo=<#> --code=<3.05> --aplicar\n');
    await client.query('ROLLBACK').catch(() => {});
    process.exit(0);
  }

  // ---------------------------------------------------------------- um grupo
  const g = grupos[GRUPO];
  if (!g) throw new Error(`grupo ${GRUPO} não existe (há ${grupos.length})`);

  console.log(`GRUPO ${GRUPO}: ${g.rotulo}`);
  console.log(`  ${g.n} lançamentos · ${brl(g.valorCents)} · contas: ${g.contas.join(', ')}`);
  if (g.sugestao) {
    console.log(`  sugestão: ${g.sugestao.code} ${g.sugestao.categoria} (${(100 * g.sugestao.confianca).toFixed(0)}%)`);
    console.log(`  evidência: ${g.sugestao.evidencia}`);
    for (const alt of g.sugestao.alternativas ?? []) {
      console.log(`  alternativa: ${alt.code} ${alt.categoria} (${(100 * alt.confianca).toFixed(0)}%) — ${alt.evidencia.slice(0, 60)}`);
    }
  }
  console.log('\n  data         valor            descrição');
  g.itens.slice(0, 25).forEach((it) =>
    console.log(`  ${dia(it.posted_on).padEnd(11)}  ${brl(Math.abs(Number(it.amount_cents))).padStart(15)}  ${String(it.description_raw ?? '').slice(0, 60)}`)
  );
  if (g.n > 25) console.log(`  … e mais ${g.n - 25}`);

  const code = CODE ?? g.sugestao?.code;
  if (!code) {
    console.log('\n  sem categoria escolhida e sem sugestão: informe --code=<codigo>\n');
    process.exit(0);
  }

  await client.query('BEGIN');
  const { rows: [cat] } = await client.query(
    `SELECT c.id, c.code, c.name FROM fin_category c
       JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1 WHERE c.code = $2`,
    [ENTIDADE, code]
  );
  if (!cat) throw new Error(`categoria ${code} não existe`);

  const ids = g.itens.map((i) => i.id);
  for (const it of g.itens) {
    await client.query(
      `INSERT INTO fin_classification_event
         (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
       VALUES ('fin_transaction', $1, 'humano', $2, true, NULL, $3::jsonb, 'qualificar-cli')`,
      [it.id, cat.id, JSON.stringify({
        grupo: g.rotulo,
        fonte: it.sugestao?.fonte ?? 'decisao_humana',
        evidencia: it.sugestao?.evidencia ?? 'escolha manual do dono',
        confianca: it.sugestao?.confianca ?? null
      })]
    );
  }

  // `classified_by='humano'` tira estes lançamentos da fila para sempre e os
  // protege do próximo `reclassificar.mjs`. É o ponto do exercício: decisão
  // tomada não volta a ser pergunta.
  const { rowCount } = await client.query(
    `UPDATE fin_transaction
        SET category_id = $2, classified_by = 'humano', classified_at = now(),
            review_status = 'ok', updated_at = now(),
            classified_reason = jsonb_build_object('motivo','qualificação em grupo','grupo',$3::text)
      WHERE id = ANY($1::bigint[])`,
    [ids, cat.id, g.rotulo]
  );
  await client.query(
    `UPDATE fin_review_item SET status='resolvido', resolved_at=now()
      WHERE target_table='fin_transaction' AND target_id = ANY($1::bigint[]) AND status='pendente'`,
    [ids]
  );

  let regra = null;
  let regrasReutilizadas = null;
  if (CRIAR_REGRA) {
    // A regra nasce do que o grupo tem em comum, e só quando isso é específico
    // o bastante. Padrão curto ("pix enviado") viraria uma regra que engole
    // metade do extrato — é exatamente a regra 42, cuja precisão medida é 15,2%.
    const alvo = g.porContraparte ? null : g.rotulo;
    const contraparteNorm = g.porContraparte ? normalizeName(g.rotulo) : null;
    if (g.porContraparte && !contraparteNorm) {
      console.log(
        `\n  REGRA NÃO CRIADA: a contraparte "${g.rotulo}" fica vazia após normalizeName().`
      );
    } else if (!g.porContraparte && (!alvo || alvo.length < 18)) {
      console.log(`\n  REGRA NÃO CRIADA: o padrão "${alvo}" é curto demais e pegaria coisa alheia.`);
    } else {
      const slug = `qualificacao-${(g.porContraparte ? g.rotulo : alvo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 46)}`;
      const cond = g.porContraparte
        ? { all: [{ op: 'equals', field: 'counterparty_name_norm', value: contraparteNorm }] }
        : { all: [{ op: 'contains_any', field: 'description_norm', value: [alvo.replace(/#/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)] }] };
      const equivalentes = await regraAtivaEquivalente(client, ids, code, ENTIDADE);
      if (equivalentes?.length) {
        regrasReutilizadas = equivalentes;
        console.log(
          `\n  REGRA NÃO CRIADA: ${equivalentes.join(', ')} já cobre(m) todos os itens ` +
          `com a categoria ${code}.`
        );
      } else {
        const { rows: [r] } = await client.query(
          `INSERT INTO fin_rule (entity_id, slug, name, priority, match_scope, conditions, actions,
                                 confidence, source, status, created_by, notes)
           SELECT e.id, $1, $2, 120, 'transaction', $3::jsonb,
                  jsonb_build_object('category_code', $4::text), 75, 'humano', 'ativa', 'qualificar-cli', $5
             FROM fin_entity e WHERE e.slug = $6
             ON CONFLICT (entity_id, slug) DO UPDATE
                SET actions = EXCLUDED.actions, conditions = EXCLUDED.conditions, updated_at = now()
           RETURNING slug`,
          [slug, `Qualificação: ${g.rotulo.slice(0, 50)}`, JSON.stringify(cond), code,
           `Criada ao qualificar ${g.n} lançamentos (${brl(g.valorCents)}).`, ENTIDADE]
        );
        regra = r?.slug ?? null;
      }
    }
  }

  const { rows: [total] } = await client.query(`SELECT sum(amount_cents) v FROM fin_transaction`);
  console.log(`\n  ${rowCount} lançamentos → ${cat.code} ${cat.name}`);
  if (regra) console.log(`  regra criada: ${regra} (as próximas chegam classificadas)`);
  if (regrasReutilizadas) console.log(`  regra reutilizada: ${regrasReutilizadas.join(', ')}`);
  console.log(`  âncora — soma do ledger: ${brl(total.v)} (não pode mudar)`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Acrescente --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
