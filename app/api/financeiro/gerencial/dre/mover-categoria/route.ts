import {
  aplicarMoverCategoria,
  simularMoverCategoria,
  ALVOS_MOVER,
  type AlvoMover
} from "@/lib/financeiro/contratos/dre-drill";
import {
  ParametroInvalido,
  comRessalvas,
  inteiroDe,
  opcaoDe,
  responderContrato,
  rotaDeLeitura
} from "@/lib/financeiro/contratos/http";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { brl, contagem } from "../../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Mover um item de uma linha da DRE para outra.
 *
 * ---------------------------------------------------------------------------
 * DUAS URLS SERIAM DUAS VERDADES: A SIMULAÇÃO E A APLICAÇÃO SÃO O MESMO CAMINHO
 * ---------------------------------------------------------------------------
 *   GET  .../dre/mover-categoria?alvo=&ids=&categoriaId=    → dry-run
 *   POST .../dre/mover-categoria  {..., "aplicar": true}    → aplica
 *
 * A tentação era `/dre/impacto-simulado` de um lado e `/dre/mover-categoria` do
 * outro. Recusada: dois caminhos independentes divergem, e a divergência
 * apareceria justamente no dia em que alguém confiasse na simulação. Aqui o
 * verbo é a única diferença, e o julgamento é literalmente a mesma função
 * (`fin_dre_mover_avaliar`) nos dois.
 *
 * E o POST sem `aplicar: true` é dry-run também. Escrever é sempre um ato
 * explícito, nunca o padrão de um corpo mal preenchido.
 *
 * ---------------------------------------------------------------------------
 * ESTA É A PRIMEIRA ROTA DE ESCRITA DE `/api/financeiro`. O QUE ISSO SIGNIFICA:
 * ---------------------------------------------------------------------------
 * · Ela escreve NO LEDGER PRÓPRIO e em mais nada. A restrição "APIs externas:
 *   somente GET" continua inteira: nenhuma chamada a Asaas, Inter, Polp ou
 *   Pipedrive sai daqui, nem direta nem indireta.
 * · Ela não move dinheiro. Move CLASSIFICAÇÃO. A âncora de soma por conta é
 *   idêntica antes e depois, e a regra de ouro é reconferida DENTRO da mesma
 *   transação — se ela deixar de fechar, tudo volta.
 * · Ela exige autor e motivo. Trilha sem quem decidiu é decorativa, e "ajuste"
 *   não é motivo. O banco recusa os dois casos.
 *
 * ---------------------------------------------------------------------------
 * O QUE ELA NÃO FAZ, E POR QUÊ
 * ---------------------------------------------------------------------------
 * NÃO existe "adicionar linha à DRE". A DRE é DERIVADA de `fin_transaction` e
 * `fin_card_transaction`; uma linha acrescentada sem lastro seria resultado
 * inventado. O que existe é classificar dinheiro que já está no extrato (esta
 * rota) e registrar um AJUSTE DECLARADO em `fin_dre_ajuste` — com autor,
 * motivo e data, em seção própria, jamais misturado ao extrato e jamais
 * alterando saldo de conta.
 */

const ALVOS = ALVOS_MOVER;
const MAX_IDS = 500;

/** GET = dry-run. Devolve o impacto na DRE antes/depois sem escrever nada. */
export const GET = rotaDeLeitura(async (sp) => {
  const alvo = opcaoDe<AlvoMover>(sp, "alvo", ALVOS, "fin_transaction");
  const ids = lerIds(sp.getAll("ids").flatMap((v) => v.split(",")));
  const categoriaId = inteiroDe(sp, "categoriaId", { min: 1, max: 2_147_483_647 });
  if (categoriaId === undefined) {
    throw new ParametroInvalido("categoriaId", "categoriaId é obrigatório: mover exige destino");
  }

  const contrato = await simularMoverCategoria({ alvo, ids, categoriaId });
  return responderContrato(comRessalvas(contrato, ...frasesMedidas(contrato.dado)));
});

/**
 * POST = aplica, se e somente se `aplicar: true`.
 *
 * Corpo:
 * ```json
 * { "alvo": "fin_transaction", "ids": [1041], "categoriaId": 22,
 *   "motivo": "a regra 40 casava o banco do recebedor, não a contraparte",
 *   "autor": "fernando", "aplicar": true }
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const corpo = await lerCorpo(request);

    if (!corpo.aplicar) {
      const contrato = await simularMoverCategoria({
        alvo: corpo.alvo,
        ids: corpo.ids,
        categoriaId: corpo.categoriaId
      });
      return responderContrato(
        comRessalvas(
          contrato,
          'POST sem "aplicar": true é DRY-RUN. Nada foi escrito. Reenvie com "aplicar": true depois de conferir o impacto abaixo.',
          ...frasesMedidas(contrato.dado)
        )
      );
    }

    if (!corpo.motivo || corpo.motivo.trim().length < 8) {
      throw new ParametroInvalido(
        "motivo",
        'motivo é obrigatório e precisa de pelo menos 8 caracteres: "ajuste" é rótulo, não motivo'
      );
    }
    if (!corpo.autor || corpo.autor.trim().length === 0) {
      throw new ParametroInvalido("autor", "autor é obrigatório: trilha sem quem decidiu é decorativa");
    }

    const contrato = await aplicarMoverCategoria({
      alvo: corpo.alvo,
      ids: corpo.ids,
      categoriaId: corpo.categoriaId,
      motivo: corpo.motivo.trim(),
      autor: corpo.autor.trim()
    });
    return responderContrato(comRessalvas(contrato, ...frasesMedidas(contrato.dado)));
  } catch (erro) {
    if (erro instanceof ParametroInvalido) {
      return Response.json(
        { erro: erro.message, parametro: erro.parametro },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (erro instanceof FinanceUnavailableError) {
      return Response.json(
        { erro: "banco financeiro indisponível", motivo: erro.message },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw erro;
  }
}

type Corpo = {
  alvo: AlvoMover;
  ids: number[];
  categoriaId: number;
  motivo?: string;
  autor?: string;
  aplicar: boolean;
};

async function lerCorpo(request: Request): Promise<Corpo> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ParametroInvalido("corpo", "corpo precisa ser JSON válido");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParametroInvalido("corpo", "corpo precisa ser um objeto JSON");
  }
  const c = json as Record<string, unknown>;

  const alvo = c.alvo === undefined ? "fin_transaction" : String(c.alvo);
  if (!(ALVOS as readonly string[]).includes(alvo)) {
    throw new ParametroInvalido("alvo", `alvo deve ser um de: ${ALVOS.join(", ")}`);
  }

  if (!Array.isArray(c.ids)) {
    throw new ParametroInvalido("ids", "ids deve ser uma lista de inteiros");
  }
  const ids = lerIds(c.ids.map((v) => String(v)));

  const categoriaId = Number(c.categoriaId);
  if (!Number.isInteger(categoriaId) || categoriaId < 1) {
    throw new ParametroInvalido(
      "categoriaId",
      "categoriaId deve ser um inteiro positivo. Mover para 'sem categoria' não é mover: " +
        "é devolver o lançamento à lacuna, e isso se faz pela fila de revisão, com motivo declarado"
    );
  }

  return {
    alvo: alvo as AlvoMover,
    ids,
    categoriaId,
    motivo: c.motivo === undefined ? undefined : String(c.motivo),
    autor: c.autor === undefined ? undefined : String(c.autor),
    aplicar: c.aplicar === true
  };
}

function lerIds(brutos: string[]): number[] {
  const ids = brutos.map((v) => v.trim()).filter((v) => v.length > 0).map(Number);
  if (ids.length === 0) {
    throw new ParametroInvalido("ids", "ids é obrigatório e não pode ser vazio");
  }
  if (ids.length > MAX_IDS) {
    throw new ParametroInvalido("ids", `o lote aceita no máximo ${MAX_IDS} lançamentos por vez`);
  }
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 1) {
      throw new ParametroInvalido("ids", "cada id deve ser um inteiro positivo");
    }
  }
  return [...new Set(ids)];
}

/**
 * As frases medidas na requisição.
 *
 * Todas derivadas do corpo que acabou de voltar — nenhuma consulta extra, pela
 * mesma regra de `_medido.ts`: se não puder ser medida a partir da resposta,
 * não pertence aqui.
 */
function frasesMedidas(dado: Awaited<ReturnType<typeof simularMoverCategoria>>["dado"]): (string | null)[] {
  const recusados = dado.avaliacoes.filter((a) => !a.aceito);
  const porLinha = new Map<string, number>();
  for (const i of dado.impacto) {
    if (i.deltaCents === 0) continue;
    porLinha.set(i.linha, (porLinha.get(i.linha) ?? 0) + i.deltaCents);
  }
  const movimento = [...porLinha.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([linha, delta]) => `${linha} ${delta > 0 ? "+" : ""}${brl(delta)}`)
    .join(" · ");

  return [
    movimento
      ? `Impacto na DRE: ${movimento}. A soma dos deltas de cada (visão, mês) é ZERO — mover reposiciona dinheiro, não cria nem destrói.`
      : null,
    recusados.length
      ? `${contagem(recusados.length, "lançamento foi recusado", "lançamentos foram recusados")}: ` +
          recusados
            .slice(0, 3)
            .map((r) => `#${r.id} — ${r.recusa}`)
            .join(" | ")
      : null,
    dado.semEfeito
      ? `${contagem(dado.semEfeito, "lançamento já está", "lançamentos já estão")} na categoria de destino: sem efeito, e não é erro.`
      : null,
    dado.regraDeOuro && !dado.regraDeOuro.fecha
      ? "A REGRA DE OURO NÃO ESTÁ FECHANDO. Nenhum movimento deveria ser aplicado antes de o resíduo voltar a zero."
      : null
  ];
}
