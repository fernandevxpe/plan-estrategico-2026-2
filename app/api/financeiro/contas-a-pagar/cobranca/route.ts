import { autorDe } from "@/lib/financeiro/custo-fixo";
import {
  alternarFavorito,
  apagarCobrancaAnexo,
  cobrancaDisponivel,
  guardarCobrancaAnexo,
  ValidacaoCobranca,
  type KindCobranca
} from "@/lib/financeiro/conta-cobranca";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST   /api/financeiro/contas-a-pagar/cobranca
 *   multipart: chaveDedupe, kind (boleto|nota_fiscal), arquivo
 *
 * PATCH  /api/financeiro/contas-a-pagar/cobranca
 *   { chaveFavorito, favorito }  — estrela da contraparte, vale todo mês
 *
 * DELETE /api/financeiro/contas-a-pagar/cobranca
 *   { chaveDedupe, kind }
 *
 * SEM GUARD AQUI: middleware protege `/api/financeiro` por prefixo — a mesma
 * decisão de `programar/route.ts`. Guard duplicado é o que diverge.
 */

function respostaDeErro(error: unknown, contexto: string): Response {
  if (error instanceof ValidacaoCobranca) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof FinanceUnavailableError) {
    return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
  }
  console.error(`[financeiro] ${contexto}:`, error);
  return Response.json({ error: "não salvou" }, { status: 500 });
}

function kindDe(bruto: unknown): KindCobranca {
  const v = String(bruto ?? "");
  if (v === "boleto" || v === "nota_fiscal") return v;
  throw new ValidacaoCobranca(400, "kind deve ser boleto ou nota_fiscal");
}

export async function POST(request: Request) {
  try {
    if (!(await cobrancaDisponivel())) {
      return Response.json({ error: "tabela de cobrança ainda não existe — rode as migrations" }, { status: 503 });
    }
    const form = await request.formData();
    const chaveDedupe = String(form.get("chaveDedupe") ?? "");
    const kind = kindDe(form.get("kind"));
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) {
      return Response.json({ error: "envie o arquivo no campo arquivo" }, { status: 400 });
    }
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const { anexo, leitura } = await guardarCobrancaAnexo({
      chaveDedupe,
      kind,
      nome: arquivo.name || "arquivo",
      mime: arquivo.type || "",
      bytes,
      autor: autorDe(request)
    });
    return Response.json({ ok: true, anexo, leitura });
  } catch (error) {
    return respostaDeErro(error, "cobranca POST");
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await cobrancaDisponivel())) {
      return Response.json({ error: "tabela de cobrança ainda não existe — rode as migrations" }, { status: 503 });
    }
    const corpo = (await request.json()) as Record<string, unknown>;
    const chave = String(corpo.chaveFavorito ?? "");
    if (typeof corpo.favorito !== "boolean") {
      return Response.json({ error: "favorito deve ser boolean" }, { status: 400 });
    }
    await alternarFavorito(chave, corpo.favorito, autorDe(request));
    return Response.json({ ok: true, chaveFavorito: chave, favorito: corpo.favorito });
  } catch (error) {
    return respostaDeErro(error, "cobranca PATCH");
  }
}

export async function DELETE(request: Request) {
  try {
    if (!(await cobrancaDisponivel())) {
      return Response.json({ error: "tabela de cobrança ainda não existe — rode as migrations" }, { status: 503 });
    }
    const corpo = (await request.json()) as Record<string, unknown>;
    await apagarCobrancaAnexo(String(corpo.chaveDedupe ?? ""), kindDe(corpo.kind));
    return Response.json({ ok: true });
  } catch (error) {
    return respostaDeErro(error, "cobranca DELETE");
  }
}
