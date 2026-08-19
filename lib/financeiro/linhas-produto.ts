import "server-only";

import { transaction } from "./db";
import { RecusaCategorizacao } from "./categorizacao";

/**
 * Linha de produto — o lado da ESCRITA (0124).
 *
 * Mesma anatomia de `criarCategoria`/`editarCategoria` em `categorizacao.ts`:
 * `transaction()`, `fin_audit_log` com before/after, `RecusaCategorizacao`
 * para recusa de regra de negócio. A diferença é o tamanho da régua — linha
 * de produto tem UM escritor (esta rota), então a guarda de desativação vive
 * aqui, lendo `fin_linha_produto_uso_v` (0124), em vez de um gatilho de
 * banco: `fin_category` é escrita por muitos caminhos (import, regra, lote),
 * e por isso a régua dela mora em gatilho — aqui não há esse motivo.
 */

const ENTIDADE = "xpe";

export type LinhaProdutoEntrada = {
  nome: string;
  descricao?: string | null;
  ordem?: number;
};

export type LinhaProdutoEdicao = {
  nome?: string;
  descricao?: string | null;
  ordem?: number;
  ativa?: boolean;
};

/** minúsculas, sem acento, hífens — mesmo padrão de `categorizacao.ts`/`regras.ts`. */
function slugDe(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function criarLinhaProduto(entrada: LinhaProdutoEntrada, ator: string) {
  const nome = entrada.nome?.trim();
  if (!nome) throw new RecusaCategorizacao("informe o nome da linha de produto");
  if (entrada.ordem !== undefined && (entrada.ordem < 0 || entrada.ordem > 9999)) {
    throw new RecusaCategorizacao("ordem precisa estar entre 0 e 9999", { ordem: entrada.ordem });
  }

  const base = slugDe(nome);
  if (!base) throw new RecusaCategorizacao(`o nome "${nome}" não produz um identificador válido`);

  return transaction(async (cli) => {
    // Colisão de slug (não de nome — nome duplicado ativo é o índice único
    // parcial da 0124, que vira 23505 e é traduzido pela rota): tenta o slug
    // base e, se ocupado, acrescenta -2, -3...
    let slug = base;
    for (let tentativa = 2; tentativa <= 20; tentativa++) {
      const { rows: ocupado } = await cli.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM fin_product_line pl
           JOIN fin_entity e ON e.id = pl.entity_id AND e.slug = $1
          WHERE pl.slug = $2`,
        [ENTIDADE, slug]
      );
      if (ocupado[0].n === "0") break;
      slug = `${base}-${tentativa}`;
    }

    const { rows } = await cli.query<Record<string, unknown>>(
      `INSERT INTO fin_product_line (entity_id, slug, name, descricao, sort_order)
       SELECT e.id, $1, $2, $3, $4 FROM fin_entity e WHERE e.slug = $5
       RETURNING id, slug, name, descricao, sort_order, is_active`,
      [slug, nome, entrada.descricao?.trim() || null, entrada.ordem ?? 0, ENTIDADE]
    );

    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
       SELECT e.id, $1, 'insert', 'fin_product_line', $2::bigint, NULL, $3::jsonb
         FROM fin_entity e WHERE e.slug = $4`,
      [ator, rows[0].id, JSON.stringify(rows[0]), ENTIDADE]
    );

    return rows[0];
  });
}

export async function editarLinhaProduto(id: number, edicao: LinhaProdutoEdicao, ator: string) {
  const campos: string[] = [];
  const params: unknown[] = [id];
  const push = (sql: string, valor: unknown) => {
    params.push(valor);
    campos.push(sql.replace("$?", `$${params.length}`));
  };

  if (edicao.nome !== undefined) {
    const nome = edicao.nome.trim();
    if (!nome) throw new RecusaCategorizacao("nome não pode ficar vazio");
    push("name = $?", nome);
  }
  if (edicao.descricao !== undefined) push("descricao = $?", edicao.descricao?.trim() || null);
  if (edicao.ordem !== undefined) {
    if (edicao.ordem < 0 || edicao.ordem > 9999) {
      throw new RecusaCategorizacao("ordem precisa estar entre 0 e 9999", { ordem: edicao.ordem });
    }
    push("sort_order = $?", edicao.ordem);
  }
  if (!campos.length && edicao.ativa === undefined) throw new RecusaCategorizacao("nada a alterar");

  return transaction(async (cli) => {
    const { rows: antes } = await cli.query<Record<string, unknown>>(
      `SELECT * FROM fin_linha_produto_uso_v WHERE id = $1`,
      [id]
    );
    if (!antes.length) throw new RecusaCategorizacao(`linha de produto ${id} não existe`);

    // A desativação é a única recusa de negócio própria desta função — o
    // resto (nome vazio, ordem fora da faixa) já foi checado acima. A régua
    // é a mesma que a tela lê: pode_desativar/motivo_bloqueio nascem uma vez
    // em fin_linha_produto_uso_v (0124).
    if (edicao.ativa === false && !antes[0].pode_desativar) {
      throw new RecusaCategorizacao(String(antes[0].motivo_bloqueio), {
        nCategoriasAtivas: Number(antes[0].n_categorias_ativas)
      });
    }
    if (edicao.ativa !== undefined) push("is_active = $?", edicao.ativa);

    const { rows: depois } = await cli.query<Record<string, unknown>>(
      `UPDATE fin_product_line SET ${campos.join(", ")} WHERE id = $1
       RETURNING id, slug, name, descricao, sort_order, is_active`,
      params
    );

    await cli.query(
      `INSERT INTO fin_audit_log (entity_id, actor, action, target_table, target_id, before, after)
       SELECT pl.entity_id, $1, 'update', 'fin_product_line', $2::bigint, $3::jsonb, $4::jsonb
         FROM fin_product_line pl WHERE pl.id = $2`,
      [ator, id, JSON.stringify(antes[0]), JSON.stringify(depois[0])]
    );

    return depois[0];
  });
}
