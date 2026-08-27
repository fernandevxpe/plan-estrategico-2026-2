import { FinanceUnavailableError } from "@/lib/financeiro/db";
import {
  getCadastroAppPessoa,
  salvarCadastroAppPessoa,
  type SalvarCadastroAppCorpo
} from "@/lib/financeiro/pessoa-cadastro-app";
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

/** GET/PATCH — cadastro do app (WhatsApp, PIX, aniversário, cartões). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return Response.json({ error: "id inválido" }, { status: 422 });
  }

  try {
    const dados = await getCadastroAppPessoa(personId);
    if (!dados) return Response.json({ error: "pessoa não encontrada" }, { status: 404 });
    return Response.json(dados);
  } catch (error) {
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return Response.json({ error: "id inválido" }, { status: 422 });
  }

  let corpo: SalvarCadastroAppCorpo;
  try {
    corpo = (await request.json()) as SalvarCadastroAppCorpo;
  } catch {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }

  try {
    const dados = await salvarCadastroAppPessoa(personId, corpo, atorDaRequisicao(request));
    return Response.json(dados);
  } catch (error) {
    if (error instanceof ValidacaoError) return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof FinanceUnavailableError) {
      return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
    }
    throw error;
  }
}
