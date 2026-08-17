import { headers } from "next/headers";

import { sessaoAtual } from "@/app/api/time/_sessao";
import { CABECALHO_PERFIL, type Perfil } from "@/lib/auth/perfis";
import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { getNotificacoes, marcarTodasLidas, sincronizar } from "@/lib/financeiro/notificacoes";

/**
 * O sino.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA ROTA VIVE FORA DE /api/financeiro
 * ---------------------------------------------------------------------------
 * Porque o time também é notificado. Se ela morasse sob o prefixo do
 * financeiro, o middleware devolveria 404 para o perfil comum e a pessoa nunca
 * saberia que o reembolso dela foi respondido.
 *
 * O que impede isso de virar um buraco: o conteúdo que sai daqui é filtrado
 * pelo PERFIL, que vem do cabeçalho carimbado pelo middleware, e pela PESSOA,
 * que vem do cookie de sessão resolvido em banco. Nenhum dos dois é enviado
 * pelo cliente. Um `x-xpe-perfil: admin` mandado por curl é sobrescrito antes
 * de chegar aqui — é o que `seguir()` no middleware faz, e o comentário de lá
 * explica que sem isso a autorização viraria um campo que o atacante preenche.
 *
 * O sync roda na leitura (barato: são views) para quem abre o sino ver o estado
 * de agora e não o da última rodada do cron. Se ele falhar, a leitura segue: um
 * erro de geração não pode esconder o que já está na caixa.
 */

export const dynamic = "force-dynamic";

async function quemEsta() {
  const perfil: Perfil = (await headers()).get(CABECALHO_PERFIL) === "admin" ? "admin" : "comum";
  const sessao = await sessaoAtual().catch(() => null);
  return { perfil, personId: sessao?.personId ?? null, nome: sessao?.nome ?? null };
}

export async function GET(request: Request) {
  try {
    const { perfil, personId } = await quemEsta();
    const url = new URL(request.url);

    if (url.searchParams.get("sync") !== "0") {
      await sincronizar(`app:${perfil}`).catch((erro) => {
        console.error("[notificacoes] sync falhou, seguindo com a caixa existente:", erro);
      });
    }

    const caixa = await getNotificacoes(perfil, personId, {
      incluirResolvidas: url.searchParams.get("resolvidas") === "1",
      limite: Number(url.searchParams.get("limite") ?? 60)
    });
    return Response.json(caixa);
  } catch (erro) {
    if (erro instanceof FinanceUnavailableError) {
      // O sino não pode derrubar a plataforma inteira: ele aparece em todas as
      // telas. Banco fora do ar vira "sem caixa", não erro 500 no topo da página.
      return Response.json(
        {
          disponivel: false,
          motivoIndisponivel: "banco financeiro indisponível",
          naoLidas: 0,
          notificacoes: [],
          destinatario: { perfil: "comum", pessoa: null }
        },
        { status: 200 }
      );
    }
    console.error("[notificacoes] falha:", erro);
    return Response.json({ error: "não consegui ler as notificações" }, { status: 500 });
  }
}

/** POST /api/notificacoes — marca tudo que está na caixa desta pessoa como lido. */
export async function POST() {
  try {
    const { perfil, personId } = await quemEsta();
    const marcadas = await marcarTodasLidas(perfil, personId);
    return Response.json({ ok: true, marcadas });
  } catch (erro) {
    if (erro instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    console.error("[notificacoes] marcar todas falhou:", erro);
    return Response.json({ error: "não consegui marcar" }, { status: 500 });
  }
}
