import { apagarItem, autorDe, editarItem, respostaDeErro, ValidacaoCusto } from "@/lib/financeiro/custos";
import { transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteParams = { params: Promise<{ id: string }> };

function idDe(bruto: string): number {
  const n = Number(bruto);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ValidacaoCusto(400, "id inválido");
  return n;
}

/**
 * PATCH /api/financeiro/gerencial/custos/[id] — editar um item.
 *
 * Corpo com qualquer subconjunto de:
 *   descricao · valorCents · indeterminadoMotivo · categoria (code) · nucleo ·
 *   centroDeCusto · contraparte · diaEsperado · ignorar (motivo) · reativar
 *
 * O QUE NÃO SE EDITA, E POR QUÊ CADA UM
 *
 * `origemRef` — mudá-lo faria o item calar uma projeção que não o originou.
 * É a dupla contagem ao contrário: dinheiro real sumindo do mês sem que
 * nenhuma linha diga que sumiu.
 *
 * `competencia` — mover o custo de mês sem trilha de que mês ele veio. Quem
 * precisa disso ignora o item e cria outro: as duas decisões ficam registradas.
 *
 * `estado` — para confirmar existe `POST /custos/confirmar`; para tirar do
 * total existe `{"ignorar": "motivo"}`. Um PATCH genérico em `estado` seria o
 * caminho por onde `realizado` entraria sem lançamento no extrato, que é
 * exatamente o que esta base promete não deixar acontecer.
 *
 * Item realizado não se edita: o lançamento já existe e a previsão está fechada.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);
  try {
    const alvo = idDe(id);
    const resultado = await transaction((c) => editarItem(c, { id: alvo, patch: corpo, actor }));
    return Response.json(
      {
        ok: true,
        ...resultado,
        ressalvas: resultado.alterados.includes("ignorar")
          ? ["Item ignorado sai do total e continua visível, com o motivo. A projeção que o originou NÃO ressuscita — ignorar é uma decisão sobre o dinheiro, não um desfazer."]
          : []
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

/**
 * DELETE /api/financeiro/gerencial/custos/[id] — só item manual, nunca realizado.
 *
 * Derivado não se apaga. Ele voltaria na próxima leitura da projeção, e o
 * apagamento teria destruído a única coisa que o apagamento produziu: a nota de
 * quem decidiu tirá-lo. O caminho é `PATCH {"ignorar": "motivo"}` — a decisão
 * fica à vista e é reversível por `{"reativar": true}`.
 *
 * A regra vive em três camadas: aqui, em `apagarItem`, e no gatilho
 * `fin_custo_previsto_apagar_trg`. A do banco é a que vale mesmo quando alguém
 * escrever um DELETE por fora.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const actor = autorDe(request);
  try {
    const alvo = idDe(id);
    const resultado = await transaction((c) => apagarItem(c, { id: alvo, actor }));
    return Response.json({ ok: true, apagado: resultado }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
