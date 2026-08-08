import { randomUUID } from "node:crypto";

import { FinanceUnavailableError, transaction } from "@/lib/financeiro/db";
import {
  classificarHumano,
  resolverCategoria,
  resolverNucleo,
  tabelaValida,
  ValidacaoError,
  type TabelaAlvo
} from "@/lib/financeiro/revisao";

/**
 * POST /api/financeiro/revisao/lote — aplicar UMA categoria a até 100 linhas.
 *
 * Corpo: {targets: [{table, id}], categoryCode, nucleo?}.
 *
 * O batch_id compartilhado no fin_audit_log é o que permite desfazer as N
 * linhas com um clique — sem ele, o lote seria N decisões avulsas e o desfazer
 * viraria arqueologia. Tudo numa transação só: ou o lote inteiro entra, ou
 * nada entra (meio lote gravado é pior que lote nenhum quando o assunto é
 * dinheiro).
 */
export async function POST(request: Request) {
  let body: { targets?: unknown; categoryCode?: unknown; nucleo?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  const targets = Array.isArray(body.targets) ? body.targets : null;
  if (!targets?.length) return Response.json({ error: "targets vazio" }, { status: 400 });
  if (targets.length > 100) {
    return Response.json({ error: "máximo de 100 alvos por lote" }, { status: 400 });
  }
  if (typeof body.categoryCode !== "string" || !body.categoryCode.trim()) {
    return Response.json({ error: "categoryCode é obrigatório" }, { status: 400 });
  }
  const categoryCode = body.categoryCode.trim();
  const nucleoPedido = typeof body.nucleo === "string" && body.nucleo.trim() ? body.nucleo.trim() : null;

  // Valida e agrupa por tabela ANTES de abrir transação: o classificarHumano
  // trabalha por tabela, e um alvo malformado deve falhar o request inteiro
  // antes de qualquer escrita.
  const porTabela = new Map<TabelaAlvo, number[]>();
  for (const alvo of targets as { table?: unknown; id?: unknown }[]) {
    const id = Number(alvo?.id);
    if (!tabelaValida(alvo?.table) || !Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "alvo inválido: esperado {table, id}" }, { status: 400 });
    }
    const lista = porTabela.get(alvo.table) ?? [];
    lista.push(id);
    porTabela.set(alvo.table, lista);
  }

  const batchId = randomUUID();

  try {
    const resultado = await transaction(async (client) => {
      const categoria = await resolverCategoria(client, categoryCode);
      const nucleo = nucleoPedido ? await resolverNucleo(client, nucleoPedido) : null;

      let aplicados = 0;
      let valorCents = 0;
      const naoEncontrados: { table: TabelaAlvo; id: number }[] = [];

      for (const [table, ids] of porTabela) {
        const parcial = await classificarHumano(client, {
          table,
          ids,
          categoria,
          nucleo,
          batchId,
          via: "lote"
        });
        aplicados += parcial.aplicados;
        valorCents += parcial.valorCents;
        for (const id of parcial.naoEncontrados) naoEncontrados.push({ table, id });
      }

      return { aplicados, valorCents, naoEncontrados };
    });

    return Response.json({ ok: true, batchId, ...resultado });
  } catch (error) {
    if (error instanceof ValidacaoError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
