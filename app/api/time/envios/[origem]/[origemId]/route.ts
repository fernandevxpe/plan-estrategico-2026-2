import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { detalharEnvioDoTime } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/time/envios/[origem]/[origemId] — detalhe de um envio da sessão:
 * itens, parcelas previstas e irmãos do mesmo grupo (ex. custo de compra).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ origem: string; origemId: string }> }
) {
  try {
    const { sessao } = await exigirContexto();
    const { origem, origemId } = await params;
    const id = Number(origemId);
    if (!Number.isFinite(id)) {
      return Response.json({ erro: "id inválido" }, { status: 400 });
    }
    const detalhe = await detalharEnvioDoTime(sessao, origem, id);
    return Response.json({ detalhe });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
