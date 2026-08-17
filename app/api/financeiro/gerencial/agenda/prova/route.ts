import { getAgendaProva } from "@/lib/financeiro/contratos/agenda";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/agenda/prova
 *
 * A prova de que a agenda não conta o mesmo dinheiro duas vezes, exposta como
 * rota para que ela possa ser cobrada de fora — por um monitor, por um teste de
 * CI, por quem estiver desconfiado do total na tela.
 *
 * DUAS AFIRMAÇÕES, AS DUAS VERIFICÁVEIS
 *
 * 1. `duplicadas = 0` — entre as linhas que SOMAM, `chaveDedupe` é única. Duas
 *    linhas somáveis com a mesma chave são o mesmo dinheiro contado duas vezes,
 *    que é exatamente o defeito de R$ 1,27 milhão da migration 0060.
 *
 * 2. `deltaExplicado` em todo mês — a soma da agenda bate com
 *    `fin_previsao_evento_v`, a previsão mensal já validada, com uma exceção
 *    declarada: item manual e ajuste de confirmação. Os dois são decisão humana
 *    e por isso divergem legitimamente da projeção; qualquer outro delta é
 *    dupla contagem ou linha perdida.
 *
 * A mesma conta roda como assertiva dentro da própria migration 0104 e no
 * `scripts/test-agenda-dia.mjs`. Três lugares porque o custo de estar errado
 * aqui é alto e silencioso: um total inflado não parece errado, parece bom.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getAgendaProva();
  const d = contrato.dado;
  const ruins = d.prova.filter((p) => !p.deltaExplicado);
  const comDecisao = d.prova.filter((p) => p.manualCents !== 0 || p.ajusteHumanoCents !== 0);

  return responderContrato(
    comRessalvas(
      contrato,
      d.duplicadas
        ? `${contagem(d.duplicadas, "chave de deduplicação aparece", "chaves de deduplicação aparecem")} ` +
            `em mais de uma linha SOMÁVEL. Isto é dupla contagem — não é ruído e não se ignora.`
        : null,
      ruins.length
        ? `${contagem(ruins.length, "mês não bate", "meses não batem")} com a previsão validada: ` +
            ruins.map((p) => `${p.competencia.slice(0, 7)}/${p.direcao} delta ${brl(p.deltaCents)}`).join(", ")
        : null,
      d.ok
        ? `Prova OK: ${d.prova.length} confronto(s) mês×direção, delta explicado em todos, zero chaves repetidas.`
        : null,
      comDecisao.length
        ? `${contagem(comDecisao.length, "confronto tem", "confrontos têm")} delta legítimo por decisão humana ` +
            `(item manual ou ajuste de confirmação). Delta legítimo não é delta zero — é delta EXPLICADO.`
        : null
    )
  );
});
