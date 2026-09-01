import { consultarSaldoAsaas } from "@/lib/financeiro/asaas-saldo";
import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { consultarSaldoInter, saldosAsaasNubankDoLedger } from "@/lib/financeiro/inter-saldo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/aprovacoes/saldo
 *
 * Inter e Asaas ao vivo; Nubank do ledger (não há GET de saldo). O corpo
 * raiz continua sendo o Inter — a tela e o teste já leem `disponivelCents`
 * ali. Asaas/Nubank entram como irmãos: somá-los no servidor misturaria
 * "cabe no Inter hoje" com caixa de outra conta.
 *
 * Sem guard aqui: `middleware.ts` protege `/api/financeiro` por prefixo.
 */
export async function GET() {
  try {
    const [inter, asaas, outros] = await Promise.all([
      consultarSaldoInter(),
      consultarSaldoAsaas(),
      saldosAsaasNubankDoLedger()
    ]);
    return Response.json(
      { ...inter, asaas, nubank: outros.nubank },
      {
        status: inter.disponivelCents === null ? 503 : 200,
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    console.error("[financeiro] saldo Inter:", error);
    return Response.json({ error: "saldo do Inter indisponível" }, { status: 503 });
  }
}
