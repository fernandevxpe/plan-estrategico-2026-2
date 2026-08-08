import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { criarPagamento, direcaoValida, getContas, type NovoPagamento } from "@/lib/financeiro/contas";
import { ValidacaoError } from "@/lib/financeiro/revisao";

/**
 * GET  /api/financeiro/contas  — lista filtrada de documentos em aberto.
 * POST /api/financeiro/contas  — cria pagamento manual (1 ou 12 documentos).
 *
 * A rota só traduz HTTP: toda a mecânica (planned_at, auditoria, fila de
 * revisão, criação de favorecido) mora em lib/financeiro/contas.ts, pelo mesmo
 * motivo de revisao.ts — um invariante cumprido em dois lugares vira um
 * invariante cumprido em um lugar e meio.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const direcao = searchParams.get("direcao") ?? "pagar";
  if (!direcaoValida(direcao)) {
    return Response.json({ error: "direcao deve ser 'pagar' ou 'receber'" }, { status: 400 });
  }

  const counterpartyBruto = searchParams.get("counterpartyId");
  const counterpartyId = counterpartyBruto ? Number(counterpartyBruto) : null;
  if (counterpartyBruto && (!Number.isInteger(counterpartyId) || (counterpartyId ?? 0) <= 0)) {
    return Response.json({ error: "counterpartyId inválido" }, { status: 400 });
  }

  try {
    const painel = await getContas({
      direcao,
      de: searchParams.get("de"),
      ate: searchParams.get("ate"),
      nucleo: searchParams.get("nucleo"),
      categoriaCode: searchParams.get("categoria"),
      counterpartyId,
      texto: searchParams.get("texto"),
      somenteAbertos: searchParams.get("todos") !== "1"
    });
    return Response.json(painel);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  let body: NovoPagamento;
  try {
    body = (await request.json()) as NovoPagamento;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    const resultado = await criarPagamento(body);
    return Response.json({ ok: true, ...resultado }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidacaoError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
