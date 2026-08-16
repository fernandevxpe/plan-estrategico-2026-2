import { getBalanco } from "@/lib/financeiro/contratos";
import { inteiroDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { mesEstritoDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/financeiro/gerencial/balanco?mes=&meses= */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getBalanco({
    mes: mesEstritoDe(sp, "mes"),
    meses: inteiroDe(sp, "meses", { min: 1, max: 120 })
  });
  return responderContrato(contrato);
});
