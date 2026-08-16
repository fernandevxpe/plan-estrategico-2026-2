import { getItensDaFila, type SlugFila } from "@/lib/financeiro/contratos";
import {
  comRessalvas,
  opcaoDe,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../../_medido";
import { centavosDe, intervaloDiarioDe, paginacaoDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * As nove filas que `getCaixaDeDecisoes()` conhece.
 *
 * A lista é COMPLETA de propósito, embora `getItensDaFila` só saiba materializar
 * quatro. Recusar as outras cinco com 400 diria "esta fila não existe", que é
 * falso — elas existem, têm contagem na caixa de entrada e tela própria. Deixá-las
 * passar faz o contrato devolver 503 com o motivo certo ("a fila X tem tela
 * própria; use a rota declarada em getCaixaDeDecisoes()"), e o motivo é a
 * informação que o chamador precisa.
 */
const FILAS = [
  "classificar",
  "indeterminado",
  "revisao",
  "documento_conflito",
  "contrato_erp",
  "parcela_nota",
  "recorrente_proposta",
  "orcamento_sem_mapa",
  "pagamento_bloqueado"
] as const satisfies readonly SlugFila[];

/**
 * GET /api/financeiro/gerencial/decisoes/itens
 *   ?fila=&grupo=&de=&ate=&valorMinCents=&busca=&pagina=&porPagina=
 *
 * Os itens de uma fila, prontos para a tela de decisão — com a EVIDÊNCIA ao lado
 * da escolha, no padrão que o commit `85a900b` estabeleceu.
 *
 * O QUE ESTA ROTA CARREGA QUE UM CRUD NÃO CARREGARIA
 *
 * · `evidencias[]` com PROCEDÊNCIA. "CNPJ 34.776.108/0001-92" não vale nada
 *   sozinho; "CNPJ que veio no `cpfCnpjRecebedor` do extrato do Inter" vale a
 *   decisão. A procedência é o que separa evidência de opinião.
 * · `opcoes[].porque` — sugestão sem porquê é chute com autoridade. Nunca há mais
 *   de uma opção `sugerida`.
 * · `grupoChave`/`grupoTamanho` — itens com a mesma chave são a MESMA decisão
 *   repetida. É o que permite "aplicar a todos os 34 iguais" com um clique, e é
 *   por isso que a ordenação padrão é por VALOR: resolver os 20 maiores move o
 *   indicador mais do que resolver os 200 mais antigos.
 *
 * Somente leitura. A decisão em si é escrita por `/api/financeiro/qualificar` e
 * `/api/financeiro/revisao`, que já existem e carregam autor e auditoria.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const fila = opcaoDe(sp, "fila", FILAS, "classificar");

  const contrato = await getItensDaFila(
    fila,
    {
      grupo: textoDe(sp, "grupo", 200),
      ...intervaloDiarioDe(sp),
      valorMinCents: centavosDe(sp, "valorMinCents"),
      busca: textoDe(sp, "busca", 120)
    },
    paginacaoDe(sp)
  );

  const itens = contrato.dado.itens;
  const semEvidencia = itens.filter((i) => i.evidencias.length === 0);
  const comSugestao = itens.filter((i) => i.opcoes.some((o) => o.sugerida));
  const grupos = new Set(itens.map((i) => i.grupoChave)).size;
  const valor = itens.reduce((s, i) => s + (i.valorCents ?? 0), 0);
  const semValor = itens.filter((i) => i.valorCents === null).length;

  return responderContrato(
    comRessalvas(
      contrato,
      itens.length
        ? `${contagem(itens.length, "item nesta página", "itens nesta página")} formam ${contagem(grupos, "decisão distinta", "decisões distintas")} — ` +
            `decidir no grupo resolve todos os iguais. Total da página: ${brl(valor)}${semValor ? `, fora ${semValor} item(ns) sem valor em reais` : ""}.`
        : null,
      semEvidencia.length
        ? `${contagem(semEvidencia.length, "item não tem", "itens não têm")} evidência alcançável nas fontes. ` +
            `Eles não devem ser decididos no chute: ficar indeterminado com motivo vale mais que um rótulo inventado.`
        : null,
      comSugestao.length
        ? `${contagem(comSugestao.length, "item traz", "itens trazem")} opção sugerida. A sugestão NÃO está aplicada — ela vem com opcoes[].porque à vista para a pessoa conferir antes de aceitar.`
        : null,
      !contrato.disponivel
        ? `A fila '${fila}' não é materializável por esta rota; o motivo exato está em ressalvas e o destino correto está em GET /api/financeiro/gerencial/decisoes, campo 'rota'.`
        : null
    )
  );
});
