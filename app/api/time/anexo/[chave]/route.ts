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
 * QUEM PODE LER
 * Só quem enviou. A autorização não é um `if` sobre a chave: ela é uma consulta
 * que parte de `person_id` da SESSÃO e chega ao anexo pelos três caminhos que
 * `fin_payment_attachment` pode apontar. Chave que não pertence à pessoa não
 * casa a consulta e devolve **404** — não 403, pelo mesmo motivo do middleware:
 * 403 confirmaria que aquele comprovante existe.
 *
 * O admin não passa por aqui. Ele lê pelo prefixo `/api/financeiro`, que é onde
 * mora tudo que enxerga o envio dos outros.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ chave: string }> }) {
  try {
    const { sessao } = await exigirContexto();
    const chave = decodeURIComponent((await params).chave ?? "");
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
            (a.target_table = 'fin_purchase_request' AND EXISTS (
              SELECT 1 FROM fin_purchase_request c
               WHERE c.id = a.target_id AND c.requested_person_id = $2))
          )
        LIMIT 1`,
      [chave, sessao.personId]
    );

    const linha = linhas[0];
    if (!linha) throw new TimeError("comprovante não encontrado", 404);

    const bytes = linha.content_encoding === "gzip" ? gunzipSync(linha.conteudo) : linha.conteudo;
    const nome = (linha.file_name ?? "comprovante").replace(/[^\w.\- ]+/g, "_").slice(0, 120);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": linha.content_type ?? "application/octet-stream",
        // `inline` para abrir no próprio celular sem baixar; o nome viaja para
        // o caso de a pessoa escolher salvar.
        "Content-Disposition": `inline; filename="${nome}"`,
        "Content-Length": String(bytes.length),
        // Comprovante é imutável (a chave contém o sha256), mas é dado pessoal:
        // cache no aparelho, nunca em proxy compartilhado.
        "Cache-Control": "private, max-age=31536000, immutable"
      }
    });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
