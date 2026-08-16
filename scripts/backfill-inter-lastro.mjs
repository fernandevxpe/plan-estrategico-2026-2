// Reconstrói o lastro documental do Inter que já existia e foi descartado.
//
// O PROBLEMA QUE ESTE ARQUIVO RESOLVE
// -----------------------------------
// `data/raw/inter-extrato.json` sempre trouxe, em `detalhes`, o CPF/CNPJ das
// duas pontas e o `endToEndId` do PIX. O importador lia esses campos, usava-os
// para escolher o nome da contraparte e descartava o resto: o ledger ficava com
// `counterparty_raw` (texto) e um vínculo resolvido por nome normalizado.
//
// A migration 0042 abriu as colunas (`counterparty_document`,
// `counterparty_document_type`, `end_to_end_id`) e `import-inter.mjs` passou a
// preenchê-las daqui para frente. Este script é o passado: casa cada linha do
// ledger com a transação do arquivo bruto por `idTransacao` — que é o
// `source_id` delas — e grava o lastro que já estava lá.
//
// O QUE ELE NÃO FAZ, E POR QUÊ
// ----------------------------
// Não classifica, não mexe em categoria, não mexe em `transfer_status` e não
// desfaz pareamento. Ele grava EVIDÊNCIA; quem decide o que a evidência
// significa é o motor de regras, via `scripts/reclassificar.mjs`, onde a decisão
// nasce com lote, trilha e desfazer. Misturar as duas coisas aqui produziria uma
// escrita de classificação sem nenhuma dessas três garantias.
//
// A única exceção é `counterparty_id`, e é uma exceção de VÍNCULO, não de
// classificação: quando o documento identifica uma contraparte já cadastrada e a
// linha está sem vínculo, ligar as duas não decide nada — apenas registra uma
// identidade que o documento prova. Nunca sobrescreve um vínculo existente.
//
// USO
//   node scripts/backfill-inter-lastro.mjs --dry-run   mostra o que faria (padrão)
//   node scripts/backfill-inter-lastro.mjs --aplicar   grava, em UMA transação
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import { lastroDaTransacao } from './lib/inter-lastro.mjs';
import { rawDirUrl } from './lib/paths.mjs';

loadEnv();
registerFinanceTypeParsers();

const ACCOUNT_SLUG = 'inter';
const ENTITY_SLUG = 'xpe';
const ATOR = 'script:backfill-inter-lastro';

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const DRY = !APLICAR;

const desconhecidas = argv.filter((a) => !/^--(aplicar|dry-run|ajuda|help)$/.test(a));
if (desconhecidas.length || argv.includes('--ajuda') || argv.includes('--help')) {
  if (desconhecidas.length) console.error(`[lastro] opção desconhecida: ${desconhecidas.join(', ')}\n`);
  console.log(
    [
      'uso: node scripts/backfill-inter-lastro.mjs [--dry-run | --aplicar]',
      '',
      '  --dry-run   (padrão) executa tudo dentro de uma transação e faz ROLLBACK',
      '  --aplicar   grava, em uma única transação, com trilha em fin_audit_log'
    ].join('\n')
  );
  process.exit(desconhecidas.length ? 1 : 0);
}

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const titulo = (t) => `\n${'━'.repeat(78)}\n${t}\n${'━'.repeat(78)}`;

// ---------------------------------------------------------------------------
// Arquivo bruto
// ---------------------------------------------------------------------------
const arquivo = JSON.parse(await readFile(new URL('inter-extrato.json', rawDirUrl), 'utf8'));
const transacoes = arquivo.data ?? [];
if (!transacoes.length) {
  console.log('[lastro] nada em data/raw/inter-extrato.json — rode antes: npm run sync:inter');
  process.exit(0);
}

// `idTransacao` é a chave. O importador o grava em `source_id`, e
// `fin_transaction_source_idx` garante que ele é único por conta — ou seja, o
// casamento é 1:1 e não precisa de heurística de valor+data, que é justamente
// como os pareamentos falsos da A6 nasceram.
const lastroPorSourceId = new Map();
let duplicadosNoArquivo = 0;
for (const t of transacoes) {
  const id = t.idTransacao;
  if (!id) continue;
  if (lastroPorSourceId.has(id)) {
    duplicadosNoArquivo += 1;
    continue;
  }
  lastroPorSourceId.set(id, lastroDaTransacao(t));
}

const pool = financePool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  // Rede de segurança do banco: com sync_mode ligado, fin_preserve_human_locks
  // devolve qualquer coluna travada por humano ao valor anterior. O lastro não
  // é campo de decisão e não deveria estar travado em ninguém — mas se estiver,
  // a trava vence, e o RETURNING abaixo mostra o resultado real e não a intenção.
  await client.query(`SET LOCAL fin.sync_mode = 'on'`);

  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.entity_id, e.cnpj
       FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
      WHERE a.slug = $1 AND e.slug = $2`,
    [ACCOUNT_SLUG, ENTITY_SLUG]
  );
  if (!contaRows.length) throw new Error(`conta '${ACCOUNT_SLUG}' não encontrada`);
  const { id: accountId, entity_id: entityId } = contaRows[0];
  const cnpjProprio = String(contaRows[0].cnpj ?? '').replace(/\D/g, '') || null;
  if (!cnpjProprio) throw new Error('entidade sem CNPJ: sem ele não há como separar transferência própria de terceiro');

  // As colunas da 0042 têm de existir. Sem esta checagem o script falharia no
  // meio do UPDATE com uma mensagem do Postgres sobre coluna inexistente, e
  // quem estivesse rodando não saberia que o que falta é uma migration.
  const { rows: colunas } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fin_transaction'
        AND column_name IN ('counterparty_document','counterparty_document_type','end_to_end_id')`
  );
  if (colunas.length !== 3) {
    throw new Error('colunas de lastro ausentes — aplique db/migrations/0042_fin_lastro_pix.sql antes');
  }

  // ------------------------------------------------------------------ leitura
  const { rows: linhas } = await client.query(
    `SELECT t.id, t.source_id, t.posted_on, t.amount_cents, t.source_kind,
            t.counterparty_id, t.counterparty_document, t.counterparty_document_type, t.end_to_end_id,
            t.transfer_status, t.category_id, t.human_locked_fields,
            c.document_number AS cadastro_documento, c.name AS cadastro_nome
       FROM fin_transaction t
       LEFT JOIN fin_counterparty c ON c.id = t.counterparty_id
      WHERE t.account_id = $1 AND t.source_id IS NOT NULL`,
    [accountId]
  );

  // Contrapartes por documento normalizado. NUNCA por nome: o nome é o que a
  // outra ponta digitou e se fragmenta em dezenas de grafias; o documento é o
  // que o Banco Central carimbou. Casar por nome aqui reintroduziria exatamente
  // a heurística que a 0042 existe para aposentar.
  const { rows: cadastro } = await client.query(
    `SELECT id, document_number, name FROM fin_counterparty
      WHERE entity_id = $1 AND document_number IS NOT NULL`,
    [entityId]
  );
  const contraparteporDocumento = new Map(cadastro.map((c) => [c.document_number, c]));

  // ------------------------------------------------------------------ decisão
  const atualizacoes = [];
  const relatorio = {
    linhasNoLedger: linhas.length,
    semCorrespondencia: [],
    gravaDocumento: 0,
    gravaE2E: 0,
    ganhaVinculo: [],
    proprias: [],
    jaTinhaLastro: 0,
    divergencias: [],
    travadas: [],
    semMudanca: 0
  };

  for (const linha of linhas) {
    const lastro = lastroPorSourceId.get(linha.source_id);
    if (!lastro) {
      relatorio.semCorrespondencia.push(linha);
      continue;
    }

    // O cadastro e o arquivo bruto discordam sobre o documento da contraparte.
    // Não é para o script escolher: o vínculo pode ter sido corrigido à mão, e
    // sobrescrever apagaria essa correção. Vira relatório e a decisão volta para
    // uma pessoa.
    if (linha.cadastro_documento && lastro.documento && linha.cadastro_documento !== lastro.documento) {
      relatorio.divergencias.push({ linha, doArquivo: lastro.documento });
      continue;
    }

    const alvo = {
      counterparty_document: linha.counterparty_document ?? lastro.documento,
      counterparty_document_type: linha.counterparty_document_type ?? lastro.tipoDocumento,
      end_to_end_id: linha.end_to_end_id ?? lastro.endToEndId,
      counterparty_id: linha.counterparty_id
    };

    const proprio = lastro.documento && lastro.documento === cnpjProprio;
    if (proprio) relatorio.proprias.push(linha);

    // Vínculo por documento — só para terceiros, só quando falta, e só quando o
    // documento já corresponde a alguém cadastrado. A empresa não é contraparte
    // de si mesma: para o CNPJ próprio o vínculo continua nulo de propósito, e é
    // o documento no lançamento que carrega a prova (0022 desfez à mão o
    // estrago de ter feito o contrário).
    if (!proprio && !linha.counterparty_id && lastro.documento) {
      const achada = contraparteporDocumento.get(lastro.documento);
      if (achada) {
        alvo.counterparty_id = achada.id;
        relatorio.ganhaVinculo.push({ linha, contraparte: achada });
      }
    }

    const mudou =
      alvo.counterparty_document !== linha.counterparty_document ||
      alvo.counterparty_document_type !== linha.counterparty_document_type ||
      alvo.end_to_end_id !== linha.end_to_end_id ||
      alvo.counterparty_id !== linha.counterparty_id;

    if (!mudou) {
      relatorio.semMudanca += 1;
      if (linha.counterparty_document) relatorio.jaTinhaLastro += 1;
      continue;
    }

    // Trava humana em qualquer coluna que este script escreve tira a linha do
    // alcance — mesma invariante de import-asaas.mjs e reclassificar.mjs.
    const travados = linha.human_locked_fields ?? [];
    const colisao = travados.filter((c) =>
      ['counterparty_document', 'counterparty_document_type', 'end_to_end_id', 'counterparty_id'].includes(c)
    );
    if (colisao.length) {
      relatorio.travadas.push({ linha, campos: colisao });
      continue;
    }

    if (!linha.counterparty_document && alvo.counterparty_document) relatorio.gravaDocumento += 1;
    if (!linha.end_to_end_id && alvo.end_to_end_id) relatorio.gravaE2E += 1;
    atualizacoes.push({ linha, alvo });
  }

  // ------------------------------------------------------------------ escrita
  let gravadas = 0;
  if (atualizacoes.length) {
    // unnest de arrays paralelos: um comando por lote, e não uma viagem de rede
    // por linha. Mesma razão de reclassificar.mjs.
    const { rows: escritas } = await client.query(
      `UPDATE fin_transaction t
          SET counterparty_document      = d.documento,
              counterparty_document_type = d.tipo,
              end_to_end_id              = d.e2e,
              counterparty_id            = d.contraparte,
              updated_at                 = now()
         FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::bigint[])
              AS d(id, documento, tipo, e2e, contraparte)
        WHERE t.id = d.id
        RETURNING t.id, t.counterparty_document, t.counterparty_document_type, t.end_to_end_id, t.counterparty_id`,
      [
        atualizacoes.map((a) => a.linha.id),
        atualizacoes.map((a) => a.alvo.counterparty_document),
        atualizacoes.map((a) => a.alvo.counterparty_document_type),
        atualizacoes.map((a) => a.alvo.end_to_end_id),
        atualizacoes.map((a) => a.alvo.counterparty_id)
      ]
    );
    gravadas = escritas.length;

    // Trilha. O `after` vem do RETURNING, nunca do que pretendíamos escrever:
    // uma trilha que descreve a intenção em vez do resultado faz o desfazer
    // mentir se um gatilho recusar parte da mudança.
    // unnest de arrays paralelos, e não VALUES: numa lista VALUES os parâmetros
    // chegam sem tipo declarado e o Postgres os trata como `text`, o que faz o
    // INSERT falhar em `entity_id` (bigint). Declarar o tipo de cada array
    // resolve na origem e é o mesmo desenho do UPDATE acima.
    const porId = new Map(escritas.map((e) => [Number(e.id), e]));
    const trilha = [];
    for (const { linha } of atualizacoes) {
      const depois = porId.get(Number(linha.id));
      if (!depois) continue;
      trilha.push({
        id: linha.id,
        antes: {
          counterparty_document: linha.counterparty_document,
          counterparty_document_type: linha.counterparty_document_type,
          end_to_end_id: linha.end_to_end_id,
          counterparty_id: linha.counterparty_id
        },
        depois: {
          counterparty_document: depois.counterparty_document,
          counterparty_document_type: depois.counterparty_document_type,
          end_to_end_id: depois.end_to_end_id,
          counterparty_id: depois.counterparty_id
        }
      });
    }

    const CAMPOS = ['counterparty_document', 'counterparty_document_type', 'end_to_end_id', 'counterparty_id'];
    const PEDACO = 500;
    for (let i = 0; i < trilha.length; i += PEDACO) {
      const pedaco = trilha.slice(i, i + PEDACO);
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         SELECT $1::bigint, 'fin_transaction', d.id, 'bulk_update', d.antes, d.depois, $5::text[], $6::text
           FROM unnest($2::bigint[], $3::jsonb[], $4::jsonb[]) AS d(id, antes, depois)`,
        [
          entityId,
          pedaco.map((t) => t.id),
          pedaco.map((t) => JSON.stringify(t.antes)),
          pedaco.map((t) => JSON.stringify(t.depois)),
          CAMPOS,
          ATOR
        ]
      );
    }
  }

  // ------------------------------------------- prova de que não moveu dinheiro
  // Sobre a tabela INTEIRA. Este script não deveria tocar em `amount_cents` em
  // lugar nenhum; confirmar isso é barato e é a diferença entre acreditar e
  // saber.
  const { rows: dinheiro } = await client.query(
    // count(t.id) e não count(*): com LEFT JOIN, `count(*)` conta a linha da
    // CONTA mesmo quando ela não tem lançamento nenhum, e uma conta vazia
    // aparece como "1 linha, R$ 0,00" — número inventado num relatório cujo
    // propósito é provar que nada mudou.
    `SELECT a.slug, count(t.id)::int AS linhas, COALESCE(sum(t.amount_cents), 0) AS soma
       FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
      GROUP BY a.slug ORDER BY a.slug`
  );

  // ---------------------------------------------------------------- relatório
  const out = [];
  out.push(titulo('1. ESCOPO'));
  out.push(`  arquivo bruto ......... ${n(transacoes.length)} transações (${n(lastroPorSourceId.size)} idTransacao únicos)`);
  if (duplicadosNoArquivo) out.push(`  duplicados no arquivo . ${n(duplicadosNoArquivo)} (o primeiro venceu)`);
  out.push(`  ledger (conta inter) .. ${n(relatorio.linhasNoLedger)} lançamentos com source_id`);
  out.push(`  casaram por source_id . ${n(relatorio.linhasNoLedger - relatorio.semCorrespondencia.length)}`);
  out.push(`  sem correspondência ... ${n(relatorio.semCorrespondencia.length)} — estão no ledger e não no arquivo bruto`);
  if (relatorio.semCorrespondencia.length) {
    const datas = relatorio.semCorrespondencia.map((l) => String(l.posted_on).slice(0, 10)).sort();
    out.push(`      período: ${datas[0]} a ${datas[datas.length - 1]}`);
    out.push('      (o arquivo bruto está mais velho que o ledger — rode `npm run sync:inter` para cobri-las)');
  }

  out.push(titulo('2. O QUE SERIA GRAVADO'));
  out.push(`  linhas atualizadas .......... ${n(atualizacoes.length)}`);
  out.push(`    ganham counterparty_document ${n(relatorio.gravaDocumento)}`);
  out.push(`    ganham end_to_end_id ....... ${n(relatorio.gravaE2E)}`);
  out.push(`    ganham counterparty_id ..... ${n(relatorio.ganhaVinculo.length)}`);
  out.push(`  já tinham lastro (sem mudança) ${n(relatorio.jaTinhaLastro)}`);
  out.push(`  sem nada a mudar ............ ${n(relatorio.semMudanca)}`);

  out.push(titulo('3. TRANSFERÊNCIA ENTRE CONTAS PRÓPRIAS (documento = CNPJ da casa)'));
  const props = relatorio.proprias;
  out.push(`  detectadas por DOCUMENTO .... ${n(props.length)}`);
  out.push(`  valor absoluto .............. ${brl(props.reduce((a, l) => a + Math.abs(Number(l.amount_cents)), 0))}`);
  out.push(`  líquido ..................... ${brl(props.reduce((a, l) => a + Number(l.amount_cents), 0))}`);
  const porStatus = new Map();
  for (const l of props) {
    const chave = `${l.transfer_status} · categoria ${l.category_id ? 'sim' : 'NÃO'}`;
    porStatus.set(chave, (porStatus.get(chave) ?? 0) + 1);
  }
  for (const [chave, qtd] of [...porStatus.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`    ${String(qtd).padStart(4)}  ${chave}`);
  }
  out.push('');
  out.push('  Este script NÃO classifica: só grava o documento que prova o fato.');
  out.push('  Quem aplica a regra `transferencia-cnpj-proprio` (0042) é:');
  out.push('    node scripts/reclassificar.mjs --conta=inter');

  if (relatorio.divergencias.length) {
    out.push(titulo('DIVERGÊNCIAS — CADASTRO × ARQUIVO BRUTO (não tocadas)'));
    out.push('  O documento da contraparte cadastrada não bate com o do extrato.');
    out.push('  Nenhuma foi alterada: pode ser correção manual, e sobrescrever a apagaria.');
    for (const d of relatorio.divergencias.slice(0, 20)) {
      out.push(
        `    #${d.linha.id} ${String(d.linha.posted_on).slice(0, 10)} ${brl(d.linha.amount_cents)} · ` +
          `cadastro "${d.linha.cadastro_nome}" ${d.linha.cadastro_documento} × extrato ${d.doArquivo}`
      );
    }
    if (relatorio.divergencias.length > 20) out.push(`    … e mais ${n(relatorio.divergencias.length - 20)}`);
  }

  if (relatorio.travadas.length) {
    out.push(titulo('TRAVADAS POR DECISÃO HUMANA (não tocadas)'));
    for (const t of relatorio.travadas) out.push(`    #${t.linha.id} travada em ${t.campos.join(', ')}`);
  }

  out.push(titulo('4. DINHEIRO (não pode mudar)'));
  for (const d of dinheiro) out.push(`  ${String(d.slug).padEnd(18)} ${String(n(d.linhas)).padStart(7)} linhas  ${brl(d.soma).padStart(18)}`);

  out.push('');
  out.push(`  linhas efetivamente escritas: ${n(gravadas)}`);
  console.log(out.join('\n'));

  if (DRY) {
    await client.query('ROLLBACK');
    console.log('\n[lastro] DRY-RUN — ROLLBACK executado, nada foi gravado. Use --aplicar para valer.');
  } else {
    await client.query('COMMIT');
    console.log(`\n[lastro] APLICADO — ${n(gravadas)} lançamentos atualizados.`);
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('[lastro] abortado, nada foi gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
