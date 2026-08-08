import { NextResponse } from "next/server";

import { salvarOverride, salvarPremissa } from "@/lib/financeiro/planejamento";

/**
 * Edição do planejamento.
 *
 * Duas operações porque são duas naturezas diferentes: `premissa` muda a REGRA
 * (e refaz o plano inteiro), `override` muda UM valor sem tocar na regra. A
 * segunda é o que evita que a primeira exceção mande a pessoa de volta para a
 * planilha.
 */
export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  try {
    if (body.tipo === "premissa") {
      const slug = typeof body.slug === "string" ? body.slug : null;
      const valor = Number(body.valor);
      if (!slug || !Number.isFinite(valor) || valor < 0) {
        return NextResponse.json({ error: "slug e valor são obrigatórios" }, { status: 400 });
      }
      return NextResponse.json(await salvarPremissa(slug, Math.round(valor)));
    }

    if (body.tipo === "override") {
      const ano = Number(body.ano);
      const mes = Number(body.mes);
      const linha = typeof body.linha === "string" ? body.linha : null;
      const nucleo = typeof body.nucleo === "string" && body.nucleo !== "collective" ? body.nucleo : null;
      const valorCents = body.valorCents === null ? null : Number(body.valorCents);
      if (!linha || !Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        return NextResponse.json({ error: "ano, mes e linha são obrigatórios" }, { status: 400 });
      }
      if (valorCents !== null && !Number.isFinite(valorCents)) {
        return NextResponse.json({ error: "valorCents inválido" }, { status: 400 });
      }
      const motivo = typeof body.motivo === "string" ? body.motivo : null;
      return NextResponse.json(
        await salvarOverride(ano, mes, linha, nucleo, valorCents === null ? null : Math.round(valorCents), motivo)
      );
    }

    return NextResponse.json({ error: "tipo deve ser 'premissa' ou 'override'" }, { status: 400 });
  } catch (erro) {
    console.error("[financeiro] edição do planejamento falhou:", erro);
    return NextResponse.json({ error: (erro as Error).message }, { status: 500 });
  }
}
