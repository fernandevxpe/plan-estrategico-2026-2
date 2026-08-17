import "server-only";

import { randomUUID } from "node:crypto";

import type pg from "pg";

import { FinanceUnavailableError } from "./db";

/**
 * As escritas sobre o catálogo de custo fixo — ligar, desligar, reajustar,
 * revisar, adotar um candidato.
 *
 * Vive aqui e não nas rotas pelo mesmo motivo de `lib/financeiro/custos.ts`: a
 * mesma operação é chamada de mais de um lugar e três cópias divergem
 * exatamente na regra que ninguém releu.
 *
 * AS QUATRO REGRAS QUE ESTE MÓDULO SUSTENTA
 *
 * 1. LIGAR É ATO COM AUTOR E HORA. `status_alterado_por` e `status_alterado_em`
 *    são obrigatórios em suspenso/encerrado/recusado por CHECK, e este módulo
 *    os preenche em TODA mudança de status, inclusive ao ligar — senão "quem
 *    ligou isto?" só se responde garimpando o log.
 *
 * 2. REAJUSTE NÃO SOBRESCREVE. Toda mudança de valor grava uma linha em
 *    `fin_custo_fixo_ajuste` ANTES de tocar `fin_recurring.amount_cents`. A
 *    tabela é imutável por gatilho e `vigente_de` nunca é anterior ao mês
 *    corrente — ajustar o catálogo muda a previsão dos meses seguintes, nunca
 *    o passado.
 *
 * 3. NADA COM CONFLITO DE CAMADA LIGA. O CHECK `fin_recurring_conflito_nao_ativa`
 *    da 0057 recusa, e este módulo recusa antes, com uma mensagem que explica
 *    qual camada já contém aquele dinheiro. Um 500 do banco seria correto e
 *    ilegível.
 *
 * 4. VALOR AUSENTE EXIGE MOTIVO. Ligar um item sem valor é impossível —
 *    `amount_cents > 0` é CHECK da 0057 — e a mensagem diz o que fazer:
 *    declarar o número, porque o detector se recusou a inventá-lo.
 *
 * Nenhuma função deste módulo toca `fin_transaction`. Nenhuma cria lançamento.
 * Item de catálogo é afirmação sobre o futuro; ele nunca vira caixa.
 */

const ENTIDADE = "xpe";

export class ValidacaoCustoFixo extends Error {
  constructor(
    readonly status: number,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ValidacaoCustoFixo";
  }
}

type Cliente = pg.PoolClient | pg.Client;

const MES_ISO = /^\d{4}-\d{2}(-\d{2})?$/;

function centsObrigatorio(bruto: unknown, campo: string): number {
  const n = Number(bruto);
  // Centavo é inteiro. Aceitar 1234.5 deixaria o Postgres arredondar em
  // silêncio, e meio centavo repetido mil vezes é dinheiro.
  if (!Number.isSafeInteger(n)) throw new ValidacaoCustoFixo(400, `${campo} deve ser inteiro em centavos`);
  if (n <= 0) throw new ValidacaoCustoFixo(422, `${campo} deve ser maior que zero — item de catálogo sem valor não liga`);
  return n;
}

function texto(bruto: unknown, campo: string, maximo = 400): string | null {
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto !== "string") throw new ValidacaoCustoFixo(400, `${campo} deve ser texto`);
  const limpo = bruto.trim();
  if (!limpo) return null;
  if (limpo.length > maximo) throw new ValidacaoCustoFixo(400, `${campo} excede ${maximo} caracteres`);
  return limpo;
}

function textoObrigatorio(bruto: unknown, campo: string, maximo = 400): string {
  const t = texto(bruto, campo, maximo);
  if (!t) throw new ValidacaoCustoFixo(422, `${campo} é obrigatório`);
  return t;
}

/**
 * A tradução HTTP dos erros deste módulo.
 *
 * Mora aqui e não num route.ts porque o App Router só aceita métodos HTTP e
 * config como exports de rota — um helper exportado de lá quebra o build. Erro
 * nosso NÃO é traduzido: sobe com a pilha para o log, porque um
 * `{"erro":"algo deu errado"}` é um bug que ninguém consegue investigar.
 */
export function respostaDeErro(erro: unknown): Response {
  if (erro instanceof ValidacaoCustoFixo) {
    return Response.json({ erro: erro.message }, { status: erro.status, headers: { "Cache-Control": "no-store" } });
  }
  if (erro instanceof FinanceUnavailableError) {
    return Response.json(
      { erro: "banco financeiro indisponível", motivo: erro.message },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  throw erro;
}

/** O autor sai do Basic Auth. Sem ele, "ligado por" seria uma coluna decorativa. */
export function autorDe(request: Request): string {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("basic ")) return "tela";
  try {
    return Buffer.from(h.slice(6), "base64").toString("utf8").split(":")[0]?.trim() || "tela";
  } catch {
    return "tela";
  }
}

async function entidadeId(c: Cliente): Promise<number> {
  const { rows } = await c.query<{ id: string }>("SELECT id FROM fin_entity WHERE slug = $1", [ENTIDADE]);
  if (!rows.length) throw new ValidacaoCustoFixo(503, `entidade ${ENTIDADE} não existe neste banco`);
  return Number(rows[0].id);
}

async function trilha(
  c: Cliente,
  args: {
    entityId: number;
    recurringId: number;
    action: "insert" | "update";
    antes: unknown;
    depois: unknown;
    campos: string[];
    batchId: string;
    actor: string;
  }
): Promise<void> {
  await c.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
     VALUES ($1, 'fin_recurring', $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7::uuid, $8)`,
    [
      args.entityId,
      args.recurringId,
      args.action,
      JSON.stringify(args.antes ?? null),
      JSON.stringify(args.depois ?? null),
      args.campos,
      args.batchId,
      args.actor
    ]
  );
}

type LinhaCatalogo = {
  id: string;
  label: string;
  status: string;
  amount_cents: string | null;
  category_id: string | null;
  conflito_camada: string | null;
  conflito_motivo: string | null;
};

async function carregar(c: Cliente, id: number, entityId: number): Promise<LinhaCatalogo> {
  const { rows } = await c.query<LinhaCatalogo>(
    `SELECT id, label, status, amount_cents, category_id, conflito_camada, conflito_motivo
       FROM fin_recurring
      WHERE id = $1 AND entity_id = $2 AND direction = 'pagar'
      FOR UPDATE`,
    [id, entityId]
  );
  if (!rows.length) {
    throw new ValidacaoCustoFixo(404, `item ${id} não existe no catálogo de custo (direction='pagar')`);
  }
  return rows[0];
}

/** O primeiro dia do mês corrente em São Paulo — a fronteira do "nunca o passado". */
async function mesCorrente(c: Cliente): Promise<string> {
  const { rows } = await c.query<{ m: string }>(
    `SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date AS m`
  );
  return String(rows[0].m).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Ligar e desligar
// ---------------------------------------------------------------------------

export type MudancaStatus = {
  status: "ativo" | "suspenso" | "encerrado" | "recusado" | "proposto";
  motivo: string | null;
};

const STATUS_VALIDOS = ["ativo", "suspenso", "encerrado", "recusado", "proposto"] as const;

export function mudancaStatusDe(bruto: unknown): MudancaStatus {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const status = String(b.status ?? "");
  if (!(STATUS_VALIDOS as readonly string[]).includes(status)) {
    throw new ValidacaoCustoFixo(400, `status deve ser um de: ${STATUS_VALIDOS.join(", ")}`);
  }
  // Desligar sem motivo apaga a decisão: em três meses ninguém sabe por que
  // aquele fornecedor sumiu da previsão. O CHECK do banco repete a exigência.
  const motivo = texto(b.motivo, "motivo");
  if (status !== "ativo" && status !== "proposto" && !motivo) {
    throw new ValidacaoCustoFixo(422, `desligar exige motivo — sem ele a decisão some e alguém religa em três meses`);
  }
  return { status: status as MudancaStatus["status"], motivo };
}

export async function mudarStatus(
  c: Cliente,
  args: { id: number; mudanca: MudancaStatus; actor: string }
): Promise<{ id: number; de: string; para: string }> {
  const entityId = await entidadeId(c);
  const item = await carregar(c, args.id, entityId);
  const batchId = randomUUID();

  if (args.mudanca.status === "ativo") {
    // As duas recusas legíveis. O banco recusaria as duas de qualquer jeito —
    // por CHECK — mas com um 500 que não diz o que fazer.
    if (item.conflito_camada) {
      throw new ValidacaoCustoFixo(
        409,
        `"${item.label}" não pode ser ligado: ${item.conflito_motivo ?? `colide com a camada ${item.conflito_camada}`}. ` +
          `Ligar aqui contaria o mesmo dinheiro duas vezes.`
      );
    }
    if (item.amount_cents === null) {
      throw new ValidacaoCustoFixo(
        422,
        `"${item.label}" não tem valor. O detector se recusou a inventar um — declare o valor antes de ligar.`
      );
    }
    if (item.category_id === null) {
      throw new ValidacaoCustoFixo(
        422,
        `"${item.label}" não tem categoria, e recorrente ativa sem categoria não entra em orçamento nem em DRE.`
      );
    }
  }

  await c.query(
    `UPDATE fin_recurring
        SET status = $2,
            status_motivo = $3,
            status_alterado_em = now(),
            status_alterado_por = $4
      WHERE id = $1`,
    [args.id, args.mudanca.status, args.mudanca.motivo, args.actor]
  );

  // O histórico do liga/desliga fica na mesma tabela do reajuste, e não só no
  // log: é a coluna que a tela lê para mostrar "desligado em julho porque o
  // contrato acabou" sem consultar auditoria.
  await c.query(
    `INSERT INTO fin_custo_fixo_ajuste
       (entity_id, recurring_id, campo, vigente_de, texto_antes, texto_depois, motivo, fonte, autor)
     VALUES ($1, $2, 'status', $3::date, $4, $5, $6, 'humano', $7)`,
    [
      entityId,
      args.id,
      await mesCorrente(c),
      item.status,
      args.mudanca.status,
      args.mudanca.motivo ?? `ligado por ${args.actor}`,
      args.actor
    ]
  );

  await trilha(c, {
    entityId,
    recurringId: args.id,
    action: "update",
    antes: { status: item.status },
    depois: { status: args.mudanca.status, motivo: args.mudanca.motivo },
    campos: ["status", "status_motivo", "status_alterado_em", "status_alterado_por"],
    batchId,
    actor: args.actor
  });

  return { id: args.id, de: item.status, para: args.mudanca.status };
}

// ---------------------------------------------------------------------------
// Reajustar — registra, não sobrescreve
// ---------------------------------------------------------------------------

export type Reajuste = {
  valorCents: number;
  motivo: string;
  vigenteDe: string | null;
  /** De onde veio o número: o detector sugeriu, um contrato declara, ou alguém digitou. */
  fonte: "humano" | "detector" | "contrato" | "erp_obras";
};

const FONTES = ["humano", "detector", "contrato", "erp_obras"] as const;

export function reajusteDe(bruto: unknown): Reajuste {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const fonte = b.fonte === undefined || b.fonte === null ? "humano" : String(b.fonte);
  if (!(FONTES as readonly string[]).includes(fonte)) {
    throw new ValidacaoCustoFixo(400, `fonte deve ser um de: ${FONTES.join(", ")}`);
  }
  let vigenteDe: string | null = null;
  if (b.vigenteDe !== undefined && b.vigenteDe !== null && b.vigenteDe !== "") {
    const v = String(b.vigenteDe);
    if (!MES_ISO.test(v)) throw new ValidacaoCustoFixo(400, "vigenteDe deve ser YYYY-MM ou YYYY-MM-DD");
    vigenteDe = `${v.slice(0, 7)}-01`;
  }
  return {
    valorCents: centsObrigatorio(b.valorCents, "valorCents"),
    motivo: textoObrigatorio(b.motivo, "motivo"),
    vigenteDe,
    fonte: fonte as Reajuste["fonte"]
  };
}

export async function reajustar(
  c: Cliente,
  args: { id: number; reajuste: Reajuste; actor: string }
): Promise<{ id: number; antesCents: number | null; depoisCents: number; vigenteDe: string }> {
  const entityId = await entidadeId(c);
  const item = await carregar(c, args.id, entityId);
  const batchId = randomUUID();
  const vigenteDe = args.reajuste.vigenteDe ?? (await mesCorrente(c));
  const antes = item.amount_cents === null ? null : Number(item.amount_cents);

  if (antes === args.reajuste.valorCents) {
    throw new ValidacaoCustoFixo(409, `"${item.label}" já vale esse valor — não há reajuste a registrar`);
  }

  // O histórico ANTES do UPDATE. Se o gatilho recusar a vigência retroativa, o
  // valor não chega a ser trocado — e é isso que se quer: a recusa tem de
  // impedir a mudança, não apenas registrar que ela foi indevida.
  await c.query(
    `INSERT INTO fin_custo_fixo_ajuste
       (entity_id, recurring_id, campo, vigente_de, valor_antes_cents, valor_depois_cents, motivo, fonte, autor)
     VALUES ($1, $2, 'valor', $3::date, $4, $5, $6, $7, $8)`,
    [entityId, args.id, vigenteDe, antes, args.reajuste.valorCents, args.reajuste.motivo, args.reajuste.fonte, args.actor]
  );

  await c.query(
    // `amount_basis = 'declarado'` porque o número passou a ser de gente, não do
    // detector. Deixá-lo como 'ultimo_observado' faria a tela dizer que o valor
    // veio de uma medida que já não o produz.
    `UPDATE fin_recurring
        SET amount_cents = $2,
            amount_basis = CASE WHEN $3::text = 'detector' THEN amount_basis ELSE 'declarado' END,
            amount_basis_motivo = CASE WHEN $3::text = 'detector' THEN amount_basis_motivo
                                       ELSE 'valor declarado por ' || $4::text || ': ' || $5::text END,
            revisado_em = now(),
            revisado_por = $4
      WHERE id = $1`,
    [args.id, args.reajuste.valorCents, args.reajuste.fonte, args.actor, args.reajuste.motivo]
  );

  await trilha(c, {
    entityId,
    recurringId: args.id,
    action: "update",
    antes: { amount_cents: antes },
    depois: { amount_cents: args.reajuste.valorCents, vigente_de: vigenteDe, motivo: args.reajuste.motivo },
    campos: ["amount_cents", "amount_basis"],
    batchId,
    actor: args.actor
  });

  return { id: args.id, antesCents: antes, depoisCents: args.reajuste.valorCents, vigenteDe };
}

// ---------------------------------------------------------------------------
// Revisar — o verbo do pedido ("o usuário vai revisar")
// ---------------------------------------------------------------------------

/**
 * Marca a linha como olhada, sem mudar nada nela.
 *
 * Existe porque "revisei e está certo" é uma decisão, e sem ela a fila de
 * revisão nunca esvazia: o item correto ficaria para sempre indistinguível do
 * item que ninguém abriu.
 */
export async function marcarRevisado(
  c: Cliente,
  args: { id: number; actor: string; nota?: string | null }
): Promise<{ id: number; revisadoEm: string }> {
  const entityId = await entidadeId(c);
  await carregar(c, args.id, entityId);
  const nota = texto(args.nota, "nota");

  const { rows } = await c.query<{ revisado_em: string }>(
    `UPDATE fin_recurring
        SET revisado_em = now(),
            revisado_por = $2,
            notes = COALESCE($3, notes)
      WHERE id = $1
      RETURNING revisado_em`,
    [args.id, args.actor, nota]
  );

  await trilha(c, {
    entityId,
    recurringId: args.id,
    action: "update",
    antes: null,
    depois: { revisado_por: args.actor },
    campos: ["revisado_em", "revisado_por"],
    batchId: randomUUID(),
    actor: args.actor
  });

  return { id: args.id, revisadoEm: String(rows[0].revisado_em) };
}

// ---------------------------------------------------------------------------
// Adotar um candidato — o grupo detectado que ainda não tem linha
// ---------------------------------------------------------------------------

export type Adocao = {
  counterpartyId: number;
  categoryId: number;
  /** Ausente usa o valor sugerido pelo detector. Presente é declaração humana. */
  valorCents: number | null;
  label: string | null;
};

export function adocaoDe(bruto: unknown): Adocao {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const counterpartyId = Number(b.counterparteId ?? b.counterpartyId);
  const categoryId = Number(b.categoriaId ?? b.categoryId);
  if (!Number.isSafeInteger(counterpartyId) || counterpartyId <= 0) {
    throw new ValidacaoCustoFixo(400, "counterparteId inválido");
  }
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    throw new ValidacaoCustoFixo(400, "categoriaId inválido");
  }
  return {
    counterpartyId,
    categoryId,
    valorCents: b.valorCents === undefined || b.valorCents === null ? null : centsObrigatorio(b.valorCents, "valorCents"),
    label: texto(b.label, "label", 200)
  };
}

/**
 * Traz um grupo detectado para o catálogo, como PROPOSTO.
 *
 * Nasce proposto e não ativo, pelo mesmo motivo da semeadura da 0108: adotar é
 * dizer "isto merece existir no catálogo", não "isto entra no meu saldo". Ligar
 * é o passo seguinte, e é outro ato.
 */
export async function adotarCandidato(
  c: Cliente,
  args: { adocao: Adocao; actor: string }
): Promise<{ id: number; label: string; valorCents: number | null }> {
  const entityId = await entidadeId(c);
  const a = args.adocao;

  const { rows: existente } = await c.query<{ id: string }>(
    `SELECT id FROM fin_recurring
      WHERE entity_id = $1 AND direction = 'pagar' AND counterparty_id = $2 AND category_id = $3`,
    [entityId, a.counterpartyId, a.categoryId]
  );
  if (existente.length) {
    throw new ValidacaoCustoFixo(409, `este grupo já está no catálogo (item ${existente[0].id})`);
  }

  const { rows } = await c.query<{ id: string; label: string; amount_cents: string | null }>(
    `INSERT INTO fin_recurring (
       entity_id, label, direction, counterparty_id, category_id,
       cadence, day_of_month, due_day_rule, start_month,
       amount_cents, amount_basis, amount_basis_motivo, amount_basis_erro_pct,
       natureza_custo, confidence, status, conflito_camada, conflito_motivo,
       ocorrencias, span_meses, densidade, dispersao, day_concentration,
       amostra_de, amostra_ate, last_seen_on,
       source, source_id, detector_versao, detectado_em, created_by)
     SELECT
       d.entity_id,
       COALESCE($4::text, d.contraparte || ' — ' || d.categoria),
       'pagar', d.counterparty_id, d.category_id,
       'mensal', d.dia_do_mes, 'exato', d.primeira_competencia,
       COALESCE($5::bigint, d.valor_sugerido_cents),
       CASE WHEN $5::bigint IS NOT NULL THEN 'declarado'
            WHEN d.familia_valor = 'estavel'            THEN 'moda_observada'
            WHEN d.familia_valor = 'varia_um_pagamento' THEN 'ultimo_observado'
            ELSE 'mediana_3m' END,
       CASE WHEN $5::bigint IS NOT NULL THEN 'valor declarado por ' || $6::text ELSE d.criterio_motivo END,
       CASE WHEN $5::bigint IS NOT NULL THEN NULL ELSE d.criterio_erro_pct END,
       d.natureza_custo, d.confianca, 'proposto', d.conflito_camada, d.conflito_motivo,
       d.ocorrencias, GREATEST(d.span_meses, 3), d.densidade, COALESCE(d.dispersao, 0),
       GREATEST(0, 1 - LEAST(d.dia_amplitude, 15)::numeric / 15)::numeric(4,3),
       d.primeira_competencia, d.ultima_competencia, d.ultima_competencia,
       'deteccao_historico', 'catalogo-v2:' || d.counterparty_id || ':' || d.category_id,
       'catalogo-v2-2026-08-17', now(), $6
     FROM fin_custo_fixo_deteccao_v d
    WHERE d.entity_id = $1 AND d.counterparty_id = $2 AND d.category_id = $3
    RETURNING id, label, amount_cents`,
    [entityId, a.counterpartyId, a.categoryId, a.label, a.valorCents, args.actor]
  );

  if (!rows.length) {
    throw new ValidacaoCustoFixo(
      404,
      `nenhum grupo detectado para (contraparte ${a.counterpartyId}, categoria ${a.categoryId}) — ` +
        `o detector exige 3 ocorrências nos 12 meses fechados, e duas ocorrências são duas coincidências`
    );
  }

  const id = Number(rows[0].id);
  await trilha(c, {
    entityId,
    recurringId: id,
    action: "insert",
    antes: null,
    depois: { counterparty_id: a.counterpartyId, category_id: a.categoryId, status: "proposto" },
    campos: ["counterparty_id", "category_id", "status"],
    batchId: randomUUID(),
    actor: args.actor
  });

  return {
    id,
    label: String(rows[0].label),
    valorCents: rows[0].amount_cents === null ? null : Number(rows[0].amount_cents)
  };
}
