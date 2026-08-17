import "server-only";

import { randomUUID } from "node:crypto";

import type pg from "pg";

import {
  autorDe,
  competenciaDe,
  confirmarItens as confirmarCustos,
  criarItemManual as criarCustoManual,
  editarItem as editarCusto,
  itemManualDe as custoManualDe,
  materializarDerivado as materializarCusto,
  respostaDeErro,
  ValidacaoCusto,
  type AlvoConfirmacao
} from "./custos";

/**
 * A escrita da agenda diária.
 *
 * ---------------------------------------------------------------------------
 * A FRONTEIRA COM A FRENTE 0100, E POR QUE ELA É ASSIM
 * ---------------------------------------------------------------------------
 * `fin_custo_previsto` (migration 0100) é a dona do item de custo editável.
 * Este módulo NÃO cria um segundo modelo para ele: as ações de saída da agenda
 * — materializar, confirmar, ajustar, ignorar, criar do zero — são delegadas
 * às funções de `lib/financeiro/custos.ts`, tal como estão.
 *
 * O que faltava era o outro lado. Do lado da ENTRADA não havia item nenhum
 * sobre o qual agir: dava para ver a projeção de recebimento e não dava para
 * corrigi-la. `fin_receita_prevista` (migration 0104) é o espelho exato de
 * `fin_custo_previsto`, e as funções abaixo são o espelho exato das de lá.
 *
 * A tela chama UMA rota e passa a direção; o despacho acontece aqui. Duas
 * rotas para a mesma ação humana ("este item está errado, corrija") seria a
 * fronteira interna do backend vazando para a UX.
 *
 * ---------------------------------------------------------------------------
 * O QUE NENHUMA FUNÇÃO DESTE ARQUIVO FAZ
 * ---------------------------------------------------------------------------
 * · Não escreve em `fin_transaction`. Previsto nunca vira realizado: o estado
 *   'realizado' exige o lançamento, e o gatilho do banco confere o SINAL dele
 *   (crédito realiza receita, débito realiza custo — nunca ao contrário).
 * · Não cria `fin_document`. Uma receita que ninguém emitiu não é cobrança:
 *   gravá-la lá a faria contar como faturamento no aging e na curva ABC.
 * · Não altera saldo de conta nenhuma. Item previsto é previsão.
 * · Não apaga item derivado. Ele voltaria na próxima leitura da projeção, e o
 *   apagamento teria destruído a única coisa que produziu — a nota de quem
 *   decidiu tirá-lo. O caminho é ignorar com motivo, que é reversível.
 */

const ENTIDADE = "xpe";

type Cliente = pg.PoolClient | pg.Client;

export type Direcao = "receber" | "pagar";

export { autorDe, respostaDeErro, ValidacaoCusto as ValidacaoAgenda };

// ---------------------------------------------------------------------------
// Validação — a fronteira, estreita de propósito
// ---------------------------------------------------------------------------

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function direcaoDe(bruto: unknown, campo = "direcao"): Direcao {
  if (bruto === "receber" || bruto === "pagar") return bruto;
  throw new ValidacaoCusto(400, `${campo} deve ser "receber" ou "pagar"`);
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
  // Centavo é inteiro. Aceitar 1234.5 deixaria o Postgres arredondar em
  // silêncio, e meio centavo repetido mil vezes é dinheiro.
  if (!Number.isSafeInteger(n)) throw new ValidacaoCusto(400, `${campo} deve ser inteiro em centavos`);
  if (n < 0) throw new ValidacaoCusto(400, `${campo} não pode ser negativo — valor previsto é módulo, não sinal`);
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
     VALUES ($1, 'fin_receita_prevista', $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7::uuid, $8)`,
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

// ---------------------------------------------------------------------------
// Materializar uma projeção de entrada
// ---------------------------------------------------------------------------

export type Materializacao = { id: number; criado: boolean };

/**
 * Traz uma linha da projeção de entrada para a tabela, pelo valor de face.
 *
 * Idempotente pela chave `(entity_id, competencia, origem_ref)`: chamar duas
 * vezes devolve o mesmo id com `criado: false`. Sem isso, dois cliques no botão
 * criariam dois itens para a mesma projeção — a dupla contagem nascendo dentro
 * da tabela feita para evitá-la.
 *
 * MATERIALIZAR NÃO MUDA O TOTAL DO MÊS. O item derivado ainda em 'previsto'
 * herda o `entra_no_saldo` da projeção que o originou, e a projeção cala. Só
 * confirmar — que tem autor, hora e valor — move o número.
 */
export async function materializarEntrada(
  c: Cliente,
  args: { entityId: number; competencia: string; origemRef: string; actor: string; batchId: string }
): Promise<Materializacao> {
  const { rows: existente } = await c.query<{ id: string }>(
    `SELECT id FROM fin_receita_prevista
      WHERE entity_id = $1 AND competencia = $2::date AND origem_ref = $3`,
    [args.entityId, args.competencia, args.origemRef]
  );
  if (existente.length) return { id: Number(existente[0].id), criado: false };

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO fin_receita_prevista
       (entity_id, origem, origem_ref, origem_camada, document_id, recurring_id,
        competencia, descricao, category_id, nucleo, cost_center_id, counterparty_id,
        dia_esperado, dia_regra, valor_previsto_cents, created_by)
     SELECT d.entity_id, 'derivado', d.origem_ref, d.origem_camada,
            d.document_id, d.recurring_id,
            d.competencia, d.descricao, d.category_id, d.nucleo, d.cost_center_id,
            d.counterparty_id, d.dia_esperado, d.dia_regra, d.valor_projetado_cents, $4
       FROM fin_receita_prevista_derivado_v d
      WHERE d.entity_id = $1 AND d.competencia = $2::date AND d.origem_ref = $3
     RETURNING id`,
    [args.entityId, args.competencia, args.origemRef, args.actor]
  );
  if (!rows.length) {
    throw new ValidacaoCusto(
      404,
      `a projeção de entrada "${args.origemRef}" não existe em ${args.competencia.slice(0, 7)} — ` +
        `o horizonte de fin_previsao_evento_v não a alcança, ou ela já saiu (foi recebida, cancelada ou encerrada). ` +
        `Documento já vencido não é projeção: ele aparece no passado da agenda, no dia em que venceu.`
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

/**
 * Confirma N itens de entrada numa transação só.
 *
 * `batchId` compartilhado no `fin_audit_log` é o que torna o lote desfazível —
 * sem ele, confirmar 30 linhas viraria 30 decisões avulsas e o desfazer viraria
 * arqueologia.
 *
 * `valorCents` ausente confirma pelo valor previsto. Presente, ele é o ajuste,
 * e a diferença fica em `ajusteCents` — o único número que afere a previsão de
 * ENTRADA item a item, e o mesmo que `fin_agenda_prova_v` usa para explicar por
 * que a agenda pode legitimamente divergir da projeção.
 */
export async function confirmarEntradas(
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
      const m = await materializarEntrada(c, {
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
         FROM fin_receita_prevista WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
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
      throw new ValidacaoCusto(409, `item ${id} está marcado como "não vai acontecer"; reative-o antes de confirmar`);
    }

    const previsto = item.valor_previsto_cents === null ? null : Number(item.valor_previsto_cents);
    const confirmado = alvo.valorCents ?? previsto;
    if (confirmado === null) {
      throw new ValidacaoCusto(
        422,
        `item ${id} não tem valor previsto (${item.indeterminado_motivo ?? "motivo não declarado"}) — ` +
          `confirme informando valorCents, porque confirmar sem número seria inventar um`
      );
    }

    await c.query(
      `UPDATE fin_receita_prevista
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
// Criar receita prevista manual — o "cadastrar futuro de receitas" do pedido
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
  // A restrição nº 5 do projeto, na fronteira HTTP: sem evidência, o valor é
  // indeterminado COM MOTIVO. O CHECK do banco repete; aqui a mensagem é
  // legível para quem está na tela.
  if (valorCents === null && !indeterminadoMotivo) {
    throw new ValidacaoCusto(422, "sem valorCents é obrigatório declarar indeterminadoMotivo");
  }
  if (valorCents !== null && valorCents === 0) {
    throw new ValidacaoCusto(422, "valorCents zero não é receita prevista — use indeterminadoMotivo se não souber");
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

export async function criarEntradaManual(
  c: Cliente,
  args: { item: ItemManual; actor: string }
): Promise<{ id: number; batchId: string; estado: string }> {
  const entityId = await entidadeId(c);
  const batchId = randomUUID();
  const i = args.item;

  const categoryId = i.categoria ? await resolverCategoria(c, entityId, i.categoria) : null;
  if (i.nucleo) await conferirNucleo(c, i.nucleo);

  const { rows } = await c.query<{ id: string; estado: string }>(
    `INSERT INTO fin_receita_prevista
       (entity_id, origem, competencia, descricao, category_id, nucleo, cost_center_id,
        counterparty_id, dia_esperado, dia_regra, valor_previsto_cents, indeterminado_motivo,
        estado, valor_confirmado_cents, confirmado_por, confirmado_em, created_by)
     VALUES ($1, 'manual', $2::date, $3, $4, $5, $6, $7, $8::date,
             CASE WHEN $8::date IS NOT NULL THEN 'informado por quem criou o item' END,
             $9, $10,
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

  return { id, batchId, estado: rows[0].estado };
}

// ---------------------------------------------------------------------------
// Editar — o "organizar o que estiver errado, ir item a item"
// ---------------------------------------------------------------------------

/**
 * A lista é curta, e cada ausência tem motivo.
 *
 * `origem`, `origemRef`, `competencia` e `entityId` NÃO são editáveis. Mudar
 * `origem_ref` faria o item calar uma projeção que não o originou — dinheiro
 * real desaparecendo do mês sem que nenhuma linha diga que sumiu. Mudar a
 * competência moveria a receita de mês sem trilha de que mês ela veio; quem
 * precisa disso ignora o item e cria outro, e as duas decisões ficam.
 *
 * `estado` também não: confirmar tem rota própria, e tirar do total é
 * `{"ignorar": "motivo"}`. Um PATCH genérico em `estado` seria o caminho por
 * onde 'realizado' entraria sem lançamento no extrato.
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

export async function editarEntrada(
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
    `SELECT * FROM fin_receita_prevista WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
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

  if ("valorCents" in p) {
    const v = centsOpcional(p.valorCents, "valorCents");
    if (v === 0) throw new ValidacaoCusto(422, "valorCents zero não é receita prevista");
    // O CHECK do banco exige valor OU motivo. Zerar o valor sem declarar o
    // motivo no mesmo PATCH deixaria a linha inválida, e a mensagem do banco
    // não diria à tela o que fazer.
    const motivoNoPatch = "indeterminadoMotivo" in p ? textoOpcional(p.indeterminadoMotivo, "indeterminadoMotivo") : null;
    if (v === null && !motivoNoPatch && !atual.indeterminado_motivo) {
      throw new ValidacaoCusto(422, "para tirar o valor, declare indeterminadoMotivo no mesmo pedido");
    }
    empurra("valor_previsto_cents", v, "valorCents");
    // Item já confirmado que muda o previsto NÃO tem o confirmado mexido: a
    // diferença entre os dois é a medida do erro da projeção, e reescrever o
    // confirmado apagaria exatamente esse sinal.
  }

  if ("indeterminadoMotivo" in p) {
    empurra("indeterminado_motivo", textoOpcional(p.indeterminadoMotivo, "indeterminadoMotivo"), "indeterminadoMotivo");
  }

  if ("categoria" in p) {
    const code = textoOpcional(p.categoria, "categoria", 20);
    empurra("category_id", code ? await resolverCategoria(c, entityId, code) : null, "categoria");
  }

  if ("nucleo" in p) {
    const n = textoOpcional(p.nucleo, "nucleo", 40);
    if (n) await conferirNucleo(c, n);
    empurra("nucleo", n, "nucleo");
  }

  if ("centroDeCusto" in p) {
    const v = p.centroDeCusto === null || p.centroDeCusto === undefined ? null : Number(p.centroDeCusto);
    if (v !== null && !Number.isSafeInteger(v)) throw new ValidacaoCusto(400, "centroDeCusto inválido");
    empurra("cost_center_id", v, "centroDeCusto");
  }

  if ("contraparte" in p) {
    const v = p.contraparte === null || p.contraparte === undefined ? null : Number(p.contraparte);
    if (v !== null && !Number.isSafeInteger(v)) throw new ValidacaoCusto(400, "contraparte inválida");
    empurra("counterparty_id", v, "contraparte");
  }

  if ("diaEsperado" in p) {
    const d = dataOpcional(p.diaEsperado, "diaEsperado");
    empurra("dia_esperado", d, "diaEsperado");
    // O dia mudou por decisão de gente: a regra que o explica passa a ser essa.
    // Deixar a regra antiga faria a tela dizer "vencimento do boleto" sobre um
    // dia que o boleto não declara.
    params.push(d ? `ajustado à mão por ${args.actor}` : null);
    set.push(`dia_regra = $${params.length}`);
  }

  // "Não vai acontecer": neutraliza com motivo, nunca apaga.
  if ("ignorar" in p) {
    const motivo = textoOpcional(p.ignorar, "ignorar");
    if (!motivo) throw new ValidacaoCusto(422, 'ignorar exige o motivo: {"ignorar": "por que não vai acontecer"}');
    empurra("ignorado_motivo", motivo, "ignorar");
    params.push("ignorado");
    set.push(`estado = $${params.length}`);
  }

  if ("reativar" in p && p.reativar) {
    if (atual.estado !== "ignorado") {
      throw new ValidacaoCusto(409, `item ${args.id} não está ignorado`);
    }
    empurra("ignorado_motivo", null, "reativar");
    params.push("previsto");
    set.push(`estado = $${params.length}`);
    // Reativar tira a confirmação junto: um item que voltou de "não vai
    // acontecer" não pode carregar um "confirmado por" de antes da dúvida.
    set.push("valor_confirmado_cents = NULL", "confirmado_por = NULL", "confirmado_em = NULL");
  }

  if (!set.length) return { id: args.id, alterados: [], estado: String(atual.estado) };

  const { rows: depois } = await c.query<Record<string, unknown>>(
    `UPDATE fin_receita_prevista SET ${set.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );

  await trilha(c, {
    entityId,
    itemId: args.id,
    action: "update",
    antes: recorte(atual, alterados),
    depois: recorte(depois[0], alterados),
    campos: alterados,
    batchId: randomUUID(),
    actor: args.actor
  });

  return { id: args.id, alterados, estado: String(depois[0].estado) };
}

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

export async function apagarEntrada(
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
  }>(
    `SELECT id, origem, estado, descricao, valor_previsto_cents
       FROM fin_receita_prevista WHERE id = $1 AND entity_id = $2 FOR UPDATE`,
    [args.id, entityId]
  );
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
    throw new ValidacaoCusto(409, `item ${args.id} está realizado — apagar esconderia dinheiro que já entrou`);
  }

  // A trilha ANTES do DELETE: depois dela o id não existe para ser referido.
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

  await c.query("DELETE FROM fin_receita_prevista WHERE id = $1", [args.id]);
  return {
    id: args.id,
    descricao: item.descricao,
    valorCents: item.valor_previsto_cents === null ? null : Number(item.valor_previsto_cents)
  };
}

// ---------------------------------------------------------------------------
// O DESPACHO — uma ação humana, uma rota, dois donos por baixo
// ---------------------------------------------------------------------------

/**
 * O item da agenda é endereçado por `{direcao, id}` ou por
 * `{direcao, competencia, origemRef}`.
 *
 * A segunda forma é a que a tela usa na maior parte das vezes, porque a linha
 * que ela mostra costuma ser PROJEÇÃO — não existe item ainda, e portanto não
 * existe id. Materializar antes de agir é o que transforma "a projeção diz
 * R$ 1.621,00" em "eu digo R$ 1.622,00, e a diferença ficou medida".
 */
export type AlvoAgenda = { direcao: Direcao } & (
  | { id: number }
  | { competencia: string; origemRef: string }
);

export function alvoAgendaDe(bruto: unknown, campo = "alvo"): AlvoAgenda {
  const a = (bruto ?? {}) as Record<string, unknown>;
  const direcao = direcaoDe(a.direcao);
  if (a.id !== undefined && a.id !== null) {
    const id = Number(a.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ValidacaoCusto(400, `${campo}: id inválido`);
    return { direcao, id };
  }
  if (typeof a.origemRef === "string" && a.origemRef.trim()) {
    return { direcao, competencia: competenciaDe(a.competencia), origemRef: a.origemRef.trim() };
  }
  throw new ValidacaoCusto(400, `${campo} precisa de {direcao, id} ou de {direcao, competencia, origemRef}`);
}

const LOTE_MAXIMO = 200;

export function alvosAgendaDe(bruto: unknown): AlvoAgenda[] {
  const lista = Array.isArray(bruto) ? bruto : bruto === undefined || bruto === null ? [] : [bruto];
  if (!lista.length) throw new ValidacaoCusto(400, "informe ao menos um item");
  if (lista.length > LOTE_MAXIMO) {
    throw new ValidacaoCusto(400, `lote acima de ${LOTE_MAXIMO} itens — divida em chamadas menores`);
  }
  return lista.map((x, i) => alvoAgendaDe(x, `itens[${i}]`));
}

/** Garante que o alvo tem id, materializando a projeção quando necessário. */
export async function resolverItem(
  c: Cliente,
  args: { alvo: AlvoAgenda; actor: string; batchId?: string }
): Promise<{ id: number; direcao: Direcao; materializado: boolean }> {
  if ("id" in args.alvo) return { id: args.alvo.id, direcao: args.alvo.direcao, materializado: false };
  const entityId = await entidadeId(c);
  const batchId = args.batchId ?? randomUUID();
  const materializar = args.alvo.direcao === "pagar" ? materializarCusto : materializarEntrada;
  const m = await materializar(c, {
    entityId,
    competencia: args.alvo.competencia,
    origemRef: args.alvo.origemRef,
    actor: args.actor,
    batchId
  });
  return { id: m.id, direcao: args.alvo.direcao, materializado: m.criado };
}

/** Confirma um lote MISTO — entradas e saídas na mesma transação. */
export async function confirmarLoteMisto(
  c: Cliente,
  args: { itens: (AlvoAgenda & { valorCents?: number | null })[]; actor: string; nota?: string | null }
): Promise<{ receber: ResultadoConfirmacao | null; pagar: ResultadoConfirmacao | null }> {
  const separa = (d: Direcao): AlvoConfirmacao[] =>
    args.itens
      .filter((i) => i.direcao === d)
      .map((i) =>
        "id" in i
          ? { id: i.id, valorCents: i.valorCents ?? null }
          : { competencia: i.competencia, origemRef: i.origemRef, valorCents: i.valorCents ?? null }
      );

  const aPagar = separa("pagar");
  const aReceber = separa("receber");

  return {
    // A saída vai por `custos.ts` sem uma linha de lógica duplicada: a 0100 é a
    // dona do item de custo, e confirmar é dela.
    pagar: aPagar.length ? await confirmarCustos(c, { alvos: aPagar, actor: args.actor, nota: args.nota }) : null,
    receber: aReceber.length ? await confirmarEntradas(c, { alvos: aReceber, actor: args.actor, nota: args.nota }) : null
  };
}

/** Edita um item, do lado que for. */
export async function editarItemDaAgenda(
  c: Cliente,
  args: { direcao: Direcao; id: number; patch: Record<string, unknown>; actor: string }
) {
  return args.direcao === "pagar"
    ? editarCusto(c, { id: args.id, patch: args.patch, actor: args.actor })
    : editarEntrada(c, { id: args.id, patch: args.patch, actor: args.actor });
}

/** Cria um previsto manual, do lado que for. */
export async function criarManualDaAgenda(
  c: Cliente,
  args: { direcao: Direcao; corpo: unknown; actor: string }
) {
  return args.direcao === "pagar"
    ? criarCustoManual(c, { item: custoManualDe(args.corpo), actor: args.actor })
    : criarEntradaManual(c, { item: itemManualDe(args.corpo), actor: args.actor });
}
