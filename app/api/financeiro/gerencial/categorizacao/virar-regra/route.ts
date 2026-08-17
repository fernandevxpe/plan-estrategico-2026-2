import { RecusaCategorizacao, virarRegra } from "@/lib/financeiro/categorizacao";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { autorDe, erro, lerCorpo } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/categorizacao/virar-regra
 *
 * ```json
 * {
 *   "code": "5.03",
 *   "padrao": "UBER DO BRASIL TECNOLOGIA LTDA",
 *   "porContraparte": true,
 *   "rotulo": "Uber",
 *   "aplicar": false
 * }
 * ```
 *
 * ==========================================================================
 * A REGRA NASCE `proposta`. SEMPRE. NÃO HÁ PARÂMETRO PARA ATIVAR
 * ==========================================================================
 *
 * A regra 40 (`meios-de-pagamento`) nasceu ativa e acumulou **25 acertos com
 * zero verdadeiros positivos**. Ela procurava `stone|cielo|pagseguro|…` no
 * texto do extrato — e o Nubank põe o **banco de destino do recebedor** no fim
 * da linha de todo PIX enviado. Posto de combustível, restaurante, imobiliária
 * e oito PIX a pessoa física foram parar em `4.05 Tarifas bancárias`. Pessoa
 * física não emite tarifa bancária.
 *
 * `proposta` é o estado em que uma regra pode ser MEDIDA antes de valer. E o
 * invariante D1 garante que nada a aponte enquanto isso: `classified_rule_id`
 * só resolve para regra com `status='ativa'`.
 *
 * ==========================================================================
 * O ALCANCE É MEDIDO NO ACERVO ATUAL, NÃO ESTIMADO PARA O FUTURO
 * ==========================================================================
 *
 * "Quantos itens futuros pegaria" não tem resposta exata, e um número inventado
 * aqui seria pior que nenhum. "Quantos do acervo de hoje pegaria" tem resposta
 * exata, é o melhor preditor disponível, e vem separado em três partes:
 *
 *   `alcanceAtual`  quantos itens casam, por universo, com valor
 *   `conflitos`     desses, quantos já estão em OUTRA categoria — a regra os
 *                   reclassificaria, e é aqui que a regra 40 teria aparecido
 *   `protegidos`    quantos estão travados por decisão humana e a regra não
 *                   tocaria, porque `fin_preserve_human_locks` devolve o valor
 *
 * ==========================================================================
 * PADRÃO CURTO É RECUSADO
 * ==========================================================================
 *
 * Abaixo de 18 caracteres, um padrão engole meio extrato. É exatamente o
 * formato de `pix-pessoa-fisica` (prioridade 200, confiança 60), a regra que
 * moveria as 205 linhas da dúvida 0. A rota recusa e diz por quê, em vez de
 * criar uma regra ruim.
 */
export async function POST(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  if (corpo.status !== undefined || corpo.ativar !== undefined) {
    return erro(
      "não existe parâmetro para ativar: toda regra criada aqui nasce `status='proposta'`. " +
        "A regra 40 nasceu ativa e acumulou 25 acertos com zero verdadeiros positivos. " +
        "Ativar é ato à parte, depois de alguém olhar o alcance medido.",
      422
    );
  }

  const code = String(corpo.code ?? "").trim();
  const padrao = String(corpo.padrao ?? "").trim();
  if (!code) return erro("informe a categoria em `code`");
  if (!padrao) return erro("informe o `padrao` que a regra deve casar");

  try {
    const proposta = await virarRegra({
      code,
      padrao,
      porContraparte: corpo.porContraparte === true,
      rotulo: String(corpo.rotulo ?? padrao).slice(0, 120),
      ator: autorDe(request),
      nota: corpo.nota === undefined ? null : String(corpo.nota).slice(0, 500),
      aplicar: corpo.aplicar === true
    });

    const alcance = proposta.alcanceAtual.reduce((s, a) => s + a.n, 0);
    const emConflito = proposta.conflitos.reduce((s, c) => s + c.n, 0);

    return Response.json(
      {
        ok: true,
        dryRun: corpo.aplicar !== true,
        proposta,
        ressalvas: [
          `A regra nasce \`status='proposta'\` e não classifica nada até ser ativada à parte.`,
          `Alcance medido no acervo ATUAL: ${alcance} item(ns) nos três universos. ` +
            `Não é previsão do futuro — é o melhor preditor que existe sem inventar número.`,
          emConflito > 0
            ? `${emConflito} desses já estão em outra categoria e seriam RECLASSIFICADOS: ` +
              proposta.conflitos.map((c) => `${c.n} em ${c.categoriaCode}`).join(", ") +
              `. Foi assim que a regra 40 carimbou 25 lançamentos errados.`
            : `Nenhum item alcançado está hoje em outra categoria.`,
          proposta.protegidos > 0
            ? `${proposta.protegidos} item(ns) alcançado(s) estão travados por decisão humana e a regra não os tocaria.`
            : null
        ].filter((r): r is string => r !== null)
      },
      { status: corpo.aplicar === true ? 201 : 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof RecusaCategorizacao) {
      return Response.json(
        { erro: e.message, ...e.detalhe },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (e instanceof FinanceUnavailableError) return erro("banco do financeiro indisponível", 503);
    const pg = e as { code?: string; message?: string };
    console.error("[categorizacao:virar-regra]", pg?.message ?? e);
    return erro(pg?.message ?? "falha ao propor regra", 500);
  }
}
