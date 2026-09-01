/**
 * As duas abas de Custo da empresa, num módulo que os DOIS lados podem importar.
 *
 * Isto começou dentro de `components/financeiro/FinCustosEmpresa.tsx`, e a
 * página quebrou em produção-local com 500 na primeira requisição:
 *
 *   Attempted to call abaValida() from the server but abaValida is on the
 *   client. It's not possible to invoke a client function from the server.
 *
 * O `"use client"` no topo daquele arquivo marca TUDO que ele exporta como
 * cliente — inclusive uma função pura de três linhas. O `tsc` passou limpo, e é
 * o mesmo buraco que o AGENTS.md §4 descreve para SQL: o compilador não vê a
 * fronteira que o runtime cobra.
 *
 * Um módulo sem `"use client"` e sem `server-only` é importável dos dois lados,
 * e é por isso que `custo-empresa-eixos.ts` e `custo-empresa-partes.ts` também
 * são assim.
 */

/**
 * `matriz` olha para TRÁS: agrega `fin_transaction` por (contraparte ×
 * categoria) e responde "com o que a empresa gastou". `contas-a-pagar` olha
 * para FRENTE: lê a agenda e responde "o que sai neste mês".
 *
 * São a mesma pergunta em dois tempos, e é por isso que são abas e não telas
 * separadas: as duas leem a MESMA classificação de bloco e área. Mover uma
 * linha de bloco na matriz reorganiza as duas; telas separadas fariam o dono
 * classificar duas vezes.
 */
export const ABAS = ["matriz", "contas-a-pagar"] as const;
export type AbaCustos = (typeof ABAS)[number];

export function abaValida(valor: string | undefined | null): valor is AbaCustos {
  return valor === "matriz" || valor === "contas-a-pagar";
}
