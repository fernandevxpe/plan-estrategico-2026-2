import { buscarHistoricoContas } from "@/lib/financeiro/contas-a-pagar-buscar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/contas-a-pagar/buscar?q=
 *
 * Histórico da plataforma para o painel Adicionar: último valor, categoria,
 * dia e favorecido. Sem guard local — middleware cobre `/api/financeiro`.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const resultado = await buscarHistoricoContas(q);
  return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
}
