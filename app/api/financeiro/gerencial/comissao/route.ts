import { getComissao } from "@/lib/financeiro/contratos";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/financeiro/gerencial/comissao */
export const GET = rotaDeLeitura(async () => responderContrato(await getComissao()));
