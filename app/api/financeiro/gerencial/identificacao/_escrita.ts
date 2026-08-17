import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { RecusaDeEscrita } from "@/lib/financeiro/identificacao";

/**
 * O envoltório das rotas de escrita desta frente.
 *
 * `rotaDeLeitura` (em `contratos/http.ts`) não serve aqui: ele entrega
 * `searchParams` e o cabeçalho daquele arquivo promete que nenhuma rota que o
 * usa expõe verbo além de GET. Reusá-lo para um POST tornaria a promessa falsa
 * — e ela protege 32 rotas de leitura.
 *
 * Traduz três coisas e só essas:
 *
 *   `RecusaDeEscrita`        → 422, com o motivo em texto legível. É recusa de
 *                              REGRA (A1, A4, dígito verificador, motivo vazio),
 *                              não erro de sintaxe: o pedido foi entendido e a
 *                              base se negou. 400 diria "você digitou errado",
 *                              que é outra conversa.
 *   corpo não-JSON           → 400.
 *   `FinanceUnavailableError`→ 503.
 *
 * Qualquer outra exceção SOBE. Bug nosso tem de aparecer no log com a pilha, e
 * não virar `{"erro":"algo deu errado"}` que ninguém investiga.
 */
export function rotaDeEscrita<T>(
  handler: (corpo: Record<string, unknown>, request: Request) => Promise<T>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    let corpo: Record<string, unknown>;
    try {
      const bruto: unknown = await request.json();
      if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
        return erro(400, "o corpo precisa ser um objeto JSON");
      }
      corpo = bruto as Record<string, unknown>;
    } catch {
      return erro(400, "corpo não é JSON válido");
    }

    try {
      const dado = await handler(corpo, request);
      return Response.json(dado, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof RecusaDeEscrita) return erro(422, e.message);
      if (e instanceof FinanceUnavailableError) {
        return erro(503, `banco financeiro indisponível: ${e.message}`);
      }
      throw e;
    }
  };
}

function erro(status: number, mensagem: string): Response {
  return Response.json({ erro: mensagem, gravado: false }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Texto obrigatório do corpo. Ausente e vazio são a mesma recusa. */
export function textoObrigatorio(corpo: Record<string, unknown>, nome: string): string {
  const v = corpo[nome];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new RecusaDeEscrita(`campo "${nome}" é obrigatório e precisa ser texto não vazio`);
  }
  return v.trim();
}

/** Inteiro obrigatório do corpo. Aceita número ou string numérica, nunca NaN. */
export function inteiroObrigatorio(corpo: Record<string, unknown>, nome: string): number {
  const v = corpo[nome];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new RecusaDeEscrita(`campo "${nome}" é obrigatório e precisa ser um inteiro positivo`);
  }
  return n;
}
