import { getContratosEParcelas } from "@/lib/financeiro/contratos";
import { inteiroDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { bandeiraEstritaDe, opcaoOpcionalDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_ERP = ["RASCUNHO", "ATIVO", "ENCERRADO", "CANCELADO", "INATIVO"] as const;

/**
 * GET /api/financeiro/gerencial/contratos
 *   ?contratoErpId=&statusErp=&semCobranca=&limite=
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getContratosEParcelas({
    contratoErpId: inteiroDe(sp, "contratoErpId", { min: 1, max: 2_147_483_647 }),
    statusErp: opcaoOpcionalDe(sp, "statusErp", STATUS_ERP),
    semCobranca: bandeiraEstritaDe(sp, "semCobranca"),
    limite: inteiroDe(sp, "limite", { min: 1, max: 2_000 })
  });
  return responderContrato(contrato);
});
