import { getMargemPorProjeto } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/margem
 *
 * "Qual custo por obra e por projeto?" — a pergunta com o **teto de fonte** mais
 * duro da base.
 *
 * O centro de custo é atribuído em 1,1% dos lançamentos, e **1,1% é o máximo
 * alcançável neste ledger**: `erp_extrato_linha` tem 861 linhas com 112
 * carimbadas, `erp_contrato` não tem coluna de projeto e `fin_obra_apontamento`
 * está vazia. Não existe segundo caminho. Ou o Adryan carimba retroativamente no
 * erp-obras (dúvida 19), ou este número não sobe — e chegar nele por outro
 * caminho significaria inventar margem por obra a partir de palpite, que é pior
 * que não ter.
 *
 * DUAS COLUNAS QUE IMPEDEM A LEITURA OTIMISTA
 *
 * · `tesourariaCents` vem separado porque o erp-obras carimba projeto
 *   majoritariamente em movimento de TESOURARIA. Aquele valor não é custo de
 *   obra, e somá-lo ao custo inflaria a obra com dinheiro que só passou por ela.
 * · `indefinidoCents` é custo que entrou sem natureza declarada. Margem alta com
 *   indefinido alto é margem frágil, e a ressalva medida nomeia os projetos onde
 *   isso acontece.
 *
 * `margemPct` é null quando a receita é zero — divisão por zero devolvida como
 * 0% diria "margem zero" sobre um projeto que sequer faturou.
 *
 * Custo comum NÃO é rateado. Decisão do Fernando, escolhendo margem de
 * contribuição em vez de lucro por obra: ratear inventaria precisão.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getMargemPorProjeto();

  const semReceita = contrato.dado.filter((p) => p.margemPct === null);
  const comIndefinido = contrato.dado.filter((p) => p.indefinidoCents !== 0);
  const comTesouraria = contrato.dado.filter((p) => p.tesourariaCents !== 0);
  const semContrato = contrato.dado.filter((p) => p.contratoCents === null);

  return responderContrato(
    comRessalvas(
      contrato,
      "TETO DE FONTE: centro de custo cobre ~1,1% dos lançamentos e é o máximo alcançável neste ledger (erp_contrato não tem coluna de projeto, fin_obra_apontamento está vazia). Esta tabela é o que foi carimbado, não o que existe.",
      comIndefinido.length
        ? `${contagem(comIndefinido.length, "projeto tem", "projetos têm")} custo sem natureza declarada, somando ${brl(
            comIndefinido.reduce((s, p) => s + p.indefinidoCents, 0)
          )}. Margem alta com indefinido alto é margem frágil.`
        : null,
      comTesouraria.length
        ? `${contagem(comTesouraria.length, "projeto carrega", "projetos carregam")} ${brl(
            comTesouraria.reduce((s, p) => s + p.tesourariaCents, 0)
          )} em movimento de TESOURARIA. Isso não é custo de obra — vem em coluna própria justamente para não entrar na margem.`
        : null,
      semReceita.length
        ? `${contagem(semReceita.length, "projeto tem", "projetos têm")} margemPct null por não ter receita registrada. Null aqui é "não há base para calcular", não "margem zero".`
        : null,
      semContrato.length
        ? `${contagem(semContrato.length, "projeto não tem", "projetos não têm")} valor de contrato no espelho do ERP (contratoCents null): não dá para dizer se o custo cabe no contratado.`
        : null,
      "Custo comum não é rateado, por decisão do Fernando: a leitura é margem de CONTRIBUIÇÃO, não lucro por obra. Ratear inventaria precisão que a fonte não tem."
    )
  );
});
