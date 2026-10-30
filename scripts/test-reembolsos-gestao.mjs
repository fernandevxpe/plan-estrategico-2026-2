// Exercita a gestão de reembolsos (/financeiro/reembolsos) contra o servidor
// real: a tela renderiza, o item é criado, editado (valor, descrição, tipo e
// COMPETÊNCIA — que troca o cabeçalho fin_reimbursement), cancelado com motivo
// e, quando o reembolso do mês está pago, recusado com 409.
//
//   npm run dev                    (noutro terminal)
//   npm run test:reembolsos-gestao
//
// AGENTS.md §4: o `tsc` não olha dentro de SQL. `editarItemReembolso` monta o
// UPDATE dinamicamente e move item entre cabeçalhos — só chamando para saber.
//
// ESCREVE NO BANCO REAL. Usa competências de 2099 (nenhum reembolso de verdade
// mora lá — conferido antes de começar) e apaga, no `finally`, só os ids que
// ele mesmo criou: itens, cabeçalhos e as linhas de auditoria deles.
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const BASE = process.env.XPE_BASE_URL ?? 'http://localhost:3000';
const MARCA = `TESTE-AUTOMATICO ${Date.now()}`;
const MES_A = '2099-01';
const MES_B = '2099-02';

let falhas = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const nok = (t, d) => {
  falhas += 1;
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`);
};
const afirma = (cond, t, d) => (cond ? ok(t, d) : nok(t, d));

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });

async function chamar(caminho, metodo, corpo) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const itensCriados = [];
let personId = null;

try {
  console.log(`\nReembolsos — gestão (${BASE})\n`);

  const pagina = await fetch(BASE + '/financeiro/reembolsos');
  const html = await pagina.text();
  afirma(pagina.status === 200, 'tela abre', `HTTP ${pagina.status}`);
  afirma(html.includes('Reembolsos do mês'), 'tela traz a gestão do mês');

  const ocupado = await pool.query(
    `SELECT count(*)::int AS n FROM fin_reimbursement WHERE reference_month >= '2099-01-01'`
  );
  if (ocupado.rows[0].n > 0) throw new Error('há reembolso em 2099 — o teste não roda sobre dado alheio');

  const pessoa = await pool.query(
    `SELECT p.id FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
      WHERE p.status = 'ativo' ORDER BY p.id LIMIT 1`
  );
  personId = Number(pessoa.rows[0].id);

  // ---------------------------------------------------------------- criar
  const criado = await chamar('/api/financeiro/reembolsos', 'POST', {
    personId,
    referenceMonth: MES_A,
    descricao: MARCA,
    valorCents: 1234
  });
  afirma(criado.status === 201, 'POST cria item', `HTTP ${criado.status} ${JSON.stringify(criado.json)}`);
  const itemId = criado.json?.itens?.[0];
  if (!itemId) throw new Error('sem item criado');
  itensCriados.push(itemId);

  // ---------------------------------------------------------------- editar
  const edit = await chamar(`/api/financeiro/reembolsos/${itemId}`, 'PATCH', {
    tipo: 'item',
    valorCents: 2000,
    descricao: `${MARCA} editado`,
    tipoReembolso: 'transporte',
    competencia: MES_B
  });
  afirma(edit.status === 200, 'PATCH edita item', `HTTP ${edit.status} ${JSON.stringify(edit.json)}`);
  const linha = (
    await pool.query(
      `SELECT i.amount_cents::int AS v, i.description, i.reimbursement_type, i.category_id,
              to_char(r.reference_month, 'YYYY-MM') AS mes, r.total_cents::int AS total
         FROM fin_reimbursement_item i JOIN fin_reimbursement r ON r.id = i.reimbursement_id WHERE i.id = $1`,
      [itemId]
    )
  ).rows[0];
  afirma(linha.v === 2000, 'valor gravado', String(linha.v));
  afirma(linha.description === `${MARCA} editado`, 'descrição gravada');
  afirma(linha.reimbursement_type === 'transporte' && linha.category_id !== null, 'tipo e categoria do tipo gravados');
  afirma(linha.mes === MES_B && linha.total === 2000, 'mudou de competência e o cabeçalho novo soma', `${linha.mes} ${linha.total}`);
  const antigo = await pool.query(
    `SELECT total_cents::int AS t FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
    [personId, `${MES_A}-01`]
  );
  afirma(antigo.rows[0]?.t === 0, 'cabeçalho antigo zerou', String(antigo.rows[0]?.t));

  const semMotivo = await chamar(`/api/financeiro/reembolsos/${itemId}`, 'PATCH', { tipo: 'item', status: 'cancelado' });
  afirma(semMotivo.status === 422, 'cancelar sem motivo é recusado', `HTTP ${semMotivo.status}`);

  const invalido = await chamar(`/api/financeiro/reembolsos/${itemId}`, 'PATCH', { tipo: 'item', valorCents: -5 });
  afirma(invalido.status === 422, 'valor negativo é recusado', `HTTP ${invalido.status}`);

  // ------------------------------------------------- tela mostra o item no mês
  const telaMes = await (await fetch(`${BASE}/financeiro/reembolsos?mes=${MES_B}`)).text();
  afirma(telaMes.includes(`${MARCA} editado`), 'item aparece na tela do mês dele');

  // ---------------------------------------------------------------- cancelar
  const del = await chamar(`/api/financeiro/reembolsos/${itemId}`, 'DELETE', { motivo: 'preenchido errado (teste)' });
  afirma(del.status === 200, 'DELETE cancela', `HTTP ${del.status} ${JSON.stringify(del.json)}`);
  const st = await pool.query(`SELECT status FROM fin_reimbursement_item WHERE id = $1`, [itemId]);
  afirma(st.rows[0]?.status === 'cancelado', 'linha continua no banco, como cancelada', st.rows[0]?.status);
  const audit = await pool.query(
    `SELECT after->>'motivo' AS m FROM fin_audit_log
      WHERE target_table = 'fin_reimbursement_item' AND target_id = $1 AND after ? 'motivo'`,
    [itemId]
  );
  afirma(audit.rows[0]?.m === 'preenchido errado (teste)', 'motivo na auditoria');

  // ---------------------------------------------------------------- trava
  const segundo = await chamar('/api/financeiro/reembolsos', 'POST', {
    personId,
    referenceMonth: MES_B,
    descricao: `${MARCA} pago`,
    valorCents: 500
  });
  const pagoId = segundo.json?.itens?.[0];
  if (pagoId) itensCriados.push(pagoId);
  await pool.query(
    `UPDATE fin_reimbursement SET status = 'pago' WHERE person_id = $1 AND reference_month = $2::date`,
    [personId, `${MES_B}-01`]
  );
  const travadoEdit = await chamar(`/api/financeiro/reembolsos/${pagoId}`, 'PATCH', { tipo: 'item', valorCents: 600 });
  afirma(travadoEdit.status === 409, 'editar item de reembolso pago é recusado', `HTTP ${travadoEdit.status}`);
  const travadoDel = await chamar(`/api/financeiro/reembolsos/${pagoId}`, 'DELETE', { motivo: 'teste' });
  afirma(travadoDel.status === 409, 'excluir item de reembolso pago é recusado', `HTTP ${travadoDel.status}`);
} catch (e) {
  nok('execução', e.message);
} finally {
  if (personId) {
    const cab = await pool.query(
      `SELECT id FROM fin_reimbursement WHERE person_id = $1 AND reference_month >= '2099-01-01'`,
      [personId]
    );
    const cabIds = cab.rows.map((r) => Number(r.id));
    await pool.query(
      `DELETE FROM fin_audit_log WHERE (target_table = 'fin_reimbursement_item' AND target_id = ANY($1::bigint[]))
          OR (target_table = 'fin_reimbursement' AND target_id = ANY($2::bigint[]))`,
      [itensCriados, cabIds]
    );
    await pool.query(`DELETE FROM fin_reimbursement_item WHERE id = ANY($1::bigint[])`, [itensCriados]);
    await pool.query(`DELETE FROM fin_reimbursement WHERE id = ANY($1::bigint[])`, [cabIds]);
    const sobra = await pool.query(
      `SELECT (SELECT count(*) FROM fin_reimbursement WHERE reference_month >= '2099-01-01')
            + (SELECT count(*) FROM fin_reimbursement_item WHERE description LIKE 'TESTE-AUTOMATICO%') AS n`
    );
    afirma(Number(sobra.rows[0].n) === 0, 'limpeza: nada do teste ficou no banco');
  }
  await pool.end();
  console.log(falhas ? `\n${falhas} falha(s)\n` : '\ntudo certo\n');
  process.exit(falhas ? 1 : 0);
}
