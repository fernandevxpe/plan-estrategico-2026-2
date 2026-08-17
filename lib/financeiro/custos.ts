import "server-only";

import { randomUUID } from "node:crypto";

import type pg from "pg";

import { FinanceUnavailableError } from "./db";

/**
 * As escritas sobre `fin_custo_previsto` — confirmar, criar, editar, ignorar.
 *
 * Vive aqui e não nas rotas pelo mesmo motivo de `lib/financeiro/revisao.ts`:
 * a mesma operação é chamada de três lugares (item, lote, e o materializar que
 * antecede a confirmação em lote), e três cópias divergem exatamente na regra
 * que ninguém releu.
 *
 * AS QUATRO REGRAS QUE ESTE MÓDULO SUSTENTA
 *
 * 1. MATERIALIZAR É NEUTRO. Criar o item derivado a partir da projeção não
 *    muda o total do mês: `fin_custo_previsto_consolidado_v` cala a projeção
 *    correspondente e o item herda a somabilidade dela. Quem move o número é a
 *    confirmação, que tem autor, hora e valor.
 *
 * 2. CONFIRMAR NÃO É REALIZAR. Nada aqui escreve `estado = 'realizado'` por
 *    dedução. O estado realizado exige `realizado_transaction_id`, e o gatilho
 *    do banco recusa qualquer outra coisa. Item confirmado continua sendo
 *    previsão até o dinheiro sair do extrato.
 *
 * 3. DERIVADO NÃO SE APAGA. `apagarItem` só aceita item `manual` e nunca
 *    `realizado` — e o gatilho `fin_custo_previsto_apagar_trg` repete a regra
 *    no banco, para o caso de alguém escrever um DELETE por fora daqui. O que
 *    se faz com derivado indesejado é `ignorar`, com motivo.
 *
 * 4. VALOR AUSENTE EXIGE MOTIVO. Um item pode nascer sem valor — e aí carrega
 *    `indeterminadoMotivo` e não entra em soma nenhuma. Um número plausível
 *    seria pior que o vazio, porque o vazio se vê.
 *
 * Nenhuma função deste módulo toca `fin_transaction`. A única leitura que ela
 * faz do ledger é conferir que o lançamento apontado por um `realizar` existe —
 * e essa conferência é do gatilho, não daqui.
 */

const ENTIDADE = "xpe";

export class ValidacaoCusto extends Error {
  constructor(
    readonly status: number,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ValidacaoCusto";
  }
}

type Cliente = pg.PoolClient | pg.Client;

// ---------------------------------------------------------------------------
// Validação de entrada — a fronteira, e ela é estreita de propósito
// ---------------------------------------------------------------------------

const MES_ISO = /^\d{4}-\d{2}(-\d{2})?$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM` ou `YYYY-MM-DD` → sempre `YYYY-MM-01`, que é a chave das views mensais. */
export function competenciaDe(bruto: unknown, campo = "competencia"): string {
  if (typeof bruto !== "string" || !MES_ISO.test(bruto)) {
    throw new ValidacaoCusto(400, `${campo} deve ser YYYY-MM ou YYYY-MM-DD`);
  }
  return `${bruto.slice(0, 7)}-01`;
}

function dataOpcional(bruto: unknown, campo: string): string | null {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  if (typeof bruto !== "string" || !DATA_ISO.test(bruto)) {
    throw new ValidacaoCusto(400, `${campo} deve ser uma data ISO (YYYY-MM-DD)`);
  }
  return bruto;
}

function centsOpcional(bruto: unknown, campo: string): number | null {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const n = Number(bruto);
  // Centavo é inteiro. Aceitar 1234.5 aqui deixaria o Postgres arredondar em
  // silêncio, e meio centavo repetido mil vezes é dinheiro.
  if (!Number.isSafeInteger(n)) throw new ValidacaoCusto(400, `${campo} deve ser inteiro em centavos`);
  if (n < 0) throw new ValidacaoCusto(400, `${campo} não pode ser negativo — custo previsto é módulo, não sinal`);
  return n;
}

function textoOpcional(bruto: unknown, campo: string, maximo = 400): string | null {
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto !== "string") throw new ValidacaoCusto(400, `${campo} deve ser texto`);
  const limpo = bruto.trim();
  if (!limpo) return null;
  if (limpo.length > maximo) throw new ValidacaoCusto(400, `${campo} excede ${maximo} caracteres`);
  return limpo;
}

/**
 * A tradução HTTP dos erros deste módulo.
 *
 * Mora aqui e não num route.ts porque o App Router só aceita métodos HTTP e
 * config como exports de rota — um helper exportado de lá quebra o build. As
 * quatro rotas de custo usam esta função, e por isso respondem igual.
 *
 * Erro nosso NÃO é traduzido: ele sobe com a pilha para o log. Um
 * `{"erro":"algo deu errado"}` seria um bug que ninguém consegue investigar.
 */
export function respostaDeErro(erro: unknown): Response {
  if (erro instanceof ValidacaoCusto) {
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

/** O autor sai do Basic Auth. Sem ele, "confirmado por" seria uma coluna decorativa. */
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
  if (!rows.length) throw new ValidacaoCusto(503, `entidade ${ENTIDADE} não existe neste banco`);
  return Number(rows[0].id);
}

async function trilha(
  c: Cliente,
  args: {
    entityId: number;
    itemId: number;
    action: "insert" | "update" | "delete" | "bulk_update";
    antes: unknown;
    depois: unknown;
    campos: string[];
    batchId: string;
    actor: string;
  }
): Promise<void> {
  await c.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
     VALUES ($1, 'fin_custo_previsto', $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7::uuid, $8)`,
    [
      args.entityId,
      args.itemId,
      args.action,
      JSON.stringify(args.antes ?? null),
      JSON.stringify(args.depois ?? null),
      args.campos,
      args.batchId,
      args.actor
    ]
  );
}

// ---------------------------------------------------------------------------
// Materializar um derivado — o passo que precede confirmar
// ---------------------------------------------------------------------------

export type Materializacao = { id: number; criado: boolean };

/**
 * Traz uma linha da projeção para a tabela, pelo valor de face.
 *
 * Idempotente pela chave `(entity_id, competencia, origem_ref)`: chamar duas
 * vezes devolve o mesmo id com `criado: false`. Sem isso, dois cliques no botão
 * de confirmar criariam dois itens para a mesma projeção — que é a dupla
 * contagem nascendo dentro da tabela feita para evitá-la. O índice único do
 * banco recusaria o segundo, mas com um 500 em vez de uma resposta.
 */
export async function materializarDerivado(
  c: Cliente,
  args: { entityId: number; competencia: string; origemRef: string; actor: string; batchId: string }
): Promise<Materializacao> {
  const { rows: existente } = await c.query<{ id: string }>(
    `SELECT id FROM fin_custo_previsto
      WHERE entity_id = $1 AND competencia = $2::date AND origem_ref = $3`,
    [args.entityId, args.competencia, args.origemRef]
  );
  if (existente.length) return { id: Number(existente[0].id), criado: false };

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO fin_custo_previsto
       (entity_id, origem, origem_ref, origem_camada, recurring_id, document_id, person_id,
        competencia, descricao, category_id, nucleo, cost_center_id, counterparty_id,
        dia_esperado, dia_regra, valor_previsto_cents, created_by)
     SELECT d.entity_id, 'derivado', d.origem_ref, d.origem_camada,
            d.recurring_id, d.document_id, d.person_id,
            d.competencia, d.descricao, d.category_id, d.nucleo, d.cost_center_id,
            d.counterparty_id, d.dia_esperado, d.dia_regra, d.valor_projetado_cents, $4
       FROM fin_custo_previsto_derivado_v d
      WHERE d.entity_id = $1 AND d.competencia = $2::date AND d.origem_ref = $3
     RETURNING id`,
    [args.entityId, args.competencia, args.origemRef, args.actor]
  );
  if (!rows.length) {
    throw new ValidacaoCusto(
      404,
      `a projeção "${args.origemRef}" não existe em ${args.competencia.slice(0, 7)} — ` +
        `o horizonte de fin_previsao_evento_v não a alcança, ou ela já saiu (foi paga, cancelada ou encerrada)`
    );
  }
  const id = Number(rows[0].id);
  await trilha(c, {
    entityId: args.entityId,
    itemId: id,
    action: "insert",
    antes: null,
    depois: { origem: "derivado", origem_ref: args.origemRef, competencia: args.competencia },
    campos: ["origem_ref"],
    batchId: args.batchId,
    actor: args.actor
  });
  return { id, criado: true };
}

// ---------------------------------------------------------------------------
// Confirmar — individual e em lote
// ---------------------------------------------------------------------------

export type AlvoConfirmacao =
  | { id: number; valorCents?: number | null }
  | { competencia: string; origemRef: string; valorCents?: number | null };

export type ResultadoConfirmacao = {
  batchId: string;
  confirmados: number;
  materializados: number;
  valorPrevistoCents: number;
  valorConfirmadoCents: number;
  ajusteCents: number;
  itens: { id: number; descricao: string; previstoCents: number | null; confirmadoCents: number }[];
  naoEncontrados: (number | string)[];
};

const LOTE_MAXIMO = 200;

/** Normaliza o corpo da rota em alvos tipados, recusando o malformado antes de abrir escrita. */
export function alvosDe(bruto: unknown): AlvoConfirmacao[] {
  const lista = Array.isArray(bruto) ? bruto : bruto === undefined ? [] : [bruto];
  if (!lista.length) throw new ValidacaoCusto(400, "informe ao menos um item para confirmar");
  if (lista.length > LOTE_MAXIMO) {
    throw new ValidacaoCusto(400, `lote acima de ${LOTE_MAXIMO} itens — divida em chamadas menores`);
  }
  return lista.map((bruta) => {
    const a = bruta as Record<string, unknown>;
    const valorCents = centsOpcional(a.valorCents, "valorCents");
    if (a.id !== undefined && a.id !== null) {
      const id = Number(a.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new ValidacaoCusto(400, "id inválido");
      return { id, valorCents };
    }
    if (typeof a.origemRef === "string" && a.origemRef.trim()) {
      return {
        competencia: competenciaDe(a.competencia),
        origemRef: a.origemRef.trim(),
        valorCents
      };
    }
    throw new ValidacaoCusto(400, "cada alvo precisa de {id} ou de {competencia, origemRef}");
  });
}

/**
 * Confirma N itens numa transação só.
 *
 * `batchId` compartilhado no `fin_audit_log` é o que torna o lote desfazível com
 * um clique — sem ele, confirmar 30 linhas viraria 30 decisões avulsas e o
 * desfazer viraria arqueologia. É o mesmo padrão de `revisao/lote`.
 *
 * `valorCents` ausente confirma pelo valor previsto. Presente, ele é o ajuste —
 * e a diferença fica medida em `ajusteCents`, que é o único número desta base
 * que afere a previsão de saída item a item.
 */
export async function confirmarItens(
  c: Cliente,
  args: { alvos: AlvoConfirmacao[]; actor: string; nota?: string | null }
): Promise<ResultadoConfirmacao> {
  const entityId = await entidadeId(c);
  const batchId = randomUUID();
  const nota = textoOpcional(args.nota, "nota");

  const resultado: ResultadoConfirmacao = {
    batchId,
    confirmados: 0,
    materializados: 0,
    valorPrevistoCents: 0,
    valorConfirmadoCents: 0,
    ajusteCents: 0,
    itens: [],
    naoEncontrados: []
  };

  for (const alvo of args.alvos) {
    let id: number;
    if ("id" in alvo) {
      id = alvo.id;
    } else {
      const m = await materializarDerivado(c, {
        entityId,
        competencia: alvo.competencia,
        origemRef: alvo.origemRef,
        actor: args.actor,
        batchId
      });
      id = m.id;
      if (m.criado) resultado.materializados += 1;
    }

    const { rows: antes } = await c.query<{
      id: string;
      descricao: string;
      estado: string;
      valor_previsto_cents: string | null;
      valor_confirmado_cents: string | null;
      indeterminado_motivo: string | null;
    }>(
      `SELECT id, descricao, estado, valor_previsto_cents, valor_confirmado_cents, indeterminado_motivo
         FROM fin_custo_previsto WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
      [id, entityId]
    );
    if (!antes.length) {
      resultado.naoEncontrados.push(id);
      continue;
    }
    const item = antes[0];

    if (item.estado === "realizado") {
      throw new ValidacaoCusto(409, `item ${id} já está realizado — confirmar de novo não faz sentido`);
    }
    if (item.estado === "ignorado") {
      throw new ValidacaoCusto(409, `item ${id} está ignorado; reative-o antes de confirmar`);
    }

    const previsto = item.valor_previsto_cents === null ? null : Number(item.valor_previsto_cents);
    const pedido = alvo.valorCents ?? null;
    const confirmado = pedido ?? previsto;
    if (confirmado === null) {
      throw new ValidacaoCusto(
        422,
        `item ${id} não tem valor previsto (${item.indeterminado_motivo ?? "motivo não declarado"}) — ` +
          `confirme informando valorCents, porque confirmar sem número seria inventar um`
      );
    }

    await c.query(
      `UPDATE fin_custo_previsto
          SET estado = 'confirmado',
              valor_confirmado_cents = $2,
              confirmado_por = $3,
              confirmado_em  = now(),
              confirmacao_nota = COALESCE($4, confirmacao_nota)
        WHERE id = $1`,
      [id, confirmado, args.actor, nota]
    );

    await trilha(c, {
      entityId,
      itemId: id,
      action: args.alvos.length > 1 ? "bulk_update" : "update",
      antes: { estado: item.estado, valor_confirmado_cents: item.valor_confirmado_cents },
      depois: { estado: "confirmado", valor_confirmado_cents: confirmado, previsto },
      campos: ["estado", "valor_confirmado_cents", "confirmado_por", "confirmado_em"],
      batchId,
      actor: args.actor
    });

    resultado.confirmados += 1;
    resultado.valorPrevistoCents += previsto ?? 0;
    resultado.valorConfirmadoCents += confirmado;
    resultado.itens.push({ id, descricao: item.descricao, previstoCents: previsto, confirmadoCents: confirmado });
  }

  resultado.ajusteCents = resultado.valorConfirmadoCents - resultado.valorPrevistoCents;
  return resultado;
}

// ---------------------------------------------------------------------------
// Criar item manual — por onde a lacuna de cobertura se fecha
// ---------------------------------------------------------------------------

export type ItemManual = {
  competencia: string;
  descricao: string;
  valorCents: number | null;
  indeterminadoMotivo: string | null;
  categoria: string | null;
  nucleo: string | null;
  centroDeCusto: number | null;
  contraparte: number | null;
  diaEsperado: string | null;
  confirmar: boolean;
};

export function itemManualDe(corpo: unknown): ItemManual {
  const b = (corpo ?? {}) as Record<string, unknown>;
  const descricao = textoOpcional(b.descricao, "descricao", 200);
  if (!descricao) throw new ValidacaoCusto(400, "descricao é obrigatória — item sem nome é item que ninguém revisa");

  const valorCents = centsOpcional(b.valorCents, "valorCents");
  const indeterminadoMotivo = textoOpcional(b.indeterminadoMotivo, "indeterminadoMotivo");
  // A restrição nº 5 do projeto, na fronteira HTTP: onde não houver evidência,
  // o valor é indeterminado COM MOTIVO. O CHECK do banco repete; aqui a
  // mensagem é legível para quem está na tela.
  if (valorCents === null && !indeterminadoMotivo) {
    throw new ValidacaoCusto(422, "sem valorCents é obrigatório declarar indeterminadoMotivo");
  }
  if (valorCents !== null && valorCents === 0) {
    throw new ValidacaoCusto(422, "valorCents zero não é custo previsto — use indeterminadoMotivo se não souber");
  }

  return {
    competencia: competenciaDe(b.competencia),
    descricao,
    valorCents,
    indeterminadoMotivo,
    categoria: textoOpcional(b.categoria, "categoria", 20),
    nucleo: textoOpcional(b.nucleo, "nucleo", 40),
    centroDeCusto: b.centroDeCusto === undefined || b.centroDeCusto === null ? null : Number(b.centroDeCusto),
    contraparte: b.contraparte === undefined || b.contraparte === null ? null : Number(b.contraparte),
    diaEsperado: dataOpcional(b.diaEsperado, "diaEsperado"),
    confirmar: Boolean(b.confirmar)
  };
}

export async function criarItemManual(
  c: Cliente,
  args: { item: ItemManual; actor: string }
): Promise<{ id: number; batchId: string; estado: string }> {
  const entityId = await entidadeId(c);
  const batchId = randomUUID();
  const i = args.item;

  const categoryId = i.categoria ? await resolverCategoria(c, entityId, i.categoria) : null;
  if (i.nucleo) await conferirNucleo(c, i.nucleo);

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO fin_custo_previsto
       (entity_id, origem, competencia, descricao, category_id, nucleo, cost_center_id,
        counterparty_id, dia_esperado, valor_previsto_cents, indeterminado_motivo,
        estado, valor_confirmado_cents, confirmado_por, confirmado_em, created_by)
     VALUES ($1, 'manual', $2::date, $3, $4, $5, $6, $7, $8::date, $9, $10,
             CASE WHEN $11::boolean AND $9::bigint IS NOT NULL THEN 'confirmado' ELSE 'previsto' END,
             CASE WHEN $11::boolean AND $9::bigint IS NOT NULL THEN $9::bigint END,
             CASE WHEN $11::boolean AND $9::bigint IS NOT NULL THEN $12::text END,
             CASE WHEN $11::boolean AND $9::bigint IS NOT NULL THEN now() END,
             $12)
     RETURNING id, estado`,
    [
      entityId,
      i.competencia,
      i.descricao,
      categoryId,
      i.nucleo,
      i.centroDeCusto,
      i.contraparte,
      i.diaEsperado,
      i.valorCents,
      i.indeterminadoMotivo,
      i.confirmar,
      args.actor
    ]
  );

  const id = Number(rows[0].id);
  await trilha(c, {
    entityId,
    itemId: id,
    action: "insert",
    antes: null,
    depois: { origem: "manual", competencia: i.competencia, valor_previsto_cents: i.valorCents },
    campos: ["origem", "competencia", "valor_previsto_cents"],
    batchId,
    actor: args.actor
  });

  return { id, batchId, estado: String((rows[0] as unknown as { estado: string }).estado) };
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

/**
 * Os campos que o PATCH aceita, e por que a lista é curta.
 *
 * `origem`, `origem_ref`, `competencia` e `entity_id` NÃO são editáveis. Mudar
 * `origem_ref` faria o item calar uma projeção que não o originou — a dupla
 * contagem ao contrário: dinheiro real desaparecendo do mês. Mudar a
 * competência moveria o custo de mês sem trilha de que mês ele veio. Quem
 * precisa disso ignora o item e cria outro; as duas decisões ficam registradas.
 *
 * `estado` também não: para confirmar existe a rota de confirmar, para ignorar
 * existe `ignorar`. Um PATCH genérico em `estado` seria o caminho por onde
 * `realizado` entraria sem lançamento.
 */
const CAMPOS_EDITAVEIS = [
  "descricao",
  "valorCents",
  "indeterminadoMotivo",
  "categoria",
  "nucleo",
  "centroDeCusto",
  "contraparte",
  "diaEsperado",
  "ignorar",
  "reativar"
] as const;

export async function editarItem(
  c: Cliente,
  args: { id: number; patch: Record<string, unknown>; actor: string }
): Promise<{ id: number; alterados: string[]; estado: string }> {
  const entityId = await entidadeId(c);
  const desconhecidos = Object.keys(args.patch).filter(
    (k) => !(CAMPOS_EDITAVEIS as readonly string[]).includes(k)
  );
  if (desconhecidos.length) {
    throw new ValidacaoCusto(
      400,
      `campo(s) não editável(is): ${desconhecidos.join(", ")}. Editáveis: ${CAMPOS_EDITAVEIS.join(", ")}`
    );
  }

  const { rows: antes } = await c.query<Record<string, unknown>>(
    `SELECT * FROM fin_custo_previsto WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
    [args.id, entityId]
  );
  if (!antes.length) throw new ValidacaoCusto(404, `item ${args.id} não existe`);
  const atual = antes[0];

  if (atual.estado === "realizado") {
    throw new ValidacaoCusto(409, `item ${args.id} está realizado — o lançamento já existe e a previsão está fechada`);
  }

  const set: string[] = [];
  const params: unknown[] = [args.id];
  const alterados: string[] = [];
  const empurra = (coluna: string, valor: unknown, campo: string) => {
    params.push(valor);
    set.push(`${coluna} = $${params.length}`);
    alterados.push(campo);
  };

  const p = args.patch;
  if ("descricao" in p) {
    const d = textoOpcional(p.descricao, "descricao", 200);
    if (!d) throw new ValidacaoCusto(400, "descricao não pode ficar vazia");
    empurra("descricao", d, "descricao");
  }
  if ("valorCents" in p) empurra("valor_previsto_cents", centsOpcional(p.valorCents, "valorCents"), "valorCents");
  if ("indeterminadoMotivo" in p) {
    empurra("indeterminado_motivo", textoOpcional(p.indeterminadoMotivo, "indeterminadoMotivo"), "indeterminadoMotivo");
  }
  if ("categoria" in p) {
    const codigo = textoOpcional(p.categoria, "categoria", 20);
    empurra("category_id", codigo ? await resolverCategoria(c, entityId, codigo) : null, "categoria");
  }
  if ("nucleo" in p) {
    const n = textoOpcional(p.nucleo, "nucleo", 40);
    if (n) await conferirNucleo(c, n);
    empurra("nucleo", n, "nucleo");
  }
  if ("centroDeCusto" in p) {
    empurra("cost_center_id", p.centroDeCusto === null ? null : Number(p.centroDeCusto), "centroDeCusto");
  }
  if ("contraparte" in p) {
    empurra("counterparty_id", p.contraparte === null ? null : Number(p.contraparte), "contraparte");
  }
  if ("diaEsperado" in p) empurra("dia_esperado", dataOpcional(p.diaEsperado, "diaEsperado"), "diaEsperado");

  // Ignorar é o "apagar" do item derivado: tira do total, mantém a decisão à
  // vista. O motivo é obrigatório, aqui e no CHECK do banco.
  if (p.ignorar !== undefined && p.ignorar !== null && p.ignorar !== false) {
    const motivo = textoOpcional(p.ignorar, "ignorar");
    if (!motivo) throw new ValidacaoCusto(422, "ignorar exige o motivo como texto: {\"ignorar\": \"por quê\"}");
    empurra("ignorado_motivo", motivo, "ignorar");
    set.push("estado = 'ignorado'");
  }
  if (p.reativar === true) {
    if (atual.estado !== "ignorado") throw new ValidacaoCusto(409, `item ${args.id} não está ignorado`);
    set.push("estado = 'previsto'", "ignorado_motivo = NULL");
    alterados.push("reativar");
  }

  if (!set.length) throw new ValidacaoCusto(400, "nada a alterar");

  const { rows: depois } = await c.query<{ estado: string }>(
    `UPDATE fin_custo_previsto SET ${set.join(", ")} WHERE id = $1 RETURNING estado`,
    params
  );

  await trilha(c, {
    entityId,
    itemId: args.id,
    action: "update",
    antes: recorte(atual, alterados),
    depois: { alterados },
    campos: alterados,
    batchId: randomUUID(),
    actor: args.actor
  });

  return { id: args.id, alterados, estado: depois[0].estado };
}

/** Só o que mudou entra na trilha: gravar a linha inteira faria o log crescer sem informar mais. */
function recorte(linha: Record<string, unknown>, campos: string[]): Record<string, unknown> {
  const mapa: Record<string, string> = {
    valorCents: "valor_previsto_cents",
    indeterminadoMotivo: "indeterminado_motivo",
    categoria: "category_id",
    centroDeCusto: "cost_center_id",
    contraparte: "counterparty_id",
    diaEsperado: "dia_esperado",
    ignorar: "estado",
    reativar: "estado"
  };
  const saida: Record<string, unknown> = {};
  for (const campo of campos) {
    const coluna = mapa[campo] ?? campo;
    saida[coluna] = linha[coluna] ?? null;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Apagar — o único caso permitido
// ---------------------------------------------------------------------------

export async function apagarItem(
  c: Cliente,
  args: { id: number; actor: string }
): Promise<{ id: number; descricao: string; valorCents: number | null }> {
  const entityId = await entidadeId(c);
  const { rows } = await c.query<{
    id: string;
    origem: string;
    estado: string;
    descricao: string;
    valor_previsto_cents: string | null;
  }>(`SELECT id, origem, estado, descricao, valor_previsto_cents
        FROM fin_custo_previsto WHERE id = $1 AND entity_id = $2 FOR UPDATE`, [args.id, entityId]);
  if (!rows.length) throw new ValidacaoCusto(404, `item ${args.id} não existe`);
  const item = rows[0];

  if (item.origem === "derivado") {
    throw new ValidacaoCusto(
      409,
      `item ${args.id} é derivado e não se apaga: ele voltaria na próxima leitura da projeção, ` +
        `e o apagamento teria destruído a nota de quem decidiu tirá-lo. Use PATCH {"ignorar": "motivo"}.`
    );
  }
  if (item.estado === "realizado") {
    throw new ValidacaoCusto(409, `item ${args.id} está realizado — apagar esconderia dinheiro que já saiu`);
  }

  // A trilha ANTES do DELETE: depois dela o id não existe mais para ser referido.
  await trilha(c, {
    entityId,
    itemId: args.id,
    action: "delete",
    antes: { origem: item.origem, estado: item.estado, descricao: item.descricao, valor: item.valor_previsto_cents },
    depois: null,
    campos: ["*"],
    batchId: randomUUID(),
    actor: args.actor
  });

  await c.query("DELETE FROM fin_custo_previsto WHERE id = $1", [args.id]);
  return {
    id: args.id,
    descricao: item.descricao,
    valorCents: item.valor_previsto_cents === null ? null : Number(item.valor_previsto_cents)
  };
}

// ---------------------------------------------------------------------------
// Resolvedores
// ---------------------------------------------------------------------------

async function resolverCategoria(c: Cliente, entityId: number, codigo: string): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    "SELECT id FROM fin_category WHERE entity_id = $1 AND code = $2",
    [entityId, codigo]
  );
  if (!rows.length) throw new ValidacaoCusto(422, `categoria ${codigo} não existe no plano de contas`);
  return Number(rows[0].id);
}

async function conferirNucleo(c: Cliente, slug: string): Promise<void> {
  const { rows } = await c.query("SELECT 1 FROM fin_nucleo WHERE slug = $1", [slug]);
  if (!rows.length) throw new ValidacaoCusto(422, `núcleo ${slug} não existe`);
}
