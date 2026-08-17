import { alvosDe, autorDe, confirmarItens, respostaDeErro } from "@/lib/financeiro/custos";
import { transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/custos/confirmar — individual e em lote.
 *
 * Corpo:
 *   {"itens": [{"id": 42}]}                              confirma pelo previsto
 *   {"itens": [{"id": 42, "valorCents": 162200}]}         confirma ajustando
 *   {"itens": [{"competencia":"2026-09","origemRef":"fin_recurring:75"}]}
 *   {"item":  {"id": 42}, "nota": "conferido no contrato"}
 *
 * DUAS FORMAS DE ALVO, E POR QUÊ
 *
 * A tela mostra duas espécies de linha: a que já é item (`id`) e a que ainda é
 * só projeção (`origemRef`). Exigir que o cliente materializasse antes de
 * confirmar criaria duas chamadas e uma janela entre elas — e um duplo clique
 * nessa janela criaria dois itens para a mesma projeção. Aqui as duas coisas
 * acontecem na MESMA transação, e `materializarDerivado` é idempotente pela
 * chave (competência, origem_ref).
 *
 * O QUE ESTA ROTA NÃO FAZ
 *
 * Não realiza. Não altera `fin_recurring`, `fin_document` nem `fin_transaction`.
 * Confirmar um custo derivado de uma recorrente proposta NÃO ativa a recorrente
 * — ela continua 'proposto', e a confirmação vale para aquele mês só. É de
 * propósito: ativar a recorrente é uma decisão sobre todos os meses futuros
 * (dúvida 33), e ninguém deve tomá-la por engano ao confirmar setembro.
 *
 * Tudo numa transação só: meio lote gravado é pior que lote nenhum quando o
 * assunto é dinheiro. O `batchId` devolvido é o mesmo em toda a trilha do
 * `fin_audit_log`, e é ele que torna o lote desfazível.
 */
export async function POST(request: Request) {
  let corpo: { itens?: unknown; item?: unknown; nota?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);
  try {
    const alvos = alvosDe(corpo.itens ?? corpo.item);
    const nota = typeof corpo.nota === "string" ? corpo.nota : null;
    const resultado = await transaction((c) => confirmarItens(c, { alvos, actor, nota }));

    const ressalvas = [
      "Confirmado NÃO é realizado: estes itens continuam sendo previsão até existir lançamento no extrato."
    ];
    if (resultado.materializados) {
      ressalvas.push(
        `${resultado.materializados} projeção(ões) viraram item nesta chamada. Materializar é neutro no total do mês; ` +
          `o que moveu o número foi a confirmação.`
      );
    }
    if (resultado.ajusteCents !== 0) {
      ressalvas.push(
        `A confirmação ajustou o previsto em ${(resultado.ajusteCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL"
        })}. Essa diferença é a medida do erro da projeção — ela fica em fin_custo_previsto_confronto_v.`
      );
    }
    if (resultado.naoEncontrados.length) {
      ressalvas.push(`Não encontrados e portanto não confirmados: ${resultado.naoEncontrados.join(", ")}.`);
    }

    return Response.json({ ok: true, ...resultado, ressalvas }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
