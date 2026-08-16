import { getReembolsos } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/reembolsos
 *
 * O contrato de tela dos reembolsos. Não confundir com `/api/financeiro/reembolsos`,
 * que é a rota operacional (GET + POST) sobre `lib/financeiro/reembolsos.ts`.
 * Esta aqui é somente leitura e traz o envelope completo.
 *
 * `aprovadoNaoPagoCents` É DÍVIDA COM O TIME, E NÃO APARECE NO A PAGAR
 *
 * Reembolso aprovado e sem documento de pagamento já foi reconhecido e ainda não
 * saiu. Ele não aparece em `/api/financeiro/gerencial/pagar` porque o a pagar
 * ainda não existe como camada nesta base (dúvida 28: a empresa tem "contas
 * pagas", não "contas a pagar"). Se esta rota não o expuser, é uma obrigação real
 * que nenhuma tela mostra — e a pessoa que a cobra é o único monitor.
 *
 * `itensSemComprovante` é o que trava a aprovação: sem nota nem recibo não há
 * como sustentar a saída. A contagem viaja por reembolso justamente para a fila
 * saber o que é decisão e o que é falta de documento.
 *
 * O reembolso é pago no mês seguinte junto do fixo e classificado como salário —
 * ele **já está dentro do caixa**. Somar este painel à folha de
 * `/api/financeiro/gerencial/pessoas` contaria ~R$ 6 mil/mês duas vezes; a regra
 * está gravada no schema para ninguém somar de novo.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getReembolsos();
  const d = contrato.dado;

  const travados = d.reembolsos.filter((r) => r.itensSemComprovante > 0);
  const aprovadoSemPagamento = d.reembolsos.filter((r) => r.aprovadoEm !== null && r.documentoPagamentoId === null);
  const semAprovador = d.reembolsos.filter((r) => r.aprovadoEm !== null && r.aprovadoPor === null);

  return responderContrato(
    comRessalvas(
      contrato,
      d.aprovadoNaoPagoCents !== 0
        ? `${brl(d.aprovadoNaoPagoCents)} em ${contagem(aprovadoSemPagamento.length, "reembolso aprovado", "reembolsos aprovados")} e ainda não pagos — ` +
            `dívida reconhecida com o time que NÃO aparece em /api/financeiro/gerencial/pagar, porque o a pagar não existe como camada (dúvida 28).`
        : null,
      d.aguardandoAprovacaoCents !== 0
        ? `${brl(d.aguardandoAprovacaoCents)} enviados e aguardando aprovação.`
        : null,
      travados.length
        ? `${contagem(travados.length, "reembolso tem", "reembolsos têm")} item sem nota nem recibo (${travados.reduce(
            (s, r) => s + r.itensSemComprovante,
            0
          )} item(ns) no total): a aprovação está travada por falta de documento, não por falta de decisão.`
        : null,
      semAprovador.length
        ? `${contagem(semAprovador.length, "reembolso está", "reembolsos estão")} aprovados sem autor registrado (aprovadoPor null): ${lista(
            semAprovador.map((r) => `#${r.id}`)
          )}. Decisão sem autor não é auditável.`
        : null,
      "Este total NÃO se soma à folha: o reembolso é pago no mês seguinte junto do fixo e já entra como salário. Somá-lo inflaria a folha em ~R$ 6 mil/mês."
    )
  );
});
