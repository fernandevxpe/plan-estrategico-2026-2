import { getAgendaSeries } from "@/lib/financeiro/contratos/agenda";
import { comRessalvas, opcaoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/agenda/series?direcao=&tipo=
 *
 * "Valores que se repetem" — o pedido, nominalmente.
 *
 * Para cada série: quantas vezes já ocorreu, valor típico, desvio medido no
 * ledger, e QUANDO TERMINA.
 *
 * A DISTINÇÃO QUE NÃO PODE SER PERDIDA
 *
 * Recorrente e parcelado têm a MESMA assinatura estatística — densidade 1,00,
 * dispersão 0,00, concentração de dia 1,00, idênticos — e são coisas
 * diferentes: parcelamento acaba, assinatura não. Um detector estatístico
 * superestimou a receita recorrente desta base em 37% justamente por não ver a
 * diferença. A correção não foi ajustar limiar: foi ler o que a FONTE declara.
 *
 * Daí os três tipos, e o campo que os separa:
 *
 *   assinatura ......... contrato declara, sem fim   → fimDeclarado = true
 *   parcelamento ....... contrato declara, com fim   → fimDeclarado = true
 *   padrao_observado ... detectado no histórico      → fimDeclarado = FALSE
 *
 * `padrao_observado` também tem fim nulo, e o fim nulo dele significa "não sei
 * quando acaba" — não "não acaba". `fimDeclarado` é o que separa os dois casos,
 * e uma tela que os pintar igual reintroduz o erro de 37%.
 *
 * `totalEContado = true` avisa que o número de parcelas foi CONTADO por nós:
 * `fin_document.installment_total` está vazio na base inteira, e chamar a
 * contagem de declaração seria inventar uma declaração que a fonte não fez.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getAgendaSeries({
    direcao: sp.get("direcao") ? opcaoDe(sp, "direcao", ["receber", "pagar"] as const, "receber") : undefined,
    tipo: sp.get("tipo")
      ? opcaoDe(sp, "tipo", ["assinatura", "parcelamento", "padrao_observado"] as const, "assinatura")
      : undefined
  });

  const d = contrato.dado;
  const semFimConhecido = d.series.filter((s) => !s.fimDeclarado && s.fim === null);
  const semHistorico = d.series.filter((s) => (s.ocorrenciasMedidas ?? 0) === 0);
  const instaveis = d.series.filter((s) => (s.desvioPct ?? 0) > 30);
  const acabando = d.series.filter((s) => s.mesesRestantes !== null && s.mesesRestantes <= 3 && s.mesesRestantes > 0);

  return responderContrato(
    comRessalvas(
      contrato,
      semFimConhecido.length
        ? `${contagem(semFimConhecido.length, "série tem", "séries têm")} fim NÃO DECLARADO — foram detectadas no ` +
            `histórico, não contratadas. Fim nulo aqui é ignorância, não natureza: não as apresente como assinatura.`
        : null,
      acabando.length
        ? `${contagem(acabando.length, "série termina", "séries terminam")} nos próximos 3 meses ` +
            `(${brl(acabando.reduce((s, x) => s + (x.valorTipicoCents ?? 0), 0))}/mês). ` +
            `Parcelamento que acaba é receita que some do horizonte sem ninguém decidir nada.`
        : null,
      instaveis.length
        ? `${contagem(instaveis.length, "série varia", "séries variam")} mais de 30% em torno da mediana no ledger — ` +
            `o "valor que se repete" delas repete menos do que parece. Ver desvioPct.`
        : null,
      semHistorico.length
        ? `${contagem(semHistorico.length, "série não tem", "séries não têm")} nenhuma ocorrência medida no ledger ` +
            `(contraparte sem lançamento pareado). O valor típico delas vem da declaração, não da observação.`
        : null
    )
  );
});
