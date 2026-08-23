import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { anexarComprovanteItemReembolso } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

/**
 * POST /api/time/reembolso-item/app/[itemId]/comprovante — anexa comprovante a
 * um item do app (fin_reimbursement_item).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { sessao } = await exigirContexto();
    const { itemId } = await params;
    const id = Number(itemId);
    if (!Number.isFinite(id)) {
      return Response.json({ erro: "id inválido" }, { status: 400 });
    }
    const { arquivo } = await lerCorpo(request);
    if (!arquivo) throw new Error("mande o arquivo do comprovante");
    await anexarComprovanteItemReembolso(sessao, id, arquivo);
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
