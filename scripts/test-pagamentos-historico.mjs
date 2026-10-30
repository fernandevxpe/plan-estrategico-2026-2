// Exercita GET /api/financeiro/pagamentos e GET /financeiro/pagamentos contra o
// servidor real, e confere os números contra SELECT direto no banco.
//
//   npm run dev                       (noutro terminal)
//   npm run test:pagamentos-historico
//
// SOMENTE LEITURA. A rota não escreve e o teste também não: a conexão abre em
// BEGIN READ ONLY e termina em ROLLBACK. Nenhuma rota de envio ao Inter é
// chamada — esta tela existe justamente para ver sem tocar.
//
// Por que existe (AGENTS.md §4): o `tsc` não olha dentro de SQL. As três
// consultas da lib (ordens + log de auditoria, execuções + extrato, composição
// de comissão) só provam que funcionam quando alguém as CHAMA.
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const BASE = process.env.XPE_BASE_URL ?? 'http://localhost:3000';
const AUTH = process.env.XPE_ADMIN_BASIC
  ? { authorization: `Basic ${Buffer.from(process.env.XPE_ADMIN_BASIC).toString('base64')}` }
  : {};

let falhas = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const nok = (t, d) => {
  falhas += 1;
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`);
};
const afirma = (cond, t, d) => (cond ? ok(t, d) : nok(t, d));

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 1, options: '-c jit=off' });

const ESTADO_SQL = `CASE status
    WHEN 'rascunho' THEN 'rascunho'
    WHEN 'aguardando_autorizacao' THEN 'aguardando_banco'
    WHEN 'pago' THEN 'pago'
    WHEN 'pago_parcial' THEN 'pago_parcial'
    WHEN 'cancelada' THEN 'cancelado' WHEN 'rejeitada' THEN 'cancelado' WHEN 'devolvida' THEN 'cancelado'
    ELSE 'outro' END`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');

    console.log('\nGET /api/financeiro/pagamentos');
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/financeiro/pagamentos`, { headers: AUTH });
    const ms = Date.now() - t0;
    afirma(r.status === 200, 'responde 200', `HTTP ${r.status} em ${ms}ms`);
    const dados = await r.json();
    afirma(dados.disponivel === true, 'disponivel = true');

    const { rows: banco } = await client.query(
      `SELECT ${ESTADO_SQL} AS estado, count(*)::int AS n, sum(net_cents)::bigint AS cents
         FROM fin_payment_request pr JOIN fin_entity e ON e.id = pr.entity_id AND e.slug = 'xpe'
        GROUP BY 1`
    );
    const total = banco.reduce((s, b) => s + b.n, 0);
    afirma(dados.ordens.length === total, 'devolve todas as ordens sem filtro', `${dados.ordens.length} × ${total} no banco`);
    for (const b of banco) {
      const api = dados.resumo.porEstado[b.estado];
      afirma(
        api && api.n === b.n && api.cents === Number(b.cents),
        `status ${b.estado} bate com o banco`,
        `API ${api?.n} / ${api?.cents} × banco ${b.n} / ${b.cents}`
      );
    }

    // Soma da lista por estado também tem de bater — o resumo e a lista vêm de
    // caminhos diferentes do código.
    for (const b of banco) {
      const lista = dados.ordens.filter((o) => o.estado === b.estado);
      afirma(
        lista.reduce((s, o) => s + o.valorCents, 0) === Number(b.cents),
        `lista ${b.estado} soma igual ao banco`
      );
    }

    const { rows: [pagoMes] } = await client.query(
      `SELECT count(DISTINCT payment_request_id)::int AS n, coalesce(sum(amount_cents), 0)::bigint AS cents
         FROM fin_payment_execution
        WHERE to_char(paid_on, 'YYYY-MM') = to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`
    );
    afirma(
      dados.resumo.pagoNoMes.n === pagoMes.n && dados.resumo.pagoNoMes.cents === Number(pagoMes.cents),
      'pago no mês bate com fin_payment_execution',
      `API ${dados.resumo.pagoNoMes.n}/${dados.resumo.pagoNoMes.cents} × banco ${pagoMes.n}/${pagoMes.cents}`
    );

    // Data de envio = primeira linha de auditoria com status aguardando_autorizacao.
    const { rows: [env] } = await client.query(
      `SELECT pr.code, to_char(min(a.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia
         FROM fin_payment_request pr
         JOIN fin_audit_log a ON a.target_table = 'fin_payment_request' AND a.target_id = pr.id
                             AND a.after ->> 'status' = 'aguardando_autorizacao'
        GROUP BY pr.code ORDER BY pr.code DESC LIMIT 1`
    );
    if (env) {
      const o = dados.ordens.find((x) => x.code === env.code);
      afirma(o && o.dia === env.dia && o.enviada, `dia de envio de ${env.code} vem do log`, `${o?.dia} × ${env.dia}`);
    }

    const pagoComExtrato = dados.ordens.find((o) => o.estado === 'pago' && o.execucoes[0]?.transacao);
    afirma(!!pagoComExtrato, 'ordem paga traz a linha do extrato que provou', pagoComExtrato?.code);
    const comissao = dados.ordens.find((o) => o.tipo === 'comissao');
    afirma(!comissao || Array.isArray(comissao.composicao), 'comissão traz composição (lista, mesmo vazia)');

    const ordenado = dados.ordens.every(
      (o, i, a) => i === 0 || (a[i - 1].enviadaEm ?? a[i - 1].criadaEm) >= (o.enviadaEm ?? o.criadaEm)
    );
    afirma(ordenado, 'mais recente primeiro');

    console.log('\nFiltros');
    const f = await (await fetch(`${BASE}/api/financeiro/pagamentos?tipo=reembolso&estado=pago`, { headers: AUTH })).json();
    const { rows: [fr] } = await client.query(
      `SELECT count(*)::int AS n FROM fin_payment_request WHERE source_id LIKE '%:reembolso' AND status = 'pago'`
    );
    afirma(f.ordens.length === fr.n, 'tipo=reembolso&estado=pago', `${f.ordens.length} × ${fr.n}`);
    const d = await (await fetch(`${BASE}/api/financeiro/pagamentos?de=2099-01-01`, { headers: AUTH })).json();
    afirma(d.ordens.length === 0, 'período no futuro devolve vazio');

    console.log('\nGET /financeiro/pagamentos (página)');
    const p = await fetch(`${BASE}/financeiro/pagamentos`, { headers: AUTH });
    const html = await p.text();
    afirma(p.status === 200, 'página responde 200', `HTTP ${p.status}`);
    afirma(html.includes('Pagamentos enviados'), 'renderiza o título');
    afirma(!/Unhandled Runtime Error|Application error/i.test(html), 'sem erro de runtime no HTML');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
