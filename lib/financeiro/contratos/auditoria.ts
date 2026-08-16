import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  Condicoes,
  contrato,
  contratoIndisponivel,
  ENTIDADE,
  montarPagina,
  normalizarPaginacao,
  type Contrato,
  type Pagina,
  type Paginacao
} from "./base";
import { getCobertura } from "./cobertura";

/**
 * Auditoria e pendências.
 *
 * Duas telas que na verdade são uma: "quem mexeu no quê" e "o que está errado
 * agora". A primeira sem a segunda vira arquivo morto; a segunda sem a primeira
 * não permite descobrir quando o erro entrou.
 *
 * A trilha (`fin_audit_log`) tem hoje 4.524 eventos e `batch_id` para agrupar
 * escrita em lote — é o que torna um backfill de 1.618 linhas UM evento
 * revisável em vez de 1.618 linhas de ruído.
 */

const DOMINIO = "auditoria";

export type EventoAuditoria = {
  id: number;
  em: string;
  tabela: string;
  alvoId: number;
  acao: string;
  ator: string;
  campos: string[];
  loteId: string | null;
  desfeitoEm: string | null;
  /** Diferença campo a campo, já resolvida para a tela não precisar comparar JSON. */
  mudancas: { campo: string; de: unknown; para: unknown }[];
};

export type FiltrosAuditoria = {
  tabela?: string;
  alvoId?: number;
  ator?: string;
  acao?: string;
  loteId?: string;
  de?: string;
  ate?: string;
  apenasLotes?: boolean;
};

const VAZIO: Pagina<EventoAuditoria> = {
  itens: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  paginas: 1,
  temMais: false,
  ordenacao: { campo: "em", direcao: "desc" },
  vazio: { causa: "fonte_indisponivel", motivo: "banco não configurado", acao: null }
};

export async function getAuditoria(
  filtros: FiltrosAuditoria = {},
  paginacao: Paginacao = {}
): Promise<Contrato<Pagina<EventoAuditoria>>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");
  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);

  const cond = new Condicoes([], []);
  cond.add("al.target_table = $?", filtros.tabela);
  cond.add("al.target_id = $?", filtros.alvoId);
  cond.add("al.actor = $?", filtros.ator);
  cond.add("al.action = $?", filtros.acao);
  cond.add("al.batch_id = $?::uuid", filtros.loteId);
  cond.add("al.created_at >= $?", filtros.de);
  cond.add("al.created_at <= $?", filtros.ate);
  if (filtros.apenasLotes) cond.raw("al.batch_id IS NOT NULL");

  try {
    const limite = cond.proximo(porPagina);
    const salto = cond.proximo(offset);
    const linhas = await query<Record<string, unknown>>(
      `SELECT al.id, al.created_at, al.target_table, al.target_id, al.action, al.actor,
              al.fields, al.batch_id, al.undone_at, al.before, al.after,
              count(*) OVER ()::text AS total_linhas
         FROM fin_audit_log al
        WHERE ${cond.where}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ${limite} OFFSET ${salto}`,
      cond.params
    );

    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const itens: EventoAuditoria[] = linhas.map((l) => {
      const antes = (l.before as Record<string, unknown> | null) ?? {};
      const depois = (l.after as Record<string, unknown> | null) ?? {};
      const campos = (l.fields as string[] | null) ?? [];
      return {
        id: Number(l.id),
        em: String(l.created_at),
        tabela: String(l.target_table),
        alvoId: Number(l.target_id),
        acao: String(l.action),
        ator: String(l.actor),
        campos,
        loteId: (l.batch_id as string) ?? null,
        desfeitoEm: (l.undone_at as string) ?? null,
        // O diff é resolvido aqui, no servidor: mandar dois JSON inteiros para
        // a tela comparar transporta o dobro do payload e reimplementa a mesma
        // lógica em cada consumidor.
        mudancas: campos.map((campo) => ({ campo, de: antes[campo] ?? null, para: depois[campo] ?? null }))
      };
    });

    return contrato({
      dominio: DOMINIO,
      dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "em", direcao: "desc" } }),
      ressalvas: [
        "batch_id agrupa escrita em lote: um backfill de 1.618 linhas é UM evento revisável, não 1.618 de ruído.",
        "undone_at preenchido significa que a operação foi revertida — o evento continua na trilha, porque apagar história é o que a trilha existe para impedir."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:auditoria]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Pendências: o placar de integridade
// ---------------------------------------------------------------------------

export type ChecagemIntegridade = {
  chave: string;
  titulo: string;
  /** O que deveria ser verdade. */
  invariante: string;
  passou: boolean;
  observado: number;
  esperado: number;
  valorCents: number | null;
  severidade: "bloqueante" | "alerta" | "informativo";
  rota: string | null;
};

export type PainelPendencias = {
  checagens: ChecagemIntegridade[];
  bloqueantes: number;
  /** A regra zero do projeto: o caixa fecha em todas as contas? */
  caixaFecha: boolean;
  contasQueNaoFecham: string[];
  contasAtrasadas: string[];
};

const PENDENCIAS_VAZIO: PainelPendencias = {
  checagens: [],
  bloqueantes: 0,
  caixaFecha: false,
  contasQueNaoFecham: [],
  contasAtrasadas: []
};

/**
 * As invariantes que a base promete, verificadas agora.
 *
 * Não é "teste que passou no CI": é o estado do dado neste instante. Um schema
 * pode estar perfeito e o ledger, mentindo — e é o ledger que paga contas.
 */
export async function getPendencias(): Promise<Contrato<PainelPendencias>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel("pendencias", PENDENCIAS_VAZIO, "banco financeiro não configurado");
  }
  try {
    const cobertura = await getCobertura();
    const [medidas] = await query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
           WHERE e.slug = $1 AND t.category_id IS NULL AND t.transfer_status = 'nao'
             AND NOT t.is_split_parent)::text AS sem_categoria,
         (SELECT COALESCE(SUM(abs(t.amount_cents)), 0) FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
           WHERE e.slug = $1 AND t.category_id IS NULL AND t.transfer_status = 'nao'
             AND NOT t.is_split_parent)::text AS sem_categoria_cents,
         (SELECT count(*) FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
           WHERE e.slug = $1 AND t.counterparty_id IS NULL AND t.transfer_status = 'nao'
             AND NOT t.is_split_parent AND t.posted_on >= '2026-01-01')::text AS sem_contraparte_2026,
         (SELECT count(*) FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
           WHERE e.slug = $1 AND t.transfer_status = 'em_transito')::text AS transferencia_orfa,
         (SELECT count(*) FROM fin_transferencia_suspeita)::text AS transferencia_suspeita,
         (SELECT count(*) FROM fin_review_item ri JOIN fin_entity e ON e.id = ri.entity_id
           WHERE e.slug = $1 AND ri.status = 'pendente')::text AS revisao_pendente,
         (SELECT count(*) FROM fin_a_classificar_v WHERE posted_on >= '2026-01-01')::text AS a_classificar,
         (SELECT count(*) FROM fin_contraparte_documento_conflito_v)::text AS documento_conflito,
         (SELECT count(*) FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
           WHERE e.slug = $1 AND t.competence_date IS NULL)::text AS sem_competencia,
         (SELECT count(*) FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
           WHERE e.slug = $1 AND d.direction = 'pagar')::text AS documentos_a_pagar,
         (SELECT count(*) FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
           WHERE e.slug = $1 AND t.cost_center_id IS NULL AND t.transfer_status = 'nao'
             AND NOT t.is_split_parent AND t.posted_on >= '2026-01-01')::text AS sem_centro_custo_2026`,
      [ENTIDADE]
    );

    const n = (chave: string) => Number(medidas?.[chave] ?? 0);

    const checagens: ChecagemIntegridade[] = [
      {
        chave: "caixa_fecha",
        titulo: "O caixa fecha em todas as contas",
        invariante: "saldo declarado = abertura + soma dos lançamentos, conta a conta",
        passou: cobertura.contasQueNaoFecham === 0,
        observado: cobertura.contas.filter((c) => c.fechaCaixa === true).length,
        esperado: cobertura.contas.length,
        valorCents: null,
        severidade: "bloqueante",
        rota: "/financeiro/contas"
      },
      {
        chave: "extrato_d1",
        titulo: "Extrato cobre até D+1",
        invariante: "toda conta ativa tem cobertura de extrato até ontem",
        passou: cobertura.contasAtrasadas === 0,
        observado: cobertura.contas.length - cobertura.contasAtrasadas,
        esperado: cobertura.contas.length,
        valorCents: null,
        severidade: "bloqueante",
        rota: "/financeiro/importar"
      },
      {
        chave: "sem_categoria",
        titulo: "Todo lançamento tem categoria",
        invariante: "category_id não nulo em tudo que não é transferência",
        passou: n("sem_categoria") === 0,
        observado: n("sem_categoria"),
        esperado: 0,
        valorCents: n("sem_categoria_cents"),
        severidade: "bloqueante",
        rota: "/financeiro/qualificar"
      },
      {
        chave: "a_classificar",
        titulo: "Nada parado em '3.99/5.99 a classificar'",
        invariante: "as categorias que declaram indefinição estão vazias",
        passou: n("a_classificar") === 0,
        observado: n("a_classificar"),
        esperado: 0,
        valorCents: null,
        severidade: "bloqueante",
        rota: "/financeiro/qualificar"
      },
      {
        chave: "transferencia_orfa",
        titulo: "Toda transferência tem par",
        invariante: "nenhuma perna em_transito sem contraparte encontrada",
        passou: n("transferencia_orfa") === 0,
        observado: n("transferencia_orfa"),
        esperado: 0,
        valorCents: null,
        severidade: "alerta",
        rota: "/financeiro/lancamentos?transferencia=em_transito"
      },
      {
        chave: "transferencia_suspeita",
        titulo: "Nenhum pareamento por coincidência",
        invariante: "as duas pernas de um par têm a mesma contraparte",
        passou: n("transferencia_suspeita") === 0,
        observado: n("transferencia_suspeita"),
        esperado: 0,
        valorCents: null,
        severidade: "bloqueante",
        rota: "/financeiro/conciliacao"
      },
      {
        chave: "documento_conflito",
        titulo: "Documento da contraparte sem conflito",
        invariante: "o CNPJ do extrato é o mesmo do cadastro",
        passou: n("documento_conflito") === 0,
        observado: n("documento_conflito"),
        esperado: 0,
        valorCents: null,
        severidade: "bloqueante",
        rota: "/financeiro/qualificar?fila=documento"
      },
      {
        chave: "contas_a_pagar",
        titulo: "As contas a pagar existem como documento",
        invariante: "fin_document tem linhas com direction='pagar'",
        passou: n("documentos_a_pagar") > 0,
        observado: n("documentos_a_pagar"),
        esperado: 1,
        valorCents: null,
        severidade: "bloqueante",
        rota: "/financeiro/pagamentos"
      },
      {
        chave: "competencia",
        titulo: "Competência declarada",
        invariante: "competence_date preenchido, ou o regime declarado como caixa",
        // Passa com ressalva: o regime de caixa está DECLARADO nos contratos,
        // então a ausência é conhecida e assumida, não um buraco silencioso.
        passou: false,
        observado: n("sem_competencia"),
        esperado: 0,
        valorCents: null,
        severidade: "alerta",
        rota: null
      },
      {
        chave: "centro_custo_2026",
        titulo: "Centro de custo em 2026",
        invariante: "todo custo aponta para um projeto ou estrutura",
        passou: n("sem_centro_custo_2026") === 0,
        observado: n("sem_centro_custo_2026"),
        esperado: 0,
        valorCents: null,
        severidade: "alerta",
        rota: "/financeiro/lancamentos?semCentroCusto=1"
      },
      {
        chave: "revisao",
        titulo: "Fila de revisão vazia",
        invariante: "nenhum item de revisão pendente",
        passou: n("revisao_pendente") === 0,
        observado: n("revisao_pendente"),
        esperado: 0,
        valorCents: null,
        severidade: "informativo",
        rota: "/financeiro/revisao"
      }
    ];

    return contrato({
      dominio: "pendencias",
      dado: {
        checagens,
        bloqueantes: checagens.filter((c) => !c.passou && c.severidade === "bloqueante").length,
        caixaFecha: cobertura.contasQueNaoFecham === 0 && cobertura.contas.length > 0,
        contasQueNaoFecham: cobertura.contas.filter((c) => c.fechaCaixa === false).map((c) => c.slug),
        contasAtrasadas: cobertura.contas.filter((c) => c.estado !== "em_dia").map((c) => c.slug)
      },
      cobertura: cobertura.fontes,
      pendencias: checagens
        .filter((c) => !c.passou)
        .map((c) => ({
          chave: c.chave,
          titulo: c.titulo,
          quantidade: c.observado,
          valorCents: c.valorCents,
          severidade: c.severidade,
          telaDeDecisao: c.rota
        })),
      ressalvas: [
        "Estas são invariantes verificadas AGORA sobre o dado, não testes de CI. Um schema perfeito e um ledger mentindo passam no CI e reprovam aqui.",
        "'competencia' aparece como não-passou de propósito: o regime de caixa está declarado nos contratos, mas a lacuna continua sendo lacuna."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:pendencias]", mensagem);
    return contratoIndisponivel("pendencias", PENDENCIAS_VAZIO, mensagem);
  }
}
