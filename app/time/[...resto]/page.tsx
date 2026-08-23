import { notFound } from "next/navigation";

/**
 * Qualquer endereço sob `/time` que não casa com uma tela real.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM CATCH-ALL, E NÃO SÓ O `not-found.tsx`
 * ---------------------------------------------------------------------------
 * No App Router, um `not-found.tsx` dentro de um segmento só atende ao
 * `notFound()` lançado por uma rota DAQUELE segmento. Uma URL que não casa com
 * rota nenhuma nunca entra no segmento — ela cai no 404 raiz, fora de
 * `app/time/layout.tsx`, e portanto sem o casco do app.
 *
 * Foi o que eu errei na primeira tentativa: criei o `not-found.tsx`, e
 * `/time/nao-existe` continuou devolvendo a página branca em inglês.
 *
 * Este arquivo existe só para fazer a URL ENTRAR no segmento e então lançar o
 * `notFound()`, que aí sim renderiza `app/time/not-found.tsx` dentro do
 * layout. Rotas específicas (`/time/custo`, `/time/envios`…) continuam
 * ganhando do catch-all — é a precedência normal do roteador.
 */
export default function TimeCatchAll() {
  notFound();
}
