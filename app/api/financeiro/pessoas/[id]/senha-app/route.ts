import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { definirSenhaAppPessoa } from "@/lib/financeiro/pessoa-cadastro-app";
import { ValidacaoError } from "@/lib/financeiro/revisao";

type RouteParams = { params: Promise<{ id: string }> };

function atorDaRequisicao(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return "ui";
  try {
    const decodificado = atob(header.slice("Basic ".length));
    const separador = decodificado.indexOf(":");
    const usuario = separador === -1 ? decodificado : decodificado.slice(0, separador);
    return usuario.trim() ? `ui:${usuario.trim()}` : "ui";
  } catch {
    return "ui";
  }
}

/** POST — define senha de entrega do app do time (mesma regra do script definir-acesso). */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return Response.json({ error: "id inválido" }, { status: 422 });
  }

  let corpo: { senha?: unknown };
  try {
    corpo = (await request.json()) as { senha?: unknown };
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  if (!senha.trim()) return Response.json({ error: "informe a senha" }, { status: 422 });

  try {
    const resultado = await definirSenhaAppPessoa(personId, senha.trim(), atorDaRequisicao(request));
    return Response.json({ ok: true, ...resultado });
  } catch (error) {
    if (error instanceof ValidacaoError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
