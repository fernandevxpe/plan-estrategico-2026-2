import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { atualizarConta, excluirConta, type PatchConta } from "@/lib/financeiro/contas";

/**
 * PATCH  /api/financeiro/contas/[id] — valor, vencimento, flexibilidade, status,
 *                                      categoria, núcleo e observação.
 * DELETE /api/financeiro/contas/[id] — só quando status='previsto' e nada foi
 *                                      liquidado; caso contrário 409.
 *
 * O PATCH é a operação de "atualizar o valor do pró-labore deste mês": editar em
 * vez de apagar e recriar preserva `planned_at`, e sem `planned_at` o pagamento
 * deixa de contar como planejado.
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  let body: PatchConta;
  try {
    body = (await request.json()) as PatchConta;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    const resultado = await atualizarConta(idNum, body);
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
    const resultado = await excluirConta(idNum);
    if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
    return Response.json(resultado);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
