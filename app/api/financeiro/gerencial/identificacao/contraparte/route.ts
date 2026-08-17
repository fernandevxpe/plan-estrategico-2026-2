import { cadastrarContraparte } from "@/lib/financeiro/identificacao";

import { inteiroObrigatorio, rotaDeEscrita, textoObrigatorio } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/identificacao/contraparte
 *
 * Cadastra a contraparte que falta, a partir de um caso do inventário.
 *
 * Corpo: `{ nome, documento, kind, ator, universo?, alvoId? }`
 *
 * O DOCUMENTO É OBRIGATÓRIO, E ISSO É A FEATURE
 *
 * Um cadastro sem CPF/CNPJ não pode ser conferido contra o extrato nem contra o
 * ERP, e vira exatamente o tipo de linha que esta base tem 24 exemplares e não
 * sabe o que fazer com. Se o documento não for conhecido, o caminho certo é
 * deixar o caso indeterminado — ou fechá-lo em
 * `/identificacao/resolucao` com `decisao: "sem_fonte"` e o motivo escrito.
 *
 * O dígito verificador é conferido antes da escrita. Não é preciosismo: uma
 * versão anterior de um detector desta base procurava CNPJ por "14 dígitos em
 * qualquer campo" e casou zero de 274 negócios, porque
 * `update_time = 2024-02-29 14:24:07` tem exatamente 14 dígitos. Comprimento não
 * é identidade.
 *
 * AS DUAS RECUSAS, E POR QUE SÃO 422 E NÃO 400
 *
 * - **CNPJ da própria XPE (34776108000192).** Recusado. Foi assim que
 *   R$ 151.977,33 de transferência interna viraram despesa de fornecedor: a
 *   linha fica perfeita, com nome, documento e categoria, e nenhuma tela acusa.
 *   Os invariantes A1 e A2 existem por causa desse episódio, e a recusa acontece
 *   aqui — antes da escrita — em vez de virar um teste vermelho amanhã.
 * - **Documento já cadastrado.** NÃO é erro: a resposta é 200 com
 *   `criada: false` e o id do cadastro existente. Criar um segundo violaria a A4
 *   e partiria o histórico da contraparte em dois, o que faz o classificador por
 *   precedente errar nas DUAS metades. "Se o documento já existe, vincule ao
 *   existente" é regra desta frente, e ela está no código e não no comentário.
 *
 * 422 e não 400 porque o pedido foi entendido: a base é que se negou por regra
 * de negócio. 400 diria "você digitou errado", que manda a pessoa procurar o
 * erro no lugar errado.
 *
 * Escrita e trilha em `fin_audit_log` vão na MESMA transação.
 */
export const POST = rotaDeEscrita(async (corpo) => {
  const universo = typeof corpo.universo === "string" ? corpo.universo.trim() : undefined;
  const alvoId = corpo.alvoId === undefined ? undefined : inteiroObrigatorio(corpo, "alvoId");

  return cadastrarContraparte({
    nome: textoObrigatorio(corpo, "nome"),
    documento: textoObrigatorio(corpo, "documento"),
    kind: textoObrigatorio(corpo, "kind"),
    ator: textoObrigatorio(corpo, "ator"),
    universo,
    alvoId
  });
});
