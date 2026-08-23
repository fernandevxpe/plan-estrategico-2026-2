import { gunzipSync } from "node:zlib";

import { exigirContexto, lerCorpo, respostaDeErro } from "@/app/api/time/_sessao";
import { query } from "@/lib/financeiro/db";
import { lerFotoPerfil, salvarFotoPerfil, TimeError } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessao } = await exigirContexto();
    const foto = await lerFotoPerfil(sessao);
    if (!foto) throw new TimeError("sem foto de perfil", 404);

    const linhas = await query<{ conteudo: Buffer; content_type: string | null; content_encoding: string | null }>(
      `SELECT conteudo, content_type, content_encoding FROM fin_anexo_blob WHERE storage_key = $1`,
      [foto.chave]
    );
    const blob = linhas[0];
    if (!blob) throw new TimeError("foto não encontrada", 404);

    const bytes = blob.content_encoding === "gzip" ? gunzipSync(blob.conteudo) : blob.conteudo;
    const tipo = blob.content_type ?? "image/jpeg";

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": tipo,
        "cache-control": "private, max-age=300"
      }
    });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

export async function POST(request: Request) {
  try {
    const { sessao } = await exigirContexto();
    const { arquivo } = await lerCorpo(request);
    if (!arquivo) throw new TimeError("mande uma foto", 400);
    await salvarFotoPerfil(sessao, arquivo);
    return Response.json({ ok: true });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
