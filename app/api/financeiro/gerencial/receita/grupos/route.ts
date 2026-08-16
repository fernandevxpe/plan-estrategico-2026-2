import { getReceitaPorGrupo } from "@/lib/financeiro/contratos";
import { anoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { mesEstritoDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/financeiro/gerencial/receita/grupos?ano=&mes= */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getReceitaPorGrupo({
    ano: anoDe(sp),
    mes: mesEstritoDe(sp, "mes")
  });
  return responderContrato(contrato);
});
