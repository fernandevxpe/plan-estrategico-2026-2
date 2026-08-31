// Prova de que Custo da empresa não volta a somar gente — e de que classificar
// um item grava time/área sem inventar pessoa.
//
// Só leitura no primeiro bloco. O PATCH cria uma linha em fin_custo_empresa
// na Ancora e DESFAZ no finally.
//
// Roda com: node scripts/test-custos-empresa.ts
// O PATCH HTTP precisa do `npm run dev` em :3000.

import { categoriaEGente, sqlContraparteEPessoa } from "../lib/financeiro/custo-empresa-eixos.ts";
import { financePool } from "./lib/artifact-db.mjs";
import { loadEnv } from "./lib/env.mjs";
import { registerFinanceTypeParsers } from "./lib/fin-types.mjs";

loadEnv();
registerFinanceTypeParsers();

let falhas = 0;
let provas = 0;

function ok(condicao: boolean, o_que: string, evidencia?: string) {
  provas += 1;
  if (condicao) console.log(`  ✓ ${o_que}${evidencia ? ` — ${evidencia}` : ""}`);
  else {
    falhas += 1;
    console.error(`  ✗ ${o_que}${evidencia ? `\n      ${evidencia}` : ""}`);
  }
}

const SQL_PESSOA_V = sqlContraparteEPessoa("v.counterparty_id");
const SQL_PESSOA_T = sqlContraparteEPessoa("t.counterparty_id");
const BASE = process.env.XPE_BASE_URL ?? "http://localhost:3000";

const pool = financePool();

try {
  console.log("\n=== Catálogo / série não contém gente ===");
  const { rows: catalogo } = await pool.query<{ descricao: string; code: string | null }>(
    `SELECT v.descricao, c.code
       FROM fin_custo_fixo_catalogo_v v
       LEFT JOIN fin_category c ON c.id = v.category_id
      WHERE v.conflito_camada IS NULL
        AND (c.code IS NULL OR (c.code NOT LIKE '6.%' AND c.code <> '4.01' AND c.code NOT LIKE '9.%'))
        AND NOT ${SQL_PESSOA_V}`
  );
  ok(catalogo.filter((r) => categoriaEGente(r.code)).length === 0, "zero item 6.% ou 4.01 no catálogo da empresa");

  const { rows: serie } = await pool.query<{ com_gente: string; sem_gente: string; itens: number }>(
    `SELECT
        SUM(-t.amount_cents) FILTER (
          WHERE c.code NOT LIKE '6.%' AND c.code <> '4.01' AND c.code NOT LIKE '9.%'
        )::bigint AS com_gente,
        SUM(-t.amount_cents) FILTER (
          WHERE c.code NOT LIKE '6.%' AND c.code <> '4.01' AND c.code NOT LIKE '9.%'
            AND NOT ${SQL_PESSOA_T}
        )::bigint AS sem_gente,
        count(DISTINCT (t.counterparty_id, t.category_id)) FILTER (
          WHERE c.code NOT LIKE '6.%' AND c.code <> '4.01' AND c.code NOT LIKE '9.%'
            AND NOT ${SQL_PESSOA_T}
        )::int AS itens
       FROM fin_transaction t
       JOIN fin_category c ON c.id = t.category_id
       JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
      WHERE t.amount_cents < 0
        AND t.posted_on >= date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date`
  );
  const comGente = Number(serie[0].com_gente);
  const semGente = Number(serie[0].sem_gente);
  ok(semGente < comGente, "série sem pessoa é menor", `${semGente} < ${comGente}`);
  ok(Number(serie[0].itens) > 10, "a matriz tem um item por (contraparte × categoria)", `${serie[0].itens} itens`);

  const { rows: ancora } = await pool.query<{ counterparty_id: number; category_id: number }>(
    `SELECT t.counterparty_id, t.category_id
       FROM fin_transaction t
       JOIN fin_category c ON c.id = t.category_id
       JOIN fin_counterparty cp ON cp.id = t.counterparty_id
       JOIN fin_entity e ON e.id = t.entity_id AND e.slug = 'xpe'
      WHERE c.code = '5.01' AND cp.name ILIKE '%ancora%'
      LIMIT 1`
  );
  ok(Boolean(ancora[0]), "Ancora × 5.01 existe para o PATCH de classificação");

  const { rows: areasNovas } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM fin_area_empresa a
       JOIN fin_entity e ON e.id = a.entity_id
      WHERE e.slug = 'xpe' AND a.ativo AND a.slug IN (
        'impostos', 'material_obras', 'material_consultoria',
        'servicos_terceirizados', 'escritorio'
      )`
  );
  ok(Number(areasNovas[0].n) === 5, "cinco áreas novas no catálogo compartilhado");

  console.log("\n=== PATCH classifica sem inventar pessoa ===");
  const alvo = ancora[0];
  if (alvo) {
    const { rows: antes } = await pool.query<{ id: number; area: string | null; bloco: string | null }>(
      `SELECT id, area, bloco FROM fin_custo_empresa
        WHERE counterparty_id IS NOT DISTINCT FROM $1 AND category_id = $2`,
      [alvo.counterparty_id, alvo.category_id]
    );
    const existia = Boolean(antes[0]);
    const areaAntes = antes[0]?.area ?? null;
    const blocoAntes = antes[0]?.bloco ?? null;
    const { rows: areasAntes } = existia
      ? await pool.query<{ slug: string }>(
          `SELECT a.slug FROM fin_custo_empresa_area l
             JOIN fin_area_empresa a ON a.id = l.area_id
            WHERE l.custo_id = $1`,
          [antes[0].id]
        )
      : { rows: [] as { slug: string }[] };

    try {
      const r = await fetch(`${BASE}/api/financeiro/custos-empresa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyId: Number(alvo.counterparty_id),
          categoryId: Number(alvo.category_id),
          area: "administrativo",
          areasEmpresa: ["financeiro"]
        })
      });
      const corpo = (await r.json()) as { error?: string; area?: string; areasEmpresa?: string[] };
      ok(r.status === 200, "PATCH devolve 200", r.status === 200 ? undefined : `${r.status} ${corpo.error}`);
      ok(corpo.area === "administrativo", "time gravado = administrativo");
      ok(Array.isArray(corpo.areasEmpresa) && corpo.areasEmpresa.includes("financeiro"), "área Financeiro ligada");

      const r50 = await fetch(`${BASE}/api/financeiro/custos-empresa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyId: Number(alvo.counterparty_id),
          categoryId: Number(alvo.category_id),
          area: "consultoria_obras",
          areasEmpresa: ["impostos"]
        })
      });
      const corpo50 = (await r50.json()) as { error?: string; area?: string; areasEmpresa?: string[] };
      ok(r50.status === 200, "PATCH 50/50 devolve 200", r50.status === 200 ? undefined : `${r50.status} ${corpo50.error}`);
      ok(corpo50.area === "consultoria_obras", "time gravado = consultoria_obras");
      ok(
        Array.isArray(corpo50.areasEmpresa) && corpo50.areasEmpresa.includes("impostos"),
        "área Impostos ligada"
      );

      const rBloco = await fetch(`${BASE}/api/financeiro/custos-empresa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyId: Number(alvo.counterparty_id),
          categoryId: Number(alvo.category_id),
          bloco: "impostos"
        })
      });
      const corpoBloco = (await rBloco.json()) as { error?: string; bloco?: string | null };
      ok(rBloco.status === 200, "PATCH bloco devolve 200", rBloco.status === 200 ? undefined : `${rBloco.status} ${corpoBloco.error}`);
      ok(corpoBloco.bloco === "impostos", "Ancora moveu para impostos");

      const { rows: pessoaInventada } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM fin_person p
          JOIN fin_person_counterparty l ON l.person_id = p.id
         WHERE l.counterparty_id = $1 AND p.name ILIKE '%ancora%'`,
        [alvo.counterparty_id]
      );
      ok(Number(pessoaInventada[0].n) === 0, "classificar aluguel não cria pessoa");
    } catch (erro) {
      ok(false, "PATCH alcançou o servidor", erro instanceof Error ? erro.message : String(erro));
    } finally {
      if (existia) {
        await fetch(`${BASE}/api/financeiro/custos-empresa`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            counterpartyId: Number(alvo.counterparty_id),
            categoryId: Number(alvo.category_id),
            area: areaAntes,
            areasEmpresa: areasAntes.map((a) => a.slug).filter(Boolean),
            bloco: blocoAntes
          })
        }).catch(() => {});
      } else {
        await pool.query(
          `DELETE FROM fin_custo_empresa
            WHERE counterparty_id IS NOT DISTINCT FROM $1 AND category_id = $2`,
          [alvo.counterparty_id, alvo.category_id]
        );
      }
    }
  }
} finally {
  await pool.end();
}

console.log(`\n${provas - falhas}/${provas} provas`);
if (falhas) process.exit(1);
