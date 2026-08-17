import {
  apagarEntrada,
  autorDe,
  direcaoDe,
  editarItemDaAgenda,
  respostaDeErro,
  ValidacaoAgenda
} from "@/lib/financeiro/agenda";
import { apagarItem as apagarCusto } from "@/lib/financeiro/custos";
import { transaction } from "@/lib/financeiro/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteParams = { params: Promise<{ direcao: string; id: string }> };

function idDe(bruto: string): number {
  const n = Number(bruto);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ValidacaoAgenda(400, "id inválido");
  return n;
}

/**
 * PATCH /api/financeiro/gerencial/agenda/itens/[direcao]/[id]
 *
 * O "organizar o que estiver errado, ir item a item".
 *
 * Corpo com qualquer subconjunto de:
 *   descricao · valorCents · indeterminadoMotivo · categoria (code) · nucleo ·
 *   centroDeCusto · contraparte · diaEsperado · ignorar (motivo) · reativar
 *
 * `{"ignorar": "motivo"}` é o "não vai acontecer": o item sai do total,
 * CONTINUA VISÍVEL com o motivo, e volta com `{"reativar": true}`. Não se
 * apaga nada — neutralizar com trilha é o padrão desta base desde a 0095.
 *
 * `{"diaEsperado": "..."}` é o ajuste de data que a agenda precisa: o item
 * muda de dia no calendário e a `dia_regra` passa a dizer "ajustado à mão por
 * fulano". Deixar a regra antiga faria a tela afirmar "vencimento do boleto"
 * sobre um dia que o boleto não declara.
 *
 * O DESPACHO ACONTECE AQUI, E É DELIBERADO. `direcao=pagar` escreve em
 * `fin_custo_previsto` pelas funções da migration 0100, que é a dona do item de
 * custo; `direcao=receber` escreve em `fin_receita_prevista` (0104). Duas rotas
 * para a mesma ação humana seria a fronteira interna do backend vazando na UX.
 *
 * O QUE NÃO SE EDITA, E POR QUÊ CADA UM
 *
 * `origemRef` — mudá-lo faria o item calar uma projeção que não o originou. É
 * a dupla contagem ao contrário: dinheiro real sumindo do mês sem que nenhuma
 * linha diga que sumiu.
 *
 * `competencia` — moveria a obrigação de mês sem trilha de que mês ela veio.
 * Quem precisa disso ignora o item e cria outro: as duas decisões ficam.
 *
 * `estado` — confirmar tem rota própria; tirar do total é `ignorar`. Um PATCH
 * genérico em `estado` seria o caminho por onde 'realizado' entraria sem
 * lançamento no extrato, que é exatamente o que esta base promete não deixar
 * acontecer.
 *
 * Toda alteração grava `fin_audit_log` com o valor ANTERIOR. Sem o `before`,
 * "alguém mudou" é uma afirmação sem conteúdo.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { direcao: dirBruta, id } = await params;
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ erro: "corpo não é JSON válido" }, { status: 400 });
  }

  const actor = autorDe(request);
  try {
    const direcao = direcaoDe(dirBruta, "direcao (no caminho)");
    const alvo = idDe(id);
    const resultado = await transaction((c) => editarItemDaAgenda(c, { direcao, id: alvo, patch: corpo, actor }));
    return Response.json(
      {
        ok: true,
        direcao,
        ...resultado,
        ressalvas: resultado.alterados.includes("ignorar")
          ? [
              'Item marcado como "não vai acontecer": sai do total e continua visível, com o motivo. ' +
                "A projeção que o originou NÃO ressuscita — ignorar é decisão sobre o dinheiro, não desfazer."
            ]
          : resultado.alterados.includes("diaEsperado")
            ? [
                "O item mudou de dia no calendário e a regra do dia passou a ser 'ajustado à mão'. " +
                  "O total do MÊS não muda; o do DIA, sim — e a curva de saldo acompanha."
              ]
            : []
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

/**
 * DELETE — só item manual, nunca derivado, nunca realizado.
 *
 * Derivado não se apaga: ele voltaria na próxima leitura da projeção, e o
 * apagamento teria destruído a única coisa que produziu — a nota de quem
 * decidiu tirá-lo. O caminho é `PATCH {"ignorar": "motivo"}`.
 *
 * A regra vive em três camadas: aqui, na função, e no gatilho do banco. A do
 * banco é a que vale quando alguém escrever um DELETE por fora.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const { direcao: dirBruta, id } = await params;
  const actor = autorDe(request);
  try {
    const direcao = direcaoDe(dirBruta, "direcao (no caminho)");
    const alvo = idDe(id);
    const resultado = await transaction((c) =>
      direcao === "pagar" ? apagarCusto(c, { id: alvo, actor }) : apagarEntrada(c, { id: alvo, actor })
    );
    return Response.json({ ok: true, direcao, apagado: resultado }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    return respostaDeErro(erro);
  }
}
