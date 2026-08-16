import { getTesouraria } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/tesouraria
 *
 * Caixa livre, reservas, aplicações e runway.
 *
 * ALVO DE RESERVA NÃO É DINHEIRO COMPROMETIDO
 *
 * Esta é a armadilha que já derrubou a primeira linha da tela uma vez: calcular o
 * disponível descontando a META das reservas produziu −R$ 180 mil, porque as
 * reservas somam ~R$ 230 mil de alvo contra ~R$ 49 mil efetivamente em conta.
 * Alvo é dinheiro que ainda FALTA guardar — a distância entre "estou no vermelho"
 * e "tenho uma meta a cumprir".
 *
 * Por isso o contrato separa três campos que uma tela descuidada colapsaria:
 *
 *   `reservadoCents`      o que já está separado, de fato
 *   `reservaFaltaCents`   o que falta para bater o alvo — não é passivo
 *   `livreCents`          caixa − reservado (nunca caixa − alvo)
 *
 * `runwayMeses` é `Medida`: null com motivo quando não há base de saída para
 * dividir. Um runway "0 meses" por falta de histórico diria falência onde há
 * apenas ausência de dado — e é a leitura que faria alguém tomar a decisão mais
 * cara possível a partir de nada.
 *
 * `aplicacoes[].bate` é o teste da custódia: o saldo da conta tem de bater com a
 * soma das posições. `delta ≠ 0` é dado a explicar, não arredondamento.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getTesouraria();
  const d = contrato.dado;

  const naoBatem = d.aplicacoes.filter((a) => !a.bate);
  const semAlvo = d.reservas.filter((r) => r.coberturaPct === null);
  const descobertas = d.reservas.filter((r) => r.faltaCents > 0);

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel
        ? `livreCents (${brl(d.livreCents)}) = caixa (${brl(d.caixaTotalCents)}) − reservado DE FATO (${brl(d.reservadoCents)}). ` +
            `O alvo NÃO entra nessa conta: reservaFaltaCents (${brl(d.reservaFaltaCents)}) é meta a cumprir, não obrigação a pagar.`
        : null,
      d.runwayMeses.valorCents === null
        ? `runwayMeses é indeterminado${d.runwayMeses.motivo ? `: "${d.runwayMeses.motivo}"` : ""}. Não leia como zero — zero afirmaria que o caixa acabou.`
        : null,
      d.saidaMediaMensalCents === null
        ? "saidaMediaMensalCents é null: sem base de saída medida, qualquer runway seria divisão por um número inventado."
        : null,
      naoBatem.length
        ? `${contagem(naoBatem.length, "aplicação não bate", "aplicações não batem")} com a soma das posições: ${lista(
            naoBatem.map((a) => `${a.contaSlug} (${brl(a.deltaCents)})`)
          )}. Delta ≠ 0 é dado a explicar, não arredondamento.`
        : null,
      descobertas.length
        ? `${contagem(descobertas.length, "reserva está", "reservas estão")} abaixo do alvo: ${lista(
            descobertas.map((r) => `${r.slug} (falta ${brl(r.faltaCents)})`)
          )}.`
        : null,
      semAlvo.length
        ? `${contagem(semAlvo.length, "reserva tem", "reservas têm")} coberturaPct null (alvo zero ou ausente): não há percentual a calcular, e 0% diria o contrário.`
        : null
    )
  );
});
