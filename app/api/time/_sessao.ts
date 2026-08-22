import { cookies } from "next/headers";

import { FinanceUnavailableError } from "@/lib/financeiro/db";
import {
  COOKIE_SESSAO,
  TimeError,
  lerSessao,
  schemaTimeDisponivel,
  type AnexoEntrada,
  type Sessao
} from "@/lib/financeiro/time";

/**
 * O que toda rota de `/api/time` faz antes de qualquer coisa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM PREFIXO NOVO, E NÃO UMA ROTA DENTRO DE /api/financeiro
 * ---------------------------------------------------------------------------
 * `lib/auth/perfis.ts` marca `/api/financeiro` como só-admin, e a regra dele é
 * "negar um prefixo, não permitir uma lista" — uma rota nova ali nasce
 * protegida. Se o app do time morasse lá, ele nasceria 404 para o próprio time.
 *
 * A saída NÃO é abrir uma exceção dentro do prefixo do financeiro: exceção
 * dentro de regra de negação é o começo do fim dela — a segunda exceção já não
 * precisa de justificativa. `/api/time` é um prefixo irmão, com disciplina
 * própria e uma regra só, escrita aqui e verificada por
 * `scripts/test-perfil-guard.mjs`:
 *
 *   NENHUMA rota sob /api/time devolve saldo, DRE, folha, margem, tributo,
 *   nem qualquer linha que pertença a outra pessoa.
 *
 * O que sustenta isso não é boa vontade: é que as funções de
 * `lib/financeiro/time.ts` recebem `Sessao` e nunca `personId`, então não
 * existe assinatura onde caiba a pessoa errada.
 */

export type ContextoTime = { sessao: Sessao };

export function respostaDeErro(erro: unknown) {
  if (erro instanceof TimeError) {
    return Response.json({ error: erro.message }, { status: erro.status });
  }
  if (erro instanceof FinanceUnavailableError) {
    return Response.json({ error: "banco financeiro indisponível" }, { status: 503 });
  }
  console.error("[time] falha inesperada:", erro);
  return Response.json({ error: "não consegui concluir" }, { status: 500 });
}

/** Lê o cookie e devolve a sessão, ou `null`. Não decide nada — quem decide é a rota. */
export async function sessaoAtual(): Promise<Sessao | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value ?? null;
  if (!token) return null;
  if (!(await schemaTimeDisponivel())) return null;
  return lerSessao(token);
}

/**
 * Sessão obrigatória.
 *
 * 401 e não 403: o time TEM credencial válida da plataforma; o que falta é
 * dizer quem é. 403 sugeriria "você não tem direito", quando o certo é "eu
 * ainda não sei quem você é".
 */
export async function exigirContexto(opcoes?: { senhaPendenteOk?: boolean }): Promise<ContextoTime> {
  // A SESSÃO VEM PRIMEIRO, e a ordem importa desde que `/api/time` deixou de
  // exigir Basic. Checar o schema antes fazia toda requisição anônima disparar
  // uma consulta no Postgres financeiro, e o 503 devolvia o número da migration
  // — dois presentes para quem só quer sondar: amplificação de banco de graça e
  // o estado interno do deploy. Sem cookie, 401 seco e nada acontece no banco.
  const sessao = await sessaoAtual();
  if (!sessao) throw new TimeError("identifique-se para continuar", 401);
  if (!(await schemaTimeDisponivel())) {
    throw new TimeError("o app do time ainda não está disponível", 503);
  }
  // A senha de entrega tem de morrer na primeira sessão — e isso precisa valer
  // no SERVIDOR. Antes, a única barreira era uma tela: quem entrasse com a
  // senha que o admin digitou (e conhece) podia ignorá-la e usar as rotas por
  // 30 dias via `curl`. A rota de troca é a única exceção, senão a pessoa fica
  // presa sem caminho para sair.
  if (sessao.trocarSenha && !opcoes?.senhaPendenteOk) {
    throw new TimeError("troque a senha de entrega antes de continuar", 403);
  }
  return { sessao };
}

/**
 * Aceita JSON e multipart no mesmo endpoint.
 *
 * O celular manda foto do comprovante (multipart); o formulário sem anexo e
 * qualquer chamada de teste mandam JSON. Exigir multipart sempre obrigaria a
 * montar `FormData` para lançar um valor de R$ 12,00 sem foto; exigir JSON
 * sempre inviabilizaria a foto, que é a lacuna que este app existe para fechar
 * (0 de 193 itens têm comprovante hoje).
 */
/**
 * Lê o corpo e separa dados de arquivos.
 *
 * `arquivo` é o PRINCIPAL — o comprovante, o campo que sempre existiu. Quem
 * precisar de mais de um usa `arquivos`, indexado pelo nome do campo: o
 * formulário de custo manda `arquivo` (a foto) e `arquivoNota` (a NF-e), e os
 * dois viram anexos de `kind` diferente no mesmo envio.
 *
 * Antes o laço sobrescrevia `arquivo` a cada iteração, então mandar dois
 * arquivos guardava só o último — em silêncio. A pessoa anexava a foto e a
 * nota, via as duas na tela, e uma sumia.
 */
export async function lerCorpo(
  request: Request
): Promise<{
  dados: Record<string, unknown>;
  arquivo: AnexoEntrada | null;
  arquivos: Record<string, AnexoEntrada>;
}> {
  const tipo = request.headers.get("content-type") ?? "";

  if (tipo.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new TimeError("não consegui ler o formulário", 400);
    }
    const dados: Record<string, unknown> = {};
    const arquivos: Record<string, AnexoEntrada> = {};
    let arquivo: AnexoEntrada | null = null;
    for (const [chave, valor] of form.entries()) {
      if (valor instanceof File) {
        if (valor.size === 0) continue;
        const entrada: AnexoEntrada = {
          nome: valor.name || "comprovante",
          mime: valor.type || "application/octet-stream",
          bytes: Buffer.from(await valor.arrayBuffer())
        };
        arquivos[chave] = entrada;
        // O primeiro campo de arquivo vira o principal. `arquivo` continua
        // sendo o comprovante em todas as rotas que só conhecem um.
        if (!arquivo) arquivo = entrada;
      } else {
        dados[chave] = valor;
      }
    }
    // Quando vêm os dois, o principal é o comprovante — não a ordem em que o
    // navegador serializou o FormData.
    if (arquivos.arquivo) arquivo = arquivos.arquivo;
    // `links` chega como JSON dentro de um campo de texto: FormData não tem
    // forma nativa de lista de objetos, e inventar `links[0][url]` criaria um
    // protocolo particular que só este formulário fala.
    if (typeof dados.links === "string") {
      try {
        dados.links = JSON.parse(dados.links);
      } catch {
        throw new TimeError("a lista de links veio malformada", 400);
      }
    }
    return { dados, arquivo, arquivos };
  }

  try {
    const dados = (await request.json()) as Record<string, unknown>;
    return { dados: dados ?? {}, arquivo: null, arquivos: {} };
  } catch {
    throw new TimeError("corpo inválido: mande JSON ou multipart/form-data", 400);
  }
}
