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
 * O extrato unificado — a tela para onde todo drill-down aponta.
 *
 * Por ser o destino de todos os detalhamentos, ela precisa aceitar EXATAMENTE
 * os filtros que os outros domínios emitem em `Drill.filtros`. Um drill que
 * chega com um filtro que esta tela não conhece devolve a lista inteira, e o
 * usuário conclui que o número de origem estava errado.
 *
 * A transferência entre contas próprias fica oculta por padrão: são linhas que
 * não são nem receita nem despesa e poluem a leitura. Quem quiser vê-las pede.
 */

const DOMINIO = "lancamentos";

export type Lancamento = {
  id: number;
  data: string;
  descricao: string;
  contraparte: string | null;
  contraparteId: number | null;
  documentoContraparte: string | null;
  categoria: string | null;
  categoriaCode: string | null;
  nucleo: string | null;
  centroCusto: string | null;
  valorCents: number;
  conta: string;
  contaSlug: string;
  origem: string | null;
  transferencia: string;
  conciliado: string;
  revisao: string;
  classificadoPor: string | null;
  /** O rationale da classificação automática, para a tela explicar o "por quê". */
  porQue: Record<string, unknown> | null;
  temLastro: boolean;
  endToEndId: string | null;
};

export type FiltrosLancamentos = {
  conta?: string;
  nucleo?: string;
  categoria?: string;
  centroCusto?: string;
  contraparte?: number;
  de?: string;
  ate?: string;
  natureza?: "entrada" | "saida";
  valorMinCents?: number;
  valorMaxCents?: number;
  busca?: string;
  semCategoria?: boolean;
  semContraparte?: boolean;
  semCentroCusto?: boolean;
  incluirTransferencias?: boolean;
  apenasRevisaoPendente?: boolean;
};

export type CampoOrdenacaoLancamento = "data" | "valor" | "contraparte" | "categoria" | "conta";

const COLUNAS: Record<CampoOrdenacaoLancamento, string> = {
  data: "t.posted_on",
  // Valor absoluto: ordenar por valor cru colocaria a maior despesa e a maior
  // receita nas pontas opostas da lista, quando a pergunta é "o que é grande".
  valor: "abs(t.amount_cents)",
  contraparte: "cp.name",
  categoria: "c.code",
  conta: "a.slug"
};

const VAZIO: Pagina<Lancamento> = {
  itens: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  paginas: 1,
  temMais: false,
  ordenacao: { campo: "data", direcao: "desc" },
  vazio: { causa: "fonte_indisponivel", motivo: "banco não configurado", acao: null }
};

export async function getLancamentos(
  filtros: FiltrosLancamentos = {},
  paginacao: Paginacao = {},
  ordem?: Ordenacao<CampoOrdenacaoLancamento>
): Promise<Contrato<Pagina<Lancamento>>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);
  const ordenacao = ordenarPor(ordem, COLUNAS, { campo: "data", direcao: "desc" });

  const cond = new Condicoes(["e.slug = $1", "NOT t.is_split_parent"], [ENTIDADE]);
  if (!filtros.incluirTransferencias) cond.raw("t.transfer_status = 'nao'");
  cond.add("a.slug = $?", filtros.conta);
  cond.add("t.nucleo = $?", filtros.nucleo);
  cond.add("c.code = $?", filtros.categoria);
  cond.add("cc.slug = $?", filtros.centroCusto);
  cond.add("t.counterparty_id = $?", filtros.contraparte);
  cond.add("t.posted_on >= $?", filtros.de);
  cond.add("t.posted_on <= $?", filtros.ate);
  cond.add("abs(t.amount_cents) >= $?", filtros.valorMinCents);
  cond.add("abs(t.amount_cents) <= $?", filtros.valorMaxCents);
  cond.add("t.description_norm LIKE '%' || $? || '%'", filtros.busca?.toLowerCase());
  if (filtros.natureza === "entrada") cond.raw("t.amount_cents > 0");
  if (filtros.natureza === "saida") cond.raw("t.amount_cents < 0");
  if (filtros.semCategoria) cond.raw("t.category_id IS NULL");
  if (filtros.semContraparte) cond.raw("t.counterparty_id IS NULL");
  if (filtros.semCentroCusto) cond.raw("t.cost_center_id IS NULL");
  if (filtros.apenasRevisaoPendente) cond.raw("t.review_status = 'pendente'");

  try {
    const limite = cond.proximo(porPagina);
    const salto = cond.proximo(offset);

    const linhas = await query<Record<string, unknown>>(
      `SELECT t.id, t.posted_on, t.description_raw, t.amount_cents::text AS amount_cents,
              t.counterparty_id, cp.name AS contraparte, t.counterparty_document,
              c.name AS categoria, c.code AS categoria_code, t.nucleo,
              cc.name AS centro_custo, a.name AS conta, a.slug AS conta_slug,
              t.source_kind, t.transfer_status, t.reconciled_status, t.review_status,
              t.classified_by, t.classified_reason, t.lastro_match, t.end_to_end_id,
              count(*) OVER ()::text AS total_linhas,
              SUM(t.amount_cents) OVER ()::text AS soma_filtro
         FROM fin_transaction t
         JOIN fin_entity e ON e.id = t.entity_id
         JOIN fin_account a ON a.id = t.account_id
         LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
         LEFT JOIN fin_category c ON c.id = t.category_id
         LEFT JOIN fin_cost_center cc ON cc.id = t.cost_center_id
        WHERE ${cond.where}
        ORDER BY ${ordenacao.sql}, t.id DESC
        LIMIT ${limite} OFFSET ${salto}`,
      cond.params
    );

    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const itens: Lancamento[] = linhas.map((l) => ({
      id: Number(l.id),
      data: String(l.posted_on).slice(0, 10),
      descricao: String(l.description_raw),
      contraparte: (l.contraparte as string) ?? null,
      contraparteId: l.counterparty_id === null ? null : Number(l.counterparty_id),
      documentoContraparte: (l.counterparty_document as string) ?? null,
      categoria: (l.categoria as string) ?? null,
      categoriaCode: (l.categoria_code as string) ?? null,
      nucleo: (l.nucleo as string) ?? null,
      centroCusto: (l.centro_custo as string) ?? null,
      valorCents: Number(l.amount_cents),
      conta: String(l.conta),
      contaSlug: String(l.conta_slug),
      origem: (l.source_kind as string) ?? null,
      transferencia: String(l.transfer_status),
      conciliado: String(l.reconciled_status),
      revisao: String(l.review_status),
      classificadoPor: (l.classified_by as string) ?? null,
      porQue: (l.classified_reason as Record<string, unknown>) ?? null,
      temLastro: l.lastro_match !== null && l.lastro_match !== undefined,
      endToEndId: (l.end_to_end_id as string) ?? null
    }));

    return contrato({
      dominio: DOMINIO,
      dado: montarPagina({
        itens,
        total,
        pagina,
        porPagina,
        ordenacao: ordenacao.aplicada,
        vazio: {
          causa: "filtro_sem_resultado",
          motivo: "nenhum lançamento casa com este filtro",
          acao: filtros.incluirTransferencias
            ? "afrouxe o período ou a busca"
            : "transferências entre contas próprias estão ocultas — inclua-as se for isso que procura"
        }
      }),
      ressalvas: [
        filtros.incluirTransferencias
          ? "Transferências entre contas próprias estão INCLUÍDAS: a soma desta lista não é receita nem despesa."
          : "Transferências entre contas próprias estão ocultas."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:lancamentos]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

/** Opções para os seletores da tela, numa ida ao banco só. */
export async function getOpcoesLancamentos(): Promise<
  Contrato<{
    contas: { slug: string; nome: string }[];
    categorias: { code: string; nome: string; tipo: string }[];
    nucleos: { slug: string; nome: string }[];
    centrosCusto: { slug: string; nome: string; tipo: string }[];
  }>
> {
  const vazio = { contas: [], categorias: [], nucleos: [], centrosCusto: [] };
  if (!isFinanceConfigured()) return contratoIndisponivel("lancamentos.opcoes", vazio, "banco não configurado");
  try {
    const [contas, categorias, nucleos, centros] = await Promise.all([
      query<{ slug: string; nome: string }>(
        `SELECT a.slug, a.name AS nome FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
        [ENTIDADE]
      ),
      query<{ code: string; nome: string; tipo: string }>(
        `SELECT c.code, c.name AS nome, c.kind AS tipo FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id
          WHERE e.slug = $1 AND c.is_active ORDER BY c.sort_order, c.code`,
        [ENTIDADE]
      ),
      query<{ slug: string; nome: string }>(
        `SELECT slug, name AS nome FROM fin_nucleo WHERE is_active ORDER BY sort_order`
      ),
      query<{ slug: string; nome: string; tipo: string }>(
        `SELECT cc.slug, cc.name AS nome, cc.kind AS tipo FROM fin_cost_center cc
           JOIN fin_entity e ON e.id = cc.entity_id
          WHERE e.slug = $1 AND cc.is_active ORDER BY cc.kind, cc.sort_order, cc.name`,
        [ENTIDADE]
      )
    ]);
    return contrato({ dominio: "lancamentos.opcoes", dado: { contas, categorias, nucleos, centrosCusto: centros } });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    return contratoIndisponivel("lancamentos.opcoes", vazio, mensagem);
  }
}

/** Drill padrão que os outros domínios devem emitir para chegar aqui. */
export function drillLancamentos(filtros: FiltrosLancamentos): Drill {
  return { dominio: DOMINIO, filtros: filtros as Record<string, string | number | boolean | null> };
}
