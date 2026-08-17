// Teste de aceite do drill da DRE, do mover-categoria e do ajuste declarado.
//
//   node scripts/test-dre-drill.mjs            afirma contra o banco como está
//   node scripts/test-dre-drill.mjs --aplicar  aplica a 0102 na transação antes
//
// ---------------------------------------------------------------------------
// O QUE ESTE TESTE PROVA
// ---------------------------------------------------------------------------
// 1. CADA NÍVEL SOMA EXATAMENTE O DE CIMA. linha → categoria → contraparte →
//    lançamento, em valor E em contagem, em todos os 64 meses e nas duas
//    visões. E o nível 1 reproduz `fin_dre_v` linha a linha — porque um drill
//    que soma certo entre si e errado contra a DRE é uma segunda verdade
//    coerente, que é pior que uma incoerente: não se denuncia.
//
// 2. A REGRA DE OURO. Na visão caixa, realizado = fin_transaction, sempre. A
//    soma de TODAS as colunas dos 64 meses de caixa reconstrói o saldo:
//    abertura + DRE = saldo atual, resíduo zero. E nenhum item de cartão
//    aparece na visão caixa.
//
// 3. A LACUNA VIAJA EM TODO NÍVEL. Não num rodapé. A soma de `lacuna_cents`
//    dos filhos é a do pai, em cada um dos três degraus.
//
// 4. MOVER É RECLASSIFICAR. O impacto simulado soma zero por (visão, mês) —
//    mover reposiciona dinheiro, não cria nem destrói. A aplicação real muda
//    a linha da DRE, mantém a âncora de dinheiro por conta, e deixa a
//    proveniência coerente (D6), a trava com dono (E1/E2) e a fila resolvida.
//
// 5. A ORDEM IMPORTA, E O TESTE MEDE OS DOIS LADOS. Ele executa a ordem errada
//    de propósito (UPDATE antes de resolver a fila) e prova que o
//    `review_status='ok'` reverte sozinho; depois executa a ordem certa e
//    prova que fica. Sem o lado errado, o teste não estaria testando a ordem —
//    estaria só concordando com ela.
//
// 6. O AJUSTE DECLARADO NÃO ALCANÇA O CAIXA. Com um ajuste na base,
//    `fin_dre_mensal_v` não se mexe, a regra de ouro continua fechando e
//    nenhum saldo de conta muda. E os CHECKs recusam ajuste em visão caixa,
//    em subtotal e em seção que não seja `resultado`.
//
// ---------------------------------------------------------------------------
// O QUE ELE DELIBERADAMENTE NÃO PROVA
// ---------------------------------------------------------------------------
// · Que a categoria escolhida por um humano é a certa. Mover é decisão; o
//   teste garante que a decisão é registrada, reversível e aritmeticamente
//   neutra — não que ela é boa.
// · Que a hipótese de `fin_dre_lacuna_destino_v` acerta. Ela é hipótese com
//   evidência nomeada; o teste garante apenas que ela nunca é somada.
//
// Tudo roda dentro de UMA transação e termina em ROLLBACK. Nada é persistido.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = 'db/migrations/0102_fin_dre_drill.sql';
const forcarAplicacao = process.argv.includes('--aplicar');

const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (n) => String(n);

let falhas = 0;
let passes = 0;

function ok(nome, detalhe = '') {
  passes += 1;
  console.log(`  ✓ ${nome}${detalhe ? `: ${detalhe}` : ''}`);
}
function falhou(nome, detalhe) {
  falhas += 1;
  console.error(`  ✗ ${nome}\n      ${detalhe}`);
}
function igual(nome, atual, esperado, formatar = brl) {
  const a = Number(atual);
  const e = Number(esperado);
  if (a === e) ok(nome, formatar(a));
  else falhou(nome, `esperado ${formatar(e)} · obtido ${formatar(a)} · delta ${formatar(a - e)}`);
}
function verdade(nome, valor, detalhe = '') {
  if (valor === true) ok(nome, detalhe);
  else falhou(nome, `esperado verdadeiro, obtido ${JSON.stringify(valor)}${detalhe ? ` · ${detalhe}` : ''}`);
}

const pool = financePool();
const client = await pool.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const um = async (sql, params = []) => (await q(sql, params))[0];

/** Executa algo que DEVE falhar, e devolve a mensagem. Usa savepoint: uma
 *  exceção aborta a transação inteira no Postgres, e o teste continua depois. */
async function recusa(nome, sql, params = []) {
  await client.query('SAVEPOINT s');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT s');
    falhou(nome, 'a operação foi ACEITA e deveria ter sido recusada');
    return null;
  } catch (erro) {
    await client.query('ROLLBACK TO SAVEPOINT s');
    ok(nome, erro.message.split('\n')[0].slice(0, 110));
    return erro.message;
  }
}

try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");

  const { pronto } = await um(`SELECT to_regclass('fin_dre_ajuste') IS NOT NULL AS pronto`);
  if (pronto && !forcarAplicacao) {
    console.log('\n=== 0. Schema já tem a 0102; afirmando contra o banco como está ===');
  } else {
    console.log('\n=== 0. Aplicando a 0102 na transação (rollback no fim) ===');
    await client.query(readFileSync(join(raiz, MIGRATION), 'utf8'));
    console.log(`  · ${MIGRATION}`);
  }

  // =========================================================================
  console.log('\n=== 1. Cada nível soma exatamente o de cima ===');

  for (const nivel of [2, 3, 4]) {
    const linhas = await q(
      `SELECT x.visao, x.mes, x.pai, x.filho, x.n_filho, p.valor_cents AS pai_valor, p.lancamentos AS pai_n
         FROM (SELECT visao, mes, pai, sum(valor_cents) AS filho, sum(lancamentos) AS n_filho
                 FROM fin_dre_drill_nivel_v WHERE nivel = $1 GROUP BY 1, 2, 3) x
         JOIN fin_dre_drill_nivel_v p
           ON p.nivel = $1 - 1 AND p.visao = x.visao AND p.mes = x.mes AND p.chave = x.pai
        WHERE x.filho IS DISTINCT FROM p.valor_cents OR x.n_filho IS DISTINCT FROM p.lancamentos`,
      [nivel]
    );
    igual(`grupos em que o nível ${nivel} não soma o ${nivel - 1}`, linhas.length, 0, inteiro);
    if (linhas.length) console.error('     ', JSON.stringify(linhas.slice(0, 3)));
  }

  // Nenhum filho pode ficar órfão: um nó cujo pai não existe some da árvore e
  // o total do pai deixa de bater sem que nenhuma soma acuse.
  const [orfaos] = await q(
    `SELECT count(*) n FROM fin_dre_drill_nivel_v f
      WHERE f.nivel > 1 AND NOT EXISTS (
        SELECT 1 FROM fin_dre_drill_nivel_v p
         WHERE p.nivel = f.nivel - 1 AND p.chave = f.pai AND p.visao = f.visao AND p.mes = f.mes)`
  );
  igual('nós órfãos na árvore do drill', orfaos.n, 0, inteiro);

  const [dre] = await q(
    `SELECT count(*) n FROM fin_dre_drill_nivel_v d
       JOIN fin_dre_v v ON v.visao = d.visao AND v.mes = d.mes AND v.linha = d.linha
                       AND v.entity_id = d.entity_id
      WHERE d.nivel = 1 AND v.tipo = 'item' AND v.valor_cents IS DISTINCT FROM d.valor_cents`
  );
  igual('linhas em que o nível 1 diverge de fin_dre_v', dre.n, 0, inteiro);

  // E o teto: o drill inteiro tem de reconstruir lucro_liquido e
  // lucro_liquido_com_lacunas de fin_dre_mensal_v, mês a mês.
  const [teto] = await q(
    `SELECT count(*) n FROM (
       SELECT d.visao, d.mes,
              sum(d.valor_cents) FILTER (WHERE d.secao = 'resultado')                    AS ll,
              sum(d.valor_cents) FILTER (WHERE d.secao IN ('resultado', 'lacuna'))       AS llc
         FROM fin_dre_drill_nivel_v d WHERE d.nivel = 1 GROUP BY 1, 2) x
       JOIN fin_dre_mensal_v m ON m.visao = x.visao AND m.mes = x.mes
      WHERE x.ll IS DISTINCT FROM m.lucro_liquido_cents
         OR x.llc IS DISTINCT FROM m.lucro_liquido_com_lacunas_cents`
  );
  igual('meses em que o drill não reconstrói o lucro da DRE mensal', teto.n, 0, inteiro);

  const [grao] = await q(
    `SELECT (SELECT count(*) FROM fin_dre_drill_nivel_v WHERE nivel = 4)                AS folhas,
            (SELECT count(*) FROM fin_dre_lancamento_v l
              CROSS JOIN LATERAL (VALUES (l.mes_caixa), (l.mes_competencia)) v(mes)
              WHERE v.mes IS NOT NULL)                                                  AS fatos`
  );
  igual('folhas do drill = fatos da DRE', grao.folhas, grao.fatos, inteiro);

  console.log('\n  Níveis, e o total de cada um (competência, todos os meses):');
  for (const n of await q(
    `SELECT nivel, nivel_nome, count(*) nos, sum(valor_cents) v, sum(lacuna_cents) lac
       FROM fin_dre_drill_arvore_v WHERE visao = 'competencia' GROUP BY 1, 2 ORDER BY 1`
  )) {
    console.log(
      `    ${n.nivel} ${String(n.nivel_nome).padEnd(12)} ${String(n.nos).padStart(7)} nós  ` +
      `${brl(n.v).padStart(18)}   lacuna ${brl(n.lac).padStart(16)}`
    );
  }

  // =========================================================================
  console.log('\n=== 2. A regra de ouro: na visão caixa, realizado é fin_transaction ===');

  const ouro = await um(`SELECT * FROM fin_dre_regra_de_ouro_v`);
  igual('resíduo entre a DRE de caixa e o ledger', ouro.residuo_ledger_cents, 0);
  igual('resíduo entre abertura + DRE e o saldo atual', ouro.residuo_saldo_cents, 0);
  igual('itens de cartão na visão caixa', ouro.itens_cartao_no_caixa, 0, inteiro);
  verdade('a regra de ouro fecha', ouro.fecha,
    `${ouro.meses} meses · ${ouro.lancamentos} lançamentos · ${brl(ouro.dre_cents)}`);
  console.log(`    abertura ${brl(ouro.abertura)} + DRE de caixa ${brl(ouro.dre_cents)} = ${brl(ouro.atual)}`);

  // Competência é reorganização temporal do MESMO dinheiro. O total das duas
  // visões tem de ser idêntico, tirando o cartão — que só existe em uma delas.
  const [visoes] = await q(
    `SELECT (SELECT sum(amount_cents) FROM fin_dre_drill_v WHERE visao = 'caixa')       AS caixa,
            (SELECT sum(amount_cents) FROM fin_dre_drill_v WHERE visao = 'competencia'
               AND origem = 'ledger')                                                   AS comp_ledger`
  );
  igual('competência move o MESMO dinheiro no tempo (ledger, total das duas visões)',
    visoes.comp_ledger, visoes.caixa);

  // =========================================================================
  console.log('\n=== 3. A lacuna viaja em todo nível, não num rodapé ===');

  for (const nivel of [2, 3, 4]) {
    const [l] = await q(
      `SELECT count(*) n FROM (
         SELECT visao, mes, pai, sum(lacuna_cents) f FROM fin_dre_drill_arvore_v
          WHERE nivel = $1 GROUP BY 1, 2, 3) x
         JOIN fin_dre_drill_arvore_v p
           ON p.nivel = $1 - 1 AND p.visao = x.visao AND p.mes = x.mes AND p.chave = x.pai
        WHERE x.f IS DISTINCT FROM p.lacuna_cents`,
      [nivel]
    );
    igual(`grupos em que a lacuna do nível ${nivel} não soma a do ${nivel - 1}`, l.n, 0, inteiro);
  }

  const [lac] = await q(
    `SELECT sum(lacuna_cents) liquido, sum(lacuna_bruto_cents) bruto, sum(lancamentos) n
       FROM fin_dre_drill_arvore_v
      WHERE nivel = 1 AND visao = 'competencia' AND linha = 'lacuna_cartao_sem_categoria'`
  );
  const [cartao] = await q(
    `SELECT count(*) n, sum(amount_cents) soma, sum(abs(amount_cents)) bruto
       FROM fin_card_transaction WHERE category_id IS NULL AND kind <> 'pagamento_fatura'`
  );
  igual('lacuna de cartão no drill = itens de cartão sem categoria', lac.liquido, -Number(cartao.soma));
  igual('lacuna de cartão em valor bruto', lac.bruto, cartao.bruto);
  igual('itens de cartão na lacuna', lac.n, cartao.n, inteiro);

  // A ressalva vem ANTES do número, e traz o valor medido junto.
  const ressalvas = await q(
    `SELECT visao, to_char(mes, 'YYYY-MM') mes, linha, chave, posicao, severidade,
            valor_em_jogo_cents, texto
       FROM fin_dre_drill_ressalva_v
      WHERE chave = 'folha_do_mes_nao_saiu' ORDER BY mes DESC LIMIT 3`
  );
  verdade('existe ressalva de mês aberto (folha ainda não saiu)', ressalvas.length > 0);
  for (const r of ressalvas) {
    verdade(`ressalva de ${r.mes} vem ANTES do número`, r.posicao === 'antes',
      `${brl(r.valor_em_jogo_cents)} em jogo`);
    console.log(`    ${r.texto}`);
  }
  const [semDepois] = await q(
    `SELECT count(*) n FROM fin_dre_drill_ressalva_v WHERE posicao <> 'antes'`
  );
  igual('ressalvas que caíram em rodapé', semDepois.n, 0, inteiro);

  // A hipótese de destino existe, tem evidência, e NUNCA é somada.
  const [destino] = await q(
    `SELECT count(*) total,
            count(*) FILTER (WHERE linha_provavel IS NOT NULL)  AS com_hipotese,
            count(*) FILTER (WHERE linha_provavel IS NULL)      AS sem_hipotese,
            count(*) FILTER (WHERE linha_provavel IS NOT NULL AND evidencia IS NULL) AS sem_evidencia,
            count(*) FILTER (WHERE linha_provavel IS NULL AND motivo_indeterminado IS NULL) AS sem_motivo
       FROM fin_dre_lacuna_destino_v`
  );
  igual('hipótese de destino sem evidência escrita', destino.sem_evidencia, 0, inteiro);
  igual('lacuna sem hipótese e sem motivo declarado', destino.sem_motivo, 0, inteiro);
  console.log(`    ${destino.com_hipotese} de ${destino.total} lacunas têm destino provável com evidência; ` +
    `${destino.sem_hipotese} ficam indeterminadas com motivo`);
  for (const d of await q(
    `SELECT linha_provavel, count(*) n, sum(abs(amount_cents)) v, round(avg(concordancia_pct), 1) c
       FROM fin_dre_lacuna_destino_v WHERE linha_provavel IS NOT NULL
      GROUP BY 1 ORDER BY 3 DESC LIMIT 6`
  )) {
    console.log(`    ${String(d.linha_provavel).padEnd(28)} ${String(d.n).padStart(4)} itens  ` +
      `${brl(d.v).padStart(14)}  concordância média ${d.c}%`);
  }

  // =========================================================================
  console.log('\n=== 4. Mover: o dry-run recusa antes de o gatilho apagar ===');

  const alvo = await um(
    `SELECT t.id, t.amount_cents, c.code, t.classified_by, t.classified_rule_id, t.review_status
       FROM fin_transaction t
       JOIN fin_category c ON c.id = t.category_id
       JOIN fin_review_item ri ON ri.target_table = 'fin_transaction' AND ri.target_id = t.id
      WHERE ri.status = 'pendente' AND ri.reason = 'baixa_confianca'
        AND t.amount_cents < 0 AND NOT t.is_split_parent
      ORDER BY t.id LIMIT 1`
  );
  const destinoDespesa = await um(
    `SELECT id, code FROM fin_category
      WHERE dre_line = 'despesas_administrativas' AND kind = 'despesa_operacional' AND is_active
      ORDER BY code LIMIT 1`
  );
  const destinoReceita = await um(
    `SELECT id, code FROM fin_category WHERE kind = 'receita' AND is_active ORDER BY code LIMIT 1`
  );

  if (!alvo || !destinoDespesa || !destinoReceita) {
    falhou('achar um lançamento de teste', 'a base não tem o caso; o teste do mover não rodou');
  } else {
    console.log(`  · alvo: lançamento ${alvo.id} (${brl(alvo.amount_cents)}), hoje em ${alvo.code}, ` +
      `carimbado por "${alvo.classified_by}" regra ${alvo.classified_rule_id}, revisão ${alvo.review_status}`);

    // 4.1 D3: categoria de receita num lançamento de SAÍDA.
    const [d3] = await q(`SELECT * FROM fin_dre_mover_avaliar('fin_transaction', $1, $2)`,
      [[Number(alvo.id)], Number(destinoReceita.id)]);
    verdade('categoria de RECEITA em lançamento de SAÍDA é recusada (D3)', d3.aceito === false,
      d3.recusa?.slice(0, 90));

    // 4.2 E o motivo pelo qual a recusa precisa existir. Um UPDATE cru com a
    // mesma categoria termina de um destes dois jeitos, e nenhum é o que o
    // usuário pediu:
    //
    //   · o gatilho de sinal zera `category_id` em SILÊNCIO e o UPDATE volta
    //     sucesso — o usuário vê "movido" e a DRE vê "sumiu para a lacuna";
    //   · ou, nas 9.793 linhas que carregam `classified_rule_version_id`, o
    //     mesmo gatilho zera `classified_rule_id` sem que
    //     `zz_fin_transaction_rule_version` chegue a rodar (ele só dispara com
    //     essas colunas no SET), e o CHECK de paridade da 0088 estoura com uma
    //     mensagem que não diz nada sobre sinal de categoria.
    //
    // Os dois são o mesmo defeito de camada: quem escreve não recebe a
    // explicação. Por isso a recusa acontece ANTES, em português.
    await client.query('SAVEPOINT prova_gatilho');
    let cruSilencioso = false;
    let cruErro = null;
    try {
      await client.query(`UPDATE fin_transaction SET category_id = $1 WHERE id = $2`,
        [Number(destinoReceita.id), Number(alvo.id)]);
      const depoisDoGatilho = await um(`SELECT category_id FROM fin_transaction WHERE id = $1`, [Number(alvo.id)]);
      cruSilencioso = depoisDoGatilho.category_id === null;
    } catch (erro) {
      cruErro = erro.message.split('\n')[0];
    }
    await client.query('ROLLBACK TO SAVEPOINT prova_gatilho');
    verdade('o UPDATE cru NUNCA faz o que o usuário pediu (por isso a recusa vem antes)',
      cruSilencioso || cruErro !== null,
      cruErro ? `estourou opaco: ${cruErro.slice(0, 90)}` : 'zerou a categoria em silêncio');

    // 4.3 Categoria inexistente, inativa e nula.
    const [inexistente] = await q(`SELECT * FROM fin_dre_mover_avaliar('fin_transaction', $1, 999999999)`,
      [[Number(alvo.id)]]);
    verdade('categoria de destino inexistente é recusada', inexistente.aceito === false, inexistente.recusa);
    const [nula] = await q(`SELECT * FROM fin_dre_mover_avaliar('fin_transaction', $1, NULL)`,
      [[Number(alvo.id)]]);
    verdade('mover para "sem categoria" é recusado', nula.aceito === false, nula.recusa?.slice(0, 80));
    const [fantasma] = await q(`SELECT * FROM fin_dre_mover_avaliar('fin_transaction', ARRAY[999999999::bigint], $1)`,
      [Number(destinoDespesa.id)]);
    verdade('id inexistente volta na resposta, recusado', fantasma?.aceito === false, fantasma?.recusa);

    // 4.4 O movimento válido: dry-run com o impacto em reais.
    const [valido] = await q(`SELECT * FROM fin_dre_mover_avaliar('fin_transaction', $1, $2)`,
      [[Number(alvo.id)], Number(destinoDespesa.id)]);
    verdade(`mover ${alvo.code} → ${destinoDespesa.code} é aceito`, valido.aceito === true,
      `${valido.linha_antes} → ${valido.linha_depois}`);

    const impacto = await q(`SELECT * FROM fin_dre_mover_impacto('fin_transaction', $1, $2)`,
      [[Number(alvo.id)], Number(destinoDespesa.id)]);
    console.log('\n  Impacto simulado na DRE, antes → depois:');
    for (const i of impacto) {
      console.log(`    ${i.visao.padEnd(12)} ${String(i.mes).slice(0, 7)} ${i.linha.padEnd(28)} ` +
        `${brl(i.valor_antes).padStart(16)} → ${brl(i.valor_depois).padStart(16)}  ` +
        `delta ${brl(i.delta).padStart(14)}`);
    }
    const porMes = new Map();
    for (const i of impacto) {
      const chave = `${i.visao}|${String(i.mes).slice(0, 7)}`;
      porMes.set(chave, (porMes.get(chave) ?? 0) + Number(i.delta));
    }
    igual('meses em que o impacto simulado não soma zero',
      [...porMes.values()].filter((v) => v !== 0).length, 0, inteiro);
    verdade('o impacto toca as duas visões', porMes.size >= 2, `${porMes.size} (visão, mês)`);

    // 4.5 Lote é tudo ou nada.
    await recusa('lote com um id recusado não escreve nada',
      `SELECT * FROM fin_dre_mover_aplicar('fin_transaction', $1, $2, 'motivo suficiente para o teste', 'teste')`,
      [[Number(alvo.id), 999999999], Number(destinoDespesa.id)]);
    await recusa('mover sem autor é recusado',
      `SELECT * FROM fin_dre_mover_aplicar('fin_transaction', $1, $2, 'motivo suficiente', '')`,
      [[Number(alvo.id)], Number(destinoDespesa.id)]);
    await recusa('mover sem motivo é recusado',
      `SELECT * FROM fin_dre_mover_aplicar('fin_transaction', $1, $2, 'ajuste', 'teste')`,
      [[Number(alvo.id)], Number(destinoDespesa.id)]);

    // =======================================================================
    console.log('\n=== 5. A ORDEM importa — os dois lados, medidos ===');

    // 5.1 A ordem ERRADA, de propósito: UPDATE primeiro, fila depois. O
    // gatilho BEFORE da 0094 lê o item ainda pendente e reverte o 'ok'.
    await client.query('SAVEPOINT ordem_errada');
    await client.query(
      `UPDATE fin_transaction SET category_id = $1, review_status = 'ok' WHERE id = $2`,
      [Number(destinoDespesa.id), Number(alvo.id)]
    );
    await client.query(
      `UPDATE fin_review_item SET status = 'resolvido', resolved_at = now(), resolved_by = 'teste'
        WHERE target_table = 'fin_transaction' AND target_id = $1 AND reason = 'baixa_confianca'`,
      [Number(alvo.id)]
    );
    const errada = await um(`SELECT review_status FROM fin_transaction WHERE id = $1`, [Number(alvo.id)]);
    verdade("na ordem errada o review_status='ok' reverte sozinho para 'pendente'",
      errada.review_status === 'pendente',
      'o gatilho da 0094 é BEFORE e lê a fila no instante do UPDATE');
    await client.query('ROLLBACK TO SAVEPOINT ordem_errada');

    // 5.2 A ordem CERTA, através da função.
    const ancoraAntes = await q(
      `SELECT account_id, count(*) n, sum(amount_cents) soma FROM fin_transaction GROUP BY account_id ORDER BY 1`
    );
    const linhaAntes = await um(
      `SELECT valor_cents FROM fin_dre_drill_arvore_v
        WHERE nivel = 1 AND visao = 'competencia' AND linha = 'despesas_administrativas'
          AND mes = (SELECT date_trunc('month', competence_date)::date FROM fin_transaction WHERE id = $1)`,
      [Number(alvo.id)]
    );

    const [aplicado] = await q(
      `SELECT * FROM fin_dre_mover_aplicar('fin_transaction', $1, $2,
              'a regra 40 casava o banco do recebedor no fim do PIX, nao a contraparte', 'teste:dre-drill')`,
      [[Number(alvo.id)], Number(destinoDespesa.id)]
    );
    ok('mover aplicado', `${aplicado.linha_antes} → ${aplicado.linha_depois} (lote ${aplicado.batch_id})`);

    const depois = await um(
      `SELECT t.category_id, c.code, t.classified_by, t.classified_rule_id, t.review_status,
              t.human_locked_fields, t.classified_reason
         FROM fin_transaction t LEFT JOIN fin_category c ON c.id = t.category_id WHERE t.id = $1`,
      [Number(alvo.id)]
    );
    verdade('a categoria mudou', depois.code === destinoDespesa.code, depois.code);
    verdade("classified_by = 'humano'", depois.classified_by === 'humano');
    verdade('classified_rule_id foi zerado (D6)', depois.classified_rule_id === null);
    verdade("'category_id' entrou em human_locked_fields (E1/E2)",
      (depois.human_locked_fields ?? []).includes('category_id'),
      JSON.stringify(depois.human_locked_fields));
    verdade("review_status = 'ok' e FICOU 'ok'", depois.review_status === 'ok',
      'a fila foi resolvida ANTES do UPDATE');

    const fila = await um(
      `SELECT status, resolved_by FROM fin_review_item
        WHERE target_table = 'fin_transaction' AND target_id = $1`, [Number(alvo.id)]);
    verdade('o item de fila baixa_confianca ficou resolvido', fila?.status === 'resolvido',
      `resolvido por ${fila?.resolved_by}`);

    const evento = await um(
      `SELECT stage, accepted, superseded_value, actor, rationale FROM fin_classification_event
        WHERE target_table = 'fin_transaction' AND target_id = $1 ORDER BY id DESC LIMIT 1`,
      [Number(alvo.id)]);
    verdade("fin_classification_event gravado com stage='humano'", evento?.stage === 'humano');
    verdade('o evento guarda o valor anterior', evento?.superseded_value?.categoria === alvo.code,
      JSON.stringify(evento?.superseded_value));
    verdade('accepted=false: um humano trocou o que a máquina disse', evento?.accepted === false);

    const auditoria = await q(
      `SELECT target_table, action, before, after, fields, actor FROM fin_audit_log
        WHERE batch_id = $1 ORDER BY id`, [aplicado.batch_id]);
    verdade('fin_audit_log gravou a transação e o item de fila', auditoria.length >= 2,
      auditoria.map((a) => a.target_table).join(' + '));
    const auditTx = auditoria.find((a) => a.target_table === 'fin_transaction');
    verdade('a auditoria guarda a linha da DRE antes e depois',
      auditTx?.before?.linha_dre === 'custos_diretos' || auditTx?.before?.linha_dre !== auditTx?.after?.linha_dre,
      `${auditTx?.before?.linha_dre} → ${auditTx?.after?.linha_dre}`);

    // A âncora: nenhum centavo mudou de conta.
    const ancoraDepois = await q(
      `SELECT account_id, count(*) n, sum(amount_cents) soma FROM fin_transaction GROUP BY account_id ORDER BY 1`
    );
    igual('contas com âncora de dinheiro alterada',
      ancoraAntes.filter((a, i) =>
        String(a.soma) !== String(ancoraDepois[i]?.soma) || String(a.n) !== String(ancoraDepois[i]?.n)).length,
      0, inteiro);

    const ouroDepois = await um(`SELECT * FROM fin_dre_regra_de_ouro_v`);
    verdade('a regra de ouro continua fechando depois de mover', ouroDepois.fecha === true);

    const linhaDepois = await um(
      `SELECT valor_cents FROM fin_dre_drill_arvore_v
        WHERE nivel = 1 AND visao = 'competencia' AND linha = 'despesas_administrativas'
          AND mes = (SELECT date_trunc('month', competence_date)::date FROM fin_transaction WHERE id = $1)`,
      [Number(alvo.id)]
    );
    igual('a linha de destino subiu exatamente o valor do lançamento',
      Number(linhaDepois?.valor_cents ?? 0) - Number(linhaAntes?.valor_cents ?? 0),
      Number(alvo.amount_cents));

    // D2/D3 e E1/E2 continuam válidos sobre a linha tocada.
    const [invar] = await q(
      `SELECT (SELECT count(*) FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
                WHERE NOT t.is_split_parent AND t.amount_cents > 0
                  AND c.kind IN ('custo_variavel_direto','despesa_operacional','pessoal','imposto','investimento')
                  AND lower(t.description_norm) !~ '(estorno|reembolso|devolu|refund|cancelamento)') AS d2,
              (SELECT count(*) FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
                WHERE NOT t.is_split_parent AND t.amount_cents < 0 AND c.kind = 'receita')            AS d3,
              (SELECT count(*) FROM fin_transaction
                WHERE human_locked_fields <> '{}' AND coalesce(classified_by,'') NOT IN ('humano','trava')) AS e1,
              (SELECT count(*) FROM fin_transaction
                WHERE 'category_id' = ANY(human_locked_fields) AND category_id IS NULL)              AS e2,
              (SELECT count(*) FROM fin_transaction
                WHERE classified_by = 'contrato' AND classified_rule_id IS NOT NULL)                  AS d6`
    );
    igual('D2 depois de mover', invar.d2, 0, inteiro);
    igual('D3 depois de mover', invar.d3, 0, inteiro);
    igual('E1 depois de mover', invar.e1, 0, inteiro);
    igual('E2 depois de mover', invar.e2, 0, inteiro);
    console.log(`    (D6 permanece em ${invar.d6}, que é a dúvida 40 e não foi tocada aqui)`);

    // Mover de novo para a mesma categoria é no-op declarado, não erro.
    const [noop] = await q(`SELECT * FROM fin_dre_mover_avaliar('fin_transaction', $1, $2)`,
      [[Number(alvo.id)], Number(destinoDespesa.id)]);
    verdade('mover para a categoria que já está é "sem efeito", não erro',
      noop.aceito === true && noop.sem_efeito === true);
  }

  // =========================================================================
  console.log('\n=== 6. Item de cartão: mover o que está na lacuna ===');

  const itemCartao = await um(
    `SELECT ct.id, ct.amount_cents, ct.description, ct.installment_plan_id
       FROM fin_card_transaction ct
      WHERE ct.category_id IS NULL AND ct.kind = 'compra' AND ct.installment_plan_id IS NULL
      ORDER BY ct.amount_cents DESC LIMIT 1`
  );
  const destinoCartao = await um(
    `SELECT id, code FROM fin_category
      WHERE dre_line = 'despesas_administrativas' AND kind = 'despesa_operacional' AND is_active
      ORDER BY code LIMIT 1`
  );
  if (!itemCartao || !destinoCartao) {
    console.log('  · nenhum item de cartão sem categoria e sem plano: o caso não existe hoje');
  } else {
    const lacAntes = await um(
      `SELECT sum(lacuna_bruto_cents) v FROM fin_dre_drill_arvore_v
        WHERE nivel = 1 AND visao = 'competencia' AND linha = 'lacuna_cartao_sem_categoria'`);
    const [aplicadoCartao] = await q(
      `SELECT * FROM fin_dre_mover_aplicar('fin_card_transaction', $1, $2,
              'classificacao humana do item de cartao no teste de aceite', 'teste:dre-drill')`,
      [[Number(itemCartao.id)], Number(destinoCartao.id)]
    );
    ok('item de cartão movido', `${aplicadoCartao.linha_antes} → ${aplicadoCartao.linha_depois}`);
    const lacDepois = await um(
      `SELECT sum(lacuna_bruto_cents) v FROM fin_dre_drill_arvore_v
        WHERE nivel = 1 AND visao = 'competencia' AND linha = 'lacuna_cartao_sem_categoria'`);
    igual('a lacuna de cartão caiu exatamente o valor do item',
      Number(lacAntes.v) - Number(lacDepois.v), Math.abs(Number(itemCartao.amount_cents)));

    const ouroCartao = await um(`SELECT * FROM fin_dre_regra_de_ouro_v`);
    verdade('classificar item de cartão NÃO mexe no caixa', ouroCartao.fecha === true,
      'o custo do cartão vive na competência da compra; o caixa é o pagamento da fatura');

    const cartaoDepois = await um(
      `SELECT classified_by, classified_rule_id, human_locked_fields FROM fin_card_transaction WHERE id = $1`,
      [Number(itemCartao.id)]);
    verdade("item de cartão: classified_by = 'humano'", cartaoDepois.classified_by === 'humano');
    verdade("item de cartão: 'category_id' travado",
      (cartaoDepois.human_locked_fields ?? []).includes('category_id'));
  }

  // =========================================================================
  console.log('\n=== 7. Ajuste declarado: existe, é separado, e não toca o caixa ===');

  const entidade = await um(`SELECT id FROM fin_entity ORDER BY id LIMIT 1`);
  const mesAlvo = await um(
    `SELECT mes, lucro_liquido_cents FROM fin_dre_mensal_v WHERE visao = 'competencia' ORDER BY mes DESC LIMIT 1`);

  const dreAntes = await q(
    `SELECT visao, mes, lucro_liquido_cents, lucro_liquido_com_lacunas_cents FROM fin_dre_mensal_v ORDER BY visao, mes`);
  const saldosAntes = await q(`SELECT id, current_balance_cents FROM fin_account ORDER BY id`);

  const [ajuste] = await q(
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'competencia', $2, 'despesas_administrativas', -1500000,
             'provisao de rescisao afirmada pelo dono, sem lancamento no extrato', 'teste:dre-drill')
     RETURNING id, amount_cents`,
    [Number(entidade.id), mesAlvo.mes]
  );
  ok('ajuste declarado registrado', `${brl(ajuste.amount_cents)} com autor e motivo`);

  const dreDepois = await q(
    `SELECT visao, mes, lucro_liquido_cents, lucro_liquido_com_lacunas_cents FROM fin_dre_mensal_v ORDER BY visao, mes`);
  igual('linhas de fin_dre_mensal_v alteradas pelo ajuste',
    dreAntes.filter((a, i) =>
      String(a.lucro_liquido_cents) !== String(dreDepois[i]?.lucro_liquido_cents) ||
      String(a.lucro_liquido_com_lacunas_cents) !== String(dreDepois[i]?.lucro_liquido_com_lacunas_cents)).length,
    0, inteiro);

  const saldosDepois = await q(`SELECT id, current_balance_cents FROM fin_account ORDER BY id`);
  igual('contas com saldo alterado pelo ajuste',
    saldosAntes.filter((a, i) => String(a.current_balance_cents) !== String(saldosDepois[i]?.current_balance_cents)).length,
    0, inteiro);

  const ouroAjuste = await um(`SELECT * FROM fin_dre_regra_de_ouro_v`);
  verdade('a regra de ouro fecha com ajuste declarado na base', ouroAjuste.fecha === true);

  const comAjuste = await q(
    `SELECT linha, secao, origem, valor_cents, autor FROM fin_dre_com_ajuste_v
      WHERE visao = 'competencia' AND mes = $1 AND secao = 'ajuste' ORDER BY ordem`, [mesAlvo.mes]);
  verdade('o ajuste aparece em seção própria de fin_dre_com_ajuste_v',
    comAjuste.some((l) => l.origem === 'declarado' && Number(l.valor_cents) === Number(ajuste.amount_cents)),
    comAjuste.map((l) => `${l.linha}=${brl(l.valor_cents)}`).join(' · '));
  const somaAjuste = comAjuste.find((l) => l.linha === 'lucro_liquido_com_ajuste');
  igual('lucro líquido com ajuste = lucro líquido + ajustes',
    somaAjuste?.valor_cents, Number(mesAlvo.lucro_liquido_cents) + Number(ajuste.amount_cents));
  const [misturado] = await q(
    `SELECT count(*) n FROM fin_dre_com_ajuste_v
      WHERE origem = 'declarado' AND secao <> 'ajuste'`);
  igual('ajuste misturado com linha do extrato', misturado.n, 0, inteiro);

  await recusa('ajuste na visão CAIXA é recusado',
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'caixa', $2, 'despesas_administrativas', -1000, 'motivo com tamanho suficiente', 'teste')`,
    [Number(entidade.id), mesAlvo.mes]);
  await recusa('ajuste em linha de SUBTOTAL é recusado',
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'competencia', $2, 'lucro_liquido', -1000, 'motivo com tamanho suficiente', 'teste')`,
    [Number(entidade.id), mesAlvo.mes]);
  await recusa("ajuste em linha da seção 'fora' é recusado",
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'competencia', $2, 'fora_movimentacao', -1000, 'motivo com tamanho suficiente', 'teste')`,
    [Number(entidade.id), mesAlvo.mes]);
  await recusa('ajuste sem motivo de verdade é recusado',
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'competencia', $2, 'despesas_administrativas', -1000, 'ajuste', 'teste')`,
    [Number(entidade.id), mesAlvo.mes]);
  await recusa('ajuste sem autor é recusado',
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'competencia', $2, 'despesas_administrativas', -1000, 'motivo com tamanho suficiente', '  ')`,
    [Number(entidade.id), mesAlvo.mes]);
  await recusa('ajuste de valor zero é recusado',
    `INSERT INTO fin_dre_ajuste (entity_id, visao, mes, linha, amount_cents, motivo, autor)
     VALUES ($1, 'competencia', $2, 'despesas_administrativas', 0, 'motivo com tamanho suficiente', 'teste')`,
    [Number(entidade.id), mesAlvo.mes]);

  // =========================================================================
  console.log('\n=== 8. Diagnóstico: a DRE de agosto, aberta até a categoria ===');

  for (const l of await q(
    `SELECT rotulo, valor_cents, lacuna_cents, lancamentos, secao
       FROM fin_dre_drill_arvore_v
      WHERE nivel = 1 AND visao = 'competencia' AND mes = '2026-08-01'
      ORDER BY linha_ordem`
  )) {
    console.log(`    ${String(l.secao).padEnd(10)} ${String(l.rotulo).padEnd(30)} ${brl(l.valor_cents).padStart(16)}` +
      `${Number(l.lacuna_cents) ? `   lacuna ${brl(l.lacuna_cents)}` : ''}   ${l.lancamentos} lanç.`);
  }
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

console.log(`\n${falhas === 0 ? 'OK' : 'FALHOU'} — ${passes} verificações passaram, ${falhas} falharam`);
process.exit(falhas === 0 ? 0 : 1);
