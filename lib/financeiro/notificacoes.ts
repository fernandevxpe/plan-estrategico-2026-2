import "server-only";

import type { Perfil } from "@/lib/auth/perfis";
import { FinanceUnavailableError, query, queryOne } from "@/lib/financeiro/db";

/**
 * As notificações — a camada de servidor.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE GOVERNA ESTE ARQUIVO
 * ---------------------------------------------------------------------------
 * Notificação é o único objeto desta plataforma que **vai atrás da pessoa**.
 * Todo o resto espera ser aberto. Isso inverte o risco: um erro de escopo numa
 * tela é uma tela que alguém teria de encontrar; um erro de escopo aqui entrega
 * o número na cara de quem não deveria vê-lo, sem que ninguém tenha procurado.
 *
 * Por isso o filtro é feito em TRÊS camadas independentes, e nenhuma delas
 * confia na anterior:
 *
 *   1. no schema — `fin_notificacao` tem CHECK que recusa aviso de gestão fora
 *      do admin, aviso de pessoa apontando para fora de /time, e valor em
 *      broadcast para o time (migration 0105);
 *   2. aqui — a consulta do perfil comum não menciona `recipient_perfil='admin'`
 *      nem `escopo='gestao'` em lugar nenhum: é uma cláusula fechada, não uma
 *      exclusão que alguém pode esquecer de manter;
 *   3. no middleware — a página e a rota do financeiro continuam 404 para o
 *      perfil comum, então mesmo um link vazado não abre nada.
 *
 * Três camadas porque a primeira falha em migração esquecida, a segunda falha
 * em refatoração e a terceira falha em rota nova fora do prefixo. As três
 * falharem juntas exige três erros diferentes no mesmo dia.
 */

const ENTITY = "xpe";

export type EstadoNotificacao = "nao_lida" | "lida" | "resolvida";

export type Notificacao = {
  id: number;
  kind: string;
  titulo: string;
  corpo: string;
  link: string;
  valorCents: number | null;
  motivoSemValor: string | null;
  estado: EstadoNotificacao;
  escopo: "proprio" | "gestao";
  criadaEm: string;
  ultimaOcorrencia: string;
  ocorrencias: number;
};

export type CaixaDeNotificacoes = {
  disponivel: boolean;
  motivoIndisponivel: string | null;
  naoLidas: number;
  notificacoes: Notificacao[];
  /**
   * Quem está sendo atendido. A tela mostra isso porque o perfil comum sem
   * sessão do time não tem caixa nenhuma — e "0 avisos" e "não sei quem é você"
   * são coisas diferentes que pareceriam iguais.
   */
  destinatario: { perfil: Perfil; pessoa: string | null };
};

/**
 * A cláusula de alcance — escrita UMA vez e usada por leitura e escrita.
 *
 * Positiva ("o que esta pessoa PODE ver"), não negativa ("tudo menos o do
 * admin"): a forma negativa deixa de proteger sozinha no dia em que um
 * destinatário novo aparecer, e ninguém percebe porque o teste continua verde.
 *
 * Uma função e não três literais espalhados: era exatamente assim que a regra
 * de acesso duplicada divergia em `lib/auth/perfis.ts`, e o comentário de lá
 * diz o porquê — regra de acesso duplicada é regra que diverge.
 */
function alcanceSql(perfil: Perfil, param: string, prefixo = ""): string {
  const p = prefixo;
  return perfil === "admin"
    ? `(${p}recipient_kind = 'perfil' AND ${p}recipient_perfil = 'admin'
        OR (${p}recipient_kind = 'pessoa' AND ${p}recipient_person_id = ${param}))`
    : `(${p}recipient_kind = 'pessoa' AND ${p}recipient_person_id = ${param}
        OR (${p}recipient_kind = 'perfil' AND ${p}recipient_perfil = 'comum'))`;
}

export async function schemaNotificacaoDisponivel(): Promise<boolean> {
  try {
    const r = await queryOne<{ ok: boolean }>(`SELECT (to_regclass('fin_notificacao') IS NOT NULL) AS ok`);
    return r?.ok === true;
  } catch (erro) {
    if (erro instanceof FinanceUnavailableError) return false;
    throw erro;
  }
}

/**
 * A caixa de quem está pedindo.
 *
 * `perfil` vem do cabeçalho que o middleware carimba — nunca do cliente, que
 * poderia mandar `x-xpe-perfil: admin` na própria requisição. `personId` vem do
 * cookie de sessão do time, resolvido em banco.
 *
 * O admin vê a caixa de gestão E, se tiver sessão do time aberta, a dele —
 * porque o Fernando também manda reembolso, e duas caixas separadas fariam ele
 * ter de lembrar de olhar as duas.
 */
export async function getNotificacoes(
  perfil: Perfil,
  personId: number | null,
  opcoes: { incluirResolvidas?: boolean; limite?: number } = {}
): Promise<CaixaDeNotificacoes> {
  const destinatario = { perfil, pessoa: null as string | null };

  if (!(await schemaNotificacaoDisponivel())) {
    return {
      disponivel: false,
      motivoIndisponivel: "a migration 0105 ainda não foi aplicada — o sino existe, a caixa ainda não",
      naoLidas: 0,
      notificacoes: [],
      destinatario
    };
  }

  const limite = Math.min(Math.max(opcoes.limite ?? 60, 1), 200);
  const estados = opcoes.incluirResolvidas
    ? ["nao_lida", "lida", "resolvida"]
    : ["nao_lida", "lida"];

  const alcance = alcanceSql(perfil, "$3", "n.");

  // Sem pessoa identificada, `$3` casaria com NULL e o `= NULL` é sempre falso
  // — o que já é seguro. Passamos -1 para deixar explícito, em vez de depender
  // dessa sutileza do SQL.
  const pessoaParam = personId ?? -1;

  const linhas = await query<Record<string, unknown>>(
    `SELECT n.id, n.kind, n.titulo, n.corpo, n.link_href, n.amount_cents, n.amount_reason,
            n.estado, n.escopo, n.criada_em, n.ultima_ocorrencia, n.ocorrencias
       FROM fin_notificacao n
       JOIN fin_entity e ON e.id = n.entity_id AND e.slug = $1
      WHERE n.estado = ANY($2)
        AND ${alcance}
      ORDER BY (n.estado = 'nao_lida') DESC, n.ultima_ocorrencia DESC
      LIMIT ${limite}`,
    [ENTITY, estados, pessoaParam]
  );

  const naoLidas = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM fin_notificacao n
       JOIN fin_entity e ON e.id = n.entity_id AND e.slug = $1
      WHERE n.estado = 'nao_lida' AND ${alcanceSql(perfil, "$2", "n.")}`,
    [ENTITY, pessoaParam]
  );

  if (personId) {
    const p = await queryOne<{ name: string }>(`SELECT name FROM fin_person WHERE id = $1`, [personId]);
    destinatario.pessoa = p?.name ?? null;
  }

  return {
    disponivel: true,
    motivoIndisponivel: null,
    naoLidas: naoLidas?.n ?? 0,
    notificacoes: linhas.map((l) => ({
      id: Number(l.id),
      kind: String(l.kind),
      titulo: String(l.titulo),
      corpo: String(l.corpo),
      link: String(l.link_href),
      valorCents: l.amount_cents === null ? null : Number(l.amount_cents),
      motivoSemValor: (l.amount_reason as string) ?? null,
      estado: String(l.estado) as EstadoNotificacao,
      escopo: String(l.escopo) as "proprio" | "gestao",
      criadaEm: new Date(l.criada_em as string).toISOString(),
      ultimaOcorrencia: new Date(l.ultima_ocorrencia as string).toISOString(),
      ocorrencias: Number(l.ocorrencias)
    })),
    destinatario
  };
}

/**
 * Marca uma notificação.
 *
 * O `WHERE` repete a cláusula de alcance de propósito: sem ela, um id chutado
 * marcaria como lida a notificação de outra pessoa. Não vaza conteúdo — mas
 * some do sino de quem precisava dela, que é um estrago pior por ser
 * silencioso.
 */
export async function marcarNotificacao(
  perfil: Perfil,
  personId: number | null,
  id: number,
  estado: "lida" | "resolvida" | "nao_lida",
  ator: string
): Promise<boolean> {
  const alcance = alcanceSql(perfil, "$3");

  const linhas = await query<{ id: number }>(
    `UPDATE fin_notificacao
        SET estado = $1,
            vista_em = CASE WHEN $1 <> 'nao_lida' THEN coalesce(vista_em, now()) ELSE NULL END,
            resolvida_em = CASE WHEN $1 = 'resolvida' THEN now() ELSE NULL END,
            resolvida_por = CASE WHEN $1 = 'resolvida' THEN $4 ELSE NULL END
      WHERE id = $2 AND ${alcance}
      RETURNING id`,
    [estado, id, personId ?? -1, ator]
  );
  return linhas.length > 0;
}

/** Marca tudo que está na caixa desta pessoa como lido. */
export async function marcarTodasLidas(perfil: Perfil, personId: number | null): Promise<number> {
  const alcance = alcanceSql(perfil, "$1");

  const linhas = await query<{ id: number }>(
    `UPDATE fin_notificacao SET estado = 'lida', vista_em = coalesce(vista_em, now())
      WHERE estado = 'nao_lida' AND ${alcance} RETURNING id`,
    [personId ?? -1]
  );
  return linhas.length;
}

/**
 * Recalcula os fatos e casa com a caixa. Idempotente.
 *
 * Chamado pelo scheduler (`scripts/notificar.mjs`) e, de graça, pela abertura
 * da lista — o custo é uma varredura de views e o benefício é que quem abre a
 * tela vê o estado de agora, não o da última rodada do cron. Se o sync falhar,
 * a leitura continua: um erro de geração não pode esconder o que já está na
 * caixa.
 */
export async function sincronizar(ator = "app"): Promise<{ criadas: number; repetidas: number; resolvidas: number }> {
  const r = await queryOne<{ criadas: number; repetidas: number; resolvidas: number }>(
    `SELECT * FROM fin_notificacao_sync($1)`,
    [ator]
  );
  return { criadas: r?.criadas ?? 0, repetidas: r?.repetidas ?? 0, resolvidas: r?.resolvidas ?? 0 };
}
