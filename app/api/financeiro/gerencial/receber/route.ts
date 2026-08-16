import { getContasAReceber, type CampoOrdenacaoReceber } from "@/lib/financeiro/contratos";
import {
  comRessalvas,
  inteiroDe,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";
import { bandeiraEstritaDe, dataEstritaDe, ordenacaoDe, paginacaoDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORDENACAO = ["vencimento", "valor", "cliente", "atraso"] as const satisfies readonly CampoOrdenacaoReceber[];

/**
 * GET /api/financeiro/gerencial/receber
 *   ?cliente=&nucleo=&camada=&vencimentoDe=&vencimentoAte=&faixa=&busca=
 *   &apenasVencido=&ordenarPor=&direcao=&pagina=&porPagina=
 *
 * "Quanto está atrasado a receber?" — com o aging na mesma resposta que a lista.
 *
 * AS CAMADAS NÃO SE SOMAM
 *
 * `totalAbertoCents` respeita o FILTRO aplicado, e é aí que mora a armadilha:
 * sem `?camada=`, a soma atravessa camadas que se sobrepõem por construção
 * (cobrança emitida É a parcela do contrato). A ressalva medida diz quantas
 * camadas responderam, para que ninguém publique um "total a receber" que conta
 * a mesma receita duas vezes. Filtre por uma camada antes de citar um total.
 *
 * `aging` NÃO respeita o filtro, de propósito: ele é o retrato da carteira
 * inteira, para a tela poder mostrar "sua seleção dentro do todo". Recortá-lo
 * junto faria as barras mudarem de tamanho a cada clique e o usuário perderia a
 * referência.
 *
 * "Vencido" não é status: é `vencimento < hoje` sobre o que está em aberto. O
 * gateway pode não ter carimbado OVERDUE ainda, e esperar pelo carimbo dele
 * esconderia atraso real.
 *
 * `confianca` distingue cobrança emitida de previsão de contrato. Duas linhas com
 * o mesmo valor e confianças diferentes não valem a mesma decisão de cobrança.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const camada = textoDe(sp, "camada", 40);

  const contrato = await getContasAReceber(
    {
      cliente: inteiroDe(sp, "cliente", { min: 1, max: 2_147_483_647 }),
      nucleo: textoDe(sp, "nucleo", 60),
      camada,
      vencimentoDe: dataEstritaDe(sp, "vencimentoDe"),
      vencimentoAte: dataEstritaDe(sp, "vencimentoAte"),
      apenasVencido: bandeiraEstritaDe(sp, "apenasVencido"),
      faixa: textoDe(sp, "faixa", 40),
      busca: textoDe(sp, "busca", 120)
    },
    paginacaoDe(sp),
    ordenacaoDe(sp, ORDENACAO, { campo: "vencimento", direcao: "asc" })
  );

  const d = contrato.dado;
  const camadas = [...new Set(d.pagina.itens.map((i) => i.camada))];
  const semCliente = d.pagina.itens.filter((i) => i.clienteId === null);

  return responderContrato(
    comRessalvas(
      contrato,
      !camada && camadas.length > 1
        ? `Esta resposta mistura ${contagem(camadas.length, "camada", "camadas")} (${lista(camadas)}) e elas NÃO se somam — ` +
            `uma cobrança emitida já é a parcela do contrato. totalAbertoCents (${brl(d.totalAbertoCents)}) conta a mesma receita mais de uma vez. ` +
            `Use ?camada= antes de publicar qualquer total.`
        : null,
      camada && d.pagina.total > 0
        ? `Recorte de camada única ('${camada}'): totalAbertoCents = ${brl(d.totalAbertoCents)} é somável.`
        : null,
      camada && d.pagina.total === 0
        ? `Nenhuma linha na camada '${camada}'. totalAbertoCents = R$ 0,00 aqui é AUSÊNCIA DE RESULTADO DO FILTRO, não "nada a receber nessa camada" — confira o nome contra dado.pagina.itens[].camada de uma consulta sem filtro.`
        : null,
      d.totalVencidoCents !== 0
        ? `${brl(d.totalVencidoCents)} já venceram dentro do recorte. 'Vencido' aqui é vencimento < hoje sobre o que está em aberto, não o carimbo OVERDUE do gateway — que pode não ter chegado.`
        : null,
      semCliente.length
        ? `${contagem(semCliente.length, "linha desta página não tem", "linhas desta página não têm")} contraparte identificada: sabe-se o valor, não o devedor.`
        : null,
      "O aging devolvido é o da carteira INTEIRA, não o do filtro — é a referência contra a qual a seleção deve ser lida."
    )
  );
});
