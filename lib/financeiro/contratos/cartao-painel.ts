import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, comFallback, ENTIDADE, type Contrato } from "./base";

/**
 * O painel de cartões — quanto se gastou, em qual plástico, com o quê.
 *
 * ---------------------------------------------------------------------------
 * ESTE CONTRATO VIVE INTEIRO DO LADO DA COMPETÊNCIA
 * ---------------------------------------------------------------------------
 * `cartao-detalhe.ts` (a tela que já existe) protege uma regra: fatura e item
 * são o mesmo dinheiro visto de dois lugares e NÃO SE SOMAM. Ela mostra os dois
 * lados porque a pergunta dela é "o que saiu do caixa e como se compõe".
 *
 * A pergunta AQUI é outra e tem um lado só: **quanto se gastou**. Gasto é
 * evento de compra — acontece quando o cartão passa, não quando a fatura vence.
 * Por isso tudo neste arquivo é `fin_card_transaction` na competência, e
 * `kind = 'pagamento_fatura'` está excluído de TODA consulta: ele é a saída de
 * caixa que paga o conjunto, e somá-lo aos itens contaria o mesmo dinheiro
 * duas vezes — o erro que a outra tela existe para impedir.
 *
 * Medido no acervo em 24/08/2026: os pagamentos de fatura somam −R$ 106.999,04
 * enquanto as compras somam R$ 85.079,12. Um total ingênuo de
 * `sum(amount_cents)` devolve −R$ 22.940,95, um número que não significa nada.
 * É esse o número que aparece quando se esquece o filtro de `kind`.
 *
 * ---------------------------------------------------------------------------
 * REALIZADO E PREVISTO SÃO DADO, NÃO ESTIMATIVA
 * ---------------------------------------------------------------------------
 * O emissor manda a parcela futura como lançamento `PENDING` com
 * `competence_month` no futuro — 67 deles hoje, indo até abril/2027. Então a
 * "projeção" desta tela não é modelo nenhum: é o que o Nubank já disse que vai
 * cobrar. `POSTED` é o que já fechou.
 *
 * A distinção nunca vira uma soma só. Um mês parcialmente fechado (o corrente)
 * tem os dois, e apresentá-los somados esconderia que metade ainda pode mudar.
 */

const DOMINIO = "cartao-painel";

/** Só evento de COMPRA entra. Pagamento de fatura é caixa e mora na outra tela. */
const SO_GASTO = `t.kind IN ('compra', 'iof', 'estorno')`;

export type MesDoCartao = {
  /** `YYYY-MM` — a competência, isto é, quando a compra aconteceu. */
  mes: string;
  cardId: number | null;
  last4: string | null;
  apelido: string | null;
  bandeira: string | null;
  emissor: string | null;
  realizadoCents: number;
  previstoCents: number;
  itens: number;
};

export type PlasticoDoPainel = {
  cardId: number;
  last4: string;
  apelido: string | null;
  bandeira: string | null;
  cor: string | null;
  tipo: string;
  status: string;
  emissor: string | null;
  emissorSlug: string | null;
  contaId: number | null;
  conta: string | null;
  /**
   * O QUE A FONTE DESTE PLÁSTICO CONSEGUE CONTAR.
   *
   *   `itens`               o emissor manda compra a compra (Nubank)
   *   `somente_fatura`      manda o total da fatura, sem itens
   *   `somente_pagamento`   manda só o pagamento (Banco Inter, Asaas)
   *
   * ESTE CAMPO EXISTE PARA IMPEDIR UMA MENTIRA ESPECÍFICA. Os três plásticos
   * do Inter têm `compras = 0` e `anoCents = 0` — não porque estejam parados,
   * mas porque o Inter nunca diz o que eles compraram. A linha do Inter gastou
   * R$ 40.862,41 em 2026, tudo dentro do não itemizado.
   *
   * Um mini-cartão mostrando "0 compras · R$ 0,00" para esses três afirma que
   * eles não foram usados. É falso, e é o erro que a casa proíbe: zero e "não
   * sei" nunca compartilham representação. Com este campo a tela sabe dizer
   * "sem detalhamento" em vez de "zero".
   */
  itemizacao: "itens" | "somente_fatura" | "somente_pagamento" | null;
  /** Limite TEÓRICO atribuído por uma pessoa. Null = ninguém definiu. */
  limiteCents: number | null;
  limiteDefinidoPor: string | null;
  /** O que este plástico gastou no mês corrente (competência). */
  mesCorrenteCents: number;
  /** O que já está lançado para o MÊS SEGUINTE — a próxima fatura deste plástico. */
  proximaFaturaCents: number;
  /** Tudo já lançado daqui para a frente (parcelas vão até abr/2027). Não é uma fatura só. */
  futuroTotalCents: number;
  /** Gasto acumulado no ano corrente. */
  anoCents: number;
  totalCents: number;
  compras: number;
  ultimaCompraEm: string | null;
  /** Percentual do limite teórico consumido no mês corrente. Null sem limite. */
  usoDoLimitePct: number | null;
};

export type TransacaoDoPainel = {
  id: number;
  postedOn: string;
  competencia: string;
  descricao: string;
  merchant: string | null;
  valorCents: number;
  kind: string;
  status: string;
  cardId: number | null;
  last4: string | null;
  apelido: string | null;
  emissor: string | null;
  categoriaId: number | null;
  categoria: string | null;
  nucleo: string | null;
  centroId: number | null;
  centro: string | null;
  parcela: number | null;
  parcelasTotal: number | null;
  mcc: string | null;
  /** Qualificado por quem: regra, humano, ou nada ainda. */
  classificadoPor: string | null;
  /** O que falta para este lançamento estar explicado. Vazio = está completo. */
  falta: ("categoria" | "nucleo")[];
};

export type RankingDoPainel = {
  id: number;
  descricao: string;
  valorCents: number;
  postedOn: string;
  last4: string | null;
  apelido: string | null;
  categoria: string | null;
  nucleo: string | null;
  centro: string | null;
};

/**
 * Uma fatia de um eixo de análise (categoria, núcleo, centro de custo).
 *
 * ESCOPO: ANO CORRENTE, e isso é deliberado. A primeira versão recortava
 * `>= 2026-01-01`, o que arrastava junto as parcelas já lançadas para 2027 —
 * e aí a soma das fatias dava R$ 63.976,89 contra os R$ 62.421,09 do KPI "no
 * ano", na mesma tela. Duas somas do "mesmo" total que não batem é o tipo de
 * divergência que faz alguém parar de confiar na página inteira.
 *
 * `chave = 'sem'` é a fatia do que não tem aquele eixo preenchido. Ela é
 * MEDIDA, não resto: nunca deve ser escondida nem rateada entre as fatias
 * conhecidas.
 */
export type QuebraDoPainel = {
  chave: string;
  rotulo: string;
  valorCents: number;
  itens: number;
};

/**
 * O gasto que a fonte NÃO explica compra a compra.
 *
 * Medido em 24/08/2026: em 2026, R$ 62.421,09 vêm itemizados e R$ 52.674,82
 * NÃO — quase o mesmo tamanho. Desses, R$ 40.862,41 são o Banco Inter inteiro
 * (`itemization_level = 'somente_pagamento'`: o emissor entrega o pagamento da
 * fatura e nunca os itens) e R$ 13.744,87 são faturas do Nubank cujo
 * detalhamento não veio.
 *
 * Sem esta série, todo número desta tela subnotificaria o gasto de cartão em
 * quase metade — e pior, silenciosamente: um KPI "no ano: R$ 62.421,09" parece
 * completo. Ele não é.
 *
 * Não entra na quebra por cartão de propósito: NÃO SE SABE de qual plástico
 * este dinheiro saiu. Ratear entre os cartões conhecidos seria inventar dono
 * para gasto sem dono — a regra que a tela irmã (`cartao-detalhe.ts`) existe
 * para proteger.
 */
export type NaoItemizadoDoMes = {
  mes: string;
  emissor: string | null;
  valorCents: number;
  motivo: string | null;
};

export type CartaoPainel = {
  /** Competência corrente (`YYYY-MM`), a âncora de todos os "deste mês". */
  mesCorrente: string;
  mesAnterior: string;
  ano: number;
  kpi: {
    mesAnteriorCents: number;
    mesCorrenteRealizadoCents: number;
    mesCorrentePrevistoCents: number;
    anoCents: number;
    /** Já lançado para meses futuros — parcelas que o emissor confirmou. */
    futuroCents: number;
    /** Variação do mês corrente contra o anterior, em pontos percentuais. */
    variacaoPct: number | null;
    /** O que a fonte não itemiza, no ano — ver `NaoItemizadoDoMes`. */
    anoNaoItemizadoCents: number;
    /** Idem, no mês anterior e no corrente. */
    mesAnteriorNaoItemizadoCents: number;
    mesCorrenteNaoItemizadoCents: number;
    /**
     * O TOTAL do mês — itemizado mais o que a fonte não detalha.
     *
     * Estes existem porque a alternativa se mostrou pior. A primeira versão
     * deixava a manchete do mês no itemizado, com o argumento de que o
     * itemizado é medido na competência da compra e o não itemizado na data da
     * fatura, e misturar os dois eixos num único mês é impreciso na borda
     * (compra do fim de julho, fatura de agosto).
     *
     * Só que medido: julho de 2026 tem R$ 5.483,14 itemizados e R$ 6.809,21
     * NÃO itemizados. A manchete "mês passado: R$ 5.483,14" subnotifica julho
     * em 55% — o não itemizado é MAIOR que o itemizado. Errar 55% para menos é
     * incomparavelmente pior que uma imprecisão de borda de alguns dias.
     *
     * Então o total é a manchete e a composição fica embaixo dele. A tela
     * mostra as duas partes; o que ela não faz é chamar a metade de "o mês".
     */
    mesAnteriorTotalCents: number;
    mesCorrenteTotalCents: number;
    /**
     * O gasto de cartão no ano SOMANDO o que se sabe e o que não se sabe.
     * É o único número desta tela que responde "quanto o cartão custou" sem
     * subnotificar — e por isso ele nunca pode ser quebrado por cartão.
     *
     * RECONCILIAÇÃO CONFERIDA EM 24/08/2026 (as quatro contas fecham):
     *
     *   faturas de 2026 cobradas ......... R$ 108.095,08  (`fin_card_bill`)
     *     = itemizado ..................... R$  55.420,26  (POSTED, competência 2026)
     *     + não itemizado ................. R$  52.674,82  (bate com `naoItemizado`)
     *
     *   itens de todo o acervo ........... R$  84.058,09
     *     = itemizado já faturado ......... R$  75.501,46  (2025 + 2026)
     *     + parcelas PENDING ainda não faturadas .. R$ 8.556,63
     *
     *   `anoTotalCents` de 2026 .......... R$ 115.095,91
     *     = R$ 62.421,09 itemizado (POSTED + PENDING de 2026) + R$ 52.674,82
     *
     * A diferença para os R$ 108.095,08 das faturas são os R$ 7.000,83 de
     * parcelas de 2026 que o emissor ainda não cobrou. Isso é correto para
     * "quanto se gastou": a compra parcelada aconteceu quando o cartão passou.
     *
     * O PORÉM HONESTO: o itemizado é medido na COMPETÊNCIA da compra e o não
     * itemizado na data da FATURA — a fonte não oferece competência para o que
     * ela não detalha. Num total anual a diferença é de borda (compras de
     * dezembro faturadas em janeiro); num mês isolado ela apareceria. Por isso
     * o número anual existe e o "total do mês" não.
     *
     * Nenhum item de cartão entra no ledger: `fin_card_transaction` não tem
     * ponteiro para `fin_transaction` (conferido). Só o pagamento da fatura
     * vira lançamento — R$ 107.600,75 em 2026 —, então não há dupla contagem
     * possível entre esta tela e as de caixa.
     */
    anoTotalCents: number;
  };
  serie: MesDoCartao[];
  naoItemizado: NaoItemizadoDoMes[];
  plasticos: PlasticoDoPainel[];
  transacoes: TransacaoDoPainel[];
  ranking: RankingDoPainel[];
  porCategoria: QuebraDoPainel[];
  porNucleo: QuebraDoPainel[];
  porCentro: QuebraDoPainel[];
  aQualificar: {
    semCategoria: { itens: number; valorCents: number };
    semNucleo: { itens: number; valorCents: number };
  };
};

const VAZIO: CartaoPainel = {
  mesCorrente: "",
  mesAnterior: "",
  ano: 0,
  kpi: {
    mesAnteriorCents: 0,
    mesCorrenteRealizadoCents: 0,
    mesCorrentePrevistoCents: 0,
    anoCents: 0,
    futuroCents: 0,
    variacaoPct: null,
    anoNaoItemizadoCents: 0,
    mesAnteriorNaoItemizadoCents: 0,
    mesCorrenteNaoItemizadoCents: 0,
    mesAnteriorTotalCents: 0,
    mesCorrenteTotalCents: 0,
    anoTotalCents: 0
  },
  serie: [],
  naoItemizado: [],
  plasticos: [],
  transacoes: [],
  ranking: [],
  porCategoria: [],
  porNucleo: [],
  porCentro: [],
  aQualificar: { semCategoria: { itens: 0, valorCents: 0 }, semNucleo: { itens: 0, valorCents: 0 } }
};

const mesIso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export async function getCartaoPainel(): Promise<Contrato<CartaoPainel>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, VAZIO, "FINANCE_DATABASE_URL não está configurada");
  }

  return comFallback(DOMINIO, VAZIO, async () => {
    const agora = new Date();
    const mesCorrente = mesIso(agora);
    const mesAnterior = mesIso(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1)));
    const ano = agora.getUTCFullYear();

    const [serie, plasticos, transacoes, ranking, porCategoria, porNucleo, porCentro, pendente, naoItem] =
      await Promise.all([
        // --------------------------------------------------------------------
        // A série mensal por plástico — o eixo do gráfico empilhado.
        // --------------------------------------------------------------------
        // Agrupada por (mês, cartão) e já separando realizado de previsto em
        // COLUNAS, não em linhas: a tela precisa desenhar os dois no mesmo mês
        // sem refazer a conta, e uma linha por status obrigaria o cliente a
        // reagrupar — que é onde as duas medidas acabam somadas por engano.
        query<{
          mes: string; card_id: number | null; last4: string | null; label: string | null;
          brand: string | null; emissor: string | null;
          realizado: string; previsto: string; itens: string;
        }>(
          `SELECT to_char(t.competence_month, 'YYYY-MM') AS mes,
                  t.card_id, c.last4, c.label, c.brand, i.name AS emissor,
                  sum(t.amount_cents) FILTER (WHERE t.status = 'POSTED')  AS realizado,
                  sum(t.amount_cents) FILTER (WHERE t.status <> 'POSTED') AS previsto,
                  count(*) AS itens
             FROM fin_card_transaction t
             LEFT JOIN fin_card c ON c.id = t.card_id
             LEFT JOIN fin_card_account a ON a.id = t.card_account_id
             LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
            WHERE ${SO_GASTO}
              -- Janeiro do ano corrente, calculado. Cravar 2026 faria o
              -- gráfico arrastar anos inteiros de histórico a cada virada.
              AND t.competence_month >= make_date($1::int, 1, 1)
            GROUP BY 1, 2, 3, 4, 5, 6
            ORDER BY 1, 2`,
          [ano]
        ),

        // --------------------------------------------------------------------
        // Os plásticos, com o que cada um gastou e o limite teórico.
        // --------------------------------------------------------------------
        // LEFT JOIN a partir de `fin_card`: um cartão que nunca gastou precisa
        // aparecer na tela (é dele que se quer saber que está parado), e um
        // INNER o esconderia exatamente quando ele importa.
        query<{
          id: number; last4: string; label: string | null; brand: string | null; cor: string | null;
          kind: string; status: string; emissor: string | null; emissor_slug: string | null;
          conta_id: number | null; conta: string | null; itemization_level: string | null;
          limite_cents: string | null; limite_definido_por: string | null;
          mes_corrente: string | null; proxima_fatura: string | null; futuro_total: string | null;
          ano_cents: string | null;
          total: string | null; compras: string; ultima_compra: string | null;
        }>(
          `WITH gasto AS (
             SELECT t.card_id,
                    sum(t.amount_cents) FILTER (
                      WHERE to_char(t.competence_month, 'YYYY-MM') = $1) AS mes_corrente,
                    sum(t.amount_cents) FILTER (
                    -- O MÊS SEGUINTE, não "tudo que vem pela frente". A primeira
                    -- versão usava "maior que o mês corrente", que somava as
                    -- parcelas até abril/2027 e chamava aquilo de "próxima
                    -- fatura" — um número que ninguém vai pagar de uma vez.
                      WHERE t.competence_month
                            = (date_trunc('month', now()) + interval '1 month')::date) AS proxima_fatura,
                    sum(t.amount_cents) FILTER (
                      WHERE t.competence_month > date_trunc('month', now())::date) AS futuro_total,
                    sum(t.amount_cents) FILTER (
                      WHERE extract(year from t.competence_month) = $2) AS ano_cents,
                    sum(t.amount_cents) AS total,
                    count(*) FILTER (WHERE t.kind = 'compra') AS compras,
                    max(t.posted_on) AS ultima_compra
               FROM fin_card_transaction t
              WHERE ${SO_GASTO}
              GROUP BY t.card_id
           )
           SELECT c.id, c.last4, c.label, c.brand, c.cor, c.kind, c.status,
                  i.name AS emissor, i.slug AS emissor_slug,
                  a.id AS conta_id, a.name AS conta, a.itemization_level,
                  c.limite_cents, c.limite_definido_por,
                  g.mes_corrente, g.proxima_fatura, g.futuro_total, g.ano_cents, g.total,
                  coalesce(g.compras, 0) AS compras, g.ultima_compra
             FROM fin_card c
             LEFT JOIN fin_card_account a ON a.id = c.card_account_id
             LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
             LEFT JOIN gasto g ON g.card_id = c.id
            ORDER BY i.name NULLS LAST, coalesce(g.total, 0) DESC, c.last4`,
          [mesCorrente, ano]
        ),

        // --------------------------------------------------------------------
        // As transações. Todas — o filtro é da tela, não da consulta.
        // --------------------------------------------------------------------
        // 795 linhas cabem numa carga só (a árvore da outra tela já carrega
        // ~140 nós sem os itens, e aqui o payload são campos escalares). Filtrar
        // no servidor obrigaria uma ida ao banco por toque de filtro, num painel
        // cuja graça é justamente cruzar os recortes rápido.
        query<{
          id: number; posted_on: string; competencia: string; description: string;
          merchant: string | null; amount_cents: string; kind: string; status: string;
          card_id: number | null; last4: string | null; label: string | null; emissor: string | null;
          category_id: number | null; categoria: string | null; nucleo: string | null;
          cost_center_id: number | null; centro: string | null;
          installment_number: number | null; installments_total: number | null;
          mcc: string | null; classified_by: string | null;
        }>(
          `SELECT t.id, t.posted_on, to_char(t.competence_month, 'YYYY-MM') AS competencia,
                  t.description, t.merchant, t.amount_cents, t.kind, t.status,
                  t.card_id, c.last4, c.label, i.name AS emissor,
                  t.category_id, (cat.code || ' ' || cat.name) AS categoria,
                  t.nucleo, t.cost_center_id, cc.name AS centro,
                  t.installment_number, t.installments_total, t.mcc, t.classified_by
             FROM fin_card_transaction t
             LEFT JOIN fin_card c ON c.id = t.card_id
             LEFT JOIN fin_card_account a ON a.id = t.card_account_id
             LEFT JOIN fin_card_issuer i ON i.id = a.issuer_id
             LEFT JOIN fin_category cat ON cat.id = t.category_id
             LEFT JOIN fin_cost_center cc ON cc.id = t.cost_center_id
            WHERE ${SO_GASTO}
            ORDER BY t.posted_on DESC, t.id DESC`
        ),

        // O ranking dos maiores. `kind = 'compra'` só: IOF de R$ 0,42 no topo
        // de um ranking de maiores gastos seria ruído, e estorno é negativo.
        query<{
          id: number; description: string; amount_cents: string; posted_on: string;
          last4: string | null; label: string | null; categoria: string | null;
          nucleo: string | null; centro: string | null;
        }>(
          `SELECT t.id, t.description, t.amount_cents, t.posted_on,
                  c.last4, c.label, (cat.code || ' ' || cat.name) AS categoria,
                  t.nucleo, cc.name AS centro
             FROM fin_card_transaction t
             LEFT JOIN fin_card c ON c.id = t.card_id
             LEFT JOIN fin_category cat ON cat.id = t.category_id
             LEFT JOIN fin_cost_center cc ON cc.id = t.cost_center_id
            -- O ANO, não "2026 em diante". A tela intitula esta lista "Os
            -- maiores gastos de {ano}" com o ano dinâmico; um piso fixo em
            -- 2026 faria o título dizer 2027 e a lista mostrar 2026. É o mesmo
            -- descolamento que já tinha acontecido nas quebras.
            WHERE t.kind = 'compra' AND extract(year from t.competence_month) = $1
            ORDER BY t.amount_cents DESC
            LIMIT 25`,
          [ano]
        ),

        query<{ chave: string; rotulo: string; valor: string; itens: string }>(
          `SELECT coalesce(cat.code, 'sem') AS chave,
                  coalesce(cat.code || ' ' || cat.name, 'Sem categoria') AS rotulo,
                  sum(t.amount_cents) AS valor, count(*) AS itens
             FROM fin_card_transaction t
             LEFT JOIN fin_category cat ON cat.id = t.category_id
            WHERE ${SO_GASTO} AND extract(year from t.competence_month) = $1
            GROUP BY 1, 2 ORDER BY 3 DESC`,
          [ano]
        ),

        query<{ chave: string; rotulo: string; valor: string; itens: string }>(
          `SELECT coalesce(t.nucleo, 'sem') AS chave,
                  coalesce(initcap(t.nucleo), 'Sem núcleo') AS rotulo,
                  sum(t.amount_cents) AS valor, count(*) AS itens
             FROM fin_card_transaction t
            WHERE ${SO_GASTO} AND extract(year from t.competence_month) = $1
            GROUP BY 1, 2 ORDER BY 3 DESC`,
          [ano]
        ),

        query<{ chave: string; rotulo: string; valor: string; itens: string }>(
          `SELECT coalesce(cc.id::text, 'sem') AS chave,
                  coalesce(cc.name, 'Sem centro de custo') AS rotulo,
                  sum(t.amount_cents) AS valor, count(*) AS itens
             FROM fin_card_transaction t
             LEFT JOIN fin_cost_center cc ON cc.id = t.cost_center_id
            WHERE ${SO_GASTO} AND extract(year from t.competence_month) = $1
            GROUP BY 1, 2 ORDER BY 3 DESC`,
          [ano]
        ),

        query<{ sem_categoria: string; valor_categoria: string; sem_nucleo: string; valor_nucleo: string }>(
          `SELECT count(*) FILTER (WHERE t.category_id IS NULL) AS sem_categoria,
                  coalesce(sum(t.amount_cents) FILTER (WHERE t.category_id IS NULL), 0) AS valor_categoria,
                  count(*) FILTER (WHERE t.nucleo IS NULL) AS sem_nucleo,
                  coalesce(sum(t.amount_cents) FILTER (WHERE t.nucleo IS NULL), 0) AS valor_nucleo
             FROM fin_card_transaction t
            WHERE t.kind IN ('compra', 'iof')`
        ),

        // O que a fonte não explica. Vem da view da 0114, que é a única
        // definição de "esta fatura tem tanto de buraco" — recalcular aqui
        // criaria uma segunda, e as duas divergiriam na primeira fatura nova.
        query<{ mes: string; emissor: string | null; valor_cents: string; motivo: string | null }>(
          // `motivo` NÃO vem agregado. A view guarda um motivo por LINHA, com
          // números do mês daquela linha ("a fonte declara 4,191.06 e itemiza
          // .00"); um `min()` sobre o grupo escolheria o motivo de um mês
          // qualquer e o colaria num acumulado de oito — dois números que se
          // contradizem na mesma frase. O que a tela precisa dizer ("o emissor
          // não entrega os itens") é do EMISSOR, não do mês, e cabe nela.
          `SELECT to_char(mes, 'YYYY-MM') AS mes, emissor, sum(valor_cents) AS valor_cents,
                  NULL::text AS motivo
             FROM fin_card_serie_mensal_v
            WHERE faixa = 'nao_itemizado' AND mes >= make_date($1::int, 1, 1)
            GROUP BY 1, 2
            ORDER BY 1, 2`,
          [ano]
        )
      ]);

    const n = (v: string | number | null | undefined) => Number(v ?? 0);

    const serieMapeada: MesDoCartao[] = serie.map((s) => ({
      mes: s.mes,
      cardId: s.card_id === null ? null : Number(s.card_id),
      last4: s.last4,
      apelido: s.label,
      bandeira: s.brand,
      emissor: s.emissor,
      realizadoCents: n(s.realizado),
      previstoCents: n(s.previsto),
      itens: n(s.itens)
    }));

    const plasticosMapeados: PlasticoDoPainel[] = plasticos.map((p) => {
      const limiteCents = p.limite_cents === null ? null : n(p.limite_cents);
      const mesCorrenteCents = n(p.mes_corrente);
      return {
        cardId: Number(p.id),
        last4: p.last4,
        apelido: p.label,
        bandeira: p.brand,
        cor: p.cor,
        tipo: p.kind,
        status: p.status,
        emissor: p.emissor,
        emissorSlug: p.emissor_slug,
        contaId: p.conta_id === null ? null : Number(p.conta_id),
        conta: p.conta,
        itemizacao: (p.itemization_level as PlasticoDoPainel["itemizacao"]) ?? null,
        limiteCents,
        limiteDefinidoPor: p.limite_definido_por,
        mesCorrenteCents,
        proximaFaturaCents: n(p.proxima_fatura),
        futuroTotalCents: n(p.futuro_total),
        anoCents: n(p.ano_cents),
        totalCents: n(p.total),
        compras: n(p.compras),
        ultimaCompraEm: p.ultima_compra ? String(p.ultima_compra).slice(0, 10) : null,
        // Sem limite definido não existe percentual — e zero aqui desenharia
        // uma barra vazia que se lê como "não usou nada", que é outra coisa.
        usoDoLimitePct:
          limiteCents === null || limiteCents === 0
            ? null
            : Math.round((mesCorrenteCents / limiteCents) * 1000) / 10
      };
    });

    const transacoesMapeadas: TransacaoDoPainel[] = transacoes.map((t) => {
      const falta: ("categoria" | "nucleo")[] = [];
      // Estorno não precisa de categoria própria — ele desfaz uma compra que já
      // tem a dela. Cobrá-lo na fila de qualificação encheria a fila de linhas
      // que ninguém deveria mexer.
      if (t.kind !== "estorno") {
        if (t.category_id === null) falta.push("categoria");
        if (t.nucleo === null) falta.push("nucleo");
      }
      return {
        id: Number(t.id),
        postedOn: String(t.posted_on).slice(0, 10),
        competencia: t.competencia,
        descricao: t.description,
        merchant: t.merchant,
        valorCents: n(t.amount_cents),
        kind: t.kind,
        status: t.status,
        cardId: t.card_id === null ? null : Number(t.card_id),
        last4: t.last4,
        apelido: t.label,
        emissor: t.emissor,
        categoriaId: t.category_id === null ? null : Number(t.category_id),
        categoria: t.categoria,
        nucleo: t.nucleo,
        centroId: t.cost_center_id === null ? null : Number(t.cost_center_id),
        centro: t.centro,
        parcela: t.installment_number,
        parcelasTotal: t.installments_total,
        mcc: t.mcc,
        classificadoPor: t.classified_by,
        falta
      };
    });

    const somaSerie = (filtro: (s: MesDoCartao) => boolean, campo: "realizadoCents" | "previstoCents") =>
      serieMapeada.filter(filtro).reduce((s, m) => s + m[campo], 0);

    const mesAnteriorCents = somaSerie((s) => s.mes === mesAnterior, "realizadoCents");
    const mesCorrenteRealizadoCents = somaSerie((s) => s.mes === mesCorrente, "realizadoCents");
    const mesCorrentePrevistoCents = somaSerie((s) => s.mes === mesCorrente, "previstoCents");
    const anoCents = serieMapeada
      .filter((s) => s.mes.startsWith(String(ano)))
      .reduce((s, m) => s + m.realizadoCents + m.previstoCents, 0);
    const futuroCents = serieMapeada
      .filter((s) => s.mes > mesCorrente)
      .reduce((s, m) => s + m.realizadoCents + m.previstoCents, 0);

    const quebra = (linhas: { chave: string; rotulo: string; valor: string; itens: string }[]) =>
      linhas.map((l) => ({ chave: l.chave, rotulo: l.rotulo, valorCents: n(l.valor), itens: n(l.itens) }));

    const naoItemizado: NaoItemizadoDoMes[] = naoItem.map((x) => ({
      mes: x.mes,
      emissor: x.emissor,
      valorCents: n(x.valor_cents),
      motivo: x.motivo
    }));
    const somaNaoItem = (filtro: (x: NaoItemizadoDoMes) => boolean) =>
      naoItemizado.filter(filtro).reduce((s, x) => s + x.valorCents, 0);

    const anoNaoItemizadoCents = somaNaoItem((x) => x.mes.startsWith(String(ano)));
    const mesAnteriorNaoItemizadoCents = somaNaoItem((x) => x.mes === mesAnterior);
    const mesCorrenteNaoItemizadoCents = somaNaoItem((x) => x.mes === mesCorrente);

    // O total do mês inclui o previsto — nos DOIS meses, e essa simetria é o
    // que impede um mês de encolher ao virar de casa.
    //
    // A primeira versão somava previsto só no mês corrente. Agosto tem
    // R$ 149,29 de parcela PENDING: em 1º de setembro, o "Este mês R$ 16.476"
    // viraria "Mês passado R$ 16.327" — o mesmo agosto, R$ 149 menor, sem que
    // nada tivesse acontecido. Um mês não pode mudar de tamanho só porque
    // deixou de ser o corrente.
    const mesAnteriorPrevistoCents = somaSerie((s) => s.mes === mesAnterior, "previstoCents");
    const mesAnteriorTotalCents =
      mesAnteriorCents + mesAnteriorPrevistoCents + mesAnteriorNaoItemizadoCents;
    const mesCorrenteTotalCents =
      mesCorrenteRealizadoCents + mesCorrentePrevistoCents + mesCorrenteNaoItemizadoCents;

    const p = pendente[0];

    return contrato({
      dominio: DOMINIO,
      dado: {
        mesCorrente,
        mesAnterior,
        ano,
        kpi: {
          mesAnteriorCents,
          mesCorrenteRealizadoCents,
          mesCorrentePrevistoCents,
          anoCents,
          futuroCents,
          // A VARIAÇÃO COMPARA OS TOTAIS, não os itemizados.
          //
          // Comparar itemizado com itemizado parece mais puro e é pior: em
          // julho o não itemizado (R$ 6.809,21) supera o itemizado
          // (R$ 5.483,14), e a proporção entre os dois muda todo mês conforme
          // o Inter fatura. Uma variação medida só no itemizado mediria essa
          // oscilação de cobertura, não a mudança de gasto.
          //
          // Continua valendo o aviso do mês em curso: um mês que ainda corre
          // contra um fechado é comparação torta, e o rótulo na tela é que
          // precisa dizer isso. Esconder o número não impede a conta, só a
          // deixa mental.
          variacaoPct:
            mesAnteriorTotalCents === 0
              ? null
              : Math.round(
                  ((mesCorrenteTotalCents - mesAnteriorTotalCents) / mesAnteriorTotalCents) * 1000
                ) / 10,
          anoNaoItemizadoCents,
          mesAnteriorNaoItemizadoCents,
          mesCorrenteNaoItemizadoCents,
          mesAnteriorTotalCents,
          mesCorrenteTotalCents,
          anoTotalCents: anoCents + anoNaoItemizadoCents
        },
        serie: serieMapeada,
        naoItemizado,
        plasticos: plasticosMapeados,
        transacoes: transacoesMapeadas,
        ranking: ranking.map((r) => ({
          id: Number(r.id),
          descricao: r.description,
          valorCents: n(r.amount_cents),
          postedOn: String(r.posted_on).slice(0, 10),
          last4: r.last4,
          apelido: r.label,
          categoria: r.categoria,
          nucleo: r.nucleo,
          centro: r.centro
        })),
        porCategoria: quebra(porCategoria),
        porNucleo: quebra(porNucleo),
        porCentro: quebra(porCentro),
        aQualificar: {
          semCategoria: { itens: n(p?.sem_categoria), valorCents: n(p?.valor_categoria) },
          semNucleo: { itens: n(p?.sem_nucleo), valorCents: n(p?.valor_nucleo) }
        }
      },
      ressalvas: [
        "Gasto é evento de compra, na competência. O pagamento da fatura não entra nesta tela — ele é a saída de caixa que quita o conjunto, e somá-lo aos itens contaria o mesmo dinheiro duas vezes.",
        "O previsto não é estimativa: são as parcelas que o emissor já lançou para meses futuros.",
        "A quebra por cartão cobre só o gasto itemizado. O Banco Inter não entrega itens — a fatura dele inteira aparece como não itemizada, sem plástico."
      ]
    });
  });
}
