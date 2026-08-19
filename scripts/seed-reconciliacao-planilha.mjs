// Carga inicial da reconciliação (0125) — roda uma vez, manualmente.
//
// Semeia só as 3 correspondências CONFIRMADAS linha a linha entre a planilha
// "Revisão - Gestão & Finanças - XPE 2026.xlsx" e o plano de contas, jan-jul
// 2026: Locação de Usinas = 3.06, Comissão Mercado Livre = 3.08, Fatufácil =
// 3.09. Bateram ao centavo (ou quase) numa comparação manual fora do banco.
//
// NÃO semeia as outras 10 categorias que aparecem na comparação: a planilha
// não separa "Consultoria e Auditoria" de "Laudos e Inspeções" — ela junta
// tudo em "Consultorias com Base em Economia", um bloco só. Inventar um valor
// esperado por categoria a partir de uma soma agregada seria estimativa
// disfarçada de dado; melhor ficar de fora da tela de reconciliação do que
// afirmar uma precisão que a fonte não tem. O gap agregado (Consultorias,
// "Monitor BT") continua registrado no relatório que já foi entregue ao
// Fernando, como investigação pendente — não como referência de categoria.
//
// Roda com: node scripts/seed-reconciliacao-planilha.mjs [--aplicar]
// Sem --aplicar, é dry-run: mostra o que gravaria e não grava nada.

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import pg from 'pg';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ATOR = 'seed-reconciliacao-planilha.mjs';
const FONTE = 'Planilha "Revisão - Gestão & Finanças - XPE 2026.xlsx" — carregado em 19/08/2026';

// [code, [jan, fev, mar, abr, mai, jun, jul]] em centavos.
const LINHAS = [
  ['3.06', [1691905, 1979028, 1462187, 1265035, 1432037, 1603263, 1527875]], // Locação de Usinas
  ['3.08', [302202, 0, 310613, 0, 308985, 313443, 0]],                       // Comissão Mercado Livre
  ['3.09', [136000, 17000, 305000, 182000, 182000, 182000, 0]]               // Fatufácil
];

const MESES = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), ssl: { rejectUnauthorized: false } });
const cli = await pool.connect();

try {
  await cli.query('BEGIN');

  let gravadas = 0;
  for (const [code, valores] of LINHAS) {
    const { rows: cat } = await cli.query(
      `SELECT id, name FROM fin_category WHERE code = $1 AND entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe')`,
      [code]
    );
    if (!cat.length) {
      console.error(`categoria ${code} não existe — pulando`);
      continue;
    }
    const categoryId = cat[0].id;

    for (let i = 0; i < MESES.length; i++) {
      const mes = MESES[i];
      const valorCents = valores[i];
      console.log(`${code} (${cat[0].name}) ${mes.slice(0, 7)} → R$ ${(valorCents / 100).toFixed(2)}`);

      if (APLICAR) {
        const { rows: antes } = await cli.query(
          `SELECT * FROM fin_reconciliacao_referencia
            WHERE entity_id = (SELECT id FROM fin_entity WHERE slug = 'xpe')
              AND category_id = $1 AND mes = $2::date`,
          [categoryId, mes]
        );

        const { rows: depois } = await cli.query(
          `INSERT INTO fin_reconciliacao_referencia
             (entity_id, category_id, mes, valor_esperado_cents, fonte, criado_por)
           SELECT e.id, $1, $2::date, $3, $4, $5 FROM fin_entity e WHERE e.slug = 'xpe'
           ON CONFLICT (entity_id, COALESCE(category_id, -1), mes)
           DO UPDATE SET valor_esperado_cents = EXCLUDED.valor_esperado_cents, fonte = EXCLUDED.fonte,
                          atualizado_em = now(), atualizado_por = $5
           RETURNING *`,
          [categoryId, mes, valorCents, FONTE, ATOR]
        );

        await cli.query(
          `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
           SELECT e.id, $1, $2, 'fin_reconciliacao_referencia', $3::bigint, $4::jsonb, $5::jsonb
             FROM fin_entity e WHERE e.slug = 'xpe'`,
          [ATOR, antes.length ? 'update' : 'insert', depois[0].id, antes.length ? JSON.stringify(antes[0]) : null, JSON.stringify(depois[0])]
        );
        gravadas++;
      }
    }
  }

  if (APLICAR) {
    await cli.query('COMMIT');
    console.log(`\n${gravadas} referência(s) gravada(s).`);
  } else {
    await cli.query('ROLLBACK');
    console.log('\nDRY-RUN — nada gravado. Rode com --aplicar para gravar de verdade.');
  }
} catch (e) {
  await cli.query('ROLLBACK').catch(() => {});
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  cli.release();
  await pool.end();
}
