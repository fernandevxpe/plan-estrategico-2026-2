import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  Condicoes,
  contrato,
  contratoIndisponivel,
  ENTIDADE,
  montarPagina,
  normalizarPaginacao,
  ordenarPor,
  type Contrato,
  type Drill,
  type Ordenacao,
  type Pagina,
  type Paginacao
} from "./base";

/**
 * Contas a receber e contas a pagar.
 *
 * Os dois lados estão em estados MUITO diferentes, e o contrato não disfarça:
 *
 *   A RECEBER  tem 3.406 documentos, 596 em aberto, aging pronto e curva ABC.
 *              É o domínio mais completo da base.
 *   A PAGAR    tem ZERO documentos. `fin_document` inteiro é `direction =
 *              'receber'`. A obrigação a pagar existe hoje só como recorrente
 *              detectada, fatura de cartão e folha — cada uma numa camada
 *              própria que NÃO pode ser somada com as outras.
 *
 * Por isso `getContasAPagar` devolve as camadas separadas, com o motivo de cada
 * uma não ser somável, em vez de um total único que pareceria completo.
 */

// ---------------------------------------------------------------------------
// A receber
// ---------------------------------------------------------------------------

export type Recebivel = {
  documentoId: number | null;
  parcelaErpId: number | null;
  camada: string;
  cliente: string | null;
  clienteId: number | null;
  documentoCliente: string | null;
  nucleo: string | null;
  vencimento: string;
  abertoCents: number;
  status: string;
  confianca: string;
  diasAtraso: number;
  faixa: string;
};

export type FiltrosReceber = {
  cliente?: number;
  nucleo?: string;
  camada?: string;
  vencimentoDe?: string;
  vencimentoAte?: string;
  apenasVencido?: boolean;
  faixa?: string;
  busca?: string;
};

export type CampoOrdenacaoReceber = "vencimento" | "valor" | "cliente" | "atraso";

const COLUNAS_RECEBER: Record<CampoOrdenacaoReceber, string> = {
  vencimento: "r.vencimento",
  valor: "r.aberto_cents",
  cliente: "r.cliente",
  atraso: "r.dias_atraso"
};

const PAGINA_VAZIA_RECEBER: Pagina<Recebivel> = {
  itens: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  paginas: 1,
  temMais: false,
  ordenacao: { campo: "vencimento", direcao: "asc" },
  vazio: { causa: "fonte_indisponivel", motivo: "banco não configurado", acao: null }
};

export async function getContasAReceber(
  filtros: FiltrosReceber = {},
  paginacao: Paginacao = {},
  ordem?: Ordenacao<CampoOrdenacaoReceber>
): Promise<Contrato<{ pagina: Pagina<Recebivel>; aging: FaixaAging[]; totalAbertoCents: number; totalVencidoCents: number }>> {
  const vazio = { pagina: PAGINA_VAZIA_RECEBER, aging: [], totalAbertoCents: 0, totalVencidoCents: 0 };
  if (!isFinanceConfigured()) return contratoIndisponivel("receber", vazio, "banco financeiro não configurado");

  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);
  const ordenacao = ordenarPor(ordem, COLUNAS_RECEBER, { campo: "vencimento", direcao: "asc" });

  const cond = new Condicoes(["e.slug = $1"], [ENTIDADE]);
  cond.add("r.counterparty_id = $?", filtros.cliente);
  cond.add("r.nucleo = $?", filtros.nucleo);
  cond.add("r.camada = $?", filtros.camada);
  cond.add("r.vencimento >= $?", filtros.vencimentoDe);
  cond.add("r.vencimento <= $?", filtros.vencimentoAte);
  cond.add("r.faixa = $?", filtros.faixa);
  cond.add("r.cliente ILIKE '%' || $? || '%'", filtros.busca);
  if (filtros.apenasVencido) cond.raw("r.dias_atraso > 0");

  try {
    const limite = cond.proximo(porPagina);
    const salto = cond.proximo(offset);

    const [linhas, aging] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT r.*, count(*) OVER ()::text AS total_linhas,
                SUM(r.aberto_cents) OVER ()::text AS total_aberto,
                SUM(r.aberto_cents) FILTER (WHERE r.dias_atraso > 0) OVER ()::text AS total_vencido
           FROM fin_receber_aging_v r JOIN fin_entity e ON e.id = r.entity_id
          WHERE ${cond.where}
          ORDER BY ${ordenacao.sql}, r.document_id NULLS LAST
          LIMIT ${limite} OFFSET ${salto}`,
        cond.params
      ),
      query<{ faixa: string; total: string; n: string }>(
        `SELECT r.faixa, SUM(r.aberto_cents)::text AS total, count(*)::text AS n
           FROM fin_receber_aging_v r JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 GROUP BY 1 ORDER BY 1`,
        [ENTIDADE]
      )
    ]);

    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const itens: Recebivel[] = linhas.map((l) => ({
      documentoId: l.document_id === null ? null : Number(l.document_id),
      parcelaErpId: l.parcela_erp_id === null ? null : Number(l.parcela_erp_id),
      camada: String(l.camada),
      cliente: (l.cliente as string) ?? null,
      clienteId: l.counterparty_id === null ? null : Number(l.counterparty_id),
      documentoCliente: (l.cliente_documento as string) ?? null,
      nucleo: (l.nucleo as string) ?? null,
      vencimento: String(l.vencimento).slice(0, 10),
      abertoCents: Number(l.aberto_cents),
      status: String(l.status),
      confianca: String(l.confianca),
      diasAtraso: Number(l.dias_atraso ?? 0),
      faixa: String(l.faixa)
    }));

    return contrato({
      dominio: "receber",
      dado: {
        pagina: montarPagina({ itens, total, pagina, porPagina, ordenacao: ordenacao.aplicada }),
        aging: aging.map((a) => ({ faixa: a.faixa, totalCents: Number(a.total), n: Number(a.n) })),
        totalAbertoCents: Number(linhas[0]?.total_aberto ?? 0),
        totalVencidoCents: Number(linhas[0]?.total_vencido ?? 0)
      },
      ressalvas: [
        "'vencido' não é status: é vencimento < hoje sobre o que está em aberto. O gateway pode não ter carimbado OVERDUE ainda.",
        "As camadas (cobrança emitida, previsão de contrato) NÃO se somam entre si — a mesma receita apareceria duas vezes."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:receber]", mensagem);
    return contratoIndisponivel("receber", vazio, mensagem);
  }
}

export type FaixaAging = { faixa: string; totalCents: number; n: number };

/** Curva ABC de receita: quem sustenta o mês, em ordem. */
export type LinhaPrioridade = {
  mes: string;
  posicao: number;
  clienteId: number | null;
  cliente: string | null;
  totalCents: number;
  cobrancas: number;
  pctDoMes: number;
  pctAcumulado: number;
  faixa: string;
  certeza: string;
  drill: Drill;
};

export async function getPrioridadeReceita(mes?: string): Promise<Contrato<LinhaPrioridade[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("receber.prioridade", [], "banco não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT * FROM fin_receita_prioridade_v
        WHERE ($1::date IS NULL OR mes = $1::date)
        ORDER BY mes DESC, posicao LIMIT 500`,
      [mes ?? null]
    );
    return contrato({
      dominio: "receber.prioridade",
      dado: linhas.map((l) => ({
        mes: String(l.mes).slice(0, 10),
        posicao: Number(l.posicao),
        clienteId: l.counterparty_id === null ? null : Number(l.counterparty_id),
        cliente: (l.contraparte as string) ?? null,
        totalCents: Number(l.total_cents),
        cobrancas: Number(l.cobrancas),
        pctDoMes: Number(l.pct_do_mes),
        pctAcumulado: Number(l.pct_acumulado),
        faixa: String(l.faixa),
        certeza: String(l.certeza),
        drill: { dominio: "receber", filtros: { cliente: Number(l.counterparty_id ?? 0) } }
      })),
      ressalvas: ["Curva ABC: a faixa A é quem, se atrasar, muda o mês. É a lista de cobrança, não um ranking decorativo."]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    return contratoIndisponivel("receber.prioridade", [], mensagem);
  }
}

// ---------------------------------------------------------------------------
// A pagar — camadas separadas, porque somá-las seria errado
// ---------------------------------------------------------------------------

export type CamadaAPagar = {
  camada: string;
  titulo: string;
  origem: string;
  itens: number;
  totalCents: number;
  /** Por que esta camada não pode ser somada com as outras. */
  naoSomarCom: string[];
  confianca: "contratado" | "firme" | "provavel" | "observado" | "estimado";
  drill: Drill | null;
};

export type ContasAPagar = {
  documentos: { itens: number; totalCents: number | null; motivoIndeterminado: string | null };
  camadas: CamadaAPagar[];
  /**
   * O total NÃO é a soma das camadas. É null de propósito enquanto não houver
   * uma camada única e completa — declarar um número somando camadas que se
   * sobrepõem seria exatamente o erro que a 0045 e a 0057 documentam.
   */
  totalCents: number | null;
  motivoSemTotal: string | null;
};

const A_PAGAR_VAZIO: ContasAPagar = {
  documentos: { itens: 0, totalCents: null, motivoIndeterminado: "banco não consultado" },
  camadas: [],
  totalCents: null,
  motivoSemTotal: "banco não consultado"
};

export async function getContasAPagar(): Promise<Contrato<ContasAPagar>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("pagar", A_PAGAR_VAZIO, "banco financeiro não configurado");
  try {
    const [docs, recorrentes, cartao, folha] = await Promise.all([
      query<{ n: string; total: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(d.amount_cents - d.settled_cents), 0)::text AS total
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1 AND d.direction = 'pagar' AND d.status IN ('previsto','emitido','confirmado','parcial')`,
        [ENTIDADE]
      ),
      query<{ status: string; n: string; total: string }>(
        `SELECT r.status, count(*)::text AS n, COALESCE(SUM(r.amount_cents), 0)::text AS total
           FROM fin_recurring r JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 AND r.direction = 'pagar' AND r.status IN ('ativo','proposto')
          GROUP BY 1`,
        [ENTIDADE]
      ),
      query<{ n: string; total: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(amount_cents), 0)::text AS total
           FROM fin_card_compromisso_mensal_v
          WHERE competence_month >= date_trunc('month', CURRENT_DATE)::date`
      ),
      query<{ n: string; total: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(amount_cents), 0)::text AS total
           FROM fin_person_compensation pc JOIN fin_entity e ON e.id = pc.entity_id
          WHERE e.slug = $1 AND pc.reference_month = date_trunc('month', CURRENT_DATE)::date`,
        [ENTIDADE]
      )
    ]);

    const nDocs = Number(docs[0]?.n ?? 0);
    const camadas: CamadaAPagar[] = [];

    const ativos = recorrentes.find((r) => r.status === "ativo");
    const propostos = recorrentes.find((r) => r.status === "proposto");
    if (ativos) {
      camadas.push({
        camada: "recorrente_ativa",
        titulo: "Recorrentes confirmadas",
        origem: "fin_recurring",
        itens: Number(ativos.n),
        totalCents: Number(ativos.total),
        naoSomarCom: ["fatura_cartao", "folha", "documento_a_pagar"],
        confianca: "firme",
        drill: { dominio: "recorrentes", filtros: { status: "ativo" } }
      });
    }
    if (propostos) {
      camadas.push({
        camada: "recorrente_proposta",
        titulo: "Recorrentes propostas (aguardando confirmação)",
        origem: "fin_recurring",
        itens: Number(propostos.n),
        totalCents: Number(propostos.total),
        naoSomarCom: ["recorrente_ativa"],
        confianca: "provavel",
        drill: { dominio: "decisoes", filtros: { fila: "recorrente_proposta" } }
      });
    }
    camadas.push({
      camada: "fatura_cartao",
      titulo: "Compromisso de cartão (competência a partir deste mês)",
      origem: "fin_card_compromisso_mensal_v",
      itens: Number(cartao[0]?.n ?? 0),
      totalCents: Number(cartao[0]?.total ?? 0),
      naoSomarCom: ["recorrente_ativa"],
      confianca: "contratado",
      drill: { dominio: "cartao", filtros: {} }
    });
    camadas.push({
      camada: "folha",
      titulo: "Folha declarada do mês",
      origem: "fin_person_compensation",
      itens: Number(folha[0]?.n ?? 0),
      totalCents: Number(folha[0]?.total ?? 0),
      naoSomarCom: ["recorrente_ativa"],
      confianca: "contratado",
      drill: { dominio: "pessoas", filtros: {} }
    });

    return contrato({
      dominio: "pagar",
      dado: {
        documentos: {
          itens: nDocs,
          totalCents: nDocs === 0 ? null : Number(docs[0].total),
          motivoIndeterminado:
            nDocs === 0
              ? "fin_document não tem nenhuma linha com direction='pagar': as contas a pagar nunca foram carregadas"
              : null
        },
        camadas: camadas.filter((c) => c.itens > 0),
        totalCents: null,
        motivoSemTotal:
          "as camadas se sobrepõem (a mesma despesa aparece como recorrente, como fatura e como folha). " +
          "Somá-las produziria um total inflado; um total honesto exige a camada de documentos a pagar, que ainda não existe."
      },
      ressalvas: [
        "Este é o domínio mais incompleto da base. O ledger tem 100% da receita e 0% das contas a pagar como documento.",
        "A fila de pagamento (0075) é onde a obrigação a pagar passa a existir com beneficiário, vencimento e comprovante."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:pagar]", mensagem);
    return contratoIndisponivel("pagar", A_PAGAR_VAZIO, mensagem);
  }
}
