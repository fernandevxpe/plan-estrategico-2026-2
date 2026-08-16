import { getLancamentos, type CampoOrdenacaoLancamento } from "@/lib/financeiro/contratos";
import {
  comRessalvas,
  inteiroDe,
  opcaoDe,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../_medido";
import {
  bandeiraEstritaDe,
  centavosDe,
  intervaloDiarioDe,
  opcaoOpcionalDe,
  ordenacaoDe,
  paginacaoDe
} from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORDENACAO = ["data", "valor", "contraparte", "categoria", "conta"] as const satisfies readonly CampoOrdenacaoLancamento[];
const NATUREZAS = ["entrada", "saida"] as const;

/**
 * GET /api/financeiro/gerencial/lancamentos
 *   ?conta=&nucleo=&categoria=&centroCusto=&contraparte=&de=&ate=&natureza=
 *   &valorMinCents=&valorMaxCents=&busca=&semCategoria=&semContraparte=
 *   &semCentroCusto=&incluirTransferencias=&apenasRevisaoPendente=
 *   &ordenarPor=&direcao=&pagina=&porPagina=
 *
 * O extrato unificado — **o destino de todo drill-down desta API**.
 *
 * Por isso a lista de parâmetros acima não é generosidade: ela é exatamente o
 * conjunto de chaves que os outros domínios emitem em `Drill.filtros`. Um drill
 * que chegue com um filtro que esta rota não conhece devolveria a lista INTEIRA,
 * e o usuário concluiria que o número de origem estava errado. Se algum contrato
 * passar a emitir uma chave nova, ela precisa nascer aqui junto.
 *
 * TRANSFERÊNCIA ENTRE CONTAS PRÓPRIAS FICA OCULTA POR PADRÃO
 *
 * Não é receita nem despesa: são 81 movimentos, R$ 966.069,29, que já estiveram
 * contados como despesa na DRE até a migration 0059. Quem quiser vê-los pede
 * `?incluirTransferencias=1` — e a ressalva medida avisa que, nesse caso, a soma
 * da lista não é receita nem despesa.
 *
 * `porQue` CARREGA O RATIONALE DA CLASSIFICAÇÃO
 *
 * Junto de `classificadoPor`, é o que permite a tela responder "por quê?" sobre
 * cada linha. O invariante D6 existe porque o par incompleto faz esse badge
 * MENTIR sobre quem decidiu — mostraria "regra X" para algo que veio do contrato.
 * A ressalva medida conta quantas linhas da página estão sem rationale.
 *
 * `vazio` distingue "nada casou com o filtro" de "esta fonte nunca foi
 * importada". A mesma lista vazia, dois problemas diferentes, duas telas
 * diferentes.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const incluirTransferencias = bandeiraEstritaDe(sp, "incluirTransferencias");

  const contrato = await getLancamentos(
    {
      conta: textoDe(sp, "conta", 60),
      nucleo: textoDe(sp, "nucleo", 60),
      categoria: textoDe(sp, "categoria", 20),
      centroCusto: textoDe(sp, "centroCusto", 80),
      contraparte: inteiroDe(sp, "contraparte", { min: 1, max: 2_147_483_647 }),
      ...intervaloDiarioDe(sp),
      natureza: opcaoOpcionalDe(sp, "natureza", NATUREZAS),
      valorMinCents: centavosDe(sp, "valorMinCents"),
      valorMaxCents: centavosDe(sp, "valorMaxCents"),
      busca: textoDe(sp, "busca", 120),
      semCategoria: bandeiraEstritaDe(sp, "semCategoria"),
      semContraparte: bandeiraEstritaDe(sp, "semContraparte"),
      semCentroCusto: bandeiraEstritaDe(sp, "semCentroCusto"),
      incluirTransferencias,
      apenasRevisaoPendente: bandeiraEstritaDe(sp, "apenasRevisaoPendente")
    },
    paginacaoDe(sp),
    ordenacaoDe(sp, ORDENACAO, { campo: "data", direcao: "desc" })
  );

  const itens = contrato.dado.itens;
  const soma = itens.reduce((s, l) => s + l.valorCents, 0);
  const semLastro = itens.filter((l) => !l.temLastro);
  const semPorque = itens.filter((l) => l.classificadoPor !== null && l.porQue === null);
  const semCategoria = itens.filter((l) => l.categoriaCode === null);
  const emTransito = itens.filter((l) => l.transferencia === "em_transito");

  return responderContrato(
    comRessalvas(
      contrato,
      itens.length
        ? incluirTransferencias
          ? `Soma desta página: ${brl(soma)} — e ela NÃO é receita nem despesa, porque as transferências entre contas próprias estão incluídas.`
          : `Soma desta página: ${brl(soma)} (${itens.length} de ${contrato.dado.total} linhas do filtro). Transferências próprias estão fora.`
        : null,
      semCategoria.length
        ? `${contagem(semCategoria.length, "linha desta página está", "linhas desta página estão")} sem categoria: o dinheiro andou e está no saldo; o que falta é a natureza dele. Elas não somem da DRE — caem na lacuna.`
        : null,
      semLastro.length
        ? `${contagem(semLastro.length, "linha não tem", "linhas não têm")} lastro de origem (temLastro false): o valor veio do extrato, mas não há identificador externo que prove a contraparte.`
        : null,
      semPorque.length
        ? `${contagem(semPorque.length, "linha tem", "linhas têm")} classificadoPor preenchido e porQue null: a tela não consegue responder "por quê?" nelas. É o padrão que o invariante D6 vigia.`
        : null,
      emTransito.length
        ? `${contagem(emTransito.length, "linha está", "linhas estão")} com transferência em_transito: uma perna foi vista, a outra não. Enquanto o par não fecha, elas não são despesa nem receita — e nem transferência provada.`
        : null,
      !incluirTransferencias
        ? "Sem ?incluirTransferencias=1 a rota devolve apenas transfer_status = 'nao'. Isso esconde também as linhas em_transito, cuja outra perna nunca apareceu — elas existem e não estão nesta contagem."
        : null
    )
  );
});
