// Importa o extrato do Inter para o ledger: data/raw/inter-extrato.json → fin_*.
//
// Segue o mesmo contrato do import do Asaas, inclusive nas regras de conflito:
// decisão humana sempre vence a reimportação. Repetir aquelas cláusulas aqui é
// deliberado — são elas que impedem o sync noturno de desfazer o trabalho de
// classificação de quem revisou.
//
// O que o extrato do Inter tem de melhor que o do Nubank: `detalhes` vem
// preenchido em 100% das transações e traz `cpfCnpjRecebedor`. Isso resolve na
// origem a pergunta que o CSV nunca respondeu — se o favorecido é PF ou PJ — e
// dá nome de contraparte estruturado, em vez de texto livre para heurística
// adivinhar.
//
// Uso:
//   node scripts/import-inter.mjs            importa e confirma
//   node scripts/import-inter.mjs --dry-run  mostra o que faria, sem gravar
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { dedupeHash, normalizeDescription, normalizeName, toCents } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import { rawDirUrl } from './lib/paths.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');
const ACCOUNT_SLUG = 'inter';
const SOURCE = 'inter_api';
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const arquivo = JSON.parse(await readFile(new URL('inter-extrato.json', rawDirUrl), 'utf8'));
const transacoes = arquivo.data ?? [];
if (!transacoes.length) {
  console.log('[inter] nada em data/raw/inter-extrato.json — rode antes: npm run sync:inter');
  process.exit(0);
}

/**
 * Sinal do valor.
 *
 * O Inter manda `valor` sempre positivo e o sentido em `tipoOperacao`: D é
 * débito, C é crédito. Confiar no sinal do número faria toda saída virar
 * entrada — e o caixa dobraria em vez de zerar.
 */
function valorEmCentavos(t) {
  const cents = Math.abs(toCents(t.valor));
  return t.tipoOperacao === 'D' ? -cents : cents;
}

/**
 * Quem está do outro lado.
 *
 * O campo muda conforme o tipo: PIX enviado traz `nomeRecebedor`, PIX recebido
 * traz `nomePagador`, boleto traz `empresaEmissora`, compra no débito traz
 * `estabelecimento`. Sem esse mapa, tudo cai em texto livre e a contraparte se
 * fragmenta em dezenas de grafias.
 *
 * `nomeEmpresaRecebedor` e `nomeEmpresaPagador` ficam DE FORA de propósito, e
 * essa é a correção mais cara deste arquivo. Apesar do nome, eles não trazem a
 * empresa favorecida: trazem a INSTITUIÇÃO onde a pessoa tem conta — "NU
 * PAGAMENTOS - IP", "ITAÚ UNIBANCO S.A.", "CAIXA ECONOMICA FEDERAL".
 *
 * Medido sobre o extrato real: em 521 de 521 saídas os dois campos diferem, e
 * em nenhuma delas o campo "empresa" é a única fonte de nome. Usá-lo primeiro
 * colapsava 57 favorecidos reais em 19 bancos — só "NU PAGAMENTOS - IP"
 * escondia 27 pessoas distintas. Para uma plataforma cujo objetivo é saber
 * quanto custa cada pessoa, era o erro mais destrutivo possível.
 */
function extrairContraparte(t) {
  const d = t.detalhes ?? {};
  const saida = t.tipoOperacao === 'D';

  let nome = saida
    ? d.nomeRecebedor || d.nomeDestinatario || d.empresaEmissora || d.estabelecimento
    : d.nomePagador || d.nomeOrigem || d.empresaOrigem;

  // `tipoTransacao='OUTROS'` vem SEM `detalhes` — a API não devolve o objeto
  // estruturado para esse tipo. O favorecido fica cravado na descrição, no
  // formato "Cp: <ISPB>-<nome>" ou "Cp: <ISPB>-<documento> <nome>":
  //
  //   "Cp: 18236120-igor Dalton Guilherme Da Silva"
  //   "Cp: 18236120-64677654 Flavio Manoel Candido"
  //
  // Sem este ramo, 30 lançamentos ficam sem favorecido — 40 só em abril,
  // R$ 69.632,63, o que fez o mês parecer barato (R$ 18 mil de custo de gente
  // contra R$ 50 mil dos vizinhos) e contaminou a conciliação com a planilha.
  if (!nome) {
    const m = String(t.descricao ?? '').match(/^Cp:\s*(\d{6,8})-(.+)$/i);
    if (m) {
      const resto = m[2].trim();
      // O documento, quando vem, antecede o nome e é só dígitos.
      const comDoc = resto.match(/^(\d{6,14})\s+(.+)$/);
      nome = (comDoc ? comDoc[2] : resto).trim();
    }
  }

  // Em boleto (`PAGAMENTO`), `cpfCnpj` é o do PAGADOR — nós — e não o do
  // beneficiário. Usá-lo fazia a checagem de CNPJ próprio casar com o lado
  // errado e marcar 31 boletos de COMPESA, EMBRASUL e STARTLAW (R$ 28.263,64)
  // como transferência entre contas próprias. Boleto identifica o beneficiário
  // por `empresaEmissora`, e documento nenhum: melhor sem documento do que com
  // o documento errado.
  const boleto = t.tipoTransacao === 'PAGAMENTO';
  const documento = boleto ? null : saida ? d.cpfCnpjRecebedor : d.cpfCnpjPagador;
  const digitos = String(documento ?? '').replace(/\D/g, '');

  return {
    nome: (nome ?? '').trim() || null,
    documento: digitos || null,
    sentido: saida ? 'saida' : 'entrada',
    // 11 dígitos é CPF, 14 é CNPJ. É esta linha que separa custo com pessoa
    // física de custo com empresa sem depender de ninguém marcar à mão.
    tipoDocumento: digitos.length === 11 ? 'cpf' : digitos.length === 14 ? 'cnpj' : null
  };
}

function descricao(t) {
  const d = t.detalhes ?? {};
  const partes = [t.titulo, t.descricao, d.descricaoPix, d.detalheDescricao].filter(Boolean);
  return [...new Set(partes)].join(' — ').slice(0, 500) || t.tipoTransacao;
}

const pool = financePool();
const client = await pool.connect();
const relatorio = { lidas: transacoes.length, contrapartes: 0, inseridas: 0, atualizadas: 0, semDocumento: 0, pf: 0, pj: 0, proprias: 0 };

try {
  await client.query('BEGIN');

  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.entity_id, e.cnpj FROM fin_account a
      JOIN fin_entity e ON e.id = a.entity_id
     WHERE a.slug = $1 AND e.slug = 'xpe'`,
    [ACCOUNT_SLUG]
  );
  if (!contaRows.length) throw new Error(`conta '${ACCOUNT_SLUG}' não encontrada`);
  const { id: accountId, entity_id: entityId } = contaRows[0];

  /**
   * O CNPJ da própria empresa não é contraparte.
   *
   * Quando o dinheiro vai da Asaas para o Inter, o extrato traz
   * `nomePagador = 'ASAAS IP S.A.'` mas `cpfCnpjPagador` é o CNPJ da XP Energy —
   * porque quem transfere o próprio saldo é a empresa. Sem esta checagem o
   * importador cria uma contraparte chamada "ASAAS IP S.A." carregando o CNPJ da
   * própria empresa, e pendura nela toda transferência entre contas próprias
   * como se fosse despesa com terceiro. Medido na primeira carga: 61
   * lançamentos, R$ 151.977,33 de transferência contada como despesa.
   */
  const cnpjProprio = String(contaRows[0].cnpj ?? '').replace(/\D/g, '') || null;

  const datas = transacoes.map((t) => t.dataTransacao ?? t.dataEntrada).filter(Boolean).sort();
  const periodoInicio = datas[0];
  const periodoFim = datas[datas.length - 1];

  // ------------------------------------------------------------------ lote
  const { rows: loteRows } = await client.query(
    `INSERT INTO fin_import_batch
       (entity_id, account_id, adapter, file_name, period_start, period_end, row_count, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'preview','sync-inter')
     RETURNING id`,
    [entityId, accountId, SOURCE, 'inter-extrato.json', periodoInicio, periodoFim, transacoes.length]
  );
  const batchId = loteRows[0].id;

  // ---------------------------------------------------- contrapartes
  // Vêm antes dos lançamentos porque o lançamento referencia a contraparte.
  const porDocumento = new Map();
  for (const t of transacoes) {
    const c = extrairContraparte(t);
    if (!c.nome) continue;
    // Movimento entre contas da própria empresa não gera contraparte.
    if (cnpjProprio && c.documento === cnpjProprio) continue;
    const chave = c.documento || `nome:${normalizeName(c.nome)}`;
    if (!porDocumento.has(chave)) porDocumento.set(chave, c);
  }

  // Busca-depois-insere, e não ON CONFLICT: o único de fin_counterparty é
  // parcial — (entity_id, document_number) só vale quando há documento. Quem
  // vem sem CPF/CNPJ precisa casar por nome normalizado, que não tem índice
  // único justamente porque duas empresas podem ter nomes parecidos.
  const idContraparte = new Map();
  for (const [chave, c] of porDocumento) {
    let id = null;

    if (c.documento) {
      const { rows } = await client.query(
        `SELECT id FROM fin_counterparty WHERE entity_id=$1 AND document_number=$2`,
        [entityId, c.documento]
      );
      id = rows[0]?.id ?? null;
    }
    if (!id) {
      const { rows } = await client.query(
        `SELECT id FROM fin_counterparty WHERE entity_id=$1 AND normalized_name=$2 LIMIT 1`,
        [entityId, normalizeName(c.nome)]
      );
      id = rows[0]?.id ?? null;
      // Achou por nome e agora temos o documento: completa o cadastro sem
      // sobrescrever o que já estava preenchido — correção manual vence.
      if (id && c.documento) {
        await client.query(
          `UPDATE fin_counterparty
              SET document_type = COALESCE(document_type, $2),
                  document_number = COALESCE(document_number, $3),
                  updated_at = now()
            WHERE id = $1`,
          [id, c.tipoDocumento, c.documento]
        );
      }
    }
    if (!id) {
      const { rows } = await client.query(
        `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        // 'fornecedor' para quem recebeu de nós; entrada fica 'outro' porque
        // crédito no Inter costuma ser transferência da própria empresa, não
        // cliente. O que separa PF de PJ é document_type, não este campo.
        [entityId, c.sentido === 'saida' ? 'fornecedor' : 'outro', c.nome, normalizeName(c.nome), c.tipoDocumento, c.documento]
      );
      id = rows[0].id;
    }

    idContraparte.set(chave, id);
    if (c.tipoDocumento === 'cpf') relatorio.pf += 1;
    else if (c.tipoDocumento === 'cnpj') relatorio.pj += 1;
    else relatorio.semDocumento += 1;
  }
  relatorio.contrapartes = idContraparte.size;

  // ------------------------------------------------------------ lançamentos
  for (const t of transacoes) {
    const data = t.dataTransacao ?? t.dataEntrada;
    const cents = valorEmCentavos(t);
    if (!cents) continue;

    const c = extrairContraparte(t);
    const proprio = Boolean(cnpjProprio && c.documento === cnpjProprio);
    const chave = proprio ? null : c.documento || (c.nome ? `nome:${normalizeName(c.nome)}` : null);
    const desc = descricao(t);
    const hash = dedupeHash({ accountSlug: ACCOUNT_SLUG, sourceId: t.idTransacao });

    const gravado = await client.query(
      `INSERT INTO fin_transaction (
         entity_id, account_id, posted_on, amount_cents, description_raw, description_norm,
         counterparty_raw, counterparty_id, source_kind, source, source_id, dedupe_hash,
         review_status, import_batch_id, transfer_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendente',$13,$14)
       ON CONFLICT (account_id, dedupe_version, dedupe_hash) DO UPDATE SET
         source_kind = EXCLUDED.source_kind,
         -- Mesma cláusula do import do Asaas, e pelo mesmo motivo: 'pareado' é
         -- resultado de conciliação com a outra ponta. Rebaixar para
         -- 'em_transito' num sync desfaria a neutralização e a transferência
         -- entre contas próprias voltaria a contar como receita e despesa.
         transfer_status = CASE WHEN fin_transaction.transfer_status = 'pareado'
                                THEN fin_transaction.transfer_status ELSE fin_transaction.transfer_status END,
         counterparty_id = COALESCE(fin_transaction.counterparty_id, EXCLUDED.counterparty_id),
         -- Decisão humana vence: campo travado não é tocado por reimportação.
         category_id = CASE WHEN 'category_id' = ANY (fin_transaction.human_locked_fields)
                            THEN fin_transaction.category_id ELSE fin_transaction.category_id END,
         review_status = CASE
           WHEN fin_transaction.review_status IN ('adiado', 'ignorado') THEN fin_transaction.review_status
           WHEN fin_transaction.category_id IS NULL THEN 'pendente'
           ELSE 'ok' END,
         updated_at = now()
       -- xmax = 0 distingue INSERT de UPDATE. Sem isto o lote declarava como
       -- inseridas as linhas que só foram atualizadas: a segunda execução criou
       -- um lote dizendo 150 inserções com zero linhas atrás dele, e o desfazer
       -- passou a mentir — reverter esse lote não apagaria nada, e reverter o
       -- anterior apagaria linhas que a tela atribui a ele.
       RETURNING (xmax = 0) AS inserido`,
      [
        entityId,
        accountId,
        data,
        cents,
        desc,
        normalizeDescription(desc),
        c.nome,
        chave ? idContraparte.get(chave) ?? null : null,
        t.tipoTransacao ?? null,
        SOURCE,
        t.idTransacao ?? null,
        hash,
        batchId,
        // 'em_transito' e não 'nao': a perna existe, mas o par ainda não foi
        // conciliado. Marcar como transferência tira o valor da despesa sem
        // fingir que o pareamento já aconteceu.
        proprio ? 'em_transito' : 'nao'
      ]
    );
    if (proprio) relatorio.proprias += 1;
    if (gravado.rows[0]?.inserido) relatorio.inseridas += 1;
    else relatorio.atualizadas += 1;
  }

  // --------------------------------------------------------- cobertura
  await client.query(
    // 'api' e não 'extrato': a cobertura por API é contínua e sem buraco de
    // arquivo esquecido, e o alarme de extrato parado precisa saber a diferença.
    `INSERT INTO fin_statement_coverage (account_id, period_start, period_end, source)
     VALUES ($1,$2,$3,'api') ON CONFLICT DO NOTHING`,
    [accountId, periodoInicio, periodoFim]
  );

  // Um lote que não inseriu nada é 'descartado', não 'confirmado'. Um lote
  // confirmado sem linhas atrás dele faz o desfazer mentir para quem o usa.
  await client.query(
    `UPDATE fin_import_batch
        SET status = CASE WHEN $2::int > 0 THEN 'confirmado' ELSE 'descartado' END,
            inserted_count = $2, duplicate_count = $3, committed_at = now()
      WHERE id = $1`,
    [batchId, relatorio.inseridas, relatorio.atualizadas]
  );

  await client.query(`UPDATE fin_account SET last_statement_at = $2 WHERE id = $1`, [accountId, periodoFim]);

  // O saldo vem da API, não da soma dos lançamentos.
  //
  // O sync já buscava `/banking/v2/saldo` e gravava no arquivo bruto, e o
  // importador ignorava — a tela ficou mostrando R$ 93,16, que era o
  // fechamento de 24/03 de um lote CSV depois revertido, enquanto o banco dizia
  // R$ 31,28. Saldo derivado de lançamento herda todo buraco de cobertura;
  // saldo do banco é o único que fecha com a realidade.
  const disponivel = arquivo?.saldo?.disponivel;
  if (typeof disponivel === 'number') {
    const cents = Math.round(disponivel * 100);
    await client.query(
      `UPDATE fin_account SET current_balance_cents = $2 WHERE id = $1`,
      [accountId, cents]
    );
    // O reconstruído inclui a ABERTURA, não só os lançamentos.
    //
    // O ledger do Inter começa em 01/01/2026 e a conta já tinha R$ 79.728,83
    // naquele dia (0036). Somar só os lançamentos dá -R$ 79.697,55 e faz a
    // variância nascer valendo exatamente a abertura — um alarme que dispara
    // todo sync, sempre pelo mesmo motivo, e que por isso ninguém olha.
    // Variância só vale como sinal se zero for o normal.
    await client.query(
      `INSERT INTO fin_balance_snapshot (account_id, date, balance_cents, source, computed_cents, variance_cents)
       SELECT $1, $2::date, $3::bigint, 'api', r.reconstruido, $3::bigint - r.reconstruido
         FROM (SELECT COALESCE(a.opening_balance_cents, 0)
                      + COALESCE((SELECT sum(t.amount_cents) FROM fin_transaction t WHERE t.account_id = a.id), 0)
                        AS reconstruido
                 FROM fin_account a WHERE a.id = $1) r
       ON CONFLICT DO NOTHING`,
      [accountId, periodoFim, cents]
    );
    relatorio.saldo = cents;
  }

  if (DRY) {
    await client.query('ROLLBACK');
    console.log('[inter] DRY-RUN — nada foi gravado');
  } else {
    await client.query('COMMIT');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('[inter] import abortado, nada foi gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

console.log(
  `[inter] ${relatorio.lidas} lidas · ${relatorio.inseridas} gravadas · ` +
    `${relatorio.contrapartes} contrapartes (${relatorio.pf} PF, ${relatorio.pj} PJ, ${relatorio.semDocumento} sem doc) · ${relatorio.proprias} entre contas próprias`
);
