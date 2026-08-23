import { headers } from "next/headers";

import { CABECALHO_PERFIL } from "@/lib/auth/perfis";
import { atualizarMatchesEstornosAbertos, cancelarItemReembolsoAdmin, confirmarEstornoAdmin, listarEstornosAdmin } from "@/lib/financeiro/estorno-reembolso-admin";
import { TimeError } from "@/lib/financeiro/time";

export const dynamic = "force-dynamic";

async function exigirAdmin() {
  const perfil = (await headers()).get(CABECALHO_PERFIL);
  if (perfil !== "admin") throw new TimeError("não encontrado", 404);
}

export async function GET() {
  try {
    await exigirAdmin();
    await atualizarMatchesEstornosAbertos();
    const estornos = await listarEstornosAdmin();
    return Response.json({ estornos });
  } catch (erro) {
    if (erro instanceof TimeError) return Response.json({ erro: erro.message }, { status: erro.status });
    // A mensagem crua do Postgres NÃO sai daqui. Foi por ela que se leu o nome
    // de uma coluna pelo fio durante a auditoria; e mesmo sendo rota de admin,
    // o resto do módulo (`_sessao.ts`) não vaza interno e esta não deve ser a
    // exceção. O detalhe fica no log do servidor, onde é útil.
    console.error("[estornos-reembolso]", erro);
    return Response.json({ erro: "não consegui concluir" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await exigirAdmin();
    const corpo = (await request.json().catch(() => ({}))) as {
      personId?: unknown;
      itemFonte?: unknown;
      itemId?: unknown;
      motivoCategoria?: unknown;
      motivo?: unknown;
      confirmar?: unknown;
      ator?: unknown;
    };
    const personId = Number(corpo.personId);
    const itemId = Number(corpo.itemId);
    const fonte = corpo.itemFonte;
    if (!Number.isFinite(personId) || !Number.isFinite(itemId)) {
      return Response.json({ erro: "personId e itemId obrigatórios" }, { status: 400 });
    }
    if (fonte !== "app" && fonte !== "planilha") {
      return Response.json({ erro: "itemFonte inválida" }, { status: 400 });
    }
    const estorno = await cancelarItemReembolsoAdmin(
      personId,
      fonte,
      itemId,
      {
        motivoCategoria: String(corpo.motivoCategoria ?? "outro"),
        motivo: String(corpo.motivo ?? ""),
        confirmar: corpo.confirmar === true
      },
      typeof corpo.ator === "string" && corpo.ator.trim() ? corpo.ator.trim() : "admin"
    );
    return Response.json({ estorno });
  } catch (erro) {
    if (erro instanceof TimeError) return Response.json({ erro: erro.message }, { status: erro.status });
    // A mensagem crua do Postgres NÃO sai daqui. Foi por ela que se leu o nome
    // de uma coluna pelo fio durante a auditoria; e mesmo sendo rota de admin,
    // o resto do módulo (`_sessao.ts`) não vaza interno e esta não deve ser a
    // exceção. O detalhe fica no log do servidor, onde é útil.
    console.error("[estornos-reembolso]", erro);
    return Response.json({ erro: "não consegui concluir" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await exigirAdmin();
    const corpo = (await request.json().catch(() => ({}))) as {
      id?: unknown;
      transactionId?: unknown;
      ator?: unknown;
    };
    const id = Number(corpo.id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ erro: "id inválido" }, { status: 400 });
    const estorno = await confirmarEstornoAdmin(id, {
      transactionId:
        corpo.transactionId === null || corpo.transactionId === undefined
          ? null
          : Number(corpo.transactionId),
      ator: typeof corpo.ator === "string" && corpo.ator.trim() ? corpo.ator.trim() : "admin"
    });
    return Response.json({ estorno });
  } catch (erro) {
    if (erro instanceof TimeError) return Response.json({ erro: erro.message }, { status: erro.status });
    // A mensagem crua do Postgres NÃO sai daqui. Foi por ela que se leu o nome
    // de uma coluna pelo fio durante a auditoria; e mesmo sendo rota de admin,
    // o resto do módulo (`_sessao.ts`) não vaza interno e esta não deve ser a
    // exceção. O detalhe fica no log do servidor, onde é útil.
    console.error("[estornos-reembolso]", erro);
    return Response.json({ erro: "não consegui concluir" }, { status: 500 });
  }
}
