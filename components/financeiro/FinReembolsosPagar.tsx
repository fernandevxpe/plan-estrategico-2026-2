"use client";

import { useMemo } from "react";

import type { GestaoReembolsos } from "@/lib/financeiro/reembolsos";
import { monthKeyLabel } from "@/lib/financeiro/format";
import { FinPagarPorPessoa, type LinhaPagar } from "@/components/financeiro/FinPagarPorPessoa";

/**
 * O pagamento de reembolso do mês, por pessoa. A mecânica de seleção e envio
 * mora em FinPagarPorPessoa (compartilhada com comissões); aqui só a
 * composição de cada PIX.
 */

export type LinhaPagarReembolso = Omit<LinhaPagar, "detalhes" | "rotulo">;

export function FinReembolsosPagar({
  dados,
  linhas,
  mesPagamento,
  hoje
}: {
  dados: GestaoReembolsos;
  linhas: LinhaPagarReembolso[];
  mesPagamento: string;
  hoje: string;
}) {
  const P = `${mesPagamento.slice(0, 7)}-01`;

  /* A composição: a mesma conta da linha de Contas a pagar — uma parcela de
     cada série aberta de `fin_reembolso_saldo_unificado_v` com competência até
     o mês do pagamento (app e planilha). Ler `fin_reimbursement_item` direto
     (primeira versão, 02/11) trazia itens de jan–abr/26 que a planilha já
     tinha pago: o Fernando aparecia com R$ 2.208,99 para um PIX de R$ 1.168,47. */
  const completas: LinhaPagar[] = useMemo(
    () =>
      linhas.map((l) => ({
        ...l,
        rotulo: null,
        detalhes: dados.saldoAberto
          .filter((s) => s.personId === l.personId && s.parcelasRestantes > 0 && s.ultimaCompetencia.slice(0, 10) <= P)
          .sort((a, b) => a.origem.localeCompare(b.origem) || a.ultimaCompetencia.localeCompare(b.ultimaCompetencia))
          .map((s) => ({
            chave: s.chave,
            valorCents: s.valorParcelaCents,
            texto:
              s.origem === "app"
                ? `app · ${monthKeyLabel(s.ultimaCompetencia)} · ${s.descricao}${s.parcelasTotal > 1 ? ` (${s.parcela}/${s.parcelasTotal})` : ""}`
                : `planilha · ${s.descricao.replace(/\s*\(?\d+\/\d+\)?\s*$/, "")} · parcela ${s.parcela + 1}/${s.parcelasTotal}`
          }))
      })),
    [linhas, dados, P]
  );

  return (
    <FinPagarPorPessoa
      linhas={completas}
      mesPagamento={mesPagamento}
      hoje={hoje}
      vazio={`Nenhum reembolso a pagar em ${monthKeyLabel(P)}.`}
      cabecalho={
        <>
          Pagamento de <strong>{monthKeyLabel(P)}</strong>: tudo que está em aberto e foi lançado até agora (inclusive
          hoje), mais a parcela do mês de cada série.
        </>
      }
    />
  );
}
