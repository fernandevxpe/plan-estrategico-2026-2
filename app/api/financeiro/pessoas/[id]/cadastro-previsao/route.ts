import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { getCadastroPrevisaoPessoa } from "@/lib/financeiro/cadastro-previsao-pessoa";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/financeiro/pessoas/[id]/cadastro-previsao?mes=YYYY-MM
 *
 * Cadastro vigente + previsão do mês — popup rápido na matriz de Pessoas.
 * Mesma base do perfil; não duplica regra de soma no cliente.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return Response.json({ error: "id inválido" }, { status: 422 });
  }

  const url = new URL(request.url);
  const mes = url.searchParams.get("mes");

  try {
    const dados = await getCadastroPrevisaoPessoa(personId, mes);
    if (!dados) return Response.json({ error: "pessoa não encontrada" }, { status: 404 });
    return Response.json(dados);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
