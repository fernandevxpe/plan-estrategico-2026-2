import { getFluxoPorConta } from "@/lib/financeiro/contratos";
import { anoDe, responderContrato, rotaDeLeitura, textoDe } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/financeiro/gerencial/fluxo/contas?ano=&conta= */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getFluxoPorConta({
    ano: anoDe(sp),
    conta: textoDe(sp, "conta", 120)
  });
  return responderContrato(contrato);
});
