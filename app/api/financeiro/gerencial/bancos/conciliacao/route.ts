import { getConciliacao } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/bancos/conciliacao
 *
 * Quanto do volume já tem liquidação casada — e onde o espelho do ERP discorda
 * deste ledger.
 *
 * MEDIDO EM REAIS, NÃO EM LINHAS
 *
 * `pctConciliado` é volume, não contagem. Uma cobrança de R$ 15 mil pesa mais que
 * trinta de R$ 60, e um percentual por linha diria "97% conciliado" com o dinheiro
 * que importa de fora. Liquidação parcial conta como parcial (LEAST), nem zero nem
 * cheia.
 *
 * `transferenciasSuspeitas` É O ACHADO QUE JUSTIFICA A TELA
 *
 * São pares casados por coincidência de valor + data unindo contrapartes
 * DISTINTAS. O par parece uma transferência interna e por isso sai da DRE — já
 * escondeu R$ 3.000 de receita e R$ 3.000 de despesa reais de uma vez. Cada linha
 * vem com `motivo` e com as contrapartes nomeadas: a decisão é humana, e sem os
 * nomes ao lado ela seria um chute.
 *
 * `espelhoErp[].paridade` compara mês a mês contagem e valor contra
 * `erp_extrato_reconciliacao_v`. O erp-obras é **somente leitura** — divergência
 * aqui é dado a levar ao Adryan, nunca escrita a fazer lá.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getConciliacao();
  const d = contrato.dado;

  const semParidade = d.espelhoErp.filter((m) => !m.paridade);
  const naoConciliadoCents = d.totalCents - d.conciliadoCents;

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel
        ? `${d.pctConciliado.toFixed(1)}% do volume tem liquidação casada (${brl(d.conciliadoCents)} de ${brl(d.totalCents)}). ` +
            `Faltam ${brl(naoConciliadoCents)} em ${d.naoConciliados} lançamento(s) sem nenhuma liquidação.`
        : null,
      d.transferenciasSuspeitas.length
        ? `${contagem(d.transferenciasSuspeitas.length, "par é suspeito", "pares são suspeitos")}, somando ${brl(
            d.transferenciasSuspeitas.reduce((s, t) => s + t.valorCents, 0)
          )}: casaram por valor+data mas unem contrapartes diferentes. ` +
            `Se forem falsos, há receita E despesa reais escondidas fora da DRE — cada linha traz o motivo e as contrapartes para a decisão humana.`
        : null,
      semParidade.length
        ? `Espelho do ERP sem paridade em ${lista(semParidade.map((m) => `${m.mes.slice(0, 7)} (${brl(m.deltaCents)})`))}. ` +
            `O erp-obras é somente leitura: divergência aqui é assunto para o Adryan, não escrita a fazer lá.`
        : null,
      "pctConciliado é medido em R$, não em número de linhas — trocar a régua faria o percentual subir sem que nada tivesse melhorado."
    )
  );
});
