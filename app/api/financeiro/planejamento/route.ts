import { NextResponse } from "next/server";

import { salvarOverride, salvarPremissa } from "@/lib/financeiro/planejamento";

/**
 * Linhas que a DRE projetada conhece. Sem esta lista, `linha` era texto livre e
 * um erro de digitação gravava uma sobrescrita para uma linha inexistente com
 * 200 OK — lixo silencioso que ninguém encontraria depois.
 */
const LINHAS_VALIDAS = new Set([
  "receita",
  "imposto",
  "custo_operacional",
  "custo_vendas",
  "marketing",
  "custo_fixo"
]);

/** Faixa de anos plausível: evita gravar plano para o ano 99999999. */
const ANO_MIN = 2020;
const ANO_MAX = 2035;

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
      if (ano < ANO_MIN || ano > ANO_MAX) {
        return NextResponse.json({ error: `ano deve estar entre ${ANO_MIN} e ${ANO_MAX}` }, { status: 422 });
      }
      if (!LINHAS_VALIDAS.has(linha)) {
        return NextResponse.json(
          { error: `linha desconhecida: ${linha}. Válidas: ${[...LINHAS_VALIDAS].join(", ")}` },
          { status: 422 }
        );
      }
      // 2^53 centavos ≈ R$ 90 trilhões. Acima disso o número já perdeu precisão
      // antes de chegar aqui, e gravá-lo é gravar mentira.
      if (valorCents !== null && Math.abs(valorCents) > Number.MAX_SAFE_INTEGER) {
        return NextResponse.json({ error: "valor fora da faixa representável" }, { status: 422 });
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
    const mensagem = (erro as Error).message;
    console.error("[financeiro] edição do planejamento falhou:", erro);
    // "não encontrada" é erro do pedido, não do servidor — e a mensagem interna
    // não deve vazar para o cliente nos demais casos.
    if (/não encontrad/i.test(mensagem)) {
      return NextResponse.json({ error: mensagem }, { status: 404 });
    }
    return NextResponse.json({ error: "não consegui salvar a alteração" }, { status: 500 });
  }
}
