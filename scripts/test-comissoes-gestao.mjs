// Exercita a gestão de comissões (/financeiro/comissoes) contra o servidor real:
// POST, GET, PATCH linha, PATCH série, DELETE parcela, DELETE série, DELETE à vista.
//
//   npm run dev                    (noutro terminal)
//   npm run test:comissoes-gestao
//
// POR QUE EXISTE: AGENTS.md §4 — o `tsc` não olha dentro de SQL. `editarComissao`
// monta o UPDATE campo a campo, e `editarComissaoSerie` reescreve a descrição de
// cada parcela com o sufixo " (2/3)" em SQL. Nada disso o compilador vê.
//
// ESCREVE NO BANCO REAL. Usa um mês distante (2028-03) — nenhuma ordem de
// pagamento existe lá, então a trava do banco não interfere — e uma descrição
// com marca + timestamp. O `finally` apaga, por essa marca, toda linha e série
// que sobrar, inclusive se o teste estourar no meio. Nenhuma linha pré-existente
// é editada: a trava "já no banco" é provada pelo DESTINO (mover a linha de
// teste para 10/2026, mês já pago da pessoa), que se falhar só move a linha de
// teste — que o finally apaga.
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const BASE = process.env.XPE_BASE_URL ?? 'http://localhost:3000';
const MARCA = `TESTE-AUTOMATICO ${Date.now()}`;
const MES = '2028-03';

let falhas = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const nok = (t, d) => {
  falhas += 1;
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`);
};
const afirma = (cond, t, d) => (cond ? ok(t, d) : nok(t, d));

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });

const auth = process.env.XPE_BASIC_AUTH
  ? { authorization: `Basic ${Buffer.from(process.env.XPE_BASIC_AUTH).toString('base64')}` }
  : {};

async function chamar(caminho, metodo = 'GET', corpo) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { ...auth, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const linhasDaMarca = async () =>
  (
    await pool.query(
      `SELECT id, person_id, to_char(competencia,'YYYY-MM') AS mes, valor_cents::int AS valor, descricao, cliente, nota,
              tipo_slug, serie_id, parcela, criado_em, atualizado_em
         FROM fin_pessoa_comissao_declarada WHERE descricao LIKE $1 ORDER BY id`,
      [`${MARCA}%`]
    )
  ).rows;

try {
  console.log(`\nComissões — gestão (${BASE})\n`);

  // Pessoa com ordem de comissão paga em 10/2026: é ela que prova a trava de destino.
  const alvo = (
    await pool.query(
      `SELECT split_part(split_part(source_id, '|', 2), ':', 2)::int AS person_id, code
         FROM fin_payment_request
        WHERE source_id LIKE '2026-10|fin_person:%:comissao%' AND status NOT IN ('rascunho','cancelada','rejeitada')
        ORDER BY created_at LIMIT 1`
    )
  ).rows[0];
  if (!alvo) throw new Error('nenhuma ordem de comissão em 10/2026 para provar a trava');
  const personId = alvo.person_id;

  // ------------------------------------------------------------- à vista
  let r = await chamar('/api/financeiro/comissoes', 'POST', {
    forma: 'avista',
    personId,
    totalCents: 12345,
    primeiraCompetencia: MES,
    descricao: MARCA,
    tipoSlug: null
  });
  afirma(r.status === 200, 'POST à vista', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  let [linha] = await linhasDaMarca();
  afirma(linha && linha.valor === 12345 && linha.serie_id === null, 'linha gravada no banco', linha ? `id ${linha.id}` : 'não achei');

  r = await chamar('/api/financeiro/comissoes');
  const noPainel = r.json?.itens?.find((i) => i.id === Number(linha.id));
  afirma(r.status === 200 && noPainel, 'GET lista a linha nova');
  afirma(noPainel?.criadoEm && noPainel.ordemNoBanco === null, 'item traz criadoEm e não está no banco');

  r = await chamar(`/api/financeiro/comissoes/${linha.id}`, 'PATCH', {
    valorCents: 20000,
    descricao: `${MARCA} editada`,
    cliente: 'Cliente Teste',
    nota: 'nota teste',
    competencia: '2028-04'
  });
  afirma(r.status === 200, 'PATCH linha', `HTTP ${r.status} ${r.json?.error ?? ''} mudou=${r.json?.mudou}`);
  [linha] = await linhasDaMarca();
  afirma(
    linha.valor === 20000 && linha.mes === '2028-04' && linha.cliente === 'Cliente Teste' && linha.nota === 'nota teste',
    'PATCH gravou valor, mês, cliente e nota'
  );
  afirma(linha.atualizado_em > linha.criado_em, 'atualizado_em andou');

  r = await chamar(`/api/financeiro/comissoes/${linha.id}`, 'PATCH', { descricao: '  ' });
  afirma(r.status === 422, 'descrição vazia é recusada', `HTTP ${r.status}`);
  r = await chamar(`/api/financeiro/comissoes/${linha.id}`, 'PATCH', { tipoSlug: 'nao_existe' });
  afirma(r.status === 422, 'tipo inexistente é recusado', `HTTP ${r.status}`);

  r = await chamar(`/api/financeiro/comissoes/${linha.id}`, 'PATCH', { competencia: '2026-10' });
  afirma(r.status === 409, `mover para mês já pago é recusado (${alvo.code})`, `HTTP ${r.status} ${r.json?.error ?? ''}`);
  [linha] = await linhasDaMarca();
  afirma(linha.mes === '2028-04', 'linha continuou em 04/2028');

  // ------------------------------------------------------------- série
  r = await chamar('/api/financeiro/comissoes', 'POST', {
    forma: 'parcelada',
    personId,
    totalCents: 30000,
    parcelas: 3,
    primeiraCompetencia: MES,
    descricao: `${MARCA} série`
  });
  afirma(r.status === 200 && r.json?.serieId, 'POST parcelada 3×', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  const serieId = r.json?.serieId;

  r = await chamar(`/api/financeiro/comissoes/serie/${serieId}`, 'PATCH', {
    descricao: `${MARCA} série nova`,
    cliente: 'Obra Teste'
  });
  afirma(r.status === 200, 'PATCH série', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  let parcelas = (await linhasDaMarca()).filter((l) => l.serie_id);
  afirma(
    parcelas.length === 3 &&
      parcelas.every((p) => p.descricao === `${MARCA} série nova (${p.parcela}/3)` && p.cliente === 'Obra Teste'),
    'descrição e cliente propagados com sufixo',
    parcelas.map((p) => p.descricao.replace(MARCA, '…')).join(' | ')
  );

  r = await chamar(`/api/financeiro/comissoes/${parcelas[1].id}`, 'PATCH', { valorCents: 5000 });
  afirma(r.status === 200, 'PATCH valor de uma parcela', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  let total = (await pool.query(`SELECT total_cents::int AS t FROM fin_pessoa_comissao_serie WHERE id = $1`, [serieId])).rows[0]?.t;
  afirma(total === 25000, 'total da série recalculado', `${total}`);

  r = await chamar(`/api/financeiro/comissoes/${parcelas[2].id}`, 'DELETE');
  afirma(r.status === 200, 'DELETE de uma parcela', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  parcelas = (await linhasDaMarca()).filter((l) => l.serie_id);
  total = (await pool.query(`SELECT total_cents::int AS t FROM fin_pessoa_comissao_serie WHERE id = $1`, [serieId])).rows[0]?.t;
  afirma(parcelas.length === 2 && total === 15000, 'sobraram 2 parcelas e o total fecha', `${parcelas.length} / ${total}`);

  r = await chamar(`/api/financeiro/comissoes/serie/${serieId}`, 'DELETE');
  afirma(r.status === 200, 'DELETE série', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  const serieSobrou = (await pool.query(`SELECT 1 FROM fin_pessoa_comissao_serie WHERE id = $1`, [serieId])).rowCount;
  afirma(serieSobrou === 0 && (await linhasDaMarca()).filter((l) => l.serie_id).length === 0, 'série e parcelas sumiram');

  r = await chamar(`/api/financeiro/comissoes/${linha.id}`, 'DELETE');
  afirma(r.status === 200, 'DELETE à vista', `HTTP ${r.status} ${r.json?.error ?? ''}`);
  afirma((await linhasDaMarca()).length === 0, 'nada da marca no banco');
} catch (e) {
  nok('execução', e.message);
} finally {
  // Desfaz o que sobrou, pela marca com timestamp — só o que ESTE run criou.
  try {
    await pool.query(`DELETE FROM fin_pessoa_comissao_serie WHERE descricao LIKE $1`, [`${MARCA}%`]);
    await pool.query(`DELETE FROM fin_pessoa_comissao_declarada WHERE descricao LIKE $1`, [`${MARCA}%`]);
    const sobrou =
      (await pool.query(`SELECT 1 FROM fin_pessoa_comissao_declarada WHERE descricao LIKE $1`, [`${MARCA}%`])).rowCount +
      (await pool.query(`SELECT 1 FROM fin_pessoa_comissao_serie WHERE descricao LIKE $1`, [`${MARCA}%`])).rowCount;
    afirma(sobrou === 0, 'limpeza: nada ficou');
  } catch (e) {
    nok('limpeza', e.message);
  }
  await pool.end();
  console.log(falhas ? `\n${falhas} falha(s)\n` : '\ntudo certo\n');
  process.exit(falhas ? 1 : 0);
}
