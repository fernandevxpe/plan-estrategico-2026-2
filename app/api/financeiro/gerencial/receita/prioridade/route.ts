import { getPrioridadeReceita } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";
import { mesEstritoDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/receita/prioridade?mes=
 *
 * A curva ABC de receita — a **prioridade nº 3 declarada pelo Fernando**, com as
 * palavras dele: *"quero ver por grupo e todo detalhe dos principais, facilitando
 * saber quais receitas são importantes não deixar de receber do mês"*.
 *
 * Uma lista de 255 cobranças ordenada por valor não responde essa pergunta. A
 * concentração responde: a faixa A é quem, se atrasar, muda o mês. Por isso o
 * contrato devolve `pctDoMes` e `pctAcumulado` linha a linha, e cada linha traz
 * o `drill` que a abre em `receber` — número que não se abre não é auditável.
 *
 * A ressalva medida diz quantos clientes formam a faixa A e quanto eles valem.
 * Sem ela, a tela precisaria refazer a soma para descobrir o tamanho do risco, e
 * duas somas da mesma coisa acabam divergindo.
 *
 * Sem `?mes=` devolve os últimos meses (teto de 500 linhas na view), mais recente
 * primeiro — a série, não só a foto.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getPrioridadeReceita(mesEstritoDe(sp, "mes"));

  const mesMaisRecente = contrato.dado[0]?.mes ?? null;
  const doMes = mesMaisRecente ? contrato.dado.filter((l) => l.mes === mesMaisRecente) : [];
  const faixaA = doMes.filter((l) => l.faixa === "A");
  const semCliente = doMes.filter((l) => l.clienteId === null);

  return responderContrato(
    comRessalvas(
      contrato,
      faixaA.length && mesMaisRecente
        ? `Em ${mesMaisRecente.slice(0, 7)}, ${contagem(faixaA.length, "cliente sustenta", "clientes sustentam")} ` +
            `${faixaA[faixaA.length - 1].pctAcumulado.toFixed(1)}% do mês, somando ${brl(faixaA.reduce((s, l) => s + l.totalCents, 0))}. ` +
            `É essa a lista de cobrança: o que a faixa A atrasar, o mês sente.`
        : null,
      semCliente.length
        ? `${contagem(semCliente.length, "linha do mês não tem", "linhas do mês não têm")} contraparte identificada (clienteId null). ` +
            `Elas continuam somando no total do mês — o que falta é o nome de quem deve, não o dinheiro.`
        : null,
      contrato.disponivel && contrato.dado.length === 0
        ? "Nenhuma linha em fin_receita_prioridade_v para o recorte pedido. Isso é ausência de cobrança na janela, não receita zero — confira o mês antes de concluir."
        : null
    )
  );
});
