import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { cancelarItemReembolso } from "@/lib/financeiro/estorno-reembolso";

export const dynamic = "force-dynamic";

/**
 * POST /api/time/reembolso-item/[fonte]/[itemId]/cancelar
 * Cancela a compra reembolsada e gera estorno (devolução à empresa).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ fonte: string; itemId: string }> }
) {
  try {
    const { sessao } = await exigirContexto();
    const { fonte, itemId } = await params;
    if (fonte !== "planilha" && fonte !== "app") {
      return Response.json({ erro: "fonte inválida" }, { status: 400 });
    }
    const id = Number(itemId);
    if (!Number.isFinite(id)) {
      return Response.json({ erro: "id inválido" }, { status: 400 });
    }
    const corpo = (await request.json().catch(() => ({}))) as {
      motivoCategoria?: unknown;
      motivo?: unknown;
      confirmar?: unknown;
    };
    const estorno = await cancelarItemReembolso(sessao, fonte, id, {
      motivoCategoria: String(corpo.motivoCategoria ?? "outro"),
      motivo: String(corpo.motivo ?? ""),
      confirmar: corpo.confirmar === true
    });
    return Response.json({ estorno });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
