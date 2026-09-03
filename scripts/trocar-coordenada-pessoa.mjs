// Troca para onde o dinheiro de uma pessoa vai — e conserta as ordens vivas.
//
//   node scripts/trocar-coordenada-pessoa.mjs --pessoa="Igor A" --para=CNPJ
//   node scripts/trocar-coordenada-pessoa.mjs --pessoa="Igor A" --para=CNPJ --aplicar
//
// ---------------------------------------------------------------------------
// POR QUE NÃO BASTA MARCAR A CONTA NOVA COMO PADRÃO
// ---------------------------------------------------------------------------
// Foi o que fiz com o Cleber e o Diogo em 03/09/2026, e faltou metade.
//
// A ordem de pagamento congela a coordenada no instante em que nasce:
// `payee_snapshot` (a foto) e `payee_fingerprint` (o sha256 dela). Na hora de
// enviar, `pagar-programar.ts` recalcula a impressão da conta padrão ATUAL e
// compara com a que a ordem guardou. Divergiu, ele recusa e não manda nada —
// "é exatamente a forma da fraude de troca de favorecido" (0075).
//
// Isso é certo, e não é para afrouxar. Mas quem TROCA a coordenada de propósito
// precisa levar as ordens vivas junto, senão elas viram lixo silencioso: a do
// Diogo (PG-2026-0089, R$ 375,00) ficou apontando para uma contraparte que
// tinha acabado de perder a conta padrão, e recusaria com 409 na hora do envio
// — descoberto quando o dono já ia mandar o pagamento.
//
// Então a troca é: conta nova vira padrão, contas concorrentes deixam de ser,
// e TODA ordem ainda viva da pessoa é reapontada para a coordenada nova, com
// snapshot e fingerprint regravados. Ordem paga ou cancelada não se toca —
// aquilo é história, e história não muda de destino.
//
// ---------------------------------------------------------------------------
// A CHAVE PRECISA SER VERIFICÁVEL
// ---------------------------------------------------------------------------
// Só troca para conta cuja chave é um documento (CPF/CNPJ) que BATE com o
// cadastro da pessoa. Telefone e e-mail não batem com nada, e trocar destino de
// pagamento para uma string que ninguém consegue conferir é a operação mais
// cara de errar desta base. Para esses casos, `--forcar` exige que quem rodou
// tenha olhado — e o log registra que foi forçado.
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { conferirDocumento, digitosDe } from './lib/fin-documento.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');
const PESSOA = arg('pessoa');
const PARA = (arg('para') ?? 'CNPJ').toUpperCase();
const APLICAR = process.argv.includes('--aplicar');
const FORCAR = process.argv.includes('--forcar');

if (!PESSOA) {
  console.error('\n  falta --pessoa="Nome". Ex.: --pessoa="Igor A" --para=CNPJ\n');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const ATOR = 'script:trocar-coordenada-pessoa';
const LOTE = randomUUID();
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const cauda = (s) => (s ? `…${String(s).trim().slice(-4)}` : '—');

/** A MESMA fórmula de `impressaoDaConta` em pagar-programar.ts. Se as duas
 *  divergirem, toda ordem reapontada aqui será recusada no envio. */
function impressaoDaConta(c) {
  const partes =
    c.operation_type === 'TED'
      ? ['TED', c.bank_code, c.agency, c.account_number, c.account_digit, c.owner_document]
      : ['PIX', c.pix_address_key_type, c.pix_address_key, c.owner_document];
  return createHash('sha256')
    .update(partes.map((p) => (p ?? '').trim().toLowerCase()).join('|'))
    .digest('hex');
}

/** A MESMA foto de `fotoDaConta`, para o snapshot ficar do mesmo formato. */
function fotoDaConta(c) {
  return {
    payee_account_id: c.id,
    operation_type: c.operation_type,
    pix_address_key: c.pix_address_key,
    pix_address_key_type: c.pix_address_key_type,
    bank_code: c.bank_code,
    bank_name: c.bank_name,
    agency: c.agency,
    account_number: c.account_number,
    account_digit: c.account_digit,
    account_type: c.account_type,
    owner_name: c.owner_name,
    owner_document: c.owner_document,
    label: c.label,
    capturado_em: new Date().toISOString()
  };
}

const cliente = await pool.connect();
try {
  await cliente.query('BEGIN');

  const { rows: pes } = await cliente.query(
    `SELECT p.id, p.name, p.cpf, p.cnpj, p.counterparty_id
       FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
      WHERE p.name = $1 AND p.status = 'ativo'`,
    [PESSOA]
  );
  if (!pes[0]) throw new Error(`pessoa ativa "${PESSOA}" não encontrada`);
  const pessoa = pes[0];

  const { rows: contas } = await cliente.query(
    `SELECT pa.id, pa.counterparty_id, pa.is_default, pa.operation_type,
            pa.pix_address_key, pa.pix_address_key_type, pa.bank_code, pa.bank_name,
            pa.agency, pa.account_number, pa.account_digit, pa.account_type,
            pa.owner_name, pa.owner_document, pa.label,
            c.name AS contraparte, c.document_number
       FROM fin_payee_account pa
       JOIN fin_counterparty c ON c.id = pa.counterparty_id
      WHERE pa.is_active
        AND (pa.counterparty_id = $2
             OR pa.counterparty_id IN (SELECT l.counterparty_id FROM fin_person_counterparty l
                                        WHERE l.person_id = $1 AND l.status = 'confirmado'))
      ORDER BY pa.id`,
    [pessoa.id, pessoa.counterparty_id]
  );

  console.log(`\n  ${pessoa.name} — contas ativas hoje\n`);
  for (const c of contas) {
    console.log(
      `    ${String(c.id).padStart(4)}  ${String(c.pix_address_key_type ?? c.operation_type).padEnd(6)} ` +
        `${cauda(c.pix_address_key).padEnd(7)} ${c.is_default ? 'PADRÃO' : '      '}  ${String(c.contraparte).slice(0, 34)}`
    );
  }

  const alvo = contas.find((c) => (c.pix_address_key_type ?? '').toUpperCase() === PARA);
  if (!alvo) throw new Error(`nenhuma conta ativa com chave ${PARA} para ${pessoa.name}`);

  // Verificável: a chave é documento e bate com o cadastro da pessoa.
  const v = conferirDocumento(alvo.pix_address_key ?? '');
  const bate =
    v.valido &&
    ((v.tipo === 'cpf' && v.digitos === digitosDe(pessoa.cpf)) ||
      (v.tipo === 'cnpj' && v.digitos === digitosDe(pessoa.cnpj)));
  if (!bate && !FORCAR) {
    throw new Error(
      `a chave ${PARA} ${cauda(alvo.pix_address_key)} não bate com o CPF/CNPJ cadastrado de ${pessoa.name}. ` +
        `Confira com a pessoa e use --forcar se estiver certo.`
    );
  }

  const perdem = contas.filter((c) => c.is_default && c.id !== alvo.id);
  console.log(`\n  → passa a receber em ${PARA} ${cauda(alvo.pix_address_key)} (conta ${alvo.id})`);
  console.log(`    deixam de ser padrão: ${perdem.map((c) => `${c.id} (${c.pix_address_key_type})`).join(', ') || 'nenhuma'}`);
  if (!bate) console.log('    ⚠ chave NÃO verificável contra o cadastro — liberada por --forcar');

  // As ordens vivas que precisam ir junto.
  const cps = [...new Set(contas.map((c) => c.counterparty_id))];
  const { rows: ordens } = await cliente.query(
    `SELECT id, code, status, amount_cents, description, counterparty_id, payee_account_id
       FROM fin_payment_request
      WHERE counterparty_id = ANY($1::bigint[])
        AND status NOT IN ('pago', 'cancelado')
      ORDER BY code`,
    [cps]
  );
  const reapontar = ordens.filter((o) => Number(o.payee_account_id) !== Number(alvo.id));
  console.log(`\n  ordens vivas a reapontar — ${reapontar.length}\n`);
  for (const o of reapontar) {
    console.log(`    ${o.code}  ${String(o.status).padEnd(22)} R$ ${brl(o.amount_cents).padStart(10)}  ${String(o.description ?? '').slice(0, 34)}`);
  }
  if (ordens.length > reapontar.length) {
    console.log(`    (${ordens.length - reapontar.length} já apontam para a conta certa)`);
  }

  if (!APLICAR) {
    await cliente.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar para gravar.\n');
  } else {
    for (const c of perdem) {
      await cliente.query('UPDATE fin_payee_account SET is_default = false WHERE id = $1', [c.id]);
      await cliente.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
         VALUES ((SELECT id FROM fin_entity WHERE slug='xpe'), 'fin_payee_account', $1, 'update', $2::jsonb, $3::jsonb, ARRAY['is_default'], $4, $5)`,
        [c.id, JSON.stringify({ is_default: true }),
         JSON.stringify({ is_default: false, motivo: `${pessoa.name} passou a receber em ${PARA}` }), LOTE, ATOR]
      );
    }
    await cliente.query('UPDATE fin_payee_account SET is_default = true WHERE id = $1', [alvo.id]);

    const foto = fotoDaConta(alvo);
    const impressao = impressaoDaConta(alvo);
    for (const o of reapontar) {
      await cliente.query(
        `UPDATE fin_payment_request
            SET counterparty_id = $2, payee_account_id = $3,
                payee_snapshot = $4::jsonb, payee_fingerprint = $5, updated_at = now()
          WHERE id = $1`,
        [o.id, alvo.counterparty_id, alvo.id, JSON.stringify(foto), impressao]
      );
      await cliente.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
         VALUES ((SELECT id FROM fin_entity WHERE slug='xpe'), 'fin_payment_request', $1, 'update', $2::jsonb, $3::jsonb,
                 ARRAY['counterparty_id','payee_account_id','payee_snapshot','payee_fingerprint'], $4, $5)`,
        [o.id,
         JSON.stringify({ counterparty_id: o.counterparty_id, payee_account_id: o.payee_account_id }),
         JSON.stringify({ counterparty_id: alvo.counterparty_id, payee_account_id: alvo.id,
                          chave: `${PARA} ${cauda(alvo.pix_address_key)}` }),
         LOTE, ATOR]
      );
    }
    await cliente.query('COMMIT');
    console.log(`\n  COMMIT — 1 coordenada trocada, ${perdem.length} despromovida(s), ${reapontar.length} ordem(ns) reapontada(s).`);
    console.log(`  lote ${LOTE}\n`);
  }
} catch (erro) {
  await cliente.query('ROLLBACK');
  console.error(`\n  ✗ ${erro.message}\n`);
  process.exitCode = 1;
} finally {
  cliente.release();
  await pool.end();
}
