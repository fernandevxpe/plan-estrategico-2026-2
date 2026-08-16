import { getPrevisao } from "@/lib/financeiro/contratos";
import { comRessalvas, inteiroDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/previsao?horizonteDias=
 *
 * "Em que dia o caixa aperta?" — e a resposta vem com o buraco declarado.
 *
 * A PREVISÃO DE SAÍDA COBRE ~71,7% DO QUE SAI DE VERDADE.
 *
 * Isso está medido, é conhecido (dúvida 34, R$ 43.059,77/mês sem camada) e a
 * migration 0079 imprime o buraco em toda execução em vez de escondê-lo numa
 * média. A rota faz o mesmo: a ressalva medida diz que a curva é OTIMISTA por
 * construção. Uma tela que desenhe `saldoPrevistoCents` sem essa frase promete
 * um caixa que não existe — e foi exatamente esse o defeito antes da 0079, quando
 * a saída cobria 5,8% e "quando o caixa aperta" respondia "nunca".
 *
 * TRÊS CAMPOS QUE NÃO PODEM SER LIDOS ISOLADOS
 *
 * · `naoSomadoTotalCents` — o que existe mas ficaria em dobro se somado. Cada
 *   camada em `dado.camadas` traz `entraNoSaldo` e, quando falso, o `motivo`.
 *   Esconder isso faz o futuro parecer melhor; somar faz parecer pior.
 * · `horizonteConfiavelDias` — depois dele a linha é constante porque acabaram os
 *   eventos, não porque o caixa estabilizou. Uma reta lida como previsão é a
 *   forma mais silenciosa de errar aqui.
 * · `ancoraAte` — a curva nasce do saldo real das contas naquela data. Extrato
 *   atrasado desloca tudo o que vem depois.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getPrevisao(inteiroDe(sp, "horizonteDias", { min: 7, max: 365 }) ?? 120);

  const d = contrato.dado;
  const naoSomadas = d.camadas.filter((c) => !c.entraNoSaldo);
  const ultimoDia = d.dias.at(-1);
  const foraDoConfiavel =
    d.horizonteConfiavelDias !== null && ultimoDia ? ultimoDia.diasAFrente - d.horizonteConfiavelDias : 0;

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel
        ? "A camada de SAÍDA cobre ~71,7% do que sai de verdade (medido, migration 0079; o restante é a dúvida 34, ~R$ 43.059,77/mês sem camada). " +
            "Esta curva é OTIMISTA por construção: o dia da ruptura tende a chegar antes do que está desenhado. Não a apresente como completa."
        : null,
      naoSomadas.length
        ? `${contagem(naoSomadas.length, "camada não entra", "camadas não entram")} no saldo previsto, somando ${brl(naoSomadas.reduce((s, c) => s + c.totalCents, 0))} — ` +
            `cada uma com o motivo em dado.camadas[].motivo. Somá-las ao saldo conta o mesmo dinheiro duas vezes.`
        : null,
      foraDoConfiavel > 0
        ? `${contagem(foraDoConfiavel, "dia no fim do horizonte não tem", "dias no fim do horizonte não têm")} evento nenhum: a linha só repete o saldo. ` +
            `Isso é ausência de informação, não estabilidade prevista (dado.horizonteConfiavelDias = ${d.horizonteConfiavelDias}).`
        : null,
      d.ancoraAte
        ? `A curva parte do saldo real de ${d.ancoraAte} (${brl(d.ancoraSaldoCents)}). Se o extrato de alguma conta estiver atrasado, tudo o que vem depois nasce deslocado.`
        : null,
      d.primeiraRuptura
        ? `Ruptura prevista em ${d.primeiraRuptura.dia} (D+${d.primeiraRuptura.diasAFrente}), saldo ${brl(d.primeiraRuptura.saldoCents)} — e ela tende a chegar ANTES, pelos 28,3% de saída sem camada.`
        : null
    )
  );
});
