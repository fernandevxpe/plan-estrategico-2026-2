import "server-only";

import type pg from "pg";

import { normalizeDescription, normalizeName } from "@/scripts/lib/fin-normalize.mjs";
import { isFinanceConfigured, query, transaction } from "./db";
import { resolverCategoria, resolverNucleo, ValidacaoError } from "./revisao";

/**
 * Contas a pagar e a receber.
 *
 * Esta é a SUPERFÍCIE DE ENTRADA do módulo: tudo que o extrato bancário não
 * conta nasce aqui. Hoje o banco tem 3.350 documentos a receber (todos vindos do
 * Asaas) e ZERO a pagar — o que significa que a previsão de caixa só enxerga
 * metade do mundo e que "cobertura de planejamento" é 0%.
 *
 * Três invariantes de escrita, iguais aos de revisao.ts e pelos mesmos motivos:
 *
 *  1. `planned_at = now()` em TODA criação manual de pagável. É a única coluna
 *     irrecuperável do schema (ver 0002): sem ela não há como provar que o
 *     pagamento foi registrado ANTES de o dinheiro sair, e o índice de
 *     confiabilidade perde o seu único componente honesto.
 *  2. Toda escrita numa `transaction()` com linha em fin_audit_log (actor 'ui'),
 *     com `before` — é o `before` que torna o desfazer possível.
 *  3. Campo que o humano editou entra em `human_locked_fields`. Sem isso o sync
 *     noturno desfaz na madrugada o valor de pró-labore corrigido às 17h.
 */

const ENTITY = "xpe";

/** Status que ainda representam dinheiro a sair/entrar. 'previsto' incluído: é o que a tela cria. */
const STATUS_ABERTOS = ["previsto", "emitido", "confirmado", "parcial"];

const FLEXIBILIDADES = new Set(["fixo", "negociavel", "adiavel"]);
const STATUS_VALIDOS = new Set([
  "previsto",
  "emitido",
  "confirmado",
  "parcial",
  "liquidado",
  "estornado",
  "cancelado"
]);

export type Direcao = "pagar" | "receber";

export function direcaoValida(valor: unknown): valor is Direcao {
  return valor === "pagar" || valor === "receber";
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export type FiltrosContas = {
  direcao: Direcao;
  /** 'YYYY-MM-DD'. Corta por due_date. */
  de?: string | null;
  ate?: string | null;
  nucleo?: string | null;
  categoriaCode?: string | null;
  counterpartyId?: number | null;
  texto?: string | null;
  /** true = só o que está em aberto (o padrão da tela). */
  somenteAbertos?: boolean;
};

export type ContaLinha = {
  id: number;
  dueDate: string;
  competenceDate: string;
  descricao: string;
  contraparte: string | null;
  counterpartyId: number | null;
  categoriaCode: string | null;
  categoriaNome: string | null;
  nucleo: string | null;
  amountCents: number;
  settledCents: number;
  abertoCents: number;
  flexibility: string;
  status: string;
  source: string;
  plannedAt: string | null;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  /** Positivo = vencido há N dias. Calculado no SQL, no fuso de São Paulo. */
  diasAtraso: number;
  notes: string | null;
};

export type GrupoMes = {
  mes: string;
  totalCents: number;
  abertoCents: number;
  vencidoCents: number;
  linhas: ContaLinha[];
};

export type OpcoesContas = {
  categorias: { code: string; name: string; kind: string; dreLine: string }[];
  nucleos: { slug: string; name: string }[];
  contrapartes: { id: number; name: string; kind: string }[];
};

export type PainelContas = {
  disponivel: boolean;
  direcao: Direcao;
  grupos: GrupoMes[];
  totais: {
    n: number;
    totalCents: number;
    abertoCents: number;
    vencidoCents: number;
    /** Só o que vence dentro dos próximos 30 dias — a pergunta real do dia 8. */
    proximos30Cents: number;
    /**
     * Recebido FORA das contas rastreadas (dinheiro, transferência direta) ou
     * compensado mas não creditado. É dinheiro reconhecido que ainda não
     * apareceu no extrato — nem "em aberto" nem "recebido".
     */
    confirmadoCents: number;
    confirmadoN: number;
  };
  /** Quantos pagáveis existem no total, ignorando filtro. Decide o estado vazio. */
  totalPagaveisNoBanco: number;
  opcoes: OpcoesContas;
};

function painelIndisponivel(direcao: Direcao): PainelContas {
  return {
    disponivel: false,
    direcao,
    grupos: [],
    totais: { n: 0, totalCents: 0, abertoCents: 0, vencidoCents: 0, proximos30Cents: 0, confirmadoCents: 0, confirmadoN: 0 },
    totalPagaveisNoBanco: 0,
    opcoes: { categorias: [], nucleos: [], contrapartes: [] }
  };
}

/**
 * Uma consulta só, com todos os filtros parametrizados.
 *
 * O agrupamento por mês acontece em JavaScript e não em SQL de propósito: a tela
 * precisa da linha individual E do subtotal do mês, e pedir os dois ao banco
 * seria duas consultas que podem discordar entre si se um filtro for esquecido
 * numa delas.
 */
export async function getContas(filtros: FiltrosContas): Promise<PainelContas> {
  if (!isFinanceConfigured()) return painelIndisponivel(filtros.direcao);

  const params: unknown[] = [ENTITY, filtros.direcao];
  const where: string[] = ["e.slug = $1", "d.direction = $2"];

  if (filtros.somenteAbertos !== false) {
    params.push(STATUS_ABERTOS);
    where.push(`d.status = ANY($${params.length}::text[])`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    where.push(`d.due_date >= $${params.length}::date`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    where.push(`d.due_date <= $${params.length}::date`);
  }
  if (filtros.nucleo) {
    params.push(filtros.nucleo);
    where.push(`d.nucleo = $${params.length}`);
  }
  if (filtros.categoriaCode) {
    params.push(filtros.categoriaCode);
    where.push(`c.code = $${params.length}`);
  }
  if (filtros.counterpartyId) {
    params.push(filtros.counterpartyId);
    where.push(`d.counterparty_id = $${params.length}`);
  }
  if (filtros.texto) {
    // A busca vai contra description_norm (mesma normalização do resto do
    // módulo) para "Pró-Labore" casar com "pro labore" digitado sem acento.
    params.push(`%${normalizeDescription(filtros.texto)}%`);
    where.push(`(d.description_norm LIKE $${params.length} OR cp.normalized_name LIKE $${params.length})`);
  }

  const [linhas, totalPagaveis, opcoes] = await Promise.all([
    query<{
      id: number;
      due_date: string;
      competence_date: string;
      description: string;
      contraparte: string | null;
      counterparty_id: number | null;
      categoria_code: string | null;
      categoria_nome: string | null;
      nucleo: string | null;
      amount_cents: number;
      settled_cents: number;
      flexibility: string;
      status: string;
      source: string;
      planned_at: string | null;
      installment_group_id: string | null;
      installment_number: number | null;
      installment_total: number | null;
      dias_atraso: number;
      notes: string | null;
    }>(
      `SELECT d.id, d.due_date::text, d.competence_date::text, d.description,
              cp.name AS contraparte, d.counterparty_id,
              c.code AS categoria_code, c.name AS categoria_nome,
              d.nucleo, d.amount_cents, d.settled_cents, d.flexibility, d.status, d.source,
              d.planned_at::text, d.installment_group_id, d.installment_number, d.installment_total,
              -- Fuso resolvido no SQL: o servidor de produção vive em UTC e o
              -- "hoje" de lá pode não ser o de quem olha a tela.
              GREATEST(0, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - d.due_date))::int AS dias_atraso,
              d.notes
         FROM fin_document d
         JOIN fin_entity e ON e.id = d.entity_id
         LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
         LEFT JOIN fin_category c ON c.id = d.category_id
        WHERE ${where.join(" AND ")}
        ORDER BY d.due_date, d.id
        LIMIT 1000`,
      params
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
        WHERE e.slug = $1 AND d.direction = $2`,
      [ENTITY, filtros.direcao]
    ),
    getOpcoesContas()
  ]);

  const grupos = new Map<string, GrupoMes>();
  // 'confirmado' é dinheiro RECONHECIDO que ainda não creditou (recebimento
  // fora do Asaas, cartão D+30). Somá-lo a "em aberto" fazia esta tela mostrar
  // R$ 631 mil enquanto /financeiro dizia R$ 414 mil e /indicadores R$ 506 mil
  // — três números para a mesma frase. Aqui ele vira uma linha própria.
  const totais = {
    n: 0,
    totalCents: 0,
    abertoCents: 0,
    vencidoCents: 0,
    proximos30Cents: 0,
    confirmadoCents: 0,
    confirmadoN: 0
  };

  const hoje = new Date();
  const limite30 = new Date(hoje.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const hojeIso = hoje.toISOString().slice(0, 10);

  for (const linha of linhas) {
    const aberto = Math.max(0, linha.amount_cents - linha.settled_cents);
    if (linha.status === "confirmado") {
      totais.confirmadoCents += aberto;
      totais.confirmadoN += 1;
    }
    const item: ContaLinha = {
      id: linha.id,
      dueDate: linha.due_date,
      competenceDate: linha.competence_date,
      descricao: linha.description,
      contraparte: linha.contraparte,
      counterpartyId: linha.counterparty_id,
      categoriaCode: linha.categoria_code,
      categoriaNome: linha.categoria_nome,
      nucleo: linha.nucleo,
      amountCents: linha.amount_cents,
      settledCents: linha.settled_cents,
      abertoCents: aberto,
      flexibility: linha.flexibility,
      status: linha.status,
      source: linha.source,
      plannedAt: linha.planned_at,
      installmentGroupId: linha.installment_group_id,
      installmentNumber: linha.installment_number,
      installmentTotal: linha.installment_total,
      diasAtraso: linha.dias_atraso,
      notes: linha.notes
    };

    const mes = `${linha.due_date.slice(0, 7)}-01`;
    const grupo = grupos.get(mes) ?? { mes, totalCents: 0, abertoCents: 0, vencidoCents: 0, linhas: [] };
    grupo.linhas.push(item);
    grupo.totalCents += item.amountCents;
    grupo.abertoCents += aberto;
    if (item.diasAtraso > 0) grupo.vencidoCents += aberto;
    grupos.set(mes, grupo);

    totais.n += 1;
    totais.totalCents += item.amountCents;
    totais.abertoCents += aberto;
    if (item.diasAtraso > 0) totais.vencidoCents += aberto;
    if (linha.due_date >= hojeIso && linha.due_date <= limite30) totais.proximos30Cents += aberto;
  }

  return {
    disponivel: true,
    direcao: filtros.direcao,
    grupos: [...grupos.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    totais,
    totalPagaveisNoBanco: totalPagaveis[0]?.n ?? 0,
    opcoes
  };
}

export async function getOpcoesContas(): Promise<OpcoesContas> {
  if (!isFinanceConfigured()) return { categorias: [], nucleos: [], contrapartes: [] };
  const [categorias, nucleos, contrapartes] = await Promise.all([
    query<{ code: string; name: string; kind: string; dre_line: string }>(
      `SELECT c.code, c.name, c.kind, c.dre_line FROM fin_category c
         JOIN fin_entity e ON e.id = c.entity_id
        WHERE e.slug = $1 AND c.is_active
        ORDER BY c.code`,
      [ENTITY]
    ),
    query<{ slug: string; name: string }>(
      `SELECT slug, name FROM fin_nucleo WHERE is_active ORDER BY sort_order`
    ),
    // Limite alto porque a lista alimenta um datalist no cliente, não um select:
    // 311 contrapartes cabem sem paginação e o autocomplete fica instantâneo.
    query<{ id: number; name: string; kind: string }>(
      `SELECT cp.id, cp.name, cp.kind FROM fin_counterparty cp
         JOIN fin_entity e ON e.id = cp.entity_id
        WHERE e.slug = $1 AND cp.is_active
        ORDER BY cp.name
        LIMIT 2000`,
      [ENTITY]
    )
  ]);
  return {
    categorias: categorias.map((c) => ({ code: c.code, name: c.name, kind: c.kind, dreLine: c.dre_line })),
    nucleos,
    contrapartes
  };
}

// ---------------------------------------------------------------------------
// Escrita: criação de pagáveis
// ---------------------------------------------------------------------------

export type NovoPagamento = {
  descricao: unknown;
  counterpartyId?: unknown;
  /** Nome digitado quando o favorecido ainda não existe — cria a contraparte. */
  counterpartyNome?: unknown;
  categoryCode?: unknown;
  nucleo?: unknown;
  valorCents?: unknown;
  dueDate?: unknown;
  recorrencia?: unknown;
  flexibility?: unknown;
  observacao?: unknown;
};

export type ResultadoCriacao = { ids: number[]; installmentGroupId: string | null };

/**
 * Resolve (ou cria) a contraparte do pagamento.
 *
 * Hoje fin_counterparty tem 311 clientes e ZERO fornecedores: exigir cadastro
 * prévio faria o primeiro pagamento manual esbarrar num formulário vazio e
 * voltar para a planilha "só dessa vez" — que é como se perde. Por isso o nome
 * digitado cria o fornecedor, com auditoria.
 *
 * O casamento é por normalized_name para "Enel S/A" e "ENEL SA" não virarem dois
 * fornecedores no mesmo mês.
 */
async function resolverFavorecido(
  client: pg.PoolClient,
  entityId: number,
  counterpartyId: number | null,
  nome: string | null
): Promise<number | null> {
  if (counterpartyId) {
    const { rows } = await client.query<{ id: number }>(
      `SELECT id FROM fin_counterparty WHERE id = $1 AND entity_id = $2`,
      [counterpartyId, entityId]
    );
    if (!rows[0]) throw new ValidacaoError(`favorecido desconhecido: ${counterpartyId}`);
    return rows[0].id;
  }
  if (!nome) return null;

  const normalizado = normalizeName(nome);
  if (!normalizado) return null;

  const existente = await client.query<{ id: number }>(
    `SELECT id FROM fin_counterparty WHERE entity_id = $1 AND normalized_name = $2 ORDER BY id LIMIT 1`,
    [entityId, normalizado]
  );
  if (existente.rows[0]) return existente.rows[0].id;

  const criado = await client.query<{ id: number }>(
    `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name)
     VALUES ($1, 'fornecedor', $2, $3) RETURNING id`,
    [entityId, nome.trim(), normalizado]
  );
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
     VALUES ($1, 'fin_counterparty', $2, 'insert', $3::jsonb, ARRAY['name','kind'], 'ui')`,
    [entityId, criado.rows[0].id, JSON.stringify({ name: nome.trim(), kind: "fornecedor" })]
  );
  return criado.rows[0].id;
}

function exigirTexto(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !valor.trim()) throw new ValidacaoError(`${campo} é obrigatório`);
  return valor.trim();
}

function exigirCentavos(valor: unknown, campo: string): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ValidacaoError(`${campo} deve ser um inteiro de centavos maior que zero`);
  }
  return n;
}

function exigirData(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    throw new ValidacaoError(`${campo} deve estar no formato AAAA-MM-DD`);
  }
  return valor.trim();
}

/**
 * Cria um pagável manual — e, quando a recorrência é mensal, os 12 do ciclo.
 *
 * A decisão de gerar 12 documentos concretos em vez de uma "regra de recorrência"
 * é deliberada: o fluxo de caixa lê fin_document, e uma recorrência que só existe
 * como configuração não aparece na previsão até virar linha. Doze é o horizonte
 * de um exercício — o suficiente para o ano fechar e pouco o bastante para
 * cancelar sem arqueologia.
 *
 * O dia do vencimento é grampeado no último dia do mês (dia 31 em fevereiro vira
 * 28/29), a mesma regra do `due_day_rule = 'posterga'` de fin_contract.
 */
export async function criarPagamento(corpo: NovoPagamento): Promise<ResultadoCriacao> {
  const descricao = exigirTexto(corpo.descricao, "descrição");
  const valorCents = exigirCentavos(corpo.valorCents, "valor");
  const dueDate = exigirData(corpo.dueDate, "vencimento");
  const recorrencia = corpo.recorrencia === "mensal" ? "mensal" : "unica";
  const flexibility =
    typeof corpo.flexibility === "string" && FLEXIBILIDADES.has(corpo.flexibility)
      ? corpo.flexibility
      : "negociavel";
  const observacao = typeof corpo.observacao === "string" && corpo.observacao.trim() ? corpo.observacao.trim() : null;
  const counterpartyId = Number.isInteger(Number(corpo.counterpartyId)) && Number(corpo.counterpartyId) > 0
    ? Number(corpo.counterpartyId)
    : null;
  const counterpartyNome =
    typeof corpo.counterpartyNome === "string" && corpo.counterpartyNome.trim()
      ? corpo.counterpartyNome.trim()
      : null;

  return transaction(async (client) => {
    const entidade = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    if (!entidade.rows[0]) throw new ValidacaoError("entidade não encontrada");
    const entityId = entidade.rows[0].id;

    const categoria =
      typeof corpo.categoryCode === "string" && corpo.categoryCode.trim()
        ? await resolverCategoria(client, corpo.categoryCode.trim())
        : null;
    const nucleo =
      typeof corpo.nucleo === "string" && corpo.nucleo.trim() ? await resolverNucleo(client, corpo.nucleo.trim()) : null;
    const favorecidoId = await resolverFavorecido(client, entityId, counterpartyId, counterpartyNome);

    const nParcelas = recorrencia === "mensal" ? 12 : 1;
    const grupo = recorrencia === "mensal" ? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;

    // generate_series + grampo no último dia do mês: o cálculo de data mora no
    // SQL porque JavaScript e Postgres discordam sobre meses de 31 dias, e a
    // discordância só apareceria em fevereiro.
    const { rows } = await client.query<{ id: number; due_date: string }>(
      `INSERT INTO fin_document (
         entity_id, direction, counterparty_id, category_id, nucleo,
         description, description_norm, competence_date, due_date, expected_cash_date,
         cash_date_basis, flexibility, amount_cents, status, source, planned_at,
         installment_group_id, installment_number, installment_total, notes, created_by, review_status
       )
       SELECT $1, 'pagar', $2, $3, $4,
              $5, $6,
              -- Competência = vencimento por padrão: é o que a tela informa. Um
              -- pagamento cuja competência é outra se corrige na edição, mas
              -- deixar NULL quebraria a DRE em silêncio.
              v.venc, v.venc, v.venc,
              'vencimento', $7, $8, 'previsto', 'manual',
              -- planned_at: a prova de precedência. Ver 0002.
              now(),
              $9, CASE WHEN $9::text IS NULL THEN NULL ELSE v0.n + 1 END,
              CASE WHEN $9::text IS NULL THEN NULL ELSE $10::int END,
              $11,
              'ui',
              -- Pagável criado à mão já nasce classificado pelo humano quando
              -- veio com categoria; sem categoria vai para a fila.
              CASE WHEN $3::bigint IS NULL THEN 'pendente' ELSE 'ok' END
         FROM generate_series(0, $10::int - 1) AS v0(n)
         CROSS JOIN LATERAL (
           SELECT (date_trunc('month', $12::date) + make_interval(months => v0.n))::date
                  + LEAST(
                      EXTRACT(day FROM $12::date)::int,
                      EXTRACT(day FROM (date_trunc('month', $12::date) + make_interval(months => v0.n)
                                        + interval '1 month' - interval '1 day'))::int
                    ) - 1 AS venc
         ) v
       RETURNING id, due_date::text`,
      [
        entityId,
        favorecidoId,
        categoria?.id ?? null,
        nucleo,
        descricao,
        normalizeDescription(descricao),
        flexibility,
        valorCents,
        grupo,
        nParcelas,
        observacao,
        dueDate
      ]
    );

    // Auditoria: uma linha por documento, com o batch_id do grupo quando é
    // recorrência — é o que permite desfazer as 12 de uma vez.
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       SELECT $1, 'fin_document', u.id, 'insert', $2::jsonb,
              ARRAY['description','amount_cents','due_date','flexibility','planned_at'], 'ui'
         FROM unnest($3::bigint[]) AS u(id)`,
      [
        entityId,
        JSON.stringify({
          direction: "pagar",
          description: descricao,
          amount_cents: valorCents,
          flexibility,
          source: "manual",
          recorrencia,
          installment_group_id: grupo
        }),
        rows.map((r) => r.id)
      ]
    );

    // Documento sem categoria entra na fila de revisão, como qualquer outro:
    // deixar o pagável criado à mão fora da fila esconderia justamente o dado
    // que ninguém mais vai classificar.
    if (!categoria) {
      await client.query(
        `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents)
         SELECT $1, 'fin_document', u.id, 'sem_categoria', $2
           FROM unnest($3::bigint[]) AS u(id)
         ON CONFLICT (target_table, target_id) DO NOTHING`,
        [entityId, valorCents, rows.map((r) => r.id)]
      );
    }

    return { ids: rows.map((r) => r.id), installmentGroupId: grupo };
  });
}

// ---------------------------------------------------------------------------
// Escrita: edição inline
// ---------------------------------------------------------------------------

export type PatchConta = {
  valorCents?: unknown;
  dueDate?: unknown;
  flexibility?: unknown;
  status?: unknown;
  categoryCode?: unknown;
  nucleo?: unknown;
  observacao?: unknown;
};

export type RespostaPatchConta =
  | { ok: true; id: number; amountCents: number; dueDate: string; flexibility: string; status: string }
  | { ok: false; status: 400 | 404 | 409 | 422; error: string };

/**
 * Edição inline de um pagável ou recebível.
 *
 * É a operação que o requisito "atualizar o valor que será pago em pró-labore"
 * descreve: o valor muda todo mês e não pode exigir apagar e recriar — apagar
 * perderia `planned_at` e, com ele, a prova de que o pagamento foi planejado.
 *
 * Os campos editados entram em human_locked_fields. Sem isso, uma futura
 * importação de extrato que casasse com este documento reescreveria o valor
 * corrigido, e a correção precisaria ser refeita toda semana.
 */
export async function atualizarConta(id: number, corpo: PatchConta): Promise<RespostaPatchConta> {
  const temAlgo =
    corpo.valorCents !== undefined ||
    corpo.dueDate !== undefined ||
    corpo.flexibility !== undefined ||
    corpo.status !== undefined ||
    corpo.categoryCode !== undefined ||
    corpo.nucleo !== undefined ||
    corpo.observacao !== undefined;
  if (!temAlgo) {
    return { ok: false, status: 400, error: "informe ao menos um campo: valorCents, dueDate, flexibility, status, categoryCode, nucleo ou observacao" };
  }

  try {
    return await transaction(async (client) => {
      // FOR UPDATE: o sync noturno e esta edição não podem intercalar escrita na
      // mesma linha. O lock segura até o COMMIT.
      const { rows } = await client.query<{
        id: number;
        entity_id: number;
        amount_cents: number;
        settled_cents: number;
        due_date: string;
        competence_date: string;
        flexibility: string;
        status: string;
        category_id: number | null;
        nucleo: string | null;
        notes: string | null;
      }>(
        `SELECT id, entity_id, amount_cents, settled_cents, due_date::text, competence_date::text,
                flexibility, status, category_id, nucleo, notes
           FROM fin_document WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const atual = rows[0];
      if (!atual) return { ok: false as const, status: 404 as const, error: `documento ${id} não encontrado` };

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const campos: string[] = [];

      let valorCents = atual.amount_cents;
      if (corpo.valorCents !== undefined) {
        valorCents = exigirCentavos(corpo.valorCents, "valor");
        // Baixar o valor abaixo do que já foi liquidado deixaria o documento
        // "liquidado" com saldo negativo. É erro do usuário, não do schema.
        if (valorCents < atual.settled_cents) {
          throw new ValidacaoError(
            `valor menor que o já liquidado (${atual.settled_cents} centavos) — estorne a liquidação antes`
          );
        }
        if (valorCents !== atual.amount_cents) {
          before.amount_cents = atual.amount_cents;
          after.amount_cents = valorCents;
        }
        campos.push("amount_cents");
      }

      let dueDate = atual.due_date;
      if (corpo.dueDate !== undefined) {
        dueDate = exigirData(corpo.dueDate, "vencimento");
        if (dueDate !== atual.due_date) {
          before.due_date = atual.due_date;
          after.due_date = dueDate;
        }
        campos.push("due_date");
      }

      let flexibility = atual.flexibility;
      if (corpo.flexibility !== undefined) {
        if (typeof corpo.flexibility !== "string" || !FLEXIBILIDADES.has(corpo.flexibility)) {
          throw new ValidacaoError("flexibility deve ser fixo, negociavel ou adiavel");
        }
        flexibility = corpo.flexibility;
        if (flexibility !== atual.flexibility) {
          before.flexibility = atual.flexibility;
          after.flexibility = flexibility;
        }
        campos.push("flexibility");
      }

      let status = atual.status;
      if (corpo.status !== undefined) {
        if (typeof corpo.status !== "string" || !STATUS_VALIDOS.has(corpo.status)) {
          throw new ValidacaoError(`status desconhecido: ${String(corpo.status)}`);
        }
        status = corpo.status;
        // Mesma restrição do CHECK de 0002, verificada antes para virar 422 em
        // vez de 500: cancelar depois de receber é estorno, não cancelamento.
        if (status === "cancelado" && atual.settled_cents !== 0) {
          return { ok: false as const, status: 409 as const, error: "documento com caixa liquidado não pode ser cancelado — registre estorno" };
        }
        if (status !== atual.status) {
          before.status = atual.status;
          after.status = status;
        }
        campos.push("status");
      }

      let categoryId = atual.category_id;
      if (corpo.categoryCode !== undefined) {
        const categoria =
          typeof corpo.categoryCode === "string" && corpo.categoryCode.trim()
            ? await resolverCategoria(client, corpo.categoryCode.trim())
            : null;
        categoryId = categoria?.id ?? null;
        if (categoryId !== atual.category_id) {
          before.category_id = atual.category_id;
          after.category_id = categoryId;
        }
        campos.push("category_id");
      }

      let nucleo = atual.nucleo;
      if (corpo.nucleo !== undefined) {
        nucleo =
          typeof corpo.nucleo === "string" && corpo.nucleo.trim()
            ? await resolverNucleo(client, corpo.nucleo.trim())
            : null;
        if (nucleo !== atual.nucleo) {
          before.nucleo = atual.nucleo;
          after.nucleo = nucleo;
        }
        campos.push("nucleo");
      }

      let notes = atual.notes;
      if (corpo.observacao !== undefined) {
        notes = typeof corpo.observacao === "string" && corpo.observacao.trim() ? corpo.observacao.trim() : null;
        if (notes !== atual.notes) {
          before.notes = atual.notes;
          after.notes = notes;
        }
        campos.push("notes");
      }

      // Trava o campo EDITADO mesmo quando o valor novo é igual ao atual:
      // confirmar também é decisão, e é ela que o sync deve respeitar. O diff
      // auditado, esse sim, só carrega o que mudou de fato.
      await client.query(
        `UPDATE fin_document d
            SET amount_cents = $1, due_date = $2, flexibility = $3, status = $4,
                category_id = $5, nucleo = $6, notes = $7,
                human_locked_fields = (
                  SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                    FROM unnest(d.human_locked_fields || $8::text[]) AS f
                )
          WHERE d.id = $9`,
        [valorCents, dueDate, flexibility, status, categoryId, nucleo, notes, campos, id]
      );

      if (Object.keys(after).length) {
        await client.query(
          `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
           VALUES ($1, 'fin_document', $2, 'update', $3::jsonb, $4::jsonb, $5::text[], 'ui')`,
          [atual.entity_id, id, JSON.stringify(before), JSON.stringify(after), Object.keys(after)]
        );
      }

      return { ok: true as const, id, amountCents: valorCents, dueDate, flexibility, status };
    });
  } catch (error) {
    if (error instanceof ValidacaoError) return { ok: false, status: 422, error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Escrita: exclusão
// ---------------------------------------------------------------------------

export type RespostaExclusao = { ok: true; id: number } | { ok: false; status: 404 | 409; error: string };

/**
 * Apaga um pagável — e SÓ se ele nunca tocou o caixa.
 *
 * A restrição não é preciosismo: um documento com liquidação apagado leva junto
 * a fin_settlement em cascata, e o lançamento bancário correspondente vira
 * dinheiro sem destino. Pagamento que já saiu se CANCELA por status (ou se
 * estorna), nunca se apaga.
 */
export async function excluirConta(id: number): Promise<RespostaExclusao> {
  return transaction(async (client) => {
    const { rows } = await client.query<{
      id: number;
      entity_id: number;
      status: string;
      settled_cents: number;
      description: string;
      amount_cents: number;
      due_date: string;
      direction: string;
      source: string;
    }>(
      `SELECT id, entity_id, status, settled_cents, description, amount_cents, due_date::text, direction, source
         FROM fin_document WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const doc = rows[0];
    if (!doc) return { ok: false as const, status: 404 as const, error: `documento ${id} não encontrado` };
    if (doc.status !== "previsto" || doc.settled_cents !== 0) {
      return {
        ok: false as const,
        status: 409 as const,
        error: "só é possível excluir documento em 'previsto' e sem liquidação — cancele em vez de excluir"
      };
    }

    // Auditoria ANTES do DELETE: depois a linha não existe mais para ser lida, e
    // um `before` vazio tornaria o desfazer impossível.
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, fields, actor)
       VALUES ($1, 'fin_document', $2, 'delete', $3::jsonb, ARRAY['*'], 'ui')`,
      [
        doc.entity_id,
        id,
        JSON.stringify({
          direction: doc.direction,
          description: doc.description,
          amount_cents: doc.amount_cents,
          due_date: doc.due_date,
          status: doc.status,
          source: doc.source
        })
      ]
    );
    await client.query(`DELETE FROM fin_review_item WHERE target_table = 'fin_document' AND target_id = $1`, [id]);
    await client.query(`DELETE FROM fin_document WHERE id = $1`, [id]);
    return { ok: true as const, id };
  });
}
