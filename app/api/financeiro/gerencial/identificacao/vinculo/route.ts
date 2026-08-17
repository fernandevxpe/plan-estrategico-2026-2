import { vincularPessoaContraparte } from "@/lib/financeiro/identificacao";

import { inteiroObrigatorio, rotaDeEscrita, textoObrigatorio } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/identificacao/vinculo
 *
 * Liga uma pessoa a uma contraparte, por decisão humana registrada.
 *
 * Corpo: `{ personId, counterpartyId, motivo, ator, principal? }`
 *
 * OS DOIS IDS SÃO EXPLÍCITOS DE PROPÓSITO
 *
 * A rota não aceita nome, não busca por semelhança e não sugere. Casar por nome
 * parecido é o erro que produziu contraparte duplicada nesta base, e a variedade
 * mais perigosa dele mora justamente aqui: `Igor Dalton Guilherme Da Sil` (sem
 * documento) parece igual a `Igor Dalton Guilherme Da Silva` (CPF 70365478474) E
 * a `64266025 Igor Dalton Guilherme Da Silva` (CNPJ 64266025000114) — a pessoa
 * física e o MEI dela. Um algoritmo escolheria uma das duas; as duas existem, e
 * qual delas recebeu aquele pagamento é uma pergunta de verdade.
 *
 * O inventário mostra os candidatos lado a lado com o documento de cada um, como
 * SUGESTÃO. Quem decide manda os ids, e assina em `ator` e `motivo`.
 *
 * `method` grava `humano`, nunca `nome_token`. A tabela distingue os dois, e um
 * vínculo assinado por uma pessoa carimbado como inferência faria a próxima
 * auditoria confiar nele errado — para mais ou para menos.
 *
 * Vínculo que já existe devolve 200 com `criado: false` e NÃO sobrescreve: o
 * status anterior pode ter sido decidido por alguém com mais contexto.
 */
export const POST = rotaDeEscrita(async (corpo) =>
  vincularPessoaContraparte({
    personId: inteiroObrigatorio(corpo, "personId"),
    counterpartyId: inteiroObrigatorio(corpo, "counterpartyId"),
    motivo: textoObrigatorio(corpo, "motivo"),
    ator: textoObrigatorio(corpo, "ator"),
    principal: corpo.principal === true
  })
);
