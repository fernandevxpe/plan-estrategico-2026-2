import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  contrato,
  contratoIndisponivel,
  ENTIDADE,
  INICIO_ESCOPO,
  montarPagina,
  normalizarPaginacao,
  type Contrato,
  type Pagina,
  type Paginacao
} from "./base";

/**
 * As filas de decisão.
 *
 * INSTRUÇÃO QUE MUDA O DESENHO (Fernando, 16/08/2026):
 *
 *   "Tudo que precisa de intervenção humana vai ter que ter telas, notificações,
 *    UX ultrafacilitada."
 *
 * Isso reclassifica as views de indeterminado. `fin_a_classificar_v`,
 * `fin_indeterminado_v`, `fin_contraparte_documento_conflito_v`,
 * `erp_contrato_indeterminado_v` e `erp_parcela_nota_sugestao_v` NÃO são
 * relatório. São a caixa de entrada de decisões do dono, e o contrato delas
 * precisa entregar três coisas que um relatório nunca entrega:
 *
 *   1. A EVIDÊNCIA AO LADO DA ESCOLHA. Cada item chega com o que se sabe
 *      (descrição bruta, documento no extrato, contraparte, histórico) e com a
 *      sugestão do sistema mais o porquê dela. Decidir sem a evidência à vista
 *      é adivinhar, e adivinhar é o que este projeto proíbe.
 *
 *   2. DECISÃO EM LOTE. São 718 lançamentos a classificar, 801 revisões
 *      pendentes, 77 contratos indeterminados. Uma tela de um item por vez
 *      transforma isso em milhares de cliques — e o resultado previsível é que
 *      ninguém decide nada. Por isso todo item carrega `grupoChave`: itens com
 *      a mesma chave são a MESMA decisão repetida e devem ser resolvidos juntos.
 *
 *   3. QUEM DECIDIU. Toda decisão exige autor. Sem isso, seis meses depois
 *      ninguém sabe se aquele número foi apurado ou chutado.
 *
 * Este arquivo é a caixa de entrada unificada — o que falta, quanto vale, e
 * qual tela resolve. As telas específicas de qualificação e revisão já existem
 * (`lib/financeiro/qualificar.ts`, `revisao.ts`) e não são reimplementadas aqui.
 */

const DOMINIO = "decisoes";

export type SlugFila =
  | "classificar"
  | "indeterminado"
  | "revisao"
  | "documento_conflito"
  | "contrato_erp"
  | "parcela_nota"
  | "recorrente_proposta"
  | "orcamento_sem_mapa"
  | "pagamento_bloqueado";

export type ResumoFila = {
  slug: SlugFila;
  titulo: string;
  /** A pergunta que a tela faz, em português, para o cabeçalho. */
  pergunta: string;
  quantidade: number;
  /** Valor em jogo. Null quando a fila não é sobre dinheiro. */
  valorCents: number | null;
  /** Item mais antigo da fila — a idade é o melhor argumento de priorização. */
  maisAntigo: string | null;
  /** Quantos grupos distintos: é o número REAL de decisões a tomar. */
  decisoesDistintas: number | null;
  severidade: "bloqueante" | "alerta" | "informativo";
  rota: string;
  origem: string;
  /** Por que esta fila existe e o que acontece se ela ficar parada. */
  consequencia: string;
};

/**
 * A caixa de entrada.
 *
 * `quantidade` e `decisoesDistintas` são propositalmente diferentes: 718 itens
 * a classificar podem ser 60 decisões se agrupados por contraparte. A tela deve
 * mostrar as duas — a primeira é o tamanho do problema, a segunda é o tamanho
 * do trabalho.
 */
export async function getCaixaDeDecisoes(): Promise<Contrato<ResumoFila[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, [], "banco financeiro não configurado");

  try {
    const [
      classificar,
      indeterminado,
      revisao,
      conflito,
      contratoErp,
      parcelaNota,
      recorrente,
      orcamento
    ] = await Promise.all([
      query<{ n: string; cents: string; antigo: string | null; grupos: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(abs(amount_cents)),0)::text AS cents,
                to_char(MIN(posted_on),'YYYY-MM-DD') AS antigo,
                count(DISTINCT COALESCE(contraparte, counterparty_raw, description_raw))::text AS grupos
           FROM fin_a_classificar_v WHERE posted_on >= $1`,
        [INICIO_ESCOPO]
      ),
      query<{ n: string; cents: string; antigo: string | null; grupos: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(abs(amount_cents)),0)::text AS cents,
                to_char(MIN(posted_on),'YYYY-MM-DD') AS antigo,
                count(DISTINCT motivo)::text AS grupos
           FROM fin_indeterminado_v`
      ),
      query<{ n: string; cents: string; antigo: string | null; grupos: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(abs(COALESCE(ri.amount_cents,0))),0)::text AS cents,
                to_char(MIN(ri.created_at),'YYYY-MM-DD') AS antigo,
                count(DISTINCT ri.reason)::text AS grupos
           FROM fin_review_item ri JOIN fin_entity e ON e.id = ri.entity_id
          WHERE e.slug = $1 AND ri.status = 'pendente'`,
        [ENTIDADE]
      ),
      query<{ n: string; cents: string; antigo: string | null }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(volume_cents),0)::text AS cents,
                to_char(MIN(de),'YYYY-MM-DD') AS antigo
           FROM fin_contraparte_documento_conflito_v`
      ),
      query<{ n: string; cents: string; grupos: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(valor_cents),0)::text AS cents,
                count(DISTINCT assunto)::text AS grupos
           FROM erp_contrato_indeterminado_v`
      ),
      query<{ n: string; cents: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(valor_cents),0)::text AS cents
           FROM erp_parcela_nota_sugestao_v`
      ),
      query<{ n: string; cents: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(amount_cents),0)::text AS cents
           FROM fin_recurring WHERE status = 'proposto'`
      ),
      query<{ n: string; cents: string }>(
        `SELECT count(*)::text AS n, COALESCE(SUM(valor_cents),0)::text AS cents
           FROM fin_budget_target WHERE mapeamento = 'indeterminado'`
      )
    ]);

    const pagamento = await filaDePagamentoBloqueado();

    const filas: ResumoFila[] = [
      {
        slug: "classificar",
        titulo: "Lançamentos a classificar",
        pergunta: "De que serviço, ou de que despesa, é este dinheiro?",
        quantidade: Number(classificar[0]?.n ?? 0),
        valorCents: Number(classificar[0]?.cents ?? 0),
        maisAntigo: classificar[0]?.antigo ?? null,
        decisoesDistintas: Number(classificar[0]?.grupos ?? 0),
        severidade: "bloqueante",
        rota: "/financeiro/qualificar",
        origem: "fin_a_classificar_v",
        consequencia:
          "Enquanto ficam aqui, esses valores entram na DRE em '5.99/3.99 a classificar' — parecem categorizados e não são."
      },
      {
        slug: "indeterminado",
        titulo: "Marcados como indeterminados",
        pergunta: "Duas leituras são possíveis e não há evidência que separe. Qual é?",
        quantidade: Number(indeterminado[0]?.n ?? 0),
        valorCents: Number(indeterminado[0]?.cents ?? 0),
        maisAntigo: indeterminado[0]?.antigo ?? null,
        decisoesDistintas: Number(indeterminado[0]?.grupos ?? 0),
        severidade: "alerta",
        rota: "/financeiro/qualificar?fila=indeterminado",
        origem: "fin_indeterminado_v",
        consequencia:
          "São os casos em que o sistema se recusou a chutar. Ficar aqui é correto; ficar para sempre é dívida."
      },
      {
        slug: "revisao",
        titulo: "Fila de revisão",
        pergunta: "A classificação automática está certa?",
        quantidade: Number(revisao[0]?.n ?? 0),
        valorCents: Number(revisao[0]?.cents ?? 0),
        maisAntigo: revisao[0]?.antigo ?? null,
        decisoesDistintas: Number(revisao[0]?.grupos ?? 0),
        severidade: "alerta",
        rota: "/financeiro/revisao",
        origem: "fin_review_item",
        consequencia: "Uma regra errada confirmada uma vez passa a valer para tudo que ela tocar no futuro."
      },
      {
        slug: "documento_conflito",
        titulo: "Documento da contraparte em conflito",
        pergunta: "O CNPJ do extrato não é o cadastrado. Qual vale?",
        quantidade: Number(conflito[0]?.n ?? 0),
        valorCents: Number(conflito[0]?.cents ?? 0),
        maisAntigo: conflito[0]?.antigo ?? null,
        decisoesDistintas: Number(conflito[0]?.n ?? 0),
        severidade: "bloqueante",
        rota: "/financeiro/qualificar?fila=documento",
        origem: "fin_contraparte_documento_conflito_v",
        consequencia:
          "Documento errado no cadastro do favorecido é o vetor mais barato de pagamento para a conta errada."
      },
      {
        slug: "contrato_erp",
        titulo: "Contratos do ERP indeterminados",
        pergunta: "Este contrato é de qual eixo, cliente ou serviço?",
        quantidade: Number(contratoErp[0]?.n ?? 0),
        valorCents: Number(contratoErp[0]?.cents ?? 0),
        maisAntigo: null,
        decisoesDistintas: Number(contratoErp[0]?.grupos ?? 0),
        severidade: "alerta",
        rota: "/financeiro/contratos?fila=indeterminado",
        origem: "erp_contrato_indeterminado_v",
        consequencia: "Sem resolver, a receita por tipo de serviço e a margem por obra ficam incompletas."
      },
      {
        slug: "parcela_nota",
        titulo: "Parcela sem nota casada",
        pergunta: "Esta nota é desta parcela?",
        quantidade: Number(parcelaNota[0]?.n ?? 0),
        valorCents: Number(parcelaNota[0]?.cents ?? 0),
        maisAntigo: null,
        decisoesDistintas: Number(parcelaNota[0]?.n ?? 0),
        severidade: "informativo",
        rota: "/financeiro/contratos?fila=nota",
        origem: "erp_parcela_nota_sugestao_v",
        consequencia: "Afeta a apuração tributária: receita no ledger sem nota emitida aparece como divergência."
      },
      {
        slug: "recorrente_proposta",
        titulo: "Recorrentes propostas pelo detector",
        pergunta: "Isto se repete todo mês de propósito?",
        quantidade: Number(recorrente[0]?.n ?? 0),
        valorCents: Number(recorrente[0]?.cents ?? 0),
        maisAntigo: null,
        decisoesDistintas: Number(recorrente[0]?.n ?? 0),
        severidade: "informativo",
        rota: "/financeiro/recorrentes",
        origem: "fin_recurring",
        consequencia:
          "Confirmar melhora a previsão de caixa e desliga o falso alarme de duplicidade na fila de pagamento."
      },
      {
        slug: "orcamento_sem_mapa",
        titulo: "Metas de orçamento sem linha do modelo",
        pergunta: "Esta meta do ERP corresponde a qual linha da DRE?",
        quantidade: Number(orcamento[0]?.n ?? 0),
        valorCents: Number(orcamento[0]?.cents ?? 0),
        maisAntigo: null,
        decisoesDistintas: Number(orcamento[0]?.n ?? 0),
        severidade: "alerta",
        rota: "/financeiro/planejamento?fila=orcamento",
        origem: "fin_budget_target",
        consequencia: "Meta sem endereço não entra em orçado × realizado — a comparação sai incompleta em silêncio."
      }
    ];

    if (pagamento) filas.push(pagamento);

    return contrato({
      dominio: DOMINIO,
      dado: filas.filter((f) => f.quantidade > 0),
      pendencias: filas
        .filter((f) => f.quantidade > 0)
        .map((f) => ({
          chave: f.slug,
          titulo: f.titulo,
          quantidade: f.quantidade,
          valorCents: f.valorCents,
          severidade: f.severidade,
          telaDeDecisao: f.rota
        })),
      ressalvas: [
        "quantidade é o tamanho do problema; decisoesDistintas é o tamanho do trabalho. Agrupar é o que torna a fila resolvível.",
        "A fila de classificação está recortada em 2026 — o histórico anterior é pendência por decisão do Fernando, não por dívida."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:decisoes]", mensagem);
    return contratoIndisponivel(DOMINIO, [], mensagem);
  }
}

/** A fila de pagamento só entra na caixa se a 0075 estiver aplicada. */
async function filaDePagamentoBloqueado(): Promise<ResumoFila | null> {
  try {
    const [linha] = await query<{ n: string; grupos: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT pendencia)::text AS grupos
         FROM fin_pagamento_pendencia_v WHERE severidade = 'bloqueante'`
    );
    return {
      slug: "pagamento_bloqueado",
      titulo: "Pagamentos travados na fila",
      pergunta: "O que falta para este pagamento poder ser aprovado?",
      quantidade: Number(linha?.n ?? 0),
      valorCents: null,
      maisAntigo: null,
      decisoesDistintas: Number(linha?.grupos ?? 0),
      severidade: "bloqueante",
      rota: "/financeiro/pagamentos?apenasBloqueados=1",
      origem: "fin_pagamento_pendencia_v",
      consequencia: "Pagamento travado vira atraso com fornecedor, e atraso vira negociação pior no mês seguinte."
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Um item de decisão, com evidência
// ---------------------------------------------------------------------------

/**
 * Uma evidência é um par rótulo/valor com PROCEDÊNCIA.
 *
 * "CNPJ 34.776.108/0001-92" não vale nada sozinho; "CNPJ que veio no
 * `cpfCnpjRecebedor` do extrato do Inter" vale a decisão. A procedência é o que
 * separa evidência de opinião.
 */
export type Evidencia = {
  rotulo: string;
  valor: string;
  procedencia: string;
  /** Peso relativo para a tela ordenar o que mostra primeiro. */
  forca: "forte" | "media" | "fraca";
};

export type OpcaoDeDecisao = {
  valor: string;
  rotulo: string;
  /** Quantos itens do grupo esta opção resolveria. */
  alcance: number | null;
  /** Verdadeiro na opção que o sistema sugere. Nunca mais de uma. */
  sugerida: boolean;
  /** Por que esta é a sugestão. Sugestão sem porquê é chute com autoridade. */
  porque: string | null;
};

export type ItemDecisao = {
  id: number;
  /** Tabela de origem, para a decisão saber onde escrever. */
  alvo: string;
  titulo: string;
  subtitulo: string | null;
  data: string | null;
  valorCents: number | null;
  evidencias: Evidencia[];
  opcoes: OpcaoDeDecisao[];
  /**
   * Itens com a mesma chave são a MESMA decisão repetida.
   * É o que permite "aplicar a todos os 34 iguais" com um clique.
   */
  grupoChave: string;
  grupoTamanho: number;
};

export type FiltrosDecisao = {
  grupo?: string;
  de?: string;
  ate?: string;
  valorMinCents?: number;
  busca?: string;
};

const PAGINA_DECISAO_VAZIA: Pagina<ItemDecisao> = {
  itens: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  paginas: 1,
  temMais: false,
  ordenacao: { campo: "valor", direcao: "desc" },
  vazio: { causa: "sem_dado_na_fonte", motivo: "fila vazia", acao: null }
};

/**
 * Os itens de uma fila, prontos para a tela de decisão.
 *
 * A ordenação padrão é por VALOR, não por data: com 718 itens, resolver os 20
 * maiores move o indicador mais do que resolver os 200 mais antigos.
 */
export async function getItensDaFila(
  slug: SlugFila,
  filtros: FiltrosDecisao = {},
  paginacao: Paginacao = {}
): Promise<Contrato<Pagina<ItemDecisao>>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(`${DOMINIO}.${slug}`, PAGINA_DECISAO_VAZIA, "banco financeiro não configurado");
  }
  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);

  try {
    switch (slug) {
      case "classificar":
        return await itensClassificar(filtros, pagina, porPagina, offset);
      case "indeterminado":
        return await itensIndeterminado(filtros, pagina, porPagina, offset);
      case "documento_conflito":
        return await itensConflitoDocumento(pagina, porPagina, offset);
      case "contrato_erp":
        return await itensContratoErp(filtros, pagina, porPagina, offset);
      default:
        return contratoIndisponivel(
          `${DOMINIO}.${slug}`,
          PAGINA_DECISAO_VAZIA,
          `a fila '${slug}' tem tela própria; use a rota declarada em getCaixaDeDecisoes()`
        );
    }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error(`[contrato:decisoes.${slug}]`, mensagem);
    return contratoIndisponivel(`${DOMINIO}.${slug}`, PAGINA_DECISAO_VAZIA, mensagem);
  }
}

async function itensClassificar(
  filtros: FiltrosDecisao,
  pagina: number,
  porPagina: number,
  offset: number
): Promise<Contrato<Pagina<ItemDecisao>>> {
  const params: unknown[] = [filtros.de ?? INICIO_ESCOPO];
  const where = ["v.posted_on >= $1"];
  if (filtros.ate) {
    params.push(filtros.ate);
    where.push(`v.posted_on <= $${params.length}`);
  }
  if (filtros.grupo) {
    params.push(filtros.grupo);
    where.push(`COALESCE(v.contraparte, v.counterparty_raw, v.description_raw) = $${params.length}`);
  }
  if (filtros.valorMinCents) {
    params.push(filtros.valorMinCents);
    where.push(`abs(v.amount_cents) >= $${params.length}`);
  }
  if (filtros.busca) {
    params.push(filtros.busca);
    where.push(`v.description_raw ILIKE '%' || $${params.length} || '%'`);
  }
  params.push(porPagina, offset);

  const linhas = await query<{
    id: number;
    posted_on: string;
    conta: string;
    amount_cents: string;
    description_raw: string;
    counterparty_raw: string | null;
    counterparty_document: string | null;
    contraparte: string | null;
    source_kind: string | null;
    natureza: string;
    categoria_atual: string;
    grupo: string;
    grupo_tamanho: string;
    total_linhas: string;
  }>(
    `SELECT v.*,
            COALESCE(v.contraparte, v.counterparty_raw, v.description_raw) AS grupo,
            count(*) OVER (PARTITION BY COALESCE(v.contraparte, v.counterparty_raw, v.description_raw))::text AS grupo_tamanho,
            count(*) OVER ()::text AS total_linhas
       FROM fin_a_classificar_v v
      WHERE ${where.join(" AND ")}
      ORDER BY abs(v.amount_cents) DESC, v.posted_on DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = linhas.length ? Number(linhas[0].total_linhas) : 0;

  // A sugestão vem da categoria padrão da contraparte, quando existe. Buscada
  // em uma consulta só para as contrapartes desta página — N+1 aqui seriam 50
  // idas ao banco por rolagem de tela.
  const nomes = [...new Set(linhas.map((l) => l.contraparte).filter(Boolean))] as string[];
  const sugestoes = nomes.length
    ? await query<{ nome: string; code: string; categoria: string }>(
        `SELECT cp.name AS nome, c.code, c.name AS categoria
           FROM fin_counterparty cp JOIN fin_category c ON c.id = cp.default_category_id
          WHERE cp.name = ANY($1)`,
        [nomes]
      )
    : [];
  const porNome = new Map(sugestoes.map((s) => [s.nome, s]));

  const itens: ItemDecisao[] = linhas.map((l) => {
    const sugestao = l.contraparte ? porNome.get(l.contraparte) : undefined;
    const evidencias: Evidencia[] = [
      { rotulo: "Descrição no extrato", valor: l.description_raw, procedencia: `extrato ${l.conta}`, forca: "forte" }
    ];
    if (l.counterparty_document) {
      evidencias.push({
        rotulo: "Documento no extrato",
        valor: l.counterparty_document,
        procedencia: "lastro do PIX/TED",
        forca: "forte"
      });
    }
    if (l.counterparty_raw) {
      evidencias.push({ rotulo: "Nome bruto", valor: l.counterparty_raw, procedencia: "extrato", forca: "media" });
    }
    if (l.contraparte) {
      evidencias.push({ rotulo: "Contraparte identificada", valor: l.contraparte, procedencia: "fin_counterparty", forca: "forte" });
    }
    evidencias.push({ rotulo: "Categoria atual", valor: l.categoria_atual, procedencia: "ledger", forca: "fraca" });

    return {
      id: l.id,
      alvo: "fin_transaction",
      titulo: l.description_raw,
      subtitulo: `${l.natureza} · ${l.conta}`,
      data: String(l.posted_on).slice(0, 10),
      valorCents: Number(l.amount_cents),
      evidencias,
      opcoes: sugestao
        ? [
            {
              valor: sugestao.code,
              rotulo: `${sugestao.code} — ${sugestao.categoria}`,
              alcance: Number(l.grupo_tamanho),
              sugerida: true,
              porque: `é a categoria padrão cadastrada para ${l.contraparte}`
            }
          ]
        : [],
      grupoChave: l.grupo,
      grupoTamanho: Number(l.grupo_tamanho)
    };
  });

  return contrato({
    dominio: `${DOMINIO}.classificar`,
    dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "valor", direcao: "desc" } }),
    ressalvas: [
      "Ordenado por valor: resolver os 20 maiores move o indicador mais que resolver os 200 mais antigos.",
      "Item sem opção sugerida é item sem evidência suficiente — nesses, escolher no lugar do humano seria chute."
    ]
  });
}

async function itensIndeterminado(
  filtros: FiltrosDecisao,
  pagina: number,
  porPagina: number,
  offset: number
): Promise<Contrato<Pagina<ItemDecisao>>> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filtros.grupo) {
    params.push(filtros.grupo);
    where.push(`v.motivo = $${params.length}`);
  }
  params.push(porPagina, offset);

  const linhas = await query<{
    id: number;
    posted_on: string;
    conta: string;
    amount_cents: string;
    description_raw: string;
    contraparte: string | null;
    counterparty_document: string | null;
    categoria_atual: string;
    motivo: string;
    grupo_tamanho: string;
    total_linhas: string;
  }>(
    `SELECT v.*, count(*) OVER (PARTITION BY v.motivo)::text AS grupo_tamanho,
            count(*) OVER ()::text AS total_linhas
       FROM fin_indeterminado_v v
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY abs(v.amount_cents) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
  const itens: ItemDecisao[] = linhas.map((l) => ({
    id: l.id,
    alvo: "fin_transaction",
    titulo: l.description_raw,
    subtitulo: PERGUNTA_INDETERMINADO[l.motivo] ?? l.motivo,
    data: String(l.posted_on).slice(0, 10),
    valorCents: Number(l.amount_cents),
    evidencias: [
      { rotulo: "Motivo declarado", valor: l.motivo, procedencia: "tag do ledger", forca: "forte" },
      { rotulo: "Descrição", valor: l.description_raw, procedencia: `extrato ${l.conta}`, forca: "media" },
      ...(l.contraparte
        ? [{ rotulo: "Contraparte", valor: l.contraparte, procedencia: "fin_counterparty", forca: "media" as const }]
        : []),
      ...(l.counterparty_document
        ? [{ rotulo: "Documento", valor: l.counterparty_document, procedencia: "lastro do extrato", forca: "forte" as const }]
        : []),
      { rotulo: "Categoria atual", valor: l.categoria_atual, procedencia: "ledger", forca: "fraca" }
    ],
    opcoes: [],
    grupoChave: l.motivo,
    grupoTamanho: Number(l.grupo_tamanho)
  }));

  return contrato({
    dominio: `${DOMINIO}.indeterminado`,
    dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "valor", direcao: "desc" } }),
    ressalvas: [
      "Estes itens não têm sugestão de propósito: o sistema já examinou e concluiu que a evidência não separa as leituras.",
      "Resolver aqui exige memória de quem estava lá, não mais processamento."
    ]
  });
}

const PERGUNTA_INDETERMINADO: Record<string, string> = {
  "indeterminado:duas-leituras-possiveis": "Duas classificações são possíveis e a evidência não separa",
  "indeterminado:contraparte-sem-historico": "Contraparte nova, sem histórico que sustente a categoria",
  "indeterminado:servico-nao-declarado": "Receita entrou sem dizer de que serviço veio",
  "indeterminado:fatura-sem-itemizacao": "Fatura de cartão sem itens — a fonte não detalha",
  "indeterminado:sem-lastro-nem-contraparte": "Sem lastro e sem contraparte: não há do que partir"
};

async function itensConflitoDocumento(
  pagina: number,
  porPagina: number,
  offset: number
): Promise<Contrato<Pagina<ItemDecisao>>> {
  const linhas = await query<{
    counterparty_id: number;
    nome_cadastrado: string;
    documento_cadastrado: string | null;
    documento_no_extrato: string | null;
    lancamentos: string;
    volume_cents: string;
    de: string;
    ate: string;
    texto_no_extrato: string | null;
    total_linhas: string;
  }>(
    `SELECT v.*, count(*) OVER ()::text AS total_linhas
       FROM fin_contraparte_documento_conflito_v v
      ORDER BY v.volume_cents DESC
      LIMIT $1 OFFSET $2`,
    [porPagina, offset]
  );

  const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
  const itens: ItemDecisao[] = linhas.map((l) => ({
    id: l.counterparty_id,
    alvo: "fin_counterparty",
    titulo: l.nome_cadastrado,
    subtitulo: `${l.lancamentos} lançamento(s) entre ${String(l.de).slice(0, 10)} e ${String(l.ate).slice(0, 10)}`,
    data: String(l.ate).slice(0, 10),
    valorCents: Number(l.volume_cents),
    evidencias: [
      {
        rotulo: "Documento cadastrado",
        valor: l.documento_cadastrado ?? "(vazio)",
        procedencia: "fin_counterparty",
        forca: "media"
      },
      {
        rotulo: "Documento no extrato",
        valor: l.documento_no_extrato ?? "(vazio)",
        procedencia: "lastro do banco (Inter/Polp)",
        forca: "forte"
      },
      ...(l.texto_no_extrato
        ? [{ rotulo: "Texto no extrato", valor: l.texto_no_extrato, procedencia: "extrato", forca: "media" as const }]
        : [])
    ],
    // As duas opções são mutuamente exclusivas e ambas explícitas. Não existe
    // "deixar como está": o conflito é sobre para onde o dinheiro vai.
    opcoes: [
      {
        valor: `manter:${l.documento_cadastrado ?? ""}`,
        rotulo: `Manter ${l.documento_cadastrado ?? "(vazio)"}`,
        alcance: 1,
        sugerida: false,
        porque: null
      },
      {
        valor: `adotar:${l.documento_no_extrato ?? ""}`,
        rotulo: `Adotar ${l.documento_no_extrato ?? "(vazio)"} (do extrato)`,
        alcance: 1,
        sugerida: true,
        porque: "o documento do extrato veio do banco, não de digitação"
      }
    ],
    grupoChave: "documento_conflito",
    grupoTamanho: total
  }));

  return contrato({
    dominio: `${DOMINIO}.documento_conflito`,
    dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "valor", direcao: "desc" } }),
    ressalvas: [
      "Documento errado no cadastro do favorecido é o vetor mais barato de pagamento para a conta errada — esta fila é pequena e cara."
    ]
  });
}

async function itensContratoErp(
  filtros: FiltrosDecisao,
  pagina: number,
  porPagina: number,
  offset: number
): Promise<Contrato<Pagina<ItemDecisao>>> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filtros.grupo) {
    params.push(filtros.grupo);
    where.push(`v.assunto = $${params.length}`);
  }
  params.push(porPagina, offset);

  const linhas = await query<{
    assunto: string;
    contrato_erp_id: number;
    referencia: string;
    motivo: string;
    valor_cents: string;
    pergunta: string;
    grupo_tamanho: string;
    total_linhas: string;
  }>(
    `SELECT v.*, count(*) OVER (PARTITION BY v.assunto)::text AS grupo_tamanho,
            count(*) OVER ()::text AS total_linhas
       FROM erp_contrato_indeterminado_v v
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY v.valor_cents DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
  const itens: ItemDecisao[] = linhas.map((l) => ({
    id: l.contrato_erp_id,
    alvo: "erp_contrato",
    titulo: l.referencia,
    subtitulo: l.pergunta,
    data: null,
    valorCents: l.valor_cents === null ? null : Number(l.valor_cents),
    evidencias: [
      { rotulo: "Assunto", valor: l.assunto, procedencia: "erp_contrato_indeterminado_v", forca: "forte" },
      { rotulo: "Motivo", valor: l.motivo, procedencia: "erp-obras (somente leitura)", forca: "forte" }
    ],
    opcoes: [],
    grupoChave: l.assunto,
    grupoTamanho: Number(l.grupo_tamanho)
  }));

  return contrato({
    dominio: `${DOMINIO}.contrato_erp`,
    dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "valor", direcao: "desc" } }),
    ressalvas: [
      "O erp-obras é somente leitura: a decisão é gravada NESTE ledger, nunca lá.",
      "ticket_multisservico é a maior fatia e depende de rateio declarado — não há dado que decida sozinho."
    ]
  });
}

// ---------------------------------------------------------------------------
// Payload de decisão
// ---------------------------------------------------------------------------

/**
 * O que a tela envia ao decidir.
 *
 * Três propriedades não negociáveis, cada uma respondendo a um erro conhecido
 * deste projeto:
 *
 *   `ids[]`        — decisão é em lote por padrão (718 itens não se resolvem um
 *                    a um);
 *   `decididoPor`  — obrigatório, porque seis meses depois "quem decidiu isso?"
 *                    é a primeira pergunta;
 *   `viraRegra`    — a decisão pode virar regra para o futuro, mas isso é
 *                    ESCOLHA EXPLÍCITA. Uma decisão pontual que vira regra sem
 *                    ninguém pedir reescreve silenciosamente a classificação de
 *                    tudo que a regra tocar (é a dívida que a B6 documenta).
 */
export type DecisaoDeFila = {
  fila: SlugFila;
  ids: number[];
  escolha: string;
  motivo?: string;
  decididoPor: string;
  viraRegra: boolean;
  /** Quando `viraRegra`, o escopo em que ela passa a valer. */
  escopoDaRegra?: { contraparteId?: number; textoContem?: string; contaSlug?: string };
};

export type ResultadoDecisao = {
  aplicados: number;
  ignorados: { id: number; motivo: string }[];
  regraCriada: { id: number; slug: string } | null;
  auditoriaBatchId: string | null;
};
