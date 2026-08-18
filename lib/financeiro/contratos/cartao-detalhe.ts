import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";

/**
 * O detalhamento de cartão — o cartão dentro da saída de caixa, e o caminho
 * inteiro até o item.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE ESTE CONTRATO EXISTE PARA PROTEGER
 * ---------------------------------------------------------------------------
 * FATURA E ITEM SÃO O MESMO DINHEIRO VISTO DE DOIS LUGARES. NÃO SE SOMAM.
 *
 *   a FATURA é o que saiu do caixa .......... `fin_transaction`, uma por mês
 *   os ITENS são a composição dela .......... `fin_card_transaction`, 781 linhas
 *
 * Medido no acervo em 18/08/2026: competência R$ 84.058,09, caixa R$ 107.600,75.
 * Somar dá R$ 191.658,84 — R$ 61.550,10 a mais do que tudo o que os emissores
 * já cobraram desde 2025. Por isso as duas medidas **nunca compartilham campo,
 * nem série, nem eixo de gráfico** neste contrato: `competencia` e `caixa` são
 * objetos separados, e `prova` traz os dois lado a lado com a frase que diz por
 * que a soma não existe.
 *
 * ---------------------------------------------------------------------------
 * A ÂNCORA DO CAIXA É O PONTEIRO, NUNCA A CATEGORIA
 * ---------------------------------------------------------------------------
 * `getCartao()` mede o caixa do cartão por `c.code = '9.01'`. Os 9 pagamentos de
 * fatura do Inter — R$ 40.862,41, 38% do que sai — têm `category_id` NULO,
 * porque o gatilho `fin_transaction_fatura_sem_itemizacao` (0094) os barrou até
 * existir `fin_card_bill` ligada. Hoje a ligação existe; o carimbo continua
 * sendo decisão humana. Medir por rótulo, portanto, esconde mais de um terço.
 *
 * A âncora certa é `fin_card_bill.paid_transaction_id` — o ponteiro que já é o
 * ÚNICO ponto de contato entre o subledger do cartão e o ledger.
 *
 * ---------------------------------------------------------------------------
 * A ÁRVORE VEM PRONTA DO BANCO
 * ---------------------------------------------------------------------------
 * `fin_card_arvore_v` (0114) é a única definição de "cada nível soma o de cima".
 * Refazer a agregação aqui criaria uma segunda, e as duas divergiriam na
 * primeira fatura que nascesse sem itens. A tela recebe nós com `chave`/`paiKey`
 * e monta a hierarquia por ponteiro — sem recalcular um centavo.
 *
 * Os ~780 nós de item NÃO viajam na carga inicial: eles chegam por
 * `getFilhosDoCartao(chave)` quando alguém abre um subcartão. A hierarquia
 * inteira sem os itens são ~140 nós.
 */

const DOMINIO = "cartao-detalhe";

/** As views que a 0114 cria. Sem elas o contrato degrada dizendo o que falta. */
const VIEWS = [
  "fin_card_arvore_v",
  "fin_card_item_v",
  "fin_card_saida_caixa_v",
  "fin_card_serie_mensal_v",
  "fin_card_caixa_mensal_v",
  "fin_card_plano_parcela_v",
  "fin_card_prova_nao_soma_v"
] as const;

export type NivelArvore = "emissor" | "linha" | "fatura" | "subcartao" | "nao_itemizado" | "item";

export type NoArvore = {
  nivel: NivelArvore;
  profundidade: number;
  chave: string;
  paiKey: string | null;
  /** Identidade, não rótulo: o recorte da tela casa por slug, nunca por texto. */
  emissorSlug: string | null;
  linhaSlug: string | null;
  rotulo: string;
  detalhe: string | null;
  valorCents: number;
  itemizadoCents: number;
  naoItemizadoCents: number;
  itens: number | null;
  /** Obrigatório quando o nó representa algo que a fonte não explica. */
  motivo: string | null;
};

/** Uma saída de caixa que pagou fatura. É a linha que aparece no extrato. */
export type SaidaDeCaixa = {
  transactionId: number;
  conta: string;
  postedOn: string;
  saiuCents: number;
  descricao: string | null;
  categoriaCode: string | null;
  categoria: string | null;
  categoriaMotivo: string | null;
  emissor: string;
  emissorSlug: string;
  linhaSlug: string;
  billId: number;
  origemFatura: string;
  mesReferencia: string | null;
  vencimento: string | null;
  faturaCents: number;
  itemizadoCents: number;
  naoItemizadoCents: number;
  pctExplicado: number | null;
  /** Quando o pago diverge do declarado. Zero é uma afirmação; a diferença tem nome. */
  diferencaCents: number;
  ressalva: string | null;
};

export type PontoCompetencia = {
  mes: string;
  emissorSlug: string;
  linhaSlug: string;
  cardId: number | null;
  last4: string | null;
  titular: string | null;
  faixa: "item" | "nao_itemizado";
  itens: number;
  valorCents: number;
  comCategoriaCents: number;
  itensSemCategoria: number;
  motivo: string | null;
};

export type PontoCaixa = {
  mes: string;
  emissorSlug: string;
  linhaSlug: string;
  conta: string;
  pagamentos: number;
  saiuCents: number;
  faturaDeclaradaCents: number;
  pagamentosSemCategoria: number;
};

/** Competência e caixa lado a lado — em campos separados, de propósito. */
export type LinhaProva = {
  mes: string;
  emissorSlug: string;
  linhaSlug: string;
  competenciaItensCents: number;
  competenciaNaoItemizadoCents: number;
  itens: number;
  caixaSaiuCents: number | null;
  caixaPagamentos: number | null;
  caixaConta: string | null;
  porqueNaoSoma: string;
};

export type Parcela = {
  itemId: number | null;
  numero: number | null;
  last4: string | null;
  postedOn: string | null;
  competenciaMes: string | null;
  billId: number | null;
  valorCents: number;
  futura: boolean;
};

export type PlanoParcelado = {
  planoId: number;
  emissorSlug: string;
  linhaSlug: string;
  rotulo: string;
  compraEm: string | null;
  parcelasTotal: number;
  parcelasFaturadas: number;
  parcelasAbertas: number;
  valorParcelaCents: number | null;
  totalCents: number | null;
  totalEstimado: boolean;
  primeiroMes: string | null;
  ultimoMes: string | null;
  status: string;
  finais: string | null;
  atravessaReemissao: boolean;
  reemissaoDeclarada: boolean;
  reemissaoMotivo: string | null;
  categoriaCode: string | null;
  categoria: string | null;
  categoriaMotivo: string | null;
  parcelas: Parcela[];
};

export type LacunaCartao = {
  lacuna: string;
  escopo: string;
  itens: number;
  valorCents: number;
  motivo: string;
};

export type Cobertura = {
  itens: number;
  semCategoria: number;
  semCategoriaCents: number;
  semTitular: number;
  semTitularCents: number;
  semCentroCusto: number;
  subcartoesSemTitular: number;
};

export type CartaoDetalhe = {
  arvore: NoArvore[];
  saidas: SaidaDeCaixa[];
  competencia: PontoCompetencia[];
  caixa: PontoCaixa[];
  prova: LinhaProva[];
  planos: PlanoParcelado[];
  lacunas: LacunaCartao[];
  cobertura: Cobertura;
  /** Comprometido nos meses à frente. Competência, não caixa. */
  comprometidoFuturoCents: number;
  comprometidoFuturoLinhas: number;
};

const VAZIO: CartaoDetalhe = {
  arvore: [],
  saidas: [],
  competencia: [],
  caixa: [],
  prova: [],
  planos: [],
  lacunas: [],
  cobertura: {
    itens: 0,
    semCategoria: 0,
    semCategoriaCents: 0,
    semTitular: 0,
    semTitularCents: 0,
    semCentroCusto: 0,
    subcartoesSemTitular: 0
  },
  comprometidoFuturoCents: 0,
  comprometidoFuturoLinhas: 0
};

const n = (v: unknown): number => Number(v ?? 0);
const nOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dia = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

/**
 * Quais views da 0114 faltam neste banco.
 *
 * Uma tela que consulta view inexistente estoura com "relation does not exist",
 * que para quem olha é indistinguível de banco fora do ar. Perguntar antes
 * custa uma consulta e permite dizer exatamente o que falta.
 */
async function viewsAusentes(): Promise<string[]> {
  const linhas = await query<{ nome: string }>(
    `SELECT v.nome FROM unnest($1::text[]) AS v(nome) WHERE to_regclass(v.nome) IS NULL`,
    [[...VIEWS]]
  );
  return linhas.map((l) => l.nome);
}

export async function getCartaoDetalhe(): Promise<Contrato<CartaoDetalhe>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");
  }

  try {
    const faltando = await viewsAusentes();
    if (faltando.length) {
      return contratoIndisponivel(
        DOMINIO,
        VAZIO,
        `a migration 0114_fin_cartao_detalhe.sql ainda não está aplicada neste ambiente ` +
          `(faltam: ${faltando.join(", ")}). O modelo de cartão existe e está conferido — ` +
          `o que falta é a camada de leitura que esta tela consome.`
      );
    }

    const [arvore, saidas, competencia, caixa, prova, planoLinhas, lacunas, cob, futuro] =
      await Promise.all([
        // Sem o nível `item`: ~140 nós contra ~920. Os itens chegam por
        // getFilhosDoCartao quando alguém abre o subcartão.
        query<Record<string, unknown>>(
          `SELECT a.* FROM fin_card_arvore_v a
             JOIN fin_entity e ON e.id = a.entity_id
            WHERE e.slug = $1 AND a.nivel <> 'item'
            ORDER BY a.profundidade, a.ordem`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT s.* FROM fin_card_saida_caixa_v s
             JOIN fin_entity e ON e.id = s.entity_id
            WHERE e.slug = $1 ORDER BY s.posted_on DESC, s.transaction_id DESC`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT c.* FROM fin_card_serie_mensal_v c
             JOIN fin_entity e ON e.id = c.entity_id
            WHERE e.slug = $1 ORDER BY c.mes, c.linha_slug, c.last4 NULLS LAST`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT k.* FROM fin_card_caixa_mensal_v k
             JOIN fin_entity e ON e.id = k.entity_id
            WHERE e.slug = $1 ORDER BY k.mes, k.linha_slug`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT p.* FROM fin_card_prova_nao_soma_v p
             JOIN fin_entity e ON e.id = p.entity_id
            WHERE e.slug = $1 ORDER BY p.mes, p.linha_slug`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT p.* FROM fin_card_plano_parcela_v p
             JOIN fin_entity e ON e.id = p.entity_id
            WHERE e.slug = $1
            ORDER BY p.purchase_date DESC, p.plano_id, p.installment_number NULLS LAST`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT l.* FROM fin_card_lacuna_v l
             JOIN fin_entity e ON e.id = l.entity_id
            WHERE e.slug = $1 AND l.itens > 0 ORDER BY l.valor_cents DESC`,
          [ENTIDADE]
        ),
        query<Record<string, unknown>>(
          `SELECT count(*)::int                                                     AS itens,
                  count(*) FILTER (WHERE i.category_id IS NULL)::int                AS sem_categoria,
                  COALESCE(sum(i.amount_cents) FILTER (WHERE i.category_id IS NULL), 0)::bigint AS sem_categoria_cents,
                  count(*) FILTER (WHERE i.titular IS NULL)::int                    AS sem_titular,
                  COALESCE(sum(i.amount_cents) FILTER (WHERE i.titular IS NULL), 0)::bigint     AS sem_titular_cents,
                  count(*) FILTER (WHERE i.cost_center_id IS NULL)::int             AS sem_centro_custo,
                  (SELECT count(*)::int FROM fin_card c WHERE c.holder_person_id IS NULL) AS subcartoes_sem_titular
             FROM fin_card_item_v i
             JOIN fin_entity e ON e.id = i.entity_id
            WHERE e.slug = $1`,
          [ENTIDADE]
        ),
        // Comprometido à frente: COMPETÊNCIA. Não é caixa, e não entra em
        // nenhum total de caixa desta tela.
        query<{ total: string; linhas: string }>(
          `SELECT COALESCE(sum(amount_cents), 0)::text AS total, count(*)::text AS linhas
             FROM fin_card_compromisso_mensal_v
            WHERE competence_month > date_trunc('month', CURRENT_DATE)`
        )
      ]);

    // Os planos vêm como uma linha por parcela; a tela quer um objeto por plano.
    // A dobra acontece aqui e não no SQL para que a view continue tendo uma
    // definição só — e para que `atravessa_reemissao` não precise ser recontado.
    const porPlano = new Map<number, PlanoParcelado>();
    for (const l of planoLinhas) {
      const id = n(l.plano_id);
      let plano = porPlano.get(id);
      if (!plano) {
        plano = {
          planoId: id,
          emissorSlug: String(l.emissor_slug ?? ""),
          linhaSlug: String(l.linha_slug ?? ""),
          rotulo: String(l.merchant_label ?? "sem rótulo na fonte"),
          compraEm: dia(l.purchase_date),
          parcelasTotal: n(l.installments_total),
          parcelasFaturadas: n(l.installments_billed),
          parcelasAbertas: n(l.installments_open),
          valorParcelaCents: nOuNulo(l.installment_amount_cents),
          totalCents: nOuNulo(l.total_amount_cents),
          totalEstimado: Boolean(l.total_is_estimated),
          primeiroMes: dia(l.first_competence_month),
          ultimoMes: dia(l.last_competence_month),
          status: String(l.status ?? ""),
          finais: (l.finais as string) ?? null,
          atravessaReemissao: Boolean(l.atravessa_reemissao),
          reemissaoDeclarada: Boolean(l.reemissao_declarada),
          reemissaoMotivo: (l.reemissao_motivo as string) ?? null,
          categoriaCode: (l.categoria_code as string) ?? null,
          categoria: (l.categoria as string) ?? null,
          categoriaMotivo: (l.categoria_motivo as string) ?? null,
          parcelas: []
        };
        porPlano.set(id, plano);
      }
      if (l.item_id !== null && l.item_id !== undefined) {
        plano.parcelas.push({
          itemId: n(l.item_id),
          numero: nOuNulo(l.installment_number),
          last4: (l.last4_da_parcela as string) ?? null,
          postedOn: dia(l.posted_on),
          competenciaMes: dia(l.competence_month),
          billId: nOuNulo(l.bill_id),
          valorCents: n(l.amount_cents),
          futura: Boolean(l.futura)
        });
      }
    }

    const c0 = cob[0] ?? {};

    return contrato({
      dominio: DOMINIO,
      dado: {
        arvore: arvore.map(mapearNo),
        saidas: saidas.map((s) => ({
          transactionId: n(s.transaction_id),
          conta: String(s.conta ?? ""),
          postedOn: dia(s.posted_on) ?? "",
          saiuCents: n(s.saiu_cents),
          descricao: (s.description_raw as string) ?? null,
          categoriaCode: (s.categoria_code as string) ?? null,
          categoria: (s.categoria as string) ?? null,
          categoriaMotivo: (s.categoria_motivo as string) ?? null,
          emissor: String(s.emissor ?? ""),
          emissorSlug: String(s.emissor_slug ?? ""),
          linhaSlug: String(s.linha_slug ?? ""),
          billId: n(s.bill_id),
          origemFatura: String(s.origem_fatura ?? ""),
          mesReferencia: dia(s.reference_month),
          vencimento: dia(s.due_date),
          faturaCents: n(s.fatura_cents),
          itemizadoCents: n(s.itemizado_cents),
          naoItemizadoCents: n(s.nao_itemizado_cents),
          pctExplicado: nOuNulo(s.pct_explicado),
          diferencaCents: n(s.diferenca_declarado_pago_cents),
          ressalva: (s.unreconciled_reason as string) ?? null
        })),
        competencia: competencia.map((c) => ({
          mes: dia(c.mes) ?? "",
          emissorSlug: String(c.emissor_slug ?? ""),
          linhaSlug: String(c.linha_slug ?? ""),
          cardId: nOuNulo(c.card_id),
          last4: (c.last4 as string) ?? null,
          titular: (c.titular as string) ?? null,
          faixa: c.faixa === "nao_itemizado" ? "nao_itemizado" : "item",
          itens: n(c.itens),
          valorCents: n(c.valor_cents),
          comCategoriaCents: n(c.com_categoria_cents),
          itensSemCategoria: n(c.itens_sem_categoria),
          motivo: (c.motivo as string) ?? null
        })),
        caixa: caixa.map((k) => ({
          mes: dia(k.mes) ?? "",
          emissorSlug: String(k.emissor_slug ?? ""),
          linhaSlug: String(k.linha_slug ?? ""),
          conta: String(k.conta ?? ""),
          pagamentos: n(k.pagamentos),
          saiuCents: n(k.saiu_cents),
          faturaDeclaradaCents: n(k.fatura_declarada_cents),
          pagamentosSemCategoria: n(k.pagamentos_sem_categoria)
        })),
        prova: prova.map((p) => ({
          mes: dia(p.mes) ?? "",
          emissorSlug: String(p.emissor_slug ?? ""),
          linhaSlug: String(p.linha_slug ?? ""),
          competenciaItensCents: n(p.competencia_itens_cents),
          competenciaNaoItemizadoCents: n(p.competencia_nao_itemizado_cents),
          itens: n(p.itens),
          caixaSaiuCents: nOuNulo(p.caixa_saiu_cents),
          caixaPagamentos: nOuNulo(p.caixa_pagamentos),
          caixaConta: (p.caixa_conta as string) ?? null,
          porqueNaoSoma: String(p.porque_nao_soma ?? "")
        })),
        planos: [...porPlano.values()],
        lacunas: lacunas.map((l) => ({
          lacuna: String(l.lacuna),
          escopo: String(l.escopo),
          itens: n(l.itens),
          valorCents: n(l.valor_cents),
          motivo: String(l.motivo)
        })),
        cobertura: {
          itens: n(c0.itens),
          semCategoria: n(c0.sem_categoria),
          semCategoriaCents: n(c0.sem_categoria_cents),
          semTitular: n(c0.sem_titular),
          semTitularCents: n(c0.sem_titular_cents),
          semCentroCusto: n(c0.sem_centro_custo),
          subcartoesSemTitular: n(c0.subcartoes_sem_titular)
        },
        comprometidoFuturoCents: n(futuro[0]?.total),
        comprometidoFuturoLinhas: n(futuro[0]?.linhas)
      },
      ressalvas: [
        "Fatura e item são o MESMO dinheiro visto de dois lugares. `competencia` e `caixa` " +
          "nunca se somam: a compra é custo na competência, só o pagamento da fatura é caixa.",
        "O caixa do cartão é ancorado em fin_card_bill.paid_transaction_id, não na categoria 9.01 — " +
          "os pagamentos de fatura do Inter não têm categoria e sumiriam de qualquer medida por rótulo.",
        "A parte não itemizada é um nó próprio com motivo, nunca uma diferença diluída entre os " +
          "subcartões. A fonte não itemiza; fechar por diferença criaria dono para gasto alheio.",
        "Fatura pertence à linha de crédito, não ao subcartão: uma fatura do Nubank mistura de 5 a 8 " +
          "finais. Por isso a árvore desce pela fatura e abre por subcartão dentro dela."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:cartao-detalhe]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

function mapearNo(a: Record<string, unknown>): NoArvore {
  return {
    nivel: String(a.nivel) as NivelArvore,
    profundidade: n(a.profundidade),
    chave: String(a.chave),
    paiKey: (a.chave_pai as string) ?? null,
    emissorSlug: (a.emissor_slug as string) ?? null,
    linhaSlug: (a.linha_slug as string) ?? null,
    rotulo: String(a.rotulo ?? ""),
    detalhe: (a.detalhe as string) ?? null,
    valorCents: n(a.valor_cents),
    itemizadoCents: n(a.itemizado_cents),
    naoItemizadoCents: n(a.nao_itemizado_cents),
    itens: nOuNulo(a.itens),
    motivo: (a.motivo as string) ?? null
  };
}

/**
 * Os filhos de um nó — o passo do drill que a carga inicial não traz.
 *
 * Só o nível `item` chega por aqui hoje, e é justamente o nível grande. A
 * consulta filtra por `chave_pai`, que é a mesma coluna que a árvore usa para
 * se montar: não existe um segundo critério de "quem é filho de quem".
 */
export async function getFilhosDoCartao(chave: string): Promise<Contrato<NoArvore[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, [], "banco financeiro não configurado");

  try {
    const faltando = await viewsAusentes();
    if (faltando.length) {
      return contratoIndisponivel(
        DOMINIO,
        [],
        `a migration 0114_fin_cartao_detalhe.sql ainda não está aplicada neste ambiente (faltam: ${faltando.join(", ")})`
      );
    }

    const filhos = await query<Record<string, unknown>>(
      `SELECT a.* FROM fin_card_arvore_v a
         JOIN fin_entity e ON e.id = a.entity_id
        WHERE e.slug = $1 AND a.chave_pai = $2
        ORDER BY a.ordem`,
      [ENTIDADE, chave]
    );

    return contrato({
      dominio: DOMINIO,
      dado: filhos.map(mapearNo),
      ressalvas: filhos.length
        ? []
        : ["Nenhum filho: ou o nó é folha, ou a fonte não itemiza este ramo — a linha `não itemizado` diz qual dos dois."]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:cartao-detalhe:filhos]", mensagem);
    return contratoIndisponivel(DOMINIO, [], mensagem);
  }
}
