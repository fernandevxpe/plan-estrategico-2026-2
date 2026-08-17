import { headers } from "next/headers";

import { CABECALHO_PERFIL } from "@/lib/auth/perfis";
import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { TimeError, schemaTimeDisponivel } from "@/lib/financeiro/time";
import { decidirEnvioDoTime, getFilaDoTime, getSaudeComprovante } from "@/lib/financeiro/time-admin";

/**
 * A fila do que o time mandou — e a decisão sobre ela.
 *
 * Esta rota mora sob `/api/financeiro` DE PROPÓSITO: é o prefixo que
 * `lib/auth/perfis.ts` marca como só-admin, e o middleware devolve 404 (não
 * 403) para o perfil comum. Decidir sobre o envio de outra pessoa é
 * exatamente o que o time não pode fazer, então a rota nasce protegida por
 * estar onde está — não por uma checagem que alguém precisa lembrar de
 * escrever.
 *
 * A dupla checagem do perfil abaixo é redundante com o middleware, e continua
 * aqui porque redundância barata em fronteira de autorização é a única
 * redundância que se paga: se um dia alguém mudar o `matcher` do middleware, a
 * rota não passa a responder para todo mundo em silêncio.
 */

export const dynamic = "force-dynamic";

async function exigirAdmin() {
  const perfil = (await headers()).get(CABECALHO_PERFIL);
  // Em desenvolvimento o middleware carimba 'admin' por padrão; ausência de
  // cabeçalho fora do middleware é um cenário que não deveria existir, e por
  // isso falha fechado.
  if (perfil !== "admin") throw new TimeError("não encontrado", 404);
}

export async function GET() {
  try {
    await exigirAdmin();
    if (!(await schemaTimeDisponivel())) {
      return Response.json({
        disponivel: false,
        motivo: "migration 0105 não aplicada",
        envios: [],
        totalCents: 0,
        semComprovante: 0,
        saude: null
      });
    }
    const [fila, saude] = await Promise.all([getFilaDoTime(), getSaudeComprovante()]);
    return Response.json({ disponivel: true, motivo: null, ...fila, saude });
  } catch (erro) {
    if (erro instanceof TimeError) return Response.json({ error: erro.message }, { status: erro.status });
    if (erro instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    console.error("[time-admin] fila falhou:", erro);
    return Response.json({ error: "não consegui ler a fila" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await exigirAdmin();
    const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const resultado = await decidirEnvioDoTime({
      origem: corpo.origem,
      id: corpo.id,
      decisao: corpo.decisao,
      motivo: corpo.motivo,
      ator: typeof corpo.ator === "string" && corpo.ator.trim() ? corpo.ator.trim() : "admin"
    });
    return Response.json({ ok: true, ...resultado });
  } catch (erro) {
    if (erro instanceof TimeError) return Response.json({ error: erro.message }, { status: erro.status });
    if (erro instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    console.error("[time-admin] decisão falhou:", erro);
    return Response.json({ error: "não consegui registrar a decisão" }, { status: 500 });
  }
}
