import {
  alvosAgendaDe,
  autorDe,
  confirmarLoteMisto,
  editarItemDaAgenda,
  respostaDeErro,
  resolverItem,
  ValidacaoAgenda,
  type AlvoAgenda
} from "@/lib/financeiro/agenda";
import { transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/agenda/confirmar
 *
 * "Confirmar em lote os que estão certos" — e também "marcar que não vai
 * acontecer", em lote, porque as duas são a mesma ação de triagem vista de
 * lados opostos e separá-las em duas telas faria o usuário passar duas vezes
 * pela mesma lista.
 *
 * Corpo:
 *   {
 *     "acao": "confirmar" | "nao-vai-acontecer",
 *     "itens": [
 *       { "direcao": "pagar", "id": 12, "valorCents": 162200 },
 *       { "direcao": "receber", "competencia": "2026-09", "origemRef": "fin_recurring:8" }
 *     ],
 *     "nota": "conferido com o contrato",       // confirmar
 *     "motivo": "cliente cancelou o contrato"   // nao-vai-acontecer
 *   }
 *
 * MATERIALIZAR É NEUTRO; SÓ CONFIRMAR MOVE O NÚMERO.
 *
 * A maior parte das linhas da agenda é PROJEÇÃO — não existe item, e portanto
 * não existe id. Confirmar por `{competencia, origemRef}` materializa o item
 * primeiro, e essa materialização não muda o total do mês: o item derivado
 * herda a somabilidade da projeção que o originou, e a projeção cala. É a trava
 * que impede as 11 recorrentes propostas (R$ 11.593,04/mês, mantidas fora do
 * saldo pelo CHECK da 0057) de entrarem no total só por terem virado linha.
 *
 * `valorCents` ausente confirma pelo valor previsto. Presente, ele é o AJUSTE —
 * e `ajusteCents` é o único número desta base que afere a previsão item a item.
 * É também o que `fin_agenda_prova_v` usa para explicar por que a soma da
 * agenda pode legitimamente divergir da projeção.
 *
 * O lote inteiro roda numa transação só, com `batchId` compartilhado no
 * `fin_audit_log` — sem ele, confirmar 30 linhas viraria 30 decisões avulsas e
 * o desfazer viraria arqueologia.
 *
 * NADA AQUI VIRA CAIXA. Confirmar não cria lançamento, não muda saldo, não
 * emite cobrança e não paga nada. Depois de um lote, `6/6 contas fecham`
 * continua valendo.
 */
export async function POST(request: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);
  const acao = corpo.acao === "nao-vai-acontecer" ? "nao-vai-acontecer" : "confirmar";

  try {
    const alvos = alvosAgendaDe(corpo.itens);

    if (acao === "nao-vai-acontecer") {
      const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() : "";
      if (!motivo) {
        throw new ValidacaoAgenda(
          422,
          'marcar "não vai acontecer" exige motivo: {"acao":"nao-vai-acontecer","motivo":"...","itens":[…]}. ' +
            "Neutralizar sem motivo é apagar com mais passos."
        );
      }
      const resultado = await transaction(async (c) => {
        const feitos: { id: number; direcao: string; materializado: boolean }[] = [];
        for (const alvo of alvos) {
          // Materializa antes: só existe item para ignorar depois que a
          // projeção vira linha. A decisão precisa de um lugar onde morar.
          const r = await resolverItem(c, { alvo, actor });
          await editarItemDaAgenda(c, {
            direcao: r.direcao,
            id: r.id,
            patch: { ignorar: motivo },
            actor
          });
          feitos.push({ id: r.id, direcao: r.direcao, materializado: r.materializado });
        }
        return feitos;
      });
      return Response.json(
        {
          ok: true,
          acao,
          motivo,
          itens: resultado,
          ressalvas: [
            "Nada foi apagado. Os itens saíram do total e continuam visíveis com o motivo — " +
              'volte com PATCH {"reativar": true}.',
            "A projeção que originou cada um NÃO ressuscita: ignorar é decisão sobre o dinheiro, não desfazer."
          ]
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ── confirmar ────────────────────────────────────────────────────────
    const itens = (Array.isArray(corpo.itens) ? corpo.itens : [corpo.itens]).map((bruto, i) => {
      const b = (bruto ?? {}) as Record<string, unknown>;
      const alvo = alvos[i] as AlvoAgenda;
      const valorCents =
        b.valorCents === undefined || b.valorCents === null || b.valorCents === "" ? null : Number(b.valorCents);
      if (valorCents !== null && (!Number.isSafeInteger(valorCents) || valorCents < 0)) {
        throw new ValidacaoAgenda(400, `itens[${i}].valorCents deve ser inteiro em centavos, não negativo`);
      }
      return { ...alvo, valorCents };
    });

    const nota = typeof corpo.nota === "string" ? corpo.nota.trim() || null : null;
    const r = await transaction((c) => confirmarLoteMisto(c, { itens, actor, nota }));

    const confirmados = (r.pagar?.confirmados ?? 0) + (r.receber?.confirmados ?? 0);
    const materializados = (r.pagar?.materializados ?? 0) + (r.receber?.materializados ?? 0);
    const ajuste = (r.pagar?.ajusteCents ?? 0) + (r.receber?.ajusteCents ?? 0);

    return Response.json(
      {
        ok: true,
        acao,
        confirmados,
        materializados,
        ajusteCents: ajuste,
        pagar: r.pagar,
        receber: r.receber,
        ressalvas: [
          "Confirmar NÃO adianta o caixa: nenhum lançamento foi criado, nenhum saldo mudou, nenhuma cobrança foi emitida.",
          materializados
            ? `${materializados} projeção(ões) virou/viraram item nesta chamada. Materializar não muda o total do mês — ` +
              "a projeção correspondente cala e o item herda a somabilidade dela."
            : null,
          ajuste !== 0
            ? `A confirmação ajustou ${(ajuste / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ` +
              "sobre o valor projetado. Esse é o erro da previsão medido item a item, e é o delta que " +
              "fin_agenda_prova_v aceita como legítimo."
            : null
        ].filter(Boolean)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
