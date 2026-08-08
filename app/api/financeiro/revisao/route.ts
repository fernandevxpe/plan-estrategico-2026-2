import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { getFilaRevisao } from "@/lib/financeiro/revisao";

/**
 * GET /api/financeiro/revisao — a fila de revisão.
 *
 * Os 100 itens de maior R$ em jogo, cada um já com as top-3 sugestões vindas do
 * histórico da contraparte, mais os totais que alimentam a barra de progresso.
 * É o endpoint que o FinReviewQueue rechama depois de cada ação.
 */
export async function GET() {
  try {
    return Response.json(await getFilaRevisao());
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
