// Cadastra a coordenada PIX de cada favorecido a partir do extrato do Inter.
//
//   npm run favorecidos:inter            mostra o que faria
//   npm run favorecidos:inter:aplicar    grava em fin_payee_account
//
// ---------------------------------------------------------------------------
// POR QUE ISTO É MELHOR QUE PEDIR A CHAVE PARA CADA UM
// ---------------------------------------------------------------------------
// Porque a chave que o extrato traz JÁ RECEBEU DINHEIRO. Ela não é uma digitação
// que alguém conferiu de olho — é o destino de um PIX que compensou, com o CPF
// ou CNPJ do recebedor ao lado, dito pelo banco.
//
// O extrato completo do Inter (`/banking/v2/extrato/completo`) devolve, por PIX
// enviado: `chavePixRecebedor`, `nomeRecebedor`, `cpfCnpjRecebedor`,
// `agenciaRecebedor`, `contaBancariaRecebedor` e `codigoSolicitacao`. O cabeçalho
// de `scripts/extrair-favorecidos-nubank.mjs` já registrava o valor disso: "o
// Inter é hoje a ÚNICA conta que diz quem recebeu".
//
// Medido no extrato local (699 transações, até 20/08/2026): 630 saídas, das
// quais 437 com `chavePixRecebedor`, formando 54 favorecidos distintos — e
// entre eles quase todo o time.
//
// A alternativa que NÃO existe: a API do Inter não expõe a agenda de
// favorecidos salva no aplicativo. As famílias publicadas são Cobrança, Banking
// (extrato, saldo, pagamento), Pix e Webhooks — nenhuma lista contatos. Este
// script é o caminho que há.
//
// ---------------------------------------------------------------------------
// O QUE ELE NÃO FAZ, E CADA "NÃO" É DELIBERADO
// ---------------------------------------------------------------------------
// · Não sobrescreve conta padrão que já existe. Trocar a coordenada de um
//   favorecido sem alguém decidir é a operação que a 0075 chama de mais cara
//   para errar — é a assinatura da fraude de troca de destinatário.
// · Não casa por NOME. Casa por DOCUMENTO (`fin_counterparty.document_number`).
//   Unir por nome parecido foi exatamente o erro que fez "PAULO GABRIEL CHAVES
//   DE ARAUJO" casar com "Gabriel" numa auditoria anterior (0026).
// · Não cria contraparte. Se o documento não está no cadastro, a linha é
//   reportada e ignorada — inventar contraparte a partir de extrato é como o
//   ledger ganha gêmeos.
// · Não imprime chave inteira. Só tipo e os quatro últimos.
import { readFileSync } from 'node:fs';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = 'data/raw/inter-extrato.json';

/** Só o suficiente para reconhecer. Nunca a chave inteira. */
const cauda = (s) => `…${String(s).trim().slice(-4)}`;

/**
 * O tipo da chave, deduzido da própria chave.
 *
 * O Inter não diz o tipo — só manda `chavePixRecebedor`. Deduzir é seguro aqui
 * porque as formas não se confundem: e-mail tem '@', EVP é UUID com hífens,
 * telefone começa com '+', e o que sobra de dígitos é CPF (11) ou CNPJ (14).
 * Qualquer outra coisa devolve null e a linha é reportada em vez de gravada com
 * um tipo chutado — tipo errado faz o banco recusar o pagamento no envio.
 */
function tipoDaChave(chave) {
  const c = String(chave).trim();
  if (c.includes('@')) return 'EMAIL';
  if (/^\+?\d{12,13}$/.test(c) && c.startsWith('+')) return 'PHONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return 'EVP';
  const so = c.replace(/\D/g, '');
  if (so.length === 11 && so === c) return 'CPF';
  if (so.length === 14 && so === c) return 'CNPJ';
  return null;
}

function acharTransacoes(o) {
  if (Array.isArray(o) && o.length && typeof o[0] === 'object') return o;
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) {
      const r = acharTransacoes(v);
      if (r) return r;
    }
  }
  return null;
}

let bruto;
try {
  bruto = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
} catch (e) {
  console.error(`\nNão consegui ler ${ARQUIVO}: ${e.message}`);
  console.error('Rode `npm run sync:inter` para baixar o extrato antes.\n');
  process.exit(1);
}

const transacoes = acharTransacoes(bruto) ?? [];
const saidas = transacoes.filter((t) => t.tipoOperacao === 'D');

/*
 * Uma linha por (documento, chave). A MAIS RECENTE vence: quem trocou de chave
 * recebe na nova, e a antiga não deve virar padrão só por ter mais histórico.
 */
const porChave = new Map();
for (const t of saidas) {
  const d = t.detalhes ?? {};
  const chave = String(d.chavePixRecebedor ?? '').trim();
  const doc = String(d.cpfCnpjRecebedor ?? '').replace(/\D/g, '');
  if (!chave || !doc) continue;
  const k = `${doc}|${chave}`;
  const data = String(t.dataTransacao ?? t.dataInclusao ?? '');
  const e = porChave.get(k) ?? { doc, chave, nome: '', data: '', vezes: 0 };
  e.vezes += 1;
  // O nome e a data ficam sendo os do pagamento MAIS RECENTE: se o favorecido
  // mudou de razão social, é o nome novo que interessa.
  if (data >= e.data) {
    e.data = data;
    e.nome = String(d.nomeRecebedor ?? '').trim() || e.nome;
  }
  porChave.set(k, e);
}

const pool = financePool();

console.log(`\nFavorecidos do extrato do Inter — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}`);
console.log(`  ${transacoes.length} transações, ${saidas.length} saídas, ${porChave.size} pares (documento × chave)\n`);

const contagem = { criados: 0, jaTem: 0, semContraparte: 0, tipoDesconhecido: 0, semDocumento: 0 };
const semCadastro = [];

// A chave mais recente de cada documento é a candidata a padrão.
const porDocumento = new Map();
for (const e of porChave.values()) {
  const atual = porDocumento.get(e.doc);
  if (!atual || e.data > atual.data) porDocumento.set(e.doc, e);
}

for (const e of [...porDocumento.values()].sort((a, b) => b.vezes - a.vezes)) {
  const tipo = tipoDaChave(e.chave);
  const rotulo = e.nome.slice(0, 32).padEnd(32);

  if (!tipo) {
    contagem.tipoDesconhecido += 1;
    console.log(`  ?  ${rotulo} chave em formato não reconhecido — não gravo com tipo chutado`);
    continue;
  }

  const { rows } = await pool.query(
    `SELECT cp.id, cp.name,
            (SELECT count(*)::int FROM fin_payee_account pa
              WHERE pa.counterparty_id = cp.id AND pa.is_default AND pa.is_active) AS ja_tem
       FROM fin_counterparty cp
       JOIN fin_entity ent ON ent.id = cp.entity_id AND ent.slug = 'xpe'
      WHERE regexp_replace(coalesce(cp.document_number,''), '\\D', '', 'g') = $1
      LIMIT 1`,
    [e.doc]
  );
  const cp = rows[0];

  if (!cp) {
    contagem.semContraparte += 1;
    semCadastro.push({ nome: e.nome, doc: e.doc, vezes: e.vezes });
    continue;
  }
  if (cp.ja_tem > 0) {
    contagem.jaTem += 1;
    console.log(`  ·  ${rotulo} já tem conta padrão — NÃO sobrescrevo`);
    continue;
  }

  contagem.criados += 1;
  console.log(`  +  ${rotulo} ${tipo.padEnd(5)} ${cauda(e.chave)}  ${String(e.vezes).padStart(3)} pagamento(s), último ${e.data.slice(0, 10)}`);

  if (APLICAR) {
    await pool.query(
      `INSERT INTO fin_payee_account
         (counterparty_id, label, operation_type, pix_address_key, pix_address_key_type,
          owner_name, owner_document, is_default, is_active)
       VALUES ($1, $2, 'PIX', $3, $4, $5, $6, true, true)`,
      [cp.id, `extrato Inter · último uso ${e.data.slice(0, 10)}`, e.chave, tipo, e.nome, e.doc]
    );
  }
}

console.log(
  `\n  ${contagem.criados} a criar · ${contagem.jaTem} já tinham · ` +
    `${contagem.semContraparte} sem contraparte no cadastro · ${contagem.tipoDesconhecido} tipo não reconhecido`
);

if (semCadastro.length) {
  console.log('\n  Receberam PIX e NÃO têm contraparte com este documento no cadastro:');
  for (const s of semCadastro.slice(0, 12)) {
    console.log(`    ${s.nome.slice(0, 40).padEnd(40)} ${s.vezes}x`);
  }
  console.log('    (não crio contraparte a partir de extrato — isso é como o ledger ganha gêmeos)');
}

// Pós-condição no estilo das migrations: provar o efeito, não supor.
const cobertura = await pool.query(
  `SELECT count(*)::int AS ativas,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM fin_payee_account pa
             WHERE pa.counterparty_id = p.counterparty_id AND pa.is_default AND pa.is_active))::int AS pagaveis
     FROM fin_person p WHERE p.status = 'ativo'`
);
const { ativas, pagaveis } = cobertura.rows[0];
console.log(`\n  ${pagaveis}/${ativas} pessoas ativas com coordenada de pagamento.`);
console.log(APLICAR ? '' : '  Para aplicar: npm run favorecidos:inter:aplicar\n');

await pool.end();
