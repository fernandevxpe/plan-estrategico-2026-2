import { RecusaCategorizacao } from "@/lib/financeiro/categorizacao";
import { marcarVeredicto, salvarReferencia } from "@/lib/financeiro/reconciliacao";
import { getReconciliacao } from "@/lib/financeiro/contratos/reconciliacao";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { intervaloMensalDe } from "../_parametros";
import { autorDe, erro, lerCorpo, textoOpcional } from "../categorizacao/_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Reconciliação — sistema × referência externa (0125).
 *
 * GET   ?de=&ate=                         a comparação, maior diferença primeiro
 * POST  {categoryId, mes, valorEsperadoCents, fonte}   salva/substitui um valor esperado
 * PATCH {referenciaId, status, nota?}      marca o veredito de uma linha já revisada
 *
 * Reusa `_escrita.ts` da central de categorização em vez de duplicar
 * autorDe/lerCorpo/textoOpcional: são helpers de propósito geral (autoria via
 * Basic Auth, undefined≠null em PATCH), não lógica de plano de contas.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getReconciliacao(intervaloMensalDe(sp));
  return responderContrato(contrato);
});

export async function POST(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  try {
    const salva = await salvarReferencia(
      {
        categoryId: corpo.categoryId === null || corpo.categoryId === undefined ? null : Number(corpo.categoryId),
        mes: String(corpo.mes ?? "").trim(),
        valorEsperadoCents: Number(corpo.valorEsperadoCents),
        fonte: String(corpo.fonte ?? "").trim()
      },
      autorDe(request)
    );
    return Response.json({ ok: true, referencia: salva }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return traduzir(e);
  }
}

export async function PATCH(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  const referenciaId = Number(corpo.referenciaId);
  if (!Number.isSafeInteger(referenciaId) || referenciaId <= 0) {
    return erro("informe `referenciaId` — o id da linha de fin_reconciliacao_referencia a marcar");
  }

  try {
    const marcada = await marcarVeredicto(
      { referenciaId, status: String(corpo.status ?? "").trim() as never, nota: textoOpcional(corpo.nota) },
      autorDe(request)
    );
    return Response.json({ ok: true, referencia: marcada }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return traduzir(e);
  }
}

function traduzir(e: unknown): Response {
  if (e instanceof RecusaCategorizacao) {
    return Response.json(
      { erro: e.message, ...e.detalhe },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (e instanceof FinanceUnavailableError) return erro("banco do financeiro indisponível", 503);

  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg?.code === "23514" || pg?.code === "23503") {
    return Response.json(
      { erro: pg.message ?? "o banco recusou a operação", recusadoPor: pg.constraint ?? "restrição da 0125" },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error("[reconciliacao]", pg?.message ?? e);
  return erro(pg?.message ?? "falha ao gravar reconciliação", 500);
}
