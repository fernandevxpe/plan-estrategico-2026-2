// Extrai todo SQL dos contratos e valida contra o banco com PREPARE (não executa).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = '/Users/fernandoxpe/Fernandev/plan-estrategico-2026.2/lib/financeiro/contratos';
const env = readFileSync('/Users/fernandoxpe/Fernandev/plan-estrategico-2026.2/.env.local', 'utf8');
const url = env.split('\n').find((l) => l.startsWith('FINANCE_DATABASE_URL='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });

// Casa qualquer template literal que comece com SELECT (após espaços/comentários).
const RE = /`((?:[^`\\]|\\.)*)`/g;

let n = 0, falhas = 0;
for (const arquivo of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
  const texto = readFileSync(path.join(DIR, arquivo), 'utf8');
  for (const m of texto.matchAll(RE)) {
    let sql = m[1];
    if (!/^\s*(SELECT|WITH)\b/i.test(sql.replace(/^(\s*--[^\n]*\n)*/, ''))) continue;
    if (sql.includes('${')) {
      // Substitui interpolações conhecidas por algo válido.
      sql = sql
        .replace(/\$\{cond\.where\}/g, 'true')
        .replace(/\$\{ordenacao\.sql\}/g, '1')
        .replace(/\$\{limite\}/g, '50')
        .replace(/\$\{salto\}/g, '0')
        .replace(/\$\{where\.join\(" AND "\)\}/g, 'true')
        .replace(/\$\{where\.length \? `WHERE \$\{where\.join\(" AND "\)\}` : ""\}/g, '')
        .replace(/\$\{params\.length - 1\}/g, '1')
        .replace(/\$\{params\.length\}/g, '2');
      if (sql.includes('${')) { console.log(`SKIP (interpolação não resolvida) ${arquivo}: ${sql.slice(0, 60)}`); continue; }
    }
    n += 1;
    const nome = `p${n}`;
    try {
      await pool.query(`PREPARE ${nome} AS ${sql}`);
      await pool.query(`DEALLOCATE ${nome}`);
    } catch (e) {
      falhas += 1;
      console.log(`\n✗ ${arquivo}\n  ${e.message}\n  ${sql.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  }
}
console.log(`\n${n - falhas}/${n} consultas válidas`);
await pool.end();
process.exit(falhas ? 1 : 0);
