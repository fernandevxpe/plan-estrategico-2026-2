import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { editarItemReembolso, mudarStatusReembolso, type EdicaoItem } from "@/lib/financeiro/reembolsos";

/**
 * PATCH  /api/financeiro/reembolsos/[id] — muda status do REEMBOLSO
 *          (corpo {status}) ou edita um ITEM do app (corpo {tipo:'item', valorCents?,
 *          competencia?, descricao?, tipo?, categoriaCode?, status?, motivo?}).
 * DELETE /api/financeiro/reembolsos/[id] — CANCELA o ITEM de id [id] (corpo {motivo}).
 *
 * O DELETE deixou de apagar a linha em 30/10/2026. Apagar levava junto a
 * prova de que o pedido existiu, e o padrão da casa para "preenchido errado"
 * já era status 'cancelado' com motivo (estornos, 0194 — os itens 901/902 do
 * Cleber). Item pago, de reembolso pago ou em ordem enviada ao banco é recusado
 * com 409 nos dois verbos.
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

  let body: EdicaoItem & { tipo?: unknown; tipoReembolso?: unknown; observacao?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    if (body.tipo === "item") {
      // `tipo` já é o discriminador da rota; o tipo de reembolso viaja como `tipoReembolso`.
      const resultado = await editarItemReembolso(idNum, { ...body, tipo: body.tipoReembolso });
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

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const corpo = (await request.json().catch(() => ({}))) as { motivo?: unknown };
    const resultado = await editarItemReembolso(idNum, { status: "cancelado", motivo: corpo.motivo });
    if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
    return Response.json(resultado);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
