// A prova de que o detalhamento de cartão não conta a mesma despesa duas vezes.
//
// ---------------------------------------------------------------------------
// O QUE ELE PROCURA
// ---------------------------------------------------------------------------
// Uma tela de cartão erra de três jeitos, e os três são silenciosos:
//
//   1. SOMA A FATURA COM OS ITENS. A fatura é o que saiu do caixa; os itens são
//      a composição dela. Somar os dois dobra a despesa, e o total continua
//      "parecendo certo" porque ninguém tem o número de fora para conferir.
//
//   2. FECHA A PARTE NÃO ITEMIZADA POR DIFERENÇA. 42% do valor das faturas não
//      é explicado por item nenhum. Distribuir esse buraco entre os itens
//      conhecidos dá um total bonito e uma base errada: gasto sem dono vira
//      gasto com dono inventado.
//
//   3. PERDE ITEM NO CAMINHO. Uma folha órfã na árvore some da tela sem
//      nenhum aviso — que é exatamente como R$ 194 mil ficaram invisíveis antes
//      da 0083.
//
// Este arquivo aplica a 0114 DENTRO de uma transação, confere as três famílias
// contra o acervo real e termina em ROLLBACK. Nada persiste, e a âncora de
// dinheiro por conta é fotografada antes e depois.
//
// Uso:
//   node scripts/test-cartao-detalhe.mjs
//   node scripts/test-cartao-detalhe.mjs --arvore     imprime a árvore inteira
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const ARVORE = process.argv.includes('--arvore');
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let ok = 0;
let falhas = 0;
const afirma = (o_que, verdade, detalhe = '') => {
  if (verdade) {
    ok += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${o_que}${detalhe ? ` — ${detalhe}` : ''}`);
  } else {
    falhas += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${o_que}${detalhe ? ` — ${detalhe}` : ''}`);
  }
};

const pool = financePool();
const c = await pool.connect();

try {
  await c.query('BEGIN');

  // A âncora: soma por conta no ledger. A 0114 só cria view, então ela tem de
  // ser idêntica byte a byte depois. Se mudar, alguma view virou escrita.
  const ancoraAntes = (
    await c.query(
      `SELECT a.slug, sum(t.amount_cents)::text AS total, count(*)::text AS n
         FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
        GROUP BY 1 ORDER BY 1`
    )
  ).rows;

  console.log('\n(aplicando a 0114 nesta transação, que termina em ROLLBACK)');
  await c.query(readFileSync(resolve(RAIZ, 'db/migrations/0114_fin_cartao_detalhe.sql'), 'utf8'));

  // =========================================================================
  console.log('\n[1] Fatura e item não se somam — a prova, em três números');
  // =========================================================================
  const { rows: [tot] } = await c.query(`
    SELECT (SELECT COALESCE(sum(valor_cents),0) FROM fin_card_serie_mensal_v WHERE faixa='item')          AS competencia,
           (SELECT COALESCE(sum(valor_cents),0) FROM fin_card_serie_mensal_v WHERE faixa='nao_itemizado') AS nao_itemizado,
           (SELECT COALESCE(sum(saiu_cents),0)  FROM fin_card_caixa_mensal_v)                             AS caixa,
           (SELECT COALESCE(sum(total_amount_cents),0) FROM fin_card_bill)                                AS faturas`);

  console.log(`      competência (itens) .... ${brl(tot.competencia)}`);
  console.log(`      não itemizado .......... ${brl(tot.nao_itemizado)}`);
  console.log(`      caixa (fatura paga) .... ${brl(tot.caixa)}`);
  console.log(`      faturas declaradas ..... ${brl(tot.faturas)}`);

  afirma(
    'competência e caixa são números DIFERENTES',
    Number(tot.competencia) !== Number(tot.caixa),
    'se fossem iguais, uma das duas séries estaria lendo a outra'
  );

  // A conta que fecha, e que é a razão de a árvore existir: itens + não
  // itemizado = as faturas declaradas. NÃO é competência + caixa.
  const faturaPorParte = Number(tot.nao_itemizado) +
    Number((await c.query(
      `SELECT COALESCE(sum(itemized_amount_cents),0) AS v FROM fin_card_bill`
    )).rows[0].v);
  afirma(
    'itemizado + não itemizado = as faturas declaradas',
    faturaPorParte === Number(tot.faturas),
    `${brl(faturaPorParte)} = ${brl(tot.faturas)}`
  );

  const somaErrada = Number(tot.competencia) + Number(tot.caixa);
  console.log(
    `      \x1b[33m○\x1b[0m somar as duas daria ${brl(somaErrada)} — ` +
      `${brl(somaErrada - Number(tot.faturas))} a mais que tudo que o emissor já cobrou`
  );

  const { rows: [ponte] } = await c.query(`
    SELECT count(*)::text AS n,
           (SELECT count(*)::text FROM (SELECT transaction_id FROM fin_card_saida_caixa_v
              GROUP BY 1 HAVING count(*) > 1) x) AS repetidos
      FROM fin_card_saida_caixa_v`);
  afirma(
    'o subledger toca o ledger em UM ponto só, e ele é 1:1',
    Number(ponte.repetidos) === 0,
    `${ponte.n} pagamento(s) de fatura, nenhum lançamento pagando duas`
  );

  const { rows: [semCat] } = await c.query(`
    SELECT count(*)::text AS n, COALESCE(sum(saiu_cents),0)::text AS v
      FROM fin_card_saida_caixa_v WHERE categoria_code IS NULL`);
  afirma(
    'medir o caixa do cartão por categoria 9.01 esconderia dinheiro',
    Number(semCat.n) > 0,
    `${semCat.n} pagamento(s) sem categoria, ${brl(semCat.v)} — é por isso que a âncora é o ponteiro`
  );

  // =========================================================================
  console.log('\n[2] A árvore soma, nível a nível');
  // =========================================================================
  const niveis = (await c.query(`
    SELECT nivel, min(profundidade) AS p, count(*)::text AS n, COALESCE(sum(valor_cents),0)::text AS v
      FROM fin_card_arvore_v GROUP BY nivel ORDER BY 2`)).rows;
  for (const n of niveis) console.log(`      ${n.nivel.padEnd(14)} ${String(n.n).padStart(4)} nó(s)  ${brl(n.v)}`);

  const porNivel = Object.fromEntries(niveis.map((n) => [n.nivel, Number(n.v)]));
  afirma('emissor = linha', porNivel.emissor === porNivel.linha, brl(porNivel.emissor));
  afirma('linha = fatura', porNivel.linha === porNivel.fatura, brl(porNivel.fatura));
  afirma(
    'subcartão + não itemizado = fatura',
    (porNivel.subcartao ?? 0) + (porNivel.nao_itemizado ?? 0) === porNivel.fatura,
    `${brl(porNivel.subcartao)} + ${brl(porNivel.nao_itemizado)} = ${brl(porNivel.fatura)}`
  );
  afirma('item = subcartão', porNivel.item === porNivel.subcartao, brl(porNivel.item));

  const { rows: [orfaos] } = await c.query(`
    SELECT count(*)::text AS n FROM fin_card_arvore_v f
     WHERE f.chave_pai IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM fin_card_arvore_v p WHERE p.chave = f.chave_pai)`);
  afirma('nenhum nó órfão', Number(orfaos.n) === 0, 'folha sem pai some da tela sem aviso');

  const { rows: [chaves] } = await c.query(`
    SELECT count(*)::text AS n FROM (SELECT chave FROM fin_card_arvore_v GROUP BY 1 HAVING count(*) > 1) x`);
  afirma('nenhuma chave repetida', Number(chaves.n) === 0, 'chave repetida dobra o ramo na navegação');

  // =========================================================================
  console.log('\n[3] A parte não itemizada é um nó, não uma diferença diluída');
  // =========================================================================
  const naoItem = (await c.query(`
    SELECT a.rotulo, a.valor_cents, a.motivo, p.rotulo AS fatura
      FROM fin_card_arvore_v a JOIN fin_card_arvore_v p ON p.chave = a.chave_pai
     WHERE a.nivel = 'nao_itemizado' ORDER BY a.valor_cents DESC`)).rows;
  afirma(
    'todo nó não itemizado carrega motivo',
    naoItem.every((n) => n.motivo && n.motivo.length > 20),
    `${naoItem.length} nó(s), ${brl(naoItem.reduce((s, n) => s + Number(n.valor_cents), 0))}`
  );

  const { rows: [conf] } = await c.query(`
    SELECT count(*)::text AS n FROM fin_card_bill b
     WHERE b.total_amount_cents <> b.itemized_amount_cents + b.unitemized_amount_cents`);
  afirma(
    'nenhuma fatura fechada por ajuste',
    Number(conf.n) === 0,
    'total = itemizado + não itemizado, e o não itemizado é declarado, não derivado da tela'
  );

  // =========================================================================
  console.log('\n[4] Quantos itens seguem sem nome e sem dono, com motivo');
  // =========================================================================
  const { rows: [cob] } = await c.query(`
    SELECT count(*)::text                                                    AS itens,
           count(*) FILTER (WHERE category_id IS NULL)::text                 AS sem_cat,
           COALESCE(sum(amount_cents) FILTER (WHERE category_id IS NULL),0)::text AS sem_cat_v,
           count(*) FILTER (WHERE titular IS NULL)::text                     AS sem_titular,
           COALESCE(sum(amount_cents) FILTER (WHERE titular IS NULL),0)::text     AS sem_titular_v,
           count(*) FILTER (WHERE cost_center_id IS NULL)::text              AS sem_cc,
           count(*) FILTER (WHERE card_id IS NULL)::text                     AS sem_card
      FROM fin_card_item_v`);
  console.log(`      itens ................ ${cob.itens}`);
  console.log(`      sem categoria ........ ${cob.sem_cat}  ${brl(cob.sem_cat_v)}`);
  console.log(`      sem titular .......... ${cob.sem_titular}  ${brl(cob.sem_titular_v)}`);
  console.log(`      sem centro de custo .. ${cob.sem_cc}`);
  console.log(`      sem subcartão ........ ${cob.sem_card}`);

  const { rows: [semMotivo] } = await c.query(`
    SELECT count(*)::text AS n FROM fin_card_item_v
     WHERE (category_id IS NULL AND categoria_motivo IS NULL)
        OR (card_id IS NOT NULL AND titular IS NULL AND titular_motivo IS NULL)
        OR (cost_center_id IS NULL AND centro_custo_motivo IS NULL)`);
  afirma('todo campo ausente tem motivo', Number(semMotivo.n) === 0, 'ausência sem motivo é a regra 5 do projeto quebrada');

  const { rows: [deduzido] } = await c.query(`
    SELECT count(*)::text AS n FROM fin_card_item_v i
     WHERE i.titular IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM fin_card c WHERE c.id = i.card_id AND c.holder_person_id IS NOT NULL)`);
  afirma('nenhum titular deduzido', Number(deduzido.n) === 0, 'titular só existe quando há pessoa ligada');

  // =========================================================================
  console.log('\n[5] O parcelamento atravessa a reemissão e continua um só');
  // =========================================================================
  const planos = (await c.query(`
    SELECT plano_id, merchant_label, installments_total, finais, atravessa_reemissao, reemissao_declarada,
           status, count(item_id)::text AS parcelas, reemissao_motivo
      FROM fin_card_plano_parcela_v
     GROUP BY 1,2,3,4,5,6,7,9 ORDER BY atravessa_reemissao DESC, plano_id`)).rows;
  const atravessam = planos.filter((p) => p.atravessa_reemissao);
  afirma(
    'os planos que trocam de plástico continuam sendo UM plano',
    atravessam.length > 0,
    `${atravessam.length} de ${planos.length} atravessam mais de um final`
  );
  afirma(
    'nenhum plano com mais parcelas observadas que o contratado',
    planos.every((p) => Number(p.parcelas) <= Number(p.installments_total)),
    'parcela a mais é plano partido em dois e recontado'
  );
  afirma(
    'a reemissão é declarada como DEDUZIDA, não como registrada',
    atravessam.every((p) => p.reemissao_declarada === false && p.reemissao_motivo),
    'fin_card.replaces_card_id está nulo nos 12 subcartões — a continuidade vem da numeração das parcelas'
  );
  for (const p of atravessam.slice(0, 6)) {
    console.log(
      `      plano ${String(p.plano_id).padStart(2)} ${String(p.merchant_label).slice(0, 24).padEnd(24)} ` +
        `${p.parcelas}/${p.installments_total} · finais ${p.finais} · ${p.status}`
    );
  }

  // =========================================================================
  console.log('\n[6] O histórico, mês a mês');
  // =========================================================================
  const serie = (await c.query(`
    SELECT to_char(p.mes, 'YYYY-MM') AS mes,
           sum(p.competencia_itens_cents)::text        AS itens,
           sum(p.competencia_nao_itemizado_cents)::text AS nao_item,
           COALESCE(sum(p.caixa_saiu_cents),0)::text   AS caixa
      FROM fin_card_prova_nao_soma_v p GROUP BY 1 ORDER BY 1`)).rows;
  console.log('      mês       competência   não itemiz.        caixa');
  for (const m of serie) {
    console.log(
      `      ${m.mes}  ${brl(m.itens).padStart(12)}  ${brl(m.nao_item).padStart(12)}  ${brl(m.caixa).padStart(12)}`
    );
  }
  afirma('o histórico cobre todo mês com movimento', serie.length >= 12, `${serie.length} mês(es)`);

  const semFrase = (await c.query(
    `SELECT count(*)::text AS n FROM fin_card_prova_nao_soma_v WHERE porque_nao_soma IS NULL`
  )).rows[0];
  afirma('toda linha da prova diz por que não soma', Number(semFrase.n) === 0);

  const compromisso = (await c.query(`
    SELECT COALESCE(sum(amount_cents),0)::text AS v, count(*)::text AS n
      FROM fin_card_compromisso_mensal_v WHERE competence_month > date_trunc('month', CURRENT_DATE)`)).rows[0];
  console.log(`      comprometido nos meses à frente: ${brl(compromisso.v)} em ${compromisso.n} linha(s)`);

  // =========================================================================
  console.log('\n[7] Os invariantes que não podem regredir');
  // =========================================================================
  const { rows: [conta] } = await c.query(`SELECT count(*)::text AS n FROM fin_account WHERE kind='cartao'`);
  afirma('nenhuma fin_account com kind=cartao', Number(conta.n) === 0);

  const { rows: [acum] } = await c.query(`
    SELECT count(*)::text AS n FROM fin_card_bill b
     WHERE b.itemized_amount_cents <> COALESCE(
       (SELECT sum(t.amount_cents) FROM fin_card_transaction t
         WHERE t.bill_id = b.id AND t.kind <> 'pagamento_fatura'), 0)`);
  afirma('o acumulador de itens confere com a recontagem nas 21 faturas', Number(acum.n) === 0);

  const ancoraDepois = (
    await c.query(
      `SELECT a.slug, sum(t.amount_cents)::text AS total, count(*)::text AS n
         FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
        GROUP BY 1 ORDER BY 1`
    )
  ).rows;
  afirma(
    'a âncora de dinheiro por conta é idêntica antes e depois',
    JSON.stringify(ancoraAntes) === JSON.stringify(ancoraDepois),
    `${ancoraDepois.length} conta(s)`
  );

  if (ARVORE) {
    console.log('\n--- a árvore ---');
    const nos = (await c.query(`
      SELECT profundidade, nivel, chave, chave_pai, rotulo, detalhe, valor_cents, motivo
        FROM fin_card_arvore_v ORDER BY profundidade, ordem`)).rows;
    for (const n of nos) {
      console.log(
        `${'  '.repeat(n.profundidade)}${n.rotulo} · ${brl(n.valor_cents)}` +
          (n.detalhe ? `  (${n.detalhe})` : '') +
          (n.motivo ? `\n${'  '.repeat(n.profundidade + 1)}\x1b[33m○ ${n.motivo}\x1b[0m` : '')
      );
    }
  }
} catch (erro) {
  falhas += 1;
  console.error(`\n\x1b[31m✗ ${erro.message}\x1b[0m`);
  if (erro.hint) console.error(`  ${erro.hint}`);
} finally {
  await c.query('ROLLBACK').catch(() => {});
  c.release();
  await pool.end();
}

console.log(`\n${ok} afirmação(ões) · ${falhas} falha(s) — tudo em ROLLBACK, nada persistiu.`);
process.exit(falhas ? 1 : 0);
