import { getCartaoDetalhe, getFilhosDoCartao } from "@/lib/financeiro/contratos";
import {
  comRessalvas,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/cartao/detalhe
 * GET /api/financeiro/gerencial/cartao/detalhe?pai=sub:7:5
 *
 * O detalhamento máximo do cartão: a árvore emissor → linha → fatura →
 * subcartão → item, o histórico por competência e por caixa, os planos de
 * parcelamento inteiros e as lacunas.
 *
 * ---------------------------------------------------------------------------
 * DOIS NÚMEROS, NENHUMA SOMA
 * ---------------------------------------------------------------------------
 * `competencia` e `caixa` são séries SEPARADAS, com meses diferentes e totais
 * diferentes, e nunca compartilham campo. Medido no acervo:
 *
 *   competência (itens) .... R$  84.058,09
 *   caixa (fatura paga) .... R$ 107.600,75
 *   somar daria ............ R$ 191.658,84   ← R$ 61.550,10 a mais do que
 *                                              tudo que os emissores cobraram
 *
 * A fatura de março é paga em março com compras de fevereiro: os dois lados nem
 * caem no mesmo mês. Qualquer cliente que somar as duas séries está errado, e a
 * ressalva medida abaixo diz isso com o número do dia.
 *
 * ---------------------------------------------------------------------------
 * O `pai` NÃO É UM FILTRO GENÉRICO
 * ---------------------------------------------------------------------------
 * Ele é a chave de um nó da própria árvore, e a consulta filtra por
 * `chave_pai` — a mesma coluna com que a árvore se monta. Não existe um segundo
 * critério de "quem é filho de quem" que pudesse divergir do primeiro. Chave
 * inexistente devolve lista vazia com a ressalva, não erro: um ramo que a fonte
 * não itemiza é um resultado legítimo.
 *
 * SOMENTE LEITURA.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const pai = textoDe(sp, "pai", 200);

  if (pai) {
    const filhos = await getFilhosDoCartao(pai);
    if (!filhos.disponivel) return responderContrato(filhos);
    return responderContrato(
      comRessalvas(
        filhos,
        filhos.dado.length
          ? `${contagem(filhos.dado.length, "nó", "nós")} sob \`${pai}\`, somando ${brl(
              filhos.dado.reduce((s, f) => s + f.valorCents, 0)
            )}. Este valor é a composição do nó pai, não uma parcela nova a somar.`
          : null,
        filhos.dado.some((f) => f.motivo)
          ? `${contagem(
              filhos.dado.filter((f) => f.motivo).length,
              "nó traz motivo",
              "nós trazem motivo"
            )}: é a parte que a fonte não explica, e ela tem linha própria em vez de ser diluída.`
          : null
      )
    );
  }

  const contrato = await getCartaoDetalhe();

  // INDISPONÍVEL NÃO GANHA RESSALVA MEDIDA, E ISTO FOI UM DEFEITO REAL AQUI.
  //
  // As frases abaixo são derivadas do dado. Sobre o VAZIO elas viravam
  // afirmações falsas sobre dinheiro — a resposta 503 dizia, literalmente,
  // "competência R$ 0,00 e caixa R$ 0,00 são medidas diferentes; somá-las daria
  // R$ 0,00 — mais do que tudo que os emissores já cobraram". Zero é uma
  // afirmação sobre o dinheiro; aqui não havia dinheiro nenhum medido, havia
  // uma view faltando. A única ressalva legítima nesse estado é a que o próprio
  // contrato já traz: qual view falta.
  if (!contrato.disponivel) return responderContrato(contrato);

  const d = contrato.dado;

  const competencia = d.competencia
    .filter((c) => c.faixa === "item")
    .reduce((s, c) => s + c.valorCents, 0);
  const naoItemizado = d.competencia
    .filter((c) => c.faixa === "nao_itemizado")
    .reduce((s, c) => s + c.valorCents, 0);
  const caixa = d.caixa.reduce((s, k) => s + k.saiuCents, 0);
  const semCategoriaNoCaixa = d.saidas.filter((s) => s.categoriaCode === null);
  const atravessam = d.planos.filter((p) => p.atravessaReemissao);
  const parciais = d.saidas.filter((s) => s.diferencaCents !== 0);

  return responderContrato(
    comRessalvas(
      contrato,
      `competência ${brl(competencia)} e caixa ${brl(caixa)} são medidas DIFERENTES do mesmo cartão. ` +
        `Somá-las daria ${brl(competencia + caixa)} — mais do que tudo que os emissores já cobraram. ` +
        `A fatura de um mês é paga naquele mês com compras do anterior: os dois lados nem caem no mesmo mês.`,
      naoItemizado
        ? `${brl(naoItemizado)} das faturas não é explicado por item nenhum — a fonte não itemiza. ` +
            `Isso aparece como nó próprio, com motivo, e NÃO é fechado por diferença: diluir esse buraco ` +
            `entre os itens conhecidos criaria dono para gasto alheio.`
        : null,
      semCategoriaNoCaixa.length
        ? `${contagem(
            semCategoriaNoCaixa.length,
            "pagamento de fatura está",
            "pagamentos de fatura estão"
          )} sem categoria (${brl(semCategoriaNoCaixa.reduce((s, x) => s + x.saiuCents, 0))}). ` +
            `Por isso o caixa do cartão é ancorado em fin_card_bill.paid_transaction_id e não na categoria 9.01: ` +
            `medir por rótulo esconderia exatamente a linha cuja classificação está em aberto.`
        : null,
      d.cobertura.semCategoria
        ? `${contagem(d.cobertura.semCategoria, "item de cartão segue", "itens de cartão seguem")} sem categoria ` +
            `(${brl(d.cobertura.semCategoriaCents)} de ${d.cobertura.itens}) e ` +
            `${d.cobertura.semTitular} sem titular, em ${d.cobertura.subcartoesSemTitular} subcartões sem dono declarado. ` +
            `Nenhum dos dois é deduzido: a fonte não devolve owner, e categoria adivinhada entra na DRE como fato.`
        : null,
      atravessam.length
        ? `${contagem(atravessam.length, "plano de parcelamento atravessa", "planos de parcelamento atravessam")} ` +
            `mais de um final de cartão e continua sendo UM plano. A troca de plástico NÃO está declarada em ` +
            `fin_card (replaces_card_id nulo): ela é inferida pela continuidade da numeração das parcelas.`
        : null,
      parciais.length
        ? `${contagem(parciais.length, "fatura foi paga", "faturas foram pagas")} por valor diferente do declarado. ` +
            `A diferença aparece com nome próprio — absorvê-la no total faria a fatura parecer quitada ao centavo.`
        : null,
      d.comprometidoFuturoCents
        ? `${brl(d.comprometidoFuturoCents)} já comprometidos em ${d.comprometidoFuturoLinhas} linha(s) de meses ` +
            `à frente. É COMPETÊNCIA: essas parcelas ainda não viraram fatura e não saíram de conta nenhuma.`
        : null
    )
  );
});
