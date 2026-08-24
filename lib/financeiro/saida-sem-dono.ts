import "server-only";

import type pg from "pg";

import { normalizeName } from "@/scripts/lib/fin-normalize.mjs";

import { transaction } from "./db";
import { classificarHumano, resolverCategoria, ValidacaoError } from "./revisao";
import {
  TIPOS_SAIDA_SEM_DONO,
  nomeSugeridoDoExtrato,
  type TipoSaidaSemDono,
  tipoSaidaValido as tipoValidoUi
} from "./saida-sem-dono-ui";

export { TIPOS_SAIDA_SEM_DONO, nomeSugeridoDoExtrato, type TipoSaidaSemDono };

export function tipoSaidaValido(v: unknown): v is TipoSaidaSemDono {
  return tipoValidoUi(v);
}

const ENTITY = "xpe";

export type ResultadoAtribuicaoSaida = {
  aplicados: number;
  counterpartyId: number;
  nome: string;
  categoryCode: string | null;
};

/**
 * Liga a saída a uma contraparte (e, se o tipo tiver, a uma categoria).
 *
 * Sem isso a linha fica no "X% sem dono" para sempre, mesmo quando o dono sabe
 * que é Algar ou Dimensional. Não liga a pessoa do roster — fornecedor/imposto
 * não é custo de gente.
 */
export async function atribuirSaidaSemDono(args: {
  transactionId: number;
  tipo: TipoSaidaSemDono;
  nome?: string | null;
  /** Mesma description_norm ainda sem contraparte — tipicamente 2× Algar. */
  aplicarIguais?: boolean;
  ator?: string;
}): Promise<ResultadoAtribuicaoSaida> {
  if (!tipoSaidaValido(args.tipo)) {
    throw new ValidacaoError(`tipo desconhecido: ${String(args.tipo)}`);
  }

  const meta = TIPOS_SAIDA_SEM_DONO[args.tipo];
  const ator = (args.ator?.trim() || "ui").slice(0, 80);

  return transaction(async (client) => {
    const { rows: txs } = await client.query<{
      id: number;
      entity_id: number;
      descricao: string;
      description_norm: string | null;
      counterparty_id: number | null;
    }>(
      `SELECT t.id, t.entity_id,
              coalesce(t.description_raw, t.description_norm, '') AS descricao,
              t.description_norm,
              t.counterparty_id
         FROM fin_transaction t
         JOIN fin_entity e ON e.id = t.entity_id
        WHERE e.slug = $1 AND t.id = $2`,
      [ENTITY, args.transactionId]
    );
    const alvo = txs[0];
    if (!alvo) throw new ValidacaoError(`lançamento ${args.transactionId} não encontrado`);
    if (alvo.counterparty_id) {
      throw new ValidacaoError("este lançamento já tem favorecido — nada a fazer");
    }

    const nome =
      (args.nome?.trim() ||
        nomeSugeridoDoExtrato(alvo.descricao) ||
        (args.tipo === "imposto_simples" ? "Simples Nacional" : null) ||
        "").trim();
    if (nome.length < 3) {
      throw new ValidacaoError(
        "não deu para ler o nome no extrato — digite o favorecido (ex.: Algar Telecom)"
      );
    }

    const counterpartyId = await resolverOuCriarFornecedor(client, alvo.entity_id, nome, ator);

    let ids = [alvo.id];
    if (args.aplicarIguais && alvo.description_norm) {
      const { rows: iguais } = await client.query<{ id: number }>(
        `SELECT t.id
           FROM fin_transaction t
          WHERE t.entity_id = $1
            AND t.counterparty_id IS NULL
            AND t.description_norm = $2
            AND t.amount_cents < 0
            AND t.transfer_status = 'nao'
            AND NOT t.is_split_parent`,
        [alvo.entity_id, alvo.description_norm]
      );
      ids = iguais.map((r) => r.id);
    }

    await client.query(
      `UPDATE fin_transaction
          SET counterparty_id = $2,
              counterparty_raw = COALESCE(counterparty_raw, $3),
              updated_at = now(),
              human_locked_fields = (
                SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                  FROM unnest(human_locked_fields || ARRAY['counterparty_id']) AS f
              )
        WHERE id = ANY($1::bigint[])
          AND counterparty_id IS NULL`,
      [ids, counterpartyId, nome]
    );

    let categoryCode: string | null = meta.categoryCode;
    if (categoryCode) {
      const categoria = await resolverCategoria(client, categoryCode);
      await classificarHumano(client, {
        table: "fin_transaction",
        ids,
        categoria,
        nucleo: null,
        batchId: null,
        via: `saida_sem_dono:${args.tipo}`
      });
    }

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, after, fields)
       VALUES ($1, $2, 'update', 'fin_transaction', $3,
               jsonb_build_object(
                 'tipo', $4::text,
                 'counterparty_id', $5::bigint,
                 'nome', $6::text,
                 'category_code', $7::text,
                 'aplicados', $8::int
               ),
               ARRAY['counterparty_id','category_id'])`,
      [
        alvo.entity_id,
        ator,
        alvo.id,
        args.tipo,
        counterpartyId,
        nome,
        categoryCode,
        ids.length
      ]
    );

    return {
      aplicados: ids.length,
      counterpartyId,
      nome,
      categoryCode
    };
  });
}

async function resolverOuCriarFornecedor(
  client: pg.PoolClient,
  entityId: number,
  nome: string,
  ator: string
): Promise<number> {
  const normalizado = normalizeName(nome);
  if (!normalizado) throw new ValidacaoError("nome do favorecido inválido");

  const existente = await client.query<{ id: number }>(
    `SELECT id FROM fin_counterparty
      WHERE entity_id = $1 AND normalized_name = $2
      ORDER BY id LIMIT 1`,
    [entityId, normalizado]
  );
  if (existente.rows[0]) return existente.rows[0].id;

  const criado = await client.query<{ id: number }>(
    `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name)
     VALUES ($1, 'fornecedor', $2, $3) RETURNING id`,
    [entityId, nome, normalizado]
  );
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
     VALUES ($1, 'fin_counterparty', $2, 'insert', $3::jsonb, ARRAY['name','kind'], $4)`,
    [entityId, criado.rows[0].id, JSON.stringify({ name: nome, kind: "fornecedor" }), ator]
  );
  return criado.rows[0].id;
}
