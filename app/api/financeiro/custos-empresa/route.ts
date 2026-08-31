import { randomUUID } from "node:crypto";

import { classificarCustoEmpresa, ValidacaoCustoEmpresa } from "@/lib/financeiro/custo-empresa-classificar";
import { autorDe } from "@/lib/financeiro/custo-fixo";
import { FinanceUnavailableError, transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * PATCH /api/financeiro/custos-empresa
 *
 * Classifica um custo (contraparte × categoria): time e/ou áreas da empresa.
 * A linha em `fin_custo_empresa` só nasce neste PATCH — não há seed.
 *
 *   { "counterpartyId": 12, "categoryId": 3, "area": "obras" }
 *   { "counterpartyId": 12, "categoryId": 3, "areasEmpresa": ["campo", "projetos"] }
 *   { "counterpartyId": 12, "categoryId": 3, "bloco": "impostos" }
 *   { "counterpartyId": null, "categoryId": 3, "area": "administrativo" }
 */
export async function PATCH(request: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "corpo não é JSON válido" }, { status: 400 });
  }

  const categoryId = Number(corpo.categoryId);
  const counterpartyId =
    corpo.counterpartyId === null || corpo.counterpartyId === undefined
      ? null
      : Number(corpo.counterpartyId);

  try {
    const resultado = await transaction((c) =>
      classificarCustoEmpresa(
        c,
        {
          counterpartyId,
          categoryId,
          area: "area" in corpo ? (corpo.area as string | null) : undefined,
          areasEmpresa: "areasEmpresa" in corpo ? (corpo.areasEmpresa as string[]) : undefined,
          bloco: "bloco" in corpo ? (corpo.bloco as string | null) : undefined,
          actor: autorDe(request)
        },
        randomUUID()
      )
    );
    return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ValidacaoCustoEmpresa) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("[financeiro] classificar custo da empresa:", error);
    return Response.json({ error: "não salvou" }, { status: 500 });
  }
}
