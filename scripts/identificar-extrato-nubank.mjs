// Liga o extrato do Nubank a QUEM recebeu — e a mais nada.
//
// ===========================================================================
// O QUE ESTE SCRIPT NÃO FAZ, E É A PARTE MAIS IMPORTANTE
// ===========================================================================
// Ele NÃO atribui categoria. Nunca.
//
// A tentação é óbvia: reconhecida a pessoa, o resto pareceria dedução — MEI do
// time vai para 6.01 Salários, sócio para 6.02 Pró-labore. Está errado, e a
// frase que fecha o assunto veio do dono em 01/09/2026: **"pode ser comissão
// tbm"**.
//
// O mesmo Pix, para a mesma pessoa, no mesmo mês, pode ser salário, pró-labore
// ou comissão. O extrato não carrega a diferença: "Transferência enviada|
// GABRIEL RAMOS VELOSO" é a mesma linha nos três casos. Deduzir a categoria a
// partir do papel da pessoa produziria um número que fecha e mente — comissão
// contada como folha fixa, e a folha do mês inflada por um pagamento variável.
//
// Então este script responde QUEM, deixa O QUE para quem tem a evidência, e as
// linhas continuam `review_status = 'pendente'`. Identificar não é classificar:
// é dar à fila de revisão o nome de quem recebeu, para a decisão humana ser
// sobre a natureza do pagamento e não sobre decifrar uma descrição de banco.
//
// ===========================================================================
// AS DUAS REGRAS QUE LIGAM, EM ORDEM DE FORÇA
// ===========================================================================
// O extrato do erp-obras traz o nome depois de um `|`, e nada mais:
//
//   Transferência enviada|ADRYAN KENNIE MELO DOS SANTOS
//   Transferência enviada|64.266.025 IGOR DALTON GUILHERME DA SILVA
//
// 1. RAIZ DE CNPJ → `fin_person`. Quando o nome vem prefixado por `NN.NNN.NNN`,
//    esses oito dígitos são a raiz do CNPJ do MEI — o Pix de MEI é emitido
//    assim. Casar contra `fin_person.cnpj` é ligar por DOCUMENTO, não por
//    grafia, e é a única regra aqui que sobrevive a um nome escrito diferente.
//    Medido: `57.538.443 TALLANNY DE MELO INACIO` casa com a contraparte 906,
//    cujo CNPJ é 57538443000158 — a raiz confere dígito a dígito.
//
// 2. NOME EXATO, CANDIDATO ÚNICO. `normalizeName` contra
//    `fin_counterparty.normalized_name`, e só quando existe UM. Dois candidatos
//    é ambiguidade, e ambiguidade aqui não é empate: é a chance de pendurar o
//    pagamento na pessoa errada.
//
// ===========================================================================
// AS TRÊS RECUSAS — cada uma achada nos dados, não imaginada
// ===========================================================================
// 1. A PRÓPRIA EMPRESA. 13 linhas (R$ 75.938,51 entrando, 14–31/08) dizem
//    `XP ENERGY SERVICOS DE MEDICAO DE ENERGIA LTDA`: é dinheiro vindo do Asaas
//    ou do Inter para o Nubank, transferência entre bolsos nossos. Ligá-las à
//    contraparte 1008 — que existe e carrega o CNPJ da casa — quebraria os
//    invariantes A2 e A3 na hora. Transferência própria não tem contraparte;
//    tem par, e parear é outra frente.
//
// 2. AMBÍGUO. `CONSELHO REGIONAL DE ENGENHARIA E AGRONOMIA` tem DUAS
//    contrapartes com o mesmo nome normalizado: a 351 com CNPJ e a 958 sem,
//    ambas criadas em 10/08. Escolher uma esconderia o cadastro duplicado, que
//    é o defeito de verdade. O script recusa e NOMEIA as duas.
//
// 3. SEM CADASTRO. Seis nomes não existem em `fin_counterparty` — MAFEMA,
//    MARITEL, ANDREA CRISTINA, LUCIANO FELIX, XPE TECNOLOGIA, XP ENERGY.
//    Criar contraparte a partir de um nome de extrato é o caminho conhecido
//    para o cadastro duplicado que a recusa 2 acabou de encontrar: o Inter faz
//    isso porque tem CPF/CNPJ na fonte para deduplicar, e aqui não temos.
//    Ficam listadas para alguém cadastrar.
//
// Uso:
//   node scripts/identificar-extrato-nubank.mjs            dry-run (padrão)
//   node scripts/identificar-extrato-nubank.mjs --aplicar  grava
import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

// Dry-run é o padrão, como no ingestor da Polp: um script que grava por omissão
// transforma "deixa eu ver o que ele faria" no pior acidente possível.
const APLICAR = process.argv.includes('--aplicar');
const CONTA = 'nubank';
const FONTE = 'erp_obras';
const ATOR = 'identificar-extrato-nubank';

const brl = (v) => (Number(v || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

/** O nome depois do `|`, e a raiz de CNPJ quando o Pix de MEI a traz na frente. */
export function lerBeneficiario(descricao) {
  const i = String(descricao ?? '').indexOf('|');
  if (i === -1) return null;
  const bruto = descricao.slice(i + 1).trim();
  if (!bruto) return null;
  const m = /^(\d{2})\.(\d{3})\.(\d{3})\s+(.+)$/.exec(bruto);
  return m
    ? { nome: m[4].trim(), raizCnpj: m[1] + m[2] + m[3], bruto }
    : { nome: bruto, raizCnpj: null, bruto };
}

const pool = financePool();
const cliente = await pool.connect();
const soltar = () => cliente.release?.();

try {
  await cliente.query('BEGIN');

  const { rows: [entidade] } = await cliente.query(`SELECT id, cnpj FROM fin_entity WHERE slug='xpe'`);
  if (!entidade) throw new Error('entidade xpe não encontrada');
  const cnpjDaCasa = digitos(entidade.cnpj);
  if (!cnpjDaCasa) throw new Error('a entidade não declara CNPJ — sem ele não dá para recusar a própria empresa');

  const { rows: [conta] } = await cliente.query(
    `SELECT id FROM fin_account WHERE entity_id=$1 AND slug=$2`, [entidade.id, CONTA]
  );
  if (!conta) throw new Error(`conta '${CONTA}' não encontrada`);

  // A âncora de dinheiro: identificar não move centavo, e isto prova.
  const somaDaConta = async () => (await cliente.query(
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) s
       FROM fin_transaction WHERE account_id = $1`, [conta.id]
  )).rows[0].s;
  const somaAntes = await somaDaConta();

  const { rows: contrapartes } = await cliente.query(
    `SELECT id, name, normalized_name, document_number FROM fin_counterparty WHERE entity_id = $1`,
    [entidade.id]
  );
  const porNome = new Map();
  for (const c of contrapartes) {
    if (!porNome.has(c.normalized_name)) porNome.set(c.normalized_name, []);
    porNome.get(c.normalized_name).push(c);
  }
  const nomesDaCasa = contrapartes
    .filter((c) => digitos(c.document_number) === cnpjDaCasa)
    .map((c) => c.normalized_name);

  // Só pessoas com contraparte ligada: sem ela não há o que escrever na linha.
  const { rows: pessoas } = await cliente.query(
    `SELECT id, name, cnpj, counterparty_id FROM fin_person
      WHERE entity_id = $1 AND cnpj IS NOT NULL AND counterparty_id IS NOT NULL`,
    [entidade.id]
  );
  const porRaiz = new Map();
  for (const p of pessoas) {
    const raiz = digitos(p.cnpj).slice(0, 8);
    if (raiz.length === 8 && !porRaiz.has(raiz)) porRaiz.set(raiz, p);
  }

  const { rows: alvos } = await cliente.query(
    `SELECT id, description_raw, amount_cents, posted_on
       FROM fin_transaction
      WHERE account_id = $1 AND source = $2 AND counterparty_id IS NULL
      ORDER BY posted_on, id`,
    [conta.id, FONTE]
  );

  const ligar = [];
  const recusas = { propriaEmpresa: [], ambiguo: [], semCadastro: [], semNome: 0 };

  for (const t of alvos) {
    const b = lerBeneficiario(t.description_raw);
    if (!b) { recusas.semNome += 1; continue; }

    // Regra 1 — documento vence grafia.
    const pessoa = b.raizCnpj ? porRaiz.get(b.raizCnpj) : null;
    if (pessoa) {
      ligar.push({
        t, nome: b.nome, counterpartyId: pessoa.counterparty_id,
        documento: digitos(pessoa.cnpj), tipoDocumento: 'cnpj',
        regra: 'raiz-cnpj', evidencia: `raiz ${b.raizCnpj} = CNPJ de ${pessoa.name} (fin_person ${pessoa.id})`
      });
      continue;
    }

    const candidatos = porNome.get(normalizeName(b.nome)) ?? [];

    const daCasa = candidatos.filter((c) => digitos(c.document_number) === cnpjDaCasa);
    if (daCasa.length) { recusas.propriaEmpresa.push({ nome: b.nome, t }); continue; }

    // O nome curto da casa não casa exato: o extrato diz "XP ENERGY" e a
    // contraparte 1008 é "Xp Energy Servicos De Medicao De Energia Ltda". Ele
    // cai em "sem cadastro", e é aí que mora o convite ao erro — alguém lê a
    // lista, cadastra "XP ENERGY" como fornecedor, e a plataforma passa a ter
    // uma contraparte que É a empresa. Foi assim que R$ 151.977,33 de
    // transferência própria entraram como despesa (a razão de existir do A1).
    //
    // Não ligamos por prefixo (seria adivinhar), mas AVISAMOS. A recusa
    // continua sendo recusa; o que muda é que ela deixa de parecer um cadastro
    // faltando.
    const pareceACasa = nomesDaCasa.some(
      (n) => n.startsWith(normalizeName(b.nome)) || normalizeName(b.nome).startsWith(n)
    );

    if (candidatos.length > 1) { recusas.ambiguo.push({ nome: b.nome, t, candidatos }); continue; }
    if (candidatos.length === 0) { recusas.semCadastro.push({ nome: b.nome, t, pareceACasa }); continue; }

    ligar.push({
      t, nome: b.nome, counterpartyId: candidatos[0].id,
      documento: null, tipoDocumento: null,
      regra: 'nome-unico', evidencia: `nome normalizado casa com a contraparte ${candidatos[0].id} "${candidatos[0].name}", e só com ela`
    });
  }

  // ------------------------------------------------------------------ relato
  const soma = (lista) => lista.reduce((s, x) => s + Number(x.t.amount_cents), 0);
  console.log(`\n  extrato do Nubank sem contraparte: ${alvos.length} lançamento(s)\n`);
  console.log(`  sem nome na descrição (RDB, fatura, boleto) ... ${String(recusas.semNome).padStart(4)}`);
  console.log(`  LIGA por raiz de CNPJ ........................ ${String(ligar.filter(l=>l.regra==='raiz-cnpj').length).padStart(4)}`);
  console.log(`  LIGA por nome único .......................... ${String(ligar.filter(l=>l.regra==='nome-unico').length).padStart(4)}`);
  console.log(`  RECUSA: é a própria empresa .................. ${String(recusas.propriaEmpresa.length).padStart(4)}  ${brl(soma(recusas.propriaEmpresa))}`);
  console.log(`  RECUSA: nome ambíguo ......................... ${String(recusas.ambiguo.length).padStart(4)}  ${brl(soma(recusas.ambiguo))}`);
  console.log(`  RECUSA: sem cadastro ......................... ${String(recusas.semCadastro.length).padStart(4)}  ${brl(soma(recusas.semCadastro))}`);

  if (recusas.ambiguo.length) {
    console.log('\n  ambíguos — o cadastro duplicado é o defeito, não a linha:');
    const vistos = new Set();
    for (const r of recusas.ambiguo) {
      if (vistos.has(r.nome)) continue;
      vistos.add(r.nome);
      console.log(`    "${r.nome}" → ${r.candidatos.map((c) => `#${c.id} (${c.document_number ?? 'sem documento'})`).join('  vs  ')}`);
    }
  }
  if (recusas.semCadastro.length) {
    console.log('\n  sem cadastro — para alguém criar a contraparte:');
    const porNomeRec = new Map();
    for (const r of recusas.semCadastro) {
      const a = porNomeRec.get(r.nome) ?? { n: 0, cents: 0, casa: false };
      a.n += 1; a.cents += Number(r.t.amount_cents); a.casa = a.casa || r.pareceACasa;
      porNomeRec.set(r.nome, a);
    }
    for (const [nome, a] of [...porNomeRec].sort((x, y) => x[1].cents - y[1].cents)) {
      console.log(
        `    ${String(a.n).padStart(2)}×  ${brl(a.cents).padStart(14)}  ${nome}` +
        (a.casa ? '   ⚠ parece ser a PRÓPRIA EMPRESA — não cadastre; é transferência própria' : '')
      );
    }
  }

  // ------------------------------------------------------------------ escrita
  if (!APLICAR) {
    await cliente.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar para gravar.\n');
  } else {
    const lote = randomUUID();
    for (const l of ligar) {
      // `category_id = category_id` não é redundante, e a omissão dele custou
      // um invariante. O gatilho `fin_transaction_categoria_pessoa` roda BEFORE
      // UPDATE OF counterparty_id e, quando a pessoa tem categoria padrão,
      // GRAVA `NEW.category_id` — mas os gatilhos AFTER que sincronizam a fila
      // (`fin_transaction_review_item`, `fin_transaction_fila_indeciso`) são
      // `UPDATE OF category_id` e disparam pela lista de colunas do COMANDO,
      // não pelo que um BEFORE mudou. Sem citar a coluna aqui, a categoria
      // entrava e a fila não sabia: medido, 2 itens 'pendente' com motivo
      // `sem_categoria` apontando para linhas já em 6.02 — exatamente o que o
      // invariante H1 recusa.
      await cliente.query(
        `UPDATE fin_transaction
            SET counterparty_id = $2,
                counterparty_raw = COALESCE(counterparty_raw, $3),
                counterparty_document      = COALESCE(counterparty_document, $4),
                counterparty_document_type = COALESCE(counterparty_document_type, $5),
                category_id = category_id,
                updated_at = now()
          WHERE id = $1 AND counterparty_id IS NULL`,
        [l.t.id, l.counterpartyId, l.nome, l.documento, l.tipoDocumento]
      );
      await cliente.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
         VALUES ($1,'fin_transaction',$2,'update',$3,$4,$5,$6,$7)`,
        [entidade.id, l.t.id,
         JSON.stringify({ counterparty_id: null }),
         JSON.stringify({ counterparty_id: l.counterpartyId, regra: l.regra, evidencia: l.evidencia }),
         ['counterparty_id'], lote, ATOR]
      );
    }

    // A3/A2 conferidos AQUI, não pelo verificador noturno: nenhuma linha pode
    // apontar para uma contraparte que carregue o CNPJ da casa.
    const { rows: [chk] } = await cliente.query(
      `SELECT count(*) n FROM fin_transaction t JOIN fin_counterparty c ON c.id = t.counterparty_id
        WHERE replace(replace(replace(coalesce(c.document_number,''),'.',''),'/',''),'-','') = $1`,
      [cnpjDaCasa]
    );
    if (Number(chk.n) !== 0) throw new Error(`A2 não fecha: ${chk.n} lançamento(s) apontando para a própria empresa`);

    // O que o gatilho decidiu por conta própria, dito em voz alta.
    //
    // O dono avisou em 01/09/2026 que um mesmo Pix "pode ser comissão tbm", e
    // o gatilho afirma o contrário na função dele: "a pessoa cadastrada define
    // a natureza do pagamento". Para sócio, ele grava 6.02 Pró-labore. Este
    // script não desfaz política da plataforma — mas também não deixa ela
    // acontecer em silêncio numa população que ela nunca tinha alcançado:
    // até aqui estas linhas não tinham contraparte, então o gatilho nunca via.
    const { rows: automaticas } = await cliente.query(
      `SELECT t.id, cat.code, cp.name
         FROM fin_transaction t
         JOIN fin_category cat ON cat.id = t.category_id
         JOIN fin_counterparty cp ON cp.id = t.counterparty_id
        WHERE t.id = ANY($1::bigint[])
          AND t.classified_reason->>'origem' = 'categoria_padrao_da_pessoa'`,
      [ligar.map((l) => l.t.id)]
    );
    if (automaticas.length) {
      console.log(`\n  ⚠ ${automaticas.length} lançamento(s) ganharam categoria SOZINHOS, pelo gatilho`);
      console.log('    fin_transaction_categoria_pessoa (categoria padrão da pessoa):');
      for (const a of automaticas) console.log(`      #${a.id}  ${a.code}  ${a.name}`);
      console.log('    Se algum destes for comissão e não pró-labore, é aqui que se olha.');
    }

    const somaDepois = await somaDaConta();
    if (String(somaAntes) !== String(somaDepois)) {
      throw new Error(`âncora de dinheiro rompida: ${brl(somaAntes)} → ${brl(somaDepois)}`);
    }

    await cliente.query('COMMIT');
    console.log(`\n  ${ligar.length} lançamento(s) ligados · lote ${lote}`);
    console.log(`  âncora de dinheiro intacta (${brl(somaAntes)}) · A2 conferido nesta transação`);
    console.log('  categoria NÃO foi tocada: continua com o humano.\n');
  }
} catch (erro) {
  await cliente.query('ROLLBACK').catch(() => {});
  throw erro;
} finally {
  soltar();
  await pool.end();
}
