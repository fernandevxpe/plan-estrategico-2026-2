import { getAgendaDia } from "@/lib/financeiro/contratos/agenda";
import {
  comRessalvas,
  dataDe,
  ParametroInvalido,
  responderContrato,
  rotaDeLeitura
} from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/agenda/dia?dia=YYYY-MM-DD
 *
 * O dia aberto, item a item — o "ir item a item" do pedido.
 *
 * Devolve TODAS as linhas daquele dia, inclusive as que não somam, ordenadas
 * com as somáveis primeiro. A linha suprimida vem junto de propósito: é ela que
 * explica por que o total do dia é menor que a soma visível dos itens, e
 * esconder isso faria o número parecer arbitrário.
 *
 * NO PASSADO, `realizadoCents` E `atrasoDias` PASSAM A EXISTIR. É onde a
 * previsão aprende: a diferença entre o dia esperado e o dia em que o dinheiro
 * de fato se moveu é a única medida honesta da qualidade da agenda.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const dia = dataDe(sp, "dia");
  if (!dia) throw new ParametroInvalido("dia", "informe dia=YYYY-MM-DD");

  const contrato = await getAgendaDia(dia);
  const d = contrato.dado;
  const foraDaSoma = d.linhas.filter((l) => !l.entraNoTotal);
  const comAlerta = d.linhas.filter((l) => l.alertaSobreposicao);
  const semRegra = d.linhas.filter((l) => !l.diaRegra);

  return responderContrato(
    comRessalvas(
      contrato,
      d.dia === null
        ? `${dia} está fora da janela da agenda (ela cobre do primeiro vencimento conhecido até um ano à frente).`
        : null,
      foraDaSoma.length
        ? `${contagem(foraDaSoma.length, "linha deste dia NÃO soma", "linhas deste dia NÃO somam")} ` +
            `(${brl(foraDaSoma.reduce((s, l) => s + (l.valorCents ?? 0), 0))}). ` +
            `Cada uma traz motivoNaoSoma — é por isso que o total do dia é menor que a soma das linhas visíveis.`
        : null,
      comAlerta.length
        ? `${contagem(comAlerta.length, "linha tem", "linhas têm")} a mesma contraparte somando por mais de uma ` +
            `origem nesta competência. Pode ser dois compromissos legítimos ou o mesmo dinheiro duas vezes — ` +
            `o banco não decide isso, só se recusa a esconder a coincidência.`
        : null,
      semRegra.length
        ? `${contagem(semRegra.length, "linha não declara", "linhas não declaram")} POR QUE cai neste dia. ` +
            `Um dia sem regra é um dia que ninguém consegue conferir nem corrigir.`
        : null
    )
  );
});
