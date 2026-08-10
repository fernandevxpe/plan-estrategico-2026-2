// Extrai o favorecido do texto do extrato do Nubank e cria a contraparte.
//
// Por que existe: o Inter é hoje a ÚNICA conta que diz quem recebeu — a API
// entrega `nomeRecebedor` e `cpfCnpjRecebedor` estruturados. No Nubank, 673 de
// 673 saídas estão sem contraparte (R$ 583.031,29), e é por ali que sai 20% do
// custo de gente. Qualquer tela de custo por pessoa nasce cega sem isto.
//
// O nome ESTÁ no texto, depois do travessão:
//   "Transferência enviada pelo Pix — NEXER - INDUSTRIA, DISTRIBUICAO E C"
//   "Pagamento de boleto efetuado — 4 TABELI DE PROTESTO DE RECIFE"
// São 605 de 673 saídas com nome, 184 favorecidos distintos.
//
// O que este script NÃO faz, de propósito: inventar documento. O extrato do
// Nubank não traz CPF/CNPJ. A contraparte nasce sem documento e só será unida à
// do Inter quando alguém confirmar — porque unir por nome parecido foi
// exatamente o erro que fez "PAULO GABRIEL CHAVES DE ARAUJO" casar com
// "Gabriel" numa auditoria anterior.
//
// Uso:
//   node scripts/extrair-favorecidos-nubank.mjs            dry-run (padrão)
//   node scripts/extrair-favorecidos-nubank.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * O texto depois do travessão é o favorecido — quando existe.
 *
 * O travessão do Nubank é o EM DASH (—), não o hífen: separar por '-' quebraria
 * "NEXER - INDUSTRIA" no meio do próprio nome da empresa.
 *
 * Descrições sem travessão são movimento interno da conta ("Aplicação RDB",
 * "Pagamento de fatura", "Resgate RDB") e não têm favorecido externo: devolvem
 * null em vez de um nome inventado.
 */
export function favorecidoDoTexto(descricao) {
  const texto = String(descricao ?? '');
  const corte = texto.indexOf('—');
  if (corte === -1) return null;

  const resto = texto.slice(corte + 1).trim();
  if (resto.length < 3) return null;

  // O trecho vem como "NOME - DOCUMENTO - BANCO", truncado em ~46 caracteres.
  // Separar por ' - ' e classificar cada parte é melhor do que tratar tudo como
  // nome: o NOME vem primeiro e quase nunca é o que a truncagem corta.
  const partes = resto.split(' - ').map((s) => s.trim()).filter(Boolean);

  let documento = null;
  let tipoDocumento = null;
  const pedacosNome = [];

  for (const parte of partes) {
    const cnpj = parte.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (cnpj) {
      documento = cnpj[1].replace(/\D/g, '');
      tipoDocumento = 'cnpj';
      // "MAFEMA - 24.091.522/0001-04" → o pedaço é só o documento, não vira nome.
      const semDoc = parte.replace(cnpj[1], '').trim();
      if (semDoc.length > 2) pedacosNome.push(semDoc);
      continue;
    }
    // CPF mascarado: •••.650.314-••  — os 6 dígitos do meio identificam.
    const cpfMasc = parte.match(/[•*.]{3}\.?(\d{3})\.(\d{3})-[•*]{2}/);
    if (cpfMasc) {
      documento = `${cpfMasc[1]}${cpfMasc[2]}`;
      tipoDocumento = 'cpf_parcial';
      continue;
    }
    pedacosNome.push(parte);
  }

  // O nome do banco no fim ("NU PAG", "ITAÚ UNIBANCO S.") é instituição, não
  // favorecido — mesmo erro que colapsou 57 pessoas em 19 bancos no import do
  // Inter. Como o nome vem sempre primeiro, o primeiro pedaço é o favorecido.
  let nome = (pedacosNome.length > 1 ? pedacosNome[0] : pedacosNome.join(' - ')).trim();

  // Prefixo de raiz de CNPJ colado no nome: "64.528.195 MARCELO FELIPE DIAS
  // LACERDA". Precisa vir DEPOIS de escolher o pedaço, senão a escolha desfaz a
  // limpeza — foi o que aconteceu na primeira versão.
  const prefixo = nome.match(/^(\d{2}\.\d{3}\.\d{3})\s+(.+)$/);
  if (prefixo) {
    if (!documento) {
      documento = prefixo[1].replace(/\D/g, '');
      tipoDocumento = 'cnpj_raiz';
    }
    nome = prefixo[2].trim();
  }

  if (nome.length < 3) return null;
  return { nome, documento, tipoDocumento, truncado: resto.length >= 44 };
}

const pool = financePool();
const client = await pool.connect();
const relatorio = { lidas: 0, comNome: 0, semNome: 0, criadas: 0, reutilizadas: 0, ligadas: 0, truncadas: 0 };

try {
  await client.query('BEGIN');

  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.entity_id FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
      WHERE a.slug = 'nubank' AND e.slug = 'xpe'`
  );
  if (!contaRows.length) throw new Error("conta 'nubank' não encontrada");
  const { id: accountId, entity_id: entityId } = contaRows[0];

  const { rows: lancamentos } = await client.query(
    `SELECT id, description_raw, amount_cents FROM fin_transaction
      WHERE account_id = $1 AND counterparty_id IS NULL AND amount_cents < 0`,
    [accountId]
  );
  relatorio.lidas = lancamentos.length;

  const idPorNome = new Map();
  const porFavorecido = new Map();

  for (const l of lancamentos) {
    const achado = favorecidoDoTexto(l.description_raw);
    if (!achado) {
      relatorio.semNome += 1;
      continue;
    }
    relatorio.comNome += 1;
    if (achado.truncado) relatorio.truncadas += 1;

    const norm = normalizeName(achado.nome);
    let id = idPorNome.get(norm);

    if (id === undefined) {
      // Documento PRIMEIRO, nome depois. É esta ordem que une o favorecido do
      // Nubank ao cadastro que o Inter já criou: o nome vem truncado e em
      // grafia diferente ("MAFEMA" vs "MAFEMA COMERCIO LTDA"), mas o CNPJ é o
      // mesmo. Procurar por nome antes criaria um segundo cadastro para a mesma
      // empresa e partiria o custo dela em dois.
      let rows = [];
      if (achado.tipoDocumento === 'cnpj') {
        ({ rows } = await client.query(
          `SELECT id FROM fin_counterparty WHERE entity_id=$1 AND document_number=$2 LIMIT 1`,
          [entityId, achado.documento]
        ));
      }
      if (!rows.length) {
        ({ rows } = await client.query(
          `SELECT id FROM fin_counterparty WHERE entity_id=$1 AND normalized_name=$2 LIMIT 1`,
          [entityId, norm]
        ));
      }
      if (rows.length) {
        id = rows[0].id;
        relatorio.reutilizadas += 1;
      } else {
        const { rows: novas } = await client.query(
          `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number, notes)
           VALUES ($1,'fornecedor',$2,$3,$4,$5,$6) RETURNING id`,
          [
            entityId,
            achado.nome,
            norm,
            // Só grava documento COMPLETO. CPF mascarado e raiz de CNPJ servem
            // para conferência humana, não para chave: gravá-los criaria uma
            // identidade que parece firme e não é.
            achado.tipoDocumento === 'cnpj' ? 'cnpj' : null,
            achado.tipoDocumento === 'cnpj' ? achado.documento : null,
            [
              'extraído do texto do extrato do Nubank',
              achado.tipoDocumento === 'cpf_parcial' ? `CPF parcial no extrato: •••.${achado.documento.slice(0,3)}.${achado.documento.slice(3)}-••` : null,
              achado.tipoDocumento === 'cnpj_raiz' ? `raiz de CNPJ no extrato: ${achado.documento}` : null,
              achado.truncado ? 'texto truncado pelo extrato' : null
            ].filter(Boolean).join(' | ')
          ]
        );
        id = novas[0].id;
        relatorio.criadas += 1;
      }
      idPorNome.set(norm, id);
    }

    await client.query(
      `UPDATE fin_transaction SET counterparty_id=$2, counterparty_raw=$3, updated_at=now()
        WHERE id=$1 AND counterparty_id IS NULL`,
      [l.id, id, achado.nome]
    );
    relatorio.ligadas += 1;

    const atual = porFavorecido.get(norm) ?? { nome: achado.nome, n: 0, v: 0 };
    atual.n += 1;
    atual.v += Math.abs(Number(l.amount_cents));
    porFavorecido.set(norm, atual);
  }

  console.log(`\nNubank — favorecidos extraídos do texto\n`);
  console.log(`  saídas sem contraparte ..... ${relatorio.lidas}`);
  console.log(`  com nome no texto .......... ${relatorio.comNome}`);
  console.log(`  sem nome (movimento interno) ${relatorio.semNome}`);
  console.log(`  contrapartes criadas ....... ${relatorio.criadas}`);
  console.log(`  contrapartes reaproveitadas  ${relatorio.reutilizadas}`);
  console.log(`  nomes truncados pelo extrato ${relatorio.truncadas}`);
  console.log(`  lançamentos ligados ........ ${relatorio.ligadas}\n`);

  console.log('  Maiores favorecidos:');
  [...porFavorecido.values()]
    .sort((a, b) => b.v - a.v)
    .slice(0, 15)
    .forEach((f) => console.log(`    ${brl(f.v).padStart(14)}  ${String(f.n).padStart(3)}x  ${f.nome.slice(0, 46)}`));

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run, nada gravado. Use --aplicar para gravar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('[nubank] abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
