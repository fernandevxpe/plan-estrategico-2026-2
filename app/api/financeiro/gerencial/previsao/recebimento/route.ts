import { getPrevisaoRecebimento } from "@/lib/financeiro/contratos";
import { comRessalvas, inteiroDe, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, lista } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/previsao/recebimento?meses=
 *
 * "Quanto entra nos próximos 90 dias, e com que grau de certeza?"
 *
 * AS CAMADAS SÃO EXCLUDENTES. NÃO SOME.
 *
 * São cinco (`cobranca_emitida`, `assinatura`, `parcelamento`, `ativo_de_fato`,
 * `vencido_a_receber`) e a mesma receita aparece em mais de uma por construção:
 * uma cobrança emitida JÁ É a parcela do contrato. Sem a trava "cobrança emitida
 * vence projeção" a previsão somava R$ 1,27 milhão falso (migration 0061).
 *
 * A rota devolve o evento cru, camada a camada, e mede o total POR CAMADA na
 * ressalva — nunca um total geral, que só existiria se as camadas fossem
 * somáveis. Quem consumir escolhe qual camada usar; a API não escolhe por
 * ninguém, porque escolher aqui esconderia a escolha.
 *
 * `certeza` distingue o declarado do observado: assinatura declarada no Asaas
 * não vale o mesmo que "cliente que paga há mais de 12 meses sem contrato
 * formal" — que é uma camada própria, `ativo_de_fato`, com confiança menor.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getPrevisaoRecebimento(inteiroDe(sp, "meses", { min: 1, max: 24 }) ?? 6);

  const porCamada = new Map<string, { n: number; total: number }>();
  for (const l of contrato.dado) {
    const atual = porCamada.get(l.camada) ?? { n: 0, total: 0 };
    porCamada.set(l.camada, { n: atual.n + 1, total: atual.total + l.valorCents });
  }
  const semCliente = contrato.dado.filter((l) => l.clienteId === null);

  return responderContrato(
    comRessalvas(
      contrato,
      porCamada.size
        ? `Totais POR CAMADA (nunca a soma delas): ${lista(
            [...porCamada.entries()].map(([camada, v]) => `${camada} ${brl(v.total)} em ${v.n} evento(s)`),
            8
          )}.`
        : null,
      porCamada.size > 1
        ? "Mais de uma camada respondeu. Elas se sobrepõem por construção — uma cobrança emitida já é a parcela do contrato. Escolha UMA antes de somar; somar todas foi o erro que a 0061 corrigiu (R$ 1,27 milhão falso)."
        : null,
      semCliente.length
        ? `${semCliente.length} evento(s) sem contraparte identificada: o valor é conhecido, o devedor não. Eles não têm drill, e por isso não abrem em receber.`
        : null,
      contrato.disponivel && contrato.dado.length === 0
        ? "Nenhum evento previsto na janela. Isso é ausência de cobrança/contrato emitido, não previsão de receita zero."
        : null
    )
  );
});
