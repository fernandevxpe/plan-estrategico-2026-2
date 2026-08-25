import "server-only";

/**
 * O que as quatro rotas de cartão compartilham.
 *
 * Nada aqui consulta banco: são as três decisões que precisam ser IGUAIS nas
 * quatro rotas — quem é o autor, como um erro se parece, e como um texto vira
 * chave de busca. Cada cópia divergente dessas três viraria um bug silencioso:
 * um autor "tela" numa rota e "xpeadmin" noutra faz a trilha de auditoria
 * mentir sobre quem decidiu.
 */

export const ENTITY = "xpe";

export function erro(mensagem: string, status = 400) {
  return Response.json({ erro: mensagem }, { status });
}

/**
 * A recusa que sai de DENTRO de uma transação.
 *
 * As rotas de escrita só descobrem parte das recusas depois de abrir a
 * transação e consultar ("esta categoria existe?", "este lançamento é da mesma
 * linha?"). Devolver `{ erro }` cru de dentro do `transaction()` fazia o
 * TypeScript inferir uma união sem discriminante, e `"erro" in resultado` não
 * estreitava o tipo. Com `recusa` marcado por um literal, estreita.
 */
export type Recusa = { recusado: true; mensagem: string; status: number };

export const recusar = (mensagem: string, status = 400): Recusa => ({
  recusado: true,
  mensagem,
  status
});

export const foiRecusa = (v: unknown): v is Recusa =>
  typeof v === "object" && v !== null && (v as Recusa).recusado === true;

/**
 * Quem está decidindo, lido do Basic Auth.
 *
 * Mesma leitura de `/api/financeiro/qualificar`. O fallback "tela" existe
 * porque a alternativa seria recusar a escrita — e a autenticação já aconteceu
 * no middleware; aqui só se quer o NOME para a trilha.
 */
export function autor(request: Request): string {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("basic ")) return "tela";
  try {
    return Buffer.from(h.slice(6), "base64").toString("utf8").split(":")[0]?.trim() || "tela";
  } catch {
    return "tela";
  }
}

/**
 * O texto vira chave de busca: minúsculo, sem acento, espaços colapsados.
 *
 * Idêntica à `normalizarFornecedor` de `lib/financeiro/time.ts` — o mesmo
 * vocabulário aprendido é alimentado pelos dois lados (app do time e tela de
 * cartões), e duas normalizações diferentes fariam "Mercado Livre" e
 * "mercado livre" virarem dois padrões que nunca se encontram.
 */
export function normalizarTexto(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
