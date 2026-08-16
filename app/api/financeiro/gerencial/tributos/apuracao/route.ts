import { getApuracaoTributaria } from "@/lib/financeiro/contratos";
import { anoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { intervaloMensalDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/financeiro/gerencial/tributos/apuracao?ano=&de=&ate= */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getApuracaoTributaria({
    ano: anoDe(sp),
    ...intervaloMensalDe(sp)
  });
  return responderContrato(contrato);
});
