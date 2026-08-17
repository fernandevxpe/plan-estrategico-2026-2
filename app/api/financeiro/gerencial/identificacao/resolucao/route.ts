import { DECISOES, RecusaDeEscrita, resolverCaso } from "@/lib/financeiro/identificacao";

import { inteiroObrigatorio, rotaDeEscrita, textoObrigatorio } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/identificacao/resolucao
 *
 * Fecha UM caso do inventário, com motivo declarado.
 *
 * Corpo: `{ universo, alvoId, tipo, decisao, motivo, ator }`
 * `decisao` ∈ `sem_fonte` | `nao_se_aplica` | `resolvido`
 *
 * "NÃO TEM FONTE" É RESPOSTA, E É POR ISSO QUE ESTA ROTA EXISTE
 *
 * Um caso que ninguém consegue resolver e que ninguém consegue fechar fica na
 * lista para sempre — e uma lista que nunca encolhe é uma lista que as pessoas
 * param de ler. `sem_fonte` fecha o caso e preserva a diferença que importa:
 * `resolvido` afirma que o dado chegou; `sem_fonte` afirma que ele não existe.
 * As duas tiram o caso da fila e dizem coisas opostas sobre o mundo, e o
 * relatório de amanhã precisa saber qual foi.
 *
 * `nao_se_aplica` é o terceiro caso, e existe porque a varredura pode ter
 * errado: a base classificou como pendência algo que não é. Fechar isso como
 * "resolvido" mentiria sobre trabalho feito.
 *
 * SINGULAR, E ISSO NÃO É LIMITAÇÃO
 *
 * A rota fecha um caso por chamada. Não existe versão em lote e não deve passar
 * a existir: o inventário tem 27.281 casos, e um botão que "resolve tudo"
 * produziria 27.281 afirmações que nenhuma pessoa fez. `motivo` tem mínimo de 12
 * caracteres pelo mesmo motivo — "ok" não é motivo, e o que ficar aqui é o que a
 * próxima pessoa vai ler quando perguntar por que aquele caso sumiu.
 *
 * Se o caso não estiver aberto, a resposta é 422 dizendo que ou ele já foi
 * resolvido, ou o dado que faltava chegou e ele saiu do inventário sozinho — as
 * views são derivadas, então um caso pode se resolver sem ninguém fechar.
 *
 * A resolução é reversível: `fin_pendencia_resolucao.desfeito_em` existe, e o
 * índice único só vale para o registro vivo.
 */
export const POST = rotaDeEscrita(async (corpo) => {
  const decisao = textoObrigatorio(corpo, "decisao");
  if (!(DECISOES as readonly string[]).includes(decisao)) {
    throw new RecusaDeEscrita(`decisao deve ser um de: ${DECISOES.join(", ")}`);
  }

  return resolverCaso({
    universo: textoObrigatorio(corpo, "universo"),
    alvoId: inteiroObrigatorio(corpo, "alvoId"),
    tipo: textoObrigatorio(corpo, "tipo"),
    decisao: decisao as (typeof DECISOES)[number],
    motivo: textoObrigatorio(corpo, "motivo"),
    ator: textoObrigatorio(corpo, "ator")
  });
});
