import { FinanceUnavailableError } from "@/lib/financeiro/db";
import {
  atualizarItemReembolso,
  excluirItemReembolso,
  mudarStatusReembolso
} from "@/lib/financeiro/reembolsos";

/**
 * PATCH  /api/financeiro/reembolsos/[id] — muda status do REEMBOLSO
 *          (corpo {status}) ou o valor de um ITEM (corpo {tipo:'item', valorCents}).
 * DELETE /api/financeiro/reembolsos/[id] — apaga o ITEM de id [id].
 *
 * O discriminador `tipo` existe porque as duas entidades compartilham a mesma
 * rota e um id numérico não diz a qual tabela pertence. O padrão é o que cada
 * verbo faz na maior parte do tempo: PATCH mexe no reembolso (aprovar/pagar),
 * DELETE mexe no item (reembolso inteiro se apaga esvaziando-o).
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  let body: { tipo?: unknown; status?: unknown; valorCents?: unknown; observacao?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    if (body.tipo === "item") {
      const resultado = await atualizarItemReembolso(idNum, body.valorCents);
      if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
      return Response.json(resultado);
    }

    if (typeof body.status !== "string" || !body.status.trim()) {
      return Response.json({ error: "status é obrigatório" }, { status: 400 });
    }
    const observacao = typeof body.observacao === "string" && body.observacao.trim() ? body.observacao.trim() : null;
    const resultado = await mudarStatusReembolso(idNum, body.status.trim(), observacao);
    if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
    return Response.json(resultado);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const resultado = await excluirItemReembolso(idNum);
    if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
    return Response.json(resultado);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
