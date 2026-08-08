import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { criarItemReembolso, getPainelReembolsos, type NovoItemReembolso } from "@/lib/financeiro/reembolsos";
import { ValidacaoError } from "@/lib/financeiro/revisao";

/**
 * GET  /api/financeiro/reembolsos — matriz pessoa × mês, planos, itens do mês
 *                                   corrente e previsão do mês seguinte.
 * POST /api/financeiro/reembolsos — lança um item; se `parcelado`, cria o plano
 *                                   e gera um item por mês de referência.
 *
 * Uma consulta só para matriz e detalhe: separá-las faria a soma da linha e a
 * soma da gaveta discordarem no dia em que um filtro fosse esquecido numa das
 * duas.
 */

export async function GET() {
  try {
    return Response.json(await getPainelReembolsos());
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  let body: NovoItemReembolso;
  try {
    body = (await request.json()) as NovoItemReembolso;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    const resultado = await criarItemReembolso(body);
    return Response.json({ ok: true, ...resultado }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidacaoError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
