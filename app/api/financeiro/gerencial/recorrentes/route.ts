import { getRecorrentes } from "@/lib/financeiro/contratos";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { opcaoOpcionalDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS = ["proposto", "ativo", "suspenso", "encerrado", "recusado"] as const;
const DIRECOES = ["pagar", "receber"] as const;
const CONFIANCAS = ["firme", "provavel", "observado"] as const;

/** GET /api/financeiro/gerencial/recorrentes?status=&direcao=&confianca= */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getRecorrentes({
    status: opcaoOpcionalDe(sp, "status", STATUS),
    direcao: opcaoOpcionalDe(sp, "direcao", DIRECOES),
    confianca: opcaoOpcionalDe(sp, "confianca", CONFIANCAS)
  });
  return responderContrato(contrato);
});
