import { autorDe } from "@/lib/financeiro/custo-fixo";
import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { ErroInterPagamento } from "@/lib/financeiro/inter-pagamento";
import {
  devolverParaRascunho,
  enviarOrdemAoInter,
  enviarOrdensAoInter,
  programarPagamentos,
  ValidacaoPagamento,
  type AlvoProgramacao
} from "@/lib/financeiro/pagar-programar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/contas-a-pagar/programar
 *   Grava as ordens. Só Postgres — nenhum banco é chamado.
 *
 *   { "scheduledFor": "2026-09-05", "metodo": "pix", "alvos": [ ... ] }
 *
 * PUT  /api/financeiro/contas-a-pagar/programar
 *   Entrega UMA ordem ao Inter e para em `aguardando_autorizacao`.
 *
 *   { "id": 12 }
 *
 * A rota só traduz HTTP: toda a mecânica mora em lib/financeiro/pagar-programar.ts,
 * pelo mesmo motivo de `contas/route.ts` — um invariante cumprido em dois
 * lugares vira um invariante cumprido em um lugar e meio.
 *
 * SEM GUARD DE AUTENTICAÇÃO AQUI, e isso é decisão: o `middleware.ts` protege
 * `/api/financeiro` por PREFIXO. Um guard nesta rota seria a mesma regra escrita
 * duas vezes, e regra duplicada é a que diverge sem ninguém notar.
 *
 * O que nenhum verbo desta rota faz: aprovar, autorizar, confirmar ou consultar
 * o banco para aprovar. `PUT` termina em `aguardando_autorizacao`, que é onde a
 * 0075 diz que o produto acaba e a pessoa vai para o aplicativo do banco.
 */

function alvosDoCorpo(bruto: unknown): AlvoProgramacao[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((item) => {
    const linha = (item ?? {}) as Record<string, unknown>;
    return {
      chaveDedupe: String(linha.chaveDedupe ?? ""),
      origemTabela: linha.origemTabela == null ? null : String(linha.origemTabela),
      origemId: linha.origemId == null ? null : Number(linha.origemId),
      counterpartyId: Number(linha.counterpartyId),
      descricao: String(linha.descricao ?? ""),
      valorCents: Number(linha.valorCents),
      dueDate: String(linha.dueDate ?? ""),
      categoryId: linha.categoryId == null ? null : Number(linha.categoryId),
      nucleo: linha.nucleo == null ? null : String(linha.nucleo)
    };
  });
}

/**
 * O corpo do erro do Inter não traz segredo — descreve o que estava errado na
 * requisição — e nenhum palpite deste código foi verificado contra a API real.
 * Devolvê-lo é o que faz o primeiro teste real ser diagnóstico em vez de
 * adivinhação. 502 porque a falha é do lado de lá, não nosso.
 */
function respostaDeErro(error: unknown, contexto: string): Response {
  if (error instanceof ValidacaoPagamento) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ErroInterPagamento) {
    return Response.json({ error: `${error.message} ${error.corpo}`.trim() }, { status: 502 });
  }
  if (error instanceof FinanceUnavailableError) {
    return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
  }
  console.error(`[financeiro] ${contexto}:`, error);
  return Response.json({ error: "não salvou" }, { status: 500 });
}

export async function POST(request: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "corpo não é JSON válido" }, { status: 400 });
  }

  // `acao: "enviar"` é o mesmo caminho do PUT, para quem tiver cliente que não
  // manda PUT. Uma implementação só, dois endereços.
  if (corpo.acao === "enviar") return enviar(corpo, request);

  /*
   * `acao: "enviar-lote"` — o gesto do dono é um só: "seleciono o que vou pagar
   * e mando para aprovação". Sem isto a tela teria de criar N ordens e depois
   * disparar N requisições, e um erro no meio deixaria o usuário sem saber
   * quais entraram.
   *
   * Continua sem aprovar nada: cada ordem para em `aguardando_autorizacao`, e
   * quem aprova é a pessoa no aplicativo do Inter.
   */
  /*
   * `acao: "devolver"` — a ordem foi ao banco e não virou dinheiro.
   *
   * O Inter apaga o que fica sem saldo e não nos avisa; a credencial não tem
   * endpoint de consulta de pagamento. Então quem olha o aplicativo declara o
   * que viu, e a ordem volta para a fila. É afirmação humana registrada, não
   * dedução a partir do silêncio.
   */
  if (corpo.acao === "devolver") {
    try {
      const ids = Array.isArray(corpo.ids) ? corpo.ids.map(Number) : [];
      const resultado = await devolverParaRascunho(ids, {
        actor: autorDe(request),
        motivo: String(corpo.motivo ?? "")
      });
      return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return respostaDeErro(error, "devolver ordens para rascunho");
    }
  }

  if (corpo.acao === "enviar-lote") {
    try {
      const ids = Array.isArray(corpo.ids) ? corpo.ids.map(Number) : [];
      const resultado = await enviarOrdensAoInter(ids, { actor: autorDe(request) });
      return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return respostaDeErro(error, "enviar lote ao Inter");
    }
  }

  try {
    const resultado = await programarPagamentos(alvosDoCorpo(corpo.alvos), {
      scheduledFor: String(corpo.scheduledFor ?? ""),
      metodo: String(corpo.metodo ?? "pix") as "pix" | "ted" | "boleto",
      actor: autorDe(request)
    });
    return Response.json(resultado, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return respostaDeErro(error, "programar pagamentos");
  }
}

export async function PUT(request: Request) {
  let corpo: Record<string, unknown>;
  try {
    corpo = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "corpo não é JSON válido" }, { status: 400 });
  }
  return enviar(corpo, request);
}

async function enviar(corpo: Record<string, unknown>, request: Request): Promise<Response> {
  try {
    const resultado = await enviarOrdemAoInter(Number(corpo.id), { actor: autorDe(request) });
    return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return respostaDeErro(error, "enviar ordem ao Inter");
  }
}
