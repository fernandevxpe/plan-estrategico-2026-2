import { RecusaCategorizacao } from "@/lib/financeiro/categorizacao";
import { criarLinhaProduto, editarLinhaProduto } from "@/lib/financeiro/linhas-produto";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { autorDe, erro, lerCorpo, textoOpcional } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Linhas de produto — criação e edição (0124).
 *
 * POST   cria linha
 * PATCH  edita nome/descrição/ordem, ou desativa
 *
 * Sem GET: a leitura vem de `getPlanoDeContas` (a mesma chamada que já
 * alimenta a aba "Plano de contas"), não duplicada aqui. Sem DELETE: mesmo
 * motivo do plano de contas — o verbo não existe, em vez de existir e ser
 * negado. A recusa de desativar (linha com categoria ativa) mora em
 * `lib/financeiro/linhas-produto.ts`, lendo `fin_linha_produto_uso_v` (0124).
 */
export async function POST(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  try {
    const criada = await criarLinhaProduto(
      {
        nome: String(corpo.nome ?? "").trim(),
        descricao: textoOpcional(corpo.descricao),
        ordem: corpo.ordem === undefined ? undefined : Number(corpo.ordem)
      },
      autorDe(request)
    );
    return Response.json({ ok: true, linha: criada }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return traduzir(e);
  }
}

export async function PATCH(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  const id = Number(corpo.id);
  if (!Number.isSafeInteger(id) || id <= 0) return erro("informe o `id` da linha de produto a editar");

  try {
    const editada = await editarLinhaProduto(
      id,
      {
        nome: textoOpcional(corpo.nome) ?? undefined,
        descricao: corpo.descricao === undefined ? undefined : textoOpcional(corpo.descricao),
        ordem: corpo.ordem === undefined ? undefined : Number(corpo.ordem),
        ativa: typeof corpo.ativa === "boolean" ? corpo.ativa : undefined
      },
      autorDe(request)
    );
    return Response.json({ ok: true, linha: editada }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return traduzir(e);
  }
}

function traduzir(e: unknown): Response {
  if (e instanceof RecusaCategorizacao) {
    return Response.json(
      { erro: e.message, ...e.detalhe },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (e instanceof FinanceUnavailableError) return erro("banco do financeiro indisponível", 503);

  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg?.code === "23505") {
    return Response.json(
      {
        erro:
          "já existe uma linha de produto ativa com este nome. Para unir duas linhas, mova as " +
          "categorias de uma para a outra no Plano de contas e desative a que ficou vazia — dar o " +
          "mesmo nome a duas cria duas fatias idênticas no relatório.",
        recusadoPor: pg.constraint ?? "fin_product_line_nome_ativo_unico"
      },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (pg?.code === "23514") {
    return Response.json(
      { erro: pg.message ?? "o banco recusou a operação", recusadoPor: pg.constraint ?? "restrição da 0124" },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error("[categorizacao:linhas-produto]", pg?.message ?? e);
  return erro(pg?.message ?? "falha ao gravar linha de produto", 500);
}
