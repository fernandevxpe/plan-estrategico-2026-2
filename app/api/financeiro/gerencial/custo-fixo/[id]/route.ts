import {
  autorDe,
  marcarRevisado,
  mudancaStatusDe,
  mudarStatus,
  reajustar,
  reajusteDe,
  respostaDeErro,
  ValidacaoCustoFixo
} from "@/lib/financeiro/custo-fixo";
import { transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * PATCH /api/financeiro/gerencial/custo-fixo/[id]
 *
 * Os três atos da tela de configuração, num verbo só, porque são o mesmo gesto
 * do ponto de vista de quem usa: abrir a linha e mexer nela.
 *
 *   `{"status": "ativo"}`                             liga
 *   `{"status": "suspenso", "motivo": "..."}`         desliga (motivo obrigatório)
 *   `{"valorCents": 550000, "motivo": "reajuste"}`    reajusta
 *   `{"revisado": true}`                              marca como olhado
 *
 * As três podem vir juntas e são aplicadas NESTA ORDEM: reajuste, depois
 * status, depois revisão. A ordem importa — ligar um item sem valor é recusado
 * pelo CHECK da 0057, e quem manda "valor novo + ativo" na mesma requisição
 * espera que o valor entre primeiro.
 *
 * O QUE ESTE PATCH NÃO ACEITA, e por quê:
 *
 *   · `conflito_camada` — quem apaga o conflito à mão está apagando a única
 *     coisa que impede a folha de ser contada duas vezes. O conflito é
 *     derivado do ledger e se resolve corrigindo o ledger.
 *   · `counterparty_id` e `category_id` — mudá-los faria a linha herdar a
 *     evidência de um grupo que não é o dela. Quem precisa disso desliga esta
 *     e adota a outra; as duas decisões ficam registradas.
 *   · `amount_cents` sem motivo — reajuste sem motivo é reajuste que ninguém
 *     consegue conferir depois. O CHECK da tabela de histórico repete a exigência.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: bruto } = await ctx.params;
  const id = Number(bruto);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ erro: "id inválido" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);

  try {
    const resultado = await transaction(async (c) => {
      const feito: Record<string, unknown> = {};

      // 1. Reajuste primeiro: quem manda "valor novo + ativo" espera que o
      //    valor exista quando o CHECK de ativação for avaliado.
      if (corpo.valorCents !== undefined && corpo.valorCents !== null) {
        feito.reajuste = await reajustar(c, { id, reajuste: reajusteDe(corpo), actor });
      }

      // 2. Status.
      if (corpo.status !== undefined && corpo.status !== null) {
        feito.status = await mudarStatus(c, { id, mudanca: mudancaStatusDe(corpo), actor });
      }

      // 3. Revisão. Reajustar já marca revisado; `{"revisado": true}` sozinho é
      //    o caso de "olhei e está certo", que é uma decisão e precisa existir —
      //    sem ela a fila de revisão nunca esvazia.
      if (corpo.revisado === true) {
        feito.revisao = await marcarRevisado(c, { id, actor, nota: (corpo.nota as string) ?? null });
      }

      if (!Object.keys(feito).length) {
        throw new ValidacaoCustoFixo(
          400,
          'nada a fazer. Envie {"status":…}, {"valorCents":…,"motivo":…} ou {"revisado":true}'
        );
      }
      return feito;
    });

    return Response.json(
      {
        ok: true,
        id,
        ...resultado,
        ressalvas: [
          "Ligar não adianta o caixa: o item continua sendo previsão até o dinheiro sair do extrato.",
          "O reajuste vale do mês corrente em diante — o catálogo muda a previsão dos meses seguintes, nunca o passado."
        ]
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
