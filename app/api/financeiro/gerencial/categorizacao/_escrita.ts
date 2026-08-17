import "server-only";

/**
 * O que as três rotas de escrita da central de categorização compartilham.
 *
 * As rotas de LEITURA desta API passam por `rotaDeLeitura` e devolvem o
 * envelope `Contrato<T>`. As de escrita não devolvem contrato — elas devolvem o
 * que mudou — mas precisam das mesmas três coisas, e tê-las em três cópias é
 * como elas divergem.
 *
 * O QUE ELAS COMPARTILHAM, E POR QUÊ
 *
 * `autorDe` — a autoria vem do Basic Auth, que é o que protege `/api/financeiro`
 * (`lib/auth/perfis.ts` marca o prefixo como só-admin). Sem nome, a trilha em
 * `fin_audit_log` diria "alguém", e é justamente a trilha que torna o desfazer
 * possível.
 *
 * `lerCorpo` — JSON malformado é 400 com o motivo, nunca exceção que estoura
 * a rota inteira.
 *
 * `textoOpcional` — distingue "não mandou o campo" (não mexer) de "mandou
 * vazio" (limpar). Um `?? ""` aqui apagaria o núcleo padrão de uma categoria
 * porque a tela não enviou o campo.
 */

export function erro(mensagem: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return Response.json({ erro: mensagem, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Quem está do outro lado, pelo Basic Auth. `tela` quando não há cabeçalho. */
export function autorDe(request: Request): string {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("basic ")) return "tela";
  try {
    return Buffer.from(h.slice(6), "base64").toString("utf8").split(":")[0]?.trim() || "tela";
  } catch {
    return "tela";
  }
}

export async function lerCorpo(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const corpo = await request.json();
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
      return erro("o corpo deve ser um objeto JSON");
    }
    return corpo as Record<string, unknown>;
  } catch {
    return erro("corpo não é JSON válido");
  }
}

/**
 * `undefined` quando o campo não veio; `null` quando veio vazio de propósito.
 *
 * Os dois significam coisas diferentes num PATCH: ausente é "não mexa",
 * vazio é "limpe". Colapsá-los apaga dado que ninguém pediu para apagar.
 */
export function textoOpcional(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

/** Ids de lote: inteiros seguros, sem repetição, na ordem em que chegaram. */
export function idsDe(valor: unknown): number[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<number>();
  for (const bruto of valor) {
    const n = Number(bruto);
    if (Number.isSafeInteger(n) && n > 0) vistos.add(n);
  }
  return [...vistos];
}
