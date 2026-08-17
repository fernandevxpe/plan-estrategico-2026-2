import { getCustosDoMes, type EstadoCusto } from "@/lib/financeiro/contratos/custos";
import { comRessalvas, inteiroDe, responderContrato, rotaDeLeitura, textoDe } from "@/lib/financeiro/contratos/http";
import { autorDe, criarItemManual, itemManualDe, respostaDeErro } from "@/lib/financeiro/custos";
import { transaction } from "@/lib/financeiro/db";

import { brl, contagem, lista } from "../_medido";
import { mesEstritoDe, opcaoOpcionalDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESTADOS = ["previsto", "confirmado", "realizado", "ignorado"] as const;

/**
 * O mês corrente em São Paulo, não em UTC.
 *
 * `new Date().toISOString().slice(0,7)` parece equivalente e não é: às 21h do
 * dia 31, UTC já virou o mês. A rota sem `?mes=` devolveria a competência
 * seguinte — vazia — e a tela leria "não há custo previsto" numa noite de
 * fechamento, que é exatamente quando alguém está olhando.
 */
function competenciaCorrente(): string {
  const [{ value: ano }, , { value: mes }] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  return `${ano}-${mes}-01`;
}

/**
 * GET /api/financeiro/gerencial/custos?mes=&categoria=&estado=&contraparte=&min=&max=&pendentes=
 *
 * O custo previsto do mês, item a item, já com a dupla contagem resolvida.
 *
 * A tela deve somar SÓ `entraNoTotal`. As demais linhas não são ruído: são o
 * que existe e não soma, cada uma com `motivoForaDaSoma`. Esconder essa metade
 * faz o mês parecer menor do que é; somá-la faz parecer maior. As duas juntas
 * são a verdade — o mesmo desenho da tela de previsão de caixa.
 *
 * A ressalva do mês corrente é medida a cada requisição e não escrita fixa:
 * num dia 16, metade de agosto já é extrato e a projeção não a enxerga. Dizer
 * isso em prosa, com o número de dias, é o que evita que alguém leia
 * "R$ 5.116,83 em agosto" como se fosse o custo do mês.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const competencia = mesEstritoDe(sp, "mes") ?? competenciaCorrente();

  const contrato = await getCustosDoMes({
    competencia,
    categoria: textoDe(sp, "categoria", 20),
    estado: opcaoOpcionalDe(sp, "estado", ESTADOS) as EstadoCusto | undefined,
    contraparte: inteiroDe(sp, "contraparte", { min: 1, max: 2_000_000_000 }),
    valorMinCents: inteiroDe(sp, "min", { min: 0, max: 1_000_000_000_000 }),
    valorMaxCents: inteiroDe(sp, "max", { min: 0, max: 1_000_000_000_000 }),
    pendentes: sp.get("pendentes") === "1" || sp.get("pendentes") === "true"
  });

  const d = contrato.dado;
  const foraDaSoma = d.itens.filter((i) => !i.entraNoTotal);
  const comAlerta = d.itens.filter((i) => i.alerta);
  const semCategoria = d.porCategoria.find((k) => k.categoriaId === null);

  return responderContrato(
    comRessalvas(
      contrato,
      d.diasForaDoHorizonte > 0
        ? `${contagem(d.diasForaDoHorizonte, "dia desta competência já passou", "dias desta competência já passaram")} ` +
            `e a projeção não os vê — ela é uma curva de caixa que começa hoje. ` +
            `O que já saiu está em confronto[].realizadoCents${
              d.realizadoCents !== null ? ` (${brl(d.realizadoCents)} até agora)` : ""
            }, não aqui.`
        : null,
      foraDaSoma.length
        ? `${contagem(foraDaSoma.length, "item existe e NÃO soma", "itens existem e NÃO somam")} (${brl(
            d.foraDaSomaCents
          )}): ${lista(foraDaSoma.slice(0, 4).map((i) => `${i.descricao} — ${i.motivoForaDaSoma ?? "sem motivo"}`), 4)}.`
        : null,
      d.aConfirmarCents > 0
        ? `${brl(d.confirmadoCents)} de ${brl(d.totalCents)} confirmado; faltam ${brl(d.aConfirmarCents)}. ` +
          `Confirmar não adianta o caixa — o item continua sendo previsão até existir lançamento.`
        : null,
      comAlerta.length
        ? `${contagem(comAlerta.length, "item acende", "itens acendem")} alerta de sobreposição: ${lista(
            comAlerta.slice(0, 4).map((i) => i.descricao),
            4
          )}. O alerta não suprime nada — ele pede conferência humana.`
        : null,
      semCategoria
        ? `${brl(semCategoria.subtotalCents)} (${semCategoria.participacaoPct ?? 0}%) sem categoria: ${
            semCategoria.motivoSemCategoria ?? "origem não declara categoria"
          }.`
        : null,
      d.itensIndeterminados
        ? `${contagem(d.itensIndeterminados, "item está", "itens estão")} com valor indeterminado e fora de toda soma — ` +
          `um número plausível ali seria pior que o vazio.`
        : null
    )
  );
});

/**
 * POST /api/financeiro/gerencial/custos — cria um item de custo MANUAL.
 *
 * É por aqui que a lacuna de cobertura se fecha. Medido em 16/08/2026, a saída
 * prevista cobre 81,4% da saída real de setembro: os R$ 27.999,43/mês que
 * faltam são gasto que não tem recorrente, não tem documento e não tem fatura.
 * Nenhuma view consegue derivá-lo do passado; só quem conhece a operação
 * consegue escrevê-lo.
 *
 * Corpo mínimo: `{competencia, descricao, valorCents}`.
 * Sem valor: `{competencia, descricao, indeterminadoMotivo}` — e aí o item
 * aparece na tela, declara que não se sabe quanto, e não entra em soma nenhuma.
 * `{confirmar: true}` já nasce confirmado, com o autor do Basic Auth.
 *
 * Item manual NÃO cala projeção nenhuma: ele soma por cima, porque não duplica
 * nada. Se o gasto já é projetado por uma camada, o caminho é confirmar aquela
 * linha ajustando o valor, e não criar uma segunda.
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
    const item = itemManualDe(corpo);
    const resultado = await transaction((c) => criarItemManual(c, { item, actor }));
    return Response.json(
      {
        ok: true,
        ...resultado,
        ressalvas: [
          "Item manual soma por cima da projeção: ele não duplica camada nenhuma. " +
            "Se este gasto já é projetado por recorrente, documento ou fatura, confirme aquela linha em vez de criar esta."
        ]
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
