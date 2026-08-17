import { getPanoramaMei } from "@/lib/financeiro/contratos";
import { anoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/mei?ano=
 *
 * Somente leitura, como todo o prefixo. E dentro de `/api/financeiro`, não em
 * `/api/time`: a janela do teto expõe quanto cada prestador recebeu no ano —
 * é dado de folha, e o perfil comum recebe 404 por estar onde está.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getPanoramaMei({ ano: anoDe(sp) });
  return responderContrato(contrato);
});
