import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { getHistoricoPagamentos } from "@/lib/financeiro/pagamentos-historico";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/pagamentos?de=&ate=&pessoa=&tipo=&estado=&busca=
 *
 * Histórico de ordens de pagamento, somente leitura. Não existe POST/PUT aqui
 * de propósito: enviar é /financeiro/aprovacoes; esta rota só responde "o que
 * foi mandado, quando, e o que aconteceu com isso".
 *
 * Sem guard aqui: `middleware.ts` protege `/api/financeiro` por prefixo.
 */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  try {
    const dados = await getHistoricoPagamentos({
      de: data(p.get("de")),
      ate: data(p.get("ate")),
      pessoa: p.get("pessoa"),
      tipo: p.get("tipo"),
      estado: p.get("estado"),
      busca: p.get("busca")
    });
    return Response.json(dados, {
      status: dados.disponivel ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    console.error("[financeiro] pagamentos histórico:", error);
    return Response.json({ error: "falha ao ler o histórico de pagamentos" }, { status: 500 });
  }
}
