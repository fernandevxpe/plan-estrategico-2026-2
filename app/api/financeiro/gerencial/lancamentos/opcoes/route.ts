import { getOpcoesLancamentos } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { contagem } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/lancamentos/opcoes
 *
 * Os seletores da tela de extrato — contas, categorias, núcleos e centros de
 * custo ATIVOS — numa ida só ao banco.
 *
 * Por que existe como rota própria: os quatro vocabulários mudam raramente e
 * pesam pouco, mas embuti-los na resposta de `/lancamentos` os faria trafegar em
 * cada paginação. E buscá-los em quatro rotas separadas abriria a janela em que a
 * tela monta o filtro com um plano de contas de um instante e consulta com o de
 * outro.
 *
 * A lista é o VOCABULÁRIO CONTROLADO da tela: qualquer valor fora dela é recusado
 * com 400 pelos filtros de `/lancamentos`. Uma categoria aposentada some daqui e
 * o filtro correspondente para de ser oferecido — mas os lançamentos históricos
 * dela continuam existindo, e é por isso que a rota de extrato não valida
 * `categoria` contra esta lista: filtrar pelo passado tem de continuar possível.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getOpcoesLancamentos();
  const d = contrato.dado;

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel
        ? `Vocabulário ativo: ${contagem(d.contas.length, "conta", "contas")}, ${contagem(
            d.categorias.length,
            "categoria",
            "categorias"
          )}, ${contagem(d.nucleos.length, "núcleo", "núcleos")}, ${contagem(
            d.centrosCusto.length,
            "centro de custo",
            "centros de custo"
          )}.`
        : null,
      "Só o que está ATIVO aparece. Lançamento classificado numa categoria depois aposentada continua existindo — filtrar por ela em /lancamentos continua funcionando, mesmo que ela não esteja nesta lista."
    )
  );
});
