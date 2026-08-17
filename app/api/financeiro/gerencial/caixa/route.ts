import { getCaixa } from "@/lib/financeiro/contratos/caixa";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/caixa
 *
 * Saldo por conta com histórico, e o Pronampe. Somente leitura, como todo o
 * prefixo, e dentro de `/api/financeiro`: saldo de conta e saldo devedor são
 * dado gerencial — o perfil comum recebe 404 por estar onde está.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getCaixa();
  return responderContrato(contrato);
});
