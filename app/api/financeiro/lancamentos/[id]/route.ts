import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { processarPatchClassificacao, type CorpoPatch } from "@/lib/financeiro/revisao";

/**
 * PATCH /api/financeiro/lancamentos/[id] — classificação humana de um
 * lançamento (fin_transaction).
 *
 * Corpo: {categoryCode?, nucleo?, reviewStatus?}. Toda a mecânica (trava de
 * campos, auditoria, evento, resolução da fila) mora em
 * lib/financeiro/revisao.ts — a rota só traduz HTTP.
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  let body: CorpoPatch;
  try {
    body = (await request.json()) as CorpoPatch;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    const resultado = await processarPatchClassificacao("fin_transaction", idNum, body);
    if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
    return Response.json(resultado);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
