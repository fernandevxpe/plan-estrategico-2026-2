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
  type Ordenacao,
  type Pagina,
  type Paginacao
} from "./base";

/**
 * A central de categorização — o lado da LEITURA.
 *
 * POR QUE ESTE DOMÍNIO EXISTE
 *
 * A categorização estava espalhada em três universos que não conversavam, e o
 * indicador do painel media um só:
 *
 *   fin_transaction ........ o painel mede este
 *   fin_document ...........  389 sem categoria · R$ 259.432,76 · fora de todo indicador
 *   fin_card_transaction ...  500 sem categoria · R$  54.126,76 · fora de todo indicador
 *
 * `fin_categorizavel_v` (0101) é a única régua que atravessa os três. Este
 * contrato é a porta HTTP dela.
 *
 * DUAS COISAS QUE ESTE CONTRATO SE RECUSA A FAZER
 *
 * 1. **Não soma valor entre universos.** `fin_card_transaction.amount_cents`
 *    tem sinal de DÍVIDA (positivo aumenta o que se deve) e
 *    `fin_transaction.amount_cents` tem sinal de CAIXA (negativo é saída). A
 *    0047 já avisava; somar os dois produz um número que não significa nada. A
 *    busca devolve `valorAbsCents` + `direcao` e o total por universo separado.
 *
 * 2. **Não aceita `ORDER BY` do cliente.** A ordenação passa por lista branca
 *    (`COLUNAS`), e campo desconhecido é 400 — nunca "ordena por outra coisa e
 *    devolve 200", que é como quem lê a primeira página conclui que os maiores
 *    valores são aqueles.
 *
 * SOMENTE LEITURA. A escrita mora em `lib/financeiro/categorizacao.ts`.
 */

const DOMINIO = "categorizacao";

// ---------------------------------------------------------------------------
// Vocabulário — o mesmo da view, para a tela e a rota não inventarem outro
// ---------------------------------------------------------------------------

export const UNIVERSOS = ["lancamento", "documento", "item_cartao"] as const;
export type Universo = (typeof UNIVERSOS)[number];

export const ESTADOS = ["classificado", "indeterminado", "em_duvida"] as const;
export type EstadoCategorizacao = (typeof ESTADOS)[number];

export const PROCEDENCIAS = [
  "humano",
  "contrato",
  "regra",
  "fonte",
  "cadastro",
  "historico",
  "padrao",
  "indefinida"
] as const;
export type ProcedenciaFamilia = (typeof PROCEDENCIAS)[number];

export const DIRECOES = ["entrada", "saida"] as const;

/** Os dois códigos que NÃO são linha do plano de contas — são marcadores de indecisão. */
export const MARCADORES_INDECISAO = ["3.99", "5.99"] as const;

export type ItemCategorizavel = {
  universo: Universo;
  id: number;
  data: string;
  competencia: string | null;
  descricao: string;
  contraparte: string | null;
  contraparteId: number | null;
  contraparteDocumento: string | null;
  valorAbsCents: number;
  /** O valor como a fonte grava. NUNCA some entre universos: o sinal do cartão é de dívida. */
  valorFonteCents: number;
  direcao: "entrada" | "saida";
  categoriaCode: string | null;
  categoriaNome: string | null;
  categoriaKind: string | null;
  categoriaGrupo: string | null;
  nucleo: string | null;
  centroCusto: string | null;
  /** Quem decidiu, na família que a tela mostra. */
  procedencia: ProcedenciaFamilia;
  /** O carimbo cru de `classified_by`, para quem for auditar. */
  procedenciaBruta: string | null;
  procedenciaRegra: string | null;
  procedenciaEvidencia: Record<string, unknown> | null;
  procedenciaEvidenciaTexto: string | null;
  procedenciaEm: string | null;
  estado: EstadoCategorizacao;
  /** Preenchido sempre que `estado` é indeterminado. `sem-motivo-declarado` é achado, não bug. */
  motivoIndeterminado: string | null;
  filaMotivo: string | null;
  filaStatus: string | null;
  travado: boolean;
  travadoCampos: string[];
  revisao: string;
  fonte: string;
  fonteRotulo: string;
  classificavel: boolean;
  motivoNaoClassificavel: string | null;
};

export type FiltrosBusca = {
  /** Texto livre sobre descrição E contraparte. */
  busca?: string;
  universo?: Universo;
  categoria?: string;
  /** `true` devolve só o que não tem categoria utilizável (nula, 3.99 ou 5.99). */
  semCategoria?: boolean;
  /**
   * O slug de `v.fonte` — conta bancária no universo lançamento, fonte de
   * dado (asaas/clickup) no documento, cartão no item de cartão. Filtrar por
   * um slug de conta bancária devolve zero linhas de documento e item de
   * cartão: é o resultado certo, não um bug — nenhum dos dois tem conta
   * bancária até ser conciliado.
   */
  conta?: string;
  nucleo?: string;
  centroCusto?: string;
  contraparte?: number;
  de?: string;
  ate?: string;
  valorMinCents?: number;
  valorMaxCents?: number;
  direcao?: "entrada" | "saida";
  estado?: EstadoCategorizacao;
  procedencia?: ProcedenciaFamilia;
  travado?: boolean;
  /** Só o que uma rota de lote pode de fato reclassificar. */
  apenasClassificavel?: boolean;
};

export type CampoOrdenacaoBusca = "data" | "valor" | "descricao" | "categoria" | "universo" | "estado" | "procedencia";

/**
 * Lista branca de ordenação. Só o que está aqui vira `ORDER BY`.
 *
 * `v.id` entra como desempate em todas: sem chave estável, duas páginas
 * seguidas com valores empatados devolvem a mesma linha duas vezes e omitem
 * outra — e o usuário conclui que a base perdeu um lançamento.
 */
const COLUNAS: Record<CampoOrdenacaoBusca, string> = {
  data: "v.data",
  valor: "v.valor_abs_cents",
  descricao: "v.descricao",
  categoria: "v.categoria_code",
  universo: "v.universo",
  estado: "v.estado",
  procedencia: "v.procedencia_familia"
};

export type ResumoUniverso = {
  universo: Universo;
  n: number;
  valorAbsCents: number;
  classificados: number;
  indeterminados: number;
  emDuvida: number;
};

export type BuscaCategorizacao = {
  pagina: Pagina<ItemCategorizavel>;
  /** O alcance do filtro por universo. Nunca somado: são grandezas diferentes. */
  porUniverso: ResumoUniverso[];
  /** Quantos itens do filtro estão travados por decisão humana. */
  travados: number;
};

const VAZIO: BuscaCategorizacao = {
  pagina: {
    itens: [],
    total: 0,
    pagina: 1,
    porPagina: 50,
    paginas: 1,
    temMais: false,
    ordenacao: { campo: "data", direcao: "desc" },
    vazio: null
  },
  porUniverso: [],
  travados: 0
};

export async function getBuscaCategorizacao(
  filtros: FiltrosBusca = {},
  paginacao: Paginacao = {},
  ordem?: Ordenacao<CampoOrdenacaoBusca>
): Promise<Contrato<BuscaCategorizacao>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);
  const ordenacao = ordenarPor(ordem, COLUNAS, { campo: "data", direcao: "desc" });

  const cond = new Condicoes(["e.slug = $1"], [ENTIDADE]);
  cond.add("v.universo = $?", filtros.universo);
  cond.add("v.categoria_code = $?", filtros.categoria);
  cond.add("v.fonte = $?", filtros.conta);
  cond.add("v.nucleo = $?", filtros.nucleo);
  cond.add("v.centro_custo = $?", filtros.centroCusto);
  cond.add("v.contraparte_id = $?", filtros.contraparte);
  cond.add("v.data >= $?", filtros.de);
  cond.add("v.data <= $?", filtros.ate);
  cond.add("v.valor_abs_cents >= $?", filtros.valorMinCents);
  cond.add("v.valor_abs_cents <= $?", filtros.valorMaxCents);
  cond.add("v.direcao = $?", filtros.direcao);
  cond.add("v.estado = $?", filtros.estado);
  cond.add("v.procedencia_familia = $?", filtros.procedencia);
  // O texto livre varre descrição E contraparte de uma vez: quem procura
  // "uber" não sabe se o nome está na descrição do extrato ou no cadastro do
  // fornecedor. Os dois LIKE compartilham UM parâmetro — `Condicoes.add` só
  // sabe substituir um `$?` por chamada, então o índice é fixado aqui.
  const termo = filtros.busca?.trim().toLowerCase();
  if (termo) {
    const i = cond.params.push(termo);
    cond.raw(
      `(v.descricao_norm LIKE '%' || $${i} || '%' OR lower(coalesce(v.contraparte, '')) LIKE '%' || $${i} || '%')`
    );
  }
  if (filtros.semCategoria) cond.raw("v.estado = 'indeterminado'");
  if (filtros.travado === true) cond.raw("v.travado");
  if (filtros.travado === false) cond.raw("NOT v.travado");
  if (filtros.apenasClassificavel) cond.raw("v.classificavel");

  try {
    const where = cond.where;
    const params = [...cond.params];
    const limite = `$${params.push(porPagina)}`;
    const salto = `$${params.push(offset)}`;

    const [linhas, resumo] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT v.*, count(*) OVER ()::text AS total_linhas,
                count(*) FILTER (WHERE v.travado) OVER ()::text AS total_travados
           FROM fin_categorizavel_v v
           JOIN fin_entity e ON e.id = v.entity_id
          WHERE ${where}
          ORDER BY ${ordenacao.sql}, v.universo ASC, v.id DESC
          LIMIT ${limite} OFFSET ${salto}`,
        params
      ),
      query<Record<string, unknown>>(
        `SELECT v.universo, count(*)::text AS n,
                sum(v.valor_abs_cents)::text AS valor,
                count(*) FILTER (WHERE v.estado = 'classificado')::text  AS classificados,
                count(*) FILTER (WHERE v.estado = 'indeterminado')::text AS indeterminados,
                count(*) FILTER (WHERE v.estado = 'em_duvida')::text     AS em_duvida
           FROM fin_categorizavel_v v
           JOIN fin_entity e ON e.id = v.entity_id
          WHERE ${where}
          GROUP BY v.universo ORDER BY v.universo`,
        cond.params
      )
    ]);

    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const travados = linhas.length ? Number(linhas[0].total_travados) : 0;

    return contrato({
      dominio: DOMINIO,
      dado: {
        pagina: montarPagina({
          itens: linhas.map(paraItem),
          total,
          pagina,
          porPagina,
          ordenacao: ordenacao.aplicada,
          vazio: {
            causa: "filtro_sem_resultado",
            motivo: "nenhum item categorizável casa com este filtro",
            acao: "afrouxe o período, a faixa de valor ou o texto — a busca varre os três universos"
          }
        }),
        porUniverso: resumo.map((r) => ({
          universo: String(r.universo) as Universo,
          n: Number(r.n),
          valorAbsCents: Number(r.valor ?? 0),
          classificados: Number(r.classificados),
          indeterminados: Number(r.indeterminados),
          emDuvida: Number(r.em_duvida)
        })),
        travados
      },
      ressalvas: [
        "Os totais por universo NÃO se somam: o sinal de fin_card_transaction é de dívida " +
          "(positivo aumenta o que se deve) e o de fin_transaction é de caixa (negativo é saída).",
        "Item de cartão nunca aparece como 'em dúvida': fin_review_item não aceita " +
          "fin_card_transaction como alvo, então a fila de revisão não alcança o subledger do cartão."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:categorizacao]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

function paraItem(l: Record<string, unknown>): ItemCategorizavel {
  return {
    universo: String(l.universo) as Universo,
    id: Number(l.id),
    data: String(l.data).slice(0, 10),
    competencia: l.competencia ? String(l.competencia).slice(0, 10) : null,
    descricao: String(l.descricao ?? ""),
    contraparte: (l.contraparte as string) ?? null,
    contraparteId: l.contraparte_id === null || l.contraparte_id === undefined ? null : Number(l.contraparte_id),
    contraparteDocumento: (l.contraparte_documento as string) ?? null,
    valorAbsCents: Number(l.valor_abs_cents),
    valorFonteCents: Number(l.valor_fonte_cents),
    direcao: l.direcao === "entrada" ? "entrada" : "saida",
    categoriaCode: (l.categoria_code as string) ?? null,
    categoriaNome: (l.categoria_nome as string) ?? null,
    categoriaKind: (l.categoria_kind as string) ?? null,
    categoriaGrupo: (l.categoria_grupo as string) ?? null,
    nucleo: (l.nucleo as string) ?? null,
    centroCusto: (l.centro_custo as string) ?? null,
    procedencia: String(l.procedencia_familia) as ProcedenciaFamilia,
    procedenciaBruta: (l.procedencia as string) ?? null,
    procedenciaRegra: (l.procedencia_regra as string) ?? null,
    procedenciaEvidencia: (l.procedencia_evidencia as Record<string, unknown>) ?? null,
    procedenciaEvidenciaTexto: (l.procedencia_evidencia_txt as string) ?? null,
    procedenciaEm: l.procedencia_em ? new Date(String(l.procedencia_em)).toISOString() : null,
    estado: String(l.estado) as EstadoCategorizacao,
    motivoIndeterminado: (l.motivo_indeterminado as string) ?? null,
    filaMotivo: (l.fila_motivo as string) ?? null,
    filaStatus: (l.fila_status as string) ?? null,
    travado: Boolean(l.travado),
    travadoCampos: (l.travado_campos as string[]) ?? [],
    revisao: String(l.review_status ?? ""),
    fonte: String(l.fonte ?? ""),
    fonteRotulo: String(l.fonte_rotulo ?? ""),
    classificavel: Boolean(l.classificavel),
    motivoNaoClassificavel: (l.motivo_nao_classificavel as string) ?? null
  };
}

// ---------------------------------------------------------------------------
// O plano de contas, com o uso medido nos três universos
// ---------------------------------------------------------------------------

export type CategoriaPlano = {
  id: number;
  code: string;
  nome: string;
  kind: string;
  grupo: string | null;
  dreLine: string | null;
  nucleoPadrao: string | null;
  ativa: boolean;
  /**
   * O sinal que a categoria exige do valor. Derivado de `kind`, nunca gravado
   * numa coluna própria: quem aplica é o gatilho
   * `fin_transaction_sinal_da_categoria`, e uma segunda coluna dizendo o mesmo
   * seria uma segunda verdade esperando para divergir da primeira.
   */
  sinalEsperado: "entrada" | "saida" | "ambos";
  usoLancamento: number;
  usoDocumento: number;
  usoItemCartao: number;
  usoVivo: number;
  valorVivoCents: number;
  eventosTrilha: number;
  regras: number;
  regrasCartao: number;
  contrapartes: number;
  /** 3.99 e 5.99. Não são linha do plano de contas — são o vocabulário da indecisão. */
  marcadorDeIndecisao: boolean;
  podeDesativar: boolean;
  motivoBloqueio: string | null;
};

/** Receita exige entrada; custo/despesa/pessoal/imposto/investimento exigem saída. */
export function sinalEsperadoDe(kind: string): "entrada" | "saida" | "ambos" {
  if (kind === "receita") return "entrada";
  if (["custo_variavel_direto", "despesa_operacional", "pessoal", "imposto", "investimento"].includes(kind)) {
    return "saida";
  }
  // `movimentacao_financeira` e `deducao_receita` andam nos dois sentidos: uma
  // transferência entre contas próprias tem perna de entrada e de saída.
  return "ambos";
}

export async function getPlanoDeContas(
  incluirInativas = false
): Promise<Contrato<{ categorias: CategoriaPlano[]; gruposFluxo: { slug: string; nome: string; direcao: string }[] }>> {
  const vazio = { categorias: [], gruposFluxo: [] };
  if (!isFinanceConfigured()) return contratoIndisponivel(`${DOMINIO}.plano`, vazio, "banco não configurado");

  try {
    const [linhas, grupos] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT u.* FROM fin_categoria_uso_v u
           JOIN fin_category c ON c.id = u.id
           JOIN fin_entity e ON e.id = c.entity_id AND e.slug = $1
          WHERE ($2::boolean OR u.is_active)
          ORDER BY u.code`,
        [ENTIDADE, incluirInativas]
      ),
      query<Record<string, unknown>>(
        `SELECT slug, name, direction FROM fin_cash_flow_group WHERE is_active ORDER BY sort_order`
      )
    ]);

    const categorias: CategoriaPlano[] = linhas.map((l) => ({
      id: Number(l.id),
      code: String(l.code),
      nome: String(l.name),
      kind: String(l.kind),
      grupo: (l.cash_flow_group as string) ?? null,
      dreLine: (l.dre_line as string) ?? null,
      nucleoPadrao: (l.default_nucleo as string) ?? null,
      ativa: Boolean(l.is_active),
      sinalEsperado: sinalEsperadoDe(String(l.kind)),
      usoLancamento: Number(l.n_lancamento),
      usoDocumento: Number(l.n_documento),
      usoItemCartao: Number(l.n_item_cartao),
      usoVivo: Number(l.n_vivo),
      valorVivoCents: Number(l.valor_vivo_cents ?? 0),
      eventosTrilha: Number(l.n_eventos),
      regras: Number(l.n_regras),
      regrasCartao: Number(l.n_regras_cartao),
      contrapartes: Number(l.n_contrapartes),
      marcadorDeIndecisao: Boolean(l.marcador_de_indecisao),
      podeDesativar: Boolean(l.pode_desativar),
      motivoBloqueio: (l.motivo_bloqueio as string) ?? null
    }));

    const ociosas = categorias.filter((c) => c.ativa && c.usoVivo === 0 && !c.marcadorDeIndecisao);

    return contrato({
      dominio: `${DOMINIO}.plano`,
      dado: {
        categorias,
        gruposFluxo: grupos.map((g) => ({
          slug: String(g.slug),
          nome: String(g.name),
          direcao: String(g.direction)
        }))
      },
      ressalvas: [
        "3.99 e 5.99 NÃO são linhas do plano de contas: são marcadores de indecisão. " +
          "O banco recusa renomeá-las, reagrupá-las ou desativá-las — 3.99 vazia significa " +
          "zero receita indecisa, que é sucesso.",
        "`sinalEsperado` é derivado de `kind`, não é coluna. Quem o aplica é o gatilho " +
          "fin_transaction_sinal_da_categoria, que ANULA a categoria quando o sinal não bate.",
        ociosas.length
          ? `${ociosas.length} categoria(s) ativa(s) sem nenhum item vivo nos três universos — ` +
            `ociosa não é o mesmo que descartável; ver dúvida 56.`
          : null
      ].filter((r): r is string => r !== null)
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:categorizacao.plano]", mensagem);
    return contratoIndisponivel(`${DOMINIO}.plano`, vazio, mensagem);
  }
}
