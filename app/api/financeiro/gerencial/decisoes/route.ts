import { getCaixaDeDecisoes } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/decisoes
 *
 * A caixa de entrada das filas de indeterminado. `PROMPT_CONCLUSAO_BASE.md` é
 * explícito: elas **não são relatório, são as telas de decisão**. Por isso todo
 * item traz `rota` — fila sem destino vira relatório morto, e relatório morto é
 * como uma pendência de R$ 80 mil fica um ano sem dono.
 *
 * `quantidade` E `decisoesDistintas` SÃO DIFERENTES DE PROPÓSITO
 *
 * 718 itens a classificar podem ser 60 decisões quando agrupados por
 * contraparte. A primeira é o tamanho do problema; a segunda é o tamanho do
 * trabalho. Uma tela que mostre só a primeira faz a fila parecer intransponível
 * e ninguém começa; uma que mostre só a segunda esconde o risco. As duas viajam.
 *
 * `consequencia` diz o que acontece se a fila ficar parada. É o campo que
 * transforma "718 pendências" em uma prioridade defensável.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getCaixaDeDecisoes();

  const bloqueantes = contrato.dado.filter((f) => f.severidade === "bloqueante");
  const comValor = contrato.dado.filter((f) => f.valorCents !== null);
  const semValor = contrato.dado.filter((f) => f.valorCents === null && f.quantidade > 0);
  const agrupaveis = contrato.dado.filter(
    (f) => f.decisoesDistintas !== null && f.decisoesDistintas > 0 && f.decisoesDistintas < f.quantidade
  );

  return responderContrato(
    comRessalvas(
      contrato,
      bloqueantes.length
        ? `${contagem(bloqueantes.length, "fila é bloqueante", "filas são bloqueantes")}: ${lista(bloqueantes.map((f) => f.slug))}. ` +
            `Elas travam trabalho de outras frentes, não só a própria tela.`
        : null,
      agrupaveis.length
        ? `Agrupando, o trabalho é menor que a fila: ${lista(
            agrupaveis.map((f) => `${f.slug} ${f.quantidade}→${f.decisoesDistintas}`)
          )}. Decidir no grupo resolve todos os iguais de uma vez.`
        : null,
      comValor.length
        ? `Valor em jogo nas filas que são sobre dinheiro: ${brl(comValor.reduce((s, f) => s + (f.valorCents ?? 0), 0))}.`
        : null,
      semValor.length
        ? `${contagem(semValor.length, "fila tem", "filas têm")} valorCents null (${lista(semValor.map((f) => f.slug))}): elas não são sobre dinheiro. ` +
            `Null aqui significa "não se mede em reais", não "vale zero" — somá-las como zero subestimaria o trabalho pendente.`
        : null
    )
  );
});
