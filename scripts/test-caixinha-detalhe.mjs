// Prova da 0114 — o detalhe das caixinhas, em transação com ROLLBACK.
//
// ===========================================================================
// O QUE ESTE TESTE PRECISA PROVAR, E POR QUÊ
// ===========================================================================
// A frente respondeu a "quero clicar na caixinha e ver as subcaixas" com uma
// medição incômoda: o nível "caixinha nomeada" NÃO existe em fonte nenhuma. É
// fácil escrever uma tela que finge o contrário — basta agrupar por valor ou
// por data e dar nomes. Então o teste guarda as duas pontas:
//
//   1. o dinheiro fecha, ao centavo, do pai para os filhos diretos;
//   2. nenhuma linha oferece nome de caixinha, e toda linha carrega o motivo.
//
// Roda o arquivo inteiro da migration numa transação, mede, e dá ROLLBACK. A
// âncora de dinheiro por conta é fotografada antes e depois — se a 0114
// mover um centavo de qualquer conta, o teste falha.
//
// SOMENTE LEITURA no banco (tudo desfeito). Nenhuma API externa é chamada.
//
// Uso:
//   node scripts/test-caixinha-detalhe.mjs
//   node scripts/test-caixinha-detalhe.mjs --catalogo   imprime a árvore inteira
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

// `new URL('..', import.meta.url)` vira asset no Turbopack e a rota morre com
// "Can't resolve '..'". A lição é da frente das fontes (0109).
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGO = process.argv.includes('--catalogo');

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let passou = 0;
let falhou = 0;
const afirma = (condicao, texto, detalhe = '') => {
  if (condicao) {
    passou += 1;
    console.log(`  ok   ${texto}${detalhe ? `  ${detalhe}` : ''}`);
  } else {
    falhou += 1;
    console.log(`  FALHA ${texto}${detalhe ? `  ${detalhe}` : ''}`);
  }
};

const pool = financePool();
const c = await pool.connect();
c.on('notice', (n) => console.log(`  · ${String(n.message).replace(/^\[0114\] /, '')}`));

try {
  await c.query('BEGIN');

  // ---------------------------------------------------------------- âncora
  const ancoraSql = `SELECT account_id, coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) soma
                       FROM fin_transaction GROUP BY account_id ORDER BY account_id`;
  const antes = await c.query(ancoraSql);

  console.log('\nAPLICANDO 0114 na transação');
  const sql = await readFile(join(RAIZ, 'db/migrations/0114_fin_caixinha_detalhe.sql'), 'utf8');
  await c.query(sql);

  const depois = await c.query(ancoraSql);
  console.log('\n1. A MIGRATION NÃO MOVE DINHEIRO');
  afirma(
    JSON.stringify(antes.rows) === JSON.stringify(depois.rows),
    'âncora por conta idêntica antes e depois',
    `${antes.rowCount} conta(s)`
  );

  // ----------------------------------------------------- nível 0 → nível 1
  const { rows: ancoras } = await c.query(
    `SELECT * FROM fin_caixinha_ancora_v ORDER BY account_slug`
  );
  const cx = ancoras.find((a) => a.account_slug === 'nubank-caixinhas');

  console.log('\n2. O PAI É A SOMA DOS FILHOS DIRETOS, AO CENTAVO');
  afirma(Boolean(cx), 'nubank-caixinhas aparece em fin_caixinha_ancora_v');
  afirma(
    Number(cx.delta_cents) === 0,
    'saldo da conta = soma das posições',
    `${brl(cx.saldo_conta_cents)} = ${brl(cx.soma_posicoes_cents)}`
  );
  // A conta é 'aplicacao' e o invariante da 0043 é o mesmo número por outro
  // caminho. Duas medidas do mesmo dinheiro que discordam é sempre defeito.
  const { rows: [v43] } = await c.query(
    `SELECT saldo_conta_cents, soma_posicoes_cents FROM fin_investment_posicao WHERE account_slug = 'nubank-caixinhas'`
  );
  afirma(
    Number(v43.soma_posicoes_cents) === Number(cx.soma_posicoes_cents),
    'a view nova concorda com fin_investment_posicao (0043)',
    brl(v43.soma_posicoes_cents)
  );

  // As posições ATIVAS explicam o saldo inteiro; as liquidadas somam zero.
  const { rows: [porStatus] } = await c.query(
    `SELECT coalesce(sum(balance_cents) FILTER (WHERE status = 'ativa'), 0) ativas,
            coalesce(sum(balance_cents) FILTER (WHERE status <> 'ativa'), 0) encerradas
       FROM fin_caixinha_posicao_v WHERE account_slug = 'nubank-caixinhas'`
  );
  afirma(
    Number(porStatus.ativas) === Number(cx.saldo_conta_cents),
    'as posições ATIVAS sozinhas explicam o saldo',
    brl(porStatus.ativas)
  );
  afirma(
    Number(porStatus.encerradas) === 0,
    'as posições liquidadas somam zero — são histórico, não caixa'
  );

  // ----------------------------------------------------- a lacuna declarada
  console.log('\n3. NENHUMA LINHA INVENTA NOME DE CAIXINHA');
  const { rows: [nomes] } = await c.query(
    `SELECT count(*) total,
            count(*) FILTER (WHERE caixinha_nome IS NOT NULL) com_nome,
            count(*) FILTER (WHERE caixinha_nome_motivo IS NULL OR caixinha_nome_motivo = '') sem_motivo
       FROM fin_caixinha_posicao_v`
  );
  afirma(Number(nomes.com_nome) === 0, 'caixinha_nome é NULL em todas', `${nomes.total} posição(ões)`);
  afirma(Number(nomes.sem_motivo) === 0, 'toda linha carrega o motivo — valor nulo sem motivo é proibido');

  // A EVIDÊNCIA da lacuna, relida do acervo e não do comentário: se a fonte
  // entregasse identidade, `name` teria mais de um valor.
  const { rows: [fonte] } = await c.query(
    `SELECT count(*) posicoes, count(DISTINCT name) nomes, count(DISTINCT issuer) emissores,
            count(*) FILTER (WHERE issuer_document IS NOT NULL) com_documento
       FROM fin_investment WHERE provider = 'polp'`
  );
  afirma(
    Number(fonte.nomes) === 1,
    'a fonte entrega UM nome de produto para todas as posições',
    `${fonte.posicoes} posições · ${fonte.nomes} nome · ${fonte.emissores} emissor`
  );

  // O extrato e o PDF concordam, por caminhos independentes.
  const { rows: [texto] } = await c.query(
    `SELECT count(*) n FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
      WHERE a.slug = 'nubank' AND t.description_norm ~ '^(aplicacao|resgate) rdb'
        AND t.description_raw !~* 'caixinh'`
  );
  const { rows: [textoTotal] } = await c.query(
    `SELECT count(*) n FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
      WHERE a.slug = 'nubank' AND t.description_norm ~ '^(aplicacao|resgate) rdb'`
  );
  afirma(
    Number(texto.n) === Number(textoTotal.n),
    'o extrato do Nubank também não nomeia caixinha em nenhuma linha de RDB',
    `${textoTotal.n} linha(s)`
  );

  // ----------------------------------------------------- nível 1 → nível 2
  console.log('\n4. A POSIÇÃO CONTRA OS PRÓPRIOS MOVIMENTOS');
  // A identidade: saldo − fluxo líquido = rendimento apropriado dentro.
  const { rows: [ident] } = await c.query(
    `SELECT count(*) total,
            count(*) FILTER (WHERE divergencia_cents = 0) fecham,
            count(*) FILTER (WHERE divergencia_cents <> 0) divergem,
            coalesce(sum(divergencia_cents) FILTER (WHERE divergencia_cents <> 0), 0) valor
       FROM fin_caixinha_posicao_v WHERE account_slug = 'nubank-caixinhas'`
  );
  afirma(
    Number(ident.fecham) + Number(ident.divergem) === Number(ident.total),
    'toda posição é ou fechada ou divergente — não há terceiro estado',
    `${ident.fecham} fecham · ${ident.divergem} divergem`
  );
  // A divergência EXISTE e o teste exige que ela continue visível. Um teste
  // que exigisse zero forçaria a próxima pessoa a escondê-la para passar.
  afirma(
    Number(ident.divergem) > 0,
    'a divergência conhecida continua exposta, não absorvida',
    `${ident.divergem} posição(ões), ${brl(ident.valor)}`
  );
  afirma(
    Number(ident.divergem) === Number(cx.posicoes_divergentes) &&
      Number(ident.valor) === Number(cx.divergencia_cents),
    'a âncora e o detalhe contam a MESMA divergência'
  );

  // Divergência é sobre o FLUXO, nunca sobre o saldo: o saldo vem da posição.
  afirma(
    Number(cx.delta_cents) === 0 && Number(cx.divergencia_cents) !== 0,
    'histórico de movimento incompleto NÃO contamina o saldo da conta'
  );

  const { rows: [mov] } = await c.query(
    `SELECT count(*) n, count(DISTINCT posicao_id) posicoes,
            coalesce(sum(assinado_cents), 0) liquido
       FROM fin_caixinha_movimento_v`
  );
  afirma(
    Number(mov.n) === Number(ancoras.reduce((s, a) => s + Number(a.movimentos), 0)),
    'a contagem de movimentos bate entre os dois níveis',
    `${mov.n} movimento(s) em ${mov.posicoes} posição(ões)`
  );

  // O nível 2 NÃO pode ser somado como caixa, e a prova é que ele difere do
  // saldo — se batesse por acaso, alguém acabaria somando os dois.
  afirma(
    Number(mov.liquido) !== Number(cx.saldo_conta_cents),
    'o fluxo líquido NÃO é o saldo — os dois níveis não se substituem',
    `${brl(mov.liquido)} ≠ ${brl(cx.saldo_conta_cents)}`
  );

  // ----------------------------------------------------------- o catálogo
  if (CATALOGO) {
    console.log('\n' + '='.repeat(78));
    console.log('A ÁRVORE, COMO A TELA A MOSTRA');
    console.log('='.repeat(78));
    for (const a of ancoras) {
      if (!Number(a.posicoes)) continue;
      console.log(`\n${a.account_nome}`);
      console.log(`  ${brl(a.saldo_conta_cents)} saldo  ${Number(a.delta_cents) === 0 ? '=' : '≠'}  ${brl(a.soma_posicoes_cents)} soma de ${a.posicoes} posições`);
      console.log(`  nome da caixinha: INDETERMINADO (a fonte não entrega)`);
      const { rows: ps } = await c.query(
        `SELECT * FROM fin_caixinha_posicao_v WHERE account_id = $1 AND status = 'ativa'
          ORDER BY balance_cents DESC`, [a.account_id]
      );
      for (const p of ps) {
        const bate = Number(p.divergencia_cents) === 0;
        console.log(
          `\n  ${p.product_subtype} #${p.external_id}  ${brl(p.balance_cents)}  ` +
          `${p.rate_percent}% do ${p.rate_type} · vence ${String(p.due_date).slice(0, 10)}`
        );
        console.log(
          `      ${brl(p.balance_cents)} ${bate ? '=' : '≠'} ${brl(p.fluxo_liquido_cents)} ` +
          `(${p.movimentos} mov) + ${brl(p.rendimento_liquido_cents)} rendimento` +
          (bate ? '' : `  ⚠ ${brl(p.divergencia_cents)} SEM EXPLICAÇÃO`)
        );
      }
    }
  }

  await c.query('ROLLBACK');
  console.log('\nROLLBACK dado — nada foi gravado.');
} catch (e) {
  falhou += 1;
  console.error('\nERRO:', e.message);
  try { await c.query('ROLLBACK'); } catch { /* a transação já morreu */ }
} finally {
  c.release();
  await pool.end();
}

console.log(`\n${passou} afirmação(ões) passaram · ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
