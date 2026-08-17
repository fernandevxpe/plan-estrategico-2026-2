import { getDreResultado } from "@/lib/financeiro/contratos/dre-resultado";
import type { Visao } from "@/lib/financeiro/contratos/resultado";
import { comRessalvas, opcaoDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";
import { mesEstritoDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VISOES = ["caixa", "competencia"] as const satisfies readonly Visao[];

/**
 * GET /api/financeiro/gerencial/dre/resultado?visao=&mes=
 *
 * O ESQUELETO da DRE do mês: as mesmas linhas do drill MAIS os subtotais, mais
 * os ajustes declarados, os meses disponíveis e o catálogo de destino do mover.
 *
 * Por que não é o `/drill`: o drill devolve só linha de tipo ITEM, porque é o
 * que tem lançamento embaixo. Uma DRE sem "Receita líquida" e "Lucro líquido"
 * no meio obriga o leitor a somar de cabeça — e quem soma de cabeça erra o
 * sinal da dedução. Os dois leem `fin_dre_v`; a tela confere um contra o outro
 * à vista, em vez de escolher um e torcer.
 *
 * A seção de AJUSTE vem separada por construção (`origem='declarado'`). Quem
 * somar as duas seções sem olhar essa coluna soma extrato com opinião.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getDreResultado({
    visao: opcaoDe(sp, "visao", VISOES, "caixa"),
    mes: mesEstritoDe(sp, "mes")
  });

  const { linhas, ajustes, meses, categorias, ressalvas } = contrato.dado;
  const vigentes = ajustes.filter((a) => a.vigente);
  const totalAjuste = vigentes.reduce((s, a) => s + a.amountCents, 0);
  const lucro = linhas.find((l) => l.linha === "lucro_liquido");
  const comLacunas = linhas.find((l) => l.linha === "lucro_liquido_com_lacunas");

  // A ressalva perecível vem primeiro de todas: ela muda a leitura do número
  // que está na tela AGORA, e a linha a que ela pertence pode nem existir na
  // árvore (pessoal em agosto vale zero porque a folha sai em 01/09).
  return responderContrato(
    comRessalvas(
      contrato,
      ...ressalvas.filter((r) => r.severidade === "alerta").map((r) => r.texto),
      lucro && comLacunas && lucro.valorCents !== comLacunas.valorCents
        ? `Lucro líquido ${brl(lucro.valorCents)} · com as lacunas dentro, ${brl(comLacunas.valorCents)}. ` +
            `A diferença de ${brl(comLacunas.valorCents - lucro.valorCents)} é dinheiro que andou no extrato e ainda não tem linha — ` +
            `não é margem, e não é zero.`
        : null,
      vigentes.length
        ? `${contagem(vigentes.length, "ajuste declarado vigente", "ajustes declarados vigentes")}, somando ${brl(totalAjuste)}. ` +
            `Eles estão em seção própria e NÃO alteram nenhuma linha do extrato, nem o caixa, nem o saldo de conta.`
        : null,
      meses.length ? `${contagem(meses.length, "mês disponível", "meses disponíveis")} nesta visão.` : null,
      categorias.length
        ? `${contagem(categorias.length, "categoria ativa", "categorias ativas")} como destino possível do mover, cada uma com a linha da DRE em que ela cai.`
        : null
    )
  );
});
