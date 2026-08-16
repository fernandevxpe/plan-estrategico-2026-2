import { getCartao } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/cartao
 *
 * Linhas de crédito, subcartões, faturas e — o campo que dá sentido à tela — as
 * `lacunas`, cada uma com escopo, valor e MOTIVO.
 *
 * O CARTÃO É O MAIOR PONTO CEGO CONHECIDO DESTA BASE
 *
 * O painel diz 98,8% classificado e **está certo**: ele mede `fin_transaction`, e
 * item de cartão não é `fin_transaction`. Foram R$ 194.205,99 em 795 itens com
 * zero categoria descobertos exatamente do lado de fora do indicador que a frente
 * vizinha estava otimizando. As `lacunas` existem para que esse buraco chegue à
 * tela junto do número, em vez de ser descoberto de novo por auditoria.
 *
 * CAIXA E COMPETÊNCIA SÃO DOIS CAMPOS SEPARADOS, E NÃO SE SOMAM
 *
 *   `competenciaMesAtualCents`         o custo dos itens no mês — NÃO é caixa
 *   `caixaPagamentoFatura12mCents`     o que saiu da conta corrente pagando fatura
 *
 * Cartão não é `fin_account` (o CHECK de `fin_account.kind` nem aceita o valor):
 * só o pagamento da fatura movimenta caixa; o custo vem dos itens, na competência.
 * Somar os dois conta a mesma compra duas vezes.
 *
 * `limiteConsolidado` marca as linhas em que a fonte só entrega o limite do
 * conjunto. Não se rateia limite por subcartão, e `titular` fica null quando a
 * fonte não diz de quem é — atribuir por dedução criaria dono para gasto alheio.
 *
 * `coberturaItensPct` diz quanto de cada fatura o sistema explica item a item.
 * O Inter não tem API de cartão (provado): parte da itemização não existe e não
 * vai existir por esse caminho.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getCartao();
  const d = contrato.dado;

  const consolidadas = d.linhas.filter((l) => l.limiteConsolidado);
  const semTitular = d.linhas.flatMap((l) => l.subcartoes).filter((s) => s.titular === null);
  const parciais = d.faturas.filter((f) => f.coberturaItensPct !== null && f.coberturaItensPct < 100);
  const semCobertura = d.faturas.filter((f) => f.coberturaItensPct === null);

  return responderContrato(
    comRessalvas(
      contrato,
      d.lacunas.length
        ? `${contagem(d.lacunas.length, "lacuna declarada", "lacunas declaradas")}, somando ${brl(
            d.lacunas.reduce((s, l) => s + l.valorCents, 0)
          )} em ${d.lacunas.reduce((s, l) => s + l.itens, 0)} item(ns): ${lista(d.lacunas.map((l) => l.lacuna))}. ` +
            `Cada uma traz o motivo — o cartão vive fora do indicador de classificação do ledger, e é assim que R$ 194.205,99 ficaram invisíveis.`
        : null,
      `competenciaMesAtualCents (${brl(d.competenciaMesAtualCents)}) é COMPETÊNCIA e caixaPagamentoFatura12mCents (${brl(
        d.caixaPagamentoFatura12mCents
      )}) é CAIXA. Não some: só o pagamento da fatura movimenta conta; o custo vem dos itens.`,
      parciais.length || semCobertura.length
        ? `${contagem(parciais.length, "fatura é explicada", "faturas são explicadas")} apenas em parte pelos itens` +
            (semCobertura.length ? `, e ${semCobertura.length} não têm cobertura medida (null, não 0%)` : "") +
            `. O Inter não tem API de cartão: parte dessa itemização não existe e não virá por esse caminho.`
        : null,
      consolidadas.length
        ? `${contagem(consolidadas.length, "linha traz", "linhas trazem")} limite consolidado (${lista(
            consolidadas.map((l) => l.slug)
          )}): a fonte só dá o limite do conjunto. Não ratear por subcartão — o rateio inventaria um limite que ninguém contratou.`
        : null,
      semTitular.length
        ? `${contagem(semTitular.length, "subcartão está", "subcartões estão")} sem titular (null): a fonte não diz de quem é. Atribuir por dedução criaria dono para gasto alheio.`
        : null
    )
  );
});
