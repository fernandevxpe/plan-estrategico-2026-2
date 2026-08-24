import { FinanceUnavailableError } from "@/lib/financeiro/db";
import {
  atribuirSaidaSemDono,
  tipoSaidaValido
} from "@/lib/financeiro/saida-sem-dono";
import { ValidacaoError } from "@/lib/financeiro/revisao";

/**
 * POST /api/financeiro/lancamentos/[id]/favorecido
 *
 * Dá favorecido (e categoria, quando o tipo tem) a uma saída que estava sem
 * dono. Usado pela cobertura de /financeiro/pessoas.
 *
 * Corpo: { tipo, nome?, aplicarIguais?, ator? }
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  if (!tipoSaidaValido(body.tipo)) {
    return Response.json(
      { error: "tipo deve ser fornecedor_obras, utilidade, imposto_simples ou outro" },
      { status: 422 }
    );
  }

  try {
    const resultado = await atribuirSaidaSemDono({
      transactionId: idNum,
      tipo: body.tipo,
      nome: typeof body.nome === "string" ? body.nome : null,
      aplicarIguais: body.aplicarIguais === true,
      ator: typeof body.ator === "string" ? body.ator : "ui"
    });
    return Response.json({ ok: true, ...resultado });
  } catch (error) {
    if (error instanceof ValidacaoError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
