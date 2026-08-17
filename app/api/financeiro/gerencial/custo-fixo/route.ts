import { getCatalogoCustoFixo, type StatusCatalogo } from "@/lib/financeiro/contratos/custo-fixo";
import { comRessalvas, responderContrato, rotaDeLeitura, textoDe } from "@/lib/financeiro/contratos/http";
import { adocaoDe, adotarCandidato, autorDe, respostaDeErro } from "@/lib/financeiro/custo-fixo";
import { transaction } from "@/lib/financeiro/db";

import { brl, contagem, lista } from "../_medido";
import { bandeiraEstritaDe, opcaoOpcionalDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS = ["proposto", "ativo", "suspenso", "encerrado", "recusado", "candidato", "informativo"] as const;

/**
 * GET /api/financeiro/gerencial/custo-fixo?categoria=&status=&aRevisar=&semConflito=&busca=
 *
 * O catálogo do que a empresa paga todo mês, com a evidência de cada linha.
 *
 * A ressalva mais importante é MEDIDA a cada requisição e não escrita fixa: a
 * relação entre o que está ligado e o que apenas foi detectado muda toda vez
 * que alguém revisa uma linha. Congelá-la no contrato a tornaria falsa no dia
 * seguinte, sem ninguém perceber — a mesma razão de `_medido.ts` existir.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getCatalogoCustoFixo({
    categoria: textoDe(sp, "categoria", 20),
    status: opcaoOpcionalDe(sp, "status", STATUS) as StatusCatalogo | undefined,
    aRevisar: bandeiraEstritaDe(sp, "aRevisar"),
    semConflito: bandeiraEstritaDe(sp, "semConflito"),
    busca: textoDe(sp, "busca", 80)
  });

  const d = contrato.dado;
  const r = d.resumo;
  const vencidos = d.vencimentos.filter((v) => v.urgencia === "vencido");
  const proximos = d.vencimentos.filter((v) => v.urgencia !== "vencido" && v.urgencia !== "vence_em_7_dias");
  const paradas = d.linhas.filter((l) => l.situacao === "parou");
  const reajustes = d.linhas.filter(
    (l) => l.divergenciaSugeridoCents !== null && Math.abs(l.divergenciaSugeridoCents) > 0
  );

  return responderContrato(
    comRessalvas(
      contrato,
      // A primeira frase é a que impede a leitura errada do número grande.
      r.itensLigados === 0 && r.totalDetectadoCents > 0
        ? `Nenhum item está ligado, então o total do catálogo é R$ 0,00 — e isso significa "ninguém decidiu ainda", ` +
            `não "a empresa não tem custo fixo". O que ela DE FATO paga de recorrente, medido em 12 meses fechados, ` +
            `é ${brl(r.totalDetectadoCents)}/mês.`
        : null,
      r.totalDetectadoCents > 0
        ? `Dos ${brl(r.totalDetectadoCents)}/mês detectados, ${brl(r.detectadoFolhaCents)} já são projetados pela ` +
            `folha e ${brl(r.detectadoDasCents)} pelo DAS. Sobram ${brl(r.detectadoTerceirosCents)}/mês de terceiros — ` +
            `é sobre esses que a decisão de ligar ou desligar existe.`
        : null,
      vencidos.length
        ? `${contagem(vencidos.length, "item venceu", "itens venceram")} e não foi pago: ${lista(
            vencidos.slice(0, 4).map((v) => `${v.descricao} (${v.diaEsperado})`),
            4
          )}.`
        : null,
      proximos.length
        ? `${contagem(proximos.length, "item vence", "itens vencem")} em até 3 dias, somando ${brl(
            proximos.reduce((s, v) => s + (v.valorCents ?? 0), 0)
          )}.`
        : null,
      r.itensComAlerta
        ? `${contagem(r.itensComAlerta, "item acende", "itens acendem")} alerta de sobreposição. O alerta não ` +
            `suprime nada — ele pede conferência humana.`
        : null,
      reajustes.length
        ? `${contagem(reajustes.length, "item tem", "itens têm")} valor sugerido diferente do gravado — é o reajuste ` +
            `que o ledger já mostra e o catálogo ainda não aplicou: ${lista(
              reajustes
                .slice(0, 3)
                .map((l) => `${l.descricao} ${brl(l.valorVigenteCents ?? 0)} → ${brl(l.valorSugeridoCents ?? 0)}`),
              3
            )}.`
        : null,
      paradas.length
        ? `${contagem(paradas.length, "item parou", "itens pararam")} de aparecer no extrato há mais de 2 meses ` +
            `fechados: ${lista(paradas.slice(0, 4).map((l) => l.descricao), 4)}. Confira antes de continuar prevendo.`
        : null,
      r.detectadoSemValor
        ? `${contagem(r.detectadoSemValor, "grupo ficou", "grupos ficaram")} com valor indeterminado: o backtest da ` +
            `família deles errou acima de 47% em todos os cinco critérios, e um número plausível ali seria pior que o vazio.`
        : null,
      r.parcelamentosAbertos
        ? `${contagem(r.parcelamentosAbertos, "parcelamento aberto", "parcelamentos abertos")} somam ${brl(
            r.parceladoMesCorrenteCents
          )}/mês e ACABAM${r.parceladoTerminaEm ? ` até ${r.parceladoTerminaEm.slice(0, 7)}` : ""}. Eles não entram ` +
            `no custo fixo: chamar parcelamento de mensalidade afirma que a empresa paga aquilo para sempre.`
        : null,
      r.reembolsoEstimadoCents
        ? `O reembolso (${brl(r.reembolsoEstimadoCents)}/mês, estimado) aparece no catálogo e NÃO soma: ele já está ` +
            `dentro da folha, pago no mês seguinte junto do fixo e classificado como salário.`
        : null
    )
  );
});

/**
 * POST /api/financeiro/gerencial/custo-fixo — adota um candidato.
 *
 * Candidato é o grupo que o detector achou no ledger e que ainda não existe
 * como linha do catálogo. Adotar cria a linha como PROPOSTA — dizer "isto
 * merece existir" não é dizer "isto entra no meu saldo". Ligar é o passo
 * seguinte, e é outro ato, com outro autor e outra hora.
 *
 * Corpo: `{counterparteId, categoriaId}` — e opcionalmente `{valorCents, label}`
 * quando quem adota quer declarar o número em vez de aceitar o sugerido.
 */
export async function POST(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);
  try {
    const adocao = adocaoDe(corpo);
    const resultado = await transaction((c) => adotarCandidato(c, { adocao, actor }));
    return Response.json(
      {
        ok: true,
        ...resultado,
        ressalvas: [
          "O item nasceu PROPOSTO: ele não entra no saldo até alguém ligá-lo.",
          "Se ele carrega conflito de camada, ligar é impossível por CHECK — e é assim que a folha não conta duas vezes."
        ]
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
