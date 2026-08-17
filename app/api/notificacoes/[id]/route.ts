import { headers } from "next/headers";

import { sessaoAtual } from "@/app/api/time/_sessao";
import { CABECALHO_PERFIL, type Perfil } from "@/lib/auth/perfis";
import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { marcarNotificacao } from "@/lib/financeiro/notificacoes";

/**
 * PATCH /api/notificacoes/[id] — muda o estado de UM aviso.
 *
 * 404 e não 403 quando o aviso não é seu, pelo mesmo motivo do middleware: 403
 * confirmaria que a notificação existe. Aqui o efeito prático é menor (não há
 * conteúdo na resposta), mas a regra tem de ser a mesma em toda a plataforma,
 * senão vira "às vezes 403" e a inconsistência é o que se aprende a explorar.
 *
 * `resolvida` é um estado do HUMANO, não do fato: quem resolve o fato é o
 * mundo, e o sync marca sozinho quando ele some. Isto aqui é "já cuidei disso,
 * some da minha caixa" — e se o fato voltar, o sync reabre.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const notificacaoId = Number(id);
    if (!Number.isInteger(notificacaoId) || notificacaoId <= 0) {
      return Response.json({ error: "id inválido" }, { status: 400 });
    }

    const corpo = (await request.json().catch(() => ({}))) as { estado?: unknown };
    const estado = corpo.estado;
    if (estado !== "lida" && estado !== "resolvida" && estado !== "nao_lida") {
      return Response.json({ error: "estado deve ser lida, resolvida ou nao_lida" }, { status: 422 });
    }

    const perfil: Perfil = (await headers()).get(CABECALHO_PERFIL) === "admin" ? "admin" : "comum";
    const sessao = await sessaoAtual().catch(() => null);

    const ok = await marcarNotificacao(
      perfil,
      sessao?.personId ?? null,
      notificacaoId,
      estado,
      sessao?.nome ? `time:${sessao.nome}` : perfil
    );
    if (!ok) return Response.json({ error: "não encontrada" }, { status: 404 });
    return Response.json({ ok: true, id: notificacaoId, estado });
  } catch (erro) {
    if (erro instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    console.error("[notificacoes] patch falhou:", erro);
    return Response.json({ error: "não consegui marcar" }, { status: 500 });
  }
}
