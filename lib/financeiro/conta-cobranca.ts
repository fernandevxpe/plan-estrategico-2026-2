import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { FinanceUnavailableError, query, transaction } from "./db";
import { ComprovanteIndisponivel, lerComprovante, leituraDeComprovanteDisponivel } from "./ler-comprovante";
import { lerNotaXml, XmlNaoEhNota } from "./ler-nfe-xml";
import type { KindCobranca } from "./contas-a-pagar-eixos";

/**
 * Cobrança do contas a pagar — boleto, NF-e e favorito.
 *
 * Vive separado de `contas-a-pagar.ts` porque aquele arquivo é o contrato de
 * LEITURA da agenda. Aqui é escrita: o arquivo entra, o blob fica em
 * `fin_anexo_blob` (0105), o vínculo em `fin_conta_cobranca_anexo` (0185).
 *
 * A agenda continua sendo a fonte do valor a pagar. O que o arquivo afirmou
 * (`valor_lido_cents`, `vencimento_lido`) só CONFERE. Campo que a leitura não
 * pegou volta null — nunca chutado, a mesma regra de `ler-comprovante.ts`.
 */

const ENTIDADE = "xpe";
const TETO_BYTES = 10 * 1024 * 1024;
const MIMES_ACEITOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "text/xml",
  "application/xml"
]);

export class ValidacaoCobranca extends Error {
  constructor(
    readonly status: number,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ValidacaoCobranca";
  }
}

export type { KindCobranca } from "./contas-a-pagar-eixos";

export type AnexoCobranca = {
  kind: KindCobranca;
  storageKey: string;
  fileName: string | null;
  mimeType: string | null;
  fileBytes: number | null;
  valorLidoCents: number | null;
  vencimentoLido: string | null;
  emitenteLido: string | null;
  formaLida: string | null;
};

export type LeituraCobranca = {
  valorLidoCents: number | null;
  vencimentoLido: string | null;
  emitenteLido: string | null;
  formaLida: string | null;
  aviso: string | null;
};

type Cliente = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function entidadeId(c: Cliente): Promise<number> {
  const { rows } = await c.query("SELECT id FROM fin_entity WHERE slug = $1", [ENTIDADE]);
  if (!rows.length) throw new ValidacaoCobranca(503, `entidade ${ENTIDADE} não existe neste banco`);
  return Number(rows[0].id);
}

export async function cobrancaDisponivel(): Promise<boolean> {
  try {
    const rows = await query<{ tem: boolean }>(`SELECT to_regclass('fin_conta_cobranca') IS NOT NULL AS tem`);
    return Boolean(rows[0]?.tem);
  } catch {
    return false;
  }
}

export async function listarFavoritos(): Promise<Set<string>> {
  if (!(await cobrancaDisponivel())) return new Set();
  const rows = await query<{ chave: string }>(
    `SELECT f.chave
       FROM fin_conta_favorito f
       JOIN fin_entity e ON e.id = f.entity_id AND e.slug = $1`,
    [ENTIDADE]
  );
  return new Set(rows.map((r) => r.chave));
}

export async function listarAnexosPorChave(chaves: string[]): Promise<Map<string, AnexoCobranca[]>> {
  const mapa = new Map<string, AnexoCobranca[]>();
  if (!chaves.length || !(await cobrancaDisponivel())) return mapa;
  const rows = await query<Record<string, unknown>>(
    `SELECT c.chave_dedupe,
            a.kind, a.storage_key, a.file_name, a.mime_type, a.file_bytes,
            a.valor_lido_cents, a.vencimento_lido::text AS vencimento_lido,
            a.emitente_lido, a.forma_lida
       FROM fin_conta_cobranca c
       JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
       JOIN fin_conta_cobranca_anexo a ON a.cobranca_id = c.id
      WHERE c.chave_dedupe = ANY($2::text[])
      ORDER BY a.kind`,
    [ENTIDADE, chaves]
  );
  for (const r of rows) {
    const chave = String(r.chave_dedupe);
    const lista = mapa.get(chave) ?? [];
    lista.push({
      kind: r.kind === "nota_fiscal" ? "nota_fiscal" : "boleto",
      storageKey: String(r.storage_key),
      fileName: r.file_name == null ? null : String(r.file_name),
      mimeType: r.mime_type == null ? null : String(r.mime_type),
      fileBytes: r.file_bytes == null ? null : Number(r.file_bytes),
      valorLidoCents: r.valor_lido_cents == null ? null : Number(r.valor_lido_cents),
      vencimentoLido: r.vencimento_lido == null ? null : String(r.vencimento_lido).slice(0, 10),
      emitenteLido: r.emitente_lido == null ? null : String(r.emitente_lido),
      formaLida: r.forma_lida == null ? null : String(r.forma_lida)
    });
    mapa.set(chave, lista);
  }
  return mapa;
}

export async function alternarFavorito(chave: string, favorito: boolean, _autor: string): Promise<void> {
  const limpa = chave.trim();
  if (!limpa || limpa.length > 200) throw new ValidacaoCobranca(400, "chave de favorito inválida");
  if (!(await cobrancaDisponivel())) {
    throw new ValidacaoCobranca(503, "tabela de cobrança ainda não existe — rode as migrations");
  }
  await transaction(async (c) => {
    const entityId = await entidadeId(c);
    if (favorito) {
      await c.query(
        `INSERT INTO fin_conta_favorito (entity_id, chave) VALUES ($1, $2)
         ON CONFLICT (entity_id, chave) DO NOTHING`,
        [entityId, limpa]
      );
    } else {
      await c.query(`DELETE FROM fin_conta_favorito WHERE entity_id = $1 AND chave = $2`, [entityId, limpa]);
    }
  });
}

function mimeDoArquivo(nome: string, mimeBruto: string, bytes: Buffer): string {
  const ehXmlDisfarcado =
    (mimeBruto === "application/octet-stream" || !mimeBruto) &&
    /\.xml$/i.test(nome) &&
    bytes.subarray(0, 200).toString("utf8").replace(/^\ufeff/, "").trimStart().startsWith("<");
  return ehXmlDisfarcado ? "text/xml" : mimeBruto;
}

async function lerArquivo(kind: KindCobranca, mime: string, bytes: Buffer): Promise<LeituraCobranca> {
  const vazio: LeituraCobranca = {
    valorLidoCents: null,
    vencimentoLido: null,
    emitenteLido: null,
    formaLida: null,
    aviso: null
  };

  if (mime === "text/xml" || mime === "application/xml") {
    try {
      const nota = lerNotaXml(bytes.toString("utf8"));
      return {
        valorLidoCents: nota.valorTotal == null ? null : Math.round(nota.valorTotal * 100),
        // Emissão da NF-e NÃO é vencimento. Guardar os dois no mesmo campo
        // faria o boleto de setembro aparecer com a data da nota de agosto.
        vencimentoLido: kind === "boleto" ? nota.data : null,
        emitenteLido: nota.emitente,
        formaLida: nota.formaPagamento === "indeterminado" ? null : nota.formaPagamento,
        aviso: null
      };
    } catch (e) {
      if (e instanceof XmlNaoEhNota) return { ...vazio, aviso: e.message };
      throw e;
    }
  }

  if (!leituraDeComprovanteDisponivel()) {
    return { ...vazio, aviso: "arquivo guardado — leitura automática sem chave neste ambiente" };
  }

  try {
    const lido = await lerComprovante(bytes, mime);
    return {
      valorLidoCents: lido.valorTotal == null ? null : Math.round(lido.valorTotal * 100),
      vencimentoLido: lido.data,
      emitenteLido: lido.estabelecimento,
      formaLida: lido.formaPagamento === "indeterminado" ? null : lido.formaPagamento,
      aviso: null
    };
  } catch (e) {
    if (e instanceof ComprovanteIndisponivel) return { ...vazio, aviso: e.message };
    throw e;
  }
}

export async function guardarCobrancaAnexo(args: {
  chaveDedupe: string;
  kind: KindCobranca;
  nome: string;
  mime: string;
  bytes: Buffer;
  autor: string;
}): Promise<{ anexo: AnexoCobranca; leitura: LeituraCobranca }> {
  if (!(await cobrancaDisponivel())) {
    throw new ValidacaoCobranca(503, "tabela de cobrança ainda não existe — rode as migrations");
  }
  const chaveDedupe = args.chaveDedupe.trim();
  if (!chaveDedupe || chaveDedupe.length > 240) {
    throw new ValidacaoCobranca(400, "chave da obrigação inválida");
  }
  if (args.kind !== "boleto" && args.kind !== "nota_fiscal") {
    throw new ValidacaoCobranca(400, "kind deve ser boleto ou nota_fiscal");
  }
  if (args.bytes.length === 0) throw new ValidacaoCobranca(400, "o arquivo veio vazio");
  if (args.bytes.length > TETO_BYTES) {
    throw new ValidacaoCobranca(413, "arquivo acima de 10 MB — fotografe em resolução menor");
  }

  const mime = mimeDoArquivo(args.nome, args.mime, args.bytes);
  if (!MIMES_ACEITOS.has(mime)) {
    throw new ValidacaoCobranca(
      415,
      `tipo de arquivo não aceito: ${args.mime || "desconhecido"} (aceito PDF, foto ou XML)`
    );
  }

  const leitura = await lerArquivo(args.kind, mime, args.bytes);
  const sha = createHash("sha256").update(args.bytes).digest("hex");
  const comprimido = gzipSync(args.bytes, { level: 9 });
  const storageKey = `cobranca/${new Date().toISOString().slice(0, 10)}/${sha.slice(0, 16)}`;
  const fileName = args.nome.slice(0, 200) || null;

  const anexo = await transaction(async (c) => {
    const entityId = await entidadeId(c);
    await c.query(
      `INSERT INTO fin_anexo_blob (storage_key, conteudo, content_type, content_encoding, sha256,
                                   bytes_originais, bytes_gravados, file_name, uploaded_by)
       VALUES ($1, $2, $3, 'gzip', $4, $5, $6, $7, $8)
       ON CONFLICT (storage_key) DO NOTHING`,
      [storageKey, comprimido, mime, sha, args.bytes.length, comprimido.length, fileName, args.autor]
    );

    const cobranca = await c.query(
      `INSERT INTO fin_conta_cobranca (entity_id, chave_dedupe)
       VALUES ($1, $2)
       ON CONFLICT (entity_id, chave_dedupe) DO UPDATE SET entity_id = EXCLUDED.entity_id
       RETURNING id`,
      [entityId, chaveDedupe]
    );
    const cobrancaId = Number(cobranca.rows[0]?.id);
    if (!cobrancaId) throw new ValidacaoCobranca(500, "não criou a cobrança");

    await c.query(
      `INSERT INTO fin_conta_cobranca_anexo
         (cobranca_id, kind, storage_key, file_name, mime_type, file_bytes,
          valor_lido_cents, vencimento_lido, emitente_lido, forma_lida, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (cobranca_id, kind) DO UPDATE SET
         storage_key = EXCLUDED.storage_key,
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         file_bytes = EXCLUDED.file_bytes,
         valor_lido_cents = EXCLUDED.valor_lido_cents,
         vencimento_lido = EXCLUDED.vencimento_lido,
         emitente_lido = EXCLUDED.emitente_lido,
         forma_lida = EXCLUDED.forma_lida,
         uploaded_by = EXCLUDED.uploaded_by,
         uploaded_at = now()`,
      [
        cobrancaId,
        args.kind,
        storageKey,
        fileName,
        mime,
        args.bytes.length,
        leitura.valorLidoCents,
        leitura.vencimentoLido,
        leitura.emitenteLido,
        leitura.formaLida,
        args.autor
      ]
    );

    return {
      kind: args.kind,
      storageKey,
      fileName,
      mimeType: mime,
      fileBytes: args.bytes.length,
      valorLidoCents: leitura.valorLidoCents,
      vencimentoLido: leitura.vencimentoLido,
      emitenteLido: leitura.emitenteLido,
      formaLida: leitura.formaLida
    } satisfies AnexoCobranca;
  });

  return { anexo, leitura };
}

export async function apagarCobrancaAnexo(chaveDedupe: string, kind: KindCobranca): Promise<void> {
  if (!(await cobrancaDisponivel())) {
    throw new ValidacaoCobranca(503, "tabela de cobrança ainda não existe — rode as migrations");
  }
  if (kind !== "boleto" && kind !== "nota_fiscal") {
    throw new ValidacaoCobranca(400, "kind deve ser boleto ou nota_fiscal");
  }
  await transaction(async (c) => {
    const entityId = await entidadeId(c);
    await c.query(
      `DELETE FROM fin_conta_cobranca_anexo a
        USING fin_conta_cobranca c
        WHERE a.cobranca_id = c.id
          AND c.entity_id = $1
          AND c.chave_dedupe = $2
          AND a.kind = $3`,
      [entityId, chaveDedupe.trim(), kind]
    );
  });
}

export async function bytesDoAnexo(storageKey: string): Promise<{
  bytes: Buffer;
  mime: string;
  fileName: string | null;
} | null> {
  if (!(await cobrancaDisponivel())) return null;
  const rows = await query<{
    conteudo: Buffer;
    content_encoding: string | null;
    content_type: string | null;
    file_name: string | null;
  }>(
    `SELECT b.conteudo, b.content_encoding, b.content_type, a.file_name
       FROM fin_conta_cobranca_anexo a
       JOIN fin_anexo_blob b ON b.storage_key = a.storage_key
       JOIN fin_conta_cobranca c ON c.id = a.cobranca_id
       JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
      WHERE a.storage_key = $2`,
    [ENTIDADE, storageKey]
  );
  const r = rows[0];
  if (!r) return null;
  const bruto = r.conteudo;
  const bytes = r.content_encoding === "gzip" ? gunzipSync(bruto) : bruto;
  return {
    bytes,
    mime: r.content_type || "application/octet-stream",
    fileName: r.file_name
  };
}

export { FinanceUnavailableError };
