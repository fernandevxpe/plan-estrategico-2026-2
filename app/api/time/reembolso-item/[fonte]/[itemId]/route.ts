import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { buscarEstornoItem } from "@/lib/financeiro/estorno-reembolso";
import {
  atualizarItemReembolso,
  detalharItemReembolso,
  historicoParcelasItem,
  opcoesDoTime
} from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/time/reembolso-item/[fonte]/[itemId] — histórico de parcelas pagas e
 * previstas de um item (planilha ou app).
 *
 * PATCH — renomeia o item (`{ "nome": "..." }`).
 */
export async function GET(
  _req: Request,
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
    const historico = await historicoParcelasItem(sessao, fonte, id);
    const item = await detalharItemReembolso(sessao, fonte, id);
    const estorno = await buscarEstornoItem(sessao, fonte, id);
    const opcoes = await opcoesDoTime();
    return Response.json({ historico, item, estorno, opcoes });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function PATCH(
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
      nome?: unknown;
      categoriaId?: unknown;
      tipoReembolso?: unknown;
      categoriaLivre?: unknown;
      nota?: unknown;
    };
    const resultado = await atualizarItemReembolso(sessao, fonte, id, {
      nome: corpo.nome !== undefined ? String(corpo.nome) : undefined,
      categoriaId:
        corpo.categoriaId === null || corpo.categoriaId === ""
          ? null
          : corpo.categoriaId !== undefined
            ? Number(corpo.categoriaId)
            : undefined,
      tipoReembolso:
        corpo.tipoReembolso === null || corpo.tipoReembolso === ""
          ? null
          : corpo.tipoReembolso !== undefined
            ? String(corpo.tipoReembolso)
            : undefined,
      categoriaLivre: corpo.categoriaLivre !== undefined ? String(corpo.categoriaLivre) : undefined,
      nota: corpo.nota !== undefined ? String(corpo.nota) : undefined
    });
    return Response.json(resultado);
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
