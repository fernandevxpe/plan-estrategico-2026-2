// Cadastra chaves PIX a partir de `secrets/chaves-pix.txt`, preenchido à mão.
//
//   npm run chaves:importar            mostra o que faria
//   npm run chaves:importar:aplicar    grava em fin_payee_account
//
// ---------------------------------------------------------------------------
// POR QUE UM ARQUIVO E NÃO O CHAT
// ---------------------------------------------------------------------------
// Porque chave PIX é CPF, telefone ou e-mail de uma pessoa do time, e conversa
// fica gravada. O arquivo vive em `secrets/`, que o `.gitignore` cobre inteiro,
// nasce com permissão 600 e deve ser apagado depois de importar.
//
// O formato é `person_id ; nome ; chave` porque casar por NOME é o erro que
// esta casa já cometeu: "PAULO GABRIEL CHAVES DE ARAUJO" casou com "Gabriel"
// numa auditoria anterior (0026). O id vem preenchido pelo gerador; o nome está
// ali só para quem preenche saber de quem é a linha, e é conferido contra o
// banco antes de gravar — se divergir, a linha é recusada.
//
// ---------------------------------------------------------------------------
// O TIPO É DEDUZIDO, E ISSO É SEGURO
// ---------------------------------------------------------------------------
// As formas não se confundem: e-mail tem '@', EVP é UUID, telefone começa com
// '+', e o que sobra de dígitos é CPF (11) ou CNPJ (14). Pedir o tipo a quem
// digita seria criar um segundo lugar para errar — e tipo errado faz o banco
// recusar o pagamento só na hora do envio.
import { existsSync, readFileSync } from 'node:fs';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = 'secrets/chaves-pix.txt';
const cauda = (s) => `…${String(s).trim().slice(-4)}`;

/** Mesma dedução de `extrair-favorecidos-inter.mjs`. Null = não reconhecida. */
function tipoDaChave(chave) {
  const c = String(chave).trim();
  if (c.includes('@')) return 'EMAIL';
  if (/^\+\d{12,13}$/.test(c)) return 'PHONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return 'EVP';
  const so = c.replace(/\D/g, '');
  if (so.length === 11) return 'CPF';
  if (so.length === 14) return 'CNPJ';
  return null;
}

/** CPF e CNPJ vão para o banco só com dígitos — é como o Inter os devolve. */
function normalizar(chave, tipo) {
  const c = String(chave).trim();
  return tipo === 'CPF' || tipo === 'CNPJ' ? c.replace(/\D/g, '') : c;
}

if (!existsSync(ARQUIVO)) {
  console.error(`\n${ARQUIVO} não existe. Rode \`npm run chaves:pix\` para ver quem falta.\n`);
  process.exit(1);
}

const linhas = readFileSync(ARQUIVO, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const pool = financePool();
console.log(`\nChaves PIX de ${ARQUIVO} — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

let gravar = 0;
let vazias = 0;
let recusadas = 0;

for (const linha of linhas) {
  const [idBruto, nomeBruto, chaveBruta] = linha.split(';').map((p) => (p ?? '').trim());
  const personId = Number(idBruto);
  const rotulo = String(nomeBruto).slice(0, 28).padEnd(28);

  if (!chaveBruta) {
    vazias += 1;
    console.log(`  ·  ${rotulo} em branco — pulo`);
    continue;
  }
  if (!Number.isSafeInteger(personId) || personId <= 0) {
    recusadas += 1;
    console.log(`  ✗  ${rotulo} person_id inválido ("${idBruto}")`);
    continue;
  }

  const tipo = tipoDaChave(chaveBruta);
  if (!tipo) {
    recusadas += 1;
    console.log(`  ✗  ${rotulo} chave em formato não reconhecido — telefone precisa de +55`);
    continue;
  }

  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.counterparty_id,
            (SELECT count(*)::int FROM fin_payee_account pa
              WHERE pa.counterparty_id = p.counterparty_id AND pa.is_default AND pa.is_active) AS ja_tem
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
      WHERE p.id = $1 AND p.status = 'ativo'`,
    [personId]
  );
  const p = rows[0];

  if (!p) {
    recusadas += 1;
    console.log(`  ✗  ${rotulo} pessoa ${personId} não existe ou não está ativa`);
    continue;
  }
  // O nome é conferido, não usado para casar: protege contra linha trocada de
  // lugar num arquivo editado à mão.
  if (nomeBruto && p.name.trim() !== nomeBruto) {
    recusadas += 1;
    console.log(`  ✗  ${rotulo} o id ${personId} é de "${p.name}" — linha trocada?`);
    continue;
  }
  if (!p.counterparty_id) {
    recusadas += 1;
    console.log(`  ✗  ${rotulo} pessoa sem contraparte — não há para onde levar a chave`);
    continue;
  }
  if (p.ja_tem > 0) {
    console.log(`  ·  ${rotulo} já tem conta padrão — NÃO sobrescrevo`);
    continue;
  }

  const chave = normalizar(chaveBruta, tipo);
  gravar += 1;
  console.log(`  +  ${rotulo} ${tipo.padEnd(5)} ${cauda(chave)}`);

  if (APLICAR) {
    await pool.query(
      `INSERT INTO fin_payee_account
         (counterparty_id, label, operation_type, pix_address_key, pix_address_key_type,
          owner_name, is_default, is_active)
       VALUES ($1, $2, 'PIX', $3, $4, $5, true, true)`,
      [p.counterparty_id, 'informada à mão a partir do app do Inter', chave, tipo, p.name]
    );
  }
}

console.log(`\n  ${gravar} a gravar · ${vazias} em branco · ${recusadas} recusada(s)`);

const cobertura = await pool.query(
  `SELECT count(*)::int AS ativas,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM fin_payee_account pa
             WHERE pa.is_default AND pa.is_active
               AND (pa.counterparty_id = p.counterparty_id
                    OR pa.counterparty_id IN (SELECT l.counterparty_id FROM fin_person_counterparty l
                                               WHERE l.person_id = p.id AND l.status='confirmado'))))::int AS pagaveis
     FROM fin_person p WHERE p.status = 'ativo'`
);
const { ativas, pagaveis } = cobertura.rows[0];
console.log(`  ${pagaveis}/${ativas} pessoas ativas pagáveis por PIX.`);
console.log(
  APLICAR
    ? `\n  Apague ${ARQUIVO} agora — ele tem chave de gente dentro.\n`
    : `\n  Para aplicar: npm run chaves:importar:aplicar\n`
);

await pool.end();
