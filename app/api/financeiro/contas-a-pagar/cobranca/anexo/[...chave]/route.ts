import { bytesDoAnexo } from "@/lib/financeiro/conta-cobranca";

export const dynamic = "force-dynamic";

/**
 * GET /api/financeiro/contas-a-pagar/cobranca/anexo/[...chave]
 *
 * Serve o boleto ou a NF-e que a tela de contas a pagar guardou. A chave é
 * `cobranca/<AAAA-MM-DD>/<sha16>` — três segmentos, por isso `[...chave]`.
 *
 * Só PDF e imagem abrem inline. XML desce como anexo: servir `text/xml`
 * inline na origem da aplicação executaria o arquivo no navegador de quem
 * abre a ficha (a mesma razão de `app/api/time/anexo`).
 */

const EXIBIVEL = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/;

export async function GET(_request: Request, { params }: { params: Promise<{ chave: string[] }> }) {
  const chave = ((await params).chave ?? []).join("/");
  if (!chave) return Response.json({ error: "anexo não encontrado" }, { status: 404 });

  const arquivo = await bytesDoAnexo(chave);
  if (!arquivo) return Response.json({ error: "anexo não encontrado" }, { status: 404 });

  const mime = arquivo.mime;
  const inline = EXIBIVEL.test(mime);
  const nome = arquivo.fileName || "cobranca";
  return new Response(new Uint8Array(arquivo.bytes), {
    headers: {
      "Content-Type": inline ? mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nome.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600"
    }
  });
}
