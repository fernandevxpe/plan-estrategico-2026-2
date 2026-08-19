import { getDrePorDimensao, type Dimensao } from "@/lib/financeiro/contratos";
import { anoDe, opcaoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { intervaloMensalDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VISOES = ["caixa", "competencia"] as const;
const DIMENSOES = ["nucleo", "cliente", "centro_custo", "linha_produto"] as const satisfies readonly Dimensao[];

/** GET /api/financeiro/gerencial/dre/dimensao?visao=&dimensao=&ano=&de=&ate= */
export const GET = rotaDeLeitura(async (sp) => {
  const intervalo = intervaloMensalDe(sp);
  const contrato = await getDrePorDimensao({
    visao: opcaoDe(sp, "visao", VISOES, "caixa"),
    dimensao: opcaoDe(sp, "dimensao", DIMENSOES, "nucleo"),
    ano: anoDe(sp),
    ...intervalo
  });
  return responderContrato(contrato);
});
