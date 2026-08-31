import "server-only";

import type pg from "pg";

import { timeValido } from "./custo-empresa-eixos";
import { subparteValida } from "./custo-empresa-partes";
import { slugArea } from "./pessoas";

const ENTITY = "xpe";

export class ValidacaoCustoEmpresa extends Error {
  constructor(
    message: string,
    readonly status = 422
  ) {
    super(message);
    this.name = "ValidacaoCustoEmpresa";
  }
}

export type PedidoClassificacao = {
  counterpartyId: number | null;
  categoryId: number;
  area?: string | null;
  areasEmpresa?: string[];
  bloco?: string | null;
  actor: string;
};

function rotuloAreaNova(slug: string, original?: string): string {
  const bruto = original?.trim() ?? "";
  if (bruto && slugArea(bruto) === slug && /[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(bruto)) return bruto.slice(0, 80);
  const texto = slug.replace(/_/g, " ");
  return (texto.charAt(0).toUpperCase() + texto.slice(1)).slice(0, 80);
}

async function entidadeId(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
  if (!rows[0]) throw new ValidacaoCustoEmpresa(`entidade ${ENTITY} não existe`, 503);
  return Number(rows[0].id);
}

async function garantirTabela(c: pg.PoolClient) {
  const { rows } = await c.query<{ tem: boolean }>(
    `SELECT to_regclass('fin_custo_empresa') IS NOT NULL AS tem`
  );
  if (!rows[0]?.tem) {
    throw new ValidacaoCustoEmpresa("fin_custo_empresa ainda não existe: aplique a migration 0182", 501);
  }
}

async function upsertCusto(
  c: pg.PoolClient,
  args: { entityId: number; counterpartyId: number | null; categoryId: number; actor: string }
): Promise<number> {
  const { rows } = await c.query<{ id: number }>(
    `INSERT INTO fin_custo_empresa (entity_id, counterparty_id, category_id, atualizado_por)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ON CONSTRAINT fin_custo_empresa_chave
     DO UPDATE SET atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
     RETURNING id`,
    [args.entityId, args.counterpartyId, args.categoryId, args.actor]
  );
  return Number(rows[0].id);
}

async function gravarAreas(
  c: pg.PoolClient,
  args: { custoId: number; entityId: number; slugs: string[]; actor: string; batchId: string }
): Promise<{ before: string[]; after: string[] } | null> {
  const { rows: atuais } = await c.query<{ slug: string }>(
    `SELECT a.slug
       FROM fin_custo_empresa_area l
       JOIN fin_area_empresa a ON a.id = l.area_id
      WHERE l.custo_id = $1
      ORDER BY a.ordem, a.nome`,
    [args.custoId]
  );
  const antes = atuais.map((r) => r.slug);
  const depois = [...args.slugs];
  if (antes.length === depois.length && antes.every((s) => depois.includes(s))) return null;

  const ids: number[] = [];
  for (const slug of depois) {
    const { rows: existentes } = await c.query<{ id: number }>(
      `SELECT id FROM fin_area_empresa WHERE entity_id = $1 AND slug = $2`,
      [args.entityId, slug]
    );
    if (existentes[0]) {
      ids.push(Number(existentes[0].id));
      continue;
    }
    const { rows: criadas } = await c.query<{ id: number }>(
      `INSERT INTO fin_area_empresa (entity_id, slug, nome, ordem)
       VALUES ($1, $2, $3, 200)
       RETURNING id`,
      [args.entityId, slug, rotuloAreaNova(slug)]
    );
    ids.push(Number(criadas[0].id));
  }

  await c.query(`DELETE FROM fin_custo_empresa_area WHERE custo_id = $1`, [args.custoId]);
  for (const areaId of ids) {
    await c.query(
      `INSERT INTO fin_custo_empresa_area (custo_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [args.custoId, areaId]
    );
  }

  await c.query(
    `INSERT INTO fin_audit_log
        (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
     VALUES ($1, 'fin_custo_empresa', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['areas_empresa'], $5::uuid, $6)`,
    [
      args.entityId,
      args.custoId,
      JSON.stringify({ areas_empresa: antes }),
      JSON.stringify({ areas_empresa: depois }),
      args.batchId,
      args.actor
    ]
  );

  return { before: antes, after: depois };
}

/**
 * Grava time e/ou áreas de um custo. Upsert: a linha só nasce quando o dono
 * classifica — 115 pares no extrato, zero seed.
 */
export async function classificarCustoEmpresa(
  c: pg.PoolClient,
  pedido: PedidoClassificacao,
  batchId: string
): Promise<{ id: number; area: string | null; areasEmpresa: string[]; bloco: string | null }> {
  await garantirTabela(c);

  if (!Number.isSafeInteger(pedido.categoryId) || pedido.categoryId <= 0) {
    throw new ValidacaoCustoEmpresa("categoryId inválido");
  }
  if (pedido.counterpartyId != null && (!Number.isSafeInteger(pedido.counterpartyId) || pedido.counterpartyId <= 0)) {
    throw new ValidacaoCustoEmpresa("counterpartyId inválido");
  }

  const { rows: cat } = await c.query<{ id: number }>(`SELECT id FROM fin_category WHERE id = $1`, [
    pedido.categoryId
  ]);
  if (!cat[0]) throw new ValidacaoCustoEmpresa("categoria não existe");

  if (pedido.counterpartyId != null) {
    const { rows: cp } = await c.query<{ id: number }>(`SELECT id FROM fin_counterparty WHERE id = $1`, [
      pedido.counterpartyId
    ]);
    if (!cp[0]) throw new ValidacaoCustoEmpresa("contraparte não existe");
  }

  const pediuArea = pedido.area !== undefined;
  const pediuAreas = pedido.areasEmpresa !== undefined;
  const pediuBloco = pedido.bloco !== undefined;
  if (!pediuArea && !pediuAreas && !pediuBloco) {
    throw new ValidacaoCustoEmpresa("informe area, areasEmpresa e/ou bloco");
  }

  let areaGravar: string | null | undefined;
  if (pediuArea) {
    if (pedido.area === null || pedido.area === "") areaGravar = null;
    else if (typeof pedido.area === "string" && timeValido(pedido.area)) areaGravar = pedido.area;
    else throw new ValidacaoCustoEmpresa("area deve ser consultoria, obras, consultoria_obras, administrativo ou outros");
  }

  let blocoGravar: string | null | undefined;
  if (pediuBloco) {
    if (pedido.bloco === null || pedido.bloco === "") blocoGravar = null;
    else if (subparteValida(pedido.bloco)) blocoGravar = pedido.bloco;
    else throw new ValidacaoCustoEmpresa("bloco inválido");
  }

  let slugs: string[] | undefined;
  if (pediuAreas) {
    if (!Array.isArray(pedido.areasEmpresa)) {
      throw new ValidacaoCustoEmpresa("areasEmpresa deve ser uma lista de slugs");
    }
    if (pedido.areasEmpresa.length > 20) {
      throw new ValidacaoCustoEmpresa("areasEmpresa aceita no máximo 20");
    }
    slugs = [];
    for (const item of pedido.areasEmpresa) {
      if (typeof item !== "string") throw new ValidacaoCustoEmpresa("areasEmpresa[] deve ser texto");
      const slug = slugArea(item);
      if (!slug) throw new ValidacaoCustoEmpresa(`área inválida: "${item}"`);
      if (!slugs.includes(slug)) slugs.push(slug);
    }
  }

  const entityId = await entidadeId(c);
  const id = await upsertCusto(c, {
    entityId,
    counterpartyId: pedido.counterpartyId,
    categoryId: pedido.categoryId,
    actor: pedido.actor
  });

  const { rows: antesRows } = await c.query<{ area: string | null; bloco: string | null }>(
    `SELECT area, bloco FROM fin_custo_empresa WHERE id = $1`,
    [id]
  );
  const areaAntes = antesRows[0]?.area ?? null;
  const blocoAntes = antesRows[0]?.bloco ?? null;

  if (areaGravar !== undefined && areaGravar !== areaAntes) {
    await c.query(
      `UPDATE fin_custo_empresa SET area = $1, atualizado_em = now(), atualizado_por = $2 WHERE id = $3`,
      [areaGravar, pedido.actor, id]
    );
    await c.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_custo_empresa', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['area'], $5::uuid, $6)`,
      [
        entityId,
        id,
        JSON.stringify({ area: areaAntes }),
        JSON.stringify({ area: areaGravar }),
        batchId,
        pedido.actor
      ]
    );
  }

  if (blocoGravar !== undefined && blocoGravar !== blocoAntes) {
    await c.query(
      `UPDATE fin_custo_empresa SET bloco = $1, atualizado_em = now(), atualizado_por = $2 WHERE id = $3`,
      [blocoGravar, pedido.actor, id]
    );
    await c.query(
      `INSERT INTO fin_audit_log
          (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
       VALUES ($1, 'fin_custo_empresa', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['bloco'], $5::uuid, $6)`,
      [
        entityId,
        id,
        JSON.stringify({ bloco: blocoAntes }),
        JSON.stringify({ bloco: blocoGravar }),
        batchId,
        pedido.actor
      ]
    );
  }

  if (slugs) {
    await gravarAreas(c, { custoId: id, entityId, slugs, actor: pedido.actor, batchId });
  }

  const { rows: depois } = await c.query<{ area: string | null; bloco: string | null }>(
    `SELECT area, bloco FROM fin_custo_empresa WHERE id = $1`,
    [id]
  );
  const { rows: areas } = await c.query<{ slug: string }>(
    `SELECT a.slug
       FROM fin_custo_empresa_area l
       JOIN fin_area_empresa a ON a.id = l.area_id
      WHERE l.custo_id = $1
      ORDER BY a.ordem, a.nome`,
    [id]
  );

  return {
    id,
    area: depois[0]?.area ?? null,
    areasEmpresa: areas.map((a) => a.slug),
    bloco: depois[0]?.bloco ?? null
  };
}
