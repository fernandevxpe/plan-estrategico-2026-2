import { NextResponse } from "next/server";

import { criarLote, ImportError, listarLotes } from "@/lib/financeiro/importacao";

/**
 * Upload e listagem de lotes de extrato.
 *
 * O upload é multipart porque o arquivo vem do compartilhamento do celular —
 * qualquer coisa que exija copiar conteúdo para um campo de texto quebra o
 * fluxo de 15 segundos que esta tela existe para permitir.
 */
export async function GET() {
  try {
    return NextResponse.json({ lotes: await listarLotes() });
  } catch (erro) {
    console.error("[financeiro] listagem de lotes falhou:", erro);
    return NextResponse.json({ error: "não consegui listar os lotes" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "envie o arquivo como multipart/form-data" }, { status: 400 });
  }

  const arquivo = form.get("file");
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: "campo 'file' é obrigatório" }, { status: 400 });
  }
  // Extrato de banco é texto: alguns MB no máximo. O teto evita que um PDF ou
  // um vídeo escolhido por engano no celular vire uma leitura de 200 MB.
  if (arquivo.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "arquivo acima de 8 MB — extrato de banco não chega perto disso" }, { status: 413 });
  }

  const contaSlug = typeof form.get("conta") === "string" ? String(form.get("conta")) : null;

  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const lote = await criarLote(buffer, arquivo.name, contaSlug);
    return NextResponse.json(lote, { status: 201 });
  } catch (erro) {
    if (erro instanceof ImportError) {
      return NextResponse.json({ error: erro.message, ...erro.detalhe }, { status: erro.status });
    }
    console.error("[financeiro] upload de extrato falhou:", erro);
    return NextResponse.json({ error: "não consegui processar o arquivo" }, { status: 500 });
  }
}
