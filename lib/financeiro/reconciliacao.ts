import "server-only";

import { transaction } from "./db";
import { RecusaCategorizacao } from "./categorizacao";

/**
 * Reconciliação — o lado da ESCRITA (0125).
 *
 * Duas operações: salvar um valor esperado (cria ou substitui — nunca
 * duplica, por causa do índice único de `db/migrations/0125_fin_reconciliacao_referencia.sql`),
 * e marcar o veredito depois de alguém olhar. Mesma anatomia de
 * `criarLinhaProduto`/`editarLinhaProduto`: `transaction()`, `fin_audit_log`,
 * `RecusaCategorizacao`.
 */

const ENTIDADE = "xpe";

const STATUS_VALIDOS = ["pendente", "sistema_correto", "referencia_errada", "corrigido"] as const;
export type StatusReconciliacao = (typeof STATUS_VALIDOS)[number];

export type ReferenciaEntrada = {
  categoryId: number | null;
  /** Qualquer dia do mês — normalizado para o dia 1 antes de gravar. */
  mes: string;
  valorEsperadoCents: number;
  fonte: string;
};

/**
 * Cria ou substitui o valor esperado de uma categoria/mês. `ON CONFLICT` no
 * índice único da 0125 em vez de SELECT-então-INSERT-ou-UPDATE: evita a
 * corrida de duas abas salvando a mesma célula ao mesmo tempo.
 */
export async function salvarReferencia(entrada: ReferenciaEntrada, ator: string) {
  const fonte = entrada.fonte?.trim();
  if (!fonte) throw new RecusaCategorizacao("informe a fonte do valor esperado — número sem proveniência não entra aqui");
  if (!Number.isFinite(entrada.valorEsperadoCents)) {
    throw new RecusaCategorizacao("valor esperado precisa ser um número de centavos válido");
  }
  const mes = /^\d{4}-\d{2}/.test(entrada.mes) ? `${entrada.mes.slice(0, 7)}-01` : null;
  if (!mes) throw new RecusaCategorizacao(`mês "${entrada.mes}" não está no formato AAAA-MM`);

  return transaction(async (cli) => {
    const { rows: antes } = await cli.query<Record<string, unknown>>(
      `SELECT * FROM fin_reconciliacao_referencia
        WHERE entity_id = (SELECT id FROM fin_entity WHERE slug = $1)
          AND COALESCE(category_id, -1) = COALESCE($2::bigint, -1) AND mes = $3::date`,
      [ENTIDADE, entrada.categoryId, mes]
    );

    const { rows: depois } = await cli.query<Record<string, unknown>>(
      `INSERT INTO fin_reconciliacao_referencia
         (entity_id, category_id, mes, valor_esperado_cents, fonte, criado_por)
       SELECT e.id, $1, $2::date, $3, $4, $5 FROM fin_entity e WHERE e.slug = $6
       ON CONFLICT (entity_id, COALESCE(category_id, -1), mes)
       DO UPDATE SET valor_esperado_cents = EXCLUDED.valor_esperado_cents,
                      fonte = EXCLUDED.fonte,
                      atualizado_em = now(),
                      atualizado_por = $5
       RETURNING *`,
      [entrada.categoryId, mes, entrada.valorEsperadoCents, fonte, ator, ENTIDADE]
    );

    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
       SELECT e.id, $1, $2, 'fin_reconciliacao_referencia', $3::bigint, $4::jsonb, $5::jsonb
         FROM fin_entity e WHERE e.slug = $6`,
      [ator, antes.length ? "update" : "insert", depois[0].id, antes.length ? JSON.stringify(antes[0]) : null, JSON.stringify(depois[0]), ENTIDADE]
    );

    return depois[0];
  });
}

export type VeredictoEntrada = {
  referenciaId: number;
  status: StatusReconciliacao;
  nota?: string | null;
};

/** Marca o veredito de uma divergência já revisada — a resposta a "pode ser a planilha errada". */
export async function marcarVeredicto(entrada: VeredictoEntrada, ator: string) {
  if (!STATUS_VALIDOS.includes(entrada.status)) {
    throw new RecusaCategorizacao(`status inválido: use um de ${STATUS_VALIDOS.join(", ")}`);
  }

  return transaction(async (cli) => {
    const { rows: antes } = await cli.query<Record<string, unknown>>(
      `SELECT * FROM fin_reconciliacao_referencia WHERE id = $1`,
      [entrada.referenciaId]
    );
    if (!antes.length) throw new RecusaCategorizacao(`referência ${entrada.referenciaId} não existe`);

    const { rows: depois } = await cli.query<Record<string, unknown>>(
      `UPDATE fin_reconciliacao_referencia
          SET status = $1, nota = $2, atualizado_em = now(), atualizado_por = $3
        WHERE id = $4
      RETURNING *`,
      [entrada.status, entrada.nota?.trim() || null, ator, entrada.referenciaId]
    );

    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
       SELECT pl.entity_id, $1, 'update', 'fin_reconciliacao_referencia', $2::bigint, $3::jsonb, $4::jsonb
         FROM fin_reconciliacao_referencia pl WHERE pl.id = $2`,
      [ator, entrada.referenciaId, JSON.stringify(antes[0]), JSON.stringify(depois[0])]
    );

    return depois[0];
  });
}
