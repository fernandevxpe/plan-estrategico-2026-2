import { gunzipSync } from "node:zlib";

import { exigirContexto, respostaDeErro } from "@/app/api/time/_sessao";
import { query } from "@/lib/financeiro/db";
import { TimeError } from "@/lib/financeiro/time";

/**
 * Devolve o comprovante que a pessoa mandou.
 *
 * POR QUE ESTA ROTA PRECISOU EXISTIR
 * O upload funciona desde a 0105: o arquivo entra, é gzipado e gravado em
 * `fin_anexo_blob`. Só que **nada o servia de volta** — nenhuma rota, nenhuma
 * tela. Anexo que entra e não sai não é prova: ninguém consegue conferir o que
 * foi enviado, nem a própria pessoa que enviou.
 *
 * POR QUE É `[...chave]` E NÃO `[chave]`
 * A chave gravada por `guardarAnexo` é `time/<AAAA-MM-DD>/<sha16>` — três
 * segmentos. Um `[param]` de segmento único casa `[^/]+` e devolveria 404 do
 * ROTEADOR, antes de qualquer código rodar, para 100% dos anexos reais. A
 * primeira versão desta rota era exatamente isso: código inalcançável.
 *
 * QUEM PODE LER
 * Só quem enviou. A autorização não é um `if` sobre a chave: é uma consulta que
 * parte do `person_id` da SESSÃO e chega ao anexo pelos alvos que
 * `fin_payment_attachment` pode apontar. Chave que não pertence à pessoa não
 * casa e devolve **404** — não 403, pelo mesmo motivo do middleware: 403
 * confirmaria que aquele comprovante existe.
 *
 * O admin não passa por aqui. Ele lê pelo prefixo `/api/financeiro`, que é onde
 * mora tudo que enxerga o envio dos outros.
 */

export const dynamic = "force-dynamic";

/**
 * O que pode ser mostrado dentro do navegador.
 *
 * Fora desta lista o arquivo desce como anexo e com tipo genérico. O motivo é
 * concreto: a allowlist de upload aceita `text/xml` e `application/xml`, e o
 * MIME não é inferido dos bytes — vem do que o navegador de quem enviou
 * declarou no multipart. Um XHTML declarado como `text/xml` e servido `inline`
 * executaria script **na origem da aplicação**, a mesma de `/financeiro`.
 * `httpOnly` protege o token; não impede o script de agir como a vítima.
 */
const EXIBIVEL = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/;

export async function GET(request: Request, { params }: { params: Promise<{ chave: string[] }> }) {
  try {
    const { sessao } = await exigirContexto();

    // Os segmentos já chegam decodificados pelo roteador. Decodificar de novo
    // faria `%25` virar `%` e depois lançar `URIError`, que não é `TimeError` e
    // viraria 500 — ruído de log gratuito para quem quisesse gerar.
    const chave = ((await params).chave ?? []).join("/");
    if (!chave) throw new TimeError("comprovante não encontrado", 404);

    const linhas = await query<{
      conteudo: Buffer;
      content_type: string | null;
      content_encoding: string | null;
      file_name: string | null;
    }>(
      `SELECT b.conteudo, b.content_type, b.content_encoding, a.file_name
         FROM fin_payment_attachment a
         JOIN fin_anexo_blob b ON b.storage_key = a.storage_key
        WHERE a.storage_key = $1
          AND (
            (a.target_table = 'fin_time_envio' AND EXISTS (
              SELECT 1 FROM fin_time_envio e WHERE e.id = a.target_id AND e.person_id = $2))
            OR
            (a.target_table = 'fin_reimbursement_item' AND EXISTS (
              SELECT 1 FROM fin_reimbursement_item i
                JOIN fin_reimbursement r ON r.id = i.reimbursement_id
               WHERE i.id = a.target_id AND r.person_id = $2))
            OR
            -- O cabeçalho do reembolso também aceita anexo (está no CHECK de
            -- target_table), e sem este caminho o comprovante preso ao pedido
            -- inteiro — não a um item — ficaria invisível para o próprio dono.
            (a.target_table = 'fin_reimbursement' AND EXISTS (
              SELECT 1 FROM fin_reimbursement r WHERE r.id = a.target_id AND r.person_id = $2))
            OR
            (a.target_table = 'fin_purchase_request' AND EXISTS (
              SELECT 1 FROM fin_purchase_request c
               WHERE c.id = a.target_id AND c.requested_person_id = $2))
          )
        LIMIT 1`,
      [chave, sessao.personId]
    );

    const linha = linhas[0];
    if (!linha) throw new TimeError("comprovante não encontrado", 404);

    let bytes: Buffer;
    try {
      bytes = linha.content_encoding === "gzip" ? gunzipSync(linha.conteudo) : linha.conteudo;
    } catch {
      // Blob truncado ou marcado `gzip` sem ser. Um 500 genérico faria parecer
      // que a rota quebrou; o problema é o arquivo, e quem vê precisa saber
      // que é aquele arquivo.
      throw new TimeError("este comprovante está corrompido e não pode ser aberto", 422);
    }

    const tipo = linha.content_type ?? "";
    // `?download=1` força o salvamento mesmo de um tipo exibível: a tela do
    // item oferece "abrir" e "baixar" para o mesmo arquivo, e a diferença
    // entre os dois é só esta.
    const querBaixar = new URL(request.url).searchParams.get("download") === "1";
    const exibivel = EXIBIVEL.test(tipo) && !querBaixar;
    const nome = (linha.file_name ?? "comprovante").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "comprovante";

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": exibivel ? tipo : "application/octet-stream",
        "Content-Disposition": `${exibivel ? "inline" : "attachment"}; filename="${nome}"`,
        // Sem sniffing: o navegador não pode decidir sozinho que aquele
        // octet-stream "parece" HTML e renderizá-lo.
        "X-Content-Type-Options": "nosniff",
        // E mesmo que renderizasse: sem script, sem rede, sem origem.
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        // Comprovante é imutável (a chave carrega o sha256), mas é dado
        // pessoal: cache no aparelho, nunca em proxy compartilhado. `Vary`
        // porque a resposta depende de quem está logado.
        "Cache-Control": "private, max-age=31536000, immutable",
        Vary: "Cookie"
      }
    });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
