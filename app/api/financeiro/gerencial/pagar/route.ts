import { getContasAPagar } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/pagar
 *
 * "Onde nasce a conta a pagar?" — e a resposta honesta é que, hoje, ela quase não
 * nasce. `fin_document` é 100% a receber: **a empresa não tem "contas a pagar",
 * tem "contas pagas"**, e só sabe que deve quando alguém lembra. Isso é a dúvida
 * 28, estrutural, e esta rota existe em parte para deixar de escondê-la.
 *
 * `totalCents` É NULL DE PROPÓSITO, COM MOTIVO
 *
 * Não existe uma camada única e completa do que a empresa deve. O que existe são
 * camadas que se sobrepõem — recorrente ativa, recorrente proposta, compromisso
 * de cartão, folha do mês, documento a pagar — e cada uma declara em
 * `naoSomarCom` com quais NÃO pode ser somada. Devolver a soma delas como "total
 * a pagar" seria exatamente o erro que as migrations 0045 e 0057 documentam: a
 * mesma obrigação contada duas ou três vezes.
 *
 * Um total inventado aqui é pior que a ausência dele, porque parece uma resposta.
 * `motivoSemTotal` viaja junto para a tela poder escrever por que o campo está
 * vazio em vez de desenhar R$ 0,00.
 *
 * `confianca` separa o contratado do observado: uma recorrente *proposta* é uma
 * detecção estatística à espera de confirmação humana, não uma obrigação.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getContasAPagar();
  const d = contrato.dado;

  const propostas = d.camadas.filter((c) => c.confianca === "provavel" || c.confianca === "observado");
  const somaIngenua = d.camadas.reduce((s, c) => s + c.totalCents, 0);

  return responderContrato(
    comRessalvas(
      contrato,
      d.totalCents === null
        ? `totalCents é NULL e o motivo está em motivoSemTotal${d.motivoSemTotal ? `: "${d.motivoSemTotal}"` : ""}. ` +
            `Não substitua por zero nem pela soma das camadas — somá-las daria ${brl(somaIngenua)}, contando a mesma obrigação mais de uma vez.`
        : null,
      d.camadas.length
        ? `${contagem(d.camadas.length, "camada respondeu", "camadas responderam")}: ${lista(
            d.camadas.map((c) => `${c.camada} ${brl(c.totalCents)} (${c.itens})`)
          )}. Cada uma lista em naoSomarCom com quais é incompatível.`
        : null,
      d.documentos.totalCents === null
        ? `Documentos a pagar: ${d.documentos.itens} item(ns), total indeterminado${
            d.documentos.motivoIndeterminado ? ` — "${d.documentos.motivoIndeterminado}"` : ""
          }.`
        : `Documentos a pagar formalizados: ${d.documentos.itens} item(ns), ${brl(d.documentos.totalCents)}. ` +
          `fin_document é hoje quase 100% a receber (dúvida 28): o que falta aqui é cadastro, não dívida inexistente.`,
      propostas.length
        ? `${contagem(propostas.length, "camada é", "camadas são")} detecção, não obrigação (${lista(
            propostas.map((c) => c.camada)
          )}): elas esperam confirmação humana e tratá-las como certas superestima a saída.`
        : null
    )
  );
});
