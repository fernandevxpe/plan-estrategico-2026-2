import { FinanceUnavailableError } from "@/lib/financeiro/db";
import { RecusaSync, dispararSync, fontesAtualizaveis, lerExecucao } from "@/lib/financeiro/fontes";

import { autorDe, erro, lerCorpo } from "../../categorizacao/_escrita";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/financeiro/gerencial/fontes/sincronizar
 *
 * ```json
 * { "fonte": "asaas" }     // ou {} / {"fonte":"todas"} para o pipeline inteiro
 * ```
 *
 * Resposta: `202 { "execucaoId": 12, "escopo": "asaas", "etapas": 3 }`
 *
 * ==========================================================================
 * POR QUE 202 E NÃO 200 — E POR QUE NÃO ESPERAR
 * ==========================================================================
 * A sync do Asaas leva ~4 min no histórico e a do Inter respeita 10 req/min.
 * Segurar a resposta até o fim entrega ao usuário um timeout de proxy e
 * nenhuma informação sobre o que aconteceu. 202 é a resposta honesta: "aceitei,
 * está rodando, acompanhe por aqui". O GET desta mesma rota devolve o estado.
 *
 * ==========================================================================
 * SOMENTE GET NAS APIS EXTERNAS
 * ==========================================================================
 * Restrição absoluta nº 3, e ela não é promessa: esta rota não fala com API
 * nenhuma. Ela insere uma linha de execução e spawna
 * `scripts/sincronizar-fontes.mjs`, que chama exatamente os mesmos scripts do
 * bloco financeiro de `scheduler.mjs`. Conferido verbo a verbo no cabeçalho
 * daquele arquivo: o único POST em toda a cadeia é `/oauth/v2/token` do Inter,
 * que é autenticação. Nada emite cobrança, paga, transfere, estorna ou cria
 * webhook.
 *
 * E, pelo mesmo motivo, sincronizar não altera saldo por caminho que não seja a
 * ingestão normal: o botão não tem código de ingestão próprio.
 *
 * ==========================================================================
 * DOIS CLIQUES NÃO VIRAM DUAS SYNCS
 * ==========================================================================
 * A trava é o índice único parcial `fin_fonte_sync_uma_por_vez` (0109), no
 * banco — não uma flag em memória. Rota e trabalhador são processos diferentes
 * e o serviço pode ter mais de uma instância; uma flag não alcança nenhum dos
 * dois casos. O segundo clique recebe 409 **com o id da execução viva**, para a
 * tela passar a acompanhar aquela em vez de só recusar.
 *
 * ==========================================================================
 * SÓ ADMIN
 * ==========================================================================
 * Por estar sob `/api/financeiro`, que `lib/auth/perfis.ts` declara só-admin. O
 * perfil comum recebe 404 do middleware, não 403 — 403 anunciaria que a rota
 * existe.
 */
export async function POST(request: Request): Promise<Response> {
  const corpo = await lerCorpo(request);
  if (corpo instanceof Response) return corpo;

  const bruto = corpo.fonte;
  if (bruto !== undefined && bruto !== null && typeof bruto !== "string") {
    return erro("`fonte` deve ser texto: o slug de uma fonte ou 'todas'");
  }
  const escopo = (typeof bruto === "string" ? bruto.trim() : "") || "todas";

  try {
    const r = await dispararSync({ escopo, ator: autorDe(request) });
    return Response.json(
      {
        ...r,
        acompanhe: `/api/financeiro/gerencial/fontes/sincronizar?execucao=${r.execucaoId}`,
        aviso:
          "a sincronização roda em processo separado. Este 202 diz que ela COMEÇOU, não que ela " +
          "terminou bem — o resultado de cada etapa aparece no GET desta rota."
      },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof RecusaSync) return erro(e.message, e.status, e.extra);
    if (e instanceof FinanceUnavailableError) {
      return erro("banco financeiro indisponível", 503, { motivo: e.message });
    }
    throw e;
  }
}

/**
 * GET /api/financeiro/gerencial/fontes/sincronizar?execucao=12
 *
 * O acompanhamento. Devolve a execução com o resultado etapa a etapa — e,
 * quando alguma falhou, O QUE falhou e POR QUÊ, com a última linha útil da
 * saída do script.
 *
 * Um botão que falha em silêncio é pior que não ter botão: ele consome a
 * confiança que o alarme já tinha gastado.
 */
export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const bruto = sp.get("execucao");

  if (!bruto) {
    return Response.json(
      {
        fontesAtualizaveis: await fontesAtualizaveis(),
        motivo:
          "as demais fontes ou são importação manual (uma pessoa exporta o arquivo) ou são API sem " +
          "etapa no agendador. A tela /financeiro/fontes diz, por linha, qual é o caso.",
        uso: "?execucao=<id> para acompanhar um disparo"
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const id = Number(bruto);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return erro("`execucao` deve ser um id inteiro positivo");
  }

  try {
    const estado = await lerExecucao(id);
    if (!estado) return erro(`execução ${id} não existe`, 404);
    return Response.json(estado, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) {
      return erro("banco financeiro indisponível", 503, { motivo: e.message });
    }
    throw e;
  }
}
