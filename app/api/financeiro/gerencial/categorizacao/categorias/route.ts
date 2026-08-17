import { RecusaCategorizacao, criarCategoria, editarCategoria } from "@/lib/financeiro/categorizacao";
import { getPlanoDeContas } from "@/lib/financeiro/contratos/categorizacao";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { bandeiraEstritaDe } from "../../_parametros";
import { autorDe, erro, lerCorpo, textoOpcional } from "../_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * O plano de contas — leitura, criação e edição.
 *
 * GET    ?incluirInativas=1   lista com o uso medido NOS TRÊS UNIVERSOS
 * POST                        cria categoria
 * PATCH                       edita nome/agrupamento, ou desativa
 *
 * ==========================================================================
 * O USO É CONTADO NOS TRÊS UNIVERSOS, E ISSO JÁ CUSTOU UM DIAGNÓSTICO ERRADO
 * ==========================================================================
 *
 * O monitor M13 contava `5.11 Frete e logística` como linha morta porque lia
 * só `fin_transaction` e `fin_document`. Havia um item de cartão de R$ 1.222,56
 * nela o tempo todo (0094). `fin_categoria_uso_v` lê as três, sempre.
 *
 * ==========================================================================
 * AS TRÊS RECUSAS, E ONDE ELAS MORAM
 * ==========================================================================
 *
 * 1. **3.99 e 5.99 não se renomeiam, não se reagrupam, não se desativam.**
 *    Não são linhas do plano de contas: são o vocabulário da indecisão, e o
 *    CÓDIGO delas é lido por três gatilhos, três invariantes (H1, H2, H3) e
 *    quatro views. Desativá-las tiraria 237 itens (R$ 112.492,54) da fila sem
 *    classificar nenhum.
 *
 * 2. **Categoria com linha viva não desativa.** Desativar não move nada — só
 *    some da tela o que continua somando na DRE.
 *
 * 3. **Categoria que já classificou algo nunca é apagada.** Por isso esta rota
 *    não tem DELETE: o verbo não existe, em vez de existir e ser negado.
 *
 * As três são gatilho no BANCO (0101), não `if` nesta camada. A rota lê
 * `fin_categoria_uso_v` antes só para explicar em português — se ela errasse,
 * o banco ainda recusaria. Uma régua só, duas traduções.
 *
 * `kind` NÃO É EDITÁVEL. Ele decide o sinal exigido e a linha da DRE; trocá-lo
 * numa categoria com uso vivo reclassificaria dinheiro sem passar por
 * `fin_classification_event`. Natureza errada se resolve criando a categoria
 * certa e movendo os itens em lote, com trilha.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getPlanoDeContas(bandeiraEstritaDe(sp, "incluirInativas"));
  return responderContrato(contrato);
});

export async function POST(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  try {
    const criada = await criarCategoria(
      {
        code: String(corpo.code ?? "").trim(),
        nome: String(corpo.nome ?? "").trim(),
        kind: String(corpo.kind ?? "").trim(),
        cashFlowGroup: String(corpo.grupoFluxo ?? "").trim(),
        dreLine: String(corpo.linhaDre ?? "").trim(),
        tocClass: textoOpcional(corpo.tocClass) ?? undefined,
        nucleoPadrao: textoOpcional(corpo.nucleoPadrao),
        parentCode: textoOpcional(corpo.categoriaPai)
      },
      autorDe(request)
    );
    return Response.json({ ok: true, categoria: criada }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return traduzir(e);
  }
}

export async function PATCH(request: Request) {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  const code = String(corpo.code ?? "").trim();
  if (!code) return erro("informe o `code` da categoria a editar");
  if (corpo.kind !== undefined) {
    return erro(
      "`kind` não é editável: ele decide o sinal exigido e a linha da DRE. " +
        "Trocá-lo numa categoria com uso vivo reclassificaria dinheiro sem trilha. " +
        "Crie a categoria certa e mova os itens em lote."
    );
  }

  try {
    const editada = await editarCategoria(
      code,
      {
        // Estes três são NOT NULL na tabela: mandar vazio não é "limpe", é
        // "não mexa". Só `nucleoPadrao` e `categoriaPai` aceitam o nulo como
        // instrução, e por isso só eles preservam o `null` de `textoOpcional`.
        nome: textoOpcional(corpo.nome) ?? undefined,
        cashFlowGroup: textoOpcional(corpo.grupoFluxo) ?? undefined,
        dreLine: textoOpcional(corpo.linhaDre) ?? undefined,
        nucleoPadrao: corpo.nucleoPadrao === undefined ? undefined : textoOpcional(corpo.nucleoPadrao),
        parentCode: corpo.categoriaPai === undefined ? undefined : textoOpcional(corpo.categoriaPai),
        ativa: typeof corpo.ativa === "boolean" ? corpo.ativa : undefined
      },
      autorDe(request)
    );
    return Response.json({ ok: true, categoria: editada }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return traduzir(e);
  }
}

/**
 * As recusas do banco chegam aqui como erro de Postgres. Traduzir para 409 é o
 * que separa "você pediu algo que este sistema não faz" de "o sistema quebrou":
 * um 500 mandaria a tela mostrar "erro interno" para uma regra de negócio
 * escrita de propósito, e a pessoa tentaria de novo.
 */
function traduzir(e: unknown): Response {
  if (e instanceof RecusaCategorizacao) {
    return Response.json(
      { erro: e.message, ...e.detalhe },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (e instanceof FinanceUnavailableError) return erro("banco do financeiro indisponível", 503);

  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg?.code === "23514" || pg?.code === "23503") {
    return Response.json(
      { erro: pg.message ?? "o banco recusou a operação", recusadoPor: pg.constraint ?? "gatilho da 0101" },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (pg?.code === "23505") {
    return Response.json(
      { erro: "já existe categoria com este código nesta entidade" },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error("[categorizacao:categorias]", pg?.message ?? e);
  return erro(pg?.message ?? "falha ao gravar categoria", 500);
}
