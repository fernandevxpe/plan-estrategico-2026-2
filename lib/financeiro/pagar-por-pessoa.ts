import type { ContaAPagar, ContasAPagar } from "@/lib/financeiro/contas-a-pagar";
import { MOTIVO_IMPEDIMENTO, ROTULO_PACOTE } from "@/lib/financeiro/contas-a-pagar-eixos";
import type { LinhaPagar } from "@/components/financeiro/FinPagarPorPessoa";

/**
 * As linhas de Contas a pagar de UMA natureza de pessoa, no formato da tabela
 * "pagar por pessoa" (reembolsos e comissões). A linha de lá é a que vira
 * ordem; ler daqui garante a mesma `chaveDedupe` nas duas telas.
 *
 * `origemRef` é `fin_person:N:reembolso` ou `fin_person:N:comissao:<pacote>`.
 */
export function linhasPagarPorPessoa(contas: ContasAPagar, natureza: "reembolso" | "comissao"): LinhaPagar[] {
  return contas.linhas
    .filter((l) => l.origemTabela === "fin_person" && l.origemId != null)
    .filter((l) => (l.origemRef ?? "").split(":")[2] === natureza)
    .map((l) => paraLinha(l, natureza));
}

function paraLinha(l: ContaAPagar, natureza: "reembolso" | "comissao"): LinhaPagar {
  const pacote = natureza === "comissao" ? ((l.origemRef ?? "").split(":")[3] ?? null) : null;
  return {
    chaveDedupe: l.chaveDedupe,
    personId: Number(l.origemId),
    pessoa: l.contraparte ?? "—",
    rotulo: pacote ? (ROTULO_PACOTE as Record<string, string>)[pacote] ?? pacote : null,
    valorCents: l.valorCents,
    counterpartyId: l.counterpartyId,
    descricao: l.descricao,
    categoryId: l.categoryId,
    nucleo: l.nucleo,
    origemTabela: l.origemTabela,
    origemId: l.origemId,
    pix: l.pixMascarado,
    impedimento: l.impedimento ? MOTIVO_IMPEDIMENTO[l.impedimento] : null,
    ordem: l.ordem ? { id: l.ordem.id, code: l.ordem.code, status: l.ordem.status, pagoCents: l.ordem.pagoCents } : null,
    detalhes: l.pedacos.map((p) => ({
      chave: `c-${p.id}`,
      valorCents: p.valorCents,
      texto: `${p.descricao}${p.parcelasTotal && p.parcelasTotal > 1 && !/\(\d+\/\d+\)/.test(p.descricao) ? ` (${p.parcela}/${p.parcelasTotal})` : ""}${p.tipoNome ? ` · ${p.tipoNome}` : ""}`
    })),
    // Memória do financeiro (folha-competencia-e-nubank): comissão de obra
    // sai pelo Nubank. Avisar evita mandar pelo Inter o que já vai por lá.
    alerta: pacote === "obras" ? "obra costuma sair pelo Nubank — confira antes de enviar pelo Inter" : null
  };
}
