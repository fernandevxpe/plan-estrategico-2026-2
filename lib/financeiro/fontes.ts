import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";

import { queryOne, transaction } from "@/lib/financeiro/db";

/**
 * O disparo do botão "atualizar fontes".
 *
 * ---------------------------------------------------------------------------
 * AS QUATRO DECISÕES QUE ESTE ARQUIVO CARREGA
 * ---------------------------------------------------------------------------
 *
 * 1. NÃO BLOQUEIA A RESPOSTA HTTP. Uma sync do Asaas leva minutos e a do Inter
 *    respeita 10 req/min. Segurar a requisição até o fim entregaria um timeout
 *    de proxy ao usuário e nenhuma informação. A rota grava a execução, spawna
 *    o trabalhador DESACOPLADO e devolve o id; a tela acompanha por polling.
 *
 * 2. A TRAVA DE CONCORRÊNCIA É DO BANCO, NÃO DA MEMÓRIA. `scheduler.mjs` usa
 *    uma variável `running`, o que basta lá porque o pipeline vive num processo
 *    só. Aqui não: a rota HTTP e o trabalhador são processos distintos, e no
 *    Railway o serviço pode ter mais de uma instância. O índice único parcial
 *    `fin_fonte_sync_uma_por_vez` (0109) é o que de fato impede duas syncs.
 *
 * 3. EXECUÇÃO PENDURADA É RECOLHIDA ANTES DE CADA DISPARO. Se o processo morrer
 *    entre o INSERT e o UPDATE final, a linha fica 'rodando' para sempre e o
 *    botão nunca mais funciona. `fin_fonte_sync_recolher_perdidas()` roda antes
 *    de tentar inserir — e marca 'perdida', que declara desconhecimento, nunca
 *    falha: o processo pode ter concluído e morrido antes de reportar.
 *
 * 4. O TRABALHADOR SOBREVIVE À REQUISIÇÃO. `detached: true` + `unref()`: sem
 *    isso, o Next poderia recolher o filho ao encerrar o handler e a sync
 *    morreria no meio, deixando exatamente a linha pendurada de (3).
 *
 * SOMENTE GET NAS APIS EXTERNAS. Este arquivo não fala com API nenhuma; ele
 * invoca `scripts/sincronizar-fontes.mjs`, que invoca os mesmos scripts do
 * agendador. O cabeçalho daquele arquivo traz a conferência verbo a verbo.
 */

const ENTITY = "xpe";
const TRABALHADOR = "scripts/sincronizar-fontes.mjs";

/** Teto para declarar perdida uma execução que não reportou fim. */
const TETO_MIN = 45;

export class RecusaSync extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(mensagem);
    this.name = "RecusaSync";
  }
}

export type DisparoSync = {
  execucaoId: number;
  escopo: string;
  etapas: number;
};

/**
 * As fontes que o botão alcança, lidas do próprio trabalhador.
 *
 * Duplicar a lista aqui a faria divergir no primeiro mês, e o sintoma seria um
 * botão habilitado que não roda nada — a versão ativa do alarme sem ação.
 */
export async function fontesAtualizaveis(): Promise<string[]> {
  const mod = await import("@/scripts/sincronizar-fontes.mjs");
  return (mod as { FONTES_ALCANCADAS: string[] }).FONTES_ALCANCADAS;
}

/**
 * Cria a execução e dispara o trabalhador. Não espera pelo fim.
 *
 * Devolve o id para a tela acompanhar. Recusa com 409 quando já há uma
 * rodando — e devolve o id DELA, para a tela poder acompanhar a existente em
 * vez de só dizer "não".
 */
export async function dispararSync(args: { escopo: string; ator: string }): Promise<DisparoSync> {
  const escopo = args.escopo || "todas";
  const alcancadas = await fontesAtualizaveis();

  if (escopo !== "todas" && !alcancadas.includes(escopo)) {
    throw new RecusaSync(
      422,
      `a fonte '${escopo}' não é atualizada por este botão`,
      {
        alcancadas,
        motivo:
          "só as fontes com etapa no pipeline do agendador são disparáveis daqui. As demais são " +
          "importação manual ou API sem etapa agendada — a tela de fontes diz qual é o caso de cada uma."
      }
    );
  }

  const instalada = await queryOne<{ ok: boolean }>(
    `SELECT to_regclass('fin_fonte_sync_execucao') IS NOT NULL AS ok`
  );
  if (!instalada?.ok) {
    throw new RecusaSync(
      503,
      "a migration 0109 não está aplicada neste banco: não há onde registrar a execução",
      {
        motivo:
          "disparar sem trilha deixaria a sync sem início, fim, resultado nem erro — que é " +
          "exatamente o que torna um botão pior que nenhum botão."
      }
    );
  }

  const execucao = await transaction(async (client) => {
    // Antes de tentar, recolhe o que ficou pendurado. Sem isso um processo morto
    // trava o botão até alguém mexer no banco à mão.
    await client.query(`SELECT fin_fonte_sync_recolher_perdidas($1)`, [TETO_MIN]);

    const entidade = await client.query<{ id: string }>(
      `SELECT id FROM fin_entity WHERE slug = $1`,
      [ENTITY]
    );
    if (!entidade.rows.length) throw new RecusaSync(503, "a entidade 'xpe' não existe neste banco");

    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO fin_fonte_sync_execucao (entity_id, escopo, status, ator)
         VALUES ($1, $2, 'rodando', $3)
         RETURNING id`,
        [entidade.rows[0].id, escopo, args.ator]
      );
      return Number(rows[0].id);
    } catch (erro) {
      // 23505 = violação do índice único parcial. É o caminho ESPERADO do
      // segundo clique, não um defeito: traduzir para 409 com o id da execução
      // viva deixa a tela acompanhar aquela em vez de insistir.
      if ((erro as { code?: string }).code === "23505") {
        const viva = await client.query<{ id: string; ator: string; iniciada_em: Date }>(
          `SELECT e.id, e.ator, e.iniciada_em
             FROM fin_fonte_sync_execucao e
             JOIN fin_entity n ON n.id = e.entity_id AND n.slug = $1
            WHERE e.status = 'rodando'
            ORDER BY e.iniciada_em DESC LIMIT 1`,
          [ENTITY]
        );
        const atual = viva.rows[0];
        throw new RecusaSync(409, "já existe uma sincronização em andamento", {
          execucaoId: atual ? Number(atual.id) : null,
          iniciadaPor: atual?.ator ?? null,
          iniciadaEm: atual?.iniciada_em ?? null,
          motivo:
            "duas syncs simultâneas leriam a mesma janela nas duas e disputariam os mesmos lotes. " +
            "A trava é um índice único no banco, então ela vale entre processos e entre instâncias."
        });
      }
      throw erro;
    }
  });

  // Desacoplado de propósito: o handler HTTP termina, o trabalhador continua.
  const filho = spawn("node", [TRABALHADOR, `--execucao=${execucao}`, `--fonte=${escopo}`], {
    cwd: path.resolve(process.cwd()),
    env: process.env,
    detached: true,
    stdio: "ignore"
  });

  filho.on("error", (erro) => {
    // Falhar ao spawnar e deixar a linha 'rodando' travaria o botão por 45 min.
    // O melhor esforço aqui é fechar a linha com o motivo real.
    void transaction(async (client) => {
      await client.query(
        `UPDATE fin_fonte_sync_execucao
            SET status = 'erro', terminada_em = now(), erro = $2
          WHERE id = $1 AND status = 'rodando'`,
        [execucao, `não consegui iniciar o processo de sincronização: ${erro.message}`]
      );
    }).catch(() => {});
  });

  filho.unref();

  const mod = await import("@/scripts/sincronizar-fontes.mjs");
  const etapas = (mod as { ETAPAS: { fonte: string | null }[] }).ETAPAS.filter(
    (e) => escopo === "todas" || e.fonte === null || e.fonte === escopo
  ).length;

  return { execucaoId: execucao, escopo, etapas };
}

export type EstadoExecucao = {
  id: number;
  escopo: string;
  status: string;
  ator: string;
  iniciadaEm: string;
  terminadaEm: string | null;
  etapas: unknown[];
  erro: string | null;
};

/** O estado de uma execução, para o polling da tela. */
export async function lerExecucao(id: number): Promise<EstadoExecucao | null> {
  const r = await queryOne<{
    id: string;
    escopo: string;
    status: string;
    ator: string;
    iniciada_em: Date;
    terminada_em: Date | null;
    etapas: unknown[] | null;
    erro: string | null;
  }>(
    `SELECT e.id, e.escopo, e.status, e.ator, e.iniciada_em, e.terminada_em, e.etapas, e.erro
       FROM fin_fonte_sync_execucao e
       JOIN fin_entity n ON n.id = e.entity_id AND n.slug = $2
      WHERE e.id = $1`,
    [id, ENTITY]
  );
  if (!r) return null;
  return {
    id: Number(r.id),
    escopo: r.escopo,
    status: r.status,
    ator: r.ator,
    iniciadaEm: new Date(r.iniciada_em).toISOString(),
    terminadaEm: r.terminada_em ? new Date(r.terminada_em).toISOString() : null,
    etapas: Array.isArray(r.etapas) ? r.etapas : [],
    erro: r.erro
  };
}
