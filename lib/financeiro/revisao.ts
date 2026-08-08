import "server-only";

import type pg from "pg";

import { classifiableText, normalizeDescription } from "@/scripts/lib/fin-normalize.mjs";
import { isFinanceConfigured, query, transaction } from "./db";

/**
 * A fila de revisão e a escrita de classificação humana.
 *
 * Este arquivo existe para que a página, o PATCH individual e o lote usem UM
 * caminho de escrita só. O invariante de cinco passos (atualizar linha + travar
 * campos + auditar + registrar evento + resolver a fila) é fácil de cumprir num
 * lugar e impossível de manter em três — a primeira cópia que esquecer o
 * human_locked_fields faz o sync noturno desfazer a decisão da véspera, e o
 * usuário só percebe quando a mesma cobrança volta para a fila pela terceira
 * vez.
 */

const ENTITY = "xpe";

/**
 * Whitelist de tabelas-alvo. O nome NUNCA vem do request para dentro do SQL:
 * o corpo envia 'fin_transaction'/'fin_document' e este mapa converte para a
 * string constante — chave desconhecida é 422, não interpolação.
 */
const TABELAS = {
  fin_transaction: "fin_transaction",
  fin_document: "fin_document"
} as const;

export type TabelaAlvo = keyof typeof TABELAS;

export function tabelaValida(valor: unknown): valor is TabelaAlvo {
  return typeof valor === "string" && valor in TABELAS;
}

// ---------------------------------------------------------------------------
// Leitura: a fila
// ---------------------------------------------------------------------------

export type SugestaoRevisao = {
  code: string;
  name: string;
  nucleo: string | null;
  n: number;
  /** Participação da categoria no histórico da contraparte, 0–100. */
  share: number;
};

export type ItemRevisao = {
  id: number;
  targetTable: TabelaAlvo;
  targetId: number;
  reason: string;
  amountCents: number;
  data: string | null;
  descricao: string;
  contraparte: string | null;
  categoriaCode: string | null;
  categoriaNome: string | null;
  nucleo: string | null;
  classifiedBy: string | null;
  /** Pré-preenchimento da agulha no fluxo "criar regra a partir desta". */
  agulhaSugerida: string;
  sugestoes: SugestaoRevisao[];
};

export type FilaRevisao = {
  disponivel: boolean;
  itens: ItemRevisao[];
  pendentes: { itens: number; valorCents: number };
  resolvidos: { itens: number; valorCents: number };
};

function filaIndisponivel(): FilaRevisao {
  return {
    disponivel: false,
    itens: [],
    pendentes: { itens: 0, valorCents: 0 },
    resolvidos: { itens: 0, valorCents: 0 }
  };
}

export async function getFilaRevisao(): Promise<FilaRevisao> {
  if (!isFinanceConfigured()) return filaIndisponivel();

  const [itens, totais] = await Promise.all([
    query<{
      id: number;
      target_table: TabelaAlvo;
      target_id: number;
      reason: string;
      amount_cents: number;
      data: string | null;
      descricao: string | null;
      contraparte: string | null;
      categoria_code: string | null;
      categoria_nome: string | null;
      nucleo: string | null;
      classified_by: string | null;
      sugestoes: SugestaoRevisao[];
    }>(
      // Ordenada por R$ em jogo, não por data — é o Pareto que faz as primeiras
      // 100 decisões cobrirem a maior parte dos R$ 648 mil (ver 0009).
      //
      // As sugestões saem do histórico da contraparte em fin_document, que é
      // onde a classificação tem texto comercial de verdade. LATERAL roda só
      // para as 100 linhas da página, nunca para a fila inteira.
      `WITH alvo AS (
         SELECT ri.id, ri.target_table, ri.target_id, ri.reason, ri.amount_cents,
                COALESCE(d.description, t.description_raw) AS descricao,
                COALESCE(d.due_date, t.posted_on) AS data,
                COALESCE(d.counterparty_id, t.counterparty_id) AS counterparty_id,
                COALESCE(dc.code, tc.code) AS categoria_code,
                COALESCE(dc.name, tc.name) AS categoria_nome,
                COALESCE(d.nucleo, t.nucleo) AS nucleo,
                COALESCE(d.classified_by, t.classified_by) AS classified_by
           FROM fin_review_item ri
           JOIN fin_entity e ON e.id = ri.entity_id
           LEFT JOIN fin_document d ON ri.target_table = 'fin_document' AND d.id = ri.target_id
           LEFT JOIN fin_transaction t ON ri.target_table = 'fin_transaction' AND t.id = ri.target_id
           LEFT JOIN fin_category dc ON dc.id = d.category_id
           LEFT JOIN fin_category tc ON tc.id = t.category_id
          WHERE e.slug = $1 AND ri.status = 'pendente'
          ORDER BY abs(ri.amount_cents) DESC, ri.id
          LIMIT 100
       )
       SELECT alvo.*, cp.name AS contraparte, sug.sugestoes
         FROM alvo
         LEFT JOIN fin_counterparty cp ON cp.id = alvo.counterparty_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(
                    jsonb_agg(jsonb_build_object(
                      'code', s.code, 'name', s.name, 'nucleo', s.nucleo,
                      'n', s.n, 'share', s.share) ORDER BY s.n DESC),
                    '[]'::jsonb) AS sugestoes
             FROM (
               SELECT c.code, c.name,
                      mode() WITHIN GROUP (ORDER BY h.nucleo) AS nucleo,
                      count(*)::int AS n,
                      -- share sobre o histórico INTEIRO da contraparte (a janela
                      -- roda antes do LIMIT), senão top-3 somaria sempre 100%.
                      round(100.0 * count(*) / SUM(count(*)) OVER ())::int AS share
                 FROM fin_document h
                 JOIN fin_category c ON c.id = h.category_id
                WHERE h.counterparty_id = alvo.counterparty_id
                  -- 3.99 é "Receita a classificar": sugerir a categoria-balde
                  -- seria empurrar a dívida de classificação adiante.
                  AND c.code <> '3.99'
                GROUP BY c.id, c.code, c.name
                ORDER BY count(*) DESC
                LIMIT 3
             ) s
         ) sug ON true
        ORDER BY abs(alvo.amount_cents) DESC, alvo.id`,
      [ENTITY]
    ),
    query<{ status: string; n: number; valor: number }>(
      `SELECT ri.status, count(*)::int AS n, COALESCE(SUM(abs(ri.amount_cents)), 0) AS valor
         FROM fin_review_item ri JOIN fin_entity e ON e.id = ri.entity_id
        WHERE e.slug = $1
        GROUP BY ri.status`,
      [ENTITY]
    )
  ]);

  const porStatus = (status: string) => {
    const linha = totais.find((t) => t.status === status);
    return { itens: linha?.n ?? 0, valorCents: linha?.valor ?? 0 };
  };

  return {
    disponivel: true,
    itens: itens.map((linha) => ({
      id: linha.id,
      targetTable: linha.target_table,
      targetId: linha.target_id,
      reason: linha.reason,
      amountCents: linha.amount_cents,
      data: linha.data,
      descricao: linha.descricao ?? "(linha original removida)",
      contraparte: linha.contraparte,
      categoriaCode: linha.categoria_code,
      categoriaNome: linha.categoria_nome,
      nucleo: linha.nucleo,
      classifiedBy: linha.classified_by,
      // A mesma extração que o classificador usa: para "Cobrança gerada
      // automaticamente ... Mensagem: NF 192" a agulha proposta é "nf 192",
      // não o boilerplate do Asaas. Calculada AQUI para o cliente não precisar
      // importar fin-normalize (que puxa node:crypto e não roda no browser).
      agulhaSugerida: classifiableText(linha.descricao) || normalizeDescription(linha.descricao),
      sugestoes: linha.sugestoes ?? []
    })),
    pendentes: porStatus("pendente"),
    resolvidos: porStatus("resolvido")
  };
}

// ---------------------------------------------------------------------------
// Opções de classificação (selects da tela)
// ---------------------------------------------------------------------------

export type OpcoesClassificacao = {
  categorias: { code: string; name: string; kind: string }[];
  nucleos: { slug: string; name: string }[];
};

export async function getOpcoesClassificacao(): Promise<OpcoesClassificacao> {
  if (!isFinanceConfigured()) return { categorias: [], nucleos: [] };
  const [categorias, nucleos] = await Promise.all([
    // Por código, não por sort_order: a tela agrupa pelo prefixo (3.x receitas,
    // 4.x custos...) e o agrupamento só é estável se a lista chegar ordenada.
    query<{ code: string; name: string; kind: string }>(
      `SELECT c.code, c.name, c.kind FROM fin_category c
         JOIN fin_entity e ON e.id = c.entity_id
        WHERE e.slug = $1 AND c.is_active
        ORDER BY c.code`,
      [ENTITY]
    ),
    query<{ slug: string; name: string }>(
      `SELECT slug, name FROM fin_nucleo WHERE is_active ORDER BY sort_order`
    )
  ]);
  return { categorias, nucleos };
}

// ---------------------------------------------------------------------------
// Resolução de código/núcleo (422 quando não existe)
// ---------------------------------------------------------------------------

/** Erro de validação reconhecível pelas rotas para virar 422. */
export class ValidacaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidacaoError";
  }
}

export async function resolverCategoria(
  client: pg.PoolClient,
  categoryCode: string
): Promise<{ id: number; code: string; name: string }> {
  const { rows } = await client.query<{ id: number; code: string; name: string }>(
    `SELECT c.id, c.code, c.name FROM fin_category c
       JOIN fin_entity e ON e.id = c.entity_id
      WHERE e.slug = $1 AND c.code = $2 AND c.is_active`,
    [ENTITY, categoryCode]
  );
  if (!rows[0]) throw new ValidacaoError(`categoria desconhecida: ${categoryCode}`);
  return rows[0];
}

export async function resolverNucleo(client: pg.PoolClient, nucleo: string): Promise<string> {
  const { rows } = await client.query<{ slug: string }>(
    `SELECT slug FROM fin_nucleo WHERE slug = $1 AND is_active`,
    [nucleo]
  );
  if (!rows[0]) throw new ValidacaoError(`núcleo desconhecido: ${nucleo}`);
  return rows[0].slug;
}

// ---------------------------------------------------------------------------
// Escrita: o invariante de classificação humana
// ---------------------------------------------------------------------------

export type ClassificacaoHumana = {
  table: TabelaAlvo;
  ids: number[];
  /** Já resolvidos por resolverCategoria/resolverNucleo. */
  categoria: { id: number; code: string; name: string } | null;
  nucleo: string | null;
  /** Compartilhado por todas as linhas de um lote; null em edição avulsa. */
  batchId: string | null;
  /** Anotação livre de origem ('sugestao_historico', 'manual', 'lote'...). */
  via: string;
};

export type ResultadoClassificacao = {
  aplicados: number;
  naoEncontrados: number[];
  valorCents: number;
};

/**
 * Aplica UMA decisão humana de categoria/núcleo a um conjunto de linhas da
 * mesma tabela, cumprindo o invariante completo dentro do client/transação do
 * chamador:
 *
 *   1. UPDATE da linha + human_locked_fields (sem duplicatas) — é o que impede
 *      o sync noturno de desfazer a decisão;
 *   2. fin_audit_log com before/after SÓ dos campos alterados — é o que torna
 *      o desfazer possível;
 *   3. fin_classification_event stage='humano' — accepted=false quando o
 *      humano sobrescreveu sugestão de máquina, que é o sinal que mede se as
 *      regras estão melhorando;
 *   4. fin_review_item → 'resolvido';
 *   5. classified_by='humano' na linha.
 *
 * Recebe N ids em vez de um porque o lote de 100 linhas contra um Postgres
 * remoto não sobrevive a 5 consultas por linha — aqui são 5 consultas por
 * CHAMADA, com unnest carregando os valores por linha.
 */
export async function classificarHumano(
  client: pg.PoolClient,
  edicao: ClassificacaoHumana
): Promise<ResultadoClassificacao> {
  const tabela = TABELAS[edicao.table];
  if (!edicao.categoria && !edicao.nucleo) {
    throw new ValidacaoError("nada a aplicar: informe categoryCode e/ou nucleo");
  }

  // FOR UPDATE: o lote e o sync noturno não podem intercalar escrita na mesma
  // linha — o lock segura até o COMMIT do chamador.
  const { rows } = await client.query<{
    id: number;
    entity_id: number;
    category_id: number | null;
    nucleo: string | null;
    review_status: string;
    classified_by: string | null;
    valor: number;
  }>(
    `SELECT id, entity_id, category_id, nucleo, review_status, classified_by,
            abs(amount_cents) AS valor
       FROM ${tabela} WHERE id = ANY($1::bigint[]) FOR UPDATE`,
    [edicao.ids]
  );

  const encontrados = new Set(rows.map((r) => r.id));
  const naoEncontrados = edicao.ids.filter((id) => !encontrados.has(id));
  if (!rows.length) return { aplicados: 0, naoEncontrados, valorCents: 0 };

  // Trava-se o campo que o humano EDITOU, mesmo quando o valor novo é igual ao
  // atual: confirmar uma sugestão também é decisão, e é ela que o sync deve
  // respeitar. O diff de auditoria, esse sim, só carrega o que mudou de fato.
  const camposEditados: string[] = [];
  if (edicao.categoria) camposEditados.push("category_id");
  if (edicao.nucleo) camposEditados.push("nucleo");

  const ids: number[] = [];
  const befores: string[] = [];
  const afters: string[] = [];
  const fieldsJson: string[] = [];
  const rationales: string[] = [];
  const accepteds: boolean[] = [];
  const supersededs: (string | null)[] = [];
  const nucleosEfetivos: (string | null)[] = [];
  let valorCents = 0;

  for (const row of rows) {
    ids.push(row.id);
    valorCents += row.valor;

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const mudados: string[] = [];
    if (edicao.categoria && row.category_id !== edicao.categoria.id) {
      before.category_id = row.category_id;
      after.category_id = edicao.categoria.id;
      mudados.push("category_id");
    }
    if (edicao.nucleo && row.nucleo !== edicao.nucleo) {
      before.nucleo = row.nucleo;
      after.nucleo = edicao.nucleo;
      mudados.push("nucleo");
    }
    if (row.review_status !== "ok") {
      before.review_status = row.review_status;
      after.review_status = "ok";
      mudados.push("review_status");
    }
    befores.push(JSON.stringify(before));
    afters.push(JSON.stringify(after));
    fieldsJson.push(JSON.stringify(mudados));

    // accepted=false = "a máquina tinha classificado e o humano trocou a
    // categoria". É a métrica de qualidade das regras; marcá-la errada faz o
    // placar de aprendizado mentir para sempre.
    const sobrescreveu =
      edicao.categoria !== null && row.classified_by !== null && row.category_id !== edicao.categoria.id;
    accepteds.push(!sobrescreveu);
    supersededs.push(
      sobrescreveu
        ? JSON.stringify({
            category_id: row.category_id,
            nucleo: row.nucleo,
            classified_by: row.classified_by
          })
        : null
    );
    nucleosEfetivos.push(edicao.nucleo ?? row.nucleo);
    rationales.push(
      JSON.stringify({
        origem: "humano",
        via: edicao.via,
        anterior: { category_id: row.category_id, nucleo: row.nucleo, classified_by: row.classified_by }
      })
    );
  }

  // 1 + 5. A linha em si. O array_agg(DISTINCT ...) é o "sem duplicatas" do
  // invariante: reclassificar a mesma linha duas vezes não pode acumular
  // ['category_id','category_id'].
  await client.query(
    `UPDATE ${tabela} t
        SET category_id = COALESCE($1, t.category_id),
            nucleo = COALESCE($2, t.nucleo),
            review_status = 'ok',
            classified_by = 'humano',
            classified_rule_id = NULL,
            classified_reason = jsonb_build_object('origem', 'humano', 'via', $3::text),
            classified_at = now(),
            human_locked_fields = (
              SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                FROM unnest(t.human_locked_fields || $4::text[]) AS f
            )
      WHERE t.id = ANY($5::bigint[])`,
    [edicao.categoria?.id ?? null, edicao.nucleo, edicao.via, camposEditados, ids]
  );

  // 2. Auditoria — o `before` é o que torna o desfazer possível (0004).
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
     SELECT r.entity_id, $1, u.id, 'update', u.b, u.a,
            ARRAY(SELECT jsonb_array_elements_text(u.f)), $5, 'ui'
       FROM unnest($2::bigint[], $3::jsonb[], $4::jsonb[], $6::jsonb[]) AS u(id, b, a, f)
       JOIN ${tabela} r ON r.id = u.id`,
    [tabela, ids, befores, afters, edicao.batchId, fieldsJson]
  );

  // 3. Evento de classificação — o histórico que nada sobrescreve.
  await client.query(
    `INSERT INTO fin_classification_event
        (target_table, target_id, stage, category_id, nucleo, confidence, rationale, accepted, superseded_value, actor)
     SELECT $1, u.id, 'humano', $2, u.nuc, 100, u.rat, u.acc, u.sup, 'ui'
       FROM unnest($3::bigint[], $4::text[], $5::jsonb[], $6::boolean[], $7::jsonb[])
              AS u(id, nuc, rat, acc, sup)`,
    [tabela, edicao.categoria?.id ?? null, ids, nucleosEfetivos, rationales, accepteds, supersededs]
  );

  // 4. A fila. WHERE status='pendente' preserva resolved_at da primeira
  // resolução quando alguém reclassifica um item já resolvido.
  await client.query(
    `UPDATE fin_review_item
        SET status = 'resolvido', resolved_at = now(), resolved_by = 'ui'
      WHERE target_table = $1 AND target_id = ANY($2::bigint[]) AND status = 'pendente'`,
    [tabela, ids]
  );

  return { aplicados: rows.length, naoEncontrados, valorCents };
}

// ---------------------------------------------------------------------------
// O PATCH individual (lançamento e documento compartilham tudo menos a tabela)
// ---------------------------------------------------------------------------

export type CorpoPatch = {
  categoryCode?: unknown;
  nucleo?: unknown;
  reviewStatus?: unknown;
};

export type RespostaPatch =
  | { ok: true; id: number; categoriaCode: string | null; nucleo: string | null; reviewStatus: string }
  | { ok: false; status: 400 | 404 | 422; error: string };

/**
 * Corpo {categoryCode?, nucleo?, reviewStatus?} → invariante completo, numa
 * transação só. Vive aqui (e não duplicado nas duas rotas) porque
 * /api/financeiro/lancamentos/[id] e /api/financeiro/documentos/[id] são a
 * MESMA operação sobre tabelas diferentes.
 */
export async function processarPatchClassificacao(
  table: TabelaAlvo,
  id: number,
  body: CorpoPatch
): Promise<RespostaPatch> {
  const categoryCode = typeof body.categoryCode === "string" ? body.categoryCode.trim() : null;
  const nucleoPedido = typeof body.nucleo === "string" ? body.nucleo.trim() : null;
  const reviewStatus = typeof body.reviewStatus === "string" ? body.reviewStatus.trim() : null;

  if (!categoryCode && !nucleoPedido && !reviewStatus) {
    return { ok: false, status: 400, error: "informe categoryCode, nucleo e/ou reviewStatus" };
  }

  try {
    return await transaction(async (client) => {
      if (categoryCode || nucleoPedido) {
        const categoria = categoryCode ? await resolverCategoria(client, categoryCode) : null;
        const nucleo = nucleoPedido ? await resolverNucleo(client, nucleoPedido) : null;
        const resultado = await classificarHumano(client, {
          table,
          ids: [id],
          categoria,
          nucleo,
          batchId: null,
          via: "manual"
        });
        if (!resultado.aplicados) {
          return { ok: false as const, status: 404 as const, error: `${table} ${id} não encontrado` };
        }
      }
      if (reviewStatus) {
        const achou = await mudarReviewStatus(client, { table, id, reviewStatus });
        if (!achou) return { ok: false as const, status: 404 as const, error: `${table} ${id} não encontrado` };
      }

      const { rows } = await client.query<{
        id: number;
        categoria_code: string | null;
        nucleo: string | null;
        review_status: string;
      }>(
        `SELECT t.id, c.code AS categoria_code, t.nucleo, t.review_status
           FROM ${TABELAS[table]} t LEFT JOIN fin_category c ON c.id = t.category_id
          WHERE t.id = $1`,
        [id]
      );
      const row = rows[0];
      return {
        ok: true as const,
        id: row.id,
        categoriaCode: row.categoria_code,
        nucleo: row.nucleo,
        reviewStatus: row.review_status
      };
    });
  } catch (error) {
    if (error instanceof ValidacaoError) return { ok: false, status: 422, error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Escrita: mudança de review_status sem classificar (adiar/ignorar/reabrir)
// ---------------------------------------------------------------------------

const REVIEW_STATUS_VALIDOS = new Set(["ok", "pendente", "adiado", "ignorado"]);

export async function mudarReviewStatus(
  client: pg.PoolClient,
  alvo: { table: TabelaAlvo; id: number; reviewStatus: string }
): Promise<boolean> {
  if (!REVIEW_STATUS_VALIDOS.has(alvo.reviewStatus)) {
    throw new ValidacaoError(`reviewStatus desconhecido: ${alvo.reviewStatus}`);
  }
  const tabela = TABELAS[alvo.table];

  const { rows } = await client.query<{ id: number; entity_id: number; review_status: string }>(
    `SELECT id, entity_id, review_status FROM ${tabela} WHERE id = $1 FOR UPDATE`,
    [alvo.id]
  );
  if (!rows[0]) return false;
  const row = rows[0];

  // 'review_status' entra no human_locked_fields pelo mesmo motivo da
  // categoria: "ignorado" é decisão humana, e o sync que reabrisse o item toda
  // noite transformaria o ignorar em trabalho de Sísifo.
  await client.query(
    `UPDATE ${tabela} t
        SET review_status = $1,
            human_locked_fields = (
              SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                FROM unnest(t.human_locked_fields || ARRAY['review_status']) AS f
            )
      WHERE t.id = $2`,
    [alvo.reviewStatus, alvo.id]
  );

  if (row.review_status !== alvo.reviewStatus) {
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       VALUES ($1, $2, $3, 'update', $4::jsonb, $5::jsonb, ARRAY['review_status'], 'ui')`,
      [
        row.entity_id,
        tabela,
        alvo.id,
        JSON.stringify({ review_status: row.review_status }),
        JSON.stringify({ review_status: alvo.reviewStatus })
      ]
    );
  }

  // Espelha na fila: 'ok' resolve, 'pendente' reabre, o resto acompanha.
  if (alvo.reviewStatus === "ok") {
    await client.query(
      `UPDATE fin_review_item SET status = 'resolvido', resolved_at = now(), resolved_by = 'ui'
        WHERE target_table = $1 AND target_id = $2 AND status = 'pendente'`,
      [tabela, alvo.id]
    );
  } else if (alvo.reviewStatus === "pendente") {
    await client.query(
      `UPDATE fin_review_item SET status = 'pendente', resolved_at = NULL, resolved_by = NULL
        WHERE target_table = $1 AND target_id = $2`,
      [tabela, alvo.id]
    );
  } else {
    // 'adiado' não carimba resolved_at: o item volta, e a data de resolução
    // precisa ser a da decisão final. 'ignorado' é decisão final e carimba.
    await client.query(
      `UPDATE fin_review_item
          SET status = $3,
              resolved_at = CASE WHEN $3 = 'ignorado' THEN now() ELSE NULL END,
              resolved_by = CASE WHEN $3 = 'ignorado' THEN 'ui' ELSE NULL END
        WHERE target_table = $1 AND target_id = $2 AND status = 'pendente'`,
      [tabela, alvo.id, alvo.reviewStatus]
    );
  }
  return true;
}
