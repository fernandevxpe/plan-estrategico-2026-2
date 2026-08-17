import {
  ESTADOS,
  PROCEDENCIAS,
  UNIVERSOS,
  getBuscaCategorizacao,
  type CampoOrdenacaoBusca
} from "@/lib/financeiro/contratos/categorizacao";
import { inteiroDe, responderContrato, rotaDeLeitura, textoDe } from "@/lib/financeiro/contratos/http";

import {
  bandeiraEstritaDe,
  centavosDe,
  intervaloDiarioDe,
  opcaoOpcionalDe,
  ordenacaoDe,
  paginacaoDe
} from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORDENACAO = [
  "data",
  "valor",
  "descricao",
  "categoria",
  "universo",
  "estado",
  "procedencia"
] as const satisfies readonly CampoOrdenacaoBusca[];

/**
 * Entrada/saída chega como `natureza`, exatamente o nome que a rota do extrato
 * (`gerencial/lancamentos`) já usa. Não é gosto: `direcao` é o parâmetro de
 * ORDENAÇÃO (asc/desc) em toda esta API, e reusá-lo aqui faria `?direcao=saida`
 * virar 400 por um motivo que ninguém conseguiria adivinhar da mensagem.
 */
const NATUREZAS = ["entrada", "saida"] as const;

/**
 * GET /api/financeiro/gerencial/categorizacao/busca
 *   ?busca=&universo=&categoria=&semCategoria=&nucleo=&centroCusto=&contraparte=
 *   &de=&ate=&valorMinCents=&valorMaxCents=&natureza=&estado=&procedencia=
 *   &travado=&apenasClassificavel=&ordenarPor=&direcao=&pagina=&porPagina=
 *
 * A busca que atravessa os TRÊS universos onde existe categoria.
 *
 * POR QUE ELA PRECISA EXISTIR
 *
 * O indicador "categoria atribuída" mede `fin_transaction` e está certo — é o
 * que o nome dele diz. O efeito colateral é que 889 itens somando
 * R$ 313.559,52, em `fin_document` e `fin_card_transaction`, não aparecem em
 * indicador nenhum: 389 documentos (R$ 259.432,76) e 500 itens de cartão
 * (R$ 54.126,76). Não estão errados — estão fora da régua. Esta rota é a
 * primeira régua que os alcança.
 *
 * `?ordenarPor=` PASSA POR LISTA BRANCA
 *
 * Campo desconhecido é 400, não "ordena por outra coisa e devolve 200". Quem
 * lê a primeira página de uma lista mal ordenada conclui que aqueles são os
 * maiores valores — e age sobre isso.
 *
 * A ORDEM DO DESEMPATE É PARTE DO CONTRATO
 *
 * Depois do campo pedido vêm `universo` e `id`. Sem chave estável, duas
 * páginas seguidas com valores empatados repetem uma linha e omitem outra.
 *
 * O TOTAL POR UNIVERSO NÃO SE SOMA
 *
 * `fin_card_transaction.amount_cents` tem sinal de dívida e
 * `fin_transaction.amount_cents` tem sinal de caixa (0047). A resposta traz
 * `porUniverso` separado e a ressalva medida diz por quê.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getBuscaCategorizacao(
    {
      busca: textoDe(sp, "busca", 120),
      universo: opcaoOpcionalDe(sp, "universo", UNIVERSOS),
      categoria: textoDe(sp, "categoria", 20),
      semCategoria: bandeiraEstritaDe(sp, "semCategoria"),
      nucleo: textoDe(sp, "nucleo", 60),
      centroCusto: textoDe(sp, "centroCusto", 80),
      contraparte: inteiroDe(sp, "contraparte", { min: 1, max: 2_147_483_647 }),
      ...intervaloDiarioDe(sp),
      valorMinCents: centavosDe(sp, "valorMinCents"),
      valorMaxCents: centavosDe(sp, "valorMaxCents"),
      direcao: opcaoOpcionalDe(sp, "natureza", NATUREZAS),
      estado: opcaoOpcionalDe(sp, "estado", ESTADOS),
      procedencia: opcaoOpcionalDe(sp, "procedencia", PROCEDENCIAS),
      // Ausente é "tanto faz"; presente é filtro. `bandeiraEstritaDe` não
      // distingue os dois, e aqui a diferença muda o resultado.
      travado: sp.get("travado") === null || sp.get("travado") === "" ? undefined : bandeiraEstritaDe(sp, "travado"),
      apenasClassificavel: bandeiraEstritaDe(sp, "apenasClassificavel")
    },
    paginacaoDe(sp),
    ordenacaoDe(sp, ORDENACAO, { campo: "data", direcao: "desc" })
  );

  if (!contrato.disponivel) return responderContrato(contrato);

  const { porUniverso, travados, pagina } = contrato.dado;
  const indeterminados = porUniverso.reduce((s, u) => s + u.indeterminados, 0);
  const foraDoPainel = porUniverso
    .filter((u) => u.universo !== "lancamento" && u.indeterminados > 0)
    .map((u) => `${u.indeterminados} em ${u.universo}`);

  return responderContrato({
    ...contrato,
    ressalvas: [
      ...(indeterminados > 0
        ? [
            `${indeterminados} de ${pagina.total} item(ns) do filtro estão indeterminados — ` +
              `cada um traz o motivo em \`motivoIndeterminado\`, e \`sem-motivo-declarado\` é achado, não vazio.`
          ]
        : []),
      ...(foraDoPainel.length
        ? [
            `Fora da régua do painel: ${foraDoPainel.join(" e ")}. ` +
              `O indicador "categoria atribuída" só mede fin_transaction.`
          ]
        : []),
      ...(travados > 0
        ? [`${travados} item(ns) do filtro estão travados por decisão humana e resistem a reclassificação automática.`]
        : []),
      ...contrato.ressalvas
    ]
  });
});
