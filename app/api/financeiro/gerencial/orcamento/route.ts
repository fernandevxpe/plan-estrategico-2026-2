import { getOrcadoRealizado } from "@/lib/financeiro/contratos";
import { anoDe, comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/orcamento?ano=
 *
 * Orçado × realizado. **Esta é a rota em que a regra "ausência não é zero" é mais
 * fácil de quebrar e mais cara de quebrar.**
 *
 * `fin_orcado_realizado_v` devolve 75 linhas com `realizado` NULL — e isso está
 * CERTO. As 114 metas de `fin_budget_target` são 100% de escopo `obras`, e o
 * realizado delas mora no ledger do erp-obras, que esta plataforma só lê e onde
 * ela não tem como somar por linha de orçamento. O motivo vem escrito na própria
 * linha (`realizado_indeterminado_motivo`) e chega em `realizado.motivo`.
 *
 *   `realizado: { valorCents: null, motivo: "..." }`   ← o que esta rota devolve
 *   `realizado: 0`                                     ← a mentira que ela recusa
 *
 * Zero é uma afirmação sobre o dinheiro ("a meta não foi consumida, sobra
 * tudo"). Ausência é uma afirmação sobre o dado ("não sei, e eis por quê"). Uma
 * tela que receba 0 desenha 0% de consumo e conclui que há orçamento livre —
 * exatamente a decisão errada. Por isso `consumoPct` também é null quando o
 * realizado é indeterminado: uma porcentagem calculada sobre um número que não
 * existe é pior que a ausência dela.
 *
 * `disponivel` é `Medida`, não número: meta − realizado − comprometido só existe
 * onde o realizado existe. E `comprometidoCents` é o que já está na fila de
 * pagamento e ainda não virou caixa — sem ele, "disponível" diria que há dinheiro
 * que já tem dono.
 *
 * Comparar meta de obras com realizado da holding produziria uma variação que não
 * significa nada. O contrato se recusa a fazê-lo, e a rota não desfaz a recusa.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getOrcadoRealizado(anoDe(sp));

  const indeterminadas = contrato.dado.filter((l) => l.realizado.valorCents === null);
  const motivos = [...new Set(indeterminadas.map((l) => l.realizado.motivo ?? "sem motivo declarado"))];
  const escopos = [...new Set(contrato.dado.map((l) => l.escopo))];
  const metaIndeterminada = indeterminadas.reduce((s, l) => s + l.metaCents, 0);

  return responderContrato(
    comRessalvas(
      contrato,
      indeterminadas.length
        ? `${indeterminadas.length} de ${contrato.dado.length} linhas têm realizado.valorCents = NULL, cobrindo ${brl(metaIndeterminada)} de meta. ` +
            `NÃO leia null como zero: zero afirmaria que a meta não foi consumida e que sobra tudo. Motivo(s) declarado(s): ${lista(motivos, 3)}.`
        : null,
      indeterminadas.length
        ? `Nessas ${contagem(indeterminadas.length, "linha", "linhas")}, consumoPct e disponivel.valorCents também vêm null — porcentagem calculada sobre número inexistente é pior que a ausência dela.`
        : null,
      escopos.length
        ? `Escopo das metas retornadas: ${lista(escopos)}. Meta de obras comparada com realizado da holding produz variação que não significa nada; o contrato se recusa a cruzá-los.`
        : null,
      contrato.disponivel && contrato.dado.length === 0
        ? "Nenhuma meta cadastrada para o ano pedido. Isso é ausência de orçamento declarado, não orçamento de R$ 0,00."
        : null
    )
  );
});
